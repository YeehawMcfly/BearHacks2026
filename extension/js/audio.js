/**
 * Audio Manager — ElevenLabs TTS with proper voice/text synchronization.
 *
 * KEY DESIGN: speak() returns a Promise<AudioElement>.
 *   - Call speak() without await for fire-and-forget (background voice)
 *   - Call await speak() + await audio.ended to block until voice finishes
 *   - stop() kills current audio and clears queue immediately
 */
(function () {
  let currentAudio = null;

  function playUrl(url) {
    return new Promise((resolve) => {
      stop(); // kill anything playing
      const audio = new Audio(url);
      currentAudio = audio;
      audio.volume = 0.85;
      audio.onended = () => { if (currentAudio === audio) currentAudio = null; resolve(audio); };
      audio.onerror = () => { if (currentAudio === audio) currentAudio = null; resolve(null); };
      audio.play().catch(() => { currentAudio = null; resolve(null); });
    });
  }

  function stop() {
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (_) {}
      currentAudio = null;
    }
  }

  // Returns a promise that resolves when audio STARTS playing (url is ready).
  // The caller can await the returned promise then await audio.onended if needed.
  async function speak(text, emotion = 'angry') {
    // Cancel any currently playing audio immediately
    stop();
    const url = await window.ReverseTest.API.getTTS(text, emotion).catch(() => null);
    if (!url) return null;
    // Don't await playback — caller decides
    return playUrl(url);
  }

  // Waits for the current audio to finish (if any)
  function waitForAudio() {
    if (!currentAudio || currentAudio.ended || currentAudio.paused) return Promise.resolve();
    return new Promise(resolve => {
      const a = currentAudio;
      a.addEventListener('ended', resolve, { once: true });
      a.addEventListener('error', resolve, { once: true });
      a.addEventListener('pause', resolve, { once: true });
    });
  }

  // Returns duration of current audio in seconds (0 if none)
  function currentDuration() {
    return currentAudio ? (currentAudio.duration || 0) : 0;
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
    } catch (_) {}
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Audio = {
    speak,
    stop,
    waitForAudio,
    currentDuration,

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
    }
  };
})();
