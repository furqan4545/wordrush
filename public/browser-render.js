const DB = 'wordrush-videos';
export const MAX_VIDEOS = 8;
let manifest;
export async function getTemplates() {
  if (!manifest) manifest = fetch('/templates/v1/manifest.json').then(async response => {
    if (!response.ok) throw new Error('The website scenes could not load.');
    const result = await response.json();
    if (result.sources?.length !== 50) throw new Error('All 50 website scenes are required.');
    return result;
  }).catch(error => {manifest = undefined; throw error;});
  return manifest;
}

export function renderInBrowser({word, query = word, sources, intensity, onProgress}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/render-worker.js', {type: 'module'});
    const stop = () => {worker.terminate(); window.removeEventListener('pagehide', onLeave);};
    const onLeave = () => {stop(); reject(new DOMException('Rendering stopped when the page was closed.', 'AbortError'));};
    window.addEventListener('pagehide', onLeave, {once: true});
    worker.onerror = event => {stop(); reject(new Error(event.message || 'The video worker stopped.'));};
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') onProgress?.(data);
      if (data.type === 'error') {stop(); reject(Object.assign(new Error(data.message), {code: data.code}));}
      if (data.type === 'complete') {stop(); resolve({blob: new Blob([data.buffer], {type: 'video/mp4'}), duration: data.duration});}
    };
    worker.postMessage({type: 'render', word, query, sources, intensity, baseUrl: new URL('/', location.href).href});
  });
}

function storageError(error) {
  if (error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014) {
    return Object.assign(new Error('Your browser storage is full. Delete a saved video before creating another.', {cause: error}), {
      name: 'QuotaExceededError', code: 'STORAGE_FULL',
    });
  }
  return error;
}
function openVideos() {
  return new Promise((resolve, reject) => {
    let request;
    try {request = indexedDB.open(DB, 1);} catch (error) {reject(storageError(error)); return;}
    request.onupgradeneeded = () => request.result.createObjectStore('videos', {keyPath: 'id'}).createIndex('createdAt', 'createdAt');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}
function runTransaction(db, mode, operation) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {transaction = db.transaction('videos', mode);} catch (error) {reject(storageError(error)); return;}
    let result, failure;
    const fail = error => {
      failure = error;
      transaction.abort();
    };
    const attempt = action => {
      try {action();} catch (error) {fail(error);}
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = event => {failure ||= transaction.error || event.target.error;};
    transaction.onabort = () => reject(storageError(failure || transaction.error || new Error('The video storage transaction was interrupted.')));
    attempt(() => operation(transaction.objectStore('videos'), value => {result = value;}, fail, attempt));
  });
}
export async function saveVideo(video) {
  const db = await openVideos();
  try {
    await runTransaction(db, 'readwrite', (store, result, fail, attempt) => {
      const existing = store.getKey(video.id);
      existing.onsuccess = () => attempt(() => {
        if (existing.result !== undefined) {
          store.put(video);
          return;
        }
        const count = store.count();
        count.onsuccess = () => attempt(() => {
          if (count.result >= MAX_VIDEOS) {
            fail(Object.assign(new Error(`You have ${MAX_VIDEOS} saved videos. Delete a video before creating another.`), {code: 'VIDEO_LIMIT'}));
            return;
          }
          store.put(video);
        });
      });
    });
  } finally {db.close();}
}
export async function recentVideos() {
  const db = await openVideos();
  try {
    return await runTransaction(db, 'readonly', (store, result, fail, attempt) => {
      const videos = [], request = store.index('createdAt').openCursor(null, 'prev');
      request.onsuccess = () => attempt(() => {
        const cursor = request.result;
        if (!cursor) {result(videos); return;}
        const {blob, ...metadata} = cursor.value;
        videos.push(metadata); cursor.continue();
      });
    });
  } finally {db.close();}
}
export async function getVideo(id) {
  const db = await openVideos();
  try {
    return await runTransaction(db, 'readonly', (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => result(request.result);
    });
  } finally {db.close();}
}
export async function deleteVideo(id) {
  const db = await openVideos();
  try {
    return await runTransaction(db, 'readwrite', (store, result, fail, attempt) => {
      const request = store.get(id);
      request.onsuccess = () => attempt(() => {
        result(request.result);
        if (request.result !== undefined) store.delete(id);
      });
    });
  } finally {db.close();}
}
export async function getLibraryStatus() {
  const db = await openVideos();
  let count;
  try {
    count = await runTransaction(db, 'readonly', (store, result) => {
      const request = store.count();
      request.onsuccess = () => result(request.result);
    });
  } finally {db.close();}
  const status = {count};
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (Number.isFinite(estimate?.usage) && estimate.usage >= 0) status.usage = estimate.usage;
    if (Number.isFinite(estimate?.quota) && estimate.quota >= 0) status.quota = estimate.quota;
    if (status.usage !== undefined && status.quota !== undefined) status.available = Math.max(0, status.quota - status.usage);
  } catch { /* Count remains usable when storage estimates are unavailable. */ }
  return status;
}
