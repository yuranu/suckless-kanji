// Minimal DOM builder: h('div.card', {onclick}, child, 'text', [more children]).
export function h(sel, props, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

// Append children, flattening arrays and skipping null/undefined/false.
export function add(el, ...children) {
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Word with furigana: segs [[text, reading|null], ...] -> <ruby> markup.
export function ruby(segs) {
  return h('span.ruby', segs.map(([t, r]) => (r ? h('ruby', t, h('rt', r)) : t)));
}

// Modal confirmation; resolves true/false.
export function confirmDialog(message, okLabel = 'OK', cancelLabel = 'Cancel') {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div.overlay', { onclick: (e) => { if (e.target === overlay) close(false); } },
      h('div.dialog',
        h('p', message),
        h('div.row.end',
          h('button.btn', { onclick: () => close(false) }, cancelLabel),
          h('button.btn.primary', { onclick: () => close(true) }, okLabel))));
    document.body.appendChild(overlay);
  });
}

export function toast(message, ms = 2200) {
  const t = h('div.toast', message);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}
