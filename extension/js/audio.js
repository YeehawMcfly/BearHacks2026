/**
 * Audio Manager — handles ElevenLabs TTS playback and fallback SFX
 */
(function () {
  let currentAudio = null;
  let audioQueue = [];
  let isPlaying = false;

  function playUrl(url) {
    return new Promise((resolve) => {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      const audio = new Audio(url);
      currentAudio = audio;
      audio.volume = 0.8;
      audio.onended = () => { currentAudio = null; resolve(); };
      audio.onerror = () => { currentAudio = null; resolve(); };
      audio.play().catch(() => resolve());
    });
  }

  async function processQueue() {
    if (isPlaying || audioQueue.length === 0) return;
    isPlaying = true;
    while (audioQueue.length > 0) {
      const item = audioQueue.shift();
      if (item.url) await playUrl(item.url);
    }
    isPlaying = false;
  }

  // Simple beep via Web Audio API as fallback
  function beep(freq, duration, type = 'square') {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch {}
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Audio = {
    async speak(text, emotion = 'angry') {
      const url = await window.ReverseTest.API.getTTS(text, emotion);
      if (url) {
        audioQueue.push({ url });
        processQueue();
      }
    },

    // Fallback sound effects (no server needed)
    sfx: {
      error()   { beep(200, 0.3, 'sawtooth'); setTimeout(() => beep(150, 0.4, 'sawtooth'), 150); },
      success() { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 100); setTimeout(() => beep(784, 0.25), 200); },
      warning() { beep(440, 0.2); setTimeout(() => beep(440, 0.2), 300); },
      ban()     { beep(100, 0.8, 'sawtooth'); },
      click()   { beep(800, 0.05, 'sine'); },
      dodge()   { beep(1200, 0.08, 'sine'); setTimeout(() => beep(800, 0.08, 'sine'), 50); },
      alarm()   {
        let i = 0;
        const id = setInterval(() => {
          beep(i % 2 ? 880 : 660, 0.15, 'square');
          if (++i >= 6) clearInterval(id);
        }, 200);
      },
      tick()    { beep(1000, 0.03, 'sine'); }
    },

    stop() {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      audioQueue = [];
      isPlaying = false;
    }
  };
})();
