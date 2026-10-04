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

export const tts = {
  get available() { return !!synth && voices.length > 0; },
  voices: () => voices,
  speak(text, { voice = '', rate = 0.9 } = {}) {
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = rate;
    const v = voices.find((x) => x.name === voice) || voices[0];
    if (v) u.voice = v;
    synth.speak(u);
  },
  stop() { synth?.cancel(); },
};
