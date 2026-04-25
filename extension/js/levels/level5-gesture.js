/**
 * Level 5 — Body/Hand Gesture CAPTCHA (MediaPipe)
 * "PROVE YOUR MEAT BODY IS REAL!"
 *
 * Uses MediaPipe Pose + Hand Landmarker running locally in the browser.
 * Gemma 4 picks the gesture; fallback pool if server unavailable.
 * User must hold the pose for 2s. Goldilocks checks if they did it "too fast".
 */
(function () {
  // ── Fallback gesture pool (used when Gemma is unavailable) ──
  const GESTURES = [
    {
      name: 'THUMBS UP',
      instruction: 'Hold up your THUMB where I can see it!',
      emoji: '👍',
      detect: (pose, hands, handedness) => {
        if (!hands.length) return false;
        for (let i = 0; i < hands.length; i++) {
          const h = hands[i];
          // Thumb tip (4) above thumb IP (3) and MCP (2), other fingers curled
          if (h[4].y < h[3].y && h[4].y < h[2].y &&
              h[8].y > h[6].y && h[12].y > h[10].y) return true;
        }
        return false;
      }
    },
    {
      name: 'PEACE SIGN',
      instruction: 'Show me a PEACE SIGN, you suspicious entity!',
      emoji: '✌️',
      detect: (pose, hands) => {
        if (!hands.length) return false;
        for (const h of hands) {
          // Index (8) and middle (12) extended, ring (16) and pinky (20) curled
          const indexUp = h[8].y < h[6].y;
          const middleUp = h[12].y < h[10].y;
          const ringDown = h[16].y > h[14].y;
          const pinkyDown = h[20].y > h[18].y;
          if (indexUp && middleUp && ringDown && pinkyDown) return true;
        }
        return false;
      }
    },
    {
      name: 'HANDS UP',
      instruction: 'Put your HANDS UP! This is a verification!',
      emoji: '🙌',
      detect: (pose, hands) => {
        if (!pose) return false;
        // Both wrists (15, 16) above shoulders (11, 12)
        const lWrist = pose[15], rWrist = pose[16];
        const lShoulder = pose[11], rShoulder = pose[12];
        if (!lWrist || !rWrist || !lShoulder || !rShoulder) return false;
        return lWrist.y < lShoulder.y && rWrist.y < rShoulder.y;
      }
    },
    {
      name: 'T-POSE',
      instruction: 'Arms OUT to the sides! T-POSE! NOW!',
      emoji: '🤸',
      detect: (pose) => {
        if (!pose) return false;
        // Wrists (15,16) roughly at shoulder height, spread wide
        const lW = pose[15], rW = pose[16], lS = pose[11], rS = pose[12];
        if (!lW || !rW || !lS || !rS) return false;
        const shoulderWidth = Math.abs(rS.x - lS.x);
        const armSpread = Math.abs(rW.x - lW.x);
        const heightOk = Math.abs(lW.y - lS.y) < 0.15 && Math.abs(rW.y - rS.y) < 0.15;
        return armSpread > shoulderWidth * 1.8 && heightOk;
      }
    },
    {
      name: 'WAVE',
      instruction: 'WAVE at the camera. Like you MEAN it.',
      emoji: '👋',
      detect: (pose, hands) => {
        if (!pose || !hands.length) return false;
        // Hand above head (nose level)
        const nose = pose[0];
        for (const h of hands) {
          if (h[0].y < nose.y) return true; // Wrist above nose
        }
        return false;
      }
    },
    {
      name: 'FLEX',
      instruction: 'Show me your MUSCLES! FLEX those arms!',
      emoji: '💪',
      detect: (pose) => {
        if (!pose) return false;
        // Elbows (13,14) raised, wrists near shoulders (bicep curl pose)
        const lE = pose[13], rE = pose[14], lW = pose[15], rW = pose[16];
        const lS = pose[11], rS = pose[12];
        if (!lE || !rE || !lW || !rW || !lS || !rS) return false;
        const elbowsUp = lE.y < lS.y + 0.05 || rE.y < rS.y + 0.05;
        const wristNearShoulder = Math.abs(lW.y - lS.y) < 0.12 || Math.abs(rW.y - rS.y) < 0.12;
        return elbowsUp && wristNearShoulder;
      }
    }
  ];

  const HOLD_DURATION = 2000; // ms to hold pose
  let container = null;
  let shadowRoot = null;
  let currentGesture = null;
  let holdStart = 0;
  let detecting = false;
  let bridgeReady = false;
  let bridgeInjected = false;
  let onLandmarks = null;
  let videoCanvas = null;
  let videoCtx = null;

  function injectBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;
    // Inject the MediaPipe bridge as a page-level script
    const script = document.createElement('script');
    script.type = 'module';
    script.src = chrome.runtime.getURL('js/mediapipe-bridge.js');
    document.documentElement.appendChild(script);
  }

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    holdStart = 0;
    detecting = false;

    // Pick random gesture
    currentGesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-magenta)">LEVEL 5 — BIOMETRIC VERIFICATION</div>
      <div class="rt-challenge-subtitle">
        <span style="font-size:28px">${currentGesture.emoji}</span><br>
        ${currentGesture.instruction}
      </div>
      <div class="rt-challenge-content">
        <div class="rt-gesture-wrap" id="rt-gesture-wrap">
          <div class="rt-gesture-loading" id="rt-gesture-loading">
            <div class="rt-gesture-loading-text">INITIALIZING BIOMETRIC SCANNER...</div>
            <div class="rt-gesture-loading-bar"><div class="rt-gesture-loading-fill" id="rt-loading-fill"></div></div>
          </div>
          <canvas id="rt-gesture-canvas" class="rt-gesture-canvas" style="display:none"></canvas>
          <div class="rt-gesture-overlay" id="rt-gesture-overlay" style="display:none">
            <div class="rt-gesture-target" id="rt-gesture-target">${currentGesture.emoji}</div>
            <div class="rt-gesture-progress-ring" id="rt-gesture-ring">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
                <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent-green)" stroke-width="4"
                  stroke-dasharray="283" stroke-dashoffset="283" stroke-linecap="round"
                  id="rt-gesture-progress-circle"/>
              </svg>
            </div>
            <div class="rt-gesture-status" id="rt-gesture-status">Waiting for pose...</div>
          </div>
        </div>
        <div class="text-center mt-8" style="font-size:11px;color:var(--text-dim);">
          Hold the pose for 2 seconds. Your camera feed stays 100% local.
        </div>
      </div>
    `;

    // Inject bridge + start
    injectBridge();
    setupListeners();
  }

  function setupListeners() {
    // Listen for bridge ready
    const onReady = () => {
      bridgeReady = true;
      document.removeEventListener('mp-ready', onReady);
      document.dispatchEvent(new CustomEvent('mp-start'));
    };

    const onError = (e) => {
      const loadingEl = shadowRoot.getElementById('rt-gesture-loading');
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div class="rt-gesture-loading-text" style="color:var(--accent-red)">
            BIOMETRIC SCANNER OFFLINE<br>
            <span style="font-size:11px;color:var(--text-dim)">${e.detail?.error || 'Camera or MediaPipe unavailable'}</span>
          </div>
          <button class="rt-submit-btn mt-16" id="rt-gesture-skip">SKIP (you get +15 suspicion)</button>
        `;
        const skipBtn = shadowRoot.getElementById('rt-gesture-skip');
        if (skipBtn) {
          skipBtn.addEventListener('click', () => {
            window.ReverseTest.Goldilocks.addSuspicion(15);
            container.dispatchEvent(new CustomEvent('level-complete', {
              detail: { passed: true, speedFactor: 0.3, perfect: false, skipped: true }
            }));
          });
        }
      }
    };

    const onCameraReady = (e) => {
      const loadingEl = shadowRoot.getElementById('rt-gesture-loading');
      const canvasEl = shadowRoot.getElementById('rt-gesture-canvas');
      const overlayEl = shadowRoot.getElementById('rt-gesture-overlay');
      if (loadingEl) loadingEl.style.display = 'none';
      if (canvasEl) {
        canvasEl.style.display = 'block';
        canvasEl.width = e.detail?.videoWidth || 640;
        canvasEl.height = e.detail?.videoHeight || 480;
        videoCanvas = canvasEl;
        videoCtx = canvasEl.getContext('2d');
      }
      if (overlayEl) overlayEl.style.display = 'flex';
      detecting = true;
    };

    onLandmarks = (e) => {
      if (!detecting) return;
      const { pose, hands, handedness, videoWidth, videoHeight } = e.detail;

      // Draw camera feed placeholder (skeleton on black)
      drawSkeleton(pose, hands, videoWidth, videoHeight);

      // Check gesture
      const detected = currentGesture.detect(pose, hands, handedness);
      const statusEl = shadowRoot.getElementById('rt-gesture-status');
      const circleEl = shadowRoot.getElementById('rt-gesture-progress-circle');
      const targetEl = shadowRoot.getElementById('rt-gesture-target');

      if (detected) {
        if (holdStart === 0) holdStart = performance.now();
        const elapsed = performance.now() - holdStart;
        const progress = Math.min(elapsed / HOLD_DURATION, 1);

        // Update progress ring
        if (circleEl) {
          circleEl.setAttribute('stroke-dashoffset', String(283 * (1 - progress)));
        }
        if (statusEl) statusEl.textContent = `HOLD IT! ${((1 - progress) * 2).toFixed(1)}s...`;
        if (targetEl) targetEl.style.transform = `scale(${1 + progress * 0.3})`;

        if (progress >= 1) {
          // SUCCESS
          detecting = false;
          document.dispatchEvent(new CustomEvent('mp-stop'));
          if (statusEl) {
            statusEl.textContent = 'POSE VERIFIED ✓';
            statusEl.style.color = 'var(--accent-green)';
          }
          if (targetEl) targetEl.style.filter = 'drop-shadow(0 0 20px var(--accent-green))';

          window.ReverseTest.Audio.sfx.success();

          const totalTime = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
          setTimeout(() => {
            container.dispatchEvent(new CustomEvent('level-complete', {
              detail: {
                passed: true,
                speedFactor: totalTime < 3 ? 0.8 : totalTime < 6 ? 0.4 : 0.2,
                perfect: totalTime < 2.5, // Too fast = suspicious
                elapsed: totalTime
              }
            }));
          }, 800);
        }
      } else {
        // Reset hold
        if (holdStart > 0) {
          holdStart = 0;
          if (circleEl) circleEl.setAttribute('stroke-dashoffset', '283');
          if (targetEl) targetEl.style.transform = 'scale(1)';
        }
        if (statusEl) statusEl.textContent = `Show me: ${currentGesture.name}`;
      }
    };

    document.addEventListener('mp-ready', onReady);
    document.addEventListener('mp-error', onError);
    document.addEventListener('mp-camera-ready', onCameraReady);
    document.addEventListener('mp-landmarks', onLandmarks);

    // If bridge was already loaded from a previous level attempt
    if (bridgeReady) {
      document.dispatchEvent(new CustomEvent('mp-start'));
    }

    // Animate loading bar
    const fillEl = shadowRoot.getElementById('rt-loading-fill');
    if (fillEl) {
      let w = 0;
      const loadInterval = setInterval(() => {
        w += 2 + Math.random() * 3;
        if (w > 90 && !bridgeReady) w = 90; // Stall at 90% until ready
        if (bridgeReady) w = 100;
        fillEl.style.width = Math.min(w, 100) + '%';
        if (w >= 100) clearInterval(loadInterval);
      }, 100);
    }
  }

  function drawSkeleton(pose, hands, vw, vh) {
    if (!videoCtx || !videoCanvas) return;
    const w = videoCanvas.width;
    const h = videoCanvas.height;

    // Clear with dark background
    videoCtx.fillStyle = '#0a0e17';
    videoCtx.fillRect(0, 0, w, h);

    // Grid lines for military scanner feel
    videoCtx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
    videoCtx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      videoCtx.beginPath(); videoCtx.moveTo(x, 0); videoCtx.lineTo(x, h); videoCtx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      videoCtx.beginPath(); videoCtx.moveTo(0, y); videoCtx.lineTo(w, y); videoCtx.stroke();
    }

    // Draw pose skeleton
    if (pose) {
      const POSE_CONNECTIONS = [
        [11,12],[11,13],[13,15],[12,14],[14,16],
        [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28]
      ];
      videoCtx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
      videoCtx.lineWidth = 2;
      for (const [a, b] of POSE_CONNECTIONS) {
        if (pose[a] && pose[b]) {
          videoCtx.beginPath();
          videoCtx.moveTo(pose[a].x * w, pose[a].y * h);
          videoCtx.lineTo(pose[b].x * w, pose[b].y * h);
          videoCtx.stroke();
        }
      }
      // Draw joints
      for (let i = 0; i < pose.length; i++) {
        if (!pose[i] || pose[i].visibility < 0.3) continue;
        videoCtx.fillStyle = i >= 15 && i <= 22 ? '#10b981' : '#06b6d4';
        videoCtx.beginPath();
        videoCtx.arc(pose[i].x * w, pose[i].y * h, 4, 0, Math.PI * 2);
        videoCtx.fill();
      }
    }

    // Draw hand landmarks
    for (const hand of (hands || [])) {
      const HAND_CONNECTIONS = [
        [0,1],[1,2],[2,3],[3,4],
        [0,5],[5,6],[6,7],[7,8],
        [5,9],[9,10],[10,11],[11,12],
        [9,13],[13,14],[14,15],[15,16],
        [13,17],[17,18],[18,19],[19,20],[0,17]
      ];
      videoCtx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
      videoCtx.lineWidth = 1.5;
      for (const [a, b] of HAND_CONNECTIONS) {
        if (hand[a] && hand[b]) {
          videoCtx.beginPath();
          videoCtx.moveTo(hand[a].x * w, hand[a].y * h);
          videoCtx.lineTo(hand[b].x * w, hand[b].y * h);
          videoCtx.stroke();
        }
      }
      for (const pt of hand) {
        videoCtx.fillStyle = '#f59e0b';
        videoCtx.beginPath();
        videoCtx.arc(pt.x * w, pt.y * h, 3, 0, Math.PI * 2);
        videoCtx.fill();
      }
    }

    // Scanner sweep effect
    const sweepY = (Date.now() % 3000) / 3000 * h;
    videoCtx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
    videoCtx.lineWidth = 2;
    videoCtx.beginPath();
    videoCtx.moveTo(0, sweepY);
    videoCtx.lineTo(w, sweepY);
    videoCtx.stroke();
  }

  function cleanup() {
    detecting = false;
    document.dispatchEvent(new CustomEvent('mp-stop'));
    if (onLandmarks) document.removeEventListener('mp-landmarks', onLandmarks);
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level5 = { render, cleanup };
})();
