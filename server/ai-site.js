'use strict';

// Builds a client site from an order.
//  • instantly, from the order fields (always works, no external services);
//  • then, if a Claude API key is configured, Claude rewrites it into a proper
//    site from the client's own description (template, copy, services/menu, colour).

const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');
const sites = require('./sites');

const MODEL = 'claude-opus-5-5';
const AnthropicClient = Anthropic.default || Anthropic;

// Orders for these services get an automatic site.
const SITE_SERVICES = ['website', 'ecommerce'];
const wantsSite = (order) => Array.isArray(order.services) && order.services.some((s) => SITE_SERVICES.includes(s));

/* ---------- Instant draft from the order fields ---------- */
function guessTemplate(text) {
  const t = text.toLowerCase();
  if (/кафе|ресторан|кофе|кофейн|бар\b|пицц|суши|пекарн|кондитер|меню|доставк[аи] еды|столов/.test(t)) return 'cafe';
  if (/портфолио|фотограф|дизайнер|архитект|иллюстрат|художник|видеограф|работы/.test(t)) return 'portfolio';
  if (/мастер|маникюр|барбер|парикмахер|тренер|юрист|адвокат|психолог|репетитор|визаж|косметолог|массаж|стилист|нутрициолог|врач|стоматолог|личн(ый|ая) (сайт|страниц)|визитк/.test(t)) return 'card';
  return 'business';
}

function firstSentence(s, max = 200) {
  const m = String(s).trim().match(/^(.{20,}?[.!?])(\s|$)/);
  const out = (m ? m[1] : String(s).trim()).replace(/\s+/g, ' ');
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function contactsFromOrder(order) {
  const phone = String(order.phone || '').trim();
  return {
    phone,
    email: order.email || '',
    telegram: order.telegram || '',
    whatsapp: order.contact_method === 'whatsapp' ? phone : '',
  };
}

function draftFromOrder(order) {
  const text = `${order.project_name} ${order.description} ${order.features || ''}`;
  const items = String(order.features || '').split(/\n|;|•|,(?=\s*[А-ЯA-Z])/).map((x) => x.replace(/^[\s\-–—*\d.)]+/, '').trim())
    .filter((x) => x.length > 2).slice(0, 8).map((title) => ({ title: title.slice(0, 120), text: '', price: '' }));
  return sites.normalizeData({
    title: order.project_name,
    tagline: firstSentence(order.description),
    about: order.description,
    cta: 'Связаться',
    items,
    contacts: contactsFromOrder(order),
    style: { theme: 'dark', accent: '#6d5dfc' },
  });
}

async function uniqueSlug(store, base) {
  let slug = sites.slugify(base) || 'site';
  if (slug.length < 3) slug = `${slug}-site`;
  if (sites.slugError(slug)) slug = `${slug}-site`.slice(0, 40);
  let candidate = slug;
  for (let i = 2; await store.getSiteBySlug(candidate); i++) candidate = `${slug.slice(0, 36)}-${i}`;
  return candidate;
}

/* ---------- Claude ---------- */
const SiteSchema = z.object({
  template: z.enum(['business', 'card', 'portfolio', 'cafe']),
  title: z.string(),
  tagline: z.string(),
  about: z.string(),
  cta: z.string(),
  items: z.array(z.object({ title: z.string(), text: z.string(), price: z.string() })),
  theme: z.enum(['dark', 'light']),
  accent: z.string(),
});

const SYSTEM = `Ты — копирайтер и веб-дизайнер студии. По заявке клиента ты собираешь содержимое его будущего одностраничного сайта.

Шаблоны:
- business — лендинг компании или услуги (ремонт, клининг, автосервис, магазин, агентство);
- card — визитка одного специалиста (мастер, тренер, юрист, психолог, репетитор);
- portfolio — портфолио с работами (дизайнер, фотограф, архитектор, студия);
- cafe — кафе, ресторан, кофейня, пекарня, доставка еды (items — это меню).

Правила:
- Пиши на языке заявки (обычно русский), живо и конкретно, без канцелярита и без выдуманных фактов о клиенте: не придумывай годы работы, награды, количество клиентов, адреса.
- title — название бизнеса или имя специалиста из заявки; если его нет, короткое понятное название.
- tagline — одно предложение до 120 символов для первого экрана.
- about — 2–3 коротких абзаца, разделённых пустой строкой.
- cta — текст главной кнопки, 1–3 слова («Записаться», «Заказать», «Позвонить»).
- items — 3–8 позиций (услуги, блюда меню или направления работ). price — только если цена есть в заявке или это меню кафе с типичной ценой, иначе пустая строка. text — одно короткое предложение.
- theme — dark или light, что лучше подходит бизнесу; accent — фирменный цвет в формате #rrggbb, подходящий по смыслу.`;

