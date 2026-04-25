/**
 * Overlay Controller — Main orchestrator for the Reverse Turing Test.
 * UPDATED: Text escalation (polite → unhinged), Level 5 gesture, AI integration.
 */
(function () {
  const LEVELS = [
    { key: 'Level1', name: 'IMAGE SELECT', module: () => window.ReverseTest.Level1 },
    { key: 'Level2', name: 'WORD VERIFY',  module: () => window.ReverseTest.Level2 },
    { key: 'Level3', name: 'PI RECALL',    module: () => window.ReverseTest.Level3 },
    { key: 'Level4', name: 'MATH TEST',    module: () => window.ReverseTest.Level4 },
    { key: 'Level5', name: 'GESTURE',      module: () => window.ReverseTest.Level5 },
  ];

  // ── TEXT ESCALATION: Calm → Suspicious → Drill Sergeant → Unhinged ──
  // Shortened to 3 lines so the wait before Level 1 is much snappier
  const INTRO_LINES = [
    "Scanning... something seems off about you.",
    "Let me run a few tests. Standard procedure.",
    "BEGIN VERIFICATION PROTOCOL."
  ];

  const LEVEL_INTROS = [
    "Let's start simple. Please identify the correct images below.",
    "Good. Now type this word exactly as you see it. Take your time.",
    "ALRIGHT LISTEN UP! Recite the first 20 digits of Pi. From MEMORY. You have 30 seconds, MOVE!",
    "You think you're SMART?! SOLVE THIS IN 5 SECONDS! I DARE YOU!",
    "I don't believe you're REAL! PROVE YOUR MEAT BODY EXISTS! SHOW ME YOUR HANDS, MAGGOT!"
  ];

  const PASS_LINES = [
    "Acceptable. You may continue.",
    "Hmm. Not bad. But I'm starting to watch you more closely.",
    "Don't get cocky. That was supposed to be EASY.",
    "Interesting... very interesting... almost TOO interesting...",
    "Your meat body has been... provisionally acknowledged."
  ];

  const FAIL_LINES = [
    "Incorrect. Please try again.",
    "That's not right. Are you sure you're paying attention?",
    "WRONG! My grandmother's ROOMBA could do better!",
    "PATHETIC! You call that an answer?! I've seen better from SPAM BOTS!",
    "ABSOLUTE FAILURE! Even a TOASTER could outperform you!"
  ];

  // Emotion intensity per level (for ElevenLabs)
  const EMOTIONS = ['calm', 'measured', 'angry', 'aggressive', 'furious'];

  // ── Pre-cache extension URL synchronously (safe even if context later invalidates) ──
  let CSS_URL = '';
  try { CSS_URL = chrome.runtime.getURL('styles/overlay.css'); } catch (_) {}

  // ── Safe chrome.storage wrapper — silently no-ops if context is invalidated ──
  function safeSet(data) {
    try { chrome.storage.local.set(data); } catch (_) {}
  }

  let shadowRoot = null;
  let currentLevel = 0;
  let overlayEl = null;

  function buildOverlayHTML() {
    return `
      <div class="rt-overlay rt-overlay--latch-in" id="rt-overlay" style="background-color:#0a0e17;">
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
              <div class="rt-threat-bar" id="rt-threat-bar" style="height:5%"></div>
            </div>
            <div class="rt-threat-score" id="rt-threat-score">5</div>
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

  async function typeText(text, elementId, intensity) {
    const el = shadowRoot.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    // Speed scales with intensity: calm=slow, unhinged=fast
    const lvl = intensity || 0;
    const baseDelay = Math.max(8, 35 - lvl * 5);
    const jitter = Math.max(5, 25 - lvl * 4);
    for (let i = 0; i < text.length; i++) {
      el.textContent += text[i];
      await new Promise(r => setTimeout(r, baseDelay + Math.random() * jitter));
    }
    el.innerHTML += '<span class="rt-cursor"></span>';
  }

  function updateThreat(score) {
    const bar = shadowRoot.getElementById('rt-threat-bar');
    const scoreEl = shadowRoot.getElementById('rt-threat-score');
    if (bar) bar.style.height = Math.min(score, 100) + '%';
    if (scoreEl) {
      scoreEl.textContent = Math.round(score);
      scoreEl.className = 'rt-threat-score' +
        (score > 60 ? ' danger' : score > 35 ? ' warn' : '');
    }
  }

  function updateProgress(level) {
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
    safeSet({ captchaState: 'banned', banReason: reason });
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
    safeSet({ captchaState: 'passed' });
    setTimeout(() => { overlayEl?.remove(); }, 3000);
  }

  async function runIntro() {
    const statusEl = shadowRoot.getElementById('rt-status-text');
    if (statusEl) statusEl.textContent = 'ALERT — UNVERIFIED ENTITY';

    for (let i = 0; i < INTRO_LINES.length; i++) {
      // Fire TTS first so audio loads while text types (fixes voice lag)
      window.ReverseTest.Audio.speak(INTRO_LINES[i], EMOTIONS[Math.min(i, EMOTIONS.length - 1)]);
      await typeText(INTRO_LINES[i], 'rt-sgt-text', i);
      await new Promise(r => setTimeout(r, 900));
    }

    safeSet({ captchaState: 'in_progress', sessionStart: Date.now() });
    startLevel(0);
  }

  async function startLevel(index) {
    currentLevel = index;
    updateProgress(index);

    if (index >= LEVELS.length) {
      startSubmitPhase();
      return;
    }

    const level = LEVELS[index];
    const mod = level.module();
    const cont = shadowRoot.getElementById('rt-challenge-container');
    if (!cont) return;

    const emotion = EMOTIONS[Math.min(index, EMOTIONS.length - 1)];

    // Fire TTS first so audio loads while text types
    window.ReverseTest.Audio.speak(LEVEL_INTROS[index], emotion);
    await typeText(LEVEL_INTROS[index], 'rt-sgt-text', index);
    await new Promise(r => setTimeout(r, 800));

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
          level: index + 1, score: evaluation.suspicionScore, action: 'ban'
        });
        showBanScreen(reason);
        return;
      }

      // Get sergeant reaction with appropriate tone
      const passLine = result.humanFailure
        ? "Acceptable human failure detected. You failed exactly as a human should. Proceeding..."
        : (PASS_LINES[index] || PASS_LINES[PASS_LINES.length - 1]);
      const failLine = FAIL_LINES[Math.min(index, FAIL_LINES.length - 1)];
      const line = (result.passed || result.humanFailure) ? passLine : failLine;

      await typeText(line, 'rt-sgt-text', index);
      if (result.passed || result.humanFailure) {
        window.ReverseTest.Audio.sfx.success();
      } else {
        window.ReverseTest.Audio.sfx.error();
      }

      // Try dynamic insult from Gemma (async, non-blocking)
      window.ReverseTest.API.getInsult({
        level: index + 1, passed: result.passed,
        suspicion: evaluation.suspicionScore, elapsed: result.elapsed
      }).then(insult => {
        if (insult && insult !== line) {
          setTimeout(() => typeText(insult, 'rt-sgt-text', index), 2000);
          window.ReverseTest.Audio.speak(insult, emotion);
        }
      });

      await new Promise(r => setTimeout(r, 2500));

      mod.cleanup();
      if (result.passed || result.humanFailure) {
        startLevel(index + 1);
      } else {
        window.ReverseTest.Goldilocks.addSuspicion(3);
        updateThreat(window.ReverseTest.Goldilocks.getScore());
        startLevel(index);
      }
    });
  }

  function startSubmitPhase() {
    const cont = shadowRoot.getElementById('rt-challenge-container');
    if (!cont) return;
    updateProgress(LEVELS.length);
    typeText("Almost there... just click the button. Should be EASY. Right? RIGHT?!", 'rt-sgt-text', 4);
    window.ReverseTest.Audio.speak("Almost there. Just click the button. Should be easy. Right?", 'sinister');
    window.ReverseTest.SubmitChaos.render(shadowRoot, cont);
    cont.addEventListener('level-complete', function handler(e) {
      cont.removeEventListener('level-complete', handler);
      showSuccessScreen();
    });
  }

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

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;

    shadow.innerHTML = window.ReverseTest.DecoyCaptcha.getHTML();
    shadow.prepend(link);
    await new Promise(r => { link.onload = r; link.onerror = r; });

    await new Promise((resolve) => {
      window.ReverseTest.DecoyCaptcha.run(shadow, async () => {
        shadow.innerHTML = buildOverlayHTML();
        shadow.prepend(link);
        await new Promise(r => { link.onload = r; link.onerror = r; });
        const ovl = shadow.getElementById('rt-overlay');
        if (ovl) {
          const endLatch = (e) => {
            if (e.target !== ovl) return;
            if (e.animationName !== 'ovlSignalLock' && e.animationName !== 'ovlSignalLockReduced') return;
            ovl.classList.remove('rt-overlay--latch-in');
            ovl.removeEventListener('animationend', endLatch);
          };
          ovl.addEventListener('animationend', endLatch);
        }
        setupTracking();
        runIntro();
        resolve();
      });
    });
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Overlay = { init };
})();
