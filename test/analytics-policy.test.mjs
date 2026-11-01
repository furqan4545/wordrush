import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textMetrics,
  featureForPath,
  sanitizeUrl,
  safeProperties,
  sanitizeCapture,
} from '../public/analytics-policy.js';

const PRIVATE = 'PRIVATE_WORDRUSH_CONTENT_7c9f';

function assertCleanUrl(value) {
  const url = new URL(value);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.ok(!value.includes(PRIVATE));
  return url;
}

test('text metrics describe usage without retaining the entered sentence', () => {
  assert.deepEqual(textMetrics('Can you order cheese?'), {
    word_count: 4,
    character_count: 'Can you order cheese?'.length,
  });
  assert.deepEqual(textMetrics(''), {word_count: 0, character_count: 0});
  const spaced = textMetrics('one   two\nthree');
  assert.equal(spaced.word_count, 3);
  assert.deepEqual(Object.keys(spaced).sort(), ['character_count', 'word_count']);
  assert.ok(!JSON.stringify(textMetrics(PRIVATE)).includes(PRIVATE));
});

test('Wordrush tools use stable feature labels on the same site', () => {
  assert.equal(featureForPath('/'), 'fast_cuts');
  assert.equal(featureForPath('/words-in-motion'), 'words_in_motion');
  assert.equal(featureForPath('/words-in-motion/'), 'words_in_motion');
  assert.equal(featureForPath('/browser-typing'), 'browser_typing');
  assert.equal(featureForPath('/browser-typing/'), 'browser_typing');
  assert.equal(featureForPath('/about.html'), 'about');
  assert.equal(featureForPath('/some-future-page'), 'site');
});

test('tracked URLs discard credentials, entered query text and fragments', () => {
  const value = sanitizeUrl(`https://person:password@wordrush.ing/words-in-motion/?word=${PRIVATE}#${PRIVATE}`);
  const url = assertCleanUrl(value);
  assert.equal(url.origin, 'https://wordrush.ing');
  assert.equal(url.pathname, '/words-in-motion/');

  const originOnly = assertCleanUrl(sanitizeUrl(`https://news.example/private/${PRIVATE}?token=secret`, {originOnly: true}));
  assert.equal(originOnly.origin, 'https://news.example');
  assert.equal(originOnly.pathname, '/');
});

test('empty and local-media URLs are never sent to analytics', () => {
  for (const value of ['', '  ', `blob:https://wordrush.ing/${PRIVATE}`, `data:audio/wav;base64,${PRIVATE}`]) {
    assert.equal(sanitizeUrl(value), '');
  }
});

test('custom events retain useful settings and results but drop content and unapproved string fields', () => {
  const result = safeProperties({
    feature: 'words_in_motion',
    source: 'editor',
    setting: 'motion_blur',
    reason: 'not_supported',
    builtin_id: 'stay_v2',
    track_id: 'ali-0c946fa5b814',
    source_id: 'loc-daily-sun',
    mime_type: 'audio/mpeg',
    error_code: 'AUDIO_ENCODER_UNAVAILABLE',
    context: 'music_export',
    word_count: 9,
    volume: .6,
    duration: 3.63,
    muted: false,
    sentence: PRIVATE,
    word: PRIVATE,
    text: PRIVATE,
    query: PRIVATE,
    title: PRIVATE,
    filename: `${PRIVATE}.mp3`,
    file_name: `${PRIVATE}.wav`,
    media_url: `blob:https://wordrush.ing/${PRIVATE}`,
    ocr: PRIVATE,
    error_message: PRIVATE,
    email: `${PRIVATE}@example.com`,
    password: 123456,
    token: PRIVATE,
    authorization: PRIVATE,
    request_body: {sentence: PRIVATE},
    unknown_string: PRIVATE,
    nested: {secret: PRIVATE},
    list: [PRIVATE],
    not_a_number: NaN,
    infinity: Infinity,
    missing: undefined,
  });

  for (const [key, value] of Object.entries({
    feature: 'words_in_motion', source: 'editor', setting: 'motion_blur', reason: 'not_supported',
    builtin_id: 'stay_v2', track_id: 'ali-0c946fa5b814', source_id: 'loc-daily-sun',
    mime_type: 'audio/mpeg', error_code: 'AUDIO_ENCODER_UNAVAILABLE', context: 'music_export',
    word_count: 9, volume: .6, duration: 3.63, muted: false,
  })) assert.equal(result[key], value, `${key} remains available for analysis`);

  assert.ok(!JSON.stringify(result).includes(PRIVATE));
  for (const key of ['sentence', 'word', 'text', 'query', 'title', 'filename', 'file_name', 'media_url', 'ocr',
    'error_message', 'email', 'password', 'token', 'authorization', 'request_body', 'unknown_string',
    'nested', 'list', 'not_a_number', 'infinity', 'missing']) {
    assert.equal(Object.hasOwn(result, key), false, `${key} is excluded`);
  }
});

