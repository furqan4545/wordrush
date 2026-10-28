import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access, mkdir, readFile, readdir, rename, stat, writeFile} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {parsePhrase, MAX_WORDS} from './public/phrase.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const EXPORTS = path.join(ROOT, 'exports');
const PREVIEW_AUDIO = path.join(ROOT, 'preview-audio', 'direct-phrase-v8');
const previewAudioJobs = new Map();
const PORT = Number(process.env.WORD_STUDIO_PORT || 4321);
const HOST = '127.0.0.1';
const CAPTURES = path.join(PUBLIC, 'captures', 'placed-v3');
const REQUIRED_SITES = 50;
function selectSources(sources) {
  const wikipedia = sources.find(s => s.domain === 'wikipedia.org');
  const dictionary = sources.find(s => /dictionary|wordnik|vocabulary|wordreference|wordsmyth/iu.test(s.domain));
  const unique = new Map();
  for (const source of [wikipedia, dictionary, ...sources]) if (source && !unique.has(source.domain)) unique.set(source.domain, source);
  return [...unique.values()].slice(0, REQUIRED_SITES);
}
const jobs = new Map();
const queue = [];
let rendering = false;
let bundlePromise;

await mkdir(EXPORTS, {recursive: true});
for (const filename of await readdir(EXPORTS)) {
  if (!/^[\da-f-]{36}\.json$/.test(filename)) continue;
  try {
    const job = JSON.parse(await readFile(path.join(EXPORTS, filename), 'utf8'));
    if (!job || typeof job !== 'object' || Array.isArray(job) ||
        !/^[\da-f-]{36}$/.test(job.id) || job.id !== filename.slice(0, -5) ||
        typeof job.word !== 'string' || typeof job.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(job.createdAt)) || typeof job.filename !== 'string' ||
        /[\u0000-\u001f\u007f]/u.test(job.filename) || !job.filename.isWellFormed() ||
        !['queued', 'capturing', 'rendering', 'complete', 'error'].includes(job.status)) continue;
    if (job.status === 'complete') await access(path.join(EXPORTS, `${job.id}.mp4`));
    else if (['rendering', 'capturing', 'queued'].includes(job.status)) {
      job.status = 'error';
      job.error = 'The app closed before this export finished. Please create it again.';
    }
    jobs.set(job.id, job);
  } catch { /* Ignore incomplete metadata; never replace an existing export. */ }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function json(res, status, payload) {
  res.writeHead(status, {'Content-Type': mime['.json'], 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(payload));
}

function publicJob(job) {
  const {id, word, intensity, status, progress, stage, createdAt, completedAt, filename, error, duration, warning, sources, sourceCount, version} = job;
  return {id, word, intensity, status, progress, stage, createdAt, completedAt, filename, error, duration, warning, sources, sourceCount, version,
    ...(status === 'complete' ? {url: `/exports/${id}.mp4`} : {}),
  };
}

const sourceKey = word => createHash('sha256').update(word).digest('hex').slice(0, 20);
async function cachedSources(word) {
  try {
    const manifest = JSON.parse(await readFile(path.join(CAPTURES, sourceKey(word), 'manifest.json'), 'utf8'));
    if (manifest.word !== word || manifest.mode !== 'placed' || !Array.isArray(manifest.sources)) return null;
    const sources = manifest.sources.filter(s => s.image && s.anchor && s.url && s.domain && s.mode === 'placed' && s.insertedText === word);
    if (new Set(sources.map(s => s.domain)).size < REQUIRED_SITES) return null;
    for (const source of sources) {
      const imageUrl = new URL(source.image, `http://${HOST}:${PORT}`);
      const imagePath = path.resolve(PUBLIC, `.${decodeURIComponent(imageUrl.pathname)}`);
      if (!imagePath.startsWith(`${CAPTURES}${path.sep}`)) return null;
      await access(imagePath);
      // Reopen the same captures if the local app is started on another port.
      source.image = `http://${HOST}:${PORT}${imageUrl.pathname}`;
    }
    return {...manifest, sources: selectSources(sources)};
  } catch { return null; }
}

async function persist(job) {
  const location = path.join(EXPORTS, `${job.id}.json`);
  const temporary = `${location}.tmp`;
  await writeFile(temporary, JSON.stringify(job, null, 2));
  await rename(temporary, location);
}

async function previewAudio(word) {
  const key = sourceKey(word);
  if (!previewAudioJobs.has(key)) previewAudioJobs.set(key, (async () => {
    await mkdir(PREVIEW_AUDIO, {recursive: true});
    const destination = path.join(PREVIEW_AUDIO, `${key}.wav`);
    try { if ((await stat(destination)).size > 44) return destination; } catch { /* Create the mixed preview below. */ }
    const {synthesizeAudio} = await import('./video/audio.mjs');
    await synthesizeAudio(word, `${destination}.tmp`);
    await rename(`${destination}.tmp`, destination);
    return destination;
  })().catch(error => {previewAudioJobs.delete(key); throw error;}));
  return previewAudioJobs.get(key);
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) && origin.port === String(PORT) && origin.protocol === 'http:';
  } catch { return false; }
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Please send a valid text request.'); }
}

