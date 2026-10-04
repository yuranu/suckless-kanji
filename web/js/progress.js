// Read-only queries combining static data with user state.
import { lessons, kanjiOfWord, cardIds } from './data.js';
import { cardStage, dueDay, today } from './state.js';

export const isLearned = (app, item) => app.state.items.has(item.id);

export function lessonList(app) {
  return lessons(app.data, app.settings.wordsPerLesson);
}

export function lessonStatus(app, lesson) {
  const n = lesson.filter((it) => isLearned(app, it)).length;
  return n === 0 ? 'new' : n === lesson.length ? 'done' : 'partial';
}

// The next lesson: the first `wordsPerLesson` unlearned items in curriculum order. Unlike
// the fixed lesson grouping this skips items already known, so gaps (e.g. after importing
// prior knowledge) are filled first, in full-size lessons.
export function nextLessonItems(app) {
  const out = [];
  for (const it of app.data.items) {
    if (!isLearned(app, it)) out.push(it);
    if (out.length >= app.settings.wordsPerLesson) break;
  }
  return out;
}

// True when some learned item already uses kanji c.
export function kanjiKnown(app, c) {
  if (app.state.items.has(c)) return true;
  return (app.data.wordsByKanji.get(c) || []).some((it) => isLearned(app, it));
}

// Items to practice for a set of kanji: the kanji-only lessons and every word using any of
// them. learnedOnly keeps just what the user already learned.
export function itemsForKanji(app, chars, learnedOnly) {
  const seen = new Map();
  for (const c of chars) {
    const own = app.data.itemById.get(c);
    for (const it of own ? [own, ...(app.data.wordsByKanji.get(c) || [])] : (app.data.wordsByKanji.get(c) || [])) {
      if (!learnedOnly || isLearned(app, it)) seen.set(it.id, it);
    }
  }
  return [...seen.values()].sort((a, b) => a.index - b.index);
}

export function nextLessonIndex(app) {
  const ls = lessonList(app);
  const i = ls.findIndex((l) => lessonStatus(app, l) !== 'done');
  return i < 0 ? null : i;
}

// Kanji status: 'new' (no learned item uses it), 'young', or 'mature' (every learned card
// that involves it has an interval of 21+ days).
export function kanjiStatus(app, c) {
  const items = [...(app.data.wordsByKanji.get(c) || [])];
  const own = app.data.itemById.get(c);
  if (own) items.push(own);
  let any = false, allMature = true;
  for (const it of items) {
    if (!isLearned(app, it)) continue;
    for (const id of cardIds(it)) {
      const card = app.state.cards.get(id);
      if (!card) continue;
      any = true;
      if (cardStage(card, app.state.settings) !== 'mature') allMature = false;
    }
  }
  return !any ? 'new' : allMature ? 'mature' : 'young';
}

export function itemStage(app, item) {
  if (!isLearned(app, item)) return 'new';
  const stages = cardIds(item).map((id) => cardStage(app.state.cards.get(id), app.state.settings));
  return stages.every((s) => s === 'mature') ? 'mature' : 'young';
}

// Number of cards falling due on each of the next `days` days (index 0 = today, incl. overdue).
export function forecast(app, days = 7) {
  const t = today(app.state);
  const out = new Array(days).fill(0);
  for (const c of app.state.cards.values()) {
    const d = Math.max(0, dueDay(c, app.state.settings) - t);
    if (d < days) out[d]++;
  }
  return out;
}

export function learnedCounts(app) {
  let words = 0, kanjiItems = 0;
  for (const id of app.state.items.keys()) {
    const it = app.data.itemById.get(id);
    if (!it) continue;
    if (it.kanji) kanjiItems++; else words++;
  }
  const kanjiKnown = new Set();
  for (const id of app.state.items.keys()) {
    const it = app.data.itemById.get(id);
    if (it) for (const c of kanjiOfWord(it.word || it.kanji)) kanjiKnown.add(c);
  }
  return { words, kanjiItems, kanji: kanjiKnown.size };
}
