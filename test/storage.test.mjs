import assert from 'node:assert/strict';
import {afterEach, beforeEach, mock, test} from 'node:test';
import {IDBFactory, IDBObjectStore, IDBDatabase} from 'fake-indexeddb';
import {MAX_VIDEOS, saveVideo, getVideo, deleteVideo, recentVideos, getLibraryStatus} from '../public/browser-render.js';

const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const setNavigator = value => Object.defineProperty(globalThis, 'navigator', {configurable: true, value});
const record = index => ({
  id: `video-${index}`, word: `phrase ${index}`, query: `how to phrase ${index}`,
  createdAt: new Date(1700000000000 + index * 1000).toISOString(),
  filename: `phrase-${index}.mp4`, blob: new Blob([`video bytes ${index}`], {type: 'video/mp4'}),
  intensity: .75, duration: 8, version: 'browser-templates-v13',
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', {configurable: true, value: new IDBFactory()});
  setNavigator({});
});
afterEach(() => {
  mock.restoreAll();
  if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB); else delete globalThis.indexedDB;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
});

async function seed(count) {
  for (let index = 0; index < count; index++) await saveVideo(record(index));
}

// Simulate a previously installed release that allowed more than eight videos.
async function seedLegacy(count) {
  await getLibraryStatus();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('wordrush-videos', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('videos', 'readwrite');
      for (let index = 0; index < count; index++) transaction.objectStore('videos').put(record(index));
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {db.close();}
}

test('saves eight videos and rejects a ninth without removing any saved file', async () => {
  assert.equal(MAX_VIDEOS, 8);
  await seed(MAX_VIDEOS);
  await assert.rejects(saveVideo(record(8)), {code: 'VIDEO_LIMIT'});
  assert.equal((await getLibraryStatus()).count, 8);
  assert.equal(await getVideo('video-8'), undefined);
  assert.equal(await (await getVideo('video-0')).blob.text(), 'video bytes 0');
});

test('the eight-video cap stays atomic when separate callers save concurrently', async () => {
  const writes = await Promise.allSettled(Array.from({length: 12}, (_, index) => saveVideo(record(index))));
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 8);
  assert.equal(writes.filter(result => result.status === 'rejected').length, 4);
  for (const result of writes.filter(result => result.status === 'rejected')) assert.equal(result.reason.code, 'VIDEO_LIMIT');
  assert.equal((await getLibraryStatus()).count, 8);
});

test('updating an existing video remains possible at the limit', async () => {
  await seed(MAX_VIDEOS);
  await saveVideo({...record(3), query: 'Updated query'});
  assert.equal((await getLibraryStatus()).count, 8);
  assert.equal((await getVideo('video-3')).query, 'Updated query');
});

test('deletion commits, returns the full record for Undo, and opens a saved-video slot', async () => {
  await seed(MAX_VIDEOS);
  const deleted = await deleteVideo('video-2');
  assert.equal(deleted.query, 'how to phrase 2');
  assert.equal(await deleted.blob.text(), 'video bytes 2');
  assert.equal(deleted.blob.type, 'video/mp4');
  assert.equal(await getVideo('video-2'), undefined);
  assert.equal((await getLibraryStatus()).count, 7);
  await saveVideo(deleted);
  assert.equal((await getLibraryStatus()).count, 8);
  assert.equal(await (await getVideo('video-2')).blob.text(), 'video bytes 2');
});

test('deleting a missing video is harmless and leaves other saved videos intact', async () => {
  await seed(1);
  assert.equal(await deleteVideo('missing'), undefined);
  assert.equal((await getLibraryStatus()).count, 1);
});

test('legacy libraries above eight are preserved and block only new videos', async () => {
  await seedLegacy(10);
  const list = await recentVideos();
  assert.equal(list.length, 10);
  assert.equal(list[0].id, 'video-9');
  assert.equal('blob' in list[0], false);
  await assert.rejects(saveVideo(record(10)), {code: 'VIDEO_LIMIT'});
  await saveVideo({...record(0), query: 'Existing file updated'});
  assert.equal((await getLibraryStatus()).count, 10);
});

test('a synchronous quota error is normalized and does not create a phantom video', async () => {
  const quota = new DOMException('Origin quota exceeded', 'QuotaExceededError');
  mock.method(IDBObjectStore.prototype, 'put', () => {throw quota;});
  await assert.rejects(saveVideo(record(0)), error => {
    assert.equal(error.code, 'STORAGE_FULL');
    assert.equal(error.name, 'QuotaExceededError');
    assert.equal(error.cause, quota);
    return true;
  });
  assert.equal((await getLibraryStatus()).count, 0);
});

test('a quota abort after a successful put still rejects and rolls back the file', async () => {
  const put = IDBObjectStore.prototype.put;
  const quota = new DOMException('Commit quota exceeded', 'QuotaExceededError');
  mock.method(IDBObjectStore.prototype, 'put', function(...args) {
    const request = put.apply(this, args);
    request.addEventListener('success', () => {
      this.transaction.error = quota;
      this.transaction.abort();
    }, {once: true});
    return request;
  });
  await assert.rejects(saveVideo(record(0)), {code: 'STORAGE_FULL', name: 'QuotaExceededError'});
  assert.equal(await getVideo('video-0'), undefined);
});

test('non-quota write failures are preserved and the connection is closed', async () => {
  const failure = new Error('Write failed');
  const close = mock.method(IDBDatabase.prototype, 'close');
  mock.method(IDBObjectStore.prototype, 'put', () => {throw failure;});
  await assert.rejects(saveVideo(record(0)), error => error === failure);
  assert.equal(close.mock.callCount(), 1);
});

test('failed deletion rolls back and never reports a deleted record', async () => {
  await seed(1);
  const failure = new Error('Delete failed');
  mock.method(IDBObjectStore.prototype, 'delete', () => {throw failure;});
  await assert.rejects(deleteVideo('video-0'), error => error === failure);
  assert.equal((await getVideo('video-0')).query, 'how to phrase 0');
});

test('storage status includes origin-wide estimates when available', async () => {
  await seed(2);
  setNavigator({storage: {estimate: async () => ({usage: 1024, quota: 4096})}});
  assert.deepEqual(await getLibraryStatus(), {count: 2, usage: 1024, quota: 4096, available: 3072});
  setNavigator({storage: {estimate: async () => ({usage: 4096, quota: 1024})}});
  assert.equal((await getLibraryStatus()).available, 0);
});

test('unavailable or rejected storage estimates do not block the saved-video count', async () => {
  await seed(1);
  setNavigator({storage: {estimate: async () => {throw new Error('No estimates');}}});
  assert.deepEqual(await getLibraryStatus(), {count: 1});
  setNavigator({});
  assert.deepEqual(await getLibraryStatus(), {count: 1});
});
