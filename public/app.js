import {drawScene, loadAssets} from './scene.js';
import {parsePhrase, MAX_WORDS} from './phrase.js';
import {getTemplates, renderInBrowser, saveVideo, recentVideos} from './browser-render.js';

const $ = id => document.getElementById(id);
const input = $('word'), motion = $('intensity'), canvas = $('preview');
const video = $('rendered-video'), ctx = canvas.getContext('2d');
const requestedWord = new URLSearchParams(location.search).get('word');
if (requestedWord !== null) input.value = requestedWord;
let assets, activeVideo, rendering = false, editVersion = 0;
let history = [];
const urls = new Map();
const phrase = () => parsePhrase(input.value);
const amount = () => Number(motion.value) / 100;
const matches = record => record?.word === phrase().phrase && (record.intensity ?? .75) === amount();

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
}
function videoUrl(record) {
  if (record.url) return record.url;
  if (!urls.has(record.id)) urls.set(record.id, URL.createObjectURL(record.blob));
  return urls.get(record.id);
}
function playVideo() {
  return video.play().catch(error => {
    if (error.name === 'NotAllowedError') $('preview-mode').textContent = 'READY TO PLAY';
    else showError('The video could not play. Try downloading it instead.');
  });
}
function showNative(record, label, {autoplay = false} = {}) {
  const url = videoUrl(record);
  video.pause();
  if (video.src !== new URL(url, location.href).href) {video.src = url; video.load();}
  activeVideo = record;
  video.muted = Boolean(record.demo);
  video.hidden = false;
  canvas.hidden = true;
  $('center-play').hidden = true;
  $('video-controls').hidden = true;
  $('timeline-wrap').hidden = true;
  $('back-to-preview').hidden = true;
  $('preview-tip').hidden = true;
  $('preview-loading').hidden = true;
  $('preview-mode').textContent = label;
  if (autoplay) void playVideo();
}
function showDemo() {
  showNative({id: 'demo', url: '/demo.mp4', demo: true}, 'EXAMPLE VIDEO');
  $('finished-card').hidden = true;
  $('source-details').hidden = true;
}
function showDraft() {
  video.pause(); activeVideo = undefined;
  video.hidden = true; canvas.hidden = false;
  // The draft is only a still. Playback always uses a completed MP4.
  if (assets) drawScene(ctx, {time: 0, word: phrase().phrase || ' ', width: canvas.width, height: canvas.height, assets});
  $('center-play').hidden = rendering || Boolean(phrase().error) || !assets;
  $('video-controls').hidden = true;
  $('timeline-wrap').hidden = true;
  $('back-to-preview').hidden = true;
  $('preview-tip').hidden = true;
  $('preview-mode').textContent = rendering ? 'MAKING YOUR VIDEO' : 'YOUR PREVIEW';
  $('finished-card').hidden = true;
  $('source-details').hidden = true;
}
function updateWord() {
  editVersion++;
  const parsed = phrase();
  $('word-count').textContent = `${parsed.wordCount} / ${MAX_WORDS} words`;
  $('word-count').style.color = parsed.wordCount > MAX_WORDS ? '#a6452b' : '';
  input.setAttribute('aria-invalid', String(Boolean(parsed.error) && Boolean(input.value.trim())));
  $('word-help').textContent = parsed.error && input.value.trim() ? parsed.error : '';
  $('form-error').hidden = true;
  if (!input.value.trim()) showDemo();
  else if (matches(activeVideo)) showNative(activeVideo, 'YOUR FINISHED VIDEO');
  else showDraft();
}
function showSources(records, word) {
  $('source-details').hidden = !records.length;
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
    input.value = record.word; motion.value = (record.intensity ?? .75) * 100;
    $('motion-value').textContent = amount() < .35 ? 'Gentle' : amount() < .85 ? 'Punchy' : 'Full rush';
    updateWord();
  }
  showNative(record, 'YOUR FINISHED VIDEO', {autoplay});
  $('finished-title').textContent = `“${record.word}” is ready.`;
  $('finished-subtitle').textContent = '50 websites · 50 cuts · 0.1s each';
  $('download-link').href = videoUrl(record);
  $('download-link').download = record.filename || 'wordrush.mp4';
  $('finished-card').hidden = false;
}
function setRendering(value) {
  rendering = value;
  $('create-button').disabled = value; input.disabled = value; motion.disabled = value;
  document.querySelectorAll('[data-word]').forEach(button => {button.disabled = value;});
  $('create-label').textContent = value ? 'Making your video…' : 'Create';
  $('create-arrow').textContent = value ? '◌' : '↗';
  $('render-progress').hidden = !value;
  $('center-play').hidden = value || !video.hidden || Boolean(phrase().error);
}
async function createVideo({autoplay = false} = {}) {
  if (rendering) return;
  const parsed = phrase();
  if (parsed.error) {$('word-help').textContent = parsed.error; input.focus(); return;}
  const cached = [activeVideo, ...history].find(record => record && !record.demo && matches(record));
  if (cached) {showFinished(cached, {autoplay}); return;}
  const word = parsed.phrase, intensity = amount();
  setRendering(true); showDraft();
  $('form-error').hidden = true;
  $('progress-fill').style.width = '0%'; $('progress-percent').textContent = '0%';
  $('progress-label').textContent = 'Preparing your moment';
  try {
    const manifest = await getTemplates();
    const result = await renderInBrowser({word, sources: manifest.sources, intensity, onProgress: state => {
      const percent = Math.min(99, Math.round(state.progress * 100));
      $('progress-percent').textContent = `${percent}%`; $('progress-fill').style.width = `${percent}%`;
      $('progress-label').textContent = state.progress < .15 ? 'Preparing your moment' : state.progress < .97 ? 'Making your moment' : 'Finishing your video';
      $('progress-note').textContent = state.stage;
    }});
    const safeName = word.replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/gu, '-') || 'wordrush';
    const record = {id: crypto.randomUUID(), word, intensity, filename: `${safeName}.mp4`,
      createdAt: new Date().toISOString(), blob: result.blob, duration: result.duration,
      sourceCount: 50, version: 'browser-templates-v12'};
    try {await saveVideo(record);} catch { /* The current MP4 remains downloadable. */ }
    setRendering(false);
    showFinished(record, {autoplay}); showSources(manifest.sources, word);
    await loadRecent(record);
  } catch (error) {
    setRendering(false); showDraft();
    if (error.name !== 'AbortError') showError(error.message);
  }
}
async function loadRecent(freshRecord) {
  try {history = await recentVideos();} catch {history = freshRecord ? [freshRecord] : [];}
  if (freshRecord && !history.some(record => record.id === freshRecord.id)) history.unshift(freshRecord);
  const keep = new Set([...history.map(record => record.id), activeVideo?.id]);
  for (const [id, url] of urls) if (!keep.has(id)) {URL.revokeObjectURL(url); urls.delete(id);}
  const list = $('recent-list'); list.replaceChildren();
  for (const record of history.slice(0, 6)) {
    const card = document.createElement('article'); card.className = 'recent-item';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'recent-play';
    play.setAttribute('aria-label', `Play ${record.word}`);
    const icon = document.createElement('span'); icon.className = 'recent-play-icon'; icon.textContent = '▶'; icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span'), title = document.createElement('strong'), subtitle = document.createElement('small');
    title.textContent = record.word; subtitle.textContent = 'Play · Saved on this device'; copy.append(title, subtitle);
    play.append(icon, copy);
    play.addEventListener('click', () => {if (!rendering) showFinished(record, {autoplay: true, restoreInput: true});});
    const download = document.createElement('a'); download.href = videoUrl(record); download.download = record.filename;
    download.textContent = '↓'; download.setAttribute('aria-label', `Download ${record.word}`);
    card.append(play, download); list.append(card);
  }
  $('recent-section').hidden = !history.length;
}

