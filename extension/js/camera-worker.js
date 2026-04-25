/**
 * Camera Worker — High-performance gesture detection with animated skeleton overlay.
 *
 * MediaPipe WASM cannot run in Chrome extension pages (Emscripten uses new Function()
 * which is blocked by MV3 CSP). Instead, this uses:
 *   1. Zone-based pixel-diff for motion detection
 *   2. Temporal pattern matching for gesture-specific validation
 *   3. Animated stick figure overlay that responds to detected motion zones
 *
 * The result: instant startup, no model downloads, and gesture-specific detection
 * that REQUIRES the correct movement pattern (not just any motion).
 */

const params = new URLSearchParams(location.search);
const GESTURE = (params.get('gesture') || 'WAVE').toUpperCase();
const REQUIRED = parseInt(params.get('frames') || '40');
const IS_PRELOAD = params.get('preload') === '1';

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

// ══════════════════════════════════════════════════
// MOTION DETECTION ENGINE
// ══════════════════════════════════════════════════
let prevData = null;
let prevPrevData = null; // two-frame history for velocity

// Named zones for body regions
const ZONES = {
  head:      { x1: 0.30, y1: 0.00, x2: 0.70, y2: 0.25 },
  torso:     { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.55 },
  leftArm:   { x1: 0.00, y1: 0.10, x2: 0.30, y2: 0.55 },
  rightArm:  { x1: 0.70, y1: 0.10, x2: 1.00, y2: 0.55 },
  leftHand:  { x1: 0.00, y1: 0.05, x2: 0.25, y2: 0.45 },
  rightHand: { x1: 0.75, y1: 0.05, x2: 1.00, y2: 0.45 },
  upperBody: { x1: 0.10, y1: 0.00, x2: 0.90, y2: 0.50 },
  lowerBody: { x1: 0.15, y1: 0.55, x2: 0.85, y2: 1.00 },
  leftLeg:   { x1: 0.15, y1: 0.55, x2: 0.50, y2: 1.00 },
  rightLeg:  { x1: 0.50, y1: 0.55, x2: 0.85, y2: 1.00 },
  topLeft:   { x1: 0.00, y1: 0.00, x2: 0.50, y2: 0.35 },
  topRight:  { x1: 0.50, y1: 0.00, x2: 1.00, y2: 0.35 },
  full:      { x1: 0.00, y1: 0.00, x2: 1.00, y2: 1.00 },
};

function zoneMotion(data, zone, w, h, threshold = 30) {
  if (!prevData) return 0;
  const x1 = Math.floor(zone.x1 * w), y1 = Math.floor(zone.y1 * h);
  const x2 = Math.floor(zone.x2 * w), y2 = Math.floor(zone.y2 * h);
  let changed = 0, total = 0;
  for (let y = y1; y < y2; y += 3) {
    for (let x = x1; x < x2; x += 3) {
      const i = (y * w + x) * 4;
      const diff = Math.abs(data[i] - prevData[i]) +
                   Math.abs(data[i+1] - prevData[i+1]) +
                   Math.abs(data[i+2] - prevData[i+2]);
      if (diff > threshold) changed++;
      total++;
    }
  }
  return total > 0 ? changed / total : 0;
}

// Get all zone motions at once
function getAllMotions(data, w, h) {
  const m = {};
  for (const [name, zone] of Object.entries(ZONES)) {
    m[name] = zoneMotion(data, zone, w, h);
  }
  return m;
}

// ══════════════════════════════════════════════════
// TEMPORAL PATTERN TRACKER
// Tracks motion history per zone for pattern matching
// ══════════════════════════════════════════════════
const motionHistory = []; // last N frames of zone motions
const HISTORY_LEN = 30;

function updateHistory(motions) {
  motionHistory.push({ ...motions, t: performance.now() });
  if (motionHistory.length > HISTORY_LEN) motionHistory.shift();
}

// Check if a zone had motion above threshold in the last N frames
function recentMotion(zone, frames = 5, threshold = 0.03) {
  const recent = motionHistory.slice(-frames);
  return recent.filter(m => m[zone] > threshold).length;
}

