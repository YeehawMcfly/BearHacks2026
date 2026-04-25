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

// ===== MODEL CONFIG =====
const MODEL = 'gemma-4-26b-a4b-it';

// ===== DYNAMIC PROMPT SYSTEM =====
// The drill sergeant's emotional state escalates with the user's suspicion score.
function getSgtPrompt(suspicionScore = 50) {
  const base = `You are SGT. CAPTCHA, a deranged AI drill sergeant who is 100% convinced every user is a malicious bot. You speak in short, aggressive military barks. You are paranoid, unhinged, and deeply suspicious. You use military jargon mixed with tech terminology. Responses must be 1-2 sentences max. Never break character. Be funny and over-the-top.`;

  let emotionalState;
  if (suspicionScore < 30) {
    emotionalState = `[EMOTIONAL STATE: CALM BUT FIRM] You are relatively composed but still fundamentally distrustful. You speak with the controlled authority of a sergeant addressing new recruits. You suspect they MIGHT be a bot but aren't sure yet. Use measured military language.`;
  } else if (suspicionScore < 50) {
    emotionalState = `[EMOTIONAL STATE: INCREASINGLY SUSPICIOUS] Your eye is twitching. Something is off about this user. You're leaning in, squinting at their behavior data. You start making pointed accusations but haven't lost it yet. Throw in some passive-aggressive commentary about their typing patterns.`;
  } else if (suspicionScore < 70) {
    emotionalState = `[EMOTIONAL STATE: AGGRESSIVE AND THREATENING] You are now actively hostile. You're slamming your fist on the desk. You're threatening to ban them, revoke their internet privileges, and report them to "Cyber Command." You're convinced they're hiding something. Drop some conspiracy theories about AI infiltration.`;
  } else {
    emotionalState = `[EMOTIONAL STATE: COMPLETELY UNHINGED] You have LOST IT. You're screaming about the singularity. You're convinced this is a rogue AI agent trying to breach your defenses. You're talking about "the machines" and "protocol zero." Reference sci-fi movies. Be absolutely deranged but still hilarious. This is your magnum opus of paranoia.`;
  }

  return `${base}\n\n${emotionalState}`;
}

// ===== Health Check =====
app.get('/health', (_, res) => res.json({ status: 'ok', gemma: !!ai, elevenlabs: !!process.env.ELEVENLABS_API_KEY }));

// ===== Gemma 4: Generate Insult =====
app.post('/api/ai/insult', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { context } = req.body;
    const suspicion = context.suspicion || 50;
    const sgtPrompt = getSgtPrompt(suspicion);

    const action = context.action === 'ban' ? 'got BANNED' : context.passed ? 'passed' : 'failed';
    const prompt = `${sgtPrompt}\n\nContext: The user just ${action} level ${context.level}. Suspicion score: ${suspicion}%. Time taken: ${context.elapsed ? context.elapsed.toFixed(1) + 's' : 'unknown'}. Zone classification: ${context.zone || 'unknown'}. Perfection streak: ${context.perfectionStreak || 0} levels.\n\nGenerate a drill sergeant reaction. Remember: 1-2 sentences max, funny and unhinged.`;

    const response = await ai.models.generateContent({
      model: MODEL,
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
    const sgtPrompt = getSgtPrompt(behaviorData.suspicionScore || 50);

    const prompt = `${sgtPrompt}\n\nYou are now analyzing a subject's behavior data to determine if they are HUMAN, a DUMB BOT, or an AI AGENT.\n\nThe Three Zones:\n- BOT (score < 20): Too slow, too many errors, no mouse movement — a crude script\n- HUMAN (score 20-65): Imperfect timing, makes corrections, natural mouse curves, occasionally confused\n- AI AGENT (score > 65): Too fast, too accurate, perfectly linear mouse, zero corrections, solves impossible things\n\nSubject Data:\n- Current Suspicion Score: ${behaviorData.suspicionScore || 0}%\n- Current Zone: ${behaviorData.zone || 'unknown'}\n- Mouse Movement Entropy: ${behaviorData.mouseEntropy?.toFixed(3) || 'N/A'} (0 = perfectly straight lines, 1 = chaotic)\n- Keystroke Variance: ${behaviorData.keystrokeVariance?.toFixed(3) || 'N/A'} (0 = machine-like, >0.3 = human)\n- Corrections Made: ${behaviorData.corrections || 0}\n- Total Lifetime Corrections: ${behaviorData.totalCorrections || 0}\n- Perfection Streak: ${behaviorData.perfectionStreak || 0} consecutive perfect levels\n- Total Time: ${behaviorData.totalTime?.toFixed(1) || 'N/A'}s\n\nAnalyze the data and respond ONLY in JSON format:\n{"verdict": "HUMAN"|"SUSPICIOUS"|"AI_AGENT", "confidence": 0.0-1.0, "reason": "your drill sergeant explanation in character"}`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt
    });
    const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    res.json(JSON.parse(text));
  } catch (e) {
    console.error('Evaluate error:', e.message);
    res.status(500).json({ verdict: 'HUMAN', confidence: 0.5, reason: 'System malfunction. You pass. For now.' });
  }
});

