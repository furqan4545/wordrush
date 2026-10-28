import {parsePhrase, MAX_WORDS} from './phrase.js';
import {getTemplates, renderInBrowser, saveVideo, recentVideos, getVideo} from './browser-render.js';

const $ = id => document.getElementById(id);
const input = $('word'), motion = $('intensity'), grid = $('videos-grid');
const examples = [...document.querySelectorAll('.example-video')];
const requestedWord = new URLSearchParams(location.search).get('word');
if (requestedWord !== null) input.value = requestedWord;
let rendering = false, history = [], activePlayer, pageActive = true;
const cards = new Map(), unsaved = new Map();
const phrase = () => parsePhrase(input.value);
const amount = () => Number(motion.value) / 100;
const queryFor = record => record.query ?? record.word;
const matches = (record, parsed, intensity) => record.word === parsed.phrase && queryFor(record) === parsed.query && (record.intensity ?? .75) === intensity;
const metadata = ({blob, ...record}) => record;
const downloadIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
}
function updateWord() {
  const parsed = phrase();
  $('word-count').textContent = `${parsed.wordCount} / ${MAX_WORDS} words`;
  $('word-count').style.color = parsed.wordCount > MAX_WORDS ? '#a6452b' : '';
  input.setAttribute('aria-invalid', String(Boolean(parsed.error) && Boolean(input.value.trim())));
  $('word-help').textContent = parsed.error && input.value.trim() ? parsed.error : '';
  $('form-error').hidden = true;
}
function pauseOthers(player) {
  activePlayer = player;
  for (const example of examples) if (example !== player) example.pause();
  for (const {video} of cards.values()) if (video !== player) video.pause();
}
function cardError(state, message) {
  if (!pageActive) return;
  state.message.textContent = message;
  state.message.hidden = false;
}
async function ensureMedia(state) {
  if (state.url) return state.url;
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const record = unsaved.get(state.record.id) || await getVideo(state.record.id);
    if (!pageActive) throw new DOMException('Page closed.', 'AbortError');
    if (!record?.blob) throw new Error('This video could not load. Try creating it again.');
    state.url = URL.createObjectURL(record.blob);
    state.video.src = state.url;
    state.video.load();
    return state.url;
  })().finally(() => {state.loading = undefined;});
  return state.loading;
}
function releaseMedia(state) {
  if (!state.url || !state.video.paused || state.busy) return;
  state.time = state.video.currentTime;
  state.video.removeAttribute('src');
  state.video.load();
  URL.revokeObjectURL(state.url);
  state.url = undefined;
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const state = cards.get(entry.target.dataset.videoId);
    state.visible = entry.isIntersecting;
    if (state.visible) {
      void ensureMedia(state).then(() => {if (!state.visible) releaseMedia(state);}).catch(error => cardError(state, error.message));
    } else releaseMedia(state);
  }
}, {rootMargin: '240px 0px'});

