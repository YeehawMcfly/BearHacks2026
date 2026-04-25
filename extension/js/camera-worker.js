/**
 * Camera Worker — MediaPipe PoseLandmarker + HandLandmarker
 * Loaded as an external module from camera.html (CSP compliant).
 * Falls back to zone pixel-diff if MediaPipe fails.
 */

const params = new URLSearchParams(location.search);
const GESTURE = (params.get('gesture') || 'WAVE').toUpperCase();
const REQUIRED = parseInt(params.get('frames') || '35');
const IS_PRELOAD = params.get('preload') === '1';

function localUrl(path) {
  return new URL(`assets/models/${path}`, location.href).href;
}

const video = document.getElementById('video');
const vc = document.getElementById('video-canvas');
const oc = document.getElementById('overlay-canvas');
const vctx = vc.getContext('2d');
const octx = oc.getContext('2d');
const statusEl = document.getElementById('status');
const loadEl = document.getElementById('load-status');
const loadSubEl = document.getElementById('load-sub');

let stream = null;
let running = false;
let accumulated = 0;
let frameCount = 0;
let scanLineY = 0;
let poseLandmarker = null;
let handLandmarker = null;
let drawUtils = null;
let useMediaPipe = false;
let _PoseLandmarker = null;
let _HandLandmarker = null;

// ── MediaPipe Init (local files) ──
async function initMediaPipe() {
  try {
    if (loadSubEl) loadSubEl.textContent = 'Loading vision bundle...';
    const { PoseLandmarker, HandLandmarker, FilesetResolver, DrawingUtils } =
      await import(localUrl('vision_bundle.mjs'));

    if (loadSubEl) loadSubEl.textContent = 'Resolving WASM...';
    const vision = await FilesetResolver.forVisionTasks(
      new URL('assets/models', location.href).href
    );

    if (loadSubEl) loadSubEl.textContent = 'Loading PoseLandmarker...';
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: localUrl('pose_landmarker_lite.task'), delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1
    });

    if (loadSubEl) loadSubEl.textContent = 'Loading HandLandmarker...';
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: localUrl('hand_landmarker.task'), delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 2
    });

    drawUtils = new DrawingUtils(octx);
    useMediaPipe = true;
    _PoseLandmarker = PoseLandmarker;
    _HandLandmarker = HandLandmarker;
    if (loadSubEl) loadSubEl.textContent = 'Ready!';
    return true;
  } catch (err) {
    console.warn('MediaPipe failed, using pixel-diff fallback:', err);
    if (loadSubEl) loadSubEl.textContent = 'Using motion detection fallback';
    useMediaPipe = false;
    return false;
  }
}

// ── MediaPipe Gesture Evaluation ──
function evaluateGestureMP(gesture, pose, hands) {
  const pl = pose?.landmarks?.[0];
  const hl = hands?.landmarks;
  const g = gesture;
  if (g.includes('WAVE') || g.includes('HAND')) {
    if (hl?.length > 0 && pl) return hl[0][0].y < pl[24].y ? 1 : 0;
    return 0;
  }
  if (g.includes('SALUTE')) {
    if (hl?.length > 0 && pl) {
      const d = Math.hypot(hl[0][0].x - pl[0].x, hl[0][0].y - pl[0].y);
      return d < 0.22 && hl[0][0].y < pl[0].y + 0.12 ? 1 : 0;
    }
    return 0;
  }
  if (g.includes('THUMBS')) {
    if (hl?.length > 0) {
      return hl[0][4].y < hl[0][3].y && hl[0][8].y > hl[0][6].y && hl[0][12].y > hl[0][10].y ? 1 : 0;
    }
    return 0;
  }
  if (g.includes('CLAP')) {
    if (hl?.length >= 2) return Math.hypot(hl[0][0].x - hl[1][0].x, hl[0][0].y - hl[1][0].y) < 0.18 ? 1 : 0;
    return 0;
  }
  if (g.includes('NOD') || g.includes('HEAD')) return pl ? 0.8 : 0;
  if (g.includes('JUMPING JACKS')) {
    if (pl) return pl[15].y < pl[11].y && pl[16].y < pl[12].y ? 1 : 0.2;
    return 0;
  }
  if (g.includes('SQUAT')) {
    if (pl) return pl[24].y > pl[26].y - 0.05 ? 1 : 0.2;
    return 0;
  }
  if (g.includes('ARM CIRCLES') || g.includes('HELICOPTER')) {
    if (pl) return Math.hypot(pl[15].x - pl[12].x, pl[15].y - pl[12].y) > 0.3 ? 1 : 0.2;
    return 0;
  }
  if (g.includes('MARCH')) {
    if (pl) return Math.abs(pl[25].y - pl[26].y) > 0.05 ? 1 : 0.3;
    return 0;
  }
  return (hl?.length > 0 ? 0.6 : 0) + (pl ? 0.4 : 0);
}

