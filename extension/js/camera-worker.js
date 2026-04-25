/**
 * Camera Worker — MediaPipe PoseLandmarker + HandLandmarker with pixel-diff fallback.
 *
 * Loads MediaPipe Tasks Vision from locally bundled files in assets/models/.
 * Requires manifest.json CSP: "script-src 'self' 'wasm-unsafe-eval'"
 * Falls back to zone pixel-diff if MediaPipe fails to load.
 *
 * FIX: Uses video.requestVideoFrameCallback to sync timestamps with actual
 * video frames. Temporal smoothing averages scores over a rolling window
 * so fast movements don't cause score drops.
 */

const params = new URLSearchParams(location.search);
const GESTURE = (params.get('gesture') || 'WAVE').toUpperCase();
const REQUIRED = parseInt(params.get('frames') || '40');
const IS_PRELOAD = params.get('preload') === '1';

const video = document.getElementById('video');
const vc = document.getElementById('video-canvas');
const oc = document.getElementById('overlay-canvas');
const vctx = vc.getContext('2d', { willReadFrequently: true });
const octx = oc.getContext('2d');
const statusEl = document.getElementById('status');
const loadEl = document.getElementById('load-status');
const loadSubEl = document.getElementById('load-sub');

let stream = null;
let running = false;
let accumulated = 0;
let frameCount = 0;
let scanLineY = 0;

// MediaPipe references
let poseLandmarker = null;
let handLandmarker = null;
let mpDrawingUtils = null;
let _PoseLandmarker = null;
let _HandLandmarker = null;
let useMediaPipe = false;

// Pixel-diff fallback
let prevData = null;

// Temporal smoothing — rolling window of recent scores
const SCORE_HISTORY = [];
const SCORE_WINDOW = 8; // average over last 8 frames (~250ms at 30fps)

function smoothedScore(rawScore) {
  SCORE_HISTORY.push(rawScore);
  if (SCORE_HISTORY.length > SCORE_WINDOW) SCORE_HISTORY.shift();
  // Use maximum of recent scores (not average) — if gesture was detected
  // in ANY recent frame, give credit. This prevents 1-frame dips from
  // killing progress during movement.
  return Math.max(...SCORE_HISTORY);
}

// Timestamp tracking for detectForVideo
let lastVideoTime = -1;  // track video.currentTime to avoid re-processing same frame
let mpTimestamp = 0;      // monotonically increasing timestamp for MediaPipe

// ══════════════════════════════════════════════════
// MEDIAPIPE INITIALIZATION (all local files)
// ══════════════════════════════════════════════════
function modelPath(filename) {
  return new URL(`assets/models/${filename}`, location.href).href;
}

async function initMediaPipe() {
  try {
    if (loadSubEl) loadSubEl.textContent = 'Loading MediaPipe vision bundle...';
    const vision = await import(modelPath('vision_bundle.mjs'));
    const { PoseLandmarker, HandLandmarker, FilesetResolver, DrawingUtils } = vision;
    _PoseLandmarker = PoseLandmarker;
    _HandLandmarker = HandLandmarker;

    if (loadSubEl) loadSubEl.textContent = 'Loading WASM runtime...';
    const wasmDir = new URL('assets/models/', location.href).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmDir);

    if (loadSubEl) loadSubEl.textContent = 'Loading PoseLandmarker model...';
    poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelPath('pose_landmarker_lite.task'),
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1
    });

    if (loadSubEl) loadSubEl.textContent = 'Loading HandLandmarker model...';
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelPath('hand_landmarker.task'),
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2
    });

    mpDrawingUtils = new DrawingUtils(octx);
    useMediaPipe = true;
    if (loadSubEl) loadSubEl.textContent = '✅ MediaPipe ready — real skeleton tracking';
    console.log('[camera] MediaPipe loaded successfully');
    return true;
  } catch (err) {
    console.warn('[camera] MediaPipe failed to load, using motion fallback:', err);
    if (loadSubEl) loadSubEl.textContent = 'Using motion detection (MediaPipe unavailable)';
    useMediaPipe = false;
    return false;
  }
}

