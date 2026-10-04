// Settings form generated from SETTINGS, plus data management (export / import / reset).
import { h, add, clear, confirmDialog, toast } from '../ui/dom.js';
import { SETTINGS } from '../settings.js';
import { tts } from '../tts.js';
import { exportBlob, parseExport } from '../store.js';
import { replay } from '../state.js';

function control(app, def) {
  const value = app.settings[def.key];
  const set = (v) => app.setSetting(def.key, v);
  switch (def.type) {
    case 'bool':
      return h('input', { type: 'checkbox', checked: !!value, onchange: (e) => set(e.target.checked) });
    case 'select':
      return h('select', { onchange: (e) => set(typeof def.options[0] === 'number' ? +e.target.value : e.target.value) },
        def.options.map((o, i) => h('option', { value: o, selected: o === value }, def.labels?.[i] ?? String(o))));
    case 'voice': {
      const vs = tts.voices();
      if (!vs.length) return h('span.muted.small', 'No Japanese voice installed in this browser/OS');
      return h('div.row',
        h('select', { onchange: (e) => set(e.target.value) },
          h('option', { value: '' }, 'Default'),
          vs.map((v) => h('option', { value: v.name, selected: v.name === value }, `${v.name} (${v.lang})`))),
        h('button.btn.small', { onclick: () => app.speak('こんにちは、かんじ') }, 'Test'));
    }
    default: {
      const out = h('output', String(value));
      const input = h('input', {
        type: 'range', min: def.min, max: def.max, step: def.step || 1, value,
        oninput: (e) => { out.textContent = e.target.value; },
        onchange: (e) => set(def.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)),
      });
      return h('div.range', input, out);
    }
  }
}

function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function settingsScreen(root, app) {
  async function render() {
    const events = await app.backend.all('events');
    const reports = await app.backend.all('reports');
    const groups = [...new Set(SETTINGS.map((s) => s.group))];
    add(clear(root),
      h('h1.title', 'Settings'),
      groups.map((g) => h('section.card.settings',
        h('h3', g),
        SETTINGS.filter((s) => s.group === g).map((def) => h('label.setting',
          h('div.setting-text', h('span', def.label), def.scope === 'device' ? h('span.tag', 'this device') : null,
            def.help ? h('small.muted', def.help) : null),
          control(app, def))))),

      h('section.card.settings',
        h('h3', 'Your data'),
        h('p.small', `Progress is an append-only log of ${events.length} events stored in this browser (IndexedDB)`,
          app.storagePersisted ? ', protected from automatic eviction.' : '. The browser did not grant persistent storage, so it may evict it under storage pressure: export a backup now and then.'),
        h('div.row',
          h('button.btn', {
            onclick: () => download(`suckless-kanji-${new Date().toISOString().slice(0, 10)}.json`, exportBlob(events, reports)),
          }, 'Export backup'),
          h('label.btn', 'Import / merge…', h('input.hidden', {
            type: 'file', accept: 'application/json,.json',
            onchange: async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              try {
                const d = parseExport(await file.text());
                replay(d.events); // validate that it replays before touching storage
                const added = await app.backend.putNew('events', d.events);
                await app.backend.putNew('reports', d.reports || []);
                await app.reload();
                toast(`Merged ${added} new events (${d.events.length - added} already present)`);
                render();
              } catch (err) {
                toast(`Import failed: ${err.message}`, 4000);
              }
            },
          }))),
        h('p.small.muted', 'Import merges: events already present are skipped, so importing a backup twice or from another device is safe.'),
        h('div.row', h('a.btn', { href: '#/import' }, 'Import prior knowledge…')),
        h('p.small.muted', 'Coming from another app? Mark the kanji you know; their reviews are spread out instead of all due at once.'),
        reports.length ? h('p.small.muted', `${reports.length} drawing-checker reports saved (included in exports).`) : null,
        h('button.btn.danger', {
          onclick: async () => {
            if (!await confirmDialog('Delete ALL progress on this device? Export a backup first if unsure.', 'Delete everything')) return;
            if (!await confirmDialog('Really delete? This cannot be undone.', 'Yes, delete')) return;
            await app.backend.clear('events');
            await app.reload();
            toast('Progress deleted');
            render();
          },
        }, 'Reset progress')),

      h('section.card.settings.small',
        h('h3', 'About'),
        h('p', 'Stroke data ', h('a', { href: 'https://kanjivg.tagaini.net' }, 'KanjiVG'), ' (CC BY-SA 3.0). Kanji and word data ',
          h('a', { href: 'https://www.edrdg.org/' }, 'JMdict/KANJIDIC2'), ' (EDRDG, CC BY-SA 4.0), ',
          h('a', { href: 'https://github.com/Doublevil/JmdictFurigana' }, 'JmdictFurigana'), '. JLPT lists ',
          h('a', { href: 'http://www.tanos.co.uk/jlpt/' }, 'tanos.co.uk'), '. Example sentences ',
          h('a', { href: 'https://tatoeba.org' }, 'Tatoeba'), ' (CC BY 2.0 FR).'),
        h('p.muted', `Device id ${app.dev}`)),
    );
  }
  render();
}
