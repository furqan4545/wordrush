// Original centerline drawings. Coordinates use a ten-unit cap height; a slash
// lifts the pen, and Q introduces a quadratic control point and endpoint.
import {bounds, CHARACTERS, PAPER} from './ink.js';

const shapes = {
  A: '0,10 3.6,0 4.2,0 8,10 / 1.4,6.5 6.5,6.5',
  B: '0,10 0,0 3.4,0 Q9,0 5.5,4 Q4.7,5 1,5 3.8,5 Q8,5 7,8 Q6.4,10 3.6,10 0,10',
  C: '7.2,1.3 Q5,-.9 2.6,.5 Q-.4,2 0,6 Q.4,11.8 5.4,9.8 Q6.5,9.3 7.3,8.4',
  D: '0,10 0,0 2.7,0 Q7.8,0 7.7,5 Q7.7,10 2.5,10 0,10',
  E: '6.6,0 0,0 0,10 6.8,10 / 0,4.8 5.2,4.8',
  F: '0,10 0,0 6.7,0 / .1,4.9 5.4,4.9',
  G: '7.6,1.4 Q5,-.9 2.7,.4 Q-.3,2 0,6 Q.3,10.6 4.5,10 Q7.2,9.8 7.5,8.6 7.5,5.6 4.5,5.6',
  H: '0,0 .1,10 / 7.3,0 7.2,10 / .2,5.2 7.2,5',
  I: '0,0 4.8,0 / 2.4,0 2.4,10 / 0,10 4.8,10',
  J: '2.2,0 6.7,0 / 5.7,0 5.7,7.4 Q5.7,11 2.3,10 Q.6,9.6 0,8',
  K: '0,0 0,10 / 6.9,0 .2,6 / 2.9,3.8 7.4,10',
  L: '0,0 .1,10 6.7,10',
  M: '0,10 .3,0 4.5,6.9 8.5,0 8.7,10',
  N: '0,10 0,0 7.3,10 7.3,0',
  O: '4.1,.1 Q.5,-.3 0,4.2 Q-.5,10.2 3.9,10.1 Q8,10.3 8,5.1 Q8.2,.4 4.1,.1',
  P: '0,10 0,.1 3.5,0 Q7.3,-.1 7.1,2.7 Q7,5.7 3.4,5.6 .1,5.6',
  Q: '4,.1 Q.2,-.3 0,4.7 Q-.4,10.1 3.9,10.1 Q8.1,10.2 8,4.9 Q8.1,.3 4,.1 / 4.9,7.3 8.8,11',
  R: '0,10 0,0 3.4,0 Q7.3,-.1 7.1,2.7 Q7,5.4 3.4,5.4 .1,5.4 / 3.3,5.4 7.5,10',
  S: '6.8,1.1 Q5.1,-.6 2.1,.2 Q-.6,1.2 .5,3.4 Q1.2,4.6 4.1,5.3 Q8.2,6.2 6.8,8.6 Q4.8,11.7 0,9',
  T: '0,.1 8,0 / 4,0 4,10',
  U: '0,0 .1,6.6 Q0,10.1 3.5,10 Q7.4,10.4 7.4,6.3 7.4,0',
  V: '0,0 3.9,10 7.8,0',
  W: '0,0 2.4,10 5.1,3 7.8,10 10.1,0',
  X: '0,0 7.4,10 / 7.3,0 0,10',
  Y: '0,0 3.9,5.5 7.6,0 / 3.9,5.5 3.9,10',
  Z: '0,0 7.3,0 .1,10 7.5,10',
  a: '5.1,4.4 Q3.7,2.8 1.5,4 Q-.6,5.4 .2,8.5 Q.9,11.3 3.4,9.5 Q4.8,8.5 5.2,5.5 / 5.3,3.6 5.2,8.7 Q5.2,10.4 6.3,9.8',
  b: '.1,0 0,10 / .2,6.5 Q1.3,3.3 3.6,3.6 Q6.5,3.9 5.5,7.5 Q4.6,11 1.7,9.9 Q.5,9.5 .1,8.4',
  c: '5.2,4.4 Q3.5,2.8 1.5,4.1 Q-.4,5.5 .1,8 Q.8,11.4 4.2,9.7 5.3,9',
  d: '5.1,4.4 Q3.4,2.8 1.4,4.1 Q-.6,5.6 .2,8.5 Q1.2,11.3 3.8,9.2 Q5,8.1 5.1,6.3 / 5.4,0 5.2,8.5 Q5.1,10.3 6.2,9.9',
  e: '.2,7.2 Q3.8,7 4.8,5.7 Q6.2,3.3 3.4,3.5 Q.7,3.7 .2,6.3 Q-.6,9.4 2.1,10 Q4.2,10.6 5.8,8.9',
  f: '.5,10 2,2.2 Q2.6,-.8 5.1,.2 / 0,4.2 4.6,4.1',
  g: '5.3,4.6 Q3.6,2.7 1.5,4 Q-.5,5.4 .1,8 Q1.1,11.2 3.9,9.1 Q5.1,7.9 5.2,5.6 / 5.4,3.6 5.1,10.5 Q4.7,15.3 .7,12.8',
  h: '.1,0 0,10 / .1,7.8 Q1.5,3.5 3.8,3.6 Q5.5,3.7 5.3,6.3 5.1,9.9',
  i: '1,3.6 .8,8.7 Q.7,10.3 2,9.9 / 1.2,1 1.25,.9',
  j: '3,3.6 2.7,10.7 Q2.5,14.8 0,13 / 3.1,1 3.15,.9',
  k: '.2,0 0,10 / 5.1,3.7 .3,7.8 / 2.4,6.2 5.6,10',
  l: '1.2,0 .8,8.3 Q.6,10.6 2.6,9.8',
  m: '.1,3.7 0,10 / .1,7.6 Q1.4,3.5 3.2,3.6 Q4.5,3.7 4.2,6.1 4,10 / 4.2,7.3 Q5.7,3.4 7.4,3.6 Q8.8,3.7 8.5,6.3 8.2,10',
  n: '.2,3.7 0,10 / .1,7.9 Q1.8,3.4 4,3.6 Q5.7,3.8 5.4,6.3 5.2,10',
  o: '3.2,3.6 Q.4,3.3 0,6.5 Q-.4,10.1 2.7,10 Q5.9,10.1 5.9,6.6 Q5.9,3.8 3.2,3.6',
  p: '.3,3.7 0,13.7 / .2,6.5 Q1.7,3 4,3.7 Q6.2,4.3 5.3,7.4 Q4.1,11 1.1,9.5 .3,8.9',
  q: '5.1,4.6 Q3.3,2.7 1.3,4.2 Q-.4,5.5 .2,8.5 Q1.1,11.2 3.6,9.3 Q4.7,8.4 5.1,6.1 / 5.3,3.6 5,13.7',
  r: '.3,3.7 0,10 / .1,7.4 Q1.8,2.8 4.4,3.8',
  s: '4.9,4.2 Q3.4,3.1 1.9,3.7 Q-.2,4.4 .7,5.8 Q1.3,6.6 3.4,7.1 Q5.9,7.9 4.4,9.4 Q2.7,11 0,9.2',
  t: '2.5,1.4 2.1,8 Q1.9,11 5,9.3 / 0,4 4.8,3.9',
  u: '.4,3.7 .1,7.4 Q-.2,10.5 2.2,9.9 Q4.1,9.4 5.3,5.7 / 5.6,3.6 5.2,8.8 Q5.2,10.3 6.2,9.9',
  v: '0,3.6 2.6,10 5.7,3.6',
  w: '0,3.6 1.6,10 4,5.5 5.7,10 8.2,3.6',
  x: '.1,3.7 5.5,10 / 5.5,3.6 0,10',
  y: '0,3.6 2.8,9.9 / 5.8,3.6 2.1,11.9 Q1.1,14.5 -.6,13.3',
  z: '.2,3.7 5.3,3.7 .1,9.9 5.5,9.9',
  '0': '3.6,0 Q.6,0 .1,4.6 Q-.6,10 3.1,10 Q6.5,10 7,5 Q7.6,0 3.6,0',
  '1': '0,2.4 3.2,0 3,10 / .6,10 5.5,10',
  '2': '0,2 Q1.1,-.4 3.8,0 Q7.6,.3 5.8,3.8 Q4.7,5.9 .1,9.9 6.9,9.9',
  '3': '.1,1 Q2.5,-.7 5,.3 Q8,2.1 4.9,4.3 3,5 Q7.8,4.9 6.6,8.1 Q5.2,11.6 0,9',
  '4': '5.2,10 5.3,0 0,6.8 7.2,6.8',
  '5': '6.3,0 1.3,0 .8,4.6 Q3.3,3.2 5.3,4.7 Q8.3,7.1 5.1,9.5 Q2.7,11.1 0,9',
  '6': '5.8,.1 Q1.3,.6 .2,5.7 Q-.6,10.2 3.5,10 Q7.1,10 6.6,6.8 Q6,3.8 2.7,4.7 Q1.1,5.2 .2,6.7',
  '7': '0,.1 7,0 2.1,10',
  '8': '3.4,4.8 Q-.8,2.7 1,.8 Q3.1,-1.1 5.4,.6 Q8.2,2.8 3.4,4.8 Q-1.8,7.4 .9,9.5 Q3.5,11.2 6,9.3 Q8.5,7 3.4,4.8',
  '9': '6.4,4.1 Q4.7,6.4 2.4,5.7 Q-.4,5 .2,2.5 Q1,-.6 4.1,.1 Q7.4,.8 6.1,5.5 Q5.2,8.8 2.1,10',
  '!': '1,0 .8,7 / .8,9.7 .9,9.8',
  '"': '.4,0 0,2.6 / 2.8,0 2.4,2.6',
  '#': '2.5,.8 1,9.4 / 6.2,.8 4.7,9.4 / .4,3.8 7.5,3.8 / 0,6.7 7,6.7',
  '$': '6.1,2.5 Q3,.2 .9,2.6 Q-.8,4.6 3.4,5.5 Q7,6.5 5.9,8.5 Q4.2,10.5 .1,8.5 / 3.5,-.6 3.2,11.3',
  '%': '7.8,.4 0,9.8 / 2.1,.6 Q-.1,.5 .1,2.6 Q.2,4.8 2.2,4.4 Q4,3.8 3.7,2 Q3.5,.6 2.1,.6 / 6.3,6 Q4.5,5.8 4.5,7.8 Q4.5,10.2 6.5,9.8 Q8.2,9.5 8,7.4 Q7.7,6 6.3,6',
  '&': '7.7,5.4 Q5.3,10.4 2.6,10 Q-.4,9.8 .1,7.6 Q.3,6.2 3.2,4.4 Q7.1,1.3 4.3,.3 Q2.1,-.4 1.8,1.7 Q1.6,4 7.9,10',
  "'": '1,0 0,2.8',
  '(': '3.3,-.5 Q-2.6,5.1 3,11.6',
  ')': '0,-.5 Q5.8,5.1 .3,11.6',
  '*': '3.1,.1 3,5.5 / .3,1.5 5.6,4.2 / .3,4.2 5.6,1.5',
  '+': '0,5.8 7,5.8 / 3.5,2.2 3.5,9.3',
  ',': '1.2,9.1 Q1.1,10.8 0,11.9',
  '-': '0,6.4 4.2,6.3',
  '.': '.1,9.8 .2,9.8',
  '/': '6.1,-.2 0,10.8',
  ':': '.3,4.2 .4,4.2 / .1,9.5 .2,9.5',
  ';': '1,4.2 1.1,4.2 / 1.1,9 Q1,10.8 0,11.7',
  '<': '6.5,2 0,5.6 6.4,9.2',
  '=': '0,4.1 6.8,4.1 / 0,7 6.8,7',
  '>': '0,2 6.5,5.6 .1,9.2',
  '?': '0,1.8 Q1,-.4 3.7,.1 Q7.9,1 5.3,4.2 Q4.7,5 3.2,5.9 Q2.8,6.4 2.8,7.3 / 2.7,9.8 2.8,9.8',
  '@': '6.8,4 Q4.5,2.7 3.1,4.8 Q1.7,7.1 3.8,7.8 Q5.5,8.2 6.7,4.7 / 6.9,3.7 6.3,6.6 Q6,8.6 8.1,7.7 Q10.9,6.2 9,2.7 Q7.3,-.7 3.5,.6 Q-.5,2 0,6.6 Q.3,11.4 6.6,9.8',
  '[': '3.2,0 0,0 0,10.8 3.2,10.8',
  '\\': '0,-.2 6.1,10.8',
  ']': '0,0 3.2,0 3.2,10.8 0,10.8',
  '^': '0,4.7 3.1,.5 6.1,4.7',
  '_': '0,11.5 7.5,11.5',
  '`': '0,0 1.7,2.3',
  '{': '4.3,-.3 Q2,-.4 2.3,2.6 Q2.7,5.1 .1,5.4 Q2.5,5.8 2.1,8.2 Q1.7,11.4 4.1,11.4',
  '|': '0,-.8 0,11.4',
  '}': '0,-.3 Q2.4,-.4 2.1,2.6 Q1.7,5.1 4.3,5.4 Q1.9,5.8 2.3,8.2 Q2.7,11.4 .2,11.4',
  '~': '0,6 Q1.6,3.6 3.7,5.4 Q5.8,7.3 7.6,5',
};