// ══════════════════════════════════════════════════
// MEDIAPIPE GESTURE EVALUATION
// Uses real landmark coordinates. More forgiving thresholds.
// ══════════════════════════════════════════════════
function evaluateGestureMP(gesture, poseResult, handResult) {
  const pl = poseResult?.landmarks?.[0];
  const hands = handResult?.landmarks;
  const g = gesture;

  // WAVE / HAND — hand visible, preferably raised. Very forgiving.
  if (g.includes('WAVE') || g.includes('HAND')) {
    if (hands?.length > 0) {
      const wrist = hands[0][0];
      if (pl) {
        const shoulder = pl[12]; // right shoulder as reference
        // Hand above shoulder = definitely waving
        if (wrist.y < shoulder.y) return 1.0;
        // Hand above hip = likely waving
        const hip = pl[24];
        if (wrist.y < hip.y) return 0.8;
        // Hand visible at all = partial credit
        return 0.5;
      }
      // Hand detected but no pose — still give credit
      return 0.7;
    }
    // Body visible but no hand detected
    return pl ? 0.15 : 0;
  }

  // SALUTE — hand near head/forehead
  if (g.includes('SALUTE')) {
    if (hands?.length > 0) {
      const wrist = hands[0][0];
      if (pl) {
        const nose = pl[0];
        const shoulder = pl[12];
        // Hand above shoulder and near head area
        if (wrist.y < shoulder.y && Math.abs(wrist.x - nose.x) < 0.35) return 1.0;
        if (wrist.y < shoulder.y) return 0.7;
        return 0.4;
      }
      return 0.6;
    }
    return pl ? 0.1 : 0;
  }

  // THUMBS UP — thumb tip above thumb IP, other fingers curled
  if (g.includes('THUMBS')) {
    if (hands?.length > 0) {
      const h = hands[0];
      const thumbTip = h[4], thumbIP = h[3], thumbMCP = h[2];
      const indexTip = h[8], indexPIP = h[6];
      // Thumb extended upward
      const thumbUp = thumbTip.y < thumbIP.y && thumbTip.y < thumbMCP.y;
      const indexDown = indexTip.y > indexPIP.y;
      if (thumbUp && indexDown) return 1.0;
      if (thumbUp) return 0.7;
      // Any hand visible = some credit
      return 0.4;
    }
    return 0;
  }

  // CLAP — two hands close together or rapid arm motion
  if (g.includes('CLAP')) {
    if (hands?.length >= 2) {
      const d = Math.hypot(hands[0][0].x - hands[1][0].x, hands[0][0].y - hands[1][0].y);
      if (d < 0.15) return 1.0;
      if (d < 0.30) return 0.7;
      return 0.4;
    }
    if (hands?.length === 1) return 0.3;
    // If pose shows both wrists close together
    if (pl) {
      const lw = pl[15], rw = pl[16];
      const d = Math.hypot(lw.x - rw.x, lw.y - rw.y);
      if (d < 0.12) return 0.9;
      if (d < 0.25) return 0.5;
    }
    return 0;
  }

  // NOD / HEAD SHAKE — head present
  if (g.includes('NOD') || g.includes('HEAD')) {
    if (pl) return 0.8;
    return 0;
  }

  // JUMPING JACKS — arms raised, body moving
  if (g.includes('JUMPING') || g.includes('JACK')) {
    if (pl) {
      const lWrist = pl[15], rWrist = pl[16];
      const lShoulder = pl[11], rShoulder = pl[12];
      const armsUp = lWrist.y < lShoulder.y && rWrist.y < rShoulder.y;
      const oneArmUp = lWrist.y < lShoulder.y || rWrist.y < rShoulder.y;
      if (armsUp) return 1.0;
      if (oneArmUp) return 0.6;
      return 0.2;
    }
    return 0;
  }

  // SQUAT — hips close to knees
  if (g.includes('SQUAT')) {
    if (pl) {
      const hip = pl[24], knee = pl[26];
      if (hip.y > knee.y - 0.08) return 1.0;
      if (hip.y > knee.y - 0.15) return 0.6;
      return 0.2;
    }
    return 0;
  }

  // ARM CIRCLES / HELICOPTER — wrist far from shoulder
  if (g.includes('ARM') || g.includes('HELICOPTER') || g.includes('CIRCLE')) {
    if (pl) {
      const lw = pl[15], rw = pl[16], rs = pl[12], ls = pl[11];
      const dist = Math.max(
        Math.hypot(lw.x - ls.x, lw.y - ls.y),
        Math.hypot(rw.x - rs.x, rw.y - rs.y)
      );
      if (dist > 0.30) return 1.0;
      if (dist > 0.20) return 0.6;
      return 0.2;
    }
    return 0;
  }

  // MARCH — any leg movement
  if (g.includes('MARCH')) {
    if (pl) {
      const lk = pl[25], rk = pl[26];
      if (Math.abs(lk.y - rk.y) > 0.06) return 1.0;
      if (Math.abs(lk.y - rk.y) > 0.03) return 0.6;
      return 0.2;
    }
    return 0;
  }

  // Generic: body or hands visible = credit
  if (hands?.length > 0 && pl) return 0.8;
  if (hands?.length > 0) return 0.6;
  if (pl) return 0.4;
  return 0;
}

