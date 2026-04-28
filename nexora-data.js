(function () {
  'use strict';

  const DB_NAME = 'nexora_data_v1';
  const STORE_NAME = 'kv';
  const DEFAULT_DEBOUNCE_MS = 500;
  const LARGE_JSON_KEYS = new Set([
    'nexora_fc_decks',
    'nexora_srs_cards',
    'nexora_chat_v2',
    'nexora_quiz_hist',
    'nexora_study_time_log',
  ]);
  const PERSISTED_JSON_KEYS = new Set([
    ...LARGE_JSON_KEYS,
    'nexora_emotions',
    'nexora_topics',
    'nexora_profile',
    'nexora_srs_streak',
    'nexora_podcasts',
  ]);
  const PERSISTED_TEXT_KEYS = new Set([
    'nexora_chat_summary_v1',
    'nexora_mood',
    'nexora_remembrance_day',
  ]);
  const JSON_DEFAULTS = {
    nexora_fc_decks: [],
    nexora_srs_cards: [],
    nexora_chat_v2: [],
    nexora_quiz_hist: [],
    nexora_study_time_log: [],
    nexora_emotions: [],
    nexora_topics: [],
    nexora_profile: { emotional: 0, logical: 0 },
    nexora_srs_streak: {},
    nexora_podcasts: [],
  };

  const jsonCache = new Map();
  const textCache = new Map();
  const jsonTimers = new Map();
  const textTimers = new Map();
  let dbPromise = null;
  let workerPromise = null;

  function defaultForKey(key) {
    return JSON_DEFAULTS[key]
      ? cloneValue(JSON_DEFAULTS[key])
      : null;
  }

  function cloneValue(value) {
    if (value == null) return value;
    try {
      return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    } catch (e) {
      return value;
    }
  }

  function toUtf8Bytes(text) {
    return new TextEncoder().encode(String(text));
  }

  function fromUtf8Bytes(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function compressText(text) {
    const raw = String(text ?? '');
    if (!raw) return { encoding: 'plain', payload: '' };
    if (!('CompressionStream' in window) || raw.length < 1024) {
      return { encoding: 'plain', payload: raw };
    }
    try {
      const blob = new Blob([raw], { type: 'text/plain' });
      const compressed = blob.stream().pipeThrough(new CompressionStream('gzip'));
      const buf = await new Response(compressed).arrayBuffer();
      return { encoding: 'gzip', payload: bytesToBase64(new Uint8Array(buf)) };
    } catch (e) {
      return { encoding: 'plain', payload: raw };
    }
  }

  async function decompressText(record) {
    if (!record) return '';
    const encoding = record.encoding || 'plain';
    const payload = String(record.payload || '');
    if (!payload) return '';
    if (encoding !== 'gzip') return payload;
    if (!('DecompressionStream' in window)) return payload;
    try {
      const blob = new Blob([base64ToBytes(payload)], { type: 'application/octet-stream' });
      const decompressed = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      const buf = await new Response(decompressed).arrayBuffer();
      return fromUtf8Bytes(new Uint8Array(buf));
    } catch (e) {
      return payload;
    }
  }

  async function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
    return dbPromise;
  }

  async function idbGet(key) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      return await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
      });
    } catch (e) {
      return null;
    }
  }

  async function idbPut(record) {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB put failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB put aborted'));
    });
  }

  async function idbDelete(key) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
      });
    } catch (e) {}
  }

  async function persistJSONNow(key, value) {
    const text = JSON.stringify(value ?? defaultForKey(key));
    const record = {
      key,
      type: 'json',
      updatedAt: Date.now(),
      ...(await compressText(text)),
    };
    try {
      await idbPut(record);
      try { localStorage.removeItem(key); } catch (e) {}
      return true;
    } catch (e) {
      try {
        localStorage.setItem(key, JSON.stringify({ type: 'json', updatedAt: record.updatedAt, ...record }));
      } catch (err) {}
      return false;
    }
  }

  async function persistTextNow(key, value, extra = {}) {
    const text = String(value ?? '');
    const record = {
      key,
      type: 'text',
      updatedAt: Date.now(),
      ...extra,
      ...(await compressText(text)),
    };
    try {
      await idbPut(record);
      try { localStorage.removeItem(key); } catch (e) {}
      return true;
    } catch (e) {
      try {
        localStorage.setItem(key, JSON.stringify({ type: 'text', updatedAt: record.updatedAt, ...record }));
      } catch (err) {}
      return false;
    }
  }

  async function flushAll() {
    const jsonTasks = [...jsonTimers.keys()].map(key => {
      const timer = jsonTimers.get(key);
      if (timer) clearTimeout(timer);
      jsonTimers.delete(key);
      return persistJSONNow(key, jsonCache.get(key));
    });
    const textTasks = [...textTimers.keys()].map(key => {
      const timer = textTimers.get(key);
      if (timer) clearTimeout(timer);
      textTimers.delete(key);
      const cached = textCache.get(key);
      const value = cached && typeof cached === 'object' ? cached.text : cached;
      const extra = cached && typeof cached === 'object' && cached.expiresAt
        ? { expiresAt: cached.expiresAt }
        : {};
      return persistTextNow(key, value, extra);
    });
    await Promise.allSettled([...jsonTasks, ...textTasks]);
  }

  async function readRecord(key) {
    let record = await idbGet(key);
    if (record) return record;

    const legacy = localStorage.getItem(key);
    if (!legacy) return null;

    try {
      const parsed = JSON.parse(legacy);
      if (parsed && typeof parsed === 'object' && parsed.payload && parsed.encoding) {
        return parsed;
      }
      if (Array.isArray(parsed) || parsed === null || typeof parsed === 'object') {
        if (PERSISTED_JSON_KEYS.has(key)) {
          await persistJSONNow(key, parsed);
          return {
            key,
            type: 'json',
            encoding: 'plain',
            payload: JSON.stringify(parsed),
          };
        }
      } else if (PERSISTED_TEXT_KEYS.has(key)) {
        return {
          key,
          type: 'text',
          encoding: 'plain',
          payload: legacy,
        };
      }
    } catch (e) {
      if (PERSISTED_TEXT_KEYS.has(key) || !PERSISTED_JSON_KEYS.has(key)) {
        return {
          key,
          type: 'text',
          encoding: 'plain',
          payload: legacy,
        };
      }
    }

    return null;
  }

  async function decodeRecord(record) {
    if (!record) return null;
    const raw = await decompressText(record);
    if (record.type === 'text') return raw;
    try {
      return JSON.parse(raw || 'null');
    } catch (e) {
      return defaultForKey(record.key);
    }
  }

  function scheduleTimer(map, key, fn, ms = DEFAULT_DEBOUNCE_MS) {
    const prev = map.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      map.delete(key);
      fn().catch(() => {});
    }, ms);
    map.set(key, timer);
  }

  async function hydrateLargeStores() {
    const tasks = [...PERSISTED_JSON_KEYS].map(async key => {
      const record = await readRecord(key);
      if (!record) {
        const fallback = defaultForKey(key);
        jsonCache.set(key, fallback);
        return fallback;
      }
      const decoded = await decodeRecord(record);
      jsonCache.set(key, cloneValue(decoded ?? defaultForKey(key)));
      return jsonCache.get(key);
    });
    const textTasks = [...PERSISTED_TEXT_KEYS].map(async key => {
      const record = await readRecord(key);
      if (!record) {
        textCache.set(key, '');
        return '';
      }
      const decoded = await decodeRecord(record);
      const text = String(decoded ?? '');
      textCache.set(key, text);
      return text;
    });
    await Promise.all([...tasks, ...textTasks]);
    return true;
  }

  function getJSON(key, fallback = null) {
    if (jsonCache.has(key)) return jsonCache.get(key);
    return fallback !== null ? fallback : defaultForKey(key);
  }

  function setJSON(key, value, opts = {}) {
    const next = cloneValue(value);
    jsonCache.set(key, next);
    if (opts.immediate) {
      return persistJSONNow(key, next);
    }
    scheduleTimer(jsonTimers, key, () => persistJSONNow(key, next), opts.delayMs || DEFAULT_DEBOUNCE_MS);
    return Promise.resolve(next);
  }

  function clearJSON(key) {
    jsonCache.set(key, defaultForKey(key));
    const timer = jsonTimers.get(key);
    if (timer) clearTimeout(timer);
    jsonTimers.delete(key);
    try { localStorage.removeItem(key); } catch (e) {}
    return idbDelete(key);
  }

  function getText(key, fallback = '') {
    if (textCache.has(key)) return textCache.get(key);
    return fallback;
  }

  function setText(key, value, opts = {}) {
    const next = String(value ?? '');
    textCache.set(key, next);
    if (opts.immediate) {
      return persistTextNow(key, next, opts.extra || {});
    }
    scheduleTimer(textTimers, key, () => persistTextNow(key, next, opts.extra || {}), opts.delayMs || DEFAULT_DEBOUNCE_MS);
    return Promise.resolve(next);
  }

  function clearText(key) {
    textCache.set(key, '');
    const timer = textTimers.get(key);
    if (timer) clearTimeout(timer);
    textTimers.delete(key);
    try { localStorage.removeItem(key); } catch (e) {}
    return idbDelete(key);
  }

  function hashText(...parts) {
    let hash = 2166136261;
    const input = parts.map(v => String(v ?? '')).join('||');
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  async function getAiCache(key) {
    const memKey = `ai:${key}`;
    if (textCache.has(memKey)) {
      const mem = textCache.get(memKey);
      if (mem && typeof mem === 'object') {
        if (mem.expiresAt && mem.expiresAt < Date.now()) {
          clearAiCache(key);
          return '';
        }
        return String(mem.text || '');
      }
      return String(mem || '');
    }
    const record = await readRecord(memKey);
    if (!record) return '';
    if (record.expiresAt && record.expiresAt < Date.now()) {
      clearAiCache(key);
      return '';
    }
    const decoded = await decodeRecord(record);
    const text = String(decoded || '');
    textCache.set(memKey, { text, expiresAt: record.expiresAt || 0 });
    return text;
  }

  function setAiCache(key, value, ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const memKey = `ai:${key}`;
    const text = String(value ?? '');
    const expiresAt = Date.now() + ttlMs;
    textCache.set(memKey, { text, expiresAt });
    const extra = { expiresAt };
    scheduleTimer(textTimers, memKey, () => persistTextNow(memKey, text, extra), DEFAULT_DEBOUNCE_MS);
    return Promise.resolve(text);
  }

  function clearAiCache(key) {
    const memKey = `ai:${key}`;
    textCache.delete(memKey);
    const timer = textTimers.get(memKey);
    if (timer) clearTimeout(timer);
    textTimers.delete(memKey);
    try { localStorage.removeItem(memKey); } catch (e) {}
    return idbDelete(memKey);
  }

  async function loadWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = new Promise((resolve, reject) => {
      try {
        const workerUrl = new URL('./nexora-study-worker.js', window.location.href);
        const worker = new Worker(workerUrl, { type: 'classic' });
        const pending = new Map();
        const fail = (err) => {
          try { worker.terminate(); } catch (e) {}
          workerPromise = null;
          pending.forEach(({ reject }) => reject(err?.error || err?.message || new Error('Worker failed')));
          pending.clear();
          reject(err?.error || err?.message || new Error('Worker failed'));
        };
        worker.onmessage = event => {
          const data = event.data || {};
          const pendingItem = pending.get(data.id);
          if (!pendingItem) return;
          pending.delete(data.id);
          if (data.ok) pendingItem.resolve(data.result);
          else pendingItem.reject(new Error(data.error || 'Worker task failed'));
        };
        worker.onerror = fail;
        worker.onmessageerror = fail;
        let seq = 0;
        resolve({
          run(type, payload) {
            return new Promise((res, rej) => {
              const id = `${Date.now()}-${++seq}`;
              pending.set(id, { resolve: res, reject: rej });
              worker.postMessage({ id, type, payload });
            });
          },
          terminate() {
            worker.terminate();
            workerPromise = null;
          }
        });
      } catch (e) {
        workerPromise = null;
        reject(e);
      }
    });
    try {
      return await workerPromise;
    } catch (e) {
      workerPromise = null;
      throw e;
    }
  }

  async function runWorkerTask(type, payload) {
    try {
      const worker = await loadWorker();
      return await worker.run(type, payload);
    } catch (e) {
      return null;
    }
  }

  window.NexoraData = {
    hydrateLargeStores,
    getJSON,
    setJSON,
    clearJSON,
    getText,
    setText,
    clearText,
    hashText,
    getAiCache,
    setAiCache,
    clearAiCache,
    runWorkerTask,
    flushAll,
  };

  window.addEventListener('pagehide', () => {
    flushAll().catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    flushAll().catch(() => {});
  });
})();
