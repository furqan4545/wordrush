import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {appendFile, readFile} from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'ui/effects.tsx')],
  outfile: path.join(root, 'public/effects.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'},
  legalComments: 'linked',
  logLevel: 'info',
});
await appendFile(path.join(root, 'public/effects.js.LEGAL.txt'), '\n\nLibraries.dev Voice Ring (official web preview)\n' +
  await readFile(path.join(root, 'ui/vendor/voice-ring/LICENSE'), 'utf8'));
