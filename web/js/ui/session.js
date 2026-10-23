// Frame for full-screen flows (lesson, review, practice): header with exit and progress.
import { h, add, confirmDialog } from './dom.js';
import { syncIcon } from './sync-ui.js';
import { navigate } from '../nav.js';

export function sessionFrame(root, { title, confirmExit, app }) {
  const bar = h('div.progress-fill');
  const label = h('span.progress-label');
  const body = h('div.session-body');
  const exit = h('button.icon-btn', {
    title: 'Leave',
    onclick: async () => {
      if (!confirmExit || await confirmDialog(confirmExit, 'Leave', 'Stay')) navigate('');
    },
  }, '✕');
  add(root, h('header.session-head', exit, h('span.session-title', title), app ? syncIcon(app) : null, label), h('div.progress', bar), body);
  return {
    body,
    progress(done, total, text) {
      bar.style.width = `${total ? (100 * done) / total : 0}%`;
      label.textContent = text ?? `${done} / ${total}`;
    },
  };
}
