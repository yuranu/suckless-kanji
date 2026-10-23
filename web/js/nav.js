// Hierarchical navigation: the browser history holds exactly the chain of screens from
// Home down to the current one, so Back goes to the parent screen, not the previous one.
// Paths are hash paths without the leading '#/' ('' is Home), URI-encoded as in links.

// [screen, parents it can open from (deepest one in the current chain wins), default chain
// above it when opened from elsewhere].
const PARENTS = [
  [/^(lessons|kanji|settings|review|free)$/, [], ['']],
  [/^learn\//, [/^lessons$/, /^kanji\//], ['']],
  [/^kanji\//, [/^kanji$/], ['', 'kanji']],
  [/^practice\//, [/^learn\//, /^kanji\//, /^free$/], ['']],
  [/^import$/, [/^settings$/], ['']],
];

// The chain of screens [Home, ..., path] when navigating to path from the chain current.
export function chainFor(path, current = ['']) {
  if (path === '') return [''];
  const [, parents, base] = PARENTS.find(([re]) => re.test(path)) || [null, [], ['']];
  for (let i = current.length - 1; i > 0; i--) {
    if (current[i] !== path && parents.some((re) => re.test(current[i]))) return [...current.slice(0, i + 1), path];
  }
  return [...base, path];
}

const entry = (chain) => [{ chain }, '', '#/' + chain[chain.length - 1]];
const hashPath = () => location.hash.replace(/^#\/?/, '');

let render = () => {};
let landed = null; // resolves the history.go() made by navigate()

function currentChain() {
  const chain = history.state?.chain;
  return Array.isArray(chain) && chain[0] === '' ? chain : null;
}

// Shows path, rewriting the history so that it holds the chain from Home to path.
export async function navigate(path) {
  const current = currentChain() || [''];
  const chain = chainFor(path, current);
  let keep = 0; // entries shared with the current history (at least Home)
  while (keep < current.length && keep < chain.length && current[keep] === chain[keep]) keep++;
  const back = current.length - keep;
  if (back > 0) await new Promise((resolve) => { landed = resolve; history.go(-back); });
  for (let i = keep; i < chain.length; i++) history.pushState(...entry(chain.slice(0, i + 1)));
  render();
}

// Routes in-app links and Back; calls show() whenever the screen should be redrawn.
export function startNav(show) {
  render = show;
  addEventListener('popstate', () => {
    if (landed) { const done = landed; landed = null; done(); return; }
    // Back/Forward land on a chain entry; an edited URL lands on a new entry without one.
    if (!currentChain()) history.replaceState(...entry(chainFor(hashPath())));
    render();
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href').slice(2));
  });
  // A fresh load (deep link, app shortcut): put the chain above it into the history.
  if (!currentChain()) {
    const chain = chainFor(hashPath());
    history.replaceState(...entry(['']));
    for (let i = 1; i < chain.length; i++) history.pushState(...entry(chain.slice(0, i + 1)));
  }
  render();
}
