export async function openDraft() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('wordrush-fingerfont', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('draft');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.onversionchange = () => db.close();
  const records = await new Promise((resolve, reject) => {
    const values = new Map();
    const tx = db.transaction('draft');
    const cursor = tx.objectStore('draft').openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (entry) {
        values.set(entry.key, entry.value);
        entry.continue();
      }
    };
    tx.oncomplete = () => resolve(values);
    tx.onabort = () => reject(tx.error);
  });
  return {
    records,
    save(entries) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('draft', 'readwrite');
        const store = tx.objectStore('draft');
        for (const [key, value] of entries) store.put(value, key);
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}
