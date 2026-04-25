/**
 * Camera Worker — STRICT gesture verification.
 *
 * Uses MediaPipe GestureRecognizer (built-in classification of 7 gestures)
 * + PoseLandmarker for full-body poses. Binary scoring: either the gesture
 * matches or it doesn't. Progress DECAYS when not matching.
 *
 * Key design decisions:
 * - GestureRecognizer handles: Thumb_Up, Open_Palm (wave), Victory, Closed_Fist, Pointing_Up, ILoveYou
 * - PoseLandmarker handles: jumping jacks, squat, march, arm circles, salute
 * - Score is BINARY: 1.0 (match) or 0.0 (no match). No partial credit.
 * - Progress decays at 0.3/frame when not matching (prevents idle wins).
 * - Distance check: if body landmarks indicate user is too close, show warning.
 */

const params = new URLSearchParams(location.search);
const GESTURE = (params.get('gesture') || 'WAVE').toUpperCase();
const REQUIRED = parseInt(params.get('frames') || '60');
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
let gestureRecognizer = null;
let poseLandmarker = null;
let mpDrawingUtils = null;
let _PoseLandmarker = null;
let _HandLandmarker = null;  // for drawing connections
let useMediaPipe = false;

// Pixel-diff fallback
let prevData = null;

// Motion tracking for dynamic gestures (wave oscillation, nod, etc.)
let prevWristX = null;
let prevNoseY = null;
let prevNoseX = null;
let waveOscillations = 0;
let lastWaveDir = 0;
let nodOscillations = 0;
let lastNodDir = 0;
let shakeOscillations = 0;
let lastShakeDir = 0;

// Consecutive match counter — require N consecutive matching frames
let consecutiveMatches = 0;
const MIN_CONSECUTIVE = 3; // need 3 frames in a row to count

// Timestamp tracking
let lastVideoTime = -1;
let mpTimestamp = 0;

// ══════════════════════════════════════════════════
// MAP GESTURE NAMES TO RECOGNIZER CATEGORIES
// ══════════════════════════════════════════════════
// GestureRecognizer outputs: None, Closed_Fist, Open_Palm, Pointing_Up,
// Thumb_Down, Thumb_Up, Victory, ILoveYou
const GESTURE_TO_CATEGORY = {
  'WAVE':       ['Open_Palm'],
  'HAND':       ['Open_Palm'],
  'THUMBS':     ['Thumb_Up'],
  'THUMBS UP':  ['Thumb_Up'],
  'THUMB':      ['Thumb_Up'],
  'FIST':       ['Closed_Fist'],
  'VICTORY':    ['Victory'],
  'PEACE':      ['Victory'],
  'POINT':      ['Pointing_Up'],
  'LOVE':       ['ILoveYou'],
};

// ══════════════════════════════════════════════════
// MEDIAPIPE INITIALIZATION
// ══════════════════════════════════════════════════
function modelPath(filename) {
  return new URL(`assets/models/${filename}`, location.href).href;
}

async function initMediaPipe() {
  try {
    if (loadSubEl) loadSubEl.textContent = 'Loading MediaPipe vision bundle...';
    const vision = await import(modelPath('vision_bundle.mjs'));
    const { GestureRecognizer, PoseLandmarker, HandLandmarker, FilesetResolver, DrawingUtils } = vision;
    _PoseLandmarker = PoseLandmarker;
    _HandLandmarker = HandLandmarker;

    if (loadSubEl) loadSubEl.textContent = 'Loading WASM runtime...';
    const wasmDir = new URL('assets/models/', location.href).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmDir);

    // GestureRecognizer — handles hand gesture classification
    if (loadSubEl) loadSubEl.textContent = 'Loading GestureRecognizer...';
    gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath('gesture_recognizer.task'), delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2
    });

    // PoseLandmarker — for full body poses
    if (loadSubEl) loadSubEl.textContent = 'Loading PoseLandmarker...';
    poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath('pose_landmarker_lite.task'), delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1
    });

    mpDrawingUtils = new DrawingUtils(octx);
    useMediaPipe = true;
    if (loadSubEl) loadSubEl.textContent = '✅ MediaPipe ready — strict gesture verification';
    console.log('[camera] MediaPipe loaded: GestureRecognizer + PoseLandmarker');
    return true;
  } catch (err) {
    console.warn('[camera] MediaPipe failed:', err);
    if (loadSubEl) loadSubEl.textContent = 'Using motion detection fallback';
    useMediaPipe = false;
    return false;
  }
}

