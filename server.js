const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 10000);
const PASSWORD = process.env.BROWSER_PASSWORD;

app.use(express.json({ limit: "20kb" }));

function authorized(req) {
  if (!PASSWORD) return process.env.ALLOW_PUBLIC_ACCESS === "true";
  const header = req.headers.authorization || "";
  const bearerOK = header === `Bearer ${PASSWORD}`;
  // The noVNC iframe cannot attach an Authorization header to its asset requests.
  // Its one-time page URL carries the same secret as a query parameter instead.
  const queryOK = req.query.token === PASSWORD;
  return bearerOK || queryOK;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Static noVNC assets contain no browser session data. The actual VNC WebSocket
// remains password-protected below, so the viewer can load without an auth header.
app.use("/novnc", express.static("/usr/share/novnc"));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/") return next();
  if (!authorized(req)) return res.status(401).json({ error: "Access denied" });
  next();
});

app.post("/api/:action", async (req, res) => {
  const action = req.params.action;
  const url = String(req.body?.url || "").trim();

  try {
    const response = await fetch("http://127.0.0.1:9222/json");
    const targets = await response.json();
    const pageTarget = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error("Chrome page is not ready");

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9);
      const onMessage = data => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off("message", onMessage);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        }
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        ws.off("message", onMessage);
        reject(new Error("Chrome command timed out"));
      }, 8000).unref();
    });

    if (action === "navigate") {
      if (!url) throw new Error("Enter a website address");
      let destination = url;
      if (!/^https?:\/\//i.test(destination)) destination = "https://" + destination;
      const parsed = new URL(destination);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS websites are supported");
      await command("Page.navigate", { url: parsed.toString() });
    } else if (action === "back" || action === "forward") {
      const history = await command("Page.getNavigationHistory");
      const current = history.currentIndex;
      const targetIndex = action === "back" ? current - 1 : current + 1;
      if (targetIndex >= 0 && targetIndex < history.entries.length) {
        await command("Page.navigateToHistoryEntry", { entryId: history.entries[targetIndex].id });
      }
    } else if (action === "reload") {
      await command("Page.reload", { ignoreCache: false });
    } else {
      throw new Error("Unknown browser action");
    }
    ws.close();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "Browser command failed" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

server.on("upgrade", (req, socket, head) => {
  const parsed = new URL(req.url, "http://localhost");
  if (parsed.pathname !== "/websockify") return socket.destroy();

  const token = parsed.searchParams.get("token") || "";
  if (PASSWORD && token !== PASSWORD) return socket.destroy();
  if (!PASSWORD && process.env.ALLOW_PUBLIC_ACCESS !== "true") return socket.destroy();

  const upstream = new WebSocket("ws://127.0.0.1:6080/websockify");
  upstream.on("open", () => {
    const downstream = new WebSocket.Server({ noServer: true });
    downstream.handleUpgrade(req, socket, head, client => {
      client.on("message", data => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data); });
      upstream.on("message", data => { if (client.readyState === WebSocket.OPEN) client.send(data); });
      client.on("close", () => upstream.close());
      upstream.on("close", () => client.close());
      client.on("error", () => upstream.close());
    });
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Personal remote browser listening on ${PORT}`);
});
