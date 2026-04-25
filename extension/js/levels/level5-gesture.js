/**
 * Level 5 — Gesture CAPTCHA (MediaPipe PoseLandmarker + HandLandmarker)
 * Uses camera.html iframe for real skeleton/landmark detection.
 * Falls back to motion detection if MediaPipe fails to load.
 */
(function () {
  const GESTURES = [
    { name: 'WAVE YOUR HAND', instruction: 'WAVE at the camera!', emoji: '👋', hint: 'Raise your hand and wave side to side' },
    { name: 'THUMBS UP', instruction: 'Give me a THUMBS UP!', emoji: '👍', hint: 'Hold a clear thumbs up to the camera' },
    { name: 'CLAP YOUR HANDS', instruction: 'CLAP YOUR HANDS!', emoji: '👏', hint: 'Bring both hands together repeatedly' },
    { name: 'NOD YOUR HEAD', instruction: 'NOD YOUR HEAD!', emoji: '🫡', hint: 'Move your head up and down' },
    { name: 'GIVE A SALUTE', instruction: 'SALUTE!', emoji: '🫡', hint: 'Raise your hand to your forehead' },
    { name: 'SHAKE YOUR HEAD', instruction: 'SHAKE YOUR HEAD!', emoji: '🙅', hint: 'Turn your head left and right' }
  ];

  const REQUIRED_FRAMES = 35;
  let container = null;
  let shadowRoot = null;
  let currentGesture = null;
  let cameraIframe = null;
  let messageHandler = null;

  // Pre-cache iframe URL
  let CAMERA_URL = '';
  try { CAMERA_URL = chrome.runtime.getURL('camera.html'); } catch (_) {}

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    currentGesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-magenta)">LEVEL 6 — BIOMETRIC VERIFICATION</div>
      <div class="rt-challenge-subtitle">
        <span style="font-size:28px">${currentGesture.emoji}</span><br>
        ${currentGesture.instruction}
      </div>
      <div class="rt-challenge-content">
        <div class="rt-gesture-wrap" id="rt-gesture-wrap">
          <div class="rt-gesture-loading" id="rt-gesture-loading">
            <div class="rt-gesture-loading-text">LOADING BIOMETRIC SCANNER...</div>
            <div class="rt-gesture-loading-bar">
              <div class="rt-gesture-loading-fill" id="rt-loading-fill" style="width:20%"></div>
            </div>
            <div id="rt-gesture-load-status" style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:8px;">
              Initializing MediaPipe PoseLandmarker + HandLandmarker...
            </div>
          </div>
          <div id="rt-gesture-active" style="display:none;position:relative;width:100%;height:100%;">
            <iframe id="rt-camera-iframe" style="width:100%;height:100%;border:none;border-radius:6px;" allow="camera"></iframe>
            <div class="rt-gesture-overlay" id="rt-gesture-overlay" style="pointer-events:none;">
              <div class="rt-gesture-progress-ring" id="rt-gesture-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent-green)" stroke-width="4"
                    stroke-dasharray="283" stroke-dashoffset="283" stroke-linecap="round"
                    id="rt-gesture-progress-circle"/>
                </svg>
              </div>
              <div class="rt-gesture-status" id="rt-gesture-status">Perform: ${currentGesture.name}</div>
            </div>
            <!-- Detection info -->
            <div id="rt-detect-info" style="position:absolute;bottom:8px;left:8px;right:8px;
              font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);
              text-shadow:0 0 4px rgba(0,0,0,0.8);z-index:5;display:flex;justify-content:space-between;">
              <span id="rt-detect-pose">POSE: —</span>
              <span id="rt-detect-hands">HANDS: —</span>
              <span id="rt-detect-score">SCORE: 0%</span>
            </div>
          </div>
        </div>
        <div class="text-center mt-8" style="font-size:11px;color:var(--text-dim);">
          ${currentGesture.hint} · Skeleton overlay powered by MediaPipe · 100% local
        </div>
      </div>
    `;

    setupIframe();
  }

  function setupIframe() {
    const iframe = shadowRoot.getElementById('rt-camera-iframe');
    const loadingEl = shadowRoot.getElementById('rt-gesture-loading');
    const activeEl = shadowRoot.getElementById('rt-gesture-active');
    const fillEl = shadowRoot.getElementById('rt-loading-fill');
    const statusEl = shadowRoot.getElementById('rt-gesture-load-status');

    if (!iframe || !CAMERA_URL) return;

    const url = `${CAMERA_URL}?gesture=${encodeURIComponent(currentGesture.name)}&frames=${REQUIRED_FRAMES}`;
    iframe.src = url;

    messageHandler = (e) => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data;
      if (!data?.event) return;

      switch (data.event) {
        case 'ready':
          if (fillEl) fillEl.style.width = '80%';
          if (statusEl) statusEl.textContent = 'MediaPipe loaded! Requesting camera...';
          // Tell iframe to start camera
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
          if (statusEl) {
            statusEl.textContent = `Camera error: ${data.message}`;
            statusEl.style.color = 'var(--accent-red)';
          }
          // Show skip button
          if (loadingEl) {
            loadingEl.innerHTML += `
              <button class="rt-submit-btn" id="rt-gesture-skip" style="margin-top:12px;font-size:13px;">
                SKIP (+15 suspicion)
              </button>`;
            const skipBtn = shadowRoot.getElementById('rt-gesture-skip');
            if (skipBtn) skipBtn.addEventListener('click', () => {
              window.ReverseTest.Goldilocks.addSuspicion(15);
              container.dispatchEvent(new CustomEvent('level-complete', {
                detail: { passed: true, speedFactor: 0.3, perfect: false, skipped: true }
              }));
            });
          }
          break;

        case 'error':
          // MediaPipe failed to load — show skip
          if (statusEl) {
            statusEl.textContent = `MediaPipe error: ${data.message}`;
            statusEl.style.color = 'var(--accent-red)';
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
    const circleEl = shadowRoot.getElementById('rt-gesture-progress-circle');
    const statusEl = shadowRoot.getElementById('rt-gesture-status');
    const poseEl = shadowRoot.getElementById('rt-detect-pose');
    const handsEl = shadowRoot.getElementById('rt-detect-hands');
    const scoreEl = shadowRoot.getElementById('rt-detect-score');

    if (circleEl) {
      circleEl.setAttribute('stroke-dashoffset', String(283 * (1 - progress)));
      circleEl.setAttribute('stroke',
        progress > 0.7 ? '#10b981' : progress > 0.3 ? '#f59e0b' : '#06b6d4');
    }

    if (statusEl) {
      statusEl.textContent = data.detected
        ? `GESTURE DETECTED — ${Math.round(progress * 100)}%`
        : `Perform: ${currentGesture.name}`;
      statusEl.style.color = data.detected ? 'var(--accent-green)' : 'var(--accent-cyan)';
    }

    if (poseEl) poseEl.textContent = `POSE: ${data.hasPose ? '✓' : '—'}`;
    if (handsEl) handsEl.textContent = `HANDS: ${data.hasHands ? '✓' : '—'}`;
    if (scoreEl) scoreEl.textContent = `SCORE: ${Math.round(progress * 100)}%`;
  }

  function onComplete() {
    const statusEl = shadowRoot.getElementById('rt-gesture-status');
    if (statusEl) { statusEl.textContent = 'GESTURE VERIFIED ✓'; statusEl.style.color = 'var(--accent-green)'; }
    window.ReverseTest.Audio.sfx.success();

    const totalTime = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
    setTimeout(() => {
      container.dispatchEvent(new CustomEvent('level-complete', {
        detail: { passed: true, speedFactor: totalTime < 4 ? 0.6 : 0.2, perfect: false, elapsed: totalTime }
      }));
    }, 800);
  }

  function cleanup() {
    if (messageHandler) window.removeEventListener('message', messageHandler);
    if (cameraIframe) {
      try { cameraIframe.contentWindow.postMessage({ cmd: 'stop' }, '*'); } catch (_) {}
    }
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level5 = { render, cleanup };
})();