// ══════════════════════════════════════════════════
// DISTANCE / VISIBILITY CHECK
// Returns true if user is appropriately framed
// ══════════════════════════════════════════════════
function checkUserDistance(poseLandmarks) {
  if (!poseLandmarks) return { ok: false, message: 'No body detected' };

  // Check if enough landmarks are visible with decent confidence
  const visibleCount = poseLandmarks.filter(l => (l.visibility || 0) > 0.5).length;
  if (visibleCount < 10) {
    return { ok: false, message: '⚠️ STEP BACK — need to see more of your body' };
  }

  // Check body spread — if shoulders/hips are too wide in frame, user is too close
  const lShoulder = poseLandmarks[11];
  const rShoulder = poseLandmarks[12];
  const shoulderWidth = Math.abs(lShoulder.x - rShoulder.x);

  // If shoulders span > 60% of frame width, too close
  if (shoulderWidth > 0.60) {
    return { ok: false, message: '⚠️ STEP BACK — you are too close to the camera' };
  }

  // For full-body gestures, check if legs are visible
  const g = GESTURE;
  const needsFullBody = g.includes('JUMPING') || g.includes('JACK') || g.includes('SQUAT') ||
                         g.includes('MARCH') || g.includes('CIRCLE') || g.includes('HELICOPTER');
  if (needsFullBody) {
    const lAnkle = poseLandmarks[27];
    const rAnkle = poseLandmarks[28];
    if ((lAnkle.visibility || 0) < 0.3 && (rAnkle.visibility || 0) < 0.3) {
      return { ok: false, message: '⚠️ STEP BACK — need to see your full body' };
    }
  }

  return { ok: true, message: '' };
}

