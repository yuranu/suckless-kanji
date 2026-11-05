// Stroke geometry + matching (ES module; also used by scripts/test-matcher.mjs).
// All coordinates are in KanjiVG space: a 109x109 box.

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
function compare(drawn, ref, leniency, place = 1) {
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
  const posTol = (10 + 0.12 * ref.len) * L * place;
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

// ---- freehand: the whole kanji, radical by radical ---------------------------
// The strokes drawn so far are judged together, in two frames:
//  1. the whole drawing may be shifted and scaled (keeping its proportions) within the box;
//  2. each radical (component, see scripts/build.mjs) may then sit a little off and be a
//     little larger or smaller than in the reference, relative to the rest.
// Each stroke is then compared with compare() inside its radical's frame, so what counts is
// the shape of each radical and roughly where it is, not where exactly every stroke landed.
const BOX_C = [54.5, 54.5];
const FIT = {
  // ws: pull of the scale towards 1 (in squared board units: about one stroke of spread 20)
  kanji: { ws: N * 400, sMin: 0.55, sMax: 1.5, tMax: 30 },
  comp: { ws: N * 400, sGrow: 0.3, tMax: 20 },
  // How far two radicals may drift apart (or together) from their reference placement.
  apart: 13,
  // Stroke position tolerance inside its radical, relative to compare()'s absolute one: the
  // frames have taken out the drift of the drawing and of each radical.
  place: 0.6,
};

// Least squares fit of u ≈ s * (r - c) + c + t, with s pulled towards 1 (weight o.ws) and
// clamped to [o.sMin, o.sMax], then t clamped to ±o.tMax. `pairs`: [drawn, reference] points.
// Uniform: one scale for both axes (a drawing as a whole keeps its proportions, else stretching
// it would hide radicals drawn too far apart); otherwise one per axis (a radical can be drawn
// narrower or taller).
function fit(pairs, c, o, uniform) {
  const n = pairs.length;
  const S = [0, 1].map((i) => {
    let Sa = 0, Saa = 0, Sb = 0, Sab = 0;
    for (const [u, r] of pairs) {
      const a = r[i] - c[i], b = u[i] - c[i];
      Sa += a; Saa += a * a; Sb += b; Sab += a * b;
    }
    // With t eliminated: minimise (Saa - Sa²/n) s² - 2 (Sab - Sa Sb / n) s + ws (s - 1)²
    return { Sa, Sb, q: Saa - Sa * Sa / n, l: Sab - Sa * Sb / n };
  });
  const scale = (q, l) => Math.min(o.sMax, Math.max(o.sMin, (l + o.ws) / (q + o.ws)));
  const both = uniform ? scale(S[0].q + S[1].q, S[0].l + S[1].l) : null;
  return S.map(({ Sa, Sb, q, l }, i) => {
    const sc = uniform ? both : scale(q, l);
    const t = Math.min(o.tMax, Math.max(-o.tMax, (Sb - sc * Sa) / n));
    return { s: sc, t, c: c[i] };
  });
}

// drawn -> reference space
const unmap = (T, p) => [(p[0] - T[0].c - T[0].t) / T[0].s + T[0].c, (p[1] - T[1].c - T[1].t) / T[1].s + T[1].c];

// Reference data for freehand matching: prepared strokes plus each radical's centre.
function prepareKanji(kanji) {
  const refs = kanji.paths.map(prepare);
  const comps = kanji.comps || refs.map(() => 0);
  const centers = [];
  for (let id = 0; id <= Math.max(...comps); id++) {
    const pts = refs.flatMap((r, i) => (comps[i] === id ? r.pts : []));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    centers.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
  }
  return { refs, comps, centers };
}

// Judge drawn strokes (resampled to N points) assigned to reference strokes `assign`.
function evaluate(K, drawn, assign, L) {
  const pairs = drawn.flatMap((u, k) => u.map((p, i) => [p, K.refs[assign[k]].pts[i]]));
  const G = fit(pairs, BOX_C, FIT.kanji, true);
  const inG = drawn.map((u) => u.map((p) => unmap(G, p)));
  const grow = FIT.comp.sGrow * L;
  const co = { ws: FIT.comp.ws, sMin: 1 / (1 + grow), sMax: 1 + grow, tMax: FIT.comp.tMax * L };
  const frames = new Map();
  for (const id of new Set(assign.map((j) => K.comps[j]))) {
    const ps = inG.flatMap((u, k) => (K.comps[assign[k]] === id ? u.map((p, i) => [p, K.refs[assign[k]].pts[i]]) : []));
    frames.set(id, fit(ps, K.centers[id], co));
  }
  // Radicals out of place relative to each other: the drawing as a whole fails.
  const shifts = [...frames.values()].map((T) => [T[0].t, T[1].t]);
  let drift = 0;
  for (const a of shifts) for (const b of shifts) drift = Math.max(drift, dist(a, b));
  const res = inG.map((u, k) => {
    const j = assign[k];
    return compare(u.map((p) => unmap(frames.get(K.comps[j]), p)), K.refs[j], L, FIT.place);
  });
  const placed = drift <= FIT.apart * L;
  return { res, pass: placed && res.every((r) => r.pass), last: res[res.length - 1], drift, G, inG };
}

// Match the next stroke of a freehand drawing. `done`: the accepted strokes so far (each
// resampled to N points), in order. Same reasons as match(), plus 'misplaced': the stroke
// fits, but together with it the drawing no longer does (a radical has drifted too far).
function matchFree(K, done, drawn, leniency) {
  const L = leniency || 1;
  if (drawn.length < 2) drawn = [drawn[0], drawn[0]];
  const u = resample(drawn, N);
  const index = done.length;
  const base = done.map((_, i) => i);
  const as = (j, pts = u) => evaluate(K, [...done, pts], [...base, j], L);
  const main = as(index);
  const r = main.last;
  // Other strokes are only tried in full when the drawn one roughly resembles them.
  const inG = main.inG[index];
  const like = (j) => compare(inG, K.refs[j], L * 2).pass;
  if (r.pass) {
    for (let j = 0; j < K.refs.length; j++) {
      if (j === index || !like(j)) continue;
      const o = as(j);
      if (o.pass && o.last.score < 0.6 * r.score - 1) return { ...r, pass: false, reason: j < index ? 'redrawn' : 'wrong-stroke', other: j };
    }
    if (!main.pass) return { ...r, pass: false, reason: 'misplaced', pts: u };
    return { ...r, reason: 'ok', pts: u };
  }
  if (as(index, u.slice().reverse()).pass) return { ...r, reason: 'backwards' };
  for (let j = index + 1; j < K.refs.length; j++) {
    if (like(j) && as(j).pass) return { ...r, reason: 'wrong-stroke', other: j };
  }
  return { ...r, reason: 'miss' };
}

export { parsePath, resample, length, normalize, frechet, prepare, compare, match, N, prepareKanji, evaluate, matchFree, FIT };
