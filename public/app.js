import {parsePhrase, MAX_WORDS} from './phrase.js';
import {getTemplates, renderInBrowser, saveVideo, recentVideos, getVideo, deleteVideo, getLibraryStatus, MAX_VIDEOS} from './browser-render.js';
import {getTiming} from './scene.js';
import {track, trackError, textMetrics} from './analytics.js';

const $ = id => document.getElementById(id);
const input = $('word'), motion = $('intensity'), grid = $('videos-grid');
const motionSettings = $('motion-settings'), motionPanel = $('motion-panel');
const previewDialog = $('video-preview-dialog'), fullPreview = $('full-preview-video'), previewDownload = $('preview-download-link');
let previewState, previewRequest = 0;
const examples = [...document.querySelectorAll('.example-video')];
const requestedWord = new URLSearchParams(location.search).get('word');
if (requestedWord !== null) input.value = requestedWord;
let rendering = false, history = [], activePlayer, pageActive = true;
const cards = new Map();
let checkingLibrary = false, pendingVideo, pendingUrl, undoRecord, undoTimer;
let inputMetricsTimer, inputRevision = 0, lastInputMetricsRevision = -1, renderAttempt;
const phrase = () => parsePhrase(input.value);
const amount = () => Number(motion.value) / 100;
const queryFor = record => record.query ?? record.word;
const matches = (record, parsed, intensity) => record.word === parsed.phrase && queryFor(record) === parsed.query && (record.intensity ?? .75) === intensity;
const metadata = ({blob, ...record}) => record;
const videoMetrics = record => record ? {
  ...textMetrics(queryFor(record)), video_id: record.id,
  video_duration_seconds: record.duration, output_format: 'mp4',
  motion_blur: record.intensity ?? .75, template_count: record.sourceCount ?? 50,
} : {};
const errorCode = error => String(error?.code || error?.name || 'unknown').slice(0, 80);
function inputMetrics(source = 'typing') {
  if (inputRevision === lastInputMetricsRevision) return;
  const parsed = phrase();
  const state = !input.value.trim() ? 'empty' : parsed.wordCount > MAX_WORDS ? 'too_long' : parsed.error ? 'invalid' : 'valid';
  const properties = {...textMetrics(input.value), validation_state: state, input_source: source};
  track('text_changed', properties); lastInputMetricsRevision = inputRevision;
}
function watchUserMedia(video, previewSource, properties = () => ({})) {
  let intentUntil = 0;
  const arm = () => {intentUntil = performance.now() + 2500;};
  video.addEventListener('pointerdown', arm);
  video.addEventListener('keydown', arm);
  for (const [event, action] of [['play', 'played'], ['pause', 'paused'], ['seeked', 'seeked']]) {
    video.addEventListener(event, () => {
      if (!pageActive || performance.now() > intentUntil) return;
      intentUntil = 0;
      track(`preview_${action}`, {preview_source: previewSource, position_seconds: Math.round(video.currentTime * 100) / 100, ...properties()});
    });
  }
}
const previewIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const downloadIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const deleteIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const fullLibraryMessage = `Your library is full. Keep up to ${MAX_VIDEOS} videos; delete a video before creating another.`;
const fullStorageMessage = 'Browser storage is full. Delete a saved video to make room, then try again.';
const isStorageFull = error => error?.code === 'STORAGE_FULL' || error?.name === 'QuotaExceededError';
function showLibraryNotice(message) {
  $('library-notice-message').textContent = message;
  $('library-notice').hidden = false;
  $('manage-videos').hidden = !history.length;
  $('download-pending-video').hidden = !pendingVideo;
  $('discard-pending-video').hidden = !pendingVideo;
}
function updateLibraryCount() {
  $('library-count').textContent = `${history.length} / ${MAX_VIDEOS} videos`;
  $('videos-section').hidden = !history.length;
}
function setPendingVideo(record) {
  if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  pendingVideo = record; pendingUrl = record ? URL.createObjectURL(record.blob) : undefined;
  const link = $('download-pending-video');
  if (record) {link.href = pendingUrl; link.download = record.filename || 'wordrush.mp4';}
  else {link.removeAttribute('href'); link.hidden = true; $('discard-pending-video').hidden = true;}
}
function clearUndo() {
  clearTimeout(undoTimer); undoTimer = undefined; undoRecord = undefined;
  $('delete-toast').hidden = true;
}
function showUndo(record) {
  clearUndo(); undoRecord = record;
  $('delete-toast-message').textContent = `Deleted “${queryFor(record)}”.`;
  $('delete-toast').hidden = false;
  undoTimer = setTimeout(clearUndo, 12000);
}
function removeCard(state) {
  if (!state || state.removed) return;
  state.removed = true;
  if (previewState === state) {if (previewDialog.open) previewDialog.close(); clearFullPreview();}
  state.video.pause(); state.busy = false; releaseMedia(state);
  observer.unobserve(state.card); state.card.remove(); cards.delete(state.record.id);
  if (activePlayer === state.video) activePlayer = undefined;
}
async function syncLibrary() {
  const records = await recentVideos();
  const ids = new Set(records.map(record => record.id));
  for (const [id, state] of cards) if (!ids.has(id)) removeCard(state);
  history = records;
  for (const record of records) grid.append(addCard(record).card);
  updateLibraryCount();
}
async function removeSavedVideo(state) {
  if (state.deleting) return;
  state.deleting = true; state.deleteButton.disabled = true;
  const index = history.findIndex(record => record.id === state.record.id);
  try {
    const record = await deleteVideo(state.record.id);
    if (record) track('library_deleted', {...videoMetrics(record), library_count: Math.max(0, history.length - 1)});
    removeCard(state);
    history = history.filter(item => item.id !== state.record.id);
    updateLibraryCount();
    if (record) showUndo(record);
    try {await syncLibrary();} catch { /* The committed deletion already freed this record. */ }
    if (history.length >= MAX_VIDEOS) showLibraryNotice(fullLibraryMessage);
    else if (pendingVideo) showLibraryNotice('Space cleared. Press Create to save your finished video, or download it now.');
    else $('library-notice').hidden = true;
    const next = grid.children[Math.min(Math.max(0, index), cards.size - 1)]?.querySelector('.video-delete');
    (next || input).focus({preventScroll: true});
  } catch (error) {
    track('library_delete_failed', {error_code: errorCode(error)});
    trackError(error, 'library_delete');
    state.deleting = false; state.deleteButton.disabled = false;
    cardError(state, 'This video could not be deleted. Try again.');
  }
}
async function restoreDeletedVideo() {
  const record = undoRecord;
  if (!record) return;
  $('undo-delete').disabled = true;
  try {
    await saveVideo(record);
    track('library_restored', videoMetrics(record));
    clearUndo();
    await syncLibrary();
    if (!pendingVideo) $('library-notice').hidden = true;
    $('videos-status').textContent = `Restored “${queryFor(record)}”.`;
  } catch (error) {
    track('library_restore_failed', {error_code: errorCode(error)});
    trackError(error, 'library_restore');
    showLibraryNotice(error.code === 'VIDEO_LIMIT' ? 'Your library is full. Delete a video before restoring this one.' : isStorageFull(error) ? fullStorageMessage : 'The video could not be restored. Try again.');
  } finally {$('undo-delete').disabled = false;}
}
// Use the renderer's duration and bitrate targets, with room for encoding overhead.
function estimatedVideoBytes(query) {
  return Math.ceil(getTiming(query).duration * (8_000_000 + 192_000) / 8 * 1.25) + 1_048_576;
}
async function storeCompletedVideo(record, {source = 'render'} = {}) {
  try {
    await saveVideo(record);
    track('library_saved', {...videoMetrics(record), save_source: source});
    clearUndo();
    if (pendingVideo?.id === record.id) setPendingVideo(undefined);
    history = [metadata(record), ...history.filter(item => item.id !== record.id)];
    $('library-notice').hidden = true;
    updateLibraryCount();
    revealCard(addCard(metadata(record), {first: true}));
    return true;
  } catch (error) {
    track('library_save_failed', {...videoMetrics(record), save_source: source, error_code: errorCode(error)});
    trackError(error, 'library_save');
    try {await syncLibrary();} catch { /* Keep the completed file available even if storage cannot be read. */ }
    setPendingVideo(record);
    showLibraryNotice(error.code === 'VIDEO_LIMIT' ? 'Your video is ready, but the library is full. Delete a saved video, then press Create to save it. You can also download it now.' : 'Your video is ready, but browser storage could not save it. Delete a saved video, then press Create to save it, or download it now.');
    return false;
  }
}

