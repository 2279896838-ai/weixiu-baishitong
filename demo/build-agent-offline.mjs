#!/usr/bin/env node
/**
 * 构建单文件「智能体问答」页面：node demo/build-agent-offline.mjs
 * 产物：deliverables/维修百事通-智能体问答.html（双击即用，无需服务、无需联网）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEMO_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEMO_DIR, '..');
const STATIC_DIR = path.join(DEMO_DIR, 'static');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'deliverables');
const OUT_FILE = path.join(OUT_DIR, '维修百事通-智能体问答.html');

function readText(file) { return fs.readFileSync(file, 'utf8'); }
function readJSON(file) { return JSON.parse(readText(file)); }
function readJSONL(file) {
  return readText(file).split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error('JSONL 解析失败：' + file + ' 第 ' + (index + 1) + ' 行：' + error.message); }
  });
}
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function inlineScript(code, id) {
  if (/<\/script/i.test(code) || code.indexOf('<!--') !== -1) {
    throw new Error('脚本 ' + id + ' 含不可安全内联的序列。');
  }
  return '<script id="' + id + '">\n' + code + '\n</script>';
}
function main() {
  const data = {
    meta: { app: '维修百事通', file: path.basename(OUT_FILE), mode: 'agent-offline-single-file', generatedAt: new Date().toISOString() },
    equipment: readJSON(path.join(DATA_DIR, 'equipment.json')),
    knowledge: readJSONL(path.join(DATA_DIR, 'knowledge.jsonl')),
    checklists: readJSON(path.join(DATA_DIR, 'checklists.json')),
    trees: readJSON(path.join(DATA_DIR, 'trees.json'))
  };
  const css = readText(path.join(STATIC_DIR, 'agent.css'));
  const shim = readText(path.join(STATIC_DIR, 'offline-shim.js'));
  const script = readText(path.join(STATIC_DIR, 'agent.js'));
  let html = readText(path.join(STATIC_DIR, 'agent.html'));

  if (/<\/style/i.test(css)) { throw new Error('agent.css 含 </style，无法内联。'); }
  html = html.replace(/<link[^>]*href="\/static\/agent\.css"[^>]*>/i, '<style id="wxbst-agent-style">\n' + css + '\n</style>');
  html = html.replace(
    /<script[^>]*src="\/static\/agent\.js"[^>]*><\/script>/i,
    '<script id="wxbst-data" type="application/json">' + jsonForScript(data) + '</script>\n' +
    inlineScript(shim, 'wxbst-offline-shim') + '\n' + inlineScript(script, 'wxbst-agent-app')
  );
  html = html.replace('<title>维修百事通 · 智能体问答</title>', '<title>维修百事通 · 智能体问答（离线版）</title>');
  html = html.replace('<a class="console-link" href="/">', '<a class="console-link" href="./维修百事通-离线演示.html">');
  html = html.replace('</head>', '  <meta name="wxbst-build" content="agent-offline-single-file" />\n</head>');

  const asserts = ['id="wxbst-data"', '__WXBST_OFFLINE_SHIM__', 'id="chatInput"', '智能体能力', '工具调用'];
  asserts.forEach((token) => { if (html.indexOf(token) === -1) { throw new Error('产物缺少：' + token); } });
  if (/(?:src|href)\s*=\s*["']\/static\//i.test(html)) { throw new Error('产物仍引用 /static 资源。'); }
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) { throw new Error('产物含外部资源。'); }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  const sha = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16).toUpperCase();
  console.log('智能体问答单文件构建完成');
  console.log('输出：' + OUT_FILE);
  console.log('大小：' + (bytes / 1024).toFixed(1) + ' KB');
  console.log('SHA256：' + sha + '…');
  console.log('数据：设备 ' + data.equipment.length + ' / 知识 ' + data.knowledge.length + ' / 树 ' + Object.keys(data.trees).length);
}
main();
