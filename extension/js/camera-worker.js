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

// Motion tracking for dynamic gestures
let prevWristX = null;
let prevNoseY = null;
let prevNoseX = null;
let waveOscillations = 0;
let lastWaveDir = 0;
let nodOscillations = 0;
let lastNodDir = 0;
let shakeOscillations = 0;
let lastShakeDir = 0;

// Clap tracking
let clapState = 'apart'; // 'apart' | 'together'
let clapCycles = 0;
const CLAP_REQUIRED_CYCLES = 3;

// Cycle tracking for full-body gestures
let jjArmsWereUp = false;   // jumping jack: arms in up position
let jjCycles = 0;           // completed jumping jack cycles
let circleQuadrant = -1;    // arm circle: current quadrant (0-3)
let circlePrevQuadrant = -1;
let circleQuadrantsHit = new Set(); // quadrants visited in current revolution
let circleRevolutions = 0;  // completed revolutions

// Squat cycle tracking
let squatPhase = 'standing'; // 'standing' | 'squatting'
let squatCycles = 0;
const SQUAT_REQUIRED_CYCLES = 3;

// March step tracking
let marchLastLegUp = null;   // 'left' | 'right' | null
let marchSteps = 0;
let marchPrevLKneeY = null;
let marchPrevRKneeY = null;
const MARCH_REQUIRED_STEPS = 4;

// Consecutive match counter — require N consecutive matching frames
let consecutiveMatches = 0;
const MIN_CONSECUTIVE = 3;

// Grace period: don't decay for N frames after last match
let framesSinceLastMatch = 999;
const GRACE_PERIOD = 10; // ~333ms at 30fps — covers the "down" phase of a jumping jack

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

