'use strict';

// Telegram bot integration managed from the admin panel:
//  • connect a bot by its token (validated with getMe, webhook installed automatically);
//  • link admin chats: deep link with a one-time code, sharing the admin phone number,
//    or entering a numeric Telegram ID by hand;
//  • new-order notifications with inline buttons that change the order status;
//  • small command set for linked chats (/orders, /stats, /stop).

const config = require('./config');
const { STATUSES, SERVICES, BUDGETS, DEADLINES, CONTACT_METHODS } = require('./constants');
const { getSettings, updateSettings, randomToken } = require('./settings');

const API = 'https://api.telegram.org';
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;

class TelegramError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

async function tg(token, method, payload = {}) {
  let res;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new TelegramError(`Telegram недоступен: ${err.message}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const desc = data.description || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 404) throw new TelegramError('Неверный токен бота. Скопируйте его из @BotFather полностью.');
    throw new TelegramError(`Telegram: ${desc}`, res.status === 403 ? 400 : 502);
  }
  return data.result;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const digits = (s) => String(s || '').replace(/\D/g, '');
// Compare by the last 10 digits so "+7 999…", "8 999…" and "7999…" match.
const samePhone = (a, b) => { const x = digits(a), y = digits(b); return x.length >= 7 && y.length >= 7 && x.slice(-10) === y.slice(-10); };
const isPublicHttps = (origin) => /^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1|\[::1\]/.test(origin);

/* ---------- Resolving the active bot (admin settings first, env as fallback) ---------- */
async function activeBot(store, legacyChatId = '') {
  const s = store ? await getSettings(store) : null;
  if (s && s.telegram.token) return { token: s.telegram.token, chatIds: s.telegram.chats.map((c) => c.id), settings: s };
  const envChats = String(legacyChatId || config.telegram.chatId || '').split(/[\s,]+/).filter(Boolean);
  return { token: config.telegram.token, chatIds: envChats, settings: s };
}

/* ---------- Admin actions ---------- */
async function connectBot(store, rawToken, origin) {
  const token = String(rawToken || '').trim().replace(/^bot/i, '');
  if (!TOKEN_RE.test(token)) throw new TelegramError('Это не похоже на токен бота. Он выглядит так: 123456789:AAH…');
  const me = await tg(token, 'getMe');
  const prev = await getSettings(store);
  const sameBot = prev.telegram.token && prev.telegram.token.split(':')[0] === token.split(':')[0];
  const webhookSecret = randomToken(24);
  let webhookUrl = '';
  if (isPublicHttps(origin)) {
    webhookUrl = `${origin}/api/telegram/webhook/${webhookSecret}`;
    await tg(token, 'setWebhook', { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    await tg(token, 'setMyCommands', { commands: [
      { command: 'orders', description: 'Последние заявки' },
      { command: 'stats', description: 'Статистика заявок' },
      { command: 'id', description: 'Мой Telegram ID' },
      { command: 'stop', description: 'Отключить уведомления' },
    ] }).catch(() => {});
  } else {
    await tg(token, 'deleteWebhook').catch(() => {});
  }
  return updateSettings(store, (s) => {
    s.telegram.token = token;
    s.telegram.botUsername = me.username || '';
    s.telegram.botName = me.first_name || '';
    s.telegram.webhookSecret = webhookUrl ? webhookSecret : '';
    s.telegram.webhookUrl = webhookUrl;
    s.telegram.linkCode = sameBot && s.telegram.linkCode ? s.telegram.linkCode : randomToken(12);
    if (!sameBot) s.telegram.chats = [];
  });
}

async function disconnectBot(store) {
  const s = await getSettings(store);
  if (s.telegram.token) await tg(s.telegram.token, 'deleteWebhook').catch(() => {});
  return updateSettings(store, (x) => {
    Object.assign(x.telegram, { token: '', botUsername: '', botName: '', webhookSecret: '', webhookUrl: '', linkCode: '', chats: [] });
  });
}

const regenerateLink = (store) => updateSettings(store, (s) => { s.telegram.linkCode = randomToken(12); });

function addChat(s, chat) {
  const id = String(chat.id);
  if (s.telegram.chats.some((c) => c.id === id)) return false;
  const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : id);
  s.telegram.chats.push({ id, title, addedAt: new Date().toISOString() });
  return true;
}

// Manual entry: numeric ID (user or group). The bot must be able to write there, so we send a hello.
async function addChatById(store, rawId) {
  const id = String(rawId || '').trim();
  if (!/^-?\d{5,20}$/.test(id)) throw new TelegramError('Telegram ID — это число, например 123456789. Узнать его можно, написав боту /id.');
  const s = await getSettings(store);
  if (!s.telegram.token) throw new TelegramError('Сначала подключите бота по токену');
  let chat;
  try { chat = await tg(s.telegram.token, 'getChat', { chat_id: id }); } catch {
    throw new TelegramError('Бот не может написать в этот чат. Откройте бота в Telegram и нажмите «Start», затем повторите.');
  }
  await tg(s.telegram.token, 'sendMessage', { chat_id: id, text: '✅ Этот чат подключён к уведомлениям о новых заявках.' });
  return updateSettings(store, (x) => { addChat(x, chat); });
}

const removeChat = (store, id) => updateSettings(store, (s) => { s.telegram.chats = s.telegram.chats.filter((c) => c.id !== String(id)); });

const setPhone = (store, phone) => updateSettings(store, (s) => {
  const p = String(phone || '').trim();
  if (p && digits(p).length < 7) throw new TelegramError('Введите номер телефона полностью, например +7 999 123-45-67');
  s.telegram.phone = p;
});

const setStatusButtons = (store, on) => updateSettings(store, (s) => { s.telegram.statusButtons = Boolean(on); });

// Fallback when the webhook can't be used (local development): read recent messages.
async function detectChats(store) {
  const s = await getSettings(store);
  if (!s.telegram.token) throw new TelegramError('Сначала подключите бота по токену');
  if (s.telegram.webhookUrl) {
    return { added: 0, note: 'Бот работает через вебхук: просто откройте ссылку подключения или напишите боту /start.' };
  }
  const updates = await tg(s.telegram.token, 'getUpdates', { limit: 50, timeout: 0 });
  const chats = updates.map((u) => u.message && u.message.chat).filter(Boolean);
  let added = 0;
  await updateSettings(store, (x) => { for (const c of chats) if (addChat(x, c)) added++; });
  return { added, found: chats.length };
}

async function sendTest(store, origin) {
  const { token, chatIds } = await activeBot(store);
  if (!token) throw new TelegramError('Бот не подключён');
  if (!chatIds.length) throw new TelegramError('Нет подключённых чатов. Откройте ссылку подключения в Telegram.');
  const results = await Promise.allSettled(chatIds.map((id) => tg(token, 'sendMessage', {
    chat_id: id,
    text: `🔔 Тестовое уведомление\nНовые заявки с сайта ${origin} будут приходить сюда.`,
    disable_web_page_preview: true,
  })));
  return { sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
}

/* ---------- Notifications ---------- */
const STATUS_BUTTONS = ['review', 'in_progress', 'done', 'cancelled'];
const STATUS_ICON = { new: '🆕', review: '👀', in_progress: '🔧', done: '✅', cancelled: '❌' };

function statusKeyboard(orderId, current, origin) {
  const btn = (st) => ({ text: `${st === current ? '• ' : ''}${STATUS_ICON[st]} ${STATUSES[st]}`, callback_data: `st:${orderId}:${st}` });
  return {
    inline_keyboard: [
      [btn('review'), btn('in_progress')],
      [btn('done'), btn('cancelled')],
      ...(isPublicHttps(origin) ? [[{ text: 'Открыть в админ-панели', url: `${origin}/admin/#/orders/${orderId}` }]] : []),
    ],
  };
}

