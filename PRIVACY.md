# Privacy Policy — SGT. CAPTCHA: The Reverse Turing Test

**Last updated: April 26, 2026**

## Overview

SGT. CAPTCHA ("the Extension") is a Chrome browser extension built as an educational and entertainment project. This privacy policy explains what data the Extension accesses, how it is used, and what is shared.

---

## Data We Collect

### 1. Behavioral Metrics (local only)
The Extension measures mouse movement, keystroke timing, and click patterns **solely within the CAPTCHA overlay UI**. This data is:
- Processed entirely in your browser (never sent to a server)
- Used only to calculate a temporary "suspicion score" during the current session
- Discarded when the session ends or the browser is closed

### 2. Camera / Body Tracking (optional, local only)
One challenge level optionally uses your webcam via the MediaPipe library for pose detection (e.g. detecting jumping jacks). This data is:
- Processed entirely on-device using on-device ML models bundled with the extension
- **Never recorded, stored, or transmitted**
- Only active during the specific challenge level that requests it
- Immediately discarded after the challenge ends

### 3. CAPTCHA State (local storage only)
The Extension stores a small state object in `chrome.storage.local`:
- `captchaState` — whether you have passed, are in progress, or have been banned
- `suspicionScore` — your current session score
- `banReason` — reason for a ban, if applicable

This data never leaves your device.

### 4. AI-Generated Content (server)
When the Extension communicates with the backend server (`https://sgt-captcha-server.onrender.com`), it sends:
- The current challenge context (e.g. level number, suspicion level, elapsed time)
- **No personally identifiable information (PII)**
- **No browsing history or URLs**
- **No camera or biometric data**

This data is used solely to generate dynamic insults and voice responses via the Google Gemini and ElevenLabs APIs. It is not stored or logged beyond the API request lifecycle.

---

## Data We Do NOT Collect

- We do **not** collect your name, email, or any account information
- We do **not** track which websites you visit
- We do **not** store or transmit camera or biometric data
- We do **not** sell or share any data with third parties
- We do **not** use cookies or tracking pixels
- We do **not** have analytics or crash reporting

---

## Third-Party Services

When the backend server is in use, requests may be forwarded to:

| Service | Purpose | Privacy Policy |
|---|---|---|
| Google Gemini (Google AI Studio) | Dynamic AI responses | [policies.google.com](https://policies.google.com/privacy) |
| ElevenLabs | AI voice generation | [elevenlabs.io/privacy](https://elevenlabs.io/privacy) |
| Pexels | Stock images for challenges | [pexels.com/privacy-policy](https://www.pexels.com/privacy-policy/) |

Only non-personal contextual data (challenge type, performance level) is sent to these services.

---

## Permissions Justification

| Permission | Why it's needed |
|---|---|
| `storage` | Save your CAPTCHA pass/fail state locally across tabs |
| `tabs` | Reload tabs after reset or disable, and prevent the overlay from running on the dashboard |
| `host_permissions` (Render URL, Pexels, Flickr) | Allow the service worker to proxy API calls to the backend and image sources |

---

## Children's Privacy

This Extension is not directed at children under 13. We do not knowingly collect data from children.

---

## Changes to This Policy

We may update this policy. Changes will be reflected by the "Last updated" date above. Continued use of the Extension after changes constitutes acceptance.

---

## Contact

This is an open-source project built at BearHacks 2026.
Source code: [github.com/YeehawMcfly/BearHacks2026](https://github.com/YeehawMcfly/BearHacks2026)

For questions, open an issue on GitHub.
