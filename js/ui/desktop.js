/* =========================================================
   Desktop window manager
   - Every element with class="window" and data-app="name" becomes a window.
   - Windows can be moved, resized, minimized to the taskbar,
     maximized and closed. Layout is remembered between visits.
   - To add a new app later: copy the #win-help block in index.html,
     give it a new data-app name, and add a desktop icon with data-open="name".
   ========================================================= */
var Desktop = (function () {
  'use strict';

  var LAYOUT_KEY = 'checkbook.layout.v1';
  var desktop, taskButtons;
  var wins = {};        // name -> { el, state, max, rect, btn }
  var zTop = 10;
  var activeName = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function deskSize() { return { w: desktop.clientWidth, h: desktop.clientHeight }; }
  function isSmallScreen() { return window.innerWidth < 700; }

  /* ---------- layout save / load ---------- */
  function loadLayout() {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveLayout() {
    var out = {};
    Object.keys(wins).forEach(function (n) {
      var w = wins[n];
      out[n] = { state: w.state, max: w.max, rect: w.rect };
    });
    out._active = activeName;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
  }

  function defaultRect(name, i) {
    var d = deskSize();
    if (name === 'checkbook') {
      var w = Math.min(1280, d.w - 120), h = Math.min(820, d.h - 30);
      return { x: Math.max(100, Math.round((d.w - w) / 2) + 40), y: 12, w: w, h: h };
    }
    return { x: 140 + i * 30, y: 60 + i * 30, w: Math.min(560, d.w - 40), h: Math.min(520, d.h - 80) };
  }

  /* ---------- geometry ---------- */
  function applyRect(w) {
    var r = w.rect;
    w.el.style.left = r.x + 'px';
    w.el.style.top = r.y + 'px';
    w.el.style.width = r.w + 'px';
    w.el.style.height = r.h + 'px';
  }
  // keep a window on screen (title bar always reachable)
  function clampRect(w) {
    var d = deskSize(), r = w.rect;
    r.w = Math.max(w.minW, Math.min(r.w, d.w));
    r.h = Math.max(w.minH, Math.min(r.h, d.h));
    r.x = Math.min(Math.max(r.x, 80 - r.w), d.w - 80);
    r.y = Math.min(Math.max(r.y, 0), d.h - 30);
  }

  /* ---------- window actions ---------- */
  function open(name) {
    var w = wins[name];
    if (!w) return;
    if (w.state === 'closed') {
      w.el.classList.remove('closed');
      if (isSmallScreen()) setMax(w, true);
    }
    w.state = 'open';
    w.el.classList.remove('minimized');
    ensureTaskButton(name);
    focus(name);
    saveLayout();
  }

  function close(name) {
    var w = wins[name];
    if (!w) return;
    w.state = 'closed';
    w.el.classList.add('closed');
    w.el.classList.remove('minimized');
    if (w.btn) { w.btn.remove(); w.btn = null; }
    if (activeName === name) activateTopmost();
    saveLayout();
  }

  function minimize(name) {
    var w = wins[name];
    if (!w || w.state === 'closed') return;
    w.state = 'min';
    w.el.classList.add('minimized');
    ensureTaskButton(name);
    if (activeName === name) activateTopmost();
    refreshTaskButtons();
    saveLayout();
  }

  function setMax(w, on) {
    w.max = on;
    w.el.classList.toggle('maximized', on);
    var b = $('.cap-max', w.el);
    if (b) { b.innerHTML = on ? '&#10064;' : '&#9633;'; b.title = on ? 'Restore Down' : 'Maximize'; }
  }
  function toggleMax(name) {
    var w = wins[name];
    setMax(w, !w.max);
    focus(name);
    saveLayout();
  }

  function focus(name) {
    var w = wins[name];
    if (!w || w.state !== 'open') return;
    if (activeName !== name || w.el.style.zIndex < zTop) w.el.style.zIndex = ++zTop;
    activeName = name;
    Object.keys(wins).forEach(function (n) { wins[n].el.classList.toggle('active', n === name); });
    refreshTaskButtons();
  }

  function activateTopmost() {
    var best = null, bestZ = -1;
    Object.keys(wins).forEach(function (n) {
      var w = wins[n];
      var z = parseInt(w.el.style.zIndex || 0, 10);
      if (w.state === 'open' && z > bestZ) { best = n; bestZ = z; }
    });
    activeName = null;
    Object.keys(wins).forEach(function (n) { wins[n].el.classList.remove('active'); });
    if (best) focus(best); else refreshTaskButtons();
  }

  function showDesktop() {
    var anyOpen = Object.keys(wins).some(function (n) { return wins[n].state === 'open'; });
    Object.keys(wins).forEach(function (n) {
      if (anyOpen) { if (wins[n].state === 'open') minimize(n); }
      else if (wins[n].state === 'min') open(n);
    });
  }

  function resetLayout() {
    var i = 0;
    Object.keys(wins).forEach(function (n) {
      var w = wins[n];
      w.rect = defaultRect(n, i++);
      clampRect(w);
      applyRect(w);
      setMax(w, isSmallScreen());
    });
    open('checkbook');
    saveLayout();
  }

  /* ---------- taskbar ---------- */
  function ensureTaskButton(name) {
    var w = wins[name];
    if (w.btn) return;
    var b = document.createElement('button');
    b.className = 'task-btn';
    b.title = w.title;
    b.innerHTML = '<img src="' + w.icon + '" alt=""><span></span>';
    $('span', b).textContent = w.title;
    b.addEventListener('click', function () {
      if (w.state === 'open' && activeName === name) minimize(name);
      else open(name);
    });
    taskButtons.appendChild(b);
    w.btn = b;
  }
  function refreshTaskButtons() {
    Object.keys(wins).forEach(function (n) {
      var w = wins[n];
      if (!w.btn) return;
      w.btn.classList.toggle('active', n === activeName && w.state === 'open');
      w.btn.classList.toggle('is-min', w.state === 'min');
    });
  }

  /* ---------- drag & resize (pointer events work for mouse and touch) ---------- */
  function startDrag(w, e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.caption-buttons')) return;
    var startX = e.clientX, startY = e.clientY;
    var moved = false;
    var orig;

    function onMove(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        moved = true;
        w.el.classList.add('dragging');
        if (w.max) {
          // like Windows: dragging a maximized window restores it under the cursor
          var ratio = startX / deskSize().w;
          setMax(w, false);
          w.rect.x = Math.round(startX - w.rect.w * ratio);
          w.rect.y = 0;
          applyRect(w);
        }
        orig = { x: w.rect.x, y: w.rect.y };
      }
      w.rect.x = orig.x + dx;
      w.rect.y = orig.y + dy;
      clampRect(w);
      applyRect(w);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      w.el.classList.remove('dragging');
      if (moved) saveLayout();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function startResize(w, dir, e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    var sx = e.clientX, sy = e.clientY;
    var o = { x: w.rect.x, y: w.rect.y, w: w.rect.w, h: w.rect.h };
    var d = deskSize();
    w.el.classList.add('resizing');

    function onMove(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      var r = { x: o.x, y: o.y, w: o.w, h: o.h };
      if (dir.indexOf('e') !== -1) r.w = Math.max(w.minW, Math.min(o.w + dx, d.w - o.x));
      if (dir.indexOf('s') !== -1) r.h = Math.max(w.minH, Math.min(o.h + dy, d.h - o.y));
      if (dir.indexOf('w') !== -1) {
        r.w = Math.max(w.minW, o.w - dx);
        r.x = o.x + (o.w - r.w);
      }
      if (dir.indexOf('n') !== -1) {
        var nh = Math.max(w.minH, o.h - dy);
        var ny = o.y + (o.h - nh);
        if (ny < 0) { nh += ny; ny = 0; }
        r.h = nh; r.y = ny;
      }
      w.rect = r;
      applyRect(w);
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      w.el.classList.remove('resizing');
      saveLayout();
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  /* ---------- setup ---------- */
  function setupWindow(el, i, saved) {
    var name = el.dataset.app;
    var w = {
      name: name, el: el,
      title: el.dataset.title || name,
      icon: el.dataset.icon || '',
      minW: parseInt(el.dataset.minw || '320', 10),
      minH: parseInt(el.dataset.minh || '220', 10),
      state: 'closed', max: false, rect: null, btn: null
    };
    wins[name] = w;

    var s = saved[name];
    w.rect = (s && s.rect) ? s.rect : defaultRect(name, i);
    clampRect(w);
    applyRect(w);

    // resize handles
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (dir) {
      var h = document.createElement('div');
      h.className = 'resize-handle rh-' + dir;
      h.addEventListener('pointerdown', function (e) { if (!w.max) startResize(w, dir, e); });
      el.appendChild(h);
    });

    var bar = $('.titlebar', el);
    bar.addEventListener('pointerdown', function (e) { focus(name); startDrag(w, e); });
    bar.addEventListener('dblclick', function (e) { if (!e.target.closest('.caption-buttons')) toggleMax(name); });
    $('.cap-min', el).addEventListener('click', function (e) { e.stopPropagation(); minimize(name); });
    $('.cap-max', el).addEventListener('click', function (e) { e.stopPropagation(); toggleMax(name); });
    $('.cap-close', el).addEventListener('click', function (e) { e.stopPropagation(); close(name); });
    el.addEventListener('pointerdown', function () { focus(name); }, true);

    // restore saved state (first visit: only CheckBook is open)
    var state = s ? s.state : (name === 'checkbook' ? 'open' : 'closed');
    setMax(w, s ? !!s.max : isSmallScreen());
    el.style.zIndex = ++zTop;
    if (state === 'closed') { el.classList.add('closed'); }
    else {
      w.state = state;
      ensureTaskButton(name);
      if (state === 'min') el.classList.add('minimized');
    }
  }

  function setupIcons() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    $$('.dicon').forEach(function (icon) {
      icon.addEventListener('click', function () {
        $$('.dicon').forEach(function (x) { x.classList.toggle('selected', x === icon); });
        if (coarse) open(icon.dataset.open); // phones/tablets: single tap opens
      });
      icon.addEventListener('dblclick', function () { open(icon.dataset.open); });
      icon.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(icon.dataset.open); });
    });
    desktop.addEventListener('pointerdown', function (e) {
      if (e.target === desktop) $$('.dicon').forEach(function (x) { x.classList.remove('selected'); });
    });
  }

  function setupStartMenu() {
    var orb = $('#start-orb'), menu = $('#start-menu');
    orb.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('pointerdown', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== orb) menu.hidden = true;
    });
    $$('[data-open]', menu).forEach(function (b) {
      b.addEventListener('click', function () { menu.hidden = true; open(b.dataset.open); });
    });
    $$('[data-sm]', menu).forEach(function (b) {
      b.addEventListener('click', function () {
        menu.hidden = true;
        var a = b.dataset.sm;
        if (a === 'show-desktop') showDesktop();
        else if (a === 'reset-layout') resetLayout();
        else if (a === 'about' && window.CheckBook && CheckBook.about) CheckBook.about();
      });
    });
    $('#show-desktop').addEventListener('click', showDesktop);
  }

  function startClock() {
    function tick() {
      var d = new Date();
      $('#clock-time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      $('#clock-date').textContent = d.toLocaleDateString();
    }
    tick();
    setInterval(tick, 15000);
  }

  function init() {
    desktop = $('#desktop');
    taskButtons = $('#task-buttons');
    var saved = loadLayout();
    $$('.window[data-app]', desktop).forEach(function (el, i) { setupWindow(el, i, saved); });
    // bring the last active window to the front
    var first = saved._active && wins[saved._active] && wins[saved._active].state === 'open' ? saved._active : null;
    if (first) focus(first); else activateTopmost();
    setupIcons();
    setupStartMenu();
    startClock();
    window.addEventListener('resize', function () {
      Object.keys(wins).forEach(function (n) { clampRect(wins[n]); applyRect(wins[n]); });
    });
  }

  init();

  return { open: open, close: close, minimize: minimize, toggleMax: toggleMax, showDesktop: showDesktop, resetLayout: resetLayout };
})();
