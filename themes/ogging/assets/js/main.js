(function () {
  var html = document.documentElement;

  var bar = document.getElementById('progress-bar');
  var siteHeader = document.querySelector('.site-header');
  var compactThreshold = 60;
  function getScrollTop() {
    return window.pageYOffset || html.scrollTop || document.body.scrollTop || 0;
  }
  function onScroll() {
    var top = getScrollTop();
    var max = html.scrollHeight - html.clientHeight;
    var pct = max > 0 ? (top / max) * 100 : 0;
    if (bar) bar.style.width = pct + '%';
    if (siteHeader) {
      siteHeader.classList.toggle('is-compact', top > compactThreshold);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var backdrop = document.getElementById('palette-backdrop');
  var input = document.getElementById('palette-input');
  var list = document.getElementById('palette-list');
  var empty = document.getElementById('palette-empty');
  var searchBtn = document.getElementById('search-btn');
  var index = [];

  function openPalette() {
    if (!backdrop) return;
    backdrop.hidden = false;
    setTimeout(function () { if (input) input.focus(); }, 30);
  }
  function closePalette() {
    if (!backdrop) return;
    backdrop.hidden = true;
    if (input) input.value = '';
    render('');
  }
  function render(q) {
    if (!list) return;
    var query = (q || '').toLowerCase().trim();
    var rows = index.filter(function (p) {
      if (!query) return true;
      var hay = ((p.title || '') + ' ' + (p.summary || '') + ' ' + (p.category || '')).toLowerCase();
      return hay.indexOf(query) !== -1;
    });
    list.innerHTML = '';
    if (rows.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    rows.slice(0, 30).forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'palette__item';
      a.href = p.url;
      var dateStr = p.date ? new Date(p.date).toISOString().slice(0, 10) : '';
      a.innerHTML =
        '<span class="t"></span><span class="c"></span>';
      a.querySelector('.t').textContent = p.title || '';
      a.querySelector('.c').textContent = [p.category || '', dateStr].filter(Boolean).join(' · ');
      list.appendChild(a);
    });
  }

  var navToggle = document.getElementById('nav-toggle');
  var siteNav = document.getElementById('site-nav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      var open = siteNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!siteNav.classList.contains('is-open')) return;
      if (e.target === navToggle || navToggle.contains(e.target)) return;
      if (siteNav.contains(e.target)) return;
      siteNav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  }

  if (searchBtn) searchBtn.addEventListener('click', openPalette);
  if (backdrop) backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closePalette();
  });
  window.addEventListener('keydown', function (e) {
    var key = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 'k') {
      e.preventDefault();
      if (backdrop && backdrop.hidden) openPalette(); else closePalette();
    } else if (key === 'escape' && backdrop && !backdrop.hidden) {
      closePalette();
    }
  });
  if (input) input.addEventListener('input', function (e) { render(e.target.value); });

  var indexUrl = (backdrop && backdrop.dataset.indexUrl) || '/index.json';
  fetch(indexUrl, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (json) { index = Array.isArray(json) ? json : []; render(''); })
    .catch(function () {});
})();

(function lightbox() {
  var modal = document.createElement('div');
  modal.className = 'lightbox';
  modal.hidden = true;
  modal.innerHTML = '<button class="lightbox__close" type="button" aria-label="닫기">×</button><div class="lightbox__content"></div>';
  document.body.appendChild(modal);
  var content = modal.querySelector('.lightbox__content');
  var closeBtn = modal.querySelector('.lightbox__close');

  function open(node) {
    var clone = node.cloneNode(true);
    if (clone.tagName && clone.tagName.toLowerCase() === 'svg') {
      clone.removeAttribute('style');
      clone.setAttribute('width', '100%');
      clone.setAttribute('height', '100%');
    }
    content.innerHTML = '';
    content.appendChild(clone);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function close() {
    modal.hidden = true;
    content.innerHTML = '';
    document.body.style.overflow = '';
  }
  modal.addEventListener('click', function (e) {
    if (e.target === modal || e.target === closeBtn || (e.target.closest && e.target.closest('.lightbox__close'))) close();
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key || '').toLowerCase() === 'escape' && !modal.hidden) close();
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    var mermaidEl = t.closest && t.closest('.mermaid');
    if (mermaidEl) {
      var svg = mermaidEl.querySelector('svg');
      if (svg) { e.preventDefault(); open(svg); }
      return;
    }
    if (t.tagName === 'IMG' && t.closest('article')) {
      e.preventDefault();
      open(t);
    }
  });
})();

(function mailtoCopy() {
  var toast;
  function showToast(msg) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('toast--visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.classList.remove('toast--visible'); }, 2200);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (err) { reject(err); }
    });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="mailto:"]');
    if (!a) return;
    var email = a.getAttribute('href').replace(/^mailto:/, '').split('?')[0];
    copyText(email).then(function () {
      showToast('이메일 주소를 복사했어요 — ' + email);
    }).catch(function () {
      showToast(email);
    });
  });
})();
