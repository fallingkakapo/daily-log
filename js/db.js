/* IndexedDB wrapper. Three stores:
   meals:  {id, date 'YYYY-MM-DD', time 'HH:MM', text, tags[]}
   days:   {date 'YYYY-MM-DD', bloating, gas, urgency, stools, bristol, wellbeing, stress, sleep, exercise, alcohol, note}
   stools: {id, date 'YYYY-MM-DD', time 'HH:MM', bristol 1-7|null, note} — one record per visit */

const DB_NAME = 'dailylog';
const DB_VERSION = 2;
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
      if (!db.objectStoreNames.contains('stools')) {
        const stools = db.createObjectStore('stools', { keyPath: 'id' });
        stools.createIndex('date', 'date');
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

async function getStoolsByDate(date) {
  const db = await openDB();
  const idx = db.transaction('stools', 'readonly').objectStore('stools').index('date');
  const visits = await reqToPromise(idx.getAll(date));
  visits.sort((a, b) => a.time.localeCompare(b.time));
  return visits;
}

async function dbClearAll() {
  const db = await openDB();
  await reqToPromise(db.transaction('meals', 'readwrite').objectStore('meals').clear());
  await reqToPromise(db.transaction('days', 'readwrite').objectStore('days').clear());
  await reqToPromise(db.transaction('stools', 'readwrite').objectStore('stools').clear());
}

async function exportData() {
  const [meals, days, stools] = await Promise.all([dbGetAll('meals'), dbGetAll('days'), dbGetAll('stools')]);
  return { app: 'dailylog', version: 2, exportedAt: new Date().toISOString(), meals, days, stools };
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
  for (const s of (data.stools || [])) {
    if (s.id && s.date) await dbPut('stools', s);
  }
  return { meals: data.meals.length, days: data.days.length };
}