/** Uninitialized canvas per task — required for WebGL2 / GPU delegate (see VisionTaskOptions.canvas). */
function createGpuBindingCanvas() {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  return c;
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

    const gestureCanvas = createGpuBindingCanvas();
    const poseCanvas = createGpuBindingCanvas();

    // GPU: delegate + dedicated canvas (each task owns a WebGL2 context). Without canvas, Tasks Vision falls back to CPU/XNNPACK.
    if (loadSubEl) loadSubEl.textContent = 'Loading GestureRecognizer (GPU)...';
    try {
      gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath('gesture_recognizer.task'), delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        canvas: gestureCanvas
      });

      if (loadSubEl) loadSubEl.textContent = 'Loading PoseLandmarker (GPU)...';
      poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath('pose_landmarker_lite.task'), delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        canvas: poseCanvas
      });
      console.log('[camera] MediaPipe WebGL2 GPU: GestureRecognizer + PoseLandmarker');
    } catch (gpuErr) {
      console.warn('[camera] GPU (WebGL2) init failed, using CPU delegate:', gpuErr?.message || gpuErr);
      gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath('gesture_recognizer.task'), delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2
      });
      poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath('pose_landmarker_lite.task'), delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1
      });
      console.log('[camera] MediaPipe CPU fallback: GestureRecognizer + PoseLandmarker');
    }

    mpDrawingUtils = new DrawingUtils(octx);
    useMediaPipe = true;
    if (loadSubEl) loadSubEl.textContent = '✅ MediaPipe ready — strict gesture verification';
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

  // Check if enough landmarks are visible
  const visibleCount = poseLandmarks.filter(l => (l.visibility || 0) > 0.4).length;
  if (visibleCount < 8) {
    return { ok: false, message: '⚠️ STEP BACK — need to see your body' };
  }

  // Check body spread — if shoulders/hips are too wide in frame, user is too close
  const lShoulder = poseLandmarks[11];
  const rShoulder = poseLandmarks[12];
  const shoulderWidth = Math.abs(lShoulder.x - rShoulder.x);

  if (shoulderWidth > 0.65) {
    return { ok: false, message: '⚠️ TOO CLOSE — step back from camera' };
  }

  // For full-body gestures, check if at least knees are visible
  const g = GESTURE;
  const needsFullBody = g.includes('JUMPING') || g.includes('JACK') || g.includes('SQUAT') ||
                         g.includes('MARCH') || g.includes('CIRCLE') || g.includes('HELICOPTER');
  if (needsFullBody) {
    const lKnee = poseLandmarks[25];
    const rKnee = poseLandmarks[26];
    if ((lKnee.visibility || 0) < 0.3 && (rKnee.visibility || 0) < 0.3) {
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
  // CLAP contains "HAND" but should NOT use the palm classifier — it has a custom handler below
  const expectedCategories = g.includes('CLAP') ? null : findExpectedCategories(g);

  if (expectedCategories) {
    // This is a hand gesture — use classifier
    if (!recognizedGestures || recognizedGestures.length === 0) return 0;

    for (const gestureList of recognizedGestures) {
      for (const detected of gestureList) {
        // Only accept high-confidence classifications
        if (detected.score < 0.75) continue; // Raised from 0.65 — stricter classification
        if (expectedCategories.includes(detected.categoryName)) {
          // For WAVE: additionally require lateral oscillation + raised hand
          if (g.includes('WAVE') || g.includes('HAND')) {
            return checkWaveMotion(handLandmarks, poseResult) ? 1.0 : 0;
          }
          return 1.0; // Gesture classified correctly by ML model
        }
      }
    }
    return 0; // Gesture not recognized
  }

  // ── CLAP: both wrists come together repeatedly ──
  if (g.includes('CLAP')) {
    if (pl) {
      const lWrist = pl[15], rWrist = pl[16];
      const wristDist = Math.hypot(lWrist.x - rWrist.x, lWrist.y - rWrist.y);
      if (clapState === 'apart' && wristDist < 0.08) {
        clapState = 'together';
      }
      if (clapState === 'together' && wristDist > 0.18) {
        clapCycles++;
        clapState = 'apart';
        console.log(`[CLAP] Cycle ${clapCycles}/${CLAP_REQUIRED_CYCLES}`);
      }
      return clapCycles >= CLAP_REQUIRED_CYCLES ? 1.0 : 0;
    }
    return 0;
  }

  // ── SALUTE: hand near forehead (not in GestureRecognizer) ──
  if (g.includes('SALUTE')) {
    if (handLandmarks?.length > 0 && pl) {
      // Check ALL detected hands, not just the first
      for (let h = 0; h < handLandmarks.length; h++) {
        const fingertip = handLandmarks[h][12]; // middle finger tip
        const nose = pl[0];
        const rEar = pl[8];
        const lEar = pl[7];
        const shoulder = pl[12];
        if (fingertip.y >= shoulder.y) continue;
        const distToREar = Math.hypot(fingertip.x - rEar.x, fingertip.y - rEar.y);
        const distToLEar = Math.hypot(fingertip.x - lEar.x, fingertip.y - lEar.y);
        const nearEar = Math.min(distToREar, distToLEar);
        if (nearEar < 0.13 && fingertip.y < nose.y + 0.04) return 1.0;
      }
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

  // ── JUMPING JACKS: Require up-down CYCLES (not static hold) ──
  if (g.includes('JUMPING') || g.includes('JACK')) {
    if (pl) {
      const lWrist = pl[15], rWrist = pl[16];
      const lShoulder = pl[11], rShoulder = pl[12];
      const armsUp = lWrist.y < lShoulder.y - 0.05 && rWrist.y < rShoulder.y - 0.05;
      const armsDown = lWrist.y > lShoulder.y + 0.05 && rWrist.y > rShoulder.y + 0.05;

      if (armsUp && !jjArmsWereUp) {
        jjArmsWereUp = true;
      }
      if (armsDown && jjArmsWereUp) {
        jjCycles++;
        jjArmsWereUp = false;
        console.log(`[JJ] Cycle ${jjCycles}/3`);
      }
      // Return match during the "up" phase of cycle so progress ring fills while performing
      return (jjCycles >= 3 || (jjArmsWereUp && jjCycles >= 2)) ? 1.0 : (armsUp ? 1.0 : 0);
    }
    return 0;
  }

  // ── SQUAT: Require up-down CYCLES (not static hold) ──
  if (g.includes('SQUAT')) {
    if (pl) {
      const hip = pl[24], knee = pl[26];
      const isSquatting = hip.y > knee.y - 0.06;
      const isStanding = hip.y < knee.y - 0.18;

      if (squatPhase === 'standing' && isSquatting) {
        squatPhase = 'squatting';
      }
      if (squatPhase === 'squatting' && isStanding) {
        squatCycles++;
        squatPhase = 'standing';
        console.log(`[SQUAT] Cycle ${squatCycles}/${SQUAT_REQUIRED_CYCLES}`);
      }
      // Match during squat phase so progress ring fills while performing
      return (squatCycles >= SQUAT_REQUIRED_CYCLES) ? 1.0 : (isSquatting ? 1.0 : 0);
    }
    return 0;
  }

  // ── ARM CIRCLES: track wrist traversing 4 quadrants around shoulder ──
  if (g.includes('ARM') || g.includes('HELICOPTER') || g.includes('CIRCLE')) {
    if (pl) {
      const lw = pl[15], rw = pl[16], rs = pl[12], ls = pl[11];
      // Pick the arm that's more extended
      const distL = Math.hypot(lw.x - ls.x, lw.y - ls.y);
      const distR = Math.hypot(rw.x - rs.x, rw.y - rs.y);
      const wrist = distL > distR ? lw : rw;
      const shoulder = distL > distR ? ls : rs;

      // Arm must be extended (not resting at side)
      const dist = Math.max(distL, distR);
      if (dist > 0.18) {
        // Determine quadrant: 0=top-right, 1=top-left, 2=bottom-left, 3=bottom-right
        const dx = wrist.x - shoulder.x;
        const dy = wrist.y - shoulder.y;
        const q = (dy < 0 ? 0 : 2) + (dx > 0 ? 0 : 1);

        if (q !== circlePrevQuadrant) {
          circleQuadrantsHit.add(q);
          circlePrevQuadrant = q;
          // If all 4 quadrants hit = one revolution
          if (circleQuadrantsHit.size >= 4) {
            circleRevolutions++;
            circleQuadrantsHit.clear();
            console.log(`[CIRCLE] Revolution ${circleRevolutions} completed`);
          }
        }

        if (circleRevolutions >= 2) return 1.0;
        if (circleRevolutions >= 1 && circleQuadrantsHit.size >= 2) return 1.0;
        return 0;
      }
      return 0;
    }
    return 0;
  }

  // ── MARCH: High knee hold logic ──
  // Check if either knee is lifted significantly higher than the other leg
  if (g.includes('MARCH')) {
    if (pl) {
      const lKnee = pl[25], rKnee = pl[26];
      const lHip = pl[23], rHip = pl[24];
      const lHipToKnee = lKnee.y - lHip.y; 
      const rHipToKnee = rKnee.y - rHip.y;
      
      const leftLifted = lHipToKnee < rHipToKnee - 0.05;
      const rightLifted = rHipToKnee < lHipToKnee - 0.05;

      return (leftLifted || rightLifted) ? 1.0 : 0;
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

// Check wave motion: Open_Palm detected + wrist oscillating laterally + hand above shoulder
// Now checks ALL detected hands (not just index 0) so left hand works too
function checkWaveMotion(handLandmarks, poseResult) {
  if (!handLandmarks || handLandmarks.length === 0) return false;

  const pl = poseResult?.landmarks?.[0];
  const shoulderY = pl ? Math.min(pl[11].y, pl[12].y) : 0.5;

  // Check each detected hand — pick the one that's raised highest
  let bestWrist = null;
  for (let h = 0; h < handLandmarks.length; h++) {
    const wrist = handLandmarks[h][0];
    // Hand must be above or near shoulder height (lower y = higher in frame)
    if (wrist.y <= shoulderY + 0.05) {
      if (!bestWrist || wrist.y < bestWrist.y) bestWrist = wrist;
    }
  }

  if (!bestWrist) return false; // no hand raised high enough

  if (prevWristX !== null) {
    const dx = bestWrist.x - prevWristX;
    // Require deliberate lateral motion
    const dir = dx > 0.015 ? 1 : dx < -0.015 ? -1 : 0;
    if (dir !== 0 && dir !== lastWaveDir) {
      waveOscillations++;
      lastWaveDir = dir;
    }
  }
  prevWristX = bestWrist.x;
  // Need at least 3 direction changes to confirm actual waving
  return waveOscillations >= 3;
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

    // Show recognized gesture label — BIG text for distance viewing
    if (gestureResult?.gestures?.length > 0) {
      const top = gestureResult.gestures[0][0];
      if (top && top.categoryName !== 'None' && top.score > 0.5) {
        octx.fillStyle = '#10b981';
        octx.font = 'bold 22px monospace';
        octx.fillText(`✓ ${top.categoryName} (${Math.round(top.score*100)}%)`, 8, h - 30);
      }
    }
  }

  // Grid
  octx.strokeStyle = 'rgba(6,182,212,0.03)'; octx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 40) { octx.beginPath(); octx.moveTo(x,0); octx.lineTo(x,h); octx.stroke(); }
  for (let y = 0; y < h; y += 40) { octx.beginPath(); octx.moveTo(0,y); octx.lineTo(w,y); octx.stroke(); }

  // REC dot — bigger
  if (Math.floor(frameCount/15) % 2 === 0) {
    octx.beginPath(); octx.arc(w-20, 18, 7, 0, Math.PI*2);
    octx.fillStyle = '#ff2d2d'; octx.fill();
    octx.fillStyle = '#fff'; octx.font = 'bold 14px monospace'; octx.fillText('REC', w-52, 23);
  }

  // Mode label — bigger for distance
  octx.fillStyle = 'rgba(6,182,212,0.6)'; octx.font = 'bold 14px monospace';
  octx.fillText(`${useMediaPipe ? '🦴 MEDIAPIPE' : '📡 MOTION'} | TARGET: ${GESTURE}`, 8, 20);

  // Distance warning — LARGE and centered
  if (distanceWarning) {
    // Dark backdrop
    octx.fillStyle = 'rgba(0,0,0,0.6)';
    octx.fillRect(0, h/2 - 30, w, 50);
    octx.fillStyle = '#ff4444';
    octx.font = 'bold 24px monospace';
    const tw = octx.measureText(distanceWarning).width;
    octx.fillText(distanceWarning, (w - tw) / 2, h / 2);
  }

  // Progress bar — THICK (12px) for distance visibility
  const progress = Math.min(Math.max(accumulated, 0) / REQUIRED, 1);
  octx.fillStyle = 'rgba(0,0,0,0.6)'; octx.fillRect(0, h - 14, w, 14);
  octx.fillStyle = score > 0.5 ? '#10b981' : '#06b6d4';
  octx.fillRect(0, h - 14, w * progress, 14);
  // Progress percentage text on the bar
  octx.fillStyle = '#fff'; octx.font = 'bold 11px monospace';
  octx.fillText(`${Math.round(progress*100)}%`, w/2 - 12, h - 3);
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

  // STRICT BINARY ACCUMULATION with GRACE PERIOD:
  // - Score is 1.0 or 0.0 (no partial)
  // - Need 3 consecutive matching frames before accumulating (debounce)
  // - Grace period: no decay for 10 frames after last match (covers cycle gaps)
  // - Decay: -0.2/frame after grace period expires
  if (score >= 1.0) {
    consecutiveMatches++;
    framesSinceLastMatch = 0;
    if (consecutiveMatches >= MIN_CONSECUTIVE) {
      accumulated += 1.0;
    }
  } else {
    consecutiveMatches = 0;
    framesSinceLastMatch++;
    // Only decay AFTER grace period — allows for natural cycle gaps
    // (e.g., arms coming down between jumping jacks)
    if (framesSinceLastMatch > GRACE_PERIOD) {
      accumulated = Math.max(0, accumulated - 0.2);
    }
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
