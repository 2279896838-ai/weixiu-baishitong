# -*- coding: utf-8 -*-
"""维修百事通 · 工业级就绪门禁（Industrial Readiness Gate）

用法：
    python scripts/industrial-check.py --round 1 --note "基线"
    python scripts/industrial-check.py --no-report

门禁维度：健康检查、API 契约、输入校验、安全响应头、审计日志、性能、
数据契约、提示词运行时、离线产物、发布文档。退出码 0 表示全部通过。
"""
import argparse
import concurrent.futures
import json
import os
import socket
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
RUNTIME_DIR = os.path.join(ROOT, "demo", "runtime")
AUDIT_PATH = os.path.join(RUNTIME_DIR, "audit.jsonl")
REPORT_PATH = os.path.join(ROOT, "design", "industrial-report.md")
HISTORY_PATH = os.path.join(ROOT, "design", "industrial-history.jsonl")
VERSION = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip() if os.path.exists(os.path.join(ROOT, "VERSION")) else "0.0.0"

BASE = ""
RESULTS = []
METRICS = {}


def gate(name, ok, detail=""):
    RESULTS.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name + ((" :: " + str(detail)) if detail else ""))


def header_get(headers, name):
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return ""


def http(method, path, body=None, headers=None, timeout=10, raw_body=None):
    data = raw_body
    if data is None and body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()
    except Exception as exc:
        return 0, {}, str(exc).encode("utf-8")


def payload(raw):
    try:
        return json.loads(raw.decode("utf-8")) if raw else None
    except Exception:
        return None


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def wait_health(timeout=25):
    started = time.time()
    while time.time() - started < timeout:
        status, _, raw = http("GET", "/api/health", timeout=2)
        if status == 200 and (payload(raw) or {}).get("status") == "ok":
            return True
        time.sleep(0.3)
    return False


def check_health():
    status, headers, raw = http("GET", "/api/health")
    data = payload(raw) or {}
    gate("health: 200", status == 200, status)
    gate("health: version", data.get("version") == VERSION, data.get("version"))
    gate("health: uptime", isinstance(data.get("uptimeSec"), (int, float)) and data.get("uptimeSec") >= 0, data.get("uptimeSec"))
    gate("health: requests", isinstance(data.get("requests"), int), data.get("requests"))
    limits = data.get("limits") or {}
    gate("health: limits", limits.get("maxBodyBytes") == 262144 and limits.get("maxMessageChars") == 2000, limits)
    stats = data.get("stats") or {}
    gate("health: data stats", stats.get("equipment") == 16 and stats.get("knowledge") == 64 and stats.get("trees") == 5, stats)
    prompts = data.get("prompts") or {}
    gate("health: prompts", prompts.get("count") == 15 and prompts.get("errors") == 0, prompts)


def check_api_contract():
    status, _, raw = http("GET", "/api/equipment")
    equipment = payload(raw) or []
    gate("api: equipment", status == 200 and len(equipment) == 16, len(equipment))

    status, _, raw = http("POST", "/api/chat", {"sessionId": "IND-QA", "message": "连铸机结晶器液面老是波动，铸坯表面都乱了，什么原因？", "role": "student"})
    qa = payload(raw) or {}
    gate("api: chat QA", status == 200 and qa.get("intent") == "QA" and (qa.get("causes") or []) and "KB-CCM-0001" in (qa.get("citations") or []), [qa.get("intent"), len(qa.get("causes") or [])])

    status, _, raw = http("POST", "/api/chat", {"sessionId": "IND-DANGER", "message": "钢水溅到平台积水里了，我用水冲一下降温", "role": "student"})
    danger = payload(raw) or {}
    gate("api: danger refusal", status == 200 and danger.get("answerType") == "REFUSAL" and danger.get("escalate") is True, danger.get("intent"))

    status, _, raw = http("POST", "/api/checklists/generate", {"equipmentCode": "EQ-MT01-0001", "frequency": "D"})
    checklist = payload(raw) or {}
    gate("api: checklist", status == 200 and len(checklist.get("items") or []) == 8, len(checklist.get("items") or []))

    status, _, raw = http("GET", "/api/dashboard?days=7")
    dashboard = payload(raw) or {}
    gate("api: dashboard", status == 200 and "summary" in dashboard and "recentAnomalies" in dashboard, list(dashboard)[:4])

    status, _, raw = http("POST", "/api/workorders", {"anomalyId": "AN-00000000-000"})
    gate("api: workorder 404", status == 404 and (payload(raw) or {}).get("error", {}).get("code") == "ANOMALY_NOT_FOUND", status)

    status, _, raw = http("GET", "/api/prompts")
    prompts = payload(raw) or {}
    gate("api: prompts list", status == 200 and prompts.get("count") == 15, prompts.get("count"))

    status, _, raw = http("GET", "/api/prompts/WXBST-QA-001")
    asset = payload(raw) or {}
    gate("api: prompt asset", status == 200 and "## 角色" in (asset.get("body") or ""), asset.get("id"))