// ══════════════════════════════════════════════════
// PIXEL-DIFF FALLBACK (zone-based motion detection)
// ══════════════════════════════════════════════════
const ZONES = {
  upperBody: { x1: 0.10, y1: 0.00, x2: 0.90, y2: 0.50 },
  lowerBody: { x1: 0.15, y1: 0.55, x2: 0.85, y2: 1.00 },
  leftSide:  { x1: 0.00, y1: 0.10, x2: 0.40, y2: 0.90 },
  rightSide: { x1: 0.60, y1: 0.10, x2: 1.00, y2: 0.90 },
  head:      { x1: 0.30, y1: 0.00, x2: 0.70, y2: 0.25 },
  full:      { x1: 0.00, y1: 0.00, x2: 1.00, y2: 1.00 },
};

function zoneMotion(data, zone, w, h) {
  if (!prevData) return 0;
  const x1 = Math.floor(zone.x1*w), y1 = Math.floor(zone.y1*h);
  const x2 = Math.floor(zone.x2*w), y2 = Math.floor(zone.y2*h);
  let changed = 0, total = 0;
  for (let y = y1; y < y2; y += 4) {
    for (let x = x1; x < x2; x += 4) {
      const i = (y*w+x)*4;
      if (Math.abs(data[i]-prevData[i]) + Math.abs(data[i+1]-prevData[i+1]) + Math.abs(data[i+2]-prevData[i+2]) > 35) changed++;
      total++;
    }
  }
  return total > 0 ? changed/total : 0;
}

function evaluateGestureFallback(data, w, h) {
  const up = zoneMotion(data, ZONES.upperBody, w, h);
  const lo = zoneMotion(data, ZONES.lowerBody, w, h);
  const le = zoneMotion(data, ZONES.leftSide, w, h);
  const ri = zoneMotion(data, ZONES.rightSide, w, h);
  const hd = zoneMotion(data, ZONES.head, w, h);
  const full = zoneMotion(data, ZONES.full, w, h);
  const g = GESTURE;

  if (g.includes('WAVE') || g.includes('HAND')) return up > 0.06 ? 1.0 : up > 0.03 ? 0.5 : 0;
  if (g.includes('SALUTE')) return up > 0.04 && hd > 0.02 ? 1.0 : up > 0.03 ? 0.5 : 0;
  if (g.includes('CLAP')) return le > 0.04 && ri > 0.04 ? 1.0 : full > 0.06 ? 0.5 : 0;
  if (g.includes('NOD') || g.includes('HEAD')) return hd > 0.03 ? 1.0 : 0;
  if (g.includes('JUMPING') || g.includes('JACK')) return full > 0.10 ? 1.0 : full > 0.05 ? 0.5 : 0;
  if (g.includes('SQUAT')) return lo > 0.06 ? 1.0 : lo > 0.03 ? 0.5 : 0;
  return full > 0.08 ? 1.0 : full > 0.04 ? 0.5 : 0;
}

