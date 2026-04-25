/**
 * Camera Worker — MediaPipe PoseLandmarker + HandLandmarker with pixel-diff fallback.
 * STRICT gesture matching: only the correct pose scores high.
 */

const params = new URLSearchParams(location.search);
const GESTURE = (params.get('gesture') || 'WAVE').toUpperCase();
const REQUIRED = parseInt(params.get('frames') || '55');
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

// Temporal smoothing — rolling AVERAGE (not max) of last 5 frames
const SCORE_HISTORY = [];
const SCORE_WINDOW = 5;

function smoothedScore(rawScore) {
  SCORE_HISTORY.push(rawScore);
  if (SCORE_HISTORY.length > SCORE_WINDOW) SCORE_HISTORY.shift();
  const sum = SCORE_HISTORY.reduce((a, b) => a + b, 0);
  return sum / SCORE_HISTORY.length;
}

// Motion tracking for wave/nod/clap detection
let prevWristX = null;
let prevNoseY = null;
let prevNoseX = null;
let waveOscillations = 0;
let lastWaveDir = 0;
let nodOscillations = 0;
let lastNodDir = 0;
let shakeOscillations = 0;
let lastShakeDir = 0;

// Timestamp tracking for detectForVideo
let lastVideoTime = -1;
let mpTimestamp = 0;

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
    const { PoseLandmarker, HandLandmarker, FilesetResolver, DrawingUtils } = vision;
    _PoseLandmarker = PoseLandmarker;
    _HandLandmarker = HandLandmarker;

    if (loadSubEl) loadSubEl.textContent = 'Loading WASM runtime...';
    const wasmDir = new URL('assets/models/', location.href).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmDir);

    if (loadSubEl) loadSubEl.textContent = 'Loading PoseLandmarker model...';
    poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath('pose_landmarker_lite.task'), delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1
    });

    if (loadSubEl) loadSubEl.textContent = 'Loading HandLandmarker model...';
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath('hand_landmarker.task'), delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 2
    });

    mpDrawingUtils = new DrawingUtils(octx);
    useMediaPipe = true;
    if (loadSubEl) loadSubEl.textContent = '✅ MediaPipe ready';
    console.log('[camera] MediaPipe loaded successfully');
    return true;
  } catch (err) {
    console.warn('[camera] MediaPipe failed:', err);
    if (loadSubEl) loadSubEl.textContent = 'Using motion detection fallback';
    useMediaPipe = false;
    return false;
  }
}

