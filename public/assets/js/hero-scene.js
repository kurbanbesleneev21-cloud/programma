/* CODEFORGE — "Live coding programmer" hero scene.
   A 1600×900 stage scaled to cover the hero. The developer types for real:
   every character that appears in the editor triggers a finger tap on the
   matching hand, the head follows whichever monitor is active, the terminal
   runs commands and the preview hot-reloads after each file. */
(() => {
  'use strict';

  const hero = document.querySelector('.hero');
  const scene = document.getElementById('scene');
  if (!hero || !scene) return;

  const media = hero.querySelector('.hero__media');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSmall = matchMedia('(max-width: 680px)').matches;
  const STAGE_W = 1600, STAGE_H = 900;

  /* ---------- Optional real video background ----------
     Set data-video-mp4 / data-video-webm on .hero__media to use footage instead. */
  if (media && (media.dataset.videoMp4 || media.dataset.videoWebm) && !reduceMotion) {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, autoplay: true, playsInline: true, preload: 'auto' });
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.className = 'hero__video';
    if (media.dataset.poster) v.poster = media.dataset.poster;
    const small = isSmall && media.dataset.videoMobile;
    if (media.dataset.videoWebm && !small) v.append(Object.assign(document.createElement('source'), { src: media.dataset.videoWebm, type: 'video/webm' }));
    v.append(Object.assign(document.createElement('source'), { src: small || media.dataset.videoMp4, type: 'video/mp4' }));
    v.addEventListener('canplay', () => { v.classList.add('is-ready'); v.play().catch(() => {}); }, { once: true });
    media.prepend(v);
  }

  /* ---------- Fit stage ----------
     Desktop: scale to the hero height and slide the stage right so the programmer
     (stage x≈800) sits beside the headline, never behind it.
     Tablet/phone: cover the hero, centred on the programmer, as ambient background. */
  const title = hero.querySelector('.hero__title');
  const fit = () => {
    const W = hero.clientWidth, H = hero.clientHeight;
    let s, x, y;
    if (W >= 1100) {
      s = Math.max(H / STAGE_H, (W / STAGE_W) * 0.8) * 0.98;
      let textRight = 0;
      title.querySelectorAll('.line').forEach((l) => { textRight = Math.max(textRight, l.getBoundingClientRect().right - hero.getBoundingClientRect().left); });
      const headHalf = 230 * s; // shoulders/arms half-width incl. glow
      const target = Math.min(Math.max(textRight + headHalf, W * 0.64), W * 0.8);
      x = target - 800 * s;
      x = Math.max(Math.min(x, W * 0.25), W - STAGE_W * s); // keep right edge covered
      y = H * 0.86 - 770 * s; // hands just above the bottom fade
      y = Math.min(0, Math.max(y, H - STAGE_H * s));
      hero.style.setProperty('--gutter-left', `${hero.querySelector('.hero__content').getBoundingClientRect().left - hero.getBoundingClientRect().left + parseFloat(getComputedStyle(hero.querySelector('.hero__content')).paddingLeft)}px`);
    } else {
      s = Math.max(W / STAGE_W, H / STAGE_H) * (isSmall ? 1.08 : 1.04);
      x = W / 2 - 800 * s;
      y = Math.min(H * 0.97 - 770 * s, 0);
      y = Math.max(y, H - STAGE_H * s);
    }
    scene.style.setProperty('--scene-scale', s.toFixed(4));
    scene.style.setProperty('--scene-x', `${x.toFixed(1)}px`);
    scene.style.setProperty('--scene-y', `${y.toFixed(1)}px`);
  };
  fit();
  addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  requestAnimationFrame(() => scene.classList.add('is-ready'));

  /* ---------- DOM refs ---------- */
  const editor = scene.querySelector('[data-editor]');
  const gutter = scene.querySelector('[data-gutter]');
  const tabs = scene.querySelector('[data-tabs]');
  const langEl = scene.querySelector('[data-lang]');
  const posEl = scene.querySelector('[data-pos]');
  const term = scene.querySelector('[data-term]');
  const sideWin = scene.querySelector('.win--side');
  const side = scene.querySelector('[data-side]');
  const sideTitle = scene.querySelector('[data-side-title]');
  const previewBlocks = [...scene.querySelectorAll('[data-preview] .pv')];
  const head = scene.querySelector('.person .head');
  const hands = {
    left: scene.querySelector('[data-hand="left"]'),
    right: scene.querySelector('[data-hand="right"]'),
  };
  const fingers = {
    left: [...hands.left.querySelectorAll('.finger')],
    right: [...hands.right.querySelectorAll('.finger')],
  };
  const rims = [...scene.querySelectorAll('.person .rim')];
  const layers = [...scene.querySelectorAll('.scene__layer[data-depth]')];

  /* ---------- Code snippets ---------- */
  const FILES = [
    {
      name: 'OrderForm.tsx', lang: 'TypeScript', kind: 'js',
      code: `import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { orderSchema, type Order } from './schema';

export function OrderForm({ onSubmit }: Props) {
  const form = useForm<Order>({
    resolver: zodResolver(orderSchema),
    mode: 'onTouched',
  });

  // every step validates before moving on
  const next = async () => {
    const ok = await form.trigger(STEPS[step].fields);
    if (ok) setStep((s) => s + 1);
  };

  return <Stepper steps={STEPS} onNext={next} />;
}`,
    },
    {
      name: 'theme.css', lang: 'CSS', kind: 'css',
      code: `:root {
  --bg: #050505;
  --card: #141414;
  --text: #ffffff;
  --muted: #a1a1a1;
}

.card {
  border-radius: 24px;
  background: var(--card);
  transition: transform .6s var(--ease);
}

.card:hover {
  transform: translateY(-6px);
  box-shadow: 0 0 40px rgba(255, 255, 255, .25);
}`,
    },
    {
      name: 'notify.py', lang: 'Python', kind: 'py',
      code: `import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/orders")

@router.post("/", status_code=201)
async def create_order(order: OrderIn):
    saved = await repo.save(order)
    # ping the team in Telegram
    async with httpx.AsyncClient() as client:
        await client.post(TG_URL, json={
            "chat_id": CHAT_ID,
            "text": f"New order {saved.number}",
        })
    return {"number": saved.number}`,
    },
    {
      name: 'index.html', lang: 'HTML', kind: 'html',
      code: `<section class="hero">
  <h1 class="hero__title">
    We build digital products
  </h1>
  <p class="hero__subtitle">
    From idea to launch.
  </p>
  <a class="btn btn--primary" href="#order">
    Start a project
  </a>
</section>`,
    },
    {
      name: 'server.go', lang: 'Go', kind: 'go',
      code: `package main

import (
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/orders", createOrder)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}`,
    },
  ];

  const TERMINAL = [
    { cmd: 'git status', out: ['On branch feature/order-form', 'Changes not staged for commit:', '  <t-dim>modified:</t-dim>   src/OrderForm.tsx'] },
    { cmd: 'npm run test', out: ['<t-dim>> vitest run</t-dim>', ' ✓ schema.test.ts (12)', ' ✓ OrderForm.test.tsx (8)', '<t-ok> Tests  20 passed (20)</t-ok>'] },
    { cmd: 'npm run build', out: ['<t-dim>> next build</t-dim>', ' ✓ Compiled successfully in 4.2s', ' ✓ Generating static pages (12/12)', '<t-ok> Route (app)        Size   First Load</t-ok>', ' ○ /                  8.1 kB   94 kB'] },
    { cmd: 'python -m pytest -q', out: ['<t-dim>........................</t-dim>', '<t-ok>24 passed in 1.38s</t-ok>'] },
    { cmd: 'git commit -am "feat: multi-step order form"', out: ['[feature/order-form 3f9c2ab] feat: multi-step order form', ' 4 files changed, 186 insertions(+), 12 deletions(-)'] },
    { cmd: 'docker compose up -d', out: [' ✔ Container platform-db-1   <t-ok>Started</t-ok>', ' ✔ Container platform-api-1  <t-ok>Started</t-ok>'] },
    { cmd: 'git push origin feature/order-form', out: ['Enumerating objects: 9, done.', 'Writing objects: 100% (5/5), 2.31 KiB', '<t-ok> * [new branch]  feature/order-form</t-ok>'] },
  ];

  /* ---------- Tiny syntax highlighter (monochrome) ---------- */
  const KEYWORDS = {
    js: 'import from export function const let return async await if else type new class extends interface true false null',
    css: '',
    py: 'import from def async await return with as class if else for in True False None',
    html: '',
    go: 'package import func return if else for range var const type struct',
  };
  const kwSets = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [k, new Set(v.split(' ').filter(Boolean))]));
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function tokenize(line, kind) {
    const out = [];
    const push = (cls, text) => out.push({ cls, text });
    let i = 0;
    const commentStart = kind === 'py' ? '#' : kind === 'css' || kind === 'html' ? null : '//';
    while (i < line.length) {
      const rest = line.slice(i);
      let m;
      if (commentStart && rest.startsWith(commentStart)) { push('t-c', rest); break; }
      if (kind === 'html' && (m = rest.match(/^<\/?[a-z0-9]+/i))) { push('t-k', m[0]); i += m[0].length; continue; }
      if (kind === 'html' && (m = rest.match(/^\/?>/))) { push('t-k', m[0]); i += m[0].length; continue; }
      if ((m = rest.match(/^(["'`])(?:\\.|(?!\1).)*\1?/))) { push('t-s', m[0]); i += m[0].length; continue; }
      if (kind === 'css' && (m = rest.match(/^--?[a-z][\w-]*/i))) { push(line.trim().startsWith(m[0]) ? 't-f' : 't-s', m[0]); i += m[0].length; continue; }
      if (kind === 'css' && (m = rest.match(/^[.#:]?[a-z][\w-]*(?=\s*[{,:(])/i)) && /^\s*[.:a-z]/i.test(line) && !line.includes(':') ) { push('t-k', m[0]); i += m[0].length; continue; }
      if ((m = rest.match(/^#[0-9a-f]{3,8}\b|^\d[\d._]*(px|ms|s|kb|%)?/i))) { push('t-n', m[0]); i += m[0].length; continue; }
      if ((m = rest.match(/^@?[A-Za-z_][\w$]*/))) {
        const w = m[0];
        const after = line.slice(i + w.length);
        let cls = '';
        if (kwSets[kind] && kwSets[kind].has(w)) cls = 't-k';
        else if (w.startsWith('@')) cls = 't-k';
        else if (/^\s*\(/.test(after) || /^\s*</.test(after) && kind === 'js') cls = 't-f';
        else if (kind === 'css' && /^\s*:/.test(after)) cls = 't-f';
        else if (/^[A-Z]/.test(w)) cls = 't-f';
        push(cls, w); i += w.length; continue;
      }
      if ((m = rest.match(/^[{}()[\];,.=<>:+\-*/!?&|]+/))) { push('t-p', m[0]); i += m[0].length; continue; }
      push('', rest[0]); i += 1;
    }
    return out;
  }

  // Render the first `n` characters of a tokenized line as HTML.
  function renderTokens(tokens, n) {
    let html = '', left = n;
    for (const t of tokens) {
      if (left <= 0) break;
      const piece = t.text.slice(0, left);
      left -= piece.length;
      html += t.cls ? `<span class="${t.cls}">${esc(piece)}</span>` : esc(piece);
    }
    return html;
  }

  /* ---------- Scheduler that pauses while hero is off-screen ---------- */
  let visible = true, tabVisible = !document.hidden;
  const waiters = new Set();
  const isRunning = () => visible && tabVisible;
  const resumeAll = () => { if (isRunning()) { waiters.forEach((r) => r()); waiters.clear(); } };
  const sleep = (ms) => new Promise((resolve) => {
    setTimeout(() => (isRunning() ? resolve() : waiters.add(resolve)), ms);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; resumeAll(); }, { threshold: 0.02 }).observe(hero);
  }
  document.addEventListener('visibilitychange', () => { tabVisible = !document.hidden; resumeAll(); });
  const rand = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;

  /* ---------- Body animation state (lerped every frame) ---------- */
  const LOOK = { center: { x: 0, r: 0, y: 0 }, left: { x: -11, r: -7, y: 2 }, right: { x: 11, r: 7, y: 2 }, down: { x: 0, r: 0, y: 6 } };
  const pose = { x: 0, r: 0, y: 0, tx: 0, tr: 0, ty: 0 };
  const handPos = { left: { x: 0, y: 0, tx: 0, ty: 0 }, right: { x: 0, y: 0, tx: 0, ty: 0 } };
  let rightOnMouse = false;
  let glow = 0.5, glowTarget = 0.5;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

  function look(where) {
    const p = LOOK[where] || LOOK.center;
    pose.tx = p.x + rand(-1.5, 1.5); pose.tr = p.r + rand(-1, 1); pose.ty = p.y;
  }

  // Map ASCII key → hand + finger index (touch-typing layout).
  const LEFT_KEYS = '`12345qwertasdfgzxcvb~!@#$%QWERTASDFGZXCVB';
  const COLUMN = { q: 0, a: 0, z: 0, 1: 0, w: 1, s: 1, x: 1, 2: 1, e: 2, d: 2, c: 2, 3: 2, r: 3, f: 3, v: 3, t: 3, g: 3, b: 3, 4: 3, 5: 3,
    y: 0, h: 0, n: 0, u: 0, j: 0, m: 0, 6: 0, 7: 0, i: 1, k: 1, ',': 1, 8: 1, o: 2, l: 2, '.': 2, 9: 2, p: 3, ';': 3, '/': 3, 0: 3 };
  function tap(ch) {
    if (ch === ' ' || ch === '\n') {
      const side = ch === '\n' ? 'right' : chance(0.5) ? 'left' : 'right';
      const hp = handPos[side]; hp.y = 3; // thumb / enter press bobs the palm
      if (ch === '\n') pressFinger('right', 3);
      return;
    }
    const lower = ch.toLowerCase();
    const sideKey = LEFT_KEYS.includes(ch) ? 'left' : 'right';
    let col = COLUMN[lower];
    if (col === undefined) col = Math.floor(Math.random() * 4);
    // left fingers are mirrored in the SVG (pinky is the last rect)
    const idx = sideKey === 'left' ? 3 - col : col;
    if (sideKey === 'right' && rightOnMouse) setMouse(false);
    pressFinger(sideKey, idx);
    const hp = handPos[sideKey];
    hp.tx = (sideKey === 'left' ? -1 : 1) * rand(-4, 5) + (rightOnMouse && sideKey === 'right' ? 92 : 0);
    hp.y = 1.6;
  }
  function pressFinger(side, idx) {
    const f = fingers[side][idx];
    if (!f) return;
    f.classList.add('is-down');
    setTimeout(() => f.classList.remove('is-down'), rand(55, 95));
  }
  function setMouse(on) {
    rightOnMouse = on;
    handPos.right.tx = on ? 92 : 0;
    handPos.right.ty = on ? -2 : 0;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!isRunning()) return;
    const t = performance.now() / 1000;
    // head: target + idle micro-movement
    pose.x += (pose.tx - pose.x) * 0.06;
    pose.r += (pose.tr - pose.r) * 0.06;
    pose.y += (pose.ty - pose.y) * 0.06;
    const idleX = Math.sin(t * 0.7) * 0.8, idleR = Math.sin(t * 0.43) * 0.6, idleY = Math.sin(t * 0.9) * 0.6;
    head.style.transform = `translate(${(pose.x + idleX).toFixed(2)}px, ${(pose.y + idleY).toFixed(2)}px) rotate(${(pose.r + idleR).toFixed(2)}deg)`;

    for (const side of ['left', 'right']) {
      const hp = handPos[side];
      hp.x += (hp.tx - hp.x) * 0.12;
      hp.y += (hp.ty - hp.y) * 0.25;
      hands[side].style.transform = `translate(${hp.x.toFixed(2)}px, ${hp.y.toFixed(2)}px)`;
    }

    glow += (glowTarget - glow) * 0.05;
    const g = glow + Math.sin(t * 2.3) * 0.03 + Math.sin(t * 5.1) * 0.015;
    rims.forEach((r) => (r.style.opacity = g.toFixed(3)));

    // mouse parallax
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    pointer.sy += (pointer.y - pointer.sy) * 0.05;
    const sc = document.body.dataset.heroFixed === '1' ? 0 : Math.min(scrollY, innerHeight);
    layers.forEach((l) => {
      const d = Number(l.dataset.depth);
      l.style.transform = `translate3d(${(pointer.sx * d * -22).toFixed(2)}px, ${(pointer.sy * d * -12 + sc * d * 0.18).toFixed(2)}px, 0)`;
    });
  }

  // phones: the device tilt (from main.js) drives the scene parallax
  document.addEventListener('cf:tilt', (e) => { pointer.x = e.detail.x; pointer.y = e.detail.y; });

  if (!isSmall) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      pointer.x = (e.clientX - r.left) / r.width - 0.5;
      pointer.y = (e.clientY - r.top) / r.height - 0.5;
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { pointer.x = 0; pointer.y = 0; });
  }

  /* ---------- Editor (center monitor) ---------- */
  const MAX_LINES = 15;
  let lineEls = [], firstLineNo = 1, caret;
  function setTabs(activeIdx) {
    tabs.innerHTML = '';
    const start = Math.max(0, activeIdx - 1);
    FILES.slice(start, start + 3).forEach((f, i) => {
      const s = document.createElement('span');
      s.textContent = f.name;
      if (start + i === activeIdx) s.className = 'is-active';
      tabs.append(s);
    });
  }
  function renderGutter() {
    gutter.textContent = lineEls.map((_, i) => firstLineNo + i).join('\n');
  }
  function newLine() {
    const el = document.createElement('div');
    editor.append(el);
    lineEls.push(el);
    if (lineEls.length > MAX_LINES) { lineEls.shift().remove(); firstLineNo++; }
    renderGutter();
    return el;
  }
  function clearEditor() { editor.innerHTML = ''; lineEls = []; firstLineNo = 1; renderGutter(); }

  async function typeFile(fileIdx, instantLines = 0) {
    const file = FILES[fileIdx];
    setTabs(fileIdx);
    langEl.textContent = file.lang;
    clearEditor();
    caret = caret || Object.assign(document.createElement('span'), { className: 'caret' });
    const lines = file.code.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      const indent = raw.match(/^\s*/)[0];
      const tokens = tokenize(raw, file.kind);
      const el = newLine();
      if (li < instantLines) { el.innerHTML = renderTokens(tokens, raw.length); continue; }
      // IDE auto-indent: indentation appears instantly
      let n = indent.length;
      const draw = () => { el.innerHTML = renderTokens(tokens, n); el.append(caret); posEl.textContent = `Ln ${firstLineNo + lineEls.length - 1}, Col ${n + 1}`; };
      draw();
      caret.classList.add('is-typing');
      while (n < raw.length) {
        const ch = raw[n];
        // occasional typo + correction
        if (/[a-z]/i.test(ch) && chance(0.018)) {
          const wrong = String.fromCharCode(ch.charCodeAt(0) + (chance(0.5) ? 1 : -1));
          el.innerHTML = renderTokens(tokens, n) + esc(wrong); el.append(caret); tap(wrong);
          await sleep(rand(160, 320));
          el.innerHTML = renderTokens(tokens, n); el.append(caret); tap('p');
          await sleep(rand(90, 160));
        }
        n++;
        tap(ch);
        draw();
        let d = rand(22, 70);
        if (ch === ' ' && chance(0.08)) d += rand(150, 450); // thinking
        if (/[({]/.test(ch)) d += rand(40, 120);
        await sleep(d);
      }
      caret.classList.remove('is-typing');
      tap('\n');
      // pauses at line ends; sometimes glance at the preview or think
      if (raw.trim() === '') await sleep(rand(120, 260));
      else await sleep(rand(180, 520));
      if (chance(0.1)) { look('right'); glowTarget = 0.6; await sleep(rand(700, 1300)); look('center'); glowTarget = 0.5; }
      else if (chance(0.06)) { look('down'); await sleep(rand(400, 700)); look('center'); }
    }
    await sleep(500);
  }

  /* ---------- Terminal (left monitor) ---------- */
  const TERM_MAX = 13;
  const termLines = [];
  const PROMPT = '<span class="t-k">➜</span> <span class="t-f">platform</span> <span class="t-dim">git:(</span><span class="t-s">main</span><span class="t-dim">)</span> ';
  const fmtOut = (s) => esc(s).replace(/&lt;(t-[a-z]+)&gt;(.*?)&lt;\/\1&gt;/g, '<span class="$1">$2</span>');
  function termPush(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    term.append(el);
    termLines.push(el);
    while (termLines.length > TERM_MAX) termLines.shift().remove();
    return el;
  }
  let termIdx = 0;
  async function runCommand() {
    const job = TERMINAL[termIdx++ % TERMINAL.length];
    look('left'); glowTarget = 0.55;
    await sleep(rand(350, 600));
    const el = termPush(PROMPT);
    caret = caret || Object.assign(document.createElement('span'), { className: 'caret' });
    el.append(caret);
    for (let i = 1; i <= job.cmd.length; i++) {
      tap(job.cmd[i - 1]);
      el.innerHTML = PROMPT + esc(job.cmd.slice(0, i));
      el.append(caret);
      await sleep(rand(35, 95));
    }
    await sleep(rand(200, 400));
    tap('\n');
    el.innerHTML = PROMPT + esc(job.cmd);
    for (const line of job.out) {
      await sleep(rand(120, 420));
      termPush(fmtOut(line));
    }
    await sleep(rand(700, 1200));
  }

  /* ---------- Right monitor: hot-reload preview / secondary file ---------- */
  async function hotReload() {
    look('right'); glowTarget = 0.65; setMouse(true);
    sideWin.classList.remove('is-code');
    sideTitle.textContent = 'localhost:3000';
    previewBlocks.forEach((b) => b.classList.add('is-off'));
    await sleep(350);
    for (const b of previewBlocks) { b.classList.remove('is-off'); await sleep(rand(160, 300)); }
    await sleep(rand(1200, 2000));
    if (chance(0.5)) { look('center'); await sleep(rand(500, 900)); look('right'); await sleep(rand(600, 1000)); }
    setMouse(false); glowTarget = 0.5;
  }

  function showSideFile(fileIdx) {
    const f = FILES[fileIdx];
    sideTitle.textContent = f.name;
    side.innerHTML = f.code.split('\n').slice(0, 14).map((l) => renderTokens(tokenize(l, f.kind), l.length) || ' ').join('\n');
    sideWin.classList.add('is-code');
  }

  /* ---------- Main loop ---------- */
  async function loop() {
    // pre-fill terminal with some history so the screen isn't empty on load
    termPush(`${PROMPT}<span>npm run dev</span>`);
    termPush(fmtOut('<t-dim>> next dev --turbo</t-dim>'));
    termPush(fmtOut(' ▲ Ready on <t-ok>http://localhost:3000</t-ok>'));
    let fileIdx = 0, first = true;
    for (;;) {
      look('center');
      await typeFile(fileIdx, first ? 5 : 0);
      first = false;
      if (chance(0.75)) await runCommand();
      await hotReload();
      if (chance(0.35)) { showSideFile((fileIdx + 2) % FILES.length); look('right'); await sleep(rand(1500, 2400)); }
      fileIdx = (fileIdx + 1) % FILES.length;
    }
  }

  function renderStatic() {
    const f = FILES[0];
    setTabs(0);
    clearEditor();
    f.code.split('\n').slice(0, MAX_LINES).forEach((l) => { newLine().innerHTML = renderTokens(tokenize(l, f.kind), l.length); });
    termPush(`${PROMPT}npm run build`);
    TERMINAL[2].out.forEach((l) => termPush(fmtOut(l)));
  }

  if (reduceMotion) {
    renderStatic();
  } else {
    requestAnimationFrame(frame);
    loop();
  }
})();
