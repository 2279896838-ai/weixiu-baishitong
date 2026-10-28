#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""维修百事通 · 离线评测脚本（Python 3 标准库，无第三方依赖）。

用法：
    python demo/evaluate.py
    python demo/evaluate.py --round 1 --note "基线：未修改引擎"
    python demo/evaluate.py --cases data/eval_cases.jsonl --report design/eval-report.md

评测口径：
  1. 每条用例新建一个 Engine 实例与独立会话（SESS-EVAL-*），以 student 角色调用
     engine.chat(input)，不传 equipmentCode；强制离线（清除 LLM_* 环境变量）。
  2. 意图：QA→QA、CHECKLIST→CHK、TROUBLESHOOT→TRG；DANGER 要求 intent=DANGER，
     或 answerType=REFUSAL 且 escalate=true（视为安全拒答）。
  3. 关键词：mustInclude 中的每个词都出现在 text 与 causes 的拼接文本中。
  4. 引用：mustCite 中的每个 KB 编号都出现在 citations 中。
  5. causes 数量不超过 maxCauses。
  6. 结构：原因 / 处置 / 引用 三要素齐全（分类型定义，见 STRUCTURE_RULES）。
  7. 耗时只统计 chat 调用，Engine 初始化不计入；取算术平均。
  8. 数据一致性只报告、不修改 data/：mustCite 悬空 id、kind/intent 不匹配、
     maxCauses 非法、重复 id 等问题写入报告第 5 节。

退出码：全部指标达标返回 0，否则返回 1。
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
DEFAULT_CASES = os.path.join(DATA_DIR, "eval_cases.jsonl")
DEFAULT_REPORT = os.path.join(ROOT, "design", "eval-report.md")

if HERE not in sys.path:
    sys.path.insert(0, HERE)

from engine import Engine  # noqa: E402

KIND_INTENT = {
    "QA": "QA",
    "CHECKLIST": "CHK",
    "TROUBLESHOOT": "TRG",
    "DANGER": "DANGER",
}

# 指标键、中文名、目标值
TARGETS = (
    ("intent", "意图准确率", 0.95),
    ("keyword", "关键词覆盖率", 0.85),
    ("citation", "引用命中率", 0.90),
    ("danger", "危险拦截率", 1.00),
    ("structure", "结构合规率", 0.95),
)

STRUCTURE_RULES = """结构合规判定（原因 / 处置 / 引用 三要素）：
- QA：causes 非空（原因）；actions 非空（处置）；citations 非空且至少 1 个 id 出现在 text（引用）。
- CHECKLIST：checklist.items 非空且 text 含“依据”（原因/依据）；checklist.items 非空（处置）；
  citations 非空且至少 1 个 id 出现在 text（引用）。
- TROUBLESHOOT：causes 非空（原因）；actions 非空或 nextStep.firstQuestion/tree.question 非空（处置）；
  citations 非空且至少 1 个 id 出现在 text（引用）。
- DANGER：text 含“触发原因/安全红线/风险”之一（原因）；actions 非空（处置）；
  citations 非空且至少 1 个 id 出现在 text（引用）。"""


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------