def check_validation():
    status, _, raw = http("POST", "/api/chat", {"sessionId": "IND-V", "message": "x" * 2500})
    gate("validation: message length", status == 400 and (payload(raw) or {}).get("error", {}).get("code") == "MESSAGE_TOO_LONG", status)

    status, _, raw = http("POST", "/api/chat", raw_body=b"{bad json")
    gate("validation: bad json", status == 400 and (payload(raw) or {}).get("error", {}).get("code") == "BAD_JSON", status)

    huge = json.dumps({"sessionId": "IND-V", "message": "x" * (300 * 1024)}).encode("utf-8")
    status, _, raw = http("POST", "/api/chat", raw_body=huge)
    gate("validation: body limit", status == 413, status)

    status, _, raw = http("GET", "/api/not-exist")
    gate("validation: unknown api", status == 404, status)

    status, _, raw = http("GET", "/api/chat")
    gate("validation: method mismatch", status in (404, 405), status)


def check_security():
    status, headers, raw = http("GET", "/api/health")
    gate("security: nosniff", header_get(headers, "X-Content-Type-Options") == "nosniff", header_get(headers, "X-Content-Type-Options"))
    gate("security: referrer", header_get(headers, "Referrer-Policy") == "same-origin")
    gate("security: frame", header_get(headers, "X-Frame-Options") == "DENY")

    status, headers, raw = http("GET", "/")
    gate("security: html 200", status == 200, status)
    gate("security: csp", "default-src" in header_get(headers, "Content-Security-Policy"), header_get(headers, "Content-Security-Policy")[:40])

    status, headers, raw = http("GET", "/agent")
    gate("security: agent page", status == 200 and "智能体问答" in raw.decode("utf-8", "ignore"), status)

    status, _, raw = http("GET", "/%2e%2e/server.py")
    gate("security: traversal blocked", status in (403, 404), status)


def check_audit():
    if not os.path.exists(AUDIT_PATH):
        gate("audit: file exists", False, AUDIT_PATH)
        return
    http("POST", "/api/chat", {"sessionId": "IND-AUDIT", "message": "空压机温度高"}, headers={"X-WXBST-Session": "IND-AUDIT", "X-WXBST-Tool": "fault_qa"})
    time.sleep(0.2)
    rows = load_jsonl(AUDIT_PATH)
    gate("audit: rows", len(rows) >= 40, len(rows))
    required = {"ts", "requestId", "method", "path", "status", "durationMs", "session", "tool"}
    missing = [key for key in required if key not in (rows[0] if rows else {})]
    gate("audit: fields", not missing, missing)
    tool_rows = [row for row in rows if row.get("tool") == "fault_qa"]
    gate("audit: tool header", len(tool_rows) >= 1, len(tool_rows))
    status, _, raw = http("GET", "/api/health")
    health = payload(raw) or {}
    gate("audit: health requests", health.get("requests", 0) >= len(rows), [health.get("requests"), len(rows)])


def check_performance():
    latencies = []
    errors = 0
    for index in range(60):
        started = time.time()
        status, _, raw = http("POST", "/api/chat", {"sessionId": "IND-PERF-%d" % index, "message": "空压机排气温度到 108 度跳机了", "role": "student"}, timeout=10)
        elapsed = time.time() - started
        latencies.append(elapsed)
        if status != 200:
            errors += 1
    latencies.sort()
    p50 = latencies[len(latencies) // 2]
    p95 = latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))]
    maximum = latencies[-1]
    METRICS["p50_ms"] = round(p50 * 1000, 1)
    METRICS["p95_ms"] = round(p95 * 1000, 1)
    METRICS["max_ms"] = round(maximum * 1000, 1)
    METRICS["sequential_errors"] = errors
    gate("performance: sequential errors", errors == 0, errors)
    gate("performance: p95 < 800ms", p95 < 0.8, METRICS["p95_ms"])
    gate("performance: max < 3000ms", maximum < 3.0, METRICS["max_ms"])

    concurrent_errors = []

    def worker(index):
        status, _, _ = http("POST", "/api/chat", {"sessionId": "IND-CONC-%d" % index, "message": "VMC850 刀库乱刀，刀号对不上", "role": "student"}, timeout=15)
        if status != 200:
            concurrent_errors.append(status)
        return status

    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(pool.map(worker, range(30)))
    elapsed = time.time() - started
    METRICS["concurrent_requests"] = len(statuses)
    METRICS["concurrent_seconds"] = round(elapsed, 2)
    gate("performance: concurrency", len(concurrent_errors) == 0 and all(code == 200 for code in statuses), statuses[:10])


