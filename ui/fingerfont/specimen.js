// Highlight the existing text runs so contextual alternates continue to shape
// across the selected letter. Only scroll the paper itself to reveal a match.
export function highlightLetter(proof, char, reveal) {
  const ranges = [];
  const highlights = globalThis.CSS?.highlights;
  if (!char) {
    highlights?.delete('fingerfont-letter');
    return;
  }
  for (const span of proof.children) {
    const text = span.firstChild;
    if (!text) continue;
    for (let index = text.data.indexOf(char); index !== -1; index = text.data.indexOf(char, index + 1)) {
      const range = new Range();
      range.setStart(text, index);
      range.setEnd(text, index + char.length);
      ranges.push(range);
    }
  }
  if (highlights) {
    highlights.set('fingerfont-letter', new Highlight(...ranges));
  } else {
    for (const range of ranges.slice().reverse()) range.surroundContents(document.createElement('mark'));
  }
  if (!reveal || !ranges.length) return;
  const sheet = proof.parentElement;
  const viewport = sheet.getBoundingClientRect();
  const rects = ranges.map(range => range.getBoundingClientRect());
  if (rects.some(rect => rect.top >= viewport.top && rect.bottom <= viewport.bottom)) return;
  sheet.scrollTop += rects[0].top - viewport.top - (sheet.clientHeight - rects[0].height) / 2;
}