function orderText(order, filesCount, origin) {
  return [
    `<b>${STATUS_ICON.new} Новая заявка ${escHtml(order.number)}</b>`,
    '',
    `<b>Проект:</b> ${escHtml(order.project_name)}`,
    `<b>Услуги:</b> ${escHtml(order.services.map((s) => SERVICES[s] || s).join(', '))}`,
    `<b>Бюджет:</b> ${escHtml(BUDGETS[order.budget] || order.budget)}`,
    `<b>Сроки:</b> ${escHtml(DEADLINES[order.deadline] || order.deadline)}`,
    '',
    `<b>Клиент:</b> ${escHtml(order.name)}`,
    `<b>Email:</b> ${escHtml(order.email)}`,
    `<b>Телефон:</b> ${escHtml(order.phone)}`,
    order.telegram ? `<b>Telegram:</b> @${escHtml(order.telegram)}` : null,
    `<b>Связь:</b> ${escHtml(CONTACT_METHODS[order.contact_method] || order.contact_method)}`,
    filesCount ? `<b>Файлов:</b> ${filesCount}` : null,
    '',
    escHtml(cut(order.description, 700)),
    isPublicHttps(origin) ? '' : null,
    isPublicHttps(origin) ? null : `${origin}/admin/#/orders/${order.id}`,
  ].filter((l) => l !== null).join('\n');
}

async function notifyOrder(store, order, filesCount, origin, legacyChatId = '') {
  const { token, chatIds, settings } = await activeBot(store, legacyChatId);
  if (!token || !chatIds.length) return { skipped: true };
  const buttons = !settings || settings.telegram.statusButtons;
  const payload = {
    text: orderText(order, filesCount, origin),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: statusKeyboard(order.id, 'new', origin) } : {}),
  };
  const results = await Promise.allSettled(chatIds.map((id) => tg(token, 'sendMessage', { chat_id: id, ...payload })));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === results.length) throw failed[0].reason;
  return { sent: results.length - failed.length };
}