// ── Pixel-Diff Fallback ──
let prevData = null;
function zoneMotion(data, zone, w, h, T = 30) {
  if (!prevData) return 0;
  const x1 = Math.floor(zone.x1*w), y1 = Math.floor(zone.y1*h);
  const x2 = Math.floor(zone.x2*w), y2 = Math.floor(zone.y2*h);
  let changed = 0, total = 0;
  for (let y = y1; y < y2; y += 2) for (let x = x1; x < x2; x += 2) {
    const i = (y*w+x)*4;
    if (Math.abs(data[i]-prevData[i])+Math.abs(data[i+1]-prevData[i+1])+Math.abs(data[i+2]-prevData[i+2]) > T) changed++;
    total++;
  }
  return total > 0 ? changed/total : 0;
}
const Z = {
  upper: {x1:.1,y1:0,x2:.9,y2:.45}, lower: {x1:.1,y1:.55,x2:.9,y2:1},
  left: {x1:0,y1:.1,x2:.45,y2:.9}, right: {x1:.55,y1:.1,x2:1,y2:.9},
  topL: {x1:0,y1:0,x2:.5,y2:.5}, topR: {x1:.5,y1:0,x2:1,y2:.5},
};
function evaluateGesturePD(imageData, w, h) {
  const d = imageData.data, g = GESTURE;
  const up = zoneMotion(d,Z.upper,w,h), lo = zoneMotion(d,Z.lower,w,h);
  const le = zoneMotion(d,Z.left,w,h), ri = zoneMotion(d,Z.right,w,h);
  const tL = zoneMotion(d,Z.topL,w,h), tR = zoneMotion(d,Z.topR,w,h);
  if (g.includes('WAVE')||g.includes('HAND')) return up>.06&&(le>.05||ri>.05)?1:up>.04?.5:0;
  if (g.includes('SALUTE')) return up>.05&&(tL>.04||tR>.04)?1:0;
  if (g.includes('CLAP')) return le>.05&&ri>.05?1:up>.08?.5:0;
  if (g.includes('THUMBS')) return (tL>.06||tR>.06)&&up>.04?1:up>.05?.4:0;
  if (g.includes('NOD')||g.includes('HEAD')) return up>.04?1:0;
  if (g.includes('JUMPING JACKS')) return tL+tR+lo>.18&&up>.06?1:up>.05?.4:0;
  if (g.includes('SQUAT')) return lo>.08?1:lo>.05?.5:0;
  if (g.includes('ARM CIRCLES')||g.includes('HELICOPTER')) return (le>.07||ri>.07)&&up>.04?1:up>.06?.4:0;
  if (g.includes('MARCH')) return lo>.06?1:lo>.03?.4:0;
  return up+lo>.10?1:up+lo>.05?.5:0;
}

