/**
 * Overlay Controller — Main orchestrator for the Reverse Turing Test.
 *
 * STORYTELLING ARC:
 *   Act I  (Levels 1-2): Normal Google-style theme (white bg, blue accents)
 *   TRANSITION:          Glitch + CRT takeover animation
 *   Act II (Levels 3-7): Military theme (dark, cyan/red, scanlines)
 *
 * GEMMA INTEGRATION:
 *   Every line of dialogue is attempted through Gemma first.
 *   Fallback text used if server is unreachable.
 */
(function () {
  const LEVELS = [
    { key: 'Level1',      name: 'IMAGE SELECT',   module: () => window.ReverseTest.Level1 },
    { key: 'Level2',      name: 'WORD VERIFY',    module: () => window.ReverseTest.Level2 },
    // ── THE TRANSITION HAPPENS HERE ──
    { key: 'Level3',      name: 'PI RECALL',      module: () => window.ReverseTest.Level3 },
    { key: 'LevelChess',  name: 'CHESS',          module: () => window.ReverseTest.LevelChess },
    { key: 'Level4',      name: 'IMPOSSIBLE MATH', module: () => window.ReverseTest.Level4 },
    { key: 'Level5',      name: 'GESTURE',        module: () => window.ReverseTest.Level5 },
    { key: 'LevelBody',   name: 'BODY SCAN',      module: () => window.ReverseTest.LevelBody },
  ];

  // At which level index does the military theme kick in?
  const TRANSITION_AFTER = 2; // After Level 2 (index 1), transition before Level 3 (index 2)

  // ── TEXT ESCALATION ──
  // Act I (normal, calm)
  const NORMAL_INTROS = [
    "Please select all images containing the requested category.",
    "Type the word shown below to verify you're human."
  ];
  // Act II (military, escalating)
  const MILITARY_INTROS = [
    "ALRIGHT LISTEN UP! Recite the first 20 digits of Pi. From MEMORY. You have 30 seconds, MOVE!",
    "Time for a BRAIN SCAN! Find checkmate in ONE move. Or admit defeat like a HUMAN!",
    "You think you're SMART?! SOLVE THIS IN 5 SECONDS! I DARE YOU!",
    "I don't believe you're REAL! PROVE YOUR MEAT BODY EXISTS! SHOW ME YOUR HANDS!",
    "STAND BACK! FULL BODY VERIFICATION! I want to see you MOVE, MAGGOT!"
  ];

  const PASS_LINES = [
    "Acceptable. You may continue.",
    "Not bad. Let's try something harder.",
    "Don't get cocky. That was supposed to be EASY.",
    "Hmm. Interesting. VERY interesting...",
    "PATHETIC performance! But somehow... human.",
    "Your meat body has been... provisionally acknowledged.",
    "I'm watching. ALWAYS watching."
  ];

  const FAIL_LINES = [
    "Incorrect. Please try again.",
    "That's not right. Are you sure you're paying attention?",
    "WRONG! My grandmother's ROOMBA could do better!",
    "PATHETIC! You call that an answer?! I've seen better from SPAM BOTS!",
    "ABSOLUTE FAILURE! Even a TOASTER could outperform you!"
  ];

  const TRANSITION_LINES = [
    "Wait... something's wrong.",
    "Your responses don't match expected human baselines.",
    "INITIATING ENHANCED VERIFICATION PROTOCOL...",
  ];

  const EMOTIONS = ['calm', 'calm', 'angry', 'angry', 'aggressive', 'furious', 'furious'];

  // ── Pre-cache ──
  let CSS_URL = '';
  let CAMERA_URL = '';
  try { CSS_URL = chrome.runtime.getURL('styles/overlay.css'); } catch (_) {}
  try { CAMERA_URL = chrome.runtime.getURL('camera.html'); } catch (_) {}
  function safeSet(data) { try { chrome.storage.local.set(data); } catch (_) {} }

  let shadowRoot = null;
  let currentLevel = 0;
  let overlayEl = null;
  let currentTheme = 'normal'; // 'normal' or 'military'

  function buildOverlayHTML() {
    return `
      <div class="rt-overlay rt-theme-normal" id="rt-overlay">
        <!-- Normal theme header (Act I) -->
        <div class="rt-header rt-header-normal" id="rt-header-normal">
          <div>
            <div class="rt-header-title-normal">Additional Verification</div>
            <div class="rt-header-version-normal">Security check required</div>
          </div>
          <div class="rt-header-status">
            <span class="rt-status-dot" style="background:#4285f4;box-shadow:0 0 6px #4285f4"></span>
            <span id="rt-status-text">Verifying...</span>
          </div>
        </div>

        <!-- Military theme header (Act II, hidden initially) -->
        <div class="rt-header rt-header-military" id="rt-header-military" style="display:none">
          <div>
            <div class="rt-header-title" data-text="SGT. CAPTCHA">SGT. CAPTCHA</div>
            <div class="rt-header-version">HUMAN VERIFICATION PROTOCOL v4.2.0</div>
          </div>
          <div class="rt-header-status">
            <span class="rt-status-dot"></span>
            <span id="rt-status-text-mil">SCANNING...</span>
          </div>
        </div>

        <!-- Main Content -->
        <div class="rt-main">
          <!-- Threat Meter (hidden in normal theme) -->
          <div class="rt-threat-panel" id="rt-threat-panel" style="display:none">
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

          <!-- Progress (hidden in normal theme) -->
          <div class="rt-progress-panel" id="rt-progress-panel" style="display:none">
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

        <!-- Sergeant Panel (hidden until transition) -->
        <div class="rt-sergeant" id="rt-sergeant" style="display:none">
          <div class="rt-sgt-avatar">🎖️</div>
          <div class="rt-sgt-bubble">
            <div class="rt-sgt-name">SGT. CAPTCHA</div>
            <div class="rt-sgt-text" id="rt-sgt-text"><span class="rt-cursor"></span></div>
          </div>
        </div>

        <!-- Normal theme text area (for Act I) -->
        <div class="rt-normal-footer" id="rt-normal-footer">
          <div class="rt-normal-status" id="rt-normal-status"></div>
        </div>
      </div>
    `;
  }

  // typeText: paces typing to match audio duration if provided, otherwise uses intensity-based speed.
  // audioDuration in seconds (0 = use intensity default)
  async function typeText(text, elementId, intensity, audioDuration = 0) {
    const el = shadowRoot.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    let msPerChar;
    if (audioDuration > 0.5 && text.length > 0) {
      // Reserve last 15% of audio for the cursor blink before advancing
      msPerChar = Math.min(120, (audioDuration * 0.85 * 1000) / text.length);
    } else {
      const lvl = intensity || 0;
      msPerChar = Math.max(8, 35 - lvl * 4);
    }
    for (let i = 0; i < text.length; i++) {
      el.textContent += text[i];
      const jitter = audioDuration > 0 ? 0 : Math.max(5, 25 - (intensity || 0) * 3);
      await new Promise(r => setTimeout(r, msPerChar + Math.random() * jitter));
    }
    el.innerHTML += '<span class="rt-cursor"></span>';
  }

  function showNormalText(text) {
    const el = shadowRoot.getElementById('rt-normal-status');
    if (el) { el.textContent = text; el.style.opacity = '1'; }
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

  // ── THEME TRANSITION ──
  async function playTransition() {
    const overlay = shadowRoot.getElementById('rt-overlay');
    if (!overlay) return;

    // Phase 1: Glitch the current normal theme
    overlay.classList.add('rt-theme-glitching');
    showNormalText("Wait... something doesn't add up.");
    window.ReverseTest.Audio.sfx.error();
    await new Promise(r => setTimeout(r, 1200));

    showNormalText("Your behavior patterns are... unusual.");
    await new Promise(r => setTimeout(r, 1200));

    // Phase 2: Screen flash + CRT boot
    overlay.classList.add('rt-theme-flash');
    await new Promise(r => setTimeout(r, 200));
    overlay.classList.remove('rt-theme-flash');
    await new Promise(r => setTimeout(r, 100));
    overlay.classList.add('rt-theme-flash');
    await new Promise(r => setTimeout(r, 100));
    overlay.classList.remove('rt-theme-flash');

    // Phase 3: Swap to military theme
    overlay.classList.remove('rt-theme-normal', 'rt-theme-glitching');
    overlay.classList.add('rt-theme-military');
    currentTheme = 'military';

    // Show military UI elements
    const headerNormal = shadowRoot.getElementById('rt-header-normal');
    const headerMil = shadowRoot.getElementById('rt-header-military');
    const threatPanel = shadowRoot.getElementById('rt-threat-panel');
    const progressPanel = shadowRoot.getElementById('rt-progress-panel');
    const sgtPanel = shadowRoot.getElementById('rt-sergeant');
    const normalFooter = shadowRoot.getElementById('rt-normal-footer');

    if (headerNormal) headerNormal.style.display = 'none';
    if (headerMil) headerMil.style.display = 'flex';
    if (threatPanel) threatPanel.style.display = 'flex';
    // if (progressPanel) progressPanel.style.display = 'block'; // Hidden for immersion
    if (sgtPanel) sgtPanel.style.display = 'flex';
    if (normalFooter) normalFooter.style.display = 'none';

    // Phase 4: SGT intro — voice and text stay in sync, wait for each line to finish
    window.ReverseTest.Audio.sfx.alarm();
    for (const line of TRANSITION_LINES) {
      window.ReverseTest.Audio.stop(); // kill any stale audio
      const audioPromise = window.ReverseTest.Audio.speak(line, 'angry');
      // Start typing immediately, then wait for voice to finish
      await typeText(line, 'rt-sgt-text', 3);
      await audioPromise; // wait for TTS to resolve (may be null if server offline)
      await window.ReverseTest.Audio.waitForAudio(); // wait for playback to end
      await new Promise(r => setTimeout(r, 300)); // brief pause between lines
    }
  }

  function showBanScreen(reason) {
    const overlay = shadowRoot.getElementById('rt-overlay');
    if (!overlay) return;
    window.ReverseTest.Audio.sfx.ban();
    window.ReverseTest.Audio.sfx.alarm();
    window.ReverseTest.Audio.speak("SECURITY BREACH! BAN HAMMER ACTIVATED!", 'furious');

    const ban = document.createElement('div');
    ban.className = 'rt-ban-screen';
    ban.innerHTML = `
      <div class="rt-ban-stamp">BANNED</div>
      <div class="rt-ban-reason">${reason || 'Suspicion score exceeded threshold.'}</div>
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin-top:20px;">
        ERROR CODE: 0xDEADBEEF
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
    // In normal theme, just show a subtle status message
    showNormalText("Additional verification required. Please complete the following.");
    safeSet({ captchaState: 'in_progress', sessionStart: Date.now() });
    await new Promise(r => setTimeout(r, 800));
    startLevel(0);
  }

  async function startLevel(index) {
    currentLevel = index;

    if (index >= LEVELS.length) {
      startSubmitPhase();
      return;
    }

    // ── TRANSITION CHECK ──
    if (index === TRANSITION_AFTER && currentTheme === 'normal') {
      await playTransition();
    }

    if (currentTheme === 'military') {
      updateProgress(index);
    }

    const level = LEVELS[index];
    const mod = level.module();
    const cont = shadowRoot.getElementById('rt-challenge-container');
    if (!cont) return;

    const isNormal = index < TRANSITION_AFTER;
    const emotion = EMOTIONS[Math.min(index, EMOTIONS.length - 1)];

    // ── ANNOUNCE LEVEL ──
    if (isNormal) {
      // Normal theme: simple text, no drill sergeant
      showNormalText(NORMAL_INTROS[index] || "Complete this verification step.");
    } else {
      // Stop any stale audio first
      window.ReverseTest.Audio.stop();
      const milIndex = index - TRANSITION_AFTER;
      const fallbackLine = MILITARY_INTROS[milIndex] || MILITARY_INTROS[MILITARY_INTROS.length - 1];
      const line = fallbackLine;

      // Fire TTS fetch in background (non-blocking)
      const audioPromise = window.ReverseTest.Audio.speak(line, emotion);

      // Type text immediately — no waiting on TTS
      await typeText(line, 'rt-sgt-text', milIndex + 2);

      // After typing: wait up to 600ms for audio to have started.
      // If it started, wait for it to finish. If not, move on immediately.
      const raceResult = await Promise.race([
        audioPromise,
        new Promise(r => setTimeout(() => r('timeout'), 600))
      ]);
      if (raceResult !== 'timeout') {
        await window.ReverseTest.Audio.waitForAudio();
      }

      // Fire Gemma for next level's intro in background (no await)
      window.ReverseTest.API.getInsult({
        level: index + 1, action: 'intro', levelName: level.name, emotion
      }).catch(() => {});

      await new Promise(r => setTimeout(r, 200));
    }

    // Start tracking
    window.ReverseTest.Goldilocks.startLevel();
    window.ReverseTest.Goldilocks._levelStart = performance.now();

    // Render level
    mod.render(shadowRoot, cont);

    // Listen for completion
    cont.addEventListener('level-complete', async function handler(e) {
      cont.removeEventListener('level-complete', handler);
      const result = e.detail;

      if (result.instantBan) { showBanScreen(result.banReason); return; }
      if (result.tooFast) {
        showBanScreen('Response time indicates non-human processing speed.');
        return;
      }

      const evaluation = window.ReverseTest.Goldilocks.evaluate(result);
      if (currentTheme === 'military') updateThreat(evaluation.suspicionScore);

      if (evaluation.verdict === 'BAN') {
        const reason = await window.ReverseTest.API.getInsult({
          level: index + 1, score: evaluation.suspicionScore, action: 'ban'
        });
        showBanScreen(reason);
        return;
      }

      // ── REACTION ──
      if (isNormal) {
        // Calm reaction in normal theme
        if (result.passed || result.humanFailure) {
          showNormalText("Verified. Proceeding to next step...");
          window.ReverseTest.Audio.sfx.success();
        } else {
          showNormalText("Incorrect. Please try again.");
          window.ReverseTest.Audio.sfx.error();
        }
      } else {
        // Military reaction — stop stale audio, speak + type in sync
        window.ReverseTest.Audio.stop();
        const passLine = result.humanFailure
          ? "Acceptable human failure. You failed like a true organic being."
          : (PASS_LINES[index % PASS_LINES.length]);
        const failLine = FAIL_LINES[Math.min(index, FAIL_LINES.length - 1)];
        const fallback = (result.passed || result.humanFailure) ? passLine : failLine;

        const reactionAudio = window.ReverseTest.Audio.speak(fallback, emotion);
        await typeText(fallback, 'rt-sgt-text', Math.min(index, 4));

        // Wait up to 600ms for audio — if started, wait for it to finish
        const race = await Promise.race([
          reactionAudio,
          new Promise(r => setTimeout(() => r('timeout'), 600))
        ]);
        if (race !== 'timeout') await window.ReverseTest.Audio.waitForAudio();

        if (result.passed || result.humanFailure) {
          window.ReverseTest.Audio.sfx.success();
        } else {
          window.ReverseTest.Audio.sfx.error();
        }
      }

      await new Promise(r => setTimeout(r, 400));

      mod.cleanup();
      if (result.passed || result.humanFailure) {
        startLevel(index + 1);
      } else {
        window.ReverseTest.Goldilocks.addSuspicion(2);
        if (currentTheme === 'military') {
          updateThreat(window.ReverseTest.Goldilocks.getScore());
        }
        startLevel(index); // retry
      }
    });
  }

  function startSubmitPhase() {
    const cont = shadowRoot.getElementById('rt-challenge-container');
    if (!cont) return;
    updateProgress(LEVELS.length);
    const line = "Almost there... just click the button. Should be EASY. Right? RIGHT?!";
    typeText(line, 'rt-sgt-text', 4);
    window.ReverseTest.Audio.speak(line, 'sinister');
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

  // Preload camera iframe in the background (hidden) so getUserMedia prompt fires early
  function preloadCamera() {
    if (!CAMERA_URL) return;
    try {
      const hidden = document.createElement('iframe');
      hidden.src = `${CAMERA_URL}?gesture=WAVE&frames=35&preload=1`;
      hidden.allow = 'camera';
      hidden.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
      document.body.appendChild(hidden);
      // Remove after 3s — it's just to trigger the browser's camera permission dialog early
      setTimeout(() => { try { hidden.remove(); } catch (_) {} }, 3000);
    } catch (_) {}
  }

  async function init(shadow, host) {
    shadowRoot = shadow;
    overlayEl = host;
    currentTheme = 'normal';

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;

    shadow.innerHTML = window.ReverseTest.DecoyCaptcha.getHTML();
    shadow.prepend(link);
    await new Promise(r => { link.onload = r; link.onerror = r; });

    // Preload camera while decoy is showing — by the time user reaches camera levels,
    // getUserMedia permission is already granted and the canvas is warm
    preloadCamera();

    await new Promise((resolve) => {
      window.ReverseTest.DecoyCaptcha.run(shadow, async () => {
        shadow.innerHTML = buildOverlayHTML();
        shadow.prepend(link);
        await new Promise(r => { link.onload = r; link.onerror = r; });
        setupTracking();
        runIntro();
        resolve();
      });
    });
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Overlay = { init };
})();