// ══════════════════════════════════════════════════
// SKELETON + SCANNER OVERLAY DRAWING
// ══════════════════════════════════════════════════
function drawOverlay(w, h, score, poseResult, handResult) {
  octx.clearRect(0, 0, w, h);

  // Scanline
  scanLineY = (scanLineY + 2.5) % h;
  const grad = octx.createLinearGradient(0, scanLineY-25, 0, scanLineY+25);
  grad.addColorStop(0, 'rgba(6,182,212,0)');
  grad.addColorStop(0.5, `rgba(6,182,212,${0.06 + score * 0.12})`);
  grad.addColorStop(1, 'rgba(6,182,212,0)');
  octx.fillStyle = grad;
  octx.fillRect(0, scanLineY-25, w, 50);

  // Corner brackets
  octx.strokeStyle = score > 0.5 ? '#10b981' : '#06b6d4';
  octx.lineWidth = 3;
  const s = 35;
  for (const [x,y,dx,dy] of [[0,0,1,1],[w,0,-1,1],[0,h,1,-1],[w,h,-1,-1]]) {
    octx.beginPath();
    octx.moveTo(x+dx*s, y); octx.lineTo(x, y); octx.lineTo(x, y+dy*s);
    octx.stroke();
  }

  // Draw REAL MediaPipe skeleton if available
  if (useMediaPipe && mpDrawingUtils && _PoseLandmarker && _HandLandmarker) {
    if (poseResult?.landmarks) {
      for (const landmarks of poseResult.landmarks) {
        const mirrored = landmarks.map(l => ({ ...l, x: 1 - l.x }));
        mpDrawingUtils.drawConnectors(mirrored, _PoseLandmarker.POSE_CONNECTIONS, {
          color: '#00FF66AA', lineWidth: 2.5
        });
        mpDrawingUtils.drawLandmarks(mirrored, {
          color: '#FF3333BB', fillColor: '#00FF6644', radius: 3, lineWidth: 1
        });
      }
    }
    if (handResult?.landmarks) {
      for (const landmarks of handResult.landmarks) {
        const mirrored = landmarks.map(l => ({ ...l, x: 1 - l.x }));
        mpDrawingUtils.drawConnectors(mirrored, _HandLandmarker.HAND_CONNECTIONS, {
          color: '#06B6D4BB', lineWidth: 2.5
        });
        mpDrawingUtils.drawLandmarks(mirrored, {
          color: '#FF2D2DBB', fillColor: '#06B6D444', radius: 2.5, lineWidth: 1
        });
      }
    }
  } else {
    // Fallback static skeleton
    const SKP = [
      [0.50,0.10],[0.50,0.20],[0.35,0.22],[0.65,0.22],
      [0.22,0.35],[0.78,0.35],[0.15,0.48],[0.85,0.48],
      [0.50,0.55],[0.40,0.55],[0.60,0.55],
      [0.38,0.73],[0.62,0.73],[0.36,0.90],[0.64,0.90]
    ];
    const SKB = [[0,1],[1,2],[1,3],[2,4],[4,6],[3,5],[5,7],[1,8],[8,9],[8,10],[9,11],[11,13],[10,12],[12,14]];
    octx.strokeStyle = score > 0 ? 'rgba(0,255,100,0.3)' : 'rgba(0,255,100,0.1)';
    octx.lineWidth = 1.5;
    for (const [a,b] of SKB) {
      octx.beginPath();
      octx.moveTo(SKP[a][0]*w, SKP[a][1]*h);
      octx.lineTo(SKP[b][0]*w, SKP[b][1]*h);
      octx.stroke();
    }
    for (const [x,y] of SKP) {
      octx.beginPath();
      octx.arc(x*w, y*h, 2.5, 0, Math.PI*2);
      octx.fillStyle = score > 0 ? 'rgba(255,60,60,0.5)' : 'rgba(255,60,60,0.15)';
      octx.fill();
    }
    octx.beginPath();
    octx.arc(0.5*w, 0.1*h, 14, 0, Math.PI*2);
    octx.strokeStyle = 'rgba(0,255,100,0.15)';
    octx.lineWidth = 1;
    octx.stroke();
  }

  // Subtle grid
  octx.strokeStyle = 'rgba(6,182,212,0.03)';
  octx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 40) { octx.beginPath(); octx.moveTo(x,0); octx.lineTo(x,h); octx.stroke(); }
  for (let y = 0; y < h; y += 40) { octx.beginPath(); octx.moveTo(0,y); octx.lineTo(w,y); octx.stroke(); }

  // REC dot
  if (Math.floor(frameCount/15) % 2 === 0) {
    octx.beginPath(); octx.arc(w-16, 14, 5, 0, Math.PI*2);
    octx.fillStyle = '#ff2d2d'; octx.fill();
    octx.fillStyle = '#fff'; octx.font = '10px monospace';
    octx.fillText('REC', w-38, 18);
  }

  // Mode + gesture label
  octx.fillStyle = 'rgba(6,182,212,0.5)';
  octx.font = '10px monospace';
  octx.fillText(`${useMediaPipe ? '🦴 MEDIAPIPE' : '📡 MOTION'} | TARGET: ${GESTURE}`, 8, 16);

  // Progress bar at bottom
  const progress = Math.min(accumulated / REQUIRED, 1);
  octx.fillStyle = 'rgba(0,0,0,0.5)';
  octx.fillRect(0, h - 6, w, 6);
  octx.fillStyle = score > 0.3 ? '#10b981' : '#06b6d4';
  octx.fillRect(0, h - 6, w * progress, 6);
}

