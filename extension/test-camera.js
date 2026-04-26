document.addEventListener('DOMContentLoaded', () => {
  const iframe = document.getElementById('cameraIframe');
  const select = document.getElementById('gestureSelect');
  const btn = document.getElementById('startBtn');
  const logBox = document.getElementById('logBox');

  function log(msg, color = '#10b981') {
    const d = document.createElement('div');
    d.style.color = color;
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logBox.prepend(d);
  }

  btn.addEventListener('click', () => {
    const gesture = select.value;
    log(`Loading gesture: ${gesture}`, '#06b6d4');
    
    // The camera.html expects URL parameters for the gesture
    const url = `camera.html?gesture=${encodeURIComponent(gesture)}&frames=60`;
    iframe.src = url;
  });

  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return;
    const data = e.data;
    if (!data?.event) return;

    switch (data.event) {
      case 'ready':
        log(`MediaPipe initialized (Mode: ${data.mediapipe ? 'GPU/CPU' : 'Fallback'})`, '#f59e0b');
        iframe.contentWindow.postMessage({ cmd: 'start' }, '*');
        break;
      
      case 'camera-started':
        log('Camera stream started', '#06b6d4');
        break;
        
      case 'camera-error':
        log(`Camera Error: ${data.message}`, '#ff2d2d');
        break;

      case 'progress':
        // Only log major progress changes to avoid spam
        if (data.detected) {
          log(`GESTURE DETECTED! Score: ${data.gestureScore.toFixed(2)} | Progress: ${Math.round(data.value * 100)}%`);
        }
        break;
        
      case 'complete':
        log('TEST PASSED! 100% COMPLETE.', '#10b981');
        break;
    }
  });
});