test('page capture sanitizes current and initial URLs without breaking anonymous journey IDs', () => {
  const input = {
    uuid: 'event-uuid',
    event: '$pageview',
    properties: {
      distinct_id: 'anonymous-visitor',
      $device_id: 'device-uuid',
      $session_id: 'session-uuid',
      feature: 'words_in_motion',
      $current_url: `https://wordrush.ing/words-in-motion/?word=${PRIVATE}#${PRIVATE}`,
      $referrer: `https://news.example/article?email=${PRIVATE}#${PRIVATE}`,
      $referring_domain: 'news.example',
      $set: {$current_url: `https://wordrush.ing/?word=${PRIVATE}`},
      $set_once: {
        $initial_current_url: `https://wordrush.ing/?word=${PRIVATE}`,
        $initial_referrer: `https://news.example/article?secret=${PRIVATE}`,
      },
    },
  };
  const original = structuredClone(input);
  const result = sanitizeCapture(input);

  assert.deepEqual(input, original, 'capture sanitation does not mutate the SDK event');
  assert.equal(result.event, '$pageview');
  assert.equal(result.uuid, 'event-uuid');
  assert.equal(result.properties.distinct_id, 'anonymous-visitor');
  assert.equal(result.properties.$device_id, 'device-uuid');
  assert.equal(result.properties.$session_id, 'session-uuid');
  assert.equal(result.properties.feature, 'words_in_motion');
  assert.equal(result.properties.$referring_domain, 'news.example');
  assertCleanUrl(result.properties.$current_url);
  assertCleanUrl(result.properties.$referrer);
  assertCleanUrl(result.properties.$set.$current_url);
  assertCleanUrl(result.properties.$set_once.$initial_current_url);
  assertCleanUrl(result.properties.$set_once.$initial_referrer);
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('autocapture retains selector context without button text, input values or content-bearing attributes', () => {
  const result = sanitizeCapture({
    event: '$autocapture',
    properties: {
      distinct_id: 'anonymous-visitor',
      $event_type: 'click',
      $el_text: PRIVATE,
      $input_value: PRIVATE,
      $selected_content: PRIVATE,
      $copy_text: PRIVATE,
      $elements_chain: `button[aria-label="Download ${PRIVATE}"]`,
      $elements: [{
        tag_name: 'button',
        nth_child: 2,
        nth_of_type: 1,
        attr__id: 'download-button',
        'attr__aria-label': `Download ${PRIVATE}`,
        attr__title: PRIVATE,
        $el_text: PRIVATE,
        text: PRIVATE,
        attributes: {title: PRIVATE},
      }],
    },
  });

  assert.equal(result.event, '$autocapture');
  assert.equal(result.properties.$event_type, 'click');
  assert.equal(result.properties.$elements[0].tag_name, 'button');
  assert.equal(result.properties.$elements[0].attr__id, 'download-button');
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('error capture keeps error types and useful locations without raw user-bearing messages', () => {
  const result = sanitizeCapture({
    event: '$exception',
    properties: {
      feature: 'words_in_motion',
      $exception_list: [{
        type: 'TypeError',
        value: `Failed while editing ${PRIVATE}`,
        stacktrace: {frames: [{
          filename: `https://wordrush.ing/words-in-motion/app.js?word=${PRIVATE}#${PRIVATE}`,
          function: 'render',
          lineno: 42,
          colno: 17,
        }]},
      }],
    },
  });

  assert.equal(result.event, '$exception');
  const exception = result.properties.$exception_list[0];
  assert.equal(exception.type, 'TypeError');
  assert.equal(typeof exception.value, 'string');
  assert.ok(exception.value.trim().length > 0);
  assertCleanUrl(exception.stacktrace.frames[0].filename);
  assert.equal(exception.stacktrace.frames[0].lineno, 42);
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('SDK-generated exception summary fields cannot bypass message redaction', () => {
  // PostHog derives these fields before calling before_send. Sanitizing only
  // $exception_list leaves the original message in these parallel summaries.
  for (const includeList of [false, true]) {
    const input = {
      event: '$exception',
      properties: {
        distinct_id: 'anonymous-visitor',
        $session_id: 'session-uuid',
        feature: 'words_in_motion',
        $exception_types: ['TypeError'],
        $exception_values: [`Cannot render ${PRIVATE}`],
        $exception_value: `Cannot render ${PRIVATE}`,
        $exception_message: `Cannot render ${PRIVATE}`,
        $exception_stack: `TypeError: ${PRIVATE}\n    at render (https://wordrush.ing/app.js?word=${PRIVATE}:42:17)`,
        $exception_steps: [{message: PRIVATE, stack: PRIVATE}],
        ...(includeList ? {$exception_list: [{type: 'TypeError', value: `Cannot render ${PRIVATE}`}]} : {}),
      },
    };
    const original = structuredClone(input);
    const result = sanitizeCapture(input);

    assert.deepEqual(input, original, 'derived SDK error data is not mutated');
    assert.equal(result.event, '$exception');
    assert.equal(result.properties.distinct_id, 'anonymous-visitor');
    assert.equal(result.properties.$session_id, 'session-uuid');
    assert.equal(result.properties.feature, 'words_in_motion');
    assert.deepEqual(result.properties.$exception_types, ['TypeError']);
    assert.ok(!JSON.stringify(result).includes(PRIVATE),
      `all exception fields are redacted ${includeList ? 'with' : 'without'} a structured exception list`);
    if (includeList) {
      assert.equal(result.properties.$exception_list[0].type, 'TypeError');
      assert.ok(result.properties.$exception_list[0].value.trim());
    }
  }
});

test('web vitals redact nested navigation and attribution URLs while retaining performance measurements', () => {
  const input = {
    event: '$web_vitals',
    properties: {
      distinct_id: 'anonymous-visitor',
      $device_id: 'device-uuid',
      $session_id: 'session-uuid',
      feature: 'words_in_motion',
      $web_vitals_LCP_value: 2460.5,
      $web_vitals_LCP_event: {
        id: 'lcp-metric-uuid',
        name: 'LCP',
        value: 2460.5,
        delta: 120.25,
        rating: 'good',
        navigation: {
          $current_url: `https://wordrush.ing/words-in-motion/?word=${PRIVATE}#${PRIVATE}`,
          navigationURL: `https://wordrush.ing/?word=${PRIVATE}`,
        },
        attribution: {
          url: `https://wordrush.ing/words-in-motion/?word=${PRIVATE}`,
          network: [{filename: `https://wordrush.ing/app.js?word=${PRIVATE}#${PRIVATE}`, duration: 80}],
        },
      },
    },
  };
  const original = structuredClone(input);
  const result = sanitizeCapture(input);
  const metric = result.properties.$web_vitals_LCP_event;

  assert.deepEqual(input, original, 'nested vitals are sanitized without mutating SDK data');
  assert.equal(result.event, '$web_vitals');
  assert.equal(result.properties.distinct_id, 'anonymous-visitor');
  assert.equal(result.properties.$device_id, 'device-uuid');
  assert.equal(result.properties.$session_id, 'session-uuid');
  assert.equal(result.properties.feature, 'words_in_motion');
  assert.equal(result.properties.$web_vitals_LCP_value, 2460.5);
  assert.equal(metric.id, 'lcp-metric-uuid');
  assert.equal(metric.name, 'LCP');
  assert.equal(metric.value, 2460.5);
  assert.equal(metric.delta, 120.25);
  assert.equal(metric.rating, 'good');
  assert.equal(metric.attribution.network[0].duration, 80);
  assertCleanUrl(metric.navigation.$current_url);
  assertCleanUrl(metric.navigation.navigationURL);
  assertCleanUrl(metric.attribution.url);
  assertCleanUrl(metric.attribution.network[0].filename);
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('heatmap URL keys lose private queries and merge points for the same page', () => {
  const firstPoints = [{x: 128, y: 240, type: 'click', target_fixed: false}];
  const secondPoints = [{x: 360, y: 720, type: 'mousemove', target_fixed: true}];
  const input = {
    event: '$heatmaps',
    properties: {
      distinct_id: 'anonymous-visitor',
      $session_id: 'session-uuid',
      feature: 'words_in_motion',
      $heatmap_data: {
        [`https://wordrush.ing/words-in-motion/?word=${PRIVATE}-first`]: firstPoints,
        [`https://wordrush.ing/words-in-motion/?word=${PRIVATE}-second#${PRIVATE}`]: secondPoints,
      },
    },
  };
  const original = structuredClone(input);
  const result = sanitizeCapture(input);
  const heatmap = result.properties.$heatmap_data;
  const keys = Object.keys(heatmap);

  assert.deepEqual(input, original, 'heatmap sanitation does not modify the queued SDK data');
  assert.equal(result.event, '$heatmaps');
  assert.equal(result.properties.distinct_id, 'anonymous-visitor');
  assert.equal(result.properties.$session_id, 'session-uuid');
  assert.equal(result.properties.feature, 'words_in_motion');
  assert.equal(keys.length, 1, 'query variants are combined under one clean page URL');
  const page = assertCleanUrl(keys[0]);
  assert.equal(page.origin, 'https://wordrush.ing');
  assert.equal(page.pathname, '/words-in-motion/');
  assert.deepEqual(heatmap[keys[0]], [...firstPoints, ...secondPoints],
    'both point arrays retain their coordinates and interaction metadata');
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('string-only autocapture keeps a valid structural chain without copied labels or URLs', () => {
  const result = sanitizeCapture({event: '$autocapture', properties: {
    $event_type: 'click', $elements_chain: `button.private:text="${PRIVATE}"attr_id="${PRIVATE}"href="https://example.com/?word=${PRIVATE}"nth-child="3"nth-of-type="1";div:nth-child="2"nth-of-type="2"`,
  }});
  assert.equal(result.properties.$elements_chain, 'button:nth-child="3"nth-of-type="1";div:nth-child="2"nth-of-type="2"');
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});