function centerlines(shape) {
  return shape.split(' / ').map((line) => {
    const tokens = line.split(' ');
    const points = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const pair = token.replace(/^Q/, '').split(',').map(Number);
      if (!token.startsWith('Q')) { points.push(pair); continue; }
      const start = points.at(-1);
      const end = tokens[++i].split(',').map(Number);
      for (let step = 1; step <= 8; step++) {
        const t = step / 8, s = 1 - t;
        points.push(end.map((v, axis) => s*s*start[axis] + 2*s*t*pair[axis] + t*t*v));
      }
    }
    return points;
  });
}

const base = Object.fromEntries(Object.entries(shapes).map(([c, shape]) => [c, centerlines(shape)]));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
function median(values, fallback) {
  if (!values.length) return fallback;
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
// Estimate stem lean from near-vertical segments, weighted by vertical travel
// so that a densely sampled corner does not outweigh a long pen stroke.
function lean(lines) {
  let sum = 0, weight = 0;
  for (const points of lines) for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i-1][0], dy = points[i][1] - points[i-1][1];
    if (!dy || Math.abs(dx) > .65 * Math.abs(dy)) continue;
    sum -= dx / dy * Math.abs(dy);
    weight += Math.abs(dy);
  }
  return weight ? sum / weight : 0;
}

