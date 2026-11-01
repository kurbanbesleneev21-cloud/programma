'use strict';

// Site builder: clients assemble a small website from a template and a questionnaire.
// A new site starts as a draft (public preview with a banner, not indexed) and becomes
// active when published — manually from the admin panel for now, after payment later.

const crypto = require('node:crypto');
const config = require('./config');

const TEMPLATES = {
  business: {
    name: 'Лендинг для бизнеса',
    desc: 'Главный экран с фото, услуги, о компании, галерея и контакты.',
    itemsLabel: 'Услуги', itemLabel: 'Услуга', itemImages: false,
    sample: { title: 'Ремонт квартир под ключ', tagline: 'Делаем ремонт быстро, аккуратно и по смете, которая не меняется.', cta: 'Получить смету',
      items: [{ title: 'Косметический ремонт', text: 'Обои, покраска, напольные покрытия.', price: 'от 3 000 ₽/м²' }, { title: 'Капитальный ремонт', text: 'Электрика, сантехника, выравнивание стен.', price: 'от 8 000 ₽/м²' }, { title: 'Дизайн-проект', text: 'Планировка, визуализация, подбор материалов.', price: 'от 1 500 ₽/м²' }] },
  },
  card: {
    name: 'Визитка специалиста',
    desc: 'Для мастера, тренера, юриста, фотографа: фото, о себе, услуги с ценами, кнопки связи.',
    itemsLabel: 'Услуги и цены', itemLabel: 'Услуга', itemImages: false,
    sample: { title: 'Анна Иванова', tagline: 'Мастер маникюра · 8 лет опыта', cta: 'Записаться',
      items: [{ title: 'Маникюр с покрытием', text: 'Гель-лак, выравнивание, дизайн одного ногтя.', price: '2 000 ₽' }, { title: 'Педикюр', text: 'Аппаратный, с покрытием.', price: '2 500 ₽' }] },
  },
  portfolio: {
    name: 'Портфолио',
    desc: 'Для дизайнера, фотографа, архитектора: работы с фото крупно, о себе и контакты.',
    itemsLabel: 'Работы', itemLabel: 'Работа', itemImages: true,
    sample: { title: 'Студия интерьеров «Линия»', tagline: 'Проектируем интерьеры, в которых приятно жить.', cta: 'Обсудить проект',
      items: [{ title: 'Квартира на Пресне', text: '86 м², современная классика', price: '' }, { title: 'Загородный дом', text: '240 м², сканди', price: '' }] },
  },
  cafe: {
    name: 'Кафе / ресторан',
    desc: 'Красивое фото, меню с ценами, галерея, адрес и часы работы.',
    itemsLabel: 'Меню', itemLabel: 'Блюдо', itemImages: true,
    sample: { title: 'Кофейня «Зерно»', tagline: 'Свежая обжарка, домашняя выпечка и завтраки весь день.', cta: 'Позвонить',
      items: [{ title: 'Капучино', text: '300 мл', price: '220 ₽' }, { title: 'Сырники со сметаной', text: 'Три штуки, ягодный соус', price: '390 ₽' }] },
  },
};

const THEMES = ['dark', 'light'];
const STATUSES = { draft: 'Черновик (ждёт оплаты)', active: 'Опубликован', suspended: 'Отключён' };
const RESERVED = new Set(['admin', 'api', 'www', 'mail', 'assets', 'static', 'media', 'create', 'new', 'edit', 'login', 'app', 'site', 'sites', 'test', 'codeforge', 'support', 'help', 'about', 'blog']);

const MAX_ITEMS = 24;
const MAX_GALLERY = 12;

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
// Only http(s) and site-relative image URLs (uploaded files) are kept.
const url = (v) => { const s = str(v, 1000); return /^https:\/\/[^\s"'<>]+$/i.test(s) || /^\/media\/[\w./-]+$/.test(s) ? s : ''; };
const handle = (v) => str(v, 64).replace(/^https?:\/\/(t\.me|instagram\.com|vk\.com)\//i, '').replace(/^@/, '').replace(/[^\w.]/g, '');

const slugify = (s) => String(s).toLowerCase().trim()
  .replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[c]))
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

function slugError(slug) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return 'Адрес: 3–40 символов, латинские буквы, цифры и дефис';
  if (RESERVED.has(slug)) return 'Этот адрес зарезервирован, выберите другой';
  return null;
}

