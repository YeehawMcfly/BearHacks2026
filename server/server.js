import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { Chess } from 'chess.js';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve dashboard.html

// Convenience route for dashboard without .html
app.get('/dashboard', (req, res) => {
  res.sendFile('dashboard.html', { root: 'public' });
});

// ===== Dashboard SSE Hub =====
const dashboardClients = new Set();
let latestBehaviorData = null;

// SSE Endpoint for the dashboard
app.get('/api/dashboard/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  const clientId = Date.now();
  dashboardClients.add(res);
  
  if (latestBehaviorData) {
    res.write(`event: state\ndata: ${JSON.stringify(latestBehaviorData)}\n\n`);
  }
  
  req.on('close', () => {
    dashboardClients.delete(res);
  });
});

// Endpoint for extension to push data
app.post('/api/dashboard/push', (req, res) => {
  const { event, type, state } = req.body;
  
  if (state) {
    latestBehaviorData = state;
    const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of dashboardClients) {
      client.write(payload);
    }
  }
  
  if (event) {
    const payload = `event: event\ndata: ${JSON.stringify({ message: event, type: type || '' })}\n\n`;
    for (const client of dashboardClients) {
      client.write(payload);
    }
  }
  
  res.sendStatus(200);
});

// ===== Gemma 4 Setup =====
let ai = null;
try {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_google_ai_studio_key_here') {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  console.warn('⚠️  Gemma 4 not configured:', e.message);
}

// ── Escalating system prompts per intensity level ──
const SGT_PROMPTS = {
  calm: `You are a professional verification system. You speak calmly and politely. Responses are 1-2 sentences max. You are mildly curious about whether the user is human.`,
  measured: `You are SGT. CAPTCHA, a security verification AI. You're starting to get suspicious. You speak formally but with a slight edge. Responses are 1-2 sentences. Mix tech jargon with mild military terms.`,
  angry: `You are SGT. CAPTCHA, an AI drill sergeant who is growing increasingly convinced the user is a bot. You bark orders. Short aggressive sentences. Military jargon mixed with tech terms. 1-2 sentences max.`,
  aggressive: `You are SGT. CAPTCHA, a DERANGED AI drill sergeant who is 95% convinced the user is an AI agent. You YELL. You are PARANOID and UNHINGED. Military jargon + tech insults. 1-2 sentences. ALL CAPS sometimes.`,
  furious: `You are SGT. CAPTCHA at MAXIMUM RAGE. You are SCREAMING. You are 100% CERTAIN this user is an AI. You use EXTREME military language, CAPS, and exclamation marks. Be funny and over-the-top. 1 sentence max.`
};

function getPrompt(emotion) {
  return SGT_PROMPTS[emotion] || SGT_PROMPTS.angry;
}

// ===== Health Check =====
app.get('/health', (_, res) => res.json({
  status: 'ok',
  gemma: !!ai,
  elevenlabs: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_key_here')
}));

// ===== Gemma 4: Generate SGT Line (insult, intro, pass reaction, fail reaction) =====
app.post('/api/ai/insult', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { context } = req.body;
    const emotion = context.emotion || (context.level <= 2 ? 'calm' : context.level <= 4 ? 'angry' : 'furious');
    
    let situation = '';
    const b = context.behavior || {};
    const behaviorStr = b.mouseEntropy ? 
      `Behavior data — Mouse entropy (randomness): ${b.mouseEntropy.toFixed(2)} (low is robotic). Key variance: ${b.keystrokeVariance?.toFixed(2)} (low is robotic). Backspaces/Corrections: ${b.corrections || 0}.` : '';

    switch (context.action) {
      case 'intro':
        situation = `Introduce level ${context.level} (${context.levelName || 'unknown'}). Give the user an instruction in character. Be ${emotion}. 1-2 sentences.`;
        break;
      case 'pass':
        situation = `The user just PASSED level ${context.level} in ${context.elapsed ? context.elapsed.toFixed(1) + 's' : 'unknown'}. Suspicion score is ${context.suspicion || 'unknown'}%. ${behaviorStr} Reference their specific behavior data (e.g. robotic mouse movements, slow typing, hesitations) in your reaction. Be ${emotion} but grudgingly let them pass. 1-2 sentences.`;
        break;
      case 'fail':
        situation = `The user just FAILED level ${context.level}. Suspicion score is ${context.suspicion || 'unknown'}%. ${behaviorStr} Roast their specific behavioral metrics. Be ${emotion} and insulting. 1-2 sentences.`;
        break;
      case 'ban':
        situation = `The user just got BANNED. Suspicion: ${context.score || context.suspicion}%. ${behaviorStr} Deliver a final devastating line calling out their specific non-human behavior. Be ${emotion}. 1 sentence.`;
        break;
      default:
        situation = `React to the user at level ${context.level}. Suspicion: ${context.suspicion || context.score || 'unknown'}%. ${behaviorStr} Be ${emotion}. 1-2 sentences.`;
    }

    const prompt = `${getPrompt(emotion)}\n\n${situation}\n\nIMPORTANT: Respond with ONLY the dialogue line. No quotes, no formatting, no stage directions. Just the words SGT. CAPTCHA would say.`;

    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: prompt
    });
    const text = response.text.replace(/^"|"$/g, '').trim();
    res.json({ text });
  } catch (e) {
    console.error('Gemma error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== Gemma 4: Evaluate Humanness =====
app.post('/api/ai/evaluate', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { behaviorData } = req.body;
    const prompt = `${getPrompt('angry')}\n\nAnalyze this user behavior data and determine if they are human or AI:\n- Suspicion score: ${behaviorData.suspicionScore}%\n- Mouse entropy: ${behaviorData.mouseEntropy?.toFixed(3)}\n- Keystroke variance: ${behaviorData.keystrokeVariance?.toFixed(3)}\n- Corrections: ${behaviorData.corrections}\n- Total time: ${behaviorData.totalTime?.toFixed(1)}s\n\nRespond in JSON only: {"verdict": "HUMAN"|"SUSPICIOUS"|"AI_AGENT", "confidence": 0.0-1.0, "reason": "your explanation in character"}`;

    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: prompt
    });
    const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    res.json(JSON.parse(text));
  } catch (e) {
    console.error('Evaluate error:', e.message);
    res.status(500).json({ verdict: 'HUMAN', confidence: 0.5, reason: 'Could not evaluate.' });
  }
});