async function sendFile(req, res, location, downloadName) {
  let file;
  try { file = await stat(location); }
  catch { return json(res, 404, {error: 'File not found.'}); }
  if (!file.isFile()) return json(res, 404, {error: 'File not found.'});
  const headers = {'Content-Type': mime[path.extname(location).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes', 'Cache-Control': downloadName ? 'private, max-age=31536000, immutable' : 'no-cache'};
  if (downloadName) {
    const ascii = downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    headers['Content-Disposition'] = `${new URL(req.url, `http://${HOST}:${PORT}`).searchParams.has('download') ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }
  let start = 0;
  let end = file.size - 1;
  let status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, {...headers, 'Content-Range': `bytes */${file.size}`});
      return res.end();
    }
    if (!match[1]) start = Math.max(0, file.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= file.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      res.writeHead(416, {...headers, 'Content-Range': `bytes */${file.size}`});
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(location, {start, end});
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function getBundle(job) {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.join(ROOT, 'video', 'index.tsx'),
      publicDir: PUBLIC,
      rootDir: path.dirname(ROOT),
      onProgress: progress => {
        job.stage = 'Preparing the video';
        // The bundler reports 0–100, while renderMedia reports 0–1.
        job.progress = Math.max(job.progress, 0.52 + (progress / 100) * 0.08);
      },
    }).catch(error => { bundlePromise = undefined; throw error; });
  }
  return bundlePromise;
}