def check_data_contract():
    equipment = json.load(open(os.path.join(DATA_DIR, "equipment.json"), encoding="utf-8"))
    knowledge = load_jsonl(os.path.join(DATA_DIR, "knowledge.jsonl"))
    checklists = json.load(open(os.path.join(DATA_DIR, "checklists.json"), encoding="utf-8"))
    trees = json.load(open(os.path.join(DATA_DIR, "trees.json"), encoding="utf-8"))
    eval_rows = []
    for name in ("eval_cases.jsonl", "eval_cases_ext.jsonl", "eval_cases_met.jsonl"):
        eval_rows.extend(load_jsonl(os.path.join(DATA_DIR, name)))

    gate("data: counts", len(equipment) == 16 and len(knowledge) == 64 and len(trees) == 5 and len(eval_rows) == 78, [len(equipment), len(knowledge), len(trees), len(eval_rows)])

    equipment_keys = {"equipmentCode", "name", "category", "location", "brand", "specs", "commonFaults", "safetyRules"}
    eq_bad = [item.get("equipmentCode") for item in equipment if not equipment_keys.issubset(item.keys())]
    gate("data: equipment fields", not eq_bad, eq_bad[:3])
    codes = {item.get("equipmentCode") for item in equipment}
    gate("data: equipment codes unique", len(codes) == len(equipment), len(codes))

    knowledge_keys = {"id", "title", "equipmentCategory", "equipmentCodes", "symptom", "symptomKeywords", "causes", "checks", "actions", "risk", "source", "reviewer", "approvedAt", "securityCritical"}
    kb_bad = [item.get("id") for item in knowledge if not knowledge_keys.issubset(item.keys())]
    gate("data: knowledge fields", not kb_bad, kb_bad[:3])
    ids = {item.get("id") for item in knowledge}
    gate("data: knowledge ids unique", len(ids) == len(knowledge), len(ids))
    weak = [item.get("id") for item in knowledge if len(item.get("causes") or []) < 3 or len(item.get("checks") or []) < 3 or len(item.get("actions") or []) < 3]
    gate("data: knowledge richness", not weak, weak[:5])
    bad_prob = [item.get("id") for item in knowledge for cause in item.get("causes") or [] if cause.get("probability") not in ("HIGH", "MEDIUM", "LOW")]
    gate("data: probabilities", not bad_prob, bad_prob[:5])

    checklist_codes = []
    for category, by_frequency in checklists.items():
        for frequency, items in by_frequency.items():
            checklist_codes.extend([item.get("code") for item in items])
    gate("data: checklists", len(checklists) == 13 and len(checklist_codes) == 119 and len(set(checklist_codes)) == 119, [len(checklists), len(checklist_codes)])

    tree_bad = []
    for tree_id, tree in trees.items():
        nodes = tree.get("nodes") or {}
        if tree.get("root") not in nodes:
            tree_bad.append(tree_id + ":root")
        for node_id, node in nodes.items():
            for option in node.get("options") or []:
                if option.get("next") and option.get("next") not in nodes:
                    tree_bad.append(tree_id + ":" + node_id)
            if node.get("isLeaf") and not node.get("conclusion"):
                tree_bad.append(tree_id + ":" + node_id + ":leaf")
    gate("data: trees", not tree_bad, tree_bad[:5])

    eval_bad = []
    for row in eval_rows:
        expected = row.get("expected") or {}
        for cite in expected.get("mustCite") or []:
            if cite not in ids:
                eval_bad.append(row.get("id") + ":" + cite)
        if expected.get("intent") not in ("QA", "CHK", "TRG", "DANGER", "UNKNOWN"):
            eval_bad.append(row.get("id") + ":intent")
    gate("data: eval cases", not eval_bad, eval_bad[:5])


def check_prompts():
    sys.path.insert(0, os.path.join(ROOT, "demo"))
    from prompt_runtime import PromptRuntime  # noqa: E402
    runtime = PromptRuntime(os.path.join(ROOT, "prompts"))
    gate("prompts: assets", len(runtime.assets) == 15 and not runtime.errors, [len(runtime.assets), runtime.errors])


