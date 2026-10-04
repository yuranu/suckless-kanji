// Setting definitions. `synced` settings live in the event log (they follow the user across
// devices once sync exists); `device` settings live in localStorage (voice, theme...).

export const SETTINGS = [
  // ---- learning
  { key: 'wordsPerLesson', group: 'Learning', label: 'Words per lesson', type: 'int', min: 1, max: 12, def: 4, scope: 'synced' },
  { key: 'learnRepeats', group: 'Learning', label: 'Correct answers per card during a lesson', type: 'int', min: 1, max: 5, def: 2, scope: 'synced' },
  { key: 'choices', group: 'Learning', label: 'Multiple-choice options', type: 'int', min: 2, max: 8, def: 4, scope: 'synced',
    help: 'More options make reading and translation questions harder.' },
  { key: 'gridSize', group: 'Learning', label: 'Kanji grid size (multi-kanji words)', type: 'select', options: [9, 12], def: 9, scope: 'synced' },
  { key: 'drawMistakes', group: 'Learning', label: 'Drawing mistakes forgiven per card', type: 'int', min: 0, max: 5, def: 1, scope: 'synced',
    help: 'Wrong strokes beyond this mark the card as failed. Asking for a hint always fails it.' },
  { key: 'leniency', group: 'Learning', label: 'Stroke matching leniency', type: 'float', min: 0.6, max: 2, step: 0.1, def: 1, scope: 'device',
    help: 'Higher accepts sloppier strokes. Device-specific: fingers and styluses differ.' },

  // ---- scheduling
  { key: 'algorithm', group: 'Scheduling', label: 'Algorithm', type: 'select', options: ['fsrs', 'sm2'], labels: ['FSRS-5', 'SM-2 (Anki legacy)'], def: 'fsrs', scope: 'synced',
    help: 'Both are tracked for every card, so switching takes effect immediately.' },
  { key: 'retention', group: 'Scheduling', label: 'Desired retention (FSRS)', type: 'float', min: 0.7, max: 0.99, step: 0.01, def: 0.9, scope: 'synced' },
  { key: 'maxReviews', group: 'Scheduling', label: 'Maximum reviews per day', type: 'int', min: 10, max: 9999, def: 200, scope: 'synced' },
  { key: 'maxInterval', group: 'Scheduling', label: 'Maximum interval (days)', type: 'int', min: 30, max: 36500, def: 36500, scope: 'synced' },
  { key: 'rolloverHour', group: 'Scheduling', label: 'Next day starts at (hour)', type: 'int', min: 0, max: 23, def: 4, scope: 'synced' },
  { key: 'sm2StartingEase', group: 'Scheduling', label: 'SM-2 starting ease', type: 'float', min: 1.3, max: 5, step: 0.05, def: 2.5, scope: 'synced' },
  { key: 'sm2EasyBonus', group: 'Scheduling', label: 'SM-2 easy bonus', type: 'float', min: 1, max: 3, step: 0.05, def: 1.3, scope: 'synced' },
  { key: 'sm2IntervalModifier', group: 'Scheduling', label: 'SM-2 interval modifier', type: 'float', min: 0.5, max: 2, step: 0.05, def: 1, scope: 'synced' },

  // ---- audio
  { key: 'autoplay', group: 'Audio', label: 'Read words aloud automatically', type: 'bool', def: true, scope: 'device' },
  { key: 'voice', group: 'Audio', label: 'Voice', type: 'voice', def: '', scope: 'device' },
  { key: 'rate', group: 'Audio', label: 'Speech rate', type: 'float', min: 0.5, max: 1.5, step: 0.05, def: 0.9, scope: 'device' },

  // ---- display
  { key: 'theme', group: 'Display', label: 'Theme', type: 'select', options: ['system', 'light', 'dark'], def: 'system', scope: 'device' },
];

export const DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, s.def]));
export const SYNCED = new Set(SETTINGS.filter((s) => s.scope === 'synced').map((s) => s.key));
