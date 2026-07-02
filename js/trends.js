/* Trends dashboard — hand-drawn SVG charts, no dependencies.
   renderTrends(container, allDays, windowDays, onWindowChange) is called from app.js */

const CHART_W = 320;
const CHART_H = 74;
const LABEL_H = 16;

function trendDates(windowDays) {
  const dates = [];
  let cur = todayStr();
  for (let i = 0; i < windowDays; i++) { dates.push(cur); cur = addDays(cur, -1); }
  return dates.reverse();
}

function xLabels(dates) {
  const n = dates.length;
  return dates.map((d, i) => {
    if (n <= 7) return dateFromStr(d).toLocaleDateString('en-GB', { weekday: 'narrow' });
    const every = n <= 31 ? 7 : 28;
    if (i % every === 0 || i === n - 1) {
      const dt = dateFromStr(d);
      return `${dt.getDate()} ${dt.toLocaleDateString('en-GB', { month: 'short' })}`;
    }
    return '';
  });
}

function avg(nums) {
  const vals = nums.filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function fmtAvg(v, unit) {
  return v == null ? '–' : v.toFixed(1) + (unit || '');
}

function barChart(values, max, color, labels) {
  const n = values.length;
  const gap = n <= 7 ? 6 : n <= 31 ? 2 : 1;
  const bw = (CHART_W - gap * (n - 1)) / n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const x = i * (bw + gap);
    if (values[i] == null) {
      parts.push(`<rect x="${x.toFixed(1)}" y="${CHART_H - 2}" width="${bw.toFixed(1)}" height="2" rx="1" fill="currentColor" opacity="0.12"/>`);
    } else {
      const h = Math.max(2, (values[i] / max) * (CHART_H - 4));
      parts.push(`<rect x="${x.toFixed(1)}" y="${(CHART_H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2.5, bw / 3).toFixed(1)}" fill="${color}"/>`);
    }
    if (labels && labels[i]) {
      parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${CHART_H + 12}" font-size="9" fill="currentColor" opacity="0.5" text-anchor="${n <= 7 ? 'middle' : (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle')}">${labels[i]}</text>`);
    }
  }
  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H + LABEL_H}" role="img">${parts.join('')}</svg>`;
}

function lineChart(values, max, color, labels) {
  const n = values.length;
  const step = n > 1 ? CHART_W / (n - 1) : 0;
  const pts = values.map((v, i) => v == null ? null : [i * step, CHART_H - 3 - (v / max) * (CHART_H - 8)]);
  const parts = [];
  let seg = [];
  const flush = () => {
    if (seg.length > 1) parts.push(`<polyline points="${seg.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    else if (seg.length === 1) parts.push(`<circle cx="${seg[0][0].toFixed(1)}" cy="${seg[0][1].toFixed(1)}" r="2.5" fill="${color}"/>`);
    seg = [];
  };
  for (const p of pts) { p ? seg.push(p) : flush(); }
  flush();
  if (n <= 7) {
    for (const p of pts) if (p) parts.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${color}"/>`);
  }
  if (labels) {
    const bw = step || CHART_W;
    labels.forEach((l, i) => {
      if (l) parts.push(`<text x="${(i * step).toFixed(1)}" y="${CHART_H + 12}" font-size="9" fill="currentColor" opacity="0.5" text-anchor="${n <= 7 ? 'middle' : (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle')}">${l}</text>`);
    });
  }
  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H + LABEL_H}" role="img">${parts.join('')}</svg>`;
}

function bristolChart(days) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) if (d && d.bristol >= 1 && d.bristol <= 7) counts[d.bristol - 1]++;
  const max = Math.max(1, ...counts);
  const gap = 8;
  const bw = (CHART_W - gap * 6) / 7;
  const parts = [];
  counts.forEach((c, i) => {
    const x = i * (bw + gap);
    const h = Math.max(2, (c / max) * (CHART_H - 16));
    parts.push(`<rect x="${x.toFixed(1)}" y="${(CHART_H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--gas)" opacity="${c ? 1 : 0.15}"/>`);
    if (c) parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(CHART_H - h - 4).toFixed(1)}" font-size="10" fill="currentColor" opacity="0.6" text-anchor="middle">${c}</text>`);
    parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${CHART_H + 12}" font-size="10" fill="currentColor" opacity="0.5" text-anchor="middle">${i + 1}</text>`);
  });
  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H + LABEL_H}" role="img">${parts.join('')}</svg>`;
}

