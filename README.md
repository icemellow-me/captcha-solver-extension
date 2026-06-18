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
│  Chrome Extension   │────►│  Universal Solver  (port 8855) │
│  ┌───────────────┐  │     │  ddddocr + Tesseract +        │
│  │ content.js    │  │     │  hcaptcha-challenger +        │
│  │ (detection +  │  │     │  Puter Vision LLM             │
│  │  solving)     │  │     │  + upstream forwarder         │
│  ├───────────────┤  │     └───────────────────────────────┘
│  │ inject.js     │  │              │              │
│  │ (MAIN world   │  │     ┌────────┘              └────────┐
│  │  token inject)│  │     ▼                                ▼
│  ├───────────────┤  │  ┌────────────────┐   ┌──────────────────┐
│  │ background.js │  │  │ Turnstile :8877 │   │ reCAPTCHA :8866  │
│  │ (API routing) │  │  │ Playwright +    │   │ Playwright +      │
│  ├───────────────┤  │  │ Headless Chrome  │   │ CaptchaPlugin     │
│  │ popup/        │  │  └────────────────┘   └──────────────────┘
│  │ (UI dashboard)│  │
│  └───────────────┘  │
└─────────────────────┘
```

All solve requests go through the **Universal Solver** (`:8855`) which acts as a hub — it handles image OCR locally and forwards `userrecaptcha` / `turnstile` requests to the dedicated solver backends.

## Install

1. Clone this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the `captcha-solver-extension` folder
5. Click the extension icon to configure your server URL and API key

## Settings

| Setting | Default | Description |
|---|---|---|
| Server URL | `http://23.22.196.74:8855` | Universal Solver API endpoint |
| API Key | — | Your solver server API key |
| Auto-solve | On | Automatically solve detected captchas |
| reCAPTCHA | On | Enable/disable reCAPTCHA solving |
| Turnstile | On | Enable/disable Turnstile solving |
| hCaptcha | On | Enable/disable hCaptcha solving |
| Image OCR | On | Enable/disable image captcha OCR |

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

## Backend Servers

This extension requires the self-hosted solver backends:

- **[universal-captcha-solver](https://github.com/icemellow-me/universal-captcha-solver)** — Image OCR + hCaptcha + forwarding hub (port 8855)
- **[turnstile-solver](https://github.com/icemellow-me/turnstile-solver)** — Cloudflare Turnstile (port 8877)
- **[recaptcha-v2-solver](https://github.com/icemellow-me/recaptcha-v2-solver)** — reCAPTCHA v2 with CaptchaPlugin (port 8866)

All backends expose a **2captcha-compatible API** (`/in.php` + `/res.php`) plus a direct JSON endpoint (`/solve`).

## How Token Injection Works

Chrome extensions run content scripts in an **isolated world** — they cannot access page JavaScript objects like `___grecaptcha_cfg`, `turnstile`, or `hcaptcha`. This extension solves that with a two-layer approach:

1. **content.js** (isolated world) — detects captchas in the DOM, sends solve requests to the background service worker
2. **inject.js** (MAIN world) — injected as a `<script>` element, has full access to page JS objects for token injection

The content script dispatches a `CustomEvent('__captchaSolverInject')` with the token, and the inject script catches it and calls the appropriate page-level callback.

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
