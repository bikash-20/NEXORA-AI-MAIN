// ============================================================
// nexora-study.js
// Study Mode: state variables, callStudyAI, flashcard functions,
// quiz functions, spaced repetition (SRS), summarizer, viva mode,
// podcast/listen mode, progress dashboard, PDF export, group rooms,
// daily reminder, memory panel, and backend integration IIFE.
// ============================================================

// ══════════════════════════════════════════════════════════════════════
//  STUDY MODE — Flashcards · Quiz · Spaced Repetition
//  All AI calls go through callStudyAI() which reuses the OpenRouter /
//  Gemini / Pollinations chain already in the app.
// ══════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────────
let studyCurrentTab  = 'flashcard';
const STUDY_AI_LS_KEY = 'nexora_study_ai';
let studyAIKey       = localStorage.getItem(STUDY_AI_LS_KEY) || 'gemini'; // which model to use in study mode
let studyLoading     = false;

// Flashcard state
let fcCards          = [];             // [{front,back,hint,tag}]
let fcIndex          = 0;
let fcFlipped        = false;
let fcReverseMode    = false;
let fcCurrentTopic   = '';

// Quiz state
let quizQuestions    = [];             // [{q, options:[A..D], correct, explanation}]
let quizIndex        = 0;
let quizScore        = 0;
let quizAnswered     = [];
let quizCurrentTopic = '';
let quizDifficulty   = 'medium';

// SRS — SM-2 lite
const SRS_LS_KEY = 'nexora_srs_cards';
let srsCards        = [];              // loaded from localStorage
let srsDue          = [];              // filtered by next_review
let srsSessionIdx   = 0;
let srsDayStreak    = 0;

// ── AI model options shown in the picker ──────────────────────────────
const STUDY_AI_BASE_OPTIONS = [
  { key: 'gemini',   label: 'Gemini 2.0 Flash', color: '#00e0ff', shortLabel: 'Gemini' },
  { key: 'llama',    label: 'Llama 3.3 70B',    color: '#10b981', shortLabel: 'Llama' },
  { key: 'deepseek', label: 'DeepSeek R1',      color: '#a855f7', shortLabel: 'DeepSeek' },
  { key: 'mistral',  label: 'Mistral Small',    color: '#f59e0b', shortLabel: 'Mistral' },
  { key: 'qwenbig',  label: 'Qwen3 235B',       color: '#c084fc', shortLabel: 'Qwen3' },
];
const STUDY_AI_CF_OPTIONS = [
  { key: 'cf-claude',   label: 'CF Writing Pro',    color: '#fb923c', shortLabel: 'CF Write' },
  { key: 'cf-deepseek', label: 'CF DeepSeek R1',    color: '#fb923c', shortLabel: 'CF DeepSeek' },
  { key: 'cf-llama',    label: 'CF Llama 3.3 70B',  color: '#fb923c', shortLabel: 'CF Llama' },
  { key: 'cf-qwen',     label: 'CF Fast Chat',      color: '#fb923c', shortLabel: 'CF Fast' },
];

function getStudyAIOptions() {
  return _hasCFWorker()
    ? [...STUDY_AI_BASE_OPTIONS, ...STUDY_AI_CF_OPTIONS]
    : [...STUDY_AI_BASE_OPTIONS];
}

function _ensureStudyAIKeyValid() {
  if (getStudyAIOptions().some(opt => opt.key === studyAIKey)) return;
  studyAIKey = 'gemini';
  try { localStorage.setItem(STUDY_AI_LS_KEY, studyAIKey); } catch(e) {}
}

function _refreshStudyAIPickerUI() {
  _ensureStudyAIKeyValid();
  if (currentScreen === 'studyScreen') {
    _renderStudyAIPicker();
    _updateStudyAIPill();
  }
}

_ensureStudyAIKeyValid();

function _studyBaseTopicLabel(topic) {
  return topic
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[.!?\n]/)[0]
    .slice(0, 80) || 'this topic';
}

function _studyExtractPoints(topic) {
  const cleaned = topic
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  const sentenceParts = cleaned.length > 1
    ? cleaned
    : topic.split(/(?<=[.!?])\s+|[;•]/);

  const points = sentenceParts
    .map(s => s.replace(/^[-*]\s*/, '').trim())
    .filter(s => s.length > 12)
    .slice(0, 24);

  return points.length ? points : [topic.trim()];
}

function _studyHint(text) {
  return text.split(/\s+/).slice(0, 4).join(' ');
}

function _buildLocalFlashcards(topic, count, lang) {
  const topicLabel = _studyBaseTopicLabel(topic);
  const points = _studyExtractPoints(topic);
  const cards = [];

  if (points.length > 1) {
    for (let i = 0; i < count; i++) {
      const point = points[i % points.length];
      const cardNo = i + 1;
      let front = `What is key point ${cardNo} about ${topicLabel}?`;
      let back = point;
      if (lang === 'bangla') {
        front = `${topicLabel} সম্পর্কে ${cardNo} নম্বর গুরুত্বপূর্ণ পয়েন্ট কী?`;
      } else if (lang === 'banglish') {
        front = `${topicLabel} niye key point ${cardNo} ki?`;
      }
      cards.push({
        front,
        back,
        hint: _studyHint(point),
        tag: topicLabel
      });
    }
    return cards;
  }

  const templates = lang === 'bangla'
    ? [
        ['এই টপিকের সংজ্ঞা কী?', `${topicLabel} এর একটি স্পষ্ট সংজ্ঞা নিজের ভাষায় লিখো।`],
        ['কেন এটি গুরুত্বপূর্ণ?', `${topicLabel} কেন গুরুত্বপূর্ণ এবং কোথায় ব্যবহার হয় তা ব্যাখ্যা করো।`],
        ['মূল অংশগুলো কী?', `${topicLabel} এর প্রধান উপাদান বা ধাপগুলো তালিকা করো।`],
        ['একটি উদাহরণ দাও', `${topicLabel} বোঝাতে একটি সহজ উদাহরণ দাও।`],
        ['কীভাবে মনে রাখবে?', `${topicLabel} মনে রাখতে 3টি ছোট কিওয়ার্ড ব্যবহার করো।`],
        ['সাধারণ ভুল কী?', `${topicLabel} পড়ার সময় শিক্ষার্থীরা যে সাধারণ ভুল করে তা লিখো।`],
      ]
    : lang === 'banglish'
      ? [
          ['Ei topic er definition ki?', `${topicLabel} er short definition nijer moto kore bolo.`],
          ['Keno important?', `${topicLabel} keno important ar kothay use hoy seta bolo.`],
          ['Main parts gula ki?', `${topicLabel} er main parts ba steps list koro.`],
          ['Ekta easy example dao', `${topicLabel} bujhte ekta easy example dao.`],
          ['Mone rakhbo kivabe?', `${topicLabel} mone rakhte 3ta keyword use koro.`],
          ['Common mistake ki?', `${topicLabel} porte gele common kon vul hoy?`],
        ]
      : [
          ['What is the definition?', `Write a clear definition of ${topicLabel} in simple words.`],
          ['Why is it important?', `Explain why ${topicLabel} matters and where it is used.`],
          ['What are the main parts?', `List the core components or steps of ${topicLabel}.`],
          ['Give one example', `Give one easy example that explains ${topicLabel}.`],
          ['How would you remember it?', `Use 3 short keywords to remember ${topicLabel}.`],
          ['What is a common mistake?', `Describe one common mistake learners make with ${topicLabel}.`],
        ];

  for (let i = 0; i < count; i++) {
    const [front, back] = templates[i % templates.length];
    cards.push({ front, back, hint: _studyHint(back), tag: topicLabel });
  }
  return cards;
}

function _buildLocalQuiz(topic, count, difficulty) {
  const topicLabel = _studyBaseTopicLabel(topic);
  const points = _studyExtractPoints(topic);
  const genericAnswers = [
    `It defines the basic idea of ${topicLabel}.`,
    `It explains why ${topicLabel} is useful in practice.`,
    `It focuses on the main steps or structure of ${topicLabel}.`,
    `It gives a concrete example of ${topicLabel}.`,
    `It highlights a common mistake related to ${topicLabel}.`,
    `It summarises the most important takeaway about ${topicLabel}.`,
  ];
  const answerPool = (points.length > 1 ? points : genericAnswers)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const questions = [];
  for (let i = 0; i < count; i++) {
    const correctText = answerPool[i % answerPool.length];
    const distractors = answerPool
      .filter(s => s !== correctText)
      .slice(0, 3);

    while (distractors.length < 3) {
      distractors.push(genericAnswers[(i + distractors.length + 1) % genericAnswers.length]);
    }

    const optionsRaw = [correctText, ...distractors.slice(0, 3)];
    const rotated = optionsRaw.map((_, idx) => optionsRaw[(idx + i) % optionsRaw.length]);
    const letters = ['A', 'B', 'C', 'D'];
    const correctIndex = rotated.indexOf(correctText);

    questions.push({
      q: `Which statement best matches ${topicLabel}${difficulty === 'hard' ? ' most precisely' : ''}?`,
      options: rotated.map((opt, idx) => `${letters[idx]}) ${opt}`),
      correct: letters[correctIndex],
      explanation: `The best answer is the one that directly matches the study material for ${topicLabel}.`
    });
  }
  return questions;
}

// ── callStudyAI — lightweight wrapper around the existing OR/Gemini chain
async function callStudyAI(systemPrompt, userPrompt) {
  _ensureStudyAIKeyValid();
  const chosenMeta = CMP_MODELS[studyAIKey] || CMP_MODELS.gemini;
  const geminiKey = localStorage.getItem('nexora_gemini_key') || '';
  const canUseGeminiDirect = studyAIKey === 'gemini' && geminiKey &&
    (geminiKey.startsWith('AIza') || geminiKey.startsWith('AQ.'));
  const cacheKey = window.NexoraData?.hashText
    ? NexoraData.hashText('study', studyAIKey, systemPrompt, userPrompt)
    : '';
  const cacheReply = async reply => {
    if (cacheKey && reply && window.NexoraData?.setAiCache) {
      await NexoraData.setAiCache(cacheKey, reply);
    }
    return reply;
  };

  if (cacheKey && window.NexoraData?.getAiCache) {
    const cached = await NexoraData.getAiCache(cacheKey);
    if (cached) return cached;
  }

  if (chosenMeta?.isCF && _hasCFWorker()) {
    try {
      const res = await fetchWithTimeout(_getCFWorkerUrl() + '/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chosenMeta.cfAlias,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 2200,
          temperature: 0.45,
        }),
      }, 30000);
      if (res.ok) {
        const d = await res.json();
        const txt = d?.choices?.[0]?.message?.content?.trim();
        if (txt) return cacheReply(txt);
      }
    } catch(e) {}
  }

  if (canUseGeminiDirect) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 }
          })
        }
      );
      if (res.ok) {
        const d = await res.json();
        const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (txt) return cacheReply(txt);
      }
    } catch(e) {}
  }

  // Use the selected study model via OpenRouter when available
  const orKey = localStorage.getItem('nexora_user_key') ||
                (typeof resolveActiveKey === 'function' ? resolveActiveKey().key : '');
  if (orKey && orKey.startsWith('sk-or-')) {
    const orModel = chosenMeta?.orModel || 'google/gemini-2.0-flash-exp:free';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${orKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin || 'https://nexora.ai',
          'X-Title': 'Nexora Study Mode'
        },
        body: JSON.stringify({
          model: orModel,
          max_tokens: 2048,
          temperature: 0.5,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt }
          ]
        })
      });
      if (res.ok) {
        const d = await res.json();
        const txt = d?.choices?.[0]?.message?.content?.trim();
        if (txt) return cacheReply(txt);
      }
    } catch(e) {}
  }

  // If the user selected a non-Gemini model but has only a Gemini key, still give them a working fallback.
  if (!canUseGeminiDirect && geminiKey && (geminiKey.startsWith('AIza') || geminiKey.startsWith('AQ.'))) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 }
          })
        }
      );
      if (res.ok) {
        const d = await res.json();
        const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (txt) return txt;
      }
    } catch(e) {}
  }

  // Last resort: Pollinations (no key needed) — prefer a model that matches the chosen AI
  try {
    const res = await fetchWithTimeout('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chosenMeta?.pollinationsModel || 'openai',
        seed: 42,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt }
        ]
      }),
    }, 20000);
    if (res.ok) {
      const txt = (await res.text()).trim();
      if (txt) return cacheReply(txt);
    }
  } catch(e) {}

  throw new Error('All AI endpoints failed — check your API key.');
}

// ── Parse JSON safely from AI output ──────────────────────────────────
function _parseStudyJSON(raw) {
  let txt = String(raw || '').replace(/```json|```/gi, '').trim();
  const arrStart = txt.indexOf('[');
  const objStart = txt.indexOf('{');
  const start = arrStart !== -1 && (objStart === -1 || arrStart < objStart) ? arrStart : objStart;
  if (start === -1) throw new Error('No JSON found');
  txt = txt.slice(start);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(txt.slice(0, i + 1));
      }
    }
  }
  return JSON.parse(txt);
}

// ── Study source helpers (Notes / Podcast) ───────────────────────────
let studySourceFile = null;
let studySourceText = '';
let studySourceName = '';
let studySourceKind = '';
let studyOutputPlainText = '';

function _updateStudySourceSub(text) {
  const el = document.getElementById('studySourceSub');
  if (el) el.textContent = text;
}

function _setStudyUploadPreview(kind, file) {
  const preview = document.getElementById('studyUploadPreview');
  const thumb   = document.getElementById('studyUploadThumb');
  const nameEl  = document.getElementById('studyUploadName');
  const metaEl  = document.getElementById('studyUploadMeta');

  if (!preview || !nameEl || !metaEl) return;

  if (!file) {
    preview.style.display = 'none';
    if (thumb) {
      thumb.src = '';
      thumb.style.display = 'none';
    }
    nameEl.textContent = '';
    metaEl.textContent = '';
    return;
  }

  preview.style.display = 'flex';
  nameEl.textContent = file.name || 'Study source';
  metaEl.textContent = `${kind} · ${Math.max(1, Math.round((file.size || 0) / 1024))} KB`;
}

async function _studyExtractSourceText(file) {
  if (!file) return '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isImage = (file.type || '').startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext);

  if (isImage) {
    if (nexoraResponseMode === 'online' && typeof callVisionAI === 'function') {
      try {
        const vision = await callVisionAI(
          file,
          'Extract the text and the main study points from this image. Return plain text only.'
        );
        if (vision && vision.trim()) return vision.trim();
      } catch(e) {}
    }

    try {
      await ensureTesseract();
      const { data: { text } } = await window.Tesseract.recognize(file, 'eng', { logger: () => {} });
      return String(text || '').replace(/\s+/g, ' ').trim();
    } catch(e) {
      return '';
    }
  }

  try {
    return String(await _readFileAsText(file) || '').trim();
  } catch(e) {
    return '';
  }
}

async function handleStudyFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;

  studySourceFile = file;
  studySourceName = file.name || 'Study source';
  studySourceKind = (file.type || '').startsWith('image/') ? 'Image' : 'Document';
  studySourceText = '';

  _setStudyUploadPreview(studySourceKind, file);
  _updateStudySourceSub(`Ready to turn "${studySourceName}" into notes or a podcast.`);

  const thumb = document.getElementById('studyUploadThumb');
  if (thumb && studySourceKind === 'Image') {
    const reader = new FileReader();
    reader.onload = e => {
      thumb.src = e.target.result;
      thumb.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else if (thumb) {
    thumb.src = '';
    thumb.style.display = 'none';
  }

  const extracted = await _studyExtractSourceText(file);
  if (extracted) {
    studySourceText = extracted;
    const metaEl = document.getElementById('studyUploadMeta');
    if (metaEl) metaEl.textContent = `${studySourceKind} · ${Math.max(1, Math.round((file.size || 0) / 1024))} KB · text ready`;
  } else {
    const metaEl = document.getElementById('studyUploadMeta');
    if (metaEl) metaEl.textContent = `${studySourceKind} · ${Math.max(1, Math.round((file.size || 0) / 1024))} KB · no readable text yet`;
  }
}

function clearStudyUpload() {
  studySourceFile = null;
  studySourceText = '';
  studySourceName = '';
  studySourceKind = '';

  const input = document.getElementById('studyFileInput');
  if (input) input.value = '';
  _setStudyUploadPreview('', null);
  _updateStudySourceSub('Upload an image or PDF, then tell Nexora what to make from it.');
}

function closeStudyOutput() {
  const panel = document.getElementById('studyOutputPanel');
  if (panel) panel.style.display = 'none';
}

function copyStudyOutput(btn) {
  const text = studyOutputPlainText || document.getElementById('studyOutputBody')?.innerText || '';
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const prev = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = 'Copied';
      setTimeout(() => { if (btn) btn.textContent = prev || 'Copy'; }, 1500);
    }
  });
}

function _showStudyOutput(title, content) {
  const panel = document.getElementById('studyOutputPanel');
  const titleEl = document.getElementById('studyOutputTitle');
  const body = document.getElementById('studyOutputBody');
  if (!panel || !titleEl || !body) return;

  studyOutputPlainText = String(content || '');
  titleEl.textContent = title || 'Study Output';
  panel.style.display = 'block';

  if (window.marked && _isMarkdownContent(studyOutputPlainText)) {
    body.innerHTML = marked.parse(studyOutputPlainText);
  } else {
    body.textContent = studyOutputPlainText;
  }
}

async function generateStudyNotes() {
  if (!studySourceFile) {
    _showStudyToast('Upload a file first.');
    return;
  }

  // ── TIER GATE: Check for paid model access ──
  if (typeof hasPaidModelAccess === 'function' && !hasPaidModelAccess()) {
    _showStudyToast('⚠️ PDF/Image analysis requires a paid API key. Add one in Settings!');
    _hideStudyLoading();
    return;
  }

  _showStudyLoading('Creating notes…');
  try {
    const sourceText = studySourceText || await _studyExtractSourceText(studySourceFile);
    if (!sourceText) throw new Error('Could not extract readable text from that file.');

    const prompt = `Turn the following study source into concise revision notes. Use headings, bullet points, key terms, and a short recap at the end. Keep it accurate and easy to review.\n\nSOURCE:\n${sourceText.slice(0, 6000)}`;
    const reply = await callStudyAI('You are an expert note-taking assistant.', prompt);
    _showStudyOutput(`📝 Notes · ${studySourceName || 'Study Source'}`, reply);
  } catch(e) {
    _showStudyToast('❌ ' + (e.message || 'Could not generate notes.'));
  } finally {
    _hideStudyLoading();
  }
}

async function generateStudyPodcast() {
  if (!studySourceFile) {
    _showStudyToast('Upload a file first.');
    return;
  }

  // ── TIER GATE: Check for paid model access ──
  if (typeof hasPaidModelAccess === 'function' && !hasPaidModelAccess()) {
    _showStudyToast('⚠️ PDF/Image analysis requires a paid API key. Add one in Settings!');
    return;
  }

  _showStudyLoading('Preparing podcast…');
  try {
    const sourceText = studySourceText || await _studyExtractSourceText(studySourceFile);
    if (!sourceText) throw new Error('Could not extract readable text from that file.');

    switchStudyTab('podcast');
    await new Promise(r => setTimeout(r, 50));
    await generatePodcast({
      topic: studySourceName ? studySourceName.replace(/\.[^.]+$/, '') : 'Study source',
      text: sourceText,
      title: `📻 ${studySourceName ? studySourceName.replace(/\.[^.]+$/, '') : 'Study Podcast'}`
    });
  } catch(e) {
    _showStudyToast('❌ ' + (e.message || 'Could not generate podcast.'));
  } finally {
    _hideStudyLoading();
  }
}