async function runQueue() {
  if (rendering || queue.length === 0) return;
  rendering = true;
  const job = queue.shift();
  job.status = 'capturing';
  job.stage = 'Preparing 50 website frames';
  job.progress = 0.01;
  try {
    await persist(job);
    let manifest = await cachedSources(job.word);
    if (!manifest) {
      const {prepareSources} = await import('./source-capture.mjs');
      const key = sourceKey(job.word);
      manifest = await prepareSources(job.word, {
        outputDir: path.join(CAPTURES, key),
        publicBaseUrl: `http://${HOST}:${PORT}/captures/placed-v3/${key}/`,
        targetCount: REQUIRED_SITES,
        onProgress: ({completed = 0, stage}) => {
          job.sourceCount = completed;
          job.progress = Math.max(job.progress, 0.02 + Math.min(1, completed / REQUIRED_SITES) * 0.48);
          job.stage = stage || `Placing your text · ${completed} / ${REQUIRED_SITES} websites`;
        },
      });
    }
    job.sources = selectSources(manifest.sources);
    job.sourceCount = new Set(job.sources.map(s => s.domain)).size;
    if (job.sourceCount < REQUIRED_SITES) {
      throw new Error(`Prepared ${job.sourceCount} of ${REQUIRED_SITES} website frames. Some pages could not load. Try again to finish the saved set.`);
    }
    job.status = 'rendering';
    job.stage = 'Adding typing, Enter, and the wheel-and-sax transition';
    job.progress = 0.51;
    const {synthesizeAudio} = await import('./video/audio.mjs');
    const {getTiming} = await import('./public/scene.js');
    job.duration = getTiming(job.word).duration;
    await synthesizeAudio(job.word, path.join(EXPORTS, `${job.id}.wav`));
    const serveUrl = await getBundle(job);
    const inputProps = {word: job.word, intensity: job.intensity, sources: job.sources,
      audioFile: `http://${HOST}:${PORT}/media/${job.id}.wav`};
    let browserExecutable;
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try { await access(chromePath); browserExecutable = chromePath; } catch { /* Remotion finds its bundled browser. */ }
    job.stage = 'Setting the scene';
    const composition = await selectComposition({serveUrl, id: 'SearchBurst', inputProps,
      browserExecutable, timeoutInMilliseconds: 120000, logLevel: 'error'});
    job.stage = 'Rendering your video';
    await renderMedia({serveUrl, composition, inputProps, codec: 'h264',
      outputLocation: path.join(EXPORTS, `${job.id}.mp4`),
      pixelFormat: 'yuv420p', colorSpace: 'bt709', crf: 18, audioCodec: 'aac', audioBitrate: '192k',
      concurrency: 2, browserExecutable, overwrite: false, timeoutInMilliseconds: 120000,
      imageFormat: 'jpeg', jpegQuality: 95, logLevel: 'error',
      onProgress: ({progress, stitchStage}) => {
        job.progress = Math.max(job.progress, 0.60 + progress * 0.39);
        job.stage = stitchStage === 'muxing' ? 'Finishing the MP4' : 'Rendering your video';
      },
    });
    job.status = 'complete';
    job.progress = 1;
    job.stage = 'Ready to download';
    job.completedAt = new Date().toISOString();
    console.log(`Export complete: ${job.id} (${job.duration}s)`);
  } catch (error) {
    console.error(`Export failed: ${job.id}`, error);
    job.status = 'error';
    job.stage = 'Export interrupted';
    job.error = `The export could not finish. ${String(error.message || error).slice(0, 350)}`;
  } finally {
    try { await persist(job); }
    catch (error) {
      console.error(`Could not save export metadata: ${job.id}`, error.message);
      job.warning = 'This export is available now, but its history could not be saved. Download it before closing the app.';
    }
    rendering = false;
    void runQueue();
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  const requestHost = req.headers.host?.split(':')[0];
  if (!['localhost', '127.0.0.1', '['].includes(requestHost)) return json(res, 403, {error: 'Use the local app address.'});
  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); }
  catch { return json(res, 400, {error: 'Invalid address.'}); }
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {available: true, version: 'placed-web-v8', maxWords: MAX_WORDS, searchText: 'entered phrase without a leading How to prefix', requiredSites: REQUIRED_SITES, cuts: 50, cutDuration: 0.1, mode: 'placed', introSurface: 'supplied-browser-photo', suggestions: 4, introZoom: {type: 'cut', scale: 1.8}, typing: 'steady', userSounds: true, transitionSound: 'wheel-sax', defaults: {word: 'find me clarity', intensity: 0.75}, format: '1080 × 1920 · MP4 · 30 fps'});
    }
    if (url.pathname === '/api/preview-audio' && ['GET', 'HEAD'].includes(req.method)) {
      const {phrase: word, error} = parsePhrase(url.searchParams.get('word') || '');
      if (error) return json(res, 400, {error});
      return sendFile(req, res, await previewAudio(word));
    }
    if (url.pathname === '/api/sources' && req.method === 'GET') {
      const {phrase: word, error} = parsePhrase(url.searchParams.get('word') || '');
      if (error) return json(res, 400, {error});
      const manifest = await cachedSources(word);
      return json(res, 200, manifest ? {...manifest, ready: true} : {word, sources: [], ready: false});
    }
    if (url.pathname === '/api/exports' && req.method === 'GET') {
      return json(res, 200, [...jobs.values()].filter(j => j.status === 'complete').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map(publicJob));
    }
    if (url.pathname === '/api/render' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, {error: 'Open the app to create a video.'});
      if (queue.length >= 5) return json(res, 429, {error: 'Your export queue is full. Let one finish first.'});
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.word !== 'string') return json(res, 400, {error: 'Enter the word or phrase for your video.'});
      const {phrase: word, error} = parsePhrase(body.word);
      if (error) return json(res, 400, {error});
      const intensity = body.intensity === undefined ? 0.75 : body.intensity;
      if (typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) return json(res, 400, {error: 'Choose a motion amount between 0 and 1.'});
      const id = randomUUID();
      const safeName = Array.from(word.replace(/[^\p{L}\p{N} -]/gu, '')).slice(0, 45).join('').trim().replace(/\s+/gu, '-') || 'word';
      const job = {id, word, intensity, status: 'queued', progress: 0, stage: rendering ? 'Waiting for the previous video' : 'Starting your video',
        filename: `${safeName}-photo-v8-${id.slice(0, 8)}.mp4`, version: 'placed-web-v8', sourceCount: 0, createdAt: new Date().toISOString()};
      await persist(job);
      jobs.set(id, job);
      queue.push(job);
      json(res, 202, publicJob(job));
      void runQueue();
      return;
    }
    const jobMatch = /^\/api\/render\/([\da-f-]{36})$/.exec(url.pathname);
    if (jobMatch && req.method === 'GET') {
      const job = jobs.get(jobMatch[1]);
      return job ? json(res, 200, publicJob(job)) : json(res, 404, {error: 'Video not found.'});
    }
    const mediaMatch = /^\/(exports|media)\/([\da-f-]{36})\.(mp4|wav)$/.exec(url.pathname);
    if (mediaMatch && ['GET', 'HEAD'].includes(req.method)) {
      const [, type, id, extension] = mediaMatch;
      const job = jobs.get(id);
      if (!job || (type === 'exports' && (extension !== 'mp4' || job.status !== 'complete')) || (type === 'media' && extension !== 'wav')) return json(res, 404, {error: 'Video not found.'});
      return sendFile(req, res, path.join(EXPORTS, `${id}.${extension}`), type === 'exports' ? job.filename : undefined);
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, {error: 'Unknown action.'});
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, {error: 'Method not supported.'});
    if (url.pathname.startsWith('/captures/')) res.setHeader('Access-Control-Allow-Origin', '*');
    let relative;
    try { relative = decodeURIComponent(url.pathname); }
    catch { return json(res, 400, {error: 'Invalid file address.'}); }
    const location = path.resolve(PUBLIC, `.${relative === '/' ? '/index.html' : relative}`);
    if (!location.startsWith(`${PUBLIC}${path.sep}`)) return json(res, 403, {error: 'File not available.'});
    return sendFile(req, res, location);
  } catch (error) {
    console.error('Request failed:', error.message);
    if (!res.headersSent) json(res, 400, {error: String(error.message || 'Request could not be completed.').slice(0, 250)});
    else res.destroy();
  }
});

server.requestTimeout = 30000;
server.listen(PORT, HOST, () => console.log(`Word Studio is ready at http://${HOST}:${PORT}`));
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Reuse the existing Word Studio window, or set WORD_STUDIO_PORT.` : error);
  process.exitCode = 1;
});
