/**
 * MediaPipe Bridge — Injected into the PAGE context (not content script)
 * because MediaPipe requires ES module imports.
 *
 * Communicates with the content script via CustomEvents on document.
 *
 * Events sent TO content script:
 *   'mp-ready'     → { ready: true }
 *   'mp-landmarks' → { pose: [...], hands: [...], timestamp }
 *   'mp-error'     → { error: string }
 *
 * Events received FROM content script:
 *   'mp-start'  → start detection loop
 *   'mp-stop'   → stop detection loop and release camera
 */
(async function () {
  const MP_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';
  const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

  let poseLandmarker = null;
  let handLandmarker = null;
  let video = null;
  let stream = null;
  let running = false;
  let animFrameId = null;

  function send(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }

  try {
    const vision = await import(MP_CDN);
    const { FilesetResolver, PoseLandmarker, HandLandmarker } = vision;

    const wasmFileset = await FilesetResolver.forVisionTasks(WASM_PATH);

    const poseCanvas = document.createElement('canvas');
    poseCanvas.width = 1;
    poseCanvas.height = 1;
    const handCanvas = document.createElement('canvas');
    handCanvas.width = 1;
    handCanvas.height = 1;

    try {
      poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        canvas: poseCanvas
      });
      handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        canvas: handCanvas
      });
      console.log('[mediapipe-bridge] WebGL2 GPU: PoseLandmarker + HandLandmarker');
    } catch (gpuErr) {
      console.warn('[mediapipe-bridge] GPU init failed, CPU fallback:', gpuErr?.message || gpuErr);
      poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1
      });
      handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2
      });
    }

    send('mp-ready', { ready: true });
  } catch (err) {
    send('mp-error', { error: 'Failed to load MediaPipe: ' + err.message });
    return;
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      await video.play();
      return true;
    } catch (err) {
      send('mp-error', { error: 'Camera access denied: ' + err.message });
      return false;
    }
  }

  function stopCamera() {
    running = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (video) {
      video.pause();
      video.srcObject = null;
      video = null;
    }
  }

  let lastTimestamp = -1;

  function detect() {
    if (!running || !video || video.readyState < 2) {
      if (running) animFrameId = requestAnimationFrame(detect);
      return;
    }

    const ts = performance.now();
    if (ts === lastTimestamp) {
      animFrameId = requestAnimationFrame(detect);
      return;
    }
    lastTimestamp = ts;

    try {
      const poseResult = poseLandmarker.detectForVideo(video, ts);
      const handResult = handLandmarker.detectForVideo(video, ts);

      const pose = poseResult.landmarks?.[0] || null;
      const hands = handResult.landmarks || [];
      const handedness = handResult.handednesses || [];

      send('mp-landmarks', {
        pose,
        hands,
        handedness,
        timestamp: ts,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight
      });
    } catch (e) {
      // Silently skip frame errors
    }

    if (running) animFrameId = requestAnimationFrame(detect);
  }

  // Listen for commands from content script
  document.addEventListener('mp-start', async () => {
    if (running) return;
    const ok = await startCamera();
    if (!ok) return;
    running = true;
    // Send video element dimensions
    send('mp-camera-ready', {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight
    });
    animFrameId = requestAnimationFrame(detect);
  });

  document.addEventListener('mp-stop', () => {
    stopCamera();
    send('mp-stopped', { stopped: true });
  });
})();
