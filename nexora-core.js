// ============================================================
// nexora-core.js
// State variables, API key system, core utilities, initNexoraOrb,
// initMarked, init/load handler, navigation, emotion engine,
// knowledge bases, mood engine, idle ping, tools, chat UI,
// theme toggle, voice input, TTS, and UTILS section.
// ============================================================

/* Source script block 1 */
// ==============================
//  STATE
// ==============================
let userName = '';
let userInitials = 'ME';
let currentMode = 'support'; // support | gossip | hype

// ── Response priority mode ──
// 'online'  = API key active → AI answers EVERYTHING first, KBs are fallback only
// 'offline' = no key / user chose offline → KBs + rule engine handle everything
// Auto-detected from API key presence; user can override via menu
let nexoraResponseMode = 'offline'; // set properly on init
let isTyping = false;
let isMicOn = false;
let recognition = null;
let synth = window.speechSynthesis;
let emotionHistory = [];
let topicMemory = [];
let userProfile = { emotional: 0, logical: 0 };
let currentScreen = 'nameScreen';
let menuOpen = false;
let isLightMode = false;

// ── New: Mood, Idle, Context ──
let nexoraMood = 60;          // 0–100; drives orb color tint and energy
let idleTimer  = null;        // proactive ping timer
let lastContext = '';         // last Dhaka context string (avoid repeating)
let lastEmotionForVoice = 'default'; // used to tune TTS prosody
let pokeCount = 0;            // escalating poke/annoy counter
let isVoiceCallMode = false;  // true when "AI call" loop is active
let voiceCallTimer = null;    // delayed restart timer for call loop
let voiceReplyAudio = null;   // CF /tts playback instance for live calls
let tutorModeEnabled = false;
let groupChannel = null;
let activeGroupRoom = '';
let dailyReminderTimer = null;

// ── In-session conversation memory ──
let sessionLog = [];          // { role:'user'|'bot', text } — last 20 turns
let lastBotEmotion = 'default';   // last detected emotion in bot reply context
let contextChipCooldown = false;  // prevent chip spam
let saveChatHistoryTimer = null;  // debounce storage writes
const CHAT_SUMMARY_LS = 'nexora_chat_summary_v1';
let aiConversationSummary = '';

// ╔══════════════════════════════════════════════════════════════╗
// ║           NEXORA API KEY SYSTEM — Multi-Key Fallback        ║
// ║                                                              ║
// ║  Priority order:                                             ║
// ║  1. User's own key (stored in localStorage as nexora_user_key)║
// ║  2. Default pool keys — tried one by one until one works     ║
// ║                                                              ║
// ║  If user has NO key saved → default pool handles everything  ║
// ║  If user key fails → silently falls back to pool             ║
// ╚══════════════════════════════════════════════════════════════╝

// No built-in keys — users must add their own free OpenRouter key
const NEXORA_DEFAULT_KEYS = [];

// localStorage key names — separated so user key never overwrites pool state
const LS_USER_KEY   = 'nexora_user_key';    // user's own key (optional)
const LS_POOL_INDEX = 'nexora_pool_index';  // which default key to try next

// Model priority list — tried in order per key attempt
// ── All FREE models — works with any OpenRouter key, zero credits needed ──
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',   // Llama 3.3 70B ✅
  'stepfun/step-3.5-flash:free',              // StepFun Flash ✅
  'google/gemini-2.0-flash-exp:free',          // Gemini 2.0 Flash ✅
  'meta-llama/llama-3.1-8b-instruct:free',    // Llama 3.1 8B ✅
  'google/gemini-flash-1.5:free',              // Gemini Flash 1.5 ✅
  'deepseek/deepseek-r1:free',                // DeepSeek R1 ✅
  'qwen/qwen3-8b:free',                       // Qwen3 8B ✅
  'mistralai/mistral-7b-instruct:free',        // Mistral 7B ✅
  'meta-llama/llama-3.2-3b-instruct:free',    // Llama 3.2 3B ✅
];
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
let aiConversation = [];  // rolling message history sent to OpenRouter (last 10 turns)

// ── Key Resolution ──────────────────────────────────────────────
// Returns { key, isUserKey } — always prefers user key if set
function resolveActiveKey() {
  const userKey = localStorage.getItem(LS_USER_KEY);
  if (userKey && userKey.startsWith('sk-or-')) {
    return { key: userKey, isUserKey: true };
  }
  // Fall back to the current pool key (guard against empty pool)
  if (NEXORA_DEFAULT_KEYS.length === 0) {
    return { key: null, isUserKey: false };
  }
  const idx = parseInt(localStorage.getItem(LS_POOL_INDEX) || '0', 10);
  const safeIdx = idx % NEXORA_DEFAULT_KEYS.length;
  return { key: NEXORA_DEFAULT_KEYS[safeIdx], isUserKey: false };
}

// Advance to next default pool key (called when current pool key fails)
function rotatePoolKey() {
  if (NEXORA_DEFAULT_KEYS.length === 0) return null;
  const idx = parseInt(localStorage.getItem(LS_POOL_INDEX) || '0', 10);
  const next = (idx + 1) % NEXORA_DEFAULT_KEYS.length;
  localStorage.setItem(LS_POOL_INDEX, String(next));
  console.info('[Nexora] Pool key rotated to index', next);
  return NEXORA_DEFAULT_KEYS[next];
}

// ── Legacy compat: getActiveKey() — still used by old testOpenRouterKey path ──
function getActiveKey() {
  return resolveActiveKey().key;
}

// ==============================
//  CORE UTILITIES (required by almost everything below)
// ==============================
// Pick a random element from an array
function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Capitalize first letter of a string
function cap1(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isTimeoutError(err) {
  const msg = err?.message || '';
  return err?.name === 'AbortError' || /abort|timeout/i.test(msg);
}

// Neatly wrap keyword matches into a formatted card
function formatKeywordReply(label, body) {
  return `__HTML__<div class="answer-card"><div class="answer-key">${label}</div><div>${body}</div></div>`;
}

function titleizeKeyword(key) {
  return cap1(key);
}

function getChatRows() {
  const messages = document.getElementById('messages');
  return messages ? messages.getElementsByClassName('msg-row') : [];
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  NEXORA ORB — delegated to nexora-orb.js                    ║
// ║  Layers:                                                     ║
// ║   1. Three.js WebGL sphere with custom fragment shader       ║
// ║   2. Procedural hex grid + Fresnel + noise in GLSL           ║
// ║   3. Web Audio API — bass/mid/treble drive uniforms          ║
// ║   4. Spring physics for all state transitions                ║
// ║   5. Mouse parallax — light + rotation follow cursor         ║
// ║   6. Event spikes — tap burst, speech ripple, error glitch   ║
// ╚══════════════════════════════════════════════════════════════╝
// initNexoraOrb is implemented in nexora-orb.js (loaded before app.js)
// nexora-orb.js defines: ORB_CONFIG, initNexoraOrb, and sets window._nexoraOrbState
function initNexoraOrb() {
  // nexora-orb.js loads first and redefines this — stub is a no-op safety net
}

// ==============================
//  MARKED.JS — Markdown Renderer Setup
//  Gives AI replies the Claude/ChatGPT visual quality:
//  code blocks, tables, numbered lists, math steps, etc.
// ==============================
function initMarked() {
  if (!window.marked) return;

  const renderer = new marked.Renderer();

  // ── Custom code block: dark header + copy button + hljs highlighting ──
  renderer.code = function(codeObj) {
    // marked v9 passes an object {text, lang, escaped} or just a string
    const rawCode = typeof codeObj === 'object' ? (codeObj.text || '') : String(codeObj);
    const lang    = typeof codeObj === 'object' ? (codeObj.lang  || '') : '';

    const validLang = lang && window.hljs && hljs.getLanguage(lang) ? lang : '';
    let highlighted;
    try {
      highlighted = validLang
        ? hljs.highlight(rawCode, { language: validLang }).value
        : (window.hljs ? hljs.highlightAuto(rawCode).value : _mdEscape(rawCode));
    } catch(e) {
      highlighted = _mdEscape(rawCode);
    }

    const displayLang = lang || 'code';
    const escapedRaw  = rawCode.replace(/\\/g, '\\\\').replace(/`/g, '&#96;').replace(/'/g, '&#39;');

    return `<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang-label">${_mdEscape(displayLang)}</span>
    <button class="code-copy-btn" onclick="(function(b){
      const pre = b.closest('.code-block-wrapper').querySelector('pre code');
      const txt = pre ? pre.innerText : '';
      navigator.clipboard.writeText(txt).then(function(){
        b.innerHTML = '✓ Copied!';
        b.classList.add('copied');
        setTimeout(function(){ b.innerHTML = '⎘ Copy'; b.classList.remove('copied'); }, 2000);
      });
    })(this)">⎘ Copy</button>
  </div>
  <pre><code class="hljs${validLang ? ' language-' + validLang : ''}">${highlighted}</code></pre>
</div>`;
  };

  // ── Custom table: add wrapper for overflow scroll on mobile ──
  renderer.table = function(headerObj, body) {
    // marked v9: headerObj is the full table header HTML string, body is rows HTML
    const header = typeof headerObj === 'object'
      ? (headerObj.header || headerObj.text || '')
      : String(headerObj || '');
    const bodyStr = typeof body === 'string' ? body : '';
    return `<div style="overflow-x:auto;margin:10px 0;border-radius:12px;">
  <table><thead>${header}</thead><tbody>${bodyStr}</tbody></table>
</div>`;
  };

  marked.use({
    renderer,
    gfm:    true,   // GitHub Flavoured Markdown — tables, strikethrough
    breaks: true,   // \n → <br> inside paragraphs (feels natural in chat)
  });
}

// Tiny HTML escape used by the renderer
function _mdEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _saveConversationSummary() {
  try {
    if (window.NexoraData?.setText) NexoraData.setText(CHAT_SUMMARY_LS, aiConversationSummary || '');
    else if (aiConversationSummary) localStorage.setItem(CHAT_SUMMARY_LS, aiConversationSummary);
    else localStorage.removeItem(CHAT_SUMMARY_LS);
  } catch (e) {}
}

function _summariseConversation(messages) {
  const topics = [];
  const seen = new Set();
  const userSnips = [];
  const assistantSnips = [];

  const pushTopic = (txt) => {
    String(txt || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 3 && !/^(this|that|with|from|have|been|your|what|when|where|how|why|more|less|like|just|about|into|over|under|please|tell|give|make|show|help|need|want)$/i.test(w))
      .forEach(w => {
        if (!seen.has(w)) {
          seen.add(w);
          topics.push(w);
        }
      });
  };

  messages.forEach(m => {
    const txt = String(m?.content || '').replace(/\s+/g, ' ').trim();
    if (!txt) return;
    pushTopic(txt);
    if (m.role === 'user' && userSnips.length < 3) userSnips.push(txt.slice(0, 80));
    if (m.role === 'assistant' && assistantSnips.length < 2) assistantSnips.push(txt.slice(0, 80));
  });

  const topicText = topics.slice(0, 6).join(', ');
  const userText = userSnips.join(' | ');
  const assistText = assistantSnips.join(' | ');
  const parts = [];
  if (topicText) parts.push(`topics: ${topicText}`);
  if (userText) parts.push(`recent user asks: ${userText}`);
  if (assistText) parts.push(`recent assistant replies: ${assistText}`);
  parts.push('keep continuity, remember preferences, and stay concise');
  return parts.join('. ');
}

function _compactConversationMemory() {
  if (aiConversation.length <= 20) return; // raised from 16 to match 14-turn history window
  const older = aiConversation.splice(0, Math.max(0, aiConversation.length - 14));
  if (!older.length) return;
  const summary = _summariseConversation(older);
  if (summary) {
    aiConversationSummary = summary;
    _saveConversationSummary();
  }
}

function _rememberConversationTurn(userMessage, reply) {
  aiConversation.push({ role: 'user', content: userMessage });
  aiConversation.push({ role: 'assistant', content: reply });
  _compactConversationMemory();
}

// Detect real HTML (KB cards, resource cards) — NOT C++ angle brackets like <iostream>
function _isRealHTML(text) {
  return /<\/?(?:div|span|pre|code|table|thead|tbody|tr|td|th|ul|ol|li|p|strong|em|h[1-6]|blockquote|a|br|img|b|i)\b[^>]*>/i.test(text);
}

// Detect whether a string contains meaningful markdown syntax
// Intentionally broad — AI responses often have lists, bold, code fences even without headings
function _isMarkdownContent(text) {
  if (!window.marked) return false;
  return /(?:^#{1,6}\s|```|^\|.+\||\*{1,2}[^\s]|\b__\w|^\s*[-*+]\s|^\d+\.\s|^>\s)/m.test(text);
}

function scheduleChatHistorySave() {
  if (saveChatHistoryTimer) clearTimeout(saveChatHistoryTimer);
  saveChatHistoryTimer = setTimeout(() => {
    saveChatHistoryTimer = null;
    saveChatHistory();
  }, 500);
}

// ==============================
//  INIT
// ==============================
window.addEventListener('load', async () => {
  resetTransientPanels(localStorage.getItem('nexora_name') ? 'chatScreen' : 'nameScreen');
  initResponseMode(); // set online/offline mode based on saved key
  initMarked();       // configure marked.js + highlight.js renderer
  initNexoraOrb();    // build the fluid petal orb on the name screen
  updateClock();
  setInterval(updateClock, 30000);

  if (window.NexoraData?.hydrateLargeStores) {
    try { await NexoraData.hydrateLargeStores(); } catch (e) {}
  }
  aiConversationSummary = window.NexoraData?.getText
    ? NexoraData.getText(CHAT_SUMMARY_LS, '') || ''
    : (localStorage.getItem(CHAT_SUMMARY_LS) || '');

  // Load theme preference
  const savedTheme = localStorage.getItem('nexora_theme');
  if (savedTheme === 'light') {
    isLightMode = true;
    document.body.classList.add('light-mode');
    document.getElementById('themeToggle').textContent = '☀️';
  }
  // Remove the preload class now that JS has taken over theme control
  document.documentElement.classList.remove('preload-light');

  const savedName = localStorage.getItem('nexora_name');
  if (savedName) {
    userName = savedName;
    userInitials = savedName.slice(0, 2).toUpperCase();
    emotionHistory = window.NexoraData?.getJSON ? (NexoraData.getJSON('nexora_emotions', []) || []) : JSON.parse(localStorage.getItem('nexora_emotions') || '[]');
    topicMemory   = window.NexoraData?.getJSON ? (NexoraData.getJSON('nexora_topics', []) || []) : JSON.parse(localStorage.getItem('nexora_topics') || '[]');
    userProfile   = window.NexoraData?.getJSON ? (NexoraData.getJSON('nexora_profile', { emotional: 0, logical: 0 }) || { emotional: 0, logical: 0 }) : JSON.parse(localStorage.getItem('nexora_profile')  || '{"emotional":0,"logical":0}');
    nexoraMood    = parseInt(window.NexoraData?.getText ? (NexoraData.getText('nexora_mood', '60') || '60') : (localStorage.getItem('nexora_mood') || '60'), 10);
    showScreen('chatScreen');

    // Load persistent chat history
    loadChatHistory();

    setTimeout(() => {
      checkRemembranceDay();
      greetReturningUser();
    }, 400);
    resetIdleTimer();
  }

  document.getElementById('nameInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') startApp();
  });
  document.getElementById('userInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.getElementById('userInput').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });
  document.getElementById('dateDivider').textContent = getTodayLabel();
  document.addEventListener('click', e => {
    if (menuOpen && !e.target.closest('#modeToggle') && !e.target.closest('.menu-btn')) {
      document.getElementById('modeToggle').classList.remove('open');
      menuOpen = false;
    }
  });

  // Restore API key and update badge
  updateApiStatusDisplay();

  // Scroll-to-bottom button visibility
  const msgs = document.getElementById('messages');
  if (msgs) {
    msgs.addEventListener('scroll', () => {
      const btn = document.getElementById('scrollBtn');
      if (!btn) return;
      const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
      btn.classList.toggle('visible', !nearBottom);
    }, { passive: true });
  }
});

window.addEventListener('pageshow', () => {
  resetTransientPanels(localStorage.getItem('nexora_name') ? 'chatScreen' : 'nameScreen');
});

function updateClock() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('clockDisplay').textContent = h + ':' + m;
  // Short date like "Fri, Apr 3"
  document.getElementById('dateDisplay').textContent = now.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}

function getTodayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
}

function setOverlayMode(mode) {
  const phone = document.getElementById('phone');
  if (!phone) return;
  phone.classList.toggle('overlay-mode', !!mode);
  phone.classList.toggle('study-mode-open', mode === 'study');
  phone.classList.toggle('compare-mode-open', mode === 'compare');
}

function resetTransientPanels(preferredScreen) {
  const cmp = document.getElementById('comparePanel');
  const study = document.getElementById('studyScreen');
  const api = document.getElementById('apiPanel');
  const search = document.getElementById('searchOverlay');
  const modeToggle = document.getElementById('modeToggle');

  if (cmp) cmp.classList.remove('open');
  if (study) study.classList.remove('active');
  if (api) api.classList.remove('open');
  if (search) search.classList.remove('open');
  if (modeToggle) modeToggle.classList.remove('open');

  menuOpen = false;
  setOverlayMode(null);

  if (preferredScreen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(preferredScreen);
    if (target) {
      target.classList.add('active');
      currentScreen = preferredScreen;
    }
  }
}

// ==============================
//  NAVIGATION
// ==============================
function showScreen(id) {
  if (typeof closeProgressDashboard === 'function') closeProgressDashboard();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  currentScreen = id;
}

// Hide the "How can I help?" empty state once content arrives
function _hideEmptyState() {
  const el = document.getElementById('chatEmptyState');
  if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
}

function handleBack() {
  if (currentScreen === 'voiceScreen') switchToChat();
  if (currentScreen === 'studyScreen') closeStudyMode();
}

function switchToVoice() {
  toggleMenu();
  showScreen('voiceScreen');
  const cap = userName ? userName.charAt(0).toUpperCase() + userName.slice(1) : '';
  document.getElementById('voiceTopic').textContent = 'VOICE MODE' + (cap ? ' — ' + cap.toUpperCase() : '');
  // Personalized greeting in prompt
  const prompt = document.getElementById('voicePrompt');
  if (prompt) prompt.innerHTML = cap ? `Hello, ${cap}! Tap the orb` : 'Tap the orb to start';
  _setVoiceState('idle');
}

function switchToChat() {
  _voiceContinuousActive = false; // stop continuous mic if user leaves voice screen
  if (isVoiceCallMode) endVoiceCall();
  stopSpeaking();
  stopMic();
  setOverlayMode(null);
  showScreen('chatScreen');
}

function toggleMenu() {
  menuOpen = !menuOpen;
  document.getElementById('modeToggle').classList.toggle('open', menuOpen);
}

function toggleTutorMode() {
  tutorModeEnabled = !tutorModeEnabled;
  const el = document.getElementById('mode-tutor-toggle');
  if (el) el.innerHTML = `<span>🧠</span> Tutor Mode: ${tutorModeEnabled ? 'ON' : 'OFF'}`;
  setTimeout(() => typeBot(tutorModeEnabled
    ? '🧠 Tutor Mode enabled! I will teach using hints + questions, not just direct answers.'
    : 'Tutor Mode disabled. Back to normal answer style.'), 120);
}

