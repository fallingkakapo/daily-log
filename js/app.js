/* Daily Log — app shell, Today + History tabs, sheets. Trends rendering lives in trends.js */

const APP_VERSION = 'v11'; // keep in step with VERSION in sw.js

const BRISTOL_DESC = {
  1: 'Type 1 — separate hard lumps',
  2: 'Type 2 — lumpy, sausage-shaped',
  3: 'Type 3 — sausage with surface cracks',
  4: 'Type 4 — smooth and soft',
  5: 'Type 5 — soft blobs with clear edges',
  6: 'Type 6 — mushy with ragged edges',
  7: 'Type 7 — liquid, no solid pieces',
};

const SEVERITY_WORDS = ['none', 'very mild', 'mild', 'moderate', 'severe', 'very severe'];
const STRESS_WORDS = ['none', 'minimal', 'low', 'low', 'mild', 'moderate', 'moderate', 'high', 'high', 'very high', 'extreme'];
const WELLBEING_WORDS = ['terrible', 'awful', 'poor', 'low', 'meh', 'okay', 'decent', 'good', 'very good', 'great', 'excellent'];
const FATIGUE_WORDS = ['', 'none', 'very low', 'low', 'mild', 'moderate', 'noticeable', 'high', 'very high', 'severe', 'exhausted'];

/* Pre-registered n-of-1 schedule — the card follows it so ON/OFF is never a guess */
const PSYLLIUM_GRAMS = 7.5;
const PSYLLIUM_TRIAL = [
  { from: '2026-09-30', to: '2026-10-13', on: true },
  { from: '2026-10-14', to: '2026-10-20', on: false },
  { from: '2026-10-21', to: '2026-11-03', on: true },
  { from: '2026-11-04', to: '2026-11-10', on: false },
];

let currentTab = 'today';
let expandedDate = null;

/* ---------- helpers ---------- */

