import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFor } from '../web/js/nav.js';

test('top-level screens sit directly under Home', () => {
  for (const p of ['lessons', 'kanji', 'settings', 'review', 'free', 'import'])
    assert.deepEqual(chainFor(p, ['', 'kanji', 'kanji/%E6%97%A5']), ['', p]);
  assert.deepEqual(chainFor('', ['', 'settings']), ['']);
});

test('screens open under their parent when it is in the chain', () => {
  assert.deepEqual(chainFor('learn/3', ['', 'lessons']), ['', 'lessons', 'learn/3']);
  assert.deepEqual(chainFor('kanji/x', ['', 'kanji']), ['', 'kanji', 'kanji/x']);
  assert.deepEqual(chainFor('learn/3', ['', 'kanji', 'kanji/x']), ['', 'kanji', 'kanji/x', 'learn/3']);
  assert.deepEqual(chainFor('practice/kanji:x', ['', 'kanji', 'kanji/x']), ['', 'kanji', 'kanji/x', 'practice/kanji:x']);
  assert.deepEqual(chainFor('practice/lesson:3', ['', 'lessons', 'learn/3']), ['', 'lessons', 'learn/3', 'practice/lesson:3']);
  assert.deepEqual(chainFor('import', ['', 'settings']), ['', 'settings', 'import']);
});

test('the deepest matching parent wins and siblings replace each other', () => {
  assert.deepEqual(chainFor('kanji/y', ['', 'kanji', 'kanji/x']), ['', 'kanji', 'kanji/y']);
  assert.deepEqual(chainFor('learn/4', ['', 'lessons', 'learn/3']), ['', 'lessons', 'learn/4']);
  assert.deepEqual(chainFor('learn/next', ['', 'learn/next']), ['', 'learn/next']);
});

test('deep links get their default chain', () => {
  assert.deepEqual(chainFor('kanji/x'), ['', 'kanji', 'kanji/x']);
  assert.deepEqual(chainFor('review'), ['', 'review']);
  assert.deepEqual(chainFor('practice/lesson:1'), ['', 'practice/lesson:1']);
  assert.deepEqual(chainFor('nonsense'), ['', 'nonsense']);
});
