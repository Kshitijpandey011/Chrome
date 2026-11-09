# Personal Remote Chrome

A minimal remote Chromium browser that runs in a Docker container on Render and is viewed from your normal browser.

## What it includes

- Chromium running remotely in a virtual desktop
- noVNC display embedded in a simple browser page
- Address bar, Back, Forward and Reload controls
- Temporary browser profile (no persistent disk required)
- A shared access password to protect the public Render URL

## Deploy to Render

1. Create a new GitHub repository and upload the contents of this folder.
2. In Render, choose **New → Blueprint** and connect the repository, or create a **Web Service** using the Docker runtime.
3. If using a Blueprint, Render reads `render.yaml`. Otherwise:
   - Runtime: Docker
   - Health check path: `/health`
   - Environment variable: `BROWSER_PASSWORD` = choose a long, unique password
4. Deploy and wait for the service to become live.
5. Open the Render URL and enter the same `BROWSER_PASSWORD`.

Do not leave `BROWSER_PASSWORD` unset. The app intentionally refuses unauthenticated access unless `ALLOW_PUBLIC_ACCESS=true` is explicitly set (not recommended).

## Notes and limitations

- Render's free service can spin down after inactivity. The first visit after sleeping may take time.
- Free instances have limited RAM/CPU. Chromium may be slow or may exceed the available memory. If that happens, use a paid instance with more memory.
- Browser data is stored under `/tmp/chrome-profile`, so it is temporary and may be lost when the service restarts or is redeployed.
- This is a single-user personal tool, not a hardened multi-tenant browser service.
- The shared password protects the page, API and display WebSocket. Use HTTPS (Render provides it) and keep the password private.
- Some websites may block data-center IP addresses, remote sessions, or automated browser environments.
- Downloads and clipboard integration are not implemented in this minimal version.

## Local testing

You need Docker installed.

```bash
docker build -t personal-remote-chrome .
docker run --rm -p 10000:10000 \
  -e BROWSER_PASSWORD='replace-with-a-long-password' \
  personal-remote-chrome
```

Then open `http://localhost:10000`.

## Troubleshooting

- **Service exits during startup:** check Render logs. Chromium plus a virtual desktop may need more memory than the free instance provides.
- **Black screen:** wait several seconds and refresh; check the `xvfb`, `x11vnc`, `websockify` and `chromium` logs in the container.
- **Cannot connect:** confirm `BROWSER_PASSWORD` is set and matches the password entered on the page.
