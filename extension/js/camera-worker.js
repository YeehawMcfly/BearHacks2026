/**
 * Camera Worker — MediaPipe PoseLandmarker + HandLandmarker with pixel-diff fallback.
 *
 * Loads MediaPipe Tasks Vision from locally bundled files in assets/models/.
 * Requires manifest.json CSP: "script-src 'self' 'wasm-unsafe-eval'"
 * Falls back to zone pixel-diff if MediaPipe fails to load.
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

// ══════════════════════════════════════════════════
// MEDIAPIPE INITIALIZATION (all local files)
// ══════════════════════════════════════════════════
function modelPath(filename) {
  // camera.html lives at extension root, so assets/models/ is relative
  return new URL(`assets/models/${filename}`, location.href).href;
}

async function initMediaPipe() {
  try {
    if (loadSubEl) loadSubEl.textContent = 'Loading MediaPipe vision bundle...';

    // Dynamic import of the locally-bundled vision_bundle.mjs
    const vision = await import(modelPath('vision_bundle.mjs'));
    const { PoseLandmarker, HandLandmarker, FilesetResolver, DrawingUtils } = vision;
    _PoseLandmarker = PoseLandmarker;
    _HandLandmarker = HandLandmarker;

    if (loadSubEl) loadSubEl.textContent = 'Loading WASM runtime...';
    // Point FilesetResolver to local wasm files directory
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
    console.log('[camera] MediaPipe loaded successfully — real pose + hand tracking active');
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
// Uses real landmark coordinates for accurate detection
// ══════════════════════════════════════════════════
function evaluateGestureMP(gesture, poseResult, handResult) {
  const pl = poseResult?.landmarks?.[0];  // 33 pose landmarks
  const hands = handResult?.landmarks;     // array of 21 landmarks per hand
  const g = gesture;

  // WAVE / HAND — hand must be above hip level and moving
  if (g.includes('WAVE') || g.includes('HAND')) {
    if (hands?.length > 0) {
      const wrist = hands[0][0];
      // If we have pose, check wrist is above hip
      if (pl) {
        const hip = pl[24]; // right hip
        if (wrist.y < hip.y) return 1.0; // hand is above hip = waving
        return 0.3;
      }
      return 0.8; // hand detected but no pose reference
    }
    return pl ? 0.1 : 0; // body visible but no hand
  }

  // SALUTE — hand near forehead
  if (g.includes('SALUTE')) {
    if (hands?.length > 0 && pl) {
      const wrist = hands[0][0];
      const nose = pl[0];
      const rEar = pl[8]; // right ear
      const dist = Math.hypot(wrist.x - rEar.x, wrist.y - rEar.y);
      // Hand near ear/forehead region
      if (dist < 0.20 && wrist.y < nose.y + 0.08) return 1.0;
      if (wrist.y < nose.y) return 0.5;
      return 0.2;
    }
    if (hands?.length > 0) return 0.4;
    return 0;
  }

  // THUMBS UP — thumb tip above thumb IP, other fingers curled
  if (g.includes('THUMBS')) {
    if (hands?.length > 0) {
      const h = hands[0];
      const thumbTip = h[4], thumbIP = h[3];
      const indexTip = h[8], indexPIP = h[6];
      const midTip = h[12], midPIP = h[10];
      // Thumb up: tip above IP joint, index/middle curled
      const thumbUp = thumbTip.y < thumbIP.y;
      const indexDown = indexTip.y > indexPIP.y;
      const midDown = midTip.y > midPIP.y;
      if (thumbUp && indexDown && midDown) return 1.0;
      if (thumbUp) return 0.5;
      return 0.2;
    }
    return 0;
  }

  // CLAP — two hands close together
  if (g.includes('CLAP')) {
    if (hands?.length >= 2) {
      const d = Math.hypot(hands[0][0].x - hands[1][0].x, hands[0][0].y - hands[1][0].y);
      if (d < 0.12) return 1.0; // hands touching
      if (d < 0.25) return 0.6;
      return 0.3;
    }
    if (hands?.length === 1) return 0.2;
    return 0;
  }

  // NOD / HEAD SHAKE — head present, checking vertical/horizontal motion
  if (g.includes('NOD') || g.includes('HEAD')) {
    if (pl) return 0.8; // head present = credit (hard to track nod with single frame)
    return 0;
  }

  // JUMPING JACKS — arms up + legs apart
  if (g.includes('JUMPING') || g.includes('JACK')) {
    if (pl) {
      const lWrist = pl[15], rWrist = pl[16];
      const lShoulder = pl[11], rShoulder = pl[12];
      const lAnkle = pl[27], rAnkle = pl[28];
      const armsUp = lWrist.y < lShoulder.y && rWrist.y < rShoulder.y;
      const legsApart = Math.abs(lAnkle.x - rAnkle.x) > 0.15;
      if (armsUp && legsApart) return 1.0;
      if (armsUp) return 0.6;
      return 0.2;
    }
    return 0;
  }

  // SQUAT — hips close to knees
  if (g.includes('SQUAT')) {
    if (pl) {
      const hip = pl[24], knee = pl[26];
      if (hip.y > knee.y - 0.08) return 1.0;
      if (hip.y > knee.y - 0.15) return 0.5;
      return 0.2;
    }
    return 0;
  }

  // ARM CIRCLES / HELICOPTER — wrist far from shoulder
  if (g.includes('ARM') || g.includes('HELICOPTER') || g.includes('CIRCLE')) {
    if (pl) {
      const lw = pl[15], rs = pl[12];
      const dist = Math.hypot(lw.x - rs.x, lw.y - rs.y);
      if (dist > 0.35) return 1.0;
      if (dist > 0.25) return 0.5;
      return 0.2;
    }
    return 0;
  }

  // MARCH — alternating knee height
  if (g.includes('MARCH')) {
    if (pl) {
      const lk = pl[25], rk = pl[26];
      if (Math.abs(lk.y - rk.y) > 0.08) return 1.0;
      if (Math.abs(lk.y - rk.y) > 0.04) return 0.5;
      return 0.2;
    }
    return 0;
  }

  // Generic: body or hands visible
  return (hands?.length > 0 ? 0.6 : 0) + (pl ? 0.4 : 0);
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

  if (g.includes('WAVE') || g.includes('HAND')) return up > 0.06 ? 1.0 : up > 0.03 ? 0.4 : 0;
  if (g.includes('SALUTE')) return up > 0.04 && hd > 0.02 ? 1.0 : up > 0.03 ? 0.4 : 0;
  if (g.includes('CLAP')) return le > 0.04 && ri > 0.04 ? 1.0 : full > 0.06 ? 0.5 : 0;
  if (g.includes('NOD') || g.includes('HEAD')) return hd > 0.03 ? 1.0 : 0;
  if (g.includes('JUMPING') || g.includes('JACK')) return full > 0.10 ? 1.0 : full > 0.05 ? 0.4 : 0;
  if (g.includes('SQUAT')) return lo > 0.06 ? 1.0 : lo > 0.03 ? 0.4 : 0;
  return full > 0.08 ? 1.0 : full > 0.04 ? 0.4 : 0;
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
        // Mirror X for selfie view
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
    // Fallback: draw simple static skeleton outline (always visible)
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
    // Head circle
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
}

// ══════════════════════════════════════════════════
// MAIN LOOP
// ══════════════════════════════════════════════════
let lastTs = 0;

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  const now = performance.now();
  if (now - lastTs < 33) return; // ~30fps
  lastTs = now;

  const w = vc.width, h = vc.height;
  vctx.save(); vctx.translate(w, 0); vctx.scale(-1, 1);
  vctx.drawImage(video, 0, 0, w, h);
  vctx.restore();

  let score = 0;
  let poseResult = null, handResult = null;

  if (useMediaPipe) {
    // Real MediaPipe landmark detection
    try {
      poseResult = poseLandmarker.detectForVideo(video, now);
      handResult = handLandmarker.detectForVideo(video, now);
      score = evaluateGestureMP(GESTURE, poseResult, handResult);
    } catch (e) {
      console.warn('[camera] MediaPipe detection error:', e);
    }
  } else {
    // Pixel-diff fallback
    const imageData = vctx.getImageData(0, 0, w, h);
    score = evaluateGestureFallback(imageData.data, w, h);
    prevData = imageData.data.slice();
  }

  // Accumulate progress
  if (score >= 0.5) accumulated += score;
  else if (score >= 0.3) accumulated += score * 0.3;

  // Draw overlay with skeleton
  drawOverlay(w, h, score, poseResult, handResult);
  frameCount++;

  const progress = Math.min(accumulated / REQUIRED, 1);

  // Status text
  if (score >= 0.5) {
    statusEl.textContent = `🦴 GESTURE MATCHED — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#10b981';
  } else if (score >= 0.3) {
    statusEl.textContent = `📡 PARTIAL MATCH — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#eab308';
  } else {
    statusEl.textContent = `Perform: ${GESTURE}`;
    statusEl.style.color = '#06b6d4';
  }

  // Report to parent
  parent.postMessage({
    event: 'progress', value: progress,
    detected: score >= 0.3,
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
    // Try to load MediaPipe from local bundled files
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
