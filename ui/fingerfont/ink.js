import {getStroke} from 'perfect-freehand';

// All editors, outlines and exports use these paper coordinates, independent of screen DPI.
export const PAPER = {width: 480, height: 240, cap: 48, waist: 96, baseline: 180};
export const GROUPS = {
  Uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  Lowercase: 'abcdefghijklmnopqrstuvwxyz',
  Numbers: '0123456789',
  Symbols: Array.from({length: 94}, (_, i) => String.fromCharCode(33 + i))
    .filter((c) => !/[a-z0-9]/i.test(c))
    .join(''),
};
export const CHARACTERS = Object.values(GROUPS).join('');

function resample(points) {
  if (points.length < 2) return points;
  const result = [points[0]];
  let remainder = 0;
  for (let i = 1; i < points.length; i++) {
    const [x, y, pressure] = points[i - 1];
    const next = points[i];
    const distance = Math.hypot(next[0] - x, next[1] - y);
    for (let offset = 1.8 - remainder; offset <= distance; offset += 1.8) {
      const t = offset / distance;
      result.push([x + (next[0] - x) * t, y + (next[1] - y) * t, pressure + (next[2] - pressure) * t]);
    }
    remainder = (remainder + distance) % 1.8;
  }
  result.push(points.at(-1));
  return result;
}

export function outline(stroke, settings) {
  const smoothness = settings.smoothness / 100;
  return getStroke(resample(stroke.points), {
    size: settings.width,
    thinning: 0.48,
    smoothing: smoothness,
    streamline: smoothness * 0.45,
    simulatePressure: !stroke.pen,
    last: true,
  });
}

export function bounds(contours) {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const contour of contours) {
    for (const [x, y] of contour) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return {left, right, top, bottom};
}

export function svgPath(contour) {
  return contour.length
    ? 'M' + contour.map(([x, y]) => x.toFixed(2) + ' ' + y.toFixed(2)).join('L') + 'Z'
    : '';
}

// A positive scale followed by a smooth shear is invertible. Applying the same
// deformation to all outlines preserves loops, crossings and disconnected dots.
export function variation(contours, character, index, strength) {
  if (!index || !strength || !contours.length) return contours;
  const seed = character.codePointAt(0) * 2.39996 + index;
  const sign = index === 1 ? -1 : 1;
  const amount = strength / 100;
  const box = bounds(contours);
  const mid = (box.left + box.right) / 2;
  return contours.map((contour) =>
    contour.map(([x, y]) => {
      const h = PAPER.baseline - y;
      const warp = Math.sin(h / 45 + seed) - Math.sin(seed);
      return [
        mid + (x - mid) * (1 + sign * 0.055 * amount) + sign * amount * (0.12 * h + 2.5 * warp),
        PAPER.baseline - h * (1 - sign * 0.045 * amount),
      ];
    }),
  );
}
