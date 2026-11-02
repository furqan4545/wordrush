// The editor and MP4 composition share this renderer and timing model.
export const FPS = 30;
export const TYPING_START = 4.05;
export const DEFAULT_DELAY = 1;
export const SOURCE_DURATION = 236 / FPS;
export const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
export const splitText = value => Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(String(value)), part => part.segment);

export function getTiming(text, pace = 'natural', sourceDuration = SOURCE_DURATION, delay = DEFAULT_DELAY, speed = 1) {
  const letters = splitText(text);
  const base = {natural: .14, quick: .087, slow: .21}[pace] ?? .14;
  const baseFirstKey = TYPING_START + delay;
  let at = baseFirstKey;
  const baseEvents = letters.map((letter, index) => {
    if (index === 0) return at;
    const variation = .78 + ((letter.codePointAt(0) * 17 + index * 29) % 47) / 100;
    at += base * variation * (/[./:]/u.test(letter) ? 1.3 : 1);
    return at;
  });
  const baseFinished = Math.max(baseFirstKey + .75, at);
  const enter = (at + .2) / speed;
  const duration = Math.ceil(Math.max(Math.max(sourceDuration, baseFinished + 1.15) / speed, enter + .45) * FPS) / FPS;
  const baseDuration = duration * speed;
  return {letters, events: baseEvents.map(event => event / speed), firstKey: baseFirstKey / speed,
    focus: TYPING_START / speed, delay, speed, enter, finished: baseFinished / speed,
    duration, baseDuration, sourceDuration, tailRate: (sourceDuration - TYPING_START) / (baseDuration - TYPING_START)};
}

export function getSourceTime(time, timing) {
  const baseTime = time * timing.speed;
  return Math.min(timing.sourceDuration - 1 / FPS, baseTime <= TYPING_START ? baseTime : TYPING_START + (baseTime - TYPING_START) * timing.tailRate);
}

export function getOutputTime(sourceTime, timing) {
  return (sourceTime <= TYPING_START ? sourceTime : TYPING_START + (sourceTime - TYPING_START) / timing.tailRate) / timing.speed;
}

export function getTextState(time, timing) {
  let count = 0;
  while (count < timing.events.length && timing.events[count] <= time) count++;
  const waiting = time < timing.firstKey;
  const settle = .25 / timing.speed;
  const blinkFrom = waiting ? timing.focus : timing.finished + settle;
  return {text: timing.letters.slice(0, count).join(''), count,
    caret: time >= timing.focus && ((!waiting && time < timing.finished + settle) || Math.floor((time - blinkFrom) * timing.speed / .53) % 2 === 0)};
}

function quadPoint(q, u, v) {
  // Projective unit-square -> tracked planar quadrilateral.
  const [p0, p1, p2, p3] = q;
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = Math.abs(denominator) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator;
  const z = g * u + h * v + 1;
  return [((p1[0] - p0[0] + g * p1[0]) * u + (p3[0] - p0[0] + h * p3[0]) * v + p0[0]) / z,
    ((p1[1] - p0[1] + g * p1[1]) * u + (p3[1] - p0[1] + h * p3[1]) * v + p0[1]) / z];
}

function triangle(ctx, image, src, dest) {
  const [a, b, c] = src, [p, q, r] = dest;
  const d = a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]);
  if (Math.abs(d) < 1e-9) return;
  const coefficients = axis => [
    (p[axis] * (b[1] - c[1]) + q[axis] * (c[1] - a[1]) + r[axis] * (a[1] - b[1])) / d,
    (p[axis] * (c[0] - b[0]) + q[axis] * (a[0] - c[0]) + r[axis] * (b[0] - a[0])) / d,
    (p[axis] * (b[0] * c[1] - c[0] * b[1]) + q[axis] * (c[0] * a[1] - a[0] * c[1]) + r[axis] * (a[0] * b[1] - b[0] * a[1])) / d,
  ];
  const x = coefficients(0), y = coefficients(1);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.lineTo(...r); ctx.closePath(); ctx.clip();
  ctx.transform(x[0], y[0], x[1], y[1], x[2], y[2]);
  ctx.drawImage(image, 0, 0); ctx.restore();
}

let plate;
export function drawOverlay(ctx, {time, text, pace = 'natural', delay = DEFAULT_DELAY, speed = 1, tracking, cameraTime, timing: preparedTiming}) {
  ctx.clearRect(0, 0, 1080, 1920);
  if (!tracking) return;
  const timing = preparedTiming ?? getTiming(text, pace, tracking.duration, delay, speed);
  if (time < timing.focus) return;
  // Preview geometry follows the exact decoded frame being presented. Export
  // callers retain their existing deterministic output-time mapping by default.
  const sourceTime = Number.isFinite(cameraTime) ? cameraTime : getSourceTime(time, timing);
  const entry = tracking.frames[Math.min(tracking.frames.length - 1, Math.round(sourceTime * tracking.fps))];
  if (!entry?.quad) return;
  const spec = tracking.plane ?? {width: tracking.planeWidth ?? 608, height: tracking.planeHeight ?? 38, textX: tracking.textX ?? 26, baseline: tracking.textBaseline ?? 24, fontSize: tracking.fontSize ?? 13};
  const width = spec.width, height = spec.height, density = 3;
  plate ??= document.createElement('canvas');
  if (plate.width !== width * density || plate.height !== height * density) {plate.width = width * density; plate.height = height * density;}
  const p = plate.getContext('2d');
  p.setTransform(density, 0, 0, density, 0, 0); p.clearRect(0, 0, width, height);
  const state = getTextState(time, timing);
  p.save(); p.beginPath(); p.rect(spec.textX - 1, 2, width - spec.textX - 14, height - 4); p.clip();
  p.font = `400 ${spec.fontSize}px ${SYSTEM_FONT}`;
  p.textBaseline = 'alphabetic';
  const measured = p.measureText(state.text).width;
  // The right end of this real Safari field is outside the camera frame.
  // Keep the active insertion point within the filmed portion for long URLs.
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const u = (low + high) / 2;
    if (quadPoint(entry.quad, u, .5)[0] < 1063) low = u; else high = u;
  }
  const available = Math.min(width - 22, width * low - 10) - spec.textX;
  const scroll = Math.max(0, measured - available);
  p.fillStyle = spec.textColor ?? '#53565b';
  // Match the slightly soft filmed screen, including the native character proportions.
  p.filter = `blur(${spec.blur ?? .17}px)`;
  p.fillText(state.text, spec.textX - scroll, spec.baseline);
  if (state.caret) {
    p.fillStyle = spec.caretColor ?? '#7f98b8';
    p.fillRect(spec.textX + measured - scroll + .65, spec.baseline - spec.fontSize + 1, .8, spec.fontSize + 1);
  }
  p.restore();
  // A fine mesh keeps text attached to the filmed screen's true perspective.
  const columns = 16, rows = 2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const u = x / columns, v = y / rows, u1 = (x + 1) / columns, v1 = (y + 1) / rows;
    const a = [u * plate.width, v * plate.height], b = [u1 * plate.width, v * plate.height], c = [u1 * plate.width, v1 * plate.height], d = [u * plate.width, v1 * plate.height];
    const qa = quadPoint(entry.quad, u, v), qb = quadPoint(entry.quad, u1, v), qc = quadPoint(entry.quad, u1, v1), qd = quadPoint(entry.quad, u, v1);
    triangle(ctx, plate, [a, b, c], [qa, qb, qc]);
    triangle(ctx, plate, [a, c, d], [qa, qc, qd]);
  }
}
