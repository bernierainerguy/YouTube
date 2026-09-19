# Whiteley Events YT Grab — Third-Party Licences

This application includes and uses third-party software. Their licence terms
are set out below and prevail over the YT Grab EULA in respect of those
components.

---

## FFmpeg — GNU General Public License v3.0 or later

**Whiteley Events YT Grab distributes an FFmpeg binary** (version **6.1.1**,
release tag `b6.1.1`, as packaged by the `ffmpeg-static` project). FFmpeg is
free software licensed under the GNU General Public License, version 3 or
later. The full licence text is included in the application bundle as
`ffmpeg.LICENSE`, inside
`Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/`.

FFmpeg is executed as a separate program, invoked over the command line. It
is not linked into, and forms no part of, the YT Grab application code.

### Written offer of source code

In accordance with sections 3 and 6 of the GPL, Whiteley Events Ltd offers,
**for a period of three years from the date you received this software**, to
provide on request the complete corresponding machine-readable source code
for the FFmpeg binary distributed with this application, together with the
build scripts used to produce it, for no more than our reasonable cost of
physically performing the distribution.

To request the source code, contact:

> **[CONTACT EMAIL]**
> Whiteley Events Ltd, [REGISTERED ADDRESS]

The same source is also available at no cost from:

- <https://ffmpeg.org/download.html>
- <https://github.com/eugeneware/ffmpeg-static> (the build used here)

You may modify and redistribute FFmpeg under the terms of the GPL. Nothing
in the YT Grab EULA restricts the rights the GPL grants you in respect of
FFmpeg.

---

## yt-dlp — The Unlicense (public domain)

YT Grab uses **yt-dlp** to retrieve media. yt-dlp is **not distributed with
this application**. On first launch the application downloads the official
`yt-dlp_macos` binary from the yt-dlp project's own release page into its
application-support folder, where it is used as a separate program invoked
over the command line.

yt-dlp is released into the public domain under The Unlicense.
Project: <https://github.com/yt-dlp/yt-dlp>

---

## Electron, Chromium and Node.js

The application is built on **Electron** (MIT Licence), which embeds
**Chromium** (BSD 3-Clause and others) and **Node.js** (MIT Licence). Their
full licence texts are included in the application bundle in
`Contents/Resources/`, and in the `LICENSE` and `LICENSES.chromium.html`
files alongside the application binary.

---

*Whiteley Events Ltd — [REGISTERED ADDRESS] — [CONTACT EMAIL]*
