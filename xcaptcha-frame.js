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
    var params = new URLSearchParams(location.search);
    if (params.get('sitekey')) return params.get('sitekey');
    if (window.SITE_KEY) return window.SITE_KEY;
    return null;
  }

  var SITE_KEY = getSiteKey();
  var CAPTCHA_SESSION = window.CAPTCHA_SESSION;
  var CLIENT_ID = window.CLIENT_ID;

  /* — Detect frame type — */
  var isChallengeFrame = !!document.querySelector('.task-wrapper') ||
                          !!document.querySelector('#app .wrapper') ||
                          location.pathname.includes('/captcha/');

  var isCheckboxFrame = !isChallengeFrame &&
                        (location.hostname.includes('static.xcaptcha.com') ||
                         location.hostname.includes('xcaptcha.com')) &&
                        !document.querySelector('.task-wrapper');

  // Also detect checkbox frame by looking for the checkbox element itself
  if (!isChallengeFrame && document.querySelector('input[type="checkbox"], [role="checkbox"]')) {
    isCheckboxFrame = true;
  }

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
    window.parent.postMessage({
      type: '__captchaSolverXCaptchaSolved',
      token: token,
      siteKey: SITE_KEY
    }, '*');
    console.log('[CaptchaSolver] xCaptcha: Token submitted to parent');
  }

  /* — Click the xCaptcha checkbox inside the checkbox iframe (_2cFrame1) —
   * xCaptcha requires a click on the checkbox to initialize the server-side
   * session. Without this, getSessionId() returns false and solving fails.
   */
  function clickXCaptchaCheckbox() {
    console.log('[CaptchaSolver] xCaptcha: Looking for checkbox to click...');

    // Strategy 1: Find and click the actual checkbox element
    var checkbox = document.querySelector('input[type="checkbox"]') ||
                   document.querySelector('.checkbox') ||
                   document.querySelector('[role="checkbox"]') ||
                   document.querySelector('#checkbox') ||
                   document.querySelector('label input');

    if (checkbox) {
      console.log('[CaptchaSolver] xCaptcha: Found checkbox element, clicking...');
      checkbox.click();
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      checkbox.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    }

    // Strategy 2: Find and click the checkbox table cell / container
    // xCaptcha uses a table layout in _2cFrame1
    var tds = document.querySelectorAll('td');
    for (var i = 0; i < tds.length; i++) {
      if (tds[i].querySelector('input[type="checkbox"]') ||
          tds[i].classList.contains('checkbox') ||
          tds[i].id === 'checkbox') {
        console.log('[CaptchaSolver] xCaptcha: Found checkbox container td, clicking...');
        tds[i].click();
        return true;
      }
    }

    // Strategy 3: Click by coordinates (checkbox is ~30px from left, vertically centered)
    console.log('[CaptchaSolver] xCaptcha: No checkbox element found, clicking by coordinates...');
    var el = document.elementFromPoint(30, 39);
    if (el) {
      el.click();
      console.log('[CaptchaSolver] xCaptcha: Clicked element at (30,39): ' + el.tagName + '.' + el.className);
      return true;
    }

    console.warn('[CaptchaSolver] xCaptcha: Could not find anything to click for checkbox');
    return false;
  }

  /* — Listen for messages from parent content.js — */
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    // Click checkbox command from parent content.js
    // The parent can't click inside cross-origin iframes, so we do it here
    if (e.data.type === '__captchaSolverClickXCaptcha') {
      console.log('[CaptchaSolver] xCaptcha: Received checkbox click command');
      clickXCaptchaCheckbox();
    }

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
      try {
        var app = document.querySelector('#app');
        if (app && app.__vue__) {
          var vm = app.__vue__;
          if (vm.$children && vm.$children[0]) {
            vm.$children[0].solved = true;
          }
        }
      } catch (e) {}
    }
  });

  // Auto-solve if we detect a challenge and have a sitekey
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

  console.log('[CaptchaSolver] xCaptcha frame script initialized (sitekey=' + (SITE_KEY || 'none') +
    ', challenge=' + isChallengeFrame + ', checkbox=' + isCheckboxFrame + ')');
})();
