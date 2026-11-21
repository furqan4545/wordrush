import {build} from 'esbuild';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['ui/fingerfont/app.js'],
  outdir: 'public/fingerfont',
  chunkNames: 'engine-[name]',
  splitting: true,
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'linked',
  logLevel: 'info',
});

const licenses = [
  'perfect-freehand/LICENSE',
  'opentype.js/LICENSE',
  'fonteditor-core/LICENSE',
  'tiny-inflate/LICENSE',
  'string.prototype.codepointat/LICENSE-MIT.txt',
];
const notices = await Promise.all(
  licenses.map(
    async (file) =>
      file.split('/')[0] + '\n' + (await readFile(new URL('node_modules/' + file, root), 'utf8')),
  ),
);
await writeFile(new URL('public/fingerfont/licenses.txt', root), notices.join('\n\n'));
