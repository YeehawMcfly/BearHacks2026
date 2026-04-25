import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

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

// ===== Gemma 4: Generate Insult =====
app.post('/api/ai/insult', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { context } = req.body;
    const emotion = context.level <= 1 ? 'calm' : context.level <= 2 ? 'measured' : context.level <= 3 ? 'angry' : 'furious';
    const prompt = `${getPrompt(emotion)}\n\nContext: The user just ${context.action === 'ban' ? 'got BANNED' : context.passed ? 'passed' : 'failed'} level ${context.level}. Suspicion score: ${context.suspicion || context.score || 'unknown'}%. Time taken: ${context.elapsed ? context.elapsed.toFixed(1) + 's' : 'unknown'}. Generate a reaction.`;

    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: prompt
    });
    res.json({ text: response.text });
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
      1: 'Generate an absurd CAPTCHA category for image selection (e.g., "existential dread"). Just the category name.',
      2: 'Generate a single military jargon word (8-15 chars) for a distorted text CAPTCHA. Just the word.',
      3: 'Generate a taunting one-liner for someone trying to type Pi from memory. Be a drill sergeant.',
      4: 'Generate an extremely complex math equation. Format with unicode math symbols.',
      5: 'Generate a body gesture or hand sign for a webcam verification. Just the name (e.g., "Thumbs Up", "Peace Sign", "T-Pose").'
    };
    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: `${getPrompt('angry')}\n\n${prompts[level] || prompts[1]}`
    });
    res.json({ text: response.text.trim() });
  } catch (e) {
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

// ===== ElevenLabs TTS =====
app.post('/api/tts', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  // Use Adam voice as default (deep, authoritative)
  let voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId || voiceId === 'your_voice_id_here') {
    voiceId = 'pNInz6obpgDQGcFmaJgB'; // Adam — deep authoritative male
  }
  if (!apiKey || apiKey === 'your_elevenlabs_key_here') {
    return res.status(503).json({ error: 'ElevenLabs not configured' });
  }

  try {
    const { text, emotion } = req.body;

    // Escalating voice settings per emotion
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

    // Voice settings already handle emotion — no text cues needed
    const processedText = text;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: processedText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: settings
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs error:', response.status, err);
      return res.status(response.status).json({ error: err });
    }

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(buffer));
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
