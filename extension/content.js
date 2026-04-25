/**
 * Content Script — Entry point injected into every page.
 * Checks state and creates Shadow DOM overlay if needed.
 */
(function () {
  // Don't run on extension pages or chrome:// URLs
  if (window.location.protocol === 'chrome-extension:' || window.location.protocol === 'chrome:') return;

  // Don't run on the dashboard (localhost:3000) so we don't block our own metrics
  if (window.location.hostname === 'localhost' && window.location.port === '3000') return;

  // Prevent double injection
  if (document.getElementById('reverse-turing-test-host')) return;

  // Pre-cache URL synchronously — getURL throws after context invalidation
  let CSS_URL = '';
  try { CSS_URL = chrome.runtime.getURL('styles/overlay.css'); } catch (_) { return; }

  async function checkAndInject() {
    try {
      const state = await chrome.storage.local.get(['captchaState', 'banReason']);
      const status = state.captchaState || 'not_started';

      if (status === 'passed' || status === 'disabled') return; // Skip injection

      // Create Shadow DOM host
      const host = document.createElement('div');
      host.id = 'reverse-turing-test-host';
      host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;';
      document.documentElement.appendChild(host);

      const shadow = host.attachShadow({ mode: 'closed' });

      if (status === 'banned') {
        // Show permanent ban screen
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS_URL;
        shadow.appendChild(link);

        await new Promise(r => { link.onload = r; link.onerror = r; });

        shadow.innerHTML += `
          <div class="rt-overlay">
            <div class="rt-ban-screen">
              <div class="rt-ban-stamp">BANNED</div>
              <div class="rt-ban-reason">${state.banReason || 'You have been identified as a non-human entity.'}</div>
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin-top:20px;">
                ERROR 0xDEADBEEF — Access permanently revoked.<br>
                Use the extension popup to reset (if you're actually human).
              </div>
            </div>
          </div>
        `;
        // Re-prepend link since innerHTML += removes it
        shadow.prepend(link);
        return;
      }

      // Block all interaction with underlying page
      host.addEventListener('keydown', e => e.stopPropagation(), true);
      host.addEventListener('keyup', e => e.stopPropagation(), true);

      // Initialize the overlay
      window.ReverseTest.Overlay.init(shadow, host);

    } catch (err) {
      console.error('[Reverse Turing Test] Init error:', err);
    }
  }

  // Listen for state changes (e.g., passed from another tab)
  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.captchaState) {
        const newState = changes.captchaState.newValue;
        const host = document.getElementById('reverse-turing-test-host');
        if ((newState === 'passed' || newState === 'disabled') && host) {
          host.style.transition = 'opacity 0.5s';
          host.style.opacity = '0';
          setTimeout(() => host.remove(), 500);
        }
        if (newState === 'not_started') {
          window.location.reload();
        }
      }
    });
  } catch (_) {}

  // Go
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndInject);
  } else {
    checkAndInject();
  }
})();
