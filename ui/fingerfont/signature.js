import {bounds, outline, svgPath} from './ink.js';

export function signatureSVG(strokes, settings) {
  if (!strokes.length) throw new Error('Draw your signature first.');
  const contours = strokes.map((stroke) => outline(stroke, settings));
  const box = bounds(contours);
  const padding = 8;
  const width = Math.ceil(box.right - box.left + 2 * padding);
  const height = Math.ceil(box.bottom - box.top + 2 * padding);
  const x = box.left - padding,
    y = box.top - padding;
  const background = settings.transparent
    ? ''
    : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/>`;
  const paths = contours.map((contour) => `<path d="${svgPath(contour)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">${background}<g fill="#232322">${paths}</g></svg>`;
}

export async function signatureBlob(strokes, settings, format) {
  const svg = new Blob([signatureSVG(strokes, settings)], {type: 'image/svg+xml'});
  if (format === 'svg') return svg;
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth * 4;
    canvas.height = image.naturalHeight * 4;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
