'use strict';

// Editable site content: defaults (= the original copy), shape enforcement and caching.
// Everything the admin "Контент" section edits lives in one JSON document.

const { PROJECTS } = require('./projects');

const DEFAULTS = {
  brand: { name: 'CODEFORGE', tagline: 'Студия цифровой разработки. Создаём сайты, мобильные приложения и программные решения, которые помогают бизнесу расти.' },
  seo: {
    title: 'CODEFORGE — разработка сайтов, мобильных приложений и IT-решений',
    description: 'CODEFORGE разрабатывает сайты, приложения для iOS и Android, веб-сервисы, интернет-магазины и CRM-системы. От идеи до запуска. Оставьте заявку — ответим в течение 24 часов.',
    ogTitle: 'CODEFORGE — мы создаём цифровые продукты будущего',
    ogDescription: 'Сайты, мобильные приложения и индивидуальные IT-решения для бизнеса. От идеи до полноценного запуска.',
    ogImage: '/assets/img/og-image.png',
  },
  contacts: {
    email: 'hello@codeforge.dev',
    telegram: 'codeforge_studio',
    phone: '',
    hours: 'Пн–Пт, 9:00–19:00 (CET)',
    note: 'Работаем с клиентами по всему миру',
    responseNote: 'Ответим в течение 24 часов',
  },
  socials: [
    { type: 'telegram', url: 'https://t.me/codeforge_studio' },
    { type: 'github', url: 'https://github.com/codeforge-studio' },
    { type: 'linkedin', url: 'https://www.linkedin.com/company/codeforge-studio' },
    { type: 'dribbble', url: 'https://dribbble.com/codeforge-studio' },
  ],
  nav: { ctaLabel: 'Оформить заказ' },
  hero: {
    eyebrow: 'Принимаем проекты на 2026–2027',
    line1: 'Мы создаём',
    line2: 'цифровые продукты',
    line3: 'будущего',
    subtitle: 'Разрабатываем сайты, мобильные приложения и индивидуальные IT-решения для вашего бизнеса. От идеи до полноценного запуска.',
    primaryCta: 'Заказать разработку',
    secondaryCta: 'Посмотреть услуги',
    scrollHint: 'Scroll to explore',
    videoMp4: '',
    videoWebm: '',
    videoMobile: '',
    videoPoster: '',
  },
  services: {
    enabled: true,
    eyebrow: 'Услуги',
    title: 'Что мы можем создать?',
    subtitle: 'Выберите направление разработки, а мы превратим вашу идею в готовый цифровой продукт.',
    items: [
      { icon: 'monitor', title: 'Разработка сайтов', text: 'Создаём современные сайты, лендинги, корпоративные порталы и интернет-магазины с уникальным дизайном и высокой производительностью.', tags: ['Лендинги', 'Корпоративные', 'Порталы'], button: 'Заказать сайт', service: 'website' },
      { icon: 'android', title: 'Android-приложения', text: 'Разрабатываем функциональные мобильные приложения для устройств на базе Android.', tags: ['Kotlin', 'Jetpack Compose', 'Google Play'], button: 'Заказать Android-приложение', service: 'android' },
      { icon: 'apple', title: 'iOS-приложения', text: 'Создаём современные приложения для iPhone и iPad с удобным интерфейсом и продуманной архитектурой.', tags: ['Swift', 'SwiftUI', 'App Store'], button: 'Заказать iOS-приложение', service: 'ios' },
      { icon: 'browser', title: 'Web Applications', text: 'Разрабатываем сложные веб-приложения, личные кабинеты, SaaS-платформы и онлайн-сервисы.', tags: ['SaaS', 'Личные кабинеты', 'Сервисы'], button: 'Заказать веб-приложение', service: 'webapp' },
      { icon: 'cart', title: 'Интернет-магазины', text: 'Создаём полноценные интернет-магазины с каталогами, корзиной, оплатой и системой управления заказами.', tags: ['Каталог', 'Онлайн-оплата', 'Заказы'], button: 'Заказать магазин', service: 'ecommerce' },
      { icon: 'code', title: 'Индивидуальная разработка', text: 'Реализуем уникальные IT-проекты, автоматизацию бизнеса, CRM-системы и нестандартные программные решения.', tags: ['CRM', 'Автоматизация', 'Интеграции'], button: 'Обсудить проект', service: 'other' },
    ],
  },
  about: {
    enabled: true,
    eyebrow: 'О нас',
    title: 'Инженерная студия полного цикла',
    text: 'CODEFORGE — команда дизайнеров, разработчиков и менеджеров проектов. Мы берём на себя всё: аналитику, дизайн, программирование, тестирование и запуск. Вы общаетесь с одним менеджером и всегда знаете, на каком этапе находится проект.',
    bullets: ['Фиксированная смета и сроки после обсуждения требований', 'Демонстрация промежуточных результатов каждые две недели', 'Исходный код и все права на продукт — у вас'],
    stats: [
      { value: 24, suffix: 'ч', label: 'максимальное время ответа на заявку' },
      { value: 7, suffix: '', label: 'направлений разработки под одной крышей' },
      { value: 100, suffix: '%', label: 'исходного кода передаём клиенту' },
      { value: 3, suffix: 'мес', label: 'бесплатной гарантийной поддержки после запуска' },
    ],
  },
  process: {
    enabled: true,
    eyebrow: 'Процесс',
    title: 'Как мы работаем',
    subtitle: 'Прозрачный процесс из четырёх этапов — от первой заявки до запуска готового продукта.',
    steps: [
      { title: 'Заявка', text: 'Клиент выбирает услугу и оставляет заявку.' },
      { title: 'Обсуждение', text: 'Мы связываемся с клиентом, уточняем требования и детали проекта.' },
      { title: 'Разработка', text: 'Наша команда приступает к проектированию, дизайну и программированию.' },
      { title: 'Запуск', text: 'Клиент получает готовый цифровой продукт.' },
    ],
  },
  order: {
    eyebrow: 'Оформление заказа',
    title: 'Давайте создадим ваш проект',
    subtitle: 'Расскажите, что вам нужно, и мы свяжемся с вами для обсуждения разработки.',
    acceptingOrders: true,
    closedMessage: 'Сейчас мы не принимаем новые заявки. Напишите нам на почту — ответим, когда освободимся.',
  },
  projects: {
    enabled: true,
    eyebrow: 'Портфолио',
    title: 'Наши работы',
    subtitle: 'Ниже — демонстрационные концепт-проекты, которые показывают наш подход к дизайну и архитектуре. Это примеры, а не реальные заказы клиентов.',
    items: PROJECTS.map((p) => ({
      slug: p.slug,
      title: p.title,
      type: p.type,
      year: p.year,
      summary: p.summary,
      preview: p.preview,
      challenge: p.challenge,
      solution: p.solution,
      stack: p.stack,
      metrics: p.metrics.map(([value, label]) => ({ value, label })),
      isDemo: true,
      published: true,
    })),
  },
  advantages: {
    enabled: true,
    eyebrow: 'Преимущества',
    title: 'Почему выбирают нас?',
    items: [
      { icon: 'person', title: 'Индивидуальный подход', text: 'Каждый проект создаётся с учётом задач конкретного клиента.' },
      { icon: 'chip', title: 'Современные технологии', text: 'Используем актуальные технологии программирования и разработки.' },
      { icon: 'pen', title: 'Продуманный дизайн', text: 'Создаём удобные и эстетичные интерфейсы.' },
      { icon: 'support', title: 'Поддержка проектов', text: 'Помогаем с запуском, обслуживанием и дальнейшим развитием продукта.' },
    ],
  },
  faq: {
    enabled: true,
    eyebrow: 'FAQ',
    title: 'Частые вопросы',
    subtitle: 'Не нашли ответ? Напишите нам в Telegram или на почту — ответим в течение рабочего дня.',
    items: [
      { q: 'Сколько времени занимает разработка сайта?', a: 'Лендинг — от 1 до 2 недель, корпоративный сайт — 3–6 недель, интернет-магазин — от 1,5 до 3 месяцев. Точные сроки фиксируем в договоре после обсуждения требований и согласования объёма работ.' },
      { q: 'Сколько стоит разработка приложения?', a: 'Стоимость зависит от количества экранов, сложности логики, интеграций и платформ. Простое MVP-приложение обычно начинается от 3 000 €, приложения с личным кабинетом, оплатами и админ-панелью — от 8 000 €. После брифа мы присылаем детальную смету с разбивкой по этапам.' },
      { q: 'Можно ли заказать сайт и мобильное приложение одновременно?', a: 'Да. В форме заказа можно выбрать несколько услуг. Мы спроектируем общий бэкенд и единую дизайн-систему, что сократит сроки и бюджет по сравнению с раздельной разработкой.' },
      { q: 'Можно ли дорабатывать уже существующий проект?', a: 'Да. Сначала проводим технический аудит кода и инфраструктуры, затем предлагаем план доработок: от исправления ошибок и ускорения до редизайна и новых функций.' },
      { q: 'Как происходит оплата?', a: 'Работаем по договору поэтапно: предоплата за первый этап, далее оплата после приёмки каждого этапа. Принимаем банковский перевод для юридических лиц и оплату картой для частных клиентов.' },
      { q: 'Предоставляете ли вы техническую поддержку?', a: 'Да. После запуска действует 3 месяца бесплатной гарантийной поддержки. Далее можно подключить ежемесячное обслуживание: мониторинг, обновления, резервные копии и развитие продукта.' },
      { q: 'Можно ли заказать индивидуальный дизайн?', a: 'Мы не используем готовые шаблоны: каждый интерфейс проектируется с нуля под ваш бренд и задачи. Вы получаете интерактивный прототип и дизайн-систему, которые согласовываются до начала разработки.' },
    ],
  },
  cta: {
    enabled: true,
    title: 'Ваша идея может стать следующим большим проектом',
    text: 'Не откладывайте развитие своего бизнеса. Давайте начнём создавать ваш цифровой продукт уже сегодня.',
    button: 'Начать создание проекта',
  },
  footer: { copyright: '© 2026 CODEFORGE. ALL RIGHTS RESERVED.' },
  notifications: { telegramChatId: '', notifyEmail: '', clientConfirmation: true },

  /* ---------- Design & behaviour ---------- */
  design: {
    background: 'aurora',      // aurora | particles | grid | image | video | none
    bgImage: '',
    bgVideo: '',
    bgDim: 55,                 // darkening over image/video, %
    color1: '#6d5dfc',
    color2: '#22d3ee',
    color3: '#ffffff',
    heroFixed: true,           // hero scene stays in place while the text scrolls over it
    animations: true,
    preloader: true,
    scrollProgress: true,
    textReveal: true,
    tilt: true,
    cursor: true,
    backToTop: true,
  },
  announcement: { enabled: false, text: 'Бесплатная консультация и оценка проекта — ответим в течение 24 часов', link: '#order', linkLabel: 'Оставить заявку' },
  marquee: {
    enabled: true,
    speed: 40,
    items: ['React', 'Next.js', 'Node.js', 'TypeScript', 'Kotlin', 'Swift', 'Flutter', 'PostgreSQL', 'Figma', 'Docker', 'AWS', 'Supabase'],
  },
  pricing: {
    enabled: false,
    eyebrow: 'Стоимость',
    title: 'Пакеты и цены',
    subtitle: 'Ориентировочная стоимость. Точную смету пришлём после обсуждения задачи.',
    items: [
      { name: 'Лендинг', price: 'от 900 €', period: '1–2 недели', features: ['Индивидуальный дизайн', 'Адаптив под телефоны', 'Форма заявок', 'Базовое SEO'], button: 'Заказать', service: 'website', highlighted: false },
      { name: 'Корпоративный сайт', price: 'от 2 500 €', period: '3–6 недель', features: ['До 15 страниц', 'Админ-панель', 'Интеграции с CRM', 'Аналитика'], button: 'Заказать', service: 'website', highlighted: true },
      { name: 'Мобильное приложение', price: 'от 6 000 €', period: '2–4 месяца', features: ['iOS и Android', 'Личный кабинет', 'Push-уведомления', 'Публикация в сторах'], button: 'Обсудить', service: 'android', highlighted: false },
    ],
  },
  testimonials: {
    enabled: false,
    eyebrow: 'Отзывы',
    title: 'Что говорят клиенты',
    items: [
      { name: 'Имя клиента', role: 'Должность, компания', text: 'Здесь будет реальный отзыв клиента. Замените этот текст в админ-панели → Контент → Отзывы.', avatar: '', rating: 5 },
    ],
  },
  widgets: {
    floatingContacts: true,
    cookieBanner: false,
    cookieText: 'Мы используем cookie для корректной работы сайта и аналитики.',
  },
  maintenance: {
    enabled: false,
    title: 'Сайт на техническом обслуживании',
    text: 'Мы обновляем сайт и скоро вернёмся. Связаться с нами можно по почте или в Telegram.',
  },
  analytics: { yandexMetrika: '', googleAnalytics: '' },
  account: { enabled: true, label: 'Войти' },
  builder: {
    autoFromOrders: true,      // an order for a website/shop instantly gets its own draft site
    enabled: false,            // the separate /create wizard (hidden by default)
    navLabel: 'Создать сайт',
    title: 'Создайте свой сайт за 5 минут',
    subtitle: 'Выберите шаблон, заполните анкету и загрузите фото — сайт появится сразу. Править его можно в личном кабинете.',
    priceNote: 'После создания вы увидите сайт в режиме предпросмотра. Он будет опубликован после оплаты.',
    publishImmediately: false,
  },
  layout: { order: ['services', 'about', 'process', 'order', 'projects', 'pricing', 'testimonials', 'advantages', 'faq', 'cta'] },
};