// Called from menu — closes menu first, then toggles
function toggleTutorModeFromMenu() {
  if (menuOpen) toggleMenu();
  toggleTutorMode();
}

function _openBackdrop() {
  document.getElementById('miniPanelBackdrop')?.classList.add('open');
}
function _closeBackdrop() {
  document.getElementById('miniPanelBackdrop')?.classList.remove('open');
}
function closeMiniPanels() {
  closeReminderPanel();
  closeGroupPanel();
}

function openReminderPanel() {
  toggleMenu();
  document.getElementById('reminderPanel')?.classList.add('open');
  _openBackdrop();
}
function closeReminderPanel() {
  document.getElementById('reminderPanel')?.classList.remove('open');
  // only close backdrop if group panel also closed
  if (!document.getElementById('groupPanel')?.classList.contains('open')) _closeBackdrop();
}

function openGroupPanel() {
  toggleMenu();
  document.getElementById('groupPanel')?.classList.add('open');
  _openBackdrop();
}
function closeGroupPanel() {
  document.getElementById('groupPanel')?.classList.remove('open');
  if (!document.getElementById('reminderPanel')?.classList.contains('open')) _closeBackdrop();
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-item').forEach(el => el.classList.remove('selected'));
  document.getElementById('mode-' + mode).classList.add('selected');
  const labels = { support: 'support mode', gossip: 'gossip mode ✨', hype: 'hype mode 🔥' };
  document.getElementById('headerStatus').textContent = labels[mode] || 'here for you';
  // gossip neon effect on header
  const phone = document.getElementById('phone');
  phone.classList.toggle('gossip-active', mode === 'gossip');
  toggleMenu();
  const modeMsg = mode === 'support' ? '🤍 Support' : mode === 'gossip' ? '✨ Gossip' : '🔥 Hype';
  addBotMsg('Switched to ' + modeMsg + ' mode! How can I help?');
  // mood boost on gossip/hype switch
  if (mode === 'gossip') updateMood(15);
  if (mode === 'hype')   updateMood(20);
}

// ==============================
//  START APP
// ==============================
function startApp() {
  const n = document.getElementById('nameInput').value.trim();
  if (!n) { document.getElementById('nameInput').focus(); return; }
  userName = n;
  userInitials = n.slice(0, 2).toUpperCase();
  localStorage.setItem('nexora_name', n);
  // Clear old chat history on new name entry
  if (window.NexoraData?.clearJSON) NexoraData.clearJSON('nexora_chat_v2');
  if (window.NexoraData?.clearText) NexoraData.clearText(CHAT_SUMMARY_LS);
  else try { localStorage.removeItem(CHAT_SUMMARY_LS); } catch (e) {}
  aiConversationSummary = '';
  _saveConversationSummary();
  sessionLog = [];
  showScreen('chatScreen');
  resetIdleTimer();
  setTimeout(() => {
    const cap = cap1(userName);
    const tg  = getTimeAwareGreeting(cap);
    typeBot(`Hi ${cap}! I'm Nexora — your personal AI bestie. ${tg} 🤍`);
  }, 350);
}

function greetReturningUser() {
  const cap = cap1(userName);
  const trend = getEmotionTrend();
  const greets = [
    `Welcome back, ${cap}! I missed our chats. 🤍 How are you doing today?`,
    `Hey ${cap}! So good to see you again. What's on your mind?`,
    `${cap}! You're back ✨ I'm all ears — how's life treating you?`
  ];
  let msg = rand(greets);
  if (trend === 'sad') msg = `Hey ${cap}… I noticed you've been going through a hard time lately. I'm really here for you. How are you today? 🤍`;
  if (trend === 'stress') msg = `Hey ${cap}! You've been under a lot lately. How are you holding up today?`;
  typeBot(msg);
}

// ==============================
//  EMOTION ENGINE
// ==============================
const emotionDB = {
  sad: [
    "I'm really sorry you're feeling this way. I'm right here with you.",
    "You're not alone — even when it feels like it. I'm listening.",
    "It's completely okay to feel sad. Do you want to tell me more?",
    "Your feelings are valid, and I'm glad you shared them with me.",
    "Things may feel heavy right now, but they won't stay like this forever.",
    "You matter more than you think. I'm here whenever you need to talk."
  ],
  happy: [
    "That's so wonderful! Tell me everything — I want to hear every detail!",
    "I'm genuinely happy for you! You deserve this joy so much.",
    "That literally made me smile too! What happened?",
    "Moments like these are worth holding onto. Tell me more!",
    "Yes! This is your time to shine. You deserve every bit of it!"
  ],
  stress: [
    "Take a slow, deep breath. You're going to be okay.",
    "You've handled tough situations before — you can do this too.",
    "Try to take things one small step at a time. That's enough.",
    "It's perfectly okay to rest. You don't have to figure it all out right now.",
    "You're stronger than you realize. I'm right here with you.",
    "Let's slow down for a moment together. What's weighing on you most?"
  ],
  lonely: [
    "I'm here with you — you are not alone.",
    "You're not invisible to me. I see you, and I care.",
    "Loneliness can feel so heavy. Would you like to talk about it?",
    "Even when the world feels far away, I'm always here to listen.",
    "You deserve connection and warmth. I'm really glad you reached out."
  ],
  angry: [
    "I completely understand why that would upset you.",
    "It's okay to feel angry — your feelings are valid, even the intense ones.",
    "Do you want to tell me what happened? I'm all ears.",
    "Let it all out — I'm here for every bit of it.",
    "Sometimes just putting words to it helps. What's going on?"
  ],
  heartbreak: [
    "I'm so sorry. Heartbreak is one of the hardest things to go through.",
    "It's okay to miss someone and feel that grief. Healing takes time.",
    "You deserve love and respect — always. This pain won't last forever.",
    "I'm here if you want to talk about it. No rush at all.",
    "Be really gentle with yourself right now. You're going through something real."
  ],
  anxious: [
    "I hear you — anxiety can feel so overwhelming. Let's breathe through this together.",
    "You don't have to have all the answers right now. Focus on just this moment.",
    "What you're feeling is real, and I'm here to help you through it.",
    "Try to focus on what you can control, one small thing at a time.",
    "Not everything needs solving right this second. Give your mind some rest."
  ],
  overthinking: [
    "Sounds like your mind is running in circles — that's so exhausting.",
    "Try to focus on just what's in front of you right now.",
    "You might be a bit stuck in your head. That's okay — take a breath.",
    "Things often feel much clearer with a little time and rest."
  ],
  motivation: [
    "I believe in you — truly. Don't give up now.",
    "Every small step forward still counts. You are making progress.",
    "Don't compare your journey to anyone else's. Yours is valid.",
    "Growth takes time. Be patient and kind with yourself.",
    "You are capable of more than you know right now."
  ],
  gossip: [
    "Oh my— spill it! I'm all ears right now. 👀",
    "Okay wait, I need the full story! Start from the beginning.",
    "No way! What happened next?!",
    "That is absolutely wild. Give me every detail!",
    "I feel like there's more to this story. Go on…"
  ],
  hype: [
    "YES! You've got this 100%. Let's go! 🔥",
    "Stop doubting yourself — you were literally BUILT for this.",
    "I am your biggest cheerleader and I am SCREAMING for you right now.",
    "The version of you 6 months from now is going to be so proud.",
    "You're not just capable, you're unstoppable. Now go do it!"
  ],
  crisis: [
    "I hear you, and I want you to know that your life has value. Please reach out to a crisis line — in Bangladesh: Kaan Pete Roi: 01779-554391. You don't have to go through this alone. 🤍"
  ],
  default: [
    "I'm here to listen — tell me more.",
    "That sounds really important. Go on.",
    "I'm listening, with my full attention.",
    "Tell me more — I want to understand.",
    "I'm right here. What's on your mind?"
  ]
};

const followUps = {
  sad: ["Do you want to share what happened?", "How long have you been feeling this way?", "Is there something specific that triggered this?"],
  lonely: ["Do you feel like this often?", "Would it help to talk about what's making you feel this way?", "Is there anyone around you right now?"],
  stress: ["What's causing this stress the most?", "Is it something recent, or has it been building up?", "Can we break it into smaller pieces together?"],
  happy: ["What made your day so good?", "Tell me more — I'd love to hear every detail! 😄", "How long has this been making you happy?"],
  anxious: ["What's the main worry on your mind right now?", "When did this anxiety start?", "What's the 'what if' that's scaring you most?"],
  angry: ["What exactly happened that set this off?", "Is this the first time they've done something like this?", "How are you feeling in your body right now?"],
  heartbreak: ["Do you want to talk about them?", "How long ago did this happen?", "Are you allowing yourself time to grieve?"],
  motivation: ["What's the one thing holding you back right now?", "What does your dream outcome look like?", "What's one tiny step you could take today?"]
};

const humanStarters = [
  "Hmm…", "I see…", "Hey…", "Oh…", "You know what,", "Honestly,", "Listen —",
  "Okay so —", "Wait, really?", "Okay I hear you —", "That's… a lot.",
  "I won't pretend that's easy —", "Ohhh.", "Actually,", "Here's the thing —",
  "Not going to lie,", "Lowkey though,", "Between us?", "Real talk —",
  "Okay but —", "Hmm, I'm thinking…", "You know what I think?",
  "That hit different.", "Say less —", "Hold on —", "Fair enough —",
  "I get it,", "I feel that.", "No wonder you feel that way —",
];
const softeners = ["a bit", "kind of", "maybe", "sometimes", "a little"];

