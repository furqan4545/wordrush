import { analyticsConfig } from './analytics-config.js';
import { featureForPath, safeProperties, sanitizeCapture, sanitizeUrl, textMetrics } from './analytics-policy.js';
export { textMetrics } from './analytics-policy.js';

const testVisit = new URLSearchParams(location.search).get('analytics_test') === '1';
const enabled = ['wordrush.ing', 'www.wordrush.ing'].includes(location.hostname)
  || (testVisit && ['localhost', '127.0.0.1'].includes(location.hostname));
const base = { app: 'wordrush', feature: featureForPath(location.pathname), analytics_version: '2026-11-02', is_test_event: testVisit };
const queue = [];
const errorQueue = [];
let client;

export function track(event, properties = {}) {
  if (!enabled || !/^[a-z][a-z0-9_]{0,79}$/.test(event)) return;
  const metrics = { ...properties };
  if (event.startsWith('render_') && metrics.render_duration_ms === undefined) metrics.render_duration_ms = metrics.elapsed_ms;
  metrics.output_bytes ??= metrics.file_bytes;
  metrics.output_width ??= metrics.width;
  metrics.output_height ??= metrics.height;
  const safe = { ...safeProperties(metrics), ...base };
  try {
    if (client) client.capture(event, safe);
    else if (queue.length < 200) queue.push({ event, properties: safe });
  } catch { /* Analytics must never interrupt editing or exporting. */ }
}

export function trackError(error, context, properties = {}) {
  const code = String(error?.code || error?.name || 'Error').replace(/[^\w.:-]/g, '').slice(0, 80) || 'Error';
  const safeContext = String(context || 'client').replace(/[^\w.:-]/g, '').slice(0, 80);
  track('client_error', { ...properties, context: safeContext, error_code: code });
  try {
    // Original messages may contain filenames, text, URLs or OCR results.
    const entry = { error: new Error(`Wordrush ${safeContext} (${code})`), properties: { ...safeProperties(properties), ...base, context: safeContext, error_code: code } };
    if (client) client.captureException(entry.error, entry.properties);
    else if (enabled && errorQueue.length < 20) errorQueue.push(entry);
  } catch { /* Error reporting must never obscure the actual product error. */ }
}

const privateText = '#word-track, #videos-grid, #videos-status, #video-preview-dialog, #music-clip-title, #music-tab-summary, #paper-tab-summary, #delete-toast-message, .music-track-title, .source-note, #canvas-error, #form-error, #website, #browser-website, #typing-error, #error';
const privateMedia = 'canvas, video, #word-track, #videos-grid, #video-preview-dialog, #download-again, #download-pending-video, #download, #typing-download';

async function start() {
  if (!enabled || !analyticsConfig.projectToken) { document.documentElement.dataset.analyticsStatus = 'disabled'; return; }
  try {
    const { default: posthog } = await import('./analytics-sdk.js');
    posthog.init(analyticsConfig.projectToken, {
      api_host: analyticsConfig.apiHost,
      ui_host: analyticsConfig.uiHost,
      defaults: '2026-08-30',
      persistence: 'localStorage+cookie',
      person_profiles: 'always',
      respect_dnt: true,
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: { capture_copied_text: false, capture_value_css_selector_allowlist: [], element_attribute_ignorelist: ['aria-label', 'title', 'download', 'value'] },
      mask_all_text: true,
      mask_all_element_attributes: true,
      capture_heatmaps: true,
      capture_dead_clicks: true,
      rageclick: true,
      capture_performance: { web_vitals: true, network_timing: true },
      capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true, capture_console_errors: true },
      disable_session_recording: false,
      enable_recording_console_log: false,
      session_recording: {
        sampleRate: 1,
        maskAllInputs: true,
        maskTextSelector: privateText,
        blockSelector: privateMedia,
        recordHeaders: false,
        recordBody: false,
        streamNetworkBody: false,
        captureCanvas: { recordCanvas: false },
        maskAttributeFn: (name, value) => {
          if (['aria-label', 'title', 'download', 'value', 'data-word', 'data-query'].includes(name)) return '[masked]';
          return ['src', 'href'].includes(name) ? sanitizeUrl(value) : value;
        },
        maskCapturedNetworkRequestFn: request => {
          const name = sanitizeUrl(request.name);
          if (!name) return null;
          return { ...request, name, requestBody: undefined, responseBody: undefined, requestHeaders: undefined, responseHeaders: undefined };
        },
      },
      before_send: event => sanitizeCapture(event && { ...event, properties: { ...event.properties, ...base } }),
      loaded: sdk => {
        client = sdk;
        sdk.register(base);
        document.documentElement.dataset.analyticsStatus = 'ready';
        track('feature_opened', { supports_video_encoder: typeof VideoEncoder !== 'undefined', supports_audio_encoder: typeof AudioEncoder !== 'undefined', supports_wasm: typeof WebAssembly !== 'undefined' });
        for (const item of queue.splice(0)) sdk.capture(item.event, item.properties);
        for (const item of errorQueue.splice(0)) sdk.captureException(item.error, item.properties);
      },
    });
  } catch { document.documentElement.dataset.analyticsStatus = 'unavailable'; }
}
void start();

// Capture navigation consistently on every current and future Wordrush page.
document.addEventListener('click', event => {
  const link = event.target.closest?.('.site-nav a, .wordmark, footer a');
  if (!link) return;
  const destination = new URL(link.href, location.href);
  if (destination.origin === location.origin) track('navigation_clicked', { destination_feature: featureForPath(destination.pathname) });
});
