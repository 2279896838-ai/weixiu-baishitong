#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生产基础能力验收：SQLite 持久化、迁移、Token 鉴权、指标、备份。"""
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "demo"))

FAILS = []
PASSES = []


def check(name, condition, detail=""):
    (PASSES if condition else FAILS).append(name)
    print(("PASS " if condition else "FAIL ") + name + ((" :: " + str(detail)) if detail != "" else ""))


def free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def http(url, method="GET", body=None, headers=None, timeout=30):
    data = None
    req_headers = dict(headers or {})
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=data, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8", "replace")
    except Exception as exc:
        return 0, {}, str(exc)


def wait_health(base, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, _, _ = http(base + "/api/health", timeout=2)
        if status == 200:
            return True
        time.sleep(0.3)
    return False


def start_server(port, db_path):
    env = dict(os.environ)
    for key in ("LLM_API_BASE", "LLM_API_KEY", "LLM_MODEL", "EMBED_API_BASE", "EMBED_API_KEY", "EMBED_MODEL"):
        env.pop(key, None)
    env.update({
        "WXBST_SKIP_LOCAL_ENV": "1",
        "WXBST_ENV": "production",
        "WXBST_STORAGE": "sqlite",
        "WXBST_DB_PATH": db_path,
        "WXBST_AUTH_MODE": "token",
        "WXBST_API_TOKENS": "viewer-token-abc:viewer,admin-token-xyz:admin",
        "WXBST_TRUST_PROXY": "0",
        "WXBST_AUDIT_RETENTION_DAYS": "30",
    })
    return subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "demo", "server.py"), "--port", str(port)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def test_storage(temp_root):
    from storage import RuntimeStore
    runtime = os.path.join(temp_root, "runtime")
    os.makedirs(runtime)
    store = RuntimeStore(runtime, backend="sqlite")
    check("storage: sqlite enabled", store.enabled, store.stats())
    store.append("workorders.jsonl", {"workorderId": "WO-TEST-001", "status": "OPEN", "createdAt": "2026-10-27T10:00:00+0800"})
    store.write_state({"sequences": {"WO-20261027-": 7}})
    store.audit({"ts": "2026-10-27T10:00:00+0800", "requestId": "req-1", "method": "GET", "path": "/api/health", "status": 200, "durationMs": 1.5, "ip": "127.0.0.1", "user": "tester", "role": "admin"})
    check("storage: read back", store.read("workorders.jsonl")[0].get("workorderId") == "WO-TEST-001")
    check("storage: state", store.read_state().get("sequences", {}).get("WO-20261027-") == 7)
    check("storage: audit rows", store.stats().get("auditRows") == 1, store.stats())
    backup_path = os.path.join(temp_root, "backup.db")
    store.backup(backup_path)
    check("storage: backup file", os.path.isfile(backup_path) and os.path.getsize(backup_path) > 0)
    check("storage: backup integrity", sqlite3.connect(backup_path).execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    store.close()
    reopened = RuntimeStore(runtime, backend="sqlite")
    check("storage: reopen persistence", reopened.read("workorders.jsonl")[0].get("workorderId") == "WO-TEST-001")
    reopened.close()

    legacy = os.path.join(temp_root, "legacy")
    os.makedirs(legacy)
    with open(os.path.join(legacy, "workorders.jsonl"), "w", encoding="utf-8") as handle:
        handle.write(json.dumps({"workorderId": "WO-LEGACY-001", "status": "OPEN"}, ensure_ascii=False) + "\n")
    legacy_store = RuntimeStore(legacy, backend="sqlite")
    check("storage: legacy migration", legacy_store.read("workorders.jsonl")[0].get("workorderId") == "WO-LEGACY-001")
    legacy_store.close()

    os.environ["WXBST_STORAGE"] = "sqlite"
    os.environ["WXBST_DB_PATH"] = os.path.join(temp_root, "engine.db")
    from engine import Engine
    engine_runtime = os.path.join(temp_root, "engine-runtime")
    engine = Engine(os.path.join(ROOT, "data"), engine_runtime)
    engine._append_jsonl_locked("workorders.jsonl", {"workorderId": "WO-ENGINE-001", "status": "OPEN", "createdAt": "2026-10-27T10:00:00+0800"})
    check("storage: engine write", any(row.get("workorderId") == "WO-ENGINE-001" for row in engine.list_workorders()))
    engine2 = Engine(os.path.join(ROOT, "data"), engine_runtime)
    check("storage: engine restart persistence", any(row.get("workorderId") == "WO-ENGINE-001" for row in engine2.list_workorders()))
    check("storage: engine stats", engine2.store_stats.get("backend") == "sqlite", engine2.store_stats)


def test_config():
    from config import Settings
    settings = Settings(tokens={"abc": "admin"}, auth_mode="token")
    check("config: token role", settings.role_for_token("abc") == "admin")
    check("config: token rejected", settings.role_for_token("wrong") == "")
    prod = Settings(env="production", storage="jsonl", auth_mode="off")
    errors, warnings = prod.validate()
    check("config: production warnings", not errors and len(warnings) >= 2, warnings)


def test_server(temp_root):
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    db_path = os.path.join(temp_root, "server.db")
    proc = start_server(port, db_path)
    try:
        check("server: ready", wait_health(base), base)
        status, headers, text = http(base + "/api/health")
        health = json.loads(text) if status == 200 else {}
        check("server: health storage", health.get("storage", {}).get("backend") == "sqlite", health.get("storage"))
        check("server: auth mode reported", health.get("authMode") == "token")
        check("server: request id header", bool(headers.get("X-Request-Id")))
        status, _, _ = http(base + "/api/ready")
        check("server: ready endpoint", status == 200)
        status, _, body = http(base + "/api/equipment")
        check("server: unauth rejected", status == 401, status)
        status, _, body = http(base + "/api/equipment", headers={"Authorization": "Bearer viewer-token-abc"})
        check("server: viewer read", status == 200 and len(json.loads(body)) == 16, status)
        status, _, _ = http(base + "/api/workorders", "POST", {"anomalyId": "AN-TEST"}, {"Authorization": "Bearer viewer-token-abc"})
        check("server: viewer write forbidden", status == 403, status)
        status, _, _ = http(base + "/api/workorders", "POST", {"anomalyId": "AN-NOT-EXIST"}, {"Authorization": "Bearer admin-token-xyz"})
        check("server: admin write reaches engine", status in (400, 404), status)
        status, _, body = http(base + "/api/metrics", headers={"Authorization": "Bearer admin-token-xyz"})
        check("server: metrics", status == 200 and "wxbst_requests_total" in body, status)
        status, _, body = http(base + "/api/auth/me", headers={"Authorization": "Bearer admin-token-xyz"})
        check("server: auth me", status == 200 and json.loads(body).get("role") == "admin", body[:120])
        conn = sqlite3.connect(db_path)
        audit_rows = conn.execute("SELECT COUNT(1) FROM audit_log").fetchone()[0]
        conn.close()
        check("server: audit persisted", audit_rows >= 3, audit_rows)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    check("server: db file", os.path.isfile(db_path))
    # restart same DB and verify persistence / schema
    proc = start_server(port, db_path)
    try:
        check("server: restart healthy", wait_health(base), base)
        status, _, body = http(base + "/api/equipment", headers={"Authorization": "Bearer viewer-token-abc"})
        check("server: restart read", status == 200, status)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    backup_dir = os.path.join(temp_root, "backups")
    result = subprocess.run(
        [sys.executable, os.path.join(ROOT, "scripts", "backup_db.py"), "--db", db_path, "--out", backup_dir, "--keep", "2"],
        capture_output=True, text=True, timeout=30,
    )
    try:
        payload = json.loads(result.stdout.strip().splitlines()[-1])
    except Exception:
        payload = {}
    check("backup: script ok", result.returncode == 0 and payload.get("ok") is True, result.stdout[-200:])
    check("backup: integrity", payload.get("integrity") == "ok", payload.get("integrity"))


def main():
    temp_root = tempfile.mkdtemp(prefix="wxbst-prod-test-")
    try:
        test_config()
        test_storage(temp_root)
        test_server(temp_root)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
    print("")
    print("production checks: %d passed, %d failed" % (len(PASSES), len(FAILS)))
    if FAILS:
        print("FAILED:", ", ".join(FAILS))
        return 1
    print("ALL PRODUCTION CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
