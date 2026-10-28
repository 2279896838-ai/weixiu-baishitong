import { readFileSync } from "node:fs";
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/count-chars.mjs <file> [file2 ...]");
  process.exit(1);
}
let tCjk = 0, tLatin = 0, tChars = 0;
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z0-9]+(?:['\u2019\-][A-Za-z0-9]+)*/g) || []).length;
  const wordLike = cjk + latin;
  tCjk += cjk; tLatin += latin; tChars += s.length;
  console.log(`${f}  CJK=${cjk}  LatinWords=${latin}  WordLike=${wordLike}  chars=${s.length}`);
}
if (files.length > 1) {
  console.log(`TOTAL  CJK=${tCjk}  LatinWords=${tLatin}  WordLike=${tCjk + tLatin}  chars=${tChars}`);
}
