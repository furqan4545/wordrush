# Wordrush

Make a fast-paced video.

Wordrush makes a vertical 1080 × 1920 MP4 in the visitor’s browser. A Web Worker draws the approved photo opening and 50 rapid website cuts with OffscreenCanvas, then encodes H.264/AAC using WebCodecs and Mediabunny. Rendering does not upload the visitor’s phrase or video to a server.

## Words in Motion

The header connects two dedicated video tools: **Fast cuts** at `/` and **Words in Motion** at `/words-in-motion/`. Fast cuts keeps the existing short-phrase workflow, browser intro, rapid website cuts and saved-video library. Words in Motion places a sentence into a newspaper paragraph and follows its highlighted words with a moving camera. Its controls, soundtrack selection, preview and video export live on the dedicated page.

The sentence editor is contained in `public/words-in-motion/`, with its own modules, styles and assets. Keep its asset URLs inside that directory so the root Wordrush scripts and renderer remain independent. Browser settings retain their existing storage keys.

## Run and build

```sh
npm ci
npm run build
npx serve dist
```

Deploy `dist/` to Vercel using the included `vercel.json`. GitHub pushes rebuild the static site. The static build recursively copies `public/words-in-motion/` to `dist/words-in-motion/`, including its `index.html`; Vercel serves that directory index directly at `/words-in-motion/` without an SPA rewrite ([directory-index behavior](https://vercel.com/docs/directory-listing)). Use `npx serve dist` to preview both tools. The legacy `npm start` server and the prepared Hetzner package remain available for development and future fallback work; the live frontend does not call their render API.

## Phrase rules

The Chrome address bar types the complete entered query, including a leading `How to` and any question marks. Only the montage phrase removes trailing question marks and a leading `How to`, optionally followed by `:` or `,`, exactly once. For example, `how to become great?` types `how to become great?` and uses `become great` in the website paragraphs; `find me wife` stays unchanged in both places. Interior question marks and other punctuation are preserved. Accept 1–8 words after the optional prefix. No search words are added automatically. Saved videos retain both the original search query and the montage phrase; cache matching includes both.

## Reusable scenes

`public/templates/v1/manifest.json` contains 50 distinct website backgrounds with a blank editable paragraph, full sentence context, and captured font/layout metadata. Each video draws its phrase inside those paragraphs and recomputes the crop anchor. No website is revisited for a new phrase. The one-time preparation tool is `template-capture.mjs`; original captures and approved exports are preserved outside the published build.

The montage is exactly 5 seconds: 50 cuts, three frames each at 30fps. Its approved blur/zoom transitions remain. The opening uses the supplied photo, mouse click, four suggestions, and an instantaneous 1.8× close-up for typing. The photograph retains its existing color.

## Audio and UI

The browser PCM mixer matches the approved Node mix sample for sample: click, trimmed typing and Enter recordings, then the approved five-second wheel-and-sax loop. AAC uses the official Mediabunny WASM encoder for consistent sound across browsers. Its measured codec priming is below one 30fps frame. Video encoding requires a browser with working AVC WebCodecs support. Finished videos are saved in IndexedDB on that device and downloaded as MP4s.

The responsive gradient interface uses Libraries.dev BorderBeam and its official Voice Ring web-preview source, vendored under `ui/vendor/voice-ring` with the MIT license and provenance. The ring follows actual rendering state, with the percentage in its center. Reduced motion and hidden tabs are respected.

```sh
npm test
npm run check
```

Prepared backgrounds are edited website scenes, not original quotations. No source website is modified or published. Downloaded original audio, old exports, local history, and unrelated project files are excluded from the static build.

## Playback and saved videos

Three permanent examples—`how to become great`, `how to hack google`, and `Focus`—sit in an animated card stack. Their positions change every three seconds. Playback, hover, focus and hidden tabs pause rotation; reduced motion disables automatic rotation. Manual selectors remain available. Example players have no app download action.

All generated videos appear once in a single “Your videos” grid: four fluid columns that fill the desktop width, two columns on tablets and one centered card on phones. Each glass card contains its 9:16 preview, original query, a top-right download icon, and a top-left full-preview icon. Native player menus also allow downloading generated videos. New recordings are added first; additional recordings form new rows. Existing saved recordings are preserved. The gallery lists all IndexedDB metadata and lazily loads full videos near the viewport, releasing idle media when it scrolls away. Starting a player pauses all other players. The borderless 9:16 media area prevents letterboxing caused by the old frame border.

The search field is 56px high on desktop and mobile. The headline is “Make a fast-paced video.” Input guidance stays hidden unless validation needs attention. A gear beside Create opens the “Control motion blur” slider, with a matching hover/focus tooltip. Adjustments apply immediately; outside clicks, Escape and Enter close the popover. The chosen setting is preserved when it closes. Clicking the gear a second time closes it without a blur/click race.


## Brand assets

`public/brand/` contains the canonical three-stroke SVG mark, horizontal SVG/PNG logo, transparent PNG icons from 16 to 1024px, multi-size ICO, browser favicon SVG, apple-touch icon and web manifest. The header and browser tab use the same mark.


The full-size preview uses an accessible native dialog with playback controls, a download icon and an explicit Close button. Gallery videos hide duplicate native fullscreen and picture-in-picture controls. Escape and backdrop clicks close it. Previewed media stays pinned until the dialog closes, and only one player plays at a time.


## Search and sharing

Canonical metadata, Open Graph and Twitter cards, WebApplication/WebSite structured data, an indexable About guide, robots.txt, sitemap.xml and llms.txt describe the public app. The social preview is the user-provided screenshot, copied unchanged to public/social/wordrush-share-v1.png. Generated browser-local videos are never listed in the sitemap. Crawler access and metadata support discovery; indexing, rankings and AI-answer inclusion are controlled by the providers.


## Saved-library capacity

The browser library accepts at most eight saved videos. The limit is checked before starting a renderer and enforced atomically in IndexedDB across tabs. Existing larger libraries are preserved and cannot add new files until below the limit. Each card has a trash icon beside its title; deletion releases the player/object URL and removes the committed record. A 12-second Undo keeps only that deleted file in memory and can restore it if storage has room. A successful new save dismisses the previous Undo.

Storage estimates compare available origin space with the renderer’s duration and bitrate targets plus overhead before rendering. Real quota errors are also handled at save time. A completed file that could not be saved is retained temporarily for download/retry, clearly labeled unsaved instead of silently appearing in the saved gallery.

Words in Motion resets its sentence and music preset on every reload. The music preset is Stay · Version 2 at 60% volume, beginning at 2:35.68; the selected end follows the video length (2:39.31 for the default 3.63-second cut). Visitors can change or remove the music for their current session. Frame, pace, text size, blur, quality and paper preferences continue to be saved.

Words in Motion prepares only the selected music window as stereo 48 kHz PCM, then uses the bundled Mediabunny software AAC encoder. This avoids WebKit's invalid native AAC decoder-description bug (302253), and does not require native AudioEncoder, AudioData, or OfflineAudioContext. Empty selected music sections fail with a visible message; no-music and zero-volume exports remain intentionally silent. Audio preparation preserves volume, selected start, looping, end fade, mono resampling, and Web Audio speaker downmix for quad/5.1 uploads. Run `node --test test/words-in-motion-audio.test.mjs` for these regression checks.

## Product analytics

PostHog: Wordrush organization, Wordrush project **703444** — https://us.posthog.com/project/703444.

Both editors and the About page share `public/analytics.js` and one PostHog project token in `public/analytics-config.js`. The same anonymous visitor and session continue across Fast cuts and Words in Motion; every event carries `app`, `feature`, and `analytics_version`. The SDK is loaded asynchronously, and analytics failures do not block editing or export.

The integration enables page views/leaves, interaction autocapture, heatmaps, rage/dead clicks, web vitals, network timing, browser exceptions, and masked session replay at 100% sampling. The PostHog project must also have session replay enabled, a zero-second recording minimum, and the Wordrush site URL configured. It does not activate unrelated paid products or change account billing.

Explicit events cover navigation; text length and validation; editor settings and panels; preview playback/seeking; paper, music, trim and volume choices; uploads; render starts/completions/failures/cancellations and time/size; downloads; cached renders; and saved-library operations. `render_started` and `render_completed` with feature breakdowns support completion funnels, export failure rates, and render-duration reports.

Input values, user-facing generated titles, media pixels, file names, OCR, clipboard contents, network bodies/headers, and original exception messages are excluded. URLs are stripped of queries/fragments, including nested web-vitals and heatmap keys. Do Not Track and existing PostHog opt-outs are respected. Ordinary local/preview visits do not send events; an explicit `?analytics_test=1` on localhost enables a marked QA visit after project configuration. Run `node --test test/analytics-policy.test.mjs` for these privacy regressions.

Vercel rewrites `/press-events/static/*` and `/press-events/array/*` to the PostHog US assets host and other `/press-events/*` requests to its ingestion host. The public project token is not a personal API credential. Verify the completed connection in the project's live events and session recordings before release.

## Browser Typing

`/browser-typing/` turns an entered website into Safari typing B-roll using the approved filmed MacBook shot, tracked native-size text and click/typing/Enter effects. Its own page is linked with Fast cuts and Words in Motion. Phone and laptop layouts share the same controls: exact website input, typing pace, a default one-second focus pause, preset video speeds and a Custom option for values such as 2.3×. Whole-video speed also scales pauses; effects keep their natural pitch.

The prepared SDR Rec.709 movie and camera tracking preserve the Apple-native color conversion approved for the local template. Browser Typing renders H.264/AAC MP4s on the visitor's device, without the local Remotion server or upload of the entered website. Preview and export share timing, perspective and PCM sound code. Per-export generated files from the local development tool are excluded from the public bundle.

Browser Typing downloads the MP4 automatically when export finishes. Export MP4 stays visible and reuses the completed file when its text and settings are unchanged.

## Paper Trail

`/paper-trail/` is the dedicated Paper Trail editor. It shares the Wordrush navigation and branding. On laptops, story lines are on the left, a large preview is in the center, and Reset/Export plus the settings are on the right. Phones keep the compact preview and Lines/Settings tabs. Full screen preview expands the player with its playback controls; Escape returns to editing. The restart and loop arrow buttons have been removed. Reset preserves entered text.

The animation engine preserves the curved arrows, calm following camera, paper sway, independent stroke weights, dotted paths, underline, and centered bracket expansion. Settings use the isolated `wordrush.paper-trail.project.v1` storage key. MP4 export uses the same engine as the preview and runs locally with WebCodecs and Mediabunny. `ui/paper-trail-export.js` builds into the dedicated feature directory. The four `test/paper-trail-*.test.mjs` suites cover geometry, motion, strokes, and highlights.

Paper Trail includes the supplied marker and whoosh effects. A single marker stroke accompanies each highlight; the whoosh starts with each arrow journey. Sound effects and independent highlight/arrow volumes live in a closed panel. Preview and MP4 use the same timed PCM mix, encoded to AAC with the bundled software encoder for Safari compatibility. Original supplied MP3s remain unchanged; asset preparation is documented beside the WAV files.

The marker uses the supplied marker_circle.mp3 stroke at its original speed and pitch. Only silence, gain and edge fades are applied to the prepared clip; it is never compressed or pitch shifted to fit the drawing. It can finish in the reading pause and is trimmed only when a selected fast window requires it. The approved whoosh assets and PCM processing remain unchanged.

Paper Trail accepts up to 50 lines, including multiline paste and saved projects. Line rows retain only the delete control. Add a line follows the final row for short stories; long stories scroll inside the editor above the anchored add row. Motion defaults are 66% moving time, 38% paper sway and 0.70× sway speed. Marker playback has a fixed 0.1 gain calibration relative to the volume slider, leaving the selected relative level and whoosh volume unchanged.