// ══════════════════════════════════════════════════
// STRICT GESTURE EVALUATION
// Returns exactly 1.0 (match) or 0.0 (no match).
// ══════════════════════════════════════════════════
function evaluateGesture(gesture, gestureResult, poseResult) {
  const pl = poseResult?.landmarks?.[0];
  const g = gesture;

  // ── HAND GESTURES: Use GestureRecognizer classification ──
  const recognizedGestures = gestureResult?.gestures;
  const handLandmarks = gestureResult?.landmarks;

  // Check if this gesture type uses the GestureRecognizer
  const expectedCategories = findExpectedCategories(g);

  if (expectedCategories) {
    // This is a hand gesture — use classifier
    if (!recognizedGestures || recognizedGestures.length === 0) return 0;

    for (const gestureList of recognizedGestures) {
      for (const detected of gestureList) {
        // Only accept high-confidence classifications
        if (detected.score < 0.65) continue;
        if (expectedCategories.includes(detected.categoryName)) {
          // For WAVE: additionally require lateral oscillation
          if (g.includes('WAVE') || g.includes('HAND')) {
            return checkWaveMotion(handLandmarks) ? 1.0 : 0;
          }
          return 1.0; // Gesture classified correctly by ML model
        }
      }
    }
    return 0; // Gesture not recognized
  }

  // ── SALUTE: hand near forehead (not in GestureRecognizer) ──
  if (g.includes('SALUTE')) {
    if (handLandmarks?.length > 0 && pl) {
      const fingertip = handLandmarks[0][12]; // middle finger tip
      const nose = pl[0];
      const rEar = pl[8];
      const shoulder = pl[12];
      // Fingers must be near temple and above shoulder
      if (fingertip.y >= shoulder.y) return 0;
      const distToEar = Math.hypot(fingertip.x - rEar.x, fingertip.y - rEar.y);
      if (distToEar < 0.13 && fingertip.y < nose.y + 0.04) return 1.0;
    }
    return 0;
  }

  // ── NOD: vertical head oscillation ──
  if (g.includes('NOD')) {
    if (pl) {
      const nose = pl[0];
      if (prevNoseY !== null) {
        const dy = nose.y - prevNoseY;
        const dir = dy > 0.007 ? 1 : dy < -0.007 ? -1 : 0;
        if (dir !== 0 && dir !== lastNodDir) { nodOscillations++; lastNodDir = dir; }
      }
      prevNoseY = nose.y;
      return nodOscillations >= 4 ? 1.0 : 0;
    }
    return 0;
  }

  // ── HEAD SHAKE: lateral head oscillation ──
  if (g.includes('HEAD') && g.includes('SHAKE')) {
    if (pl) {
      const nose = pl[0];
      if (prevNoseX !== null) {
        const dx = nose.x - prevNoseX;
        const dir = dx > 0.007 ? 1 : dx < -0.007 ? -1 : 0;
        if (dir !== 0 && dir !== lastShakeDir) { shakeOscillations++; lastShakeDir = dir; }
      }
      prevNoseX = nose.x;
      return shakeOscillations >= 4 ? 1.0 : 0;
    }
    return 0;
  }

  // ── JUMPING JACKS: both arms above shoulders + legs apart ──
  if (g.includes('JUMPING') || g.includes('JACK')) {
    if (pl) {
      const lWrist = pl[15], rWrist = pl[16];
      const lShoulder = pl[11], rShoulder = pl[12];
      const lAnkle = pl[27], rAnkle = pl[28];
      const armsUp = lWrist.y < lShoulder.y - 0.08 && rWrist.y < rShoulder.y - 0.08;
      const legsApart = Math.abs(lAnkle.x - rAnkle.x) > 0.20;
      return (armsUp && legsApart) ? 1.0 : 0;
    }
    return 0;
  }

  // ── SQUAT: hips drop to knee level ──
  if (g.includes('SQUAT')) {
    if (pl) {
      const hip = pl[24], knee = pl[26];
      return (hip.y > knee.y - 0.06) ? 1.0 : 0;
    }
    return 0;
  }

  // ── ARM CIRCLES: track wrist orbit around shoulder ──
  if (g.includes('ARM') || g.includes('HELICOPTER') || g.includes('CIRCLE')) {
    if (pl) {
      // Check if either wrist is significantly extended from shoulder
      const lw = pl[15], rw = pl[16], rs = pl[12], ls = pl[11];
      const distL = Math.hypot(lw.x - ls.x, lw.y - ls.y);
      const distR = Math.hypot(rw.x - rs.x, rw.y - rs.y);
      // Arm must be extended far (not just resting at side)
      // Also check that wrist is at a varied angle (above, below, or to the side)
      const maxDist = Math.max(distL, distR);
      if (maxDist > 0.35) {
        // Additionally: wrist should NOT be below hip (resting position)
        const hip = pl[24];
        const activeWrist = distL > distR ? lw : rw;
        if (activeWrist.y < hip.y) return 1.0;
      }
      return 0;
    }
    return 0;
  }

  // ── MARCH: alternating knee heights ──
  if (g.includes('MARCH')) {
    if (pl) {
      const lk = pl[25], rk = pl[26];
      return (Math.abs(lk.y - rk.y) > 0.10) ? 1.0 : 0;
    }
    return 0;
  }

  // Unknown gesture — NO free credit
  return 0;
}

// Find expected GestureRecognizer categories for a gesture name
function findExpectedCategories(gesture) {
  for (const [key, cats] of Object.entries(GESTURE_TO_CATEGORY)) {
    if (gesture.includes(key)) return cats;
  }
  return null;
}

// Check wave motion: Open_Palm detected + wrist oscillating laterally
function checkWaveMotion(handLandmarks) {
  if (!handLandmarks || handLandmarks.length === 0) return false;
  const wrist = handLandmarks[0][0];
  if (prevWristX !== null) {
    const dx = wrist.x - prevWristX;
    const dir = dx > 0.010 ? 1 : dx < -0.010 ? -1 : 0;
    if (dir !== 0 && dir !== lastWaveDir) {
      waveOscillations++;
      lastWaveDir = dir;
    }
  }
  prevWristX = wrist.x;
  // Need at least 2 direction changes to confirm actual waving
  return waveOscillations >= 2;
}

// ══════════════════════════════════════════════════
// PIXEL-DIFF FALLBACK
// ══════════════════════════════════════════════════
const ZONES = {
  upperBody: { x1: 0.10, y1: 0.00, x2: 0.90, y2: 0.50 },
  lowerBody: { x1: 0.15, y1: 0.55, x2: 0.85, y2: 1.00 },
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
      if (Math.abs(data[i]-prevData[i]) + Math.abs(data[i+1]-prevData[i+1]) + Math.abs(data[i+2]-prevData[i+2]) > 40) changed++;
      total++;
    }
  }
  return total > 0 ? changed/total : 0;
}

