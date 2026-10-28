import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = process.env.EMBED_URL || "http://127.0.0.1:8895/";
const SHOT = process.env.EMBED_SHOT || "templates/embed-shot.png";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wxbst-embed-"));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--hide-scrollbars","--window-size=1440,1000","--allow-file-access-from-files","--remote-debugging-port=9338","--user-data-dir=" + profile,"about:blank"], { stdio: "ignore" });
let ws = null; const fails = [];
function check(name, cond, detail) { console.log((cond?"PASS ":"FAIL ")+name+(detail===undefined?"":" :: "+JSON.stringify(detail))); if(!cond) fails.push(name); }
try {
  for (let i=0;i<80;i++){ try { const r=await fetch("http://127.0.0.1:9338/json/version"); if(r.ok) break; } catch{} await sleep(300); }
  const page=(await (await fetch("http://127.0.0.1:9338/json/list")).json()).find(t=>t.type==="page");
  ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map();
  ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:APP}); await sleep(4000);
  const evaluate=async (expr)=>{const r=await send("Runtime.evaluate",{expression:expr,awaitPromise:true,returnByValue:true});return r.result&&r.result.value;};
  check("agent tab", await evaluate("!!document.getElementById('tabBtn-qa')"));
  await evaluate("document.getElementById('tabBtn-qa').click()");
  await sleep(4500);
  check("iframe exists", await evaluate("!!document.getElementById('agentFrame')"));
  const docInfo = await evaluate("(function(){try{var f=document.getElementById('agentFrame');var d=f.contentDocument;return d?{title:d.title,eq:(d.getElementById('equipmentSelect')||{}).options?d.getElementById('equipmentSelect').options.length:-1,tools:d.body.innerText.indexOf('智能体能力')!==-1}:'no-doc';}catch(e){return 'ERR:'+e.message}})()");
  console.log("docInfo", JSON.stringify(docInfo));
  check("iframe agent loaded", docInfo && docInfo !== "no-doc" && (typeof docInfo === "string" ? false : docInfo.tools === true && docInfo.eq === 16), docInfo);
  if (docInfo && typeof docInfo === "object") {
    await evaluate("(function(){var d=document.getElementById('agentFrame').contentDocument;var i=d.getElementById('chatInput');i.value='连铸机结晶器液面老是波动，铸坯表面都乱了，什么原因？';i.dispatchEvent(new Event('input',{bubbles:true}));d.getElementById('chatForm').requestSubmit();return true})()");
    await sleep(6500);
    const text = await evaluate("document.getElementById('agentFrame').contentDocument.body.innerText");
    check("iframe agent answer", text.indexOf("可能原因") !== -1, text.slice(0,120));
  }
  const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  fs.mkdirSync(path.dirname(SHOT),{recursive:true}); fs.writeFileSync(SHOT, Buffer.from(shot.data,"base64"));
  console.log("shot", SHOT, fs.statSync(SHOT).size);
  console.log(fails.length ? "\n"+fails.length+" FAILED: "+fails.join(", ") : "\nALL EMBED CHECKS PASSED");
} finally { try{if(ws)ws.close();}catch{}; chrome.kill(); await sleep(300); try{fs.rmSync(profile,{recursive:true,force:true});}catch{} }
process.exit(fails.length?1:0);
