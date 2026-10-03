// Stroke geometry + matching. Plain script (no modules) so it works from file:// and in node via vm.
// All coordinates are in KanjiVG space: a 109x109 box.
(function (global) {
  'use strict';

  // ---- SVG path -> polyline -------------------------------------------------
  // KanjiVG only uses M/m, C/c, S/s; L/l and Z are handled for safety.
  function parsePath(d) {
    const tokens = d.match(/[MmCcSsLlZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
    const pts = [];
    let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lastCx = null, lastCy = null;
    const num = () => parseFloat(tokens[i++]);
    const cubic = (x1, y1, x2, y2, x3, y3) => {
      const n = 16;
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        pts.push([
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        ]);
      }
      lastCx = x2; lastCy = y2; x = x3; y = y3;
    };
    while (i < tokens.length) {
      if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M':
          x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push([x, y]);
          lastCx = null;
          cmd = rel ? 'l' : 'L'; // implicit lineto after moveto
          break;
        case 'L':
          x = ox + num(); y = oy + num(); pts.push([x, y]); lastCx = null;
          break;
        case 'C': {
          const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
          cubic(...a);
          break;
        }
        case 'S': {
          const x1 = lastCx === null ? x : 2 * x - lastCx;
          const y1 = lastCy === null ? y : 2 * y - lastCy;
          const a = [ox + num(), oy + num(), ox + num(), oy + num()];
          cubic(x1, y1, ...a);
          break;
        }
        case 'Z':
          x = sx; y = sy; pts.push([x, y]); lastCx = null;
          break;
        default:
          throw new Error('unsupported path command ' + cmd);
      }
    }
    return pts;
  }

  // ---- polyline helpers -----------------------------------------------------
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function length(pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
    return l;
  }

  // n points equally spaced along the polyline's arc length.
  function resample(pts, n) {
    if (pts.length === 1) return Array.from({ length: n }, () => pts[0].slice());
    const total = length(pts);
    if (total === 0) return Array.from({ length: n }, () => pts[0].slice());
    const step = total / (n - 1);
    const out = [pts[0].slice()];
    let acc = 0, i = 1, prev = pts[0];
    while (out.length < n - 1 && i < pts.length) {
      const d = dist(prev, pts[i]);
      if (acc + d >= step && d > 0) {
        const t = (step - acc) / d;
        const p = [prev[0] + t * (pts[i][0] - prev[0]), prev[1] + t * (pts[i][1] - prev[1])];
        out.push(p);
        prev = p; acc = 0;
      } else {
        acc += d; prev = pts[i]; i++;
      }
    }
    while (out.length < n) out.push(pts[pts.length - 1].slice());
    return out;
  }

  // Translate to centroid, scale so the stroke's arc length is 1.
  function normalize(pts) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const l = length(pts) || 1;
    return pts.map((p) => [(p[0] - cx) / l, (p[1] - cy) / l]);
  }

  // Discrete Fréchet distance between two polylines.
  function frechet(a, b) {
    const ca = a.map(() => new Array(b.length).fill(-1));
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        const d = dist(a[i], b[j]);
        if (i === 0 && j === 0) ca[i][j] = d;
        else if (i === 0) ca[i][j] = Math.max(ca[i][j - 1], d);
        else if (j === 0) ca[i][j] = Math.max(ca[i - 1][j], d);
        else ca[i][j] = Math.max(Math.min(ca[i - 1][j], ca[i - 1][j - 1], ca[i][j - 1]), d);
      }
    }
    return ca[a.length - 1][b.length - 1];
  }

  const N = 24;

  // Precompute what the matcher needs for one reference stroke.
  function prepare(d) {
    const pts = parsePath(d);
    const rs = resample(pts, N);
    return { d, pts: rs, len: length(rs), norm: normalize(rs) };
  }

  // Compare a drawn polyline against a prepared reference stroke.
  // Returns metrics plus a combined score (lower is better) and pass flag.
  function compare(drawn, ref, leniency) {
    const L = leniency || 1;
    const u = resample(drawn, N);
    const ulen = length(u); // resampled, so hand jitter does not inflate it
    let avg = 0;
    for (let i = 0; i < N; i++) avg += dist(u[i], ref.pts[i]);
    avg /= N;
    const start = dist(u[0], ref.pts[0]);
    const end = dist(u[N - 1], ref.pts[N - 1]);
    const ratio = ulen / Math.max(ref.len, 1);
    // Shape is meaningless for dots; only check it on strokes with real extent.
    const shape = ref.len > 18 && ulen > 8 ? frechet(normalize(u), ref.norm) : 0;
    // Short strokes (dots, ticks) get an absolute floor so they're not impossibly strict.
    const posTol = (10 + 0.12 * ref.len) * L;
    const checks = {
      avg: avg <= posTol,
      start: start <= posTol * 1.3,
      end: end <= posTol * 1.3,
      // absolute slack so dots/ticks tolerate jitter
      length: ulen >= ref.len * 0.35 / L - 4 && ulen <= ref.len * 2.2 * L + 10,
      shape: shape <= 0.3 * L,
    };
    const pass = Object.values(checks).every(Boolean);
    return { pass, checks, avg, start, end, ratio, shape, score: avg + 0.5 * (start + end) };
  }

  // Match a drawn stroke against stroke `index` of the kanji (array of prepared refs).
  // Rejects strokes that fit another stroke clearly better: a later one (wrong order) or an
  // already drawn one (redrawing it) — matters for close parallel strokes like the dots of 雨.
  // result.reason: 'ok' | 'backwards' | 'wrong-stroke' | 'redrawn' | 'miss'
  function match(drawn, refs, index, leniency) {
    if (drawn.length < 2) drawn = [drawn[0], drawn[0]];
    const ref = refs[index];
    const r = compare(drawn, ref, leniency);
    if (r.pass) {
      for (let j = 0; j < refs.length; j++) {
        if (j === index) continue;
        const o = compare(drawn, refs[j], leniency);
        if (o.pass && o.score < r.score * 0.6) return { ...r, pass: false, reason: j < index ? 'redrawn' : 'wrong-stroke', other: j };
      }
      return { ...r, reason: 'ok' };
    }
    const rev = compare(drawn.slice().reverse(), ref, leniency);
    if (rev.pass) return { ...r, reason: 'backwards' };
    for (let j = index + 1; j < refs.length; j++) {
      if (compare(drawn, refs[j], leniency).pass) return { ...r, reason: 'wrong-stroke', other: j };
    }
    return { ...r, reason: 'miss' };
  }

  global.Stroke = { parsePath, resample, length, normalize, frechet, prepare, compare, match };
})(typeof window !== 'undefined' ? window : globalThis);