// ── Screen open / close ────────────────────────────────────────────────
function openStudyMode() {
  if (typeof closeProgressDashboard === 'function') closeProgressDashboard();
  // Close menu if open
  if (menuOpen) {
    menuOpen = false;
    document.getElementById('modeToggle').classList.remove('open');
  }
  // Close compare panel if it's open (it sits on top as an overlay)
  const cmpPanel = document.getElementById('comparePanel');
  if (cmpPanel) cmpPanel.classList.remove('open');

  _ensureStudyAIKeyValid();
  setOverlayMode('study');
  showScreen('studyScreen');
  _renderStudyAIPicker();
  _updateStudyAIPill();
  srsLoadCards();
  switchStudyTab(studyCurrentTab);
}

function closeStudyMode() {
  if (typeof closeProgressDashboard === 'function') closeProgressDashboard();
  setOverlayMode(null);
  showScreen('chatScreen');
}

// ── Tab switching ──────────────────────────────────────────────────────
function switchStudyTab(tab) {
  studyCurrentTab = tab;
  document.querySelectorAll('.study-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.study-panel').forEach(p => p.classList.remove('active'));
  const tabBtn = document.getElementById('stab-' + tab);
  const panel  = document.getElementById('spanel-' + tab);
  if (tabBtn) tabBtn.classList.add('active');
  if (panel)  panel.classList.add('active');
  if (tab === 'srs') _renderSrsState();
  if (tab === 'flashcard') _renderSavedDecks();
}

// ── AI picker ──────────────────────────────────────────────────────────
function _renderStudyAIPicker() {
  const grid = document.getElementById('studyAIPickerGrid');
  if (!grid) return;
  _ensureStudyAIKeyValid();
  grid.innerHTML = getStudyAIOptions().map(opt => `
    <div class="study-ai-option ${opt.key === studyAIKey ? 'selected' : ''}"
         onclick="selectStudyAI('${opt.key}')">
      <div class="study-ai-option-dot" style="background:${opt.color}"></div>
      <div class="study-ai-option-label">${opt.label}</div>
    </div>
  `).join('');
}

function selectStudyAI(key) {
  if (CMP_MODELS[key]?.isCF && !_hasCFWorker()) {
    toggleStudyAIPicker(false);
    openCFPanel();
    return;
  }
  if (!getStudyAIOptions().some(opt => opt.key === key)) return;
  studyAIKey = key;
  localStorage.setItem(STUDY_AI_LS_KEY, key);
  _updateStudyAIPill();
  _renderStudyAIPicker();
  toggleStudyAIPicker(false);
}

function _updateStudyAIPill() {
  _ensureStudyAIKeyValid();
  const options = getStudyAIOptions();
  const opt = options.find(o => o.key === studyAIKey) || options[0] || STUDY_AI_BASE_OPTIONS[0];
  const pill  = document.getElementById('studyAIPill');
  const dot   = document.getElementById('studyAIPillDot');
  const label = document.getElementById('studyAIPillLabel');
  if (dot)   dot.style.background = opt.color;
  if (label) label.textContent = opt.shortLabel || opt.label;
}

function toggleStudyAIPicker(forceClose) {
  const picker = document.getElementById('studyAIPicker');
  if (!picker) return;
  if (forceClose === false || picker.style.display !== 'none') {
    picker.style.display = 'none';
  } else {
    picker.style.display = 'block';
    _renderStudyAIPicker();
  }
}

// Close picker when clicking outside
document.addEventListener('click', e => {
  const picker = document.getElementById('studyAIPicker');
  const pill   = document.getElementById('studyAIPill');
  if (picker && picker.style.display !== 'none' &&
      !picker.contains(e.target) && e.target !== pill && !pill?.contains(e.target)) {
    picker.style.display = 'none';
  }
});

// ── Loading helpers ────────────────────────────────────────────────────
function _showStudyLoading(text) {
  studyLoading = true;
  const el = document.getElementById('studyLoading');
  const tx = document.getElementById('studyLoadingText');
  if (el) el.style.display = 'flex';
  if (tx) tx.textContent = text || 'Generating with AI…';
}
function _hideStudyLoading() {
  studyLoading = false;
  const el = document.getElementById('studyLoading');
  if (el) el.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════════
//  FLASHCARD GENERATOR
// ══════════════════════════════════════════════════════════════════════

async function generateFlashcards() {
  const topic = (document.getElementById('fcTopicInput')?.value || '').trim();
  if (!topic) { _showStudyToast('⚠️ Enter a topic first'); return; }
  const count = parseInt(document.getElementById('fcCountSelect')?.value || '8');
  const lang  = document.getElementById('fcLangSelect')?.value || 'english';

  const btn = document.getElementById('fcGenBtn');
  if (btn) btn.disabled = true;
  _showStudyLoading(`Generating ${count} flashcards…`);

  const systemPrompt = `You are a study assistant. Generate flashcards as a JSON array.
Each card: {"front":"<question>","back":"<answer>","hint":"<optional short hint>","tag":"<topic tag>"}
Rules:
- Respond ONLY with the JSON array — no preamble, no markdown fences
- Language: ${lang}
- Make cards concise and educational
- Hint should be very short (max 8 words), or empty string if not useful`;

  const userPrompt = `Generate exactly ${count} flashcards about: ${topic}`;

  try {
    let raw = null;
    try {
      raw = await callStudyAI(systemPrompt, userPrompt);
      fcCards  = _parseStudyJSON(raw);
      if (!Array.isArray(fcCards) || fcCards.length === 0) throw new Error('Empty array');
    } catch(err) {
      console.warn('Study Mode flashcard AI failed, using local fallback:', err);
      const workerCards = window.NexoraData?.runWorkerTask
        ? await NexoraData.runWorkerTask('flashcards', { topic, count, lang })
        : null;
      fcCards = Array.isArray(workerCards) && workerCards.length
        ? workerCards
        : _buildLocalFlashcards(topic, count, lang);
      _showStudyToast(isTimeoutError(err)
        ? '⚠️ AI took too long — used smart local cards'
        : '⚠️ AI unavailable — used smart local cards');
    }
    // Ensure required fields
    fcCards = fcCards.map(c => ({
      front: c.front || c.question || c.q || '?',
      back:  c.back  || c.answer  || c.a || '?',
      hint:  c.hint  || '',
      tag:   c.tag   || topic.slice(0,20)
    }));
    fcIndex      = 0;
    fcFlipped    = false;
    fcReverseMode = false;
    fcCurrentTopic = topic.slice(0, 30);
    _renderFlashcardDeck();
  } catch(err) {
    _showStudyToast('❌ Failed to generate cards — try again');
    console.error('FC gen error:', err);
  } finally {
    _hideStudyLoading();
    if (btn) btn.disabled = false;
  }
}

function _renderFlashcardDeck() {
  const area = document.getElementById('fcDeckArea');
  if (!area) return;
  area.style.display = 'flex';
  area.style.flexDirection = 'column';
  area.style.gap = '12px';

  document.getElementById('fcDeckTopic').textContent = fcCurrentTopic;
  _renderFlashcard();
  _renderFcDots();
}

function _renderFlashcard() {
  if (!fcCards.length) return;
  const card = fcCards[fcIndex];
  const front = fcReverseMode ? card.back  : card.front;
  const back  = fcReverseMode ? card.front : card.back;
  const hint  = fcReverseMode ? '' : (card.hint || '');

  document.getElementById('fcFrontText').textContent = front;
  document.getElementById('fcBackText').textContent  = back;
  document.getElementById('fcDeckProgress').textContent = `${fcIndex + 1} / ${fcCards.length}`;

  // Reset flip state
  const el = document.getElementById('fcCard');
  if (el) { el.classList.remove('flipped'); fcFlipped = false; }

  // Hint
  const hintRow = document.getElementById('fcHintRow');
  const hintTxt = document.getElementById('fcHintText');
  if (hintRow) hintRow.style.display = hint ? 'flex' : 'none';
  if (hintTxt) { hintTxt.style.display = 'none'; hintTxt.textContent = hint; }

  // Close explain panel
  const ep = document.getElementById('fcExplainPanel');
  if (ep) ep.style.display = 'none';
}

function _renderFcDots() {
  const wrap = document.getElementById('fcDots');
  if (!wrap) return;
  wrap.innerHTML = fcCards.slice(0, 12).map((_, i) =>
    `<div class="fc-dot ${i === fcIndex ? 'active' : ''}"></div>`
  ).join('');
}

function flipFlashcard() {
  const el = document.getElementById('fcCard');
  if (!el) return;
  fcFlipped = !fcFlipped;
  el.classList.toggle('flipped', fcFlipped);
}

function showFlashcardHint() {
  const hint = document.getElementById('fcHintText');
  if (hint) hint.style.display = 'inline';
}

function fcNav(dir) {
  if (!fcCards.length) return;
  fcIndex = (fcIndex + dir + fcCards.length) % fcCards.length;
  _renderFlashcard();
  _renderFcDots();
}

function toggleFlipAll() {
  fcReverseMode = !fcReverseMode;
  const btn = document.getElementById('fcFlipAllBtn');
  if (btn) btn.style.background = fcReverseMode
    ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.08)';
  _renderFlashcard();
  _showStudyToast(fcReverseMode ? '🔄 Reverse mode on' : '🔄 Normal mode');
}

async function explainFlashcard() {
  const panel  = document.getElementById('fcExplainPanel');
  const body   = document.getElementById('fcExplainBody');
  const card   = fcCards[fcIndex];
  if (!panel || !body || !card) return;

  panel.style.display = 'block';
  body.innerHTML = '<span style="color:var(--text3)">Asking AI…</span>';

  try {
    const reply = await callStudyAI(
      'You are a helpful tutor. Give a clear, concise explanation in 3-5 sentences.',
      `Explain this concept:\nQuestion: ${card.front}\nAnswer: ${card.back}`
    );
    body.textContent = reply;
  } catch(e) {
    body.textContent = 'Failed to get explanation. Try again.';
  }
}

function closeExplainPanel() {
  const p = document.getElementById('fcExplainPanel');
  if (p) p.style.display = 'none';
}

// ── Save cards ──────────────────────────────────────────────────────
function saveSingleCard() {
  if (!fcCards.length) return;
  const card = fcCards[fcIndex];
  _addSrsCard(card.front, card.back, card.tag || fcCurrentTopic);
  _showStudyToast('💾 Card saved to Review deck!');
  _refreshSrsBadge();
}

function saveAllFlashcards() {
  if (!fcCards.length) return;
  const deckKey = 'deck_' + Date.now();
  try {
    const decks = (window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]')) || [];
    decks.unshift({ key: deckKey, topic: fcCurrentTopic, cards: fcCards, savedAt: Date.now() });
    if (decks.length > 20) decks.length = 20;
    if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_fc_decks', decks);
    else localStorage.setItem('nexora_fc_decks', JSON.stringify(decks));
  } catch(e) {}
  // Also add all to SRS
  fcCards.forEach(c => _addSrsCard(c.front, c.back, c.tag || fcCurrentTopic));
  _showStudyToast(`💾 ${fcCards.length} cards saved!`);
  _refreshSrsBadge();
  _renderSavedDecks();
}

function _renderSavedDecks() {
  const list = document.getElementById('fcSavedList');
  if (!list) return;
  let decks = [];
  try { decks = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]'); } catch(e) {}
  if (!decks.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text3);text-align:center;padding:12px 0;">No saved decks yet</div>';
    return;
  }
  list.innerHTML = decks.map((d, i) => `
    <div class="fc-saved-deck" onclick="loadSavedDeck(${i})">
      <div class="fc-saved-deck-icon">🃏</div>
      <div class="fc-saved-deck-info">
        <div class="fc-saved-deck-name">${_esc(d.topic)}</div>
        <div class="fc-saved-deck-meta">${d.cards.length} cards · ${_timeAgo(d.savedAt)}</div>
      </div>
      <div class="fc-deck-actions" onclick="event.stopPropagation()">
        <button class="fc-deck-action-btn share-btn" onclick="shareFlashcardDeck(${i})" title="Share deck link">🔗</button>
        <button class="fc-deck-action-btn anki-btn" onclick="exportDeckToAnki(${i})" title="Export to Anki">📥</button>
        <button class="fc-saved-deck-del" onclick="deleteSavedDeck(${i})" title="Delete deck">🗑️</button>
      </div>
    </div>
  `).join('');
}

function loadSavedDeck(idx) {
  let decks = [];
  try { decks = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]'); } catch(e) {}
  if (!decks[idx]) return;
  const d = decks[idx];
  fcCards = d.cards; fcIndex = 0; fcFlipped = false;
  fcReverseMode = false; fcCurrentTopic = d.topic;
  document.getElementById('fcTopicInput').value = d.topic;
  _renderFlashcardDeck();
}

function deleteSavedDeck(idx) {
  try {
    const decks = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]');
    decks.splice(idx, 1);
    if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_fc_decks', decks);
    else localStorage.setItem('nexora_fc_decks', JSON.stringify(decks));
    _renderSavedDecks();
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  QUIZ MODE
// ══════════════════════════════════════════════════════════════════════

async function generateQuiz() {
  const topic = (document.getElementById('quizTopicInput')?.value || '').trim();
  if (!topic) { _showStudyToast('⚠️ Enter a topic first'); return; }
  const count = parseInt(document.getElementById('quizCountSelect')?.value || '5');
  quizDifficulty = document.getElementById('quizDiffSelect')?.value || 'medium';

  const btn = document.getElementById('quizGenBtn');
  if (btn) btn.disabled = true;
  _showStudyLoading(`Generating ${count}-question quiz…`);

  const systemPrompt = `You are a quiz generator. Return ONLY a JSON array — no text outside it.
Each item: {"q":"<question>","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"A","explanation":"<1-2 sentence explanation of the correct answer>"}
Rules:
- Exactly 4 options labelled A) B) C) D)
- correct field is just the letter: A, B, C, or D
- Difficulty: ${quizDifficulty}
- Make distractors plausible`;

  const userPrompt = `Generate ${count} multiple choice questions about: ${topic}`;

  try {
    try {
      const raw = await callStudyAI(systemPrompt, userPrompt);
      quizQuestions = _parseStudyJSON(raw);
      if (!Array.isArray(quizQuestions) || !quizQuestions.length) throw new Error('Empty');
    } catch(err) {
      console.warn('Study Mode quiz AI failed, using local fallback:', err);
      const workerQuiz = window.NexoraData?.runWorkerTask
        ? await NexoraData.runWorkerTask('quiz', { topic, count, difficulty: quizDifficulty })
        : null;
      quizQuestions = Array.isArray(workerQuiz) && workerQuiz.length
        ? workerQuiz
        : _buildLocalQuiz(topic, count, quizDifficulty);
      _showStudyToast(isTimeoutError(err)
        ? '⚠️ AI took too long — used smart local quiz'
        : '⚠️ AI unavailable — used smart local quiz');
    }
    quizQuestions = quizQuestions.map(q => ({
      q:           q.q || q.question || '?',
      options:     Array.isArray(q.options) ? q.options : ['A) ?','B) ?','C) ?','D) ?'],
      correct:     (q.correct || 'A').toUpperCase().replace(/[^ABCD]/g,'').slice(0,1) || 'A',
      explanation: q.explanation || ''
    }));
    quizIndex   = 0;
    quizScore   = 0;
    quizAnswered = [];
    quizCurrentTopic = topic.slice(0, 30);
    _renderQuizQuestion();
    document.getElementById('quizSetup').style.display  = 'none';
    document.getElementById('quizActive').style.display = 'block';
    document.getElementById('quizReview').style.display = 'none';
  } catch(err) {
    _showStudyToast('❌ Failed to generate quiz — try again');
    console.error('Quiz gen error:', err);
  } finally {
    _hideStudyLoading();
    if (btn) btn.disabled = false;
  }
}

function _renderQuizQuestion() {
  const q = quizQuestions[quizIndex];
  if (!q) return;

  // Header
  document.getElementById('quizQCounter').textContent = `Q ${quizIndex + 1} / ${quizQuestions.length}`;
  const pct = (quizIndex / quizQuestions.length) * 100;
  document.getElementById('quizProgressFill').style.width = pct + '%';
  document.getElementById('quizScoreLive').textContent = quizScore + ' pts';

  // Question
  document.getElementById('quizQuestion').textContent = q.q;

  // Options
  const optWrap = document.getElementById('quizOptions');
  optWrap.innerHTML = q.options.map((opt, i) => `
    <button class="quiz-option-btn" onclick="quizAnswer(${i})">${_esc(opt)}</button>
  `).join('');

  document.getElementById('quizNextBtn').style.display = 'none';
}

function quizAnswer(choiceIdx) {
  const q = quizQuestions[quizIndex];
  const letters = ['A','B','C','D'];
  const chosen  = letters[choiceIdx];
  const correct = q.correct;
  const isRight = chosen === correct;

  if (isRight) quizScore++;
  quizAnswered.push({ q: q.q, chosen, correct, options: q.options, explanation: q.explanation, isRight });

  // Colour the buttons
  const btns = document.querySelectorAll('#quizOptions .quiz-option-btn');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (letters[i] === correct) btn.classList.add('correct');
    else if (i === choiceIdx && !isRight) btn.classList.add('wrong');
  });

  // Update score display
  document.getElementById('quizScoreLive').textContent = quizScore + ' pts';

  // Show next/finish button
  const nextBtn = document.getElementById('quizNextBtn');
  nextBtn.style.display = 'block';
  nextBtn.textContent = quizIndex < quizQuestions.length - 1 ? 'Next →' : 'See Results 🎉';
}

function quizNext() {
  quizIndex++;
  if (quizIndex < quizQuestions.length) {
    _renderQuizQuestion();
  } else {
    _renderQuizResults();
  }
}

function _renderQuizResults() {
  document.getElementById('quizActive').style.display = 'none';
  document.getElementById('quizReview').style.display = 'block';

  const total = quizQuestions.length;
  const pct   = Math.round((quizScore / total) * 100);

  const emoji = pct >= 80 ? '🎉' : pct >= 50 ? '🤔' : '😅';
  document.getElementById('quizResultEmoji').textContent = emoji;
  document.getElementById('quizResultScore').textContent = `${quizScore} / ${total}`;
  document.getElementById('quizResultSub').textContent   =
    pct >= 80 ? 'Excellent! You nailed it.' :
    pct >= 50 ? 'Good effort! Review the wrong ones.' :
                'Keep practicing — you\'ll get there!';

  // Review list
  const list = document.getElementById('quizReviewList');
  list.innerHTML = quizAnswered.map((a, i) => `
    <div class="quiz-review-item ${a.isRight ? 'correct' : 'wrong'}">
      <div class="quiz-review-q">${i+1}. ${_esc(a.q)}</div>
      ${!a.isRight ? `<div class="quiz-review-your">Your answer: ${a.chosen}</div>
        <div class="quiz-review-correct">✓ Correct: ${a.correct} — ${_esc(a.options['ABCD'.indexOf(a.correct)] || '')}</div>` : ''}
      ${a.explanation ? `<div class="quiz-review-your" style="margin-top:4px;font-style:italic">${_esc(a.explanation)}</div>` : ''}
      ${!a.isRight ? `<button class="quiz-re-explain-btn" data-quiz-index="${i}" onclick="quizReExplain(${i})">🧠 Re-explain</button>` : ''}
    </div>
  `).join('');

  // Save quiz result to localStorage
  try {
    const hist = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_quiz_hist', []) : JSON.parse(localStorage.getItem('nexora_quiz_hist') || '[]');
    hist.unshift({ topic: quizCurrentTopic, score: quizScore, total, pct, ts: Date.now(), diff: quizDifficulty });
    if (hist.length > 50) hist.length = 50;
    if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_quiz_hist', hist);
    else localStorage.setItem('nexora_quiz_hist', JSON.stringify(hist));
  } catch(e) {}
}

