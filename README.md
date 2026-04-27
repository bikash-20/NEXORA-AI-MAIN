# Nexora — Your AI Companion 🤍

> A personal AI companion built as a Progressive Web App (PWA). Chat, study, and explore — with full offline support and zero mandatory accounts.

![PWA](https://img.shields.io/badge/PWA-Ready-7c5cff?style=flat-square)
![Offline](https://img.shields.io/badge/Offline-Supported-00e0ff?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-ff4ecd?style=flat-square)

---

## ✨ Features

### 💬 Chat Modes
- **Support Mode** — empathetic emotional support with a full emotion detection engine
- **Gossip Mode** — casual, fun conversation with neon vibes
- **Hype Mode** — motivational energy when you need a push
- **Voice Mode** — full speech-to-text and text-to-speech

### 🤖 AI Engine
- **Multi-key fallback** — OpenRouter → Gemini Direct → Cloudflare AI Workers → Pollinations.ai (no key needed)
- **AI Compare Mode** — run the same question through multiple models side by side
- **Online/Offline toggle** — works fully offline using a built-in knowledge base and rule engine

### 📚 Study Mode
- **Flashcards** — AI-generated cards from any topic or uploaded image/PDF, with flip animations and hints
- **Quiz** — multiple-choice quizzes with difficulty levels and AI re-explanation
- **Spaced Repetition (SRS)** — SM-2 algorithm with daily streaks and due badges
- **Summarizer** — paste any text and get bullet points, paragraph, ELI5, key terms, or TL;DR. Compare two models side by side
- **Viva Mode** — AI oral exam simulator: question by question, scored critique, grade report
- **📊 Progress Dashboard** — bar chart of study time, quiz accuracy sparkline, SRS progress, streak

### 📄 PDF Export
- Export SRS flashcard decks to print-ready PDF
- Export quiz history as a stats table
- Export Viva exam results with per-question feedback

### 🌐 PWA
- Installable on Android, iOS, and desktop
- Full offline support via service worker (cache-first for assets, network-first for app shell)
- Cloudflare AI Worker proxy for free AI inference with no CORS issues

---

## 🗂️ File Structure

```
nexora/
├── index.html          # App shell — all screens and panels
├── app.js              # All logic — AI, emotion engine, study, SRS, quiz, new features
├── styles.css          # Full design system — dark/light mode, animations
├── manifest.json       # PWA manifest
├── sw.js               # Service worker — smart cache routing
├── nexora-worker.js    # Cloudflare AI Worker (deploy separately to Cloudflare)
├── icon-192.png        # PWA icon
├── icon-512.png        # PWA icon
├── icon.svg            # SVG icon (monochrome)
└── apple-touch-icon.png
```

---

## 🚀 Getting Started

### Option 1 — Open directly in browser
Just open `index.html` in any modern browser. No build step, no dependencies.

### Option 2 — Local server (recommended for PWA features)
```bash
npx serve .
# or
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

### Option 3 — Deploy to GitHub Pages
1. Fork or push this repo
2. Go to **Settings → Pages → Source → main branch / root**
3. Your app will be live at `https://yourusername.github.io/nexora`

---

## 🔑 AI Setup (Optional — works without any key)

Nexora works out of the box via Pollinations.ai (no key needed). For better quality:

| Key | Where to get | What it unlocks |
|-----|-------------|-----------------|
| OpenRouter | [openrouter.ai](https://openrouter.ai) | Llama 70B, DeepSeek, Gemini Flash (all free tier) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) | Gemini 2.0 Flash direct API |
| Cloudflare AI | Deploy `nexora-worker.js` to CF Workers | Free hosted inference, no rate limits |

Add keys inside the app via **Menu → 🔑 API Key Setup**.

---

## ☁️ Cloudflare Worker Setup

The `nexora-worker.js` is a Cloudflare Worker that proxies AI requests to Cloudflare's free AI models, avoiding CORS and keeping keys off the client.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create**
2. Paste the contents of `nexora-worker.js`
3. Add a **Workers AI binding**: variable name `AI`
4. Deploy — copy the worker URL
5. In Nexora: **Menu → 🔑 API Key Setup → Cloudflare Worker tab** → paste URL

---

## 🛠️ Tech Stack

- **Vanilla JS** — no framework, no build step
- **marked.js** — Markdown rendering for AI replies
- **highlight.js** — syntax highlighting in code blocks
- **Web Speech API** — voice input/output
- **Service Worker** — PWA offline support
- **SM-2 Algorithm** — spaced repetition scheduling
- **Cloudflare Workers AI** — free AI inference proxy

---

## 📱 PWA Installation

| Platform | How to install |
|----------|---------------|
| Android Chrome | Tap the install banner or **⋮ → Add to Home Screen** |
| iOS Safari | **Share → Add to Home Screen** |
| Desktop Chrome | Click the install icon in the address bar |

---

## 🙏 Credits

Built by **Bikash Talukder**  
AI powered by OpenRouter, Google Gemini, Cloudflare AI, and Pollinations.ai

---

## 📄 License

MIT — free to use, modify, and distribute.

---

### 🎧 Listen Mode (Podcast)
- Type any topic or upload a file (TXT, MD) → AI writes a full podcast script
- **Dialogue mode**: HOST (teacher) + STUDENT (learner) — two voices, natural conversation
- **Monologue mode**: single narrator style
- TTS: Cloudflare AI TTS model (free) → falls back to Web Speech API automatically
- Custom audio player with seek bar, speed control (0.8x–2x), line-by-line transcript with live highlighting
- Podcast library saved in localStorage — reload previous podcasts anytime
- Download script as `.txt`

### ☁️ Updated CF Worker (v2.0)
Added two new endpoints alongside the existing `/ai`:
- `POST /podcast` — generates structured dialogue script (topic or raw text input)
- `POST /tts` — converts text to audio using `@cf/myshell-ai/melotts` (free CF model)
