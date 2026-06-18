/* popup.js — CaptchaSolver v2 extension popup logic */

var $ = function(sel) { return document.querySelector(sel); };
var logEl = $('#log-output');

function log(msg, type) {
  var entry = document.createElement('div');
  entry.className = 'log-entry ' + (type || '');
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  logEl.prepend(entry);
  while (logEl.children.length > 30) logEl.lastChild.remove();
}

function msg(type, data) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage(Object.assign({ type: type }, data || {}), function(resp) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp && resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

/* — Stats — */

function updateStats() {
  msg('stats').then(function(stats) {
    $('#stat-solved').textContent = stats.totalSolved || 0;
    $('#stat-failed').textContent = stats.totalFailed || 0;
    $('#stat-active').textContent = (stats.queue || []).length;
  }).catch(function() {});
}

/* — Server Status — */

function checkHealth() {
  var el = $('#server-status');
  return msg('health').then(function(health) {
    var engines = health.engines || {};
    var rows = [
      { label: 'API', value: health.status === 'ok' ? 'Online' : 'Error', cls: health.status === 'ok' ? 'ok' : 'err' },
      { label: 'ddddocr OCR', value: engines.ddddocr ? '\u2713' : '\u2717', cls: engines.ddddocr ? 'ok' : 'err' },
      { label: 'Tesseract', value: engines.tesseract ? '\u2713' : '\u2717', cls: engines.tesseract ? 'ok' : 'err' },
      { label: 'hCaptcha', value: engines.hcaptcha ? '\u2713' : '\u2717', cls: engines.hcaptcha ? 'ok' : 'err' },
      { label: 'Puter Vision', value: engines.puter_vision ? '\u2713' : '\u2717', cls: engines.puter_vision ? 'ok' : 'err' },
      { label: 'Queue', value: health.queue || 0, cls: 'warn' },
    ];
    el.innerHTML = rows.map(function(r) {
      return '<div class="status-row"><span class="status-label">' + r.label + '</span><span class="status-value ' + r.cls + '">' + r.value + '</span></div>';
    }).join('');
    log('Health check OK', 'log-ok');
  }).catch(function(e) {
    el.innerHTML = '<div class="status-row"><span class="status-label">Status</span><span class="status-value err">' + e.message + '</span></div>';
    log('Health check failed: ' + e.message, 'log-err');
  });
}

/* — Captcha List — */

var TYPE_NAMES = {
  recaptcha: 'reCAPTCHA v2',
  turnstile: 'Turnstile',
  hcaptcha: 'hCaptcha',
  imageCaptcha: 'Image Captcha'
};

function refreshCaptchas() {
  var el = $('#captcha-list');
  msg('get-captchas').then(function(captchas) {
    if (!captchas || captchas.length === 0) {
      el.innerHTML = '<div class="empty">No captchas detected on this page</div>';
      return;
    }
    el.innerHTML = captchas.map(function(c) {
      var statusCls = 'badge-' + (c.status || 'pending');
      var statusText = c.status || 'pending';
      return '<div class="captcha-item">' +
        '<span class="captcha-type">' + (TYPE_NAMES[c.type] || c.type) + '</span>' +
        '<span class="badge ' + statusCls + '">' + (c.sitekey ? c.sitekey.substring(0, 8) + '...' : statusText) + '</span>' +
      '</div>';
    }).join('');
  }).catch(function() {
    el.innerHTML = '<div class="empty">Could not detect captchas</div>';
  });
}

/* — Solve — */

$('#btn-solve').addEventListener('click', function() {
  var btn = $('#btn-solve');
  btn.disabled = true;
  btn.textContent = '\u23F3 Solving...';
  log('Solving all captchas...');

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'solve-all' }, function() {
        if (chrome.runtime.lastError) {
          log('Solve error: ' + chrome.runtime.lastError.message, 'log-err');
        } else {
          log('Solve request sent', 'log-ok');
        }
        btn.disabled = false;
        btn.textContent = '\u26A1 Solve All';
        setTimeout(function() { refreshCaptchas(); updateStats(); }, 2000);
      });
    }
  });
});

/* — Detect — */

$('#btn-detect').addEventListener('click', function() {
  log('Re-detecting captchas...');
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'detect' }, function() {
        if (chrome.runtime.lastError) { /* ignore */ }
        refreshCaptchas();
        log('Detection complete', 'log-ok');
      });
    }
  });
});

/* — Settings — */

function loadConfig() {
  msg('get-config').then(function(cfg) {
    $('#cfg-url').value = cfg.apiUrl || '';
    $('#cfg-key').value = cfg.apiKey || '';
    $('#cfg-auto').classList.toggle('active', cfg.autoSolve !== false);
    $('#cfg-recaptcha').classList.toggle('active', cfg.solveRecaptcha !== false);
    $('#cfg-turnstile').classList.toggle('active', cfg.solveTurnstile !== false);
    $('#cfg-hcaptcha').classList.toggle('active', cfg.solveHcaptcha !== false);
    $('#cfg-image').classList.toggle('active', cfg.solveImage !== false);
  }).catch(function() {});
}

// Toggle click handlers
['cfg-auto', 'cfg-recaptcha', 'cfg-turnstile', 'cfg-hcaptcha', 'cfg-image'].forEach(function(id) {
  $('#' + id).addEventListener('click', function() {
    this.classList.toggle('active');
  });
});

$('#btn-save').addEventListener('click', function() {
  var config = {
    apiUrl: $('#cfg-url').value.trim(),
    apiKey: $('#cfg-key').value.trim(),
    autoSolve: $('#cfg-auto').classList.contains('active'),
    solveRecaptcha: $('#cfg-recaptcha').classList.contains('active'),
    solveTurnstile: $('#cfg-turnstile').classList.contains('active'),
    solveHcaptcha: $('#cfg-hcaptcha').classList.contains('active'),
    solveImage: $('#cfg-image').classList.contains('active'),
  };
  msg('set-config', { config: config }).then(function() {
    log('Settings saved', 'log-ok');
  }).catch(function(e) {
    log('Save failed: ' + e.message, 'log-err');
  });
});

$('#btn-test').addEventListener('click', function() {
  log('Testing connection...');
  checkHealth();
});

/* — Init — */

checkHealth();
refreshCaptchas();
loadConfig();
updateStats();
setInterval(updateStats, 3000);
