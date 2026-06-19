/* inject.js — Runs in page's MAIN world to access captcha JS objects
 * Injected as a <script> element by the content script.
 * Content scripts run in isolated world and can't access page-level objects
 * like ___grecaptcha_cfg, turnstile, hcaptcha.
 */

(function() {
  'use strict';

  /* ── reCAPTCHA v2/v3 Deep Injection ── */

  function injectRecaptchaToken(token) {
    console.log('[CaptchaSolver] MAIN world: Injecting reCAPTCHA token (' + token.substring(0, 20) + '...)');
    let injected = false;

    // ── Strategy 0 (BEST): Set ___grecaptcha_cfg internal token ──
    // The 'C' property on each client object is what grecaptcha.getResponse() reads.
    // Setting it makes the public API return the token, which is what most sites check.
    // This also enables form submission to include the token server-side.
    if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
      for (const [widgetId, client] of Object.entries(window.___grecaptcha_cfg.clients)) {
        try {
          // Set the token in the internal response holder
          client.C = token;
          // Also set the "solved" state flags
          try { client.Z = client.Z || {}; client.Z.v = true; } catch(e) {}
          try { client.L = client.L || {}; client.L.J = '0'; } catch(e) {}
          console.log('[CaptchaSolver] ✓ Set reCAPTCHA internal token (client.C) for widget ' + widgetId);
          injected = true;
        } catch (e) {
          console.warn('[CaptchaSolver] Widget ' + widgetId + ' C-set error:', e);
        }
      }
      // Verify it worked
      try {
        var resp = (window.grecaptcha.enterprise || window.grecaptcha).getResponse();
        if (resp) {
          console.log('[CaptchaSolver] ✓ grecaptcha.getResponse() now returns token (' + resp.length + ' chars)');
        }
      } catch(e) {}
    }

    // ── Strategy 1: ___grecaptcha_cfg internal callback ──
    // The reCAPTCHA config object holds widget info including the callback.
    // Calling the callback is the most reliable way to:
    //   (a) deliver the token to the page JS
    //   (b) trigger the reCAPTCHA JS to update anchor iframe (green tick)
    if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
      for (const [widgetId, client] of Object.entries(window.___grecaptcha_cfg.clients)) {
        try {
          // Deep search for the callback function
          const cb = deepFindCallback(client, 0);
          if (cb && typeof cb === 'function') {
            cb(token);
            console.log('[CaptchaSolver] ✓ reCAPTCHA callback invoked for widget ' + widgetId);
            injected = true;
          }
        } catch (e) {
          console.warn('[CaptchaSolver] Widget ' + widgetId + ' callback error:', e);
        }
      }
    }

    // ── Strategy 2: grecaptcha API call ──
    if (!injected && window.grecaptcha) {
      try {
        // Use grecaptcha enterprise if available
        const api = window.grecaptcha.enterprise || window.grecaptcha;
        
        // Try to find all widget IDs and set their responses
        document.querySelectorAll('[data-sitekey]').forEach(function(el) {
          const widgetId = el.dataset.widgetId || el.getAttribute('data-widget-id') || '0';
          try {
            const current = api.getResponse(widgetId);
            if (!current) {
              // grecaptcha doesn't expose setResponse publicly,
              // but some builds have it internally
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

    // ── Strategy 3: Set textarea + dispatch React/jQuery events ──
    const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"]');
    textareas.forEach(function(textarea) {
      textarea.value = token;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('blur', { bubbles: true }));
      console.log('[CaptchaSolver] ✓ reCAPTCHA token set in textarea');
      injected = true;
    });

    // ── Strategy 4: data-callback attribute ──
    document.querySelectorAll('[data-sitekey][data-callback], .g-recaptcha[data-callback]').forEach(function(el) {
      const cbName = el.dataset.callback;
      if (cbName && typeof window[cbName] === 'function') {
        window[cbName](token);
        console.log('[CaptchaSolver] ✓ reCAPTCHA token via data-callback="' + cbName + '"');
        injected = true;
      }
    });

    // ── Strategy 5: Trigger recaptcha:verify / recaptcha:success events ──
    // Some frameworks (Angular, React) listen for custom events
    document.dispatchEvent(new CustomEvent('recaptcha:verify', {
      detail: { response: token, widgetId: null },
      bubbles: true
    }));
    document.dispatchEvent(new CustomEvent('recaptcha:success', {
      detail: { response: token },
      bubbles: true
    }));
    window.dispatchEvent(new CustomEvent('recaptcha:verify', {
      detail: { response: token }
    }));

    // ── Strategy 6: jQuery compatible events ──
    if (window.jQuery || window.$) {
      try {
        (window.jQuery || window.$)(document).trigger('recaptcha:verify', [token]);
        (window.jQuery || window.$)(document).trigger('recaptcha:success', [token]);
        (window.jQuery || window.$)('textarea[name="g-recaptcha-response"]').trigger('change');
        (window.jQuery || window.$)('textarea[name="g-recaptcha-response"]').trigger('input');
      } catch (e) {}
    }

    // ── Strategy 7: Global callback search ──
    if (!injected) {
      const commonCallbacks = [
        'onRecaptchaLoad', 'recaptchaCallback', 'recaptcha_loaded',
        'onReCaptchaLoad', 'captchaCallback', 'verifyCallback',
        'recaptchaSuccessCallback', 'onRecaptchaSuccess',
        'recaptchaOnload', 'reCaptchaCallback', 'onCaptchaComplete'
      ];
      for (const name of commonCallbacks) {
        if (typeof window[name] === 'function') {
          try {
            window[name](token);
            console.log('[CaptchaSolver] ✓ reCAPTCHA token via global callback "' + name + '"');
            injected = true;
            break;
          } catch (e) {}
        }
      }
    }

    // ── Final: Post message to anchor iframe to show green tick ──
    // Our recaptcha-anchor.js runs inside the iframe and will click the checkbox
    const anchorFrames = document.querySelectorAll(
      'iframe[src*="recaptcha"][src*="anchor"], iframe[src*="recaptcha/api2/anchor"], iframe[title*="reCAPTCHA"]'
    );
    anchorFrames.forEach(function(frame) {
      try {
        frame.contentWindow.postMessage({
          type: '__captchaSolverSolve',
          token: token
        }, '*');
      } catch (e) {}
    });

    // Also send to bframe (challenge frame) in case it can relay
    document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]').forEach(function(frame) {
      try {
        frame.contentWindow.postMessage({
          type: '__captchaSolverSolve',
          token: token
        }, '*');
      } catch (e) {}
    });

    if (!injected) {
      console.warn('[CaptchaSolver] Could not find reCAPTCHA callback. Token set in textarea but checkbox may not show green tick.');
    }
  }

  /**
   * Deep-search the reCAPTCHA client object for the callback function.
   * The internal structure varies by reCAPTCHA version and build.
   * We search recursively for any function property named "callback" or similar.
   */
  function deepFindCallback(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    
    // Direct "callback" property
    if (typeof obj.callback === 'function') return obj.callback;
    
    // Search all keys for callback-like functions
    for (const key of Object.keys(obj)) {
      try {
        const val = obj[key];
        // Check if this key looks like a callback name
        if (typeof val === 'function' && /callback/i.test(key)) return val;
        // Recurse into nested objects (but not arrays to avoid infinite loops)
        if (typeof val === 'object' && val !== null && !Array.isArray(val) && depth < 4) {
          const found = deepFindCallback(val, depth + 1);
          if (found) return found;
        }
      } catch (e) {}
    }
    return null;
  }

  /* ── Cloudflare Turnstile Injection ── */

  function injectTurnstileToken(token) {
    console.log('[CaptchaSolver] MAIN world: Injecting Turnstile token...');
    let injected = false;

    // Method 1: data-callback
    document.querySelectorAll('[data-turnstile-sitekey], .cf-turnstile').forEach(function(w) {
      const cbName = w.dataset.turnstileCallback || w.dataset.callback;
      if (cbName && typeof window[cbName] === 'function') {
        window[cbName](token);
        console.log('[CaptchaSolver] ✓ Turnstile token via callback "' + cbName + '"');
        injected = true;
      }
    });

    // Method 2: turnstile global API
    if (window.turnstile) {
      try {
        if (window.turnstile.getResponse) {
          document.querySelectorAll('[data-turnstile-sitekey]').forEach(function(el) {
            const widgetId = el.dataset.turnstileWidgetId;
            if (widgetId != null && window.turnstile.setResponse) {
              window.turnstile.setResponse(widgetId, token);
              injected = true;
            }
          });
        }
      } catch (e) {}
    }

    // Method 3: Hidden inputs
    document.querySelectorAll('input[name="cf-turnstile-response"]').forEach(function(input) {
      input.value = token;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('[CaptchaSolver] ✓ Turnstile token set in hidden input');
      injected = true;
    });

    // Method 4: Global callback search
    if (!injected) {
      const commonCallbacks = ['onTurnstileLoad', 'turnstileCallback', 'turnstileSuccess'];
      for (const name of commonCallbacks) {
        if (typeof window[name] === 'function') {
          try { window[name](token); injected = true; break; } catch (e) {}
        }
      }
    }

    // Method 5: Custom events
    document.dispatchEvent(new CustomEvent('turnstile:success', {
      detail: { token: token }
    }));
  }

  /* ── hCaptcha Injection ── */

  function injectHcaptchaToken(token) {
    console.log('[CaptchaSolver] MAIN world: Injecting hCaptcha token...');
    let injected = false;

    // Method 1: hCaptcha global API
    if (window.hcaptcha) {
      try {
        document.querySelectorAll('.h-captcha, [data-hcaptcha-sitekey]').forEach(function(w) {
          const widgetId = w.dataset.hcaptchaWidgetId;
          if (widgetId != null && window.hcaptcha.setResponse) {
            window.hcaptcha.setResponse(widgetId, token);
            injected = true;
          }
          const cbName = w.dataset.callback;
          if (cbName && typeof window[cbName] === 'function') {
            window[cbName](token);
            console.log('[CaptchaSolver] ✓ hCaptcha token via callback');
            injected = true;
          }
        });
      } catch (e) {}
    }

    // Method 2: data-callback attribute
    if (!injected) {
      const widget = document.querySelector('.h-captcha[data-callback], [data-hcaptcha-sitekey][data-callback]');
      if (widget) {
        const cbName = widget.dataset.callback;
        if (cbName && typeof window[cbName] === 'function') {
          window[cbName](token);
          console.log('[CaptchaSolver] ✓ hCaptcha token via data-callback');
          injected = true;
        }
      }
    }

    // Method 3: Textarea
    document.querySelectorAll('textarea[name="h-captcha-response"]').forEach(function(ta) {
      ta.value = token;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[CaptchaSolver] ✓ hCaptcha token set in textarea');
      injected = true;
    });

    // Method 4: Global callback search
    if (!injected) {
      const commonCallbacks = ['onHcaptchaLoad', 'hcaptchaCallback', 'hcaptchaSuccess'];
      for (const name of commonCallbacks) {
        if (typeof window[name] === 'function') {
          try { window[name](token); injected = true; break; } catch (e) {}
        }
      }
    }

    // Method 5: Custom events
    document.dispatchEvent(new CustomEvent('hcaptcha:success', {
      detail: { token: token }
    }));
  }

  /* ── Main Event Listener ── */

  window.addEventListener('__captchaSolverInject', function(e) {
    const { action, token } = e.detail;

    if (action === 'inject-recaptcha') {
      injectRecaptchaToken(token);
    } else if (action === 'inject-turnstile') {
      injectTurnstileToken(token);
    } else if (action === 'inject-hcaptcha') {
      injectHcaptchaToken(token);
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

    // Extract reCAPTCHA sitekeys from internal config
    if (window.___grecaptcha_cfg) {
      try {
        for (const [, client] of Object.entries(window.___grecaptcha_cfg.clients || {})) {
          const sitekey = findSitekeyDeep(client, 0);
          if (sitekey && !info.recaptchaSitekeys.includes(sitekey)) {
            info.recaptchaSitekeys.push(sitekey);
          }
        }
      } catch (e) {}
    }

    // Also check grecaptcha.render'd widgets
    document.querySelectorAll('[data-sitekey]').forEach(function(el) {
      const key = el.dataset.sitekey;
      if (key && !info.recaptchaSitekeys.includes(key)) {
        info.recaptchaSitekeys.push(key);
      }
    });

    // Extract Turnstile sitekeys
    document.querySelectorAll('[data-turnstile-sitekey]').forEach(function(el) {
      const key = el.dataset.turnstileSitekey || el.dataset.sitekey;
      if (key && !info.turnstileSitekeys.includes(key)) info.turnstileSitekeys.push(key);
    });

    // Extract hCaptcha sitekeys
    document.querySelectorAll('[data-hcaptcha-sitekey]').forEach(function(el) {
      const key = el.dataset.hcaptchaSitekey || el.dataset.sitekey;
      if (key && !info.hcaptchaSitekeys.includes(key)) info.hcaptchaSitekeys.push(key);
    });

    window.postMessage({ type: '__captchaSolverInfo', info }, '*');
  }

  function findSitekeyDeep(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 3) return null;
    if (obj.sitekey && typeof obj.sitekey === 'string') return obj.sitekey;
    for (const key of Object.keys(obj)) {
      try {
        const val = obj[key];
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const found = findSitekeyDeep(val, depth + 1);
          if (found) return found;
        }
      } catch (e) {}
    }
    return null;
  }

  // Run on load and periodically
  detectPageCaptchas();
  setInterval(detectPageCaptchas, 3000);

  console.log('[CaptchaSolver] Inject script loaded in MAIN world');
})();
