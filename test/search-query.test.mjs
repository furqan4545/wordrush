import test from 'node:test';
import assert from 'node:assert/strict';
import {drawScene, getAudioEvents, getTiming, getVisibleQuery} from '../public/scene.js';
import {parsePhrase} from '../public/phrase.js';

function recordFrame(options) {
  const text = [];
  const context = new Proxy({
    fillText: value => text.push(value),
    measureText: value => ({width: String(value).length * 16}),
    createLinearGradient: () => ({addColorStop() {}}),
    createRadialGradient: () => ({addColorStop() {}}),
  }, {get: (target, property) => target[property] ?? (() => {})});
  const canvas = () => ({width: 1080, height: 1920, getContext: () => context});
  const assets = {stage: canvas(), screen: canvas(), surface: canvas(), frame: canvas(),
    chromePhoto: {width: 1759, height: 986}, sites: []};
  drawScene(context, {...options, assets});
  return text;
}

test('the opening types the complete user query while the montage phrase is separate', () => {
  const word = 'become great', query = 'how to become great';
  const timing = getTiming(query);
  const visibleText = recordFrame({word, query, time: timing.enter - 1 / 30});
  assert.ok(visibleText.includes(query));
  assert.ok(!visibleText.includes('Preparing website frames…'));
  assert.equal(getVisibleQuery(timing.enter, query), query);
  assert.equal(getAudioEvents(query).typing.length, Array.from(query).length);
});

test('an input without how to receives no added prefix', () => {
  const query = 'become great';
  const visibleText = recordFrame({word: query, query, time: getTiming(query).enter});
  assert.ok(visibleText.includes(query));
  assert.ok(!visibleText.includes('how to become great'));
  assert.equal(getVisibleQuery(getTiming(query).enter, query), query);
});

test('a trailing question mark stays in the typed intro and is removed only from the montage phrase', () => {
  const {phrase: word, query, error} = parsePhrase('how to become great?');
  assert.equal(error, '');
  assert.equal(word, 'become great');
  assert.equal(query, 'how to become great?');
  const visibleText = recordFrame({word, query, time: getTiming(query).enter});
  assert.ok(visibleText.includes(query));
  assert.ok(visibleText.includes('how to become great?'));
  assert.ok(!word.includes('?'));
  assert.equal(getAudioEvents(query).typing.length, Array.from(query).length);
});

test('longer search text controls the intro boundary and keeps all fifty cuts at five seconds', () => {
  const word = 'become great', query = 'how to become great';
  const events = getAudioEvents(query);
  assert.ok(events.intro > getTiming(word).intro);
  assert.equal(Math.round((events.duration - events.intro) * 30), 150);
  assert.equal(events.cuts.length, 50);
  assert.equal(events.cuts[0], events.intro);
  assert.equal(Math.round((events.cuts.at(-1) + events.cutDuration - events.intro) * 30), 150);
  assert.ok(recordFrame({word, query, time: events.intro - 1 / 30}).includes(query));
  assert.ok(recordFrame({word, query, time: events.intro}).includes('Preparing website frames…'));
});

test('legacy scene callers default the search query to the montage phrase', () => {
  const word = 'find me clarity';
  assert.deepEqual(
    recordFrame({word, time: getTiming(word).enter}),
    recordFrame({word, query: word, time: getTiming(word).enter}),
  );
});
