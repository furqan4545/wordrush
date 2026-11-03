import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS, normalizeSettings, getDuration, createScene, getActiveLine} from '../public/paper-trail/engine.js';

test('normalization retains complete Unicode text and entered colors', () => {
  const phrase = '한 번의 생각, a new beginning — 你好';
  const s = normalizeSettings({lines: [phrase, '', 'second line'], accent: '#AbC', ink: '#123456', mode: 'topdown'});
  assert.deepEqual(s.lines, [phrase, 'second line']);
  assert.equal(s.accent, '#AbC'); assert.equal(s.ink, '#123456'); assert.equal(s.mode, 'topdown');
  assert.deepEqual(DEFAULTS.lines, ['My name is', 'Ali and I will blow', 'Your mind']);
});

test('timing includes each phrase and final hold, with stable final selection', () => {
  const scene = createScene({lines: ['One', 'Two', 'Three'], pace: 2, hold: 1.25});
  assert.equal(getDuration(scene.settings), 7.25);
  assert.equal(getActiveLine(scene, -2), 0);
  assert.equal(getActiveLine(scene, 1.99), 0);
  assert.equal(getActiveLine(scene, 2), 1);
  assert.equal(getActiveLine(scene, 4), 2);
  assert.equal(getActiveLine(scene, 100), 2);
});

test('long phrases and unbroken strings wrap without dropping content', () => {
  for (const phrase of ['A long phrase with enough words to span several lines and remain fully visible in the finished video', 'https://example.com/' + 'abcdefghij'.repeat(32), '한글텍스트'.repeat(30)]) {
    const scene = createScene({lines: [phrase], textSize: 70});
    const item = scene.layout[0];
    assert.ok(item.rows.length > 1);
    assert.equal(item.rows.join('').replace(/\s/g, ''), phrase.replace(/\s/g, ''));
    assert.ok(item.widths.every((width) => width <= 810.001));
  }
});

test('twenty stops receive separate paper positions and seeded repeatable geometry', () => {
  const lines = Array.from({length:20}, (_, i) => `This is phrase ${i + 1}`);
  const a = createScene({lines, seed: 94});
  const b = createScene({lines, seed: 94});
  assert.deepEqual(a.layout, b.layout);
  assert.equal(a.layout.length, 20);
  assert.ok(a.layout.every((item, i) => !i || item.y > a.layout[i - 1].y + item.height));
  assert.ok(a.layout.slice(1).every((item) => item.connector.length === 101));
});

test('output dimensions and controls validate independently', () => {
  assert.equal(createScene({aspect:'1:1'}).height, 720);
  assert.equal(createScene({aspect:'16:9'}).height, 405);
  assert.equal(createScene({aspect:'4:5'}, {width:1080}).height, 1350);
  assert.equal(createScene(DEFAULTS, {width:1080,height:1920}).height, 1920);
  const s = normalizeSettings({pace: -10, hold: 999, textSize: Infinity, arrowSize: 0, texture: -1, accent:'url(example)', paper:'aged'});
  assert.equal(s.pace, 0.6); assert.equal(s.hold, 5); assert.equal(s.textSize, 54);
  assert.equal(s.arrowSize, 0.3); assert.equal(s.texture, 0); assert.equal(s.accent, DEFAULTS.accent); assert.equal(s.paper, 'aged');
});

test('empty editing state is supported without inventing replacement text', () => {
  const scene = createScene({lines:[]});
  assert.equal(scene.layout.length, 0); assert.equal(getActiveLine(scene,0), -1); assert.ok(scene.duration > 0);
  scene.dispose();
});

test('inline phrase bands do not share body-copy baselines', () => {
  const scene = createScene({lines:['A short selection', 'A much longer phrase that wraps into several lines so its complete block needs clean surrounding paper'], textSize:70});
  assert.equal(scene.reservedBands.length, 2);
  for (const paragraph of scene.paragraphs) {
    assert.ok(scene.reservedBands.every((band) => paragraph.y < band.top || paragraph.y > band.bottom), `body baseline ${paragraph.y} overlaps a phrase`);
  }
  assert.ok(scene.paragraphs.length > 20, 'the rest of the paper retains its running copy');
});

test('every motion control preserves explicit values, including disabled effects and asymmetric easing', () => {
  const raw = {curve:0,curveDirection:'alternate',travel:.88,easeIn:.7,easeOut:.65,cameraSmooth:0,paperMotion:0,paperSpeed:1.4,edgeBlur:0,blurWidth:.45,focusY:.32,spacing:1.7,frameRate:60};
  const normalized = normalizeSettings(raw);
  for (const [key,value] of Object.entries(raw)) assert.equal(normalized[key],value,`${key} must remain the value the user entered`);
  const restored = normalizeSettings(JSON.parse(JSON.stringify(normalized)));
  for (const [key,value] of Object.entries(raw)) assert.equal(restored[key],value,`${key} must survive saving and reloading`);
  assert.equal(normalizeSettings({frameRate:30}).frameRate,30);
  assert.equal(normalizeSettings({frameRate:123}).frameRate,DEFAULTS.frameRate);
  const defaults = normalizeSettings({});
  for (const key of Object.keys(raw)) assert.notEqual(defaults[key],undefined,`${key} needs a usable initial value`);
});

test('motion controls reject nonnumeric and out-of-range values without introducing invalid geometry', () => {
  const settings = normalizeSettings({curve:-1,curveDirection:'unknown',travel:5,easeIn:-10,easeOut:5,cameraSmooth:Infinity,paperMotion:NaN,paperSpeed:-1,edgeBlur:4,blurWidth:-5,focusY:2,spacing:0});
  const expected={curve:0,travel:.9,easeIn:.1,easeOut:.75,paperSpeed:.2,edgeBlur:1,blurWidth:.1,focusY:.7,spacing:1};
  for (const [key,value] of Object.entries(expected)) assert.equal(settings[key],value,`${key} is clamped to its documented range`);
  assert.equal(settings.curveDirection,DEFAULTS.curveDirection);
  assert.equal(settings.cameraSmooth,DEFAULTS.cameraSmooth);
  assert.equal(settings.paperMotion,DEFAULTS.paperMotion);
});