export const MIN_SAMPLES = 2;

export function generateSet(drawings) {
  const samples = [...CHARACTERS].filter(c => drawings[c]?.length);
  if (samples.length < MIN_SAMPLES) throw new Error('Draw two distinct characters first.');
  const widths = [], heights = [], leans = [], offsets = [], pressures = [];
  for (const c of samples) {
    const lines = drawings[c].map(stroke => stroke.points);
    const box = bounds(lines), ref = bounds(base[c]);
    if (ref.right - ref.left > 1 && box.right - box.left > 3)
      widths.push((box.right - box.left) / (ref.right - ref.left));
    if (ref.bottom - ref.top > 2 && box.bottom - box.top > 4)
      heights.push((box.bottom - box.top) / (ref.bottom - ref.top));
    leans.push(lean(lines) - lean(base[c]));
    offsets.push(box.bottom - PAPER.baseline - (ref.bottom - 10) * 13.2);
    for (const stroke of drawings[c]) if (stroke.pen) pressures.push(median(stroke.points.map(p => p[2]), .5));
  }
  const sx = clamp(median(widths, 13.2), 6, 24);
  const sy = clamp(median(heights, 13.2), 7, 15);
  const skew = clamp(median(leans, 0), -.4, .4);
  const baseline = PAPER.baseline + clamp(median(offsets, 0), -20, 8);
  const pressure = clamp(median(pressures, .5), .12, 1);

  return Object.fromEntries([...CHARACTERS].map(c => {
    const lines = base[c], box = bounds(lines);
    const mid = (box.left + box.right) / 2;
    // These letters have the same construction in either case. Keep the
    // writer's actual contour and pressure profile when its partner is known.
    const partner = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
    if (/^[cosvwxz]$/i.test(c) && drawings[partner]?.length) {
      const original = drawings[partner];
      const src = bounds(original.map(stroke => stroke.points));
      const height = src.bottom - src.top;
      if (height > 4) {
        const scale = (box.bottom - box.top) * sy / height;
        const center = (src.left + src.right) / 2;
        const top = baseline + (box.top - 10) * sy;
        return [c, original.map(stroke => ({
          pen: stroke.pen,
          points: stroke.points.map(([x, y, p]) => [
            clamp(PAPER.width / 2 + (x - center) * scale, 2, PAPER.width - 2),
            clamp(top + (y - src.top) * scale, 2, PAPER.height - 2), p,
          ]),
        }))];
      }
    }
    const strokes = lines.map(line => ({
      pen: pressures.length > 0,
      points: line.map(([x,y]) => [
        PAPER.width / 2 + (x - mid) * sx + skew * (10 - y) * sy,
        clamp(baseline + (y - 10) * sy, 2, PAPER.height - 2),
        pressure,
      ]),
    }));
    return [c, strokes];
  }));
}