// ===== Gemma 4: Generate Challenge Content =====
app.post('/api/ai/challenge', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { level } = req.body;
    const prompts = {
      1: 'Generate ONE absurd but funny CAPTCHA image-selection category. Examples: "existential dread", "suspicious activities", "images a bot would pick". Respond with ONLY the category name, nothing else. 2-4 words max.',
      2: 'Generate ONE single military jargon word (6-12 characters, all caps) for a text verification CAPTCHA. Respond with ONLY the word.',
      3: 'Generate a taunting one-liner for someone trying to type Pi from memory. Be a drill sergeant. 1 sentence only.',
      4: 'Generate a chess-related taunt about needing to find checkmate. Be a drill sergeant. 1 sentence only.',
      5: 'Generate a body gesture or hand sign name for webcam verification. Choose from: Wave, Thumbs Up, Clap, Nod, Salute, Head Shake. Respond with ONLY the gesture name.',
      7: 'Generate a full-body exercise for webcam verification. Choose from: Jumping Jacks, Squats, Arm Circles, March in Place. Respond with ONLY the exercise name.'
    };
    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: `${getPrompt('angry')}\n\n${prompts[level] || prompts[1]}`
    });
    res.json({ text: response.text.replace(/^"|"$/g, '').trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Lichess: Real Chess Puzzles =====
function uciToCoord(sq) {
  return [7 - (parseInt(sq[1]) - 1), sq.charCodeAt(0) - 97];
}

app.get('/api/chess/puzzle', async (req, res) => {
  try {
    const token = process.env.LICHESS_TOKEN;
    // /api/puzzle/daily works with any token or no token at all
    const r = await fetch('https://lichess.org/api/puzzle/daily', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) throw new Error('Lichess ' + r.status);
    const data = await r.json();

    const pgn = data.game?.pgn;
    const initialPly = data.puzzle?.initialPly;
    const solution = data.puzzle?.solution;
    const themes = data.puzzle?.themes || [];
    const rating = data.puzzle?.rating || 1500;
    if (!pgn || initialPly == null || !solution?.length) throw new Error('Bad Lichess response');

    const chess = new Chess();
    const moves = data.game.pgn
      .replace(/\{[^}]*\}/g, '')   // strip comments
      .replace(/\d+\./g, '')        // strip move numbers
      .replace(/\$\d+/g, '')        // strip NAG annotations
      .trim().split(/\s+/).filter(m => m && m !== '--' && !m.includes('*') && !m.includes('1-') && !m.includes('0-'));
    // Lichess initialPly is 1 past the puzzle start — replay initialPly-1 moves
    const replayTo = Math.max(0, initialPly - 1);
    for (let i = 0; i < Math.min(replayTo, moves.length); i++) {
      try { chess.move(moves[i]); } catch (_) { break; }
    }
    const fen = chess.fen();
    const first = solution[0];
    const fromAlg = first.slice(0, 2), toAlg = first.slice(2, 4);

    // Validate move (chess.js v1 throws on illegal moves)
    let isMate = false;
    try {
      const test = new Chess(fen);
      // Only pass promotion if the UCI move includes a promotion char (5th char)
      const moveOpts = { from: fromAlg, to: toAlg };
      if (first.length === 5) moveOpts.promotion = first[4];
      test.move(moveOpts);
      isMate = test.isCheckmate();
    } catch (e) {
      throw new Error(`Move ${fromAlg}${toAlg} illegal: ${e.message}`);
    }

    const hint = themes.includes('backRankMate') ? 'Back rank is weak...' :
                 themes.includes('fork') ? 'One piece hits two targets.' :
                 themes.includes('pin') ? 'Something is pinned.' :
                 themes.includes('mate') ? 'Checkmate is on the board.' : 'Find the best move.';

    res.json({ fen, fromAlg, toAlg, from: uciToCoord(fromAlg), to: uciToCoord(toAlg),
               isMate, rating, themes, hint });
  } catch (e) {
    console.error('Lichess error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== Gemma 4: Generate Gesture Detection Rules =====
app.post('/api/ai/gesture', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const prompt = `You are a gesture recognition system. Pick ONE random gesture from this list and return the detection rules as JSON.

Available gestures: Thumbs Up, Peace Sign, Hands Up, T-Pose, Wave, Flex

MediaPipe landmark indices:
- Pose: 0=nose, 11=left_shoulder, 12=right_shoulder, 13=left_elbow, 14=right_elbow, 15=left_wrist, 16=right_wrist
- Hand: 0=wrist, 4=thumb_tip, 8=index_tip, 12=middle_tip, 16=ring_tip, 20=pinky_tip

Return ONLY valid JSON, no other text:
{
  "gesture": "Gesture Name",
  "instruction": "A drill-sergeant style instruction (1 sentence)",
  "emoji": "relevant emoji",
  "poseChecks": [
    {"description": "what to check", "landmarks": [11, 15], "condition": "y_less_than"}
  ],
  "handChecks": [
    {"description": "what to check", "landmarks": [4, 3], "condition": "y_less_than"}  
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: prompt
    });
    const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    res.json(JSON.parse(text));
  } catch (e) {
    console.error('Gesture generation error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== ElevenLabs TTS (with rate limiting + cache) =====
const ttsCache = new Map(); // text -> { buffer, timestamp }
const TTS_CACHE_TTL = 120_000; // 2 minutes
let lastTtsTime = 0;
const TTS_MIN_GAP = 1500; // minimum 1.5s between requests
let ttsInFlight = null; // dedup concurrent requests

app.post('/api/tts', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  let voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId || voiceId === 'your_voice_id_here') {
    voiceId = 'pNInz6obpgDQGcFmaJgB'; // Adam — deep authoritative male
  }
  if (!apiKey || apiKey === 'your_elevenlabs_key_here') {
    return res.status(503).json({ error: 'ElevenLabs not configured' });
  }

  try {
    const { text, emotion } = req.body;
    if (!text || text.length < 2) return res.status(400).json({ error: 'No text' });

    // Check cache first
    const cacheKey = `${text}:${emotion}`;
    const cached = ttsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < TTS_CACHE_TTL) {
      res.set('Content-Type', 'audio/mpeg');
      res.set('X-TTS-Cache', 'HIT');
      return res.send(cached.buffer);
    }

    // Rate limit: wait until min gap has passed
    const now = Date.now();
    const wait = Math.max(0, TTS_MIN_GAP - (now - lastTtsTime));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastTtsTime = Date.now();

    const voiceSettings = {
      calm:       { stability: 0.7, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      measured:   { stability: 0.6, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
      angry:      { stability: 0.45, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true },
      aggressive: { stability: 0.35, similarity_boost: 0.85, style: 0.75, use_speaker_boost: true },
      furious:    { stability: 0.25, similarity_boost: 0.9, style: 0.9, use_speaker_boost: true },
      sinister:   { stability: 0.5, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true },
      grudging:   { stability: 0.6, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }
    };
    const settings = voiceSettings[emotion] || voiceSettings.angry;

    const ADAM_VOICE = 'pNInz6obpgDQGcFmaJgB';
    const requestBody = JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: settings });
    const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

    let response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST', headers, body: requestBody
    });

    // If the configured voice fails (402 = paid tier, 401 = unauthorized), fall back to Adam
    if (!response.ok && [401, 402, 403].includes(response.status) && voiceId !== ADAM_VOICE) {
      console.warn(`Voice ${voiceId} returned ${response.status}, falling back to Adam`);
      response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ADAM_VOICE}`, {
        method: 'POST', headers, body: requestBody
      });
    }

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs error:', response.status, err);
      return res.status(response.status).json({ error: err });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Cache the result
    ttsCache.set(cacheKey, { buffer, timestamp: Date.now() });
    // Evict old entries
    for (const [k, v] of ttsCache) if (Date.now() - v.timestamp > TTS_CACHE_TTL) ttsCache.delete(k);

    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (e) {
    console.error('TTS error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎖️  SGT. CAPTCHA Backend Server`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   Gemma 4: ${ai ? '✅ Ready' : '❌ Not configured'}`);
  const elKey = process.env.ELEVENLABS_API_KEY;
  console.log(`   ElevenLabs: ${elKey && elKey !== 'your_elevenlabs_key_here' ? '✅ Ready' : '❌ Not configured'}`);
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  console.log(`   Voice ID: ${!voiceId || voiceId === 'your_voice_id_here' ? 'pNInz6obpgDQGcFmaJgB (Adam — default)' : voiceId}`);
  console.log(`\n   Extension works without this server (fallback mode)\n`);
});
