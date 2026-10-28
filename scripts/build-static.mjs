import {cp, mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public'), dist = path.join(root, 'dist');
await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});
for (const name of await readdir(publicDir)) {
  if (/^demo-[a-z0-9-]+\.mp4$/u.test(name) || /\.(html|css|js|txt|xml)$/u.test(name)) await cp(path.join(publicDir, name), path.join(dist, name));
}
await mkdir(path.join(dist, 'assets'), {recursive: true});
for (const name of ['chrome-photo-v7.png', 'example-great-v14.jpg', 'example-hack-v14.jpg', 'example-focus-v14.jpg']) {
  await cp(path.join(publicDir, 'assets', name), path.join(dist, 'assets', name));
}
await cp(path.join(publicDir, 'social'), path.join(dist, 'social'), {recursive: true});
await cp(path.join(publicDir, 'brand'), path.join(dist, 'brand'), {recursive: true});
await cp(path.join(publicDir, 'templates'), path.join(dist, 'templates'), {recursive: true});
for (const dir of ['user-sfx-v1', 'transition-sax-v1']) {
  const source = path.join(publicDir, 'audio', dir), target = path.join(dist, 'audio', dir);
  await mkdir(target, {recursive: true});
  for (const name of await readdir(source)) if (name.endsWith('.wav') && name !== 'typing-bed.wav') {
    await cp(path.join(source, name), path.join(target, name));
  }
}
const original = JSON.parse(await readFile(path.join(publicDir, 'audio/user-sfx-v1/manifest.json'), 'utf8'));
const asset = ({file, attackOffsetSeconds}) => ({file, attackOffsetSeconds});
await writeFile(path.join(dist, 'audio/user-sfx-v1/manifest.json'), JSON.stringify({assets: {
  enter: asset(original.assets.enter), typingKeys: original.assets.typingKeys.map(asset),
}}));
console.log('Static app ready in dist: browser rendering, 50 reusable scenes, and approved sound assets.');
