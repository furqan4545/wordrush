import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'ui/paper-trail-export.js')],
  outfile: path.join(root, 'public/paper-trail/export.js'),
  external: ['./engine.js', './audio.js'],
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'],
  legalComments: 'linked', logLevel: 'info',
});
