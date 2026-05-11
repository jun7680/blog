(function () {
  var html = document.documentElement;

  var bar = document.getElementById('progress-bar');
  function onScroll() {
    var max = html.scrollHeight - html.clientHeight;
    var pct = max > 0 ? (html.scrollTop / max) * 100 : 0;
    if (bar) bar.style.width = pct + '%';
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
