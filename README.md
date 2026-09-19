# YT Grab

A small Electron app for macOS (Apple Silicon) that downloads a YouTube video as **MP4**, or just its audio as **MP3**.

![platform](https://img.shields.io/badge/macOS-arm64-black)

## What it does

- Paste a link, pick **Video · MP4** or **Audio · MP3**, hit Download.
- Resolution cap for video (best / 4K / 1440p / 1080p / 720p / 480p / 360p).
- Bitrate choice for MP3 (320 / 256 / 192 / 128 kbps), with thumbnail art and metadata embedded.
- Optional whole-playlist download.
- Live progress, speed and ETA; cancel mid-download.
- Files land in `~/Downloads/YT Grab` unless you pick another folder.

## How it works

- **yt-dlp** does the downloading. The app fetches the official `yt-dlp_macos` binary into its own app-support folder on first launch, so nothing needs installing by hand. *Help → Update yt-dlp* re-fetches the latest build when YouTube changes things.
- **ffmpeg** is bundled via `ffmpeg-static` and used to merge video+audio streams and to encode MP3.

## Run it

```bash
npm install
npm start
```

## Build a .dmg for Apple Silicon

```bash
npm run dist
```

The installer lands in `dist/`. The build is unsigned, so the first launch needs a right-click → **Open**, or:

```bash
xattr -dr com.apple.quarantine "/Applications/YT Grab.app"
```

To sign and notarise it yourself, set `CSC_LINK` / `CSC_KEY_PASSWORD` and the `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` environment variables before `npm run dist`; entitlements are already in `build/entitlements.mac.plist`.

**Note:** build on a Mac. `electron-builder` can't produce a macOS app from Linux or Windows — `hdiutil` and codesign are macOS-only.

## Build in CI instead

`.github/workflows/build-macos.yml` builds the arm64 dmg on a `macos-14` (Apple Silicon) runner, so you never need to run the build locally:

- **On demand** — Actions → *Build macOS (arm64)* → Run workflow. The dmg lands as a workflow artifact for 30 days.
- **On a tag** — push `v1.0.0` (or any `v*` tag) and the dmg is also attached to a **draft** release for you to publish.

CI builds unsigned (`CSC_IDENTITY_AUTO_DISCOVERY: false`). To sign and notarise there, add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, pass them into the build step's `env`, and drop the `CSC_IDENTITY_AUTO_DISCOVERY` line.

## Layout

| Path | Purpose |
| --- | --- |
| `src/main.js` | Main process: window, IPC, yt-dlp invocation and progress parsing |
| `src/binaries.js` | Fetches/updates the yt-dlp binary, resolves the bundled ffmpeg |
| `src/preload.js` | Context-isolated bridge to the renderer |
| `src/renderer/` | UI (HTML/CSS/JS, no framework) |

Security posture: `contextIsolation` on, `nodeIntegration` off, a strict CSP in the renderer, and external links open in the default browser.

## Legal

Downloading content from YouTube generally breaches its Terms of Service. Use this on your own uploads, on material you hold the rights to, or where the licence permits it. You are responsible for what you download.
