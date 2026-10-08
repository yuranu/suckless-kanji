// Kanji drawing pad: the user draws strokes in order, each checked by the stroke matcher.
// Starts blank (or with an outline in trace mode); a mistake or a hint turns the outline on.
import { h, s, clear } from './dom.js';
import * as Stroke from '../stroke.js';

const MESSAGES = {
  backwards: 'Wrong direction',
  'wrong-stroke': 'Wrong stroke order',
  redrawn: 'Already drawn',
  miss: 'Try again',
};

export function drawpad(kanji, opts = {}) {
  const { leniency = 1, outline: startOutline = false, onMistake, onComplete, onStroke } = opts;
  const refs = kanji.paths.map(Stroke.prepare);
  const svg = s('svg', { viewBox: '0 0 109 109', class: 'drawpad' });
  const grid = s('g', { class: 'grid' }, svg);
  s('rect', { x: 0.5, y: 0.5, width: 108, height: 108, rx: 3 }, grid);
  s('line', { x1: 54.5, y1: 0, x2: 54.5, y2: 109 }, grid);
  s('line', { x1: 0, y1: 54.5, x2: 109, y2: 54.5 }, grid);
  const layers = Object.fromEntries(['ghost', 'done', 'hint', 'ink'].map((n) => [n, s('g', { class: n }, svg)]));
  const msg = h('div.drawpad-msg');
  const el = h('div.drawpad-wrap', svg, msg);

  let stroke = 0, mistakes = 0, hintUsed = false, outline = startOutline, finished = false;
  let strokeMistakes = 0; // rejections of the current stroke
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function say(text, cls = '') { msg.textContent = text; msg.className = 'drawpad-msg ' + cls; }

  function renderGhost() {
    clear(layers.ghost);
    if (!outline || finished) return;
    kanji.paths.forEach((d, i) => {
      if (i >= stroke) s('path', { d, class: i === stroke ? 'next' : '' }, layers.ghost);
    });
    const p = refs[stroke].pts[0];
    s('circle', { cx: p[0], cy: p[1], r: 2 }, layers.ghost);
  }

  function animateStroke(g, i, ms) {
    return new Promise((resolve) => {
      const p = s('path', { d: kanji.paths[i] }, g);
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.style.transition = `stroke-dashoffset ${ms}ms linear`;
      p.style.strokeDashoffset = 0;
      later(() => resolve(p), ms);
    });
  }

  function showHintStroke() {
    clear(layers.hint);
    const st = refs[stroke].pts[0];
    s('circle', { cx: st[0], cy: st[1], r: 2.2 }, layers.hint);
    animateStroke(layers.hint, stroke, 500).then((p) => {
      later(() => { p.style.transition = 'opacity 0.6s'; p.style.opacity = 0; }, 400);
      later(() => clear(layers.hint), 1100);
    });
  }

  function complete() {
    finished = true;
    clear(layers.ghost); clear(layers.hint); clear(layers.ink);
    layers.done.classList.add('complete');
    say('');
    onComplete?.({ mistakes, hintUsed });
  }

  function accept() {
    s('path', { d: kanji.paths[stroke], class: 'fresh' }, layers.done);
    clear(layers.hint);
    stroke++;
    strokeMistakes = 0;
    say('');
    onStroke?.(stroke);
    if (stroke === kanji.paths.length) complete();
    else renderGhost();
  }

  // ---- input ----
  let drawing = null;
  const toBoard = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  };
  svg.addEventListener('pointerdown', (e) => {
    if (finished || drawing) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const p = toBoard(e);
    drawing = { id: e.pointerId, pts: [p], line: s('polyline', { points: p.join(',') }, layers.ink) };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const p = toBoard(ev);
      const last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.4) drawing.pts.push(p);
    }
    drawing.line.setAttribute('points', drawing.pts.map((p) => p.join(',')).join(' '));
  });
  const end = (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const { pts, line } = drawing;
    drawing = null;
    judge(pts, line);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', (e) => {
    if (drawing && e.pointerId === drawing.id) { drawing.line.remove(); drawing = null; }
  });

  function judge(pts, line) {
    const r = Stroke.match(pts, refs, stroke, leniency);
    if (r.reason === 'ok') {
      line.remove();
      accept();
      return;
    }
    line.classList.add('bad');
    later(() => line.remove(), 450);
    mistakes++;
    strokeMistakes++;
    say(MESSAGES[r.reason], 'bad');
    if (!outline) { outline = true; renderGhost(); }
    showHintStroke();
    onMistake?.(mistakes, r.reason);
  }

  renderGhost();

  return {
    el,
    get mistakes() { return mistakes; },
    get hintUsed() { return hintUsed; },
    get finished() { return finished; },
    get stroke() { return stroke; },
    hint() {
      if (finished) return;
      hintUsed = true;
      outline = true;
      renderGhost();
      showHintStroke();
    },
    // "My stroke was right": the checker wrongly rejected the current stroke. Count it as
    // drawn, take back its mistakes, and hide the outline again so the rest is still drawn
    // from memory (unless a hint was asked for).
    forgive() {
      if (finished || !strokeMistakes) return;
      mistakes -= strokeMistakes;
      if (!hintUsed) outline = startOutline;
      accept();
    },
    // Stroke-order animation of the whole kanji (display only).
    async animate(ms = 350) {
      finished = true;
      clear(layers.ghost); clear(layers.done); clear(layers.hint); clear(layers.ink);
      layers.done.classList.remove('complete');
      for (let i = 0; i < kanji.paths.length; i++) {
        await animateStroke(layers.done, i, ms);
        await new Promise((r) => later(r, 100));
      }
    },
    destroy() { timers.forEach(clearTimeout); timers = []; },
  };
}

// Static kanji rendering from stroke paths (for grids and headers).
export function kanjiSvg(kanji, cls = 'kanji-svg') {
  const svg = s('svg', { viewBox: '0 0 109 109', class: cls });
  const g = s('g', { class: 'done' }, svg);
  for (const d of kanji.paths) s('path', { d }, g);
  return svg;
}