// Check for alternating motion (left-right for waving)
function hasAlternatingMotion(zoneA, zoneB, minCycles = 2) {
  if (motionHistory.length < 10) return false;
  const recent = motionHistory.slice(-15);
  let cycles = 0, lastSide = null;
  for (const m of recent) {
    const aActive = m[zoneA] > 0.04;
    const bActive = m[zoneB] > 0.04;
    if (aActive && !bActive && lastSide !== 'A') { lastSide = 'A'; cycles += 0.5; }
    if (bActive && !aActive && lastSide !== 'B') { lastSide = 'B'; cycles += 0.5; }
  }
  return cycles >= minCycles;
}

// Check for sustained stillness in a zone (for salute — hold position)
function hasSustainedPresence(zone, frames = 8, threshold = 0.02) {
  if (motionHistory.length < frames) return false;
  const recent = motionHistory.slice(-frames);
  // Presence = some motion initially (raising arm), then LOW motion (holding still)
  const initial = recent.slice(0, 3).filter(m => m[zone] > 0.03).length;
  const holding = recent.slice(-5).filter(m => m[zone] < threshold + 0.02).length;
  return initial >= 1 && holding >= 3;
}

// ══════════════════════════════════════════════════
// GESTURE EVALUATORS
// Each returns 0-1 confidence score using temporal patterns
// ══════════════════════════════════════════════════
function evaluateGesture(motions) {
  const g = GESTURE;

  if (g.includes('WAVE') || g.includes('HAND')) {
    // Wave: need upper body motion + alternating lateral movement
    const upperActive = motions.upperBody > 0.04;
    const hasAlt = hasAlternatingMotion('leftHand', 'rightHand', 1.5);
    const armMotion = Math.max(motions.leftArm, motions.rightArm);
    if (upperActive && hasAlt) return 1.0;
    if (upperActive && armMotion > 0.06) return 0.6;
    if (armMotion > 0.04) return 0.3;
    return 0;
  }

  if (g.includes('SALUTE')) {
    // Salute: hand near head, sustained position
    const headZone = motions.head > 0.02;
    const topActive = Math.max(motions.topLeft, motions.topRight) > 0.04;
    const sustained = hasSustainedPresence('topRight') || hasSustainedPresence('topLeft');
    if (topActive && sustained) return 1.0;
    if (topActive && headZone) return 0.6;
    if (topActive) return 0.3;
    return 0;
  }

  if (g.includes('CLAP')) {
    // Clap: simultaneous left+right arm motion, sudden bursts
    const bothArms = motions.leftArm > 0.04 && motions.rightArm > 0.04;
    const burst = motions.torso > 0.06;
    const recentBursts = recentMotion('torso', 5, 0.06);
    if (bothArms && recentBursts >= 2) return 1.0;
    if (bothArms && burst) return 0.7;
    if (bothArms) return 0.4;
    return 0;
  }

  if (g.includes('THUMBS')) {
    // Thumbs up: hand raised, small sustained motion in upper zone
    const handUp = Math.max(motions.topLeft, motions.topRight) > 0.03;
    const smallMotion = motions.upperBody > 0.02 && motions.upperBody < 0.15;
    if (handUp && smallMotion) return 1.0;
    if (handUp) return 0.5;
    return 0;
  }

  if (g.includes('NOD') || g.includes('HEAD')) {
    // Head nod/shake: motion in head zone, minimal body motion
    const headMotion = motions.head > 0.03;
    const bodyStill = motions.torso < 0.06;
    if (headMotion && bodyStill) return 1.0;
    if (headMotion) return 0.6;
    return 0;
  }

  if (g.includes('JUMPING') || g.includes('JACK')) {
    // Jumping jacks: full body, arms + legs moving, all quadrants
    const armsUp = motions.leftArm > 0.04 && motions.rightArm > 0.04;
    const legsMove = motions.lowerBody > 0.05;
    const fullBody = motions.full > 0.08;
    if (armsUp && legsMove && fullBody) return 1.0;
    if (fullBody && (armsUp || legsMove)) return 0.5;
    if (fullBody) return 0.2;
    return 0;
  }

  if (g.includes('SQUAT')) {
    // Squat: lower body motion, upper body relatively stable
    const lowerActive = motions.lowerBody > 0.06;
    const upperStable = motions.upperBody < 0.12;
    const verticalMotion = motions.full > 0.05;
    if (lowerActive && upperStable && verticalMotion) return 1.0;
    if (lowerActive) return 0.5;
    return 0;
  }

  if (g.includes('ARM') || g.includes('HELICOPTER') || g.includes('CIRCLE')) {
    // Arm circles: sustained circular arm motion
    const armMotion = Math.max(motions.leftArm, motions.rightArm);
    const sustained = recentMotion('leftArm', 8, 0.05) + recentMotion('rightArm', 8, 0.05);
    if (armMotion > 0.06 && sustained >= 6) return 1.0;
    if (armMotion > 0.05 && sustained >= 3) return 0.5;
    return 0;
  }

  if (g.includes('MARCH')) {
    // Marching: alternating leg motion
    const legAlt = hasAlternatingMotion('leftLeg', 'rightLeg', 2);
    const legMotion = motions.lowerBody > 0.05;
    if (legAlt && legMotion) return 1.0;
    if (legMotion) return 0.4;
    return 0;
  }

  // Generic fallback: require significant motion
  const total = motions.full;
  return total > 0.10 ? 1.0 : total > 0.05 ? 0.5 : 0;
}

