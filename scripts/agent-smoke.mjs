import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CPORT = 9336;
const APP = process.env.AGENT_URL || "http://127.0.0.1:8895/agent";
const SHOT = process.env.AGENT_SHOT || "templates/agent-shot.png";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url) {
  for (let i = 0; i < 80; i++) {
    try { const res = await fetch(url); if (res.ok) return true; } catch {}
    await sleep(300);
  }
  return false;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "wxbst-agent-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--window-size=1440,1000", "--allow-file-access-from-files",
  "--remote-debugging-port=" + CPORT, "--user-data-dir=" + profile, "about:blank"
], { stdio: "ignore" });

let ws = null;
const fails = [];
function check(name, cond, detail) {
  console.log((cond ? "PASS " : "FAIL ") + name + (detail === undefined ? "" : " :: " + JSON.stringify(detail)));
  if (!cond) fails.push(name);
}
try {
  if (!(await waitFor("http://127.0.0.1:" + CPORT + "/json/version"))) throw new Error("chrome not ready");
  const page = (await (await fetch("http://127.0.0.1:" + CPORT + "/json/list")).json()).find((t) => t.type === "page");
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
    const id = ++seq; pending.set(id, { resolve, reject });
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
  const bodyText = () => evaluate("document.body.innerText");
  const sendMessage = async (text) => {
    await evaluate("(()=>{var i=document.getElementById('chatInput');i.value=" + JSON.stringify(text) + ";i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('chatForm').requestSubmit();return true})()");
    await sleep(6000);
  };
  check("title", (await evaluate("document.title")).indexOf("智能体问答") !== -1, await evaluate("document.title"));
  check("tools panel", (await bodyText()).indexOf("智能体能力") !== -1);
  check("equipment loaded", (await evaluate("document.getElementById('equipmentSelect').options.length")) === 16, await evaluate("document.getElementById('equipmentSelect').options.length"));
  await evaluate("(()=>{var s=document.getElementById('equipmentSelect');s.value='EQ-MT01-0001';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()");

  await sendMessage("连铸机结晶器液面老是波动，铸坯表面都乱了，什么原因？");
  let text = await bodyText();
  check("metallurgy answer", text.indexOf("液面") !== -1 && text.indexOf("可能原因") !== -1);
  check("tool trace", text.indexOf("知识库诊断") !== -1);
  check("citations", text.indexOf("引用来源") !== -1);
  check("session used", (await evaluate("document.getElementById('toolCount').textContent")).indexOf("1") !== -1, await evaluate("document.getElementById('toolCount').textContent"));
  await evaluate("(()=>{var m=document.querySelector('.msg.assistant');if(m){m.scrollIntoView({block:'start'});}return true})()");
  await sleep(400);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  fs.writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
  console.log("shot", SHOT, fs.statSync(SHOT).size, "bytes");

  await sendMessage("板坯连铸机日点检要做哪些项目？");
  text = await bodyText();
  check("checklist tool", text.indexOf("点检清单") !== -1 && text.indexOf("CHK-CCM") !== -1);

  await sendMessage("连铸结晶器液面波动，带我一步步排查");
  text = await bodyText();
  check("guide tool", text.indexOf("排查引导") !== -1 && text.indexOf("安全确认") !== -1);
  const options = await evaluate("document.querySelectorAll('.guide-options button').length");
  check("guide options", options >= 2, options);
  if (options >= 2) {
    const first = await evaluate("document.querySelectorAll('.guide-options button')[1].textContent");
    await evaluate("document.querySelectorAll('.guide-options button')[1].click()");
    await sleep(5000);
    text = await bodyText();
    check("guide advanced", text.indexOf(first) === -1 || text.indexOf("当前主要现象") === -1, first);
  }

  await sendMessage("看一下异常看板");
  text = await bodyText();
  check("dashboard tool", text.indexOf("异常看板") !== -1 && text.indexOf("未闭环工单") !== -1);

  console.log(fails.length ? "\n" + fails.length + " FAILED: " + fails.join(", ") : "\nALL AGENT CHECKS PASSED");
} finally {
  try { if (ws) ws.close(); } catch {}
  chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(fails.length ? 1 : 0);
