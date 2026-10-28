/** Reflow the editable paragraph over its once-captured website background. */
export function prepareTemplate(source, phrase, makeCanvas) {
  const t = source.template;
  if (!t) return source;
  const p = t.paragraph, image = source.img;
  const surface = makeCanvas(image.width, image.height), c = surface.getContext('2d');
  c.drawImage(image, 0, 0);
  const before = t.before.trim().replace(/\s+/gu, ' ');
  const after = t.after.trim().replace(/\s+/gu, ' ');
  const atoms = [
    ...before.split(' ').filter(Boolean).map(value => ({text: value, target: false})),
    {text: phrase, target: true},
    ...after.split(' ').filter(Boolean).map(value => ({text: value, target: false})),
  ];
  const nativeSize = Number(p.fontSize) || 16;
  const nativeLine = Number(p.lineHeight) || nativeSize * 1.4;
  const font = scale => {
    c.font = `${p.fontStyle || 'normal'} ${p.fontWeight || '400'} ${nativeSize * scale}px ${p.fontFamily || 'Arial, sans-serif'}`;
    if ('letterSpacing' in c) c.letterSpacing = `${(Number(p.letterSpacing) || 0) * scale}px`;
  };
  const layout = scale => {
    font(scale);
    const space = c.measureText(' ').width, indent = (Number(p.textIndent) || 0) * scale;
    const lines = [];
    let current = {atoms: [], width: 0, indent};
    for (const atom of atoms) {
      const width = c.measureText(atom.text).width;
      if (current.atoms.length && current.width + space + width > p.width - current.indent) {
        lines.push(current);
        current = {atoms: [], width: 0, indent: 0};
      }
      if (current.atoms.length) current.width += space;
      current.atoms.push({...atom, width});
      current.width += width;
    }
    if (current.atoms.length) lines.push(current);
    return {lines, space, height: lines.length * nativeLine * scale,
      widest: Math.max(...lines.map(line => line.width + line.indent))};
  };
  // Keep the phrase on one line and all rewritten text inside the original box.
  let scale = 1, result = layout(scale);
  if (result.height > p.height + 2 || result.widest > p.width) {
    let low = .08, high = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (low + high) / 2, candidate = layout(mid);
      if (candidate.height <= p.height + 2 && candidate.widest <= p.width) low = mid;
      else high = mid;
    }
    scale = low; result = layout(scale);
  }
  font(scale);
  c.fillStyle = p.color || '#333';
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  const lineHeight = nativeLine * scale;
  const firstBaseline = (Number(p.baselineOffset) || nativeSize * .82 + (nativeLine - nativeSize) / 2) * scale;
  let anchor;
  result.lines.forEach((line, index) => {
    const available = p.width - line.indent;
    const alignOffset = p.textAlign === 'center' ? (available - line.width) / 2 :
      ['right', 'end'].includes(p.textAlign) ? available - line.width : 0;
    const justify = p.textAlign === 'justify' && index < result.lines.length - 1 && line.atoms.length > 1 ?
      Math.max(0, available - line.width) / (line.atoms.length - 1) : 0;
    let x = p.x + line.indent + alignOffset;
    const y = p.y + firstBaseline + index * lineHeight;
    line.atoms.forEach((atom, atomIndex) => {
      c.fillText(atom.text, x, y);
      if (atom.target) {
        const metrics = c.measureText(atom.text);
        const ascent = metrics.actualBoundingBoxAscent || nativeSize * scale * .8;
        const descent = metrics.actualBoundingBoxDescent || nativeSize * scale * .2;
        anchor = {x, y: y - ascent, width: atom.width, height: Math.max(1, ascent + descent)};
      }
      x += atom.width + (atomIndex < line.atoms.length - 1 ? result.space + justify : 0);
    });
  });
  return {...source, img: surface, anchor, insertedText: phrase, matchedText: phrase,
    excerpt: `${before} ${phrase} ${after}`, templateScale: scale};
}
