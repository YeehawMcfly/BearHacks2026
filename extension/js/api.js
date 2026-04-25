/**
 * API Client — talks to our Express backend for Gemma 4 + ElevenLabs
 * Falls back to local data if server is unreachable.
 */
(function () {
  const SERVER = 'http://localhost:3000';
  let serverAlive = null; // null = unknown, true/false

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
  ];

  async function checkServer() {
    if (serverAlive !== null) return serverAlive;
    try {
      const r = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2000) });
      serverAlive = r.ok;
    } catch { serverAlive = false; }
    return serverAlive;
  }

  async function post(path, body) {
    const alive = await checkServer();
    if (!alive) return null;
    try {
      const r = await fetch(`${SERVER}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      return r.ok ? r : null;
    } catch { return null; }
  }

  window.ReverseTest = window.ReverseTest || {};
  window.ReverseTest.API = {
    async getInsult(context) {
      const r = await post('/api/ai/insult', { context });
      if (r) {
        const data = await r.json();
        return data.text;
      }
      return FALLBACK_INSULTS[Math.floor(Math.random() * FALLBACK_INSULTS.length)];
    },

    async evaluateHumanness(behaviorData) {
      const r = await post('/api/ai/evaluate', { behaviorData });
      if (r) return (await r.json());
      // Fallback: simple scoring
      const s = behaviorData.suspicionScore || 0;
      if (s > 75) return { verdict: 'AI_AGENT', confidence: 0.9, reason: 'Behavior too perfect.' };
      if (s > 50) return { verdict: 'SUSPICIOUS', confidence: 0.6, reason: 'Hmm...' };
      return { verdict: 'HUMAN', confidence: 0.7, reason: 'Acceptably pathetic.' };
    },

    async generateChallenge(level) {
      const r = await post('/api/ai/challenge', { level });
      if (r) return (await r.json());
      return null; // Levels use their own defaults
    },

    async getMathProblem() {
      const r = await post('/api/ai/math', {});
      if (r) return (await r.json());
      return null; // Level 4 uses its own hardcoded fallbacks
    },

    async getTTS(text, emotion) {
      const r = await post('/api/tts', { text, emotion });
      if (r) {
        const blob = await r.blob();
        return URL.createObjectURL(blob);
      }
      return null;
    },

    isServerAlive() { return serverAlive; }
  };
})();