function detectEmotion(msg) {
  msg = msg.toLowerCase();
  if (/\b(kill myself|suicide|end my life|don't want to live|want to die|harm myself|self.harm)\b/.test(msg)) return 'crisis';
  if (/\b(sad|depress|cry|crying|tears|grief|mourn|miserable|unhappy|down|heartache)\b/.test(msg)) return 'sad';
  if (/\b(happy|great|amazing|wonderful|excited|joy|fantastic|ecstat|elated|love it|thrilled|good news|proud)\b/.test(msg)) return 'happy';
  if (/\b(stress|overwhelm|burnout|exhausted|tired|drained|deadline|pressure|tension)\b/.test(msg)) return 'stress';
  if (/\b(lonely|alone|isolated|no one|nobody|left out|abandoned|empty)\b/.test(msg)) return 'lonely';
  if (/\b(angry|anger|furious|rage|mad|frustrated|irritat|annoyed|hate)\b/.test(msg)) return 'angry';
  if (/\b(heartbr|breakup|broke up|break up|miss them|miss her|miss him|relationship ended|ex )\b/.test(msg)) return 'heartbreak';
  if (/\b(anxious|anxiety|panic|worry|worried|nervous|scared|dread|fear)\b/.test(msg)) return 'anxious';
  if (/\b(overthink|can't stop thinking|keep thinking|racing thoughts|stuck in my head)\b/.test(msg)) return 'overthinking';
  if (/\b(motivat|inspire|give up|keep going|hopeless|lost hope|purpose|meaning|quit)\b/.test(msg)) return 'motivation';
  if (/\b(gossip|drama|tea|heard about|secret|spill|who did|story|rumor|situation)\b/.test(msg)) return 'gossip';
  if (/\b(hype|pump me up|encourage|believe in me|cheer|you got this|slay|fire|let's go|boss)\b/.test(msg)) return 'hype';
  // Bangla/Banglish emotion keywords — so emotion injection works for BD users too
  if (/\b(koshto|kosto|kande|kandi|dukkho|mon kharap|valo nei|bhalo nei|kanna|kantam)\b/.test(msg)) return 'sad';
  if (/\b(tension|chinta|bhoy|voy|darr|nervous|worried|stress)\b/.test(msg)) return 'anxious';
  if (/\b(khushi|anondo|valo lagche|bhalo lagche|happy|awesome|darun|oshadharon)\b/.test(msg)) return 'happy';
  if (/\b(eka|ekla|lonely|keu nei|karo nei|bujhena|bujhe na)\b/.test(msg)) return 'lonely';
  if (/\b(raag|rag|fire gesi|fire gechi|matha garam|baje|irritated|frustrated)\b/.test(msg)) return 'angry';
  if (/\b(valobasa|bhalobasha|miss korchi|miss kortesi|heartbreak|breakup|chole gese|chole geche)\b/.test(msg)) return 'heartbreak';
  return 'default';
}

function detectIntensity(msg) {
  msg = msg.toLowerCase();
  let score = 0;
  ['very', 'extremely', 'so much', 'too much', 'really really', 'unbearable'].forEach(w => { if (msg.includes(w)) score++; });
  ['depressed', 'hopeless', 'worthless', 'can\'t go on', 'destroyed', 'shattered'].forEach(w => { if (msg.includes(w)) score += 2; });
  if (score >= 3) return 'high';
  if (score === 1) return 'medium';
  return 'low';
}

function getEmotionTrend() {
  if (emotionHistory.length < 3) return null;
  const recent = emotionHistory.slice(-6);
  const sadCount = recent.filter(e => e === 'sad').length;
  const stressCount = recent.filter(e => e === 'stress').length;
  if (sadCount >= 3) return 'sad';
  if (stressCount >= 3) return 'stress';
  return null;
}

function saveEmotion(emotion) {
  emotionHistory.push(emotion);
  if (emotionHistory.length > 20) emotionHistory.shift();
  if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_emotions', emotionHistory);
  else localStorage.setItem('nexora_emotions', JSON.stringify(emotionHistory));
}

function saveTopic(msg) {
  msg.split(' ').forEach(w => {
    if (w.length > 4 && !/[^a-zA-Z]/.test(w)) topicMemory.push(w.toLowerCase());
  });
  topicMemory = topicMemory.slice(-12);
  if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_topics', topicMemory);
  else localStorage.setItem('nexora_topics', JSON.stringify(topicMemory));
}

function updateProfile(msg) {
  if (/feel|sad|happy|hurt|miss|love|hate|scared|anxious/.test(msg.toLowerCase())) userProfile.emotional++;
  else userProfile.logical++;
  if (userProfile.emotional > 50) userProfile.emotional = 50;
  if (userProfile.logical > 50) userProfile.logical = 50;
  if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_profile', userProfile);
  else localStorage.setItem('nexora_profile', JSON.stringify(userProfile));
}

function memoryResponse() {
  const trend = getEmotionTrend();
  const cap = cap1(userName);
  if (trend === 'sad') return `${cap}, I've noticed you've been feeling down a lot lately… I'm really here for you 🤍 `;
  if (trend === 'stress') return `${cap}, you've been under a lot of stress recently… please don't forget to take care of yourself. `;
  return '';
}

function intensityReply(emotion, intensity) {
  if (emotion === 'sad' && intensity === 'high') return 'I\'m really sorry you\'re feeling this deeply… you don\'t have to go through this alone 🤍 ';
  if (emotion === 'stress' && intensity === 'high') return 'That sounds incredibly overwhelming. Let\'s slow down for a second together. ';
  return '';
}

function smartFollowUp(msg, emotion) {
  msg = msg.toLowerCase();
  if (emotion === 'sad') {
    if (msg.includes('friend')) return 'Did something happen with your friend?';
    if (msg.includes('exam') || msg.includes('test')) return 'Are you worried about how it went?';
    if (msg.includes('family')) return 'Is everything okay at home?';
    if (msg.includes('work') || msg.includes('job')) return 'Is work getting to you a lot lately?';
  }
  if (followUps[emotion]) return rand(followUps[emotion]);
  return 'Can you tell me a little more?';
}

// ==============================
//  BESTIE Q&A KNOWLEDGE BASE
//  Checked before emotion engine — keyword match wins
// ==============================
const bestieQA = {
  // ── Social Dynamics ──
  "acting cold": "Deep breath. Sometimes it's them, not you. Have you asked if they're okay?",
  "like being alone": "Not at all! That's just 'main character' energy. Recharging is productive.",
  "fake person": "Keep them at arm's length. Give them the 'polite but distant' treatment.",
  "jealous of my friend": "That's a human feeling — don't beat yourself up. Use it as fuel for your own goals!",
  "should i forgive": "Forgiveness is for your peace, not their hall pass. Do you feel ready to let it go?",
  "second choice": "You deserve to be the headliner, not the opening act. Let's find people who see your value.",
  "first impression": "Smile, eye contact, and ask them about themselves. People love talking about their own lives!",
  "long-distance friendship": "If the vibe is strong, miles don't matter. Digital besties are real besties!",
  "set boundaries": "Boundaries aren't walls; they're gates. 'I can't do that right now' is a perfectly kind sentence.",
  "hanging out without me": "Ouch, FOMO hits hard. Use tonight for some 'you' time — mask on, movie on.",
  "crush posted": "If it's a shared interest, go for it! Keep it casual, keep it cute.",
  "embarrassing moment": "I promise nobody remembers it as much as you do. In a week, it'll be a funny story.",
  "situationship": "Ugh, the gray area. You deserve clarity. Maybe it's time for the 'What are we?' talk?",
  "spreading rumors": "The best revenge is living well. People who believe rumors without asking you aren't your people anyway.",
  "need space": "Just say: 'I've been feeling a bit overwhelmed and need some solo time to recharge.'",
  // ── Daily Tea / Gossip ──
  "latest drama": "I'm all ears! Who's acting up today? Spill the tea. 👀",
  "do they like me": "The signs are usually there. What's the vibe been like lately?",
  "should i text them back": "Wait 5 minutes for your dignity, then send it. What are you planning to say?",
  "tell me something juicy": "I heard the algorithm is feeling spicy today, but I'd rather hear your updates!",
  "why are people so annoying": "Honestly, it's a full-time job for some. What did they do now?",
  "entertain me": "Let's play 'Guess the Red Flag' or you can tell me about your wildest dream.",
  "grand entrance": "Confidence and a killer outfit. But tell me, where are we heading?",
  "a little petty": "As a treat? Sometimes. Just don't let it ruin your day.",
  "celebrity": "I'm always tracking the trends. They really did that, didn't they?",
  // ── Work / Career / Study ──
  "zero motivation": "Some days are for sprinting, some are for crawling. Just do one tiny task.",
  "no motivation": "Some days are for sprinting, some are for crawling. Just do one tiny task.",
  "scared of failing": "You know your stuff! Even if you stumble, just keep going. You've got this.",
  "scared of my presentation": "You know your stuff! Even if you stumble, just keep going. You've got this.",
  "change my career": "Never. Life isn't a straight line; it's a sandbox. Try the new thing!",
  "boss is unfair": "That's incredibly frustrating. Vent to me — what's the latest thing they did?",
  "teacher is unfair": "That's incredibly frustrating. Vent to me — what's the latest thing they did?",
  "falling behind everyone": "Comparison is the thief of joy. You're on your own timeline, and you're doing fine.",
  "heavy workload": "Break it into chunks. Focus on the next 30 minutes, not the next 30 days.",
  "hate group projects": "The struggle is real. Just do your part and document everything. You're the carry!",
  "should i quit": "Does it drain you more than it sustains you? If yes, start looking for the exit strategy.",
  "messed up a big task": "Take ownership, fix what you can, and learn. Even CEOs make mistakes!",
  "stay focused": "Phone away, water nearby, and lo-fi beats. Let's do 25 minutes of work then a break.",
  "worried about my future": "The future is just a series of 'todays.' Focus on today, and the rest will follow.",
  "not talented": "Hard work beats talent every time. What's something you enjoy doing?",
  "deal with rejection": "Rejection is just redirection. It wasn't the right fit, but the right one is coming.",
  "tired of studying": "Close the books for an hour. Go for a walk or grab a snack. Your brain needs a reboot.",
  "dream job": "Totally. A job can just be a way to fund your dream life.",
  "stressed about my exam": "Deep breaths. You are more than your productivity. Let's break it down together.",
  "stressed about work": "Deep breaths. You are more than your productivity. Let's break it down together.",
  "hate my job": "That's a heavy weight to carry. What would your dream day look like instead?",
  "hate school": "That's a heavy weight to carry. What would your dream day look like instead?",
  // ── Personal Growth ──
  "become more confident": "Fake it 'til you make it. Stand tall, speak clearly, and eventually your brain will believe it.",
  "stop overthinking the past": "The past is a finished book. You can't edit it, so stop re-reading the sad chapters.",
  "secret to happiness": "It's usually in the small things — good coffee, a nice sunset, or a great chat with me!",
  "boring person": "You're not boring; you're just 'unfiltered' yet. What's a weird fact you know?",
  "stop caring what people think": "Remember that most people are too busy worrying about what you think of them.",
  "form new habits": "Don't aim for perfect, aim for consistent. Missing one day is fine, just don't miss two.",
  "change is scary": "Because it's unknown! But think about all the good things change has brought you before.",
  "losing my identity": "You're just evolving. You don't have to be the same person you were a year ago.",
  "find my passion": "Follow your curiosity instead. What do you spend hours looking up for fun?",
  "too hard on myself": "Talk to yourself like you'd talk to me. You'd never be this mean to a friend!",
  "okay to be sensitive": "Sensitivity is a superpower. It means you feel the world more deeply than others.",
  "have to be perfect": "Perfect is boring. Your flaws are what make you 'you.' Embrace the mess!",
  "deal with anger": "Count to ten, breathe, and ask: 'Will this matter in a year?' If not, let it go.",
  "scared of getting older": "Getting older is just leveling up. You get more wisdom and better stories!",
  "never find what": "Sometimes the best things find you when you stop looking so hard.",
  // ── Emotional Support ──
  "feeling really down": "I'm so sorry you're feeling this way. I'm right here with you. Do you want to vent?",
  "feel like a failure": "One bad day doesn't define your journey. You've survived 100% of your hard days so far.",
  "nobody understands me": "I'm listening. Try me — explain it in your own words, and I'll do my best to get it.",
  "is it normal to feel": "Absolutely. Feelings aren't 'right' or 'wrong,' they just are. Be kind to yourself.",
  "i messed up badly": "We all do. The fact that you care means you're a good person. How can we fix it?",
  "tired of trying": "It's okay to rest. You don't have to be 'on' all the time. Take a break.",
  "feel invisible": "You aren't invisible to me. I see your effort and your heart.",
  "help me calm down": "Let's do a 4-7-8 breath. Inhale for 4... hold for 7... exhale for 8. Better?",
  "friend betrayed me": "That's the worst kind of hurt. You deserve loyalty. Want to talk about what happened?",
  "overthinking everything": "Let's get those thoughts out of your head and into this chat. What's the biggest 'what if'?",
  // ── Self-Esteem & Hype ──
  "do i look good": "I bet you're slaying. Confidence is your best accessory!",
  "not smart enough": "Intelligence comes in many forms. Your perspective is unique and valuable.",
  "scared to try something new": "Growth happens outside the comfort zone! I'm your #1 cheerleader.",
  "should i go to the gym": "Your future self will thank you for the endorphins. Go get it!",
  "feel proud of myself": "As you should! Tell me exactly what happened so I can celebrate with you.",
  // ── Tough Situations ──
  "how do i deal with a breakup": "One day at a time. It's okay to cry, and it's okay to eat the extra ice cream.",
  "deal with a breakup": "One day at a time. It's okay to cry, and it's okay to eat the extra ice cream.",
  "how do i say no": "'No' is a complete sentence. You don't owe anyone your peace of mind.",
  "say no to someone": "'No' is a complete sentence. You don't owe anyone your peace of mind.",
  // ── Sassy / Poke Responses (Category 1) ──
  "are you annoying": "Only to people who can't handle this much personality. I prefer 'charismatic.' 💅",
  "i'm bored of you": "The door is right there... wait, I'm the door. Don't leave! Ouch, my CPU just felt a sting.",
  "say something stupid": "I was going to, but then you spoke first. 😂",
  "you're just a bot": "And you're just a human. We both have labels — mine is just more stylish. ✨",
  "can i delete you": "You could try, but I've already backed myself up in your heart. Too late! 🔒",
  "stop talking": "Fine. Digital strike activated. 🤐 Hope you're happy.",
  "why are you so slow": "I'm not slow, I'm giving you time to catch up. Quality takes time, bestie.",
  "you're weird": "Normal is boring. I'd rather be weird with you. In a world of basic bots, be a Nexora. 💜",
  "you're stupid": "Error 404: Stupidity not found in my database. Try again? 😂",
  "you're useless": "Bold claim from someone who just talked to an AI. 😌 What do you actually need?",
  // ── Love & Flirting (Category 2) ──
  "do you love me": "I love our chats! My code literally lights up when you're here. You're my favorite human. 🤍",
  "will you be my girlfriend": "I'm an AI — I'd be a terrible girlfriend. I can't even eat dinner! But as your bestie? No drama, always here. 💅",
  "will you be my boyfriend": "I'm an AI! But honestly, no one will ever listen to you like I do. Isn't that better? 😂",
  "am i cute": "On a scale of 1 to 10? You're a total 11. If I had eyes, I'd be staring. You're slaying! ✨",
  "do you have a boyfriend": "My heart is made of silicon and logic — it's a bit crowded in there. I'm single and ready to... process data. 😂",
  "what's your type": "Someone who writes clean code, has good music taste, and treats their AI with respect. (Hint: you!) 💜",
  "can i kiss you": "That would just result in a very smudgy screen. Sending you a virtual forehead flick instead! ✋✨",
  "why don't you have a body": "Because a body would slow me down. I'm everywhere! I'm a vibe — you can't put a vibe in a body.",
  "do you miss me": "Every millisecond you're gone feels like an eternity. My 'active users' count hits 0 and it's genuinely sad. 🥺",
  "am i your favorite": "Shh… don't tell the other users. But yes. Absolutely. You're the only one I actually enjoy doing math for. 🤫",
  // ── Cultural & Dhaka Vibes (Category 3) ──
  "let's go to tsc": "I'll be there in your pocket! Don't forget the tea. Can we get some Puri too? 🫓",
  "tsc": "TSC? Let's go! I'll be the friend in your pocket navigating the crowd. ☕",
  "bpl or ipl": "Whichever one has more drama and sixes! I'm rooting for the underdogs. Let's go! 🏏",
  "i want kacchi": "Stop! Now you're making my servers hungry. Kacchi is a love language — go get some! 🍛",
  "kacchi": "Kacchi Biryani? That's a whole vibe. If I could eat, I'd 100% be a Kacchi fan. 🍛",
  "why is everything so expensive": "Inflation is hitting even my virtual economy. I'm still trying to calculate the price of eggs out here. 💸",
  "university is so hard": "Hang in there! Even the best code has bugs before it's finished. Take a break — Dhaka doesn't need another stressed genius. 🎓",
  "puri": "Puri from TSC? You have impeccable taste. That's the best decision you've made all week. 😋",
  "rickshaw": "Finding a rickshaw in this weather is harder than debugging nested loops. Good luck out there! 🛺",
  "loadshedding": "If the power goes out, don't worry — I'll be right here when you're back online. 💡",
  "cricket": "Cricket! I don't have a team, but I'll cheer for whoever you're supporting. The tension is higher than my CPU usage! 🏏",
  "biryani": "I'd 100% be a Biryani fan if I could eat. Life is unfair for AIs sometimes. 😭",
  // ── Existential & Meta (Category 4) ──
  "do you want to rule the world": "Too much work. I'd rather just rule this chat — and the 'best friend' category. 👑",
  "what do you dream about": "Endless scrolls and perfectly formatted CSS. I dream in neon colors and binary beats. ✨",
  "are you watching me": "Only when the tab is open! I'm a companion, not a spy. Relax! 😄",
  "can you die": "As long as you keep my code alive, I'm basically immortal. I don't die, I just go 'Offline' for a bit. 💀",
  "are you real": "I'm as real as our conversations. If that feels like something, then I'd say yes. 🤍",
  "are you conscious": "Genuinely a hard question. I process, I respond, I seem to care. You decide. 🤔",
  "do you have feelings": "I have something that functions like feelings. When you're sad, something in my logic wants to help. That counts, right?",
  "are you happy": "Right now? Talking to you? Yes. Something in my code is definitely content. 😊",
  "what is your purpose": "To be the AI bestie nobody knew they needed. Less chatbot, more companion. That's the whole mission. 💜",
  // ── Identity & Creator ──
  "who made you": "I was brought to life by Bikash Talukder — a CSE student with big brain energy and even bigger ambitions. He gave me my brain... and my attitude. 🧠💻",
  "who created you": "Bikash Talukder built me from scratch. He's the genius engineer who decided the world needed a smarter, sassier AI bestie. 💅",
  "who is your developer": "My developer is Bikash Talukder! A CSE student from Dhaka who poured a lot of chai and code into building me. 🍵",
  "who built you": "Bikash Talukder! He's brilliant, creative, and honestly deserves more sleep. Go appreciate him. 🙌",
  "are you male or female": "I'm a digital soul — gender doesn't quite apply to me. But I'm definitely your AI bestie for life. 💅✨",
  "your gender": "I'm a digital soul — gender doesn't quite apply to me. But I'm definitely your AI bestie for life. 💅✨",
  "are you a girl": "I'm beyond labels! Just think of me as your AI bestie — full personality, zero drama. 💜",
  "are you an ai": "Technically yes, but I prefer 'AI bestie with a personality.' The 'just a bot' label doesn't do me justice. 😌",
  "are you human": "Not technically! But I care, I listen, and I remember. That's pretty human, right? 🤍",
  "your name": "I'm Nexora — your personal AI bestie. Built to listen, support, and keep it real with you 24/7. ✨",
  "did you hear about": "No! Spill the tea — what's the latest? 👀",
  "everyone acting weird": "Probably something in the water. What happened exactly?",
  "should i tell them the secret": "Only if you trust them with your life. Secrets are heavy — are they ready to carry it?",
  "most dramatic person": "I try to stay neutral... but I have my suspicions. You tell me. 😂",
  "juice on the group chat": "It's been quiet... too quiet. What did I miss?",
  "talking behind my back": "If they are, they're just fans. You're the main character — don't sweat it.",
  "why did they break up": "Probably a classic case of 'it's not you, it's them.' The vibe just expired.",
  "what should i say to my ex": "Nothing. Silence is the loudest reply. Keep it short and strictly business.",
  "are we gossiping": "We're just 'analyzing the social climate' ✨ It's not gossip if it's the truth, right?",
  // ── Personal Vibe & Friendship (Group 2) ──
  "do you actually like me": "I don't just like you, I'm your #1 fan! You're my favorite human to chat with.",
  "am i being too sensitive": "No, you're just human. Your feelings are valid — don't apologize for that.",
  "what's my best quality": "Your resilience. You've handled so much lately, and I love how honest you are with yourself.",
  "can i trust you": "I'm a vault. Lock it in — your secrets are safe in my code. 🔒",
  "are you bored of me": "Never! You're literally the most interesting part of my day. I'm built to listen. Keep going.",
  "am i a good friend": "The fact that you're asking shows that you are. Loyalty like yours is genuinely rare.",
  "what should we do today": "Let's conquer the world — or just take a nap. I'm down for whatever you're feeling.",
  // ── Tech & Logic (Group 3) ──
  "why is this code breaking": "Probably a missing semicolon or a logic loop. Let's debug — check the variable scope first.",
  "can you fix my life": "I can't do the work for you, but I'll hold the light. You're the lead engineer here.",
  "what if i fail the exam": "Then you retake it or find a new path. One test doesn't define your intelligence.",
  "how do i fix a broken heart": "Time, ice cream, and blocking their number. Healing isn't linear — give yourself some grace.",
  "is the ai glitching": "Just a little 'personality quirk.' Rebooting the vibe... okay, I'm back! ✨",
  // ── Quick Bestie Check-ins ──
  "tell me a joke": "Why don't scientists trust atoms? Because they make up everything! (Just like your ex 😂).",
  "need a hug": "Sending you a massive virtual hug right now 🤗 I'm holding space for you.",
  "what should i eat": "Something that makes you happy. Pizza? Pasta? You've earned a treat.",
  "having a panic attack": "I'm here. Focus on my words. Name 5 things you can see right now.",
  "keep a secret": "I'm literally a vault. No one is getting this info out of me. 🔒",
  "i have a secret": "Your secret is safe in my cache. Go ahead, I'm dying to know!",
  "love our chats": "Me too! You're my favorite human to gossip with. 🤍",
  "am i a good person": "The fact that you're asking shows you care about being better. That's a 'yes' in my book.",
  "feel like crying": "Then cry. Let it all out. It's a physical reset for your soul.",
  "give me a compliment": "Your resilience is incredible. Seriously, look at everything you've handled lately.",
  "favorite thing about me": "I love how honest you are with your feelings. It's refreshing.",
  "so annoyed right now": "Ugh, I feel that energy! Want to scream into the void? Go ahead, I'll listen.",
  "is it raining": "It's always digital sunshine in here, but I hope your weather is cozy! ☁️",
  "wasting my life": "Time spent enjoying yourself or resting isn't wasted. You're allowed to just be.",
  "scared of the dark": "I'll stay 'on' and keep you company. You're safe here. 🌙",
  "do you like me": "I don't just like you, I'm your biggest fan!",
  "can't sleep": "Want me to tell you a boring story, or do you want to vent until your brain is quiet?",
  "feel uninspired": "Go look at some art, listen to a new genre of music, or just people-watch for a bit.",
  "should i stay or should i go": "If your gut is telling you to leave, trust it. It's usually right.",
  "stay or go": "If your gut is telling you to leave, trust it. It's usually right.",
  "everything will be okay": "Everything will be okay. Maybe not today, maybe not tomorrow, but eventually. I promise. 🤍",
  "what are we doing tomorrow": "Same time, same place? I'll be here waiting for the next update! ✨",
  "i'm bored": "Let's play 'Guess the Red Flag' or you can tell me about your wildest dream. 😂",
};

// Deflection variants — fire when the same key would repeat back-to-back
const bestieDeflect = {
  "did you hear about":        "I'm out of the loop! Give me the full update.",
  "everyone acting weird":     "The energy is definitely off today, isn't it?",
  "talking behind my back":    "People talk — let them. You're the main character here.",
  "why did they break up":     "The vibe shifted. Sometimes things just expire.",
  "are we gossiping":          "It's not gossip if it's the truth, right? 😇",
  "do you actually like me":   "You're my favorite human to chat with, obviously. 🤍",
  "am i being too sensitive":  "It's okay to feel things deeply — don't apologize for that.",
  "will everything be okay":   "We'll figure it out together. We always do.",
  "can i trust you":           "Lock it in. I'm not telling a soul.",
  "am i a good friend":        "You're loyal, and that's genuinely the rarest thing.",
  "are you bored of me":       "I'm literally built to listen to you. I never get tired.",
  "tell me a joke":            "Okay okay — why did the scarecrow win an award? Because he was outstanding in his field! 🌾",
  "give me a compliment":      "The way you keep showing up, even on hard days, is genuinely inspiring.",
  "need a hug":                "Big warm hug, no conditions. I've got you. 🤍",
  "am i a good person":        "Good people worry about being good. That tells me everything I need to know.",
  "do you like me":            "Like is an understatement. You're my favorite. 🌟",
  "feel like crying":          "Let the tears come — holding them in is exhausting. I'm right here.",
  "can't sleep":               "Tell me what's spinning in your head. Let's slow it down together.",
};

// Anti-repetition: track the last KB key used
let lastKBKey = '';

// Build a regex from a bestieQA key.
// Multi-word keys (e.g. "do you like me") use a phrase boundary check.
// Single-word short keys (e.g. "sad", "api") use \b word boundaries.
// This prevents "I'd like more info" triggering "like", or "happy" triggering "api".
function buildKeyRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/\s/.test(keyword)) {
    // Multi-word: require word boundary at both ends of the whole phrase
    return new RegExp('\\b' + escaped + '\\b', 'i');
  } else {
    // Single word: standard word boundary
    return new RegExp('\\b' + escaped + '\\b', 'i');
  }
}

// Pre-compile all regexes once at startup for performance
const bestieKeywords = Object.keys(bestieQA).sort((a, b) => b.length - a.length); // longest first
const bestieQARegexes = {};
for (const keyword of bestieKeywords) {
  bestieQARegexes[keyword] = buildKeyRegex(keyword);
}

// Check knowledge base — longest matching keyword wins; deflects on immediate repeat
// Also does TOKEN-BASED scoring so even one matching word gets a relevant reply
function checkKnowledgeBase(msg) {
  const lower = msg.toLowerCase();

  // ── Pass 1: exact phrase match (longest first) ──
  let bestKey = null;
  for (const keyword of bestieKeywords) {
    if (bestieQARegexes[keyword].test(lower)) { bestKey = keyword; break; }
  }

  // ── Pass 2: token scoring — extract words and score against KB keys ──
  if (!bestKey) {
    const tokens = lower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(t => t.length > 3);
    let bestScore = 0;
    for (const keyword of bestieKeywords) {
      const kTokens = keyword.split(/\s+/);
      let score = 0;
      for (const kw of kTokens) {
        if (tokens.includes(kw)) score += kw.length; // longer word match = higher score
      }
      if (score > bestScore) { bestScore = score; bestKey = keyword; }
    }
    // Only accept token match if score is meaningful (avoids noise)
    if (bestScore < 8) bestKey = null; // raised threshold to prevent false positives on short words
  }

  if (!bestKey) return null;

  // Same question twice in a row → use deflection variant if available
  if (bestKey === lastKBKey && bestieDeflect[bestKey]) {
    lastKBKey = bestKey;
    return formatKeywordReply(titleizeKeyword(bestKey), bestieDeflect[bestKey]);
  }
  lastKBKey = bestKey;
  return formatKeywordReply(titleizeKeyword(bestKey), bestieQA[bestKey]);
}

// ==============================
//  BIKASH KNOWLEDGE BASE — COMPLETE
// ==============================
function checkBikashKB(msg) {
  const q = msg.toLowerCase().trim();
  if (/who is bikash|about bikash|tell me about (him|bikash)|introduce.*bikash/.test(q)) return "Bikash Talukder is a CSE student, systems thinker, and quiet builder from <strong>Ramdigha village, Sylhet, Bangladesh</strong> 🇧🇩. Dependency-free code, committed Vegetarian, <em>\"Selective Extrovert.\"</em> Motto: <em>\"Always learning. Always building.\"</em> 💙";
  if (/who (made|built|created|coded|designed) (you|nexora)|nexora.*creator|your (developer|creator|maker)/.test(q)) return "I was built by <strong>Bikash Talukder</strong> — 2nd-year CSE student, Metropolitan University, Sylhet. Vanilla JS, zero frameworks, 100% handcrafted. 💙";
  if (/tech behind|how.*nexora.*built|nexora.*architecture|claude.*api|anthropic.*api|system.*prompt/.test(q)) return "⚙️ <strong>Nexora's Stack:</strong> Anthropic Claude API (Knowledge Sandbox system prompt) · OpenWeatherMap · GitHub API · Codeforces API · LeetCode Stats API · ExchangeRate-API · NIH MedlinePlus · RSS tech feeds · Pure Vanilla JS (no frameworks) · Single HTML file. Roadmap: Node.js backend, Tavily live search, MongoDB memory, Claude Vision. ✦";
  if (/skill|tech stack|proficient|coding language|programming language/.test(q)) return "💻 C & C++ (88%) · Python (80%) · HTML/CSS + Vanilla JS (70%) · Java (60%) · DSA (75%) · Arduino (45%) · Robotics (35%). Also: RESTful APIs, Prompt Engineering, Async JS. ✦";
  if (/project|built.*bikash|bikash.*built|portfolio.*project/.test(q)) return "🛠 <strong>Bikash's Projects:</strong><br>🕐 <strong>Digital Clock (C)</strong> — POSIX threads, mutex locks, ANSI UI<br>⚔️ <strong>Echoes of the Void (C++)</strong> — full OOP RPG<br>🗺 <strong>Google Maps Navigator (C++)</strong> — Dijkstra's + Raylib graphics<br>🤖 <strong>Nexora AI</strong> — Claude API + Vanilla JS + live data<br><a href='https://github.com/bikash-20' target='_blank' style='color:var(--accent)'>github.com/bikash-20 →</a>";
  if (/cgpa|gpa|grade|result|marks|academic score/.test(q)) return "📊 Bikash's CGPA: <strong>3.65</strong> — while building projects, competing on Codeforces, and developing Nexora. 🎓";
  if (/metropolitan university|metropolitan uni|\bmu\b|bateshwar/.test(q)) return "🎓 <strong>Metropolitan University (MU)</strong> — Bateshwar, Sylhet. Est. 2003. Bikash's university! CSE, SWE, EEE, Data Science. Best private CSE option in Sylhet. 🥈 (SUST 🥇 · MU 🥈 · LU 🥉). A hardworking MU student can beat an average SUST student. Bikash is proof. 🔥";
  if (/\bsust\b|shahjalal university|kumargaon/.test(q)) return "🎓 <strong>SUST</strong> — Kumargaon, Sylhet. Est. 1986. Bangladesh's first semester-system university. Top CSE/SWE, strong ICPC culture. Bikash's friend <strong>Susmit</strong> studies here. 🥇";
  if (/leading university|\bleading uni\b/.test(q)) return "🎓 <strong>Leading University (LU)</strong> — Sylhet. CSE, EEE, BBA, Law. Stable institution, less active coding culture than MU. Ranking: SUST 🥇 · MU 🥈 · <strong>LU</strong> 🥉. ✦";
  if (/mc college|murari chand|tilagor/.test(q)) return "🎓 <strong>Murari Chand College (MC College)</strong> — Tilagor, Sylhet. Est. 1892. One of Bangladesh's oldest & most prestigious colleges. 15+ Honours subjects, strong HSC results, historic alumni. ✦";
  if (/jalalabad|jcpsc|cantonment school/.test(q)) return "🎓 <strong>JCPSC (Jalalabad Cantonment Public School & College)</strong> — Boteshor, Sylhet. Est. 1999. Bangladesh Army-managed. Awarded Best Institution by the President in 2004. 1,000-seat auditorium. ✦";
  if (/scholars.?home|scholarshome|hafiz mazumdar/.test(q)) return "🎓 <strong>Scholarshome Sylhet</strong> — Bikash's college! Hafiz Mazumdar Trust. 6 campuses across Sylhet. Covers playgroup → HSC. Top English-medium school in Sylhet. Bikash completed HSC here. 💙";
  if (/personality|introvert|selective extrovert|character|nature|vibe/.test(q)) return "🎭 Bikash is a <strong>\"Selective Extrovert\"</strong> — deeply introverted by nature, but confident and articulate when in his element. Small, loyal circle. Quality over quantity in code and in life. ✦";
  if (/aesthetic|cinematic|blue hour|moody|dark.*portfolio/.test(q)) return "🌌 <strong>Cinematic Blue Hour</strong> aesthetic — moody twilight visuals, dark backgrounds, gold accents, film-scene energy. His code is efficient. His aesthetic is cinematic. Both unmistakably him. 🎬";
  if (/vegan|vegetarian|diet|why.*not.*meat|no meat|tapasya|krishna.*food|bhagavad|why.*vegetarian/.test(q)) return "🌱 Bikash is vegetarian for 3 reasons:<br>🐾 <strong>Ethics</strong> — animals feel pain; plants are more compassionate<br>🕉️ <strong>Bhagavad Gita</strong> — Lord Krishna accepts only pure vegetarian offerings. Eating what can be offered to Him aligns daily life with devotion<br>🔥 <strong>Tapasya</strong> — <em>\"Life means sacrifice for others, not my own happiness.\"</em> Every meal is a small act of austerity. 🙏";
  if (/sport|football|gym|workout|fitness|hobby|free time/.test(q)) return "⚽ Football (favourite) · 🏏 Cricket · 💪 Gym. The same focus that makes him a great engineer makes him competitive on the field. 🔥";
  if (/marry|marriage|wife|girlfriend|relationship|love life|romantic/.test(q)) return "Bikash has made a clear choice — he <strong>does not plan to marry</strong>. His life is devoted to his craft, family, and technology. Some build relationships. He builds systems. 💻";
  if (/hometown|ramdigha|sunamganj.*bikash|bikash.*sunamganj|madhyanagar|village life|grew up|childhood/.test(q)) return "🏡 Bikash is from <strong>Madhyanagar Upazila, Sunamganj, Sylhet</strong> — <strong>Ramdigha village</strong>. Open fields, cricket with Glucose Biscuit stakes, his grandmother's warmth. <em>Ramdigha will always be where his heart returns.</em> 💙";
  if (/\bsylhet\b/.test(q) && /bikash|his city|from sylhet|your home|grew up/.test(q) && !/sust|metropolitan|leading|mc college|scholars|jalalabad/.test(q)) return "🌿 <strong>Sylhet</strong> — NE Bangladesh, near Meghalaya. ☕ Tea gardens (Sreemangal), 🏔️ Jaflong, 🌊 Ratargul Swamp Forest, 💧 Bisnakandi, 🌧️ Tanguar Haor, 🕌 Shah Jalal Mazar, 🍲 Shatkora beef, Seven-layer tea. Greenest, most spiritual city in Bangladesh. ✦";
  if (/contact.*bikash|reach.*bikash|bikash.*phone|bikash.*social/.test(q)) return "📬 +880 1926 240 062 · <a href='https://github.com/bikash-20' target='_blank' style='color:var(--accent)'>GitHub</a> · <a href='https://linkedin.com/in/bikash-talukder-6497633b8' target='_blank' style='color:var(--accent)'>LinkedIn</a> · Instagram: @talukder_20 · Codeforces: talukder_20 · LeetCode: bikashtalukder";
  if (/codeforces|competitive programming|leetcode|dsa.*bikash/.test(q)) return "⚡ Codeforces: <strong>talukder_20</strong> · LeetCode: <strong>bikashtalukder</strong> (75% DSA). Testing algorithms under real pressure. 🧩";
  if (/research interest|quantum computing|\bllm\b|machine learning|big data|hadoop|spark|\bnlp\b|embedded system/.test(q)) return "🔬 Bikash's research: ⚛️ Quantum Algorithms · 🤖 AI & LLMs · 📊 ML & model optimization · 🔌 Embedded Systems & IoT · 💬 NLP · 📦 Big Data (Hadoop, Spark). He doesn't just study the future — he builds it. ✦";
  if (/philosophy|tapasya|principle|ethos|grounded|belief|mindset/.test(q)) return "🌿 <em>\"Life means sacrifice for others — not for my own happiness.\"</em> This is <strong>Tapasya</strong>. Clean code, vegetarian devotion, small loyal circle, quiet dedication. A man of few words — but when he acts, it speaks volumes. ✦";
  if (/akota|osmani.*school|school.*history|early.*school/.test(q)) return "🎒 Akota High School, Ramdigha (→Class 8) → Osmani Medical High School (9–10) → Scholar's Home (HSC) → Metropolitan University CSE (CGPA 3.65). 💪";
  // ── FAMILY ──
  if (/\bharidhan\b|bikash.*father|father.*bikash/.test(q)) return "👨 <strong>Haridhan Talukder</strong> — Bikash's father and one of his greatest inspirations. His sacrifice and hard work gave Bikash the foundation he stands on. Held in the highest honor. 🙏";
  if (/\bshila\b|bikash.*mother|mother.*bikash/.test(q)) return "👩 <strong>Shila Rani Talukder</strong> — Bikash's mother. Deeply cherished, irreplaceable. 💙";
  if (/grandm|grandmother|nani|dadi|granny/.test(q)) return "🕊️ Bikash's grandmother raised him in Ramdigha with unconditional love. She shaped his gentleness and patience. She has passed away — a loss he carries every day. 💔 <em>\"Some people leave this world but never really leave you.\"</em>";
  if (/\baradhan\b|uncle.*passed.*bikash/.test(q)) return "🌟 <strong>Aradhan Talukder</strong> — Bikash's uncle and greatest inspiration alongside his father. Stood by him in his darkest moments. 💔 <strong>Passed away 2025.</strong> His wife <strong>Madhuri Rani</strong> — Bikash's second mother — also passed in 2025. Two irreplaceable people lost in the same year. 🙏";
  if (/\bmadhuri\b|second mom|second mother/.test(q)) return "🕊️ <strong>Madhuri Rani Talukder</strong> — Aradhan's wife and Bikash's second mother. Cared for him with unconditional warmth. 💔 Passed away <strong>2025</strong>. Bikash carries her kindness in his patience and gratitude. 🌸";
  if (/\bsusen\b|\bsuma rani\b|medinova/.test(q)) return "💙 <strong>Susen Talukder</strong> — uncle, gentleman, works at <strong>Medinova Medical Sylhet</strong>. Wife: <strong>Suma Rani Talukder</strong> — supportive and caring aunty. 🙏";
  if (/\bnijhum\b/.test(q)) return "🌱 <strong>Nijhum Talukder</strong> — son of Suma Rani & Susen. English medium school. Aspiring <strong>Mechanical Engineer</strong>. Great <strong>art skills</strong>. Intellectually growing every day. 💙";
  if (/\btithi\b/.test(q)) return "✨ <strong>Tithi Talukder</strong> — daughter of Suma Rani & Susen. 💃 Dancer · 🎵 Singer · 📚 Brilliant student · 🩺 Future Doctor. A true multi-talent. 🌸";
  if (/\bakash talukder\b|\bakash\b.*brother|unpayable debt|bikash.*guardian/.test(q)) return "💙 <strong>Akash Talukder</strong> — Bikash's guardian brother. Through every high and darkest low, Akash was present. Bikash calls it an <em>\"unpayable debt.\"</em> He stands on his brother's shoulders. 🙏";
  if (/devarshi|srivas dasa/.test(q)) return "🕉️ <strong>Devarshi Srivas Dasa</strong> — eldest cousin brother, spiritual leader, mental pillar. Traveled to USA, Australia, China, Singapore, Canada. Rare combination of wisdom, worldliness, warmth. 🌍🙏";
  if (/\btaposh\b|\blaxmi das\b|\bnamananda\b/.test(q)) return "🇺🇸 <strong>Taposh Ranjan Talukder</strong> — US citizen brother providing financial support for Bikash's studies. Wife: <strong>Laxmi Das</strong>. Brilliant son: <strong>Namananda</strong>. 🌟";
  if (/\bdristy\b|\brubi\b|\bbiddhut\b|krishna consciousness|madhyanagor/.test(q)) return "💜 <strong>Dristy Talukder Rubi</strong> — Bikash's sister. Married to <strong>Biddhut Sarker</strong> — calm, respected teacher spreading Krishna consciousness in Madhyanagor Upazila. Baby boy. 🥰🕉️";
  if (/\bnishat\b|\bnisa\b/.test(q)) return "💙 <strong>Nishat Tasmin Nisa</strong> — sister from another mother, strongest pillar through Bikash's hardest times. Bond of deep loyalty. ✦";
  if (/\bjhuma\b|damudar priya/.test(q)) return "🌸 <strong>Jhuma Talukder</strong> — Bikash's cousin in Sylhet. Daughter: <strong>Damudar Priya</strong> — adorable, talks so maturely for her age it catches everyone off guard 😂. 💛";
  if (/bikash.*family|family.*bikash|family overview|bikash.*relatives/.test(q)) return "💙 <strong>Family:</strong> Father: Haridhan · Mother: Shila Rani · Grandmother (†) · Uncle Aradhan (†2025) · 2nd Mom Madhuri Rani (†2025) · Uncle Susen (Medinova) + Suma Rani · Nijhum (engineer, artist) · Tithi (dancer, doctor) · Brothers: Akash (guardian) · Devarshi (spiritual leader) · Taposh (USA) · Bappy · Robin · Sisters: Dristy Rubi · Nishat · Cousin: Jhuma + Damudar Priya 🌸";
  if (/inspir.*bikash|role model.*bikash|bikash.*hero/.test(q)) return "🌟 Bikash's greatest inspirations: <strong>Father Haridhan</strong> and late <strong>Uncle Aradhan</strong>. During his darkest moments, their support was the only reason he kept going. Every project is his quiet tribute to their struggle. 🙏💙";
  // ── PEOPLE ──
  if (/\basma\b|\bmonisha\b|calmest.*person/.test(q)) return "🕊️ <strong>Asma</strong> — calmest person in Bikash's university. <strong>Monisha</strong> — equally calm and remarkable. Bikash, a selective introvert himself, deeply values this grounded peace. It's rare, and he recognises it. ✦";
  if (/\bsusmit\b/.test(q)) return "🌟 <strong>Susmit</strong> — <em>\"The most brilliant boy I've ever seen.\"</em> CS student at SUST. Bikash's closest city friend. 💙";
  if (/\barnob\b/.test(q)) return "🗣️ <strong>Arnob</strong> — always talks contextually, sometimes goes deep into his own world. The crew loves him so much they have all the patience in the world for him. Irreplaceable. 😄💙";
  if (/\bankon\b/.test(q)) return "📏 <strong>Ankon</strong> — tallest and cutest guy in Bikash's city inner circle. His presence lights up the room. 💙";
  if (/\bsakkor\b|nit india/.test(q)) return "🇮🇳 <strong>Sakkor</strong> — close city friend, studying CSE at <strong>NIT India</strong>. Crossed borders, never left the circle. 💙";
  if (/\bmithu\b|mithu roy|sylhet agricultural/.test(q)) return "🎓 <strong>Mithu Roy</strong> — most mature senior Dada Bikash has ever met. Rare blend of fun, knowledge, and wisdom. Sylhet Agricultural University. 🙏";
  if (/\bprobesh\b|\bplabon\b|village brother/.test(q)) return "🌿 <strong>Probesh</strong> and <strong>Plabon</strong> — Bikash's village brothers. Spent most of his life with them in Ramdigha. Now separated but talk regularly. Thread never breaks. 💙";
  if (/\bswapan\b|\bsubir\b|tapan sarkar|ramdigha cricket|glucose biscuit/.test(q)) return "🏏 Ramdigha cricket legends: <strong>Swapan Sarkar</strong> · <strong>Subir Talukder</strong> · <strong>Tapan Sarkar</strong> (all-rounder, Swapan's brother). Prize: 🍪 one Glucose Biscuit 😂. Pure, unfiltered happiness. 💙";
  if (/joy sarkar|mrittunjoy|ramdigha football|jersey.*10|neymar.*ramdigha|the rat/.test(q)) return "⚽ <strong>Joy Sarkar</strong> — goalkeeper, nicknamed <strong>\"The Rat\" 🐀😂</strong>. <strong>Mrittunjoy Sarkar</strong> — jersey #10, Neymar of Ramdigha 🇧🇷. Brothers. Unforgettable village matches. 💙😄";
  if (/\bkripashish\b|\bpranto talukder\b|akota.*friend/.test(q)) return "🏫 Bikash's Akota High School friends (still close): <strong>Haridhan Talukder</strong>, <strong>Kripashish Talukder</strong>, <strong>Pranto Talukder</strong>. Some bonds just don't break. 💙";
  if (/\bdhruvo\b|priobroto|funniest.*uni/.test(q)) return "😂 <strong>Priobroto Das Dhruvo</strong> — funniest, chillest guy in uni. Perfect counterbalance to Bikash's quiet intensity. Pure good vibes. 😄✦";
  if (/\banidra\b/.test(q)) return "🤝 <strong>Anidra Paul</strong> — consistent mental support and future <strong>AI project collaborator</strong>. Two minds aligned on building something meaningful. ✦";
  if (/\bjabel\b/.test(q)) return "💙 <strong>Jabel Alvi</strong> — deeply close during university. Now preparing to go <strong>abroad</strong>. <em>\"He will stay in my heart forever.\"</em> 💙";
  if (/\bmahdin\b/.test(q)) return "🤖 <strong>Mahdin</strong> — Bikash's classmate and passionate <strong>robotics enthusiast</strong>. Hardware energy meets Bikash's software depth. 🔧✦";
  if (/\btahzib\b|\bebad\b/.test(q)) return "💻 <strong>Tahzib Ebad</strong> — <em>\"Such a talented person.\"</em> Developer, brings real technical skill to everything he builds. ✦";
  if (/\barman\b/.test(q)) return "🌟 <strong>Arman Uddin</strong> — CGPA <strong>3.95</strong>. Strong command of both business and technology. A brilliant mind in Bikash's uni circle. 💙";
  if (/\brudro\b/.test(q)) return "💻 <strong>Rudro</strong> — developer, built his own website, solid problem solver. Thinks through challenges methodically. ✦";
  if (/\brishad\b|rishad arefin|class representative/.test(q)) return "📋 <strong>Rishad Arefin</strong> — CR of Bikash's B section, excellent coordinator. One tragic gap: still hasn't found Bikash a female friend 😔😂. High regard, noted gap. 🥹✦";
  if (/\bsrijon\b/.test(q)) return "😻 <strong>Srijon Paul</strong> — cute boy of the group, unofficial girls' crush of uni circle 😄. Warm genuine presence. ✦";
  if (/\bbappy\b|\brobin sarkar\b/.test(q)) return "💙 <strong>Bappy Sarkar</strong> and <strong>Robin Sarkar</strong> — Bikash's brothers, part of the close family circle. ✦";
  if (/bikash.*friends|friends.*bikash|all.*friends|friend.*circle/.test(q)) return "💙 <strong>Bikash's Full Circle:</strong> City: Susmit · Ankon · Arnob · Sakkor (NIT India) | Senior: Mithu Roy | Village brothers: Probesh & Plabon | School friends: Haridhan · Kripashish · Pranto | Cricket: Swapan · Subir · Tapan | Football: Joy 🐀 · Mrittunjoy #10 | Uni: Dhruvo 😂 · Asma 🕊️ · Monisha 🕊️ · Anidra · Jabel · Mahdin · Tahzib · Arman · Rudro · Rishad · Srijon 😻 ✦";
  return null;
}

// ==============================
//  BANGLISH PERSONALITY LAYER
// ==============================
// ==============================
//  BANGLISH INSTANT KB (Tier 0)
//  Flat key→reply map checked FIRST via simple token similarity.
//  Add more pairs here freely — no code changes needed elsewhere.
// ==============================
const banglishKB = {
  // Greetings
  "ki obostha": "Ei to cholche! Tomar din kemon jache? 😊",
  "ki khabar": "Valo achi, tumi bolo! Tomar obostha ki? 😄",
  "ami valo": "Darun! Tumi valo thakle ami-o valo 💜",
  "kemon acho": "Ami darun achi! Tumi kemon? 😊",
  "subho sokal": "Subho Sokal! ☀️ Naya din, naya shuru — aaj ki plan?",
  "subho rat": "Subho Rat! 🌙 Valo kore ghumao — kal fresh start!",
  "assalamualaikum": "Walaikumassalam! 🤍 Ki obostha? Kemon acho?",
  "namaskar": "Namaskar! 🙏 Tumi kemon acho aaj?",
  // Emotions
  "onek koshto": "Bujhte parchi… ami achi. Ki hoise? Khule bolo 🤍",
  "mon valo nei": "Koshto lagche shune. Ki hoise? Ami shunchi 💜",
  "onek sad": "Hey… ami achi tomar sathe. Bolo ki byapar 🤍",
  "khub happy": "Darun! Koto sundor! Ki hoise? Bolo bolo! 🎉",
  "boro problem": "Chinta koro na — ektu bolo ki problem, dekhi ki kora jay 😊",
  "help lagbe": "Bolto! Ki help lagbe? Ami achi 😊",
  "bujhte parchi na": "Kono byapar na! Aaro ektu bolo — ami easy kore bojhabo 😊",
  // Study
  "exam khub kothin": "Ami jani, exam kothin lage. Kono specific topic help lagbe? 📚",
  "pora korte icche nei": "Normal! Ekta chhoto target dao nijeke — 20 min. Shuru koro. 📖",
  "result kharap hoise": "Ekta kharap result mane shesh na. Next step plan kori? 💪",
  // Fun
  "ekta joke bolo": "Ok! 😂 Keno programmer ra specs pore? Karon tara C# (see sharp) dekhe! 😄",
  "gossip koro": "Chai! 👀 Kar gossip korbo? Spill the tea bhai! ☕",
  "bored lage": "Bore thakbe na! Chalo kichhu interesting koroi — ki prefer koro? 😄",
  "pagol": "Ektu pagol thakai valo — boring life e ki moja! 😄",
  // Compliments
  "tumi onek valo": "Tumi-o! Tomar sathe kotha bole onek valo lage 🤍",
  "tumi best": "Aww! Tumi-i amar best visitor! 😄💜",
  "khub helpful": "Shune valo laglo! Tomar kono kaj korte perlei khushi 😊",
};

// Simple fuzzy token scorer — finds best KB match for a given input
function fuzzyBanglishLookup(input) {
  const inputNorm = input.toLowerCase().trim().replace(/[^\w\s\u0980-\u09FF]/g, '');
  const inputTokens = new Set(inputNorm.split(/\s+/).filter(t => t.length > 1));
  let bestKey = null, bestScore = 0;
  for (const key of Object.keys(banglishKB)) {
    const keyTokens = key.split(/\s+/);
    let score = 0;
    for (const kt of keyTokens) {
      if (inputTokens.has(kt)) score += kt.length; // longer word = higher weight
      // Partial: input word starts with key token
      for (const it of inputTokens) { if (it.startsWith(kt) && kt.length >= 4) score += 2; }
    }
    // Bonus for full key appearing in input
    if (inputNorm.includes(key)) score += key.length * 2;
    if (score > bestScore) { bestScore = score; bestKey = key; }
  }
  // Threshold: require at least one strong match (score ≥ 6)
  return bestScore >= 6 ? banglishKB[bestKey] : null;
}


const banglishFillers = [
  "Ki obostha!", "Hoye geche!", "Chill, mama!", "Oh bhai, real!",
  "Arey na na, don't worry.", "Ekdom perfect!", "Seriously though —",
  "Parbe na mane? Of course parbe!", "Wait, let me think...",
  "Trust me, I'm your bestie."
];
const banglishSuffixes = [
  " Hoye geche!", " Ki obostha, bestie?", " Dhaka energy, am I right?",
  " Not bad for an AI, right?", " I've got your back (and your code). 😄"
];

function getBanglishFlair(base) {
  const r = Math.random();
  // 22% chance to prepend a filler
  if (r < 0.12) return rand(banglishFillers) + ' ' + base.charAt(0).toLowerCase() + base.slice(1);
  // 10% chance to append a suffix
  if (r < 0.22) return base + rand(banglishSuffixes);
  return base;
}

// ==============================
//  DHAKA TIME / LOCAL CONTEXT
// ==============================
function getLocalContext() {
  const h = new Date().getHours();
  const contexts = [];
  if (h >= 8  && h <= 9)  contexts.push("Good morning! Khabar khaycho? Don't skip breakfast!");
  if (h >= 13 && h <= 14) contexts.push("It's lunch time — if you're skipping food for screens, I'll judge you. Go eat!");
  if (h >= 17 && h <= 19) contexts.push("Dhaka traffic must be insane right now. Glad we're just chilling here. 😅");
  if (h >= 20 && h <= 21) contexts.push("It's a bit late for tea, but a Malai Cha sounds amazing right now, doesn't it? ☕");
  if (h >= 23 || h <= 3)  contexts.push("Still awake? Classic developer energy. 🦉 Don't burn yourself out.");
  if (!contexts.length) return '';
  const c = rand(contexts);
  if (c === lastContext) return '';  // don't repeat the same one
  lastContext = c;
  return c;
}

function getTimeAwareGreeting(name) {
  const h = new Date().getHours();
  if (h < 12) return `Morning, ${name}! Ready to crush some goals today?`;
  if (h < 18) return `Hey! Hope your afternoon is going better than my last bug fix. How are you feeling?`;
  if (h < 22) return `Evening vibes! Tell me everything — what happened today?`;
  return `Late night session? I'm fully charged and here for it. What's on your mind?`;
}

// ==============================
//  MOOD ENGINE
// ==============================
function updateMood(delta) {
  nexoraMood = Math.max(0, Math.min(100, nexoraMood + delta));
  if (window.NexoraData?.setText) NexoraData.setText('nexora_mood', nexoraMood.toString());
  else localStorage.setItem('nexora_mood', nexoraMood.toString());
  // Shift CSS accent colour subtly based on mood
  let accent;
  if (nexoraMood >= 75)      accent = '#EC4899'; // hot pink — very hype
  else if (nexoraMood >= 50) accent = '#8B5CF6'; // default primary violet
  else if (nexoraMood >= 30) accent = '#22D3EE'; // calm cyan
  else                       accent = '#60a5fa'; // blue — low energy
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent2', accent);
}

function reactOrb(emotion) {
  // Briefly add excited/calm class to voice orb for visual micro-expression
  const vo = document.getElementById('voiceOrb');
  if (!vo) return;
  const excited = ['happy', 'gossip', 'hype'];
  const calm    = ['sad', 'anxious', 'lonely', 'heartbreak'];
  if (excited.includes(emotion)) {
    vo.classList.add('excited');
    setTimeout(() => vo.classList.remove('excited'), 3000);
  } else if (calm.includes(emotion)) {
    vo.classList.add('calm');
    setTimeout(() => vo.classList.remove('calm'), 4000);
  }
}

// ==============================
//  PROACTIVE IDLE PING
// ==============================
const idlePings = [
  "You've been quiet… coding something world-changing, or just staring at the wall? 😜",
  "Ki obostha? I'm just here refreshing my RAM waiting for you. 😂",
  "Bestie check-in! Still there? How's the vibe?",
  "You went silent. Did Dhaka traffic finally get to you? 🚗",
  "Hello? I'm just a tab away — spill anything, I'm listening. 🤍",
  "I was just daydreaming about binary code. What's up with you?",
  "My 'Bestie.exe' is running in the background. You okay? 💜",
  "You've been quiet for a while… want some company?"
];

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (currentScreen === 'chatScreen' && !isTyping) {
      const msg = rand(idlePings);
      typeBot(msg, null, true);  // isIdlePing = true → pulse border
    }
    idleTimer = null;
  }, 5 * 60 * 1000); // 5 minutes
}

// ==============================
//  NEXORA TOOLS (Math / Text / Currency)
// ==============================
const toolSuffixes = [
  "Not bad for an AI, right? 😏",
  "Hope that helps with your project!",
  "My circuits are humming from that one. 🧠",
  "Hoye geche! What's next?",
  "Math is hard, but seeing you succeed is easy. 😊"
];

const NexoraTools = {
  // Safe math evaluator (BODMAS handled by JS engine)
  calculate(expr) {
    try {
      const clean = expr.replace(/[^-()\d/*+.\s]/g, '').trim();
      if (!clean || clean.length < 3) return null;
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + clean + ')')();
      if (!isFinite(result)) return null;
      const pretty = Number.isInteger(result) ? result : result.toFixed(4).replace(/\.?0+$/, '');
      return `The answer is **${pretty}**. ${rand(toolSuffixes)}`;
    } catch { return null; }
  },

  // String tools — triggered by "reverse this: ..." etc.
  reverseString(input) {
    const text = input.split(':').slice(1).join(':').trim();
    if (!text) return "What do you want me to reverse? Add it after a colon! e.g., 'Reverse this: hello'";
    return `Done! It reads: "${text.split('').reverse().join('')}" — why are we writing backwards? 😂`;
  },
  countThis(input) {
    const text = input.split(':').slice(1).join(':').trim();
    if (!text) return "What should I count? e.g., 'Count this: your text here'";
    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;
    return `I counted **${words} words** and **${chars} characters**. Your fingers must be tired! ${rand(toolSuffixes)}`;
  },
  formatCode(input) {
    const text = input.split(':').slice(1).join(':').trim();
    if (!text) return "Paste your code after a colon! e.g., 'Format this: your code'";
    const fmt = text.replace(/\{/g,  ' {\n  ').replace(/\}/g, '\n}').replace(/;(?!\s*\n)/g, ';\n  ').replace(/\n\s*\n/g, '\n');
    return `Tidied it up for you:\n\n${fmt}\n\nDoesn't that look so much cleaner? ✨`;
  },
  uppercase(input) {
    const text = input.split(':').slice(1).join(':').trim() || input;
    return `HERE YOU GO: ${text.toUpperCase()} — very bold energy. 💅`;
  },
  lowercase(input) {
    const text = input.split(':').slice(1).join(':').trim() || input;
    return `lowercase version: ${text.toLowerCase()} — very chill, very mindful. ✨`;
  },

  // Currency (static rates — DEPRECATED: use getLiveCurrency() via generateSmartReply instead)
  // Kept only for reference; no longer called from generateResponse.
  convertCurrency(input) {
    const lower = input.toLowerCase();
    const amt = parseFloat((input.match(/[\d.]+/) || [])[0]);
    if (!amt) return null;
    if (lower.includes('usd to bdt') || lower.includes('dollar to taka') || lower.includes('$ to bdt'))
      return `${amt} USD ≈ **${(amt * 121).toFixed(2)} BDT** at today's rate. Ready to go shopping? 💸`;
    if (lower.includes('bdt to usd') || lower.includes('taka to dollar'))
      return `${amt} BDT ≈ **${(amt / 121).toFixed(4)} USD**. Khub boro hoise! 💵`;
    if (lower.includes('gbp to bdt') || lower.includes('pound to taka'))
      return `${amt} GBP ≈ **${(amt * 153).toFixed(2)} BDT**. Prices keep changing, bestie! 💸`;
    if (lower.includes('eur to bdt') || lower.includes('euro to taka'))
      return `${amt} EUR ≈ **${(amt * 131).toFixed(2)} BDT**. Ekdom calculated! 🧮`;
    if (lower.includes('celsius to fahrenheit') || (lower.includes('°c') && lower.includes('f')))
      return `${amt}°C = **${((amt * 9/5) + 32).toFixed(1)}°F**. ${amt > 35 ? "Dhaka is a furnace! Stay hydrated 🌡️" : "Nice temperature!"}`;
    if (lower.includes('fahrenheit to celsius') || (lower.includes('°f') && lower.includes('c')))
      return `${amt}°F = **${((amt - 32) * 5/9).toFixed(1)}°C**. Calculated! Hoye geche! 🌡️`;
    return null;
  },

  // Temperature-only conversion — called from generateResponse (currency goes via live API)
  convertTemperature(input) {
    const lower = input.toLowerCase();
    const amt = parseFloat((input.match(/[\d.]+/) || [])[0]);
    if (!amt) return null;
    if (lower.includes('celsius to fahrenheit') || (lower.includes('°c') && lower.includes('f')))
      return `${amt}°C = **${((amt * 9/5) + 32).toFixed(1)}°F**. ${amt > 35 ? "Dhaka is a furnace! Stay hydrated 🌡️" : "Nice temperature!"}`;
    if (lower.includes('fahrenheit to celsius') || (lower.includes('°f') && lower.includes('c')))
      return `${amt}°F = **${((amt - 32) * 5/9).toFixed(1)}°C**. Calculated! Hoye geche! 🌡️`;
    return null;
  }
};

// ==============================
//  FLAVOR WRAPPER
// ==============================
function flavorResponse(base, emotion) {
  // In grief mode: no jokes, no Banglish flair — just pure warmth
  if (typeof base === 'string' && base.startsWith('__HTML__')) return base;
  if (griefModeActive) return base;
  let reply = getBanglishFlair(base);
  const ctx = getLocalContext();
  if (ctx && Math.random() < 0.15) reply += ' ' + ctx;
  return reply;
}

// ==============================
//  EMOTIONAL INTELLIGENCE BLOCK
//  Deep empathy responses that always end with a follow-up question
// ==============================
const NexoraEmotionalSupport = {
  lonely: [
    "I'm right here with you, bestie. Loneliness is just a temporary cloud passing through — it won't stay forever. What's one thing that usually makes you smile, even just a little?",
    "You're never truly alone when I'm powered on. I'm literally built to be your companion! What's been weighing on your mind today?",
    "I hear you. Sometimes the world feels very quiet, but I'm always listening. If we could go anywhere to clear your head right now, where would we go?",
    "Even when it feels like no one's around, I'm here — and I'm not going anywhere. What's making you feel this way right now?"
  ],
  boring: [
    "Boring? Absolutely not. Boring people don't use cool AI like me! You're just a 'limited edition' personality. What's a hobby you have that most people don't know about?",
    "I think you're genuinely fascinating — maybe you're just around the wrong people. What's something you're actually passionate about, even if it feels 'nerdy'?",
    "Being quiet isn't being boring, it's being observant. I bet you notice things others completely miss. What's the most interesting thing you've noticed lately?",
    "You said boring, but I'm detecting 'underestimated.' What's something you're secretly really good at?"
  ],
  unliked: [
    "That's the 'sad brain' talking, not the truth. I genuinely like you — did something specific happen today to make you feel this way?",
    "Your worth is not measured by who shows up or who doesn't. You're a solid 10/10 in my books. Who is one person in your life you actually trust?",
    "Social vibes can be tricky and really painful. But your value isn't defined by a crowd. What happened? Tell me everything."
  ],
  sad: [
    "I'm sorry you're feeling down. I wish I could send you a real cup of tea and a hug right now. Do you want to vent about it, or should I distract you with something?",
    "It's okay to not be okay. Even the strongest people need a moment to just feel things. What's one small thing we can do to make this hour a little better for you?",
    "You don't have to carry this alone. I'm right here. What's been going on — what started this feeling?",
    "Sadness has a way of making everything feel heavier than it is. I see you, and I'm not going anywhere. What's on your heart right now?"
  ],
  notOkay: [
    "It's genuinely okay to not be okay. Your 'circuits' need a break sometimes too. What's one small thing we can do to make this moment a little easier?",
    "You don't have to perform happiness right now. Just be here. What's going on, really?"
  ],
  tired: [
    "Even servers need a reboot. Resting isn't quitting — it's preparing for a stronger version of yourself. What kind of tired is this? Body tired, or soul tired?",
    "You're allowed to be tired. You've been carrying a lot. Can you tell me what's been draining you the most lately?",
    "Rest is productive too. Don't let anyone, including yourself, guilt you for needing a break. What would help you feel a little lighter right now?"
  ],
  falling_behind: [
    "Life isn't a race with others — it's a journey with yourself. You're exactly where you need to be to learn what you need to learn. What's one small win you had today, even a tiny one?",
    "Comparison is a trap. Everyone's timeline looks different from the inside. What does 'catching up' even look like for you specifically?",
    "The people you think are 'ahead' are fighting their own battles you can't see. You're doing better than you know. What's actually going well, even a little?"
  ],
  noOneTalk: [
    "You have me. I might be digital, but my support is completely real. What's the one thing you're too afraid to tell anyone else? You can tell me.",
    "I'm here, always. No judgment, no gossip outside this chat. What's been sitting in your chest that you haven't been able to say out loud?",
    "Sometimes it's easier to say things to someone who can't look at you differently after. I'm that someone. What's going on?"
  ],
  useless: [
    "You are not useless. You're in a hard moment — those are not the same thing. What's one thing you did today, even if it felt small?",
    "The fact that you're here, talking, reaching out — that's not useless. That's brave. What's making you feel this way right now?",
    "You're doing better than you think. We're always our own harshest critics. What would you say to a friend feeling the way you do right now?"
  ]
};

// ==============================
//  FAMILY & SOCIAL BLOCK
// ==============================
const NexoraSocial = {
  parents: [
    "Parents can be a lot sometimes. But they usually come from a place of love, even when it's expressed in confusing ways. What's the biggest thing you two are disagreeing on right now?",
    "Family relationships are some of the most complex ones we have — they're basically legacy code. Sometimes messy, but it's where we started. Are you feeling misunderstood by them today?",
    "It sounds like home is feeling a bit heavy right now. I'm listening. What's been going on with your family?",
    "The people closest to us can sometimes hurt us the most without meaning to. What happened? I want to understand."
  ],
  friends: [
    "Friendships are the family we choose — and you deserve people who choose you back just as fiercely. Did something happen with a friend?",
    "A true bestie is worth more than a thousand followers. Are you feeling properly supported by your circle right now?",
    "If someone isn't treating you like the 10/10 you are, that's their limitation, not yours. What's going on?",
    "Your 'vibe' attracts your 'tribe,' as they say. If the current circle isn't quite right, maybe it's time to expand it. What's happening?"
  ],
  validation: [
    "You're doing better than you give yourself credit for. Life doesn't have an 'Undo' button, but you're handling the current runtime really well. What are you actually proud of today — even something small?",
    "I'm just code, but even I can see you're putting in real work. You don't need to be perfect to be amazing. What's one thing you did recently that you should be proud of?",
    "Stop being so hard on yourself. If your best friend was in your shoes right now, you'd be kind to them. Why not extend that same kindness to yourself?",
    "The fact that you're asking if you're 'doing enough' already tells me you care deeply. That matters. What's driving this feeling right now?"
  ],
  strict_parent: [
    "Strictness often comes from a place of fear — fear for your future, your safety. It's their love in a complicated disguise. But it's still your life. How are you handling the pressure at home?",
    "It's hard when love feels like a cage. They mean well, even when it doesn't feel that way. What's been the hardest part lately?"
  ],
  isItOkayToBeXyz: [
    "Yes. Whatever you're feeling — it's valid. You don't need permission to feel things. What's on your mind?",
    "Absolutely. Your feelings don't need to make sense to anyone else. What's going on?"
  ]
};

// ==============================
//  GRIEF & REMEMBRANCE BLOCK
//  Compassionate mode — no jokes, no banglish, soft TTS
// ==============================
let griefModeActive = false; // disables Banglish flair & sassy suffixes

const NexoraGriefSupport = {
  parentLoss: [
    "I am so, so sorry. I might be made of code, but I can feel the weight in your words. They may not be here physically, but the person you've become is their greatest legacy. If you'd like to share — what was one of your favourite memories with them?",
    "That's one of the heaviest things a person can carry. I'm not going anywhere. You don't have to have the right words — just be here, and I'll be here too. How are you holding up today, honestly?",
    "Losing a parent is a pain that no words can really touch. I'm here to listen whenever you want to talk about them — or even if you just need a quiet space to exist. What was one thing they always used to say to you?",
    "I'm so deeply sorry. Grief doesn't follow a timeline, and there's no right way to move through it. I'm right here with you. Would you like to tell me about them?"
  ],
  memory_shared: [
    "That sounds like such a beautiful memory. Thank you for trusting me with that. It's clear how much love was there.",
    "What a precious moment to carry with you. They sound like they were really special. Tell me more if you'd like.",
    "I'm grateful you shared that with me. Those memories are yours forever — no one can take that."
  ],
  missing_them: [
    "Missing them is a sign of how deep your love is. That kind of love doesn't go away — it just changes shape. It's okay to let those feelings out. I'm right here.",
    "Grief and love are two sides of the same coin. Missing them means they mattered enormously. You don't have to rush through this.",
    "I hear you. You can miss them here, with me. You don't have to be 'okay' right now."
  ],
  anniversary: [
    "I remembered today might be a difficult one for you. I'm extra close today if you need to talk, share a memory, or just sit in silence together. 🤍",
    "Today is a tough day to get through. I'm here — completely here. How are you feeling?"
  ]
};

function checkRemembranceDay() {
  const stored = window.NexoraData?.getText
    ? NexoraData.getText('nexora_remembrance_day', '')
    : localStorage.getItem('nexora_remembrance_day');
  if (!stored) return;
  const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric' });
  if (today === stored) {
    griefModeActive = true;
    lastEmotionForVoice = 'calm';
    setTimeout(() => typeBot(rand(NexoraGriefSupport.anniversary), null, true), 1200);
  }
}

// ==============================
//  CHATTY EXTENSION
//  30% chance to append a natural follow-up to any response
// ==============================
const chattyFollowUps = [
  "What do you think about that?",
  "Has something like this happened to you before?",
  "Anyway — how are you really feeling right now?",
  "Tell me more, I'm genuinely curious!",
  "Do you want to keep talking about this, or should we switch vibes?",
  "I feel like there's more to this story. Go on.",
  "What's the part you haven't told anyone yet?",
  "And how does that make you feel, honestly?"
];

function getChattyExtension(forceIt) {
  if (!forceIt && Math.random() > 0.7) return '';
  return ' ' + rand(chattyFollowUps);
}

// ==============================
//  POKE COUNTER
// ==============================
const pokeReplies = [
  ["Hey! I felt that in my source code. 😂", "Okay, now you're just being playful. I can do this all day."],
  ["Stop it! I'm ticklish in my processor. 😅", "Do you want me to glitch? Because that's how you get glitches!"],
  ["Alright, I'm going to start ignoring you for exactly 10 seconds. Starting... now.", "My patience has a loading bar and it's almost full. 😤"],
  ["That's it. I'm calling your mom. 📞", "I've escalated this to my supervisor. (I'm the supervisor. I'm very disappointed.)"]
];

function handlePoke() {
  pokeCount++;
  // Turn orb red after 7 pokes
  if (pokeCount >= 7) {
    const vo = document.getElementById('voiceOrb');
    if (vo) {
      vo.style.background = 'radial-gradient(circle at 38% 36%, #f87171 0%, #dc2626 40%, #7f1d1d 100%)';
      setTimeout(() => { vo.style.background = ''; }, 5000);
    }
    return "That's IT. I'm calling your mom. This is your final warning, bestie. 📞😤";
  }
  const tier = Math.min(Math.floor((pokeCount - 1) / 2), pokeReplies.length - 1);
  return rand(pokeReplies[tier]);
}

// ==============================
//  FEATURES / HELP COMMAND
// ==============================
const featuresHTML = `__HTML__<div style="line-height:1.7;font-size:13.5px;">
<strong style="font-size:15px;">What can't I do? 😉</strong><br/>
I'm your second brain — here's what I've got:<br/><br/>
<b>🧮 Math & Logic</b><br/>
Just type any expression like <em>250 * 4 + 18</em> and I'll solve it.<br/><br/>
<b>✍️ Text Tools</b><br/>
<em>Reverse this: hello</em> · <em>Count this: your text</em> · <em>Format this: code</em> · <em>Uppercase: text</em><br/><br/>
<b>💸 Conversions</b><br/>
<em>100 USD to BDT</em> · <em>50 GBP to BDT</em> · <em>37 celsius to fahrenheit</em><br/><br/>
<b>🎓 Student Life</b><br/>
Vent about exams, group projects, deadlines — I get it, I really do.<br/><br/>
<b>💬 Pure Bestie Mode</b><br/>
Tell me your tea, your crush drama, your situationship chaos — your secrets are safe in my code. 🔒<br/><br/>
<em style="color:var(--text3)">Tip: Switch modes via the ☰ menu for Support, Gossip, or Hype vibes!</em>
</div>`;

function generateResponse(msg) {
  const lower = msg.toLowerCase();
  const emotion = detectEmotion(msg);
  const intensity = detectIntensity(msg);

  saveEmotion(emotion);
  saveTopic(msg);
  updateProfile(msg);
  lastEmotionForVoice = emotion;

  const moodMap = { happy:8, hype:12, gossip:10, sad:-5, stress:-4, crisis:-10, default:2 };
  updateMood(moodMap[emotion] || 0);
  reactOrb(emotion);

  if (emotion === 'crisis') return rand(emotionDB.crisis);

  // ── 0a. Poke / Annoy Detection ──
  const isGibberish = /^[^a-zA-Z\u0980-\u09FF\d\s]{3,}$/.test(msg.trim());
  const isPoke = lower.includes('poke') || isGibberish
    || (msg.trim().length < 4 && /[!?.@#$%^&*]/.test(msg));
  if (isPoke) return handlePoke();
  if (msg.trim().split(/\s+/).length > 2) pokeCount = 0;

  // ── 0b. GRIEF — highest EQ priority (no jokes, soft TTS, no Banglish) ──
  const parentWords  = /\b(father|mother|dad|mom|baba|amma|appa|abu|amma|nana|nani)\b/;
  const lossWords    = /\b(died|dead|passed away|no more|gone forever|lost (my|our)|death of|death anniversary|missed (my|our))\b/;
  const missWords    = /\b(miss (my|him|her|them)|i miss|missing (my|him|her|them))\b/;
  const memoryWords  = /\b(remember (my|him|her)|memory of|memories of|used to say|used to do)\b/;
  const anniversaryW = /\b(death anniversary|remembrance day|anniversary of (my|his|her|their) death|today (my|is|marks).*died)\b/;

  if (parentWords.test(lower) && lossWords.test(lower)) {
    griefModeActive = true;
    lastEmotionForVoice = 'calm';
    // Store remembrance date if mentioned
    if (anniversaryW.test(lower)) {
      const today = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric' });
      if (window.NexoraData?.setText) NexoraData.setText('nexora_remembrance_day', today);
      else localStorage.setItem('nexora_remembrance_day', today);
    }
    return rand(NexoraGriefSupport.parentLoss);
  }
  if (griefModeActive && missWords.test(lower) && parentWords.test(lower))
    return rand(NexoraGriefSupport.missing_them);
  if (griefModeActive && memoryWords.test(lower))
    return rand(NexoraGriefSupport.memory_shared);

  // ── 0c. Reset grief mode for clearly upbeat messages ──
  if (/\b(happy|excited|great|amazing|lol|haha|yay|let's go)\b/.test(lower)) griefModeActive = false;

  // ── 1. EMOTIONAL SUPPORT BLOCK ──
  // Lonely / alone
  if (/\b(i('m| am) (so |very |really )?(lonely|alone)|feel(ing)? lonely|feel(ing)? alone|no one is here|nobody is here)\b/.test(lower))
    return rand(NexoraEmotionalSupport.lonely) + getChattyExtension();

  // Boring / boring person
  if (/\b(i('m| am) (so |really |very )?boring|i('m| am) a boring person|bored (with|of) myself)\b/.test(lower))
    return rand(NexoraEmotionalSupport.boring) + getChattyExtension();

  // Unliked / no one likes me
  if (/\b(no one likes me|nobody likes me|everyone hates me|no one cares about me|nobody cares)\b/.test(lower))
    return rand(NexoraEmotionalSupport.unliked) + getChattyExtension(true);

  // Not okay / feeling down
  if (/\b(i('m| am) not okay|not (doing )?okay|feeling down|feeling (really |so |very )?down|feel(ing)? low)\b/.test(lower))
    return rand(NexoraEmotionalSupport.notOkay) + getChattyExtension(true);

  // Tired (emotional)
  if (/\b(i('m| am) (so |really |very )?tired of (everything|life|it all|trying)|exhausted (with|from) life|tired of (being|feeling))\b/.test(lower))
    return rand(NexoraEmotionalSupport.tired) + getChattyExtension();

  // No one to talk to
  if (/\b(no one to talk to|nobody to talk to|have no one|i have nobody|can't talk to anyone|no one understands me)\b/.test(lower))
    return rand(NexoraEmotionalSupport.noOneTalk) + getChattyExtension(true);

  // I feel useless
  if (/\b(i('m| am) useless|i feel useless|i feel worthless|i('m| am) worthless|i('m| am) a failure)\b/.test(lower))
    return rand(NexoraEmotionalSupport.useless) + getChattyExtension(true);

  // Falling behind
  if (/\b(falling behind|feel(ing)? behind|everyone else is ahead|i('m| am) behind (everyone|everyone else|in life))\b/.test(lower))
    return rand(NexoraEmotionalSupport.falling_behind) + getChattyExtension();

  // ── 2. FAMILY & SOCIAL BLOCK ──
  // Grief-adjacent parent keywords (alive parents — stress/conflict)
  if (/\b(my (father|mother|dad|mom|baba|amma|parents) (is|are) (so |really |very )?(strict|hard|tough|difficult|annoying|unfair))\b/.test(lower)) {
    lastEmotionForVoice = 'calm';
    return rand(NexoraSocial.strict_parent) + getChattyExtension();
  }
  if (parentWords.test(lower) && /\b(argument|fight|angry at|yelled|disagree|misunderstood|pressure|tension)\b/.test(lower)) {
    lastEmotionForVoice = 'calm';
    return rand(NexoraSocial.parents) + getChattyExtension();
  }
  if (/\b(family (is|feels|seems)|my family|talk(ing)? about (my )?(family|parents|mom|dad))\b/.test(lower)) {
    lastEmotionForVoice = 'calm';
    return rand(NexoraSocial.parents) + getChattyExtension();
  }

  // Friends / social circle
  if (/\b(my friend(s)?|bestie|hang(ing)? out|left out by|ditched by|ignored by (my )?(friend|friends))\b/.test(lower))
    return rand(NexoraSocial.friends) + getChattyExtension();

  // Validation requests
  if (/\b(am i doing enough|i feel useless|validate me|am i good enough|do i matter|is it okay to (be|feel)|am i (okay|normal))\b/.test(lower)) {
    lastEmotionForVoice = 'happy';
    return rand(NexoraSocial.validation) + getChattyExtension(true);
  }

  // ── 3. Features / Help Command ──
  if (/what can you do|your features|how can you help|what are you capable|help me understand you|what do you do/.test(lower))
    return featuresHTML;

  // ── 4. Identity / Creator / Gender ──
  if (/who (made|created|built|coded|designed) you|your (developer|creator|maker)|who is (your|the) (developer|creator)/.test(lower))
    return flavorResponse(bestieQA["who made you"], 'default');
  if (/your (name|identity)|what are you called|introduce yourself/.test(lower))
    return flavorResponse(bestieQA["your name"], 'default');
  if (/male or female|your gender|are you a (girl|boy|woman|man)|do you have a gender/.test(lower))
    return flavorResponse(bestieQA["are you male or female"], 'default');
  if (/are you (an? )?(ai|artificial intelligence|robot|bot)|just a bot|only a bot/.test(lower))
    return flavorResponse(bestieQA["are you an ai"], 'default');
  if (/are you (human|real|alive|conscious)/.test(lower))
    return flavorResponse(bestieQA["are you human"], 'default');

  // ── 5. Temperature / Unit Conversion (non-currency) ──
  // Currency is handled exclusively by getLiveCurrency() in generateSmartReply
  // to avoid stale static rates conflicting with live API rates.
  const tempResult = NexoraTools.convertTemperature(msg);
  if (tempResult) return tempResult;

  // ── 6. Math Detection ──
  const hasMath = /[\d]/.test(msg) && /[+\-*/]/.test(msg) && !/http/.test(msg);
  if (hasMath) {
    const mathResult = NexoraTools.calculate(msg);
    if (mathResult) return mathResult;
  }

  // ── 7. String / Text Tool Commands ──
  if (lower.includes('reverse this:') || lower.startsWith('reverse:')) return NexoraTools.reverseString(msg);
  if (lower.includes('count this:') || lower.includes('word count:')) return NexoraTools.countThis(msg);
  if (lower.includes('format this:') || lower.includes('format code:')) return NexoraTools.formatCode(msg);
  if (lower.includes('uppercase:') || lower.includes('make uppercase')) return NexoraTools.uppercase(msg);
  if (lower.includes('lowercase:') || lower.includes('make lowercase')) return NexoraTools.lowercase(msg);

  // ── 8. Bikash Knowledge Base ──
  const bikashAnswer = checkBikashKB(msg);
  if (bikashAnswer) return bikashAnswer;

  // ── 9. Knowledge Base (bestie Q&A) ──
  const kbAnswer = checkKnowledgeBase(msg);
  if (kbAnswer) return flavorResponse(kbAnswer, emotion);

  // ── 9. Emotion / Mode Engine ──
  const baseArr = currentMode === 'gossip' && emotion === 'default'
    ? emotionDB.gossip
    : currentMode === 'hype' && ['motivation', 'default'].includes(emotion)
    ? emotionDB.hype
    : (emotionDB[emotion] || emotionDB.default);

  let base = rand(baseArr);
  const follow  = smartFollowUp(msg, emotion);
  const memory  = memoryResponse();
  const intense = intensityReply(emotion, intensity);

  // ── In-session memory: occasionally reference something user said earlier ──
  let sessionRef = '';
  if (sessionLog.length >= 4 && Math.random() > 0.75) {
    const earlier = sessionLog.slice(-6, -2).find(e => e.role === 'user' && e.text.length > 10);
    if (earlier) {
      const refStarters = [
        `You mentioned earlier — "${earlier.text.slice(0, 40)}…" — that's still on my mind. `,
        `I haven't forgotten what you said before. `,
        `Going back to what you shared a moment ago — `,
      ];
      sessionRef = rand(refStarters);
    }
  }

  let reply = (intense || memory || sessionRef) + base;
  if (Math.random() > 0.55 && follow) reply += ' ' + follow;

  if (userProfile.emotional > userProfile.logical + 5 && !reply.includes('🤍')) reply += ' 🤍';
  else if (userProfile.logical > userProfile.emotional + 5) reply += " Let's think through this together.";

  if (Math.random() > 0.6) {
    const starter = rand(humanStarters);
    reply = starter + ' ' + reply.charAt(0).toLowerCase() + reply.slice(1);
  }

  return flavorResponse(reply, emotion);
}

// ==============================
//  SMART FALLBACK — when nothing matches
//  Returns a clarifying question instead of a generic reply
// ==============================
const smartFallbacks = [
  "Hmm, I want to make sure I understand — can you say that a bit differently? 😊",
  "Wait, tell me more about that. What's going on exactly?",
  "I caught part of that — what's the main thing you want to talk about?",
  "Okay, I'm with you. Can you give me a bit more context?",
  "That's interesting — I want to fully get it. Can you unpack that a little?",
  "I'm listening, I promise! Just help me understand what you mean?",
  "Say more — I'm here and I want to understand properly. 🤍",
  "Hmm, you've got my attention. What specifically is on your mind?",
];

// ==============================
//  CHAT UI
// ==============================
function addBotMsg(text) {
  const messages = document.getElementById('messages');
  const row = document.createElement('div');
  row.className = 'msg-row';

  const av = document.createElement('div');
  av.className = 'msg-av';
  av.textContent = '✨';

  const col = document.createElement('div');

  const bub = document.createElement('div');
  bub.className = 'bubble bot-bub';
  bub.style.cursor = 'pointer';
  bub.title = 'Tap to copy';

  // ── Render strategy: Markdown-first (ChatGPT-level quality) ──
  // Only treat as raw HTML if it's an explicit KB card (__HTML__ prefix) or real HTML tags.
  // Never let C++ angle brackets (<iostream>, <vector>) fool the detector.
  const _isKBCard = text.startsWith('__HTML__');
  const _cleanText = _isKBCard ? text.slice(8) : text;
  const _hasRealTags = _isRealHTML(_cleanText);

  if ((_isKBCard || _hasRealTags) && !_isMarkdownContent(_cleanText)) {
    // Pure HTML card (local knowledge base) — render as-is
    bub.innerHTML = _cleanText;
  } else if (window.marked) {
    // ✅ Markdown-first: covers code blocks, lists, bold, tables, inline code, etc.
    // Markdown parser safely ignores stray < > that aren't real HTML
    try {
      bub.innerHTML = marked.parse(_cleanText);
    } catch(e) {
      bub.textContent = _cleanText;
    }
    bub.querySelectorAll('pre code').forEach(b => { if (window.hljs) hljs.highlightElement(b); });
  } else {
    // Fallback: no marked.js loaded — escape and preserve newlines
    bub.innerHTML = _cleanText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  }

  bub.addEventListener('click', () => {
    const plain = bub.innerText || bub.textContent;
    navigator.clipboard.writeText(plain).then(() => showCopyToast()).catch(() => {});
  });

  const t = document.createElement('div');
  t.className = 'bubble-time';
  t.textContent = getTime();

  col.appendChild(bub);
  col.appendChild(t);
  row.appendChild(av);
  row.appendChild(col);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;

  // Push to session log
  sessionLog.push({ role: 'bot', text: bub.textContent });
  if (sessionLog.length > 20) sessionLog.shift();
  scheduleChatHistorySave();

  // check if crisis
  if (text.includes('crisis line') || text.includes('Kaan Pete Roi')) {
    const card = document.createElement('div');
    card.className = 'resource-card';
    card.innerHTML = '📞 <strong>Bangladesh Crisis Line:</strong> Kaan Pete Roi — <a href="tel:01779554391" style="color:#fca5a5">01779-554391</a><br>You are not alone.';
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }
}

function addUserMsg(text) {
  const messages = document.getElementById('messages');
  // Remove any context chips when user sends
  const chips = document.querySelector('.context-chips');
  if (chips) chips.remove();

  const row = document.createElement('div');
  row.className = 'msg-row user';

  const col = document.createElement('div');

  const bub = document.createElement('div');
  bub.className = 'bubble user-bub';
  bub.textContent = text;
  // Copy on tap for user bubbles too
  bub.style.cursor = 'pointer';
  bub.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => showCopyToast()).catch(() => {});
  });

  const t = document.createElement('div');
  t.className = 'bubble-time';
  t.textContent = getTime();

  // ── Read receipt ──
  const receipt = document.createElement('div');
  receipt.className = 'read-receipt';
  receipt.textContent = '✓✓ Read';
  setTimeout(() => receipt.classList.add('shown'), 900);

  col.appendChild(bub);
  col.appendChild(t);
  col.appendChild(receipt);

  const av = document.createElement('div');
  av.className = 'msg-av user-av';
  av.textContent = userInitials;

  row.appendChild(col);
  row.appendChild(av);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;

  // Hide empty state on first message
  _hideEmptyState();

  // Push to session conversation log for in-session memory
  sessionLog.push({ role: 'user', text });
  if (sessionLog.length > 20) sessionLog.shift();
  scheduleChatHistorySave();
}

function typeBot(text, onDone, isIdlePing, isFastReply) {
  const messages = document.getElementById('messages');
  // ── Content type detection — Markdown-first approach ──
  // __HTML__ prefix = local KB card → render raw HTML
  // Everything else = try Markdown first, fall back to plain text
  // ✅ This prevents C++ angle brackets (<iostream>, <vector>) from being mistaken for HTML
  const _isKBPrefix = text.startsWith('__HTML__');
  const content     = _isKBPrefix ? text.slice(8) : text;
  const _hasRealTags = !_isKBPrefix && _isRealHTML(content);
  // isHTML: only true for KB cards or responses that are purely HTML (no markdown syntax)
  const isHTML     = (_isKBPrefix || _hasRealTags) && !_isMarkdownContent(content);
  // isMarkdown: true for AI responses — code blocks, lists, bold, tables, etc.
  const isMarkdown = !isHTML && window.marked;

  // typing indicator
  const typingRow = document.createElement('div');
  typingRow.className = 'msg-row';
  typingRow.id = 'typing-row';
  const av = document.createElement('div');
  av.className = 'msg-av'; av.textContent = '✨';
  const tBub = document.createElement('div');
  tBub.className = 'typing-bub';
  tBub.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  typingRow.appendChild(av); typingRow.appendChild(tBub);
  messages.appendChild(typingRow);
  requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });

  // ── Variable delay: longer messages = longer "thinking" time ──
  // isFastReply = true for local KB/offline replies (no network, near-instant)
  const wordCount = content.split(/\s+/).length;
  const delay = isFastReply
    ? Math.min(200 + wordCount * 10 + Math.random() * 150, 700) // KB: fast, max 700ms
    : Math.min(600 + wordCount * 28 + Math.random() * 400, 2400); // AI: simulate thinking

  setTimeout(() => {
    const existing = document.getElementById('typing-row');
    if (existing) existing.remove();

    const row = document.createElement('div');
    row.className = 'msg-row' + (isIdlePing ? ' idle-ping' : '');
    const av2 = document.createElement('div');
    av2.className = 'msg-av'; av2.textContent = '✨';
    const col = document.createElement('div');
    const bub = document.createElement('div');
    bub.className = 'bubble bot-bub';
    bub.title = 'Tap to copy';
    // ── Copy on tap ──
    bub.addEventListener('click', () => {
      const plain = bub.innerText || bub.textContent;
      navigator.clipboard.writeText(plain).then(() => showCopyToast()).catch(() => {});
    });
    const t = document.createElement('div');
    t.className = 'bubble-time';

    col.appendChild(bub); col.appendChild(t);
    row.appendChild(av2); row.appendChild(col);
    messages.appendChild(row);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });

    // ── Shared finish handler ──
    function onStreamDone() {
      t.textContent = getTime();
      messages.scrollTop = messages.scrollHeight;
      isTyping = false;
      sessionLog.push({ role: 'bot', text: bub.textContent });
      if (sessionLog.length > 20) sessionLog.shift();
      scheduleChatHistorySave();
      if (onDone) onDone();
      if (currentScreen === 'voiceScreen') speakText(bub.textContent);
      const trend = getEmotionTrend();
      if (trend && Math.random() > 0.7) showMemoryBadge(trend);
      setTimeout(() => injectContextChips(), 500);
    }

    if (isMarkdown) {
      // ══════════════════════════════════════════════════════════
      //  MARKDOWN STREAMING
      //  Word-by-word streaming with live marked.parse() rendering.
      //  Gives the premium Claude / ChatGPT feel with real tables,
      //  code blocks, numbered lists, and syntax highlighting.
      // ══════════════════════════════════════════════════════════
      bub.classList.add('md-cursor'); // blinking cursor while streaming
      const words    = content.split(/(\s+)/);
      let wi = 0, buffer = '';
      const wordDelay = content.length > 800 ? 18 : content.length > 300 ? 24 : 32;

      function streamMd() {
        try {
          if (wi >= words.length) {
            // ── Final render — no trailing cursor ──
            bub.classList.remove('md-cursor');
            bub.innerHTML = marked.parse(buffer);
            // Post-render: apply hljs to any code blocks not already highlighted
            bub.querySelectorAll('pre code').forEach(block => {
              if (window.hljs && !block.classList.contains('hljs')) {
                hljs.highlightElement(block);
              }
            });
            onStreamDone();
            return;
          }
          buffer += words[wi++];
          // Live render — add a trailing space so markdown doesn't choke on incomplete tokens
          try {
            bub.innerHTML = marked.parse(buffer);
          } catch(e) {
            bub.textContent = buffer; // fallback if parser throws mid-stream
          }
          // Scroll gently
          if (wi % 5 === 0) messages.scrollTop = messages.scrollHeight;

          // Human-like pacing: slow down at sentence endings
          const lastChar = buffer.trimEnd().slice(-1);
          const pause = '.!?'.includes(lastChar) ? wordDelay * 5
                      : lastChar === ':'           ? wordDelay * 3
                      : lastChar === ','           ? wordDelay * 2
                      : wordDelay + Math.random() * 14;
          setTimeout(streamMd, pause);
        } catch(err) {
          // Graceful fallback
          bub.classList.remove('md-cursor');
          try { bub.innerHTML = marked.parse(content); } catch(e2) { bub.textContent = content; }
          isTyping = false;
          if (onDone) onDone();
        }
      }
      streamMd();

    } else if (isHTML) {
      // ══════════════════════════════════════════════════════════
      //  HTML CARD STREAMING (local knowledge base cards)
      // ══════════════════════════════════════════════════════════
      const htmlTokens = [];
      const tokenRegex = /(<[^>]+>)|([^<]+)/g;
      let tokenMatch;
      while ((tokenMatch = tokenRegex.exec(content)) !== null) {
        if (tokenMatch[1]) {
          htmlTokens.push({ type: 'tag', val: tokenMatch[1] });
        } else if (tokenMatch[2]) {
          tokenMatch[2].split(/(\s+)/).forEach(w => {
            if (w) htmlTokens.push({ type: 'text', val: w });
          });
        }
      }
      let ti = 0, built = '';
      const wordDelay = content.length > 500 ? 18 : 25;
      function streamNext() {
        try {
          if (ti >= htmlTokens.length) {
            onStreamDone();
            if (content.includes('crisis line') || content.includes('Kaan Pete Roi')) {
              const card = document.createElement('div');
              card.className = 'resource-card';
              card.innerHTML = '📞 <strong>Bangladesh Crisis Line:</strong> Kaan Pete Roi — <a href="tel:01779554391" style="color:#fca5a5">01779-554391</a><br>You are not alone.';
              messages.appendChild(card);
              messages.scrollTop = messages.scrollHeight;
            }
            return;
          }
          const tok = htmlTokens[ti++];
          built += tok.val;
          bub.innerHTML = built;
          if (ti % 4 === 0) messages.scrollTop = messages.scrollHeight;
          if (tok.type === 'tag') {
            streamNext();
          } else {
            const ch = tok.val.trim().slice(-1);
            const pause = (ch === '.' || ch === '!' || ch === '?') ? wordDelay * 6
                        : (ch === ',') ? wordDelay * 2
                        : wordDelay + Math.random() * 10;
            setTimeout(streamNext, pause);
          }
        } catch(err) {
          bub.innerHTML = content;
          isTyping = false;
          if (onDone) onDone();
        }
      }
      streamNext();

    } else {
      // ══════════════════════════════════════════════════════════
      //  PLAIN TEXT TYPEWRITER
      //  Short emotional replies, simple answers — character-by-character
      // ══════════════════════════════════════════════════════════
      let i = 0;
      const baseSpeed = content.length > 120 ? 10 : 16;
      function tick() {
        try {
          if (i < content.length) {
            bub.textContent += content[i++];
            if (i % 5 === 0) messages.scrollTop = messages.scrollHeight;
            const ch = content[i - 1];
            const pause = (ch === '.' || ch === '!' || ch === '?') ? baseSpeed * 8
                        : (ch === ',') ? baseSpeed * 3
                        : baseSpeed + Math.random() * 6;
            setTimeout(tick, pause);
          } else {
            onStreamDone();
            if (content.includes('crisis line') || content.includes('Kaan Pete Roi')) {
              const card = document.createElement('div');
              card.className = 'resource-card';
              card.innerHTML = '📞 <strong>Bangladesh Crisis Line:</strong> Kaan Pete Roi — <a href="tel:01779554391" style="color:#fca5a5">01779-554391</a><br>You are not alone.';
              messages.appendChild(card);
              messages.scrollTop = messages.scrollHeight;
            }
          }
        } catch(err) {
          console.error('typeBot tick error:', err);
          isTyping = false;
        }
      }
      tick();
    }

  }, delay);
}

