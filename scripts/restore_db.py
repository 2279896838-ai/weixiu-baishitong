#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 SQLite 备份恢复（服务必须已停止）。"""
import argparse
import os
import sqlite3
import sys


def main():
    parser = argparse.ArgumentParser(description="维修百事通 SQLite 恢复")
    parser.add_argument("--backup", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    backup = os.path.abspath(args.backup)
    db = os.path.abspath(args.db)
    if not os.path.isfile(backup):
        print("备份不存在:", backup)
        return 1
    if os.path.exists(db) and not args.force:
        print("目标数据库已存在；确认停止服务后加 --force 覆盖:", db)
        return 1
    check = sqlite3.connect(backup)
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        check.close()
    if integrity != "ok":
        print("备份完整性校验失败:", integrity)
        return 1
    os.makedirs(os.path.dirname(db), exist_ok=True)
    tmp = db + ".restore.tmp"
    src = sqlite3.connect(backup)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)
        dst.execute("PRAGMA journal_mode=DELETE")
    finally:
        dst.close()
        src.close()
    os.replace(tmp, db)
    for suffix in ("-wal", "-shm"):
        try:
            os.remove(db + suffix)
        except FileNotFoundError:
            pass
    print("恢复完成:", db, "来源:", backup, "完整性:", integrity)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
