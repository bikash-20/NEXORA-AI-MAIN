<div align="center">

# ✨ Nexora — Your AI Companion

**A beautiful, offline-capable AI companion PWA built with pure HTML, CSS & JavaScript.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-7c5cff?style=for-the-badge&logo=github)](https://yourusername.github.io/nexora)
[![License](https://img.shields.io/badge/License-MIT-00e0ff?style=for-the-badge)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-Ready-ff4ecd?style=for-the-badge&logo=pwa)](https://web.dev/progressive-web-apps/)
[![OpenRouter](https://img.shields.io/badge/AI-OpenRouter-7c5cff?style=for-the-badge)](https://openrouter.ai)

> Designed & Developed by **Bikash Talukder**

</div>

---

## 📸 Preview

> A futuristic dark-glass AI chat interface with animated orbs, voice mode, light/dark themes, and a full rule-based response engine — all in a single HTML file.

---

## 🚀 Features

| Feature | Description |
|---|---|
| 💬 **AI Chat** | Real AI responses via free OpenRouter models (Llama, Gemini, Mistral & more) |
| 🔌 **Works Offline** | Full rule-based engine + knowledge base when no API key is present |
| 🎙️ **Voice Mode** | Speech-to-text input + text-to-speech responses |
| 📷 **Image Input** | Upload or capture images and ask questions about them |
| 🌗 **Light / Dark Mode** | Toggle between a sleek dark UI and a soft light theme |
| 🧠 **Memory** | Remembers your name, emotions, and conversation history across sessions |
| 🗺️ **Learning Roadmaps** | Built-in roadmaps for Python, JS, DSA, ML, Android, Cybersecurity & more |
| 😊 **Mood Chips** | Quick-tap emotional prompts to start a conversation instantly |
| 💾 **Export Chat** | Download your full conversation as a `.txt` file |
| 📲 **Installable PWA** | Add to home screen on Android & iOS — works like a native app |

---

## 🤖 AI Models (Free via OpenRouter)

Nexora cycles through these **completely free** models automatically:

- `meta-llama/llama-3.3-70b-instruct:free`
- `google/gemini-2.0-flash-exp:free`
- `google/gemini-flash-1.5:free`
- `deepseek/deepseek-r1:free`
- `mistralai/mistral-7b-instruct:free`
- `qwen/qwen3-8b:free`
- `meta-llama/llama-3.1-8b-instruct:free`
- `meta-llama/llama-3.2-3b-instruct:free`

No paid credits needed — just a free [OpenRouter](https://openrouter.ai) account.

---

## 📁 File Structure

```
nexora/
├── index.html          # Entire app — UI, logic, styles
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (offline caching)
├── icon-192.png        # PWA icon (192×192)
├── icon-512.png        # PWA icon (512×512)
├── apple-touch-icon.png# iOS home screen icon (180×180)
└── README.md           # This file
```

---

## ⚡ Getting Started

### Option 1 — Just open the file
```bash
git clone https://github.com/yourusername/nexora.git
cd nexora
# Open index.html in any modern browser
```

### Option 2 — Serve locally (recommended for PWA features)
```bash
# Using Python
python -m http.server 8080

# Using Node.js
npx serve .
```
Then visit `http://localhost:8080`

### Option 3 — Deploy to GitHub Pages (free hosting)
1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Set source: **Deploy from branch → main → / (root)**
4. Visit `https://yourusername.github.io/nexora`

---

## 🔑 Adding Your API Key

Nexora works without a key (offline rule-based mode). To unlock full AI:

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) → sign up free
2. Create a new API key (starts with `sk-or-...`)
3. In the app: tap **Menu (☰) → 🔑 API Key Setup**
4. Paste your key and tap **Save & Activate**

> **Privacy:** Your key is stored only in your own browser's `localStorage`. It is never sent anywhere except directly to OpenRouter's API.

---

## 🧩 Modes

| Mode | Description |
|---|---|
| 🤍 **Support Mode** | Empathetic, calm responses for emotional conversations |
| ✨ **Gossip Mode** | Fun, playful energy for casual chats |
| 🔥 **Hype Mode** | Motivational, high-energy responses |
| 🎙️ **Voice Mode** | Hands-free mic input + TTS output |

---

## 🛠️ Tech Stack

- **Vanilla HTML / CSS / JavaScript** — zero dependencies, zero build tools
- **OpenRouter API** — unified gateway to free AI models
- **Web Speech API** — voice input & output
- **Service Worker** — offline caching & PWA install
- **localStorage** — persistent user memory
- **Google Fonts** — Sora + DM Sans

---

## 🔒 Privacy

- No backend, no database, no server
- All data (name, chat history, API key) stays in **your browser only**
- API calls go directly from your browser → OpenRouter
- No analytics, no tracking, no ads

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

<div align="center">

Made with 💜 by **Bikash Talukder**

*If you find Nexora useful, consider starring the repo ⭐*

</div>
