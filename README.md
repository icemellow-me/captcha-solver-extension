# CaptchaSolver — Universal Chrome Extension

Auto-detect and solve **reCAPTCHA v2**, **Cloudflare Turnstile**, **hCaptcha**, and **image captchas** on any page using your own self-hosted AI solver servers.

## Features

- **reCAPTCHA v2** — Detects iframe + sitekey, solves via server, injects token via callback + textarea
- **Cloudflare Turnstile** — Detects widget, solves non-interactive and managed challenges
- **hCaptcha** — Detects iframe + sitekey, solves via hcaptcha-challenger + Gemini LLM
- **Image Captchas** — Extracts image, OCRs via ddddocr + Tesseract, fills nearest input
- **Canvas Captchas** — Captures canvas rendering, OCRs the result
- **Auto-solve mode** — Detects and solves captchas automatically on page load
- **Per-type toggles** — Enable/disable each captcha type independently
- **Visual feedback** — Floating badges show solve progress on page
- **Popup dashboard** — Server health, solve stats, per-captcha status, settings

## Architecture

```
┌─────────────────────┐     ┌───────────────────────────────┐
│  Chrome Extension   │────►│  Universal Solver  (port 8844) │
│  ┌───────────────┐  │     │  ddddocr + Tesseract +        │
│  │ content.js    │  │     │  hcaptcha-challenger +        │
│  │ (detection +  │  │     │  Puter Vision LLM             │
│  │  solving)     │  │     │  + upstream forwarder         │
│  ├───────────────┤  │     └───────────────────────────────┘
│  │ inject.js     │  │              │              │
│  │ (MAIN world   │  │     ┌────────┘              └────────┐
│  │  token inject)│  │     ▼                                ▼
│  ├───────────────┤  │  ┌────────────────┐   ┌──────────────────┐
│  │ background.js │  │  │ Turnstile :8822 │   │ reCAPTCHA :8833  │
│  │ (API routing) │  │  │ nodriver +      │   │ Playwright +      │
│  ├───────────────┤  │  │ camoufox (V2)    │   │ CaptchaPlugin     │
│  │ popup/        │  │  └────────────────┘   └──────────────────┘
│  │ (UI dashboard)│  │
│  └───────────────┘  │
└─────────────────────┘
```

The extension uses **separate solver instances** (ports 8844/8833/8822) that support `json=1` responses per the 2captcha API spec. Your original solvers (ports 8855/8866/8878) are untouched and use plain-text responses only.

## Install

1. Clone this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the `captcha-solver-extension` folder
5. Click the extension icon to configure your server URL and API key

## Settings

| Setting | Default | Description |
|---|---|---|
| Server URL | `http://23.22.196.74:8844` | Extension-specific Universal Solver endpoint |
| API Key | — | Your solver server API key |
| Auto-solve | On | Automatically solve detected captchas |
| Solve Delay | 500ms | Delay before solving (avoid race conditions) |
| reCAPTCHA | On | Enable/disable reCAPTCHA solving |
| Turnstile | On | Enable/disable Turnstile solving |
| hCaptcha | On | Enable/disable hCaptcha solving |
| Image OCR | On | Enable/disable image captcha OCR |

## How Solving Works

The extension follows the **2captcha API flow**:

```
┌──────────┐    POST /in.php        ┌──────────┐
│          │ ─────────────────────► │          │
│ Extension│    json=1              │  Solver   │
│          │ ◄───────────────────── │  Server   │
│          │  {"status":1,          │          │
│          │   "request":"task_id"} │          │
│          │                        │          │
│          │    GET /res.php         │          │
│          │ ─────────────────────► │          │
│          │    id=task_id           │          │
│          │    json=1               │          │
│          │                        │          │
│          │ ◄───────────────────── │          │
│          │  CAPCHA_NOT_READY      │          │
│          │  (poll again in 3s)    │          │
│          │                        │          │
│          │ ◄───────────────────── │          │
│          │  {"status":1,          │          │
│          │   "request":"TOKEN"}   │          │
└──────────┘                        └──────────┘
```

