import { readFileSync, writeFileSync } from "node:fs";
const src = process.argv[2], dst = process.argv[3];
let md = readFileSync(src, "utf8");
const start = md.indexOf("\n# 目录\n");
if (start < 0) { console.error("TOC section not found"); process.exit(1); }
const ch1 = md.indexOf("\n# 1 项目与提示词工程概述", start);
if (ch1 < 0) { console.error("chapter 1 not found"); process.exit(1); }
md = md.slice(0, start) + md.slice(ch1);
writeFileSync(dst, md, "utf8");
console.log("wrote", dst, md.length);
