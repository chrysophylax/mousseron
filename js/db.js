// IndexedDB storage. Mash-up iterations are immutable: only add(), never put().
// A mash-up's current name lives in the 'names' store, keyed by lineage.
const DB_NAME = 'mousseron';
const DB_VERSION = 2;

let dbPromise = null;

export function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('features', { keyPath: 'id' });
        db.createObjectStore('languages', { keyPath: 'id' });
        const mashups = db.createObjectStore('mashups', { keyPath: 'id' });
        mashups.createIndex('lineageId', 'lineageId');
      }
      if (e.oldVersion < 2) db.createObjectStore('names', { keyPath: 'lineageId' });
    };
    let blocked = false;
    req.onblocked = () => {
      // Don't cache the failure: a later open() retries once the other tabs are closed.
      blocked = true;
      dbPromise = null;
      reject(new Error('Close other Mousseron tabs so the database can be upgraded, then reload.'));
    };
    req.onsuccess = () => {
      const db = req.result;
      // The upgrade finished after this request was given up on; a retry opens its own connection.
      if (blocked) return db.close();
      // Let a newer version in another tab upgrade the database; reopening then fails with VersionError.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error?.name === 'VersionError'
        ? new Error('Mousseron was updated in another tab. Reload this page.')
        : req.error);
    };
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

export async function putMeta(record) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(record);
  return done(tx);
}

export async function addMashup(mashup) {
  const db = await open();
  const tx = db.transaction('mashups', 'readwrite');
  tx.objectStore('mashups').add(mashup);
  return done(tx);
}

export async function putName(record) {
  const db = await open();
  const tx = db.transaction('names', 'readwrite');
  tx.objectStore('names').put(record);
  return done(tx);
}

export async function deleteLineage(lineageId) {
  const db = await open();
  const tx = db.transaction(['mashups', 'names'], 'readwrite');
  const store = tx.objectStore('mashups');
  const keys = await request(store.index('lineageId').getAllKeys(lineageId));
  keys.forEach((k) => store.delete(k));
  tx.objectStore('names').delete(lineageId);
  return done(tx);
}
