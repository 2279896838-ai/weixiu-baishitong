# -*- coding: utf-8 -*-
"""轻量向量检索（可选远端 Embedding，默认离线哈希向量）。

- 默认：字符 n-gram 哈希向量（512 维），无需第三方依赖、无需联网；
- 可选：设置 EMBED_API_BASE / EMBED_API_KEY / EMBED_MODEL 调用 OpenAI 兼容
  /embeddings 接口；失败自动回退哈希向量。
- 供引擎混合检索（关键词 BM25 + 向量余弦）使用。
"""
import hashlib
import json
import math
import os
import ssl
import urllib.request

DIM = 512


def _hash_feature(feature, dim):
    digest = hashlib.md5(feature.encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big")
    index = value % dim
    sign = 1.0 if (value >> 63) == 0 else -1.0
    return index, sign


def _features(text):
    low = str(text or "").lower()
    features = []
    latin = []
    current = []
    cjk_run = []
    for char in low:
        if "\u4e00" <= char <= "\u9fff":
            cjk_run.append(char)
            if current:
                latin.append("".join(current))
                current = []
        else:
            if cjk_run:
                features.extend(_cjk_features(cjk_run))
                cjk_run = []
            if char.isalnum() or char in "-_.":
                current.append(char)
            else:
                if current:
                    latin.append("".join(current))
                    current = []
    if cjk_run:
        features.extend(_cjk_features(cjk_run))
    if current:
        latin.append("".join(current))
    for word in latin:
        if len(word) >= 2:
            features.append(word)
    return features


def _cjk_features(run):
    text = "".join(run)
    features = list(text)
    features.extend(text[i:i + 2] for i in range(len(text) - 1))
    features.extend(text[i:i + 3] for i in range(len(text) - 2))
    return features


def _normalize(vector):
    norm = math.sqrt(sum(v * v for v in vector))
    if norm <= 0:
        return vector
    return [v / norm for v in vector]


def hash_embed(text, dim=DIM):
    vector = [0.0] * dim
    for feature in _features(text):
        index, sign = _hash_feature(feature, dim)
        vector[index] += sign
    return _normalize(vector)


class VectorIndex:
    def __init__(self, dim=DIM):
        self.dim = dim
        self.ids = []
        self.vectors = []
        self.texts = []
        self.backend = "hash"
        self.model = ""
        self.error = ""
        if all(os.environ.get(name) for name in ("EMBED_API_BASE", "EMBED_API_KEY", "EMBED_MODEL")):
            self.backend = "remote"
            self.model = os.environ.get("EMBED_MODEL", "")

    @classmethod
    def from_entries(cls, entries, dim=DIM):
        index = cls(dim)
        for entry in entries:
            entry_id = str(entry.get("id") or "")
            if not entry_id:
                continue
            text = index.entry_text(entry)
            try:
                vector = index.embed(text)
            except Exception as exc:
                index.error = "%s: %s" % (type(exc).__name__, exc)
                index.backend = "hash"
                vector = hash_embed(text, dim)
            index.ids.append(entry_id)
            index.vectors.append(vector)
            index.texts.append(text)
        return index

    @staticmethod
    def entry_text(entry):
        parts = [
            str(entry.get("title") or ""),
            str(entry.get("symptom") or ""),
            " ".join(str(x) for x in entry.get("symptomKeywords") or []),
            " ".join(str(x) for x in entry.get("tags") or []),
            " ".join(str(c.get("rootCause") or "") for c in entry.get("causes") or []),
            " ".join(str(x) for x in entry.get("actions") or []),
        ]
        return " ".join(parts)

    def _remote_embed(self, text):
        base = os.environ.get("EMBED_API_BASE", "").rstrip("/")
        key = os.environ.get("EMBED_API_KEY", "")
        model = os.environ.get("EMBED_MODEL", "")
        url = base if base.endswith("/embeddings") else (base + "/embeddings" if base.endswith("/v1") else base + "/v1/embeddings")
        payload = json.dumps({"model": model, "input": [text]}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=payload, method="POST")
        request.add_header("Content-Type", "application/json")
        request.add_header("Authorization", "Bearer " + key)
        context = None
        if str(os.environ.get("LLM_SSL_VERIFY", "true")).lower() in ("0", "false", "no", "off"):
            context = ssl._create_unverified_context()
        with urllib.request.urlopen(request, timeout=20, context=context) as response:
            data = json.loads(response.read().decode("utf-8"))
        vector = data.get("data", [{}])[0].get("embedding") or []
        if not vector:
            raise RuntimeError("embedding 返回为空")
        return _normalize([float(v) for v in vector])

    def embed(self, text):
        if self.backend == "remote":
            try:
                return self._remote_embed(text)
            except Exception as exc:
                self.error = "%s: %s" % (type(exc).__name__, exc)
                self.backend = "hash"
        return hash_embed(text, self.dim)

    def search(self, query, top_k=10):
        if not self.vectors:
            return {}
        query_vector = self.embed(query)
        scored = []
        for index, vector in enumerate(self.vectors):
            if len(vector) != len(query_vector):
                continue
            score = sum(a * b for a, b in zip(query_vector, vector))
            scored.append((self.ids[index], score))
        scored.sort(key=lambda item: item[1], reverse=True)
        return {entry_id: score for entry_id, score in scored[:max(1, int(top_k))]}

    def info(self):
        return {
            "docs": len(self.ids),
            "dim": self.dim,
            "backend": self.backend,
            "model": self.model,
            "error": self.error,
        }
