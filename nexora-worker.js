/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║        NEXORA — Cloudflare AI Worker Proxy v2.0                 ║
 * ║  + /podcast  endpoint: AI script generation                     ║
 * ║  + /tts      endpoint: Text-to-Speech via CF TTS model          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * BINDINGS REQUIRED (Workers → Settings → Variables & Bindings):
 *   AI        → Workers AI binding (free)
 *
 * ROUTES:
 *   GET  /              → health check
 *   GET  /health        → health check
 *   POST /ai            → AI chat completions (existing)
 *   POST /podcast       → Generate podcast script from topic or text
 *   POST /tts           → Text-to-Speech → returns audio/mpeg
 */

// ── AI models ──────────────────────────────────────────────────────
const MODELS = {
  'cf-claude': {
    primary:   '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    fallbacks: ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.2'],
    label:     'CF Claude (Llama 70B)',
  },
  'cf-llama': {
    primary:   '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    fallbacks: ['@cf/meta/llama-3.1-8b-instruct'],
    label:     'CF Llama 3.3 70B',
  },
  'cf-qwen': {
    primary:   '@cf/meta/llama-3.1-8b-instruct',
    fallbacks: ['@cf/mistral/mistral-7b-instruct-v0.2'],
    label:     'CF Qwen (Llama 8B)',
  },
  'cf-gemma': {
    primary:   '@cf/google/gemma-3-12b-it',
    fallbacks: ['@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.2'],
    label:     'CF Gemma 3 12B',
  },
  'cf-mistral': {
    primary:   '@cf/mistral/mistral-7b-instruct-v0.2',
    fallbacks: ['@cf/meta/llama-3.1-8b-instruct'],
    label:     'CF Mistral 7B',
  },
  'cf-deepseek': {
    primary:   '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    fallbacks: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
    label:     'CF DeepSeek R1',
  },
};

const MAX_TOKENS = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast':      768,
  '@cf/meta/llama-3.1-8b-instruct':                768,
  '@cf/mistral/mistral-7b-instruct-v0.2':          768,
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': 1536,
  '@cf/google/gemma-3-12b-it':                     768,
};

// Script generation uses the best available model with higher token limit
const SCRIPT_MODEL  = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const SCRIPT_TOKENS = 2048;

// ── CF TTS model (free, available in Workers AI) ────────────────────
// MeloTTS returns MP3 audio.
const TTS_MODEL = '@cf/myshell-ai/melotts'; // free CF TTS model

// ── Router ──────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204);
    const url = new URL(request.url);

    // Health
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return cors(JSON.stringify({
        status: 'ok',
        worker: 'Nexora CF AI Proxy v2.0',
        endpoints: ['/ai', '/podcast', '/tts'],
        models: Object.keys(MODELS),
        timestamp: new Date().toISOString(),
      }));
    }

    if (request.method === 'POST') {
      if (url.pathname === '/ai')      return handleAI(request, env);
      if (url.pathname === '/podcast') return handlePodcast(request, env);
      if (url.pathname === '/tts')     return handleTTS(request, env);
    }

    return cors(JSON.stringify({ error: 'Not found' }), 404);
  }
};

