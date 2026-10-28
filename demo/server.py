# -*- coding: utf-8 -*-
# Copyright (c) 2026 张庆涛（日照职业技术大学 智能冶金系 工业互联网）. All rights reserved.
"""维修百事通 MVP HTTP 服务（Python 标准库）。

用法：
    python demo/server.py --port 8787
环境变量（可选）：LLM_API_BASE / LLM_API_KEY / LLM_MODEL，三者齐全时启用大模型问答。
"""
import argparse
import json
import os
import posixpath
import sys
import threading
import time
import traceback
import uuid

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)


def _load_local_env():
    """加载项目根目录 .env.local（不覆盖已有环境变量；文件被 .gitignore 排除）。"""
    if os.environ.get("WXBST_SKIP_LOCAL_ENV") == "1":
        return
    path = os.path.join(ROOT, ".env.local")
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and value:
                    os.environ.setdefault(key, value)
    except FileNotFoundError:
        return
    except Exception:
        return


_load_local_env()

from engine import Engine, EngineError  # noqa: E402
from config import Settings  # noqa: E402

ENGINE = None
SETTINGS = Settings.from_env()
STATIC_DIR = os.path.join(HERE, "static")
try:
    VERSION = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
except Exception:
    VERSION = "1.1.0"
STARTED_AT = time.time()
REQUEST_COUNT = 0
ERROR_COUNT = 0
AUDIT_LOCK = threading.Lock()
RATE_LOCK = threading.Lock()
RATE_BUCKETS = {}
MAX_BODY_BYTES = 256 * 1024
MAX_MESSAGE_CHARS = 2000
RATE_PER_MINUTE = 600
AUDIT_PATH = os.path.join(HERE, "runtime", "audit.jsonl")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