// ── Scanner Overlay ──
function drawScannerOverlay(w, h, score, poseR, handR) {
  octx.clearRect(0, 0, w, h);
  scanLineY = (scanLineY + 3) % h;
  const grad = octx.createLinearGradient(0, scanLineY-20, 0, scanLineY+20);
  grad.addColorStop(0, 'rgba(6,182,212,0)');
  grad.addColorStop(0.5, `rgba(6,182,212,${0.1+score*0.15})`);
  grad.addColorStop(1, 'rgba(6,182,212,0)');
  octx.fillStyle = grad; octx.fillRect(0, scanLineY-20, w, 40);

  const bS = 30;
  octx.strokeStyle = score > 0.5 ? '#10b981' : '#06b6d4'; octx.lineWidth = 3;
  for (const [x,y,dx,dy] of [[0,0,1,1],[w,0,-1,1],[0,h,1,-1],[w,h,-1,-1]]) {
    octx.beginPath(); octx.moveTo(x+dx*bS, y); octx.lineTo(x, y); octx.lineTo(x, y+dy*bS); octx.stroke();
  }

  if (useMediaPipe && drawUtils && _PoseLandmarker && _HandLandmarker) {
    if (poseR?.landmarks) for (const lm of poseR.landmarks) {
      const m = lm.map(l => ({ ...l, x: 1 - l.x }));
      drawUtils.drawConnectors(m, _PoseLandmarker.POSE_CONNECTIONS, { color: '#00FF6680', lineWidth: 2 });
      drawUtils.drawLandmarks(m, { color: '#FF404080', fillColor: '#00FF6640', radius: 3, lineWidth: 1 });
    }
    if (handR?.landmarks) for (const lm of handR.landmarks) {
      const m = lm.map(l => ({ ...l, x: 1 - l.x }));
      drawUtils.drawConnectors(m, _HandLandmarker.HAND_CONNECTIONS, { color: '#06B6D480', lineWidth: 2 });
      drawUtils.drawLandmarks(m, { color: '#FF2D2D80', fillColor: '#06B6D440', radius: 2, lineWidth: 1 });
    }
  } else if (score > 0.3) {
    const pts = [[w*.5,h*.15],[w*.5,h*.3],[w*.3,h*.25],[w*.7,h*.25],[w*.25,h*.45],[w*.75,h*.45],[w*.5,h*.5]];
    octx.strokeStyle = '#10b98160'; octx.lineWidth = 1;
    for (let i = 0; i < pts.length-1; i++) {
      octx.beginPath(); octx.moveTo(pts[i][0],pts[i][1]); octx.lineTo(pts[i+1][0],pts[i+1][1]); octx.stroke();
    }
    pts.forEach(([x,y]) => { octx.beginPath(); octx.arc(x,y,4,0,Math.PI*2); octx.fillStyle='#10b981cc'; octx.fill(); });
  }

  if (Math.floor(frameCount/20)%2===0) {
    octx.beginPath(); octx.arc(w-16,14,5,0,Math.PI*2); octx.fillStyle='#ff2d2d'; octx.fill();
    octx.fillStyle='#fff'; octx.font='10px monospace'; octx.fillText('REC', w-38, 18);
  }
}

// ── Main Loop ──
let lastTs = 0;
function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastTs < 33) return;
  lastTs = now;

  const w = vc.width, h = vc.height;
  vctx.save(); vctx.translate(w, 0); vctx.scale(-1, 1);
  vctx.drawImage(video, 0, 0, w, h); vctx.restore();

  let score = 0, poseR = null, handR = null;
  if (useMediaPipe) {
    try {
      poseR = poseLandmarker.detectForVideo(video, now);
      handR = handLandmarker.detectForVideo(video, now);
      score = evaluateGestureMP(GESTURE, poseR, handR);
    } catch (_) {}
  } else {
    const img = vctx.getImageData(0, 0, w, h);
    score = evaluateGesturePD(img, w, h);
    prevData = img.data.slice();
  }

  if (score > 0) accumulated += score;
  drawScannerOverlay(w, h, score, poseR, handR);
  frameCount++;

  const progress = Math.min(accumulated / REQUIRED, 1);
  statusEl.textContent = score > 0
    ? `${useMediaPipe ? '🦴 SKELETON' : '📡 MOTION'} DETECTED — ${Math.round(progress*100)}%`
    : `Perform: ${GESTURE}`;

  parent.postMessage({
    event: 'progress', value: progress, detected: score > 0,
    hasPose: useMediaPipe ? !!(poseR?.landmarks?.length) : score > 0.5,
    hasHands: useMediaPipe ? !!(handR?.landmarks?.length) : score > 0.3,
    score: accumulated, gestureScore: score, mode: useMediaPipe ? 'mediapipe' : 'pixeldiff'
  }, '*');

  if (progress >= 1) {
    running = false;
    parent.postMessage({ event: 'complete' }, '*');
    if (stream) stream.getTracks().forEach(t => t.stop());
  }
}

async function startCamera() {
  if (IS_PRELOAD) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, facingMode:'user' }, audio:false });
    video.srcObject = stream; await video.play();
    vc.width = oc.width = video.videoWidth || 640;
    vc.height = oc.height = video.videoHeight || 480;
    if (loadEl) loadEl.style.display = 'none';
    running = true;
    parent.postMessage({ event: 'camera-started', mediapipe: useMediaPipe }, '*');
    loop();
  } catch(e) { parent.postMessage({ event: 'camera-error', message: e.message }, '*'); }
}

async function init() {
  if (!IS_PRELOAD) {
    if (loadSubEl) loadSubEl.textContent = 'Initializing...';
    await initMediaPipe();
  }
  parent.postMessage({ event: 'ready', mediapipe: useMediaPipe }, '*');
  // Auto-start camera unless preload
  if (!IS_PRELOAD) startCamera();
}

window.addEventListener('message', e => {
  if (e.data?.cmd === 'start') startCamera();
  if (e.data?.cmd === 'stop') { running = false; if (stream) stream.getTracks().forEach(t => t.stop()); }
});

init();
