# 🎖️ The Reverse Turing Test — AI Bouncer

> A Chrome Extension that acts as an unhinged AI Drill Sergeant CAPTCHA, blocking your **entire browser** until you prove you're a *perfectly flawed* human.

**Built for BearHacks 2026** 🐻

## 🎯 The Concept

You know those CAPTCHAs that check if you're a robot? This one checks if you're **too good** at being human — because that means you might be an AI agent.

**The Goldilocks Trap:**
- Fail too hard → You're a bot (too dumb)
- Succeed too perfectly → You're an AI agent (too smart)
- Be imperfect, slow, and messy → You're human ✅

## 🎮 The Gauntlet

| Level | Challenge | The Twist |
|-------|-----------|-----------|
| **1** | Select images containing "EXISTENTIAL DREAD" | Categories are intentionally absurd |
| **2** | Retype a distorted military word | Typing too fast = suspicious |
| **3** | Type 20 digits of Pi from memory | Do it in <3 seconds? BANNED. |
| **4** | Solve impossible math in 5 seconds | Getting it RIGHT = instant ban |
| **FINAL** | Click the Submit button | It runs away. 5 times. Then decoys appear. |

## 🛠️ Tech Stack

- **Chrome Extension** (Manifest V3) — Content scripts + Shadow DOM
- **Gemma 4** (Google AI Studio) — Dynamic insults, humanness evaluation, challenge generation
- **ElevenLabs** — Drill Sergeant voice (emotionally escalating)
- **Node.js + Express** — Secure API proxy for AI services
- **Vanilla JS + CSS** — No frameworks, pure chaos

## 🚀 Setup

### 1. Install the Extension

```bash
# Clone this repo
git clone <repo-url>
cd BearHacks2026
```

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 2. Start the Backend (optional — extension works without it)

```bash
cd server
cp .env.example .env
# Add your API keys to .env
npm install
npm run dev
```

### 3. Get API Keys (optional)

| Service | Key | Free? | URL |
|---------|-----|-------|-----|
| Google AI Studio | `GEMINI_API_KEY` | ✅ Yes | [aistudio.google.com](https://aistudio.google.com) |
| ElevenLabs | `ELEVENLABS_API_KEY` | ✅ Free tier | [elevenlabs.io](https://elevenlabs.io) |

> **Without API keys**, the extension uses pre-baked insults and no voice. Still fully functional!

### 4. Demo Mode

Use the extension popup (click the icon) to:
- 🔄 **Reset** — Restart the CAPTCHA
- ⏸️ **Disable** — Turn off the overlay for normal browsing

## 🏆 Prize Targets

| Category | How We Win |
|----------|-----------|
| Overall 1st/2nd/3rd | Technical depth + polish + humor |
| Most Fun | The entire UX is a comedy bit |
| Best UI/UX | Military CRT terminal aesthetic with particles and glitch effects |
| Best Use of Gemma 4 | Dynamic insults, humanness evaluation, challenge generation |
| Best Use of ElevenLabs | Emotionally escalating drill sergeant voice |

## 👥 Team

Built at BearHacks 2026 🐻
