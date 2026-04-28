/* eslint-disable no-restricted-globals */
'use strict';

const STOPWORDS = new Set([
  'the','and','for','with','from','that','this','those','these','have','has','had','are','was','were','will','would',
  'could','should','about','into','over','under','your','you','me','our','their','there','here','what','when','where',
  'why','how','a','an','to','of','in','on','at','by','it','as','is','be','or','if','then','than','but','not','can',
  'do','does','did','please','tell','explain','give','make','show','help','need','want','like','just','more','less',
]);

function baseTopicLabel(topic) {
  return String(topic || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[.!?\n]/)[0]
    .slice(0, 80) || 'this topic';
}

function extractPoints(topic) {
  const cleaned = String(topic || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  const parts = cleaned.length > 1
    ? cleaned
    : String(topic || '').split(/(?<=[.!?])\s+|[;•]/);
  const points = parts
    .map(s => s.replace(/^[-*]\s*/, '').trim())
    .filter(s => s.length > 12)
    .slice(0, 24);
  return points.length ? points : [String(topic || '').trim()];
}

function hint(text) {
  return String(text || '').split(/\s+/).slice(0, 4).join(' ');
}

function buildLocalFlashcards(topic, count, lang) {
  const topicLabel = baseTopicLabel(topic);
  const points = extractPoints(topic);
  const cards = [];

  if (points.length > 1) {
    for (let i = 0; i < count; i++) {
      const point = points[i % points.length];
      const cardNo = i + 1;
      let front = `What is key point ${cardNo} about ${topicLabel}?`;
      if (lang === 'bangla') front = `${topicLabel} সম্পর্কে ${cardNo} নম্বর গুরুত্বপূর্ণ পয়েন্ট কী?`;
      else if (lang === 'banglish') front = `${topicLabel} niye key point ${cardNo} ki?`;
      cards.push({
        front,
        back: point,
        hint: hint(point),
        tag: topicLabel,
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
    cards.push({ front, back, hint: hint(back), tag: topicLabel });
  }
  return cards;
}

function buildLocalQuiz(topic, count, difficulty) {
  const topicLabel = baseTopicLabel(topic);
  const points = extractPoints(topic);
  const genericAnswers = [
    `It defines the basic idea of ${topicLabel}.`,
    `It explains why ${topicLabel} is useful in practice.`,
    `It focuses on the main steps or structure of ${topicLabel}.`,
    `It gives a concrete example of ${topicLabel}.`,
    `It highlights a common mistake related to ${topicLabel}.`,
    `It summarises the most important takeaway about ${topicLabel}.`,
  ];
  const answerPool = (points.length > 1 ? points : genericAnswers)
    .map(s => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const questions = [];
  for (let i = 0; i < count; i++) {
    const correctText = answerPool[i % answerPool.length];
    const distractors = answerPool.filter(s => s !== correctText).slice(0, 3);
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
      explanation: `The best answer is the one that directly matches the study material for ${topicLabel}.`,
    });
  }
  return questions;
}

function reviewSrsCard(card, rating, now) {
  const updated = { ...card };
  const easeDelta = [-0.3, 0, 0.1][rating] || 0;
  const ease = Math.max(1.3, (updated.ease || 2.5) + easeDelta);
  let interval;
  if (rating === 0) {
    interval = 1;
    updated.reps = 0;
  } else {
    updated.reps = (updated.reps || 0) + 1;
    interval = updated.reps === 1 ? 1 : updated.reps === 2 ? 3 : Math.round((updated.interval || 1) * ease);
  }
  updated.ease = ease;
  updated.interval = interval;
  updated.next_review = now + interval * 24 * 60 * 60 * 1000;
  return updated;
}

self.onmessage = event => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    if (type === 'flashcards') {
      result = buildLocalFlashcards(payload.topic, payload.count, payload.lang);
    } else if (type === 'quiz') {
      result = buildLocalQuiz(payload.topic, payload.count, payload.difficulty);
    } else if (type === 'srs-review') {
      result = reviewSrsCard(payload.card, payload.rating, payload.now || Date.now());
    } else {
      throw new Error(`Unknown task: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
