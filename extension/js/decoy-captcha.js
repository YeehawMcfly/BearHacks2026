/**
 * Decoy “normal” CAPTCHA — generic checkbox widget shown before SGT. CAPTCHA.
 * Flow: click → … → tab overload → black + “Not so fast” type → dwell → apex → SGT. overlay latches in.
 */
(function () {
  // Pre-cache URL immediately — getURL fails if context is invalidated during the async flow
  let LOGO_URL = '';
  try { LOGO_URL = chrome.runtime.getURL('assets/recaptcha-logo/RecaptchaLogo.svg.png'); } catch (_) {}
  /** Spinning “verifying” phase before the X (reCAPTCHA-like). */
  const VERIFY_MS = 2200;
  /** Post-X wait before the tab cascade. */
  const HOLD_AFTER_X_MS = 3000;
  const TAB_SPAWN_COUNT = 19;
  const TAB_SPAWN_COUNT_REDUCED = 3;
  /** First N layers (0 … N-1) use the diagonal stack; the rest are random on screen. */
  const TABS_DIAGONAL_COUNT = 5;
  /** Hold on black (with “Not so fast” + glitch layer) after typing; was 1s, +5s for dwell. */
  const POST_TYPE_BLACK_HOLD_MS = 6000;
  const POST_TYPE_BLACK_HOLD_MS_REDUCED = 5220;
  /** Full-screen corruption burst, then SGT. overlay “latches in”. */
  const TAKEOVER_MS = 1100;
  const TAKEOVER_MS_REDUCED = 200;

  /**
   * Inter-spawn delays: after 1s, four 0.5s, then 14 steps accelerating to a floor.
   * @param {number} n number of spawns (19)
   * @returns {number[]}
   */
  function getSpawnDelays(n) {
    const out = [];
    if (n <= 0) return out;
    out.push(1000);
    const slowRepeat = Math.min(4, n - 1);
    for (let i = 0; i < slowRepeat; i++) {
      out.push(500);
    }
    const rest = n - out.length;
    let t = 400;
    for (let j = 0; j < rest; j++) {
      out.push(Math.max(45, Math.round(t)));
      t *= 0.82;
    }
    return out.slice(0, n);
  }

  function getSpawnDelaysReduced() {
    return [2000, 1500, 1500];
  }

  function getFirstRecaptchaBlockHTML(logoUrl) {
    return `
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
    `;
  }

  /** Stacked copies: static failed row (no id), no spinner, X on. */
  function getCloneRecaptchaBlockHTML(logoUrl) {
    return `
        <div class="rt-decoy-card" aria-hidden="true">
          <div class="rt-decoy-main">
            <div class="rt-decoy-left">
              <button type="button" class="rt-decoy-check rt-decoy-check--fail" disabled tabindex="-1" aria-hidden="true">
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
    `;
  }

  function randomLayerPosition() {
    const left = 2 + Math.random() * 96;
    const top = 1 + Math.random() * 98;
    return { left, top };
  }

  /**
   * Invisible wrapper; first TABS_DIAGONAL_COUNT use diagonal offset, the rest are random (viewport %).
   */
  function getStackedLayerHTML(logoUrl, index, { first } = { first: false }) {
    const z = 5 + index;
    const block = first ? getFirstRecaptchaBlockHTML(logoUrl) : getCloneRecaptchaBlockHTML(logoUrl);
    if (index >= TABS_DIAGONAL_COUNT) {
      const p = randomLayerPosition();
      return `
      <div class="rt-decoy-layer rt-decoy-layer--random" data-rt-idx="${index}" style="z-index:${z};left:${p.left}%;top:${p.top}%;--rt-idx:${index};">
        ${block}
      </div>
    `;
    }
    return `
      <div class="rt-decoy-layer rt-decoy-layer--stacked" data-rt-idx="${index}" style="--rt-idx:${index};z-index:${z};">
        ${block}
      </div>
    `;
  }

  function getHTML() {
    const logoUrl = LOGO_URL;
    return `
      <div class="rt-decoy-root">
        <div class="rt-decoy-preface" id="rt-decoy-preface" style="display:none" aria-hidden="true">
          <div class="rt-decoy-preface-text" id="rt-decoy-preface-text"></div>
        </div>
        <div class="rt-decoy-cascade" id="rt-decoy-cascade">
          ${getStackedLayerHTML(logoUrl, 0, { first: true })}
        </div>
        <div class="rt-decoy-takeover" aria-hidden="true">
          <div class="rt-decoy-takeover-burst"></div>
          <div class="rt-decoy-takeover-shear"></div>
          <div class="rt-decoy-takeover-rgb"></div>
        </div>
      </div>
    `;
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * @param {ShadowRoot} shadow
   * @param {string} logoUrl
   * @param {boolean} reduceMotion
   */
  async function runTabCascade(shadow, logoUrl, reduceMotion) {
    const cascade = shadow.getElementById('rt-decoy-cascade');
    if (!cascade) return;
    const n = reduceMotion ? TAB_SPAWN_COUNT_REDUCED : TAB_SPAWN_COUNT;
    const delays = reduceMotion ? getSpawnDelaysReduced() : getSpawnDelays(n);
    for (let s = 0; s < n; s++) {
      await delay(delays[s] ?? 100);
      const idx = s + 1;
      const html = getStackedLayerHTML(logoUrl, idx, { first: false });
      cascade.insertAdjacentHTML('beforeend', html);
      if (window.ReverseTest?.Audio?.sfx) {
        window.ReverseTest.Audio.sfx.error();
      }
    }
  }

  const NOT_SO_FAST = 'Not so fast';
  /** ms per char: ~55–105, slower than overlay typeText. */
  const NOT_SO_FAST_CHAR_MIN = 55;
  const NOT_SO_FAST_CHAR_JITTER = 50;

  /**
   * Typewriter with SGT. bubble colors + .rt-cursor; slower than main overlay typeText.
   * @param {ShadowRoot} shadow
   * @param {boolean} reduceMotion
   */
  async function typeNotSoFast(shadow, reduceMotion) {
    const el = shadow.getElementById('rt-decoy-preface-text');
    const wrap = shadow.getElementById('rt-decoy-preface');
    if (!el || !wrap) return;
    wrap.style.display = 'block';
    wrap.setAttribute('aria-hidden', 'false');
    el.textContent = '';
    if (reduceMotion) {
      el.textContent = NOT_SO_FAST;
      el.innerHTML = el.textContent + '<span class="rt-cursor"></span>';
      return;
    }
    for (let i = 0; i < NOT_SO_FAST.length; i++) {
      el.textContent += NOT_SO_FAST[i];
      await new Promise((r) =>
        setTimeout(r, NOT_SO_FAST_CHAR_MIN + Math.random() * NOT_SO_FAST_CHAR_JITTER)
      );
    }
    el.innerHTML = el.textContent + '<span class="rt-cursor"></span>';
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

    const logoUrl = LOGO_URL;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      await runTabCascade(shadow, logoUrl, reduceMotion);

      const root = shadow.querySelector('.rt-decoy-root');
      if (root) {
        root.classList.add('rt-decoy-root--glitch');
        await typeNotSoFast(shadow, reduceMotion);
        await delay(reduceMotion ? POST_TYPE_BLACK_HOLD_MS_REDUCED : POST_TYPE_BLACK_HOLD_MS);
        root.classList.add('rt-decoy-root--glitch-apex');
        await delay(reduceMotion ? TAKEOVER_MS_REDUCED : TAKEOVER_MS);
      }

      await Promise.resolve(onDone());
    });
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.DecoyCaptcha = { getHTML, run, getSpawnDelays };
})();
