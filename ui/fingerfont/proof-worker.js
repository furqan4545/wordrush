self.onmessage = async ({data: {version, glyphs, settings}}) => {
  try {
    const {buildFont} = await import('./font.js');
    const bytes = buildFont(glyphs, settings, 'otf', true);
    self.postMessage({version, bytes}, [bytes]);
  } catch {
    self.postMessage({version, error: 'Could not build the sentence preview.'});
  }
};