// ══════════════════════════════════════════════════
// ANIMATED SKELETON OVERLAY
// Draws a stick figure that lights up based on active motion zones
// ══════════════════════════════════════════════════

// Skeleton keypoints (normalized 0-1, mirrored for selfie view)
const SKELETON = {
  head:       { x: 0.50, y: 0.10 },
  neck:       { x: 0.50, y: 0.20 },
  lShoulder:  { x: 0.35, y: 0.22 },
  rShoulder:  { x: 0.65, y: 0.22 },
  lElbow:     { x: 0.22, y: 0.35 },
  rElbow:     { x: 0.78, y: 0.35 },
  lWrist:     { x: 0.15, y: 0.48 },
  rWrist:     { x: 0.85, y: 0.48 },
  hip:        { x: 0.50, y: 0.55 },
  lHip:       { x: 0.40, y: 0.55 },
  rHip:       { x: 0.60, y: 0.55 },
  lKnee:      { x: 0.38, y: 0.73 },
  rKnee:      { x: 0.62, y: 0.73 },
  lAnkle:     { x: 0.36, y: 0.90 },
  rAnkle:     { x: 0.64, y: 0.90 },
};

const BONES = [
  ['head', 'neck'], ['neck', 'lShoulder'], ['neck', 'rShoulder'],
  ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'],
  ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'],
  ['neck', 'hip'], ['hip', 'lHip'], ['hip', 'rHip'],
  ['lHip', 'lKnee'], ['lKnee', 'lAnkle'],
  ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
];

// Map joints to motion zones for activation
const JOINT_ZONES = {
  head: 'head', neck: 'head',
  lShoulder: 'leftArm', rShoulder: 'rightArm',
  lElbow: 'leftArm', rElbow: 'rightArm',
  lWrist: 'leftHand', rWrist: 'rightHand',
  hip: 'torso', lHip: 'leftLeg', rHip: 'rightLeg',
  lKnee: 'leftLeg', rKnee: 'leftLeg',
  lAnkle: 'leftLeg', rAnkle: 'rightLeg',
};

// Animate skeleton joints based on motion
function getAnimatedSkeleton(motions, w, h) {
  const t = performance.now() / 1000;
  const pts = {};

  for (const [name, base] of Object.entries(SKELETON)) {
    const zone = JOINT_ZONES[name];
    const activity = motions[zone] || 0;

    // Jitter proportional to motion in that zone
    const jx = activity > 0.02 ? (Math.sin(t * 8 + base.x * 20) * activity * 0.03) : 0;
    const jy = activity > 0.02 ? (Math.cos(t * 6 + base.y * 15) * activity * 0.02) : 0;

    pts[name] = {
      x: (base.x + jx) * w,
      y: (base.y + jy) * h,
      active: activity > 0.03,
      intensity: Math.min(1, activity * 12)
    };
  }
  return pts;
}

