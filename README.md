# Wordrush

A few words. A whole feeling.

Wordrush makes a vertical 1080 × 1920 MP4 in the visitor’s browser. A Web Worker draws the approved photo opening and 50 rapid website cuts with OffscreenCanvas, then encodes H.264/AAC using WebCodecs and Mediabunny. Rendering does not upload the visitor’s phrase or video to a server.

## Run and build

```sh
npm ci
npm run build
npx serve dist
```

Deploy `dist/` to Vercel using the included `vercel.json`. GitHub pushes rebuild the static site. The legacy `npm start` server and the prepared Hetzner package remain available for development and future fallback work; the live frontend does not call their render API.

## Phrase rules

A leading `How to`, optionally followed by `:` or `,`, is removed once. Other text is used directly. For example, `How to: become great` becomes `become great`; `find me wife` stays `find me wife`. Accept 1–8 words after that prefix. Keep entered text visible in the form and show the resolved phrase below it. No automatic search words are added.

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