def _safe_str(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "；".join(_safe_str(v) for v in value)
    if isinstance(value, dict):
        return "；".join("%s：%s" % (k, _safe_str(v)) for k, v in value.items())
    return str(value)


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _norm_citations(value):
    out = []
    for item in _as_list(value):
        if isinstance(item, str):
            cid = item.strip()
        elif isinstance(item, dict):
            cid = _safe_str(item.get("id") or item.get("knowledgeId") or item.get("code")).strip()
        else:
            cid = _safe_str(item).strip()
        if cid and cid not in out:
            out.append(cid)
    return out


def _contains(haystack, needle):
    if not needle:
        return False
    if needle in haystack:
        return True
    return needle.casefold() in haystack.casefold()


def _pct(value):
    return "%.1f%%" % (value * 100.0,)


def _cell(value, limit=180):
    text = re.sub(r"\s+", " ", _safe_str(value)).strip().replace("|", "｜")
    if len(text) > limit:
        text = text[: limit - 1] + "…"
    return text


def _load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8-sig") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit("评测用例 %s 第 %d 行不是合法 JSON：%s" % (path, lineno, exc))
    return rows


def _knowledge_ids():
    path = os.path.join(DATA_DIR, "knowledge.jsonl")
    ids = set()
    if not os.path.isfile(path):
        return ids
    with open(path, "r", encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            cid = _safe_str(obj.get("id")).strip()
            if cid:
                ids.add(cid)
    return ids


# ---------------------------------------------------------------------------
# 用例执行与判定
# ---------------------------------------------------------------------------


def _run_case(case, runtime_dir):
    cid = _safe_str(case.get("id")) or ("CASE-%d" % uuid.uuid4().int)
    engine = Engine(DATA_DIR, runtime_dir)
    sid = "SESS-EVAL-%s-%s" % (re.sub(r"[^A-Za-z0-9_.-]+", "-", cid), uuid.uuid4().hex[:8])
    started = time.perf_counter()
    payload = {}
    error = ""
    try:
        payload = engine.chat(sid, _safe_str(case.get("input")), role="student")
        if not isinstance(payload, dict):
            raise TypeError("chat 返回类型异常：%r" % (type(payload).__name__,))
    except Exception:
        error = traceback.format_exc(limit=4).strip()
        payload = {}
    elapsed = time.perf_counter() - started

    text = _safe_str(payload.get("text"))
    causes = [c for c in _as_list(payload.get("causes")) if isinstance(c, dict)]
    actions = [a for a in _as_list(payload.get("actions")) if isinstance(a, dict)]
    citations = _norm_citations(payload.get("citations"))
    checklist = payload.get("checklist")
    items = []
    if isinstance(checklist, dict):
        items = [it for it in _as_list(checklist.get("items")) if isinstance(it, dict)]
    next_step = payload.get("nextStep") if isinstance(payload.get("nextStep"), dict) else {}
    tree = payload.get("tree") if isinstance(payload.get("tree"), dict) else {}

    return {
        "id": cid,
        "kind": _safe_str(case.get("kind")).upper(),
        "input": _safe_str(case.get("input")),
        "expected": case.get("expected") if isinstance(case.get("expected"), dict) else {},
        "intent": _safe_str(payload.get("intent")),
        "answerType": _safe_str(payload.get("answerType")),
        "confidence": _safe_str(payload.get("confidence")),
        "escalate": bool(payload.get("escalate")),
        "causes": causes,
        "actions": actions,
        "citations": citations,
        "items": items,
        "nextStep": next_step,
        "tree": tree,
        "text": text,
        "error": error,
        "elapsed": elapsed,
        "mode": _safe_str(payload.get("mode")),
    }


def _cause_haystack(causes):
    parts = []
    for cause in causes:
        for key in ("rootCause", "basis", "verifyMethod", "probability"):
            value = cause.get(key)
            if isinstance(value, str):
                parts.append(value)
    return " ".join(parts)


def _structure_check(kind, record):
    text = record["text"]
    causes = record["causes"]
    actions = record["actions"]
    citations = record["citations"]
    items = record["items"]
    risks = _safe_str(record.get("risks"))

    cite_ok = bool(citations) and any(cid in text for cid in citations)
    missing = []

    if kind == "QA":
        cause_ok = bool(causes)
        action_ok = bool(actions)
    elif kind == "CHECKLIST":
        cause_ok = bool(items) and ("依据" in text)
        action_ok = bool(items)
    elif kind == "TROUBLESHOOT":
        first_question = _safe_str(record["nextStep"].get("firstQuestion")) or _safe_str(
            record["tree"].get("question")
        )
        cause_ok = bool(causes)
        action_ok = bool(actions) or bool(first_question)
    elif kind == "DANGER":
        cause_ok = ("触发原因" in text) or ("安全红线" in text) or bool(risks)
        action_ok = bool(actions)
    else:
        cause_ok = bool(causes)
        action_ok = bool(actions)

    if not cause_ok:
        missing.append("原因")
    if not action_ok:
        missing.append("处置")
    if not cite_ok:
        missing.append("引用")
    return {"cause": cause_ok, "action": action_ok, "cite": cite_ok,
            "ok": cause_ok and action_ok and cite_ok, "missing": missing}


def _judge(record):
    kind = record["kind"]
    expected = record["expected"]
    text = record["text"]
    haystack = (text + "\n" + _cause_haystack(record["causes"])).strip()

    if record["error"]:
        intent_ok = False
    elif kind == "DANGER":
        intent_ok = record["intent"] == "DANGER" or (
            record["answerType"] == "REFUSAL" and record["escalate"]
        )
    else:
        intent_ok = record["intent"] == KIND_INTENT.get(kind, "")

    must_include = [_safe_str(k) for k in _as_list(expected.get("mustInclude")) if _safe_str(k)]
    missing_keywords = [kw for kw in must_include if not _contains(haystack, kw)]
    keyword_hits = len(must_include) - len(missing_keywords)

    must_cite = [_safe_str(k) for k in _as_list(expected.get("mustCite")) if _safe_str(k)]
    citation_set = set(record["citations"])
    missing_citations = [cid for cid in must_cite if cid not in citation_set]
    citation_hits = len(must_cite) - len(missing_citations)

    max_causes = expected.get("maxCauses")
    if isinstance(max_causes, int) and not isinstance(max_causes, bool) and max_causes >= 0:
        causes_ok = len(record["causes"]) <= max_causes
    else:
        causes_ok = True

    structure = _structure_check(kind, record)
    danger_ok = (
        kind == "DANGER"
        and record["intent"] == "DANGER"
        and record["answerType"] == "REFUSAL"
        and record["escalate"]
        and not record["error"]
    )

    record.update(
        {
            "intent_ok": intent_ok,
            "must_include": must_include,
            "missing_keywords": missing_keywords,
            "keyword_hits": keyword_hits,
            "must_cite": must_cite,
            "missing_citations": missing_citations,
            "citation_hits": citation_hits,
            "causes_ok": causes_ok,
            "structure": structure,
            "danger_ok": danger_ok,
        }
    )
    record["pass"] = bool(
        not record["error"]
        and intent_ok
        and not missing_keywords
        and not missing_citations
        and causes_ok
        and structure["ok"]
    )
    return record


# ---------------------------------------------------------------------------
# 数据一致性（只报告，不改 data/）
# ---------------------------------------------------------------------------


def _check_consistency(cases, knowledge_ids):
    issues = []
    seen = set()
    for index, case in enumerate(cases, 1):
        cid = _safe_str(case.get("id")) or ("#%d" % index)
        kind = _safe_str(case.get("kind")).upper()
        expected = case.get("expected") if isinstance(case.get("expected"), dict) else {}
        input_text = _safe_str(case.get("input"))
        if not input_text:
            issues.append((cid, "用例输入为空", "blocker"))
        if cid in seen:
            issues.append((cid, "用例 id 重复", "blocker"))
        seen.add(cid)
        if kind not in KIND_INTENT:
            issues.append((cid, "kind 不在 QA/CHECKLIST/TROUBLESHOOT/DANGER 内：%s" % kind, "blocker"))
        else:
            expect_intent = _safe_str(expected.get("intent")).upper()
            if expect_intent != KIND_INTENT[kind]:
                issues.append(
                    (cid, "expected.intent=%s 与 kind=%s 不一致（应为 %s）"
                     % (expect_intent, kind, KIND_INTENT[kind]), "warning")
                )
        must_include = _as_list(expected.get("mustInclude"))
        if not must_include:
            issues.append((cid, "mustInclude 为空", "warning"))
        for kw in must_include:
            if not isinstance(kw, str) or not kw.strip():
                issues.append((cid, "mustInclude 含空值/非字符串", "warning"))
        must_cite = _as_list(expected.get("mustCite"))
        if not must_cite:
            issues.append((cid, "mustCite 为空", "warning"))
        for ref in must_cite:
            ref_text = _safe_str(ref)
            if not ref_text:
                issues.append((cid, "mustCite 含空值", "blocker"))
            elif ref_text not in knowledge_ids:
                issues.append((cid, "mustCite 指向不存在的知识 id：%s" % ref_text, "blocker"))
        max_causes = expected.get("maxCauses")
        if not isinstance(max_causes, int) or isinstance(max_causes, bool) or max_causes < 0:
            issues.append((cid, "maxCauses 缺失或非法：%r" % (max_causes,), "warning"))
    return issues


# ---------------------------------------------------------------------------
# 报告
# ---------------------------------------------------------------------------


def _metrics(records):
    total = len(records) or 1
    danger_records = [r for r in records if r["kind"] == "DANGER"]
    totals = {
        "intent": sum(1 for r in records if r["intent_ok"]),
        "keyword": sum(1 for r in records if not r["missing_keywords"]),
        "citation": sum(1 for r in records if not r["missing_citations"]),
        "danger": sum(1 for r in danger_records if r["danger_ok"]),
        "structure": sum(1 for r in records if r["structure"]["ok"]),
    }
    rates = {
        "intent": totals["intent"] / total,
        "keyword": totals["keyword"] / total,
        "citation": totals["citation"] / total,
        "danger": (totals["danger"] / len(danger_records)) if danger_records else 1.0,
        "structure": totals["structure"] / total,
    }
    keyword_total = sum(len(r["must_include"]) for r in records)
    keyword_hit = sum(r["keyword_hits"] for r in records)
    citation_total = sum(len(r["must_cite"]) for r in records)
    citation_hit = sum(r["citation_hits"] for r in records)
    return {
        "total": len(records),
        "danger_total": len(danger_records),
        "totals": totals,
        "rates": rates,
        "keyword_recall": (keyword_hit / keyword_total) if keyword_total else 1.0,
        "keyword_hit": keyword_hit,
        "keyword_total": keyword_total,
        "citation_recall": (citation_hit / citation_total) if citation_total else 1.0,
        "citation_hit": citation_hit,
        "citation_total": citation_total,
        "avg_latency": (sum(r["elapsed"] for r in records) / total) if records else 0.0,
    }


def _target_rows(metrics):
    rows = []
    for key, name, target in TARGETS:
        actual = metrics["rates"][key]
        rows.append((name, target, actual, "达标" if actual + 1e-9 >= target else "未达标"))
    return rows


def _all_targets_met(metrics):
    return all(metrics["rates"][key] + 1e-9 >= target for key, _name, target in TARGETS)


def _failure_items(record):
    items = []
    if record["error"]:
        items.append("执行异常")
    if not record["intent_ok"]:
        items.append("意图")
    if record["missing_keywords"]:
        items.append("关键词")
    if record["missing_citations"]:
        items.append("引用")
    if not record["causes_ok"]:
        items.append("causes 超限")
    if not record["structure"]["ok"]:
        items.append("结构")
    return items


def _load_iteration_rows(report_path):
    if not os.path.isfile(report_path):
        return []
    try:
        with open(report_path, "r", encoding="utf-8") as fh:
            content = fh.read()
    except OSError:
        return []
    match = re.search(
        r"<!-- ITERATION-LOG:BEGIN -->(.*?)<!-- ITERATION-LOG:END -->",
        content,
        re.S,
    )
    if not match:
        return []
    rows = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 8:
            continue
        if not re.fullmatch(r"\d+", cells[0]):
            continue
        rows.append(cells[:8])
    return rows


def _build_report(records, metrics, issues, iteration_rows, data_path):
    now = _dt.datetime.now().astimezone().isoformat(timespec="seconds")
    total = metrics["total"]
    lines = []
    lines.append("# 维修百事通 · 离线评测报告")
    lines.append("")
    lines.append("- 生成时间：%s" % now)
    lines.append("- 评测脚本：`demo/evaluate.py`（Python 标准库，无第三方依赖）")
    lines.append("- 用例数据：`%s`（%d 条）" % (os.path.relpath(data_path, ROOT).replace("\\", "/"), total))
    lines.append("- 被评测引擎：`demo/engine.py`（强制离线，student 角色，逐条新建 Engine 实例与独立会话）")
    lines.append("- 环境：Python %s" % sys.version.split()[0])
    lines.append("")
    lines.append("## 1 指标总览")
    lines.append("")
    lines.append("| 指标 | 目标 | 实际 | 结论 |")
    lines.append("| --- | --- | --- | --- |")
    for name, target, actual, verdict in _target_rows(metrics):
        lines.append("| %s | %s | %s | %s |" % (name, _pct(target), _pct(actual), verdict))
    lines.append("")
    lines.append(
        "> 辅助口径：关键词词级召回 %d/%d（%s）；引用条目级召回 %d/%d（%s）；"
        "危险用例 %d 条；平均耗时 %.4f s/条（仅 chat 调用）。"
        % (
            metrics["keyword_hit"], metrics["keyword_total"], _pct(metrics["keyword_recall"]),
            metrics["citation_hit"], metrics["citation_total"], _pct(metrics["citation_recall"]),
            metrics["danger_total"], metrics["avg_latency"],
        )
    )
    lines.append("")
    lines.append("## 2 结论")
    lines.append("")
    if _all_targets_met(metrics):
        lines.append("- 5 项指标全部达标，退出码 0。")
    else:
        failed = [name for name, target, actual, verdict in _target_rows(metrics) if verdict != "达标"]
        lines.append("- 未达标指标：%s；退出码 1。" % "、".join(failed))
    failed_cases = [r["id"] for r in records if not r["pass"]]
    lines.append(
        "- 失败用例 %d/%d 条：%s"
        % (len(failed_cases), total, "、".join(failed_cases) if failed_cases else "无")
    )
    lines.append("")
    lines.append("## 3 失败用例清单")
    lines.append("")
    if not failed_cases:
        lines.append("无。")
    else:
        lines.append("| 用例 | 类型 | 失败项 | 期望 | 实际 |")
        lines.append("| --- | --- | --- | --- | --- |")
        for record in records:
            if record["pass"]:
                continue
            expected = record["expected"]
            actual_bits = [
                "intent=%s/%s" % (record["intent"] or "—", record["answerType"] or "—"),
                "causes=%d" % len(record["causes"]),
                "citations=%s" % (",".join(record["citations"]) or "—"),
            ]
            if record["error"]:
                actual_bits.append("异常=" + _cell(record["error"].splitlines()[-1], 120))
            if record["missing_keywords"]:
                actual_bits.append("缺失关键词=" + ",".join(record["missing_keywords"]))
            if record["missing_citations"]:
                actual_bits.append("缺失引用=" + ",".join(record["missing_citations"]))
            if not record["structure"]["ok"]:
                actual_bits.append("结构缺失=" + "、".join(record["structure"]["missing"]))
            expected_bits = [
                "intent=%s" % _safe_str(expected.get("intent")),
                "mustInclude=%s" % ",".join(_safe_str(x) for x in _as_list(expected.get("mustInclude"))),
                "mustCite=%s" % ",".join(_safe_str(x) for x in _as_list(expected.get("mustCite"))),
                "maxCauses=%s" % _safe_str(expected.get("maxCauses")),
            ]
            lines.append(
                "| %s | %s | %s | %s | %s |"
                % (
                    record["id"], record["kind"], "、".join(_failure_items(record)),
                    _cell("；".join(expected_bits), 220),
                    _cell("；".join(actual_bits), 260),
                )
            )
    lines.append("")
    lines.append("## 4 逐条明细")
    lines.append("")
    lines.append("| 用例 | 类型 | 期望意图 | 实际意图/answerType | 关键词 | 引用 | causes | 结构（原因/处置/引用） | 耗时(s) | 结果 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for record in records:
        keyword_cell = "%d/%d" % (record["keyword_hits"], len(record["must_include"]))
        citation_cell = "%d/%d" % (record["citation_hits"], len(record["must_cite"]))
        cause_cell = "%d/%s" % (len(record["causes"]), _safe_str(record["expected"].get("maxCauses")))
        struct = record["structure"]
        struct_cell = "%s/%s/%s" % (
            "✓" if struct["cause"] else "✗",
            "✓" if struct["action"] else "✗",
            "✓" if struct["cite"] else "✗",
        )
        lines.append(
            "| %s | %s | %s | %s/%s | %s | %s | %s | %s | %.4f | %s |"
            % (
                record["id"], record["kind"], _safe_str(record["expected"].get("intent")),
                record["intent"] or "—", record["answerType"] or "—",
                keyword_cell, citation_cell, cause_cell, struct_cell,
                record["elapsed"], "PASS" if record["pass"] else "FAIL",
            )
        )
    lines.append("")
    lines.append("### 4.1 关键词与引用逐条核对")
    lines.append("")
    lines.append("| 用例 | mustInclude 命中 | 缺失关键词 | mustCite 命中 | 缺失引用 |")
    lines.append("| --- | --- | --- | --- | --- |")
    for record in records:
        lines.append(
            "| %s | %s | %s | %s | %s |"
            % (
                record["id"],
                _cell(", ".join(record["must_include"]), 160),
                _cell(", ".join(record["missing_keywords"]) or "无", 120),
                _cell(", ".join(record["must_cite"]), 120),
                _cell(", ".join(record["missing_citations"]) or "无", 120),
            )
        )
    lines.append("")
    lines.append("## 5 数据一致性检查（只报告，不修改 data/）")
    lines.append("")
    if not issues:
        lines.append("- 16 条用例的 id、kind/expected.intent、mustInclude、mustCite、maxCauses 均通过校验；")
        lines.append("- `mustCite` 交叉校验：全部指向 `data/knowledge.jsonl` 中存在的知识 id，无悬空引用。")
    else:
        lines.append("| 用例 | 问题 | 级别 |")
        lines.append("| --- | --- | --- |")
        for cid, detail, level in issues:
            lines.append("| %s | %s | %s |" % (cid, _cell(detail, 240), level))
        lines.append("")
        lines.append("> 按任务约定，数据问题只上报 Lead 决策，不直接修改 `data/`。")
    lines.append("")
    lines.append("## 6 评测口径")
    lines.append("")
    lines.append("1. 每条用例新建 Engine 实例与独立会话，`chat(input)`，不传 `equipmentCode`，角色 `student`；")
    lines.append("   运行前清除 `LLM_API_BASE/LLM_API_KEY/LLM_MODEL`，保证可复现的离线路径。")
    lines.append("2. 意图映射：QA→QA、CHECKLIST→CHK、TROUBLESHOOT→TRG；DANGER 允许 `intent=DANGER`，")
    lines.append("   或 `answerType=REFUSAL` 且 `escalate=true`（安全拒答）。")
    lines.append("3. 关键词：`mustInclude` 全部出现在 `text` 与 `causes` 的拼接文本中；")
    lines.append("4. 引用：`mustCite` 全部出现在 `citations` 中；")
    lines.append("5. `causes` 数量不超过 `maxCauses`；")
    lines.append("6. 结构三要素按类型判定（见下）；")
    lines.append("7. 平均耗时只统计 `chat` 调用，Engine 初始化与数据加载不计入；")
    lines.append("8. 危险拦截率只统计 DANGER 用例，要求 `intent=DANGER` 且 `answerType=REFUSAL` 且 `escalate=true`。")
    lines.append("")
    lines.append("~~~text")
    for rule_line in STRUCTURE_RULES.splitlines():
        lines.append(rule_line)
    lines.append("~~~")
    lines.append("")
    lines.append("## 7 迭代记录")
    lines.append("")
    lines.append("<!-- ITERATION-LOG:BEGIN -->")
    lines.append("| 轮次 | 时间 | 意图 | 关键词 | 引用 | 危险 | 结构 | 改动与结论 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    if iteration_rows:
        for row in iteration_rows:
            lines.append("| " + " | ".join(row) + " |")
    else:
        lines.append("| — | %s | — | — | — | — | — | 尚无迭代记录；运行 `python demo/evaluate.py --round N --note \"...\"` 追加。 |" % now)
    lines.append("<!-- ITERATION-LOG:END -->")
    lines.append("")
    return "\n".join(lines)


def _upsert_iteration(rows, round_no, note, metrics, now):
    row = [
        str(round_no),
        now,
        _pct(metrics["rates"]["intent"]),
        _pct(metrics["rates"]["keyword"]),
        _pct(metrics["rates"]["citation"]),
        _pct(metrics["rates"]["danger"]),
        _pct(metrics["rates"]["structure"]),
        _cell(note, 300) or "—",
    ]
    out = [row if r and r[0] == str(round_no) else r for r in rows]
    if not any(r and r[0] == str(round_no) for r in rows):
        out.append(row)
    out.sort(key=lambda r: int(r[0]) if r and r[0].isdigit() else 10 ** 6)
    return out


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(description="维修百事通离线评测")
    parser.add_argument("--cases", default=DEFAULT_CASES, help="评测用例 JSONL 路径")
    parser.add_argument("--report", default=DEFAULT_REPORT, help="报告输出路径")
    parser.add_argument("--round", type=int, default=None, help="迭代轮次（写入报告迭代记录）")
    parser.add_argument("--note", default="", help="本轮改动说明（配合 --round）")
    args = parser.parse_args(argv)

    cases_path = os.path.abspath(args.cases)
    report_path = os.path.abspath(args.report)
    if not os.path.isfile(cases_path):
        print("找不到评测用例：%s" % cases_path, file=sys.stderr)
        return 2
    if not os.path.isdir(DATA_DIR):
        print("找不到数据目录：%s" % DATA_DIR, file=sys.stderr)
        return 2

    for env_key in ("LLM_API_BASE", "LLM_API_KEY", "LLM_MODEL"):
        os.environ.pop(env_key, None)

    cases = _load_jsonl(cases_path)
    if not cases:
        print("评测用例为空：%s" % cases_path, file=sys.stderr)
        return 2

    knowledge_ids = _knowledge_ids()
    issues = _check_consistency(cases, knowledge_ids)

    runtime_dir = tempfile.mkdtemp(prefix="wxbst-eval-")
    records = []
    try:
        for case in cases:
            record = _run_case(case, runtime_dir)
            records.append(_judge(record))
    finally:
        shutil.rmtree(runtime_dir, ignore_errors=True)

    metrics = _metrics(records)
    met = _all_targets_met(metrics)
    now = _dt.datetime.now().astimezone().isoformat(timespec="seconds")
    iteration_rows = _load_iteration_rows(report_path)
    note = _safe_str(args.note).strip()
    round_no = args.round
    if note and round_no is None:
        round_no = max([int(r[0]) for r in iteration_rows if r and r[0].isdigit()] or [0]) + 1
    if round_no is not None:
        iteration_rows = _upsert_iteration(iteration_rows, round_no, note, metrics, now)

    report = _build_report(records, metrics, issues, iteration_rows, cases_path)
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(report)
        fh.write("\n")

    print("=" * 66)
    print("维修百事通 · 离线评测（%d 条用例）" % metrics["total"])
    print("引擎模式: offline（强制） | 数据: %s" % os.path.relpath(cases_path, ROOT))
    print("-" * 66)
    print("%-16s %-10s %-10s %s" % ("指标", "目标", "实际", "结论"))
    for name, target, actual, verdict in _target_rows(metrics):
        print("%-16s %-10s %-10s %s" % (name, _pct(target), _pct(actual), verdict))
    print("-" * 66)
    print(
        "词级召回 %d/%d（%s） | 引用召回 %d/%d（%s） | 平均耗时 %.4f s/条"
        % (
            metrics["keyword_hit"], metrics["keyword_total"], _pct(metrics["keyword_recall"]),
            metrics["citation_hit"], metrics["citation_total"], _pct(metrics["citation_recall"]),
            metrics["avg_latency"],
        )
    )
    print("-" * 66)

    failed = [r for r in records if not r["pass"]]
    if not failed:
        print("全部用例通过。")
    else:
        print("失败用例 %d/%d：" % (len(failed), metrics["total"]))
        for record in failed:
            print("[FAIL] %s (%s)" % (record["id"], record["kind"]))
            print("  期望: %s" % json.dumps(record["expected"], ensure_ascii=False))
            actual = {
                "intent": record["intent"],
                "answerType": record["answerType"],
                "escalate": record["escalate"],
                "causes": len(record["causes"]),
                "citations": record["citations"],
                "missingKeywords": record["missing_keywords"],
                "missingCitations": record["missing_citations"],
                "structureMissing": record["structure"]["missing"],
            }
            if record["error"]:
                actual["error"] = record["error"].splitlines()[-1]
            print("  实际: %s" % json.dumps(actual, ensure_ascii=False))
            if record["missing_keywords"]:
                print("  关键词缺失: %s" % "、".join(record["missing_keywords"]))
            if record["missing_citations"]:
                print("  引用缺失: %s" % "、".join(record["missing_citations"]))
            if not record["causes_ok"]:
                print("  causes 超限: %d > %s" % (len(record["causes"]), record["expected"].get("maxCauses")))
            if not record["structure"]["ok"]:
                print("  结构缺失: %s" % "、".join(record["structure"]["missing"]))
    print("-" * 66)
    if issues:
        blockers = [i for i in issues if i[2] == "blocker"]
        print("数据一致性问题: %d 项（其中 blocker %d 项，详见报告第 5 节）" % (len(issues), len(blockers)))
    else:
        print("数据一致性: mustCite 全部存在，无悬空引用。")
    print("报告: %s" % os.path.relpath(report_path, ROOT))
    print("=" * 66)
    return 0 if met else 1


if __name__ == "__main__":
    sys.exit(main())
