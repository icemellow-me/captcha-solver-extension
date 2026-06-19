/* content.js — CaptchaSolver v2 Detection & Solving
 * Detects reCAPTCHA v2/v3, Cloudflare Turnstile, hCaptcha, and image captchas
 * then solves them via the background service worker API calls.
 */

(function() {
  'use strict';

  if (window.__captchaSolverContentLoaded) return;
  window.__captchaSolverContentLoaded = true;

  const DETECT_INTERVAL = 2000;
  const SOLVE_RETRY = 3;

  window.__captchaSolverDetected = window.__captchaSolverDetected || [];
  const solved = new Set();
  const solving = new Set();

  /* — Inject MAIN world script — */

  function injectMainWorldScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === '__captchaSolverInfo' && e.source === window) {
      const info = e.data.info;
      if (info.recaptchaSitekeys) {
        for (const sk of info.recaptchaSitekeys) {
          if (!window.__captchaSolverDetected.find(function(d) { return d.type === 'recaptcha' && d.sitekey === sk; })) {
            window.__captchaSolverDetected.push({ type: 'recaptcha', sitekey: sk, pageurl: location.href, source: 'mainworld' });
          }
        }
      }
    }
  });

  /* — Detection — */

  var DETECTORS = {
    recaptcha: {
      name: 'reCAPTCHA v2',
      detect: function() {
        var found = [];
        document.querySelectorAll('iframe[src*="recaptcha"]').forEach(function(iframe) {
          var src = iframe.src || '';
          var m = src.match(/[?&]k=([^&]+)/);
          if (m) found.push({ type: 'recaptcha', sitekey: m[1], element: iframe, pageurl: location.href });
        });
        document.querySelectorAll('.g-recaptcha[data-sitekey], #g-recaptcha[data-sitekey]').forEach(function(el) {
          found.push({ type: 'recaptcha', sitekey: el.dataset.sitekey, element: el, pageurl: location.href });
        });
        return found;
      }
    },
    turnstile: {
      name: 'Cloudflare Turnstile',
      detect: function() {
        var found = [];
        document.querySelectorAll('.cf-turnstile[data-sitekey], .cf-turnstile[data-turnstile-sitekey], [data-turnstile-sitekey]').forEach(function(el) {
          var sitekey = el.dataset.turnstileSitekey || el.dataset.sitekey || '';
          if (sitekey && !found.find(function(f) { return f.sitekey === sitekey; })) {
            found.push({ type: 'turnstile', sitekey: sitekey, element: el, pageurl: location.href });
          }
        });
        document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').forEach(function(iframe) {
          var src = iframe.src || '';
          var m = src.match(/[?&]k=([^&]+)/);
          var sitekey = m ? m[1] : '';
          if (!found.find(function(f) { return f.sitekey === sitekey; })) {
            found.push({ type: 'turnstile', sitekey: sitekey, element: iframe, pageurl: location.href });
          }
        });
        return found;
      }
    },
    hcaptcha: {
      name: 'hCaptcha',
      detect: function() {
        var found = [];
        document.querySelectorAll('.h-captcha[data-sitekey], .h-captcha[data-hcaptcha-sitekey], [data-hcaptcha-sitekey]').forEach(function(el) {
          var sitekey = el.dataset.hcaptchaSitekey || el.dataset.sitekey || '';
          if (sitekey && !found.find(function(f) { return f.sitekey === sitekey; })) {
            found.push({ type: 'hcaptcha', sitekey: sitekey, element: el, pageurl: location.href });
          }
        });
        document.querySelectorAll('iframe[src*="hcaptcha.com"]').forEach(function(iframe) {
          var src = iframe.src || '';
          var m = src.match(/[?&]sitekey=([^&]+)/);
          var sitekey = m ? m[1] : '';
          if (sitekey && !found.find(function(f) { return f.sitekey === sitekey; })) {
            found.push({ type: 'hcaptcha', sitekey: sitekey, element: iframe, pageurl: location.href });
          }
        });
        return found;
      }
    },
    imageCaptcha: {
      name: 'Image Captcha',
      detect: function() {
        var found = [];
        var sel = 'img[src*="captcha" i], img[src*="captch" i], img[alt*="captcha" i], img[src*="verify" i], img[src*="code" i]';
        document.querySelectorAll(sel).forEach(function(img) {
          if (img.closest('.g-recaptcha, .cf-turnstile, .h-captcha, [data-sitekey]')) return;
          var input = findNearestInput(img);
          if (input) found.push({ type: 'imageCaptcha', element: img, input: input, pageurl: location.href });
        });
        document.querySelectorAll('canvas').forEach(function(canvas) {
          if (canvas.width < 400 && canvas.height < 200 && canvas.width > 50) {
            var input = findNearestInput(canvas);
            if (input) found.push({ type: 'imageCaptcha', element: canvas, input: input, pageurl: location.href, isCanvas: true });
          }
        });
        return found;
      }
    }
  };

  function findNearestInput(el) {
    var form = el.closest('form');
    if (form) {
      var inp = form.querySelector('input[type="text"], input:not([type])');
      if (inp) return inp;
    }
    var sib = el;
    for (var i = 0; i < 5; i++) {
      sib = sib.nextElementSibling;
      if (!sib) break;
      if (sib.tagName === 'INPUT') return sib;
      var inner = sib.querySelector && sib.querySelector('input');
      if (inner) return inner;
    }
    var parent = el.parentElement;
    for (var j = 0; j < 3 && parent; j++) {
      var inp2 = parent.querySelector('input[type="text"], input:not([type])');
      if (inp2 && !inp2.closest('.g-recaptcha, .cf-turnstile, .h-captcha')) return inp2;
      parent = parent.parentElement;
    }
    return null;
  }

  /* — Solving — */

  function sendToBackground(type, data) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, data), function(resp) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.error) return reject(new Error(resp.error));
        resolve(resp);
      });
    });
  }

  function injectToken(action, token) {
    var script = document.createElement('script');
    script.textContent = "window.dispatchEvent(new CustomEvent('__captchaSolverInject', { detail: { action: '" + action + "', token: " + JSON.stringify(token) + " } }));";
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function solveRecaptcha(captcha) {
    if (!captcha.sitekey) return Promise.reject(new Error('No sitekey found'));
    console.log('[CaptchaSolver] Solving reCAPTCHA: ' + captcha.sitekey.substring(0, 8) + '...');
    return sendToBackground('solve-recaptcha', { sitekey: captcha.sitekey, pageurl: captcha.pageurl }).then(function(token) {
      console.log('[CaptchaSolver] Got reCAPTCHA token, injecting into page...');

      // 1. Set the hidden textarea (this is what the form submits)
      var textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"]');
      textareas.forEach(function(ta) {
        ta.value = token;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // 2. Also set the g-recaptcha-response div content
      var responseDiv = document.getElementById('g-recaptcha-response');
      if (responseDiv && responseDiv.tagName !== 'TEXTAREA') {
        responseDiv.textContent = token;
      }

      // 3. Inject into MAIN world (triggers callbacks, visual tick, jQuery events)
      injectToken('inject-recaptcha', token);

      // 4. Send message to reCAPTCHA anchor iframe to trigger green tick
      //    Our recaptcha-anchor.js content script runs inside the anchor iframe
      //    and listens for this message type, then clicks the checkbox
      var anchorFrame = document.querySelector('iframe[src*="recaptcha"][src*="anchor"]') ||
                        document.querySelector('iframe[src*="recaptcha/api2/anchor"]') ||
                        document.querySelector('iframe[src*="recaptcha"][src*="bframe"]') ||
                        document.querySelector('iframe[title*="reCAPTCHA"]');
      if (anchorFrame) {
        try {
          anchorFrame.contentWindow.postMessage({
            type: '__captchaSolverSolve',
            token: token
          }, '*');
          console.log('[CaptchaSolver] Sent solve message to reCAPTCHA iframe');
        } catch (e) {
          console.warn('[CaptchaSolver] Could not message reCAPTCHA iframe:', e.message);
        }
      }

      // 5. Wait a moment then check if the visual state updated, if not show overlay
      setTimeout(function() {
        checkAndShowOverlay(captcha, token);
      }, 1500);

      return token;
    });
  }

  /**
   * Check if the reCAPTCHA widget shows the green tick.
   * If not, add a visual overlay to indicate it's been solved.
   */
  function checkAndShowOverlay(captcha, token) {
    // Check if the anchor iframe already shows the green tick
    var anchorFrame = document.querySelector('iframe[src*="recaptcha"][src*="anchor"]') ||
                      document.querySelector('iframe[src*="recaptcha/api2/anchor"]');
    if (anchorFrame) {
      try {
        var doc = anchorFrame.contentDocument;
        if (doc && doc.querySelector('.recaptcha-checkbox-checked')) {
          console.log('[CaptchaSolver] ✓ reCAPTCHA green tick confirmed');
          return; // Already showing green tick
        }
      } catch (e) {
        // Cross-origin, can't check — show overlay
      }
    }

    // If we can't confirm the green tick, add a visual "SOLVED" badge on the widget
    var container = captcha.element;
    if (!container) {
      container = document.querySelector('.g-recaptcha') || document.querySelector('[data-sitekey]');
    }
    if (container && !container.dataset.__solverBadge) {
      container.dataset.__solverBadge = 'true';

      var badge = document.createElement('div');
      badge.className = '__captcha-solver-solved-badge';
      badge.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;' +
        'background:rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;' +
        'z-index:10000;font:600 13px/1 Roboto,-apple-system,sans-serif;color:#1e8e3e;' +
        'border-radius:3px;pointer-events:none;';
      badge.innerHTML = '✅ Solved';
      
      var wrapper = container.closest('.g-recaptcha') || container;
      if (getComputedStyle(wrapper).position === 'static') {
        wrapper.style.position = 'relative';
      }
      wrapper.appendChild(badge);

      console.log('[CaptchaSolver] Added visual solved overlay (green tick may not show cross-origin)');
    }
  }

  function solveTurnstile(captcha) {
    if (!captcha.sitekey) return Promise.reject(new Error('No Turnstile sitekey found'));
    console.log('[CaptchaSolver] Solving Turnstile: ' + captcha.sitekey.substring(0, 8) + '...');
    return sendToBackground('solve-turnstile', { sitekey: captcha.sitekey, pageurl: captcha.pageurl }).then(function(token) {
      console.log('[CaptchaSolver] Got Turnstile token, injecting into page...');

      // Set hidden inputs
      var inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
      inputs.forEach(function(input) {
        input.value = token;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Also set any named form inputs
      var namedInputs = document.querySelectorAll('input[name="cf-turnstile-response"], input[name="g-recaptcha-response"]');
      namedInputs.forEach(function(input) {
        input.value = token;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Inject into MAIN world (triggers callbacks)
      injectToken('inject-turnstile', token);

      // Try data-callback
      var container = captcha.element && captcha.element.closest('[data-turnstile-sitekey]') || captcha.element;
      if (container) {
        var cbName = container.dataset && container.dataset.turnstileCallback;
        if (cbName && typeof window[cbName] === 'function') window[cbName](token);
      }

      return token;
    });
  }

  function solveHcaptcha(captcha) {
    if (!captcha.sitekey) return Promise.reject(new Error('No hCaptcha sitekey found'));
    console.log('[CaptchaSolver] Solving hCaptcha: ' + captcha.sitekey.substring(0, 8) + '...');
    return sendToBackground('solve-hcaptcha', { sitekey: captcha.sitekey, pageurl: captcha.pageurl }).then(function(token) {
      console.log('[CaptchaSolver] Got hCaptcha token, injecting into page...');

      // Set textarea
      var textareas = document.querySelectorAll('textarea[name="h-captcha-response"]');
      textareas.forEach(function(ta) {
        ta.value = token;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Inject into MAIN world
      injectToken('inject-hcaptcha', token);

      // Try data-callback
      var widget = document.querySelector('.h-captcha[data-callback]');
      if (widget && widget.dataset.callback && typeof window[widget.dataset.callback] === 'function') {
        window[widget.dataset.callback](token);
      }

      return token;
    });
  }

  function solveImageCaptcha(captcha) {
    console.log('[CaptchaSolver] Solving image captcha');
    var el = captcha.element;
    var base64Promise;

    if (captcha.isCanvas) {
      base64Promise = Promise.resolve(el.toDataURL('image/png').split(',')[1]);
    } else {
      var src = el.src || '';
      if (src.startsWith('data:')) {
        base64Promise = Promise.resolve(src.split(',')[1]);
      } else {
        base64Promise = fetch(src).then(function(r) { return r.blob(); }).then(function(blob) {
          return new Promise(function(resolve) {
            var rd = new FileReader();
            rd.onloadend = function() { resolve(rd.result.split(',')[1]); };
            rd.readAsDataURL(blob);
          });
        }).catch(function() {
          var canvas = document.createElement('canvas');
          canvas.width = el.naturalWidth || el.width;
          canvas.height = el.naturalHeight || el.height;
          canvas.getContext('2d').drawImage(el, 0, 0);
          return canvas.toDataURL('image/png').split(',')[1];
        });
      }
    }

    return base64Promise.then(function(base64) {
      return sendToBackground('solve-image', { image_base64: base64 });
    }).then(function(result) {
      if (captcha.input && result) {
        captcha.input.value = result;
        captcha.input.dispatchEvent(new Event('input', { bubbles: true }));
        captcha.input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return result;
    });
  }

  var SOLVERS = {
    recaptcha: solveRecaptcha,
    turnstile: solveTurnstile,
    hcaptcha: solveHcaptcha,
    imageCaptcha: solveImageCaptcha
  };

  /* — Visual Feedback Badge — */

  function addSolveIndicator(element, status, message) {
    var badge = document.createElement('div');
    badge.className = '__captcha-solver-badge';
    var colors = { solving: '#f39c12', solved: '#2ecc71', failed: '#e74c3c' };
    var texts = { solving: 'Solving...', solved: 'Solved!', failed: 'Failed: ' + (message || '') };
    badge.style.cssText = 'position:fixed;z-index:2147483647;padding:4px 8px;border-radius:4px;font:11px/1.4 -apple-system,sans-serif;color:#fff;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.3);background:' + (colors[status] || '#333');
    badge.textContent = (status === 'solving' ? '\uD83E\uDDE9 ' : status === 'solved' ? '\u2705 ' : '\u274C ') + (texts[status] || '');
    try {
      var r = element.getBoundingClientRect();
      badge.style.top = Math.max(0, r.top - 28) + 'px';
      badge.style.left = r.left + 'px';
    } catch(e) {
      badge.style.top = '10px';
      badge.style.left = '10px';
    }
    document.body.appendChild(badge);
    if (status !== 'solving') setTimeout(function() { badge.remove(); }, status === 'solved' ? 5000 : 8000);
    return badge;
  }

  /* — Main Loop — */

  function detectAndSolve() {
    var newCaptchas = [];
    var keys = Object.keys(DETECTORS);
    for (var ki = 0; ki < keys.length; ki++) {
      var type = keys[ki];
      try {
        var captchas = DETECTORS[type].detect();
        for (var ci = 0; ci < captchas.length; ci++) {
          var c = captchas[ci];
          var id = c.type + ':' + (c.sitekey || (c.element && c.element.src && c.element.src.substring(0,40)) || Math.random());
          c._id = id;
          if (!solved.has(id) && !solving.has(id)) {
            newCaptchas.push(c);
            if (!window.__captchaSolverDetected.find(function(d) { return d.type === c.type && d.sitekey === c.sitekey; })) {
              window.__captchaSolverDetected.push({ type: c.type, sitekey: c.sitekey, pageurl: c.pageurl, status: 'pending' });
              try { chrome.runtime.sendMessage({ type: 'captcha-detected', captchaType: c.type, sitekey: c.sitekey, pageurl: c.pageurl }); } catch(e) {}
            }
          }
        }
      } catch(e) { console.error('[CaptchaSolver] Detection error for ' + type + ':', e); }
    }

    return sendToBackground('get-config', {}).then(function(cfg) {
      if (cfg.autoSolve === false) return;

      var chain = Promise.resolve();
      newCaptchas.forEach(function(captcha) {
        chain = chain.then(function() {
          var id = captcha._id;
          if (solved.has(id) || solving.has(id)) return;
          if (cfg.solveDelay > 0) return new Promise(function(r) { setTimeout(r, cfg.solveDelay); }).then(function() { return doSolve(captcha, id); });
          return doSolve(captcha, id);
        });
      });
      return chain;
    }).catch(function() {
      // Config fetch failed — try solving anyway
      newCaptchas.forEach(function(captcha) {
        doSolve(captcha, captcha._id);
      });
    });
  }

  function doSolve(captcha, id) {
    solving.add(id);
    var badge = captcha.element ? addSolveIndicator(captcha.element, 'solving') : null;
    var solver = SOLVERS[captcha.type];
    if (!solver) { solving.delete(id); return; }

    return trySolve(solver, captcha, 0, SOLVE_RETRY, badge, id);
  }

  function trySolve(solver, captcha, attempt, maxRetry, badge, id) {
    return solver(captcha).then(function(result) {
      solved.add(id);
      solving.delete(id);
      if (badge) { badge.textContent = '\u2705 Solved!'; badge.style.background = '#2ecc71'; setTimeout(function() { badge.remove(); }, 5000); }
      var detected = window.__captchaSolverDetected.find(function(d) { return d.type === captcha.type && d.sitekey === captcha.sitekey; });
      if (detected) detected.status = 'solved';
      console.log('[CaptchaSolver] Solved ' + captcha.type);
      try { chrome.runtime.sendMessage({ type: 'solve-result', captchaType: captcha.type, success: true }); } catch(e) {}
      return result;
    }).catch(function(e) {
      if (attempt < maxRetry - 1) {
        console.warn('[CaptchaSolver] Attempt ' + (attempt+1) + ' failed for ' + captcha.type + ': ' + e.message);
        return trySolve(solver, captcha, attempt + 1, maxRetry, badge, id);
      }
      solving.delete(id);
      if (badge) { badge.textContent = '\u274C ' + e.message; badge.style.background = '#e74c3c'; setTimeout(function() { badge.remove(); }, 8000); }
      var detected = window.__captchaSolverDetected.find(function(d) { return d.type === captcha.type && d.sitekey === captcha.sitekey; });
      if (detected) detected.status = 'failed';
      console.error('[CaptchaSolver] Failed ' + captcha.type + ' after ' + maxRetry + ' attempts: ' + e.message);
      try { chrome.runtime.sendMessage({ type: 'solve-result', captchaType: captcha.type, success: false, error: e.message }); } catch(e2) {}
    });
  }

  /* — Init — */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMainWorldScript);
  } else { injectMainWorldScript(); }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(detectAndSolve, 1000);
  } else {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(detectAndSolve, 1000); });
  }

  setInterval(detectAndSolve, DETECT_INTERVAL);

  var observer = new MutationObserver(function() {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(detectAndSolve, 1000);
  });
  observer.observe(document.documentElement || document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'solve-all') {
      solved.clear(); solving.clear();
      detectAndSolve().then(function() { sendResponse({ ok: true }); }).catch(function(e) { sendResponse({ error: e.message }); });
      return true;
    }
    if (msg.type === 'detect') {
      window.__captchaSolverDetected = []; solved.clear(); solving.clear();
      detectAndSolve().then(function() { sendResponse(window.__captchaSolverDetected); }).catch(function() { sendResponse(window.__captchaSolverDetected); });
      return true;
    }
    if (msg.type === 'get-status') {
      sendResponse({ detected: window.__captchaSolverDetected, solved: Array.from(solved), solving: Array.from(solving) });
      return false;
    }
  });

  console.log('[CaptchaSolver] v2.0 Content script loaded');
})();