1. **Submit** — `POST /in.php` with `method`, `sitekey`, `pageurl`, and `json=1`
2. **Poll** — `GET /res.php?key=...&id=TASK_ID&json=1` every 3 seconds until `{"status":1,...}`
3. **Inject** — Token is injected into the page via the MAIN world script

### Why `json=1`?

The 2captcha API spec supports `json=1` for structured JSON responses. The Chrome extension uses this to properly parse responses with `.json()`. The extension-specific solver instances on ports 8844/8833/8822 support this parameter. The original solvers (8855/8866/8878) return plain-text only (`OK|id`, `CAPCHA_NOT_READY`).

## Detection Methods

### reCAPTCHA v2
- Scans for `iframe[src*="recaptcha"]` and `.g-recaptcha[data-sitekey]`
- Extracts sitekey from URL or data attribute
- Submits to `/in.php?method=userrecaptcha`
- Polls `/res.php` for token
- Injects token via `___grecaptcha_cfg` callback (MAIN world), textarea `#g-recaptcha-response`, and `data-callback`

### Cloudflare Turnstile
- Scans for `.cf-turnstile`, `[data-turnstile-sitekey]`, and `iframe[src*="challenges.cloudflare.com"]`
- Extracts sitekey, solves via `/in.php?method=turnstile`
- Injects token via `data-turnstile-callback`, hidden input `cf-turnstile-response`

### hCaptcha
- Scans for `.h-captcha`, `[data-hcaptcha-sitekey]`, and `iframe[src*="hcaptcha.com"]`
- Extracts sitekey, solves via `/in.php?method=hcaptcha`
- Injects token via `hcaptcha.setResponse()`, textarea, and `data-callback`

### Image/Canvas Captchas
- Scans for `img[src*="captcha"]`, `img[alt*="captcha"]`, and `<canvas>` elements near text inputs
- Extracts image as base64 (via fetch, canvas draw, or direct data URL)
- Sends to `/solve` endpoint for ddddocr + Tesseract dual-engine OCR
- Fills OCR result into nearest text input

## How Token Injection Works

Chrome extensions run content scripts in an **isolated world** — they cannot access page JavaScript objects like `___grecaptcha_cfg`, `turnstile`, or `hcaptcha`. This extension solves that with a two-layer approach:

1. **content.js** (isolated world) — detects captchas in the DOM, sends solve requests to the background service worker
2. **inject.js** (MAIN world) — injected as a `<script>` element, has full access to page JS objects for token injection

The content script dispatches a `CustomEvent('__captchaSolverInject')` with the token, and the inject script catches it and calls the appropriate page-level callback.

## Backend Servers

This extension requires the self-hosted solver backends. Two sets run side by side:

### Extension-Specific (with `json=1` support)
- **Universal Solver** — port **8844** (image OCR + hCaptcha + forwarding hub)
- **reCAPTCHA v2** — port **8833** (Playwright + CaptchaPlugin)
- **Turnstile** — port **8822** (nodriver + camoufox V2)

### Original (plain-text responses, for scripts/other tasks)
- **Universal Solver** — port **8855**
- **reCAPTCHA v2** — port **8866**
- **Turnstile** — port **8878** (nodriver + camoufox V2)

All backends expose a **2captcha-compatible API** (`/in.php` + `/res.php`) plus a direct JSON endpoint (`/solve`).

See the [Universal Solver README](https://github.com/icemellow-me/universal-captcha-solver) for full API documentation.

## Development

```
captcha-solver-extension/
├── manifest.json      # MV3 manifest
├── background.js      # Service worker — API routing, config, health checks
├── content.js         # Content script — detection, solving, visual feedback
├── inject.js          # MAIN world — token injection into page JS objects
├── popup/
│   ├── popup.html     # Dashboard UI
│   └── popup.js       # Dashboard logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE
└── README.md
```

## License

MIT
