import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePhrase} from '../public/phrase.js';
import {getSearchQuery, getAudioEvents} from '../public/scene.js';

for (const [input, expected] of [
  ['How to: find me clarity', 'find me clarity'],
  ['HOW TO focus', 'focus'],
  ['How to, find me wife', 'find me wife'],
  ['How to : find me wife', 'find me wife'],
  ['find me wife', 'find me wife'],
  ['clarity', 'clarity'],
  ['show me how to focus', 'show me how to focus'],
  ['how today feels', 'how today feels'],
  ['How together works', 'How together works'],
  ['How to: how to focus', 'how to focus'],
  ['  Find me  clarity!  ', 'Find me  clarity!'],
]) {
  test(`input ${JSON.stringify(input)} renders ${JSON.stringify(expected)}`, () => {
    const parsed = parsePhrase(input);
    assert.equal(parsed.error, '');
    assert.equal(parsed.phrase, expected);
    assert.equal(getSearchQuery(parsed.phrase), expected);
  });
}

test('eight effective words are accepted without the old character limit', () => {
  const phrase = 'extraordinary experiences illuminate possibilities beyond ordinary imagination today';
  assert.ok(phrase.length > 60);
  assert.equal(parsePhrase('How to: ' + phrase).wordCount, 8);
  assert.equal(parsePhrase('How to: ' + phrase).error, '');
});

test('nine words are rejected, never truncated', () => {
  const phrase = 'one two three four five six seven eight nine';
  const parsed = parsePhrase(phrase);
  assert.equal(parsed.wordCount, 9);
  assert.match(parsed.error, /up to 8 words/u);
  assert.equal(parsed.phrase, phrase);
});

test('empty prefixes and multiline text are rejected', () => {
  for (const input of ['', ' ', 'How to:', 'how to', 'HOW TO,']) assert.ok(parsePhrase(input).error);
  assert.match(parsePhrase('How\nto: focus').error, /one line/u);
  assert.match(parsePhrase('find\nme wife').error, /one line/u);
});

test('canonical phrases are validated without stripping content a second time', () => {
  assert.equal(parsePhrase('how to focus', {stripPrefix: false}).phrase, 'how to focus');
});

test('typing events spell only the final search phrase; montage stays five seconds', () => {
  const phrase = parsePhrase('How to: find me wife').phrase;
  const schedule = getAudioEvents(phrase);
  assert.equal(schedule.typing.length, Array.from('find me wife').length);
  assert.equal(schedule.cutCount, 50);
  assert.equal(schedule.montageDuration, 5);
});
