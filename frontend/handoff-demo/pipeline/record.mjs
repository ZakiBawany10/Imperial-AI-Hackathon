// Record the Ascend flow on a wall photo at iPhone size (content area between iOS status bar
// and Safari toolbar), with visible taps. Saves the screencast, event marks and /solve JSON.
// Usage: node record.mjs <photo> <outdir>
import puppeteer from "puppeteer-core";
import fs from "fs";
const [PHOTO, OUT] = process.argv.slice(2);
const W = 390, H = 659, DPR = 884 / 390;
const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--force-device-scale-factor=2.2667"],
});
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
let solveReq = null, solveRes = null, analyzeRes = null;
p.on("request", (r) => { if (r.url().endsWith("/solve") && r.method() === "POST") solveReq = r.postData(); });
p.on("response", async (r) => { if (r.url().endsWith("/analyze") && r.request().method() === "POST") analyzeRes = await r.text(); if (r.url().endsWith("/solve") && r.request().method() === "POST") solveRes = await r.text(); });
await p.setViewport({ width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: DPR });
await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
// touch indicator: a soft ring where each tap lands
await p.addStyleTag({ content: `.tapdot{position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
  background:rgba(36,62,54,.18);border:2px solid rgba(36,62,54,.45);pointer-events:none;animation:tapdot .55s ease-out forwards}
  @keyframes tapdot{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.25);opacity:0}}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let t0 = Date.now();
const marks = [];
const shot = (name) => p.screenshot({ path: `${OUT}/s-${name}.png` }).catch(() => {});
const mark = (name) => { setTimeout(() => shot(name), 500); marks.push({ name, t: (Date.now() - t0) / 1000, epoch: Date.now() / 1000 }); console.log(name, ((Date.now() - t0) / 1000).toFixed(1)); };
const ring = async (x, y) => {
  await p.evaluate((x, y) => { const d = document.createElement("div"); d.className = "tapdot"; d.style.left = x + "px"; d.style.top = y + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 700); }, x, y);
  await wait(140);
};
const tapAt = async (x, y) => {
  await p.evaluate((x, y) => { const d = document.createElement("div"); d.className = "tapdot"; d.style.left = x + "px"; d.style.top = y + "px"; document.body.appendChild(d); setTimeout(() => d.remove(), 700); }, x, y);
  await wait(120);
  await p.touchscreen.tap(x, y);
};
const tapSel = async (sel) => {
  const el = await p.waitForSelector(sel, { visible: true, timeout: 60000 });
  await el.scrollIntoView();
  const bx = await el.boundingBox();
  await ring(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await el.evaluate((e) => e.click());
};
const tapText = async (text) => {
  const h = await p.waitForFunction((t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().includes(t) && b.offsetParent), { timeout: 60000 }, text);
  const bx = await h.asElement().boundingBox();
  await ring(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await h.asElement().evaluate((e) => e.click());
};
const tapHold = async (id) => {
  const pt = await p.$eval(`[data-hold="h${id}"]`, (g, id) => {
    const r = g.getBoundingClientRect();
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      const hit = document.elementsFromPoint(x, y).map((e) => e.closest("[data-hold]")).find(Boolean);
      if (hit && hit.getAttribute("data-hold") === "h" + id) return { x, y };
    }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  await tapAt(pt.x, pt.y);
};

// full-resolution frames straight from DevTools, each with its timestamp
fs.mkdirSync(`${OUT}/frames`, { recursive: true });
const cdp = await p.createCDPSession();
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const f = `${OUT}/frames/${String(frames.length).padStart(5, "0")}.jpg`;
  fs.writeFileSync(f, Buffer.from(data, "base64"));
  frames.push({ f, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 2000, maxHeight: 3000, everyNthFrame: 1 });
const rec = { stop: async () => { await cdp.send("Page.stopScreencast"); fs.writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames)); } };
mark("start");
await wait(800);
await (await p.$$("input[type=file]"))[1].uploadFile(PHOTO);
mark("uploaded");
await p.waitForSelector('[data-name="screen/2-review"]', { timeout: 600000 });
mark("review");
await wait(1600);
await tapText("blue"); mark("colour");
const instr = () => p.$eval('[data-name="review/instruction"]', (e) => e.textContent);
const ctaText = () => p.$eval('[data-name="review/cta"]', (e) => e.textContent);
// let the auto-zoom onto the climb finish before aiming at a hold
let lastBox = "";
for (let i = 0; i < 20; i++) { await wait(250); const bx = JSON.stringify(await p.$eval('[data-hold="h38"]', (g) => { const r = g.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })); if (bx === lastBox) break; lastBox = bx; }
await wait(900);
for (let i = 0; i < 3 && !/top hold/.test(await instr()); i++) { await tapHold(38); await wait(900); }
mark("start-hold");
await wait(1200);
await tapSel('[data-name="review/cta"]'); mark("top");
await wait(1500);
await tapHold(34); await wait(1000);
const act = await p.$('[data-name="action/start"]');
if (act && await act.isIntersectingViewport()) { const bx = await act.boundingBox(); await ring(bx.x + bx.width / 2, bx.y + bx.height / 2); await act.evaluate((e) => e.click()); mark("second-start"); }
else { await p.screenshot({ path: `${OUT}/debug-34.png` }); console.log("no action sheet for 34"); }
await wait(1400);
console.log("cta:", await ctaText(), "|", await instr());
if (/Answer/.test(await ctaText())) {
  await tapSel('[data-name="review/cta"]'); mark("questions");
  for (let i = 0; i < 20; i++) {
    await wait(1000);
    const a = await p.$('[data-name="sheet/confirm-hold"] [data-name^="answer/"]');
    if (!a || !(await a.isIntersectingViewport())) break;
    const bx = await a.boundingBox();
    await ring(bx.x + bx.width / 2, bx.y + bx.height / 2);
    await a.evaluate((e) => e.click());
  }
  mark("answered");
}
console.log("cta:", await ctaText());
await wait(1200);
await tapSel('[data-name="review/cta"]'); mark("you");
await wait(2200);
await tapText("Solve route"); mark("solve");
await p.waitForFunction(() => document.querySelector('[data-name="screen/4-play"]') || document.querySelector('[data-name="solving/error"]'), { timeout: 120000 });
mark("play");
if (await p.$('[data-name="solving/error"]')) console.log("SOLVE ERROR", await p.$eval('[data-name="solving/error"]', (e) => e.textContent));
await wait(4500);
const play = await p.$('[aria-label="Play"]');
if (play) { const bx = await play.boundingBox(); await ring(bx.x + bx.width / 2, bx.y + bx.height / 2); await play.evaluate((e) => e.click()); mark("playing"); }
await wait(16000);
mark("end");
await rec.stop();
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 1));
if (solveReq) fs.writeFileSync(`${OUT}/solve_request.json`, solveReq);
if (analyzeRes) fs.writeFileSync(`${OUT}/analyze.json`, analyzeRes);
if (solveRes) fs.writeFileSync(`${OUT}/solve.json`, solveRes);
console.log("errors:", errs.slice(0, 5)); await wait(600);
await b.close();
