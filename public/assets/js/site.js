/* Client sites: reveal-on-scroll */
(() => {
  'use strict';
  const els = document.querySelectorAll('[data-sx-reveal]');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
  els.forEach((e, i) => { e.style.transitionDelay = `${Math.min(i % 6, 5) * 60}ms`; io.observe(e); });
})();
