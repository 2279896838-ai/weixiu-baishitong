#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SQLite 在线备份 + 完整性校验 + 保留策略（Python 标准库）。"""
import argparse
import hashlib
import json
import os
import sqlite3
import time


def main():
    parser = argparse.ArgumentParser(description="维修百事通 SQLite 备份")
    parser.add_argument("--db", default=os.environ.get("WXBST_DB_PATH") or os.path.join("demo", "runtime", "wxbst.db"))
    parser.add_argument("--out", default=os.environ.get("WXBST_BACKUP_DIR") or "backups")
    parser.add_argument("--keep", type=int, default=int(os.environ.get("WXBST_BACKUP_KEEP", "7")))
    args = parser.parse_args()
    db = os.path.abspath(args.db)
    if not os.path.isfile(db):
        print(json.dumps({"ok": False, "error": "数据库不存在: " + db}, ensure_ascii=False))
        return 1
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(out_dir, "wxbst-%s.db" % stamp)
    source = sqlite3.connect(db)
    target = sqlite3.connect(dest)
    try:
        source.backup(target)
        target.execute("PRAGMA journal_mode=DELETE")
    finally:
        target.close()
        source.close()
    check = sqlite3.connect(dest)
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        check.close()
    if integrity != "ok":
        print(json.dumps({"ok": False, "error": "备份完整性校验失败: " + str(integrity)}, ensure_ascii=False))
        return 1
    digest = hashlib.sha256(open(dest, "rb").read()).hexdigest()
    with open(dest + ".sha256", "w", encoding="ascii") as handle:
        handle.write(digest + "  " + os.path.basename(dest) + "\n")
    backups = sorted(
        os.path.join(out_dir, name) for name in os.listdir(out_dir)
        if name.startswith("wxbst-") and name.endswith(".db")
    )
    removed = []
    keep = max(1, args.keep)
    for old in backups[:-keep]:
        try:
            os.remove(old)
            removed.append(os.path.basename(old))
        except OSError:
            pass
    print(json.dumps({
        "ok": True,
        "db": db,
        "backup": dest,
        "bytes": os.path.getsize(dest),
        "sha256": digest,
        "integrity": integrity,
        "removed": removed,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