function pad(n) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateFromStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(s, withYear) {
  const d = dateFromStr(s);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (withYear) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

function fmtTime(t) {
  return t;
}

function addDays(s, n) {
  const d = dateFromStr(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(a, b) {
  return Math.round((dateFromStr(b) - dateFromStr(a)) / 86400000);
}

function trialPhase(date) {
  const block = PSYLLIUM_TRIAL.find(b => date >= b.from && date <= b.to);
  if (!block) return null;
  return { on: block.on, day: daysBetween(block.from, date) + 1, len: daysBetween(block.from, block.to) + 1 };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtUnits(v) {
  return v % 1 ? v.toFixed(1) : String(v);
}

/* Real stools only — gas-only visits are logged for timing but aren't stools */
function stoolVisits(visits) {
  return (visits || []).filter(s => !s.gasOnly);
}

/* The day's Bristol: median of rated visits when there are any, else the
   check-in's "typical" type. Median, not mean — a day of 5s with one 6 is a 5 */
function dayBristol(day, visits) {
  const rated = stoolVisits(visits).map(s => s.bristol).filter(Boolean).sort((a, b) => a - b);
  if (!rated.length) return day ? day.bristol : null;
  const mid = rated.length >> 1;
  return rated.length % 2 ? rated[mid] : (rated[mid - 1] + rated[mid]) / 2;
}

/* Fixed, objective rule — mirrored verbatim in the Trends label so the
   number is always interpretable: every symptom <=2 and, if rated, Bristol 3-5 */
function isGoodDay(day, visits) {
  if (!day) return false;
  const b = dayBristol(day, visits);
  const bristolOk = b == null || (b >= 3 && b <= 5);
  const discomfortOk = day.discomfort == null || day.discomfort <= 2;
  return day.bloating <= 2 && day.gas <= 2 && day.urgency <= 2 && discomfortOk && bristolOk;
}

let toastTimer = null;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- tabs ---------- */

const TAB_TITLES = { today: 'Today', history: 'History', trends: 'Trends' };

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.id !== 'tab-' + tab; });
  document.getElementById('topbar-title').textContent = TAB_TITLES[tab];
  render();
}

async function render() {
  if (currentTab === 'today') await renderToday();
  else if (currentTab === 'history') await renderHistory();
  else await renderTrendsTab();
}

/* ---------- meal suggestions ---------- */

function buildSuggestionIndex(allMeals) {
  const map = new Map();
  for (const m of allMeals) {
    const key = m.text.trim().toLowerCase();
    if (!key) continue;
    const cur = map.get(key) || { text: m.text.trim(), count: 0, last: '', tags: [] };
    cur.count++;
    const stamp = m.date + m.time;
    if (stamp > cur.last) { cur.last = stamp; cur.text = m.text.trim(); cur.tags = m.tags || []; }
    map.set(key, cur);
  }
  return [...map.values()];
}

function getSuggestions(index, query) {
  const q = query.trim().toLowerCase();
  let list = index;
  if (q) list = index.filter(s => s.text.toLowerCase().includes(q) && s.text.toLowerCase() !== q);
  return list.sort((a, b) => (b.count - a.count) || b.last.localeCompare(a.last)).slice(0, 6);
}

/* ---------- Today tab ---------- */

async function renderToday() {
  const container = document.getElementById('tab-today');
  const date = todayStr();
  const [meals, day, allMeals, visits, doses, allDoses] = await Promise.all([
    getMealsByDate(date), dbGet('days', date), dbGetAll('meals'), getStoolsByDate(date), getDosesByDate(date), dbGetAll('doses'),
  ]);
  /* Card shows during the trial, and afterwards while doses are still being logged */
  const recentDose = allDoses.some(x => x.date >= addDays(date, -14));
  const showDose = trialPhase(date) || recentDose;
  const suggestionIndex = buildSuggestionIndex(allMeals);
  const yesterday = addDays(date, -1);
  const yDay = await dbGet('days', yesterday);
  const hasAnyData = allMeals.length > 0;

  container.innerHTML = `
    <p class="date-heading">${fmtDate(date)}</p>
    ${!yDay && hasAnyData ? `<div class="nudge" id="yesterday-nudge">Yesterday's check-in is missing — <b>tap to fill it in</b></div>` : ''}
    <div class="card">
      <h2>Meals</h2>
      <div class="meal-input-row">
        <input type="time" id="meal-time" value="${nowTime()}">
        <input type="text" id="meal-text" placeholder="Log a meal…" autocomplete="off">
        <button class="btn primary" id="meal-add">Add</button>
      </div>
      <div class="chip-row" id="meal-suggestions"></div>
      <div class="meal-list" id="meal-list"></div>
    </div>
    ${showDose ? '<div class="card" id="dose-card"></div>' : ''}
    <div id="checkin-card"></div>
  `;

  const nudge = container.querySelector('#yesterday-nudge');
  if (nudge) nudge.addEventListener('click', () => { expandedDate = yesterday; switchTab('history'); });

  const textInput = container.querySelector('#meal-text');
  const timeInput = container.querySelector('#meal-time');
  const sugRow = container.querySelector('#meal-suggestions');

  function renderSuggestions() {
    const sugs = getSuggestions(suggestionIndex, textInput.value);
    sugRow.innerHTML = sugs.map((s, i) =>
      `<button class="chip suggestion" data-i="${i}">${escapeHtml(s.text)}</button>`).join('');
    sugRow.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      const s = sugs[Number(c.dataset.i)];
      const sheet = openSheet(`
        <h2>Log meal</h2>
        <p class="empty-note" style="margin-bottom:10px">${escapeHtml(s.text)}</p>
        <div class="sheet-row"><input type="time" id="lm-time" value="${nowTime()}"></div>
        <div class="actions"><button class="btn primary" id="lm-save">Log meal</button></div>
      `);
      sheet.querySelector('#lm-save').addEventListener('click', async () => {
        await dbPut('meals', { id: crypto.randomUUID(), date, time: sheet.querySelector('#lm-time').value || nowTime(), text: s.text, tags: s.tags });
        closeSheet();
        toast('Logged: ' + s.text);
        renderToday();
      });
    }));
  }
  renderSuggestions();
  textInput.addEventListener('input', renderSuggestions);

  async function addMeal() {
    const text = textInput.value.trim();
    if (!text) { textInput.focus(); return; }
    await dbPut('meals', { id: crypto.randomUUID(), date, time: timeInput.value || nowTime(), text, tags: [] });
    toast('Logged: ' + text);
    renderToday();
  }
  container.querySelector('#meal-add').addEventListener('click', addMeal);
  textInput.addEventListener('keydown', e => { if (e.key === 'Enter') addMeal(); });

  if (showDose) renderDoseCard(container.querySelector('#dose-card'), date, doses, () => renderToday());
  renderMealList(container.querySelector('#meal-list'), meals, () => renderToday());
  renderCheckinCard(container.querySelector('#checkin-card'), date, day, visits, () => renderToday());
}

function renderMealList(listEl, meals, onChange) {
  if (!meals.length) {
    listEl.innerHTML = `<p class="empty-note">No meals logged yet.</p>`;
    return;
  }
  listEl.innerHTML = meals.map(m => `
    <div class="meal-row" data-id="${m.id}">
      <span class="meal-time">${fmtTime(m.time)}</span>
      <span class="meal-text">${escapeHtml(m.text)}
        ${m.tags && m.tags.length ? `<span class="meal-tags">${m.tags.map(escapeHtml).join(' · ')}</span>` : ''}
      </span>
    </div>`).join('');
  listEl.querySelectorAll('.meal-row').forEach(row => {
    row.addEventListener('click', () => {
      const meal = meals.find(m => m.id === row.dataset.id);
      openMealSheet(meal, onChange);
    });
  });
}

/* ---------- psyllium (shared by Today and History) ---------- */

function fmtGrams(g) {
  return (Math.round(g * 100) / 100) + ' g';
}

/* Doses can be split through the day; the primary button logs whatever is
   left of the daily target, "Other amount" logs a custom quantity */
function renderDoseCard(el, date, doses, onChange) {
  const phase = trialPhase(date);
  const phaseText = phase ? `${phase.on ? 'ON' : 'OFF'} · day ${phase.day} of ${phase.len}` : '';
  const total = doses.reduce((a, x) => a + (x.grams || 0), 0);
  const remaining = Math.round((PSYLLIUM_GRAMS - total) * 100) / 100;
  const isToday = date === todayStr();
  const hint = phase && !phase.on && !doses.length ? 'OFF week — no dose today'
    : doses.length ? (remaining > 0 ? `${fmtGrams(total)} of ${fmtGrams(PSYLLIUM_GRAMS)} so far — tap a dose to edit` : 'Tap a dose to edit it')
    : isToday ? 'Logs a dose at the current time' : 'Adds a dose to this day';
  el.innerHTML = `
    <h2>Psyllium <span class="sub">· ${doses.length ? `${fmtGrams(total)} / ` : ''}${fmtGrams(PSYLLIUM_GRAMS)}${phaseText ? ' · ' + phaseText : ''}</span></h2>
    ${doses.length ? `<div class="meal-list">${doses.map(x => `
      <div class="meal-row" data-id="${x.id}">
        <span class="meal-time">${x.time}</span>
        <span class="meal-text">${fmtGrams(x.grams)}</span>
      </div>`).join('')}</div>` : ''}
    <div class="visit-btns" style="${doses.length ? 'margin-top:6px;' : ''}">
      ${remaining > 0 ? `<button type="button" class="btn ${phase && !phase.on ? '' : 'primary'}" id="dose-add">${doses.length ? `Log remaining ${fmtGrams(remaining)}` : `Log ${fmtGrams(PSYLLIUM_GRAMS)}`}</button>` : ''}
      <button type="button" class="btn" id="dose-other">${remaining > 0 ? 'Other amount' : '+ Add more'}</button>
    </div>
    <p class="empty-note" style="padding:6px 0 0;">${hint}</p>
  `;
  const add = el.querySelector('#dose-add');
  if (add) add.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isToday) {
      await dbPut('doses', { id: crypto.randomUUID(), date, time: nowTime(), what: 'psyllium', grams: remaining });
      toast(`Psyllium logged · ${fmtGrams(remaining)}`);
      onChange();
    } else {
      openDoseSheet(null, date, onChange, remaining);
    }
  });
  el.querySelector('#dose-other').addEventListener('click', (e) => {
    e.stopPropagation();
    openDoseSheet(null, date, onChange, remaining > 0 ? remaining : PSYLLIUM_GRAMS);
  });
  el.querySelectorAll('.meal-row').forEach(row => row.addEventListener('click', (e) => {
    e.stopPropagation();
    openDoseSheet(doses.find(x => x.id === row.dataset.id), date, onChange);
  }));
}

function openDoseSheet(dose, date, onChange, grams) {
  const isNew = !dose;
  const x = dose || { id: crypto.randomUUID(), date, time: date === todayStr() ? nowTime() : '09:00', what: 'psyllium', grams: grams || PSYLLIUM_GRAMS };
  const sheet = openSheet(`
    <h2>${isNew ? 'Add psyllium dose' : 'Edit psyllium dose'}</h2>
    <div class="sheet-row"><input type="time" id="ds-time" value="${x.time}"></div>
    <div class="sheet-row dose-grams">
      <input type="number" id="ds-grams" inputmode="decimal" min="0.25" max="30" step="0.25" value="${x.grams}">
      <span>g</span>
    </div>
    <div class="chip-row" id="ds-chips" style="margin:0 0 4px">
      ${[2.5, 3.75, 5, 7.5].map(g => `<button type="button" class="chip" data-g="${g}">${g} g</button>`).join('')}
    </div>
    <div class="actions">
      ${isNew ? '' : '<button class="btn danger" id="ds-delete">Delete</button>'}
      <button class="btn primary" id="ds-save">Save</button>
    </div>
  `);
  const gramsInput = sheet.querySelector('#ds-grams');
  sheet.querySelectorAll('#ds-chips .chip').forEach(c => c.addEventListener('click', () => {
    gramsInput.value = c.dataset.g;
  }));
  sheet.querySelector('#ds-save').addEventListener('click', async () => {
    const g = Math.round(parseFloat(gramsInput.value) * 100) / 100;
    if (!(g > 0 && g <= 30)) { gramsInput.focus(); toast('Enter an amount in grams'); return; }
    await dbPut('doses', { ...x, time: sheet.querySelector('#ds-time').value || x.time, grams: g });
    closeSheet();
    toast(isNew ? `Dose added · ${fmtGrams(g)}` : 'Dose updated');
    onChange();
  });
  const del = sheet.querySelector('#ds-delete');
  if (del) del.addEventListener('click', async () => {
    await dbDelete('doses', x.id);
    closeSheet();
    toast('Dose deleted');
    onChange();
  });
}

/* ---------- check-in (shared by Today and History) ---------- */

function visitListHtml(visits) {
  return `<div class="meal-list" id="ci-visits">${visits.map(s => `
    <div class="meal-row" data-id="${s.id}">
      <span class="meal-time">${s.time}</span>
      <span class="meal-text">${s.gasOnly ? 'Gas only' : s.bristol ? 'Type ' + s.bristol : 'Unrated'}${s.note ? ` <span class="meal-tags">· ${escapeHtml(s.note)}</span>` : ''}</span>
    </div>`).join('')}</div>`;
}

/* onChanged is the caller's full refresh handler (including syncDayStools) —
   the form passes one that preserves unsaved slider values across the refresh */
function wireVisits(cardEl, date, visits, onChanged) {
  cardEl.querySelector('#ci-add-visit').addEventListener('click', async () => {
    if (date === todayStr()) {
      await dbPut('stools', { id: crypto.randomUUID(), date, time: nowTime(), bristol: null, note: '' });
      toast('Stool logged — tap it to rate');
      onChanged();
    } else {
      openStoolSheet(null, date, onChanged);
    }
  });
  cardEl.querySelector('#ci-add-gas').addEventListener('click', async () => {
    if (date === todayStr()) {
      await dbPut('stools', { id: crypto.randomUUID(), date, time: nowTime(), bristol: null, gasOnly: true, note: '' });
      toast('Gas-only visit logged');
      onChanged();
    } else {
      openStoolSheet(null, date, onChanged, true);
    }
  });
  cardEl.querySelectorAll('#ci-visits .meal-row').forEach(row => row.addEventListener('click', (e) => {
    e.stopPropagation();
    openStoolSheet(visits.find(s => s.id === row.dataset.id), date, onChanged);
  }));
}

function renderCheckinCard(cardEl, date, day, visits, onSaved, draft) {
  const isToday = date === todayStr();
  visits = visits || [];
  const stoolCount = stoolVisits(visits).length;
  const gasCount = visits.length - stoolCount;
  if (day && !cardEl.dataset.editing) {
    const bristol = dayBristol(day, visits);
    cardEl.innerHTML = `
      <div class="card">
      <h2>Daily check-in <span class="sub">· done</span></h2>
      <div class="checkin-summary">
        <div class="checkin-pills">
          ${day.wellbeing != null ? `<span class="pill">Wellbeing <b>${day.wellbeing}</b></span>` : ''}
          <span class="pill">Stress <b>${day.stress}</b></span>
          ${day.sleep != null ? `<span class="pill">Sleep <b>${day.sleep}h</b>${day.sleepQuality != null ? ` · q<b>${day.sleepQuality}</b>` : ''}</span>` : ''}
          ${day.fatigue != null ? `<span class="pill">Fatigue <b>${day.fatigue}</b>${day.fatigueExercise ? ' · exercise' : ''}</span>` : ''}
          ${day.exercise != null ? `<span class="pill">Exercise <b>${day.exercise}m</b></span>` : ''}
          ${day.alcohol != null ? `<span class="pill">Alcohol <b>${fmtUnits(day.alcohol)}u</b></span>` : ''}
          <span class="pill">Bloating <b>${day.bloating}</b></span>
          <span class="pill">Gas <b>${day.gas}</b></span>
          <span class="pill">Urgency <b>${day.urgency}</b></span>
          ${day.discomfort != null ? `<span class="pill">Discomfort <b>${day.discomfort}</b></span>` : ''}
          <span class="pill">Stools <b>${visits.length ? stoolCount : day.stools}</b>${bristol ? ` · B<b>${bristol}</b>` : ''}</span>
          ${gasCount ? `<span class="pill">Gas only <b>${gasCount}</b></span>` : ''}
        </div>
        <button class="btn" id="checkin-edit">Edit</button>
      </div>
      ${day.note ? `<p class="empty-note" style="margin-top:8px">${escapeHtml(day.note)}</p>` : ''}
      <div style="border-top: 0.5px solid var(--border); margin-top: 12px; padding-top: 4px;">
        ${visitListHtml(visits)}
        <div class="visit-btns" style="margin-top:8px;">
          <button type="button" class="btn" id="ci-add-visit">+ Log stool</button>
          <button type="button" class="btn" id="ci-add-gas">+ Gas only</button>
        </div>
        <p class="empty-note" style="padding:6px 0 0;">${visits.length ? 'Tap a visit to edit it' : (isToday ? 'Logs a visit at the current time' : 'Adds a visit to this day')}</p>
      </div>
      </div>
    `;
    cardEl.querySelector('#checkin-edit').addEventListener('click', () => {
      cardEl.dataset.editing = '1';
      renderCheckinCard(cardEl, date, day, visits, onSaved);
    });
    wireVisits(cardEl, date, visits, async () => { await syncDayStools(date); onSaved(); });
    return;
  }

  const v = draft || day || { bloating: 0, gas: 0, urgency: 0, discomfort: 0, stools: 0, bristol: null, wellbeing: 5, stress: 5, sleep: 7, sleepQuality: 5, fatigue: 5, fatigueExercise: false, exercise: 0, alcohol: 0, note: '' };

  cardEl.innerHTML = `
    <div class="card">
      <h2>Daily check-in ${isToday ? '' : `<span class="sub">· ${fmtDate(date)}</span>`}</h2>
      ${slider('wellbeing', 'Overall wellbeing', v.wellbeing != null ? v.wellbeing : 5, 10, WELLBEING_WORDS)}
      ${slider('stress', 'Stress', v.stress, 10, STRESS_WORDS)}
      ${slider('sleep', 'Sleep', v.sleep != null ? v.sleep : 7, 12, null, 0.5, 'h')}
      ${slider('sleep-quality', 'Sleep quality', v.sleepQuality != null ? v.sleepQuality : 5, 10, WELLBEING_WORDS)}
      ${slider('fatigue', 'Fatigue', v.fatigue != null ? v.fatigue : 5, 10, FATIGUE_WORDS, 1, '', 1)}
      <div class="chip-row" style="margin-top:-6px; margin-bottom:14px">
        <button type="button" class="chip toggle ${v.fatigueExercise ? 'on' : ''}" id="ci-fatigue-ex" aria-pressed="${!!v.fatigueExercise}">Exercise-induced</button>
      </div>
      <div class="slider-label"><span>Exercise</span><span class="val" id="ex-val">${v.exercise != null ? v.exercise : 0} min</span></div>
      <div class="chip-row" style="margin-top:6px" id="ex-chips">
        <button type="button" class="chip" data-add="5">+5 min</button>
        <button type="button" class="chip" data-add="15">+15</button>
        <button type="button" class="chip" data-add="30">+30</button>
        <button type="button" class="chip" data-add="60">+60</button>
        <button type="button" class="chip" id="ex-clear">reset</button>
      </div>
      <div class="slider-label" style="margin-top:14px"><span>Alcohol</span><span class="val" id="al-val">${fmtUnits(v.alcohol != null ? v.alcohol : 0)} units</span></div>
      <div class="chip-row" style="margin-top:6px" id="al-chips">
        <button type="button" class="chip" data-add="0.5">+0.5</button>
        <button type="button" class="chip" data-add="1">+1</button>
        <button type="button" class="chip" data-add="2">+2</button>
        <button type="button" class="chip" id="al-clear">reset</button>
      </div>
    </div>
    <div class="card">
      <h2>Symptoms</h2>
      ${slider('bloating', 'Bloating', v.bloating, 5, SEVERITY_WORDS)}
      ${slider('gas', 'Gas', v.gas, 5, SEVERITY_WORDS)}
      ${slider('urgency', 'Urgency', v.urgency, 5, SEVERITY_WORDS)}
      ${slider('discomfort', 'Discomfort / pain', v.discomfort != null ? v.discomfort : 0, 5, SEVERITY_WORDS)}
    </div>
    <div class="card">
      <h2>Stools</h2>
      ${visitListHtml(visits)}
      <div class="visit-btns" style="${visits.length ? 'margin-top:6px;' : ''}">
        <button type="button" class="btn" id="ci-add-visit">+ Log stool</button>
        <button type="button" class="btn" id="ci-add-gas">+ Gas only</button>
      </div>
      <p class="empty-note" style="padding:6px 0 0;">${visits.length ? `${stoolCount} stool${stoolCount === 1 ? '' : 's'}${gasCount ? ` + ${gasCount} gas only` : ''} — tap one to edit` : (isToday ? 'Logs a visit at the current time' : 'Adds a visit to this day')}</p>
      ${visits.length ? '' : `
      <div class="stepper-row" style="margin-top:10px">
        <span>Total for the day (manual)</span>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="Fewer">−</button>
          <span class="count" id="ci-stools">${v.stools}</span>
          <button type="button" data-step="1" aria-label="More">+</button>
        </div>
      </div>`}
      <p class="field-label" style="margin-top:12px">Typical Bristol type
        <button type="button" class="info-btn" id="ci-bristol-info" aria-label="Bristol scale reference">?</button></p>
      <div class="bristol-row" id="ci-bristol">
        ${[1,2,3,4,5,6,7].map(n => `<button type="button" class="bristol-btn ${v.bristol === n ? 'on' : ''}" data-b="${n}">${n}</button>`).join('')}
      </div>
      <p class="bristol-desc" id="bristol-desc">${v.bristol ? BRISTOL_DESC[v.bristol] : 'Tap a type (tap again to clear)'}</p>
    </div>
    <div class="card">
      <h2>Notes</h2>
      <textarea id="ci-note" rows="2" placeholder="Anything else about today…">${escapeHtml(v.note || '')}</textarea>
      <button class="btn primary full" id="ci-save">${day ? 'Update check-in' : 'Save check-in'}</button>
    </div>
  `;

  cardEl.querySelectorAll('input[type=range]').forEach(r => {
    r.addEventListener('input', () => {
      const out = cardEl.querySelector(`#val-${r.id}`);
      const words = r.dataset.words ? JSON.parse(r.dataset.words) : null;
      const val = Number(r.value);
      out.textContent = words ? `${val} · ${words[val]}` : `${val}${r.dataset.unit || ''}`;
    });
  });

  let exercise = v.exercise != null ? v.exercise : 0;
  const exVal = cardEl.querySelector('#ex-val');
  cardEl.querySelectorAll('#ex-chips .chip[data-add]').forEach(c => c.addEventListener('click', () => {
    exercise = Math.min(600, exercise + Number(c.dataset.add));
    exVal.textContent = exercise + ' min';
  }));
  cardEl.querySelector('#ex-clear').addEventListener('click', () => {
    exercise = 0;
    exVal.textContent = '0 min';
  });

  let alcohol = v.alcohol != null ? v.alcohol : 0;
  const alVal = cardEl.querySelector('#al-val');
  cardEl.querySelectorAll('#al-chips .chip[data-add]').forEach(c => c.addEventListener('click', () => {
    alcohol = Math.min(50, Math.round((alcohol + Number(c.dataset.add)) * 10) / 10);
    alVal.textContent = fmtUnits(alcohol) + ' units';
  }));
  cardEl.querySelector('#al-clear').addEventListener('click', () => {
    alcohol = 0;
    alVal.textContent = '0 units';
  });

  let stools = visits.length ? stoolCount : v.stools;

  let fatigueExercise = !!v.fatigueExercise;
  const fxChip = cardEl.querySelector('#ci-fatigue-ex');
  fxChip.addEventListener('click', () => {
    fatigueExercise = !fatigueExercise;
    fxChip.classList.toggle('on', fatigueExercise);
    fxChip.setAttribute('aria-pressed', fatigueExercise);
  });
  const stoolsEl = cardEl.querySelector('#ci-stools');
  if (stoolsEl) {
    cardEl.querySelectorAll('.stepper button').forEach(b => b.addEventListener('click', () => {
      stools = Math.max(0, Math.min(15, stools + Number(b.dataset.step)));
      stoolsEl.textContent = stools;
    }));
  }

  const captureDraft = () => ({
    bloating: Number(cardEl.querySelector('#ci-bloating').value),
    gas: Number(cardEl.querySelector('#ci-gas').value),
    urgency: Number(cardEl.querySelector('#ci-urgency').value),
    discomfort: Number(cardEl.querySelector('#ci-discomfort').value),
    stools,
    bristol,
    wellbeing: Number(cardEl.querySelector('#ci-wellbeing').value),
    stress: Number(cardEl.querySelector('#ci-stress').value),
    sleep: Number(cardEl.querySelector('#ci-sleep').value),
    sleepQuality: Number(cardEl.querySelector('#ci-sleep-quality').value),
    fatigue: Number(cardEl.querySelector('#ci-fatigue').value),
    fatigueExercise,
    exercise,
    alcohol,
    note: cardEl.querySelector('#ci-note').value,
  });
  wireVisits(cardEl, date, visits, async () => {
    const unsaved = captureDraft();
    await syncDayStools(date);
    renderCheckinCard(cardEl, date, day, await getStoolsByDate(date), onSaved, unsaved);
  });

  let bristol = v.bristol;
  const bRow = cardEl.querySelector('#ci-bristol');
  function applyBristol(n) {
    bristol = n;
    bRow.querySelectorAll('.bristol-btn').forEach(x => x.classList.toggle('on', Number(x.dataset.b) === bristol));
    cardEl.querySelector('#bristol-desc').textContent = bristol ? BRISTOL_DESC[bristol] : 'Tap a type (tap again to clear)';
  }
  bRow.querySelectorAll('.bristol-btn').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.b);
    applyBristol(bristol === n ? null : n);
  }));
  cardEl.querySelector('#ci-bristol-info').addEventListener('click', () => openBristolSheet(bristol, applyBristol));

  cardEl.querySelector('#ci-save').addEventListener('click', async () => {
    const rec = {
      date,
      bloating: Number(cardEl.querySelector('#ci-bloating').value),
      gas: Number(cardEl.querySelector('#ci-gas').value),
      urgency: Number(cardEl.querySelector('#ci-urgency').value),
      discomfort: Number(cardEl.querySelector('#ci-discomfort').value),
      stools,
      bristol,
      wellbeing: Number(cardEl.querySelector('#ci-wellbeing').value),
      stress: Number(cardEl.querySelector('#ci-stress').value),
      sleep: Number(cardEl.querySelector('#ci-sleep').value),
      sleepQuality: Number(cardEl.querySelector('#ci-sleep-quality').value),
      fatigue: Number(cardEl.querySelector('#ci-fatigue').value),
      fatigueExercise,
      exercise,
      alcohol,
      note: cardEl.querySelector('#ci-note').value.trim(),
    };
    await dbPut('days', rec);
    delete cardEl.dataset.editing;
    toast('Check-in saved');
    onSaved();
  });
}