// ══════════════════════════════════════════════════════════════════════
//  /ai  — existing chat completion endpoint (unchanged)
// ══════════════════════════════════════════════════════════════════════
async function handleAI(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return cors(JSON.stringify({ error: 'Invalid JSON body' }), 400); }

  const { model: alias, messages, max_tokens, temperature } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return cors(JSON.stringify({ error: 'messages array is required' }), 400);

  if (!env.AI)
    return cors(JSON.stringify({
      error: 'Workers AI binding missing.',
    }), 500);

  const meta   = MODELS[alias] || MODELS['cf-llama'];
  const toTry  = [meta.primary, ...(meta.fallbacks || [])];
  const system = messages.find(m => m.role === 'system');
  const chats  = messages.filter(m => m.role !== 'system');
  const all    = system ? [{ role:'system', content:system.content }, ...chats] : chats;

  let lastErr = '';
  for (const cfModel of toTry) {
    try {
      const result = await env.AI.run(cfModel, {
        messages: all,
        max_tokens: max_tokens || MAX_TOKENS[cfModel] || 768,
        temperature: temperature ?? 0.7,
      });
      const text = (result?.response || result?.result?.response || '').trim();
      if (text && text.length > 2) {
        return cors(JSON.stringify({
          id: 'cf-' + Date.now(),
          object: 'chat.completion',
          model: cfModel,
          choices: [{ index:0, message:{ role:'assistant', content:text }, finish_reason:'stop' }],
          usage: { prompt_tokens:0, completion_tokens:0, total_tokens:0 },
          _nexora: { alias, cfModel, label: meta.label },
        }));
      }
      lastErr = `${cfModel} returned empty response`;
    } catch(e) {
      lastErr = e?.message || String(e);
      const errLow = lastErr.toLowerCase();
      if (errLow.includes('limit') || errLow.includes('quota') || errLow.includes('rate')) {
        return cors(JSON.stringify({ error: 'Daily free limit reached. Resets at midnight UTC.' }), 429);
      }
      if (errLow.includes('unavailable') || errLow.includes('overloaded')) {
        // Try next model instead of bailing
        continue;
      }
    }
  }
  return cors(JSON.stringify({ error: 'All models failed', tried: toTry, last_error: lastErr }), 502);
}

// ══════════════════════════════════════════════════════════════════════
//  /podcast  — Generate a 2-voice podcast script from topic or text
//
//  Request body:
//    { topic?: string, text?: string, style?: 'dialogue'|'monologue', length?: 'short'|'medium'|'long' }
//
//  Response:
//    { script: string, lines: [{speaker:'HOST'|'STUDENT', text:string}], title:string, summary:string }
// ══════════════════════════════════════════════════════════════════════
async function handlePodcast(request, env) {
  if (!env.AI) return cors(JSON.stringify({ error: 'Workers AI binding missing.' }), 500);

  let body;
  try { body = await request.json(); }
  catch { return cors(JSON.stringify({ error: 'Invalid JSON' }), 400); }

  const { topic, text, style = 'dialogue', length = 'medium' } = body;
  if (!topic && !text)
    return cors(JSON.stringify({ error: 'Provide topic or text' }), 400);

  const lengthGuide = { short: '3–4 minutes', medium: '6–8 minutes', long: '10–12 minutes' }[length] || '6–8 minutes';

  // Build prompt based on input type
  let inputSection = '';
  if (text && text.trim().length > 20) {
    inputSection = `The student has uploaded these notes/document:\n\n"""\n${text.slice(0, 3500)}\n"""\n\nConvert all key concepts from these notes into the podcast script.`;
  } else {
    inputSection = `Topic: "${topic}"`;
  }

  const styleGuide = style === 'dialogue'
    ? `Write as a friendly dialogue between two people:
- HOST: an enthusiastic, knowledgeable teacher (warm, clear, uses analogies)
- STUDENT: a curious student who asks the questions everyone is thinking (relatable, sometimes surprised)
Format EVERY line strictly as:
HOST: <text>
STUDENT: <text>
No other prefixes. No stage directions. No asterisks.`
    : `Write as a single-voice narration. Format every line as:
HOST: <text>`;

  const systemPrompt = `You are a world-class educational podcast scriptwriter. You create engaging, clear, memorable audio lessons that feel like listening to a brilliant friend explain something.`;

  const userPrompt = `${inputSection}

Create a ${lengthGuide} educational podcast script about this topic.

${styleGuide}

Structure:
1. Hook opening — grab attention in the first 10 seconds with a question or surprising fact
2. Introduction — what we're learning today and why it matters
3. Core concepts — explained step by step using simple language and relatable analogies
4. Real-world examples — at least 2 concrete, vivid examples
5. Common misconceptions — address 1-2 things people get wrong
6. Quick recap — key takeaways in 3 bullet-point style sentences
7. Outro — friendly sign-off with encouragement

Tone: conversational, friendly, smart but not condescending. Simple English. Short sentences.
Do NOT include any music cues, sound effects, or stage directions.
Do NOT use markdown formatting — plain text only.
Start directly with the first HOST line.`;

  try {
    const result = await env.AI.run(SCRIPT_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: SCRIPT_TOKENS,
      temperature: 0.72,
    });

    const rawScript = result?.response || result?.result?.response || '';
    if (!rawScript || rawScript.length < 50)
      return cors(JSON.stringify({ error: 'Script generation returned empty' }), 502);

    // Parse into structured lines
    const lines = _parseScript(rawScript);
    const title = topic
      ? `📻 ${topic}`
      : `📻 Study Podcast`;

    // Extract a 1-sentence summary from first HOST line
    const firstHost = lines.find(l => l.speaker === 'HOST');
    const summary   = firstHost ? firstHost.text.slice(0, 120) + (firstHost.text.length > 120 ? '…' : '') : '';

    return cors(JSON.stringify({
      ok: true,
      title,
      summary,
      script: rawScript,
      lines,
      model: SCRIPT_MODEL,
      length,
      style,
    }));

  } catch(e) {
    return cors(JSON.stringify({ error: 'Script generation failed: ' + (e?.message || String(e)) }), 502);
  }
}