// ══════════════════════════════════════════════════
// STRICT GESTURE EVALUATION
// Each gesture requires the SPECIFIC pose, not just visibility
// ══════════════════════════════════════════════════
function evaluateGestureMP(gesture, poseResult, handResult) {
  const pl = poseResult?.landmarks?.[0];
  const hands = handResult?.landmarks;
  const g = gesture;

  // ── WAVE: hand above shoulder + lateral wrist oscillation ──
  if (g.includes('WAVE') || g.includes('HAND')) {
    if (hands?.length > 0 && pl) {
      const wrist = hands[0][0];
      const shoulder = pl[12];
      // Hand must be above shoulder
      if (wrist.y >= shoulder.y) return 0.05;
      // Track lateral oscillation
      if (prevWristX !== null) {
        const dx = wrist.x - prevWristX;
        const dir = dx > 0.008 ? 1 : dx < -0.008 ? -1 : 0;
        if (dir !== 0 && dir !== lastWaveDir) {
          waveOscillations++;
          lastWaveDir = dir;
        }
      }
      prevWristX = wrist.x;
      // Need at least 2 direction changes to confirm waving
      if (waveOscillations >= 3) return 1.0;
      if (waveOscillations >= 1) return 0.5;
      return 0.15; // hand raised but not waving yet
    }
    return 0;
  }

  // ── SALUTE: hand near forehead, fingers together, elbow out ──
  if (g.includes('SALUTE')) {
    if (hands?.length > 0 && pl) {
      const wrist = hands[0][0];
      const fingertip = hands[0][12]; // middle finger tip
      const nose = pl[0];
      const rEar = pl[8];
      const shoulder = pl[12];
      // Hand must be above shoulder
      if (wrist.y >= shoulder.y) return 0.05;
      // Fingertips near forehead/temple region
      const distToEar = Math.hypot(fingertip.x - rEar.x, fingertip.y - rEar.y);
      const distToNose = Math.hypot(fingertip.x - nose.x, fingertip.y - nose.y);
      if (distToEar < 0.15 && fingertip.y < nose.y + 0.05) return 1.0;
      if (distToNose < 0.18 && fingertip.y < nose.y + 0.08) return 0.8;
      if (wrist.y < nose.y) return 0.3;
      return 0.1;
    }
    return 0;
  }

  // ── THUMBS UP: thumb extended up, other fingers curled ──
  if (g.includes('THUMBS')) {
    if (hands?.length > 0) {
      const h = hands[0];
      const thumbTip = h[4], thumbIP = h[3], thumbMCP = h[2];
      const indexTip = h[8], indexPIP = h[6];
      const midTip = h[12], midPIP = h[10];
      const ringTip = h[16], ringPIP = h[14];
      // Thumb must point up (tip above IP and MCP)
      const thumbUp = thumbTip.y < thumbIP.y - 0.02 && thumbTip.y < thumbMCP.y - 0.02;
      // Other fingers must be curled (tips below their PIP joints)
      const indexCurled = indexTip.y > indexPIP.y;
      const midCurled = midTip.y > midPIP.y;
      const ringCurled = ringTip.y > ringPIP.y;
      const fingersCurled = [indexCurled, midCurled, ringCurled].filter(Boolean).length;
      if (thumbUp && fingersCurled >= 3) return 1.0;
      if (thumbUp && fingersCurled >= 2) return 0.7;
      if (thumbUp) return 0.3;
      return 0.05;
    }
    return 0;
  }

  // ── CLAP: two hands moving together rapidly ──
  if (g.includes('CLAP')) {
    if (hands?.length >= 2) {
      const d = Math.hypot(hands[0][0].x - hands[1][0].x, hands[0][0].y - hands[1][0].y);
      if (d < 0.08) return 1.0;  // hands touching
      if (d < 0.15) return 0.5;
      return 0.15; // two hands visible but apart
    }
    // Also check pose wrists if hand landmarks not both found
    if (pl) {
      const lw = pl[15], rw = pl[16];
      const d = Math.hypot(lw.x - rw.x, lw.y - rw.y);
      if (d < 0.08) return 0.9;
      if (d < 0.15) return 0.4;
    }
    return 0;
  }

  // ── NOD: head bobbing vertically ──
  if (g.includes('NOD')) {
    if (pl) {
      const nose = pl[0];
      if (prevNoseY !== null) {
        const dy = nose.y - prevNoseY;
        const dir = dy > 0.006 ? 1 : dy < -0.006 ? -1 : 0;
        if (dir !== 0 && dir !== lastNodDir) {
          nodOscillations++;
          lastNodDir = dir;
        }
      }
      prevNoseY = nose.y;
      if (nodOscillations >= 4) return 1.0;
      if (nodOscillations >= 2) return 0.5;
      return 0.1;
    }
    return 0;
  }

  // ── HEAD SHAKE: head moving laterally ──
  if (g.includes('HEAD')) {
    if (pl) {
      const nose = pl[0];
      if (prevNoseX !== null) {
        const dx = nose.x - prevNoseX;
        const dir = dx > 0.006 ? 1 : dx < -0.006 ? -1 : 0;
        if (dir !== 0 && dir !== lastShakeDir) {
          shakeOscillations++;
          lastShakeDir = dir;
        }
      }
      prevNoseX = nose.x;
      if (shakeOscillations >= 4) return 1.0;
      if (shakeOscillations >= 2) return 0.5;
      return 0.1;
    }
    return 0;
  }

  // ── JUMPING JACKS: both arms above shoulders + legs apart ──
  if (g.includes('JUMPING') || g.includes('JACK')) {
    if (pl) {
      const lWrist = pl[15], rWrist = pl[16];
      const lShoulder = pl[11], rShoulder = pl[12];
      const lAnkle = pl[27], rAnkle = pl[28];
      const armsUp = lWrist.y < lShoulder.y - 0.05 && rWrist.y < rShoulder.y - 0.05;
      const legsApart = Math.abs(lAnkle.x - rAnkle.x) > 0.18;
      if (armsUp && legsApart) return 1.0;
      if (armsUp) return 0.4;
      return 0.05;
    }
    return 0;
  }

  // ── SQUAT: hips drop to knee level ──
  if (g.includes('SQUAT')) {
    if (pl) {
      const hip = pl[24], knee = pl[26];
      if (hip.y > knee.y - 0.05) return 1.0;
      if (hip.y > knee.y - 0.12) return 0.4;
      return 0.05;
    }
    return 0;
  }

  // ── ARM CIRCLES: wrist far from shoulder, tracking rotation ──
  if (g.includes('ARM') || g.includes('HELICOPTER') || g.includes('CIRCLE')) {
    if (pl) {
      const lw = pl[15], rw = pl[16], rs = pl[12], ls = pl[11];
      const dist = Math.max(
        Math.hypot(lw.x - ls.x, lw.y - ls.y),
        Math.hypot(rw.x - rs.x, rw.y - rs.y)
      );
      if (dist > 0.35) return 1.0;
      if (dist > 0.25) return 0.4;
      return 0.05;
    }
    return 0;
  }

  // ── MARCH: alternating knee heights ──
  if (g.includes('MARCH')) {
    if (pl) {
      const lk = pl[25], rk = pl[26];
      if (Math.abs(lk.y - rk.y) > 0.08) return 1.0;
      if (Math.abs(lk.y - rk.y) > 0.04) return 0.4;
      return 0.05;
    }
    return 0;
  }

  // Generic fallback — no free credit
  return 0;
}

