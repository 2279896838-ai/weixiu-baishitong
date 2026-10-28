import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["01-overview-architecture.md","02-system-prompt.md","03-scenarios.md","04-rag-tools-output.md","05-safety-eval-engineering.md","06-examples-appendix.md","07-agent-collaboration.md"];
const expected = {
  "01-overview-architecture.md": ["# 1 项目与提示词工程概述","# 2 提示词体系总体架构"],
  "02-system-prompt.md": ["# 3 全局系统提示词"],
  "03-scenarios.md": ["# 4 核心场景提示词"],
  "04-rag-tools-output.md": ["# 5 检索增强生成提示词","# 6 工具调用与 Agent 编排","# 7 结构化输出与格式约束"],
  "05-safety-eval-engineering.md": ["# 8 提示词安全与风险控制","# 9 评估、测试与持续迭代","# 10 工程实现与运维"],
  "06-examples-appendix.md": ["# 11 场景示例库","# 12 附录"],
  "07-agent-collaboration.md": ["# 13 智能体协作与提示词自迭代生产"],
};
const errs = [];
for (const f of files) {
  const text = readFileSync(join(ROOT, "docs/draft", f), "utf8");
  const lines = text.split(/\r?\n/);
  let inFence = false, fenceAt = 0, json = null;
  const h1 = [];
  const jsonBlocks = [];
  lines.forEach((line, i) => {
    if (/^\s*\x60{3,}/.test(line)) {
      if (!inFence) { inFence = true; fenceAt = i + 1; if (/^\s*\x60{3}json\s*$/.test(line)) json = []; }
      else { inFence = false; if (json) { jsonBlocks.push({ at: fenceAt, body: json.join("\n") }); json = null; } }
      return;
    }
    if (inFence) { if (json) json.push(line); return; }
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (m && m[1].length === 1) h1.push("# " + m[2]);
  });
  if (inFence) errs.push(f + ": 围栏未闭合 @" + fenceAt);
  for (const w of expected[f]) if (!h1.includes(w)) errs.push(f + ": 缺标题 " + w);
  h1.filter((h) => !expected[f].includes(h)).forEach((h) => errs.push(f + ": 多余标题 " + h));
  for (const b of jsonBlocks) { try { JSON.parse(b.body); } catch (e) { errs.push(f + ": JSON 失败 @" + b.at + " " + e.message.slice(0, 60)); } }
  // 表格列数一致性
  inFence = false; let hdr = null;
  lines.forEach((line, i) => {
    if (/^\s*\x60{3,}/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(/^\|(.+)\|\s*$/);
    if (!m) { hdr = null; return; }
    const cells = m[1].split("|").map((x) => x.trim());
    if (!hdr) { hdr = cells.length; return; }
    if (/^-+$/.test(cells[0].replace(/:/g, "")) || cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
    if (cells.length !== hdr) errs.push(f + ":" + (i + 1) + " 表格列数 " + cells.length + "≠" + hdr);
  });
  console.log(f + ": json=" + jsonBlocks.length + " H1=" + h1.length);
}
if (errs.length) { console.log("ERRORS " + errs.length); errs.forEach((e) => console.log(" - " + e)); process.exitCode = 1; } else console.log("ALL CHECKS PASSED");
