/* xcaptcha-frame.js — CaptchaSolver xCaptcha Challenge Solver
 * Runs inside the xCaptcha challenge iframe (frame2)
 * Intercepts the Vue.js app, reads the task, solves it, and submits
 */

(function() {
  'use strict';
  if (window.__xcFrameLoaded) return;
  window.__xcFrameLoaded = true;

  console.log('[CaptchaSolver] xCaptcha frame script loaded');

  const SITE_KEY = window.SITE_KEY;
  const CAPTCHA_SESSION = window.CAPTCHA_SESSION;
  const CLIENT_ID = window.CLIENT_ID;
  const HOST_API = window.hostApi || 'api.xcaptcha.com';

  if (!SITE_KEY) {
    console.log('[CaptchaSolver] No xCaptcha SITE_KEY found, exiting');
    return;
  }

  console.log(`[CaptchaSolver] xCaptcha detected: site=${SITE_KEY.substring(0,8)}... session=${CAPTCHA_SESSION?.substring(0,8)}...`);

  /* — Wait for Vue app to mount — */
  function waitForApp(maxWait) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        // The Vue app exposes window.CustomTask for "custom" type challenges
        // and the root Vue instance on #app
        const app = document.querySelector('#app');
        if (app && app.__vue__) {
          resolve(app.__vue__);
          return;
        }
        // Also check if the task data is available via the global state
        if (window.__wcaptcha || document.querySelector('.task-wrapper')) {
          resolve(null); // app exists but we'll use API directly
          return;
        }
        if (Date.now() - start > (maxWait || 10000)) {
          reject(new Error('xCaptcha app mount timeout'));
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  /* — Fetch task data from API — */
  async function fetchTask() {
    const lang = document.documentElement.lang || 'en';
    const url = `https://${HOST_API}/captcha/${SITE_KEY}/task?lang=${lang}`;
    const resp = await fetch(url, { credentials: 'include' });
    return await resp.json();
  }

  /* — Get the response token after solving — */
  async function fetchResponseToken(answerKey) {
    const url = `https://${HOST_API}/captcha/${SITE_KEY}/task/${answerKey}`;
    const resp = await fetch(url, { credentials: 'include' });
    return await resp.json();
  }

  /* — Solve "empty" type (auto-pass) — */
  async function solveEmpty(task) {
    console.log('[CaptchaSolver] xCaptcha: empty type, auto-solving...');
    // The answer field contains the key to fetch the response token
    if (task.answer) {
      const result = await fetchResponseToken(task.answer);
      console.log('[CaptchaSolver] xCaptcha empty response:', result);
      return result;
    }
    throw new Error('Empty task has no answer key');
  }

  /* — Solve "custom" type (click-on-objects) — */
  async function solveCustom(task) {
    console.log('[CaptchaSolver] xCaptcha: custom type (click-on-objects)');
    // task.i1 and task.i2 are image URLs (main image + overlay/objects)
    // Need to identify which objects to click and return coordinates
    // This requires AI image classification via our solver backend

    const i1Url = task.i1 ? `https://${HOST_API}${task.i1}` : null;
    const i2Url = task.i2 ? `https://${HOST_API}${task.i2}` : null;

    if (!i1Url) throw new Error('Custom task missing image URL (i1)');

    // Download images and convert to base64
    async function imageUrlToBase64(url) {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    }

    const mainImageB64 = await imageUrlToBase64(i1Url);
    const overlayImageB64 = i2Url ? await imageUrlToBase64(i2Url) : null;

    // Send to our AI solver for classification
    // We need to determine: what objects to find, and their coordinates
    const prompt = task.object || task.prompt || 'Identify all objects in this captcha image and return their center coordinates as x:y pairs separated by commas';

    // Send message to extension background to classify
    const classificationResult = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'classify-image',
        image: mainImageB64,
        prompt: prompt
      }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.error) return reject(new Error(resp.error));
        resolve(resp);
      });
    });

    if (!classificationResult) throw new Error('Classification returned no result');

    // Parse coordinates from the AI result
    // Expected format: "x1:y1,x2:y2,x3:y3,x4:y4"
    // Or it could be text like "click the 4 boats at positions..."
    let coords = [];
    const coordPattern = /(\d+)\s*[:x,]\s*(\d+)/g;
    let match;
    while ((match = coordPattern.exec(String(classificationResult))) !== null) {
      coords.push({ x: parseInt(match[1]), y: parseInt(match[2]) });
    }

    if (coords.length === 0) {
      throw new Error('Could not extract coordinates from AI response: ' + String(classificationResult).substring(0, 200));
    }

    console.log(`[CaptchaSolver] xCaptcha: Found ${coords.length} object coordinates`);

    // Take exactly 4 coordinates (max for this challenge type)
    coords = coords.slice(0, 4);

    // Build the answer in the xCaptcha format: base64("x1:y1,x2:y2,x3:y3,x4:y4")
    const coordStr = coords.map(c => `${c.x}:${c.y}`).join(',');
    const answer = btoa(coordStr);

    // Submit answer via the Vue component's check method
    if (window.CustomTask && typeof window.CustomTask.check === 'function') {
      // If CustomTask is available (from coord_orig.js), use its built-in check
      // But actually it uses component.check(btoa(response))
      // We need to find the Vue component reference
    }

    // Alternative: submit via the Vue app directly
    const app = document.querySelector('#app');
    if (app && app.__vue__) {
      const vm = app.__vue__;
      if (vm.$children && vm.$children[0] && typeof vm.$children[0].check === 'function') {
        vm.$children[0].check(answer);
        console.log('[CaptchaSolver] xCaptcha: Submitted answer via Vue component');
        return true;
      }
    }

    // Fallback: send the answer directly to the API
    console.log('[CaptchaSolver] xCaptcha: Trying API-based submission');
    try {
      const submitUrl = `https://${HOST_API}/captcha/${SITE_KEY}/check`;
      const resp = await fetch(submitUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: task.key,
          answer: answer,
          client_id: CLIENT_ID || ''
        })
      });
      const result = await resp.json();
      console.log('[CaptchaSolver] xCaptcha: Submit response:', result);
      return result;
    } catch (e) {
      console.warn('[CaptchaSolver] xCaptcha: Direct submit failed:', e.message);
    }

    throw new Error('Could not submit xCaptcha custom answer');
  }

  /* — Solve "text" type (assemble code) — */
  async function solveText(task) {
    console.log('[CaptchaSolver] xCaptcha: text type (assemble code)');
    // This type shows a text code and asks user to assemble it from 2 elements
    // The task object should contain the text/parts
    // We need to use the solver to OCR/classify the text elements

    // Take screenshot of the challenge area for OCR
    const taskEl = document.querySelector('.task-wrapper') || document.querySelector('#app');
    if (!taskEl) throw new Error('No task element found for text captcha');

    // For text captcha, the answer is typically visible in the task data
    // or we need to OCR the displayed text
    if (task.answer) {
      // Answer provided directly
      return task.answer;
    }

    // Use canvas to capture the challenge
    const canvas = document.createElement('canvas');
    const rect = taskEl.getBoundingClientRect();
    canvas.width = rect.width || 300;
    canvas.height = rect.height || 200;

    // We can't directly draw cross-origin content to canvas
    // So ask the background script to solve it via screenshot
    // For now, send the task info to the solver
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'solve-xcaptcha-text',
        siteKey: SITE_KEY,
        taskKey: task.key,
        taskType: 'text'
      }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.error) return reject(new Error(resp.error));
        resolve(resp);
      });
    });

    return result;
  }

  /* — Solve "dynamics" type (sliding puzzle) — */
  async function solveDynamics(task) {
    console.log('[CaptchaSolver] xCaptcha: dynamics type (sliding puzzle)');
    // This uses WebSocket for real-time position tracking
    // The user slides a piece to align with the background
    // We need to: 1) capture both images, 2) calculate offset, 3) simulate drag

    // For now, delegate to the background solver
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'solve-xcaptcha-dynamics',
        siteKey: SITE_KEY,
        taskKey: task.key,
        taskType: 'dynamics',
        socket: task.socket,
        size: task.size
      }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.error) return reject(new Error(resp.error));
        resolve(resp);
      });
    });

    return result;
  }

  /* — Main solve flow — */
  async function solve() {
    try {
      // Wait for the Vue app to initialize
      await waitForApp(10000);

      // Fetch the current task
      const task = await fetchTask();
      console.log(`[CaptchaSolver] xCaptcha task type: ${task.type}`);
      console.log(`[CaptchaSolver] xCaptcha task data:`, JSON.stringify(task).substring(0, 300));

      let result;
      switch (task.type) {
        case 'empty':
          result = await solveEmpty(task);
          break;
        case 'custom':
          result = await solveCustom(task);
          break;
        case 'text':
          result = await solveText(task);
          break;
        case 'dynamics':
          result = await solveDynamics(task);
          break;
        default:
          throw new Error('Unknown xCaptcha task type: ' + task.type);
      }

      // If we got a response token, inject it into the parent page
      if (result && typeof result === 'object' && result.answer) {
        // Notify parent frame about the solved token
        window.parent.postMessage({
          type: '__captchaSolverXCaptchaSolved',
          token: result.answer,
          siteKey: SITE_KEY
        }, '*');
        console.log('[CaptchaSolver] xCaptcha solved! Token sent to parent.');
      } else if (result === true) {
        // Answer was submitted via Vue component — wait for verification
        console.log('[CaptchaSolver] xCaptcha answer submitted, waiting for verification...');
        // Monitor for the response callback
        await new Promise(r => setTimeout(r, 3000));
        // Check if the parent page's wcaptcha_response input got a value
        window.parent.postMessage({
          type: '__captchaSolverXCaptchaCheck',
          siteKey: SITE_KEY
        }, '*');
      }

      // Collect fingerprint data and send (xneeded for verification)
      try {
        if (typeof getFingerprint === 'function') {
          const fp = await getFingerprint();
          await fetch(`https://${HOST_API}/collect`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fp)
          });
        }
      } catch (e) {
        // Fingerprinting not critical
      }

    } catch (e) {
      console.error('[CaptchaSolver] xCaptcha solve error:', e.message);
      // Send error to parent
      window.parent.postMessage({
        type: '__captchaSolverXCaptchaError',
        error: e.message,
        siteKey: SITE_KEY
      }, '*');
    }
  }

  // Listen for solve commands from the parent content script
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === '__captchaSolverSolveXCaptcha' && e.data.siteKey === SITE_KEY) {
      console.log('[CaptchaSolver] xCaptcha: Received solve command from parent');
      solve();
    }
  });

  // Auto-solve if autoSolve is enabled
  // Wait for the task to load, then auto-trigger
  setTimeout(() => {
    // Check if there's actually a challenge visible (not just the checkbox frame)
    if (document.querySelector('.task-wrapper') || document.querySelector('#app .wrapper')) {
      console.log('[CaptchaSolver] xCaptcha: Challenge visible, auto-solving...');
      solve();
    }
  }, 3000);

  console.log('[CaptchaSolver] xCaptcha frame script initialized');
})();
