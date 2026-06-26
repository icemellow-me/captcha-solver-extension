/* xcaptcha-frame.js — CaptchaSolver xCaptcha Challenge Solver
 * Runs inside xCaptcha iframes (frame1 checkbox + frame2 challenge)
 * Routes solving through background.js → xCaptcha solver API (port 8899)
 * Uses 2captcha-compatible protocol: POST /in.php → GET /res.php
 */
(function() {
  'use strict';
  if (window.__xcFrameLoaded) return;
  window.__xcFrameLoaded = true;

  console.log('[CaptchaSolver] xCaptcha frame script loaded');

  // Extract sitekey from URL params or global
  function getSiteKey() {
    // From URL params
    var params = new URLSearchParams(location.search);
    if (params.get('sitekey')) return params.get('sitekey');
    // From global (set by xCaptcha's own JS)
    if (window.SITE_KEY) return window.SITE_KEY;
    // From parent's data attributes (via postMessage request)
    return null;
  }

  var SITE_KEY = getSiteKey();
  var CAPTCHA_SESSION = window.CAPTCHA_SESSION;
  var CLIENT_ID = window.CLIENT_ID;

  /* — Solve via background API (2captcha-compatible) — */
  async function solveViaAPI(siteKey) {
    console.log('[CaptchaSolver] xCaptcha: Solving via API, sitekey=' + (siteKey || 'unknown').substring(0, 12) + '...');

    var result = await new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({
        type: 'solve-xcaptcha',
        sitekey: siteKey,
        pageurl: location.href
      }, function(resp) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.error) return reject(new Error(resp.error));
        resolve(resp);
      });
    });

    console.log('[CaptchaSolver] xCaptcha: Got token from API: ' + String(result || '').substring(0, 30) + '...');
    return result;
  }

  /* — Submit token to parent page — */
  function submitToParent(token) {
    if (!token) return;
    // Send to parent content.js
    window.parent.postMessage({
      type: '__captchaSolverXCaptchaSolved',
      token: token,
      siteKey: SITE_KEY
    }, '*');
    console.log('[CaptchaSolver] xCaptcha: Token submitted to parent');
  }

  /* — Listen for token injection from parent (inject.js) — */
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    // Solve command from parent content.js
    if (e.data.type === '__captchaSolverSolveXCaptcha' && e.data.siteKey) {
      console.log('[CaptchaSolver] xCaptcha: Received solve command');
      if (!SITE_KEY) SITE_KEY = e.data.siteKey;
      solveViaAPI(SITE_KEY).then(function(token) {
        submitToParent(token);
      }).catch(function(err) {
        console.error('[CaptchaSolver] xCaptcha solve failed:', err.message);
        window.parent.postMessage({
          type: '__captchaSolverXCaptchaError',
          error: err.message,
          siteKey: SITE_KEY
        }, '*');
      });
    }

    // Token from parent inject.js (for direct injection inside iframe)
    if (e.data.type === '__captchaSolverXCaptchaToken' && e.data.token) {
      console.log('[CaptchaSolver] xCaptcha: Received token from parent, injecting...');
      // Try to set it in the Vue app if we're inside the challenge frame
      try {
        var app = document.querySelector('#app');
        if (app && app.__vue__) {
          var vm = app.__vue__;
          // Mark as solved in the Vue component
          if (vm.$children && vm.$children[0]) {
            vm.$children[0].solved = true;
          }
        }
      } catch (e) {}
    }
  });

  // Auto-solve if we detect a challenge and have a sitekey
  // (But only if we're inside the challenge iframe, not the checkbox iframe)
  var isChallengeFrame = !!document.querySelector('.task-wrapper') ||
                          !!document.querySelector('#app .wrapper') ||
                          location.pathname.includes('/captcha/');

  if (isChallengeFrame && SITE_KEY) {
    console.log('[CaptchaSolver] xCaptcha: Challenge frame detected, auto-solving...');
    setTimeout(function() {
      solveViaAPI(SITE_KEY).then(function(token) {
        submitToParent(token);
      }).catch(function(err) {
        console.error('[CaptchaSolver] xCaptcha auto-solve failed:', err.message);
      });
    }, 1500);
  }

  console.log('[CaptchaSolver] xCaptcha frame script initialized (sitekey=' + (SITE_KEY || 'none') + ', challenge=' + isChallengeFrame + ')');
})();