function setMotionPanel(open, {focusSlider = false, restoreFocus = false} = {}) {
  if (open && motionPanel.hidden) track('settings_panel_opened', {panel: 'motion'});
  motionSettings.setAttribute('aria-expanded', String(open));
  motionPanel.hidden = !open;
  if (open && focusSlider) motion.focus({preventScroll: true});
  if (!open && restoreFocus) motionSettings.focus({preventScroll: true});
}
function updateMotion() {
  $('motion-value').textContent = `${motion.value}%`;
  motion.setAttribute('aria-valuetext', `${motion.value} percent`);
}
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
  if (fullPreview !== player) fullPreview.pause();
  for (const example of examples) if (example !== player) example.pause();
  for (const {video} of cards.values()) if (video !== player) video.pause();
}
function cardError(state, message) {
  if (!pageActive || state.removed) return;
  state.message.textContent = message;
  state.message.hidden = false;
}
async function ensureMedia(state) {
  if (state.url) return state.url;
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const record = await getVideo(state.record.id);
    if (!pageActive || state.removed) throw new DOMException('The video preview was closed.', 'AbortError');
    if (!record?.blob) throw new Error('This video could not load. Try creating it again.');
    state.url = URL.createObjectURL(record.blob);
    state.download.href = state.url;
    state.download.removeAttribute('aria-disabled');
    state.video.src = state.url;
    state.video.load();
    return state.url;
  })().catch(error => {
    if (error.name !== 'AbortError') {track('preview_failed', {preview_source: 'saved_video_card', error_code: errorCode(error)}); trackError(error, 'saved_video_load');}
    throw error;
  }).finally(() => {state.loading = undefined;});
  return state.loading;
}
function releaseMedia(state) {
  if (!state.url || !state.video.paused || state.busy || previewState === state) return;
  state.time = state.video.currentTime;
  state.download.removeAttribute('href');
  state.download.setAttribute('aria-disabled', 'true');
  state.video.removeAttribute('src');
  state.video.load();
  URL.revokeObjectURL(state.url);
  state.url = undefined;
}
async function openFullPreview(state) {
  track('preview_opened', {...videoMetrics(state.record), preview_source: 'saved_video_modal'});
  const request = ++previewRequest;
  previewState = state;
  pauseOthers(fullPreview);
  state.video.pause();
  $('video-preview-title').textContent = queryFor(state.record);
  $('video-preview-error').hidden = true;
  previewDownload.removeAttribute('href'); previewDownload.setAttribute('aria-disabled', 'true');
  fullPreview.setAttribute('aria-label', `Full-size preview: ${queryFor(state.record)}`);
  if (!previewDialog.open) previewDialog.showModal();
  try {
    const url = state.url || await ensureMedia(state);
    if (request !== previewRequest || !previewDialog.open) {
      if (!state.visible) releaseMedia(state);
      return;
    }
    previewDownload.href = url; previewDownload.download = state.record.filename || 'wordrush.mp4';
    previewDownload.setAttribute('aria-label', `Download ${queryFor(state.record)}`); previewDownload.removeAttribute('aria-disabled');
    fullPreview.src = url;
    fullPreview.load();
    try {await fullPreview.play(); track('preview_played', {...videoMetrics(state.record), preview_source: 'saved_video_modal', playback_source: 'open_preview'});}
    catch (error) {if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') throw error;}
  } catch (error) {
    if (request !== previewRequest || !previewDialog.open) return;
    track('preview_failed', {preview_source: 'saved_video_modal', error_code: errorCode(error)});
    trackError(error, 'saved_video_preview');
    $('video-preview-error').textContent = error.message || 'This preview could not load. Try downloading the video.';
    $('video-preview-error').hidden = false;
  }
}
function clearFullPreview() {
  previewRequest++;
  fullPreview.pause();
  previewDownload.removeAttribute('href'); previewDownload.setAttribute('aria-disabled', 'true');
  fullPreview.removeAttribute('src');
  fullPreview.load();
  const state = previewState;
  previewState = undefined;
  if (state) {
    if (pageActive) track('preview_closed', {...videoMetrics(state.record), preview_source: 'saved_video_modal'});
    activePlayer = state.video;
    if (!state.visible) releaseMedia(state);
  }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const state = cards.get(entry.target.dataset.videoId);
    if (!state || state.removed) continue;
    state.visible = entry.isIntersecting;
    if (state.visible) {
      void ensureMedia(state).then(() => {if (!state.visible) releaseMedia(state);}).catch(error => cardError(state, error.message));
    } else releaseMedia(state);
  }
}, {rootMargin: '240px 0px'});

