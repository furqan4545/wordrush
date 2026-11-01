/**
 * Local screenshot-to-article import. Every paragraph comes from OCR of the
 * supplied image. No image or recognized text is uploaded to an OCR service.
 * Runtime, worker, WebAssembly core, and English model are served with the app.
 */
const OCR_ROOT = new URL('./vendor/tesseract/', import.meta.url);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;
const MAX_RUNTIME_MS = 120_000;

function abortError() {
  return new DOMException('Article import canceled.', 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

/**
 * @param {File|Blob} file JPG, PNG, or WebP screenshot of English article text.
 * @param {{onProgress?:(fraction:number,status:string)=>void,signal?:AbortSignal}} options
 * @returns {Promise<{articleText:string,width:number,height:number,confidence:number}>}
 */
export async function extractArticleText(file, { onProgress, signal } = {}) {
  checkAbort(signal);
  if (!(file instanceof Blob) || !file.size) throw new Error('Choose an article screenshot to import.');
  if (file.size > MAX_BYTES) throw new Error('Choose an article screenshot smaller than 20 MB.');
  if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP article screenshot.');
  }
  if (!globalThis.Worker || !globalThis.WebAssembly) {
    throw new Error('This browser cannot read article screenshots locally. Open the studio in Edge or Chrome.');
  }

  let progress = 0;
  let worker;
  let workerPromise;
  let imageUrl;
  let image;
  let canvas;
  let timedOut = false;
  let rejectStop;
  let timer;
  let finished = false;
  const report = (fraction, status) => {
    if (finished || signal?.aborted) return;
    progress = Math.max(progress, Math.min(1, fraction));
    onProgress?.(progress, status);
  };
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const onAbort = () => {
    worker?.terminate().catch(() => {});
    rejectStop(abortError());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => {
    timedOut = true;
    worker?.terminate().catch(() => {});
    rejectStop(new Error('Reading this article took too long. Try a sharper screenshot with fewer columns.'));
  }, MAX_RUNTIME_MS);

  const read = async () => {
    report(0.02, 'Opening your screenshot…');
    imageUrl = URL.createObjectURL(file);
    image = new Image();
    image.src = imageUrl;
    try { await image.decode(); }
    catch { throw new Error('This screenshot could not be opened. Choose a JPG, PNG, or WebP image.'); }
    checkAbort(signal);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width < 300 || height < 300) throw new Error('Use an article screenshot at least 300 × 300 pixels.');

    // Moderate upscaling helps small website type. Bound the pixel count so a
    // very long screenshot does not exhaust memory on a phone.
    const scale = Math.min(2, Math.max(1, 1800 / width), Math.sqrt(MAX_PIXELS / (width * height)));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser could not prepare the article screenshot.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    report(0.06, 'Loading the local text reader…');
    const { default: Tesseract } = await import('./vendor/tesseract/tesseract.esm.min.js');
    checkAbort(signal);
    if (timedOut) return;
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: new URL('worker.min.js', OCR_ROOT).href,
      corePath: OCR_ROOT.href,
      langPath: OCR_ROOT.href.replace(/\/$/, ''),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: (message) => {
        const portion = Math.max(0, Math.min(1, Number(message.progress) || 0));
        switch (message.status) {
          case 'loading tesseract core': report(0.08 + portion * 0.13, 'Loading the local text reader…'); break;
          case 'loading language traineddata': report(0.22 + portion * 0.17, 'Loading English article recognition…'); break;
          case 'initializing tesseract':
          case 'initializing api': report(0.40 + portion * 0.08, 'Preparing to read your article…'); break;
          case 'recognizing text': report(0.50 + portion * 0.47, 'Reading your article in this browser…'); break;
          default: break;
        }
      },
      // Tesseract otherwise throws worker errors outside its rejected promise.
      errorHandler: () => {},
    });
    // If the user cancels during initialization, terminate as soon as the
    // initialized worker becomes available rather than retaining it in the tab.
    workerPromise.then((created) => {
      if (finished || signal?.aborted || timedOut) created.terminate().catch(() => {});
    }, () => {});
    worker = await workerPromise;
    checkAbort(signal);
    if (timedOut) return;
    await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '0' });
    const result = await worker.recognize(canvas, {}, { text: true });
    checkAbort(signal);
    const articleText = String(result?.data?.text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const confidence = Number(result?.data?.confidence) || 0;
    const readableWords = articleText.match(/[A-Za-z][A-Za-z'’-]{1,}/g) || [];
    if (articleText.length < 120 || readableWords.length < 20 || confidence < 25) {
      throw new Error('We could not read enough article text. Use a sharper screenshot of English article paragraphs.');
    }
    report(1, 'Your article is ready.');
    return { articleText, width, height, confidence };
  };

  try {
    return await Promise.race([read(), stopped]);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error?.name === 'AbortError' || error?.message) throw error;
    throw new Error('The local article reader could not start. Reload the studio and try again.');
  } finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (worker) await worker.terminate().catch(() => {});
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    if (image) image.src = '';
  }
}
