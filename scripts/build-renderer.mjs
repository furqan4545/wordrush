import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'ui/render-worker.ts')],
  outfile: path.join(root, 'public/render-worker.js'),
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'],
  legalComments: 'linked', logLevel: 'info',
});
await build({
  entryPoints: [path.join(root, 'ui/audio-browser.ts')],
  outfile: path.join(root, 'public/browser-audio.js'),
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'],
  legalComments: 'linked', logLevel: 'info',
});