function addCard(record, {first = false} = {}) {
  if (cards.has(record.id)) return cards.get(record.id);
  const titleText = queryFor(record);
  const card = document.createElement('article'); card.className = 'video-card ph-no-capture ph-mask'; card.dataset.videoId = record.id; card.tabIndex = -1;
  const titleId = `video-title-${record.id}`; card.setAttribute('aria-labelledby', titleId);
  const media = document.createElement('div'); media.className = 'video-card-media';
  const video = document.createElement('video'); video.className = 'saved-video'; video.controls = true; video.playsInline = true; video.preload = 'metadata';
  video.setAttribute('aria-label', `Video: ${titleText}`);
  video.setAttribute('controlslist', 'nofullscreen');
  video.disablePictureInPicture = true;
  video.setAttribute('disablepictureinpicture', '');
  media.append(video);
  const footer = document.createElement('div'); footer.className = 'video-card-footer';
  const caption = document.createElement('div'); caption.className = 'video-card-caption';
  const title = document.createElement('h3'); title.className = 'video-card-title'; title.id = titleId; title.textContent = titleText;
  const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'video-preview-icon';
  preview.setAttribute('aria-label', `Full-size preview: ${titleText}`); preview.setAttribute('aria-haspopup', 'dialog');
  preview.title = 'Full-size preview'; preview.innerHTML = previewIcon; media.append(preview);
  const download = document.createElement('a'); download.className = 'video-download-icon'; download.setAttribute('aria-label', `Download ${titleText}`);
  download.title = 'Download video'; download.download = record.filename || 'wordrush.mp4'; download.setAttribute('aria-disabled', 'true');
  download.innerHTML = downloadIcon; media.append(download);
  const message = document.createElement('p'); message.className = 'video-card-message'; message.hidden = true; message.setAttribute('role', 'status');
  const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.className = 'video-delete';
  deleteButton.setAttribute('aria-label', `Delete ${titleText}`); deleteButton.title = 'Delete video'; deleteButton.innerHTML = deleteIcon;
  caption.append(title, deleteButton);
  footer.append(caption, message); card.append(media, footer);
  const state = {record, card, video, message, download, deleteButton, visible: false, busy: false, time: 0};
  cards.set(record.id, state);
  if (first) grid.prepend(card); else grid.append(card);
  observer.observe(card);
  deleteButton.addEventListener('click', () => {void removeSavedVideo(state);});
  preview.addEventListener('click', () => {void openFullPreview(state);});
  video.addEventListener('play', () => pauseOthers(video));
  watchUserMedia(video, 'saved_video_card', () => videoMetrics(record));
  video.addEventListener('pause', () => {if (!state.visible) releaseMedia(state);});
  video.addEventListener('loadedmetadata', () => {if (state.time > 0) video.currentTime = Math.min(state.time, video.duration);});
  video.addEventListener('error', () => {if (state.url) {track('preview_failed', {preview_source: 'saved_video_card', media_error_code: video.error?.code}); cardError(state, 'The preview could not play. You can still download the video.');}});
  card.addEventListener('focusin', () => {void ensureMedia(state).catch(error => cardError(state, error.message));});
  download.addEventListener('click', async event => {
    if (state.url) {track('video_downloaded', {...videoMetrics(record), download_source: 'saved_video_card'}); return;}
    event.preventDefault();
    if (state.busy) return;
    state.busy = true; download.setAttribute('aria-busy', 'true');
    try {
      const url = await ensureMedia(state);
      track('video_downloaded', {...videoMetrics(record), download_source: 'saved_video_card'});
      const link = document.createElement('a'); link.href = url; link.download = record.filename || 'wordrush.mp4';
      document.body.append(link); link.click(); link.remove();
    } catch (error) {track('video_download_failed', {download_source: 'saved_video_card', error_code: errorCode(error)}); trackError(error, 'video_download'); cardError(state, error.message);}
    finally {
      state.busy = false; download.removeAttribute('aria-busy');
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
  $('create-button').disabled = value; input.disabled = value; motion.disabled = value; motionSettings.disabled = value;
  if (value) setMotionPanel(false);
  document.querySelectorAll('[data-word]').forEach(button => {button.disabled = value;});
  $('create-label').textContent = value ? 'Making your video…' : 'Create';
  $('create-arrow').textContent = value ? '◌' : '↗';
  $('render-progress').hidden = !value;
}
async function createVideo() {
  if (rendering || checkingLibrary) return;
  const parsed = phrase();
  clearTimeout(inputMetricsTimer); inputMetrics();
  if (parsed.error) {
    track('render_blocked', {...textMetrics(input.value), reason: !input.value.trim() ? 'empty_text' : parsed.wordCount > MAX_WORDS ? 'text_too_long' : 'invalid_text'});
    $('word-help').textContent = parsed.error; input.focus(); return;
  }
  checkingLibrary = true;
  input.disabled = true; motion.disabled = true; motionSettings.disabled = true; $('create-button').disabled = true;
  const intensity = amount();
  const attempt = {startedAt: null, finished: false, properties: {
    ...textMetrics(parsed.query), render_id: crypto.randomUUID(), motion_blur: intensity,
    output_format: 'mp4', width: 1080, height: 1920, template_count: 50, has_audio: true,
  }};
  try {
    await savedReady;
    await syncLibrary();
    const cached = history.find(record => record.version === 'browser-templates-v13' && matches(record, parsed, intensity));
    if (cached) {
      track('render_reused', {...videoMetrics(cached), reuse_source: 'saved_video'});
      if (pendingVideo && matches(pendingVideo, parsed, intensity)) {setPendingVideo(undefined); $('library-notice').hidden = true;}
      revealCard(addCard(cached)); return;
    }
    const status = await getLibraryStatus();
    if (status.count >= MAX_VIDEOS) {track('render_blocked', {reason: 'library_full', library_count: status.count}); showLibraryNotice(fullLibraryMessage); return;}
    if (pendingVideo && !matches(pendingVideo, parsed, intensity)) {
      track('render_blocked', {reason: 'unsaved_video_pending'});
      showLibraryNotice('Download or discard the unsaved video before creating another.'); return;
    }
    if (pendingVideo) {track('render_reused', {...videoMetrics(pendingVideo), reuse_source: 'unsaved_video'}); await storeCompletedVideo(pendingVideo, {source: 'retry'}); return;}
    const required = estimatedVideoBytes(parsed.query);
    if (Number.isFinite(status.available) && status.available < required) {
      track('render_blocked', {reason: 'storage_full', library_count: status.count});
      showLibraryNotice('Browser storage is almost full. Delete a saved video to make room before creating another.'); return;
    }
    attempt.startedAt = performance.now(); renderAttempt = attempt;
    track('render_started', attempt.properties);
    setRendering(true);
    $('form-error').hidden = true; $('library-notice').hidden = true;
    $('progress-fill').style.width = '0%'; $('progress-percent').textContent = '0%';
    $('progress-label').textContent = 'Preparing your video';
    const manifest = await getTemplates();
    const result = await renderInBrowser({word: parsed.phrase, query: parsed.query, sources: manifest.sources, intensity, onProgress: state => {
      const percent = Math.min(99, Math.round(state.progress * 100));
      $('progress-percent').textContent = `${percent}%`; $('progress-fill').style.width = `${percent}%`;
      $('progress-label').textContent = state.progress < .15 ? 'Preparing your video' : state.progress < .97 ? 'Making your video' : 'Finishing your video';
      $('progress-note').textContent = state.stage;
    }});
    attempt.finished = true;
    track('render_completed', {...attempt.properties, render_duration_ms: Math.round(performance.now() - attempt.startedAt), video_duration_seconds: result.duration, output_bytes: result.blob.size});
    const safeName = parsed.query.replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/gu, '-') || 'wordrush';
    const record = {id: crypto.randomUUID(), word: parsed.phrase, query: parsed.query, intensity, filename: `${safeName}.mp4`,
      createdAt: new Date().toISOString(), blob: result.blob, duration: result.duration,
      sourceCount: 50, version: 'browser-templates-v13'};
    setRendering(false);
    await storeCompletedVideo(record);
  } catch (error) {
    if (attempt.startedAt !== null && !attempt.finished) {
      attempt.finished = true;
      track(error.name === 'AbortError' ? 'render_canceled' : 'render_failed', {...attempt.properties, render_duration_ms: Math.round(performance.now() - attempt.startedAt), error_code: errorCode(error)});
    } else if (attempt.startedAt === null) track('render_blocked', {reason: 'preflight_error', error_code: errorCode(error)});
    if (error.name !== 'AbortError') trackError(error, 'fast_cuts_render');
    if (error.name !== 'AbortError') {
      if (isStorageFull(error)) showLibraryNotice(fullStorageMessage);
      else showError(error.message || 'Your video could not finish. Try again.');
    }
  } finally {if (renderAttempt === attempt) renderAttempt = undefined; setRendering(false); checkingLibrary = false;}
}
async function loadVideos() {
  try {await syncLibrary();}
  catch (error) {track('library_load_failed', {error_code: errorCode(error)}); trackError(error, 'library_load'); updateLibraryCount();}
  if (history.length >= MAX_VIDEOS) showLibraryNotice(fullLibraryMessage);
}

$('manage-videos').addEventListener('click', () => {
  track('library_manage_opened', {library_count: history.length});
  const first = history.map(record => cards.get(record.id)).find(Boolean);
  if (!first) return;
  first.card.scrollIntoView({behavior: 'smooth', block: 'center'});
  first.deleteButton.focus({preventScroll: true});
});
$('undo-delete').addEventListener('click', () => {void restoreDeletedVideo();});
$('dismiss-delete-toast').addEventListener('click', clearUndo);
$('discard-pending-video').addEventListener('click', () => {
  if (pendingVideo) track('library_unsaved_discarded', videoMetrics(pendingVideo));
  setPendingVideo(undefined);
  if (history.length >= MAX_VIDEOS) showLibraryNotice(fullLibraryMessage); else $('library-notice').hidden = true;
});
window.addEventListener('focus', () => {if (!rendering && !checkingLibrary) void syncLibrary().catch(() => {});});
$('creator-form').addEventListener('submit', event => {event.preventDefault(); void createVideo();});
input.addEventListener('input', () => {inputRevision++; updateWord(); clearTimeout(inputMetricsTimer); inputMetricsTimer = setTimeout(() => inputMetrics(), 700);});
input.addEventListener('change', () => {clearTimeout(inputMetricsTimer); inputMetrics();});
document.querySelectorAll('[data-word]').forEach((button, index) => button.addEventListener('click', () => {input.value = button.dataset.word; inputRevision++; updateWord(); clearTimeout(inputMetricsTimer); inputMetrics('example'); track('example_text_selected', {preset_index: index + 1});}));
motion.addEventListener('input', () => {
  updateMotion();
  updateWord();
});
motion.addEventListener('change', () => track('settings_changed', {setting: 'motion_blur', value: amount()}));
motionSettings.addEventListener('click', () => {
  const open = motionSettings.getAttribute('aria-expanded') !== 'true';
  setMotionPanel(open, {focusSlider: open});
});
document.addEventListener('pointerdown', event => {
  if (!motionPanel.hidden && !motionPanel.contains(event.target) && !motionSettings.contains(event.target)) setMotionPanel(false);
});
document.addEventListener('keydown', event => {
  if (!motionPanel.hidden && event.key === 'Escape') {
    event.preventDefault(); setMotionPanel(false, {restoreFocus: true});
  }
});
motionPanel.addEventListener('keydown', event => {
  if (event.key === 'Enter') {event.preventDefault(); setMotionPanel(false, {restoreFocus: true});}
});
motionPanel.addEventListener('focusout', event => {
  const next = event.relatedTarget;
  if (next && !motionPanel.contains(next) && !motionSettings.contains(next)) setMotionPanel(false);
});
previewDownload.addEventListener('click', event => {
  if (!previewDownload.hasAttribute('href')) event.preventDefault();
  else if (previewState) track('video_downloaded', {...videoMetrics(previewState.record), download_source: 'saved_video_modal'});
});
$('download-pending-video').addEventListener('click', () => {
  if (pendingVideo && $('download-pending-video').hasAttribute('href')) track('video_downloaded', {...videoMetrics(pendingVideo), download_source: 'unsaved_video'});
});
$('close-video-preview').addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('close', () => {if (!previewDialog.open) clearFullPreview();});
let backdropPressed = false;
previewDialog.addEventListener('pointerdown', event => {
  const bounds = previewDialog.getBoundingClientRect();
  backdropPressed = event.target === previewDialog &&
    (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
});
previewDialog.addEventListener('click', event => {
  if (backdropPressed && event.target === previewDialog) previewDialog.close();
  backdropPressed = false;
});
fullPreview.addEventListener('play', () => pauseOthers(fullPreview));
watchUserMedia(fullPreview, 'saved_video_modal', () => videoMetrics(previewState?.record));
fullPreview.addEventListener('error', () => {
  if (previewDialog.open && fullPreview.hasAttribute('src')) {
    track('preview_failed', {preview_source: 'saved_video_modal', media_error_code: fullPreview.error?.code});
    $('video-preview-error').textContent = 'The preview could not play. You can still download this video.';
    $('video-preview-error').hidden = false;
  }
});
for (const [index, example] of examples.entries()) {
  example.addEventListener('play', () => pauseOthers(example));
  watchUserMedia(example, 'example_video', () => ({example_index: index + 1}));
  example.addEventListener('error', () => {if (example.error) track('preview_failed', {preview_source: 'example_video', example_index: index + 1, media_error_code: example.error.code});});
}
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || ['INPUT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'VIDEO', 'A'].includes(document.activeElement.tagName)) return;
  const target = activePlayer || document.querySelector('.example-card.is-front video') || examples[0];
  if (!target?.currentSrc) return;
  event.preventDefault();
  const previewSource = target === fullPreview ? 'saved_video_modal' : examples.includes(target) ? 'example_video' : 'saved_video_card';
  const properties = {preview_source: previewSource, playback_source: 'keyboard_shortcut', position_seconds: Math.round(target.currentTime * 100) / 100};
  if (target.paused) void target.play().then(() => track('preview_played', properties)).catch(() => {});
  else {target.pause(); track('preview_paused', properties);}
});
window.addEventListener('pagehide', () => {
  clearTimeout(inputMetricsTimer);
  if (renderAttempt && !renderAttempt.finished) {
    renderAttempt.finished = true;
    track('render_canceled', {...renderAttempt.properties, reason: 'page_closed', render_duration_ms: Math.round(performance.now() - renderAttempt.startedAt)});
  }
  pageActive = false;
  if (previewDialog.open) previewDialog.close();
  clearFullPreview();
  for (const example of examples) example.pause();
  for (const state of cards.values()) {state.video.pause(); releaseMedia(state);}
});
window.addEventListener('pageshow', event => {
  pageActive = true;
  if (event.persisted) for (const state of cards.values()) if (state.visible) void ensureMedia(state).catch(error => cardError(state, error.message));
});
updateMotion();
updateWord();
const savedReady = loadVideos();