$('creator-form').addEventListener('submit', event => {event.preventDefault(); void createVideo();});
$('center-play').addEventListener('click', () => void createVideo({autoplay: true}));
input.addEventListener('input', updateWord);
document.querySelectorAll('[data-word]').forEach(button => button.addEventListener('click', () => {input.value = button.dataset.word; updateWord();}));
motion.addEventListener('input', () => {
  $('motion-value').textContent = amount() < .35 ? 'Gentle' : amount() < .85 ? 'Punchy' : 'Full rush';
  updateWord();
});
video.addEventListener('error', () => {if (video.src) showError('The video could not load. Try Create again or open a saved video.');});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || ['INPUT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'VIDEO', 'A'].includes(document.activeElement.tagName)) return;
  event.preventDefault();
  if (video.hidden) void createVideo({autoplay: true});
  else if (video.paused) void playVideo(); else video.pause();
});
window.addEventListener('pagehide', () => video.pause());

updateWord();
const readyVersion = editVersion;
try {
  const [loadedAssets] = await Promise.all([loadAssets('/').catch(() => undefined), loadRecent()]);
  assets = loadedAssets;
  $('preview-loading').hidden = true;
  if (editVersion === readyVersion && !rendering && (!activeVideo || activeVideo.demo)) {
    if (!input.value.trim() && history.length) showFinished(history[0]);
    else if (phrase().phrase && !phrase().error) {
      const saved = history.find(matches);
      if (saved) showFinished(saved); else showDraft();
    } else showDemo();
  } else if (video.hidden && !rendering) showDraft();
} catch {
  $('preview-loading').hidden = true;
  if (!rendering && (!activeVideo || activeVideo.demo)) showDemo();
}
