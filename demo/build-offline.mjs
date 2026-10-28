#!/usr/bin/env node
/**
 * 维修百事通 · 单文件离线演示构建脚本
 * 用法：node demo/build-offline.mjs
 * 产物：deliverables/维修百事通-离线演示.html（双击即可运行，无需服务、无需联网）
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
const OUT_FILE = path.join(OUT_DIR, '维修百事通-离线演示.html');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJSONFile(filePath) {
  return JSON.parse(readText(filePath));
}

function readJSONL(filePath) {
  const rows = [];
  const lines = readText(filePath).split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) { return; }
    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error('JSONL 解析失败：' + filePath + ' 第 ' + (index + 1) + ' 行：' + error.message);
    }
  });
  return rows;
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function inlineScript(code, id) {
  if (/<\/script/i.test(code) || code.indexOf('<!--') !== -1) {
    throw new Error('脚本 ' + id + ' 含不可安全内联的序列（</script 或 <!--），请先清理。');
  }
  return '<script id="' + id + '">\n' + code + '\n</script>';
}

function countChecklistItems(checklists) {
  let total = 0;
  Object.keys(checklists).forEach((category) => {
    const byFrequency = checklists[category] || {};
    Object.keys(byFrequency).forEach((frequency) => {
      if (Array.isArray(byFrequency[frequency])) { total += byFrequency[frequency].length; }
    });
  });
  return total;
}

function main() {
  const htmlPath = path.join(STATIC_DIR, 'index.html');
  const cssPath = path.join(STATIC_DIR, 'style.css');
  const appPath = path.join(STATIC_DIR, 'app.js');
  const shimPath = path.join(STATIC_DIR, 'offline-shim.js');

  const equipment = readJSONFile(path.join(DATA_DIR, 'equipment.json'));
  const knowledge = readJSONL(path.join(DATA_DIR, 'knowledge.jsonl'));
  const checklists = readJSONFile(path.join(DATA_DIR, 'checklists.json'));
  const trees = readJSONFile(path.join(DATA_DIR, 'trees.json'));
  const css = readText(cssPath);
  const app = readText(appPath);
  const shim = readText(shimPath);
  let html = readText(htmlPath);

  if (!equipment.length || !knowledge.length || !Object.keys(checklists).length || !Object.keys(trees).length) {
    throw new Error('数据包不完整：设备/知识/点检/决策树不能为空。');
  }
  if (/<\/style/i.test(css)) { throw new Error('style.css 含 </style，无法内联。'); }

  const data = {
    meta: {
      app: '维修百事通',
      file: path.basename(OUT_FILE),
      version: '1.0.0',
      mode: 'offline-single-file',
      generatedAt: new Date().toISOString(),
      source: 'data/equipment.json, data/knowledge.jsonl, data/checklists.json, data/trees.json'
    },
    equipment,
    knowledge,
    checklists,
    trees
  };

  const appReplacements = [
    ['无法连接后端服务，请确认 demo/server.py 已启动（默认端口 8787）。', '离线知识库暂时不可用，请刷新页面重试。'],
    [' 请确认已在项目根目录运行 python demo/server.py --port 8787。', ''],
    ['无法连接后端服务', '离线数据加载失败']
  ];
  let patchedApp = app;
  appReplacements.forEach(([from, to]) => {
    patchedApp = patchedApp.split(from).join(to);
  });
  if (/server\.py|8787/.test(patchedApp)) {
    throw new Error('app.js 中仍存在服务版提示（server.py/8787），请检查替换规则。');
  }

  const dataScript = '<script id="wxbst-data" type="application/json">' + jsonForScript(data) + '</script>';
  const shimScript = inlineScript(shim, 'wxbst-offline-shim');
  const appScript = inlineScript(patchedApp, 'wxbst-app');

  const cssLinkPattern = /<link[^>]*href="\/static\/style\.css"[^>]*>/i;
  const appScriptPattern = /<script[^>]*src="\/static\/app\.js"[^>]*><\/script>/i;
  if (!cssLinkPattern.test(html)) { throw new Error('index.html 中未找到 style.css 引用。'); }
  if (!appScriptPattern.test(html)) { throw new Error('index.html 中未找到 app.js 引用。'); }

  const offlineCss = css + '\n\n/* ===== build-offline 注入：单文件离线演示 ===== */\n#globalAlert { display: none !important; }\n';
  html = html.replace(cssLinkPattern, '<style id="wxbst-style">\n' + offlineCss + '\n</style>');
  html = html.replace(appScriptPattern, dataScript + '\n' + shimScript + '\n' + appScript);

  const agentFile = path.join(OUT_DIR, '维修百事通-智能体问答.html');
  if (!fs.existsSync(agentFile)) {
    throw new Error('缺少智能体单文件，请先运行 node demo/build-agent-offline.mjs 再构建主离线演示。');
  }
  let agentHtml = fs.readFileSync(agentFile, 'utf8');
  agentHtml = agentHtml.replace(/<a class="console-link"[^>]*>返回控制台<\/a>/, '');
  agentHtml = agentHtml.replace('</head>', '<style>.agent-header{display:none !important}.agent-footer{display:none !important}.agent-layout{margin-top:12px}</style></head>');
  const agentBase64 = Buffer.from(agentHtml, 'utf8').toString('base64');
  const agentEmbed = '<iframe id="agentFrame" title="智能体问答"></iframe>\n' +
    '<script id="wxbst-agent-source" type="text/plain">' + agentBase64 + '</script>\n' +
    '<script>(function(){var node=document.getElementById("wxbst-agent-source");var bin=atob(node.textContent.trim());var bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){bytes[i]=bin.charCodeAt(i);}var html=new TextDecoder("utf-8").decode(bytes);document.getElementById("agentFrame").srcdoc=html;})();</script>';
  if (!html.includes('id="agentFrame"')) { throw new Error('index.html 缺少智能体内嵌容器。'); }
  html = html.replace(/<iframe id="agentFrame"[^>]*><\/iframe>/, agentEmbed);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>维修百事通 · 设备故障诊断助手（离线演示）</title>');
  html = html.replace('href="/agent"', 'href="./维修百事通-智能体问答.html"');
  html = html.replace('</head>', '  <meta name="wxbst-build" content="offline-single-file" />\n</head>');
  html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- 由 demo/build-offline.mjs 生成：单文件离线演示，内含数据与离线 API 垫片。 -->');

  const mustContain = [
    'id="wxbst-data"',
    '__WXBST_OFFLINE_SHIM__',
    'id="chatInput"',
    'data-tab="qa"',
    'data-tab="checklist"',
    'data-tab="dashboard"',
    'data-tab="workorders"',
    '故障问答',
    '点检填报',
    '异常看板',
    '工单管理'
  ];
  mustContain.forEach((token) => {
    if (html.indexOf(token) === -1) { throw new Error('产物缺少关键内容：' + token); }
  });
  if (/(?:src|href)\s*=\s*["']\/(?:static|api)\//i.test(html)) {
    throw new Error('产物仍引用 /static 或 /api 相对资源。');
  }
  if (/(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) {
    throw new Error('产物含外部 http(s) 资源引用。');
  }
  if (/@import\s+url\(/i.test(html)) { throw new Error('产物 CSS 含外部 @import。'); }
  if (html.indexOf('python demo/server.py') !== -1 || html.indexOf('请确认已在项目根目录运行') !== -1 || html.indexOf('默认端口 8787') !== -1) {
    throw new Error('产物仍残留服务版提示。');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');

  const bytes = Buffer.byteLength(html, 'utf8');
  const sha = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16).toUpperCase();
  const fileUrl = 'file:///' + OUT_FILE.replace(/\\/g, '/');

  console.log('============================================================');
  console.log('维修百事通 · 单文件离线演示构建完成');
  console.log('数据：设备 ' + equipment.length + ' 台，知识 ' + knowledge.length + ' 条，点检 ' +
    countChecklistItems(checklists) + ' 项，决策树 ' + Object.keys(trees).length + ' 棵');
  console.log('输出：' + OUT_FILE);
  console.log('大小：' + (bytes / 1024).toFixed(1) + ' KB');
  console.log('SHA256：' + sha + '…');
  console.log('打开：' + fileUrl);
  console.log('提示：双击 HTML 即可使用；点检/看板/工单数据保存在浏览器 localStorage。');
  console.log('============================================================');
}

main();