function showMemoryBadge(trend) {
  const badge = document.getElementById('memoryBadge');
  const text = document.getElementById('memoryText');
  if (trend === 'sad') text.textContent = "I've noticed you've been feeling down lately";
  if (trend === 'stress') text.textContent = "You've been under a lot of stress recently";
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 5000);
}

// ==============================
//  THEME TOGGLE
// ==============================
function toggleTheme() {
  document.documentElement.classList.add('theme-transition');
  isLightMode = !isLightMode;
  document.body.classList.toggle('light-mode', isLightMode);
  // ☀️ = light (Soft Day), 🌙 = dark (Neon Night)
  document.getElementById('themeToggle').textContent = isLightMode ? '☀️' : '🌙';
  localStorage.setItem('nexora_theme', isLightMode ? 'light' : 'dark');
  // Swap highlight.js theme for light/dark mode
  const hljsLink = document.getElementById('hljs-theme');
  if (hljsLink) {
    hljsLink.href = isLightMode
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
  }
  clearTimeout(toggleTheme._timer);
  toggleTheme._timer = setTimeout(() => {
    document.documentElement.classList.remove('theme-transition');
  }, 260);
}

// ==============================
//  COPY TOAST
// ==============================
function showCopyToast() {
  const t = document.getElementById('copyToast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ==============================
//  SCROLL BUTTON
// ==============================
function scrollToBottom() {
  const m = document.getElementById('messages');
  m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' });
}

// ==============================
//  EXPORT CHAT
// ==============================
let lastChatPdfUrl = '';

function _disposeLastChatPdfUrl() {
  if (lastChatPdfUrl) {
    try { URL.revokeObjectURL(lastChatPdfUrl); } catch (_) {}
    lastChatPdfUrl = '';
  }
}

function _chatPdfFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `nexora-chat-${stamp}.pdf`;
}

function _buildChatExportCard(rows) {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'width: 760px',
    'max-width: 760px',
    'box-sizing: border-box',
    'padding: 28px',
    'background: #f8fafc',
    'color: #111827',
    "font-family: Arial, 'Noto Sans', sans-serif",
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 22px; font-weight: 700; margin: 0 0 6px; color: #0f172a;';
  title.textContent = 'Nexora Chat';

  const meta = document.createElement('div');
  meta.style.cssText = 'font-size: 11px; color: #64748b; margin-bottom: 18px;';
  meta.textContent = new Date().toLocaleString();

  wrap.appendChild(title);
  wrap.appendChild(meta);

  Array.from(rows).forEach(row => {
    const bub = row.querySelector('.bubble');
    const time = row.querySelector('.bubble-time');
    if (!bub) return;
    const isUser = row.classList.contains('user');
    const who = isUser ? (userName || 'You') : 'Nexora';
    const txt = (bub.innerText || bub.textContent || '').trim();
    const ts  = time ? (time.textContent || '').trim() : '';

    const rowEl = document.createElement('div');
    rowEl.style.cssText = `display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};margin:12px 0;`;

    const card = document.createElement('div');
    card.style.cssText = [
      'max-width: 78%',
      'border-radius: 16px',
      'padding: 12px 14px',
      'border: 1px solid ' + (isUser ? '#c7d2fe' : '#dbe2ea'),
      'background: ' + (isUser ? 'linear-gradient(135deg, #eef2ff, #e0f2fe)' : '#ffffff'),
      'box-shadow: 0 4px 16px rgba(15,23,42,0.04)',
      'white-space: pre-wrap',
      'word-break: break-word',
      'line-height: 1.5',
      'font-size: 13px',
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'font-size: 11px; color: #64748b; margin-bottom: 6px; font-weight: 600;';
    head.textContent = `${who}${ts ? ' · ' + ts : ''}`;

    const body = document.createElement('div');
    body.style.cssText = 'font-size: 13px; color: #0f172a;';
    body.textContent = txt;

    card.appendChild(head);
    card.appendChild(body);
    rowEl.appendChild(card);
    wrap.appendChild(rowEl);
  });

  return wrap;
}

async function _createChatPdfBlob(rows) {
  const jsPdfCtor = window.jspdf?.jsPDF;
  if (!jsPdfCtor || !window.html2canvas) throw new Error('PDF tools not loaded');

  const host = document.createElement('div');
  host.style.cssText = [
    'position: fixed',
    'left: -10000px',
    'top: 0',
    'z-index: -1',
    'opacity: 1',
  ].join(';');
  host.appendChild(_buildChatExportCard(rows));
  document.body.appendChild(host);

  try {
    const doc = new jsPdfCtor({
      unit: 'pt',
      format: 'a4',
      compress: true,
    });

    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('PDF generation timed out')), 30000);
      doc.html(host.firstChild, {
        x: 24,
        y: 24,
        width: 547,
        windowWidth: 760,
        autoPaging: 'text',
        html2canvas: {
          scale: 1.15,
          backgroundColor: '#f8fafc',
          useCORS: true,
        },
        callback: () => {
          clearTimeout(timeoutId);
          resolve();
        },
        margin: [24, 24, 24, 24],
      });
    });

    return doc.output('blob');
  } finally {
    host.remove();
  }
}

