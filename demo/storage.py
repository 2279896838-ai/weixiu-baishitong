# -*- coding: utf-8 -*-
"""运行时持久化：SQLite（WAL）优先，兼容旧 JSONL。

生产默认 WXBST_STORAGE=sqlite，数据库默认 runtime/wxbst.db；
设置 WXBST_STORAGE=jsonl 可回退旧文件模式（仅用于兼容/测试）。
"""
import json
import os
import sqlite3
import threading
import time

LEGACY_STREAMS = {
    "submissions.jsonl": "submissions",
    "anomalies.jsonl": "anomalies",
    "workorders.jsonl": "workorders",
    "knowledge_candidates.jsonl": "knowledge_candidates",
}
SCHEMA_VERSION = 1


class RuntimeStore:
    def __init__(self, runtime_dir, backend=None):
        self.runtime_dir = os.path.abspath(runtime_dir or "runtime")
        self.backend = (backend or os.environ.get("WXBST_STORAGE") or "sqlite").strip().lower()
        self.enabled = self.backend == "sqlite"
        self.path = os.environ.get("WXBST_DB_PATH") or os.path.join(self.runtime_dir, "wxbst.db")
        self.path = os.path.abspath(self.path)
        self._lock = threading.RLock()
        self._conn = None
        self.error = ""
        if not self.enabled:
            return
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            self._conn = sqlite3.connect(self.path, check_same_thread=False, timeout=30.0)
            self._conn.row_factory = sqlite3.Row
            with self._lock:
                self._conn.execute("PRAGMA journal_mode=WAL")
                self._conn.execute("PRAGMA synchronous=NORMAL")
                self._conn.execute("PRAGMA foreign_keys=ON")
                self._conn.execute("PRAGMA busy_timeout=30000")
                self._migrate()
                self._import_legacy()
        except Exception as exc:
            self.error = "%s: %s" % (type(exc).__name__, exc)
            self.enabled = False
            try:
                if self._conn is not None:
                    self._conn.close()
            except Exception:
                pass
            self._conn = None

    def _migrate(self):
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        current = self._conn.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").fetchone()["v"]
        if current < 1:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS streams (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    stream TEXT NOT NULL,
                    row_id TEXT,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_streams_stream_seq ON streams(stream, seq);
                CREATE INDEX IF NOT EXISTS idx_streams_row_id ON streams(stream, row_id);
                CREATE TABLE IF NOT EXISTS state_store (
                    key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    request_id TEXT,
                    method TEXT,
                    path TEXT,
                    status INTEGER,
                    duration_ms REAL,
                    session TEXT,
                    tool TEXT,
                    ip TEXT,
                    user TEXT,
                    role TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
                """
            )
            self._conn.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)",
                (time.strftime("%Y-%m-%dT%H:%M:%S%z"),),
            )
        self._conn.commit()

    def _import_legacy(self):
        meta = self._conn.execute("SELECT payload FROM state_store WHERE key='legacy_import'").fetchone()
        if meta:
            return
        for filename, _ in LEGACY_STREAMS.items():
            stream = filename
            path = os.path.join(self.runtime_dir, filename)
            if not os.path.isfile(path):
                continue
            count = self._conn.execute("SELECT COUNT(1) AS c FROM streams WHERE stream=?", (stream,)).fetchone()["c"]
            if count:
                continue
            rows = []
            try:
                with open(path, "r", encoding="utf-8-sig") as handle:
                    for line in handle:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            item = json.loads(line)
                        except Exception:
                            continue
                        if isinstance(item, dict):
                            rows.append(item)
            except Exception:
                continue
            for item in rows:
                self.append(stream, item)
        state_path = os.path.join(self.runtime_dir, "engine_state.json")
        if os.path.isfile(state_path) and not self.read_state():
            try:
                with open(state_path, "r", encoding="utf-8-sig") as handle:
                    state = json.load(handle)
                if isinstance(state, dict):
                    self.write_state(state)
            except Exception:
                pass
        self._conn.execute(
            "INSERT OR REPLACE INTO state_store(key, payload, updated_at) VALUES('legacy_import', ?, ?)",
            (json.dumps({"importedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, ensure_ascii=False), time.strftime("%Y-%m-%dT%H:%M:%S%z")),
        )
        self._conn.commit()

    def append(self, stream, row):
        if not self.enabled:
            return False
        payload = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
        row_id = str(row.get("id") or row.get("workorderId") or row.get("submissionId") or row.get("anomalyId") or row.get("candidateId") or "")
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute(
                    "INSERT INTO streams(stream, row_id, payload, created_at) VALUES(?,?,?,?)",
                    (stream, row_id, payload, time.strftime("%Y-%m-%dT%H:%M:%S%z")),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
        return True

    def read(self, stream):
        if not self.enabled:
            return []
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM streams WHERE stream=? ORDER BY seq ASC", (stream,)
            ).fetchall()
        result = []
        for row in rows:
            try:
                item = json.loads(row["payload"])
            except Exception:
                continue
            if isinstance(item, dict):
                result.append(item)
        return result

    def write_state(self, payload):
        if not self.enabled:
            return False
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO state_store(key, payload, updated_at) VALUES('engine_state', ?, ?)",
                (body, time.strftime("%Y-%m-%dT%H:%M:%S%z")),
            )
            self._conn.commit()
        return True

    def read_state(self):
        if not self.enabled:
            return None
        with self._lock:
            row = self._conn.execute("SELECT payload FROM state_store WHERE key='engine_state'").fetchone()
        if not row:
            return None
        try:
            value = json.loads(row["payload"])
        except Exception:
            return None
        return value if isinstance(value, dict) else None

    def audit(self, entry):
        if not self.enabled:
            return False
        with self._lock:
            self._conn.execute(
                "INSERT INTO audit_log(ts, request_id, method, path, status, duration_ms, session, tool, ip, user, role) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    str(entry.get("ts") or "")[:40],
                    str(entry.get("requestId") or "")[:64],
                    str(entry.get("method") or "")[:12],
                    str(entry.get("path") or "")[:300],
                    int(entry.get("status") or 0),
                    float(entry.get("durationMs") or 0),
                    str(entry.get("session") or "")[:80],
                    str(entry.get("tool") or "")[:40],
                    str(entry.get("ip") or "")[:80],
                    str(entry.get("user") or "")[:80],
                    str(entry.get("role") or "")[:20],
                ),
            )
            self._conn.commit()
        return True

    def prune_audit(self, days=30):
        if not self.enabled:
            return 0
        cutoff = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(time.time() - max(1, int(days)) * 86400))
        with self._lock:
            cur = self._conn.execute("DELETE FROM audit_log WHERE ts < ?", (cutoff,))
            self._conn.commit()
            return cur.rowcount

    def stats(self):
        if not self.enabled:
            return {"backend": self.backend, "enabled": False, "error": self.error}
        with self._lock:
            streams = self._conn.execute("SELECT COUNT(1) AS c FROM streams").fetchone()["c"]
            audit_rows = self._conn.execute("SELECT COUNT(1) AS c FROM audit_log").fetchone()["c"]
            version = self._conn.execute("SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations").fetchone()["v"]
        return {
            "backend": "sqlite",
            "enabled": True,
            "path": self.path,
            "schemaVersion": version,
            "streamRows": streams,
            "auditRows": audit_rows,
            "error": self.error,
        }

    def backup(self, destination):
        if not self.enabled:
            raise RuntimeError("storage backend 不是 sqlite")
        destination = os.path.abspath(destination)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        target = sqlite3.connect(destination)
        try:
            with self._lock:
                self._conn.backup(target)
        finally:
            target.close()
        return destination

    def close(self):
        if self._conn is not None:
            with self._lock:
                try:
                    self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                except Exception:
                    pass
                self._conn.close()
            self._conn = None
