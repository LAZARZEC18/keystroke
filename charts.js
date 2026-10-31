// Keystroke charts: crisp SVG line charts with tooltips, and a QWERTY keyboard heatmap. No dependencies.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function niceMax(v) {
    if (v <= 0) return 10;
    const steps = [10, 20, 25, 40, 50, 60, 80, 100, 120, 150, 160, 200, 250, 300];
    for (const s of steps) if (v <= s) return s;
    return Math.ceil(v / 100) * 100;
  }

  // Monotone cubic path (Fritsch-Carlson), so the line never overshoots the data.
  function smoothPath(pts) {
    const n = pts.length;
    if (!n) return '';
    if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
    if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
    const dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
  }

  function tipEl(box) {
    let tip = box.querySelector('.ks-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'ks-tip'; tip.setAttribute('role', 'status'); box.appendChild(tip); }
    return tip;
  }

  function placeTip(box, tip, x, y) {
    const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14; if (left + tw > bw) left = x - tw - 14; if (left < 0) left = Math.max(0, Math.min(bw - tw, x - tw / 2));
    let top = Math.max(-8, y - th - 12);
    tip.style.transform = `translate(${left}px,${top}px)`;
  }

  /* Generic line chart.
     series: [{values:[...], cls, smooth, dash, width, area}], labels: x labels per index,
     markers: [{i, y, cls}] drawn above, tooltip(i) -> html. */
  function lineChart(box, spec) {
    box._spec = spec;
    const W = Math.max(240, box.clientWidth), H = Math.max(120, box.clientHeight);
    const pad = { l: 36, r: 12, t: spec.markerRow ? 22 : spec.yTitle ? 26 : 12, b: 26 };
    const n = spec.labels.length;
    const all = spec.series.flatMap(s => s.values).filter(v => isFinite(v));
    const ymax = niceMax(Math.max(10, ...all) * 1.08);
    const ymin = spec.ymin || 0;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = i => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = v => pad.t + ih - ((Math.max(ymin, v) - ymin) / (ymax - ymin)) * ih;
    let g = '';
    // grid and y labels
    const range = ymax - ymin;
    const ticks = [4, 5, 3, 6].find(t => Number.isInteger(range / t) && (range / t) % 5 === 0) || 4;
    for (let k = 0; k <= ticks; k++) {
      const v = ymin + ((ymax - ymin) / ticks) * k, y = Y(v).toFixed(1);
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" style="stroke:var(--line)" stroke-width="1"${k ? ' stroke-dasharray="2 4"' : ''}/>`;
      g += `<text x="${pad.l - 8}" y="${+y + 4}" text-anchor="end">${Math.round(v)}</text>`;
    }
    // x labels: about one every 70px
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
    for (let i = 0; i < n; i++) {
      if (i % every && i !== n - 1) continue;
      if (i !== n - 1 && n - 1 - i < every * 0.6) continue;
      g += `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(spec.labels[i])}</text>`;
    }
    if (spec.yTitle) g += `<text x="${pad.l - 8}" y="${Math.max(8, pad.t - 10)}" text-anchor="end" class="ytitle">${esc(spec.yTitle)}</text>`;
    // series
    const gid = 'ksg' + Math.random().toString(36).slice(2, 7);
    let defs = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>`;
    spec.series.forEach(s => {
      const pts = s.values.map((v, i) => [X(i), Y(v)]);
      const d = s.smooth === false ? 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') : smoothPath(pts);
      if (s.area && pts.length > 1) g += `<path d="${d}L${pts[pts.length - 1][0].toFixed(1)},${pad.t + ih}L${pts[0][0].toFixed(1)},${pad.t + ih}Z" fill="url(#${gid})"/>`;
      g += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="${s.width || 2.5}" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}${s.opacity ? ` opacity="${s.opacity}"` : ''}/>`;
      if (s.dots) pts.forEach(p => { g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n > 60 ? 2 : 3}" style="fill:${s.color}"/>`; });
    });
    (spec.markers || []).forEach(m => {
      const y = m.top ? pad.t - 12 : Y(m.v);
      if (m.kind === 'err') g += `<g class="mk-err" transform="translate(${X(m.i).toFixed(1)},${y.toFixed(1)})"><circle r="${m.r || 4.5}" style="fill:var(--bad)"/></g>`;
      else g += `<circle cx="${X(m.i).toFixed(1)}" cy="${y.toFixed(1)}" r="${iw < 500 ? 4 : 5.5}" style="fill:var(--surface);stroke:var(--accent)" stroke-width="${iw < 500 ? 2.5 : 3}"/>`;
    });
    // hover layer
    g += `<line class="hover-line" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" style="stroke:var(--ink-2)" stroke-width="1" opacity="0"/>`;
    g += `<g class="hover-dots"></g>`;
    g += `<rect class="hit" x="${pad.l}" y="0" width="${iw}" height="${H}" fill="transparent"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(spec.aria || 'Chart')}">${defs}${g}</svg>`;
    const svg = box.firstChild, tip = tipEl(box);
    const line = svg.querySelector('.hover-line'), dots = svg.querySelector('.hover-dots');
    let cur = -1;
    function show(i) {
      if (i < 0 || i >= n) return hide();
      cur = i;
      const x = X(i);
      line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('opacity', '.35');
      dots.innerHTML = spec.series.filter(s => !s.noHover).map(s => isFinite(s.values[i]) ? `<circle cx="${x}" cy="${Y(s.values[i])}" r="4.5" style="fill:var(--surface);stroke:${s.color}" stroke-width="2.5"/>` : '').join('');
      tip.innerHTML = spec.tooltip(i);
      tip.classList.add('on');
      const ys = spec.series.map(s => Y(s.values[i] || 0));
      placeTip(box, tip, x, Math.min(...ys));
    }
    function hide() { cur = -1; line.setAttribute('opacity', '0'); dots.innerHTML = ''; tip.classList.remove('on'); }
    function idxAt(evt) {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      return n <= 1 ? 0 : Math.round(((px - pad.l) / iw) * (n - 1));
    }
    svg.addEventListener('pointermove', e => show(Math.max(0, Math.min(n - 1, idxAt(e)))));
    svg.addEventListener('pointerdown', e => show(Math.max(0, Math.min(n - 1, idxAt(e)))));
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, Math.min(n - 1, (cur < 0 ? (e.key === 'ArrowRight' ? -1 : n) : cur) + (e.key === 'ArrowRight' ? 1 : -1)))); }
      if (e.key === 'Escape') hide();
    });
    if (!box._ro && 'ResizeObserver' in window) {
      let lastW = box.clientWidth;
      box._ro = new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) > 2 && box._spec) { lastW = box.clientWidth; lineChart(box, box._spec); } });
      box._ro.observe(box);
    }
    return { show, hide };
  }

  // WPM and raw WPM for each second of a test, with error markers.
  function speed(box, seconds) {
    const wpm = seconds.map(s => s.wpm), raw = seconds.map(s => s.raw);
    const maxErr = Math.max(1, ...seconds.map(s => s.errors));
    return lineChart(box, {
      aria: `Speed per second. Final ${Math.round(wpm[wpm.length - 1] || 0)} words per minute over ${seconds.length} seconds.`,
      labels: seconds.map(s => s.second + 's'),
      markerRow: true, yTitle: 'wpm',
      series: [
        { values: raw, color: 'var(--raw)', width: 2, dash: '4 5' },
        { values: wpm, color: 'var(--wpm)', width: 3, area: true }
      ],
      markers: seconds.map((s, i) => s.errors ? { i, kind: 'err', top: true, r: 3 + 2.5 * (s.errors / maxErr) } : null).filter(Boolean),
      tooltip: i => {
        const s = seconds[i];
        return `<span class="mut">Second ${s.second}</span><br><b>${Math.round(s.wpm)}</b> wpm &nbsp;<span class="mut">raw</span> <b>${Math.round(s.raw)}</b>` +
          (s.errors ? `<br><span class="bad">${s.errors} error${s.errors > 1 ? 's' : ''}</span>` : '');
      }
    });
  }

  // WPM for each saved test, oldest first, with a rolling average and personal-best markers.
  function progress(box, runs, fmtDate, fmtTest) {
    const wpm = runs.map(r => r.wpm);
    const avg = wpm.map((_, i) => { const a = wpm.slice(Math.max(0, i - 9), i + 1); return a.reduce((x, y) => x + y, 0) / a.length; });
    return lineChart(box, {
      aria: `WPM for your last ${runs.length} tests.`,
      labels: runs.map((r, i) => '#' + (i + 1)),
      yTitle: 'wpm',
      ymin: Math.max(0, Math.floor((Math.min(...wpm) - 12) / 20) * 20),
      series: [
        { values: avg, color: 'var(--ink-2)', width: 2, opacity: .5, noHover: true },
        { values: wpm, color: 'var(--wpm)', width: 2.5, dots: true, smooth: false }
      ],
      markers: runs.map((r, i) => r.pb ? { i, v: r.wpm, kind: 'pb' } : null).filter(Boolean),
      tooltip: i => {
        const r = runs[i];
        return `<span class="mut">${esc(fmtDate(r.ts))} · ${esc(fmtTest(r))}</span><br><b>${Math.round(r.wpm)}</b> wpm &nbsp;<b>${Math.round(r.acc)}%</b> <span class="mut">accuracy</span>` +
          (r.pb ? `<br><b style="color:var(--accent-ink)">Personal best</b>` : '') + `<br><span class="mut">Average of last 10:</span> <b>${Math.round(avg[i])}</b>`;
      }
    });
  }

  /* ---------- Keyboard heatmap ---------- */
  const ROWS = [
    [['`'], ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0'], ['-'], ['='], ['delete', 2, 'mod']],
    [['tab', 1.5, 'mod'], ['q'], ['w'], ['e'], ['r'], ['t'], ['y'], ['u'], ['i'], ['o'], ['p'], ['['], [']'], ['\\', 1.5]],
    [['caps', 1.75, 'mod'], ['a'], ['s'], ['d'], ['f'], ['g'], ['h'], ['j'], ['k'], ['l'], [';'], ["'"], ['return', 2.25, 'mod']],
    [['shift', 2.25, 'mod'], ['z'], ['x'], ['c'], ['v'], ['b'], ['n'], ['m'], [','], ['.'], ['/'], ['shift', 2.75, 'mod']],
    [['', 1.25, 'mod'], ['', 1.25, 'mod'], ['', 1.5, 'mod'], [' ', 7, 'space'], ['', 1.5, 'mod'], ['', 1.25, 'mod'], ['', 1.25, 'mod']]
  ];
  const COMPACT = [
    [['q'], ['w'], ['e'], ['r'], ['t'], ['y'], ['u'], ['i'], ['o'], ['p']],
    [['', .5, 'pad'], ['a'], ['s'], ['d'], ['f'], ['g'], ['h'], ['j'], ['k'], ['l']],
    [['', .9, 'pad'], ['z'], ['x'], ['c'], ['v'], ['b'], ['n'], ['m'], [','], ['.']],
    [['', 2.5, 'pad'], [' ', 5, 'space']]
  ];
  const keyName = k => k === ' ' ? 'Space' : k.length === 1 && /[a-z]/.test(k) ? k.toUpperCase() : k;

  // A perfect key is a calm green tint. Any miss turns the key red, deeper as accuracy falls to 80% or below.
  function fillFor(acc) {
    if (acc >= 100) return 'color-mix(in oklab, var(--good) 20%, var(--surface))';
    const t = Math.max(0, Math.min(1, (100 - acc) / 20));
    return `color-mix(in oklab, var(--bad) ${Math.round(22 + t * 58)}%, var(--surface))`;
  }

  function keyboard(host, keys, weak) {
    keys = keys || {};
    host._kb = [keys, weak];
    const compact = host.clientWidth > 0 && host.clientWidth < 560;
    const LAYOUT = compact ? COMPACT : ROWS;
    host.classList.toggle('kb-compact', compact);
    if (!host._ro && 'ResizeObserver' in window) {
      host._ro = new ResizeObserver(() => { const c = host.clientWidth > 0 && host.clientWidth < 560; if (c !== host.classList.contains('kb-compact') && host._kb) keyboard(host, host._kb[0], host._kb[1]); });
      host._ro.observe(host);
    }
    const weakSet = new Set((weak || []).map(w => w.key));
    const U = 44, G = compact ? 6 : 5, R = 8, totalU = compact ? 10 : 15;
    const W = totalU * U + (totalU - 1) * G, H = LAYOUT.length * U + (LAYOUT.length - 1) * G;
    let g = '';
    LAYOUT.forEach((row, ri) => {
      // spread each row exactly across the full width
      const units = row.reduce((a, k) => a + (k[1] || 1), 0);
      const gaps = row.length - 1;
      const unitW = compact ? U : (W - gaps * G) / units;
      let x = 0; const y = ri * (U + G);
      row.forEach(k => {
        const [label, w = 1, kind] = k;
        const kw = w * unitW;
        if (kind === 'pad') { x += kw; return; }
        const isKey = kind !== 'mod';
        const rec = isKey ? keys[label] : null;
        const total = rec ? rec.hit + rec.miss : 0;
        const acc = total ? (rec.hit / total) * 100 : null;
        const cls = ['kb-key', kind === 'mod' ? 'mod' : '', !total ? 'nodata' : 'has', weakSet.has(label) ? 'weak' : ''].join(' ');
        const fill = total ? `fill:${fillFor(acc)}` : '';
        const stroke = weakSet.has(label) ? ';stroke:var(--bad);stroke-width:1.5' : '';
        const text = kind === 'space' ? 'space' : label;
        const tx = kind === 'mod' ? x + 10 : x + kw / 2, anchor = kind === 'mod' ? 'start' : 'middle';
        const aria = total ? `${keyName(label)}: ${rec.hit} of ${total} right, ${Math.round(acc)}%` : '';
        g += `<g class="${cls}"${total ? ` tabindex="0" role="img" aria-label="${esc(aria)}" data-key="${esc(label)}" data-hit="${rec.hit}" data-miss="${rec.miss}"` : ''}>` +
          `<rect x="${x.toFixed(1)}" y="${y}" width="${kw.toFixed(1)}" height="${U}" rx="${R}" style="${fill}${stroke}"/>` +
          (text ? `<text x="${tx.toFixed(1)}" y="${y + (kind === 'mod' ? U - 10 : U / 2 + 5)}" text-anchor="${anchor}">${esc(text)}</text>` : '') + '</g>';
        x += kw + G;
      });
    });
    host.innerHTML = `<svg viewBox="-1 -1 ${W + 2} ${H + 2}" role="group" aria-label="Keyboard heatmap of key accuracy">${g}</svg>`;
    const tip = tipEl(host);
    const svg = host.firstChild;
    function show(gEl) {
      const k = gEl.dataset.key, hit = +gEl.dataset.hit, miss = +gEl.dataset.miss, tot = hit + miss;
      tip.innerHTML = `<b>${esc(keyName(k))}</b> &nbsp;${Math.round((hit / tot) * 100)}%<br><span class="mut">${hit} of ${tot} right</span>` + (miss ? `<br><span class="bad">${miss} missed</span>` : '');
      tip.classList.add('on');
      const r = gEl.getBoundingClientRect(), hr = host.getBoundingClientRect();
      placeTip(host, tip, r.left - hr.left + r.width / 2, r.top - hr.top);
    }
    svg.addEventListener('pointerover', e => { const k = e.target.closest('.kb-key.has'); if (k) show(k); });
    svg.addEventListener('pointerleave', () => tip.classList.remove('on'));
    svg.addEventListener('focusin', e => { const k = e.target.closest('.kb-key.has'); if (k) show(k); });
    svg.addEventListener('focusout', () => tip.classList.remove('on'));
  }

  window.KSCharts = { speed, progress, keyboard, lineChart, smoothPath, niceMax };
})();
