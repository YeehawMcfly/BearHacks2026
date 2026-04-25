/**
 * Level 5 — Body/Hand Gesture CAPTCHA
 * "PROVE YOUR MEAT BODY IS REAL!"
 *
 * Uses getUserMedia() directly. Motion detection via canvas pixel diff.
 * Progress only goes UP — never decays. Just need proof of a moving body.
 * Real-time motion meter shown for feedback.
 */
(function () {
  const GESTURES = [
    {
      name: 'WAVE YOUR HAND',
      instruction: 'WAVE at the camera! Show some MOVEMENT, maggot!',
      emoji: '👋',
      hint: 'Move your hand rapidly side to side'
    },
    {
      name: 'THUMBS UP',
      instruction: 'Give me a THUMBS UP where I can SEE it!',
      emoji: '👍',
      hint: 'Raise your thumb clearly in front of camera'
    },
    {
      name: 'CLAP YOUR HANDS',
      instruction: 'CLAP YOUR HANDS! I need to see proof of life!',
      emoji: '👏',
      hint: 'Clap your hands visibly in front of the camera'
    },
    {
      name: 'NOD YOUR HEAD',
      instruction: 'NOD YOUR HEAD! Acknowledge your sergeant!',
      emoji: '🫡',
      hint: 'Move your head up and down clearly'
    },
    {
      name: 'GIVE A SALUTE',
      instruction: 'SALUTE! Show some RESPECT for this verification system!',
      emoji: '🫡',
      hint: 'Raise your hand to your forehead, then lower it'
    },
    {
      name: 'SHAKE YOUR HEAD',
      instruction: 'SHAKE YOUR HEAD like you DISAGREE with being scanned!',
      emoji: '🙅',
      hint: 'Turn your head left and right'
    }
  ];

  // How many motion-frames to accumulate (progress only goes up, never decays)
  const REQUIRED_MOTION_FRAMES = 25;
  // Fraction of pixels that must change to count as a motion frame
  const MOTION_THRESHOLD = 0.025;

  const CANVAS_W = 320;
  const CANVAS_H = 240;

  let container = null;
  let shadowRoot = null;
  let currentGesture = null;
  let stream = null;
  let animFrameId = null;
  let detecting = false;

  // Motion tracking
  let prevPixels = null;
  let accumulatedMotion = 0; // only goes up
  let frameCount = 0;

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    accumulatedMotion = 0;
    frameCount = 0;
    prevPixels = null;
    detecting = false;

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
            <div class="rt-gesture-loading-text">REQUESTING BIOMETRIC ACCESS...</div>
            <button class="rt-submit-btn" id="rt-camera-btn" style="margin-top:16px;font-size:13px;">
              📷 ACTIVATE CAMERA
            </button>
          </div>
          <div id="rt-gesture-active" style="display:none;position:relative;width:100%;height:100%;">
            <canvas id="rt-gesture-canvas" class="rt-gesture-canvas"></canvas>
            <div class="rt-gesture-overlay" id="rt-gesture-overlay">
              <div class="rt-gesture-target" id="rt-gesture-target">${currentGesture.emoji}</div>
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
            <!-- Real-time motion meter -->
            <div id="rt-motion-meter" style="
              position:absolute;bottom:8px;left:8px;right:8px;height:6px;
              background:rgba(0,0,0,0.5);border-radius:3px;overflow:hidden;z-index:5;
            ">
              <div id="rt-motion-bar" style="
                height:100%;width:0%;border-radius:3px;
                transition:width 0.1s,background 0.2s;background:var(--accent-cyan);
              "></div>
            </div>
            <!-- Motion label -->
            <div id="rt-motion-label" style="
              position:absolute;bottom:18px;left:12px;
              font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);
              text-shadow:0 0 4px rgba(0,0,0,0.8);z-index:5;
            ">MOTION: 0%</div>
          </div>
        </div>
        <div class="text-center mt-8" style="font-size:11px;color:var(--text-dim);">
          Hint: ${currentGesture.hint} · Camera feed stays 100% local · Progress only goes up!
        </div>
      </div>
    `;

    const btn = shadow.getElementById('rt-camera-btn');
    if (btn) btn.addEventListener('click', startCamera);
  }

  async function startCamera() {
    const loadingEl = shadowRoot.getElementById('rt-gesture-loading');
    const activeEl = shadowRoot.getElementById('rt-gesture-active');
    const btn = shadowRoot.getElementById('rt-camera-btn');

    if (btn) { btn.disabled = true; btn.textContent = '⏳ ACCESSING...'; }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CANVAS_W, height: CANVAS_H, facingMode: 'user' },
        audio: false
      });
    } catch (err) {
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div class="rt-gesture-loading-text" style="color:var(--accent-red)">
            BIOMETRIC SCANNER OFFLINE<br>
            <span style="font-size:11px;color:var(--text-dim)">${err.message}</span>
          </div>
          <button class="rt-submit-btn mt-16" id="rt-gesture-skip" style="font-size:13px;">
            SKIP (+15 suspicion)
          </button>
        `;
        const skipBtn = shadowRoot.getElementById('rt-gesture-skip');
        if (skipBtn) skipBtn.addEventListener('click', () => {
          window.ReverseTest.Goldilocks.addSuspicion(15);
          container.dispatchEvent(new CustomEvent('level-complete', {
            detail: { passed: true, speedFactor: 0.3, perfect: false, skipped: true }
          }));
        });
      }
      return;
    }

    // Camera opened — switch to active view
    if (loadingEl) loadingEl.style.display = 'none';
    if (activeEl) activeEl.style.display = 'block';

    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();

    const canvasEl = shadowRoot.getElementById('rt-gesture-canvas');
    if (canvasEl) {
      canvasEl.width = CANVAS_W;
      canvasEl.height = CANVAS_H;
    }

    detecting = true;
    startDetection(video, canvasEl);
  }

  function startDetection(video, canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const offscreen = document.createElement('canvas');
    offscreen.width = 80; offscreen.height = 60;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    function loop() {
      if (!detecting) return;
      animFrameId = requestAnimationFrame(loop);
      frameCount++;

      // Draw mirrored video
      ctx.save();
      ctx.translate(CANVAS_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();

      // Downsample for motion detection
      offCtx.drawImage(video, 0, 0, 80, 60);
      const pixels = offCtx.getImageData(0, 0, 80, 60).data;

      // Scanner overlay
      drawScannerOverlay(ctx, frameCount);

      if (prevPixels) {
        const motionLevel = computeMotion(pixels, prevPixels);
        updateMotionMeter(motionLevel);

        // Only accumulate if above threshold — never decay
        if (motionLevel > MOTION_THRESHOLD) {
          accumulatedMotion++;
        }

        updateProgress();
      }
      prevPixels = new Uint8ClampedArray(pixels);
    }

    loop();
  }

  function computeMotion(curr, prev) {
    let diff = 0;
    const total = curr.length / 4;
    for (let i = 0; i < curr.length; i += 4) {
      const dl = Math.abs(curr[i] - prev[i]) +
                 Math.abs(curr[i+1] - prev[i+1]) +
                 Math.abs(curr[i+2] - prev[i+2]);
      if (dl > 40) diff++;
    }
    return diff / total;
  }

  function updateMotionMeter(motionLevel) {
    const bar = shadowRoot.getElementById('rt-motion-bar');
    const label = shadowRoot.getElementById('rt-motion-label');
    if (!bar || !label) return;

    // Scale for visual (cap at 20% pixel change = full bar)
    const pct = Math.min(motionLevel / 0.15, 1) * 100;
    bar.style.width = pct + '%';

    const isActive = motionLevel > MOTION_THRESHOLD;
    bar.style.background = isActive ? 'var(--accent-green)' : 'var(--accent-cyan)';
    label.textContent = `MOTION: ${Math.round(pct)}%${isActive ? ' ✓ DETECTED' : ''}`;
    label.style.color = isActive ? 'var(--accent-green)' : 'var(--accent-cyan)';
  }

  function updateProgress() {
    const progress = Math.min(accumulatedMotion / REQUIRED_MOTION_FRAMES, 1);

    const circleEl = shadowRoot.getElementById('rt-gesture-progress-circle');
    const statusEl = shadowRoot.getElementById('rt-gesture-status');
    const targetEl = shadowRoot.getElementById('rt-gesture-target');

    if (circleEl) {
      circleEl.setAttribute('stroke-dashoffset', String(283 * (1 - progress)));
      circleEl.setAttribute('stroke',
        progress > 0.7 ? '#10b981' : progress > 0.3 ? '#f59e0b' : '#06b6d4');
    }

    if (statusEl) {
      statusEl.textContent = progress > 0
        ? `RECORDING... ${Math.round(progress * 100)}%`
        : `Perform: ${currentGesture.name}`;
      statusEl.style.color = progress > 0.5 ? 'var(--accent-green)' : 'var(--accent-cyan)';
    }

    if (targetEl) targetEl.style.transform = `scale(${1 + progress * 0.4})`;

    if (progress >= 1) {
      detecting = false;
      stopCamera();

      if (statusEl) { statusEl.textContent = 'GESTURE VERIFIED ✓'; statusEl.style.color = 'var(--accent-green)'; }
      if (targetEl) targetEl.style.filter = 'drop-shadow(0 0 20px var(--accent-green))';
      window.ReverseTest.Audio.sfx.success();

      const totalTime = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
      setTimeout(() => {
        container.dispatchEvent(new CustomEvent('level-complete', {
          detail: {
            passed: true,
            speedFactor: totalTime < 4 ? 0.6 : 0.2,
            perfect: false,
            elapsed: totalTime
          }
        }));
      }, 800);
    }
  }

  function drawScannerOverlay(ctx, frame) {
    // Grid
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y < CANVAS_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }
    // Corner brackets
    const bw = 20;
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
    ctx.lineWidth = 2;
    [[0,0],[CANVAS_W,0],[0,CANVAS_H],[CANVAS_W,CANVAS_H]].forEach(([x,y]) => {
      const sx = x === 0 ? 1 : -1, sy = y === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x, y + sy*bw); ctx.lineTo(x, y); ctx.lineTo(x + sx*bw, y);
      ctx.stroke();
    });
    // Sweep
    const sweepY = ((frame * 3) % CANVAS_H);
    const grad = ctx.createLinearGradient(0, sweepY - 6, 0, sweepY + 2);
    grad.addColorStop(0, 'rgba(6,182,212,0)');
    grad.addColorStop(1, 'rgba(6,182,212,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, sweepY - 6, CANVAS_W, 8);
  }

  function stopCamera() {
    detecting = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function cleanup() {
    stopCamera();
    container = null;
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Level5 = { render, cleanup };
})();