/* Keep day.stools consistent with logged visits so exports and old views agree */
async function syncDayStools(date) {
  const [day, visits] = await Promise.all([dbGet('days', date), getStoolsByDate(date)]);
  const count = stoolVisits(visits).length;
  if (day && visits.length && day.stools !== count) {
    day.stools = count;
    await dbPut('days', day);
  }
}

function openStoolSheet(visit, date, onChange, gasOnly) {
  const isNew = !visit;
  const v = visit || { id: crypto.randomUUID(), date, time: date === todayStr() ? nowTime() : '12:00', bristol: null, gasOnly: !!gasOnly, note: '' };
  let bristol = v.bristol;
  let isGas = !!v.gasOnly;
  const sheet = openSheet(`
    <h2>${isNew ? 'Add visit' : 'Edit visit'}</h2>
    <div class="sheet-row"><input type="time" id="sv-time" value="${v.time}"></div>
    <div class="chip-row" style="margin:0 0 10px">
      <button type="button" class="chip toggle ${isGas ? 'on' : ''}" id="sv-gas" aria-pressed="${isGas}">Gas only — no stool</button>
    </div>
    <div class="bristol-row" id="sv-bristol">
      ${[1, 2, 3, 4, 5, 6, 7].map(n => `<button type="button" class="bristol-btn ${bristol === n ? 'on' : ''}" data-b="${n}">${n}</button>`).join('')}
    </div>
    <p class="bristol-desc" id="sv-desc">${bristol ? BRISTOL_DESC[bristol] : 'Tap a type (optional)'}</p>
    <div class="sheet-row"><input type="text" id="sv-note" placeholder="Note (optional)" value="${escapeHtml(v.note || '')}"></div>
    <div class="actions">
      ${isNew ? '' : '<button class="btn danger" id="sv-delete">Delete</button>'}
      <button class="btn primary" id="sv-save">Save</button>
    </div>
  `);
  const bRow = sheet.querySelector('#sv-bristol');
  const desc = sheet.querySelector('#sv-desc');
  const gasChip = sheet.querySelector('#sv-gas');
  function paint() {
    bRow.querySelectorAll('.bristol-btn').forEach(x => x.classList.toggle('on', Number(x.dataset.b) === bristol));
    bRow.classList.toggle('disabled', isGas);
    gasChip.classList.toggle('on', isGas);
    gasChip.setAttribute('aria-pressed', isGas);
    desc.textContent = isGas ? 'Not counted as a stool' : bristol ? BRISTOL_DESC[bristol] : 'Tap a type (optional)';
  }
  paint();
  bRow.querySelectorAll('.bristol-btn').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.b);
    bristol = bristol === n ? null : n;
    isGas = false;
    paint();
  }));
  gasChip.addEventListener('click', () => {
    isGas = !isGas;
    if (isGas) bristol = null;
    paint();
  });
  sheet.querySelector('#sv-save').addEventListener('click', async () => {
    await dbPut('stools', { ...v, time: sheet.querySelector('#sv-time').value || v.time, bristol, gasOnly: isGas, note: sheet.querySelector('#sv-note').value.trim() });
    closeSheet();
    toast(isNew ? 'Visit added' : 'Visit updated');
    onChange();
  });
  const del = sheet.querySelector('#sv-delete');
  if (del) del.addEventListener('click', async () => {
    await dbDelete('stools', v.id);
    closeSheet();
    toast('Visit deleted');
    onChange();
  });
}

