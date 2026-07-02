/* IndexedDB wrapper. Two stores:
   meals: {id, date 'YYYY-MM-DD', time 'HH:MM', text, tags[]}
   days:  {date 'YYYY-MM-DD', bloating, gas, urgency, stools, bristol, stress, sleep, note} */

const DB_NAME = 'dailylog';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meals')) {
        const meals = db.createObjectStore('meals', { keyPath: 'id' });
        meals.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('days')) {
        db.createObjectStore('days', { keyPath: 'date' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store, obj) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readwrite').objectStore(store).put(obj));
}

async function dbDelete(store, key) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

async function dbGet(store, key) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
}

async function dbGetAll(store) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

async function getMealsByDate(date) {
  const db = await openDB();
  const idx = db.transaction('meals', 'readonly').objectStore('meals').index('date');
  const meals = await reqToPromise(idx.getAll(date));
  meals.sort((a, b) => a.time.localeCompare(b.time));
  return meals;
}

async function dbClearAll() {
  const db = await openDB();
  await reqToPromise(db.transaction('meals', 'readwrite').objectStore('meals').clear());
  await reqToPromise(db.transaction('days', 'readwrite').objectStore('days').clear());
}

async function exportData() {
  const [meals, days] = await Promise.all([dbGetAll('meals'), dbGetAll('days')]);
  return { app: 'dailylog', version: 1, exportedAt: new Date().toISOString(), meals, days };
}

/* Merge-import: upserts by meal id / day date, never deletes existing records. */
async function importData(data) {
  if (!data || (data.app !== 'dailylog' && data.app !== 'gutlog') || !Array.isArray(data.meals) || !Array.isArray(data.days)) {
    throw new Error('Not a valid Daily Log backup file');
  }
  for (const m of data.meals) {
    if (m.id && m.date) await dbPut('meals', m);
  }
  for (const d of data.days) {
    if (d.date) await dbPut('days', d);
  }
  return { meals: data.meals.length, days: data.days.length };
}
