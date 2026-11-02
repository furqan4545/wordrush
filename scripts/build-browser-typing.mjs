import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'ui/browser-typing-render.js')],
  outfile: path.join(root, 'public/browser-typing/engine.js'),
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'],
  legalComments: 'linked', logLevel: 'info',
});
await build({
  entryPoints: [path.join(root, 'ui/browser-typing-preview.js')],
  outfile: path.join(root, 'public/browser-typing/preview.js'),
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'],
  legalComments: 'linked', logLevel: 'info',
});
