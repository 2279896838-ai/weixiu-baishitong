# -*- coding: utf-8 -*-
"""提示词运行时自检：python scripts/test-prompts.py"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "demo"))

from prompt_runtime import PromptRuntime, PromptRuntimeError, EXPECTED_IDS  # noqa: E402

fails = []


def check(name, cond, detail=None):
    suffix = "" if detail is None else " :: %s" % (detail,)
    print(("PASS " if cond else "FAIL ") + name + suffix)
    if not cond:
        fails.append(name)


def is_version(value):
    parts = str(value).split(".")
    return len(parts) == 3 and all(part.isdigit() for part in parts)


def run():
    runtime = PromptRuntime(os.path.join(ROOT, "prompts"))
    check("assets count", len(runtime.assets) == 15, len(runtime.assets))
    check("no load errors", not runtime.errors, runtime.errors)
    check("registry ids", sorted(runtime.assets) == sorted(EXPECTED_IDS))
    for asset_id in EXPECTED_IDS:
        asset = runtime.get_asset(asset_id)
        check(asset_id + " body", bool(asset and asset.chars >= 500), asset.chars if asset else None)
        check(asset_id + " sections", bool(asset and "## 角色" in asset.body and ("## 任务" in asset.body or "## 目标" in asset.body)))
        check(asset_id + " version", bool(asset and is_version(asset.version)))
    check("no warnings", not runtime.warnings, runtime.warnings)
    stats = runtime.stats()
    check("stats count", stats["count"] == 15, stats["count"])
    qa = runtime.get_asset("WXBST-QA-001")
    variables = {key: "X" for key in qa.placeholders}
    rendered = runtime.render("WXBST-QA-001", variables, strict=True)
    check("render placeholders", "{{" not in rendered, qa.placeholders)
    try:
        runtime.render("WXBST-QA-001", {}, strict=True)
        check("strict unresolved raises", False)
    except PromptRuntimeError:
        check("strict unresolved raises", True)
    system_prompt = runtime.build_system_prompt({"user_query": "主轴异响", "equipment_ledger": "{}", "retrieved_chunks": "[]"})
    check("system prompt role", "## 角色" in system_prompt)
    check("system prompt qa", "故障诊断工程师" in system_prompt)
    check("system prompt no raw placeholder", "{{" not in system_prompt)
    check("system prompt length", len(system_prompt) > 1500, len(system_prompt))

    from engine import Engine  # noqa: E402
    engine = Engine(os.path.join(ROOT, "data"), os.path.join(ROOT, "templates", "_test_runtime"))
    prompts = engine.prompt_stats
    check("engine prompt stats", prompts.get("count") == 15, prompts.get("count"))
    asset = engine.get_prompt_asset("WXBST-SYS-001")
    check("engine get prompt", bool(asset and asset.get("id") == "WXBST-SYS-001"))
    check("engine unknown prompt", engine.get_prompt_asset("WXBST-NONE-999") is None)
    messages = engine._build_llm_messages("主轴异响", "student", None, [])
    system = messages[0]["content"]
    check("llm system uses assets", "故障诊断工程师" in system and len(system) > 1500, len(system))
    check("llm system no placeholder", "{{" not in system)
    print("")
    if fails:
        print("%d FAILED: %s" % (len(fails), ", ".join(fails)))
        return 1
    print("ALL PROMPT CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(run())
