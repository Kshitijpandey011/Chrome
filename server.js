const express = require("express");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright-core");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const PORT = Number(process.env.PORT || 10000);
const PASSWORD = process.env.BROWSER_PASSWORD;
const WIDTH = 1280;
const HEIGHT = 720;

let browser;
let context;
let pages = [];
let activePage = null;
let launching = null;

app.use(express.json({ limit: "100kb" }));

function authorized(req) {
  if (!PASSWORD) return process.env.ALLOW_PUBLIC_ACCESS === "true";
  const header = req.headers.authorization || "";
  return header === `Bearer ${PASSWORD}` || req.query.token === PASSWORD;
}

function requireAuth(req, res, next) {
  if (!authorized(req)) return res.status(401).json({ error: "Access denied" });
  next();
}

async function ensureBrowser() {
  if (browser && browser.isConnected()) return;
  if (launching) return launching;
  launching = (async () => {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--disable-background-networking",
        "--disable-features=Translate,BackForwardCache"
      ]
    });
    context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: false
    });
    const page = await context.newPage();
    pages = [page];
    activePage = page;
    browser.on("disconnected", () => {
      browser = null; context = null; pages = []; activePage = null;
    });
  })();
  try { await launching; } finally { launching = null; }
}

function cleanUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) throw new Error("Enter a website address");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    value = value.includes(".") && !value.includes(" ") ? "https://" + value : "https://www.google.com/search?q=" + encodeURIComponent(value);
  }
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS websites are supported");
  return parsed.toString();
}

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.get("/api/state", requireAuth, async (_req, res) => {
  try {
    await ensureBrowser();
    res.json({
      tabs: pages.map((p, i) => ({ id: i, title: p.isClosed() ? "New Tab" : (p.url() === "about:blank" ? "New Tab" : p.url()) })),
      active: pages.indexOf(activePage),
      url: activePage && !activePage.isClosed() ? activePage.url() : "about:blank"
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/:action", requireAuth, async (req, res) => {
  try {
    await ensureBrowser();
    const action = req.params.action;
    const data = req.body || {};
    if (!activePage || activePage.isClosed()) activePage = await context.newPage();

    if (action === "navigate") {
      await activePage.goto(cleanUrl(data.url), { waitUntil: "domcontentloaded", timeout: 45000 });
    } else if (action === "back") {
      await activePage.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    } else if (action === "forward") {
      await activePage.goForward({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    } else if (action === "reload") {
      await activePage.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    } else if (action === "new-tab") {
      const p = await context.newPage();
      await p.setViewportSize({ width: WIDTH, height: HEIGHT });
      pages.push(p); activePage = p;
    } else if (action === "switch-tab") {
      const index = Number(data.index);
      if (Number.isInteger(index) && pages[index] && !pages[index].isClosed()) activePage = pages[index];
    } else if (action === "close-tab") {
      if (pages.length > 1) {
        const index = pages.indexOf(activePage);
        await activePage.close();
        pages = pages.filter(p => !p.isClosed());
        activePage = pages[Math.max(0, index - 1)] || pages[0];
      } else {
        await activePage.goto("about:blank");
      }
    } else if (action === "input") {
      const msg = data;
      if (msg.type === "click") await activePage.mouse.click(msg.x, msg.y, { button: msg.button || "left" });
      else if (msg.type === "move") await activePage.mouse.move(msg.x, msg.y);
      else if (msg.type === "wheel") await activePage.mouse.wheel(msg.dx || 0, msg.dy || 0);
      else if (msg.type === "keydown") await activePage.keyboard.down(msg.key);
      else if (msg.type === "keyup") await activePage.keyboard.up(msg.key);
      else if (msg.type === "type") await activePage.keyboard.insertText(String(msg.text || ""));
      else if (msg.type === "keypress") await activePage.keyboard.press(msg.key);
    } else {
      return res.status(404).json({ error: "Unknown action" });
    }
    res.json({ ok: true, url: activePage && !activePage.isClosed() ? activePage.url() : "about:blank" });
  } catch (e) {
    res.status(400).json({ error: e.message || "Browser action failed" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/stream") return socket.destroy();
  const token = url.searchParams.get("token") || "";
  if (PASSWORD ? token !== PASSWORD : process.env.ALLOW_PUBLIC_ACCESS !== "true") return socket.destroy();

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit("connection", ws);
  });
});

wss.on("connection", async ws => {
  try {
    await ensureBrowser();
    let running = true;
    const sendFrame = async () => {
      if (!running || ws.readyState !== WebSocket.OPEN) return;
      try {
        if (!activePage || activePage.isClosed()) activePage = await context.newPage();
        const image = await activePage.screenshot({ type: "jpeg", quality: 62, scale: "css", timeout: 8000 });
        if (ws.readyState === WebSocket.OPEN) ws.send(image, { binary: true });
      } catch (_) {}
    };
    const timer = setInterval(sendFrame, 650);
    sendFrame();
    ws.on("close", () => { running = false; clearInterval(timer); });
    ws.on("message", async raw => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch (_) {}
    });
  } catch (e) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ error: e.message }));
    ws.close();
  }
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`Simple Remote Chrome listening on ${PORT}`);
  try { await ensureBrowser(); console.log("Headless Chromium started"); }
  catch (e) { console.error("Chromium startup failed:", e); }
});
