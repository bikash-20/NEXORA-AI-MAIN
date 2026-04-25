/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        NEXORA — Cloudflare AI Worker Proxy v1.1             ║
 * ║  Fixed: confirmed free-tier models + auto-fallback chain    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CONFIRMED FREE TIER MODELS:
 *  ✅ @cf/meta/llama-3.3-70b-instruct-fp8-fast  — best quality
 *  ✅ @cf/meta/llama-3.1-8b-instruct            — fast
 *  ✅ @cf/mistral/mistral-7b-instruct-v0.2      — reliable
 *  ✅ @cf/deepseek-ai/deepseek-r1-distill-qwen-32b — reasoning
 *  ✅ @cf/google/gemma-3-12b-it                 — Google model
 *
 * NOT on free tier (removed from v1.0):
 *  ❌ @cf/anthropic/claude-3-haiku
 *  ❌ @cf/qwen/qwen2.5-72b-instruct
 */

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
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast':      512,
  '@cf/meta/llama-3.1-8b-instruct':                512,
  '@cf/mistral/mistral-7b-instruct-v0.2':          512,
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': 1024,
  '@cf/google/gemma-3-12b-it':                     512,
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204);
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return cors(JSON.stringify({
        status: 'ok',
        worker: 'Nexora CF AI Proxy v1.1',
        models: Object.keys(MODELS),
        timestamp: new Date().toISOString(),
      }));
    }

    if (request.method === 'POST' && url.pathname === '/ai') {
      return handleAI(request, env);
    }

    return cors(JSON.stringify({ error: 'Not found' }), 404);
  }
};

async function handleAI(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return cors(JSON.stringify({ error: 'Invalid JSON body' }), 400); }

  const { model: alias, messages, max_tokens, temperature } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return cors(JSON.stringify({ error: 'messages array is required' }), 400);

  if (!env.AI)
    return cors(JSON.stringify({
      error: 'Workers AI binding missing. Go to Worker → Bindings → Add Workers AI → Variable: AI → Save & Deploy',
    }), 500);

  const meta = MODELS[alias] || MODELS['cf-llama'];
  const toTry = [meta.primary, ...(meta.fallbacks || [])];

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');
  const allMsgs   = systemMsg
    ? [{ role: 'system', content: systemMsg.content }, ...chatMsgs]
    : chatMsgs;

  let lastErr = '';
  for (const cfModel of toTry) {
    try {
      const result = await env.AI.run(cfModel, {
        messages: allMsgs,
        max_tokens: max_tokens || MAX_TOKENS[cfModel] || 512,
        temperature: temperature ?? 0.7,
      });

      const text = result?.response || result?.result?.response || '';
      if (text && text.length > 2) {
        return cors(JSON.stringify({
          id: 'cf-' + Date.now(),
          object: 'chat.completion',
          model: cfModel,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          _nexora: { alias, cfModel, label: meta.label },
        }));
      }
      lastErr = `${cfModel} returned empty`;
    } catch (e) {
      lastErr = e?.message || String(e);
      if (lastErr.includes('limit') || lastErr.includes('quota'))
        return cors(JSON.stringify({ error: 'Daily free limit reached. Resets at midnight UTC.' }), 429);
    }
  }

  return cors(JSON.stringify({
    error: 'All models failed for: ' + (alias || '?'),
    tried: toTry,
    last_error: lastErr,
  }), 502);
}

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
