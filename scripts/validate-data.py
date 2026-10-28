# -*- coding: utf-8 -*-
import json, os, sys
os.chdir("data")
ok = True
for f in ["equipment.json", "checklists.json", "knowledge.jsonl", "trees.json", "eval_cases.jsonl", "eval_cases_ext.jsonl", "eval_cases_met.jsonl"]:
    if not os.path.exists(f):
        print(f, "MISSING"); ok = False; continue
    try:
        if f.endswith(".jsonl"):
            n = 0
            for line in open(f, encoding="utf-8"):
                line = line.strip()
                if line:
                    json.loads(line); n += 1
            print(f, "OK lines=%d" % n)
        else:
            d = json.load(open(f, encoding="utf-8"))
            print(f, "OK", type(d).__name__, len(d))
    except Exception as e:
        print(f, "ERROR", e); ok = False
# coverage checks
try:
    eq = json.load(open("equipment.json", encoding="utf-8"))
    cats = sorted({e.get("category") for e in eq})
    print("categories:", cats)
    kb = [json.loads(l) for l in open("knowledge.jsonl", encoding="utf-8") if l.strip()]
    print("knowledge:", len(kb), "interview:", sum(1 for k in kb if k.get("source", {}).get("type") == "TEACHER_INTERVIEW"))
    print("kb categories:", sorted({k.get("equipmentCategory") for k in kb}))
    ck = json.load(open("checklists.json", encoding="utf-8"))
    print("checklist cats:", sorted(ck.keys()), "D counts:", {k: len(v.get("D", [])) for k, v in ck.items()})
except Exception as e:
    print("coverage error", e); ok = False
sys.exit(0 if ok else 1)