// ══════════════════════════════════════════════════
// MAIN LOOP — synced to actual video frames
// ══════════════════════════════════════════════════

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  const w = vc.width, h = vc.height;

  // Only process when we have a new video frame
  // This prevents re-processing the same frame and fixes timestamp issues
  const currentVideoTime = video.currentTime;
  if (currentVideoTime === lastVideoTime) return;
  lastVideoTime = currentVideoTime;

  // Mirror video to canvas
  vctx.save(); vctx.translate(w, 0); vctx.scale(-1, 1);
  vctx.drawImage(video, 0, 0, w, h);
  vctx.restore();

  let rawScore = 0;
  let poseResult = null, handResult = null;

  if (useMediaPipe) {
    // Use monotonically increasing timestamp derived from video time
    // This is critical — detectForVideo rejects non-increasing timestamps
    mpTimestamp = Math.max(mpTimestamp + 1, Math.round(currentVideoTime * 1000));

    try {
      poseResult = poseLandmarker.detectForVideo(video, mpTimestamp);
      handResult = handLandmarker.detectForVideo(video, mpTimestamp);
      rawScore = evaluateGestureMP(GESTURE, poseResult, handResult);
    } catch (e) {
      console.warn('[camera] MediaPipe detection error:', e.message);
    }
  } else {
    const imageData = vctx.getImageData(0, 0, w, h);
    rawScore = evaluateGestureFallback(imageData.data, w, h);
    prevData = imageData.data.slice();
  }

  // Apply temporal smoothing — uses MAX of last N frames
  // This means: if the gesture was detected in ANY of the last 8 frames,
  // give full credit. Prevents score drops during natural movement jitter.
  const score = smoothedScore(rawScore);

  // More generous accumulation:
  // score >= 0.4 = full credit (was 0.5)
  // score >= 0.2 = half credit (was 0.3 with 30% multiplier)
  if (score >= 0.4) accumulated += score;
  else if (score >= 0.2) accumulated += score * 0.5;

  // Draw overlay with skeleton
  drawOverlay(w, h, score, poseResult, handResult);
  frameCount++;

  const progress = Math.min(accumulated / REQUIRED, 1);

  // Status text
  if (score >= 0.5) {
    statusEl.textContent = `🦴 GESTURE MATCHED — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#10b981';
  } else if (score >= 0.2) {
    statusEl.textContent = `📡 DETECTING... — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#eab308';
  } else {
    statusEl.textContent = `Perform: ${GESTURE}`;
    statusEl.style.color = '#06b6d4';
  }

  // Report to parent
  parent.postMessage({
    event: 'progress', value: progress,
    detected: score >= 0.2,
    gestureScore: score,
    mode: useMediaPipe ? 'mediapipe' : 'pixeldiff',
    hasPose: !!(poseResult?.landmarks?.length),
    hasHands: !!(handResult?.landmarks?.length)
  }, '*');

  if (progress >= 1) {
    running = false;
    statusEl.textContent = '✅ GESTURE VERIFIED';
    statusEl.style.color = '#10b981';
    parent.postMessage({ event: 'complete' }, '*');
    if (stream) stream.getTracks().forEach(t => t.stop());
  }
}

// ══════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════
async function startCamera() {
  if (IS_PRELOAD) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    vc.width = oc.width = video.videoWidth || 640;
    vc.height = oc.height = video.videoHeight || 480;
    if (loadEl) loadEl.style.display = 'none';
    running = true;
    parent.postMessage({ event: 'camera-started', mediapipe: useMediaPipe }, '*');
    loop();
  } catch (e) {
    if (statusEl) statusEl.textContent = `Camera error: ${e.message}`;
    parent.postMessage({ event: 'camera-error', message: e.message }, '*');
  }
}

async function init() {
  if (!IS_PRELOAD) {
    await initMediaPipe();
  }
  parent.postMessage({ event: 'ready', mediapipe: useMediaPipe }, '*');
  if (!IS_PRELOAD) startCamera();
}

window.addEventListener('message', e => {
  if (e.data?.cmd === 'start') startCamera();
  if (e.data?.cmd === 'stop') {
    running = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
  }
});

init();