async function quizReExplain(idx) {
  const a   = quizAnswered[idx];
  const btn = document.querySelector(`.quiz-re-explain-btn[data-quiz-index="${idx}"]`);
  if (!a) return;
  if (btn) { btn.textContent = '⏳ Asking AI…'; btn.disabled = true; }
  try {
    const reply = await callStudyAI(
      'You are a patient tutor. Explain in 2-3 sentences why the correct answer is right.',
      `Question: ${a.q}\nCorrect answer: ${a.correct} — ${a.options['ABCD'.indexOf(a.correct)] || ''}`
    );
    if (btn) { btn.textContent = reply; btn.style.fontSize = '11px'; btn.style.cursor = 'default'; }
  } catch(e) {
    if (btn) { btn.textContent = '❌ Failed'; btn.disabled = false; }
  }
}

function retakeQuiz() {
  quizIndex = 0; quizScore = 0; quizAnswered = [];
  document.getElementById('quizReview').style.display  = 'none';
  document.getElementById('quizActive').style.display  = 'block';
  _renderQuizQuestion();
}

function newQuiz() {
  quizQuestions = [];
  document.getElementById('quizReview').style.display  = 'none';
  document.getElementById('quizActive').style.display  = 'none';
  document.getElementById('quizSetup').style.display   = 'block';
  document.getElementById('quizTopicInput').value      = '';
}

// ══════════════════════════════════════════════════════════════════════
//  SPACED REPETITION (SM-2 lite)
// ══════════════════════════════════════════════════════════════════════

function srsLoadCards() {
  try {
    srsCards = window.NexoraData?.getJSON ? NexoraData.getJSON(SRS_LS_KEY, []) : JSON.parse(localStorage.getItem(SRS_LS_KEY) || '[]');
  } catch(e) { srsCards = []; }
  _refreshSrsBadge();
}

function srsSaveCards() {
  try {
    if (window.NexoraData?.setJSON) NexoraData.setJSON(SRS_LS_KEY, srsCards);
    else localStorage.setItem(SRS_LS_KEY, JSON.stringify(srsCards));
  } catch(e) {}
}

// Add a new card (from flashcard save)
function _addSrsCard(front, back, tag) {
  // Avoid exact duplicates
  if (srsCards.some(c => c.front === front)) return;
  srsCards.push({
    id: Date.now() + Math.random(),
    front, back, tag: tag || '',
    interval: 1,      // days until next review
    ease: 2.5,        // ease factor (SM-2)
    reps: 0,
    next_review: Date.now() // due immediately
  });
  srsSaveCards();
}

function _refreshSrsBadge() {
  const now = Date.now();
  const due = srsCards.filter(c => c.next_review <= now).length;
  const badge = document.getElementById('srsDueBadge');
  if (!badge) return;
  if (due > 0) { badge.style.display = 'inline-flex'; badge.textContent = due > 99 ? '99+' : due; }
  else badge.style.display = 'none';
}

function _renderSrsState() {
  const now = Date.now();
  srsDue = srsCards.filter(c => c.next_review <= now);

  document.getElementById('srsEmpty').style.display      = srsCards.length === 0 ? 'block' : 'none';
  document.getElementById('srsAllDone').style.display    = srsCards.length > 0 && srsDue.length === 0 ? 'block' : 'none';
  document.getElementById('srsSession').style.display    = srsDue.length > 0 ? 'flex' : 'none';
  document.getElementById('srsBrowsePanel').style.display = 'none';

  if (srsDue.length === 0 && srsCards.length > 0) {
    // Find next due card
    const next = srsCards.reduce((a, b) => a.next_review < b.next_review ? a : b);
    const mins = Math.round((next.next_review - now) / 60000);
    const txt = mins < 60 ? `Next card in ${mins} min` :
                mins < 1440 ? `Next card in ${Math.round(mins/60)} hr` :
                `Next card in ${Math.round(mins/1440)} day(s)`;
    document.getElementById('srsNextDueText').textContent = txt;
  }

  if (srsDue.length > 0) {
    srsSessionIdx = 0;
    document.getElementById('srsSessionCount').textContent = `${srsDue.length} card${srsDue.length !== 1 ? 's' : ''} due`;
    // Streak
    const streak = _getSrsStreak();
    const sb = document.getElementById('srsStreakBadge');
    const sn = document.getElementById('srsStreakNum');
    if (streak > 0 && sb && sn) { sb.style.display = 'flex'; sn.textContent = streak; }
    _showSrsCard();
  }
}

function _showSrsCard() {
  const card = srsDue[srsSessionIdx];
  if (!card) { _srsSessionDone(); return; }

  document.getElementById('srsFrontText').textContent = card.front;
  document.getElementById('srsBackText').textContent  = card.back;

  const cardEl = document.getElementById('srsCard');
  if (cardEl) cardEl.classList.remove('flipped');
  document.getElementById('srsRatingRow').style.display = 'none';
}

function flipSrsCard() {
  const cardEl = document.getElementById('srsCard');
  if (!cardEl) return;
  cardEl.classList.add('flipped');
  document.getElementById('srsRatingRow').style.display = 'flex';
}

async function rateSrsCard(rating) {
  if (rateSrsCard._busy) return;
  rateSrsCard._busy = true;
  // rating: 0=hard, 1=okay, 2=easy
  const card = srsDue[srsSessionIdx];
  if (!card) { rateSrsCard._busy = false; return; }

  try {
    let updated = null;
    if (window.NexoraData?.runWorkerTask) {
      updated = await NexoraData.runWorkerTask('srs-review', { card, rating, now: Date.now() });
    }
    if (!updated) {
      const ease = Math.max(1.3, card.ease + [-0.3, 0, 0.1][rating]);
      let interval;
      if (rating === 0) {
        interval = 1; // reset to 1 day
        card.reps = 0;
      } else {
        card.reps++;
        interval = card.reps === 1 ? 1 :
                   card.reps === 2 ? 3 :
                   Math.round(card.interval * ease);
      }
      card.ease        = ease;
      card.interval    = interval;
      card.next_review = Date.now() + interval * 24 * 60 * 60 * 1000;
      updated = card;
    }

    // Persist
    const idx = srsCards.findIndex(c => c.id === updated.id);
    if (idx !== -1) srsCards[idx] = updated;
    if (srsDue[srsSessionIdx]) srsDue[srsSessionIdx] = updated;
    srsSaveCards();

    srsSessionIdx++;
    _refreshSrsBadge();

    if (srsSessionIdx >= srsDue.length) {
      _srsSessionDone();
    } else {
      _showSrsCard();
    }
  } finally {
    rateSrsCard._busy = false;
  }
}

function _srsSessionDone() {
  _recordSrsStreak();
  _renderSrsState();
}

function srsBrowseAll() {
  document.getElementById('srsAllDone').style.display    = 'none';
  document.getElementById('srsBrowsePanel').style.display = 'block';
  const list = document.getElementById('srsBrowseList');
  if (!list) return;
  if (!srsCards.length) { list.innerHTML = '<div style="color:var(--text3);font-size:12px">No cards</div>'; return; }
  list.innerHTML = srsCards.map(c => `
    <div class="srs-browse-card">
      <div class="srs-browse-card-q">${_esc(c.front)}</div>
      <div class="srs-browse-card-a">${_esc(c.back)}</div>
      <div class="srs-browse-card-meta">Interval: ${c.interval}d · Ease: ${c.ease?.toFixed(1)} · ${c.tag}</div>
    </div>
  `).join('');
}

function closeSrsBrowse() {
  document.getElementById('srsBrowsePanel').style.display = 'none';
  document.getElementById('srsAllDone').style.display     = srsCards.length > 0 ? 'block' : 'none';
}

// Daily streak tracking
function _getSrsStreak() {
  try {
    const d = window.NexoraData?.getJSON
      ? (NexoraData.getJSON('nexora_srs_streak', {}) || {})
      : JSON.parse(localStorage.getItem('nexora_srs_streak') || '{}');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (d.last === today) return d.streak || 0;
    if (d.last === yesterday) return d.streak || 0;
    return 0;
  } catch(e) { return 0; }
}
function _recordSrsStreak() {
  try {
    const d = window.NexoraData?.getJSON
      ? (NexoraData.getJSON('nexora_srs_streak', {}) || {})
      : JSON.parse(localStorage.getItem('nexora_srs_streak') || '{}');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    let streak = d.streak || 0;
    if (d.last === yesterday) streak++;
    else if (d.last !== today) streak = 1;
    if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_srs_streak', { last: today, streak });
    else localStorage.setItem('nexora_srs_streak', JSON.stringify({ last: today, streak }));
  } catch(e) {}
}

// ── Shared utils ──────────────────────────────────────────────────────
function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return Math.round(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.round(diff/3600000) + 'h ago';
  return Math.round(diff/86400000) + 'd ago';
}
function _showStudyToast(msg) {
  if (typeof _showKeyToast === 'function') { _showKeyToast(msg); return; }
  const t = document.getElementById('copyToast');
  if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
}
// ══════════════════════════════════════════════════════════════════════
//  NEXORA — NEW FEATURES v1.0
//  Drop this entire block at the END of app.js
//  Features:
//    1. 📊 Progress Dashboard
//    2. 📝 Summarizer (with dual-model compare)
//    3. 🎤 Mock Oral Exam / Viva Mode
//    4. 📄 PDF Export (SRS cards + Quiz results)
// ══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────
//  SHARED: Study time tracking
//  Auto-starts when Study Mode opens, saves on close
// ──────────────────────────────────────────────────────────────────────
const STUDY_TIME_LS  = 'nexora_study_time_log'; // [{ date:'2025-04-27', mins:12 }, …]
let _studySessionStart = null;

// Call this when Study Mode opens
function _studyTimeStart() {
  _studySessionStart = Date.now();
}

// Call this when Study Mode closes
function _studyTimeEnd() {
  if (!_studySessionStart) return;
  const mins = Math.round((Date.now() - _studySessionStart) / 60000);
  _studySessionStart = null;
  if (mins < 1) return; // skip tiny sessions
  try {
    const log  = window.NexoraData?.getJSON ? NexoraData.getJSON(STUDY_TIME_LS, []) : JSON.parse(localStorage.getItem(STUDY_TIME_LS) || '[]');
    const today = new Date().toDateString();
    const existing = log.find(e => e.date === today);
    if (existing) existing.mins += mins;
    else log.push({ date: today, mins });
    // keep 30 days
    while (log.length > 30) log.shift();
    if (window.NexoraData?.setJSON) NexoraData.setJSON(STUDY_TIME_LS, log);
    else localStorage.setItem(STUDY_TIME_LS, JSON.stringify(log));
  } catch(e) {}
}