function evaluateGestureFallback(data, w, h) {
  const up = zoneMotion(data, ZONES.upperBody, w, h);
  const lo = zoneMotion(data, ZONES.lowerBody, w, h);
  const hd = zoneMotion(data, ZONES.head, w, h);
  const full = zoneMotion(data, ZONES.full, w, h);
  const g = GESTURE;
  // Much stricter thresholds for fallback
  if (g.includes('WAVE') || g.includes('HAND')) return up > 0.10 ? 1.0 : 0;
  if (g.includes('SALUTE')) return up > 0.08 && hd > 0.04 ? 1.0 : 0;
  if (g.includes('NOD') || g.includes('HEAD')) return hd > 0.06 ? 1.0 : 0;
  if (g.includes('JUMPING') || g.includes('JACK')) return full > 0.15 ? 1.0 : 0;
  if (g.includes('SQUAT')) return lo > 0.10 ? 1.0 : 0;
  return full > 0.12 ? 1.0 : 0;
}

// ══════════════════════════════════════════════════
// OVERLAY DRAWING
// ══════════════════════════════════════════════════
let distanceWarning = '';

function drawOverlay(w, h, score, poseResult, gestureResult) {
  octx.clearRect(0, 0, w, h);

  // Scanline
  scanLineY = (scanLineY + 2.5) % h;
  const grad = octx.createLinearGradient(0, scanLineY-25, 0, scanLineY+25);
  grad.addColorStop(0, 'rgba(6,182,212,0)');
  grad.addColorStop(0.5, `rgba(6,182,212,${0.06 + score * 0.15})`);
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

  // Draw MediaPipe skeleton
  if (useMediaPipe && mpDrawingUtils && _PoseLandmarker) {
    if (poseResult?.landmarks) {
      for (const landmarks of poseResult.landmarks) {
        const mirrored = landmarks.map(l => ({ ...l, x: 1 - l.x }));
        mpDrawingUtils.drawConnectors(mirrored, _PoseLandmarker.POSE_CONNECTIONS, { color: '#00FF66AA', lineWidth: 2.5 });
        mpDrawingUtils.drawLandmarks(mirrored, { color: '#FF3333BB', fillColor: '#00FF6644', radius: 3, lineWidth: 1 });
      }
    }
    // Draw hand landmarks from gesture recognizer
    if (gestureResult?.landmarks && _HandLandmarker) {
      for (const landmarks of gestureResult.landmarks) {
        const mirrored = landmarks.map(l => ({ ...l, x: 1 - l.x }));
        mpDrawingUtils.drawConnectors(mirrored, _HandLandmarker.HAND_CONNECTIONS, { color: '#06B6D4BB', lineWidth: 2.5 });
        mpDrawingUtils.drawLandmarks(mirrored, { color: '#FF2D2DBB', fillColor: '#06B6D444', radius: 2.5, lineWidth: 1 });
      }
    }

    // Show recognized gesture label
    if (gestureResult?.gestures?.length > 0) {
      const top = gestureResult.gestures[0][0];
      if (top && top.categoryName !== 'None' && top.score > 0.5) {
        octx.fillStyle = '#10b981';
        octx.font = 'bold 14px monospace';
        octx.fillText(`Detected: ${top.categoryName} (${Math.round(top.score*100)}%)`, 8, h - 20);
      }
    }
  }

  // Grid
  octx.strokeStyle = 'rgba(6,182,212,0.03)'; octx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 40) { octx.beginPath(); octx.moveTo(x,0); octx.lineTo(x,h); octx.stroke(); }
  for (let y = 0; y < h; y += 40) { octx.beginPath(); octx.moveTo(0,y); octx.lineTo(w,y); octx.stroke(); }

  // REC dot
  if (Math.floor(frameCount/15) % 2 === 0) {
    octx.beginPath(); octx.arc(w-16, 14, 5, 0, Math.PI*2);
    octx.fillStyle = '#ff2d2d'; octx.fill();
    octx.fillStyle = '#fff'; octx.font = '10px monospace'; octx.fillText('REC', w-38, 18);
  }

  // Mode label
  octx.fillStyle = 'rgba(6,182,212,0.5)'; octx.font = '10px monospace';
  octx.fillText(`${useMediaPipe ? '🦴 MEDIAPIPE' : '📡 MOTION'} | TARGET: ${GESTURE}`, 8, 16);

  // Distance warning
  if (distanceWarning) {
    octx.fillStyle = 'rgba(255,50,50,0.85)';
    octx.font = 'bold 16px monospace';
    const tw = octx.measureText(distanceWarning).width;
    octx.fillText(distanceWarning, (w - tw) / 2, h / 2);
  }

  // Progress bar
  const progress = Math.min(Math.max(accumulated, 0) / REQUIRED, 1);
  octx.fillStyle = 'rgba(0,0,0,0.5)'; octx.fillRect(0, h - 6, w, 6);
  octx.fillStyle = score > 0.5 ? '#10b981' : '#06b6d4';
  octx.fillRect(0, h - 6, w * progress, 6);
}

