# -*- coding: utf-8 -*-
"""提示词资产运行时（Prompt Runtime）。

把 prompts/registry.yaml 与 prompts/**/*.md 加载为可渲染的提示词资产：
- 每个资产含 id / version / path / body / placeholders / sha256；
- render(id, variables) 渲染双花括号变量，未知变量保留并记录；
- validate() 校验 15 个资产齐全、正文非空、版本与文件头一致。

引擎在 LLM 模式下用 WXBST-SYS-001 + WXBST-QA-001 构造 system prompt；
离线模式下资产用于登记、展示与测试，不参与确定性合成。

用法：
    from prompt_runtime import PromptRuntime
    rt = PromptRuntime("prompts")
    rt.render("WXBST-QA-001", {"user_query": "主轴异响"})
"""
import hashlib
import json
import os

EXPECTED_IDS = [
    "WXBST-SYS-001", "WXBST-RTR-001", "WXBST-QA-001", "WXBST-TRG-001",
    "WXBST-CHK-001", "WXBST-CHK-002", "WXBST-DASH-001", "WXBST-WO-001",
    "WXBST-EXT-001", "WXBST-INT-001", "WXBST-RAG-QRY-001", "WXBST-RAG-RNK-001",
    "WXBST-FIX-001", "WXBST-SEC-001", "WXBST-EVL-001",
]

NL = chr(10)
TEXT_MARKER = chr(96) * 3 + "text"
REQUIRED_SECTIONS = ("## 角色",)


class PromptRuntimeError(Exception):
    """提示词资产加载或渲染失败。"""


def find_placeholders(body):
    found = []
    index = 0
    while True:
        start = body.find("{{", index)
        if start < 0:
            break
        end = body.find("}}", start + 2)
        if end < 0:
            break
        key = body[start + 2:end].strip()
        if key and key.replace("_", "").isalnum() and key not in found:
            found.append(key)
        index = end + 2
    return found


def extract_text_body(text):
    pos = text.find(TEXT_MARKER)
    if pos < 0:
        return ""
    line_end = text.find(NL, pos + len(TEXT_MARKER))
    if line_end < 0:
        return ""
    end = text.find(chr(96) * 3, line_end + 1)
    if end < 0:
        return ""
    return text[line_end + 1:end].strip()


def parse_header_version(header):
    for line in header.splitlines():
        if "版本" not in line:
            continue
        value = line.split("版本", 1)[1].strip()
        value = value.lstrip("：:").strip()
        if value.startswith("v"):
            value = value[1:]
        parts = value.split(".")
        if len(parts) == 3 and all(part.isdigit() for part in parts):
            return value
        return ""
    return ""


class PromptAsset:
    def __init__(self, asset_id, version, rel_path, abs_path, body, header):
        self.id = asset_id
        self.version = version
        self.path = rel_path
        self.abs_path = abs_path
        self.body = body
        self.header = header
        self.sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()
        self.placeholders = find_placeholders(body)
        self.chars = len(body)

    def meta(self):
        return {
            "id": self.id,
            "version": self.version,
            "path": self.path,
            "sha256": self.sha256,
            "chars": self.chars,
            "placeholders": list(self.placeholders),
        }

    def as_dict(self):
        data = self.meta()
        data["body"] = self.body
        return data