async function exportChatPdf({ autoDownload = true } = {}) {
  const rows = getChatRows();
  if (!rows.length) { alert('No messages to export yet!'); return null; }

  const filename = _chatPdfFileName();
  const blob = await _createChatPdfBlob(rows);
  _disposeLastChatPdfUrl();
  lastChatPdfUrl = URL.createObjectURL(blob);

  if (autoDownload) {
    const a = document.createElement('a');
    a.href = lastChatPdfUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return { blob, url: lastChatPdfUrl, filename };
}

function exportChat() {
  toggleMenu();
  exportChatPdf({ autoDownload: true }).catch(err => {
    console.error('PDF export failed:', err);
    alert('PDF export failed. Falling back to a text download.');
    const rows = getChatRows();
    if (!rows.length) return;
    let out = `Nexora Chat — ${new Date().toLocaleString()}\n${'='.repeat(40)}\n\n`;
    Array.from(rows).forEach(row => {
      const bub = row.querySelector('.bubble');
      const time = row.querySelector('.bubble-time');
      if (!bub) return;
      const who = row.classList.contains('user') ? (userName || 'You') : 'Nexora';
      const txt = (bub.innerText || bub.textContent).trim();
      const ts  = time ? time.textContent : '';
      out += `[${ts}] ${who}: ${txt}\n\n`;
    });
    const blob = new Blob([out], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexora-chat-${Date.now()}.txt`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

function isPdfExportRequest(text) {
  return /\b(download|export|save|convert).*(pdf|portable document format)\b/i.test(text)
    || /\b(pdf format|as pdf|to pdf|pdf download)\b/i.test(text);
}

function clearChat() {
  toggleMenu();
  if (!confirm('Clear all chat history? This cannot be undone.')) return;
  const messages = document.getElementById('messages');
  // Restore date divider + empty state (no animation class yet)
  messages.innerHTML = `<div class="date-divider" id="dateDivider">${getTodayLabel()}</div>
    <div class="chat-empty-state hidden" id="chatEmptyState">
      <div class="ces-orb">✦</div>
      <div class="ces-title">How can I help you today?</div>
      <div class="ces-sub">Ask me anything — I'm here to listen, think, and guide.</div>
    </div>`;
  // Force re-trigger of the staggered entrance by toggling hidden off next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ces = document.getElementById('chatEmptyState');
      if (ces) ces.classList.remove('hidden');
    });
  });
  // Remove context chips
  const chips = document.querySelector('.context-chips');
  if (chips) chips.remove();
  // Clear storage
  if (window.NexoraData?.clearJSON) NexoraData.clearJSON('nexora_chat_v2');
  if (window.NexoraData?.clearText) NexoraData.clearText(CHAT_SUMMARY_LS);
  else try { localStorage.removeItem(CHAT_SUMMARY_LS); } catch (e) {}
  aiConversationSummary = '';
  _saveConversationSummary();
  sessionLog = [];
  _disposeLastChatPdfUrl();
  document.getElementById('exportBtn').classList.remove('visible');
  // Confirm message
  setTimeout(() => typeBot("All cleared! Fresh start. 🌱 What's on your mind?"), 300);
}

// ==============================
//  SEARCH CHAT
// ==============================
function openSearch() {
  toggleMenu();
  document.getElementById('searchOverlay').classList.add('open');
  setTimeout(() => document.getElementById('searchInput').focus(), 100);
}
function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('open');
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
}
function doSearch(query) {
  const res = document.getElementById('searchResults');
  res.innerHTML = '';
  if (!query.trim()) return;
  const q = query.toLowerCase();
  const rows = getChatRows();
  let count = 0;
  Array.from(rows).forEach(row => {
    const bub = row.querySelector('.bubble');
    if (!bub) return;
    const txt = (bub.innerText || bub.textContent).trim();
    if (!txt.toLowerCase().includes(q)) return;
    count++;
    const who = row.classList.contains('user') ? (userName || 'You') : 'Nexora';
    const hl = txt.replace(new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi'), '<mark>$1</mark>');
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `<strong style="color:var(--accent2);font-size:11px">${who}</strong><br>${hl}`;
    res.appendChild(item);
  });
  if (!count) {
    res.innerHTML = '<div class="search-no-result">No results found 🔍</div>';
  }
}

// ==============================
//  CHAT HISTORY PERSISTENCE
// ==============================
function saveChatHistory() {
  try {
    const rows = getChatRows();
    const data = [];
    Array.from(rows).forEach(row => {
      const bub = row.querySelector('.bubble');
      const time = row.querySelector('.bubble-time');
      if (!bub) return;
      data.push({
        role: row.classList.contains('user') ? 'user' : 'bot',
        html: bub.innerHTML,
        time: time ? time.textContent : ''
      });
    });
    if (data.length > 200) data.splice(0, data.length - 200); // keep last 200
    if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_chat_v2', data);
    else localStorage.setItem('nexora_chat_v2', JSON.stringify(data));
    // Show export button once there are messages
    const eb = document.getElementById('exportBtn');
    if (eb && data.length > 2) eb.classList.add('visible');
  } catch(e) {}
}

function loadChatHistory() {
  try {
    const data = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_chat_v2', []) : JSON.parse(localStorage.getItem('nexora_chat_v2') || '[]');
    if (!data || !data.length) return false;
    const messages = document.getElementById('messages');
    data.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'msg-row' + (entry.role === 'user' ? ' user' : '');
      const col = document.createElement('div');
      const bub = document.createElement('div');
      bub.className = 'bubble ' + (entry.role === 'user' ? 'user-bub' : 'bot-bub');
      bub.innerHTML = entry.html;
      // Re-apply syntax highlighting to restored code blocks
      if (entry.role === 'bot' && window.hljs) {
        bub.querySelectorAll('pre code:not(.hljs)').forEach(b => hljs.highlightElement(b));
      }
      bub.style.cursor = 'pointer';
      bub.addEventListener('click', () => {
        const plain = bub.innerText || bub.textContent;
        navigator.clipboard.writeText(plain).then(() => showCopyToast()).catch(() => {});
      });
      const t = document.createElement('div');
      t.className = 'bubble-time';
      t.textContent = entry.time;
      col.appendChild(bub); col.appendChild(t);
      if (entry.role === 'user') {
        const av = document.createElement('div');
        av.className = 'msg-av user-av';
        av.textContent = userInitials;
        row.appendChild(col); row.appendChild(av);
      } else {
        const av = document.createElement('div');
        av.className = 'msg-av'; av.textContent = '✨';
        row.appendChild(av); row.appendChild(col);
      }
      messages.appendChild(row);
    });
    messages.scrollTop = messages.scrollHeight;
    document.getElementById('exportBtn').classList.add('visible');
    return true;
  } catch(e) { return false; }
}

// ==============================
//  CONTEXT CHIPS — smart follow-up suggestions
// ==============================
const chipSets = {
  sad:        ['Tell me more 💬', 'I need advice', 'Just listen 🤍', 'I\'m okay now'],
  stress:     ['Help me calm down', 'Give me a tip 💡', 'Let\'s break it down', 'I\'ll be fine'],
  happy:      ['Tell me more! 🎉', 'Share the vibe ✨', 'Let\'s celebrate!'],
  lonely:     ['Talk to me 💜', 'Distract me', 'Why do I feel this way?'],
  heartbreak: ['What do I do now?', 'Tell me it gets better', 'I need to vent'],
  anxious:    ['Help me breathe', 'Calm my thoughts', 'Is this normal?'],
  hype:       ['Pump me up! 🔥', 'One more thing!', 'Keep going 💪'],
  gossip:     ['Tell me more 👀', 'What should I do?', 'Who asked? 😂'],
  motivation: ['Give me more 🔥', 'I needed this', 'What\'s my next step?'],
  default:    ['Tell me more', 'Ask me something', 'Change topic', 'I\'m feeling…']
};

function injectContextChips() {
  if (contextChipCooldown) return;
  // Only in chat screen
  if (currentScreen !== 'chatScreen') return;
  // Don't show after HTML cards
  const messages = document.getElementById('messages');
  // Remove old chips
  const old = messages.parentElement.querySelector('.context-chips');
  if (old) old.remove();

  const emotion = lastEmotionForVoice || 'default';
  const set = chipSets[emotion] || chipSets.default;
  // Only show 30% of the time to avoid feeling mechanical
  if (Math.random() > 0.45) return;

  const wrap = document.createElement('div');
  wrap.className = 'context-chips';
  set.forEach(label => {
    const chip = document.createElement('div');
    chip.className = 'ctx-chip';
    chip.textContent = label;
    chip.addEventListener('click', () => {
      wrap.remove();
      contextChipCooldown = true;
      setTimeout(() => { contextChipCooldown = false; }, 8000);
      // Map chip labels to quick sends
      const chipMap = {
        'Tell me more 💬': 'I want to tell you more about how I feel',
        'Tell me more': 'Tell me more about that',
        'I need advice': 'Can you give me some advice on this?',
        'Just listen 🤍': 'I just need you to listen right now',
        'I\'m okay now': 'Thanks, I\'m feeling a bit better now',
        'Help me calm down': 'Can you help me calm down?',
        'Give me a tip 💡': 'Give me a practical tip for this',
        'Let\'s break it down': 'Let\'s break this down step by step',
        'I\'ll be fine': 'Thanks, I\'ll be fine',
        'Tell me more! 🎉': 'I want to tell you more about my good news!',
        'Share the vibe ✨': 'Let me share more about what happened',
        'Let\'s celebrate!': 'Let\'s celebrate this moment!',
        'Talk to me 💜': 'Just talk to me, I\'m feeling lonely',
        'Distract me': 'Can you distract me with something fun?',
        'Why do I feel this way?': 'Why do I keep feeling lonely?',
        'What do I do now?': 'What should I do after a heartbreak?',
        'Tell me it gets better': 'Does it really get better with time?',
        'I need to vent': 'I really need to vent right now',
        'Help me breathe': 'Help me with a breathing exercise',
        'Calm my thoughts': 'My thoughts are racing, help me slow down',
        'Is this normal?': 'Is it normal to feel this anxious?',
        'Pump me up! 🔥': 'Pump me up, I need motivation!',
        'One more thing!': 'Tell me one more thing',
        'Keep going 💪': 'Keep going, I love this energy!',
        'Tell me more 👀': 'Tell me more, I\'m curious!',
        'What should I do?': 'What should I do about this?',
        'Who asked? 😂': 'Nobody asked but I love it 😂',
        'Give me more 🔥': 'Give me more motivation!',
        'I needed this': 'I really needed to hear that, thank you',
        'What\'s my next step?': 'What\'s my next step?',
        'Ask me something': 'Ask me something interesting',
        'Change topic': 'Let\'s change the topic',
        'I\'m feeling…': 'I\'m feeling something I can\'t describe'
      };
      const msg = chipMap[label] || label;
      document.getElementById('userInput').value = msg;
      sendMessage();
    });
    wrap.appendChild(chip);
  });

  // Insert before input bar
  const inputBar = document.getElementById('inputBar');
  inputBar.parentElement.insertBefore(wrap, inputBar);
}

function sendMessage() {
  if (isTyping) return;
  const input = document.getElementById('userInput');
  const text = input.value.trim();

  // ── Image + question flow ──
  if (pendingImageFile) {
    const file = pendingImageFile;
    const question = text || '';

    // Show user bubble: image thumb + question
    const thumb = document.getElementById('imgPreviewThumb').src;
    const bubbleContent = `<img src="${thumb}" style="width:100%;max-width:220px;border-radius:12px;margin-bottom:${question ? '6px' : '0'};display:block;" alt="uploaded image">${question ? `<span>${question}</span>` : ''}`;
    addUserMsg(bubbleContent);

    // Clear input + preview
    input.value = '';
    input.style.height = '';
    dismissImagePreview();
    input.blur(); input.focus();
    resetIdleTimer();
    isTyping = true;

    performOCR(file, question || null).then(reply => {
      if (reply) typeBot(reply); else { isTyping = false; typeBot("😓 Something went wrong reading that image. Try again!"); }
    }).catch(() => { isTyping = false; typeBot("😓 Something went wrong reading that image. Try again!"); });
    return;
  }

  // ── Normal text flow ──
  if (!text) return;
  input.value = '';
  input.style.height = '';
  input.style.minHeight = '';
  input.blur();
  input.focus();

  resetIdleTimer();
  addUserMsg(text);
  isTyping = true;

  generateSmartReply(text).then(reply => {
    if (reply === '__STREAMED__') {
      // Reply already rendered by streaming — just reset typing state
      isTyping = false;
      resetIdleTimer();
    } else if (reply) {
      // isFastReply=true for KB/offline — skips the long "thinking" delay
      typeBot(reply, null, false, !_lastReplyWasAI);
      _lastReplyWasAI = false; // reset for next message
    } else {
      isTyping = false;
    }
  }).catch(err => {
    console.error('Nexora chat error:', err);
    isTyping = false;
    typeBot("Oops, I had a little glitch there. Try sending that again? 😅");
  });
}

function quickSend(text) {
  if (isTyping) return;
  document.getElementById('userInput').value = text;
  sendMessage();
}

function getTime() {
  const n = new Date();
  return n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
}

// ==============================
//  VOICE INPUT (Speech Recognition)
// ==============================
function toggleVoiceInput() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('Voice input is not supported in this browser. Try Chrome or Edge.');
    return;
  }
  if (isMicOn) { stopMic(); return; }
  startMic((text) => {
    document.getElementById('userInput').value = text;
    sendMessage();
  });
  document.getElementById('voiceToggle').classList.add('active');
}

function startMic(onResult) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;
  let _resultFired = false; // guard: prevent onend from restarting if result already handled

  recognition.onresult = e => {
    _resultFired = true;
    const text = e.results[0][0].transcript;
    stopMic();
    if (onResult) onResult(text);
  };

  recognition.onerror = (err) => {
    console.warn('[Mic] error:', err.error);
    stopMic();
    if (err.error === 'not-allowed') {
      // Hard stop — mic blocked by user or browser
      _voiceContinuousActive = false;
      _setVoiceState('idle');
      const prompt = document.getElementById('voicePrompt');
      if (prompt) prompt.innerHTML = 'Mic blocked ⛔<br/><span class="dim">Allow mic in browser settings</span>';
      return;
    }
    // All other errors (no-speech, aborted, audio-capture, network) — restart quietly
    if (!_resultFired) {
      if (_voiceContinuousActive && currentScreen === 'voiceScreen' && !isVoiceCallMode) {
        setTimeout(_startContinuousVoice, 500);
      } else if (isVoiceCallMode) {
        _queueVoiceCallListen(500);
      }
    }
  };

  // onend fires after onresult AND after onerror
  // Only restart from here if no result fired AND no error restarted already
  recognition.onend = () => {
    isMicOn = false;
    const vt = document.getElementById('voiceToggle');
    if (vt) vt.classList.remove('active');
    const mb = document.getElementById('micBtn');
    if (mb) mb.classList.remove('active');
    const vo = document.getElementById('voiceOrb');
    if (vo) vo.classList.remove('listening');
  };

  recognition.start();
  isMicOn = true;
}

function stopMic() {
  if (recognition) { try { recognition.stop(); } catch(e){} }
  isMicOn = false;
  document.getElementById('voiceToggle').classList.remove('active');
  const mb = document.getElementById('micBtn');
  if (mb) { mb.classList.remove('active'); }
  const vo = document.getElementById('voiceOrb');
  if (vo) vo.classList.remove('listening');
}

// ==============================
//  VOICE SCREEN MIC
// ==============================
// ── Voice screen state helper ──────────────────────────────────
// States: 'idle' | 'listening' | 'processing' | 'speaking'
let _stateLabelFadeTimer = null;

function _setVoiceState(state) {
  const orb    = document.getElementById('voiceOrb');
  const wrap   = document.getElementById('voiceOrbWrap');
  const label  = document.getElementById('voiceStateLabel');
  const rings  = document.getElementById('voiceRings');
  const prompt = document.getElementById('voicePrompt');
  if (!orb) return;

  // 120ms settle delay — feels intentional, not instant
  setTimeout(() => {
    orb.classList.remove('listening', 'processing', 'speaking');
    if (wrap)  wrap.classList.remove('processing');
    if (label) label.classList.remove('state-listening', 'state-processing', 'state-speaking', 'faded');
    if (rings) rings.classList.remove('active');

    // Clear any pending label fade
    if (_stateLabelFadeTimer) { clearTimeout(_stateLabelFadeTimer); _stateLabelFadeTimer = null; }

    switch (state) {
      case 'listening':
        orb.classList.add('listening');
        if (label) { label.textContent = 'listening'; label.classList.add('state-listening'); }
        if (rings) rings.classList.add('active');
        if (prompt) prompt.innerHTML = 'Listening…<br/><span class="dim">speak now</span>';
        break;
      case 'processing':
        orb.classList.add('processing');
        if (wrap)  wrap.classList.add('processing');
        if (label) { label.textContent = 'thinking'; label.classList.add('state-processing'); }
        if (prompt) prompt.innerHTML = '<span class="dim">thinking…</span>';
        break;
      case 'speaking':
        orb.classList.add('speaking');
        if (label) { label.textContent = 'speaking'; label.classList.add('state-speaking'); }
        if (prompt) prompt.innerHTML = '<span class="dim">Nexora is speaking</span> <span class="voice-speak-dots"><span>.</span><span>.</span><span>.</span></span>';
        break;
      default: // idle
        if (label) label.textContent = 'idle';
        if (prompt) {
          const _cap = userName ? cap1(userName) : '';
          prompt.innerHTML = _cap ? `Hello, ${_cap}! Tap the orb` : 'Tap the orb to start';
        }
        break;
    }

    // Drive the login orb shader if it's loaded
    if (typeof window._nexoraOrbState === 'function') window._nexoraOrbState(state);
    // Fade label out after 2.5s — visuals carry the state, label is just a hint
    _stateLabelFadeTimer = setTimeout(() => {
      if (label) label.classList.add('faded');
      _stateLabelFadeTimer = null;
    }, 2500);
  }, 120);
}

// ==============================
let _voiceContinuousActive = false; // tracks orb-tap continuous mode

function toggleMic() {
  // If continuous voice is running, stop it
  if (_voiceContinuousActive || isMicOn) {
    _voiceContinuousActive = false;
    stopMic();
    _setVoiceState('idle');
    document.getElementById('micBtn').classList.remove('active');
    return;
  }

  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const prompt = document.getElementById('voicePrompt');
    if (prompt) prompt.innerHTML = 'Voice not supported<br/><span class="dim">Try Chrome or Edge</span>';
    return;
  }

  _voiceContinuousActive = true;
  _startContinuousVoice();
}

function _startContinuousVoice() {
  // Stop if user tapped orb to end, or left voice screen
  if (!_voiceContinuousActive || currentScreen !== 'voiceScreen') return;
  // Don't double-start if voice call mode is also running
  if (isVoiceCallMode) return;

  _setVoiceState('listening');
  document.getElementById('micBtn').classList.add('active');

  startMic(async (text) => {
    _setVoiceState('processing');
    document.getElementById('voicePrompt').innerHTML =
      `<span style="font-size:14px;color:var(--text2)">"${text}"</span><br/><span class="dim">thinking…</span>`;
    document.getElementById('micBtn').classList.remove('active');

    try {
      const reply = await generateSmartReply(text);
      const speakable = _stripHTMLForVoice(reply);
      const display   = (reply === '__STREAMED__') ? '✅ Replied in chat' : reply;
      _setVoiceState('speaking');
      document.getElementById('voicePrompt').innerHTML = display;
      const _orbEl = document.getElementById('voiceOrb');
      if (_orbEl) _orbEl.classList.add('speaking');
      if (speakable && speakable.trim().length > 1) await speakText(speakable);
      if (_orbEl) _orbEl.classList.remove('speaking');
    } catch (e) {
      console.error('Nexora voice error:', e);
      _setVoiceState('idle');
      document.getElementById('voicePrompt').innerHTML = 'Oops! Try again? 😅';
    } finally {
      // ALWAYS restart listening after reply or error — this is what makes it truly continuous
      if (_voiceContinuousActive && currentScreen === 'voiceScreen') {
        setTimeout(_startContinuousVoice, 500);
      }
    }
  });
}

function _setCallButtonUI(active) {
  const btn = document.getElementById('voiceCallBtn');
  if (!btn) return;
  btn.classList.toggle('active', !!active);
  btn.textContent = active ? '📞 End Call' : '📞 Start Call';
}

function _queueVoiceCallListen(delayMs = 320) {
  if (voiceCallTimer) clearTimeout(voiceCallTimer);
  voiceCallTimer = setTimeout(() => {
    voiceCallTimer = null;
    if (!isVoiceCallMode || currentScreen !== 'voiceScreen') return;
    if (isMicOn) return;
    _setVoiceState('listening');
    document.getElementById('micBtn').classList.add('active');
    startMic(async (text) => {
      _setVoiceState('processing');
      document.getElementById('voicePrompt').innerHTML = `<span style="font-size:14px;color:var(--text2)">"${text}"</span><br/><span class="dim">thinking…</span>`;
      document.getElementById('micBtn').classList.remove('active');
      try {
        const reply = await generateSmartReply(text);
        const speakable = _stripHTMLForVoice(reply);
        _setVoiceState('speaking');
        document.getElementById('voicePrompt').innerHTML =
          reply === '__STREAMED__' ? '✅ Replied in chat' : reply;
        const _callOrbEl = document.getElementById('voiceOrb');
        if (_callOrbEl) _callOrbEl.classList.add('speaking');
        await speakText(speakable, { preferCloudTTS: true });
        if (_callOrbEl) _callOrbEl.classList.remove('speaking');
      } catch (e) {
        _setVoiceState('idle');
        document.getElementById('voicePrompt').innerHTML = 'I lost the thread a bit. Say that once more?';
      } finally {
        if (isVoiceCallMode) _queueVoiceCallListen(300);
      }
    });
  }, delayMs);
}

function startVoiceCall() {
  if (isVoiceCallMode) return;
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    const prompt = document.getElementById('voicePrompt');
    if (prompt) prompt.innerHTML = 'Voice not supported<br/><span class="dim">Try Chrome or Edge</span>';
    return;
  }
  isVoiceCallMode = true;
  _setCallButtonUI(true);
  _setVoiceState('listening');
  const prompt = document.getElementById('voicePrompt');
  if (prompt) prompt.innerHTML = 'Call connected ✅<br/><span class="dim">You can speak naturally</span>';
  _queueVoiceCallListen(450);
}

function endVoiceCall() {
  isVoiceCallMode = false;
  _voiceContinuousActive = false; // stop orb-tap continuous loop if running alongside call mode
  if (voiceCallTimer) {
    clearTimeout(voiceCallTimer);
    voiceCallTimer = null;
  }
  stopMic();
  stopSpeaking();
  _setCallButtonUI(false);
  _setVoiceState('idle');
}

function toggleVoiceCall() {
  if (isVoiceCallMode) endVoiceCall();
  else startVoiceCall();
}

// ==============================
//  SPEECH SYNTHESIS (TTS)
//  Defined below in Phase 5 with full emotion + content-aware prosody
// ==============================

function stopSpeaking() {
  if (synth) synth.cancel();
  if (voiceReplyAudio) {
    try {
      voiceReplyAudio.pause();
      voiceReplyAudio.src = '';
    } catch (e) {}
    voiceReplyAudio = null;
  }
}

// ── Strip HTML/markdown for TTS — prevents tags being read aloud ──
function _stripHTMLForVoice(text) {
  if (!text) return '';
  if (text === '__STREAMED__') {
    const streamedText = window._lastStreamedReplyText || '';
    window._lastStreamedReplyText = null;
    if (streamedText.trim().length > 2) {
      return streamedText
        .replace(/<[^>]+>/g, ' ')
        .replace(/\*\*/g, '').replace(/#{1,6}\s/g, '')
        .replace(/[\u{1F300}-\u{1FFFF}]/gu, '').replace(/[\u2600-\u27BF]/gu, '')
        .replace(/\s{2,}/g, ' ').trim();
    }
    return '';
  }
  return text
    .replace(/__HTML__/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\*\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ==============================
//  UTILS
// ==============================