// Patch the existing openStudyMode / closeStudyMode to track time
// Works by wrapping after they are already defined
(function patchStudyTimeTracking() {
  const origOpen  = window.openStudyMode;
  const origClose = window.closeStudyMode;
  window.openStudyMode = function() {
    _studyTimeStart();
    if (origOpen) origOpen();
  };
  window.closeStudyMode = function() {
    _studyTimeEnd();
    if (origClose) origClose();
  };
})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Nexora: Daily Reminder + Group Rooms                           ║
// ╚══════════════════════════════════════════════════════════════════╝
(function initNexoraCommunityFeatures() {
  'use strict';

  const LS_REMINDER_TIME = 'nexora_daily_reminder_time';
  const LS_REMINDER_EMAIL = 'nexora_daily_reminder_email';
  const LS_TUTOR_MODE = 'nexora_tutor_mode';
  const BACKEND_URL = (window._nexoraBackend && window._nexoraBackend.BACKEND_URL) || '';

  function reminderHint(msg, isError = false) {
    const el = document.getElementById('dailyReminderHint');
    if (!el) return;
    el.style.color = isError ? '#fda4af' : '#93c5fd';
    el.textContent = msg || '';
  }

  async function sendReminderEmailNow(email) {
    if (!BACKEND_URL || !email) return;
    try {
      await fetch(`${BACKEND_URL}/api/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          subject: 'Nexora Daily Reminder',
          message: 'You have cards due today. Keep your streak alive!',
        }),
      });
    } catch (e) {}
  }

  function scheduleDailyReminderAt(timeText) {
    if (dailyReminderTimer) {
      clearTimeout(dailyReminderTimer);
      dailyReminderTimer = null;
    }
    if (!timeText || !/^\d{2}:\d{2}$/.test(timeText)) return;
    const [hh, mm] = timeText.split(':').map(Number);
    const now = new Date();
    const next = new Date();
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();

    dailyReminderTimer = setTimeout(async () => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Nexora Reminder', {
          body: 'You have study tasks due today. Keep your streak alive!',
          icon: '/manifest.json',
        });
      }
      const email = localStorage.getItem(LS_REMINDER_EMAIL) || '';
      if (email) await sendReminderEmailNow(email);
      scheduleDailyReminderAt(timeText);
    }, ms);
  }

  window.saveDailyReminder = async function saveDailyReminder() {
    const time = (document.getElementById('dailyReminderTime')?.value || '').trim();
    const email = (document.getElementById('dailyReminderEmail')?.value || '').trim();
    if (!time) return reminderHint('Please select a reminder time.', true);
    localStorage.setItem(LS_REMINDER_TIME, time);
    localStorage.setItem(LS_REMINDER_EMAIL, email);
    const auth = window._nexoraAuth;
    const sb = auth?.getClient?.();
    const user = auth?.getUser?.();
    if (sb && user) {
      try {
        await sb.from('reminder_subscriptions').upsert({
          user_id: user.id,
          email,
          remind_time: time,
          enabled: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch (e) {}
    }
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    scheduleDailyReminderAt(time);
    reminderHint(`Saved. Daily reminder set at ${time}.`);
  };

  function appendGroupFeed(text) {
    const feed = document.getElementById('groupRoomFeed');
    if (!feed) return;
    const line = document.createElement('div');
    line.textContent = text;
    feed.appendChild(line);
    feed.scrollTop = feed.scrollHeight;
  }

  window.joinGroupRoom = async function joinGroupRoom() {
    const code = (document.getElementById('groupRoomCode')?.value || '').trim().toLowerCase();
    const status = document.getElementById('groupRoomStatus');
    if (!code) {
      if (status) status.textContent = 'Enter a room code first.';
      return;
    }
    const auth = window._nexoraAuth;
    const sb = auth?.getClient?.();
    const user = auth?.getUser?.();
    if (!sb || !user) {
      if (status) status.textContent = 'Login required for group rooms.';
      return;
    }
    if (groupChannel) {
      try { await sb.removeChannel(groupChannel); } catch (e) {}
      groupChannel = null;
    }
    activeGroupRoom = code;
    groupChannel = sb.channel(`group-room-${code}`);
    groupChannel.on('broadcast', { event: 'message' }, ({ payload }) => {
      appendGroupFeed(`${payload.name || 'Friend'}: ${payload.text || ''}`);
    });
    await groupChannel.subscribe();
    try {
      const { data } = await sb
        .from('group_room_messages')
        .select('display_name,message')
        .eq('room_code', code)
        .order('id', { ascending: false })
        .limit(20);
      const feed = document.getElementById('groupRoomFeed');
      if (feed) feed.innerHTML = '';
      (data || []).reverse().forEach(row => appendGroupFeed(`${row.display_name || 'Friend'}: ${row.message || ''}`));
    } catch (e) {}
    if (status) status.textContent = `Joined room: ${code}`;
    appendGroupFeed(`You joined room "${code}"`);
  };

  window.sendGroupMessage = async function sendGroupMessage() {
    const input = document.getElementById('groupRoomMsg');
    const text = (input?.value || '').trim();
    if (!text || !groupChannel) return;
    const name = (userName || 'Me').slice(0, 24);
    const auth = window._nexoraAuth;
    const sb = auth?.getClient?.();
    const user = auth?.getUser?.();
    if (sb && user && activeGroupRoom) {
      try {
        await sb.from('group_room_messages').insert({
          room_code: activeGroupRoom,
          user_id: user.id,
          display_name: name,
          message: text,
        });
      } catch (e) {}
    }
    await groupChannel.send({
      type: 'broadcast',
      event: 'message',
      payload: { name, text },
    });
    if (input) input.value = '';
  };

  function bootstrapCommunityUI() {
    const savedTime = localStorage.getItem(LS_REMINDER_TIME) || '';
    const savedEmail = localStorage.getItem(LS_REMINDER_EMAIL) || '';
    const t = document.getElementById('dailyReminderTime');
    const e = document.getElementById('dailyReminderEmail');
    if (t && savedTime) t.value = savedTime;
    if (e && savedEmail) e.value = savedEmail;
    if (savedTime) scheduleDailyReminderAt(savedTime);

    tutorModeEnabled = localStorage.getItem(LS_TUTOR_MODE) === '1';
    const el = document.getElementById('mode-tutor-toggle');
    if (el) el.innerHTML = `<span>🧠</span> Tutor Mode: ${tutorModeEnabled ? 'ON' : 'OFF'}`;
  }

  const oldToggleTutorMode = window.toggleTutorMode;
  window.toggleTutorMode = function toggleTutorModePersisted() {
    oldToggleTutorMode();
    localStorage.setItem(LS_TUTOR_MODE, tutorModeEnabled ? '1' : '0');
  };
  // Re-expose the menu variant so HTML onclick still works after this IIFE
  window.toggleTutorModeFromMenu = function() {
    if (menuOpen) toggleMenu();
    window.toggleTutorMode();
  };

  if (document.readyState === 'complete') bootstrapCommunityUI();
  else window.addEventListener('load', bootstrapCommunityUI);
})();

// ══════════════════════════════════════════════════════════════════════
//  1. 📊 PROGRESS DASHBOARD
// ══════════════════════════════════════════════════════════════════════

function openProgressDashboard() {
  // Close menu if open
  if (typeof menuOpen !== 'undefined' && menuOpen) {
    menuOpen = false;
    const mt = document.getElementById('modeToggle');
    if (mt) mt.classList.remove('open');
  }

  _renderDashboard();
  const overlay = document.getElementById('progressDashboard');
  if (overlay) overlay.classList.add('open');
}

function closeProgressDashboard() {
  const overlay = document.getElementById('progressDashboard');
  if (overlay) overlay.classList.remove('open');
}

function _renderDashboard() {
  // ── Gather data ──────────────────────────────────────────────
  // SRS cards
  let srsTotal = 0, srsMastered = 0, srsWeekReviewed = 0;
  try {
    const cards = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]');
    srsTotal     = cards.length;
    srsMastered  = cards.filter(c => c.interval >= 7).length;
    const weekAgo = Date.now() - 7 * 86400000;
    // Count cards whose next_review was updated in the last 7 days (reps > 0 and recently active)
    // We approximate using interval/ease as a proxy for reviewed cards
    srsWeekReviewed = cards.filter(c => c.reps > 0).length;
  } catch(e) {}

  // SRS streak
  let srsStreak = 0;
  try {
    const d = window.NexoraData?.getJSON
      ? (NexoraData.getJSON('nexora_srs_streak', {}) || {})
      : JSON.parse(localStorage.getItem('nexora_srs_streak') || '{}');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (d.last === today || d.last === yesterday) srsStreak = d.streak || 0;
  } catch(e) {}

  // Quiz history
  let quizSessions = [], quizAvgPct = 0, quizBestPct = 0, quizTopTopics = [];
  try {
    quizSessions = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_quiz_hist', []) : JSON.parse(localStorage.getItem('nexora_quiz_hist') || '[]');
    if (quizSessions.length) {
      const last5 = quizSessions.slice(0, 5);
      quizAvgPct  = Math.round(last5.reduce((a, b) => a + (b.pct || 0), 0) / last5.length);
      quizBestPct = Math.max(...quizSessions.map(s => s.pct || 0));
      // Most quizzed topics
      const topicCounts = {};
      quizSessions.forEach(s => { if (s.topic) topicCounts[s.topic] = (topicCounts[s.topic] || 0) + 1; });
      quizTopTopics = Object.entries(topicCounts).sort((a,b) => b[1]-a[1]).slice(0,3).map(([t]) => t);
    }
  } catch(e) {}

  // Study time (last 7 days)
  let totalStudyMins = 0, studyDaysThisWeek = 0;
  const weeklyMinsByDay = {}; // { 'Mon': 25, … }
  try {
    const log = window.NexoraData?.getJSON ? NexoraData.getJSON(STUDY_TIME_LS, []) : JSON.parse(localStorage.getItem(STUDY_TIME_LS) || '[]');
    const weekAgo = Date.now() - 7 * 86400000;
    log.forEach(entry => {
      const d = new Date(entry.date);
      if (d.getTime() >= weekAgo) {
        totalStudyMins += entry.mins;
        studyDaysThisWeek++;
        const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
        weeklyMinsByDay[dayLabel] = (weeklyMinsByDay[dayLabel] || 0) + entry.mins;
      }
    });
  } catch(e) {}

  // ── Build mini bar chart (7 day study time) ──────────────────
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayIdx = new Date().getDay();
  const orderedDays = [];
  for (let i = 6; i >= 0; i--) {
    orderedDays.push(days[(todayIdx - i + 7) % 7]);
  }
  const maxMins  = Math.max(...orderedDays.map(d => weeklyMinsByDay[d] || 0), 1);
  const barsHTML = orderedDays.map(d => {
    const mins = weeklyMinsByDay[d] || 0;
    const pct  = Math.round((mins / maxMins) * 100);
    const isToday = d === days[todayIdx];
    return `<div class="dash-bar-col">
      <div class="dash-bar-wrap">
        <div class="dash-bar-fill ${isToday ? 'today' : ''}" style="height:${Math.max(pct, mins > 0 ? 8 : 0)}%"
             title="${mins} min"></div>
      </div>
      <div class="dash-bar-label ${isToday ? 'today' : ''}">${d}</div>
    </div>`;
  }).join('');

  // ── Quiz accuracy mini sparkline ──────────────────────────────
  const last5Quiz = quizSessions.slice(0, 5).reverse();
  let sparkHTML = '';
  if (last5Quiz.length >= 2) {
    const pts = last5Quiz.map(s => s.pct || 0);
    const maxP = Math.max(...pts, 1);
    const w = 100 / (pts.length - 1);
    const polyPoints = pts.map((p, i) => `${i * w},${100 - (p / maxP) * 80}`).join(' ');
    sparkHTML = `<svg class="dash-spark" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${polyPoints}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map((p,i) => `<circle cx="${i*w}" cy="${100-(p/maxP)*80}" r="4" fill="var(--primary)"/>`).join('')}
    </svg>`;
  } else {
    sparkHTML = `<div class="dash-no-data">Complete 2+ quizzes to see trend</div>`;
  }

  // ── Render HTML ───────────────────────────────────────────────
  const body = document.getElementById('dashboardBody');
  if (!body) return;

  const dashboardInsight = srsStreak >= 3
    ? '🔥 Your streak is building momentum. Keep the rhythm going.'
    : quizAvgPct >= 80
      ? '🎯 Your quiz scores are strong this week. Keep sharpening them.'
      : totalStudyMins >= 90
        ? '📈 You already put in real time this week. One more session will move the trend.'
        : '🌱 Small daily sessions compound fast. One focused block changes the shape of progress.';

  body.innerHTML = `
    <div class="dash-hero-banner">
      <div class="dash-hero-copy">
        <div class="dash-hero-kicker">📊 Your Learning Insights</div>
        <div class="dash-hero-title">Track your growth over time</div>
        <div class="dash-hero-sub">${_esc(dashboardInsight)}</div>
      </div>
      <div class="dash-hero-ring" aria-hidden="true"></div>
    </div>

    <!-- Row 1: key stats -->
    <div class="dash-grid-3">
      <div class="dash-stat-card hero">
        <div class="dash-stat-icon">🔁</div>
        <div class="dash-stat-val">${srsStreak}</div>
        <div class="dash-stat-label">Day Streak</div>
        <div class="dash-stat-note">${_esc(dashboardInsight)}</div>
      </div>
      <div class="dash-stat-card secondary">
        <div class="dash-stat-icon">🃏</div>
        <div class="dash-stat-val">${srsTotal}</div>
        <div class="dash-stat-label">Cards Saved</div>
      </div>
      <div class="dash-stat-card tertiary">
        <div class="dash-stat-icon">⏱️</div>
        <div class="dash-stat-val">${totalStudyMins}</div>
        <div class="dash-stat-label">Mins This Week</div>
      </div>
    </div>

    <!-- Row 2: SRS progress -->
    <div class="dash-section">
      <div class="dash-section-title">🃏 Flashcard Progress</div>
      <div class="dash-progress-row">
        <div class="dash-progress-label"><span>Mastered</span><span>${srsMastered} / ${srsTotal}</span></div>
        <div class="dash-progress-track">
          <div class="dash-progress-bar" style="width:${srsTotal ? Math.round(srsMastered/srsTotal*100) : 0}%"></div>
        </div>
      </div>
      <div class="dash-progress-row" style="margin-top:8px">
        <div class="dash-progress-label"><span>Reviewed</span><span>${srsWeekReviewed} cards</span></div>
        <div class="dash-progress-track">
          <div class="dash-progress-bar secondary" style="width:${srsTotal ? Math.min(Math.round(srsWeekReviewed/srsTotal*100),100) : 0}%"></div>
        </div>
      </div>
    </div>

    <!-- Row 3: Quiz accuracy -->
    <div class="dash-section">
      <div class="dash-section-title">📝 Quiz Accuracy <span class="dash-section-sub">(last 5 sessions)</span></div>
      <div class="dash-quiz-stats">
        <div class="dash-quiz-stat"><div class="dash-quiz-val">${quizSessions.length}</div><div class="dash-quiz-lab">Quizzes</div></div>
        <div class="dash-quiz-stat"><div class="dash-quiz-val">${quizAvgPct}%</div><div class="dash-quiz-lab">Avg Score</div></div>
        <div class="dash-quiz-stat"><div class="dash-quiz-val">${quizBestPct}%</div><div class="dash-quiz-lab">Best Score</div></div>
      </div>
      <div class="dash-spark-wrap">${sparkHTML}</div>
      ${quizTopTopics.length ? `<div class="dash-topics-row">${quizTopTopics.map(t => `<span class="dash-topic-chip">${t}</span>`).join('')}</div>` : ''}
    </div>

    <!-- Row 4: Weekly study chart -->
    <div class="dash-section">
      <div class="dash-section-title">⏱️ Study Time — Last 7 Days</div>
      <div class="dash-bar-chart">${barsHTML}</div>
      <div class="dash-study-footer">${studyDaysThisWeek} active day${studyDaysThisWeek !== 1 ? 's' : ''} · ${totalStudyMins} total mins</div>
    </div>

    <!-- Row 5: recent quiz history -->
    ${quizSessions.length ? `
    <div class="dash-section">
      <div class="dash-section-title">📋 Recent Quizzes</div>
      <div class="dash-quiz-hist">
        ${quizSessions.slice(0, 6).map(s => `
          <div class="dash-quiz-hist-row">
            <span class="dash-quiz-hist-topic">${_esc(s.topic || 'Quiz')}</span>
            <span class="dash-quiz-hist-diff ${s.diff || ''}">${s.diff || ''}</span>
            <span class="dash-quiz-hist-score ${s.pct >= 80 ? 'good' : s.pct >= 50 ? 'mid' : 'low'}">${s.pct}%</span>
            <span class="dash-quiz-hist-time">${_timeAgo(s.ts)}</span>
          </div>
        `).join('')}
      </div>
    </div>` : ''}
  `;
}


// ══════════════════════════════════════════════════════════════════════
//  2. 📝 SUMMARIZER (with dual-model compare)
// ══════════════════════════════════════════════════════════════════════

function openSummarizer() {
  if (typeof menuOpen !== 'undefined' && menuOpen) {
    menuOpen = false;
    const mt = document.getElementById('modeToggle');
    if (mt) mt.classList.remove('open');
  }
  const overlay = document.getElementById('summarizerPanel');
  if (overlay) overlay.classList.add('open');
  // Reset
  const ta = document.getElementById('summarizerInput');
  if (ta) ta.value = '';
  document.getElementById('summarizerOutput').innerHTML = '';
  document.getElementById('summarizerOutput').style.display = 'none';
}

function closeSummarizer() {
  const overlay = document.getElementById('summarizerPanel');
  if (overlay) overlay.classList.remove('open');
}

async function runSummarizer() {
  const text   = (document.getElementById('summarizerInput')?.value || '').trim();
  const mode   = document.getElementById('summarizerMode')?.value || 'bullet';
  const compare = document.getElementById('summarizerCompare')?.checked;

  if (!text || text.length < 40) {
    _showStudyToast('Please paste at least a sentence or two to summarize.');
    return;
  }

  const btn = document.getElementById('summarizerRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Summarizing…'; }

  const modeDesc = {
    bullet:   'Summarize into clear bullet points. Be concise.',
    paragraph:'Write a concise paragraph summary in plain English.',
    eli5:     'Explain this in simple terms a 12-year-old would understand.',
    key:      'Extract only the key terms and their one-line definitions.',
    tldr:     'Write a 2-sentence TL;DR.',
  }[mode] || 'Summarize concisely.';

  const systemPrompt = `You are an expert study assistant. ${modeDesc} Keep your response focused and well-structured. Do not add preamble like "Sure!" or "Here is a summary".`;
  const userPrompt   = `Text to summarize:\n\n${text.slice(0, 4000)}`;

  const out = document.getElementById('summarizerOutput');
  out.style.display = 'block';
  out.innerHTML = `<div class="sum-loading">⏳ Generating summary…</div>`;

  if (!compare) {
    // Single model
    try {
      const reply = await callStudyAI(systemPrompt, userPrompt);
      out.innerHTML = _renderSummaryCard('✨ Summary', reply, studyAIKey);
    } catch(e) {
      out.innerHTML = `<div class="sum-error">❌ Failed to summarize. Check your AI key.</div>`;
    }
  } else {
    // Dual model compare: current study AI + a second one
    out.innerHTML = `
      <div class="sum-compare-grid">
        <div id="sumCard1" class="sum-card-wrap"><div class="sum-loading">⏳ Model 1…</div></div>
        <div id="sumCard2" class="sum-card-wrap"><div class="sum-loading">⏳ Model 2…</div></div>
      </div>`;

    // Run both in parallel
    const model1Key = studyAIKey;
    // Pick a different second model
    const allOptions = typeof getStudyAIOptions === 'function' ? getStudyAIOptions() : [];
    const model2Opt  = allOptions.find(o => o.key !== model1Key) || allOptions[0];
    const model2Key  = model2Opt?.key || 'gemini';

    const origKey = studyAIKey;

    const p1 = callStudyAI(systemPrompt, userPrompt).then(r => {
      document.getElementById('sumCard1').innerHTML = _renderSummaryCard(
        (typeof CMP_MODELS !== 'undefined' ? CMP_MODELS[model1Key]?.label : model1Key) || model1Key, r, model1Key);
    }).catch(() => {
      document.getElementById('sumCard1').innerHTML = `<div class="sum-error">❌ Model 1 failed.</div>`;
    });

    // Temporarily swap key to get model 2
    const p2 = (async () => {
      studyAIKey = model2Key;
      try {
        const r = await callStudyAI(systemPrompt, userPrompt);
        document.getElementById('sumCard2').innerHTML = _renderSummaryCard(
          (typeof CMP_MODELS !== 'undefined' ? CMP_MODELS[model2Key]?.label : model2Key) || model2Key, r, model2Key);
      } catch(e) {
        document.getElementById('sumCard2').innerHTML = `<div class="sum-error">❌ Model 2 failed.</div>`;
      } finally {
        studyAIKey = origKey;
      }
    })();

    await Promise.allSettled([p1, p2]);
  }

  if (btn) { btn.disabled = false; btn.textContent = '✨ Summarize'; }
}

function _renderSummaryCard(label, text, modelKey) {
  const color = (typeof CMP_MODELS !== 'undefined' && CMP_MODELS[modelKey]?.color) || 'var(--primary)';
  const rendered = (window.marked && text) ? marked.parse(text) : _esc(text || '').replace(/\n/g, '<br>');
  return `<div class="sum-card">
    <div class="sum-card-header" style="border-left:3px solid ${color}">
      <span class="sum-card-model">${_esc(label)}</span>
      <button class="sum-copy-btn" onclick="(function(b){
        const txt = b.closest('.sum-card').querySelector('.sum-card-body').innerText;
        navigator.clipboard.writeText(txt).then(()=>{b.textContent='✓ Copied';setTimeout(()=>{b.textContent='Copy'},1800)});
      })(this)">Copy</button>
    </div>
    <div class="sum-card-body">${rendered}</div>
  </div>`;
}


// ══════════════════════════════════════════════════════════════════════
//  3. 🎤 MOCK ORAL EXAM / VIVA MODE
// ══════════════════════════════════════════════════════════════════════

let vivaQuestions   = [];   // [{ q, critique, score, userAnswer }]
let vivaIndex       = 0;
let vivaTopic       = '';
let vivaAnswering   = false; // waiting for user answer
let vivaSessionDone = false;

function openViva() {
  if (typeof menuOpen !== 'undefined' && menuOpen) {
    menuOpen = false;
    const mt = document.getElementById('modeToggle');
    if (mt) mt.classList.remove('open');
  }
  _vivaReset();
  const overlay = document.getElementById('vivaPanel');
  if (overlay) overlay.classList.add('open');
}

function closeViva() {
  const overlay = document.getElementById('vivaPanel');
  if (overlay) overlay.classList.remove('open');
  // Stop voice if active
  if (typeof stopMic === 'function') stopMic();
  if (typeof stopSpeaking === 'function') stopSpeaking();
}

function _vivaReset() {
  vivaQuestions   = [];
  vivaIndex       = 0;
  vivaTopic       = '';
  vivaAnswering   = false;
  vivaSessionDone = false;
  _vivaShowSetup();
}

function _vivaShowSetup() {
  document.getElementById('vivaSetup').style.display     = 'block';
  document.getElementById('vivaSession').style.display   = 'none';
  document.getElementById('vivaResults').style.display   = 'none';
  const inp = document.getElementById('vivaTopicInput');
  if (inp) { inp.value = ''; inp.focus(); }
}

async function startViva() {
  const topicEl = document.getElementById('vivaTopicInput');
  const qCount  = parseInt(document.getElementById('vivaQCount')?.value || '5', 10);
  const level   = document.getElementById('vivaLevel')?.value || 'undergraduate';
  vivaTopic     = (topicEl?.value || '').trim();

  if (!vivaTopic) { _showStudyToast('Please enter a topic.'); return; }

  const btn = document.getElementById('vivaStartBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing questions…'; }

  const systemPrompt = `You are a strict but fair university examiner conducting a viva voce oral exam. Generate exactly ${qCount} open-ended exam questions on the topic provided. Each question should test deep understanding, not just recall. Questions should be appropriate for ${level} level. Format your response as JSON only — an array of strings, no other text. Example: ["Question 1?","Question 2?"]`;
  const userPrompt   = `Topic: ${vivaTopic}\nGenerate ${qCount} viva questions.`;

  try {
    const raw = await callStudyAI(systemPrompt, userPrompt);
    // Parse JSON from response
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON found');
    const qs = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(qs) || qs.length === 0) throw new Error('Empty array');
    vivaQuestions = qs.slice(0, qCount).map(q => ({ q: String(q), userAnswer: '', critique: '', score: 0 }));
    vivaIndex = 0;
    _vivaShowSession();
  } catch(e) {
    // Fallback: generic questions
    vivaQuestions = [
      { q: `Define the core concept of ${vivaTopic} in your own words.`, userAnswer:'', critique:'', score:0 },
      { q: `What are the main components or principles of ${vivaTopic}?`, userAnswer:'', critique:'', score:0 },
      { q: `Give a real-world example that illustrates ${vivaTopic}.`, userAnswer:'', critique:'', score:0 },
      { q: `What are the limitations or drawbacks of ${vivaTopic}?`, userAnswer:'', critique:'', score:0 },
      { q: `How does ${vivaTopic} compare to an alternative approach?`, userAnswer:'', critique:'', score:0 },
    ].slice(0, qCount);
    vivaIndex = 0;
    _vivaShowSession();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎤 Start Exam'; }
  }
}

function _vivaShowSession() {
  document.getElementById('vivaSetup').style.display   = 'none';
  document.getElementById('vivaSession').style.display = 'block';
  document.getElementById('vivaResults').style.display = 'none';
  _vivaRenderQuestion();
}

function _vivaRenderQuestion() {
  const q = vivaQuestions[vivaIndex];
  if (!q) { _vivaShowResults(); return; }

  const progress = `Q${vivaIndex + 1} of ${vivaQuestions.length}`;
  document.getElementById('vivaProgress').textContent = progress;
  document.getElementById('vivaProgressFill').style.width = `${((vivaIndex) / vivaQuestions.length) * 100}%`;
  document.getElementById('vivaQuestion').textContent = q.q;
  document.getElementById('vivaAnswerInput').value = '';
  document.getElementById('vivaCritique').style.display = 'none';
  document.getElementById('vivaSubmitRow').style.display = 'flex';
  document.getElementById('vivaNextRow').style.display   = 'none';
  vivaAnswering = true;
}

async function submitVivaAnswer() {
  const ans = (document.getElementById('vivaAnswerInput')?.value || '').trim();
  if (!ans) { _showStudyToast('Please write your answer before submitting.'); return; }

  const q = vivaQuestions[vivaIndex];
  q.userAnswer = ans;
  vivaAnswering = false;

  const submitBtn = document.getElementById('vivaSubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Evaluating…'; }

  const systemPrompt = `You are a strict but constructive university examiner. Evaluate the student's answer to a viva question. Respond ONLY with a JSON object: {"score": <0-10>, "critique": "<2-3 sentence evaluation mentioning what was good, what was missing, and the ideal answer>"}. No other text.`;
  const userPrompt   = `Topic: ${vivaTopic}\nQuestion: ${q.q}\nStudent's answer: ${ans}`;

  try {
    const raw  = await callStudyAI(systemPrompt, userPrompt);
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    q.score    = Math.max(0, Math.min(10, parseInt(json.score || 0, 10)));
    q.critique = json.critique || 'No critique returned.';
  } catch(e) {
    q.score    = 5;
    q.critique = 'Could not evaluate automatically. Review your answer and compare with course materials.';
  }

  // Show critique
  const critiqueEl = document.getElementById('vivaCritique');
  const scoreEl    = document.getElementById('vivaCritiqueScore');
  const textEl     = document.getElementById('vivaCritiqueText');

  const scoreClass = q.score >= 8 ? 'good' : q.score >= 5 ? 'mid' : 'low';
  if (scoreEl) { scoreEl.textContent = `${q.score}/10`; scoreEl.className = `viva-score-badge ${scoreClass}`; }
  if (textEl)  textEl.textContent = q.critique;
  if (critiqueEl) critiqueEl.style.display = 'block';

  document.getElementById('vivaSubmitRow').style.display = 'none';
  document.getElementById('vivaNextRow').style.display   = 'flex';

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '✅ Submit Answer'; }
}