// Parse "HOST: ..." / "STUDENT: ..." lines into structured array
function _parseScript(raw) {
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
      // continuation of previous line
      lines[lines.length - 1].text += ' ' + line;
    }
  }
  // If nothing parsed (monologue model gave no prefix), treat entire thing as HOST lines
  if (lines.length === 0) {
    rawLines.forEach(l => { if (l.length > 10) lines.push({ speaker: 'HOST', text: l }); });
  }
  return lines;
}

// ══════════════════════════════════════════════════════════════════════
//  /tts  — Text-to-Speech using Cloudflare's free TTS model
//
//  Request body:
//    { text: string, voice?: 'en-us-male'|'en-us-female' }
//
//  Response: audio/wav binary (or JSON error)
// ══════════════════════════════════════════════════════════════════════
async function handleTTS(request, env) {
  if (!env.AI) return cors(JSON.stringify({ error: 'Workers AI binding missing.' }), 500);

  let body;
  try { body = await request.json(); }
  catch { return cors(JSON.stringify({ error: 'Invalid JSON' }), 400); }

  const { text } = body;
  if (!text || text.trim().length === 0)
    return cors(JSON.stringify({ error: 'text is required' }), 400);

  // Truncate to safe length for TTS model
  const safeText = text.trim().slice(0, 500);

  try {
    const result = await env.AI.run(TTS_MODEL, {
      prompt: safeText,
      lang: 'en',
    });

    // CF TTS can return: base64 string, ArrayBuffer, or { audio: base64 }
    let audioBytes;
    if (result instanceof ArrayBuffer) {
      audioBytes = new Uint8Array(result);
    } else if (result instanceof Uint8Array) {
      audioBytes = result;
    } else {
      const audioB64 = typeof result === 'string'
        ? result
        : (result?.audio || result?.result?.audio || '');
      if (!audioB64) {
        return cors(JSON.stringify({
          error: 'TTS returned empty audio. The CF TTS model may not be available in your Worker region.',
          hint: 'The frontend will automatically fall back to the Web Speech API.',
        }), 502);
      }
      audioBytes = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
    }

    if (!audioBytes || audioBytes.length < 100) {
      return cors(JSON.stringify({
        error: 'TTS audio too short — likely a model error.',
        hint: 'Frontend will fall back to Web Speech API.',
      }), 502);
    }

    return new Response(audioBytes, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBytes.length),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-store',
      },
    });
  } catch(e) {
    return cors(JSON.stringify({
      error: 'TTS failed: ' + (e?.message || String(e)),
      hint: 'The CF TTS model may not be available in your Worker region. The frontend will fall back to Web Speech API.',
    }), 502);
  }
}

// ── CORS helper ─────────────────────────────────────────────────────
function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
