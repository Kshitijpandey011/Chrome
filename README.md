# Simple Remote Chrome

A minimal Chrome-style browser UI backed by real headless Chromium on Render.

## NoVNC / desktop components removed

This version does not use noVNC, Xvfb, Fluxbox, x11vnc or a Linux desktop.
Chromium runs headlessly. The page is rendered remotely and sent to the UI as JPEG frames. Mouse clicks, scrolling and keyboard input are forwarded to Playwright.

## Deploy on Render

1. Upload the contents of this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and connect the repository.
3. Set `BROWSER_PASSWORD` to a long, unique password.
4. Deploy. Render builds the Docker image and starts Chromium.
5. Open the Render URL and enter the same password.

Alternatively create a Web Service with Docker runtime and health check path `/health`.

## Important limitations

- This is a simple remote browser, not the Google Chrome application itself. It uses Chromium's rendering engine and a Chrome-inspired interface.
- The remote page is streamed as periodic screenshots. It is not native video streaming; animations may look less smooth than local Chrome.
- Keyboard and pointer input are forwarded to the remote page. Some complex gestures, file uploads, downloads, popups and browser permission prompts are not implemented.
- One shared browser session is used. This is intended for one personal user, not multiple concurrent users.
- Browser profile is temporary in `/tmp`; sessions and logins may disappear after restarts.
- Render free services can spin down and have limited RAM/CPU. Chromium may be slow or exceed the free instance's memory. Upgrade the instance if it repeatedly restarts.
- The password protects the UI, API and WebSocket. Do not set `ALLOW_PUBLIC_ACCESS=true`.

## Local Docker test

```bash
docker build -t simple-remote-chrome .
docker run --rm -p 10000:10000 -e BROWSER_PASSWORD='choose-a-long-password' simple-remote-chrome
```

Open `http://localhost:10000`.