function vivaNext() {
  vivaIndex++;
  if (vivaIndex >= vivaQuestions.length) {
    _vivaShowResults();
  } else {
    _vivaRenderQuestion();
  }
}

function _vivaShowResults() {
  document.getElementById('vivaSession').style.display = 'none';
  document.getElementById('vivaResults').style.display = 'block';
  document.getElementById('vivaProgressFill').style.width = '100%';

  const answered = vivaQuestions.filter(q => q.userAnswer);
  const total    = answered.length;
  const avgScore = total ? Math.round(answered.reduce((a,b) => a + b.score, 0) / total * 10) : 0;

  const grade = avgScore >= 80 ? 'Distinction 🎓' : avgScore >= 65 ? 'Merit 🌟' : avgScore >= 50 ? 'Pass ✅' : 'Needs Work 📚';
  document.getElementById('vivaGrade').textContent       = grade;
  document.getElementById('vivaFinalScore').textContent  = `${avgScore}%`;
  document.getElementById('vivaFinalTopic').textContent  = vivaTopic;

  const reviewList = document.getElementById('vivaReviewList');
  if (reviewList) {
    reviewList.innerHTML = vivaQuestions.map((q, i) => `
      <div class="viva-review-item">
        <div class="viva-review-q"><span class="viva-review-num">Q${i+1}</span> ${_esc(q.q)}</div>
        ${q.userAnswer ? `
          <div class="viva-review-answer">${_esc(q.userAnswer)}</div>
          <div class="viva-review-critique">
            <span class="viva-score-badge ${q.score>=8?'good':q.score>=5?'mid':'low'}">${q.score}/10</span>
            <span>${_esc(q.critique)}</span>
          </div>
        ` : `<div class="viva-review-answer" style="color:var(--text3)">Not answered</div>`}
      </div>
    `).join('');
  }
}

function vivaRetry() { _vivaReset(); }

// Optional: voice input for viva answer
function vivaToggleMic() {
  const btn = document.getElementById('vivaMicBtn');
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    _showStudyToast('Voice input not supported in this browser.');
    return;
  }
  // Reuse existing recognition if available, else create
  if (window._vivaRecognition && window._vivaRecognition._active) {
    window._vivaRecognition.stop();
    window._vivaRecognition._active = false;
    if (btn) btn.classList.remove('active');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec._active = true;
  rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const ta = document.getElementById('vivaAnswerInput');
    if (ta) ta.value = (ta.value ? ta.value + ' ' : '') + transcript;
    rec._active = false;
    if (btn) btn.classList.remove('active');
  };
  rec.onerror = () => { rec._active = false; if (btn) btn.classList.remove('active'); };
  rec.onend   = () => { rec._active = false; if (btn) btn.classList.remove('active'); };
  window._vivaRecognition = rec;
  rec.start();
  if (btn) btn.classList.add('active');
  _showStudyToast('🎤 Listening… speak your answer.');
}


// ══════════════════════════════════════════════════════════════════════
//  4. 📄 PDF EXPORT
//  Pure browser — no external libs needed (uses window.print with
//  a hidden iframe + custom print CSS injected inline)
// ══════════════════════════════════════════════════════════════════════