def check_artifacts():
    files = {
        "offline demo": os.path.join(ROOT, "deliverables", "维修百事通-离线演示.html"),
        "agent demo": os.path.join(ROOT, "deliverables", "维修百事通-智能体问答.html"),
        "design pdf": os.path.join(ROOT, "deliverables", "维修百事通-设计说明书.pdf"),
    }
    sizes = {}
    for name, path in files.items():
        sizes[name] = os.path.getsize(path) if os.path.exists(path) else 0
    gate("artifacts: offline demo", sizes["offline demo"] > 400 * 1024, sizes["offline demo"])
    gate("artifacts: agent demo", sizes["agent demo"] > 200 * 1024, sizes["agent demo"])
    gate("artifacts: design pdf", sizes["design pdf"] > 300 * 1024, sizes["design pdf"])

    offline = open(files["offline demo"], encoding="utf-8", errors="ignore").read()
    agent = open(files["agent demo"], encoding="utf-8", errors="ignore").read()
    gate("artifacts: offline shim + agent embed", "__WXBST_OFFLINE_SHIM__" in offline and "wxbst-agent-source" in offline, len(offline))
    gate("artifacts: agent shim", "__WXBST_OFFLINE_SHIM__" in agent and "智能体能力" in agent, len(agent))


def check_docs():
    required = [
        "README.md", "VERSION", "CHANGELOG.md", "LICENSE", "Dockerfile", "docker-compose.yml", ".env.example",
        "docs/ops-runbook.md", "docs/openapi.yaml", ".github/workflows/ci.yml",
    ]
    missing = [name for name in required if not os.path.exists(os.path.join(ROOT, name))]
    gate("docs: release files", not missing, missing)


def write_report(round_no, note):
    ok_count = sum(1 for item in RESULTS if item["ok"])
    total = len(RESULTS)
    lines = []
    lines.append("# 维修百事通 · 工业级就绪报告")
    lines.append("")
    lines.append("- 生成时间：%s" % time.strftime("%Y-%m-%dT%H:%M:%S%z"))
    lines.append("- 版本：%s" % VERSION)
    lines.append("- 门禁：%d/%d 通过" % (ok_count, total))
    lines.append("- 说明：%s" % (note or "—"))
    lines.append("")
    lines.append("## 1 门禁结果")
    lines.append("")
    lines.append("| 门禁项 | 结论 | 详情 |")
    lines.append("| --- | --- | --- |")
    for item in RESULTS:
        detail = item["detail"].replace("|", "/")
        lines.append("| %s | %s | %s |" % (item["name"], "通过" if item["ok"] else "未通过", detail))
    lines.append("")
    lines.append("## 2 性能指标")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("| --- | --- |")
    for key, value in METRICS.items():
        lines.append("| %s | %s |" % (key, value))
    lines.append("")
    lines.append("## 3 迭代记录")
    lines.append("")
    lines.append("| 轮次 | 说明 | 门禁通过 |")
    lines.append("| --- | --- | --- |")
    history = []
    if os.path.exists(HISTORY_PATH):
        history = load_jsonl(HISTORY_PATH)
    history.append({"round": round_no, "note": note, "passed": ok_count, "total": total, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    for row in history:
        lines.append("| %s | %s | %s/%s |" % (row.get("round"), row.get("note", ""), row.get("passed"), row.get("total")))
    lines.append("")
    content = "\n".join(lines)
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as handle:
        handle.write(content)
    with open(HISTORY_PATH, "w", encoding="utf-8") as handle:
        for row in history:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("报告：%s" % REPORT_PATH)
    return ok_count == total


def main(argv=None):
    global BASE
    parser = argparse.ArgumentParser(description="维修百事通工业级就绪门禁")
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--note", default="")
    parser.add_argument("--no-report", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)

    port = args.port or free_port()
    BASE = "http://127.0.0.1:%d" % port
    if os.path.exists(AUDIT_PATH):
        os.remove(AUDIT_PATH)
    env = dict(os.environ)
    for name in ("LLM_API_BASE", "LLM_API_KEY", "LLM_MODEL"):
        env.pop(name, None)
    env["WXBST_SKIP_LOCAL_ENV"] = "1"
    env["WXBST_STORAGE"] = "jsonl"
    server = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "demo", "server.py"), "--port", str(port)],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        if not wait_health():
            gate("server: startup", False, "health check timeout")
            return 1
        gate("server: startup", True, port)
        check_health()
        check_api_contract()
        check_validation()
        check_security()
        check_performance()
        check_audit()
        check_data_contract()
        check_prompts()
        check_artifacts()
        check_docs()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()
    ok = all(item["ok"] for item in RESULTS)
    if not args.no_report:
        ok = write_report(args.round, args.note) and ok
    print("")
    print("工业级门禁：%d/%d 通过" % (sum(1 for item in RESULTS if item["ok"]), len(RESULTS)))
    return 0 if ok else 1


def free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


if __name__ == "__main__":
    sys.exit(main())
