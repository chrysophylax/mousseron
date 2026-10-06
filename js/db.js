// IndexedDB storage. Mash-up iterations are immutable: only add(), never put().
const DB_NAME = 'mousseron';
const DB_VERSION = 1;

let dbPromise = null;

export function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('features', { keyPath: 'id' });
      db.createObjectStore('languages', { keyPath: 'id' });
      const mashups = db.createObjectStore('mashups', { keyPath: 'id' });
      mashups.createIndex('lineageId', 'lineageId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error ?? tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export async function get(store, key) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function replaceDataset({ meta, features, languages }) {
  const db = await open();
  const tx = db.transaction(['meta', 'features', 'languages'], 'readwrite');
  const f = tx.objectStore('features');
  const l = tx.objectStore('languages');
  f.clear();
  l.clear();
  features.forEach((x) => f.add(x));
  languages.forEach((x) => l.add(x));
  tx.objectStore('meta').put(meta);
  return done(tx);
}

export async function addMashup(mashup) {
  const db = await open();
  const tx = db.transaction('mashups', 'readwrite');
  tx.objectStore('mashups').add(mashup);
  return done(tx);
}

export async function deleteLineage(lineageId) {
  const db = await open();
  const tx = db.transaction('mashups', 'readwrite');
  const store = tx.objectStore('mashups');
  const keys = await request(store.index('lineageId').getAllKeys(lineageId));
  keys.forEach((k) => store.delete(k));
  return done(tx);
}
