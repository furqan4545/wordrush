import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {copyFile, cp, mkdir, mkdtemp, readdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, '../..');
const destination = process.argv[2]
  ? path.resolve(process.argv[2])
  : await mkdtemp(path.join(os.tmpdir(), 'wordrush-build-'));
await mkdir(destination, {recursive: true});
if ((await readdir(destination)).length) throw new Error('Use a new empty directory for the deployment context.');

const files = [
  ['deployment/hetzner/runtime-package.json', 'package.json'],
  ['deployment/hetzner/runtime-package-lock.json', 'package-lock.json'],
  ['deployment/hetzner/Dockerfile', 'Dockerfile'],
  ...['package.json', 'package-lock.json', 'server.mjs', 'source-capture.mjs', 'source-sites.json',
    'video/index.tsx', 'video/audio.mjs', 'video/archive-v3-intro-before/scene.js',
    'public/assets/chrome-photo-v7.png'].map(relative => [relative, `word-studio/${relative}`]),
];

// Include compiled browser assets, not source/capture/history directories.
for (const item of await readdir(path.join(studio, 'public'), {withFileTypes: true})) {
  if (item.isFile() && /\.(?:html|js|css|svg|txt|ico|webmanifest)$/u.test(item.name)) {
    files.push([`public/${item.name}`, `word-studio/public/${item.name}`]);
  }
}

const manifest = [];
for (const [relative, output] of files) {
  const source = path.join(studio, relative), target = path.join(destination, output);
  await mkdir(path.dirname(target), {recursive: true});
  await copyFile(source, target);
  const bytes = await readFile(target);
  manifest.push({file: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
for (const name of ['user-sfx-v1', 'transition-sax-v1']) {
  const source = path.join(studio, 'public/audio', name);
  await cp(source, path.join(destination, 'word-studio/public/audio', name), {recursive: true});
}
await writeFile(path.join(destination, 'BUILD-MANIFEST.json'), JSON.stringify({
  purpose: 'Wordrush Hetzner renderer; no previous exports, capture cache, source archives, or private brand assets',
  createdAt: new Date().toISOString(), files: manifest,
}, null, 2) + '\n');
console.log(JSON.stringify({directory: destination, files: manifest.length, dataDirectoriesIncluded: false}));
