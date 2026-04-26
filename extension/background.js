/**
 * Background Service Worker — The Reverse Turing Test
 * Manages global CAPTCHA state across all tabs via chrome.storage.local.
 * States: "not_started" | "in_progress" | "passed" | "banned"
 *
 * Local API proxy: content scripts inherit the page origin (e.g. https://google.com).
 * Fetch to loopback from that context is blocked (Private Network Access). The service
 * worker fetches as chrome-extension:// — allowed with host_permissions.
 */

const LOCAL_SERVER = 'https://sgt-captcha-server.onrender.com';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

// Initialize state on install
chrome.runtime.onInstalled.addListener(async (details) => {
  const { captchaState, whitelistedDomains } = await chrome.storage.local.get(['captchaState', 'whitelistedDomains']);
  if (!captchaState) {
    await chrome.storage.local.set({
      captchaState: 'not_started',
      currentLevel: 0,
      suspicionScore: 0,
      banReason: '',
      sessionStart: null
    });
  }
  if (!whitelistedDomains) {
    await chrome.storage.local.set({
      whitelistedDomains: []
    });
  }
  
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'options.html' });
  }
  updateBadge('not_started');
});

// Listen for state changes to update badge
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.captchaState) {
    updateBadge(changes.captchaState.newValue);
  }
});

// Update extension badge based on state
function updateBadge(state) {
  const badges = {
    'not_started': { text: '!', color: '#f59e0b' },
    'in_progress': { text: '⏳', color: '#06b6d4' },
    'passed':      { text: '✓', color: '#10b981' },
    'banned':      { text: '✗', color: '#ff2d2d' }
  };
  const badge = badges[state] || badges['not_started'];
  chrome.action.setBadgeText({ text: badge.text });
  chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOCAL_API_FETCH') {
    const { path, method = 'GET', body, timeoutMs = 30000, binary = false } = message;
    const url = `${LOCAL_SERVER}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const init = { method, signal: controller.signal, headers: {} };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    fetch(url, init)
      .then(async (res) => {
        clearTimeout(tid);
        if (binary && res.ok) {
          const buf = await res.arrayBuffer();
          sendResponse({
            ok: true,
            status: res.status,
            base64: arrayBufferToBase64(buf),
            contentType: res.headers.get('Content-Type') || 'application/octet-stream'
          });
          return;
        }
        if (binary && !res.ok) {
          const text = await res.text();
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch (_) {}
          sendResponse({ ok: false, status: res.status, json });
          return;
        }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        sendResponse({ ok: res.ok, status: res.status, json, text });
      })
      .catch(() => {
        clearTimeout(tid);
        sendResponse({ ok: false, status: 0 });
      });
    return true;
  }

  if (message.type === 'RESET_STATE') {
    chrome.storage.local.set({
      captchaState: 'not_started',
      currentLevel: 0,
      suspicionScore: 0,
      banReason: '',
      sessionStart: null
    }).then(() => {
      updateBadge('not_started');
      // Reload all tabs to re-trigger overlay
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.url && !tab.url.startsWith('chrome://')) {
            chrome.tabs.reload(tab.id);
          }
        });
      });
      sendResponse({ success: true });
    });
    return true; // async response
  }

  if (message.type === 'GET_STATE') {
    chrome.storage.local.get(null).then(state => sendResponse(state));
    return true;
  }

  // Bypass host page CSP for level1 images
  if (message.type === 'FETCH_IMAGE') {
    fetch(message.url)
      .then(res => res.arrayBuffer())
      .then(buffer => {
        // Convert to base64
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        sendResponse({ dataUrl: 'data:image/jpeg;base64,' + btoa(binary) });
      })
      .catch(err => {
        console.error('FETCH_IMAGE error:', err);
        sendResponse({ error: err.toString() });
      });
    return true;
  }
});
