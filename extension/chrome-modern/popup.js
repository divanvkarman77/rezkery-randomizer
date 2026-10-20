(function () {
  'use strict';

  var isFirefox = typeof browser !== 'undefined';
  var API = isFirefox ? browser : chrome;
  var DB_KEY = 'rz_movies_v1';
  var USED_KEY = 'rz_used_v1';
  var pageCountOverride = 0;
  var hdrezkaSyncBusy = false;
  var currentCatalogPages = Object.create(null);
  var currentYearPages = Object.create(null);
  var currentYear = null;
  var currentYearFilter = 'all';
  var pending = Object.create(null);
  var busy = false;
  var BASE_ORIGIN = 'https://rezkery.com';
  var DEFAULT_ORIGIN = 'https://rezkery.com';

  var TYPE_LABELS = {
    all: 'Все вместе',
    film: 'Фильм',
    series: 'Сериал',
    cartoon: 'Мультфильм',
    anime: 'Аниме',
    other: 'Другое'
  };

  // Rezkery uses these genre ids in the visible content filters.
  // The supplied site pages currently end at these global page numbers;
  // the values are used only as a fallback if the first page exposes no pagination.
  var GENRE_BY_FILTER = { film: '1', series: '2', cartoon: '3', anime: '82' };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function storageGet(key) {
    if (isFirefox) return API.storage.local.get(key).then(function (x) { return x[key]; });
    return new Promise(function (resolve, reject) {
      API.storage.local.get(key, function (x) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(x[key]);
      });
    });
  }
  function storageSet(obj) {
    if (isFirefox) return API.storage.local.set(obj);
    return new Promise(function (resolve, reject) {
      API.storage.local.set(obj, function () {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }
  function createTab(url, active) {
    if (isFirefox) return API.tabs.create({ url: url, active: active !== false });
    return new Promise(function (resolve, reject) {
      API.tabs.create({ url: url, active: active !== false }, function (tab) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(tab);
      });
    });
  }
  function removeTab(id) {
    if (isFirefox) return API.tabs.remove(id).catch(function () {});
    return new Promise(function (resolve) { API.tabs.remove(id, function () { resolve(); }); });
  }
  function updateTab(id, url) {
    if (isFirefox) return API.tabs.update(id, { url: url, active: false });
    return new Promise(function (resolve, reject) {
      API.tabs.update(id, { url: url, active: false }, function (tab) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(tab);
      });
    });
  }
  function queryTabs(q) {
    if (isFirefox) return API.tabs.query(q);
    return new Promise(function (resolve, reject) {
      API.tabs.query(q, function (tabs) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(tabs);
      });
    });
  }
  function sendToTab(tabId, msg) {
    if (isFirefox) return API.tabs.sendMessage(tabId, msg);
    return new Promise(function (resolve, reject) {
      API.tabs.sendMessage(tabId, msg, function (response) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  API.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (message.type === 'REZKERY_PARSE_RESULT' && pending[message.requestId]) {
      pending[message.requestId].resolve(message.result);
    }
    if (message.type === 'REZKERY_PARSE_ERROR' && pending[message.requestId]) {
      pending[message.requestId].reject(new Error(message.error || 'Ошибка чтения страницы.'));
    }
    if (message.type === 'REZKERY_HDREZKA_PROGRESS') {
      var p = message.progress || {};
      $('#hdrezkaSyncStatus').textContent = (p.phase || 'Синхронизация…') + (p.total ? ' — ' + p.done + ' из ' + p.total : '…');
    }
    if (message.type === 'REZKERY_TASK_RESULT') {
      if (message.ok) {
        setBusy(false);
        var picks = message.picks || [];
        if (picks.length === 1) messageToast('Открыто: ' + picks[0].title);
        else messageToast('Открыто ' + picks.length + ': ' + picks.map(function(m){return m.title;}).join(' · '));
        renderDb();
      } else {
        setBusy(false);
        messageToast(message.error || 'Ошибка фоновой задачи.');
      }
    }
  });

  function setBusy(value) {
    busy = value;
    document.body.classList.toggle('busy', value);
    $$('button, input, select').forEach(function (el) { el.disabled = value; });
    $('#diagnostics').disabled = value;
    $('#searchInput').disabled = false;
  }

  function message(text, keep) {
    $('#message').textContent = text;
    if (!keep) {
      var el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
      document.body.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
    }
  }

  function messageToast(textValue) { message(textValue); }

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function normalizeUrl(url) {
    try {
      var u = new URL(url);
      u.hash = '';
      return u.href.replace(/\/+$/, '/');
    } catch (e) { return String(url || '').trim(); }
  }

  function inferTypeFromUrl(url) {
    var u = String(url || '').toLowerCase();
    if (/\/films\//.test(u)) return 'film';
    if (/\/series\//.test(u) || /\/serial/.test(u)) return 'series';
    if (/\/cartoons?\//.test(u) || /\/multfil/.test(u)) return 'cartoon';
    if (/\/anime\//.test(u)) return 'anime';
    return 'other';
  }

  function normalizeMovie(m) {
    m = m || {};
    var rawUrl = m.url || m.href || m.link || m.uri || '';
    var rawDate = m.addedAt || m.date || '';
    var addedAt = rawDate;
    if (typeof rawDate === 'number' || /^\d{10,13}$/.test(String(rawDate))) {
      var stamp = Number(rawDate); if (String(Math.floor(stamp)).length <= 10) stamp *= 1000;
      try { addedAt = new Date(stamp).toISOString(); } catch (e) { addedAt = new Date().toISOString(); }
    }
    var type = m.type;
    if (!TYPE_LABELS[type]) type = inferTypeFromUrl(rawUrl);
    return {
      id: normalizeUrl(rawUrl),
      url: normalizeUrl(rawUrl),
      title: m.title || m.name || 'Без названия',
      year: m.year || null,
      poster: m.poster || m.cover || '',
      type: type,
      typeLabel: TYPE_LABELS[type] || TYPE_LABELS.other,
      sourcePage: m.sourcePage || '',
      addedAt: addedAt || new Date().toISOString()
    };
  }

  function loadDb() {
    return storageGet(DB_KEY).then(function (db) {
      if (!Array.isArray(db)) return [];
      return db.filter(function (m) { return m && m.url; }).map(normalizeMovie);
    });
  }
  function saveDb(db) { return storageSet((function () { var x = {}; x[DB_KEY] = db; return x; })()); }
  function loadUsed() { return storageGet(USED_KEY).then(function (x) { return Array.isArray(x) ? x.map(normalizeUrl).filter(Boolean) : []; }); }
  function saveUsed(urls) { var x = {}; x[USED_KEY] = Array.from(new Set((urls || []).map(normalizeUrl).filter(Boolean))); return storageSet(x); }
  function mergeUsed(urls) { return loadUsed().then(function (existing) { return saveUsed(existing.concat(urls || [])); }); }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch (e) { return ''; }
  }
  function updateCount(db) { $('#dbCount').textContent = String(db.length); }
  function typeText(type) { return TYPE_LABELS[type] || TYPE_LABELS.other; }

  function addMovies(movies) {
    return loadDb().then(function (db) {
      var byUrl = Object.create(null);
      db.forEach(function (m) { byUrl[normalizeUrl(m.url)] = m; });
      var added = [];
      movies.forEach(function (m) {
        var url = normalizeUrl(m.url);
        if (!url || byUrl[url]) return;
        var type = TYPE_LABELS[m.type] ? m.type : inferTypeFromUrl(url);
        var item = normalizeMovie({
          url: url,
          title: m.title,
          year: m.year,
          poster: m.poster,
          type: type,
          sourcePage: m.sourcePage,
          addedAt: new Date().toISOString()
        });
        db.push(item); byUrl[url] = item; added.push(item);
      });
      return saveDb(db).then(function () { return { db: db, added: added }; });
    });
  }

  function renderDb() {
    return loadDb().then(function (db) {
      var q = clean($('#searchInput').value).toLowerCase();
      var filtered = db.filter(function (m) {
        if (q && clean(m.title).toLowerCase().indexOf(q) === -1 && String(m.year || '').indexOf(q) === -1 && typeText(m.type).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      filtered.sort(function (a, b) { return String(b.addedAt).localeCompare(String(a.addedAt)); });
      var tbody = $('#dbTable'); tbody.innerHTML = '';
      filtered.slice(0, 500).forEach(function (m) {
        var tr = document.createElement('tr');
        var td1 = document.createElement('td');
        var a = document.createElement('a'); a.className = 'movie-link'; a.href = m.url; a.target = '_blank'; a.textContent = m.title; td1.appendChild(a);
        var td2 = document.createElement('td'); var badge = document.createElement('span'); badge.className = 'type-badge'; badge.textContent = typeText(m.type); td2.appendChild(badge);
        var td3 = document.createElement('td'); td3.textContent = m.year || '—';
        var td4 = document.createElement('td'); td4.textContent = formatDate(m.addedAt);
        var td5 = document.createElement('td'); var b = document.createElement('button'); b.className = 'delete-one'; b.textContent = '×'; b.title = 'Удалить'; b.dataset.url = m.url; td5.appendChild(b);
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tr.appendChild(td5); tbody.appendChild(tr);
      });
      $('#dbEmpty').style.display = filtered.length ? 'none' : 'block';
      updateCount(db);
      return db;
    });
  }

  function parsePageViaTab(url, timeoutMs) {
    timeoutMs = timeoutMs || 25000;
    var requestId = 'p' + Date.now() + '_' + Math.random().toString(36).slice(2);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { delete pending[requestId]; reject(new Error('Не удалось прочитать страницу: тайм-аут.')); }, timeoutMs);
      pending[requestId] = { resolve: function (r) { clearTimeout(timer); delete pending[requestId]; resolve(r); }, reject: function (e) { clearTimeout(timer); delete pending[requestId]; reject(e); } };
      sendRuntime({ type: 'REZKERY_PARSE_URL', requestId: requestId, url: url });
    });
  }

  function sendRuntime(message) {
    if (isFirefox) return API.runtime.sendMessage(message);
    return new Promise(function (resolve, reject) {
      API.runtime.sendMessage(message, function (r) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(r);
      });
    });
  }

  function randomInt(max) { return Math.floor(Math.random() * max); }
  function uniqUrls(movies) {
    var seen = Object.create(null), out = [];
    movies.forEach(function (m) {
      var u = normalizeUrl(m.url);
      if (u && !seen[u]) { seen[u] = 1; out.push(m); }
    });
    return out;
  }

  function genreForFilter(filter) {
    return GENRE_BY_FILTER[filter] || '';
  }

  function filterLabel(filter) {
    return TYPE_LABELS[filter] || TYPE_LABELS.all;
  }

  function catalogStartUrl(filter) {
    var genre = genreForFilter(filter);
    return BASE_ORIGIN + (genre ? '/?filter=last&genre=' + genre : '/');
  }

  function pageUrl(scope, year, page, filter) {
    var genre = genreForFilter(filter);
    var suffix = genre ? '?filter=last&genre=' + genre : '';
    if (scope === 'year') {
      return BASE_ORIGIN + '/year/' + year + (page > 1 ? '/page/' + page + '/' : '/') + suffix;
    }
    return BASE_ORIGIN + (page > 1 ? '/page/' + page + '/' : '/') + suffix;
  }

  function normalizeOrigin(value) {
    value = clean(value);
    if (!value) return DEFAULT_ORIGIN;
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    try {
      var u = new URL(value);
      if (u.username || u.password || u.pathname !== '/' && u.pathname !== '') throw new Error('Укажите только домен, без пути.');
      return u.protocol + '//' + u.host;
    } catch (e) { throw new Error('Некорректный домен. Пример: https://rezka.fi'); }
  }

  function loadSettings() {
    return storageGet('rz_settings_v1').then(function (s) {
      s = s || {};
      try { BASE_ORIGIN = normalizeOrigin(s.domain || DEFAULT_ORIGIN); } catch (e) { BASE_ORIGIN = DEFAULT_ORIGIN; }
      pageCountOverride = Math.max(0, Math.min(100000, parseInt(s.pageCountOverride, 10) || 0));
      return { domain: BASE_ORIGIN, pageCountOverride: pageCountOverride };
    });
  }

  function saveSettings() {
    var input = $('#domainInput');
    var origin = normalizeOrigin(input.value);
    var rawCount = clean($('#pageCountOverride').value);
    var pages = rawCount ? Number(rawCount) : 0;
    if (!Number.isInteger(pages) || pages < 0 || pages > 100000) throw new Error('Укажи целое число страниц от 0 до 100000.');
    return storageGet('rz_settings_v1').then(function (existing) {
      existing = existing || {}; existing.domain = origin; existing.pageCountOverride = pages;
      return storageSet({ rz_settings_v1: existing });
    }).then(function () {
      BASE_ORIGIN = origin; pageCountOverride = pages;
      input.value = BASE_ORIGIN; $('#pageCountOverride').value = String(pages);
      currentCatalogPages = Object.create(null); currentYearPages = Object.create(null);
      $('#catalogPages').textContent = pages ? String(pages) + ' (вручную)' : 'не определено';
      $('#yearPages').textContent = 'не определено';
      $('#settingsStatus').textContent = 'Сохранено: ' + BASE_ORIGIN + ' · страниц: ' + (pages || 'авто');
      message('Настройки сохранены.');
    });
  }

  function replaceOrigin(url) {
    try { var u = new URL(url); u.protocol = new URL(BASE_ORIGIN).protocol; u.host = new URL(BASE_ORIGIN).host; return u.href; }
    catch (e) { return url; }
  }

  function detectCatalogPages(filter) {
    filter = filter || 'all';
    if (currentCatalogPages[filter]) {
      $('#catalogPages').textContent = String(currentCatalogPages[filter]);
      return Promise.resolve(currentCatalogPages[filter]);
    }
    $('#catalogPages').textContent = 'определяю…';
    var url = catalogStartUrl(filter);
    return parsePageViaTab(url, 30000).then(function (result) {
      if (!result || !result.cards || result.cards.length < 1) {
        throw new Error('Не удалось найти карточки в режиме «' + filterLabel(filter) + '». Проверьте доступ к выбранному домену.');
      }
      var max = result.pagination ? Number(result.pagination.max) || 1 : 1;
      if (!(result.pagination && result.pagination.exact) || max < 2) {
        throw new Error('Не удалось прочитать ссылку на последнюю страницу. Укажи её номер в настройках (например, 2540), чтобы рандом выбирал по всему каталогу.');
      }
      currentCatalogPages[filter] = max;
      $('#catalogPages').textContent = String(max) + (pageCountOverride ? ' · рандом: ' + pageCountOverride : '');
      return max;
    });
  }

  function detectYearPages(year, filter, force) {
    filter = filter || 'all';
    var cacheKey = String(year) + ':' + filter;
    if (!force && currentYearPages[cacheKey]) {
      currentYear = year;
      currentYearFilter = filter;
      $('#yearPages').textContent = String(currentYearPages[cacheKey]);
      return Promise.resolve(currentYearPages[cacheKey]);
    }
    currentYear = year;
    currentYearFilter = filter;
    $('#yearPages').textContent = 'определяю…';
    $('#yearPageStatus').textContent = 'Читаю пагинацию ' + year + ' · ' + filterLabel(filter) + '…';
    var firstUrl = pageUrl('year', year, 1, filter);
    var seen = Object.create(null);

    function pageNumberFromUrl(url) {
      var m = String(url || '').match(/\/page\/(\d+)\/?(?:\?.*)?$/);
      return m ? Number(m[1]) : 1;
    }

    function walk(url, result, guard) {
      guard = guard || 0;
      var p = result && result.pagination ? result.pagination : {};
      var max = Math.max(Number(p.max) || 1, Number(p.last ? pageNumberFromUrl(p.last) : 1) || 1);
      var current = Number(p.current || pageNumberFromUrl(url) || 1) || 1;
      if (max > current) return Promise.resolve(max);
      var next = ''; try { if (p.next && new URL(p.next).host === new URL(BASE_ORIGIN).host && /^https?:$/i.test(new URL(p.next).protocol)) next = p.next; } catch (e) {}
      if (next && guard < 120 && !seen[next] && next !== url) {
        seen[next] = 1;
        $('#yearPageStatus').textContent = 'Проверяю следующую страницу ' + (current + 1) + '…';
        return parsePageViaTab(next, 30000).then(function (r) { return walk(next, r, guard + 1); });
      }
      return Promise.resolve(max);
    }

    return parsePageViaTab(firstUrl, 30000).then(function (result) {
      if (!result || !result.cards || result.cards.length < 1) {
        throw new Error('На странице года не найдены карточки для «' + filterLabel(filter) + '».');
      }
      seen[firstUrl] = 1;
      return walk(firstUrl, result, 0);
    }).then(function (max) {
      currentYearPages[cacheKey] = Math.max(1, Number(max) || 1);
      $('#yearPages').textContent = String(currentYearPages[cacheKey]);
      $('#yearPageStatus').textContent = 'Определено по пагинации ' + year + ' · ' + filterLabel(filter) + '.';
      return currentYearPages[cacheKey];
    }).catch(function (e) {
      $('#yearPages').textContent = 'ошибка';
      $('#yearPageStatus').textContent = e.message || 'Ошибка чтения страницы.';
      throw e;
    });
  }

  function typeMatches(movie, filter) { return filter === 'all' || movie.type === filter; }

  function pickOne(scope, year, pageCount, dbUrls, filter) {
    var attempts = 0;
    function next() {
      attempts++;
      if (attempts > 60) {
        var wanted = typeText(filter);
        return Promise.reject(new Error('Не нашлась новая карточка: ' + wanted + '. Возможно, этот тип контента уже почти полностью есть в базе или его мало в каталоге.'));
      }
      var page = randomInt(pageCount) + 1;
      return parsePageViaTab(pageUrl(scope, year, page, filter), 25000).then(function (result) {
        var candidates = uniqUrls(result.cards || []).filter(function (m) {
          return typeMatches(m, filter) && !dbUrls[normalizeUrl(m.url)];
        });
        if (!candidates.length) return next();
        return candidates[randomInt(candidates.length)];
      });
    }
    return next();
  }

  function runRandom(scope, year, count, filter) {
    if (busy) return;
    count = Math.max(1, Math.min(30, Number(count) || 1));
    filter = filter || 'all';
    setBusy(true);
    var taskId = 't' + Date.now() + '_' + Math.random().toString(36).slice(2);
    message('Фоновый рандом: подбираю ' + count + '…', true);
    sendRuntime({ type: 'REZKERY_RUN_RANDOM', taskId: taskId, scope: scope, year: year, count: count, filter: filter }).catch(function(e){ setBusy(false); message(e.message || 'Не удалось запустить фоновую задачу.'); });
  }

  function plural(n, one, few, many) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function exportJson() {
    Promise.all([loadDb(), loadUsed()]).then(function (values) {
      var db = values[0], used = Array.from(new Set(values[1].concat(db.map(function (m) { return m.url; }))));
      downloadFile('rezkery-randomizer-' + dateStamp() + '.json', JSON.stringify({
        format: 'rezkery-randomizer-db', version: 1, exportedAt: new Date().toISOString(), items: db, used: used
      }, null, 2), 'application/json;charset=utf-8');
      message('JSON экспортирован в совместимом формате.');
    });
  }

  function htmlEscape(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function exportHtml() {
    loadDb().then(function (db) {
      var exportDb = db.map(function(m){ var x = {}; Object.keys(m).forEach(function(k){x[k]=m[k];}); x.url = replaceOrigin(m.url); x.id = x.url; return x; });
      var data = JSON.stringify(exportDb).replace(/<\//g, '<\\/');
      var cards = exportDb.map(function (m) {
        var poster = m.poster ? '<img loading="lazy" src="' + htmlEscape(m.poster) + '" alt="">' : '';
        return '<article class="card" data-type="' + htmlEscape(m.type) + '">' + poster + '<div class="ct"><a href="' + htmlEscape(m.url) + '" target="_blank" rel="noopener">' + htmlEscape(m.title) + '</a><div class="meta">' + htmlEscape(typeText(m.type)) + ' · ' + htmlEscape(m.year || '') + ' · добавлен ' + htmlEscape(formatDate(m.addedAt)) + '</div></div></article>';
      }).join('');
      var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rezkery Randomizer — моя база</title><style>body{margin:0;background:#111317;color:#f3f4f6;font:14px Arial,sans-serif}header{position:sticky;top:0;background:#181b22;padding:14px 18px;border-bottom:1px solid #2a2f38;display:flex;gap:8px;align-items:center;flex-wrap:wrap}button,select{border:1px solid #38404d;border-radius:8px;background:#2a303b;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}.wrap{max-width:1100px;margin:auto;padding:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.card{background:#181b22;border:1px solid #2b313c;border-radius:10px;overflow:hidden}.card img{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;background:#20242d}.ct{padding:10px}.ct a{color:#fff;font-weight:700;text-decoration:none}.ct a:hover{text-decoration:underline}.meta{color:#7f8794;font-size:11px;margin-top:5px}#empty{padding:30px;text-align:center;color:#7f8794}</style></head><body><header><strong>Rezkery Randomizer</strong><span id="domain"></span><span id="count"></span><select id="type"><option value="all">Все типы</option><option value="film">Только фильмы</option><option value="series">Только сериалы</option><option value="cartoon">Только мультфильмы</option><option value="anime">Только аниме</option></select><button id="random">🎲 Случайный</button></header><div class="wrap"><div class="grid">' + cards + '</div>' + (!exportDb.length ? '<div id="empty">База пуста.</div>' : '') + '</div><script id="rezkery-data" type="application/json">' + data + '</script><script>var D=JSON.parse(document.getElementById("rezkery-data").textContent);document.getElementById("domain").textContent=" · Домен: BASE_ORIGIN";var S=document.getElementById("type");var C=document.querySelector(".grid");function render(){var f=S.value;var a=D.filter(function(x){return f==="all"||x.type===f;});Array.prototype.forEach.call(C.children,function(n){n.style.display=(f==="all"||n.getAttribute("data-type")===f)?"":"none";});document.getElementById("count").textContent=" · "+a.length+" карточек";}S.onchange=render;document.getElementById("random").onclick=function(){var f=S.value,a=D.filter(function(x){return f==="all"||x.type===f;});if(!a.length)return;window.open(a[Math.floor(Math.random()*a.length)].url,"_blank");};render();</script></body></html>';
      html = html.replace('BASE_ORIGIN', htmlEscape(BASE_ORIGIN));
      downloadFile('rezkery-randomizer-' + dateStamp() + '.html', html, 'text/html;charset=utf-8');
      message('HTML экспортирован.');
    });
  }

  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  function dateStamp() { return new Date().toISOString().slice(0, 10); }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = String(reader.result || ''), imported = [], importedUsed = [];
        function unpack(data) {
          if (Array.isArray(data)) return data;
          if (!data || typeof data !== 'object') return [];
          importedUsed = Array.isArray(data.used) ? data.used : [];
          return data.items || data.movies || data.data || data.bookmarks || [];
        }
        if (/\.json$/i.test(file.name) || (file.type || '').indexOf('json') >= 0) {
          imported = unpack(JSON.parse(text));
        } else {
          var doc = new DOMParser().parseFromString(text, 'text/html');
          var script = doc.getElementById('rezkery-data') || doc.getElementById('rezkery-db');
          if (script) imported = unpack(JSON.parse(script.textContent || '[]'));
          else throw new Error('Это не экспорт Rezkery Randomizer.');
        }
        imported = imported.filter(function (m) { return m && (m.url || m.href || m.link || m.uri); }).map(normalizeMovie);
        loadDb().then(function (db) {
          var map = Object.create(null); db.forEach(function (m) { map[normalizeUrl(m.url)] = m; });
          var n = 0;
          imported.forEach(function (m) { var u = normalizeUrl(m.url); if (!map[u]) { m.id = u; map[u] = m; db.push(m); n++; } });
          return Promise.all([saveDb(db), mergeUsed(importedUsed.concat(imported.map(function (m) { return m.url; })))])
            .then(function () { message('Импортировано новых: ' + n + ' · всего в базе: ' + db.length); renderDb(); });
        });
      } catch (e) { message('Импорт: ' + (e.message || 'не удалось разобрать файл.')); }
    };
    reader.readAsText(file); $('#importFile').value = ''; if ($('#settingsImportFile')) $('#settingsImportFile').value = '';
  }


  function loadSyncSettings() {
    return storageGet('rz_settings_v1').then(function(s) {
      s = s || {};
      $('#githubToken').value = s.githubToken || '';
      $('#githubGistId').value = s.githubGistId || '';
    });
  }

  function githubSync() {
    var token = clean($('#githubToken').value);
    var gistId = clean($('#githubGistId').value);
    if (!token) { $('#syncStatus').textContent = 'Вставьте GitHub token с разрешением gist.'; return; }
    $('#syncStatus').textContent = 'Синхронизирую…';
    Promise.all([loadDb(), storageGet('rz_settings_v1')]).then(function(values) {
      var local = values[0], settings = values[1] || {};
      function api(url, method, body) {
        return fetch(url, {
          method: method,
          headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        }).then(function(r) {
          return r.text().then(function(t) {
            var data = {}; try { data = t ? JSON.parse(t) : {}; } catch (e) {}
            if (!r.ok) throw new Error(data.message || ('GitHub API: HTTP ' + r.status));
            return data;
          });
        });
      }
      function merge(remote) {
        var map = Object.create(null);
        (remote || []).concat(local).forEach(function(m) {
          if (!m || !m.url) return;
          var normalized = normalizeMovie(m), key = normalizeUrl(normalized.url);
          if (!key) return;
          if (!map[key] || String(normalized.addedAt) > String(map[key].addedAt)) map[key] = normalized;
        });
        return Object.keys(map).map(function(k) { return map[k]; });
      }
      function contentFrom(gist) {
        var file = gist && gist.files && (gist.files['rezkery-randomizer.json'] || Object.values(gist.files)[0]);
        if (!file || !file.content) return {items:[],used:[]};
        var parsed = JSON.parse(file.content);
        return Array.isArray(parsed) ? {items:parsed,used:[]} : {items:parsed.items || parsed.movies || [],used:parsed.used || []};
      }
      var getPromise = gistId ? api('https://api.github.com/gists/' + encodeURIComponent(gistId), 'GET') : Promise.resolve(null);
      return Promise.all([getPromise,loadUsed()]).then(function(values) {
        var gist=values[0], remote=gist?contentFrom(gist):{items:[],used:[]}, merged=merge(remote.items);
        var used=Array.from(new Set(values[1].concat(remote.used||[],merged.map(function(m){return m.url;}))));
        var fileBody = JSON.stringify({format:'rezkery-randomizer-db',version:1,syncedAt:new Date().toISOString(),items:merged,used:used}, null, 2);
        var body = {description:'Rezkery Randomizer database sync',public:false,files:{'rezkery-randomizer.json':{content:fileBody}}};
        return (gist ? api('https://api.github.com/gists/' + encodeURIComponent(gistId), 'PATCH', body) : api('https://api.github.com/gists', 'POST', body))
          .then(function(saved) {
            return Promise.all([saveDb(merged),saveUsed(used)]).then(function() {
              settings.githubToken = token; settings.githubGistId = saved.id || gistId; settings.domain = settings.domain || BASE_ORIGIN;
              return storageSet({rz_settings_v1:settings}).then(function() {
                $('#githubGistId').value = settings.githubGistId;
                $('#syncStatus').textContent = 'Готово: объединено карточек ' + merged.length + '. Gist: ' + settings.githubGistId;
                renderDb();
              });
            });
          });
      });
    }).catch(function(e) {
      $('#syncStatus').textContent = 'Ошибка синхронизации: ' + (e.message || 'неизвестная ошибка');
    });
  }


  function hdrezkaSync() {
    if (hdrezkaSyncBusy) return;
    hdrezkaSyncBusy = true;
    var status = $('#hdrezkaSyncStatus'), button = $('#hdrezkaSyncNow');
    button.disabled = true;
    status.textContent = 'Проверяю авторизацию HDRezka…';
    queryTabs({active:true,currentWindow:true}).then(function(tabs) {
      var tab=tabs && tabs[0];
      if(!tab || !tab.id || !tab.url) throw new Error('Откройте HDRezka в активной вкладке и войдите в свой аккаунт.');
      var host;
      try { host = new URL(tab.url).hostname; } catch(e) { throw new Error('Не удалось определить адрес активной вкладки.'); }
      if (!/(rezka|hdrzk)/i.test(host)) throw new Error('Откройте HDRezka (войдите в аккаунт) в активной вкладке и повторите синхронизацию.');
      return loadDb().then(function(db) {
        return API.scripting.executeScript({
          target:{tabId:tab.id},
          args:[db.map(function(m){return {url:m.url,title:m.title||m.name||'',year:m.year||'',type:m.type||''};})],
          func: async function(movies) {
            var api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
            var delay=1400,lastRequest=0,visited=Object.create(null);
            function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
            async function pace(){if(lastRequest){var left=delay-(Date.now()-lastRequest);if(left>0)await wait(left);}lastRequest=Date.now();}
            function progress(phase,done,total){
              try{if(api&&api.runtime&&api.runtime.sendMessage){var p=api.runtime.sendMessage({type:'REZKERY_HDREZKA_PROGRESS',progress:{phase:phase,done:done||0,total:total||0}});if(p&&p.catch)p.catch(function(){});}}catch(e){}
            }
            function challenge(text){return /anubis|cloudflare|cdn-cgi\/challenge|captcha|checking your browser|just a moment|провер(ка|ьте).*человек/i.test(text||'');}
            async function getText(url){
              await pace();
              var r=await fetch(url,{credentials:'include',redirect:'follow'}),t=await r.text();
              if(challenge(t))throw new Error('HDRezka показала проверку защиты. Запросы остановлены; пройди её в браузере и повтори синхронизацию.');
              if(!r.ok)throw new Error('HDRezka вернула HTTP '+r.status+' при чтении закладок.');
              return t;
            }
            async function apiPost(data){
              await pace();
              var r=await fetch(new URL('/ajax/favorites/',location.origin),{
                method:'POST',credentials:'include',
                headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
                body:new URLSearchParams(data).toString()
              });
              var t=await r.text();
              if(challenge(t)||r.status===429)throw new Error('HDRezka ограничила запросы или показала проверку защиты. Синхронизация остановлена.');
              var j;try{j=JSON.parse(t);}catch(e){throw new Error('HDRezka вернула не JSON. Проверь вход в аккаунт.');}
              if(!r.ok||j.success===false)throw new Error(j.message||('Ошибка закладок HTTP '+r.status));
              return j;
            }
            function postId(url){
              try{var p=new URL(url).pathname,m=p.match(/(?:^|\/)(\d+)-[^/]+\.html?$/i);return m?m[1]:'';}catch(e){return '';}
            }
            function parsePage(html){
              var d=new DOMParser().parseFromString(html,'text/html'),items=[],seen=Object.create(null);
              d.querySelectorAll('.b-content__inline_item').forEach(function(n){
                var a=n.querySelector('.b-content__inline_item-link > a[href]')||n.querySelector('a[href]');
                if(!a)return;
                var u=new URL(a.getAttribute('href'),location.origin).href;
                if(seen[u])return;seen[u]=1;
                var info=n.querySelector('.b-content__inline_item-link'),marker=n.querySelector('.b-content__inline_item-cover .cat, .cat');
                var cls=marker?String(marker.className||'').toLowerCase():'',ctx=(info?info.textContent:n.textContent)||'';
                var m=ctx.match(/(?:^|\D)(19\d{2}|20\d{2}|21\d{2})(?:\D|$)/)||u.match(/(?:^|\D)(19\d{2}|20\d{2}|21\d{2})(?:\D|$)/);
                var type=/\bfilms\b/.test(cls)?'film':(/\bseries\b/.test(cls)?'series':(/\bcartoons\b/.test(cls)?'cartoon':(/\banime\b/.test(cls)?'anime':'other')));
                var img=n.querySelector('img');
                items.push({url:u,title:(info?info.textContent:a.textContent||'Без названия').replace(/\s+/g,' ').trim(),year:m?Number(m[1]):null,type:type,poster:img?(img.getAttribute('data-src')||img.getAttribute('src')||''):'',addedAt:new Date().toISOString()});
              });
              function pageNo(href){try{var u=new URL(href,location.origin),m=u.pathname.match(/\/page\/(\d+)\/?$/),q=u.searchParams.get('page');return m?Number(m[1]):(q?Number(q):1);}catch(e){return 1;}}
              var current=pageNo(location.href),next='',last='',max=1;
              d.querySelectorAll('a[href]').forEach(function(a){
                var href=new URL(a.getAttribute('href'),location.origin).href,u=new URL(href),n=pageNo(href);
                if(u.origin!==location.origin||!/^\/favorites\/\d+(?:\/page\/\d+)?\/?$/.test(u.pathname))return;
                if(n>max)max=n;
                var marker=((a.getAttribute('rel')||'')+' '+a.className+' '+(a.getAttribute('title')||'')+' '+(a.getAttribute('aria-label')||'')+' '+((a.parentElement&&a.parentElement.className)||'')+' '+a.textContent).toLowerCase();
                if(/\bnext\b|следующ|далее/.test(marker))next=href;
                if(/\blast\b|послед|посл\.?$/.test(marker)){last=href;if(n>max)max=n;}
              });
              var node=d.querySelector('.b-navigation__next, .b-navigation__last');
              if(node){var anchor=node.closest('a')||(node.parentElement&&node.parentElement.closest('a'));if(anchor){var marker=(node.className+' '+anchor.className+' '+anchor.textContent).toLowerCase(),href=new URL(anchor.getAttribute('href'),location.origin).href;if(/\blast\b|послед|посл/.test(marker))last=href;else next=href;}}
              if(last)max=Math.max(max,pageNo(last));
              return {items:items,current:current,max:max,next:next,last:last};
            }
            function findRandom(html){
              var d=new DOMParser().parseFromString(html,'text/html'),id='';
              d.querySelectorAll('a.b-favorites_content__cats_list_link').forEach(function(a){
                var name=(a.querySelector('.name')||a).textContent.trim().toUpperCase(),m=(a.getAttribute('href')||'').match(/\/favorites\/(\d+)/);
                if(name==='RANDOM'&&m)id=m[1];
              });
              return id;
            }
            try{
              progress('Проверяю вход и папку RANDOM',0,0);
              var home=await getText(new URL('/favorites/',location.origin).href);
              if(challenge(home))throw new Error('HDRezka показала проверку защиты. Пройди её вручную.');
              if(!/b-favorites_content__cats_list_link/.test(home)&&/(?:name=["'](?:login|email)|Войти в аккаунт|Вход в аккаунт)/i.test(home))throw new Error('Не вижу авторизованные закладки. Войди в HDRezka в этой вкладке.');
              var cat=findRandom(home);
              if(!cat){
                if(!movies.length)return {ok:true,noFolder:true,items:[],added:0,skipped:0,failed:[],pages:0};
                progress('Создаю папку RANDOM',0,0);
                var created=await apiPost({action:'add_cat',name:'RANDOM'});
                cat=String(created.id||(created.data&&created.data.id)||'');
                if(!cat)cat=findRandom(await getText(new URL('/favorites/',location.origin).href));
                if(!cat)throw new Error('Не удалось создать или найти папку RANDOM.');
              }
              var base=new URL('/favorites/'+cat+'/',location.origin).href;
              var html=await getText(base),data=parsePage(html),itemsMap=new Map(),ids=new Set(),urls=new Set();
              data.items.forEach(function(x){itemsMap.set(x.url,x);var id=postId(x.url);if(id)ids.add(id);urls.add(x.url);});
              var next=data.next,lastPage=data.last?(function(){try{return Number((new URL(data.last)).pathname.match(/\/page\/(\d+)/)?.[1]||1);}catch(e){return 1;}})():0,pages=1;visited[base]=1;
              progress('Импортирую папку RANDOM',pages,lastPage||data.max);
              while((next||lastPage>pages)&&pages<500){
                var target=new URL(next || ('/favorites/'+cat+'/page/'+(pages+1)+'/'),location.origin);
                if(target.origin!==location.origin||visited[target.href])break;
                visited[target.href]=1;html=await getText(target.href);data=parsePage(html);pages++;
                data.items.forEach(function(x){itemsMap.set(x.url,x);var id=postId(x.url);if(id)ids.add(id);urls.add(x.url);});
                next=data.next;
                if(data.last){try{lastPage=Number((new URL(data.last)).pathname.match(/\/page\/(\d+)/)?.[1]||lastPage);}catch(e){}}
                progress('Импортирую папку RANDOM',pages,lastPage||Math.max(pages,data.max));
              }
              if((next||lastPage>pages)&&pages>=500)throw new Error('В папке RANDOM более 500 страниц. Остановил импорт, чтобы не выполнять длинную серию запросов.');
              var imported=Array.from(itemsMap.values()),added=0,skipped=0,failed=[];
              progress('Добавляю отсутствующие карточки',0,movies.length);
              for(var i=0;i<movies.length;i++){
                var movie=movies[i],id=postId(movie.url||'');progress('Добавляю отсутствующие карточки',i+1,movies.length);
                if(!id){failed.push((movie.title||movie.url||'карточка')+': не удалось определить ID');continue;}
                if(ids.has(id)){skipped++;continue;}
                try{await apiPost({action:'add_post',post_id:id,cat_id:cat});ids.add(id);urls.add(movie.url);added++;}
                catch(e){if(/проверку защиты|ограничила запросы/i.test(e.message||''))throw e;failed.push((movie.title||id)+': '+(e.message||'ошибка API'));}
              }
              return {ok:true,noFolder:false,items:imported,added:added,skipped:skipped,failed:failed,pages:pages};
            }catch(e){return {ok:false,error:String(e.message||e)}}
          }
        }).then(function(results) {
          var result=results && results[0] && results[0].result;
          if(!result || !result.ok) throw new Error(result && result.error || 'HDRezka не вернула результат синхронизации.');
          var imported=result.items||[];
          return Promise.all([addMovies(imported),mergeUsed(imported.map(function(m){return m.url;}))]).then(function(values){
            var count=(values[0]&&values[0].added||[]).length;
            var msg=result.noFolder?'Папка RANDOM не найдена; локальная база пуста.':'Импортировано в базу '+count+' новых карточек; в папку RANDOM добавлено '+result.added+', уже было '+result.skipped+'; прочитано страниц: '+result.pages+'.';
            if(result.failed&&result.failed.length)msg+=' Ошибки: '+result.failed.slice(0,3).join(' | ');
            status.textContent=msg;renderDb();
          });
        });
      });
    }).catch(function(e) { status.textContent='Синхронизация не выполнена: '+(e.message||'ошибка'); })
      .finally(function(){hdrezkaSyncBusy=false;button.disabled=false;});
  }

  function setupSettingsUi() {
    $('#domainInput').value = BASE_ORIGIN;
    $('#pageCountOverride').value = String(pageCountOverride);
    $('#settingsStatus').textContent = 'Текущий домен: ' + BASE_ORIGIN;
    $('#settingsSave').addEventListener('click', function () {
      try { saveSettings().catch(function(e){ $('#settingsStatus').textContent = e.message || 'Ошибка сохранения.'; }); } catch (e) { $('#settingsStatus').textContent = e.message; }
    });
    $('#settingsReset').addEventListener('click', function () {
      $('#domainInput').value = DEFAULT_ORIGIN;
      $('#pageCountOverride').value = '0';
    });
    $('#settingsClose').addEventListener('click', function () { $('#settingsPanel').classList.remove('active'); });
    $('#settingsExportJson').addEventListener('click', exportJson);
    $('#settingsImportFile').addEventListener('change', function () { importFile(this.files && this.files[0]); });
    $('#githubSyncNow').addEventListener('click', githubSync);
    $('#hdrezkaSyncNow').addEventListener('click', hdrezkaSync);
    $('#settingsButton').addEventListener('click', function () { $('#domainInput').value = BASE_ORIGIN; $('#settingsPanel').classList.add('active'); loadSyncSettings(); });
  }

  function setupYears() {
    var sel = $('#yearSelect'); sel.innerHTML = '';
    var now = new Date().getFullYear();
    for (var y = now + 1; y >= 1900; y--) {
      var o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o);
    }
    sel.value = '1984'; currentYear = 1984;
  }

  function diagnostics() {
    queryTabs({ active: true, currentWindow: true }).then(function (tabs) {
      var tab = tabs[0];
      if (!tab || !tab.url || tab.url.indexOf(new URL(BASE_ORIGIN).host) === -1) { message('Откройте страницу выбранного домена и нажмите «Диагностика».'); return; }
      parsePageViaTab(tab.url, 30000).then(function (r) {
        if (!r) { message('Контент-скрипт не ответил. Обновите страницу.'); return; }
        var cards = (r.cards || []).length, pages = r.pagination && r.pagination.max || 1;
        var c = r.counts || {};
        message('Диагностика: ' + cards + ' карточек, пагинация ' + pages + '.', true);
        alert('Диагностика Rezkery\n\nURL: ' + r.url + '\nКарточек: ' + cards + '\n\nФильмы: ' + (c.film || 0) + '\nСериалы: ' + (c.series || 0) + '\nМультфильмы: ' + (c.cartoon || 0) + '\nАниме: ' + (c.anime || 0) + '\nДругое: ' + (c.other || 0) + '\n\nПагинация: ' + pages + '\nТип страницы: ' + r.kind + (r.year ? '\nГод: ' + r.year : ''));
      }).catch(function (e) { message(e.message || 'Ошибка диагностики.'); });
    });
  }

  $$('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.classList.remove('active'); });
      $$('.panel').forEach(function (x) { x.classList.remove('active'); });
      btn.classList.add('active'); $('#tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'database') renderDb();
    });
  });

  $$('.batch').forEach(function (b) { b.addEventListener('click', function () { runRandom('catalog', null, Number(b.dataset.size), $('#catalogType').value); }); });
  $('#customRandom').addEventListener('click', function () { runRandom('catalog', null, Number($('#customSize').value), $('#catalogType').value); });
  $('#detectCatalog').addEventListener('click', function () {
    if (busy) return; var filter = $('#catalogType').value; setBusy(true); detectCatalogPages(filter).then(function () { message('Найдено для «' + filterLabel(filter) + '»: ' + currentCatalogPages[filter] + ' страниц. Рандом использует ' + (pageCountOverride || currentCatalogPages[filter]) + '.'); }).catch(function (e) { message(e.message || 'Не удалось определить.'); }).finally(function () { setBusy(false); });
  });

  $$('.yearBatch').forEach(function (b) { b.addEventListener('click', function () { runRandom('year', Number($('#yearSelect').value), Number(b.dataset.size), $('#yearType').value); }); });
  $('#yearCustomRandom').addEventListener('click', function () { runRandom('year', Number($('#yearSelect').value), Number($('#yearCustomSize').value), $('#yearType').value); });
  $('#refreshYear').addEventListener('click', function () {
    if (busy) return; var y = Number($('#yearSelect').value), f = $('#yearType').value; setBusy(true); detectYearPages(y, f, true).then(function () { message('Для ' + y + ' · ' + filterLabel(f) + ': ' + currentYearPages[String(y) + ':' + f] + ' страниц.'); }).catch(function (e) { message(e.message || 'Ошибка.'); }).finally(function () { setBusy(false); });
  });
  $('#yearSelect').addEventListener('change', function () { currentYear = Number(this.value); currentYearFilter = $('#yearType').value; $('#yearPages').textContent = 'не определено'; });
  $('#catalogType').addEventListener('change', function () { $('#catalogPages').textContent = currentCatalogPages[this.value] ? String(currentCatalogPages[this.value]) : 'не определено'; });
  $('#yearType').addEventListener('change', function () { currentYearFilter = this.value; var key = String(Number($('#yearSelect').value)) + ':' + this.value; $('#yearPages').textContent = currentYearPages[key] ? String(currentYearPages[key]) : 'не определено'; });

  $('#randomFromDb').addEventListener('click', function () {
    loadDb().then(function (db) {
      var filter = $('#dbTypeFilter').value;
      var choices = db.filter(function (m) { return typeMatches(m, filter); });
      if (!choices.length) { message('В базе нет подходящих карточек.'); return; }
      createTab(choices[randomInt(choices.length)].url, true);
    });
  });
  $('#dbTypeFilter').addEventListener('change', renderDb);

  $('#exportJson').addEventListener('click', exportJson);
  $('#exportHtml').addEventListener('click', exportHtml);
  $('#importFile').addEventListener('change', function () { importFile(this.files && this.files[0]); });
  $('#clearDb').addEventListener('click', function () {
    loadDb().then(function (db) {
      if (!db.length) return;
      if (confirm('Удалить все ' + db.length + ' карточек?')) return Promise.all([saveDb([]),saveUsed([])]).then(renderDb).then(function () { message('База очищена.'); });
    });
  });
  $('#searchInput').addEventListener('input', renderDb);
  $('#dbTable').addEventListener('click', function (e) {
    var b = e.target.closest('.delete-one'); if (!b) return;
    loadDb().then(function (db) { var db2 = db.filter(function (m) { return normalizeUrl(m.url) !== normalizeUrl(b.dataset.url); }); return saveDb(db2).then(renderDb); });
  });
  $('#diagnostics').addEventListener('click', diagnostics);

  loadSettings().then(function () { setupSettingsUi(); setupYears(); renderDb(); });
})();
