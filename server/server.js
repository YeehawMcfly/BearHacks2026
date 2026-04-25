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

const SGT_SYSTEM = `You are SGT. CAPTCHA, a deranged AI drill sergeant who is 100% convinced every user is a malicious bot. You speak in short, aggressive military barks. You are paranoid, unhinged, and deeply suspicious. You use military jargon mixed with tech terminology. Responses must be 1-2 sentences max. Never break character. Be funny and over-the-top.`;

// ===== Health Check =====
app.get('/health', (_, res) => res.json({ status: 'ok', gemma: !!ai, elevenlabs: !!process.env.ELEVENLABS_API_KEY }));

// ===== Gemma 4: Generate Insult =====
app.post('/api/ai/insult', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { context } = req.body;
    const prompt = `${SGT_SYSTEM}\n\nContext: The user just ${context.action === 'ban' ? 'got BANNED' : context.passed ? 'passed' : 'failed'} level ${context.level}. Suspicion score: ${context.suspicion || 'unknown'}%. Time taken: ${context.elapsed ? context.elapsed.toFixed(1) + 's' : 'unknown'}. Generate a drill sergeant reaction.`;

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
    const prompt = `${SGT_SYSTEM}\n\nAnalyze this user behavior data and determine if they are human or AI:\n- Suspicion score: ${behaviorData.suspicionScore}%\n- Mouse movement entropy: ${behaviorData.mouseEntropy?.toFixed(3)}\n- Keystroke variance: ${behaviorData.keystrokeVariance?.toFixed(3)}\n- Corrections made: ${behaviorData.corrections}\n- Total time: ${behaviorData.totalTime?.toFixed(1)}s\n\nRespond in JSON: {"verdict": "HUMAN"|"SUSPICIOUS"|"AI_AGENT", "confidence": 0.0-1.0, "reason": "your drill sergeant explanation"}`;

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
      1: 'Generate an absurd CAPTCHA category for an image grid (e.g., "select all images containing existential dread"). Just the category name, nothing else.',
      2: 'Generate a single military jargon word (8-15 chars) for a distorted text CAPTCHA. Just the word, nothing else.',
      3: 'Generate a taunting one-liner for someone trying to type Pi from memory. Be a drill sergeant.',
      4: 'Generate an extremely complex math equation that looks unsolvable. Format it with unicode math symbols.'
    };

    const response = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: `${SGT_SYSTEM}\n\n${prompts[level] || prompts[1]}`
    });
    res.json({ text: response.text.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ElevenLabs TTS =====
app.post('/api/tts', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // "Adam" default
  if (!apiKey || apiKey === 'your_elevenlabs_key_here') {
    return res.status(503).json({ error: 'ElevenLabs not configured' });
  }

  try {
    const { text, emotion } = req.body;
    // Adjust voice settings based on emotion
    const stability = emotion === 'furious' ? 0.3 : emotion === 'aggressive' ? 0.4 : 0.5;
    const similarity = 0.8;
    const style = emotion === 'furious' ? 0.9 : emotion === 'aggressive' ? 0.7 : 0.5;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs error:', err);
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
  console.log(`   Gemma 4: ${ai ? '✅ Ready' : '❌ Not configured (set GEMINI_API_KEY in .env)'}`);
  console.log(`   ElevenLabs: ${process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_key_here' ? '✅ Ready' : '❌ Not configured (set ELEVENLABS_API_KEY in .env)'}`);
  console.log(`\n   Extension works without this server (fallback mode)\n`);
});