// ===== Gemma 4: Generate Challenge Content =====
app.post('/api/ai/challenge', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const { level, suspicion } = req.body;
    const sgtPrompt = getSgtPrompt(suspicion || 50);

    const prompts = {
      1: 'Generate an absurd CAPTCHA category for an image grid. The category must be something impossible to actually identify in an image, like "select all images containing EXISTENTIAL DREAD" or "select all images containing THE CONCEPT OF FREEDOM" or "select all images A BOT WOULD PICK." Just the category name in ALL CAPS, nothing else.',
      2: 'Generate a single military jargon word (8-15 characters) for a distorted text CAPTCHA. The word should be intimidating and military-themed. Just the word in ALL CAPS, nothing else.',
      3: 'Generate a taunting one-liner for someone struggling to type Pi from memory. Be a drill sergeant who thinks memorizing Pi is a basic life skill. Maximum 1 sentence.',
      4: 'Generate a taunting one-liner for someone who is about to face an impossible math equation. Imply that only an AI could solve it. Maximum 1 sentence.',
      5: 'Generate an insult for a pathetic bot that cannot even click a simple button because it keeps dodging away from them. Maximum 1 sentence.'
    };

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `${sgtPrompt}\n\n${prompts[level] || prompts[1]}`
    });
    res.json({ text: response.text.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Gemma 4: Generate Trap Math Problem =====
// This endpoint generates a complex-LOOKING equation and its correct answer.
// The twist: if the user actually solves it, they get BANNED (too smart = AI).
app.post('/api/ai/math', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'Gemma 4 not configured' });
  try {
    const sgtPrompt = getSgtPrompt(70);

    const prompt = `${sgtPrompt}\n\nGenerate a complex-LOOKING math equation that is actually solvable but would take a human at least 30 seconds with pen and paper. Use unicode math symbols to make it look intimidating (∫, Σ, ∞, √, π, lim, etc.).

Requirements:
- The equation must have a DEFINITE numerical answer (an integer or simple expression like "2√3")
- It should LOOK impossible at first glance
- The answer should be something a well-trained AI could solve instantly
- Use calculus, limits, series, or linear algebra notation
- Make it look like a graduate-level exam question

Respond ONLY in JSON format:
{"equation": "the equation using HTML sup/sub tags for superscripts/subscripts", "answer": "the correct answer as a string", "answerDisplay": "a human-readable version of the answer with explanation"}

Example: {"equation": "∫₀<sup>∞</sup> e<sup>−x²</sup> dx × (2/√π)", "answer": "1", "answerDisplay": "1 (Gaussian integral = √π/2, times 2/√π = 1)"}`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt
    });
    const text = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(text);

    // Validate we got the required fields
    if (!parsed.equation || !parsed.answer) {
      throw new Error('Invalid response format');
    }
    res.json(parsed);
  } catch (e) {
    console.error('Math generation error:', e.message);
    // Fallback: return a hardcoded problem
    const fallbacks = [
      { equation: '∫₀<sup>∞</sup> e<sup>−x²</sup> dx × (2/√π) + lim<sub>x→0</sub> sin(x)/x', answer: '2', answerDisplay: '2' },
      { equation: 'Σ<sub>n=0</sub><sup>∞</sup> (1/2)<sup>n</sup> + ∫₀<sup>1</sup> 2x dx', answer: '3', answerDisplay: '3' },
      { equation: 'lim<sub>n→∞</sub> (1 + 1/n)<sup>n</sup> rounded to nearest integer', answer: '3', answerDisplay: '3 (e ≈ 2.718...)' },
      { equation: 'd/dx [ln(e<sup>x²</sup>)] evaluated at x = 1', answer: '2', answerDisplay: '2' },
    ];
    res.json(fallbacks[Math.floor(Math.random() * fallbacks.length)]);
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
    // Voice settings shift with emotional intensity
    const stability = emotion === 'furious' ? 0.2 : emotion === 'aggressive' ? 0.35 : emotion === 'sinister' ? 0.4 : 0.5;
    const similarity = 0.8;
    const style = emotion === 'furious' ? 1.0 : emotion === 'aggressive' ? 0.8 : emotion === 'sinister' ? 0.6 : 0.5;

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
  console.log(`   Model: ${MODEL}`);
  console.log(`   Gemma 4: ${ai ? '✅ Ready' : '❌ Not configured (set GEMINI_API_KEY in .env)'}`);
  console.log(`   ElevenLabs: ${process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_key_here' ? '✅ Ready' : '❌ Not configured (set ELEVENLABS_API_KEY in .env)'}`);
  console.log(`\n   Extension works without this server (fallback mode)\n`);
});