def json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "WeixiuBaishitong/1.0"

    def log_message(self, fmt, *args):
        message = fmt % args
        if os.environ.get("WXBST_LOG_FORMAT") == "json":
            entry = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "requestId": getattr(self, "_req_id", ""),
                "message": message,
            }
            sys.stderr.write(json.dumps(entry, ensure_ascii=False) + "\n")
            return
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), message))

    # ---------- 可观测、限流与安全响应头 ----------
    def handle_one_request(self):
        self._req_started = time.time()
        self._req_id = uuid.uuid4().hex[:12]
        super().handle_one_request()

    def _audit(self, status):
        global REQUEST_COUNT, ERROR_COUNT
        duration_ms = round((time.time() - getattr(self, "_req_started", time.time())) * 1000.0, 2)
        REQUEST_COUNT += 1
        if status >= 400:
            ERROR_COUNT += 1
        identity = getattr(self, "_identity", None) or {}
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "requestId": getattr(self, "_req_id", ""),
            "method": getattr(self, "command", ""),
            "path": (getattr(self, "path", "") or "")[:200],
            "status": status,
            "durationMs": duration_ms,
            "session": self.headers.get("X-WXBST-Session", "")[:80],
            "tool": self.headers.get("X-WXBST-Tool", "")[:40],
            "ip": self._client_key()[:80],
            "user": str(identity.get("user") or "")[:80],
            "role": str(identity.get("role") or "")[:20],
        }
        try:
            if ENGINE is not None and getattr(ENGINE, "store", None) is not None:
                ENGINE.store.audit(entry)
        except Exception:
            pass
        try:
            os.makedirs(os.path.dirname(AUDIT_PATH), exist_ok=True)
            with AUDIT_LOCK:
                with open(AUDIT_PATH, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def _client_key(self):
        if SETTINGS.trust_proxy:
            forwarded = self.headers.get("X-Forwarded-For") or self.headers.get("X-Real-IP")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return (self.client_address[0] or "unknown")

    def _allow_request(self):
        now = time.time()
        key = self._client_key()
        with RATE_LOCK:
            bucket = [item for item in RATE_BUCKETS.get(key, []) if now - item < 60.0]
            if len(bucket) >= RATE_PER_MINUTE:
                RATE_BUCKETS[key] = bucket
                return False
            bucket.append(now)
            RATE_BUCKETS[key] = bucket
            if len(RATE_BUCKETS) > 2000:
                for old_key in list(RATE_BUCKETS)[:1000]:
                    RATE_BUCKETS.pop(old_key, None)
        return True

    def _security_headers(self, html=False):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        if SETTINGS.hsts or self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if html:
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
            )

    # ---------- 基础 ----------
    def _send(self, status, payload, headers=None):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Request-Id", getattr(self, "_req_id", ""))
        self._security_headers(False)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)
        self._audit(status)

    def _error(self, status, code, message):
        self._send(status, {"error": {"code": code, "message": message}})

    def _send_text(self, status, text, content_type="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Request-Id", getattr(self, "_req_id", ""))
        self._security_headers(False)
        self.end_headers()
        self.wfile.write(body)
        self._audit(status)

    def _api_auth(self, path, method):
        if SETTINGS.auth_mode != "token" or not path.startswith("/api/"):
            return True
        if path in ("/api/health", "/api/ready", "/api/metrics"):
            return True
        token = ""
        auth = self.headers.get("Authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        token = token or (self.headers.get("X-API-Token") or "")
        role = SETTINGS.role_for_token(token)
        if not role:
            self._error(401, "UNAUTHORIZED", "需要有效的 API Token")
            return False
        if method in ("POST", "PATCH", "PUT", "DELETE") and role not in ("teacher", "admin"):
            self._error(403, "FORBIDDEN", "需要教师或管理员权限")
            return False
        self._identity = {"user": "token-" + role, "role": role}
        return True

    def _metrics_text(self):
        store = ENGINE.store_stats if ENGINE is not None else {}
        stats = ENGINE.stats if ENGINE is not None else {}
        lines = [
            "# HELP wxbst_requests_total HTTP 请求总数",
            "# TYPE wxbst_requests_total counter",
            "wxbst_requests_total %d" % REQUEST_COUNT,
            "# HELP wxbst_errors_total HTTP 4xx/5xx 响应总数",
            "# TYPE wxbst_errors_total counter",
            "wxbst_errors_total %d" % ERROR_COUNT,
            "# HELP wxbst_uptime_seconds 服务运行秒数",
            "# TYPE wxbst_uptime_seconds gauge",
            "wxbst_uptime_seconds %.1f" % (time.time() - STARTED_AT),
            "# HELP wxbst_storage_rows 运行时存储行数",
            "# TYPE wxbst_storage_rows gauge",
            "wxbst_storage_rows %d" % int(store.get("streamRows", 0) or 0),
            "wxbst_audit_rows %d" % int(store.get("auditRows", 0) or 0),
            "wxbst_knowledge_entries %d" % int(stats.get("knowledge", 0) or 0),
            "wxbst_equipment_total %d" % int(stats.get("equipment", 0) or 0),
            "wxbst_llm_enabled %d" % (1 if ENGINE is not None and ENGINE.mode == "online" else 0),
            "",
        ]
        return "\n".join(lines)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            raise EngineError("请求体过大（上限 256 KB）", code="PAYLOAD_TOO_LARGE", status=413)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            raise EngineError("请求体不是合法 JSON", code="BAD_JSON", status=400)
        if not isinstance(data, dict):
            raise EngineError("请求体必须是 JSON 对象", code="BAD_BODY", status=400)
        return data

    # ---------- 路由 ----------
    def do_GET(self):
        try:
            if not self._allow_request():
                return self._error(429, "RATE_LIMITED", "请求过于频繁，请稍后再试")
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            query = parse_qs(parsed.query)
            if not self._api_auth(path, "GET"):
                return
            if path == "/api/ready":
                store = ENGINE.store_stats
                ok = (not store.get("enabled")) or (not store.get("error"))
                return self._send(200 if ok else 503, {
                    "status": "ready" if ok else "not_ready",
                    "storage": store,
                    "version": VERSION,
                })
            if path == "/api/metrics":
                return self._send_text(200, self._metrics_text())
            if path == "/api/auth/me":
                identity = getattr(self, "_identity", None) or {"user": "anonymous", "role": "anonymous"}
                return self._send(200, {"user": identity.get("user"), "role": identity.get("role"), "authMode": SETTINGS.auth_mode})
            if path == "/api/health":
                prompt_stats = ENGINE.prompt_stats
                return self._send(200, {
                    "status": "ok", "mode": ENGINE.mode, "version": VERSION,
                    "uptimeSec": round(time.time() - STARTED_AT, 1),
                    "requests": REQUEST_COUNT, "errors": ERROR_COUNT,
                    "limits": {"maxBodyBytes": MAX_BODY_BYTES, "maxMessageChars": MAX_MESSAGE_CHARS,
                               "ratePerMinute": RATE_PER_MINUTE},
                    "audit": {"path": "runtime/audit.jsonl", "requests": REQUEST_COUNT},
                    "storage": ENGINE.store_stats,
                    "config": SETTINGS.info(),
                    "authMode": SETTINGS.auth_mode,
                    "vector": dict(ENGINE.stats).get("vector", {}),
                    "llm": {"enabled": ENGINE.mode == "online", "model": os.environ.get("LLM_MODEL", "")},
                    "stats": dict(ENGINE.stats), "warnings": list(ENGINE.warnings),
                    "prompts": {"count": prompt_stats.get("count", 0),
                                "expected": prompt_stats.get("expected", 15),
                                "errors": prompt_stats.get("errors", 0)}})
            if path == "/api/prompts":
                return self._send(200, ENGINE.prompt_stats)
            if path.startswith("/api/prompts/"):
                asset = ENGINE.get_prompt_asset(path[len("/api/prompts/"):])
                if not asset:
                    return self._error(404, "PROMPT_NOT_FOUND", "提示词资产不存在")
                return self._send(200, asset)
            if path == "/api/equipment":
                q = (query.get("query") or [""])[0]
                return self._send(200, ENGINE.list_equipment(q))
            if path == "/api/knowledge":
                try:
                    limit = int((query.get("limit") or ["200"])[0] or 200)
                except ValueError:
                    limit = 200
                return self._send(200, ENGINE.list_knowledge(
                    (query.get("query") or [""])[0],
                    (query.get("category") or [""])[0],
                    (query.get("source") or [""])[0],
                    limit))
            if path == "/api/dashboard":
                days = int((query.get("days") or ["30"])[0] or 30)
                return self._send(200, ENGINE.dashboard(days))
            if path == "/api/workorders":
                status = (query.get("status") or [None])[0] or None
                return self._send(200, ENGINE.list_workorders(status))
            if path.startswith("/api/"):
                return self._error(404, "NOT_FOUND", "接口不存在: " + path)
            if path in ("/agent", "/agent/"):
                return self._serve_static("/agent.html")
            return self._serve_static(path)
        except EngineError as e:
            self._error(e.status, e.code, str(e))
        except Exception:
            traceback.print_exc()
            self._error(500, "INTERNAL", "服务内部错误，请查看服务端日志")

    def do_POST(self):
        try:
            if not self._allow_request():
                return self._error(429, "RATE_LIMITED", "请求过于频繁，请稍后再试")
            path = unquote(urlparse(self.path).path)
            if not self._api_auth(path, "POST"):
                return
            body = self._read_json()
            if path == "/api/chat":
                message = str(body.get("message") or "")
                if len(message) > MAX_MESSAGE_CHARS:
                    return self._error(400, "MESSAGE_TOO_LONG", "message 最长 %d 字符" % MAX_MESSAGE_CHARS)
                return self._send(200, ENGINE.chat(
                    str(body.get("sessionId") or "SESS-DEFAULT"),
                    message,
                    str(body.get("role") or "student"),
                    body.get("equipmentCode") or None))
            if path == "/api/troubleshoot/answer":
                reply = str(body.get("reply") or "")
                if len(reply) > MAX_MESSAGE_CHARS:
                    return self._error(400, "MESSAGE_TOO_LONG", "reply 最长 %d 字符" % MAX_MESSAGE_CHARS)
                return self._send(200, ENGINE.answer_tree(
                    str(body.get("sessionId") or "SESS-DEFAULT"),
                    reply))
            if path == "/api/checklists/generate":
                return self._send(200, ENGINE.generate_checklist(
                    str(body.get("equipmentCode") or ""),
                    str(body.get("frequency") or "D"),
                    str(body.get("operator") or "")))
            if path == "/api/checklists/submit":
                return self._send(200, ENGINE.submit_checklist(
                    body.get("checklist") or {},
                    body.get("items") or [],
                    str(body.get("operator") or ""),
                    str(body.get("note") or "")))
            if path == "/api/workorders":
                return self._send(200, ENGINE.create_workorder(
                    str(body.get("anomalyId") or ""),
                    str(body.get("note") or ""),
                    str(body.get("operator") or "")))
            if path.startswith("/api/"):
                return self._error(404, "NOT_FOUND", "接口不存在: " + path)
            return self._error(404, "NOT_FOUND", "路径不存在")
        except EngineError as e:
            self._error(e.status, e.code, str(e))
        except Exception:
            traceback.print_exc()
            self._error(500, "INTERNAL", "服务内部错误，请查看服务端日志")

    def do_PATCH(self):
        try:
            if not self._allow_request():
                return self._error(429, "RATE_LIMITED", "请求过于频繁，请稍后再试")
            path = unquote(urlparse(self.path).path)
            if not self._api_auth(path, "PATCH"):
                return
            body = self._read_json()
            prefix = "/api/workorders/"
            if not path.startswith(prefix):
                return self._error(404, "NOT_FOUND", "接口不存在: " + path)
            workorder_id = path[len(prefix):]
            if not workorder_id:
                return self._error(400, "BAD_REQUEST", "缺少工单号")
            return self._send(200, ENGINE.update_workorder(
                workorder_id,
                str(body.get("status") or ""),
                body.get("repairReport"),
                str(body.get("operator") or "")))
        except EngineError as e:
            self._error(e.status, e.code, str(e))
        except Exception:
            traceback.print_exc()
            self._error(500, "INTERNAL", "服务内部错误，请查看服务端日志")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, POST, PATCH, OPTIONS")
        self.send_header("Content-Length", "0")
        self._security_headers(False)
        self.end_headers()
        self._audit(204)

    # ---------- 静态文件 ----------
    def _serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        elif path in ("/agent", "/agent/"):
            path = "/agent.html"
        stripped = path[len("/static/"):] if path.startswith("/static/") else path.lstrip("/")
        rel = posixpath.normpath(stripped)
        if rel.startswith("../") or rel == ".." or rel.startswith("/"):
            return self._error(403, "FORBIDDEN", "非法路径")
        full = os.path.join(STATIC_DIR, rel.replace("/", os.sep))
        if not os.path.isfile(full):
            return self._error(404, "NOT_FOUND", "静态文件不存在: " + path)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._security_headers(ext == ".html")
        self.end_headers()
        self.wfile.write(body)
        self._audit(200)


def main():
    global ENGINE
    parser = argparse.ArgumentParser(description="维修百事通 MVP 服务")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()
    errors, warnings = SETTINGS.validate()
    for warning in warnings:
        print("配置警告:", warning)
    if errors:
        for error in errors:
            print("配置错误:", error)
        raise SystemExit(2)
    ENGINE = Engine(os.path.join(ROOT, "data"), os.path.join(HERE, "runtime"))
    try:
        if getattr(ENGINE, "store", None) is not None and ENGINE.store_stats.get("enabled"):
            removed = ENGINE.store.prune_audit(int(os.environ.get("WXBST_AUDIT_RETENTION_DAYS", "30") or 30))
            if removed:
                print("审计日志清理:", removed, "条（保留天数）")
    except Exception:
        pass
    stats = ENGINE.stats
    print("=" * 56)
    print("维修百事通 MVP 服务已启动")
    print("模式:", ENGINE.mode, "| 设备:", stats.get("equipment"), "| 知识条目:", stats.get("knowledge"),
          "| 点检模板:", stats.get("checklistItems"), "| 决策树:", stats.get("trees"))
    print("存储:", ENGINE.store_stats.get("backend"), "| 鉴权:", SETTINGS.auth_mode, "| 环境:", SETTINGS.env)
    if ENGINE.warnings:
        print("数据加载警告:")
        for w in ENGINE.warnings():
            print("  -", w)
    print("地址: http://127.0.0.1:%d" % args.port)
    print("=" * 56)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止服务…")
    finally:
        httpd.server_close()
        if ENGINE is not None and getattr(ENGINE, "store", None) is not None:
            ENGINE.store.close()


if __name__ == "__main__":
    main()