function addCard(record, {first = false} = {}) {
  if (cards.has(record.id)) return cards.get(record.id);
  const titleText = queryFor(record);
  const card = document.createElement('article'); card.className = 'video-card'; card.dataset.videoId = record.id; card.tabIndex = -1;
  const titleId = `video-title-${record.id}`; card.setAttribute('aria-labelledby', titleId);
  const media = document.createElement('div'); media.className = 'video-card-media';
  const video = document.createElement('video'); video.className = 'saved-video'; video.controls = true; video.playsInline = true; video.preload = 'metadata';
  video.setAttribute('aria-label', `Video: ${titleText}`); video.setAttribute('controlslist', 'nodownload');
  media.append(video);
  const footer = document.createElement('div'); footer.className = 'video-card-footer';
  const title = document.createElement('h3'); title.className = 'video-card-title'; title.id = titleId; title.textContent = titleText;
  const download = document.createElement('button'); download.type = 'button'; download.className = 'video-download'; download.setAttribute('aria-label', `Download ${titleText}`);
  download.innerHTML = `<span>Download</span>${downloadIcon}`;
  const message = document.createElement('p'); message.className = 'video-card-message'; message.hidden = true; message.setAttribute('role', 'status');
  footer.append(title, download, message); card.append(media, footer);
  const state = {record, card, video, message, visible: false, busy: false, time: 0};
  cards.set(record.id, state);
  if (first) grid.prepend(card); else grid.append(card);
  observer.observe(card);
  video.addEventListener('play', () => pauseOthers(video));
  video.addEventListener('pause', () => {if (!state.visible) releaseMedia(state);});
  video.addEventListener('loadedmetadata', () => {if (state.time > 0) video.currentTime = Math.min(state.time, video.duration);});
  video.addEventListener('error', () => {if (state.url) cardError(state, 'The preview could not play. You can still download the video.');});
  card.addEventListener('focusin', () => {void ensureMedia(state).catch(error => cardError(state, error.message));});
  download.addEventListener('click', async () => {
    state.busy = true; download.disabled = true; download.setAttribute('aria-busy', 'true');
    try {
      const url = await ensureMedia(state);
      const link = document.createElement('a'); link.href = url; link.download = record.filename || 'wordrush.mp4';
      document.body.append(link); link.click(); link.remove();
    } catch (error) {cardError(state, error.message);}
    finally {
      state.busy = false; download.disabled = false; download.removeAttribute('aria-busy');
      if (!state.visible) setTimeout(() => {if (!state.visible) releaseMedia(state);}, 1000);
    }
  });
  return state;
}
function revealCard(state) {
  activePlayer = state.video;
  $('videos-section').hidden = false;
  $('videos-status').textContent = `“${queryFor(state.record)}” is ready to watch or download.`;
  for (const item of cards.values()) item.card.classList.toggle('is-new', item === state);
  requestAnimationFrame(() => {
    state.card.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
    state.card.focus({preventScroll: true});
  });
}
function setRendering(value) {
  rendering = value;
  $('create-button').disabled = value; input.disabled = value; motion.disabled = value;
  document.querySelectorAll('[data-word]').forEach(button => {button.disabled = value;});
  $('create-label').textContent = value ? 'Making your video…' : 'Create';
  $('create-arrow').textContent = value ? '◌' : '↗';
  $('render-progress').hidden = !value;
}
async function createVideo() {
  if (rendering) return;
  const parsed = phrase();
  if (parsed.error) {$('word-help').textContent = parsed.error; input.focus(); return;}
  const intensity = amount();
  await savedReady;
  if (rendering) return;
  const cached = history.find(record => record.version === 'browser-templates-v13' && matches(record, parsed, intensity));
  if (cached) {revealCard(addCard(cached)); return;}
  setRendering(true);
  $('form-error').hidden = true;
  $('progress-fill').style.width = '0%'; $('progress-percent').textContent = '0%';
  $('progress-label').textContent = 'Preparing your video';
  try {
    const manifest = await getTemplates();
    const result = await renderInBrowser({word: parsed.phrase, query: parsed.query, sources: manifest.sources, intensity, onProgress: state => {
      const percent = Math.min(99, Math.round(state.progress * 100));
      $('progress-percent').textContent = `${percent}%`; $('progress-fill').style.width = `${percent}%`;
      $('progress-label').textContent = state.progress < .15 ? 'Preparing your video' : state.progress < .97 ? 'Making your video' : 'Finishing your video';
      $('progress-note').textContent = state.stage;
    }});
    const safeName = parsed.query.replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/gu, '-') || 'wordrush';
    const record = {id: crypto.randomUUID(), word: parsed.phrase, query: parsed.query, intensity, filename: `${safeName}.mp4`,
      createdAt: new Date().toISOString(), blob: result.blob, duration: result.duration,
      sourceCount: 50, version: 'browser-templates-v13'};
    try {await saveVideo(record);} catch {unsaved.set(record.id, record);}
    history.unshift(metadata(record));
    setRendering(false);
    revealCard(addCard(metadata(record), {first: true}));
  } catch (error) {
    setRendering(false);
    if (error.name !== 'AbortError') showError(error.message || 'Your video could not finish. Try Create again.');
  }
}
async function loadVideos() {
  try {history = await recentVideos();} catch {history = [];}
  for (const record of history) addCard(record);
  $('videos-section').hidden = !history.length;
}

$('creator-form').addEventListener('submit', event => {event.preventDefault(); void createVideo();});
input.addEventListener('input', updateWord);
document.querySelectorAll('[data-word]').forEach(button => button.addEventListener('click', () => {input.value = button.dataset.word; updateWord();}));
motion.addEventListener('input', () => {
  $('motion-value').textContent = amount() < .35 ? 'Gentle' : amount() < .85 ? 'Punchy' : 'Full rush';
  updateWord();
});
for (const example of examples) example.addEventListener('play', () => pauseOthers(example));
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || ['INPUT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'VIDEO', 'A'].includes(document.activeElement.tagName)) return;
  const target = activePlayer || document.querySelector('.example-card.is-front video') || examples[0];
  if (!target?.currentSrc) return;
  event.preventDefault();
  if (target.paused) void target.play().catch(() => {}); else target.pause();
});
window.addEventListener('pagehide', () => {
  pageActive = false;
  for (const example of examples) example.pause();
  for (const state of cards.values()) {state.video.pause(); releaseMedia(state);}
});
window.addEventListener('pageshow', event => {
  pageActive = true;
  if (event.persisted) for (const state of cards.values()) if (state.visible) void ensureMedia(state).catch(error => cardError(state, error.message));
});
updateWord();
const savedReady = loadVideos();
