# Wordrush

Make a fast-paced video.

Wordrush makes a vertical 1080 × 1920 MP4 in the visitor’s browser. A Web Worker draws the approved photo opening and 50 rapid website cuts with OffscreenCanvas, then encodes H.264/AAC using WebCodecs and Mediabunny. Rendering does not upload the visitor’s phrase or video to a server.

## Run and build

```sh
npm ci
npm run build
npx serve dist
```

Deploy `dist/` to Vercel using the included `vercel.json`. GitHub pushes rebuild the static site. The legacy `npm start` server and the prepared Hetzner package remain available for development and future fallback work; the live frontend does not call their render API.

## Phrase rules

The Chrome address bar types the complete entered query, including a leading `How to`. The montage removes a leading `How to`, optionally followed by `:` or `,`, exactly once. For example, `How to: become great` types that full query and uses `become great` in the website paragraphs; `find me wife` stays unchanged in both places. Accept 1–8 words after the optional prefix. No search words are added automatically. Saved videos retain both the original query and the montage phrase; cache matching includes both.

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