function orderPrompt(order) {
  return [
    `Название проекта: ${order.project_name}`,
    `Что хочет клиент: ${order.description}`,
    order.features ? `Нужные функции и разделы: ${order.features}` : '',
    order.references_text ? `Примеры сайтов, которые нравятся: ${order.references_text}` : '',
    `Услуги из формы: ${order.services.join(', ')}`,
  ].filter(Boolean).join('\n');
}

async function generateWithClaude(order, apiKey) {
  const client = new AnthropicClient({ apiKey, timeout: 50_000, maxRetries: 1 });
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if a safety classifier declines, Anthropic re-runs it on its recommended model
    output_config: { effort: 'low', format: zodOutputFormat(SiteSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: orderPrompt(order) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude отказался обрабатывать эту заявку');
  if (!response.parsed_output) throw new Error('Claude вернул ответ не по схеме');
  return response.parsed_output;
}

/* ---------- Google Gemini (free tier) ---------- */
// Plain REST: no extra dependency. The schema mirrors SiteSchema in Gemini's OpenAPI subset.
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    template: { type: 'STRING', enum: ['business', 'card', 'portfolio', 'cafe'] },
    title: { type: 'STRING' },
    tagline: { type: 'STRING' },
    about: { type: 'STRING' },
    cta: { type: 'STRING' },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, text: { type: 'STRING' }, price: { type: 'STRING' } }, required: ['title', 'text', 'price'] } },
    theme: { type: 'STRING', enum: ['dark', 'light'] },
    accent: { type: 'STRING' },
  },
  required: ['template', 'title', 'tagline', 'about', 'cta', 'items', 'theme', 'accent'],
};

class AiError extends Error {
  constructor(message, status) { super(message); this.aiStatus = status; }
}

async function generateWithGemini(order, apiKey, model = 'gemini-1.5-flash') {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: orderPrompt(order) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(50_000),
    });
  } catch (err) {
    throw new AiError(err.name === 'TimeoutError' ? 'Gemini не ответил вовремя' : 'Нет соединения с Gemini', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || '';
    if (res.status === 400 && /api key/i.test(msg)) throw new AiError('Неверный ключ Gemini — проверьте его в админке → Интеграции', 400);
    if (res.status === 403) throw new AiError('Ключ Gemini не имеет доступа (проверьте ключ в Google AI Studio)', 403);
    if (res.status === 404) throw new AiError(`Модель «${model}» не найдена — укажите другую модель Gemini в админке → Интеграции`, 404);
    if (res.status === 429) throw new AiError('Бесплатный лимит Gemini исчерпан — попробуйте позже', 429);
    throw new AiError(`Gemini: ошибка ${res.status}${msg ? ` — ${msg.slice(0, 160)}` : ''}`, res.status);
  }
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.map((p) => p.text || '').join('') : '';
  if (!text) throw new AiError(cand && cand.finishReason === 'SAFETY' ? 'Gemini отказался обрабатывать эту заявку' : 'Gemini вернул пустой ответ', 502);
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new AiError('Gemini вернул ответ не в формате JSON', 502); }
  const checked = SiteSchema.safeParse(parsed);
  if (!checked.success) throw new AiError('Gemini вернул ответ не по схеме', 502);
  return checked.data;
}

// Generates with whichever AI is configured: { provider: 'gemini'|'claude', key, model? }.
function generate(order, cfg) {
  return cfg.provider === 'claude' ? generateWithClaude(order, cfg.key) : generateWithGemini(order, cfg.key, cfg.model);
}

// Merges Claude's content with the contacts and photos the site already has.
function applyGenerated(site, gen) {
  const data = sites.normalizeData({
    ...site.data,
    title: gen.title || site.data.title,
    tagline: gen.tagline || site.data.tagline,
    about: gen.about,
    cta: gen.cta,
    items: gen.items,
    style: { theme: gen.theme, accent: gen.accent },
  });
  return { template: sites.TEMPLATES[gen.template] ? gen.template : site.template, data };
}

function friendlyError(err) {
  if (err instanceof AiError) return err.message;
  if (err instanceof AnthropicClient.AuthenticationError) return 'Неверный ключ Claude API — проверьте его в админке → Интеграции';
  if (err instanceof AnthropicClient.PermissionDeniedError) return 'У ключа Claude API нет доступа к модели';
  if (err instanceof AnthropicClient.RateLimitError) return 'Claude API перегружен или закончился лимит — попробуйте позже';
  if (err instanceof AnthropicClient.APIConnectionTimeoutError) return 'Claude API не ответил вовремя';
  if (err instanceof AnthropicClient.APIConnectionError) return 'Нет соединения с Claude API';
  if (err instanceof AnthropicClient.APIError) return `Claude API: ошибка ${err.status}`;
  return err.message || 'Не удалось сгенерировать сайт';
}

module.exports = { wantsSite, draftFromOrder, guessTemplate, uniqueSlug, generate, generateWithClaude, generateWithGemini, applyGenerated, friendlyError, MODEL };
