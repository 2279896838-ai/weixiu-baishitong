import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CPORT = 9333;
const APP = "http://127.0.0.1:8893/";
const OUT = "design/images";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, tries = 80, interval = 400) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(interval);
  }
  return false;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wxbst-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--window-size=1440,1000", "--force-device-scale-factor=1",
  "--remote-debugging-port=" + CPORT, "--user-data-dir=" + profile, "about:blank",
], { stdio: "ignore" });

let ws = null;
try {
  if (!(await waitFor("http://127.0.0.1:" + CPORT + "/json/version"))) throw new Error("chrome not ready");
  let targets = await (await fetch("http://127.0.0.1:" + CPORT + "/json/list")).json();
  let page = targets.find((t) => t.type === "page");
  if (!page) {
    page = await (await fetch("http://127.0.0.1:" + CPORT + "/json/new?" + encodeURIComponent(APP), { method: "PUT" })).json();
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: APP });
  await sleep(4000);
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const buf = Buffer.from(r.data, "base64");
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log("shot", name, buf.length);
  };

  const probe = async (label) => {
    const r = await evaluate("fetch('/api/health',{cache:'no-store'}).then(function(x){return x.status}).catch(function(e){return 'ERR:'+e.message})");
    console.log("probe", label, r);
  };
  await probe("after-load");
  const title = await evaluate("document.title");
  const tabs = await evaluate("Array.from(document.querySelectorAll('.tab')).map(function(b){return b.textContent.trim()})");
  console.log("title:", title, "tabs:", JSON.stringify(tabs));

  // 1) 问答（先选中连铸机，保证右侧设备卡一致）
  await evaluate("(()=>{var s=document.getElementById('equipmentSelect');if(!s)return 'no-select';var idx=-1;for(var i=0;i<s.options.length;i++){if(s.options[i].value==='EQ-MT01-0001'){idx=i;break;}}if(idx>=0){s.selectedIndex=idx;s.dispatchEvent(new Event('change',{bubbles:true}));}return idx})()");
  await sleep(1200);
  await evaluate("(()=>{var i=document.getElementById('chatInput');i.value='连铸机结晶器液面老是波动，铸坯表面都乱了，什么原因？';i.dispatchEvent(new Event('input',{bubbles:true}));var b=document.getElementById('sendBtn');if(b){b.click();return 'clicked'}return 'nobtn'})()");
  await sleep(8000);
  await evaluate("(()=>{var b=document.getElementById('chatBody');if(b){b.scrollTop=0;}return true})()");
  await sleep(300);
  await shot("ui-qa.png");

  // 2) 点检
  await evaluate("document.getElementById('tabBtn-checklist').click()");
  await sleep(1500);
  await probe("before-checklist");
  await evaluate("(()=>{var s=document.getElementById('checkEquipment');var idx=-1;for(var i=0;i<s.options.length;i++){if(s.options[i].value==='EQ-MT01-0001'){idx=i;break;}}if(idx>=0)s.selectedIndex=idx;s.dispatchEvent(new Event('change',{bubbles:true}));var f=document.getElementById('checkFrequency');f.value='D';f.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('generateChecklistBtn').click();return true})()");
  await sleep(4000);
  await shot("ui-checklist.png");

  // 2.5) 追加冶金演示数据
  const seed = async (code, note, sev) => {
    const js = "fetch('/api/checklists/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipmentCode:'" + code + "',frequency:'D'})}).then(function(r){return r.json()}).then(function(cl){var items=cl.items.map(function(it,i){return {code:it.code,result:i===0?'ABNORMAL':'OK',note:i===0?'" + note + "':''};});if(items[0]){items[0].severity='" + sev + "';}return fetch('/api/checklists/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checklist:cl,items:items,operator:'实训学生'})}).then(function(r){return r.json()}).then(function(s){var a=(s.anomalies||[])[0];if(a){return fetch('/api/workorders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({anomalyId:a.anomalyId,note:'冶金演示数据',operator:'teacher'})}).then(function(r){return r.status}).catch(function(){return 0});}return 0;}).catch(function(){return 0;});}).catch(function(){return 0;})";
    const r = await evaluate(js);
    console.log("seed", code, r);
  };
  await seed("EQ-MT01-0001", "结晶器液面波动，保护渣结块", "HIGH");
  await seed("EQ-MT03-0003", "F3 轧机振动超标，板面振痕", "HIGH");
  await seed("EQ-MT04-0004", "除尘风机轴承温度 82 ℃", "MEDIUM");

  // 3) 看板
  await evaluate("document.getElementById('tabBtn-dashboard').click()");
  await sleep(2500);
  await shot("ui-dashboard.png");

  // 4) 工单
  await evaluate("document.getElementById('tabBtn-workorders').click()");
  await sleep(2500);
  await shot("ui-workorders.png");

  console.log("done");
} finally {
  try { if (ws) ws.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
