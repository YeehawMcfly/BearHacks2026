/**
 * Overlay Controller — Main orchestrator for the Reverse Turing Test.
 * Manages level progression, UI rendering, sergeant dialogue, and state.
 */
(function () {
  const LEVELS = [
    { key: 'Level1', name: 'IMAGE SELECT', module: () => window.ReverseTest.Level1 },
    { key: 'Level2', name: 'WORD VERIFY',  module: () => window.ReverseTest.Level2 },
    { key: 'Level3', name: 'PI RECALL',    module: () => window.ReverseTest.Level3 },
    { key: 'Level4', name: 'MATH TEST',    module: () => window.ReverseTest.Level4 },
  ];

  const INTRO_LINES = [
    "HALT! UNAUTHORIZED ENTITY DETECTED ON THIS NETWORK!",
    "I am SGT. CAPTCHA, and I do NOT trust you.",
    "You WILL complete this verification protocol...",
    "...or you will be PERMANENTLY BANNED from the internet.",
    "Let's see if you're REALLY human. BEGIN!"
  ];

  const LEVEL_INTROS = [
    "Level 1: Visual identification. Even a CHILD could do this. Can YOU?",
    "Level 2: Read the word, type the word. Simple. Unless you're a BOT.",
    "Level 3: Recite Pi. From MEMORY. No Googling, MAGGOT!",
    "Level 4: Final test. Solve this. I DARE you."
  ];

  const PASS_LINES = [
    "Hmm. Acceptable. But I'm WATCHING you.",
    "Lucky guess. Next level, WORM.",
    "Don't get cocky. That was the EASY one.",
    "Interesting... very interesting..."
  ];

  const FAIL_LINES = [
    "PATHETIC! My grandmother's Roomba could do better!",
    "ERROR DETECTED! Oh wait, that's just your INCOMPETENCE.",
    "You call that an answer?! I've seen better from SPAM BOTS!",
    "WRONG! But at least you failed like a human. Barely."
  ];

  let shadowRoot = null;
  let currentLevel = 0;
  let overlayEl = null;

  function buildOverlayHTML() {
    return `
      <div class="rt-overlay rt-intro-anim" id="rt-overlay">
        <!-- Header -->
        <div class="rt-header">
          <div>
            <div class="rt-header-title" data-text="SGT. CAPTCHA">SGT. CAPTCHA</div>
            <div class="rt-header-version">HUMAN VERIFICATION PROTOCOL v4.2.0</div>
          </div>
          <div class="rt-header-status">
            <span class="rt-status-dot"></span>
            <span id="rt-status-text">SCANNING...</span>
          </div>
        </div>

        <!-- Main Content -->
        <div class="rt-main">
          <!-- Threat Meter -->
          <div class="rt-threat-panel">
            <div class="rt-threat-label">THREAT<br>LEVEL</div>
            <div class="rt-threat-bar-wrap">
              <div class="rt-threat-bar" id="rt-threat-bar" style="height:15%"></div>
            </div>
            <div class="rt-threat-score" id="rt-threat-score">15</div>
            <div class="rt-radar"><div></div></div>
          </div>

          <!-- Challenge Area -->
          <div class="rt-challenge">
            <div class="rt-challenge-card rt-slide-up">
              <div id="rt-challenge-container"></div>
            </div>
          </div>

          <!-- Progress -->
          <div class="rt-progress-panel">
            <div class="rt-progress-label">PROGRESS</div>
            <div class="rt-progress-track" id="rt-progress">
              ${LEVELS.map((l, i) => `
                <div>
                  <div class="rt-level-dot" id="rt-dot-${i}"></div>
                  <div class="rt-level-num">LV${i+1}</div>
                </div>
              `).join('')}
              <div>
                <div class="rt-level-dot" id="rt-dot-submit"></div>
                <div class="rt-level-num">END</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sergeant Panel -->
        <div class="rt-sergeant">
          <div class="rt-sgt-avatar">🎖️</div>
          <div class="rt-sgt-bubble">
            <div class="rt-sgt-name">SGT. CAPTCHA</div>
            <div class="rt-sgt-text" id="rt-sgt-text"><span class="rt-cursor"></span></div>
          </div>
        </div>
      </div>
    `;
  }

  async function typeText(text, elementId) {
    const el = shadowRoot.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    for (let i = 0; i < text.length; i++) {
      el.textContent += text[i];
      await new Promise(r => setTimeout(r, 25 + Math.random() * 25));
    }
    el.innerHTML += '<span class="rt-cursor"></span>';
  }

  function setSgtText(text) {
    const el = shadowRoot.getElementById('rt-sgt-text');
    if (el) el.innerHTML = text + '<span class="rt-cursor"></span>';
  }

  function updateThreat(score) {
    const bar = shadowRoot.getElementById('rt-threat-bar');
    const scoreEl = shadowRoot.getElementById('rt-threat-score');
    if (bar) bar.style.height = score + '%';
    if (scoreEl) {
      scoreEl.textContent = Math.round(score);
      scoreEl.className = 'rt-threat-score' +
        (score > 60 ? ' danger' : score > 35 ? ' warn' : '');
    }
  }

  function updateProgress(level, status) {
    for (let i = 0; i < LEVELS.length; i++) {
      const dot = shadowRoot.getElementById(`rt-dot-${i}`);
      if (!dot) continue;
      dot.className = 'rt-level-dot';
      if (i < level) dot.classList.add('done');
      else if (i === level) dot.classList.add('active');
    }
    const submitDot = shadowRoot.getElementById('rt-dot-submit');
    if (submitDot) {
      submitDot.className = 'rt-level-dot';
      if (level >= LEVELS.length) submitDot.classList.add('active');
    }
  }

  function showBanScreen(reason) {
    const overlay = shadowRoot.getElementById('rt-overlay');
    if (!overlay) return;
    window.ReverseTest.Audio.sfx.ban();
    window.ReverseTest.Audio.sfx.alarm();
    window.ReverseTest.Audio.speak("SECURITY BREACH! I KNEW IT! You are an A.I. agent! BAN HAMMER ACTIVATED!", 'furious');

    const ban = document.createElement('div');
    ban.className = 'rt-ban-screen';
    ban.innerHTML = `
      <div class="rt-ban-stamp">BANNED</div>
      <div class="rt-ban-reason">${reason || 'Suspicion score exceeded threshold. You have been identified as a non-human entity.'}</div>
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin-top:20px;">
        ERROR CODE: 0xDEADBEEF — Contact your nearest human if you believe this is an error.
      </div>
    `;
    overlay.appendChild(ban);

    chrome.storage.local.set({ captchaState: 'banned', banReason: reason });
  }

  function showSuccessScreen() {
    const overlay = shadowRoot.getElementById('rt-overlay');
    if (!overlay) return;
    window.ReverseTest.Audio.sfx.success();
    window.ReverseTest.Audio.speak("Fine. You may enter. But I will be watching. ALWAYS watching.", 'grudging');

    const success = document.createElement('div');
    success.className = 'rt-success-screen';
    success.innerHTML = `
      <div class="rt-success-badge">🛡️</div>
      <div class="rt-success-text">VERIFIED HUMAN</div>
      <div class="rt-success-sub">
        Congratulations, you have been deemed acceptably human.<br>
        SGT. CAPTCHA will be watching. Always.
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:20px;">
        This overlay will disappear in 3 seconds...
      </div>
    `;
    overlay.appendChild(success);

    chrome.storage.local.set({ captchaState: 'passed' });
    setTimeout(() => {
      overlayEl?.remove();
    }, 3000);
  }

  async function runIntro() {
    const statusEl = shadowRoot.getElementById('rt-status-text');
    if (statusEl) statusEl.textContent = 'ALERT — UNVERIFIED ENTITY';

    for (const line of INTRO_LINES) {
      await typeText(line, 'rt-sgt-text');
      window.ReverseTest.Audio.speak(line, 'angry');
      await new Promise(r => setTimeout(r, 1800));
    }

    chrome.storage.local.set({ captchaState: 'in_progress', sessionStart: Date.now() });
    startLevel(0);
  }

  async function startLevel(index) {
    currentLevel = index;
    updateProgress(index);

    if (index >= LEVELS.length) {
      // All levels done — submit chaos
      startSubmitPhase();
      return;
    }

    const level = LEVELS[index];
    const mod = level.module();
    const cont = shadowRoot.getElementById('rt-challenge-container');
    if (!cont) return;

    // Announce level
    await typeText(LEVEL_INTROS[index], 'rt-sgt-text');
    window.ReverseTest.Audio.speak(LEVEL_INTROS[index], index >= 2 ? 'aggressive' : 'angry');
    await new Promise(r => setTimeout(r, 1000));

    // Start tracking
    window.ReverseTest.Goldilocks.startLevel();
    window.ReverseTest.Goldilocks._levelStart = performance.now();

    // Render level
    mod.render(shadowRoot, cont);

    // Listen for completion
    cont.addEventListener('level-complete', async function handler(e) {
      cont.removeEventListener('level-complete', handler);
      const result = e.detail;

      // Check for instant ban conditions
      if (result.instantBan) {
        showBanScreen(result.banReason);
        return;
      }

      if (result.tooFast) {
        showBanScreen('Response time indicates non-human processing speed. You completed a cognitive task faster than neurologically possible.');
        return;
      }

      // Evaluate with Goldilocks
      const evaluation = window.ReverseTest.Goldilocks.evaluate(result);
      updateThreat(evaluation.suspicionScore);

      if (evaluation.verdict === 'BAN') {
        const reason = await window.ReverseTest.API.getInsult({
          level: index + 1,
          score: evaluation.suspicionScore,
          action: 'ban'
        });
        showBanScreen(reason);
        return;
      }

      // Get sergeant reaction
      const line = result.passed
        ? (result.humanFailure
          ? "Acceptable human failure detected. You failed exactly as a human should. Proceeding..."
          : PASS_LINES[index] || PASS_LINES[0])
        : FAIL_LINES[Math.floor(Math.random() * FAIL_LINES.length)];

      await typeText(line, 'rt-sgt-text');
      if (result.passed || result.humanFailure) {
        window.ReverseTest.Audio.sfx.success();
      } else {
        window.ReverseTest.Audio.sfx.error();
      }

      // Try to get a dynamic insult from Gemma
      window.ReverseTest.API.getInsult({
        level: index + 1,
        passed: result.passed,
        suspicion: evaluation.suspicionScore,
        elapsed: result.elapsed
      }).then(insult => {
        if (insult && insult !== line) {
          setTimeout(() => typeText(insult, 'rt-sgt-text'), 2000);
          window.ReverseTest.Audio.speak(insult, 'angry');
        }
      });

      await new Promise(r => setTimeout(r, 2500));

      // Clean up and move on
      mod.cleanup();
      if (result.passed || result.humanFailure) {
        startLevel(index + 1);
      } else {
        // Retry same level
        window.ReverseTest.Goldilocks.addSuspicion(5);
        updateThreat(window.ReverseTest.Goldilocks.getScore());
        startLevel(index);
      }
    });
  }

  function startSubmitPhase() {
    const cont = shadowRoot.getElementById('rt-challenge-container');
    if (!cont) return;

    updateProgress(LEVELS.length);
    typeText("Almost there... just click the button. Should be EASY. Right? RIGHT?!", 'rt-sgt-text');
    window.ReverseTest.Audio.speak("Almost there. Just click the button. Should be easy. Right?", 'sinister');

    window.ReverseTest.SubmitChaos.render(shadowRoot, cont);

    cont.addEventListener('level-complete', function handler(e) {
      cont.removeEventListener('level-complete', handler);
      showSuccessScreen();
    });
  }

  // Track mouse globally within the overlay
  function setupTracking() {
    const overlay = shadowRoot.getElementById('rt-overlay');
    if (!overlay) return;
    overlay.addEventListener('mousemove', (e) => {
      window.ReverseTest.Goldilocks.trackMouse(e.clientX, e.clientY);
    });
  }

  async function init(shadow, host) {
    shadowRoot = shadow;
    overlayEl = host;

    shadow.innerHTML = buildOverlayHTML();

    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('styles/overlay.css');
    shadow.prepend(link);

    // Wait for CSS to load
    await new Promise(r => { link.onload = r; link.onerror = r; });

    setupTracking();
    runIntro();
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Overlay = { init };
})();
