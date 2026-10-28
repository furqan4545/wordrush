import {parsePhrase, MAX_WORDS} from './phrase.js';
import {getTemplates, renderInBrowser, saveVideo, recentVideos} from './browser-render.js';

const $ = id => document.getElementById(id);
const input = $('word'), motion = $('intensity');
const video = $('rendered-video'), example = $('example-video');
const requestedWord = new URLSearchParams(location.search).get('word');
if (requestedWord !== null) input.value = requestedWord;
let activeVideo, rendering = false;
let history = [];
const urls = new Map();
const phrase = () => parsePhrase(input.value);
const amount = () => Number(motion.value) / 100;
const queryFor = record => record.query ?? record.word;
const matches = record => record?.word === phrase().phrase && queryFor(record) === phrase().query && (record.intensity ?? .75) === amount();

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
}
function videoUrl(record) {
  if (!urls.has(record.id)) urls.set(record.id, URL.createObjectURL(record.blob));
  return urls.get(record.id);
}
function playVideo(target) {
  return target.play().catch(error => {
    if (error.name !== 'NotAllowedError') showError(target === example ? 'The example could not play. Refresh the page to try again.' : 'The video could not play. Try downloading it instead.');
  });
}
function hideResult() {
  video.pause();
  $('generated-result').hidden = true;
}
function updateWord() {
  const parsed = phrase();
  $('word-count').textContent = `${parsed.wordCount} / ${MAX_WORDS} words`;
  $('word-count').style.color = parsed.wordCount > MAX_WORDS ? '#a6452b' : '';
  input.setAttribute('aria-invalid', String(Boolean(parsed.error) && Boolean(input.value.trim())));
  $('word-help').textContent = parsed.error && input.value.trim() ? parsed.error : '';
  $('form-error').hidden = true;
  if (!matches(activeVideo)) hideResult();
}
function showSources(records, word) {
  $('source-details').hidden = !records.length;
  $('source-details').open = false;
  $('source-summary').textContent = `${new Set(records.map(source => source.domain)).size} edited website frames`;
  $('source-caption').textContent = `“${word}” is placed into these reusable scenes. These are edited frames, not original quotes.`;
  const list = $('source-list'); list.replaceChildren();
  for (const source of records) {
    const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const domain = document.createElement('strong'); domain.textContent = source.domain;
    const context = document.createElement('span');
    context.textContent = source.template ? `${source.template.before} ${word} ${source.template.after}` : source.excerpt;
    link.append(domain, context); list.append(link);
  }
}
function showFinished(record, {autoplay = false, restoreInput = false} = {}) {
  if (restoreInput) {
    input.value = queryFor(record); motion.value = (record.intensity ?? .75) * 100;
    $('motion-value').textContent = amount() < .35 ? 'Gentle' : amount() < .85 ? 'Punchy' : 'Full rush';
    updateWord();
  }
  const url = videoUrl(record);
  video.pause();
  if (video.src !== url) {video.src = url; video.load();}
  activeVideo = record;
  $('finished-title').textContent = `“${queryFor(record)}” is ready.`;
  $('finished-subtitle').textContent = '50 websites · 50 cuts · 0.1s each';
  $('download-link').href = url;
  $('download-link').download = record.filename || 'wordrush.mp4';
  $('finished-card').hidden = false;
  $('generated-result').hidden = false;
  $('source-details').hidden = true;
  if (autoplay) void playVideo(video);
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
  const cached = [activeVideo, ...history].find(record => record && record.version === 'browser-templates-v13' && matches(record));
  if (cached) {showFinished(cached); return;}
  const word = parsed.phrase, query = parsed.query, intensity = amount();
  setRendering(true); hideResult();
  $('form-error').hidden = true;
  $('progress-fill').style.width = '0%'; $('progress-percent').textContent = '0%';
  $('progress-label').textContent = 'Preparing your video';
  try {
    const manifest = await getTemplates();
    const result = await renderInBrowser({word, query, sources: manifest.sources, intensity, onProgress: state => {
      const percent = Math.min(99, Math.round(state.progress * 100));
      $('progress-percent').textContent = `${percent}%`; $('progress-fill').style.width = `${percent}%`;
      $('progress-label').textContent = state.progress < .15 ? 'Preparing your video' : state.progress < .97 ? 'Making your video' : 'Finishing your video';
      $('progress-note').textContent = state.stage;
    }});
    const safeName = query.replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/gu, '-') || 'wordrush';
    const record = {id: crypto.randomUUID(), word, query, intensity, filename: `${safeName}.mp4`,
      createdAt: new Date().toISOString(), blob: result.blob, duration: result.duration,
      sourceCount: 50, version: 'browser-templates-v13'};
    try {await saveVideo(record);} catch { /* The current MP4 remains downloadable. */ }
    setRendering(false);
    showFinished(record); showSources(manifest.sources, word);
    await loadRecent(record);
  } catch (error) {
    setRendering(false);
    if (error.name !== 'AbortError') showError(error.message || 'Your video could not finish. Try Create again.');
  }
}
async function loadRecent(freshRecord) {
  try {history = await recentVideos();} catch {history = freshRecord ? [freshRecord] : [];}
  if (freshRecord && !history.some(record => record.id === freshRecord.id)) history.unshift(freshRecord);
  const keep = new Set([...history.map(record => record.id), activeVideo?.id]);
  for (const [id, url] of urls) if (!keep.has(id)) {URL.revokeObjectURL(url); urls.delete(id);}
  const list = $('recent-list'); list.replaceChildren();
  for (const record of history.slice(0, 6)) {
    const titleText = queryFor(record);
    const card = document.createElement('article'); card.className = 'recent-item';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'recent-play';
    play.setAttribute('aria-label', `Play ${titleText}`);
    const icon = document.createElement('span'); icon.className = 'recent-play-icon'; icon.textContent = '▶'; icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span'), title = document.createElement('strong'), subtitle = document.createElement('small');
    title.textContent = titleText; subtitle.textContent = 'Play · Saved on this device'; copy.append(title, subtitle);
    play.append(icon, copy);
    play.addEventListener('click', () => {if (!rendering) showFinished(record, {autoplay: true, restoreInput: true});});
    const download = document.createElement('a'); download.href = videoUrl(record); download.download = record.filename || 'wordrush.mp4';
    download.textContent = '↓'; download.setAttribute('aria-label', `Download ${titleText}`);
    card.append(play, download); list.append(card);
  }
  $('recent-section').hidden = !history.length;
}

$('creator-form').addEventListener('submit', event => {event.preventDefault(); void createVideo();});
input.addEventListener('input', updateWord);
document.querySelectorAll('[data-word]').forEach(button => button.addEventListener('click', () => {input.value = button.dataset.word; updateWord();}));
motion.addEventListener('input', () => {
  $('motion-value').textContent = amount() < .35 ? 'Gentle' : amount() < .85 ? 'Punchy' : 'Full rush';
  updateWord();
});
video.addEventListener('play', () => example.pause());
example.addEventListener('play', () => video.pause());
video.addEventListener('error', () => {if (video.src) showError('The video could not load. Try Create again or open a saved video.');});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || ['INPUT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'VIDEO', 'A'].includes(document.activeElement.tagName)) return;
  event.preventDefault();
  const target = $('generated-result').hidden ? example : video;
  if (target.paused) void playVideo(target); else target.pause();
});
window.addEventListener('pagehide', () => {video.pause(); example.pause();});

updateWord();
void loadRecent();