class PromptRuntime:
    def __init__(self, prompts_dir):
        self.prompts_dir = os.path.abspath(prompts_dir or "prompts")
        self.assets = {}
        self.errors = []
        self.warnings = []
        self._load()

    # ------------------------------------------------------------------
    # 加载与校验
    # ------------------------------------------------------------------

    def _registry_path(self):
        return os.path.join(self.prompts_dir, "registry.yaml")

    def _parse_registry(self):
        path = self._registry_path()
        if not os.path.isfile(path):
            raise PromptRuntimeError("缺少提示词登记表：%s" % path)
        assets = []
        current = None
        with open(path, "r", encoding="utf-8") as handle:
            for raw in handle:
                stripped = raw.strip()
                if not stripped or stripped.startswith("#") or stripped == "assets:":
                    continue
                if stripped.startswith("- id:"):
                    if current:
                        assets.append(current)
                    current = {"id": stripped.split(":", 1)[1].strip()}
                elif current is not None and stripped.startswith("version:"):
                    current["version"] = stripped.split(":", 1)[1].strip()
                elif current is not None and stripped.startswith("path:"):
                    current["path"] = stripped.split(":", 1)[1].strip()
        if current:
            assets.append(current)
        if not assets:
            raise PromptRuntimeError("提示词登记表为空：%s" % path)
        return assets

    def _read_asset(self, item):
        asset_id = item.get("id") or ""
        rel_path = item.get("path") or ""
        if not asset_id or not rel_path:
            raise PromptRuntimeError("登记表条目缺少 id 或 path：%r" % (item,))
        abs_path = os.path.join(self.prompts_dir, rel_path.replace("/", os.sep))
        if not os.path.isfile(abs_path):
            raise PromptRuntimeError("提示词文件不存在：%s" % abs_path)
        with open(abs_path, "r", encoding="utf-8") as handle:
            text = handle.read()
        body = extract_text_body(text)
        if not body:
            raise PromptRuntimeError("提示词缺少代码块正文或正文为空：%s" % abs_path)
        marker_pos = text.find(TEXT_MARKER)
        header = text[: marker_pos] if marker_pos >= 0 else ""
        header_version = parse_header_version(header)
        version = item.get("version") or header_version or "0.0.0"
        if header_version and version != header_version:
            self.warnings.append("%s 登记版本 %s 与文件头版本 %s 不一致" % (asset_id, version, header_version))
        asset = PromptAsset(asset_id, version, rel_path, abs_path, body, header)
        for section in REQUIRED_SECTIONS:
            if section not in body:
                self.warnings.append("%s 缺少必需小节：%s" % (asset_id, section))
        if "## 任务" not in body and "## 目标" not in body:
            self.warnings.append("%s 缺少 ## 任务/## 目标 小节" % asset_id)
        if "## 输出格式" not in body:
            self.warnings.append("%s 缺少 ## 输出格式 小节" % asset_id)
        return asset

    def _load(self):
        registry = self._parse_registry()
        seen = set()
        for item in registry:
            asset = self._read_asset(item)
            if asset.id in seen:
                self.errors.append("重复的提示词编号：%s" % asset.id)
                continue
            seen.add(asset.id)
            self.assets[asset.id] = asset
        missing = [asset_id for asset_id in EXPECTED_IDS if asset_id not in self.assets]
        if missing:
            self.errors.append("缺少提示词资产：%s" % ", ".join(missing))
        unknown = [asset_id for asset_id in self.assets if asset_id not in EXPECTED_IDS]
        if unknown:
            self.warnings.append("存在未登记的提示词资产：%s" % ", ".join(unknown))

    # ------------------------------------------------------------------
    # 查询与渲染
    # ------------------------------------------------------------------

    def get(self, asset_id):
        asset = self.assets.get(str(asset_id or "").strip().upper())
        if not asset:
            return None
        return asset.as_dict()

    def get_asset(self, asset_id):
        return self.assets.get(str(asset_id or "").strip().upper())

    def list_assets(self):
        return [self.assets[asset_id].meta() for asset_id in EXPECTED_IDS if asset_id in self.assets]

    def stats(self):
        return {
            "count": len(self.assets),
            "expected": len(EXPECTED_IDS),
            "errors": len(self.errors),
            "warnings": len(self.warnings),
            "assets": self.list_assets(),
        }

    def validate(self, strict=True):
        problems = list(self.errors)
        if strict:
            problems.extend(self.warnings)
        return problems

    def render(self, asset_id, variables=None, strict=False):
        """渲染双花括号变量；strict=True 时未知变量抛错，否则保留原样。"""
        asset = self.assets.get(str(asset_id or "").strip().upper())
        if not asset:
            raise PromptRuntimeError("未知提示词资产：%s" % asset_id)
        mapping = dict(variables or {})
        rendered = asset.body
        for key in asset.placeholders:
            if key in mapping:
                value = mapping[key]
                if value is None:
                    value = ""
                elif not isinstance(value, str):
                    value = json.dumps(value, ensure_ascii=False)
                rendered = rendered.replace("{{" + key + "}}", value)
        unresolved = [key for key in asset.placeholders if key not in mapping]
        if unresolved:
            message = "%s 存在未提供变量：%s" % (asset.id, ", ".join(unresolved))
            if strict:
                raise PromptRuntimeError(message)
            if message not in self.warnings:
                self.warnings.append(message)
        return rendered

    def build_system_prompt(self, variables=None):
        """LLM 模式 system prompt：SYS-001 全文 + QA-001 全文（渲染输入变量）。"""
        mapping = dict(variables or {})
        mapping.setdefault("role", "student")
        mapping.setdefault("maintenance_history", "[]")
        mapping.setdefault("session_state", "{}")
        parts = []
        for asset_id in ("WXBST-SYS-001", "WXBST-QA-001"):
            asset = self.assets.get(asset_id)
            if asset:
                for key in asset.placeholders:
                    mapping.setdefault(key, "")
            parts.append(self.render(asset_id, mapping))
        return (NL + NL).join(parts)
