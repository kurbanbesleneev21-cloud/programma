/* CODEFORGE — site-wide interactions (no dependencies) */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Touch devices (incl. phones in "desktop site" mode) never get mouse-only effects.
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || matchMedia('(any-pointer: coarse)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches && !hasTouch;
  const body = document.body;
  const fx = body.dataset.fx !== '0' && !reduceMotion;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  window.CF = window.CF || {};

  /* ---------- Toast ---------- */
  const toastEl = $('[data-toast]');
  let toastTimer;
  CF.toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-visible');
      setTimeout(() => (toastEl.hidden = true), 500);
    }, 2600);
  };

  /* ---------- Preloader ---------- */
  const preloader = $('.preloader');
  const hidePreloader = () => {
    if (!preloader) return;
    preloader.classList.add('is-done');
    setTimeout(() => preloader.remove(), 900);
  };
  if (preloader) {
    if (document.readyState === 'complete') setTimeout(hidePreloader, 250);
    else addEventListener('load', () => setTimeout(hidePreloader, 250), { once: true });
    setTimeout(hidePreloader, 3500); // never block the page on slow assets
  }

  /* ---------- Hero entrance ---------- */
  requestAnimationFrame(() => document.documentElement.classList.add('is-loaded'));

  /* ---------- Announcement bar (dismissible, remembered per text) ---------- */
  const ann = $('.announce');
  if (ann) {
    const key = `cf-ann-${[...ann.textContent].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)}`;
    if (store.get(key)) { ann.remove(); body.classList.remove('has-announce'); }
    $('[data-announce-close]', ann)?.addEventListener('click', () => { store.set(key, '1'); ann.remove(); body.classList.remove('has-announce'); });
  }

  /* ---------- Scroll-linked effects: progress bar, fixed hero fade, back-to-top ---------- */
  const progress = $('.scroll-progress');
  const heroEl = $('.hero');
  const heroMedia = body.dataset.heroFixed === '1' ? $('.hero__media') : null;
  const toTop = $('[data-to-top]');
  let scrollTicking = false;
  const onScrollFx = () => {
    scrollTicking = false;
    const y = scrollY;
    if (progress) {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : '0');
    }
    if (heroMedia && heroEl) {
      const h = heroEl.offsetHeight || innerHeight;
      const o = Math.max(0, 1 - y / (h * 0.85));
      heroMedia.style.opacity = o.toFixed(3);
      heroMedia.classList.toggle('is-gone', o <= 0.001);
    }
    if (toTop) toTop.classList.toggle('is-visible', y > innerHeight * 0.9);
  };
  addEventListener('scroll', () => { if (!scrollTicking) { scrollTicking = true; requestAnimationFrame(onScrollFx); } }, { passive: true });
  addEventListener('resize', onScrollFx);
  onScrollFx();
  toTop && toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  /* ---------- Floating contact buttons ---------- */
  const fab = $('[data-fab]');
  if (fab) {
    const toggle = $('.fab__toggle', fab);
    toggle.addEventListener('click', () => {
      const open = !fab.hasAttribute('data-open');
      fab.toggleAttribute('data-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (!fab.contains(e.target)) { fab.removeAttribute('data-open'); toggle.setAttribute('aria-expanded', 'false'); } });
  }

  /* ---------- Cookie notice ---------- */
  const cookie = $('[data-cookie]');
  if (cookie && !store.get('cf-cookie-ok')) {
    cookie.hidden = false;
    $('[data-cookie-ok]', cookie).addEventListener('click', () => { store.set('cf-cookie-ok', '1'); cookie.remove(); });
  }

  /* ---------- Background video: keep it playing (iOS pauses muted video sometimes) ---------- */
  const bgVideo = $('.bgfx video');
  if (bgVideo) {
    if (reduceMotion) bgVideo.pause();
    else document.addEventListener('visibilitychange', () => { if (!document.hidden) bgVideo.play().catch(() => {}); });
  }

  /* ---------- Section titles appear word by word ---------- */
  if (fx && body.dataset.textReveal === '1') {
    $$('.section-title, .cta__title, .page-title').forEach((el) => {
      if (el.children.length) return; // keep markup that already has structure
      const words = el.textContent.trim().split(/\s+/);
      el.setAttribute('aria-label', el.textContent.trim());
      el.classList.add('is-split');
      el.innerHTML = words.map((w, i) => `<span class="split-word" aria-hidden="true"><span style="--i:${i}">${w.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span></span>`).join(' ');
      if (!el.closest('[data-reveal]')) {
        const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { el.querySelectorAll('.split-word').forEach((s) => s.classList.add('is-in')); io.disconnect(); } }, { threshold: 0.2 });
        io.observe(el);
      }
    });
  }

  /* ---------- Navigation: transparent → glass ---------- */
  const nav = $('#nav');
  const onScroll = () => nav && nav.classList.toggle('is-scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const burger = $('.burger');
  const menu = $('#mobile-menu');
  const setMenu = (open) => {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    document.body.classList.toggle('menu-open', open);
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add('is-open'));
      const first = menu.querySelector('a');
      first && first.focus({ preventScroll: true });
    } else {
      menu.classList.remove('is-open');
      setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, 450);
    }
  };
  burger && burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
  menu && menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && burger && burger.getAttribute('aria-expanded') === 'true') { setMenu(false); burger.focus(); }
  });
  addEventListener('resize', () => { if (innerWidth > 1024 && burger && burger.getAttribute('aria-expanded') === 'true') setMenu(false); });

  /* ---------- Scroll spy ---------- */
  const spyLinks = $$('[data-spy]');
  if (spyLinks.length && 'IntersectionObserver' in window) {
    const map = new Map(spyLinks.map((a) => [a.dataset.spy, a]));
    const visible = new Map();
    const spy = new IntersectionObserver((entries) => {
      for (const en of entries) visible.set(en.target.id, en.isIntersecting ? en.intersectionRatio : 0);
      let best = null, ratio = 0;
      for (const [id, r] of visible) if (r > ratio && map.has(id)) { best = id; ratio = r; }
      if (best) spyLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.spy === best));
    }, { threshold: [0, .15, .3, .5, .7], rootMargin: '-20% 0px -40% 0px' });
    [...map.keys()].forEach((id) => { const el = document.getElementById(id); el && spy.observe(el); });
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = $$('[data-reveal]');
  if (fx && 'IntersectionObserver' in window) {
    // stagger siblings inside grids
    reveals.forEach((el) => {
      const parent = el.parentElement;
      const sibs = [...parent.children].filter((c) => c.hasAttribute('data-reveal'));
      if (sibs.length > 1) el.style.setProperty('--reveal-delay', `${Math.min(sibs.indexOf(el), 6) * 0.08}s`);
    });
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- Counters ---------- */
  const counters = $$('[data-count]');
  const runCounter = (el) => {
    const target = Number(el.dataset.count);
    if (reduceMotion) { el.textContent = target; return; }
    const dur = 1600, t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); }
    }, { threshold: 0.6 });
    counters.forEach((c) => cio.observe(c));
  } else counters.forEach((c) => (c.textContent = c.dataset.count));

  /* ---------- Timeline progress ---------- */
  const timeline = $('[data-timeline]');
  if (timeline) {
    const steps = $$('.step', timeline);
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = timeline.getBoundingClientRect();
      const vh = innerHeight;
      const p = Math.max(0, Math.min(1, (vh * 0.75 - r.top) / (r.height + vh * 0.25)));
      timeline.style.setProperty('--progress', p.toFixed(3));
      steps.forEach((s, i) => s.classList.toggle('is-active', p >= (i + 0.35) / steps.length || (p > 0.02 && i === 0)));
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
  }

  /* ---------- Spotlight on cards + button glow ---------- */
  if (finePointer) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('[data-spotlight]');
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
      const btn = e.target.closest && e.target.closest('.btn--primary');
      if (btn) {
        const r = btn.getBoundingClientRect();
        btn.style.setProperty('--bx', `${e.clientX - r.left}px`);
        btn.style.setProperty('--by', `${e.clientY - r.top}px`);
      }
    }, { passive: true });
  }

  /* ---------- 3D tilt on cards + magnetic big buttons (desktop) ---------- */
  if (finePointer && fx && body.dataset.tilt === '1') {
    let active = null;
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('[data-tilt-card]');
      if (active && active !== card) { active.classList.remove('is-tilting'); active.style.removeProperty('--rx'); active.style.removeProperty('--ry'); }
      active = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add('is-tilting');
      card.style.setProperty('--rx', `${(-py * 7).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${(px * 9).toFixed(2)}deg`);
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (active) active.classList.remove('is-tilting'); active = null; });

    $$('.btn--lg').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${((e.clientX - r.left) / r.width - 0.5) * 10}px, ${((e.clientY - r.top) / r.height - 0.5) * 8}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }

  /* ---------- FAQ accordion ---------- */
  $$('[data-accordion]').forEach((acc) => {
    const buttons = $$('.acc__btn', acc);
    buttons.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.acc');
        const open = !item.classList.contains('is-open');
        // single-open behaviour keeps the list tidy
        $$('.acc.is-open', acc).forEach((o) => { if (o !== item) { o.classList.remove('is-open'); $('.acc__btn', o).setAttribute('aria-expanded', 'false'); } });
        item.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
      });
      btn.addEventListener('keydown', (e) => {
        const k = e.key;
        let j = null;
        if (k === 'ArrowDown') j = (i + 1) % buttons.length;
        else if (k === 'ArrowUp') j = (i - 1 + buttons.length) % buttons.length;
        else if (k === 'Home') j = 0;
        else if (k === 'End') j = buttons.length - 1;
        if (j !== null) { e.preventDefault(); buttons[j].focus(); }
      });
    });
  });

  /* ---------- Service buttons → preselect in order form ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-pick-service]');
    if (!el) return;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('cf:pick-service', { detail: el.dataset.pickService }));
    const order = document.getElementById('order');
    order && order.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });

  /* ---------- Custom cursor (desktop only) ---------- */
  if (finePointer && !reduceMotion && body.dataset.cursor !== '0') {
    const cursor = $('.cursor');
    if (cursor) {
      document.documentElement.classList.add('has-cursor');
      const dot = $('.cursor__dot', cursor), ring = $('.cursor__ring', cursor);
      let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, raf = null;
      const loop = () => {
        rx += (x - rx) * 0.18; ry += (y - ry) * 0.18;
        dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
        raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.1 ? requestAnimationFrame(loop) : null;
      };
      addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        x = e.clientX; y = e.clientY;
        cursor.classList.add('is-visible');
        cursor.classList.toggle('is-hover', !!e.target.closest('a, button, label, input, textarea, select, [data-spotlight]'));
        if (!raf) raf = requestAnimationFrame(loop);
      }, { passive: true });
      document.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
      addEventListener('pointerdown', () => cursor.classList.add('is-down'));
      addEventListener('pointerup', () => cursor.classList.remove('is-down'));
    }
  }

  /* ---------- Delicate background particles ---------- */
  const canvas = $('.bg-particles');
  if (canvas && fx) {
    const ctx = canvas.getContext('2d');
    let w, h, dpr, particles = [], running = true, last = 0;
    const count = () => Math.round(Math.min(70, (innerWidth * innerHeight) / 26000));
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      const n = count();
      particles = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12 * dpr, vy: (-Math.random() * 0.15 - 0.03) * dpr,
        r: (Math.random() * 1.1 + 0.3) * dpr, a: Math.random() * 0.5 + 0.15,
      }));
    };
    const draw = (t) => {
      if (!running) return;
      requestAnimationFrame(draw);
      if (t - last < 33) return; // ~30fps is plenty for ambient motion
      last = t;
      ctx.clearRect(0, 0, w, h);
      const linkDist = 120 * dpr;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        ctx.globalAlpha = p.a;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            ctx.globalAlpha = (1 - Math.sqrt(d2) / linkDist) * 0.08;
            ctx.strokeStyle = '#fff'; ctx.lineWidth = dpr * 0.6;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
    };
    resize();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running) requestAnimationFrame(draw);
    });
    requestAnimationFrame(draw);
  }
})();
