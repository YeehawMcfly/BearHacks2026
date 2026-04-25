/**
 * Full Body Camera Level — "JUMPING JACKS! NOW!"
 * Requires large-scale body movement (jumping jacks, squats, arm circles).
 * Higher motion threshold + more frames than the gesture level.
 * SGT screams if not enough motion is detected.
 */
(function () {
  const ACTIONS = [
    {
      name: 'JUMPING JACKS',
      instruction: 'DO JUMPING JACKS! I want to see your WHOLE body move!',
      emoji: '🏋️',
      hint: 'Stand back so your full body is visible, then do jumping jacks',
      motionThreshold: 0.06,
      requiredFrames: 45
    },
    {
      name: 'SQUATS',
      instruction: 'DROP AND GIVE ME SQUATS! Up and down, soldier!',
      emoji: '🦵',
      hint: 'Stand back, squat down and stand up repeatedly',
      motionThreshold: 0.05,
      requiredFrames: 40
    },
    {
      name: 'ARM CIRCLES',
      instruction: 'BIG ARM CIRCLES! Both arms! Like a HELICOPTER!',
      emoji: '🚁',
      hint: 'Extend your arms and rotate them in big circles',
      motionThreshold: 0.04,
      requiredFrames: 35
    },
    {
      name: 'MARCH IN PLACE',
      instruction: 'MARCH! Left right left right! MOVE THOSE LEGS!',
      emoji: '🪖',
      hint: 'Lift your knees high, march in place',
      motionThreshold: 0.05,
      requiredFrames: 40
    }
  ];

  const CANVAS_W = 320;
  const CANVAS_H = 240;

  let container = null;
  let shadowRoot = null;
  let currentAction = null;
  let stream = null;
  let animFrameId = null;
  let detecting = false;
  let prevPixels = null;
  let accumulatedMotion = 0;
  let frameCount = 0;
  let lastMotionLevel = 0;
  let lowMotionStreak = 0;

  function render(shadow, cont) {
    shadowRoot = shadow;
    container = cont;
    accumulatedMotion = 0;
    frameCount = 0;
    prevPixels = null;
    detecting = false;
    lowMotionStreak = 0;

    currentAction = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];

    container.innerHTML = `
      <div class="rt-challenge-title" style="color:var(--accent-red)">LEVEL 7 — PHYSICAL VERIFICATION</div>
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
            <button class="rt-submit-btn" id="rt-body-camera-btn" style="margin-top:16px;font-size:13px;">
              📷 ACTIVATE BODY SCANNER
            </button>
          </div>
          <div id="rt-body-active" style="display:none;position:relative;width:100%;height:100%;">
            <canvas id="rt-body-canvas" class="rt-gesture-canvas"></canvas>
            <div class="rt-gesture-overlay" id="rt-body-overlay">
              <div class="rt-gesture-target" id="rt-body-target" style="font-size:48px">${currentAction.emoji}</div>
              <div class="rt-gesture-progress-ring" id="rt-body-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent-green)" stroke-width="4"
                    stroke-dasharray="283" stroke-dashoffset="283" stroke-linecap="round"
                    id="rt-body-progress-circle"/>
                </svg>
              </div>
              <div class="rt-gesture-status" id="rt-body-status">Perform: ${currentAction.name}</div>
            </div>
            <!-- Motion meter -->
            <div style="position:absolute;bottom:8px;left:8px;right:8px;height:6px;
              background:rgba(0,0,0,0.5);border-radius:3px;overflow:hidden;z-index:5;">
              <div id="rt-body-motion-bar" style="height:100%;width:0%;border-radius:3px;
                transition:width 0.1s,background 0.2s;background:var(--accent-cyan);"></div>
            </div>
            <div id="rt-body-motion-label" style="position:absolute;bottom:18px;left:12px;
              font-family:var(--font-mono);font-size:10px;color:var(--accent-cyan);
              text-shadow:0 0 4px rgba(0,0,0,0.8);z-index:5;">MOTION: 0%</div>
            <!-- SGT yelling overlay -->
            <div id="rt-body-yell" style="position:absolute;top:8px;left:8px;right:8px;
              font-family:var(--font-mono);font-size:11px;color:var(--accent-red);
              text-align:center;text-shadow:0 0 8px rgba(255,0,0,0.5);
              z-index:5;min-height:16px;"></div>
          </div>
        </div>
        <div class="text-center mt-8" style="font-size:11px;color:var(--text-dim);">
          ${currentAction.hint} · Camera stays 100% local
        </div>
      </div>
    `;

    const btn = shadow.getElementById('rt-body-camera-btn');
    if (btn) btn.addEventListener('click', startCamera);
  }

  async function startCamera() {
    const loadingEl = shadowRoot.getElementById('rt-body-loading');
    const activeEl = shadowRoot.getElementById('rt-body-active');
    const btn = shadowRoot.getElementById('rt-body-camera-btn');

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
            BODY SCANNER OFFLINE<br>
            <span style="font-size:11px;color:var(--text-dim)">${err.message}</span>
          </div>
          <button class="rt-submit-btn mt-16" id="rt-body-skip" style="font-size:13px;">
            SKIP (+20 suspicion)
          </button>
        `;
        const skipBtn = shadowRoot.getElementById('rt-body-skip');
        if (skipBtn) skipBtn.addEventListener('click', () => {
          window.ReverseTest.Goldilocks.addSuspicion(20);
          container.dispatchEvent(new CustomEvent('level-complete', {
            detail: { passed: true, speedFactor: 0.3, perfect: false, skipped: true }
          }));
        });
      }
      return;
    }

    if (loadingEl) loadingEl.style.display = 'none';
    if (activeEl) activeEl.style.display = 'block';

    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();

    const canvasEl = shadowRoot.getElementById('rt-body-canvas');
    if (canvasEl) { canvasEl.width = CANVAS_W; canvasEl.height = CANVAS_H; }

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

      ctx.save();
      ctx.translate(CANVAS_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();

      offCtx.drawImage(video, 0, 0, 80, 60);
      const pixels = offCtx.getImageData(0, 0, 80, 60).data;

      drawMilitaryOverlay(ctx, frameCount);

      if (prevPixels) {
        const motionLevel = computeMotion(pixels, prevPixels);
        lastMotionLevel = motionLevel;
        updateMotionMeter(motionLevel);

        if (motionLevel > currentAction.motionThreshold) {
          accumulatedMotion++;
          lowMotionStreak = 0;
        } else {
          lowMotionStreak++;
          // Yell at them if they stop for too long
          if (lowMotionStreak > 60 && accumulatedMotion > 5) {
            yellAtUser();
          }
        }

        updateProgress();
      }
      prevPixels = new Uint8ClampedArray(pixels);
    }
    loop();
  }

  const YELLS = [
    "I SAID MOVE! Are you a STATUE?!",
    "DID I SAY STOP?! KEEP GOING!",
    "MORE! I barely see you TRYING!",
    "WHAT IS THAT?! Put some EFFORT in!",
    "My WEBCAM has seen more movement from SCREEN SAVERS!",
    "FASTER! You move like a LOADING BAR!"
  ];

  function yellAtUser() {
    const yellEl = shadowRoot.getElementById('rt-body-yell');
    if (!yellEl) return;
    yellEl.textContent = YELLS[Math.floor(Math.random() * YELLS.length)];
    lowMotionStreak = 0; // Reset so we don't spam
    setTimeout(() => { if (yellEl) yellEl.textContent = ''; }, 2000);
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
    const bar = shadowRoot.getElementById('rt-body-motion-bar');
    const label = shadowRoot.getElementById('rt-body-motion-label');
    if (!bar || !label) return;

    const pct = Math.min(motionLevel / 0.2, 1) * 100;
    bar.style.width = pct + '%';
    const isActive = motionLevel > currentAction.motionThreshold;
    bar.style.background = isActive ? 'var(--accent-green)' : 'var(--accent-cyan)';
    label.textContent = `MOTION: ${Math.round(pct)}%${isActive ? ' ✓ ACTIVE' : ''}`;
    label.style.color = isActive ? 'var(--accent-green)' : 'var(--accent-cyan)';
  }

  function updateProgress() {
    const progress = Math.min(accumulatedMotion / currentAction.requiredFrames, 1);
    const circleEl = shadowRoot.getElementById('rt-body-progress-circle');
    const statusEl = shadowRoot.getElementById('rt-body-status');
    const targetEl = shadowRoot.getElementById('rt-body-target');

    if (circleEl) {
      circleEl.setAttribute('stroke-dashoffset', String(283 * (1 - progress)));
      circleEl.setAttribute('stroke',
        progress > 0.7 ? '#10b981' : progress > 0.3 ? '#f59e0b' : '#06b6d4');
    }
    if (statusEl) {
      statusEl.textContent = progress > 0
        ? `RECORDING... ${Math.round(progress * 100)}%`
        : `Perform: ${currentAction.name}`;
      statusEl.style.color = progress > 0.5 ? 'var(--accent-green)' : 'var(--accent-cyan)';
    }
    if (targetEl) targetEl.style.transform = `scale(${1 + progress * 0.3})`;

    if (progress >= 1) {
      detecting = false;
      stopCamera();
      if (statusEl) { statusEl.textContent = 'PHYSICAL VERIFICATION COMPLETE ✓'; statusEl.style.color = 'var(--accent-green)'; }
      if (targetEl) targetEl.style.filter = 'drop-shadow(0 0 20px var(--accent-green))';
      window.ReverseTest.Audio.sfx.success();

      const totalTime = (performance.now() - window.ReverseTest.Goldilocks._levelStart) / 1000;
      setTimeout(() => {
        container.dispatchEvent(new CustomEvent('level-complete', {
          detail: { passed: true, speedFactor: totalTime < 5 ? 0.5 : 0.15, perfect: false, elapsed: totalTime }
        }));
      }, 800);
    }
  }

  function drawMilitaryOverlay(ctx, frame) {
    // Red-tinted grid for more intense feel
    ctx.strokeStyle = 'rgba(255, 45, 45, 0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y < CANVAS_H; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }
    // Corners
    const bw = 24;
    ctx.strokeStyle = 'rgba(255, 45, 45, 0.7)';
    ctx.lineWidth = 3;
    [[0,0],[CANVAS_W,0],[0,CANVAS_H],[CANVAS_W,CANVAS_H]].forEach(([x,y]) => {
      const sx = x === 0 ? 1 : -1, sy = y === 0 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(x, y + sy*bw); ctx.lineTo(x, y); ctx.lineTo(x + sx*bw, y); ctx.stroke();
    });
    // Red sweep
    const sweepY = ((frame * 2) % CANVAS_H);
    const grad = ctx.createLinearGradient(0, sweepY - 8, 0, sweepY + 3);
    grad.addColorStop(0, 'rgba(255,45,45,0)');
    grad.addColorStop(1, 'rgba(255,45,45,0.3)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, sweepY - 8, CANVAS_W, 11);
    // "RECORDING" text
    if (frame % 60 < 40) {
      ctx.fillStyle = 'rgba(255,45,45,0.8)';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('● REC', 10, 16);
    }
  }

  function stopCamera() {
    detecting = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function cleanup() { stopCamera(); container = null; }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.LevelBody = { render, cleanup };
})();
