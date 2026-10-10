// Text-to-speech via the Web Speech API. Words are spoken from their kana reading, so the
// engine cannot pick a wrong reading for the kanji.

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let voices = [];

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'));
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}

// How long an engine may take to start speaking before we call it stuck. Generous: a cold
// engine can take a second or two.
const START_TIMEOUT_MS = 3000;
let current = null;

export const tts = {
  get available() { return !!synth && voices.length > 0; },
  voices: () => voices,
  // onFail(reason) is called when nothing gets spoken: the engine reported an error, or never
  // started. On Android this happens when the system speech engine is stuck or has lost its
  // Japanese voice; the browser stays silent and does not recover on its own.
  speak(text, { voice = '', rate = 0.9, onFail } = {}) {
    if (!text) return;
    if (!synth) { onFail?.('unsupported'); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = rate;
    const v = voices.find((x) => x.name === voice) || voices[0];
    if (v) u.voice = v;
    current = u;
    let started = false;
    const fail = (reason) => {
      if (started || current !== u) return;
      current = null;
      synth.cancel();
      onFail?.(reason);
    };
    u.addEventListener('start', () => { started = true; });
    u.addEventListener('error', (e) => {
      // Our own cancel() (a newer utterance) or a page that may not autoplay yet: not broken.
      if (['interrupted', 'canceled', 'not-allowed'].includes(e.error)) {
        if (current === u) current = null; // and no timeout report either
        return;
      }
      fail(e.error || 'error');
    });
    setTimeout(() => fail('timeout'), START_TIMEOUT_MS);
    synth.speak(u);
  },
  stop() { current = null; synth?.cancel(); },
};