// ══════════════════════════════════════════════════
// PIXEL-DIFF FALLBACK
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
  if (g.includes('WAVE') || g.includes('HAND')) return up > 0.08 ? 1.0 : up > 0.04 ? 0.4 : 0;
  if (g.includes('SALUTE')) return up > 0.05 && hd > 0.03 ? 1.0 : up > 0.04 ? 0.3 : 0;
  if (g.includes('CLAP')) return le > 0.05 && ri > 0.05 ? 1.0 : full > 0.07 ? 0.4 : 0;
  if (g.includes('NOD') || g.includes('HEAD')) return hd > 0.04 ? 1.0 : 0;
  if (g.includes('JUMPING') || g.includes('JACK')) return full > 0.12 ? 1.0 : full > 0.06 ? 0.4 : 0;
  if (g.includes('SQUAT')) return lo > 0.07 ? 1.0 : lo > 0.04 ? 0.3 : 0;
  return full > 0.10 ? 1.0 : full > 0.05 ? 0.3 : 0;
}

// ══════════════════════════════════════════════════
// OVERLAY DRAWING
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
  octx.strokeStyle = score > 0.6 ? '#10b981' : '#06b6d4';
  octx.lineWidth = 3;
  const s = 35;
  for (const [x,y,dx,dy] of [[0,0,1,1],[w,0,-1,1],[0,h,1,-1],[w,h,-1,-1]]) {
    octx.beginPath();
    octx.moveTo(x+dx*s, y); octx.lineTo(x, y); octx.lineTo(x, y+dy*s);
    octx.stroke();
  }

  // Draw MediaPipe skeleton
  if (useMediaPipe && mpDrawingUtils && _PoseLandmarker && _HandLandmarker) {
    if (poseResult?.landmarks) {
      for (const landmarks of poseResult.landmarks) {
        const mirrored = landmarks.map(l => ({ ...l, x: 1 - l.x }));
        mpDrawingUtils.drawConnectors(mirrored, _PoseLandmarker.POSE_CONNECTIONS, { color: '#00FF66AA', lineWidth: 2.5 });
        mpDrawingUtils.drawLandmarks(mirrored, { color: '#FF3333BB', fillColor: '#00FF6644', radius: 3, lineWidth: 1 });
      }
    }
    if (handResult?.landmarks) {
      for (const landmarks of handResult.landmarks) {
        const mirrored = landmarks.map(l => ({ ...l, x: 1 - l.x }));
        mpDrawingUtils.drawConnectors(mirrored, _HandLandmarker.HAND_CONNECTIONS, { color: '#06B6D4BB', lineWidth: 2.5 });
        mpDrawingUtils.drawLandmarks(mirrored, { color: '#FF2D2DBB', fillColor: '#06B6D444', radius: 2.5, lineWidth: 1 });
      }
    }
  } else {
    // Static skeleton fallback
    const SKP = [[.50,.10],[.50,.20],[.35,.22],[.65,.22],[.22,.35],[.78,.35],[.15,.48],[.85,.48],[.50,.55],[.40,.55],[.60,.55],[.38,.73],[.62,.73],[.36,.90],[.64,.90]];
    const SKB = [[0,1],[1,2],[1,3],[2,4],[4,6],[3,5],[5,7],[1,8],[8,9],[8,10],[9,11],[11,13],[10,12],[12,14]];
    octx.strokeStyle = 'rgba(0,255,100,0.12)'; octx.lineWidth = 1.5;
    for (const [a,b] of SKB) { octx.beginPath(); octx.moveTo(SKP[a][0]*w,SKP[a][1]*h); octx.lineTo(SKP[b][0]*w,SKP[b][1]*h); octx.stroke(); }
  }

  // Grid
  octx.strokeStyle = 'rgba(6,182,212,0.03)'; octx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 40) { octx.beginPath(); octx.moveTo(x,0); octx.lineTo(x,h); octx.stroke(); }
  for (let y = 0; y < h; y += 40) { octx.beginPath(); octx.moveTo(0,y); octx.lineTo(w,y); octx.stroke(); }

  // REC
  if (Math.floor(frameCount/15) % 2 === 0) {
    octx.beginPath(); octx.arc(w-16, 14, 5, 0, Math.PI*2);
    octx.fillStyle = '#ff2d2d'; octx.fill();
    octx.fillStyle = '#fff'; octx.font = '10px monospace'; octx.fillText('REC', w-38, 18);
  }

  octx.fillStyle = 'rgba(6,182,212,0.5)'; octx.font = '10px monospace';
  octx.fillText(`${useMediaPipe ? '🦴 MEDIAPIPE' : '📡 MOTION'} | TARGET: ${GESTURE}`, 8, 16);

  // Progress bar
  const progress = Math.min(accumulated / REQUIRED, 1);
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

  let rawScore = 0;
  let poseResult = null, handResult = null;

  if (useMediaPipe) {
    mpTimestamp = Math.max(mpTimestamp + 1, Math.round(currentVideoTime * 1000));
    try {
      poseResult = poseLandmarker.detectForVideo(video, mpTimestamp);
      handResult = handLandmarker.detectForVideo(video, mpTimestamp);
      rawScore = evaluateGestureMP(GESTURE, poseResult, handResult);
    } catch (e) {
      console.warn('[camera] MediaPipe error:', e.message);
    }
  } else {
    const imageData = vctx.getImageData(0, 0, w, h);
    rawScore = evaluateGestureFallback(imageData.data, w, h);
    prevData = imageData.data.slice();
  }

  // Average smoothing (not max!) — prevents lucky single frames
  const score = smoothedScore(rawScore);

  // STRICT accumulation:
  // score >= 0.6 = full credit (gesture confirmed)
  // score 0.3-0.6 = 25% credit (partial match, slow progress)
  // score < 0.3 = NO credit
  if (score >= 0.6) accumulated += score;
  else if (score >= 0.3) accumulated += score * 0.25;

  drawOverlay(w, h, score, poseResult, handResult);
  frameCount++;

  const progress = Math.min(accumulated / REQUIRED, 1);

  if (score >= 0.6) {
    statusEl.textContent = `🦴 GESTURE MATCHED — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#10b981';
  } else if (score >= 0.3) {
    statusEl.textContent = `📡 PARTIAL — keep going — ${Math.round(progress*100)}%`;
    statusEl.style.color = '#eab308';
  } else {
    statusEl.textContent = `Perform: ${GESTURE}`;
    statusEl.style.color = '#06b6d4';
  }

  parent.postMessage({
    event: 'progress', value: progress,
    detected: score >= 0.3, gestureScore: score,
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
