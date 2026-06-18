/* inject.js — Runs in page's MAIN world to access captcha JS objects
 * Injected as a <script> element by the content script.
 * Content scripts run in isolated world and can't access page-level objects
 * like ___grecaptcha_cfg, turnstile, hcaptcha.
 */

(function() {
  'use strict';

  /* ── Token Injection ── */

  window.addEventListener('__captchaSolverInject', (e) => {
    const { action, token } = e.detail;

    if (action === 'inject-recaptcha') {
      // Method 1: ___grecaptcha_cfg callback (most reliable)
      if (window.___grecaptcha_cfg) {
        for (const [, client] of Object.entries(window.___grecaptcha_cfg.clients || {})) {
          try {
            const cb = client?.callback;
            if (typeof cb === 'function') {
              cb(token);
              console.log('[CaptchaSolver] ✓ reCAPTCHA token injected via callback');
              return;
            }
          } catch {}
        }
      }
      // Method 2: grecaptcha API
      if (window.grecaptcha && window.grecaptcha.getResponse) {
        try {
          // Find widget IDs and set response for each
          if (window.___grecaptcha_cfg) {
            for (const [id] of Object.entries(window.___grecaptcha_cfg.clients || {})) {
              try {
                // The internal structure varies, but some implementations
                // have a setResponse method on the widget
              } catch {}
            }
          }
        } catch {}
      }
      // Method 3: Set textarea + dispatch events
      const textarea = document.getElementById('g-recaptcha-response');
      if (textarea) {
        textarea.value = token;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[CaptchaSolver] ✓ reCAPTCHA token set in textarea');
      }
      // Method 4: Try data-callback
      document.querySelectorAll('[data-sitekey]').forEach(el => {
        const cbName = el.dataset.callback;
        if (cbName && typeof window[cbName] === 'function') {
          window[cbName](token);
          console.log('[CaptchaSolver] ✓ reCAPTCHA token injected via data-callback');
        }
      });
    }

    if (action === 'inject-turnstile') {
      // Method 1: Find callback function name
      const widgets = document.querySelectorAll('[data-turnstile-sitekey], .cf-turnstile');
      for (const w of widgets) {
        const cbName = w.dataset.turnstileCallback;
        if (cbName && typeof window[cbName] === 'function') {
          window[cbName](token);
          console.log('[CaptchaSolver] ✓ Turnstile token injected via callback');
          return;
        }
      }
      // Method 2: turnstile global API
      if (window.turnstile) {
        try {
          // Try to find widget responses
          const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
          inputs.forEach(input => {
            input.value = token;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          console.log('[CaptchaSolver] ✓ Turnstile token set via global + inputs');
        } catch {}
      }
      // Method 3: Hidden input fallback
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input) {
        input.value = token;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[CaptchaSolver] ✓ Turnstile token set in hidden input');
      }
    }

    if (action === 'inject-hcaptcha') {
      // Method 1: hCaptcha global API
      if (window.hcaptcha) {
        try {
          if (window.hcaptcha.setResponse) window.hcaptcha.setResponse(token);
          console.log('[CaptchaSolver] ✓ hCaptcha token set via API');
        } catch {}
      }
      // Method 2: Callback
      const widget = document.querySelector('.h-captcha, [data-hcaptcha-sitekey]');
      if (widget) {
        const cbName = widget.dataset.callback;
        if (cbName && typeof window[cbName] === 'function') {
          window[cbName](token);
          console.log('[CaptchaSolver] ✓ hCaptcha token injected via callback');
          return;
        }
      }
      // Method 3: Textarea
      const textarea = document.querySelector('textarea[name="h-captcha-response"]');
      if (textarea) {
        textarea.value = token;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[CaptchaSolver] ✓ hCaptcha token set in textarea');
      }
    }
  });

  /* ── Detection from MAIN world ── */

  function detectPageCaptchas() {
    const info = {
      recaptcha: !!window.___grecaptcha_cfg,
      turnstile: !!window.turnstile,
      hcaptcha: !!window.hcaptcha,
      recaptchaSitekeys: [],
      turnstileSitekeys: [],
      hcaptchaSitekeys: [],
    };

    // Extract reCAPTCHA sitekeys from config
    if (window.___grecaptcha_cfg) {
      try {
        for (const [, client] of Object.entries(window.___grecaptcha_cfg.clients || {})) {
          if (client?.sitekey) info.recaptchaSitekeys.push(client.sitekey);
        }
      } catch {}
    }

    // Extract Turnstile widget IDs
    if (window.turnstile) {
      try {
        document.querySelectorAll('[data-turnstile-sitekey]').forEach(el => {
          const key = el.dataset.turnstileSitekey || el.dataset.sitekey;
          if (key) info.turnstileSitekeys.push(key);
        });
      } catch {}
    }

    // Extract hCaptcha sitekeys
    if (window.hcaptcha) {
      try {
        document.querySelectorAll('[data-hcaptcha-sitekey]').forEach(el => {
          const key = el.dataset.hcaptchaSitekey || el.dataset.sitekey;
          if (key) info.hcaptchaSitekeys.push(key);
        });
      } catch {}
    }

    window.postMessage({ type: '__captchaSolverInfo', info }, '*');
  }

  // Run on load and periodically
  detectPageCaptchas();
  setInterval(detectPageCaptchas, 3000);

  console.log('[CaptchaSolver] Inject script loaded in MAIN world');
})();