const SECTION_IDS = ['services', 'about', 'process', 'order', 'projects', 'pricing', 'testimonials', 'advantages', 'faq', 'cta'];
const BACKGROUNDS = ['aurora', 'particles', 'grid', 'image', 'video', 'none'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
const color = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

/* ---------- Shape enforcement ----------
   Incoming JSON is forced into the shape of DEFAULTS: unknown keys are dropped,
   types coerced, strings and arrays bounded. Array items follow the first default item. */
const MAX_STR = 6000;
const MAX_ITEMS = 60;

function conform(value, tpl) {
  if (Array.isArray(tpl)) {
    const itemTpl = tpl[0] !== undefined ? tpl[0] : '';
    if (!Array.isArray(value)) return structuredClone(tpl);
    return value.slice(0, MAX_ITEMS).map((v) => conform(v, itemTpl));
  }
  if (tpl !== null && typeof tpl === 'object') {
    const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const out = {};
    for (const k of Object.keys(tpl)) out[k] = k in src ? conform(src[k], tpl[k]) : structuredClone(tpl[k]);
    return out;
  }
  if (typeof tpl === 'boolean') return value === true || value === 'true';
  if (typeof tpl === 'number') { const n = Number(value); return Number.isFinite(n) ? n : tpl; }
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, MAX_STR);
}

