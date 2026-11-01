import {drawOverlay, getTiming, getOutputTime, getSourceTime, splitText, TYPING_START, DEFAULT_DELAY} from './scene.js';
import {PreviewAudio} from './preview-audio.js';
import {track, trackError, textMetrics} from '../analytics.js';

const $ = id => document.getElementById(id);
const input = $('website'), video = $('footage'), overlay = $('overlay'), scrubber = $('scrubber');
const poster = $('preview-poster'), shot = $('shot');
const delayInput = $('typing-delay'), speedInput = $('video-speed'), customInput = $('custom-speed');
const context = overlay.getContext('2d'), previewAudio = new PreviewAudio({onInterrupted: () => pause()});
const presets = [1, 1.25, 1.5, 2, 3], storageKey = 'wordrush-browser-typing-settings-v1';
let tracking, pace = 'natural', delay = DEFAULT_DELAY, speed = 1, customMode = false, customSpeed = 2.3;
let ready = false, playing = false, currentTime = 0, renderBusy = false, raf = 0, playToken = 0;
let editingStill = true, previewStarting = 0;
let exportController, blobUrl, lastExport, lastExportKey, analyticsTimer;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved === 'object') {
    if (typeof saved.text === 'string') {
      // Replace the old untouched example once, while keeping custom addresses
      // and allowing people to deliberately enter the old example again.
      input.value = !saved.defaultUrlVersion && saved.text === 'calai.app' ? 'https://loveyou.com' : saved.text;
    }
    if (['natural', 'quick', 'slow'].includes(saved.pace)) pace = saved.pace;
    if (Number.isFinite(saved.delay) && saved.delay >= 0 && saved.delay <= 5) delay = saved.delay;
    if (Number.isFinite(saved.speed) && saved.speed >= 1 && saved.speed <= 3) speed = saved.speed;
    if (Number.isFinite(saved.customSpeed) && saved.customSpeed >= 1 && saved.customSpeed <= 3) customSpeed = saved.customSpeed;
    customMode = saved.customMode === true || !presets.includes(speed);
    if (!presets.includes(speed)) customSpeed = speed;
  }
} catch { /* Editing does not depend on local storage. */ }
delayInput.value = String(delay); customInput.value = String(customSpeed);
speedInput.value = customMode ? 'custom' : String(speed);
document.querySelectorAll('[data-pace]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pace === pace)));
const narrowScreen = matchMedia('(max-width:559px)');
$('timing-settings').open = !narrowScreen.matches;
narrowScreen.addEventListener('change', event => {$('timing-settings').open = !event.matches;});
function persist() {
  try {localStorage.setItem(storageKey, JSON.stringify({text: input.value, pace, delay, speed, customMode, customSpeed, defaultUrlVersion: 2}));} catch { /* Optional preference. */ }
}
const timing = () => getTiming(input.value, pace, tracking?.duration, delay, speed);
const clock = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
const decimal = value => Number(value.toFixed(3)).toString();
const metrics = () => ({...textMetrics(input.value), typing_pace: pace, typing_delay_seconds: delay, video_speed: speed,
  custom_speed: customMode, output_format: 'mp4', output_width: 1080, output_height: 1920, has_audio: true});
function showError(message) {$('error').textContent = message; $('error').hidden = !message;}
function updateCustomControl() {
  $('custom-speed-control').hidden = !customMode;
  customInput.disabled = !customMode || renderBusy;
  customInput.required = customMode;
}
updateCustomControl();
function paint(time = currentTime) {
  currentTime = time;
  const t = timing();
  drawOverlay(context, {time: editingStill ? t.duration : time, text: input.value, pace, delay, speed, tracking});
  const empty = !input.value.trim();
  $('preview-empty').hidden = !empty;
  overlay.hidden = empty || !$('finished-video').hidden;
  $('play').disabled = !ready || empty || renderBusy || !!previewStarting;
  scrubber.max = t.duration; scrubber.value = Math.min(time, t.duration);
  $('duration').textContent = `${t.duration.toFixed(1)} sec`;
  $('delay-hint').textContent = speed === 1 ? 'After the address bar focuses' : `${decimal(delay / speed)} s at ${decimal(speed)}× speed`;
  $('settings-summary').textContent = `${decimal(delay)} s delay · ${decimal(speed)}×`;
  $('timecode').textContent = `${clock(time)} / ${clock(Math.ceil(t.duration))}`;
}
function setPlaying(value) {
  playing = value;
  shot.classList.toggle('is-playing', value);
  $('play-label').textContent = value ? 'Pause preview' : 'Play preview';
  $('play').setAttribute('aria-label', value ? 'Pause preview' : 'Play preview');
  $('play-icon').innerHTML = value ? '<path d="M7 5h4v14H7zM15 5h4v14h-4z"/>' : '<path d="m9 5 11 7-11 7z"/>';
  $('preview-state').textContent = !input.value.trim() ? 'Type your URL' : value ? 'Playing preview' : (ready ? 'Ready to preview' : 'Loading preview…');
}
function pause() {playToken++; previewStarting = 0; video.pause(); previewAudio.stop(); cancelAnimationFrame(raf); setPlaying(false);}
function seek(time) {
  const t = timing(); currentTime = Math.max(0, Math.min(t.duration - 1 / 30, time));
  if (!editingStill) video.currentTime = getSourceTime(currentTime, t);
  paint();
}
function animate() {
  if (!playing) return;
  const t = timing();
  video.playbackRate = (video.currentTime >= TYPING_START ? t.tailRate : 1) * speed;
  paint(getOutputTime(video.currentTime, t));
  if (video.readyState >= 3) previewAudio.sync(currentTime); else previewAudio.stop();
  if (video.ended || currentTime >= t.duration - 1 / 30) {pause(); paint(t.duration - 1 / 30); return;}
  raf = requestAnimationFrame(animate);
}
function showEditorPreview() {
  $('finished-video').pause(); $('finished-video').hidden = true;
  editingStill = true;
  video.hidden = true; poster.hidden = false; overlay.hidden = !input.value.trim(); $('preview-controls').hidden = false;
}
function refresh() {
  pause(); showError(''); showEditorPreview();
  $('render-status').hidden = true;
  // iOS may not decode or paint a paused <video> before its first play gesture.
  // This exact final camera frame gives every keystroke a complete live preview
  // without asking the media element to seek or play while someone is editing.
  if (tracking) seek(timing().duration - 1 / 30); else paint();
  setPlaying(false);
  persist();
}
function settingsEvent(control) {track('editor_setting_changed', {...metrics(), control});}
input.addEventListener('input', () => {
  refresh(); clearTimeout(analyticsTimer);
  analyticsTimer = setTimeout(() => track('text_input_changed', {...textMetrics(input.value), input_source: 'typing'}), 450);
});
delayInput.addEventListener('input', () => {
  const value = delayInput.valueAsNumber;
  if (!Number.isFinite(value) || value < 0 || value > 5) {pause(); showError('Choose a delay from 0 to 5 seconds.'); return;}
  delay = value; refresh();
});
delayInput.addEventListener('change', () => settingsEvent('typing_delay'));
speedInput.addEventListener('change', () => {
  customMode = speedInput.value === 'custom'; updateCustomControl();
  if (customMode) {
    const value = customInput.valueAsNumber;
    if (Number.isFinite(value) && value >= 1 && value <= 3) {customSpeed = value; speed = value;}
    else {pause(); showError('Enter a custom speed from 1× to 3×.'); customInput.focus(); return;}
  } else speed = Number(speedInput.value);
  refresh(); settingsEvent('video_speed');
});
customInput.addEventListener('input', () => {
  const value = customInput.valueAsNumber;
  if (!Number.isFinite(value) || value < 1 || value > 3) {pause(); showError('Enter a custom speed from 1× to 3×.'); return;}
  customSpeed = value; speed = value; refresh();
});
customInput.addEventListener('change', () => settingsEvent('custom_video_speed'));
document.querySelectorAll('[data-pace]').forEach(button => button.addEventListener('click', () => {
  pace = button.dataset.pace;
  document.querySelectorAll('[data-pace]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  refresh(); settingsEvent('typing_pace');
}));
$('play').addEventListener('click', async () => {
  if (playing) {pause(); track('preview_paused', metrics()); return;}
  if (!ready || previewStarting || renderBusy) return;
  if (!validate()) return;
  const token = ++playToken; previewStarting = token; showError('');
  editingStill = false; video.hidden = false;
  if (currentTime >= timing().duration - .5) seek(0);
  video.playbackRate = (video.currentTime >= TYPING_START ? timing().tailRate : 1) * speed;
  try {
    $('play').disabled = true;
    // Start both media unlocks inside this tap, before either async operation
    // can lose Safari's user activation.
    const soundReady = previewAudio.prepare(timing());
    const playbackReady = video.play();
    await Promise.all([soundReady, playbackReady]);
    if (token !== playToken) return;
    poster.hidden = true;
    previewAudio.start(getOutputTime(video.currentTime, timing()));
    setPlaying(true); animate(); track('preview_played', metrics());
  } catch (error) {
    if (token !== playToken) return;
    pause(); showEditorPreview(); seek(timing().duration - 1 / 30);
    showError(error.message || 'Your preview could not play. Please try again.'); trackError(error, 'browser_typing_preview', metrics());
  }
  finally {
    if (previewStarting === token) previewStarting = 0;
    $('play').disabled = !ready || !input.value.trim() || renderBusy || !!previewStarting;
  }
});
$('preview-sound').addEventListener('click', async () => {
  try {await previewAudio.setMuted(!previewAudio.muted);}
  catch (error) {pause(); showError(error.message || 'Tap Play again to enable preview sound.');}
  const label = previewAudio.muted ? 'Unmute preview sound' : 'Mute preview sound';
  $('preview-sound').setAttribute('aria-label', label); $('preview-sound').title = label;
  $('preview-sound').style.opacity = previewAudio.muted ? '.4' : '1';
  track('preview_sound_changed', {muted: previewAudio.muted});
});
scrubber.addEventListener('input', () => {pause(); editingStill = false; video.hidden = false; seek(Number(scrubber.value));});
video.addEventListener('ended', () => {pause(); paint(timing().duration - 1 / 30);});
video.addEventListener('seeked', () => {paint(); if (ready) $('preview-loader').hidden = true;});
document.addEventListener('visibilitychange', () => {if (document.hidden) {pause(); $('finished-video').pause();}});

function busy(value) {
  renderBusy = value;
  $('export').disabled = value; input.disabled = value; delayInput.disabled = value; speedInput.disabled = value;
  document.querySelectorAll('[data-pace]').forEach(button => {button.disabled = value;});
  updateCustomControl();
  $('play').disabled = value || !ready || !input.value.trim() || !!previewStarting;
  $('export').querySelector('span').textContent = value ? 'Exporting…' : 'Export MP4';
}
function validate() {
  if (!input.value.trim()) {showError('Enter the website you want to type.'); input.focus(); return false;}
  if (splitText(input.value).length > 300) {showError('Use an address of 300 characters or fewer.'); input.focus(); return false;}
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(input.value)) {showError('Use one line of text.'); input.focus(); return false;}
  if (!Number.isFinite(delayInput.valueAsNumber) || delayInput.valueAsNumber < 0 || delayInput.valueAsNumber > 5) {
    $('timing-settings').open = true; showError('Choose a delay from 0 to 5 seconds.'); delayInput.focus(); return false;
  }
  if (customMode && (!Number.isFinite(customInput.valueAsNumber) || customInput.valueAsNumber < 1 || customInput.valueAsNumber > 3)) {
    $('timing-settings').open = true; showError('Enter a custom speed from 1× to 3×.'); customInput.focus(); return false;
  }
  return true;
}
function downloadVideo(source) {
  const link = document.createElement('a');
  link.href = blobUrl; link.download = 'wordrush-browser-typing.mp4'; link.hidden = true;
  link.className = 'ph-no-capture';
  document.body.append(link); link.click(); link.remove();
  $('render-status').hidden = false; $('progress').value = 1;
  $('status-text').textContent = 'Download started.';
  track('video_downloaded', {...lastExport, download_source: source});
}
$('cancel-export').addEventListener('click', () => {
  if (!exportController) return;
  $('cancel-export').disabled = true; $('status-text').textContent = 'Stopping…'; exportController.abort();
});
$('editor-form').addEventListener('submit', async event => {
  event.preventDefault(); if (renderBusy) return;
  showError(''); if (!validate()) return;
  const request = {text: input.value, pace, delay, speed};
  const requestKey = JSON.stringify(request);
  if (blobUrl && lastExportKey === requestKey) {downloadVideo('export_button'); return;}
  pause(); showEditorPreview(); busy(true); $('render-status').hidden = false;
  $('cancel-export').hidden = false; $('cancel-export').disabled = false;
  $('status-text').textContent = 'Preparing your video…'; $('progress').value = 0;
  exportController = new AbortController();
  const controller = exportController;
  const started = performance.now(), renderMetrics = metrics(); track('render_started', renderMetrics);
  try {
    const {renderBrowserTyping} = await import('./engine.js');
    const result = await renderBrowserTyping({...request, signal: controller.signal, onProgress: data => {
      if (controller.signal.aborted) return;
      const progress = typeof data === 'number' ? data : data.progress;
      $('progress').value = Math.max(0, Math.min(1, progress || 0));
      $('status-text').textContent = `${typeof data === 'object' && data.stage ? data.stage : 'Exporting'} · ${Math.round((progress || 0) * 100)}%`;
    }});
    if (controller.signal.aborted) throw new DOMException('Export canceled.', 'AbortError');
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(result.blob);
    lastExport = {...renderMetrics, output_duration_seconds: result.duration, file_bytes: result.blob.size};
    lastExportKey = requestKey;
    const finished = $('finished-video'); finished.src = blobUrl; finished.hidden = false;
    video.hidden = true; overlay.hidden = true; $('preview-empty').hidden = true; $('preview-loader').hidden = true; $('preview-controls').hidden = true;
    $('preview-state').textContent = 'Your finished video';
    $('progress').value = 1;
    track('render_completed', {...lastExport, render_duration_ms: Math.round(performance.now() - started)});
    downloadVideo('automatic');
  } catch (error) {
    if (error.name === 'AbortError' || controller.signal.aborted) {
      $('status-text').textContent = 'Export canceled. Your settings are ready when you are.';
      track('render_canceled', {...renderMetrics, render_duration_ms: Math.round(performance.now() - started)});
    } else {
      $('render-status').hidden = true; showError(error.message || 'Your video could not be exported. Please try again.');
      trackError(error, 'browser_typing_export', renderMetrics); track('render_failed', {...renderMetrics, error_code: error.code || error.name || 'Error'});
    }
  } finally {
    busy(false); $('cancel-export').hidden = true;
    if (exportController === controller) exportController = null;
  }
});
$('finished-video').addEventListener('play', () => {pause(); $('preview-state').textContent = 'Your finished video'; track('generated_video_played', lastExport || metrics());});
$('timing-settings').addEventListener('toggle', () => {if ($('timing-settings').open) track('settings_panel_opened', {panel: 'typing_timing'});});
window.addEventListener('pagehide', event => {
  clearTimeout(analyticsTimer); exportController?.abort(); pause(); $('finished-video').pause();
  if (!event.persisted && blobUrl) URL.revokeObjectURL(blobUrl);
});

paint();
try {
  const response = await fetch('./media/tracking.json');
  if (!response.ok) throw new Error('The camera tracking could not load.');
  tracking = await response.json();
  await poster.decode();
  ready = true; scrubber.disabled = false;
  showEditorPreview(); seek(timing().duration - 1 / 30); setPlaying(false);
  $('preview-loader').hidden = true;
  persist();
} catch (error) {
  $('preview-loader').textContent = 'Preview unavailable'; $('preview-state').textContent = 'Preview unavailable';
  showError('The preview could not load. Check your connection and reload the page.'); trackError(error, 'browser_typing_load');
}
