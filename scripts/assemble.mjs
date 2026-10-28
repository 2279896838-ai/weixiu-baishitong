import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  { path: "docs/draft/01-overview-architecture.md", h1: ["# 1 项目与提示词工程概述", "# 2 提示词体系总体架构"] },
  { path: "docs/draft/02-system-prompt.md", h1: ["# 3 全局系统提示词"] },
  { path: "docs/draft/03-scenarios.md", h1: ["# 4 核心场景提示词"] },
  { path: "docs/draft/04-rag-tools-output.md", h1: ["# 5 检索增强生成提示词", "# 6 工具调用与 Agent 编排", "# 7 结构化输出与格式约束"] },
  { path: "docs/draft/05-safety-eval-engineering.md", h1: ["# 8 提示词安全与风险控制", "# 9 评估、测试与持续迭代", "# 10 工程实现与运维"] },
  { path: "docs/draft/06-examples-appendix.md", h1: ["# 11 场景示例库", "# 12 附录"] },
  { path: "docs/draft/07-agent-collaboration.md", h1: ["# 13 智能体协作与提示词自迭代生产"] },
];

const FOREWORD = "docs/front/foreword.md";
const OUT = "deliverables/维修百事通-提示词工程规范-v1.0.md";

function scan(md) {
  const lines = md.split(/\r?\n/);
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\x60{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }
  return headings;
}

function stat(md) {
  const cjk = (md.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latin = (md.match(/[A-Za-z0-9]+(?:['\u2019\-][A-Za-z0-9]+)*/g) || []).length;
  return { cjk, latin, wordLike: cjk + latin };
}

const errors = [];
const warnings = [];
let body = "";
let total = { cjk: 0, latin: 0, wordLike: 0 };
const chapterHeadings = [];

for (const f of FILES) {
  const p = join(ROOT, f.path);
  if (!existsSync(p)) { errors.push("缺少文件：" + f.path); continue; }
  const md = readFileSync(p, "utf8");
  if (/<!--PART2-->/.test(md)) errors.push(f.path + " 残留 <!--PART2--> 占位符");
  if (/^---\s*$/m.test(md.split(/\r?\n/).slice(0, 1).join(""))) warnings.push(f.path + " 疑似包含 YAML 头");
  const hs = scan(md);
  const h1s = hs.filter(h => h.level === 1).map(h => "# " + h.text);
  for (const want of f.h1) {
    if (!h1s.includes(want)) errors.push(f.path + " 缺少标题：" + want);
  }
  const extra = h1s.filter(h => !f.h1.includes(h));
  if (extra.length) errors.push(f.path + " 存在未预期一级标题：" + extra.join(" / "));
  const s = stat(md);
  total.cjk += s.cjk; total.latin += s.latin; total.wordLike += s.wordLike;
  console.log(`${f.path}  CJK=${s.cjk}  WordLike=${s.wordLike}  H1=${h1s.length}  H2=${hs.filter(h=>h.level===2).length}`);
  body += (body ? "\n\n" : "") + md.trim() + "\n";
  chapterHeadings.push(...hs);
}

const forePath = join(ROOT, FOREWORD);
const fore = existsSync(forePath) ? readFileSync(forePath, "utf8").trim() : "";
const fs = stat(fore);

// TOC
const tocLines = ["- 前言"];
for (const h of chapterHeadings) {
  if (h.level === 1) tocLines.push("- " + h.text);
  else if (h.level === 2) tocLines.push("  - " + h.text);
  else if (h.level === 3) tocLines.push("    - " + h.text);
}
const toc = tocLines.join("\n");

const YAML = [
  "---",
  'title: "维修百事通 · 提示词工程规范"',
  'subtitle: "设备故障诊断知识助手：故障问答 / 排查引导 / 点检清单 / 工单流转"',
  'author: "维修百事通项目组"',
  'date: "2026-10-26"',
  'version: "v1.0"',
  "lang: zh-CN",
  "---",
].join("\n");

const mdOut = [YAML, "", fore, "", "# 目录", "", toc, "", body.trim(), ""].join("\n");
const os = stat(mdOut);
writeFileSync(join(ROOT, OUT), mdOut, "utf8");

console.log("");
console.log("前言 CJK=" + fs.cjk);
console.log("全文 CJK=" + os.cjk + "  LatinWords=" + os.latin + "  WordLike=" + os.wordLike);
console.log("输出：" + OUT);
for (const w of warnings) console.log("WARN " + w);
if (errors.length) { console.log("\nERRORS " + errors.length); for (const e of errors) console.log(" - " + e); process.exitCode = 1; }
else console.log("结构校验通过");