const slugify = (s) => String(s).toLowerCase().trim()
  .replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[c]))
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function normalize(input) {
  const c = conform(input, DEFAULTS);
  const seen = new Set();
  c.projects.items.forEach((p, i) => {
    let slug = slugify(p.slug || p.title) || `project-${i + 1}`;
    while (seen.has(slug)) slug = `${slug}-${i + 1}`;
    seen.add(slug);
    p.slug = slug;
  });
  c.contacts.telegram = c.contacts.telegram.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');

  const d = c.design;
  if (!BACKGROUNDS.includes(d.background)) d.background = DEFAULTS.design.background;
  d.bgDim = clamp(d.bgDim, 0, 90);
  for (const k of ['color1', 'color2', 'color3']) d[k] = color(d[k], DEFAULTS.design[k]);
  c.marquee.speed = clamp(c.marquee.speed, 10, 120);
  c.marquee.items = c.marquee.items.map((x) => x.trim()).filter(Boolean);
  c.testimonials.items.forEach((t) => { t.rating = clamp(Math.round(t.rating), 0, 5); });
  c.analytics.yandexMetrika = c.analytics.yandexMetrika.replace(/\D/g, '').slice(0, 12);
  c.analytics.googleAnalytics = /^G-[A-Z0-9]{4,20}$/i.test(c.analytics.googleAnalytics.trim()) ? c.analytics.googleAnalytics.trim().toUpperCase() : '';
  // Section order: known ids only, each once, missing ones appended.
  const order = c.layout.order.filter((id, i, a) => SECTION_IDS.includes(id) && a.indexOf(id) === i);
  c.layout.order = [...order, ...SECTION_IDS.filter((id) => !order.includes(id))];
  return c;
}

/* ---------- Load / save with a short in-memory cache ---------- */
const CACHE_MS = 10_000;
let cache = { at: 0, data: null };

async function getContent(store) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  let data = null;
  try {
    const raw = store && (await store.getKv('site_content'));
    data = raw ? normalize(JSON.parse(raw)) : null;
  } catch (err) {
    console.error('[content] falling back to defaults:', err.message);
  }
  cache = { at: Date.now(), data: data || normalize(DEFAULTS) };
  return cache.data;
}

async function saveContent(store, input) {
  const data = normalize(input);
  const json = JSON.stringify(data);
  if (json.length > 900_000) throw Object.assign(new Error('Слишком большой объём контента'), { status: 413, expose: true });
  await store.setKv('site_content', json);
  await store.addContentVersion(json);
  cache = { at: Date.now(), data };
  return data;
}

const invalidateContent = () => { cache = { at: 0, data: null }; };

module.exports = { DEFAULTS, SECTION_IDS, normalize, getContent, saveContent, invalidateContent, slugify };