function slider(id, label, value, max, words, step, unit, min) {
  const val = Number(value);
  const display = words ? `${val} · ${words[val]}` : `${val}${unit || ''}`;
  return `
    <div class="slider-group">
      <div class="slider-label"><span>${label}</span><span class="val" id="val-ci-${id}">${display}</span></div>
      <input type="range" id="ci-${id}" min="${min || 0}" max="${max}" step="${step || 1}" value="${val}"
        ${words ? `data-words='${JSON.stringify(words)}'` : ''} ${unit ? `data-unit="${unit}"` : ''}>
    </div>`;
}

/* ---------- History tab ---------- */

async function renderHistory() {
  const container = document.getElementById('tab-history');
  const [allDays, allMeals, allStools, allDoses] = await Promise.all([dbGetAll('days'), dbGetAll('meals'), dbGetAll('stools'), dbGetAll('doses')]);
  const stoolsByDate = {};
  for (const s of allStools) (stoolsByDate[s.date] = stoolsByDate[s.date] || []).push(s);
  const dosedDates = new Set(allDoses.map(x => x.date));
  const mealsByDate = {};
  for (const m of allMeals) (mealsByDate[m.date] = mealsByDate[m.date] || []).push(m);
  const dayByDate = {};
  for (const d of allDays) dayByDate[d.date] = d;

  const today = todayStr();
  let earliest = today;
  for (const d of allDays) if (d.date < earliest) earliest = d.date;
  for (const m of allMeals) if (m.date < earliest) earliest = m.date;

  const dates = [];
  let cur = today;
  let guard = 0;
  while (cur >= earliest && guard < 400) { dates.push(cur); cur = addDays(cur, -1); guard++; }

  if (!allDays.length && !allMeals.length) {
    container.innerHTML = `<div class="card"><p class="empty-note">Nothing logged yet. Start on the Today tab — past days will show up here for review and editing.</p></div>`;
    return;
  }

  container.innerHTML = `<div class="card" id="history-list"></div>`;
  const list = container.querySelector('#history-list');

  for (const date of dates) {
    const day = dayByDate[date];
    const meals = (mealsByDate[date] || []).sort((a, b) => a.time.localeCompare(b.time));
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="day-date">${fmtDate(date)}${date === today ? '<span class="weekday">today</span>' : ''}</span>
      <span class="day-dots">${day ? severityDots(day, stoolsByDate[date]) : '<span class="day-meta">no check-in</span>'}</span>
      <span class="day-meta">${dosedDates.has(date) ? '<span class="dose-mark" title="Psyllium taken">P</span>' : ''}${meals.length ? meals.length + ' meal' + (meals.length > 1 ? 's' : '') : ''}</span>
      <svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6l-6 6"/></svg>
    `;
    list.appendChild(row);

    const detail = document.createElement('div');
    detail.className = 'day-detail';
    detail.hidden = expandedDate !== date;
    list.appendChild(detail);
    if (!detail.hidden) fillDayDetail(detail, date, day, meals);

    row.addEventListener('click', () => {
      expandedDate = expandedDate === date ? null : date;
      renderHistory();
    });
  }
}

function severityDots(day, visits) {
  const dot = (v, color) =>
    `<span class="dot" style="background:var(--${color}); opacity:${(0.15 + (v / 5) * 0.85).toFixed(2)}"></span>`;
  const good = isGoodDay(day, visits)
    ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--good)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M5 12l5 5l10 -10"/></svg>` : '';
  return `${good}${dot(day.bloating, 'bloat')}${dot(day.gas, 'gas')}${dot(day.urgency, 'urg')}${day.discomfort != null ? dot(day.discomfort, 'discomfort') : ''}`;
}

async function fillDayDetail(detail, date, day, meals) {
  const [visits, doses] = await Promise.all([getStoolsByDate(date), getDosesByDate(date)]);
  const showDose = trialPhase(date) || doses.length;
  detail.innerHTML = `
    ${showDose ? '<div id="d-dose" class="dose-inline"></div>' : ''}
    <p class="section-label">Meals</p>
    <div class="meal-list" id="d-meals"></div>
    <div class="meal-input-row" style="margin-top:8px">
      <input type="time" id="d-meal-time" value="12:00">
      <input type="text" id="d-meal-text" placeholder="Add a meal to this day" autocomplete="off">
      <button class="btn" id="d-meal-add">Add</button>
    </div>
    <p class="section-label">Check-in</p>
    <div id="d-checkin"></div>
  `;
  const refresh = () => renderHistory();
  if (showDose) renderDoseCard(detail.querySelector('#d-dose'), date, doses, refresh);
  renderMealList(detail.querySelector('#d-meals'), meals, refresh);
  detail.querySelector('#d-meal-add').addEventListener('click', async () => {
    const text = detail.querySelector('#d-meal-text').value.trim();
    if (!text) return;
    await dbPut('meals', { id: crypto.randomUUID(), date, time: detail.querySelector('#d-meal-time').value || '12:00', text, tags: [] });
    toast('Logged: ' + text);
    refresh();
  });
  detail.querySelectorAll('.meal-input-row, #d-checkin, .meal-list').forEach(el =>
    el.addEventListener('click', e => e.stopPropagation()));
  renderCheckinCard(detail.querySelector('#d-checkin'), date, day, visits, refresh);
}

/* ---------- Trends tab ---------- */

let trendsWindow = 7;

async function renderTrendsTab() {
  const container = document.getElementById('tab-trends');
  const [allDays, allStools] = await Promise.all([dbGetAll('days'), dbGetAll('stools')]);
  renderTrends(container, allDays, allStools, trendsWindow, (w) => { trendsWindow = w; renderTrendsTab(); });
}

/* ---------- sheets ---------- */

function openSheet(html) {
  const overlay = document.getElementById('sheet-overlay');
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = html;
  overlay.hidden = false;
  overlay.onclick = (e) => { if (e.target === overlay) closeSheet(); };
  return sheet;
}

function closeSheet() {
  document.getElementById('sheet-overlay').hidden = true;
}

function openMealSheet(meal, onChange) {
  const sheet = openSheet(`
    <h2>Edit meal</h2>
    <div class="sheet-row"><input type="text" id="em-text" value="${escapeHtml(meal.text)}"></div>
    <div class="sheet-row"><input type="time" id="em-time" value="${meal.time}"></div>
    <div class="actions">
      <button class="btn danger" id="em-delete">Delete</button>
      <button class="btn primary" id="em-save">Save</button>
    </div>
  `);
  sheet.querySelector('#em-save').addEventListener('click', async () => {
    const text = sheet.querySelector('#em-text').value.trim();
    if (!text) return;
    await dbPut('meals', { ...meal, text, time: sheet.querySelector('#em-time').value || meal.time, tags: meal.tags || [] });
    closeSheet();
    toast('Meal updated');
    onChange();
  });
  sheet.querySelector('#em-delete').addEventListener('click', async () => {
    await dbDelete('meals', meal.id);
    closeSheet();
    toast('Meal deleted');
    onChange();
  });
}

const BRISTOL_CAT = { 1: 'constipation', 2: 'constipation', 3: 'healthy', 4: 'ideal', 5: 'borderline loose', 6: 'diarrhoea', 7: 'diarrhoea' };

function bristolShape(n) {
  const F = 'fill="#B08968"';
  const S = 'stroke="#7d5a38" stroke-width="1.6" fill="none" stroke-linecap="round"';
  const shapes = {
    1: `<circle cx="12" cy="16" r="5.5" ${F}/><circle cx="28" cy="13" r="6" ${F}/><circle cx="45" cy="17" r="5.5" ${F}/><circle cx="62" cy="14" r="6" ${F}/>`,
    2: `<rect x="6" y="9" width="68" height="13" rx="6.5" ${F}/><circle cx="18" cy="11" r="6" ${F}/><circle cx="34" cy="20" r="6" ${F}/><circle cx="50" cy="10" r="6" ${F}/><circle cx="64" cy="19" r="5" ${F}/>`,
    3: `<rect x="6" y="9" width="68" height="13" rx="6.5" ${F}/><path d="M20 9v4 M33 22v-4 M46 9v4 M59 22v-4" ${S}/>`,
    4: `<rect x="6" y="8" width="68" height="14" rx="7" ${F}/>`,
    5: `<ellipse cx="16" cy="15" rx="10" ry="7" ${F}/><ellipse cx="41" cy="17" rx="11" ry="7.5" ${F}/><ellipse cx="65" cy="13" rx="9" ry="6.5" ${F}/>`,
    6: `<ellipse cx="13" cy="14" rx="7" ry="5" ${F}/><ellipse cx="26" cy="19" rx="8" ry="5.5" ${F}/><ellipse cx="38" cy="12" rx="7" ry="4.5" ${F}/><ellipse cx="52" cy="18" rx="8" ry="5" ${F}/><ellipse cx="66" cy="13" rx="6" ry="4.5" ${F}/><circle cx="20" cy="9" r="3" ${F}/><circle cx="46" cy="23" r="3" ${F}/><circle cx="61" cy="22" r="2.5" ${F}/>`,
    7: `<path d="M6 12 q6 -5 12 0 t12 0 t12 0 t12 0 t12 0" stroke="#B08968" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M12 21 q6 -5 12 0 t12 0 t12 0 t12 0" stroke="#B08968" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  };
  return `<svg viewBox="0 0 80 30" width="80" height="30" aria-hidden="true">${shapes[n]}</svg>`;
}

function openBristolSheet(current, onPick) {
  const sheet = openSheet(`
    <h2>Bristol stool scale</h2>
    ${[1, 2, 3, 4, 5, 6, 7].map(n => `
      <div class="bristol-ref-row ${current === n ? 'on' : ''}" data-b="${n}">
        ${bristolShape(n)}
        <div>
          <div class="b-name">Type ${n} <span class="b-cat">${BRISTOL_CAT[n]}</span></div>
          <div class="b-desc">${BRISTOL_DESC[n].split(' — ')[1]}</div>
        </div>
      </div>`).join('')}
    <p class="settings-note">Tap a type to use it for this check-in.</p>
  `);
  sheet.querySelectorAll('.bristol-ref-row').forEach(r => r.addEventListener('click', () => {
    onPick(Number(r.dataset.b));
    closeSheet();
  }));
}

function openSettingsSheet() {
  const sheet = openSheet(`
    <h2>Settings</h2>
    <button class="settings-item" id="s-export">Export backup <span>↓</span></button>
    <button class="settings-item" id="s-import">Import backup <span>↑</span></button>
    <button class="settings-item" id="s-clear" style="color:#E24B4A">Clear all data</button>
    <input type="file" id="s-file" accept=".json,application/json" hidden>
    <p class="settings-note">All data stays on this device — nothing is uploaded anywhere. Export a backup every week or two and keep it somewhere safe (Files, iCloud Drive). Importing a backup merges it with what's already here.</p>
    <p class="settings-note">Daily Log is a personal diary, not medical advice. Share exports with your doctor rather than self-diagnosing from patterns.</p>
    <p class="settings-note" style="text-align:center">Daily Log ${APP_VERSION}</p>
  `);
  sheet.querySelector('#s-export').addEventListener('click', async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily-log-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup exported');
  });
  const fileInput = sheet.querySelector('#s-file');
  sheet.querySelector('#s-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await importData(data);
      closeSheet();
      toast(`Imported ${res.meals} meals, ${res.days} days`);
      render();
    } catch (err) {
      toast(err.message || 'Import failed');
    }
  });
  sheet.querySelector('#s-clear').addEventListener('click', async () => {
    if (!confirm('Delete ALL meals and check-ins? Export a backup first if you might want this data back.')) return;
    await dbClearAll();
    closeSheet();
    toast('All data cleared');
    render();
  });
}

/* ---------- boot ---------- */

document.querySelectorAll('.tab-btn').forEach(b =>
  b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.getElementById('settings-btn').addEventListener('click', openSettingsSheet);

let renderedFor = todayStr();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && todayStr() !== renderedFor) {
    renderedFor = todayStr();
    render();
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}

render();
