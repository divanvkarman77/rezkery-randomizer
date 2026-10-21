(function () {
  'use strict';

  var API = (typeof browser !== 'undefined') ? browser : chrome;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function absUrl(value) {
    try {
      if (!value) return '';
      return new URL(value, location.href).href;
    } catch (e) {
      return '';
    }
  }

  function pathOf(url) {
    try { return new URL(url).pathname; } catch (e) { return ''; }
  }

  function sameSite(url) {
    try {
      var u = new URL(url, location.href);
      return u.hostname === location.hostname;
    } catch (e) {
      return false;
    }
  }

  function posterFrom(card, anchor) {
    var img = card && card.querySelector ? card.querySelector('img') : null;
    if (!img && anchor) img = anchor.querySelector('img');
    if (!img) return '';
    return absUrl(
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('src') ||
      img.currentSrc || ''
    );
  }

  function titleFromCard(card, fallbackAnchor) {
    var titleLink = card && card.querySelector ? card.querySelector('.b-content__inline_item-link > a[href]') : null;
    var img = card && card.querySelector ? card.querySelector('img') : null;
    var candidates = [
      titleLink && titleLink.textContent,
      titleLink && titleLink.getAttribute('title'),
      card && card.getAttribute && card.getAttribute('data-title'),
      fallbackAnchor && fallbackAnchor.getAttribute('data-title'),
      img && img.getAttribute('alt')
    ];
    for (var i = 0; i < candidates.length; i++) {
      var t = cleanText(candidates[i]);
      if (t && t.length >= 2 && t.length <= 180) {
        t = t.replace(/^(?:смотреть|фильм|сериал)\s+/i, '');
        t = t.replace(/\s+онлайн(?:\s+в\s+HD.*)?$/i, '').trim();
        if (t.length >= 2) return t;
      }
    }
    var href = fallbackAnchor && fallbackAnchor.href ? fallbackAnchor.href : (card && card.getAttribute ? card.getAttribute('data-url') : '');
    var path = pathOf(href).split('/').filter(Boolean).pop() || '';
    try { path = decodeURIComponent(path); } catch (e) {}
    path = path.replace(/\.html?$/i, '').replace(/^\d+-/, '').replace(/[-_]+/g, ' ').trim();
    return path || 'Без названия';
  }

  function yearFrom(text, url) {
    var m = String(text || '').match(/(?:^|[^0-9])(19[0-9]{2}|20[0-9]{2})(?![0-9])/);
    if (m) return Number(m[1]);
    m = String(url || '').match(/(?:^|\D)(19[0-9]{2}|20[0-9]{2})(?:\D|$)/);
    return m ? Number(m[1]) : null;
  }

  function isExcludedPath(pathname) {
    var p = pathname.replace(/\/+$/, '') || '/';
    if (/^\/page\/\d+$/i.test(p)) return true;
    if (/^\/year\/\d{4}(?:\/page\/\d+)?$/i.test(p)) return true;
    if (/^\/(?:search|login|register|user|favorites|page|year|genre|category|tag|serialy?|multfilmy?|anime|top|rating|collections?)(?:\/|$)/i.test(p)) return true;
    return false;
  }

  function isLikelyMovieUrl(url) {
    if (!sameSite(url)) return false;
    var path = pathOf(url);
    if (!path || isExcludedPath(path)) return false;
    if (/\.html?$/i.test(path)) return true;
    var tail = path.split('/').filter(Boolean).pop() || '';
    if (/^\d+-[^/]+$/i.test(tail)) return true;
    if (/\d{4}.*(?:-|_)/.test(tail)) return true;
    return false;
  }

  // When the page itself is filtered by genre, trust that filter first.
  // This is especially important for anime pages where the card URL/theme marker can vary.
  function forcedTypeFromPage() {
    try {
      var params = new URL(location.href).searchParams;
      var genre = params.get('genre');
      if (genre === '1') return 'film';
      if (genre === '2') return 'series';
      if (genre === '3') return 'cartoon';
      if (genre === '82') return 'anime';
    } catch (e) {}
    return '';
  }

  // Rezkery marks the card type on the cover as .cat.films / .cat.series /
  // .cat.cartoons / .cat.anime. URL paths are used as a second fallback.
  function contentTypeFromCard(card, href, context, forcedType) {
    if (forcedType) return forcedType;
    var marker = card && card.querySelector ? card.querySelector('.b-content__inline_item-cover .cat, .cat') : null;
    var cls = marker ? String(marker.className || '').toLowerCase() : '';
    if (/\bfilms\b/.test(cls) || /\/films\//i.test(href)) return 'film';
    if (/\bseries\b/.test(cls) || /\/series\//i.test(href) || /\/serial/i.test(href)) return 'series';
    if (/\bcartoons\b/.test(cls) || /\/cartoons?\//i.test(href) || /\/multfil/i.test(href)) return 'cartoon';
    if (/\banime\b/.test(cls) || /\/anime\//i.test(href)) return 'anime';

    var txt = String(context || '').toLowerCase();
    if (/(?:^|\s)аниме(?:\s|$)/i.test(txt)) return 'anime';
    if (/(?:^|\s)(?:сериал|сериалы)(?:\s|$)/i.test(txt)) return 'series';
    if (/(?:^|\s)(?:мультфильм|мультфильмы|мультсериал)(?:\s|$)/i.test(txt)) return 'cartoon';
    if (/(?:^|\s)фильм(?:\s|$)/i.test(txt)) return 'film';
    return 'other';
  }

  function typeLabel(type) {
    if (type === 'film') return 'Фильм';
    if (type === 'series') return 'Сериал';
    if (type === 'cartoon') return 'Мультфильм';
    if (type === 'anime') return 'Аниме';
    return 'Другое';
  }

  function chooseRoot() {
    var direct = document.querySelectorAll('.b-content__inline_item');
    if (direct && direct.length) {
      var root = direct[0].parentElement;
      return root || document.body;
    }
    var candidates = [];
    var selectors = ['main', '[role="main"]', '#content', '#main', '.content', '.main', '.main-content', '.content-area'];
    for (var i = 0; i < selectors.length; i++) {
      try {
        var nodes = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < nodes.length; j++) candidates.push(nodes[j]);
      } catch (e) {}
    }
    candidates.push(document.body);
    var best = document.body;
    var bestScore = -1;
    for (var k = 0; k < candidates.length; k++) {
      var root2 = candidates[k];
      if (!root2 || root2.getAttribute && root2.getAttribute('data-rz-skip')) continue;
      var links = root2.querySelectorAll ? root2.querySelectorAll('a[href]') : [];
      var likely = 0;
      for (var q = 0; q < links.length; q++) {
        if (isLikelyMovieUrl(absUrl(links[q].getAttribute('href')))) likely++;
      }
      var score = likely;
      if (likely >= 15 && likely <= 60) score += 25;
      if (root2 === document.body) score -= 2;
      if (score > bestScore) { bestScore = score; best = root2; }
    }
    return best || document.body;
  }

  function extractCards() {
    var forcedType = forcedTypeFromPage();
    var directCards = document.querySelectorAll('.b-content__inline_item');
    var cards = [];
    if (directCards && directCards.length) {
      for (var i = 0; i < directCards.length; i++) {
        var card = directCards[i];
        var anchor = card.querySelector('.b-content__inline_item-link > a[href]') || card.querySelector('a[href]');
        var href = anchor ? absUrl(anchor.getAttribute('href')) : absUrl(card.getAttribute('data-url'));
        if (!isLikelyMovieUrl(href)) continue;
        href = href.split('#')[0];
        var info = card.querySelector('.b-content__inline_item-link');
        var context = cleanText(info ? info.textContent : card.textContent);
        var type = contentTypeFromCard(card, href, context, forcedType);
        cards.push({
          url: href,
          title: titleFromCard(card, anchor),
          year: yearFrom(context, href),
          poster: posterFrom(card, anchor),
          type: type,
          typeLabel: typeLabel(type),
          sourcePage: location.href,
          sourcePageTitle: document.title,
          index: cards.length
        });
      }
      return cards;
    }

    // Fallback for unexpected theme changes without the known card wrapper.
    var root = chooseRoot();
    var anchors = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    var seen = Object.create(null);
    for (var j = 0; j < anchors.length; j++) {
      var a = anchors[j];
      var u = absUrl(a.getAttribute('href'));
      if (!isLikelyMovieUrl(u)) continue;
      u = u.split('#')[0];
      if (seen[u]) continue;
      seen[u] = true;
      var parent = a.closest ? a.closest('.b-content__inline_item') : a.parentElement;
      var context2 = cleanText((parent || a.parentElement || document.body).textContent);
      var type2 = contentTypeFromCard(parent || a.parentElement, u, context2, forcedType);
      cards.push({
        url: u,
        title: titleFromCard(parent || a.parentElement || document.body, a),
        year: yearFrom(context2, u),
        poster: posterFrom(parent || a.parentElement || document.body, a),
        type: type2,
        typeLabel: typeLabel(type2),
        sourcePage: location.href,
        sourcePageTitle: document.title,
        index: cards.length
      });
    }
    return cards;
  }

  function queryValue(url, key) {
    try { return new URL(url).searchParams.get(key) || ''; } catch (e) { return ''; }
  }

  function extractPagination(kind, year) {
    var currentGenre = queryValue(location.href, 'genre');
    var currentFilter = queryValue(location.href, 'filter');

    function pageBase(url) {
      try {
        return new URL(url, location.href).pathname
          .replace(/\/page\/\d+\/?$/i, '')
          .replace(/\/+$/, '') || '/';
      } catch (e) { return ''; }
    }

    function pageNumber(url) {
      try {
        var u = new URL(url, location.href);
        var m = u.pathname.match(/\/page\/(\d+)\/?$/i);
        if (m) return Number(m[1]);
        var q = Number(u.searchParams.get('page')) || 0;
        return q > 0 ? q : 0;
      } catch (e) { return 0; }
    }

    function inScope(url, base) {
      if (!url || !sameSite(url)) return false;
      var u;
      try { u = new URL(url, location.href); } catch (e) { return false; }
      if (pageBase(u.href) !== base) return false;
      var genre = u.searchParams.get('genre') || '';
      var filter = u.searchParams.get('filter') || '';
      return (!genre || !currentGenre || genre === currentGenre) &&
        (!filter || !currentFilter || filter === currentFilter);
    }

    var current = pageNumber(location.href) || 1;
    var base = pageBase(location.href);
    var max = current;
    var pages = [current];
    var nextUrl = '';
    var lastUrl = '';
    var containers = document.querySelectorAll('.b-navigation, .pagination, .pagenavi, .navigation');
    var roots = containers.length ? Array.prototype.slice.call(containers) : [document];
    var seen = Object.create(null);

    function markerOf(a) {
      return ((a.className || '') + ' ' + (a.getAttribute('rel') || '') + ' ' +
        (a.getAttribute('title') || '') + ' ' + (a.getAttribute('aria-label') || '') + ' ' +
        ((a.parentElement && a.parentElement.className) || '') + ' ' +
        cleanText(a.textContent)).toLowerCase();
    }

    roots.forEach(function (root) {
      var links = root.querySelectorAll('a[href]');
      var localPages = [];
      var localMaxAnchor = null;
      var localMax = current;
      var explicitLast = null;

      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var href = absUrl(a.getAttribute('href'));
        if (!inScope(href, base)) continue;
        var n = pageNumber(href);
        if (!n) {
          var label = cleanText(a.textContent);
          if (/^\d+$/.test(label)) n = Number(label);
        }
        var marker = markerOf(a);
        if (/rel=.?next|\bnext\b|следующ|далее/.test(marker)) nextUrl = href || nextUrl;
        if (/rel=.?last|\blast\b|послед|посл\.?$/.test(marker)) explicitLast = href || explicitLast;
        if (n > 0) {
          localPages.push(n);
          pages.push(n);
          if (n > localMax) { localMax = n; localMaxAnchor = a; }
          if (n > max) max = n;
        }
      }

      if (explicitLast) {
        lastUrl = explicitLast;
        max = Math.max(max, pageNumber(explicitLast));
        return;
      }

      var ellipsis = root.querySelector('.nav_ext, .ellipsis, .pagination-ellipsis');
      var lastFollowsEllipsis = !!(ellipsis && localMaxAnchor &&
        (ellipsis.compareDocumentPosition(localMaxAnchor) & 4));
      var unique = Object.create(null);
      localPages.forEach(function (n) { unique[n] = 1; });
      var contiguous = true;
      for (var n = 1; n <= localMax; n++) {
        if (!unique[n] && n !== current) { contiguous = false; break; }
      }
      if (localMaxAnchor && (lastFollowsEllipsis || contiguous)) {
        lastUrl = absUrl(localMaxAnchor.getAttribute('href'));
        max = Math.max(max, localMax);
      }
    });

    if (!nextUrl) {
      var next = document.querySelector('.b-navigation__next');
      var nextAnchor = next && (next.closest('a') || (next.parentElement && next.parentElement.closest('a')));
      if (nextAnchor) {
        var candidateNext = absUrl(nextAnchor.getAttribute('href'));
        if (inScope(candidateNext, base)) nextUrl = candidateNext;
      }
    }
    if (!lastUrl) {
      var last = document.querySelector('.b-navigation__last');
      var lastAnchor = last && (last.closest('a') || (last.parentElement && last.parentElement.closest('a')));
      if (lastAnchor) {
        var candidateLast = absUrl(lastAnchor.getAttribute('href'));
        if (inScope(candidateLast, base)) {
          lastUrl = candidateLast;
          max = Math.max(max, pageNumber(candidateLast));
        }
      }
    }

    pages = Array.from(new Set(pages)).sort(function (a, b) { return a - b; });
    return {
      max: max,
      next: nextUrl,
      last: lastUrl,
      exact: !!lastUrl || (max === 1 && current === 1 && containers.length === 0 && !nextUrl),
      pages: pages,
      current: current,
      genre: currentGenre,
      filter: currentFilter
    };
  }

  function parsePage() {
    var path = location.pathname;
    var yearPath = path.replace(/\/page\/\d+\/?$/, '').replace(/\/+$/, '');
    var yearMatch = yearPath.match(/(?:^|\/)(19\d{2}|20\d{2})$/);
    var kind = yearMatch ? 'year' : 'catalog';
    var year = yearMatch ? Number(yearMatch[1]) : null;
    var cards = extractCards();
    var pagination = extractPagination(kind, year);
    var counts = { all: cards.length, film: 0, series: 0, cartoon: 0, anime: 0, other: 0 };
    cards.forEach(function (m) { if (counts[m.type] === undefined) counts.other++; else counts[m.type]++; });
    return {
      ok: true,
      url: location.href,
      title: document.title,
      kind: kind,
      year: year,
      cards: cards,
      counts: counts,
      pagination: pagination,
      forcedType: forcedTypeFromPage(),
      parsedAt: new Date().toISOString()
    };
  }

  function send(result) {
    try {
      var p = API.runtime.sendMessage({ type: 'REZKERY_PAGE_PARSED', result: result });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  function ready() {
    // Give lazy image/card scripts a moment to finish rendering.
    setTimeout(function () { send(parsePage()); }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  API.runtime.onMessage.addListener(function (message) {
    if (message && message.type === 'REZKERY_PARSE_NOW') return parsePage();
    if (message && message.type === 'REZKERY_SCROLL_AND_PARSE') {
      try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
      setTimeout(function () { send(parsePage()); }, 100);
    }
  });
})();
