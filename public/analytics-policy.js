const SAFE_LABELS = new Set([
  'feature', 'source', 'setting', 'reason', 'context', 'error_code', 'error_type',
  'failure_code', 'failure_type', 'format', 'mime_type', 'file_type', 'upload_type',
  'track_id', 'source_id', 'paper_id', 'builtin_id', 'music_id', 'video_id',
  'download_source', 'preview_source', 'media_source', 'panel', 'field', 'state',
  'validation', 'validation_state', 'validation_reason', 'action', 'trigger',
  'category', 'quality', 'renderer', 'extension', 'stage', 'setting_name',
  'destination_feature',
  'control', 'typing_pace',
  'output_format', 'from_format', 'to_format', 'selection_source', 'seek_source',
  'playback_source', 'save_source', 'reuse_source', 'input_method', 'music_type',
  'paper_type', 'error_name', 'music_category', 'result', 'frame_format', 'render_id', 'input_source',
]);
const PRIVATE_KEY = /(?:^|_)(?:sentence|query|word|words|text|ocr|title|filename|file_name|message|stack|email|password|token|authorization|cookie|body|headers|url|href|src)(?:_|$)/i;
const ELEMENT_TAGS = new Set('a button input select option textarea label div span form section main body html header nav footer p ul ol li h1 h2 h3 h4 h5 h6 svg path circle img table tr td th aside article summary details progress canvas video strong em small'.split(' '));

export function sanitizeElementChain(chain) {
  if (typeof chain !== 'string') return '';
  return chain.split(';').map(part => {
    const tag = /^([a-z][a-z0-9-]*)/i.exec(part)?.[1]?.toLowerCase();
    if (!ELEMENT_TAGS.has(tag)) return '';
    const child = /(?:^|[^\w-])nth-child="(\d+)"/.exec(part)?.[1] || '0';
    const type = /(?:^|[^\w-])nth-of-type="(\d+)"/.exec(part)?.[1] || '0';
    return `${tag}:nth-child="${child}"nth-of-type="${type}"`;
  }).filter(Boolean).join(';');
}

export function featureForPath(pathname = '/') {
  if (/^\/browser-typing(?:\/|$)/.test(pathname)) return 'browser_typing';
  if (/^\/words-in-motion(?:\/|$)/.test(pathname)) return 'words_in_motion';
  if (pathname === '/' || pathname === '/index.html') return 'fast_cuts';
  if (pathname === '/about.html') return 'about';
  return 'site';
}

export function textMetrics(text = '') {
  const value = String(text);
  return { word_count: value.trim().split(/\s+/u).filter(Boolean).length, character_count: Array.from(value).length };
}

export function sanitizeUrl(value, { originOnly = false } = {}) {
  if (!value || typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, 'https://wordrush.ing');
    return /^https?:$/.test(url.protocol) ? url.origin + (originOnly ? '' : url.pathname) : '';
  } catch { return ''; }
}

/** Custom product events accept measurements and an explicit set of safe labels. */
export function safeProperties(properties = {}) {
  const result = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[a-z][a-z0-9_]*$/i.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Counts and numerical settings never contain the entered words/media.
      if (!/password|token|authorization|cookie|email/i.test(key)) result[key] = value;
    } else if (typeof value === 'boolean') result[key] = value;
    else if (key === 'value' && ['landscape', 'portrait', 'square'].includes(value)) result[key] = value;
    else if (typeof value === 'string' && SAFE_LABELS.has(key) && !PRIVATE_KEY.test(key)
      && value.length <= 120 && /^[\w./:+ -]*$/.test(value) && !/@|https?:|blob:|data:/i.test(value)) result[key] = value;
    else if (typeof value === 'string' && ['error_code', 'error_type', 'failure_code', 'failure_type', 'context'].includes(key)
      && /^[\w.:-]{1,100}$/.test(value)) result[key] = value;
  }
  return result;
}

function scrubSystemProperties(properties) {
  const result = { ...properties };
  for (const [key, value] of Object.entries(result)) {
    if (/url|href|referrer/i.test(key) && typeof value === 'string') {
      result[key] = sanitizeUrl(value, { originOnly: /referrer/i.test(key) });
    }
    if (['$set', '$set_once'].includes(key) && value && typeof value === 'object') result[key] = scrubSystemProperties(value);
    if (/^\$web_vitals_.*_event$/.test(key) && value && typeof value === 'object') result[key] = scrubVitals(value);
    if (/\$(?:el_text|event_text|input_value|selected_content|clipboard|copied_text|copy_text)|attr__(?:aria-label|title|download|value)/i.test(key)) delete result[key];
  }
  // Keep selectors for general interaction counts without user-facing copy.
  if (Array.isArray(result.$elements)) result.$elements = result.$elements.map(element => Object.fromEntries(
    Object.entries(element).filter(([key]) => ['tag_name', 'classes', 'nth_child', 'nth_of_type', 'attr__id', 'attr__class'].includes(key)),
  ));
  if (result.$elements_chain) result.$elements_chain = sanitizeElementChain(result.$elements_chain);
  if (result.$heatmap_data && typeof result.$heatmap_data === 'object') {
    const cleaned = {};
    for (const [url, points] of Object.entries(result.$heatmap_data)) {
      const path = sanitizeUrl(url);
      if (path && Array.isArray(points)) cleaned[path] = [...(cleaned[path] || []), ...points];
    }
    result.$heatmap_data = cleaned;
  }
  for (const key of ['$exception_values', '$exception_value', '$exception_message', '$exception_stack', '$exception_steps']) delete result[key];
  if (Array.isArray(result.$exception_list)) {
    result.$exception_list = result.$exception_list.map(exception => {
      const type = /^[A-Za-z][\w.]{0,79}$/.test(exception.type || '') ? exception.type : 'Error';
      return {
        type, value: type,
        mechanism: exception.mechanism ? { type: exception.mechanism.type, handled: exception.mechanism.handled } : undefined,
        stacktrace: exception.stacktrace ? { frames: exception.stacktrace.frames?.map(frame => ({
          function: frame.function, module: frame.module, filename: sanitizeUrl(frame.filename),
          lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app,
        })) } : undefined,
      };
    });
    result.$exception_values = result.$exception_list.map(exception => exception.value);
  }
  return result;
}

function scrubVitals(value) {
  if (Array.isArray(value)) return value.map(scrubVitals);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    /url|href|filename|referrer/i.test(key) && typeof entry === 'string'
      ? sanitizeUrl(entry, { originOnly: /referrer/i.test(key) })
      : scrubVitals(entry),
  ]));
}

export function sanitizeCapture(event) {
  if (!event) return event;
  return { ...event, properties: scrubSystemProperties(event.properties || {}) };
}