// Forces questionnaire input into a safe, bounded shape.
function normalizeData(input = {}) {
  const d = input && typeof input === 'object' ? input : {};
  const c = d.contacts && typeof d.contacts === 'object' ? d.contacts : {};
  const st = d.style && typeof d.style === 'object' ? d.style : {};
  return {
    title: str(d.title, 120),
    tagline: str(d.tagline, 300),
    about: str(d.about, 3000),
    cta: str(d.cta, 40) || 'Связаться',
    logo: url(d.logo),
    hero: url(d.hero),
    items: (Array.isArray(d.items) ? d.items : []).slice(0, MAX_ITEMS)
      .map((it) => ({ title: str(it && it.title, 120), text: str(it && it.text, 600), price: str(it && it.price, 40), image: url(it && it.image) }))
      .filter((it) => it.title),
    gallery: (Array.isArray(d.gallery) ? d.gallery : []).map(url).filter(Boolean).slice(0, MAX_GALLERY),
    contacts: {
      phone: str(c.phone, 40),
      email: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(str(c.email, 120)) ? str(c.email, 120) : '',
      telegram: handle(c.telegram),
      whatsapp: str(c.whatsapp, 40).replace(/[^\d+]/g, ''),
      instagram: handle(c.instagram),
      vk: handle(c.vk),
      address: str(c.address, 200),
      hours: str(c.hours, 120),
    },
    style: {
      theme: THEMES.includes(st.theme) ? st.theme : 'dark',
      accent: /^#[0-9a-f]{6}$/i.test(st.accent || '') ? st.accent.toLowerCase() : '#6d5dfc',
    },
  };
}

function validateData(data) {
  const fields = {};
  if (data.title.length < 2) fields.title = 'Укажите название (минимум 2 символа)';
  if (!data.tagline) fields.tagline = 'Добавьте короткое описание';
  const c = data.contacts;
  if (!c.phone && !c.email && !c.telegram && !c.whatsapp) fields.contacts = 'Укажите хотя бы один способ связи';
  return fields;
}

/* ---------- Client cabinet access ---------- */
const newToken = () => crypto.randomBytes(24).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const tokenMatches = (site, token) => {
  if (!site || !token) return false;
  const a = Buffer.from(hashToken(token)), b = Buffer.from(site.token_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Per-site session cookie: bound to the current token hash, so issuing a new link logs everyone out.
const SITE_COOKIE = 'cf_site';
const SITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function siteSession(site) {
  const exp = Date.now() + SITE_TTL_MS;
  const payload = `${site.id}.${exp}`;
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(`site:${payload}:${site.token_hash}`).digest('base64url');
  return `${payload}.${sig}`;
}
function readSiteSession(value, site) {
  if (!value || !site || !config.sessionSecret) return false;
  for (const v of String(value).split('|')) {
    const [id, exp, sig] = v.split('.');
    if (Number(id) !== site.id || !(Number(exp) > Date.now())) continue;
    const expected = crypto.createHmac('sha256', config.sessionSecret).update(`site:${id}.${exp}:${site.token_hash}`).digest('base64url');
    if (sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return true;
  }
  return false;
}
// One cookie holds sessions for several sites (a client may own more than one).
function siteCookie(existing, site) {
  const keep = String(existing || '').split('|').filter((v) => v && Number(v.split('.')[0]) !== site.id).slice(-4);
  const value = [...keep, siteSession(site)].join('|');
  const attrs = [`${SITE_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SITE_TTL_MS / 1000)}`];
  if (config.isProd) attrs.push('Secure');
  return attrs.join('; ');
}

const publicSite = (s) => ({
  id: s.id, slug: s.slug, status: s.status, template: s.template, data: s.data,
  owner_name: s.owner_name, owner_email: s.owner_email, owner_phone: s.owner_phone, order_number: s.order_number || '',
  paid_at: s.paid_at, created_at: s.created_at, updated_at: s.updated_at,
});

module.exports = {
  TEMPLATES, THEMES, STATUSES, RESERVED, MAX_ITEMS, MAX_GALLERY,
  slugify, slugError, normalizeData, validateData,
  newToken, hashToken, tokenMatches, SITE_COOKIE, siteCookie, readSiteSession, publicSite,
};
