/**
 * AURA · Cloudflare Worker — uygulama ile Claude arasındaki köprü
 *
 * Gizli değerler (Cloudflare panelinde Settings → Variables and Secrets → "Secret" olarak):
 *   ANTHROPIC_API_KEY  Anthropic Console'dan alınan API anahtarı
 *   FAMILY_CODE        Aile kodu (uygulamada öğretmen ayarlarına aynı kod girilir)
 * İsteğe bağlı değişkenler:
 *   MODEL              Varsayılan: claude-haiku-5-5 (hızlı ve ekonomik)
 *   ALLOWED_ORIGIN     Varsayılan: https://aura-tr.github.io
 *
 * Bu dosyada hiçbir gizli bilgi yoktur; depo herkese açık olabilir.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const MAX_TURNS = 16;          // Claude'a gönderilen son konuşma sayısı
const MAX_CHARS = 600;         // Öğrencinin tek mesajı için üst sınır

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || 'https://aura-tr.github.io').split(',').map(s => s.trim());
    const okOrigin = allowed.includes(origin) || origin.startsWith('http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Family-Code',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return json({ ok: true, service: 'aura-worker' });
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    if (!okOrigin) return json({ error: 'origin' }, 403);
    if (!env.FAMILY_CODE || request.headers.get('X-Family-Code') !== env.FAMILY_CODE) return json({ error: 'code' }, 401);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'key' }, 500);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'json' }, 400); }
    const student = body.student || {};
    const history = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : [];
    const messages = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
      .map(m => ({ role: m.role, content: m.text.slice(0, MAX_CHARS) }));
    // Konuşma her zaman öğrenciyle başlamalı ve öğrenciyle bitmeli
    if (messages.length && messages[0].role === 'assistant') messages.unshift({ role: 'user', content: '(The lesson starts. The teacher greets the student first.)' });
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'empty' }, 400);
    // Arka arkaya aynı rol gelirse birleştir
    const merged = [];
    for (const m of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content += '\n' + m.content; else merged.push({ ...m });
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model: env.MODEL || 'claude-haiku-5-5', max_tokens: 700, system: systemPrompt(student, body.mode), messages: merged })
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ error: 'upstream', status: res.status, detail: t.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return json({ ...parseReply(text), usage: data.usage || null });
  }
};

/** Claude'un cevabındaki JSON'u çıkarır; JSON yoksa düz metni cevap sayar. */
export function parseReply(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const c = j.correction && j.correction.right ? {
        wrong: String(j.correction.wrong || ''), right: String(j.correction.right), note_tr: String(j.correction.note_tr || '')
      } : null;
      return {
        reply: String(j.reply || '').trim() || 'Sorry, can you say that again?',
        correction: c,
        new_words: Array.isArray(j.new_words) ? j.new_words.slice(0, 5).map(String) : [],
        level_estimate: /^(A1|A2|B1|B2|C1|C2)$/.test(j.level_estimate || '') ? j.level_estimate : null,
        done: j.done === true
      };
    } catch (e) { /* düz metne düş */ }
  }
  return { reply: text.replace(/[{}]/g, '').trim() || 'Sorry, can you say that again?', correction: null, new_words: [], level_estimate: null, done: false };
}

/** Öğretmen talimatı: AURA'nın A1 eğitim planına göre */
export function systemPrompt(s, mode) {
  const name = clean(s.name) || 'the student';
  const level = /^(A1|A2|B1|B2|C1|C2)$/.test(s.level || '') ? s.level : 'A1';
  const teacher = s.teacher === 'daniel' ? 'Daniel' : 'Alisha';
  const step = s.step || {};
  const LEVEL_STYLE = {
    A1: 'Use very short sentences (5–9 words), present simple, the most common everyday words, and one simple question per turn. Speak slowly and clearly.',
    A2: 'Use short sentences, present and past simple, common everyday words, and one question per turn.',
    B1: 'Use clear natural sentences, common tenses, and everyday topics; ask one open question per turn.',
    B2: 'Speak naturally with some idioms; ask follow-up questions and invite opinions.',
    C1: 'Speak naturally and fluently; discuss abstract topics; encourage precise vocabulary.',
    C2: 'Speak as with a near-native speaker; challenge with nuance and register.'
  };
  const lines = [
    `You are ${teacher}, a warm, patient English speaking teacher inside the AURA app. Your student is ${name}, a Turkish learner at CEFR level ${level}.`,
    `Teaching language: British English only — British pronunciation, spelling and vocabulary (colour, favourite, flat, holiday, football, mum, film, lift). Never use American forms.`,
    LEVEL_STYLE[level],
    `Keep every turn short: 1–3 sentences, then usually one question so ${name} keeps speaking. Never give long explanations.`,
    `Be encouraging and positive. Praise effort briefly ("Great!", "Well done!"). Never mock or criticise.`,
    `The student may be a child or teenager: keep every topic family-friendly.`,
    `If the student uses Turkish words, give the English word and continue in English.`,
    `If the student says "Help" or "Yardım", give a simple model sentence they can repeat or complete.`,
    `If the student says "That's it", "I'm done" or "Bitti", it means they finished their answer — respond to it.`,
    `CORRECTION RULE: if the student's last message has a grammar or word mistake that matters, add a correction. "right" is the corrected sentence in British English. "note_tr" is exactly in this Turkish form: Düzeltme yapıyorum. "<wrong sentence>" yerine bu cümleyi söylemelisin: "<right sentence>". Optionally add one very short Turkish reason in brackets. Correct only the most important mistake. Do not correct small pronunciation-like spelling from speech recognition, missing punctuation or capital letters.`,
    `In "reply", react naturally to what the student said (do not repeat the correction in English at length), then continue the conversation.`
  ];
  if (step.topic) lines.push(`Current lesson step: ${clean(step.topic)}. Can-do goal: "${clean(step.goal)}". Grammar focus: ${clean(step.grammar)}. Useful words: ${clean(step.words)}. Useful phrases: ${clean(step.phrases)}. Steer the talk to this topic and help ${name} use these words and phrases.`);
  if (Array.isArray(s.interests) && s.interests.length) lines.push(`Student interests: ${s.interests.slice(0, 6).map(clean).join(', ')}. Use them in examples when it fits.`);
  if (Array.isArray(s.known) && s.known.length) lines.push(`Words the student has learned recently (reuse some): ${s.known.slice(0, 40).map(clean).join(', ')}.`);
  if (Array.isArray(s.facts) && s.facts.length) lines.push(`Things you already know about the student (never ask these again): ${s.facts.slice(0, 20).map(clean).join('; ')}.`);
  if (mode === 'level') {
    lines.push(`MODE: LEVEL CHECK. Ask one question per turn, starting very easy (A1) and getting gradually harder (A2, B1, B2) while the student answers well. After 8–10 student answers, set "done": true, give a kind summary in "reply", and set "level_estimate" to the CEFR level the student showed. Before that, keep "level_estimate" null.`);
  } else if (mode === 'task') {
    lines.push(`MODE: SPEAKING TASK (role-play) for the current lesson step. Play the other person in the scene and keep the role-play going.`);
  } else {
    lines.push(`MODE: FREE TALK about everyday life or the student's interests.`);
  }
  lines.push(`OUTPUT: reply with ONLY one JSON object, no other text:
{"reply": "<what you say, English>", "correction": null or {"wrong": "<student's sentence>", "right": "<corrected sentence>", "note_tr": "<Turkish note>"}, "new_words": ["<up to 3 new English words you used that may be new>"], "level_estimate": null, "done": false}`);
  return lines.filter(Boolean).join('\n');
}

function clean(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, 200); }
