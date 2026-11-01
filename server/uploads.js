'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');
const { storage } = require('./storage');

// Allow-list: extension -> { mime, magic check }. SVG/HTML deliberately excluded (script injection).
const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const isZip = (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
const isTextLike = (b) => {
  const sample = b.subarray(0, 4096);
  return !sample.includes(0) && Buffer.from(sample).toString('utf8').indexOf('�') === -1;
};

const TYPES = {
  '.jpg':  { mime: 'image/jpeg', check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  '.jpeg': { mime: 'image/jpeg', check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  '.png':  { mime: 'image/png', check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.gif':  { mime: 'image/gif', check: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  '.webp': { mime: 'image/webp', check: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8) },
  '.pdf':  { mime: 'application/pdf', check: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: isZip },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: isZip },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: isZip },
  '.txt':  { mime: 'text/plain', check: isTextLike },
};

const ALLOWED_EXTENSIONS = Object.keys(TYPES);

class UploadError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: config.uploads.maxFiles,
    fileSize: config.uploads.maxFileSize,
    fields: 40,
    fieldSize: 16 * 1024,
    parts: 50,
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!TYPES[ext]) return cb(new UploadError(`Недопустимый тип файла: ${ext || 'без расширения'}`));
    cb(null, true);
  },
});

// Multer stores latin1-decoded names; recover UTF-8 and make them safe for display/headers.
function sanitizeOriginalName(name) {
  let decoded = name;
  try { decoded = Buffer.from(name, 'latin1').toString('utf8'); } catch { /* keep */ }
  const base = path.basename(decoded).replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, '_').trim();
  return (base || 'file').slice(0, 150);
}

// Validate content signatures and persist under random names outside the web root.
async function persistFiles(files = []) {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > config.uploads.maxTotal) {
    throw new UploadError(`Общий размер файлов больше ${Math.round(config.uploads.maxTotal / 1048576)} МБ`);
  }
  const prepared = [];
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const type = TYPES[ext];
    if (!type || !type.check(file.buffer)) {
      throw new UploadError(`Файл «${sanitizeOriginalName(file.originalname)}» повреждён или не соответствует своему расширению`);
    }
    prepared.push({
      storedName: `${crypto.randomUUID()}${ext}`,
      originalName: sanitizeOriginalName(file.originalname),
      mime: type.mime,
      size: file.size,
      buffer: file.buffer,
    });
  }
  const written = [];
  try {
    for (const f of prepared) {
      await storage.put('private', f.storedName, f.buffer, f.mime);
      written.push(f.storedName);
    }
  } catch (err) {
    await removeFiles(written);
    throw err;
  }
  return prepared.map(({ buffer, ...meta }) => meta);
}

async function removeFiles(storedNames) {
  await Promise.all(storedNames.map((n) => storage.remove('private', n)));
}

const readStoredFile = (storedName) => storage.get('private', storedName);

/* ---------- Site media (admin library): images and videos ---------- */
// ISO-BMFF (mp4/mov/m4v): bytes 4..8 are "ftyp". WebM/Matroska: EBML header 1A 45 DF A3.
const isFtyp = (b) => startsWith(b, [0x66, 0x74, 0x79, 0x70], 4);
const MEDIA_TYPES = {
  '.jpg':  { mime: 'image/jpeg', kind: 'image', check: TYPES['.jpg'].check },
  '.jpeg': { mime: 'image/jpeg', kind: 'image', check: TYPES['.jpg'].check },
  '.png':  { mime: 'image/png', kind: 'image', check: TYPES['.png'].check },
  '.gif':  { mime: 'image/gif', kind: 'image', check: TYPES['.gif'].check },
  '.webp': { mime: 'image/webp', kind: 'image', check: TYPES['.webp'].check },
  '.avif': { mime: 'image/avif', kind: 'image', check: (b) => isFtyp(b) },
  '.mp4':  { mime: 'video/mp4', kind: 'video', check: isFtyp },
  '.m4v':  { mime: 'video/mp4', kind: 'video', check: isFtyp },
  '.mov':  { mime: 'video/quicktime', kind: 'video', check: isFtyp },
  '.webm': { mime: 'video/webm', kind: 'video', check: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
};
const MEDIA_LIMITS = { image: 15 * 1024 * 1024, video: 50 * 1024 * 1024 }; // Supabase free plan: 50 MB per file
// Through the server (local disk or small files on Vercel) the request body limit applies.
const serverLimit = config.isVercel ? config.uploads.maxFileSize : MEDIA_LIMITS.video;

const mediaExt = (name) => {
  const ext = path.extname(String(name || '')).toLowerCase();
  return MEDIA_TYPES[ext] ? ext : null;
};

function describeMedia(name, size) {
  const ext = mediaExt(name);
  if (!ext) throw new UploadError('Можно загружать фото (JPG, PNG, WEBP, GIF, AVIF) и видео (MP4, MOV, WEBM)');
  const type = MEDIA_TYPES[ext];
  const max = MEDIA_LIMITS[type.kind];
  if (!(Number(size) > 0)) throw new UploadError('Пустой файл');
  if (Number(size) > max) throw new UploadError(`Файл больше ${Math.round(max / 1048576)} МБ. Сожмите ${type.kind === 'video' ? 'видео' : 'изображение'} и попробуйте снова.`);
  const storedExt = ext === '.jpeg' ? '.jpg' : ext === '.m4v' ? '.mp4' : ext;
  return { ext, type, path: `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${storedExt}` };
}

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: serverLimit, fields: 5 },
  fileFilter(req, file, cb) {
    if (!mediaExt(file.originalname)) return cb(new UploadError('Можно загружать фото (JPG, PNG, WEBP, GIF, AVIF) и видео (MP4, MOV, WEBM)'));
    cb(null, true);
  },
});

async function persistMedia(file) {
  if (!file) throw new UploadError('Выберите файл');
  const d = describeMedia(file.originalname, file.size);
  if (!d.type.check(file.buffer)) throw new UploadError('Файл повреждён или не соответствует своему формату');
  const saved = await storage.put('public', d.path, file.buffer, d.type.mime);
  return { path: saved.path, url: saved.url, originalName: sanitizeOriginalName(file.originalname), mime: d.type.mime, size: file.size };
}

// After a direct-to-storage upload: make sure the object exists, has the declared size and a real signature.
async function verifyDirectUpload(p, name) {
  const ext = path.extname(p).toLowerCase();
  const type = MEDIA_TYPES[ext];
  if (!type || !/^\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(p)) throw new UploadError('Некорректный путь файла');
  const head = await storage.head('public', p, 16);
  if (!head) throw new UploadError('Файл не найден в хранилище — загрузка не завершилась');
  if (!type.check(head.bytes) || head.size > MEDIA_LIMITS[type.kind]) {
    await storage.remove('public', p);
    throw new UploadError('Файл повреждён или не соответствует своему формату');
  }
  return { path: p, originalName: sanitizeOriginalName(Buffer.from(String(name || 'file'), 'utf8').toString('latin1')), mime: type.mime, size: head.size };
}

module.exports = {
  upload, mediaUpload, persistFiles, persistMedia, describeMedia, verifyDirectUpload, removeFiles, readStoredFile, UploadError, ALLOWED_EXTENSIONS, MEDIA_LIMITS,
};
