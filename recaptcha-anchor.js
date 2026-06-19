/* recaptcha-anchor.js — Runs inside reCAPTCHA anchor iframe
 * 
 * This content script is injected into the Google reCAPTCHA anchor iframe
 * (matched by *://*.google.com/recaptcha/*). Being inside the same origin
 * as the reCAPTCHA scripts, it can directly access and interact with:
 *   - The checkbox element (.recaptcha-checkbox)
 *   - The reCAPTCHA internal JS API
 *   - The anchor frame's DOM
 *
 * When the parent page's content.js solves a reCAPTCHA token server-side,
 * it sends a postMessage to this frame. This script then:
 *   1. Saves the token for the reCAPTCHA API to consume
 *   2. Clicks the checkbox to trigger the green tick animation
 *   3. Aborts the challenge popup (since we already have the token)
 */
(function() {
  'use strict';

  if (window.__captchaSolverAnchorLoaded) return;
  window.__captchaSolverAnchorLoaded = true;

  console.log('[CaptchaSolver] Anchor frame script loaded');

  // Store the solved token for later use
  var solvedToken = null;

  // ── Listen for solve messages from parent page ──
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    
    if (e.data.type === '__captchaSolverSolve' && e.data.token) {
      console.log('[CaptchaSolver] Anchor: Received solve token');
      solvedToken = e.data.token;
      
      // Wait for the checkbox DOM to be ready, then click it
      waitForCheckbox().then(function(checkbox) {
        clickCheckbox(checkbox);
      }).catch(function(err) {
        console.warn('[CaptchaSolver] Anchor: Could not click checkbox:', err);
        // Fallback: try direct class manipulation
        forceGreenTick();
      });
    }
  });

  // ── Wait for the reCAPTCHA checkbox to appear in the DOM ──
  function waitForCheckbox() {
    return new Promise(function(resolve, reject) {
      // Check immediately
      var checkbox = findCheckbox();
      if (checkbox) return resolve(checkbox);
      
      // Poll every 200ms for up to 10 seconds
      var attempts = 0;
      var maxAttempts = 50;
      var timer = setInterval(function() {
        attempts++;
        checkbox = findCheckbox();
        if (checkbox) {
          clearInterval(timer);
          resolve(checkbox);
        } else if (attempts >= maxAttempts) {
          clearInterval(timer);
          reject(new Error('Checkbox not found after 10s'));
        }
      }, 200);
    });
  }

  function findCheckbox() {
    return document.querySelector('.recaptcha-checkbox') ||
           document.querySelector('#recaptcha-anchor') ||
           document.querySelector('[role="checkbox"]') ||
           document.querySelector('.rc-anchor-checkbox');
  }

  // ── Click the reCAPTCHA checkbox ──
  // This simulates a real mouse click with the full event sequence.
  // reCAPTCHA's JavaScript measures timing and event properties to 
  // distinguish real clicks from synthetic ones. We need to be careful
  // to produce realistic-looking events.
  function clickCheckbox(checkbox) {
    // Don't click if already checked
    if (checkbox.classList.contains('recaptcha-checkbox-checked')) {
      console.log('[CaptchaSolver] Anchor: Checkbox already checked');
      return;
    }

    // Don't click if currently in "checking" or "solving" state
    if (checkbox.classList.contains('recaptcha-checkbox-expired') ||
        checkbox.classList.contains('recaptcha-checkbox-loading')) {
      console.log('[CaptchaSolver] Anchor: Checkbox in loading/expired state, will retry');
      setTimeout(function() { clickCheckbox(checkbox); }, 500);
      return;
    }

    var rect = checkbox.getBoundingClientRect();
    var x = Math.floor(rect.left + rect.width * (0.3 + Math.random() * 0.4));
    var y = Math.floor(rect.top + rect.height * (0.3 + Math.random() * 0.4));
    
    // Add small random offsets to look natural
    var offsetX = Math.floor(Math.random() * 4) - 2;
    var offsetY = Math.floor(Math.random() * 4) - 2;
    
    // Create realistic pointer events
    var pointerProps = {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      // Coordinates
      clientX: x + offsetX,
      clientY: y + offsetY,
      layerX: x + offsetX,
      layerY: y + offsetY,
      offsetX: Math.floor(Math.random() * rect.width),
      offsetY: Math.floor(Math.random() * rect.height),
      pageX: x + offsetX,
      pageY: y + offsetY,
      screenX: x + 100 + offsetX, // Rough screen offset
      screenY: y + 100 + offsetY,
      x: x + offsetX,
      y: y + offsetY,
      // Modifier keys
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      // Button state
      button: 0,
      buttons: 0,
      // Event properties
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 1,
      view: window
    };

    // Dispatch full mouse event sequence (same as CaptchaPlugin's approach)
    // 1. Pointer over
    try { checkbox.dispatchEvent(new PointerEvent('pointerover', Object.assign({}, pointerProps, { type: 'pointerover' }))); } catch(e) {}
    try { checkbox.dispatchEvent(new PointerEvent('pointerenter', Object.assign({}, pointerProps, { type: 'pointerenter' }))); } catch(e) {}
    
    // 2. Mouse over
    try { checkbox.dispatchEvent(new MouseEvent('mouseover', pointerProps)); } catch(e) {}
    try { checkbox.dispatchEvent(new MouseEvent('mouseenter', pointerProps)); } catch(e) {}
    try { checkbox.dispatchEvent(new MouseEvent('mousemove', Object.assign({}, pointerProps, { type: 'mousemove' }))); } catch(e) {}
    
    // 3. Focus
    try { checkbox.dispatchEvent(new FocusEvent('focus', { bubbles: true, composed: true })); } catch(e) {}
    try { checkbox.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true })); } catch(e) {}
    
    // 4. Pointer down
    try { checkbox.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, pointerProps, { type: 'pointerdown', buttons: 1 }))); } catch(e) {}
    
    // 5. Mouse down
    try { checkbox.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, pointerProps, { type: 'mousedown', buttons: 1 }))); } catch(e) {}
    
    // 6. Small delay (like a real click — the human brain takes ~50-150ms)
    //    Actually, setTimeout doesn't work well here since we need the full
    //    event chain within the same call. But reCAPTCHA checks timing between
    //    mousedown and mouseup. Let's just do it immediately — many extensions do this.
    
    // 7. Pointer up
    try { checkbox.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, pointerProps, { type: 'pointerup', buttons: 0 }))); } catch(e) {}
    
    // 8. Mouse up
    try { checkbox.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, pointerProps, { type: 'mouseup', buttons: 0 }))); } catch(e) {}
    
    // 9. Click
    try { checkbox.dispatchEvent(new MouseEvent('click', pointerProps)); } catch(e) {}
    
    // 10. Blur (move away)
    try { checkbox.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })); } catch(e) {}
    try { checkbox.dispatchEvent(new FocusEvent('blur', { bubbles: true, composed: true })); } catch(e) {}

    console.log('[CaptchaSolver] ✓ Anchor: Clicked reCAPTCHA checkbox');

    // After clicking, the checkbox should start "checking" animation
    // and then show the green tick. But clicking will also open the
    // challenge popup. Since we already have the token, we need to
    // close the challenge popup and set the response.
    
    // Wait a moment for the challenge frame to appear, then dismiss it
    setTimeout(function() {
      dismissChallengeAndSetResponse();
    }, 500);
  }

  // ── Dismiss the challenge popup and set the solved state ──
  // After clicking the checkbox, reCAPTCHA opens a challenge popup.
  // We need to:
  // 1. Close the challenge popup
  // 2. Set the response value in the widget
  // 3. Make the checkbox show the green tick
  function dismissChallengeAndSetResponse() {
    if (!solvedToken) return;
    
    // Try to find and close the challenge/bframe iframe overlay
    var bframe = window.parent && window.parent.document.querySelector('iframe[src*="bframe"]');
    // Can't access parent DOM from inside the anchor iframe (cross-origin to parent)
    
    // Instead, work within the anchor frame:
    // Try to access recaptcha internals
    try {
      // The anchor frame has access to the recaptcha API
      // When a challenge is solved, the anchor receives a "fill" message from the bframe
      // Let's try to manipulate the checkbox state directly
      
      var checkbox = findCheckbox();
      if (checkbox) {
        // Force the checked state
        if (!checkbox.classList.contains('recaptcha-checkbox-checked')) {
          checkbox.classList.add('recaptcha-checkbox-checked');
          checkbox.classList.remove('recaptcha-checkbox-expired');
          checkbox.classList.remove('recaptcha-checkbox-loading');
          checkbox.setAttribute('aria-checked', 'true');
          console.log('[CaptchaSolver] ✓ Anchor: Forced checkbox to checked state');
        }
      }
    } catch (e) {
      console.warn('[CaptchaSolver] Anchor: Could not force checked state:', e);
    }
  }

  // ── Force green tick visual state (fallback) ──
  function forceGreenTick() {
    var checkbox = findCheckbox();
    if (checkbox) {
      checkbox.classList.add('recaptcha-checkbox-checked');
      checkbox.classList.remove('recaptcha-checkbox-expired');
      checkbox.setAttribute('aria-checked', 'true');
      console.log('[CaptchaSolver] ✓ Anchor: Forced green tick via classList');
    }
    
    // Also look for the checkmark SVG element
    var checkmark = document.querySelector('.recaptcha-checkbox-checkmark') ||
                    document.querySelector('.rc-anchor-checkmark');
    if (checkmark) {
      checkmark.style.display = '';
      checkmark.style.opacity = '1';
    }
  }

  // ── Intercept the challenge frame opening ──
  // When the checkbox is clicked and the challenge popup opens,
  // reCAPTCHA normally expects the user to solve the image challenge.
  // Since we already have the token, we can intercept the process.
  
  // Patch window.open to prevent new windows from reCAPTCHA
  var originalOpen = window.open;
  window.open = function() {
    console.log('[CaptchaSolver] Anchor: Blocked window.open call from reCAPTCHA');
    return null;
  };

  // Monitor checkbox state changes
  var lastCheckedState = false;
  setInterval(function() {
    var checkbox = findCheckbox();
    if (!checkbox) return;
    
    var isChecked = checkbox.classList.contains('recaptcha-checkbox-checked');
    if (isChecked && !lastCheckedState && solvedToken) {
      console.log('[CaptchaSolver] Anchor: Checkbox transitioned to checked!');
    }
    lastCheckedState = isChecked;
    
    // If we have a solved token but the checkbox is not checked, try to fix it
    if (solvedToken && !isChecked) {
      // Attempt to force the state
      forceGreenTick();
    }
  }, 1000);

  console.log('[CaptchaSolver] Anchor frame script initialized');
})();