/* ---------- Webhook: updates from Telegram ---------- */
async function handleUpdate(store, update, { origin }) {
  const s = await getSettings(store);
  const token = s.telegram.token;
  if (!token) return;
  const send = (chatId, text, extra = {}) => tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }).catch(() => {});
  const linked = (id) => s.telegram.chats.some((c) => c.id === String(id));
  const removeKb = { reply_markup: { remove_keyboard: true } };

  if (update.callback_query) {
    const q = update.callback_query;
    const m = /^st:(\d+):(\w+)$/.exec(q.data || '');
    const chatId = q.message && q.message.chat && q.message.chat.id;
    if (!m || !STATUSES[m[2]] || !linked(chatId)) {
      await tg(token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа', show_alert: true }).catch(() => {});
      return;
    }
    const order = await store.updateOrder(Number(m[1]), { status: m[2] });
    if (!order) {
      await tg(token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Заявка не найдена (возможно, удалена)', show_alert: true }).catch(() => {});
      return;
    }
    await tg(token, 'answerCallbackQuery', { callback_query_id: q.id, text: `Статус: ${STATUSES[m[2]]}` }).catch(() => {});
    await tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: q.message.message_id, reply_markup: statusKeyboard(order.id, order.status, origin) }).catch(() => {});
    return;
  }

  const msg = update.message;
  if (!msg || !msg.chat) return;
  const chat = msg.chat;
  const text = String(msg.text || '').trim();
  const [cmd, arg] = text.split(/\s+/, 2);
  const command = (cmd || '').split('@')[0].toLowerCase();

  if (msg.contact) {
    if (linked(chat.id)) return send(chat.id, 'Этот чат уже подключён ✅', removeKb);
    const own = msg.from && msg.contact.user_id === msg.from.id;
    if (own && s.telegram.phone && samePhone(msg.contact.phone_number, s.telegram.phone)) {
      await updateSettings(store, (x) => { addChat(x, chat); });
      return send(chat.id, '✅ Номер подтверждён. Уведомления о новых заявках будут приходить сюда.', removeKb);
    }
    return send(chat.id, 'Этот номер не совпадает с номером администратора, указанным в админ-панели.', removeKb);
  }

  if (command === '/id') return send(chat.id, `Ваш Telegram ID: <code>${chat.id}</code>\nВставьте его в админ-панели → Интеграции → Telegram.`);

  if (command === '/start') {
    if (arg && s.telegram.linkCode && arg === s.telegram.linkCode) {
      const added = await updateSettings(store, (x) => { addChat(x, chat); }).then(() => true);
      if (added) return send(chat.id, '✅ Готово! Этот чат подключён: сюда будут приходить новые заявки.\n\nКоманды: /orders — последние заявки, /stats — статистика, /stop — отключить.', removeKb);
    }
    if (linked(chat.id)) return send(chat.id, 'Этот чат уже подключён ✅\n\nКоманды: /orders, /stats, /stop.');
    if (s.telegram.phone && chat.type === 'private') {
      return send(chat.id, 'Чтобы получать заявки, подтвердите, что вы администратор: нажмите кнопку ниже и отправьте свой номер телефона.', {
        reply_markup: { keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      });
    }
    return send(chat.id, `Этот бот присылает заявки администраторам сайта.\nВаш Telegram ID: <code>${chat.id}</code> — его можно вставить в админ-панели.`);
  }

  if (!linked(chat.id)) return undefined;

  if (command === '/stop') {
    await updateSettings(store, (x) => { x.telegram.chats = x.telegram.chats.filter((c) => c.id !== String(chat.id)); });
    return send(chat.id, 'Уведомления в этот чат отключены.');
  }
  if (command === '/stats') {
    const { byStatus, lastWeek } = await store.stats();
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return send(chat.id, [`<b>📊 Заявки</b>`, `Всего: ${total} (за 7 дней: +${lastWeek})`, ...Object.entries(STATUSES).map(([k, v]) => `${STATUS_ICON[k]} ${v}: ${byStatus[k] || 0}`)].join('\n'));
  }
  if (command === '/orders') {
    const { items } = await store.listOrders({ limit: 5, offset: 0, sort: 'newest' });
    if (!items.length) return send(chat.id, 'Заявок пока нет.');
    for (const o of items) {
      await send(chat.id, `${STATUS_ICON[o.status] || ''} <b>${escHtml(o.number)}</b> — ${escHtml(o.project_name)}\n${escHtml(o.name)} · ${escHtml(o.phone)}\nСтатус: ${escHtml(STATUSES[o.status] || o.status)}`, { reply_markup: statusKeyboard(o.id, o.status, origin) });
    }
    return undefined;
  }
  return send(chat.id, 'Команды: /orders — последние заявки, /stats — статистика, /id — ваш ID, /stop — отключить уведомления.');
}

module.exports = {
  tg, TelegramError, activeBot, connectBot, disconnectBot, regenerateLink, addChatById, removeChat, setPhone, setStatusButtons,
  detectChats, sendTest, notifyOrder, handleUpdate, samePhone, statusKeyboard,
};
