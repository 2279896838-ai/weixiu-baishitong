#!/usr/bin/env node
// 从 docs/draft/*.md 抽取 15 个提示词资产到 prompts/<dir>/<ID>.md 与 prompts/registry.yaml
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGETS = [
  { id: "WXBST-SYS-001", dir: "sys", expect: "维修百事通" },
  { id: "WXBST-RTR-001", dir: "router", expect: "意图路由" },
  { id: "WXBST-QA-001", dir: "scenario", expect: "故障诊断工程师" },
  { id: "WXBST-TRG-001", dir: "scenario", expect: "现场排查" },
  { id: "WXBST-CHK-001", dir: "scenario", expect: "点检标准编制" },
  { id: "WXBST-CHK-002", dir: "scenario", expect: "填报校验" },
  { id: "WXBST-DASH-001", dir: "scenario", expect: "看板" },
  { id: "WXBST-WO-001", dir: "scenario", expect: "工单受理" },
  { id: "WXBST-EXT-001", dir: "scenario", expect: "知识" },
  { id: "WXBST-INT-001", dir: "scenario", expect: "访谈" },
  { id: "WXBST-RAG-QRY-001", dir: "rag", expect: "查询改写" },
  { id: "WXBST-RAG-RNK-001", dir: "rag", expect: "重排" },
  { id: "WXBST-FIX-001", dir: "fix", expect: "JSON 修复" },
  { id: "WXBST-SEC-001", dir: "safety", expect: "安全判定" },
  { id: "WXBST-EVL-001", dir: "eval", expect: "评测" },
];
const draftDir = join(ROOT, "docs/draft");
const files = readdirSync(draftDir).filter((f) => f.endsWith(".md"));
const corpus = files.map((f) => ({ file: f, lines: readFileSync(join(draftDir, f), "utf8").split("\n") }));

const found = {};
for (const c of corpus) {
  for (let i = 0; i < c.lines.length; i++) {
    if (!/^\s*```text\s*$/.test(c.lines[i])) continue;
    // 向上 25 行找最近的资产编号
    let id = null, idLine = -1;
    for (let j = i - 1; j >= Math.max(0, i - 25); j--) {
      const m = c.lines[j].match(/WXBST-[A-Z-]+-\d{3}/);
      if (m) { id = m[0]; idLine = j; break; }
    }
    if (!id || found[id]) continue;
    // 找闭合围栏
    let end = -1;
    for (let j = i + 1; j < c.lines.length; j++) if (/^\s*```\s*$/.test(c.lines[j])) { end = j; break; }
    if (end < 0) continue;
    const body = c.lines.slice(i + 1, end).join("\n");
    if (!body.includes("## 角色")) continue;
    let heading = "";
    for (let j = idLine; j >= 0; j--) if (/^##\s+\d+\.\d+/.test(c.lines[j])) { heading = c.lines[j].replace(/^##\s+/, ""); break; }
    if (!heading) for (let j = idLine; j >= 0; j--) if (/^##\s+/.test(c.lines[j])) { heading = c.lines[j].replace(/^##\s+/, ""); break; }
    found[id] = { file: c.file, body, heading };
  }
}
let ok = 0;
for (const t of TARGETS) {
  const f = found[t.id];
  if (!f) { console.error("MISSING", t.id); continue; }
  if (!f.body.includes(t.expect)) console.error("WARN content mismatch", t.id, "expect", t.expect);
  const dir = join(ROOT, "prompts", t.dir);
  mkdirSync(dir, { recursive: true });
  const version = t.id === "WXBST-QA-001" ? "1.1.0" : t.id === "WXBST-EVL-001" ? "1.0.1" : "1.0.0";
  const md = ["# " + t.id, "", "- 来源：docs/draft/" + f.file + " · " + f.heading,
    "- 版本：v" + version, "- 生成方式：node scripts/extract-prompts.mjs（修改请改源稿后重新生成）", "",
    "## 提示词正文", "", "```text", f.body, "```", ""].join("\n");
  writeFileSync(join(dir, t.id + ".md"), md, "utf8");
  ok++;
}
const reg = ["# 提示词资产登记表", "", "| 编号 | 版本 | 文件 |", "| --- | --- | --- |"];
for (const t of TARGETS) {
  const version = t.id === "WXBST-QA-001" ? "v1.1.0" : t.id === "WXBST-EVL-001" ? "v1.0.1" : "v1.0.0";
  reg.push("| " + t.id + " | " + version + " | prompts/" + t.dir + "/" + t.id + ".md |");
}
writeFileSync(join(ROOT, "prompts/registry.yaml"),
  "assets:\n" + TARGETS.map((t) => {
    const version = t.id === "WXBST-QA-001" ? "1.1.0" : t.id === "WXBST-EVL-001" ? "1.0.1" : "1.0.0";
    return "  - id: " + t.id + "\n    version: " + version + "\n    path: " + t.dir + "/" + t.id + ".md";
  }).join("\n") + "\n", "utf8");
console.log("extracted", ok, "/", TARGETS.length);
