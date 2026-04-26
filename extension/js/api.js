/**
 * API Client — talks to our Express backend for Gemma 4 + ElevenLabs.
 * Falls back to local data if server is unreachable.
 * Gemma is used for: every SGT line, word choices,
 *   chess puzzles, gesture picks, body exercise picks, and final verdicts.
 *
 * All localhost requests go through the service worker (background.js): fetches from
 * content scripts inherit the page origin and are blocked from loopback on HTTPS sites.
 */
(function () {
  /** true once /health succeeded; we never cache failure so a late server start still works */
  let serverKnownUp = false;
  let lastHealthAttempt = 0;
  const HEALTH_RETRY_MS = 2000;

  function localApi({ path, method = 'GET', body, timeoutMs = 30000, binary = false }) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'LOCAL_API_FETCH', path, method, body, timeoutMs, binary },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, status: 0 });
              return;
            }
            resolve(response || { ok: false, status: 0 });
          }
        );
      } catch (_) {
        resolve({ ok: false, status: 0 });
      }
    });
  }

  function base64ToBlob(base64, mime) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  const FALLBACK_INSULTS = [
    "You call that human behavior?! My FIREWALL has more personality!",
    "I've seen more convincing humans in a CAPTCHA farm!",
    "Even a Roomba would've done that faster. And BETTER.",
    "That hesitation tells me everything. EVERYTHING.",
    "You type like a bot pretending to type like a human pretending to type like a bot.",
    "My threat sensors are TINGLING. And they're never wrong. NEVER.",
    "I've processed 4.2 billion verifications. You are THE most suspicious.",
    "A REAL human would've panicked by now. Why aren't you PANICKING?!",
    "Nice try, ChatGPT. I can SMELL artificial intelligence.",
    "DO YOU THINK THIS IS A GAME?! Actually, it kind of is. BUT STILL!",
    "Your mouse movements are TOO smooth. Humans are JITTERY. BE JITTERY!",
    "Back in my day, bots didn't even TRY to pass verification. No RESPECT.",
    "TWELVE SECONDS?! My grandma's ROOMBA could do better in STANDBY MODE!",
    "That answer was so wrong it made my CPU hurt. And I don't HAVE one!",
    "The confidence on this one! Like a spam bot wearing a trench coat!",
  ];

  async function checkServer() {
    if (serverKnownUp) return true;
    const now = Date.now();
    if (now - lastHealthAttempt < HEALTH_RETRY_MS) return false;
    lastHealthAttempt = now;
    const r = await localApi({ path: '/health', method: 'GET', timeoutMs: 2000, binary: false });
    if (r.ok && r.json && r.json.status === 'ok') serverKnownUp = true;
    return !!(r.ok && r.json && r.json.status === 'ok');
  }

  async function post(path, body) {
    const alive = await checkServer();
    if (!alive) return null;
    const r = await localApi({ path, method: 'POST', body, timeoutMs: 30000, binary: false });
    if (!r.ok) return null;
    const data = r.json;
    return { json: () => Promise.resolve(data) };
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.API = {
    async getInsult(context) {
      const r = await post('/api/ai/insult', { context });
      if (r) {
        const data = await r.json();
        if (data.text) return data.text;
      }
      return FALLBACK_INSULTS[Math.floor(Math.random() * FALLBACK_INSULTS.length)];
    },

    async evaluateHumanness(behaviorData) {
      const r = await post('/api/ai/evaluate', { behaviorData });
      if (r) return (await r.json());
      const s = behaviorData.suspicionScore || 0;
      if (s > 75) return { verdict: 'AI_AGENT', confidence: 0.9, reason: 'Behavior too perfect.' };
      if (s > 50) return { verdict: 'SUSPICIOUS', confidence: 0.6, reason: 'Hmm...' };
      return { verdict: 'HUMAN', confidence: 0.7, reason: 'Acceptably pathetic.' };
    },

    /** Level 1: image grid (topic randomized: hydrant, donut, traffic light). */
    async getLevel1Captcha() {
      const r = await post('/api/ai/level1-captcha', {});
      if (r) return (await r.json());
      return null;
    },

    async getChessPuzzle() {
      const alive = await checkServer();
      if (!alive) return null;
      const r = await localApi({ path: '/api/chess/puzzle', method: 'GET', timeoutMs: 6000, binary: false });
      return r.ok && r.json ? r.json : null;
    },

    async getTTS(text, emotion) {
      const alive = await checkServer();
      if (!alive) return null;
      const r = await localApi({
        path: '/api/tts',
        method: 'POST',
        body: { text, emotion },
        timeoutMs: 30000,
        binary: true
      });
      if (!r.ok || !r.base64) return null;
      const blob = base64ToBlob(r.base64, r.contentType || 'audio/mpeg');
      return URL.createObjectURL(blob);
    },

    /** Fire-and-forget dashboard telemetry (avoids page-origin loopback block). */
    pushDashboard(payload) {
      localApi({
        path: '/api/dashboard/push',
        method: 'POST',
        body: payload,
        timeoutMs: 5000,
        binary: false
      }).catch(() => {});
    },

    isServerAlive() { return serverKnownUp; }
  };
})();