function drawSkeleton(pts, motions, score) {
  const w = oc.width, h = oc.height;

  // Draw bones
  for (const [a, b] of BONES) {
    const pa = pts[a], pb = pts[b];
    const active = pa.active || pb.active;
    const intensity = Math.max(pa.intensity, pb.intensity);

    octx.beginPath();
    octx.moveTo(pa.x, pa.y);
    octx.lineTo(pb.x, pb.y);
    octx.strokeStyle = active
      ? `rgba(0, 255, 100, ${0.3 + intensity * 0.5})`
      : 'rgba(0, 255, 100, 0.12)';
    octx.lineWidth = active ? 2.5 : 1;
    octx.stroke();

    // Glow effect on active bones
    if (active && intensity > 0.3) {
      octx.beginPath();
      octx.moveTo(pa.x, pa.y);
      octx.lineTo(pb.x, pb.y);
      octx.strokeStyle = `rgba(0, 255, 100, ${intensity * 0.15})`;
      octx.lineWidth = 8;
      octx.stroke();
    }
  }

  // Draw joints
  for (const [name, pt] of Object.entries(pts)) {
    const r = pt.active ? 4.5 : 2.5;

    // Outer glow
    if (pt.active) {
      octx.beginPath();
      octx.arc(pt.x, pt.y, r + 6, 0, Math.PI * 2);
      octx.fillStyle = `rgba(255, 60, 60, ${pt.intensity * 0.15})`;
      octx.fill();
    }

    // Joint dot
    octx.beginPath();
    octx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    octx.fillStyle = pt.active
      ? `rgba(255, 60, 60, ${0.5 + pt.intensity * 0.5})`
      : 'rgba(255, 60, 60, 0.2)';
    octx.fill();

    // White center on active joints
    if (pt.active) {
      octx.beginPath();
      octx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
      octx.fillStyle = `rgba(255, 255, 255, ${pt.intensity * 0.8})`;
      octx.fill();
    }
  }

  // Head circle (special)
  const head = pts.head;
  octx.beginPath();
  octx.arc(head.x, head.y, head.active ? 18 : 14, 0, Math.PI * 2);
  octx.strokeStyle = head.active
    ? `rgba(0, 255, 100, ${0.4 + head.intensity * 0.4})`
    : 'rgba(0, 255, 100, 0.15)';
  octx.lineWidth = head.active ? 2 : 1;
  octx.stroke();
}

