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

  let currentUtterance = null; // For Web Speech API fallback

  function revokeIfBlob(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  }

  /** @param {string|null} fallbackText - if play() fails (autoplay) or decode errors, use Web Speech */
  function playUrl(url, fallbackText = null) {
    return new Promise((resolve) => {
      stop(); // kill anything playing
      const audio = new Audio(url);
      currentAudio = audio;
      audio.volume = 0.85;
      const finishFallback = () => {
        revokeIfBlob(url);
        if (fallbackText) playFallbackSpeech(fallbackText).then(resolve);
        else resolve(null);
      };
      audio.onended = () => {
        if (currentAudio === audio) currentAudio = null;
        revokeIfBlob(url);
        resolve(audio);
      };
      audio.onerror = () => {
        if (currentAudio === audio) currentAudio = null;
        finishFallback();
      };
      audio.play().catch(() => {
        if (currentAudio === audio) currentAudio = null;
        finishFallback();
      });
    });
  }

  function playFallbackSpeech(text) {
    return new Promise((resolve) => {
      stop();
      if (!window.speechSynthesis) return resolve(null);
      const utterance = new SpeechSynthesisUtterance(text);
      currentUtterance = utterance;
      utterance.rate = 1.1; // Slightly faster for the drill sergeant
      utterance.pitch = 0.8; // Deeper pitch
      
      utterance.onend = () => { if (currentUtterance === utterance) currentUtterance = null; resolve(utterance); };
      utterance.onerror = () => { if (currentUtterance === utterance) currentUtterance = null; resolve(null); };
      window.speechSynthesis.speak(utterance);
    });
  }

  function stop() {
    if (currentAudio) {
      try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (_) {}
      currentAudio = null;
    }
    if (currentUtterance && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      currentUtterance = null;
    }
  }

  // Returns a promise that resolves when audio STARTS playing (url is ready).
  // The caller can await the returned promise then await audio.onended if needed.
  async function speak(text, emotion = 'angry') {
    stop();
    const url = await window.ReverseTest.API.getTTS(text, emotion).catch(() => null);
    if (!url) {
      return playFallbackSpeech(text);
    }
    return playUrl(url, text);
  }

  /**
   * Play TTS from a getTTS() promise (e.g. started during a click so fetch runs early).
   * After await, stops SFX and plays — still passes fallbackText if decode/play fails.
   */
  async function playPreparedTts(ttsPromise, fallbackText) {
    const url = await ttsPromise.catch(() => null);
    stop();
    if (!url) {
      return playFallbackSpeech(fallbackText);
    }
    return playUrl(url, fallbackText);
  }

  // Waits for the current audio to finish (if any)
  function waitForAudio() {
    if (currentUtterance && window.speechSynthesis && window.speechSynthesis.speaking) {
      return new Promise(resolve => {
        const check = setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

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

  // One shared context for all SFX — creating a new AudioContext per beep hits browser limits and
  // triggers "The AudioContext encountered an error from the audio device or the WebAudio renderer."
  let sfxContext = null;

  function getSfxContext() {
    if (sfxContext && sfxContext.state !== 'closed') return sfxContext;
    sfxContext = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      sfxContext = new AC();
    } catch (_) {
      sfxContext = null;
    }
    return sfxContext;
  }

  function ensureSfxRunning(ctx) {
    if (!ctx || ctx.state === 'closed') return Promise.resolve();
    if (ctx.state === 'suspended') {
      return ctx.resume().catch(() => {});
    }
    return Promise.resolve();
  }

  /** Fire-and-forget tone; uses shared context + resume (required after autoplay policies). */
  function beep(freq, duration, type = 'square') {
    const ctx = getSfxContext();
    if (!ctx) return;
    ensureSfxRunning(ctx).then(() => {
      try {
        if (!sfxContext || sfxContext.state === 'closed') return;
        const c = sfxContext;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const t0 = c.currentTime;
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + Math.max(0.02, duration));
        osc.connect(gain).connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + duration);
      } catch (_) {}
    });
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.Audio = {
    speak,
    playPreparedTts,
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
