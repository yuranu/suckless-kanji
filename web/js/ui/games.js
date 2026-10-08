// Card minigames. runCard() plays one card (reading / writing / kanji) through its steps and
// a summary, and resolves with {ok, rating}. Steps resolve true/false; a wrong answer can be
// taken back with the "I misclicked" corner button.
import { h, clear, ruby, sleep } from './dom.js';
import { drawpad } from './drawpad.js';
import { readingChoices, meaningChoices, kanjiGrid } from '../distractors.js';
import { isKanji, kanjiOfWord } from '../data.js';
import { previewIntervals } from '../state.js';

const RATING_LABELS = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

function speakButton(app, text) {
  return h('button.icon-btn.speak', { title: 'Read aloud', onclick: () => app.speak(text) }, '🔊');
}

function stepCard(...children) {
  return h('div.step', ...children);
}

// Keyboard shortcuts while a step is on screen; returns an unbind function. The handler
// unbinds itself once `root` leaves the document (user navigated away mid-step).
function keys(map, root) {
  const fn = (e) => {
    if (root && !root.isConnected) { document.removeEventListener('keydown', fn); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const f = map[e.key];
    if (f) { e.preventDefault(); f(); }
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

// ---- multiple choice -------------------------------------------------------------
function choiceStep(root, { prompt, options, correct, cls = '' }) {
  return new Promise((resolve) => {
    let failed = false, done = false;
    const misclick = h('button.corner', { disabled: true, onclick: undo }, 'I misclicked');
    const cont = h('button.btn.primary.hidden', { onclick: () => finish(false) }, 'Continue');
    const buttons = options.map((opt, i) => h('button.choice' + (cls ? '.' + cls : ''), {
      onclick: () => pick(i),
    }, h('span.key', String(i + 1)), h('span.label', opt)));

    function pick(i) {
      if (done || failed) return;
      const b = buttons[i];
      if (options[i] === correct) {
        done = true;
        b.classList.add('right');
        buttons.forEach((x) => { x.disabled = true; });
        setTimeout(() => finish(true), 450);
      } else {
        failed = true;
        b.classList.add('wrong');
        buttons[options.indexOf(correct)].classList.add('right');
        buttons.forEach((x) => { x.disabled = true; });
        misclick.disabled = false;
        cont.classList.remove('hidden');
      }
    }
    function undo() {
      if (!failed || done) return;
      failed = false;
      buttons.forEach((x) => { x.disabled = false; x.classList.remove('right', 'wrong'); });
      misclick.disabled = true;
      cont.classList.add('hidden');
    }
    const unbind = keys({
      ...Object.fromEntries(options.map((_, i) => [String(i + 1), () => pick(i)])),
      Enter: () => { if (failed) finish(false); },
    }, root);
    function finish(ok) {
      if (done && !ok) return;
      done = true;
      unbind();
      resolve(ok);
    }
    // Many options: kana go in two columns, translations get compact rows (fit one screen).
    const many = options.length > 4 ? (cls === 'jp' ? '.many.cols' : '.many') : '';
    clear(root).appendChild(stepCard(misclick, prompt, h('div.choices' + many, buttons), h('div.row.center', cont)));
  });
}

function readingStep(root, app, item) {
  const s = app.settings;
  return choiceStep(root, {
    prompt: h('div.prompt', h('div.question', 'How is this read?'), h('div.word.big', item.word)),
    options: readingChoices(item, s.choices, app.data),
    correct: item.kana,
    cls: 'jp',
  });
}

function meaningStep(root, app, item) {
  const s = app.settings;
  app.autoSpeak(item.kana);
  return choiceStep(root, {
    prompt: h('div.prompt', h('div.question', 'What does it mean?'),
      h('div.word-line', h('div.word.big', ruby(item.segs)), speakButton(app, item.kana))),
    options: meaningChoices(item, s.choices, app.data),
    correct: item.meaning,
  });
}

// Word with kanji replaced by blanks; `filled[i]` fills the i-th blank.
function blankedWord(word, filled = [], states = []) {
  let bi = 0;
  return h('div.word.big.blanked', [...word].map((ch) => {
    if (!isKanji(ch)) return h('span', ch);
    const i = bi++;
    return h('span.blank' + (states[i] ? '.' + states[i] : ''), filled[i] || '　');
  }));
}

// ---- drawing -------------------------------------------------------------------
function drawStep(root, app, kanji, prompt) {
  return new Promise((resolve) => {
    const s = app.settings;
    let ok = null, settled = false;
    const cont = h('button.btn.primary.hidden', { onclick: () => finish() }, 'Continue');
    const hintBtn = h('button.btn', { onclick: () => pad.hint() }, 'Hint');
    // Shown only right after a rejected stroke (until the next one), so it can't be hit by
    // accident and can't skip drawing: it only forgives that one stroke.
    const broken = h('button.corner.invisible', {
      title: 'The checker rejected a stroke you drew correctly: count it and carry on',
      onclick: () => {
        app.report('drawpad', { kanji: kanji.c, stroke: pad.stroke, mistakes: pad.mistakes });
        broken.classList.add('invisible');
        pad.forgive();
      },
    }, 'My stroke was right');
    const pad = drawpad(kanji, {
      leniency: s.leniency,
      onMistake: () => broken.classList.remove('invisible'),
      onStroke: () => broken.classList.add('invisible'),
      onComplete: ({ mistakes, hintUsed }) => {
        ok = !hintUsed && mistakes <= s.drawMistakes;
        hintBtn.disabled = true;
        broken.classList.add('invisible');
        if (ok) setTimeout(finish, 700);
        else cont.classList.remove('hidden');
      },
    });
    const unbind = keys({ h: () => pad.hint(), Enter: () => { if (ok === false) finish(); } }, root);
    function finish() {
      if (settled) return;
      settled = true;
      unbind();
      pad.destroy();
      resolve(ok);
    }
    clear(root).appendChild(stepCard(broken, prompt, pad.el, h('div.row.center', hintBtn, cont)));
  });
}

function writeStep(root, app, item) {
  const kanji = kanjiOfWord(item.word);
  app.autoSpeak(item.kana);
  const prompt = (word) => h('div.prompt', h('div.question', 'Write it'),
    h('div.kana', item.kana, speakButton(app, item.kana)), word,
    h('div.hint-meaning', item.meaning));
  if (kanji.length === 1) {
    return drawStep(root, app, app.data.kanjiByChar.get(kanji[0]), prompt(blankedWord(item.word)));
  }
  return gridStep(root, app, item, prompt);
}

// ---- kanji grid (multi-kanji words) ---------------------------------------------
function gridStep(root, app, item, prompt) {
  return new Promise((resolve) => {
    const answer = [...item.word].filter(isKanji);
    const size = Math.max(app.settings.gridSize, answer.length > 4 ? 12 : 0);
    const options = kanjiGrid(item.word, size, app.data);
    const filled = [], states = [];
    let failed = false, settled = false;
    const wordBox = h('div');
    const misclick = h('button.corner', { disabled: true, onclick: undo }, 'I misclicked');
    const cont = h('button.btn.primary.hidden', { onclick: () => finish(false) }, 'Continue');
    const cells = options.map((c) => h('button.grid-cell', { onclick: () => pick(c) }, c));

    function render() { clear(wordBox).appendChild(blankedWord(item.word, filled, states)); }
    function pick(c) {
      if (failed || settled || filled.length >= answer.length) return;
      const i = filled.length;
      if (c === answer[i]) {
        filled.push(c); states.push('right');
      } else {
        filled.push(answer[i]); states.push('wrong');
        failed = true;
        misclick.disabled = false;
        cont.classList.remove('hidden');
      }
      render();
      if (!failed && filled.length === answer.length) setTimeout(() => finish(true), 600);
    }
    function undo() {
      if (!failed) return;
      filled.pop(); states.pop();
      failed = false;
      misclick.disabled = true;
      cont.classList.add('hidden');
      render();
    }
    function finish(ok) {
      if (settled) return;
      settled = true;
      unbind();
      resolve(ok);
    }
    const unbind = keys({ Enter: () => { if (failed) finish(false); } }, root);
    render();
    clear(root).appendChild(stepCard(misclick, prompt(wordBox), h('div.kanji-grid' + (size > 9 ? '.wide' : ''), cells), h('div.row.center', cont)));
  });
}

// ---- kanji-only item ----------------------------------------------------------
function kanjiStep(root, app, item) {
  const k = app.data.kanjiByChar.get(item.kanji);
  const prompt = h('div.prompt', h('div.question', 'Write the kanji'),
    h('div.meaning-big', k.meanings.join(', ')),
    h('div.readings', k.on.length ? h('span', '音 ' + k.on.join('・')) : null, k.kun.length ? h('span', '訓 ' + k.kun.join('・')) : null));
  return drawStep(root, app, k, prompt);
}

// ---- summary ---------------------------------------------------------------------
export function wordSummary(app, item) {
  if (item.kanji) {
    const k = app.data.kanjiByChar.get(item.kanji);
    return h('div.summary-body',
      h('div.word.huge', k.c),
      h('div.meaning', k.meanings.join(', ')),
      h('div.readings', k.on.length ? h('span', '音 ' + k.on.join('・')) : null, k.kun.length ? h('span', '訓 ' + k.kun.join('・')) : null));
  }
  const ex = item.example;
  return h('div.summary-body',
    h('div.word.huge', ruby(item.segs)),
    h('div.kana', item.kana, speakButton(app, item.kana)),
    h('div.meaning', item.meaning),
    h('div.kanji-breakdown', kanjiOfWord(item.word).map((c) => {
      const k = app.data.kanjiByChar.get(c);
      return h('a', { href: `#/kanji/${encodeURIComponent(c)}`, target: '_self', class: 'kb' }, h('span.kb-c', c), h('span.kb-m', k?.meanings[0] || ''));
    })),
    ex ? h('div.example', h('div.ja', ex.ja, speakButton(app, ex.ja)), h('div.en', ex.en)) : null);
}

function fmtDays(d) {
  if (d < 1) return '<1d';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${(d / 30).toFixed(d < 300 ? 1 : 0).replace(/\.0$/, '')}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

function summaryStep(root, app, item, { ok, mode, cardId }) {
  return new Promise((resolve) => {
    const rate = (r) => { unbind(); resolve(r); };
    // Reviews rate like Anki: after a correct answer all four (Again included, e.g. for a
    // lucky guess); after a miss the rating is Again. Lessons and practice just continue.
    let buttons, shortcuts;
    if (mode === 'review') {
      const card = app.state.cards.get(cardId);
      const prev = card ? previewIntervals(app.state, card) : {};
      const ratings = ok ? [1, 2, 3, 4] : [1];
      buttons = ratings.map((r) => h('button.btn.rate.r' + r + (!ok ? '.only' : ''), { onclick: () => rate(r) },
        h('span', RATING_LABELS[r]), prev[r] ? h('small', fmtDays(prev[r])) : null));
      const main = ok ? 3 : 1;
      shortcuts = { ' ': () => rate(main), Enter: () => rate(main), ...Object.fromEntries(ratings.map((r) => [String(r), () => rate(r)])) };
    } else {
      buttons = [h('button.btn.primary', { onclick: () => rate(ok ? 3 : 1) }, 'Continue')];
      shortcuts = { ' ': () => rate(ok ? 3 : 1), Enter: () => rate(ok ? 3 : 1) };
    }
    const unbind = keys(shortcuts, root);
    clear(root).appendChild(stepCard(
      h('div.verdict' + (ok ? '.ok' : '.bad'), ok ? 'Correct' : 'Missed — this card will come back'),
      wordSummary(app, item),
      h('div.row.center.rate-row', buttons)));
    if (!ok || mode !== 'review') app.autoSpeak(item.kana || '');
  });
}

// ---- card runner ----------------------------------------------------------------
// mode: 'learn' | 'review' | 'practice'. Resolves {ok, rating, ms}.
export async function runCard(root, app, item, kind, mode) {
  const t0 = Date.now();
  let ok = true;
  if (kind === 'r') {
    ok = (await readingStep(root, app, item)) && ok;
    ok = (await meaningStep(root, app, item)) && ok;
  } else if (kind === 'w') {
    ok = (await writeStep(root, app, item)) && ok;
    ok = (await meaningStep(root, app, item)) && ok;
  } else {
    ok = await kanjiStep(root, app, item);
  }
  const ms = Date.now() - t0;
  const rating = await summaryStep(root, app, item, { ok, mode, cardId: `${item.id}#${kind}` });
  await sleep(0);
  // Rating Again counts as a miss even when the answers were right: the card comes back.
  return { ok: ok && rating !== 1, rating, ms };
}

export const KIND_LABEL = { r: 'Reading', w: 'Writing', k: 'Kanji' };