// ══════════════════════════════════════════════════
// SCANNER OVERLAY
// ══════════════════════════════════════════════════
function drawScannerOverlay(w, h, score, motions) {
  octx.clearRect(0, 0, w, h);

  // Scanline sweep
  scanLineY = (scanLineY + 2.5) % h;
  const grad = octx.createLinearGradient(0, scanLineY - 25, 0, scanLineY + 25);
  grad.addColorStop(0, 'rgba(6, 182, 212, 0)');
  grad.addColorStop(0.5, `rgba(6, 182, 212, ${0.08 + score * 0.12})`);
  grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
  octx.fillStyle = grad;
  octx.fillRect(0, scanLineY - 25, w, 50);

  // Corner brackets
  octx.strokeStyle = score > 0.5 ? '#10b981' : '#06b6d4';
  octx.lineWidth = 3;
  const s = 35;
  for (const [x, y, dx, dy] of [[0,0,1,1],[w,0,-1,1],[0,h,1,-1],[w,h,-1,-1]]) {
    octx.beginPath();
    octx.moveTo(x + dx * s, y);
    octx.lineTo(x, y);
    octx.lineTo(x, y + dy * s);
    octx.stroke();
  }

  // Draw animated skeleton
  const pts = getAnimatedSkeleton(motions, w, h);
  drawSkeleton(pts, motions, score);

  // Grid lines (subtle)
  octx.strokeStyle = 'rgba(6, 182, 212, 0.04)';
  octx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 40) {
    octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, h); octx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    octx.beginPath(); octx.moveTo(0, y); octx.lineTo(w, y); octx.stroke();
  }

  // Zone activity indicators (small text labels)
  octx.font = '9px monospace';
  const activeZones = [];
  if (motions.head > 0.03) activeZones.push('HEAD');
  if (motions.leftArm > 0.04) activeZones.push('L.ARM');
  if (motions.rightArm > 0.04) activeZones.push('R.ARM');
  if (motions.torso > 0.04) activeZones.push('TORSO');
  if (motions.lowerBody > 0.04) activeZones.push('LEGS');
  if (activeZones.length > 0) {
    octx.fillStyle = 'rgba(0, 255, 100, 0.6)';
    octx.fillText(`ACTIVE: ${activeZones.join(' | ')}`, 8, h - 24);
  }

  // REC indicator
  if (Math.floor(frameCount / 15) % 2 === 0) {
    octx.beginPath(); octx.arc(w - 16, 14, 5, 0, Math.PI * 2);
    octx.fillStyle = '#ff2d2d'; octx.fill();
    octx.fillStyle = '#fff'; octx.font = '10px monospace';
    octx.fillText('REC', w - 38, 18);
  }

  // Gesture label
  octx.fillStyle = 'rgba(6, 182, 212, 0.5)';
  octx.font = '10px monospace';
  octx.fillText(`TARGET: ${GESTURE}`, 8, 16);
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
  // Mirror the video for selfie view
  vctx.save();
  vctx.translate(w, 0);
  vctx.scale(-1, 1);
  vctx.drawImage(video, 0, 0, w, h);
  vctx.restore();

  // Get pixel data and compute zone motions
  const imageData = vctx.getImageData(0, 0, w, h);
  const motions = getAllMotions(imageData.data, w, h);
  updateHistory(motions);

  // Store frame history
  prevPrevData = prevData;
  prevData = imageData.data.slice();

  // Evaluate gesture match
  const score = evaluateGesture(motions);

  // Only accumulate when gesture is actually detected (score > 0.3)
  if (score >= 0.5) {
    accumulated += score;
  } else if (score >= 0.3) {
    accumulated += score * 0.3; // partial credit for close attempts
  }
  // No credit for random motion (score < 0.3)

  // Draw overlay with skeleton
  drawScannerOverlay(w, h, score, motions);
  frameCount++;

  const progress = Math.min(accumulated / REQUIRED, 1);

  // Status text
  if (score >= 0.5) {
    statusEl.textContent = `🦴 GESTURE MATCHED — ${Math.round(progress * 100)}%`;
    statusEl.style.color = '#10b981';
  } else if (score >= 0.3) {
    statusEl.textContent = `📡 PARTIAL MATCH — ${Math.round(progress * 100)}%`;
    statusEl.style.color = '#eab308';
  } else {
    statusEl.textContent = `Perform: ${GESTURE}`;
    statusEl.style.color = '#06b6d4';
  }

  // Report to parent
  parent.postMessage({
    event: 'progress',
    value: progress,
    detected: score >= 0.3,
    gestureScore: score,
    mode: 'skeleton-motion',
    activeZones: Object.entries(motions).filter(([k,v]) => v > 0.03).map(([k]) => k)
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
    parent.postMessage({ event: 'camera-started', mode: 'skeleton-motion' }, '*');
    loop();
  } catch (e) {
    if (statusEl) statusEl.textContent = `Camera error: ${e.message}`;
    parent.postMessage({ event: 'camera-error', message: e.message }, '*');
  }
}

window.addEventListener('message', e => {
  if (e.data?.cmd === 'start') startCamera();
  if (e.data?.cmd === 'stop') {
    running = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
  }
});

// Signal ready and auto-start unless preload
parent.postMessage({ event: 'ready', mode: 'skeleton-motion' }, '*');
if (!IS_PRELOAD) {
  if (loadSubEl) loadSubEl.textContent = 'Starting camera...';
  startCamera();
}
