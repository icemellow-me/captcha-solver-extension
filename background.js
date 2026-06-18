/* background.js — Service Worker for CaptchaSolver Extension v2
 * Routes captcha solve requests to self-hosted solver backends
 * Universal (:8844) → forwards to Turnstile (:8822) + reCAPTCHA (:8833)
 */

const DEFAULTS = {
  apiUrl: 'http://23.22.196.74:8844',
  apiKey: '8010000000ccojr5nrbg516w5jvw1wu9',
  autoSolve: true,
  solveDelay: 500,
  solveRecaptcha: true,
  solveTurnstile: true,
  solveHcaptcha: true,
  solveImage: true,
  maxPollWait: 120,
};

/* ── State ── */

const solveQueue = new Map(); // taskId → { status, type, sitekey, started }
let totalSolved = 0;
let totalFailed = 0;

/* ── Helpers ── */

async function getConfig() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

function log(msg) {
  console.log(`[CaptchaSolver] ${msg}`);
}

/* ── 2captcha-compatible API ── */

async function submitTask(params) {
  const cfg = await getConfig();
  const url = new URL('/in.php', cfg.apiUrl);
  const body = new URLSearchParams({ key: cfg.apiKey, ...params, json: '1' });
  log(`Submitting ${params.method} task`);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json();
  if (data.status !== 1) throw new Error(data.request || 'Submit failed');
  return data.request; // task_id
}

async function pollResult(taskId, maxWait) {
  const cfg = await getConfig();
  const timeout = maxWait || cfg.maxPollWait || 120;
  const url = new URL('/res.php', cfg.apiUrl);
  const start = Date.now();

  while ((Date.now() - start) < timeout * 1000) {
    url.search = new URLSearchParams({
      key: cfg.apiKey, id: taskId, json: '1',
    }).toString();

    const resp = await fetch(url.toString());
    const data = await resp.json();

    if (data.status === 1) return data.request;
    if (data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(data.request || 'Solve failed');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Timeout waiting for solution');
}

async function solveCaptcha(method, params) {
  const taskId = await submitTask({ method, ...params });
  solveQueue.set(taskId, { status: 'solving', type: method, sitekey: params.sitekey, started: Date.now() });
  const result = await pollResult(taskId);
  solveQueue.delete(taskId);
  return result;
}

/* ── Direct JSON API (image OCR, classify) ── */

async function solveDirect(payload) {
  const cfg = await getConfig();
  const resp = await fetch(`${cfg.apiUrl}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: cfg.apiKey, ...payload }),
  });
  const data = await resp.json();
  if (data.status !== 'solved') throw new Error(data.error || data.solution || 'Solve failed');
  return data.solution;
}

async function classifyImage(base64Image, prompt) {
  const cfg = await getConfig();
  const resp = await fetch(`${cfg.apiUrl}/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: cfg.apiKey,
      image: base64Image,
      prompt: prompt || 'What is in this image?',
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function healthCheck() {
  const cfg = await getConfig();
  try {
    const resp = await fetch(`${cfg.apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return await resp.json();
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/* ── Badge ── */

function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: count > 0 ? '#e74c3c' : '#2ecc71' });
}

/* ── Solve Stats ── */

function getStats() {
  return { totalSolved, totalFailed, active: solveQueue.size, queue: Array.from(solveQueue.entries()).map(([id, v]) => ({ id, ...v })) };
}

/* ── Message Router ── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = {
    // 2captcha flow
    'solve-recaptcha': async () => {
      const { sitekey, pageurl, version } = msg;
      const token = await solveCaptcha('userrecaptcha', { sitekey, pageurl, version: version || 'v2' });
      totalSolved++;
      updateBadge(totalSolved);
      return token;
    },
    'solve-turnstile': async () => {
      const { sitekey, pageurl } = msg;
      const token = await solveCaptcha('turnstile', { sitekey, pageurl });
      totalSolved++;
      updateBadge(totalSolved);
      return token;
    },
    'solve-hcaptcha': async () => {
      const { sitekey, pageurl } = msg;
      const token = await solveCaptcha('hcaptcha', { sitekey, pageurl });
      totalSolved++;
      updateBadge(totalSolved);
      return token;
    },
    // Direct API
    'solve-image': async () => {
      const { image_base64 } = msg;
      const result = await solveDirect({ type: 'image', image_base64 });
      totalSolved++;
      updateBadge(totalSolved);
      return result;
    },
    'classify-image': async () => {
      const { image, prompt } = msg;
      return await classifyImage(image, prompt);
    },
    // Config
    'get-config': async () => await getConfig(),
    'set-config': async () => {
      await chrome.storage.local.set(msg.config);
      return { ok: true };
    },
    // Health + Stats
    'health': async () => await healthCheck(),
    'stats': async () => getStats(),
    // Tab info
    'get-captchas': async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return [];
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.__captchaSolverDetected || [],
        });
        return results[0]?.result || [];
      } catch {
        return [];
      }
    },
  };

  const fn = handler[msg.type];
  if (!fn) return false;

  fn().then(sendResponse).catch(e => {
    totalFailed++;
    sendResponse({ error: e.message });
  });
  return true; // async
});

// Listen for captcha detections from content scripts
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'captcha-detected') {
    log(`Captcha detected on tab ${sender.tab?.id}: ${msg.captchaType}`);
  }
});

// Listen for solve results from content scripts
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'solve-result') {
    if (msg.success) {
      totalSolved++;
      updateBadge(totalSolved);
      log(`✅ Solved ${msg.captchaType} on tab ${sender.tab?.id}`);
    } else {
      totalFailed++;
      log(`❌ Failed ${msg.captchaType}: ${msg.error}`);
    }
  }
});

log('CaptchaSolver v2.0 background service worker initialized');
