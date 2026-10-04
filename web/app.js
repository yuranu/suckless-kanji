// Kanji stroke drawing minigame. Depends on window.Stroke (stroke.js); loads data/kanji.json.
fetch('data/kanji.json').then((r) => r.json()).then((data) => {
  'use strict';
  window.KANJI = data.map((k) => ({ ...k, jlpt: k.level, strokes: k.paths.length }));

  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const board = $('board');
  const layers = { ghost: $('ghost'), done: $('done'), hint: $('hint'), ink: $('ink') };

  // How many misses on one stroke before the hint animation plays, per mode.
  const HINT_AFTER = { trace: 2, guided: 1, recall: 3 };
  const MESSAGES = {
    backwards: 'Wrong direction',
    'wrong-stroke': 'Wrong stroke order',
    redrawn: 'Already drawn',
    miss: 'Try again',
  };

  // ---- persistence (best effort: the game works without it) ----------------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('sk.' + key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('sk.' + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };
  const stats = store.get('stats', {}); // char -> {runs, clean, misses, last}

  // ---- state -----------------------------------------------------------------
  let level = store.get('level', 5);
  let mode = store.get('mode', 'trace');
  let list = [];
  let pos = 0;
  let cur = null; // {k, refs, stroke, misses, totalMisses, finished}
  let timers = [];

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  const clear = (g) => { while (g.firstChild) g.removeChild(g.firstChild); };

  // ---- level / kanji selection ----------------------------------------------
  // `at`: kanji to open; defaults to where the level was left off.
  function setLevel(n, at) {
    level = n;
    store.set('level', n);
    $('level').value = String(n);
    list = window.KANJI.filter((k) => k.jlpt === n);
    pos = at ? list.indexOf(at) : store.get('pos' + n, 0) % list.length;
    store.set('pos' + n, pos);
    load();
  }

  function setMode(m) {
    mode = m;
    store.set('mode', m);
    for (const b of $('mode').children) b.classList.toggle('on', b.dataset.mode === m);
    if (cur) load();
  }

  function go(delta) {
    pos = (pos + delta + list.length) % list.length;
    store.set('pos' + level, pos);
    load();
  }

  function jumpTo(ch) {
    const k = window.KANJI.find((x) => x.c === ch);
    if (!k) { say(`${ch} is not in the JLPT set`, 'bad'); return; }
    setLevel(k.jlpt, k);
  }

  // ---- rendering ---------------------------------------------------------------
  function load() {
    clearTimers();
    const k = list[pos];
    cur = { k, refs: k.paths.map(window.Stroke.prepare), stroke: 0, misses: 0, totalMisses: 0, finished: false };
    $('meaning').textContent = k.meanings.join(', ');
    $('on').textContent = k.on.length ? '音 ' + k.on.join('・') : '';
    $('kun').textContent = k.kun.length ? '訓 ' + k.kun.join('・') : '';
    // In recall mode the kanji is the answer, so keep it out of the input box.
    $('jump').value = '';
    $('jump').placeholder = mode === 'recall' ? '字' : k.c;
    clear(layers.done); clear(layers.hint); clear(layers.ink);
    layers.done.classList.remove('complete');
    renderGhost();
    renderStatus();
    say('');
  }

  function renderGhost() {
    clear(layers.ghost);
    if (mode !== 'trace' || cur.finished) return;
    cur.k.paths.forEach((d, i) => {
      if (i < cur.stroke) return;
      el('path', { d, class: i === cur.stroke ? 'next' : '' }, layers.ghost);
    });
    const p = cur.refs[cur.stroke].pts[0];
    el('circle', { cx: p[0], cy: p[1], r: 2 }, layers.ghost);
  }

  function renderStatus() {
    const k = cur.k;
    $('progress').textContent = `${pos + 1}/${list.length} · stroke ${Math.min(cur.stroke + 1, k.strokes)}/${k.strokes}`;
    const learned = list.filter((x) => stats[x.c] && stats[x.c].clean > 0).length;
    const s = stats[k.c];
    $('stats').textContent =
      `N${level}: ${learned}/${list.length} drawn without a miss` +
      (s ? ` · this kanji: ${s.runs} runs, ${s.clean} clean` : '');
  }

  function say(text, cls) {
    const m = $('msg');
    m.textContent = text;
    m.className = cls || '';
  }

  function flash(text, color) {
    const f = $('flash');
    f.textContent = text;
    f.style.color = color;
    f.classList.add('show');
    later(() => f.classList.remove('show'), 700);
  }

  // Animate stroke `i` being drawn into group `g`; resolves when finished.
  function animateStroke(g, i, ms) {
    return new Promise((resolve) => {
      const p = el('path', { d: cur.k.paths[i] }, g);
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect(); // force layout so the transition runs
      p.style.transition = `stroke-dashoffset ${ms}ms linear`;
      p.style.strokeDashoffset = 0;
      later(() => resolve(p), ms);
    });
  }

  function showHint() {
    clear(layers.hint);
    const i = cur.stroke;
    const s = cur.refs[i].pts[0];
    el('circle', { cx: s[0], cy: s[1], r: 2.2 }, layers.hint);
    animateStroke(layers.hint, i, 500).then((p) => {
      later(() => { p.style.transition = 'opacity 0.6s'; p.style.opacity = 0; }, 400);
      later(() => clear(layers.hint), 1100);
    });
  }

  async function replayAll() {
    if (!cur) return;
    load();
    clear(layers.ghost);
    cur.finished = true; // block input during the animation
    for (let i = 0; i < cur.k.strokes; i++) {
      await animateStroke(layers.done, i, 350);
      await new Promise((r) => later(r, 120));
    }
    later(load, 900);
  }

  // ---- drawing ----------------------------------------------------------------
  let drawing = null; // {pts, line, id}

  function toBoard(e) {
    const pt = board.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(board.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  board.addEventListener('pointerdown', (e) => {
    if (!cur || cur.finished || drawing) return;
    e.preventDefault();
    try { board.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
    const p = toBoard(e);
    drawing = { id: e.pointerId, pts: [p], line: el('polyline', { points: p.join(',') }, layers.ink) };
  });

  board.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = toBoard(ev);
      const last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.4) drawing.pts.push(p);
    }
    drawing.line.setAttribute('points', drawing.pts.map((p) => p.join(',')).join(' '));
  });

  const endStroke = (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const { pts, line } = drawing;
    drawing = null;
    judge(pts, line);
  };
  board.addEventListener('pointerup', endStroke);
  board.addEventListener('pointercancel', (e) => {
    if (drawing && e.pointerId === drawing.id) { drawing.line.remove(); drawing = null; }
  });

  function judge(pts, line) {
    const r = window.Stroke.match(pts, cur.refs, cur.stroke);
    if (r.reason === 'ok') {
      line.remove();
      el('path', { d: cur.k.paths[cur.stroke], class: 'fresh' }, layers.done);
      clear(layers.hint);
      cur.stroke++;
      cur.misses = 0;
      say('');
      if (cur.stroke === cur.k.strokes) finish();
      else { renderGhost(); renderStatus(); }
      return;
    }
    line.classList.add('bad');
    later(() => line.remove(), 450);
    cur.misses++;
    cur.totalMisses++;
    say(MESSAGES[r.reason], 'bad');
    if (cur.misses >= HINT_AFTER[mode]) showHint();
  }

  function finish() {
    cur.finished = true;
    clear(layers.ghost);
    layers.done.classList.add('complete');
    const s = stats[cur.k.c] || { runs: 0, clean: 0, misses: 0 };
    s.runs++;
    s.misses += cur.totalMisses;
    if (cur.totalMisses === 0) s.clean++;
    s.last = Date.now();
    stats[cur.k.c] = s;
    store.set('stats', stats);
    $('jump').placeholder = cur.k.c;
    if (cur.totalMisses === 0) { flash('Perfect', 'var(--good)'); say('Perfect', 'good'); }
    else say(`${cur.totalMisses} miss${cur.totalMisses > 1 ? 'es' : ''}`, 'bad');
    renderStatus();
    later(() => go(1), 1200);
  }

  // ---- controls ---------------------------------------------------------------
  $('level').addEventListener('change', (e) => setLevel(+e.target.value));
  $('mode').addEventListener('click', (e) => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
  $('prev').addEventListener('click', () => go(-1));
  $('next').addEventListener('click', () => go(1));
  $('restart').addEventListener('click', load);
  $('replay').addEventListener('click', replayAll);
  $('jump').addEventListener('input', (e) => {
    const ch = e.target.value.trim();
    if (ch && !e.isComposing) { jumpTo(ch); e.target.blur(); }
  });
  $('jump').addEventListener('compositionend', (e) => { const ch = e.data.trim().slice(-1); if (ch) { jumpTo(ch); e.target.blur(); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'r') load();
    else if (e.key === 'a') replayAll();
    else if (e.key === 'h' && cur && !cur.finished) showHint();
  });

  for (const b of $('mode').children) b.classList.toggle('on', b.dataset.mode === mode);
  setLevel(level);
});
