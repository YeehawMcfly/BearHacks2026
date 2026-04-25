/**
 * Decoy “normal” CAPTCHA — generic checkbox widget shown before SGT. CAPTCHA.
 * Flow: click → verifying spinner → red X → hand off to main overlay.
 */
(function () {
  /** Spinning “verifying” phase before the X (reCAPTCHA-like). */
  const VERIFY_MS = 2200;
  const HOLD_AFTER_X_MS = 1600;

  function getHTML() {
    const logoUrl = chrome.runtime.getURL('assets/recaptcha-logo/RecaptchaLogo.svg.png');
    return `
      <div class="rt-decoy-root">
        <div class="rt-decoy-card">
          <div class="rt-decoy-main">
            <div class="rt-decoy-left">
              <button type="button" class="rt-decoy-check" id="rt-decoy-checkbox" aria-label="I'm not a robot">
                <span class="rt-decoy-spinner" aria-hidden="true">
                  <span class="rt-decoy-spinner-ring"></span>
                </span>
                <span class="rt-decoy-x" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
                    <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>
                  </svg>
                </span>
              </button>
              <span class="rt-decoy-label">I'm not a robot</span>
            </div>
            <div class="rt-decoy-right">
              <img class="rt-decoy-recaptcha-logo" src="${logoUrl}" width="56" height="56" alt="" draggable="false" />
              <div class="rt-decoy-legal">
                <span class="rt-decoy-link">Privacy</span>
                <span class="rt-decoy-legal-sep"> - </span>
                <span class="rt-decoy-link">Terms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * @param {ShadowRoot} shadow
   * @param {() => void | Promise<void>} onDone
   */
  async function run(shadow, onDone) {
    const btn = shadow.getElementById('rt-decoy-checkbox');
    if (!btn) {
      onDone();
      return;
    }

    let done = false;
    btn.addEventListener('click', async () => {
      if (done) return;
      done = true;
      btn.disabled = true;
      btn.classList.add('rt-decoy-check--loading');

      await delay(VERIFY_MS);

      btn.classList.remove('rt-decoy-check--loading');
      btn.classList.add('rt-decoy-check--fail');
      if (window.ReverseTest?.Audio?.sfx) {
        window.ReverseTest.Audio.sfx.error();
      }

      await delay(HOLD_AFTER_X_MS);

      await Promise.resolve(onDone());
    });
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.DecoyCaptcha = { getHTML, run };
})();
