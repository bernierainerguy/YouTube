# Whiteley Events YT Grab

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

## Build a signed, notarised .dmg

Same flow as WESC — signing and notarisation happen **on the Mac**, not in CI:

```bash
npm run build:mac      # or double-click build-mac.command in Finder
```

It signs with the `Developer ID Application: Bernie Rainer-Guy (T57Q5FRCB6)` certificate from your login keychain, pinned by hash so an expired duplicate can't be picked by mistake, notarises the dmg through the `WESC_NOTARY` notarytool keychain profile (same Apple account, so nothing extra to set up), then staples and verifies with `spctl`. The result lands in `dist/`.

The script refuses to start if the certificate or notary profile is missing, rather than quietly producing something unshippable.

Overrides:

| Variable | Effect |
| --- | --- |
| `APPLE_SIGNING_IDENTITY_HASH` | Use a different Developer ID certificate |
| `APPLE_KEYCHAIN_PROFILE` | Use a different notarytool profile |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` (+ `APPLE_TEAM_ID`) | Notarise with credentials instead of a keychain profile |
| `YTGRAB_SKIP_NOTARIZE=1` | Sign, but skip notarisation |
| `YTGRAB_SKIP_MAC_SIGNING=1` | Unsigned local build |

### Signing in CI

`.github/workflows/build-macos.yml` produces the same signed, notarised dmg on a `macos-14` runner once these repository secrets exist (Settings → Secrets and variables → Actions):

| Secret | What it is |
| --- | --- |
| `APPLE_CERT_P12_BASE64` | Developer ID Application certificate **and private key**, exported from Keychain Access as `.p12`, then base64-encoded |
| `APPLE_CERT_PASSWORD` | The password you set on that `.p12` export |
| `APPLE_ID` | Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com (not the account password) |
| `APPLE_TEAM_ID` | `T57Q5FRCB6` |

To export the certificate:

```bash
# Keychain Access → My Certificates → right-click the Developer ID
# Application cert → Export → .p12, then:
base64 -i Certificates.p12 | pbcopy
```

The workflow imports the certificate into a throwaway keychain, builds, notarises through `notarytool`, staples and verifies with `spctl`, then deletes the keychain. Run it from Actions → *macOS release (arm64)* → Run workflow, or push a `v*` tag to also attach the dmg to a draft release.

**Without those secrets the workflow still runs but produces an UNSIGNED dmg** (it logs a warning and labels the artefact `unsigned`). Unsigned builds need the quarantine flag cleared before they will open:

```bash
xattr -dr com.apple.quarantine "/Applications/YT Grab.app"
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/main.js` | Main process: window, IPC, yt-dlp invocation and progress parsing |
| `src/binaries.js` | Fetches/updates the yt-dlp binary, resolves the bundled ffmpeg |
| `src/preload.js` | Context-isolated bridge to the renderer |
| `src/renderer/` | UI (HTML/CSS/JS, no framework) |

Security posture: `contextIsolation` on, `nodeIntegration` off, a strict CSP in the renderer, and external links open in the default browser.

## Registration and licence check-in

The app requires registration (name + email) before it will download anything, and checks in with the licence server on launch. This uses the **same protocol and endpoint as WESC**:

```
POST https://whiteleyevents.co.uk/welm-api.php?action=checkin
{ uuid, name, email, machine_name, app: "ytgrab", version }
```

- The server keys records on `uuid` alone and stores `app` alongside, so YT Grab installs sit beside WESC ones without colliding. **No server-side change was needed.**
- New records are created as `granted`. Flipping one to `denied` in WP Admin blocks that install at its next check-in.
- A successful check-in refreshes a **30-day local grace**. If the server is unreachable the cached grant is trusted until that expires, with a warning in the final 7 days — being offline should not lock someone out mid-use.
- If the very first check-in fails (offline install), the grace clock still starts, so the copy gets its 30 days rather than being dead on arrival.
- The download handler enforces this in the main process, not just by hiding the button.

State lives in `userData/licence-checkin.json`. Point `YTGRAB_LICENCE_SERVER` elsewhere to test against a staging site.

## Publishing to whiteleyevents.co.uk

```bash
cp .env.example .env     # add WELM_APP_USER / WELM_APP_PASSWORD
npm run upload dist/YT-Grab-*.dmg
```

This streams the dmg to the theme's software endpoint, which files it under `/uploads/whe-software/<product>/MAC/` and lists it on the Software page — the same route WESC uses.

**Prerequisite:** the product must exist first. In WP Admin → **Software → Products**, create an entry with the key `ytgrab`. The endpoint rejects anything it cannot match to a catalogue entry (`Could not match file to a software product`), and the same catalogue populates the public Software page.

Credentials are a WordPress **application password**, not the account password. `.env` is gitignored.

## Legal

**Only download videos you own or are licensed to download.** The app states this on first launch, requires acknowledgement before it will download anything, and keeps the notice visible in the main window.

Downloading content you have no right to may breach YouTube's Terms of Service and infringe copyright. Use this on your own uploads, on material you hold the rights to, or where the licence permits it. You are solely responsible for what you download and what you do with it.
