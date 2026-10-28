const DB = 'wordrush-videos';
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

export function renderInBrowser({word, sources, intensity, onProgress}) {
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
    worker.postMessage({type: 'render', word, sources, intensity, baseUrl: new URL('/', location.href).href});
  });
}

function openVideos() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('videos', {keyPath: 'id'}).createIndex('createdAt', 'createdAt');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveVideo(video) {
  const db = await openVideos();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('videos', 'readwrite');
      transaction.objectStore('videos').put(video);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {db.close();}
}
export async function recentVideos() {
  const db = await openVideos();
  try {
    return await new Promise((resolve, reject) => {
      const videos = [], request = db.transaction('videos').objectStore('videos').index('createdAt').openCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || videos.length >= 6) return resolve(videos);
        videos.push(cursor.value); cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } finally {db.close();}
}
