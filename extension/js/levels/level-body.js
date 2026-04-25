/**
 * Full Body Camera Level — uses camera.html iframe with MediaPipe.
 * Requires larger body movements (jumping jacks, squats, etc.).
 * Higher threshold than gesture level.
 */
(function () {
  const ACTIONS = [
    { name: 'JUMPING JACKS', instruction: 'DO JUMPING JACKS! Full body!', emoji: '🏋️', hint: 'Stand back, do jumping jacks' },
    { name: 'SQUATS', instruction: 'DROP AND SQUAT! Up and down!', emoji: '🦵', hint: 'Squat down and stand up' },
    { name: 'ARM CIRCLES', instruction: 'BIG ARM CIRCLES! Like a HELICOPTER!', emoji: '🚁', hint: 'Extend arms and rotate' },
    { name: 'MARCH IN PLACE', instruction: 'MARCH! Left right left right!', emoji: '🪖', hint: 'Lift knees high, march' }
  ];

  const REQUIRED_FRAMES = 50;
  let container = null;
  let shadowRoot = null;
  let currentAction = null;
  let messageHandler = null;
  let lowScoreStreak = 0;

  let CAMERA_URL = '';
  try { CAMERA_URL = chrome.runtime.getURL('camera.html'); } catch (_) {}

  const YELLS = [
    "I SAID MOVE! Are you a STATUE?!",
    "DID I SAY STOP?! KEEP GOING!",
    "MORE! Put some EFFORT in!",
    "FASTER! You move like a LOADING BAR!",
    "My WEBCAM has seen more movement from SCREEN SAVERS!"
  ];

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    lowScoreStreak = 0;
    currentAction = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-red)">PHYSICAL VERIFICATION</div>
      <div class="rt-challenge-subtitle">
        <span style="font-size:28px">${currentAction.emoji}</span><br>
        ${currentAction.instruction}
      </div>
      <div class="rt-challenge-content">
        <div class="rt-gesture-wrap" id="rt-body-wrap">
          <div class="rt-gesture-loading" id="rt-body-loading">
            <div class="rt-gesture-loading-text">
              FULL BODY SCAN REQUIRED<br>
              <span style="font-size:11px;color:var(--text-dim)">Stand back so your body is visible</span>
            </div>
            <div class="rt-gesture-loading-bar">
              <div class="rt-gesture-loading-fill" id="rt-body-fill" style="width:20%"></div>
            </div>
            <div id="rt-body-load-status" style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:8px;">
              Loading PoseLandmarker...
            </div>
          </div>
          <div id="rt-body-active" style="display:none;position:relative;width:100%;height:100%;">
            <iframe id="rt-body-iframe" style="width:100%;height:100%;border:none;border-radius:6px;" allow="camera"></iframe>
            <div class="rt-gesture-overlay" style="pointer-events:none;">
              <div class="rt-gesture-progress-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent-green)" stroke-width="4"
                    stroke-dasharray="283" stroke-dashoffset="283" stroke-linecap="round"
                    id="rt-body-progress-circle"/>
                </svg>
              </div>
              <div class="rt-gesture-status" id="rt-body-status">Perform: ${currentAction.name}</div>
            </div>
            
            <!-- Reference Animation -->
            <div class="rt-reference-anim rt-anim-${currentAction.name.replace(/\s+/g, '-').toLowerCase()}">
              <div class="stick-head"></div>
              <div class="stick-torso"></div>
              <div class="stick-arm-l"></div>
              <div class="stick-arm-r"></div>
              <div class="stick-leg-l"></div>
              <div class="stick-leg-r"></div>
            </div>

            <div id="rt-body-yell" style="position:absolute;top:8px;left:8px;right:8px;
              font-family:var(--font-mono);font-size:11px;color:var(--accent-red);
              text-align:center;text-shadow:0 0 8px rgba(255,0,0,0.5);z-index:5;min-height:16px;"></div>
            <div style="position:absolute;bottom:8px;left:8px;right:8px;
              font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);
              text-shadow:0 0 4px rgba(0,0,0,0.8);z-index:5;display:flex;justify-content:space-between;">
              <span id="rt-body-pose">POSE: —</span>
              <span id="rt-body-score">SCORE: 0%</span>
            </div>
          </div>
        </div>
        <div class="text-center mt-8" style="font-size:11px;color:var(--text-dim);">
          ${currentAction.hint} · Full body skeleton tracking · 100% local
        </div>
      </div>
    `;

    setupIframe();
  }

  function setupIframe() {
    const iframe = shadowRoot.getElementById('rt-body-iframe');
    const loadingEl = shadowRoot.getElementById('rt-body-loading');
    const activeEl = shadowRoot.getElementById('rt-body-active');
    const fillEl = shadowRoot.getElementById('rt-body-fill');
    const statusEl = shadowRoot.getElementById('rt-body-load-status');
    if (!iframe || !CAMERA_URL) return;

    iframe.src = `${CAMERA_URL}?gesture=${encodeURIComponent(currentAction.name)}&frames=${REQUIRED_FRAMES}`;

    messageHandler = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (!data?.event) return;

      switch (data.event) {
        case 'ready':
          if (fillEl) fillEl.style.width = '80%';
          if (statusEl) statusEl.textContent = 'MediaPipe loaded! Requesting camera...';
          iframe.contentWindow.postMessage({ cmd: 'start' }, '*');
          break;
        case 'camera-started':
          if (fillEl) fillEl.style.width = '100%';
          setTimeout(() => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (activeEl) activeEl.style.display = 'block';
          }, 300);
          break;
        case 'camera-error':
        case 'error':
          if (loadingEl) {
            loadingEl.innerHTML = `
              <div class="rt-gesture-loading-text" style="color:var(--accent-red)">
                BODY SCANNER OFFLINE<br>
                <span style="font-size:11px;color:var(--text-dim)">${data.message}</span>
              </div>
              <button class="rt-submit-btn" id="rt-body-skip" style="margin-top:12px;font-size:13px;">SKIP (+20 suspicion)</button>`;
            const skipBtn = shadowRoot.getElementById('rt-body-skip');
            if (skipBtn) skipBtn.addEventListener('click', () => {
              window.ReverseTest.Goldilocks.addSuspicion(20);
              container.dispatchEvent(new CustomEvent('level-complete', {
                detail: { passed: true, speedFactor: 0.3, perfect: false, skipped: true }
              }));
            });
          }
          break;
        case 'progress':
          updateProgress(data);
          break;
        case 'complete':
          onComplete();
          break;
      }
    };
    window.addEventListener('message', messageHandler);
  }

  function updateProgress(data) {
    const progress = data.value || 0;
    const circleEl = shadowRoot.getElementById('rt-body-progress-circle');
    const statusEl = shadowRoot.getElementById('rt-body-status');
    const poseEl = shadowRoot.getElementById('rt-body-pose');
    const scoreEl = shadowRoot.getElementById('rt-body-score');

    if (circleEl) {
      circleEl.setAttribute('stroke-dashoffset', String(283 * (1 - progress)));
      circleEl.setAttribute('stroke', progress > 0.7 ? '#10b981' : progress > 0.3 ? '#f59e0b' : '#06b6d4');
    }
    if (statusEl) {
      statusEl.textContent = data.detected ? `RECORDING... ${Math.round(progress * 100)}%` : `Perform: ${currentAction.name}`;
      statusEl.style.color = data.detected ? 'var(--accent-green)' : 'var(--accent-cyan)';
    }
    if (poseEl) poseEl.textContent = `POSE: ${data.hasPose ? '✓ TRACKING' : '— NOT FOUND'}`;
    if (scoreEl) scoreEl.textContent = `SCORE: ${Math.round(progress * 100)}%`;

    // Yell if no progress
    if (!data.detected) {
      lowScoreStreak++;
      if (lowScoreStreak > 90) { // ~3 seconds at 30fps
        const yellEl = shadowRoot.getElementById('rt-body-yell');
        if (yellEl) {
          yellEl.textContent = YELLS[Math.floor(Math.random() * YELLS.length)];
          lowScoreStreak = 0;
          setTimeout(() => { if (yellEl) yellEl.textContent = ''; }, 2000);
        }
      }
    } else {
      lowScoreStreak = 0;
    }
  }

  function onComplete() {
    const statusEl = shadowRoot.getElementById('rt-body-status');
    if (statusEl) { statusEl.textContent = 'PHYSICAL VERIFICATION COMPLETE ✓'; statusEl.style.color = 'var(--accent-green)'; }
    window.ReverseTest.Audio.sfx.success();
    const totalTime = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
    setTimeout(() => {
      container.dispatchEvent(new CustomEvent('level-complete', {
        detail: { passed: true, speedFactor: totalTime < 5 ? 0.5 : 0.15, perfect: false, elapsed: totalTime }
      }));
    }, 800);
  }

  function cleanup() {
    if (messageHandler) window.removeEventListener('message', messageHandler);
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.LevelBody = { render, cleanup };
})();
