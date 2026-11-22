/* Columbia County Live — merch card slider (preview build v2, 2026-11-21).
   Each .merch-card runs its own rotation: one product at a time,
   ~6s hold, current slide exits left, next slides in from the right,
   loops forever. Timing is rAF-driven so the progress bar stays in
   sync and pauses cleanly on hover/focus/hidden tab.
   The whole card links to the Shopify collection. */
(function () {
  var SHOP_URL = 'https://vryy5m-dh.myshopify.com/collections/columbia-county-live';
  var HOLD_MS = 6000;
  var ANIM_MS = 660;

  function initCard(card) {
    var slides = Array.prototype.slice.call(card.querySelectorAll('.merch-slide'));
    var dots = Array.prototype.slice.call(card.querySelectorAll('.merch-dot'));
    var nameEl = card.querySelector('.merch-name');
    var priceEl = card.querySelector('.merch-price');
    var captionEl = card.querySelector('.merch-caption');
    var countEl = card.querySelector('.merch-count');
    var fillEl = card.querySelector('.merch-progress-fill');
    var prevBtn = card.querySelector('.merch-arrow.prev');
    var nextBtn = card.querySelector('.merch-arrow.next');
    if (!slides.length) return;

    var cur = 0;
    var animating = false;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    slides.forEach(function (s, i) {
      if (i === 0) {
        s.classList.add('is-on');
        s.style.transform = 'translateX(0)';
      }
    });

    function setCaption(i) {
      if (!nameEl) return;
      captionEl.classList.add('fading');
      setTimeout(function () {
        nameEl.textContent = slides[i].getAttribute('data-name') || '';
        priceEl.textContent = slides[i].getAttribute('data-price') || '';
        captionEl.classList.remove('fading');
      }, 180);
      if (countEl) countEl.textContent = (i + 1) + ' / ' + slides.length;
    }

    function go(n, dir) {
      if (animating || n === cur) return;
      dir = dir || 1;
      animating = true;
      var prev = slides[cur];
      var next = slides[n];
      next.classList.add('no-anim');
      next.classList.add('is-on');
      next.style.transform = 'translateX(' + 103 * dir + '%)';
      void next.offsetWidth; /* paint the entry position before animating */
      next.classList.remove('no-anim');
      next.style.transform = 'translateX(0)';
      prev.style.transform = 'translateX(' + -103 * dir + '%)';
      cur = n;
      dots.forEach(function (d, i) { d.classList.toggle('is-active', i === cur); });
      setCaption(cur);
      setTimeout(function () {
        prev.classList.remove('is-on');
        prev.classList.add('no-anim');
        prev.style.transform = 'translateX(103%)';
        void prev.offsetWidth;
        prev.classList.remove('no-anim');
        animating = false;
      }, ANIM_MS);
    }

    /* --- rAF clock driving both the auto-advance and the progress bar --- */
    var elapsed = 0;
    var lastTs = null;
    var paused = false;

    function frame(ts) {
      if (lastTs === null) lastTs = ts;
      var dt = ts - lastTs;
      lastTs = ts;
      if (!paused && !document.hidden && !animating) {
        elapsed += dt;
        if (elapsed >= HOLD_MS) {
          elapsed = 0;
          go((cur + 1) % slides.length, 1);
        }
      }
      if (fillEl) fillEl.style.width = Math.min(elapsed / HOLD_MS * 100, 100) + '%';
      requestAnimationFrame(frame);
    }
    if (!reduceMotion && slides.length > 1) requestAnimationFrame(frame);
    else if (fillEl) fillEl.style.width = '100%';

    function resetClock() { elapsed = 0; }

    dots.forEach(function (d, i) {
      d.addEventListener('click', function (ev) {
        ev.stopPropagation();
        go(i, i > cur ? 1 : -1);
        resetClock();
      });
    });
    if (prevBtn) prevBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      go((cur - 1 + slides.length) % slides.length, -1);
      resetClock();
    });
    if (nextBtn) nextBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      go((cur + 1) % slides.length, 1);
      resetClock();
    });

    card.addEventListener('pointerenter', function () { paused = true; });
    card.addEventListener('pointerleave', function () { paused = false; });
    card.addEventListener('focusin', function () { paused = true; });
    card.addEventListener('focusout', function () { paused = false; });

    /* Whole card links to the store; dots, arrows and real links keep their own behavior. */
    card.addEventListener('click', function (ev) {
      if (ev.target.closest('a, button')) return;
      window.open(SHOP_URL, '_blank', 'noopener');
    });
  }

  function init() {
    document.querySelectorAll('.merch-card').forEach(initCard);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
