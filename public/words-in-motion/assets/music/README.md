# Inprint audio catalog

`tracks.json` is the app-facing catalog: all **17 user-provided Ali BG Music files first**, followed by the three existing Inprint Originals. Stable IDs and local URLs for the Inprint Originals are preserved.

## Ali BG Music

The catalog includes all 16 MP3 files and the one AAC/M4A file supplied in the user's Ali BG Music folder, including short effects, the saxophone loop, and both Stay versions. The SRT and TXT sidecars are metadata files and are not audio tracks. Display titles are cleaned labels; `originalFilename` and R2 `objectKey` preserve the exact original filenames. Credit: **Your library**. These files are user-provided; the catalog makes no claim about their authorship, ownership, or copyright license.

The public URLs use the Cloudflare R2 base `https://pub-c69f087cc30748f9a10a9862e3b6119d.r2.dev` and the `music/` object prefix. Each URL path is percent-encoded from its original object key. `r2-library.json` records the 17 source objects and their measured format metadata. All 17 uploaded objects were verified with the exact published site Origin: HEAD returned 200 with the original byte size, 64-byte range requests returned 206 with matching source bytes, and R2 ETags matched the source MD5 values. Verification details and timestamp are recorded there. No local absolute source paths are published in this metadata.

`r2-waveforms.json` contains equally spaced, normalized absolute-peak bins per user track: 4096 bins for tracks longer than 30 seconds and 256 bins for shorter tracks. The same bins are included as `waveform` on each catalog entry; `waveformBinCount` and `waveformBinDuration` describe their resolution. The waveforms were measured from the original audio decoded to mono at 8 kHz in memory. Audio files were not modified to create the waveforms.

# Inprint Originals

Three original instrumental cues composed and synthesized independently for this app on November 1, 2026. No commercial recordings, external audio samples, or existing melodies were used. Credit: **Inprint Originals**.

- **After Hours** — 80 BPM; 8 bars / 24 seconds. Warm electric-key synthesis, an original sparse melodic line, rounded bass, and quiet synthesized percussion.
- **Paper Trail** — 108 BPM; 12 bars / 26.666667 seconds. Muted mallet/pluck figures, syncopated electric keys, rounded bass, and a light rhythmic pulse.
- **Quiet Momentum** — 64 BPM; 8 bars / 30 seconds. Soft harmonic pads, felt-key synthesis, an original spacious melodic line, and a restrained mallet accent; no drum groove.

All instruments and percussion are mathematical synthesis with deterministic variation. Harmony, note sequences, voicings, and rhythmic patterns were composed for these cues. Circular instrument tails and room/tempo-delay reflections preserve the musical loop; a 12 ms cosine edge envelope avoids decoder clicks. The delivered MP3s are stereo, 48 kHz, 192 kbit/s. Tiny MP3 encoder padding is included in file duration; `loopDuration` records the exact musical duration.

Mastering targets were −18 LUFS integrated and −2.5 dBTP. See `metrics.json` for actual measurements of the final decoded MP3s, file sizes, durations, and stream details. These measurements describe signal properties; subjective listening review is still recommended before a release.

`tracks.json` is the app-facing manifest. Origin is original app composition; this note does not assert a separate third-party license or clearance.
