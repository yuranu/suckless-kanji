import { h, add, clear } from '../ui/dom.js';
import { lessonList, lessonStatus, nextLessonIndex } from '../progress.js';

const STATUS_LABEL = { done: 'learned', partial: 'partly', new: '' };

export function lessonsScreen(root, app) {
  const ls = lessonList(app);
  const next = nextLessonIndex(app);
  const byLevel = new Map();
  ls.forEach((l, i) => {
    const lv = l[0].level;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv).push(i);
  });
  const currentLevel = next === null ? null : ls[next][0].level;

  function row(i) {
    const l = ls[i];
    const st = lessonStatus(app, l);
    return h('a.lesson-row.' + st + (i === next ? '.next' : ''), { href: `#/learn/${i + 1}` },
      h('span.lesson-n', String(i + 1)),
      h('span.lesson-words.jp', l.map((it) => it.kanji || it.word).join('　')),
      h('span.lesson-status', i === next ? 'next' : STATUS_LABEL[st]));
  }

  add(clear(root),
    h('h1.title', 'Lessons'),
    h('p.muted', `${ls.length} lessons of ${app.settings.wordsPerLesson} words. Tap one to learn it (or practice it again).`),
    [...byLevel].map(([lv, idx]) => {
      const done = idx.filter((i) => lessonStatus(app, ls[i]) === 'done').length;
      const det = h('details.level', { open: lv === currentLevel },
        h('summary', h('span', `N${lv}`), h('span.muted', `${done} / ${idx.length}`)));
      // Rows are built on first open: N1 alone has ~1000 lessons.
      const fill = () => { if (det.childElementCount === 1) add(det, idx.map(row)); };
      if (det.open) fill();
      det.addEventListener('toggle', fill);
      return det;
    }),
  );
  root.querySelector('.lesson-row.next')?.scrollIntoView({ block: 'center' });
}
