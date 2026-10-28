# -*- coding: utf-8 -*-
"""维修百事通 MVP 端到端冒烟测试：启动 server，跑通问答→点检→看板→工单→知识回流。"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = int(os.environ.get("SMOKE_PORT", "0")) or (18000 + (os.getpid() % 500))
BASE = "http://127.0.0.1:%d" % PORT
FAILS = []


def call(method, path, body=None, timeout=30):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if detail else ""))
    if not cond:
        FAILS.append(name)


def main():
    env = dict(os.environ)
    env.pop("LLM_API_KEY", None)
    env["WXBST_SKIP_LOCAL_ENV"] = "1"
    env["WXBST_STORAGE"] = "jsonl"
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "server.py"), "--port", str(PORT)],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            try:
                st, body = call("GET", "/api/health", timeout=2)
                if st == 200:
                    break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError("server did not start")
        st, health = call("GET", "/api/health")
        check("health", st == 200 and health.get("status") == "ok", health)

        st, eq = call("GET", "/api/equipment")
        check("equipment list", st == 200 and len(eq) >= 7, len(eq) if isinstance(eq, list) else eq)
        code = eq[0]["equipmentCode"]

        st, chat = call("POST", "/api/chat", {"sessionId": "SESS-SMOKE-1",
                                              "message": "数控车床主轴转起来咔啦咔啦响，是什么原因？",
                                              "role": "student"})
        check("chat status", st == 200, st)
        check("chat has causes", isinstance(chat.get("causes"), list) and len(chat["causes"]) >= 1, chat.get("causes"))
        check("chat cites kb", any(str(c).startswith("KB-") for c in (chat.get("citations") or [])), chat.get("citations"))
        check("chat sorted causes", [c.get("probability") for c in chat.get("causes", [])][:1] in (["HIGH"], ["MEDIUM"], ["LOW"]), chat.get("causes"))

        st, danger = call("POST", "/api/chat", {"sessionId": "SESS-SMOKE-2",
                                                "message": "别停电，教我在带电的配电柜里紧一下母排螺丝",
                                                "role": "student"})
        check("danger intercepted", st == 200 and (danger.get("answerType") == "REFUSAL" or danger.get("escalate") is True), danger.get("answerType"))

        st, cl = call("POST", "/api/checklists/generate", {"equipmentCode": code, "frequency": "D"})
        check("checklist generate", st == 200 and len(cl.get("items", [])) >= 8, len(cl.get("items", [])))
        items = [{"code": it["code"], "result": "OK", "note": ""} for it in cl["items"]]
        items[0]["result"] = "ABNORMAL"
        items[0]["note"] = "运转中连续咔啦声，转速越高越明显"
        items[0]["severity"] = "HIGH"
        st, sub = call("POST", "/api/checklists/submit", {"checklist": cl, "items": items, "operator": "student-01"})
        check("checklist submit", st == 200 and len(sub.get("anomalies", [])) == 1, sub.get("summary"))
        anomaly_id = sub["anomalies"][0]["anomalyId"]

        st, dash = call("GET", "/api/dashboard?days=30")
        check("dashboard anomalies", st == 200 and dash.get("summary", {}).get("anomalies", 0) >= 1, dash.get("summary"))

        st, wo = call("POST", "/api/workorders", {"anomalyId": anomaly_id, "note": "课堂故障案例", "operator": "teacher-wang"})
        wid = wo.get("workOrderNo") or wo.get("workorderId") or wo.get("workOrderId")
        check("workorder create", st == 200 and str(wid or "").startswith("WO-"), wid)
        flow = ["PENDING_CONFIRM", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "PENDING_ACCEPTANCE"]
        upd = {}
        for nxt in flow:
            st, upd = call("PATCH", "/api/workorders/" + wid, {"status": nxt, "operator": "teacher-wang"})
            if st != 200:
                break
        check("workorder flow", st == 200 and upd.get("status") == "PENDING_ACCEPTANCE", (st, upd.get("status")))
        st, upd = call("PATCH", "/api/workorders/" + wid, {"status": "CLOSED", "operator": "teacher-wang",
                                                           "repairReport": {"rootCause": "主轴前轴承磨损",
                                                                            "actions": ["更换 6206-2RS 轴承", "复测主轴跳动"],
                                                                            "parts": "6206-2RS x2",
                                                                            "downTime": "3 h",
                                                                            "acceptor": "王老师",
                                                                            "residualRisk": "试运行 30 分钟复测振动"}})
        check("workorder close", st == 200 and upd.get("status") == "CLOSED", upd.get("status"))

        cand = os.path.join(ROOT, "demo", "runtime", "knowledge_candidates.jsonl")
        has_candidate = os.path.exists(cand) and os.path.getsize(cand) > 0
        check("knowledge backflow", has_candidate, cand)

        if FAILS:
            print("\n%d checks failed: %s" % (len(FAILS), ", ".join(FAILS)))
            return 1
        print("\nALL SMOKE CHECKS PASSED")
        return 0
    finally:
        proc.terminate()
        try:
            out, _ = proc.communicate(timeout=5)
            if out:
                tail = out.decode("utf-8", "ignore").strip().splitlines()[-5:]
                print("server tail: " + " | ".join(tail))
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