function exportSRStoPDF() {
  let cards = [];
  try { cards = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]'); } catch(e) {}
  if (!cards.length) { _showStudyToast('No saved cards to export.'); return; }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Nexora Flashcards</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; padding: 32px; }
  h1 { font-size: 22px; margin-bottom: 4px; color: #7c5cff; }
  .meta { font-size: 12px; color: #888; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px; break-inside: avoid; }
  .card-num { font-size: 10px; color: #aaa; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
  .card-q { font-size: 13px; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; line-height: 1.4; }
  .card-a { font-size: 12px; color: #444; border-top: 1px solid #f0f0f0; padding-top: 8px; line-height: 1.5; }
  .card-meta { font-size: 10px; color: #bbb; margin-top: 6px; }
  .tag { display:inline-block; background:#f3f0ff; color:#7c5cff; border-radius:4px; padding:1px 6px; font-size:10px; }
  @media print {
    body { padding: 16px; }
    .cards { grid-template-columns: 1fr 1fr; }
  }
</style></head><body>
<h1>📚 Nexora Flashcards</h1>
<div class="meta">Exported ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} · ${cards.length} cards</div>
<div class="cards">
  ${cards.map((c, i) => `
    <div class="card">
      <div class="card-num">Card ${i + 1} ${c.tag ? `<span class="tag">${_esc(c.tag)}</span>` : ''}</div>
      <div class="card-q">${_esc(c.front)}</div>
      <div class="card-a">${_esc(c.back)}</div>
      <div class="card-meta">Interval: ${c.interval}d · Ease: ${(c.ease||2.5).toFixed(1)} · Reps: ${c.reps||0}</div>
    </div>
  `).join('')}
</div>
</body></html>`;

  _printHTML(html, 'Nexora_Flashcards');
}

function exportQuizToPDF() {
  let hist = [];
  try { hist = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_quiz_hist', []) : JSON.parse(localStorage.getItem('nexora_quiz_hist') || '[]'); } catch(e) {}
  if (!hist.length) { _showStudyToast('No quiz history to export.'); return; }

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Nexora Quiz History</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; padding: 32px; }
  h1 { font-size: 22px; margin-bottom: 4px; color: #7c5cff; }
  .meta { font-size: 12px; color: #888; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #7c5cff; color: #fff; padding: 10px 12px; text-align: left; font-size: 12px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
  tr:nth-child(even) td { background: #fafafa; }
  .score-good { color: #16a34a; font-weight: 700; }
  .score-mid  { color: #ca8a04; font-weight: 700; }
  .score-low  { color: #dc2626; font-weight: 700; }
  .diff { display:inline-block; font-size:10px; padding:2px 8px; border-radius:4px; background:#f3f0ff; color:#7c5cff; }
  .summary { margin-top: 24px; padding: 16px; background: #f8f7ff; border-radius: 10px; border: 1px solid #e9e4ff; }
  .summary h3 { font-size: 14px; color: #7c5cff; margin-bottom: 10px; }
  .sum-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
  .sum-stat { text-align: center; }
  .sum-val { font-size: 24px; font-weight: 700; color: #7c5cff; }
  .sum-lab { font-size: 11px; color: #888; }
  @media print { body { padding: 16px; } }
</style></head><body>
<h1>📝 Nexora Quiz History</h1>
<div class="meta">Exported ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} · ${hist.length} sessions</div>

<div class="summary">
  <h3>📊 Overall Stats</h3>
  <div class="sum-grid">
    <div class="sum-stat"><div class="sum-val">${hist.length}</div><div class="sum-lab">Total Quizzes</div></div>
    <div class="sum-stat"><div class="sum-val">${Math.round(hist.reduce((a,b)=>a+(b.pct||0),0)/hist.length)}%</div><div class="sum-lab">Average Score</div></div>
    <div class="sum-stat"><div class="sum-val">${Math.max(...hist.map(s=>s.pct||0))}%</div><div class="sum-lab">Best Score</div></div>
  </div>
</div>

<table style="margin-top:20px">
  <thead><tr><th>#</th><th>Topic</th><th>Score</th><th>Questions</th><th>Difficulty</th><th>Date</th></tr></thead>
  <tbody>
    ${hist.map((s,i) => `<tr>
      <td>${i+1}</td>
      <td>${_esc(s.topic||'—')}</td>
      <td class="${s.pct>=80?'score-good':s.pct>=50?'score-mid':'score-low'}">${s.pct}%</td>
      <td>${s.total||'—'}</td>
      <td><span class="diff">${_esc(s.diff||'medium')}</span></td>
      <td>${new Date(s.ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
    </tr>`).join('')}
  </tbody>
</table>
</body></html>`;

  _printHTML(html, 'Nexora_Quiz_History');
}

function _printHTML(html, title) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;';
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {}
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 600);
  _showStudyToast('📄 Opening print dialog…');
}


// ══════════════════════════════════════════════════════════════════════
//  PATCH: Add new tabs to switchStudyTab
// ══════════════════════════════════════════════════════════════════════
(function patchSwitchStudyTab() {
  const orig = window.switchStudyTab;
  window.switchStudyTab = function(tab) {
    if (tab === 'summarizer') {
      document.querySelectorAll('.study-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.study-panel').forEach(p => p.classList.remove('active'));
      const tabBtn = document.getElementById('stab-summarizer');
      const panel  = document.getElementById('spanel-summarizer');
      if (tabBtn) tabBtn.classList.add('active');
      if (panel)  panel.classList.add('active');
      studyCurrentTab = 'summarizer';
      return;
    }
    if (tab === 'viva') {
      document.querySelectorAll('.study-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.study-panel').forEach(p => p.classList.remove('active'));
      const tabBtn = document.getElementById('stab-viva');
      const panel  = document.getElementById('spanel-viva');
      if (tabBtn) tabBtn.classList.add('active');
      if (panel)  panel.classList.add('active');
      studyCurrentTab = 'viva';
      _vivaReset();
      return;
    }
    if (orig) orig(tab);
  };
})();

// ══════════════════════════════════════════════════════════════════════
//  PDF EXPORT — Viva Session Results
// ══════════════════════════════════════════════════════════════════════
function exportVivaToPDF() {
  if (!vivaQuestions.length) { _showStudyToast('No viva session to export.'); return; }
  const answered = vivaQuestions.filter(q => q.userAnswer);
  const avgScore = answered.length
    ? Math.round(answered.reduce((a, b) => a + b.score, 0) / answered.length * 10) : 0;
  const grade = avgScore >= 80 ? 'Distinction' : avgScore >= 65 ? 'Merit' : avgScore >= 50 ? 'Pass' : 'Needs Work';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Nexora Viva Results</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; padding: 32px; }
  h1 { font-size: 22px; color: #7c5cff; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #888; margin-bottom: 20px; }
  .summary { display: flex; gap: 20px; background: #f8f7ff; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; border: 1px solid #e9e4ff; }
  .sum-stat { text-align: center; }
  .sum-val { font-size: 28px; font-weight: 800; color: #7c5cff; }
  .sum-lab { font-size: 11px; color: #888; margin-top: 2px; }
  .q-item { margin-bottom: 18px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; break-inside: avoid; }
  .q-head { background: #7c5cff; color: #fff; padding: 10px 14px; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
  .q-body { padding: 12px 14px; }
  .q-text { font-size: 13px; font-weight: 600; color: #1a1a2e; margin-bottom: 10px; line-height: 1.4; }
  .answer-label { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #aaa; margin-bottom: 4px; }
  .answer-text { font-size: 12px; color: #444; line-height: 1.5; border-left: 3px solid #e9e4ff; padding-left: 10px; margin-bottom: 10px; }
  .critique-text { font-size: 12px; color: #555; line-height: 1.5; border-left: 3px solid #7c5cff; padding-left: 10px; }
  .score-badge { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 8px; }
  .good { color: #16a34a; background: #f0fdf4; }
  .mid  { color: #ca8a04; background: #fefce8; }
  .low  { color: #dc2626; background: #fef2f2; }
  @media print { body { padding: 16px; } }
</style></head><body>
<h1>🎤 Viva Exam Results</h1>
<div class="meta">Topic: ${_esc(vivaTopic)} · ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
<div class="summary">
  <div class="sum-stat"><div class="sum-val">${avgScore}%</div><div class="sum-lab">Overall Score</div></div>
  <div class="sum-stat"><div class="sum-val">${grade}</div><div class="sum-lab">Grade</div></div>
  <div class="sum-stat"><div class="sum-val">${answered.length}/${vivaQuestions.length}</div><div class="sum-lab">Answered</div></div>
</div>
${vivaQuestions.map((q, i) => {
  const sc = q.score; const cls = sc>=8?'good':sc>=5?'mid':'low';
  return `<div class="q-item">
    <div class="q-head"><span>Question ${i+1}</span>${q.userAnswer?`<span class="score-badge ${cls}">${sc}/10</span>`:''}</div>
    <div class="q-body">
      <div class="q-text">${_esc(q.q)}</div>
      ${q.userAnswer ? `
        <div class="answer-label">Your Answer</div>
        <div class="answer-text">${_esc(q.userAnswer)}</div>
        <div class="answer-label">Examiner Feedback</div>
        <div class="critique-text">${_esc(q.critique)}</div>
      ` : '<div class="answer-text" style="color:#ccc">Not answered</div>'}
    </div>
  </div>`;
}).join('')}
</body></html>`;
  _printHTML(html, 'Nexora_Viva_Results');
}
// ══════════════════════════════════════════════════════════════════════
//  NEXORA — 🎧 PODCAST / LISTEN MODE  v1.0
//  Paste at the END of app.js  (after nexora-features.js block)
//
//  Architecture:
//    1. Script generation → CF Worker /podcast OR callStudyAI() fallback
//    2. TTS → CF Worker /tts (WAV) → falls back to Web Speech API
//    3. Playback → custom HTML5 audio player OR Web Speech synth
//    4. Library → NexoraData JSON store (nexora_podcasts)
// ══════════════════════════════════════════════════════════════════════

const PODCAST_LS = 'nexora_podcasts'; // persisted podcast library key
const PODCAST_DB_NAME = 'nexora_podcast_cache';
const PODCAST_DB_STORE = 'audio_blobs';

let _podcastDbPromise = null;

// ── State ────────────────────────────────────────────────────────────
let _podcastGenerating  = false;
let _podcastCurrentData = null;  // { title, lines[], script, audioBlobs[] }
let _podcastSynthActive = false; // Web Speech synth playing
let _podcastLineIndex   = 0;     // which line synth is on
let _podcastAudioEl     = null;  // <audio> element for WAV playback

function _openPodcastDB() {
  if (_podcastDbPromise) return _podcastDbPromise;
  _podcastDbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(PODCAST_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PODCAST_DB_STORE)) {
        db.createObjectStore(PODCAST_DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return _podcastDbPromise;
}

async function _savePodcastAudioCache(id, blobs) {
  if (!id || !Array.isArray(blobs) || !blobs.length) return;
  try {
    const db = await _openPodcastDB();
    const tx = db.transaction(PODCAST_DB_STORE, 'readwrite');
    tx.objectStore(PODCAST_DB_STORE).put({ id, blobs, updatedAt: Date.now() });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Failed to store audio cache'));
      tx.onabort = () => reject(tx.error || new Error('Audio cache save aborted'));
    });
  } catch(e) {
    console.warn('[Nexora] Failed to cache podcast audio', e);
  }
}

async function _loadPodcastAudioCache(id) {
  if (!id) return [];
  try {
    const db = await _openPodcastDB();
    const tx = db.transaction(PODCAST_DB_STORE, 'readonly');
    const req = tx.objectStore(PODCAST_DB_STORE).get(id);
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Failed to read audio cache'));
    });
    return Array.isArray(record?.blobs) ? record.blobs.filter(Boolean) : [];
  } catch(e) {
    return [];
  }
}

// ── Open / Close ─────────────────────────────────────────────────────
function openPodcast() {
  if (typeof closeProgressDashboard === 'function') closeProgressDashboard();
  if (typeof menuOpen !== 'undefined' && menuOpen) {
    menuOpen = false;
    const mt = document.getElementById('modeToggle');
    if (mt) mt.classList.remove('open');
  }
  // Switch to podcast tab inside Study Mode
  if (typeof openStudyMode === 'function') openStudyMode();
  setTimeout(() => switchStudyTab('podcast'), 80);
}

// ══════════════════════════════════════════════════════════════════════
//  STEP 1 — GENERATE PODCAST
// ══════════════════════════════════════════════════════════════════════
async function generatePodcast(sourceOverride = null) {
  if (_podcastGenerating) return;

  const topicEl    = document.getElementById('podcastTopicInput');
  const fileEl     = document.getElementById('podcastFileInput');
  const lengthEl   = document.getElementById('podcastLength');
  const styleEl    = document.getElementById('podcastStyle');

  const topic  = (sourceOverride?.topic || topicEl?.value || '').trim();
  const length = lengthEl?.value || 'medium';
  const style  = styleEl?.value  || 'dialogue';
  const overrideText = String(sourceOverride?.text || '').trim();
  const titleHint = String(sourceOverride?.title || '').trim();

  // Read uploaded file if present
  let uploadedText = overrideText;
  if (!uploadedText && fileEl?.files?.length) {
    try {
      uploadedText = await _readFileAsText(fileEl.files[0]);
    } catch(e) {
      _showStudyToast('Could not read file — ' + e.message);
      return;
    }
  }

  if (!topic && !uploadedText) {
    _showStudyToast('Enter a topic or upload a document first.');
    return;
  }

  _podcastGenerating  = true;
  _podcastCurrentData = null;
  _podcastAudioEl     = null;
  _podcastSynthActive = false;

  _podcastShowGenerating();

  try {
    // ── Try CF Worker /podcast first ──────────────────────────────
    let lines = null, scriptText = '', titleStr = '', summaryStr = '';

    if (_hasCFWorker()) {
      try {
        _podcastSetStatus('🧠 Writing script with AI…', 15);
        const res = await fetchWithTimeout(_getCFWorkerUrl() + '/podcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topic || undefined, text: uploadedText || undefined, style, length }),
        }, 45000);

        if (res.ok) {
          const d = await res.json();
          if (d.ok && d.lines?.length) {
            lines      = d.lines;
            scriptText = d.script;
            titleStr   = d.title;
            summaryStr = d.summary;
          }
        }
      } catch(e) { /* fallback below */ }
    }

    // ── Fallback: generate script via callStudyAI ─────────────────
    if (!lines) {
      _podcastSetStatus('🧠 Writing script with AI…', 20);
      const inputSection = uploadedText
        ? `Convert these notes into a podcast:\n\n${uploadedText.slice(0, 3000)}`
        : `Topic: "${topic}"`;

      const sys = `You are an educational podcast scriptwriter. Write a friendly, clear dialogue.`;
      const usr = `${inputSection}

Write a ${length === 'short' ? '3-4' : length === 'long' ? '10-12' : '6-8'} minute educational ${style === 'dialogue' ? 'dialogue between HOST (teacher) and STUDENT (learner)' : 'monologue by HOST'}.

Format EVERY line as:
HOST: <text>
STUDENT: <text>

Structure: hook intro → explain concepts → real examples → recap → outro.
Conversational tone. Simple English. No markdown. No stage directions.`;

      const raw = await callStudyAI(sys, usr);
      lines = _parsePodcastScript(raw);
      scriptText = raw;
      titleStr   = titleHint || (topic ? `📻 ${topic}` : '📻 Study Podcast');
      summaryStr = lines[0]?.text?.slice(0, 120) || '';
    }

    if (!lines || lines.length === 0) throw new Error('Script is empty');

    if (!titleStr) titleStr = titleHint || (topic ? `📻 ${topic}` : '📻 Study Podcast');
    if (!summaryStr) summaryStr = lines[0]?.text?.slice(0, 120) || '';

    _podcastCurrentData = { title: titleStr, summary: summaryStr, lines, script: scriptText, topic, audioBlobs: [], audioBlobData: [] };

    // ── STEP 2: TTS ───────────────────────────────────────────────
    _podcastSetStatus('🎙️ Converting to voices…', 40);

    const hasCFTTS = _hasCFWorker();
    const hasSpeechSynth = 'speechSynthesis' in window;

    if (hasCFTTS) {
      // Try to get audio blobs for each line from CF TTS
      await _generateAudioBlobs(lines);
    }

    // If we got audio blobs, build a merged audio player
    const hasAudio = _podcastCurrentData.audioBlobs.filter(Boolean).length > 0;

    _podcastSetStatus('🎵 Preparing player…', 85);
    await new Promise(r => setTimeout(r, 400)); // brief pause feels natural

    // ── STEP 3: Save to library ───────────────────────────────────
    await _savePodcastToLibrary({
      id:        `pod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title:     titleStr,
      topic:     topic || '(from document)',
      summary:   summaryStr,
      lines,
      script:    scriptText,
      createdAt: Date.now(),
    });

    // ── STEP 4: Show player ───────────────────────────────────────
    _podcastSetStatus('✅ Ready!', 100);
    await new Promise(r => setTimeout(r, 300));
    _podcastShowPlayer(hasAudio, hasSpeechSynth);

  } catch(e) {
    _podcastShowError(e.message || 'Generation failed');
  } finally {
    _podcastGenerating = false;
  }
}

// ── Generate audio blobs via CF TTS (one per line, up to 40 lines) ──
async function _generateAudioBlobs(lines) {
  const MAX_LINES = Math.min(lines.length, 40);
  let successCount = 0;
  const pct_start = 40, pct_end = 82;

  for (let i = 0; i < MAX_LINES; i++) {
    const line = lines[i];
    const voice = line.speaker === 'STUDENT' ? 'en-us-female' : 'en-us-male';
    // Smart truncation: cut at sentence boundary near 600 chars (same as speakText)
    let ttsText = line.text;
    if (ttsText.length > 600) {
      const cutoff = ttsText.lastIndexOf('.', 600);
      ttsText = cutoff > 300 ? ttsText.slice(0, cutoff + 1) : ttsText.slice(0, 600);
    }
    try {
      const res = await fetchWithTimeout(_getCFWorkerUrl() + '/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ttsText, voice }),
      }, 12000);

      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        let blob = null;
        if (ct.includes('audio/')) {
          blob = await res.blob();
        } else {
          const payload = await res.json().catch(() => null);
          const audioB64 = payload?.audio || payload?.result?.audio || '';
          if (audioB64) {
            const bytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
            blob = new Blob([bytes], { type: 'audio/mpeg' });
          }
        }
        if (!blob || blob.size === 0) throw new Error('Empty audio response');
        if (!blob.type || blob.type === 'application/octet-stream') {
          blob = new Blob([await blob.arrayBuffer()], { type: 'audio/mpeg' });
        }
        if (!_podcastCurrentData.audioBlobData) _podcastCurrentData.audioBlobData = [];
        _podcastCurrentData.audioBlobData[i] = blob;
        _podcastCurrentData.audioBlobs[i] = URL.createObjectURL(blob);
        successCount++;
      } else {
        _podcastCurrentData.audioBlobs[i] = null;
        if (_podcastCurrentData.audioBlobData) _podcastCurrentData.audioBlobData[i] = null;
      }
    } catch(e) {
      _podcastCurrentData.audioBlobs[i] = null;
      if (_podcastCurrentData.audioBlobData) _podcastCurrentData.audioBlobData[i] = null;
    }

    // Update progress bar
    const pct = Math.round(pct_start + ((i + 1) / MAX_LINES) * (pct_end - pct_start));
    _podcastSetStatus(`🎙️ Generating voices… (${i + 1}/${MAX_LINES})`, pct);
  }

  return successCount;
}

// ══════════════════════════════════════════════════════════════════════
//  PLAYBACK — WAV blobs (CF TTS) OR Web Speech API fallback
// ══════════════════════════════════════════════════════════════════════

// Play using pre-generated WAV blobs (sequential)
let _podcastPlaying   = false;
let _podcastBlobIndex = 0;

function podcastPlay() {
  const data = _podcastCurrentData;
  if (!data) return;

  const hasBlobs = data.audioBlobs.filter(Boolean).length > 0;

  if (hasBlobs) {
    _podcastBlobIndex = 0;
    _podcastPlaying   = true;
    _podcastPlayNextBlob();
  } else {
    // Web Speech fallback
    _podcastSpeakLines(data.lines, 0);
  }
  _updatePodcastPlayerUI(true);
}

function podcastPause() {
  _podcastPlaying = false;
  if (_podcastAudioEl) { _podcastAudioEl.pause(); }
  if (_podcastSynthActive && window.speechSynthesis) { window.speechSynthesis.pause(); }
  _updatePodcastPlayerUI(false);
}

function podcastStop() {
  _podcastPlaying     = false;
  _podcastSynthActive = false;
  _podcastBlobIndex   = 0;
  if (_podcastAudioEl) { _podcastAudioEl.pause(); _podcastAudioEl.src = ''; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  _updatePodcastPlayerUI(false);
  _updatePodcastProgress(0, '0:00', '0:00');
}

function _podcastPlayNextBlob() {
  if (!_podcastPlaying) return;
  const data   = _podcastCurrentData;
  const blobs  = data.audioBlobs;
  const lines  = data.lines;

  // Find next valid blob
  while (_podcastBlobIndex < blobs.length && !blobs[_podcastBlobIndex]) {
    _podcastBlobIndex++;
  }

  if (_podcastBlobIndex >= blobs.length) {
    // Done
    _podcastPlaying = false;
    _updatePodcastPlayerUI(false);
    _podcastBlobIndex = 0;
    _updatePodcastProgress(100, _podcastFormatTime(blobs.length * 3), _podcastFormatTime(blobs.length * 3));
    return;
  }

  const url    = blobs[_podcastBlobIndex];
  const line   = lines[_podcastBlobIndex] || {};
  const audio  = new Audio(url);
  _podcastAudioEl = audio;

  // Set speed
  const speedEl = document.getElementById('podcastSpeed');
  audio.playbackRate = parseFloat(speedEl?.value || '1');

  // Highlight current line in transcript
  _highlightTranscriptLine(_podcastBlobIndex);

  // Update progress
  const progress = Math.round((_podcastBlobIndex / blobs.filter(Boolean).length) * 100);
  const timeStr  = _podcastFormatTime(_podcastBlobIndex * 3.5);
  const totalStr = _podcastFormatTime(blobs.filter(Boolean).length * 3.5);
  _updatePodcastProgress(progress, timeStr, totalStr);

  audio.onended = () => {
    _podcastBlobIndex++;
    _podcastPlayNextBlob();
  };
  audio.onerror = () => {
    _podcastBlobIndex++;
    _podcastPlayNextBlob();
  };

  audio.play().catch(() => {
    _podcastBlobIndex++;
    _podcastPlayNextBlob();
  });
}

// Web Speech API fallback — speaks all lines with two voices
function _podcastSpeakLines(lines, startIdx) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  _podcastSynthActive = true;
  _podcastLineIndex   = startIdx;

  const voices = window.speechSynthesis.getVoices();
  // Try to find two distinct English voices
  const enVoices  = voices.filter(v => v.lang.startsWith('en'));
  const hostVoice    = enVoices.find(v => v.name.match(/male|David|Mark|Google UK English Male/i)) || enVoices[0] || null;
  const studentVoice = enVoices.find(v => v.name.match(/female|Samantha|Zira|Google US English/i)) || enVoices[1] || hostVoice;

  function speakNext() {
    if (!_podcastSynthActive || _podcastLineIndex >= lines.length) {
      _podcastSynthActive = false;
      _updatePodcastPlayerUI(false);
      return;
    }

    const line  = lines[_podcastLineIndex];
    const utt   = new SpeechSynthesisUtterance(line.text);
    const speedEl = document.getElementById('podcastSpeed');
    utt.rate  = parseFloat(speedEl?.value || '1');
    utt.pitch = line.speaker === 'STUDENT' ? 1.15 : 0.9;

    if (line.speaker === 'STUDENT' && studentVoice) utt.voice = studentVoice;
    else if (hostVoice) utt.voice = hostVoice;

    _highlightTranscriptLine(_podcastLineIndex);

    const progress = Math.round((_podcastLineIndex / lines.length) * 100);
    const timeStr  = _podcastFormatTime(_podcastLineIndex * 4);
    const totalStr = _podcastFormatTime(lines.length * 4);
    _updatePodcastProgress(progress, timeStr, totalStr);

    utt.onend = () => {
      _podcastLineIndex++;
      speakNext();
    };
    utt.onerror = () => {
      _podcastLineIndex++;
      speakNext();
    };

    window.speechSynthesis.speak(utt);
  }

  speakNext();
}

function podcastRestart() {
  podcastStop();
  setTimeout(podcastPlay, 150);
}

function podcastSetSpeed(val) {
  const speedLabel = document.getElementById('podcastSpeedLabel');
  if (speedLabel) speedLabel.textContent = val + 'x';
  if (_podcastAudioEl) _podcastAudioEl.playbackRate = parseFloat(val);
}

// ══════════════════════════════════════════════════════════════════════
//  UI RENDERERS
// ══════════════════════════════════════════════════════════════════════

function _podcastShowGenerating() {
  const panel = document.getElementById('podcastGeneratingState');
  const setup = document.getElementById('podcastSetup');
  const player = document.getElementById('podcastPlayer');
  if (setup)  setup.style.display  = 'none';
  if (player) player.style.display = 'none';
  if (panel)  { panel.style.display = 'block'; }
  _podcastSetStatus('🧠 Initialising…', 5);
}

function _podcastSetStatus(msg, pct) {
  const txt  = document.getElementById('podcastStatusText');
  const bar  = document.getElementById('podcastProgressBar');
  const fill = document.getElementById('podcastProgressFill');
  if (txt)  txt.textContent = msg;
  if (fill) fill.style.width = (pct || 0) + '%';
}

function _podcastShowError(msg) {
  const panel = document.getElementById('podcastGeneratingState');
  const setup = document.getElementById('podcastSetup');
  if (panel) panel.style.display = 'none';
  if (setup) setup.style.display = 'block';
  _showStudyToast('❌ ' + msg);
}

function _podcastShowPlayer(hasBlobs, hasSynth) {
  const genEl  = document.getElementById('podcastGeneratingState');
  const setup  = document.getElementById('podcastSetup');
  const player = document.getElementById('podcastPlayer');
  if (genEl)  genEl.style.display  = 'none';
  if (setup)  setup.style.display  = 'none';
  if (player) player.style.display = 'block';

  const data = _podcastCurrentData;
  if (!data) return;

  // Title
  const titleEl = document.getElementById('podcastPlayerTitle');
  if (titleEl) titleEl.textContent = data.title;

  // Sub info
  const infoEl  = document.getElementById('podcastPlayerInfo');
  if (infoEl)   infoEl.textContent = `${data.lines.length} lines · ${hasBlobs ? 'CF Voice' : 'Web Speech'}`;

  // TTS mode badge
  const badgeEl = document.getElementById('podcastTTSBadge');
  if (badgeEl) {
    badgeEl.textContent = hasBlobs ? '🎙️ CF TTS' : '🔊 Web Speech';
    badgeEl.className   = 'podcast-tts-badge ' + (hasBlobs ? 'cf' : 'web');
  }

  // Total time estimate
  const totalLines = data.lines.length;
  const avgSecs    = 4;
  const totalSecs  = totalLines * avgSecs;
  const totalEl    = document.getElementById('podcastTotalTime');
  if (totalEl) totalEl.textContent = _podcastFormatTime(totalSecs);

  // Render transcript
  _renderPodcastTranscript(data.lines);

  // Render library
  _renderPodcastLibrary();
}

function _renderPodcastTranscript(lines) {
  const el = document.getElementById('podcastTranscript');
  if (!el) return;
  el.innerHTML = lines.map((line, i) => `
    <div class="podcast-line ${line.speaker === 'STUDENT' ? 'student' : 'host'}" data-line="${i}" id="podcast-line-${i}">
      <span class="podcast-speaker">${line.speaker === 'HOST' ? '🎙️' : '🎓'}</span>
      <span class="podcast-line-text">${_esc(line.text)}</span>
    </div>
  `).join('');
}

function _highlightTranscriptLine(idx) {
  document.querySelectorAll('.podcast-line.active').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('podcast-line-' + idx);
  if (el) {
    el.classList.add('active');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function _updatePodcastPlayerUI(playing) {
  const playBtn  = document.getElementById('podcastPlayBtn');
  const pauseBtn = document.getElementById('podcastPauseBtn');
  if (playBtn)  playBtn.style.display  = playing ? 'none' : 'flex';
  if (pauseBtn) pauseBtn.style.display = playing ? 'flex' : 'none';
}

function _updatePodcastProgress(pct, current, total) {
  const fill = document.getElementById('podcastSeekFill');
  const cur  = document.getElementById('podcastCurrentTime');
  const tot  = document.getElementById('podcastTotalTime');
  if (fill) fill.style.width = pct + '%';
  if (cur)  cur.textContent  = current;
  if (tot)  tot.textContent  = total;
}

function podcastBackToSetup() {
  podcastStop();
  const setup  = document.getElementById('podcastSetup');
  const player = document.getElementById('podcastPlayer');
  const gen    = document.getElementById('podcastGeneratingState');
  if (gen)    gen.style.display    = 'none';
  if (player) player.style.display = 'none';
  if (setup)  setup.style.display  = 'block';
}

function podcastDownload() {
  const data = _podcastCurrentData;
  if (!data?.script) { _showStudyToast('No script to download.'); return; }
  const blob = new Blob([data.script], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (data.topic || 'podcast').replace(/[^a-z0-9]/gi, '_') + '_script.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════
//  LIBRARY
// ══════════════════════════════════════════════════════════════════════

async function _savePodcastToLibrary(entry) {
  try {
    const lib = window.NexoraData?.getJSON
      ? (NexoraData.getJSON(PODCAST_LS, []) || [])
      : JSON.parse(localStorage.getItem(PODCAST_LS) || '[]');
    const safeEntry = { ...entry, audioBlobs: undefined, audioBlobData: undefined };
    lib.unshift(safeEntry);
    // Keep 20 max
    while (lib.length > 20) lib.pop();
    if (window.NexoraData?.setJSON) NexoraData.setJSON(PODCAST_LS, lib);
    else localStorage.setItem(PODCAST_LS, JSON.stringify(lib));

    const audioData = _podcastCurrentData?.audioBlobData?.filter(Boolean) || [];
    if (entry.id && audioData.length) {
      await _savePodcastAudioCache(entry.id, audioData);
    }
  } catch(e) {}
}

function _renderPodcastLibrary() {
  const el = document.getElementById('podcastLibraryList');
  if (!el) return;
  let lib = [];
  try {
    lib = window.NexoraData?.getJSON
      ? (NexoraData.getJSON(PODCAST_LS, []) || [])
      : JSON.parse(localStorage.getItem(PODCAST_LS) || '[]');
  } catch(e) {}

  if (!lib.length) {
    el.innerHTML = '<div class="podcast-lib-empty">Your generated podcasts will appear here</div>';
    return;
  }
  el.innerHTML = lib.map((e, i) => `
    <div class="podcast-lib-item" onclick="_loadPodcastFromLibrary(${i})">
      <div class="podcast-lib-icon">🎧</div>
      <div class="podcast-lib-meta">
        <div class="podcast-lib-title">${_esc(e.title || e.topic)}</div>
        <div class="podcast-lib-date">${_timeAgo(e.createdAt)} · ${(e.lines || []).length} lines</div>
      </div>
      <button class="podcast-lib-del" onclick="event.stopPropagation();_deletePodcastFromLibrary(${i})">✕</button>
    </div>
  `).join('');
}

async function _loadPodcastFromLibrary(idx) {
  let lib = [];
  try {
    lib = window.NexoraData?.getJSON
      ? (NexoraData.getJSON(PODCAST_LS, []) || [])
      : JSON.parse(localStorage.getItem(PODCAST_LS) || '[]');
  } catch(e) {}
  const entry = lib[idx];
  if (!entry) return;

  const cacheId = entry.id || (entry.createdAt ? `pod_${entry.createdAt}` : '');
  const cachedBlobs = await _loadPodcastAudioCache(cacheId);
  const cachedUrls  = cachedBlobs.map(blob => URL.createObjectURL(blob));

  _podcastCurrentData = {
    ...entry,
    audioBlobs: cachedUrls,
    audioBlobData: cachedBlobs,
  };
  _podcastShowPlayer(cachedUrls.length > 0, 'speechSynthesis' in window);
}

function _deletePodcastFromLibrary(idx) {
  let lib = [];
  try {
    lib = window.NexoraData?.getJSON
      ? (NexoraData.getJSON(PODCAST_LS, []) || [])
      : JSON.parse(localStorage.getItem(PODCAST_LS) || '[]');
  } catch(e) {}
  const entry = lib[idx];
  lib.splice(idx, 1);
  if (window.NexoraData?.setJSON) NexoraData.setJSON(PODCAST_LS, lib);
  else localStorage.setItem(PODCAST_LS, JSON.stringify(lib));
  const cacheId = entry?.id || (entry?.createdAt ? `pod_${entry.createdAt}` : '');
  if (cacheId) {
    _openPodcastDB().then(db => {
      try {
        const tx = db.transaction(PODCAST_DB_STORE, 'readwrite');
        tx.objectStore(PODCAST_DB_STORE).delete(cacheId);
      } catch(e) {}
    }).catch(() => {});
  }
  _renderPodcastLibrary();
}

// ══════════════════════════════════════════════════════════════════════
//  FILE READER
// ══════════════════════════════════════════════════════════════════════
function _readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'md', 'markdown'].includes(ext) && file.type !== 'text/plain') {
      // For PDF/DOCX — just read as text (limited but works for plain-text PDFs)
      // Full PDF parsing needs pdf.js — for now we read what we can
    }
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result || '');
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsText(file);
  });
}

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════
function _parsePodcastScript(raw) {
  const lines = [];
  const rawLines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of rawLines) {
    if (line.startsWith('HOST:')) {
      const text = line.replace(/^HOST:\s*/, '').trim();
      if (text) lines.push({ speaker: 'HOST', text });
    } else if (line.startsWith('STUDENT:')) {
      const text = line.replace(/^STUDENT:\s*/, '').trim();
      if (text) lines.push({ speaker: 'STUDENT', text });
    } else if (lines.length > 0) {
      lines[lines.length - 1].text += ' ' + line;
    }
  }
  if (!lines.length) {
    rawLines.forEach(l => { if (l.length > 8) lines.push({ speaker: 'HOST', text: l }); });
  }
  return lines;
}

function _podcastFormatTime(secs) {
  const s = Math.round(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Patch switchStudyTab to handle 'podcast' tab ──────────────────
(function patchSwitchStudyTabForPodcast() {
  const orig = window.switchStudyTab;
  window.switchStudyTab = function(tab) {
    if (tab === 'podcast') {
      document.querySelectorAll('.study-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.study-panel').forEach(p => p.classList.remove('active'));
      const tabBtn = document.getElementById('stab-podcast');
      const panel  = document.getElementById('spanel-podcast');
      if (tabBtn) tabBtn.classList.add('active');
      if (panel)  panel.classList.add('active');
      if (typeof studyCurrentTab !== 'undefined') studyCurrentTab = 'podcast';
      _renderPodcastLibrary();
      return;
    }
    if (orig) orig(tab);
  };
})();

// ══════════════════════════════════════════════════════════════════════
//  ✨ NEXORA — 15 FEATURE UPGRADES
// ══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// FIX 1: AI Badge — always correct on load + live status text
// ─────────────────────────────────────────────────────────────────────
(function patchAiBadgeOnLoad() {
  const _origInit = window.addEventListener;
  // Patch updateResponseModeUI to also update #headerStatus
  const _origUpdateUI = window.updateResponseModeUI;
  window.updateResponseModeUI = function() {
    if (typeof _origUpdateUI === 'function') _origUpdateUI();
    const headerStatus = document.getElementById('headerStatus');
    if (!headerStatus) return;
    const userKey = localStorage.getItem('nexora_user_key');
    const geminiKey = localStorage.getItem('nexora_gemini_key');
    const hasKey = (userKey && userKey.startsWith('sk-or-')) || (geminiKey && (geminiKey.startsWith('AIza') || geminiKey.startsWith('AQ.')));
    if (hasKey) {
      headerStatus.textContent = nexoraResponseMode === 'online' ? 'AI ready · online' : 'key saved · offline mode';
    } else {
      headerStatus.textContent = nexoraResponseMode === 'online' ? 'free AI active' : 'here for you';
    }
  };
})();

// ─────────────────────────────────────────────────────────────────────
// FIX 2: Header status updates when mode changes
// ─────────────────────────────────────────────────────────────────────
(function patchSetMode() {
  const _orig = window.setMode;
  window.setMode = function(mode) {
    if (typeof _orig === 'function') _orig(mode);
    const hs = document.getElementById('headerStatus');
    if (!hs) return;
    const labels = { support: 'support mode · here for you', gossip: '✨ gossip mode', hype: '🔥 hype mode' };
    hs.textContent = labels[mode] || 'here for you';
    setTimeout(() => { if (window.updateResponseModeUI) updateResponseModeUI(); }, 2000);
  };
})();

// ─────────────────────────────────────────────────────────────────────
// FIX 3: Thinking bubble — show instantly when user sends
// ─────────────────────────────────────────────────────────────────────
let _thinkingBubbleEl = null;

function showThinkingBubble() {
  removeThinkingBubble();
  const messages = document.getElementById('messages');
  if (!messages) return;
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.id = 'nexora-thinking-row';
  row.innerHTML = `
    <div class="msg-av">✨</div>
    <div class="bubble bot-bub thinking-bubble">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
    </div>`;
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  _thinkingBubbleEl = row;
}

function removeThinkingBubble() {
  const el = document.getElementById('nexora-thinking-row');
  if (el) el.remove();
  _thinkingBubbleEl = null;
}

// Patch sendMessage to show thinking bubble
(function patchSendMessageThinking() {
  const _orig = window.sendMessage;
  window.sendMessage = function() {
    const input = document.getElementById('userInput');
    const text = (input && input.value.trim()) || '';
    const hasPending = window.pendingImageFile;
    if (!text && !hasPending) return;
    if (typeof _orig === 'function') _orig();
    // Show thinking bubble if isTyping just became true
    setTimeout(() => { if (window.isTyping) showThinkingBubble(); }, 50);
  };
})();

// Patch typeBot to remove thinking bubble before typing starts
(function patchTypeBotThinking() {
  const _orig = window.typeBot;
  window.typeBot = function(text, onDone, isIdlePing) {
    removeThinkingBubble();
    if (typeof _orig === 'function') return _orig(text, onDone, isIdlePing);
  };
})();

// ─────────────────────────────────────────────────────────────────────
// FEATURE 4: Smart Topic Suggestions row (time-aware chips)
// ─────────────────────────────────────────────────────────────────────
function _getSmartSuggestions() {
  const h = new Date().getHours();
  const morning  = h >= 5  && h < 12;
  const afternoon= h >= 12 && h < 17;
  const evening  = h >= 17 && h < 21;
  const night    = h >= 21 || h < 5;

  const timeBased = morning
    ? [{ icon:'☀️', label:'Morning motivation', msg:'Give me a motivational quote to start my day!' },
       { icon:'📚', label:'Study with me', msg:'Help me make a study plan for today' }]
    : afternoon
    ? [{ icon:'💡', label:'Life tip', msg:'Give me one useful life tip for today' },
       { icon:'🧠', label:'Brain teaser', msg:'Give me a brain teaser or riddle!' }]
    : evening
    ? [{ icon:'🌙', label:'Evening check-in', msg:'How can I wind down and relax tonight?' },
       { icon:'📖', label:'Learn something', msg:'Teach me one interesting fact I don\'t know' }]
    : [{ icon:'💤', label:'Can\'t sleep', msg:'I can\'t sleep, talk to me' },
       { icon:'🌟', label:'Late night thoughts', msg:'I have some late night thoughts to share' }];

  return [
    ...timeBased,
    { icon:'🌤️', label:'Weather', msg:'What\'s the weather like?' },
    { icon:'📚', label:'Study Mode', msg:null, action: () => openStudyMode() },
    { icon:'⚖️', label:'AI Compare', msg:null, action: () => openComparePanel() },
    { icon:'🎯', label:'Set a goal', msg:'Help me set a goal for today' },
  ];
}

function renderSmartSuggestions() {
  const bar = document.getElementById('smartSuggestBar');
  if (!bar) return;
  const suggestions = _getSmartSuggestions();
  bar.innerHTML = suggestions.map((s, i) =>
    `<div class="smart-chip" data-idx="${i}">${s.icon} ${s.label}</div>`
  ).join('');
  bar.querySelectorAll('.smart-chip').forEach((chip, i) => {
    chip.addEventListener('click', () => {
      // Tap-to-dismiss: fade the chip out
      chip.classList.add('chip-dismissed');
      setTimeout(() => { if (chip.parentNode) chip.remove(); }, 280);
      const s = suggestions[i];
      if (s.action) { s.action(); return; }
      if (s.msg) { document.getElementById('userInput').value = s.msg; sendMessage(); }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE 5: Pinned Memory Panel (🧠 icon in header)
// ─────────────────────────────────────────────────────────────────────
function openMemoryPanel() {
  const existing = document.getElementById('nexora-memory-panel');
  if (existing) { existing.remove(); return; }

  const streak = (() => {
    try {
      const d = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_streak', {}) : JSON.parse(localStorage.getItem('nexora_srs_streak') || '{}');
      return d.streak || 0;
    } catch(e) { return 0; }
  })();

  const cards = (() => {
    try { return (window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]')).length; }
    catch(e) { return 0; }
  })();

  const topics = (window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_topics', []) : (() => { try { return JSON.parse(localStorage.getItem('nexora_topics') || '[]'); } catch(e) { return []; } })());
  const recentTopics = [...new Set((topics || []).map(t => String(t || '').trim()).filter(Boolean))].slice(-5).reverse();

  const profile = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_profile', { emotional: 0, logical: 0 }) : { emotional: 0, logical: 0 };
  const total = (profile.emotional || 0) + (profile.logical || 0);
  const ePct = total ? Math.round((profile.emotional / total) * 100) : 50;
  const lPct = 100 - ePct;

  const hasKey = localStorage.getItem('nexora_user_key') || localStorage.getItem('nexora_gemini_key');
  const aiStatus = hasKey ? '🟢 API key active' : '🟡 Free AI (Pollinations)';

  const panel = document.createElement('div');
  panel.id = 'nexora-memory-panel';
  panel.className = 'memory-panel-popup';
  panel.innerHTML = `
    <div class="memory-panel-header">
      <span>🧠 Nexora Knows</span>
      <button onclick="document.getElementById('nexora-memory-panel').remove()">✕</button>
    </div>
    <div class="memory-panel-body">
      <div class="mem-row"><span class="mem-label">👤 Name</span><span class="mem-val">${_esc(userName || '—')}</span></div>
      <div class="mem-row"><span class="mem-label">🔥 Streak</span><span class="mem-val">${streak} day${streak !== 1 ? 's' : ''}</span></div>
      <div class="mem-row"><span class="mem-label">🃏 Cards saved</span><span class="mem-val">${cards}</span></div>
      <div class="mem-row"><span class="mem-label">🤖 AI status</span><span class="mem-val">${aiStatus}</span></div>
      <div class="mem-row"><span class="mem-label">🎭 Mode</span><span class="mem-val">${currentMode || 'support'}</span></div>
      ${recentTopics.length ? `<div class="mem-row"><span class="mem-label">📌 Recent topics</span><span class="mem-val mem-topics">${recentTopics.map(t => `<span>${_esc(t)}</span>`).join('')}</span></div>` : ''}
      <div class="mem-row"><span class="mem-label">💡 Your style</span>
        <span class="mem-val">
          <div class="mem-profile-bar">
            <div class="mem-profile-fill emotional" style="width:${ePct}%"></div>
            <div class="mem-profile-fill logical" style="width:${lPct}%"></div>
          </div>
          <div class="mem-profile-labels"><span>❤️ ${ePct}% emotional</span><span>🧠 ${lPct}% logical</span></div>
        </span>
      </div>
    </div>
    <div class="memory-panel-footer">
      <button onclick="clearMemory()">🗑️ Clear memory</button>
    </div>`;

  document.getElementById('phone').appendChild(panel);
}

function clearMemory() {
  if (!confirm('Clear all Nexora memory? This removes your emotion history, topics, and profile data.')) return;
  ['nexora_emotions','nexora_topics','nexora_profile','nexora_srs_streak'].forEach(k => {
    if (window.NexoraData?.clearJSON) NexoraData.clearJSON(k);
    else localStorage.removeItem(k);
  });
  emotionHistory = [];
  topicMemory = [];
  userProfile = { emotional: 0, logical: 0 };
  document.getElementById('nexora-memory-panel')?.remove();
  _showStudyToast('Memory cleared 🧹');
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE 6: Message Reactions (long-press or double-tap)
// ─────────────────────────────────────────────────────────────────────
let _reactionTimer = null;

function _attachMessageReactions(bubbleEl, text, isBot) {
  let pressStart = 0;

  const showReactions = (e) => {
    e.preventDefault();
    document.querySelectorAll('.msg-reaction-bar').forEach(el => el.remove());

    const bar = document.createElement('div');
    bar.className = 'msg-reaction-bar';
    bar.innerHTML = `
      <button class="reaction-btn" data-emoji="👍" title="Like">👍</button>
      <button class="reaction-btn" data-emoji="❤️" title="Love">❤️</button>
      <button class="reaction-btn" data-emoji="😂" title="Funny">😂</button>
      <button class="reaction-btn" data-emoji="😮" title="Wow">😮</button>
      ${isBot ? `<button class="reaction-btn regen-btn" title="Regenerate">🔁</button>` : ''}
      <button class="reaction-btn copy-btn" title="Copy">📋</button>
    `;

    bar.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const emoji = btn.dataset.emoji;
        if (btn.classList.contains('regen-btn')) {
          bar.remove();
          if (!isTyping) {
            const lastUserMsg = [...document.querySelectorAll('.user-bub')].pop()?.textContent || '';
            if (lastUserMsg) { isTyping = true; showThinkingBubble(); generateSmartReply(lastUserMsg).then(r => { if (r) typeBot(r); else isTyping = false; }); }
          }
        } else if (btn.classList.contains('copy-btn')) {
          navigator.clipboard.writeText(bubbleEl.innerText || text).then(() => showCopyToast()).catch(() => {});
          bar.remove();
        } else {
          // Add emoji reaction badge
          let badge = bubbleEl.querySelector('.reaction-badge');
          if (!badge) { badge = document.createElement('div'); badge.className = 'reaction-badge'; bubbleEl.appendChild(badge); }
          badge.textContent = emoji;
          bar.remove();
        }
      });
    });

    bubbleEl.style.position = 'relative';
    bubbleEl.appendChild(bar);
    setTimeout(() => { document.addEventListener('click', () => bar.remove(), { once: true }); }, 100);
  };

  // Long press
  bubbleEl.addEventListener('pointerdown', () => { pressStart = Date.now(); _reactionTimer = setTimeout(() => showReactions({ preventDefault: () => {} }), 500); });
  bubbleEl.addEventListener('pointerup', () => { if (Date.now() - pressStart < 500) clearTimeout(_reactionTimer); });
  bubbleEl.addEventListener('pointercancel', () => clearTimeout(_reactionTimer));
  // Double tap on desktop
  bubbleEl.addEventListener('dblclick', showReactions);
}

// Patch addBotMsg to attach reactions
(function patchAddBotMsgReactions() {
  const _orig = window.addBotMsg;
  window.addBotMsg = function(text) {
    if (typeof _orig === 'function') _orig(text);
    // Attach reactions to the last bot bubble
    setTimeout(() => {
      const bubs = document.querySelectorAll('.bot-bub');
      const last = bubs[bubs.length - 1];
      if (last && !last.dataset.reactionsAttached) {
        last.dataset.reactionsAttached = '1';
        _attachMessageReactions(last, last.innerText, true);
      }
    }, 100);
  };
})();

// Patch addUserMsg to attach reactions
(function patchAddUserMsgReactions() {
  const _orig = window.addUserMsg;
  window.addUserMsg = function(text) {
    if (typeof _orig === 'function') _orig(text);
    setTimeout(() => {
      const bubs = document.querySelectorAll('.user-bub');
      const last = bubs[bubs.length - 1];
      if (last && !last.dataset.reactionsAttached) {
        last.dataset.reactionsAttached = '1';
        _attachMessageReactions(last, text, false);
      }
    }, 100);
  };
})();

// ─────────────────────────────────────────────────────────────────────
// FEATURE 7: "Generate Study Cards from Chat" button
// ─────────────────────────────────────────────────────────────────────
function generateStudyFromChat() {
  const rows = document.querySelectorAll('.msg-row');
  const lines = [];
  rows.forEach(row => {
    const bub = row.querySelector('.bot-bub, .user-bub');
    if (bub) lines.push(bub.innerText || bub.textContent || '');
  });
  const chatText = lines.filter(Boolean).join('\n\n').slice(0, 800);
  if (!chatText) { _showStudyToast('No chat to study from yet!'); return; }
  openStudyMode();
  setTimeout(() => {
    const fcInput = document.getElementById('fcTopicInput');
    if (fcInput) {
      fcInput.value = chatText;
      switchStudyTab('flashcard');
      _showStudyToast('📚 Chat loaded — tap Generate!');
    }
  }, 400);
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE 8: Offline Indicator in header
// ─────────────────────────────────────────────────────────────────────
(function initOfflineIndicator() {
  function _setOfflineBanner(offline) {
    let banner = document.getElementById('nexora-offline-banner');
    const header = document.getElementById('header');
    if (!header) return;
    if (offline) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'nexora-offline-banner';
        banner.className = 'offline-banner';
        banner.textContent = '📵 Offline — using local AI';
        header.after(banner);
      }
    } else {
      if (banner) banner.remove();
    }
  }

  window.addEventListener('online',  () => _setOfflineBanner(false));
  window.addEventListener('offline', () => _setOfflineBanner(true));
  // Check on load
  if (!navigator.onLine) _setOfflineBanner(true);
})();

// ─────────────────────────────────────────────────────────────────────
// FEATURE 9: Escape key closes all panels
// ─────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Close memory panel
  document.getElementById('nexora-memory-panel')?.remove();
  // Close reaction bars
  document.querySelectorAll('.msg-reaction-bar').forEach(el => el.remove());
  // Close API panel
  const apiPanel = document.getElementById('apiPanel');
  if (apiPanel && apiPanel.classList.contains('open')) { if (typeof closeApiPanel === 'function') closeApiPanel(); return; }
  // Close compare panel
  const cmpPanel = document.getElementById('comparePanel');
  if (cmpPanel && cmpPanel.classList.contains('open')) { if (typeof closeComparePanel === 'function') closeComparePanel(); return; }
  // Close study mode
  const studyScreen = document.getElementById('studyScreen');
  if (studyScreen && studyScreen.classList.contains('active')) { if (typeof closeStudyMode === 'function') closeStudyMode(); return; }
  // Close progress dashboard
  const dash = document.getElementById('progressDashboard');
  if (dash && dash.classList.contains('open')) { if (typeof closeProgressDashboard === 'function') closeProgressDashboard(); return; }
  // Close search overlay
  const searchOvr = document.getElementById('searchOverlay');
  if (searchOvr && searchOvr.classList.contains('open')) { if (typeof closeSearch === 'function') closeSearch(); return; }
  // Close menu
  if (window.menuOpen) {
    document.getElementById('modeToggle')?.classList.remove('open');
    window.menuOpen = false;
  }
});

// ─────────────────────────────────────────────────────────────────────
// FEATURE 10: Study Mode progress banner (saves per tab)
// ─────────────────────────────────────────────────────────────────────
function _renderStudyProgressBanner() {
  const existing = document.getElementById('study-progress-banner');
  if (existing) existing.remove();

  const streak = (() => { try { const d = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_streak', {}) : JSON.parse(localStorage.getItem('nexora_srs_streak') || '{}'); return d.streak || 0; } catch(e) { return 0; } })();
  const cards = (() => { try { return (window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]')).length; } catch(e) { return 0; } })();
  const quizzes = (() => { try { return (window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_quiz_hist', []) : JSON.parse(localStorage.getItem('nexora_quiz_hist') || '[]')).length; } catch(e) { return 0; } })();
  const due = (() => { try { const c = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]'); return c.filter(x => x.next_review <= Date.now()).length; } catch(e) { return 0; } })();

  const banner = document.createElement('div');
  banner.id = 'study-progress-banner';
  banner.className = 'study-progress-banner';
  banner.innerHTML = `
    <div class="spb-stat"><span class="spb-val">${cards}</span><span class="spb-lab">cards</span></div>
    <div class="spb-divider"></div>
    <div class="spb-stat"><span class="spb-val">${quizzes}</span><span class="spb-lab">quizzes</span></div>
    <div class="spb-divider"></div>
    <div class="spb-stat"><span class="spb-val">${streak}🔥</span><span class="spb-lab">streak</span></div>
    ${due > 0 ? `<div class="spb-divider"></div><div class="spb-stat due" onclick="switchStudyTab('srs')"><span class="spb-val">${due}</span><span class="spb-lab">due now</span></div>` : ''}
  `;

  // Place banner between the tab-bar and the active panel, so it never pushes tabs off screen
  const tabBar = document.querySelector('.study-tab-bar');
  if (tabBar) tabBar.after(banner);
}

// Patch openStudyMode and switchStudyTab to show banner
(function patchStudyProgressBanner() {
  const _origOpen = window.openStudyMode;
  window.openStudyMode = function() {
    if (typeof _origOpen === 'function') _origOpen();
    setTimeout(_renderStudyProgressBanner, 150);
  };
  const _origSwitch = window.switchStudyTab;
  window.switchStudyTab = function(tab) {
    if (typeof _origSwitch === 'function') _origSwitch(tab);
    setTimeout(_renderStudyProgressBanner, 100);
  };
})();

// ─────────────────────────────────────────────────────────────────────
// FEATURE 11: Podcast transcript — click line to jump
// ─────────────────────────────────────────────────────────────────────
(function patchPodcastTranscriptSeek() {
  const _orig = window._renderPodcastTranscript;
  window._renderPodcastTranscript = function(lines) {
    if (typeof _orig === 'function') _orig(lines);
    // Attach click-to-seek on each line
    const el = document.getElementById('podcastTranscript');
    if (!el) return;
    el.querySelectorAll('.podcast-line').forEach((lineEl, i) => {
      lineEl.style.cursor = 'pointer';
      lineEl.title = 'Jump to this line';
      lineEl.addEventListener('click', () => {
        // Stop current, jump to line i
        if (window._podcastSynthActive) {
          window.speechSynthesis && window.speechSynthesis.cancel();
          window._podcastSynthActive = false;
        }
        if (window._podcastAudioEl) {
          window._podcastAudioEl.pause();
          window._podcastAudioEl.currentTime = 0;
        }
        window._podcastLineIndex = i;
        window._podcastBlobIndex = i;
        // Re-start from that line
        if (window._podcastLines) {
          if (window._podcastBlobs && window._podcastBlobs.length > i) {
            // Audio blob mode
            window._podcastBlobIndex = i;
            if (typeof window._podcastPlayNextBlob === 'function') window._podcastPlayNextBlob();
          } else {
            // Web Speech mode
            if (typeof window._podcastSpeakLines === 'function') window._podcastSpeakLines(window._podcastLines, i);
          }
        }
        _highlightTranscriptLine(i);
        _showStudyToast(`▶ Jumped to line ${i + 1}`);
      });
    });
  };
})();

// ─────────────────────────────────────────────────────────────────────
// FEATURE 12: Animated SVG theme toggle
// ─────────────────────────────────────────────────────────────────────
(function patchThemeToggle() {
  function _updateThemeToggleSVG() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.innerHTML = isLightMode
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="theme-svg sun-svg">
           <circle cx="12" cy="12" r="5"/>
           <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
           <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
           <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
           <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
         </svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="theme-svg moon-svg">
           <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
         </svg>`;
    btn.title = isLightMode ? 'Switch to dark mode' : 'Switch to light mode';
  }

  const _orig = window.toggleTheme;
  window.toggleTheme = function() {
    if (typeof _orig === 'function') _orig();
    _updateThemeToggleSVG();
  };

  // Init on load
  setTimeout(_updateThemeToggleSVG, 300);
})();

// ─────────────────────────────────────────────────────────────────────
// FEATURE 13: Daily Study Challenge
// ─────────────────────────────────────────────────────────────────────
function _checkDailyChallenge() {
  const today = new Date().toDateString();
  const lastChallenge = localStorage.getItem('nexora_last_challenge');
  if (lastChallenge === today) return; // Already shown today

  let cards = [];
  try {
    cards = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]');
  } catch(e) {}

  if (!cards.length) return; // No cards to challenge with

  // Pick a random card that was reviewed at least once
  const reviewed = cards.filter(c => c.reps > 0);
  if (!reviewed.length) return;

  const card = reviewed[Math.floor(Math.random() * reviewed.length)];
  localStorage.setItem('nexora_last_challenge', today);

  setTimeout(() => {
    const panel = document.createElement('div');
    panel.id = 'daily-challenge-panel';
    panel.className = 'daily-challenge-panel';
    panel.innerHTML = `
      <div class="dc-header">
        <span class="dc-badge">🎯 Daily Challenge</span>
        <button class="dc-close" onclick="document.getElementById('daily-challenge-panel').remove()">✕</button>
      </div>
      <div class="dc-question">${_esc(card.front)}</div>
      <button class="dc-reveal-btn" onclick="this.style.display='none';document.getElementById('dc-answer').style.display='block'">Reveal Answer 👇</button>
      <div id="dc-answer" class="dc-answer" style="display:none">${_esc(card.back)}</div>
      <div class="dc-actions" id="dc-actions" style="display:none">
        <button class="dc-rate hard" onclick="closeDailyChallenge(0)">😕 Hard</button>
        <button class="dc-rate ok" onclick="closeDailyChallenge(1)">🤔 Got it</button>
        <button class="dc-rate easy" onclick="closeDailyChallenge(2)">✅ Easy</button>
      </div>`;

    panel.querySelector('#dc-answer') && panel.querySelector('.dc-reveal-btn').addEventListener('click', () => {
      setTimeout(() => { const da = document.getElementById('dc-actions'); if (da) da.style.display = 'flex'; }, 50);
    });

    document.getElementById('phone').appendChild(panel);
    window._dcCard = card;
  }, 2500);
}

function closeDailyChallenge(rating) {
  const panel = document.getElementById('daily-challenge-panel');
  if (panel) panel.remove();
  if (window._dcCard && window.NexoraData?.runWorkerTask) {
    NexoraData.runWorkerTask('srs-review', { card: window._dcCard, rating, now: Date.now() }).then(updated => {
      if (updated) {
        // Update in srsCards
        if (typeof srsCards !== 'undefined') {
          const idx = srsCards.findIndex(c => c.id === updated.id);
          if (idx !== -1) { srsCards[idx] = updated; if (typeof srsSaveCards === 'function') srsSaveCards(); }
        }
      }
    }).catch(() => {});
  }
  const msgs = ['🔥 Keep it up!', '🧠 Memory sharpened!', '✅ Challenge done for today!'];
  _showStudyToast(msgs[rating] || '✅ Challenge done!');
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE 14: Export to Anki CSV
// ─────────────────────────────────────────────────────────────────────
function exportToAnki() {
  let cards = [];
  try {
    cards = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_srs_cards', []) : JSON.parse(localStorage.getItem('nexora_srs_cards') || '[]');
  } catch(e) {}

  if (!cards.length) { _showStudyToast('No saved cards to export. Save some flashcards first!'); return; }

  // Anki import format: Front<tab>Back<tab>Tags
  const rows = ['#separator:tab', '#html:false', '#notetype:Basic', '#deck:Nexora Import'];
  cards.forEach(c => {
    const front = String(c.front || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
    const back  = String(c.back  || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
    const tag   = String(c.tag   || 'nexora').replace(/\s+/g, '_');
    rows.push(`${front}\t${back}\t${tag}`);
  });

  const blob = new Blob([rows.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexora-anki-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  _showStudyToast(`📥 Exported ${cards.length} cards for Anki!`);
}

// Export a specific saved deck to Anki format
function exportDeckToAnki(deckIdx) {
  let decks = [];
  try { decks = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]'); } catch(e) {}
  const deck = decks[deckIdx];
  if (!deck) { _showStudyToast('Deck not found!'); return; }

  const rows = ['#separator:tab', '#html:false', '#notetype:Basic', `#deck:Nexora - ${deck.topic}`];
  deck.cards.forEach(c => {
    const front = String(c.front || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
    const back  = String(c.back  || '').replace(/\t/g, ' ').replace(/\n/g, ' ');
    const tag   = String(c.tag   || deck.topic || 'nexora').replace(/\s+/g, '_');
    rows.push(`${front}\t${back}\t${tag}`);
  });

  const blob = new Blob([rows.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexora-anki-${deck.topic.slice(0,30).replace(/[^a-z0-9]/gi,'_')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  _showStudyToast(`📥 Exported "${deck.topic}" — ${deck.cards.length} cards for Anki!`);
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE 15: Shareable Deck Links
// ─────────────────────────────────────────────────────────────────────
function shareFlashcardDeck(deckIdx) {
  let decks = [];
  try {
    decks = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]');
  } catch(e) {}

  const deck = decks[deckIdx];
  if (!deck) { _showStudyToast('Deck not found!'); return; }

  try {
    const payload = JSON.stringify({ topic: deck.topic, cards: deck.cards.map(c => ({ front: c.front, back: c.back, hint: c.hint, tag: c.tag })) });
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    const url = `${window.location.origin}${window.location.pathname}?deck=${b64}`;
    navigator.clipboard.writeText(url).then(() => {
      _showStudyToast('🔗 Deck link copied! Share it with friends.');
    }).catch(() => {
      // Fallback: show URL in prompt
      prompt('Copy this link to share your deck:', url);
    });
  } catch(e) {
    _showStudyToast('Could not create share link. Deck may be too large.');
  }
}

function importSharedDeck() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('deck');
  if (!encoded) return;

  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!payload.topic || !Array.isArray(payload.cards) || !payload.cards.length) return;

    // Remove ?deck= from URL without reload
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    // Import after study mode is ready
    setTimeout(() => {
      let decks = [];
      try { decks = window.NexoraData?.getJSON ? NexoraData.getJSON('nexora_fc_decks', []) : JSON.parse(localStorage.getItem('nexora_fc_decks') || '[]'); } catch(e) {}
      const imported = { topic: payload.topic, cards: payload.cards, savedAt: Date.now() };
      decks.push(imported);
      if (window.NexoraData?.setJSON) NexoraData.setJSON('nexora_fc_decks', decks);
      else localStorage.setItem('nexora_fc_decks', JSON.stringify(decks));

      // Show notification
      const toast = document.createElement('div');
      toast.className = 'import-toast';
      toast.innerHTML = `📚 <strong>Deck imported!</strong><br>"${_esc(payload.topic)}" — ${payload.cards.length} cards<br><button onclick="openStudyMode();setTimeout(()=>switchStudyTab('flashcard'),300);" class="import-toast-btn">View in Study Mode →</button>`;
      document.getElementById('phone').appendChild(toast);
      setTimeout(() => toast.remove(), 6000);
    }, 1500);
  } catch(e) {
    console.warn('[Nexora] Failed to import shared deck:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────
// BOOT: run init patches after DOM ready
// ─────────────────────────────────────────────────────────────────────
(function nexoraFeaturesInit() {
  // Wait for load
  const _run = () => {
    // Fix 1: immediately update badge
    if (window.updateResponseModeUI) updateResponseModeUI();

    // Feature 4: render smart suggestions
    renderSmartSuggestions();

    // Feature 13: daily challenge (after greeting delay)
    setTimeout(_checkDailyChallenge, 3000);

    // Feature 15: import shared deck from URL
    importSharedDeck();
  };

  if (document.readyState === 'complete') _run();
  else window.addEventListener('load', _run);
})();

// ╔══════════════════════════════════════════════════════════════════╗
// ║  NEXORA — Vercel Backend Integration Patch                      ║
// ║  Drop this at the very bottom of app.js                        ║
// ║  It overrides callOpenRouter to use your Vercel backend         ║
// ╚══════════════════════════════════════════════════════════════════╝

(function patchNexoraBackend() {
  'use strict';

  // ── YOUR VERCEL BACKEND URL ──────────────────────────────────────
  // After deploying, replace this with your actual Vercel URL
const BACKEND_URL = 'https://nexora-backend-sigma.vercel.app';
  // ─────────────────────────────────────────────────────────────────

  const CHAT_ENDPOINT   = `${BACKEND_URL}/api/chat`;
  const STATUS_ENDPOINT = `${BACKEND_URL}/api/status`;

  // ── Rate limit state (shown in UI) ───────────────────────────────
  let _guestRemaining = null;
  let _guestLimit     = 40;
  let _resetAt        = null;
  let _isOwnKey       = false;

  // ── Show usage badge in header ────────────────────────────────────
  function _updateUsageBadge(remaining, limit, isOwn) {
    let badge = document.getElementById('nexora-usage-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'nexora-usage-badge';
      badge.className = 'nexora-usage-badge';
      const hs = document.getElementById('headerStatus');
      if (hs) hs.after(badge);
    }

    if (isOwn) {
      badge.textContent = '∞ unlimited';
      badge.className = 'nexora-usage-badge unlimited';
      return;
    }

    // Guard against null/undefined/NaN before rendering
    if (remaining === null || remaining === undefined || isNaN(Number(remaining))) return;
    const rem = Number(remaining);
    const lim = Number(limit) || 40;
    const pct = rem / lim;
    badge.textContent = `${rem}/${lim} msgs left`;
    badge.className = 'nexora-usage-badge ' + (pct > 0.5 ? 'good' : pct > 0.2 ? 'warn' : 'low');
  }

  // ── Show rate-limit toast ─────────────────────────────────────────
  function _showRateLimitToast(resetInMin) {
    const existing = document.getElementById('nexora-rate-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'nexora-rate-toast';
    toast.className = 'nexora-rate-toast';
    toast.innerHTML = `
      <div class="nrt-icon">⏳</div>
      <div class="nrt-body">
        <div class="nrt-title">Free limit reached</div>
        <div class="nrt-msg">Resets in <strong>${resetInMin} min</strong>. Add your own API key in <span class="nrt-link" onclick="document.getElementById('apiPanel')?.classList.add('open')">Settings</span> for unlimited access.</div>
      </div>
      <button class="nrt-close" onclick="this.parentElement.remove()">✕</button>`;

    const phone = document.getElementById('phone') || document.body;
    phone.appendChild(toast);
    setTimeout(() => toast?.remove(), 10000);
  }

  // ── Get user's own key from storage ──────────────────────────────
  function _getUserKey() {
    const orKey = localStorage.getItem('nexora_user_key');
    if (orKey && orKey.startsWith('sk-or-')) return { key: orKey, type: 'openrouter' };

    const gemKey = localStorage.getItem('nexora_gemini_key');
    if (gemKey && (gemKey.startsWith('AIza') || gemKey.startsWith('AQ.'))) return { key: gemKey, type: 'gemini' };

    return null;
  }

  // ── Build system prompt (same as existing Nexora logic) ──────────
  function _buildSystemPrompt() {
    const name    = typeof userName !== 'undefined' ? userName : '';
    const mode    = typeof currentMode !== 'undefined' ? currentMode : 'support';
    const history = typeof emotionHistory !== 'undefined' ? emotionHistory : [];

    const modeDesc = {
      support: 'You are Nexora, a warm, empathetic AI companion. Be caring, personal and supportive.',
      gossip : 'You are Nexora in gossip mode — fun, chatty, pop-culture savvy and entertaining.',
      hype   : 'You are Nexora in hype mode — motivational, energetic and uplifting.',
    }[mode] || 'You are Nexora, a helpful AI companion.';

    const recentEmotions = history.slice(-3).map(e => e.emotion).join(', ');

    return [
      modeDesc,
      name ? `The user's name is ${name}.` : '',
      recentEmotions ? `Recent emotional context: ${recentEmotions}.` : '',
      'Keep responses concise, warm and conversational. Use markdown for code/lists when helpful.',
    ].filter(Boolean).join('\n');
  }

  // ── Build messages array from session log ─────────────────────────
  function _buildMessages(userInput) {
    const log = typeof sessionLog !== 'undefined' ? sessionLog : [];
    const history = log.slice(-8).map(m => ({
      role   : m.role === 'bot' ? 'assistant' : 'user',
      content: String(m.text || '').slice(0, 300),
    }));
    return [...history, { role: 'user', content: userInput }];
  }

  // ── Main API call to Vercel backend ──────────────────────────────
  async function callVercelBackend(userInput) {
    const ownKey = _getUserKey();
    _isOwnKey    = Boolean(ownKey);

    const headers = { 'Content-Type': 'application/json' };
    if (ownKey) {
      headers['X-User-Key']      = ownKey.key;
      headers['X-User-Key-Type'] = ownKey.type;
    }

    let res;
    try {
      res = await fetchWithTimeout(CHAT_ENDPOINT, {
        method : 'POST',
        headers,
        body   : JSON.stringify({
          messages: _buildMessages(userInput),
          system  : _buildSystemPrompt(),
        }),
      }, 28000);
    } catch (e) {
      console.warn('[Nexora Backend] Network error:', e?.message);
      return null; // will fall through to existing callOpenRouter
    }

    // Handle rate limit
    if (res.status === 429) {
      let data = {};
      try { data = await res.json(); } catch {}
      _showRateLimitToast(data.resetInMin || 60);
      _guestRemaining = 0;
      _updateUsageBadge(0, _guestLimit, false);
      return `⏳ You've reached the free limit (${_guestLimit} messages/hour). Add your own API key in Settings → API Keys for unlimited access, or wait ${data.resetInMin || 60} minutes.`;
    }

    if (!res.ok) {
      console.warn('[Nexora Backend] Error:', res.status);
      return null;
    }

    let data;
    try { data = await res.json(); } catch { return null; }

    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return null;

    // Update usage display
    if (data.usage) {
      _guestRemaining = data.usage.remaining;
      _guestLimit     = data.usage.limit || 40;
      _isOwnKey       = data.usage.isOwnKey || false;
      _updateUsageBadge(_guestRemaining, _guestLimit, _isOwnKey);
    }

    return reply;
  }

  // ── Check status on load ─────────────────────────────────────────
  async function checkBackendStatus() {
    try {
      const ownKey  = _getUserKey();
      const headers = {};
      if (ownKey) headers['X-User-Key'] = ownKey.key;

      const res  = await fetchWithTimeout(STATUS_ENDPOINT, { headers }, 5000);
      if (!res.ok) return;
      const data = await res.json();

      if (data.guest) {
        _guestRemaining = data.guest.remaining;
        _guestLimit     = data.guest.limit;
        _resetAt        = data.guest.resetAt;
        _isOwnKey       = data.isOwnKey;
        _updateUsageBadge(_guestRemaining, _guestLimit, _isOwnKey);
      }
    } catch { /* backend offline, gracefully ignore */ }
  }

  // ── Patch callOpenRouter to try Vercel backend FIRST ─────────────
  const _origCallOpenRouter = window.callOpenRouter;
  window.callOpenRouter = async function(userMessage) {
    // 1. Try Vercel backend first
    const backendReply = await callVercelBackend(userMessage);
    if (backendReply) return backendReply;

    // 2. Fall back to original OpenRouter logic (user's own key direct)
    if (typeof _origCallOpenRouter === 'function') {
      return _origCallOpenRouter(userMessage);
    }
    return null;
  };

  // ── CSS for usage badge and rate toast ───────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .nexora-usage-badge {
      display: inline-flex;
      align-items: center;
      font-size: 10.5px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 20px;
      margin-left: 6px;
      letter-spacing: 0.02em;
      transition: background 0.3s, color 0.3s;
    }
    .nexora-usage-badge.good      { background: rgba(34,197,94,0.15);  color: #4ade80; }
    .nexora-usage-badge.warn      { background: rgba(251,191,36,0.15); color: #fbbf24; }
    .nexora-usage-badge.low       { background: rgba(239,68,68,0.15);  color: #f87171; }
    .nexora-usage-badge.unlimited { background: rgba(124,92,255,0.15); color: #a78bfa; }
    .light-mode .nexora-usage-badge.good      { background: rgba(34,197,94,0.12);  }
    .light-mode .nexora-usage-badge.warn      { background: rgba(251,191,36,0.12); }
    .light-mode .nexora-usage-badge.low       { background: rgba(239,68,68,0.12);  }
    .light-mode .nexora-usage-badge.unlimited { background: rgba(124,92,255,0.1);  }

    .nexora-rate-toast {
      position: absolute;
      bottom: 88px;
      left: 12px; right: 12px;
      background: var(--card, #0f172a);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: 16px;
      padding: 14px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      z-index: 9999;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      animation: toastSlideUp 0.3s cubic-bezier(0.34,1.56,0.64,1);
    }
    .light-mode .nexora-rate-toast {
      background: #fff;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }
    @keyframes toastSlideUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0);    }
    }
    .nrt-icon { font-size: 22px; flex-shrink: 0; }
    .nrt-body { flex: 1; min-width: 0; }
    .nrt-title {
      font-size: 13px; font-weight: 700;
      color: #f87171; margin-bottom: 3px;
    }
    .nrt-msg {
      font-size: 12px; color: var(--text2, #94a3b8);
      line-height: 1.5;
    }
    .nrt-link {
      color: var(--accent, #7c5cff);
      cursor: pointer; text-decoration: underline;
      text-underline-offset: 2px;
    }
    .nrt-close {
      background: none; border: none;
      color: var(--text3, #64748b);
      font-size: 15px; cursor: pointer;
      padding: 2px 4px; border-radius: 6px;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .nrt-close:hover { background: rgba(255,255,255,0.07); }
  `;
  document.head.appendChild(style);

  // ── Init ─────────────────────────────────────────────────────────
  if (document.readyState === 'complete') checkBackendStatus();
  else window.addEventListener('load', checkBackendStatus);

  // Expose for debugging
  window._nexoraBackend = { checkStatus: checkBackendStatus, BACKEND_URL };

  console.log('[Nexora] Backend integration loaded ✅', BACKEND_URL);
})();