function chartCard(title, avgText, svg) {
  return `
    <div class="card chart-card">
      <div class="chart-head"><h2 style="margin:0">${title}</h2><span class="avg">${avgText}</span></div>
      ${svg}
    </div>`;
}

function renderTrends(container, allDays, windowDays, onWindowChange) {
  const dates = trendDates(windowDays);
  const byDate = {};
  for (const d of allDays) byDate[d.date] = d;
  const windowRecords = dates.map(dt => byDate[dt] || null);
  const withData = windowRecords.filter(Boolean);
  const labels = xLabels(dates);

  const segRow = `
    <div class="seg-row">
      ${[7, 30, 90].map(w => `<button class="seg ${w === windowDays ? 'on' : ''}" data-w="${w}">${w}d</button>`).join('')}
    </div>`;

  if (!withData.length) {
    container.innerHTML = segRow + `<div class="card"><p class="empty-note">No check-ins in this window yet. Charts appear after your first daily check-in on the Today tab.</p></div>`;
    wireSegs(container, onWindowChange);
    return;
  }

  const goodDays = withData.filter(isGoodDay).length;
  const series = key => windowRecords.map(d => d ? d[key] : null);

  container.innerHTML = segRow + `
    <div class="metric-grid">
      <div class="metric"><div class="m-label">Good days</div><div class="m-val">${goodDays}<small> / ${withData.length} logged</small></div></div>
      <div class="metric"><div class="m-label">Avg wellbeing</div><div class="m-val">${fmtAvg(avg(series('wellbeing')))}<small> / 10</small></div></div>
      <div class="metric"><div class="m-label">Avg stress</div><div class="m-val">${fmtAvg(avg(series('stress')))}<small> / 10</small></div></div>
      <div class="metric"><div class="m-label">Avg sleep</div><div class="m-val">${fmtAvg(avg(series('sleep')), 'h')}</div></div>
      <div class="metric"><div class="m-label">Avg exercise</div><div class="m-val">${fmtAvg(avg(series('exercise')), 'm')}</div></div>
      <div class="metric"><div class="m-label">Avg stools / day</div><div class="m-val">${fmtAvg(avg(series('stools')))}</div></div>
    </div>
    ${chartCard('Overall wellbeing', 'daily rating / 10', lineChart(series('wellbeing'), 10, 'var(--well)', labels))}
    ${chartCard('Bloating', 'avg ' + fmtAvg(avg(series('bloating'))) + ' / 5', barChart(series('bloating'), 5, 'var(--bloat)', labels))}
    ${chartCard('Gas', 'avg ' + fmtAvg(avg(series('gas'))) + ' / 5', barChart(series('gas'), 5, 'var(--gas)', labels))}
    ${chartCard('Urgency', 'avg ' + fmtAvg(avg(series('urgency'))) + ' / 5', barChart(series('urgency'), 5, 'var(--urg)', labels))}
    ${chartCard('Stools per day', '', barChart(series('stools'), Math.max(4, ...series('stools').filter(v => v != null)), 'var(--muted)', labels))}
    ${chartCard('Bristol distribution', withData.filter(d => d.bristol).length + ' days rated', bristolChart(withData))}
    ${chartCard('Sleep', 'hours per night', lineChart(series('sleep'), 12, 'var(--sleep)', labels))}
    ${chartCard('Stress', 'daily rating / 10', lineChart(series('stress'), 10, 'var(--stress)', labels))}
    ${chartCard('Exercise', 'minutes per day', barChart(series('exercise'), Math.max(60, ...series('exercise').filter(v => v != null)), 'var(--exercise)', labels))}
  `;
  wireSegs(container, onWindowChange);
}

function wireSegs(container, onWindowChange) {
  container.querySelectorAll('.seg').forEach(s =>
    s.addEventListener('click', () => onWindowChange(Number(s.dataset.w))));
}