// ══════════════════════════════════════════════════
// MAIN LOOP
// ══════════════════════════════════════════════════
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  const w = vc.width, h = vc.height;
  const currentVideoTime = video.currentTime;
  if (currentVideoTime === lastVideoTime) return;
  lastVideoTime = currentVideoTime;

  vctx.save(); vctx.translate(w, 0); vctx.scale(-1, 1);
  vctx.drawImage(video, 0, 0, w, h);
  vctx.restore();

  let score = 0;
  let poseResult = null, gestureResult = null;

  if (useMediaPipe) {
    mpTimestamp = Math.max(mpTimestamp + 1, Math.round(currentVideoTime * 1000));
    try {
      gestureResult = gestureRecognizer.recognizeForVideo(video, mpTimestamp);
      poseResult = poseLandmarker.detectForVideo(video, mpTimestamp);

      // Distance/visibility check
      const distCheck = checkUserDistance(poseResult?.landmarks?.[0]);
      distanceWarning = distCheck.ok ? '' : distCheck.message;

      if (distCheck.ok) {
        score = evaluateGesture(GESTURE, gestureResult, poseResult);
      }
      // If not OK, score stays 0
    } catch (e) {
      console.warn('[camera] MediaPipe error:', e.message);
    }
  } else {
    const imageData = vctx.getImageData(0, 0, w, h);
    score = evaluateGestureFallback(imageData.data, w, h);
    prevData = imageData.data.slice();
  }

  // STRICT BINARY ACCUMULATION:
  // - Score is 1.0 or 0.0 (no partial)
  // - Need 3 consecutive matching frames before accumulating (debounce)
  // - Progress DECAYS when not matching
  if (score >= 1.0) {
    consecutiveMatches++;
    if (consecutiveMatches >= MIN_CONSECUTIVE) {
      accumulated += 1.0;
    }
  } else {
    consecutiveMatches = 0;
    // Decay: lose 0.3 progress per non-matching frame
    // This means idle time actively hurts — you can't just wait it out
    accumulated = Math.max(0, accumulated - 0.3);
  }

  drawOverlay(w, h, score, poseResult, gestureResult);
  frameCount++;

  const progress = Math.min(Math.max(accumulated, 0) / REQUIRED, 1);

  if (score >= 1.0 && consecutiveMatches >= MIN_CONSECUTIVE) {
    statusEl.textContent = `🦴 GESTURE MATCHED — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#10b981';
  } else if (distanceWarning) {
    statusEl.textContent = distanceWarning;
    statusEl.style.color = '#ef4444';
  } else {
    statusEl.textContent = `Perform: ${GESTURE}`;
    statusEl.style.color = '#06b6d4';
  }

  parent.postMessage({
    event: 'progress', value: progress,
    detected: score >= 1.0,
    gestureScore: score,
    mode: useMediaPipe ? 'mediapipe' : 'pixeldiff',
    hasPose: !!(poseResult?.landmarks?.length),
    hasHands: !!(gestureResult?.landmarks?.length)
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
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
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
  if (!IS_PRELOAD) await initMediaPipe();
  parent.postMessage({ event: 'ready', mediapipe: useMediaPipe }, '*');
  if (!IS_PRELOAD) startCamera();
}

window.addEventListener('message', e => {
  if (e.data?.cmd === 'start') startCamera();
  if (e.data?.cmd === 'stop') { running = false; if (stream) stream.getTracks().forEach(t => t.stop()); }
});

init();
