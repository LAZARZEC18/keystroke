// Keystroke app: wires the engine (engine.js), words (words.js) and charts (charts.js) to the page.
(function () {
  'use strict';
  const E = window.KeystrokeEngine, W = window.KS_WORDS, C = window.KSCharts, store = ZL.store, esc = ZL.esc;
  const $ = s => document.querySelector(s);
  const now = () => performance.now();
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const LENGTHS = { time: [15, 30, 60, 120], words: [10, 25, 50, 100], sentences: [1, 3, 5] };
  const LEN_LABEL = { time: 'Seconds', words: 'Words', sentences: 'Sentences' };
  const DRILL_SIZE = 25;
  const HISTORY_CAP = 500;

  const defaults = { mode: 'time', time: 30, words: 25, sentences: 3, punct: false, nums: false, diff: 'common' };
  let settings = Object.assign({}, defaults, store.get('settings', {}));
  let history = store.get('history', []); // oldest first
  let pbs = store.get('pbs', {});
  let last = store.get('last', null);

  // Current test
  let test = null, cfg = null, decorate = null, rand = null, ticker = null, state = 'ready';
  let wordEls = [], scrollLine = 0, showAll = false, view = 'test', shownResult = null;

  const el = {
    app: $('#ks-app'), status: $('#ks-status'), typing: $('#ks-typing'), results: $('#ks-results'),
    words: $('#ks-words'), wrap: $('#ks-words-wrap'), caret: $('#ks-caret'), input: $('#ks-input'),
    liveMain: $('#ks-live-main'), liveWpm: $('#ks-live-wpm'), liveAcc: $('#ks-live-acc'), drillTag: $('#ks-drill-tag'),
    restart: $('#ks-restart'), srWords: $('#ks-sr-words')
  };

  /* ---------- helpers ---------- */
  const r0 = v => Math.round(v);
  function fmtSecs(ms) { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; }
  function fmtDuration(ms) {
    const m = Math.round(ms / 60000);
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  function fmtDate(ts) {
    const d = new Date(ts), t = new Date();
    const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    const day = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    if (ts >= day) return 'Today ' + time;
    if (ts >= day - 864e5) return 'Yesterday ' + time;
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
  function fmtTest(r) {
    if (r.mode === 'drill') return 'Drill · ' + (r.drill || []).join(' ');
    if (r.mode === 'time') return 'Time · ' + r.length + ' s';
    if (r.mode === 'words') return 'Words · ' + r.length;
    if (r.mode === 'custom') return 'Repeat · ' + r.length + ' words';
    return 'Sentences · ' + r.length;
  }
  const pbKey = r => r.mode + '-' + r.length;
  function seed() { return (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0; }
  function saveAll() { store.set('history', history); store.set('pbs', pbs); store.set('last', last); }

  function setStatus(text) { el.status.textContent = text; }
  function setState(s) {
    state = s; el.app.dataset.state = s;
    document.body.classList.toggle('ks-focus', s === 'running');
  }
  function describe(c) {
    if (c.drill) return 'Weak-key drill · ' + c.drill.join(' ');
    if (c.mode === 'custom') return 'Repeating the last text';
    const base = c.mode === 'time' ? c.length + ' seconds' : c.mode === 'words' ? c.length + ' words' : c.length + (c.length === 1 ? ' sentence' : ' sentences');
    if (c.mode === 'sentences') return base;
    const extras = [c.diff === 'all' ? 'all words' : 'common words'];
    if (c.punct) extras.push('punctuation');
    if (c.nums) extras.push('numbers');
    return base + ', ' + extras.join(', ');
  }

  /* ---------- config UI ---------- */
  function renderConfig() {
    document.querySelectorAll('#ks-mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode)));
    $('#lbl-length').textContent = LEN_LABEL[settings.mode];
    $('#ks-length').innerHTML = LENGTHS[settings.mode].map(n =>
      `<button type="button" data-len="${n}" aria-pressed="${n === settings[settings.mode]}">${n}</button>`).join('');
    const sent = settings.mode === 'sentences';
    $('#ks-punct').setAttribute('aria-pressed', String(!sent && settings.punct));
    $('#ks-nums').setAttribute('aria-pressed', String(!sent && settings.nums));
    ['#ks-punct', '#ks-nums'].forEach(s => { $(s).disabled = sent; });
    document.querySelectorAll('#ks-diff button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.diff === settings.diff)); b.disabled = sent; });
    $('#ks-config-hint').hidden = !sent;
  }
  function changeSetting(patch) {
    Object.assign(settings, patch);
    store.set('settings', settings);
    renderConfig();
    newTest();
  }

  /* ---------- building a test ---------- */
  function pool() { return settings.diff === 'all' ? W.all : W.common; }
  function moreWords(n) {
    const list = E.pickWords(pool(), n, rand, test ? test.words[test.words.length - 1] : null);
    return list.map(w => decorate(w, false));
  }

  function newTest(opts) {
    opts = opts || {};
    clearInterval(ticker); ticker = null;
    rand = E.rng(opts.seed != null ? opts.seed : seed());
    cfg = { mode: settings.mode, length: settings[settings.mode], punct: settings.punct, nums: settings.nums, diff: settings.diff, drill: null };
    let words;
    if (opts.words) {
      words = opts.words.slice();
      cfg = Object.assign(cfg, opts.cfg || { mode: 'custom', length: words.length, punct: false, nums: false });
    } else if (opts.drill) {
      cfg = Object.assign(cfg, { mode: 'drill', length: DRILL_SIZE, punct: false, nums: false, diff: 'all', drill: opts.drill });
      words = E.drillWords(W.all, opts.drill, DRILL_SIZE, rand);
    } else if (cfg.mode === 'sentences') {
      cfg.punct = cfg.nums = false;
      const picks = [], used = new Set();
      while (picks.length < cfg.length) { const i = Math.floor(rand() * W.sentences.length); if (!used.has(i)) { used.add(i); picks.push(W.sentences[i]); } }
      words = picks.join(' ').split(' ');
    } else {
      decorate = E.makeDecorator({ punctuation: cfg.punct, numbers: cfg.nums }, rand);
      const n = cfg.mode === 'words' ? cfg.length : 80;
      words = E.pickWords(pool(), n, rand).map((w, i) => decorate(w, cfg.mode === 'words' && i === n - 1));
    }
    if (!decorate || opts.words || opts.drill || cfg.mode === 'sentences') decorate = E.makeDecorator({ punctuation: cfg.punct, numbers: cfg.nums }, rand);
    test = E.createTest(words, { fixedLength: cfg.mode !== 'time' });
    if (opts.cfg && opts.cfg.mode === 'time') test.fixedLength = false;
    setState('ready');
    showTyping();
    renderWords();
    el.input.value = '';
    el.drillTag.hidden = !cfg.drill;
    if (cfg.drill) el.drillTag.textContent = 'Drill · ' + cfg.drill.join(' ');
    updateLive();
    setStatus('Ready · ' + describe(cfg));
    if (opts.focus !== false) focusInput();
    return test;
  }

  function focusInput() { el.input.focus({ preventScroll: true }); syncFocus(); }
  function syncFocus() { el.typing.classList.toggle('unfocused', document.activeElement !== el.input); }

  /* ---------- rendering words ---------- */
  function lettersHTML(i) {
    const target = test.words[i], typed = test.typed[i] || '', committed = i < test.index;
    let h = '';
    for (let k = 0; k < target.length; k++) {
      let cls = '';
      if (k < typed.length) cls = typed[k] === target[k] ? ' ok' : ' bad';
      else if (committed) cls = ' miss';
      h += `<span class="l${cls}">${esc(target[k])}</span>`;
    }
    for (let k = target.length; k < typed.length; k++) h += `<span class="l extra">${esc(typed[k])}</span>`;
    return h;
  }
  function paintWord(i) {
    const w = wordEls[i]; if (!w) return;
    w.innerHTML = lettersHTML(i);
    w.classList.toggle('err', i < test.index && test.typed[i] !== test.words[i]);
  }
  function renderWords() {
    el.words.innerHTML = test.words.map((_, i) => `<span class="w">${lettersHTML(i)}</span>`).join('');
    wordEls = Array.from(el.words.children);
    scrollLine = 0;
    el.words.style.transition = 'none';
    el.words.style.transform = 'translateY(0)';
    void el.words.offsetHeight;
    el.words.style.transition = '';
    el.srWords.textContent = 'Text to type: ' + test.words.slice(0, 60).join(' ');
    placeCaret(true);
  }
  function appendWords(list) {
    const start = test.words.length;
    test.words.push(...list);
    const frag = document.createDocumentFragment();
    list.forEach((_, j) => { const s = document.createElement('span'); s.className = 'w'; s.innerHTML = lettersHTML(start + j); frag.appendChild(s); wordEls.push(s); });
    el.words.appendChild(frag);
  }
  function ensureWords() { if (cfg.mode === 'time' && test.words.length - test.index < 40) appendWords(moreWords(40)); }

  function placeCaret(instant) {
    const i = Math.min(test.index, test.words.length - 1);
    const w = wordEls[i]; if (!w) return;
    const typedLen = test.index < test.words.length ? test.typed[test.index].length : test.words[i].length;
    const spans = w.children;
    let x;
    if (typedLen < spans.length) x = w.offsetLeft + spans[typedLen].offsetLeft;
    else { const lastS = spans[spans.length - 1]; x = w.offsetLeft + lastS.offsetLeft + lastS.offsetWidth; }
    const lineH = w.offsetHeight || 1;
    const line = Math.round(w.offsetTop / lineH);
    const want = Math.max(0, line - 1);
    if (want !== scrollLine) { scrollLine = want; el.words.style.transform = `translateY(${-scrollLine * lineH}px)`; }
    const ch = el.caret.offsetHeight;
    const y = (line - scrollLine) * lineH + (lineH - ch) / 2;
    if (instant) { el.caret.style.transition = 'none'; }
    el.caret.style.transform = `translate(${(x - 1).toFixed(1)}px,${y.toFixed(1)}px)`;
    if (instant) { void el.caret.offsetHeight; el.caret.style.transition = ''; }
    el.caret.classList.toggle('idle', state !== 'running');
  }

  /* ---------- typing ---------- */
  function elapsed() { return test.startedAt === null ? 0 : now() - test.startedAt; }
  function timeUp() { return cfg.mode === 'time' && test.startedAt !== null && elapsed() >= cfg.length * 1000; }

  function onInput() {
    if (!test || test.finished || state === 'done') { el.input.value = ''; return; }
    if (timeUp()) { el.input.value = ''; finish(); return; }
    const from = test.index;
    E.applyInput(test, el.input.value, now());
    if (state === 'ready' && test.startedAt !== null) begin();
    if (state === 'running') document.body.classList.add('ks-focus');
    el.input.value = test.finished ? '' : test.typed[test.index];
    ensureWords();
    for (let i = from; i <= Math.min(test.index, test.words.length - 1); i++) paintWord(i);
    placeCaret();
    updateLive();
    if (test.finished) finish();
  }

  function begin() {
    setState('running');
    setStatus(cfg.mode === 'time' ? 'Typing · ' + cfg.length + 's left' : 'Typing');
    el.caret.classList.remove('idle');
    ticker = setInterval(tick, 100);
  }

  function tick() {
    if (!test || state !== 'running') return;
    if (timeUp()) return finish();
    updateLive();
  }

  function updateLive() {
    const ms = elapsed();
    if (cfg.mode === 'time') {
      const left = Math.max(0, Math.ceil(cfg.length - ms / 1000 - 1e-9));
      el.liveMain.textContent = test.startedAt === null ? cfg.length : left;
      if (state === 'running') setStatus('Typing · ' + left + 's left');
    } else {
      el.liveMain.textContent = Math.min(test.index, test.words.length) + '/' + test.words.length;
    }
    const wpm = ms >= 1000 ? E.liveCorrect(test) / 5 / (ms / 60000) : 0;
    el.liveWpm.textContent = r0(wpm);
    el.liveAcc.textContent = (test.keystrokes ? Math.floor((test.correctKeys / test.keystrokes) * 100) : 100) + '%';
  }

  function finish() {
    if (!test || state === 'done') return;
    clearInterval(ticker); ticker = null;
    const ms = cfg.mode === 'time' ? cfg.length * 1000 : (test.endedAt || elapsed());
    test.finished = true;
    if (test.endedAt === null) test.endedAt = ms;
    const r = E.results(test, ms);
    setState('done');
    if (r.correctChars === 0 || r.keystrokes < 2) {
      ZL.toast('Not saved. Type at least one word correctly to get a result.', { type: 'info' });
      newTest();
      return;
    }
    const run = {
      id: Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), ts: Date.now(),
      mode: cfg.mode, length: cfg.length, punct: cfg.punct, nums: cfg.nums, diff: cfg.diff, drill: cfg.drill,
      wpm: r.wpm, raw: r.raw, acc: r.accuracy, cons: r.consistency, chars: r.chars, elapsed: r.elapsed
    };
    let isPb = false;
    if (run.mode === 'time' || run.mode === 'words' || run.mode === 'sentences') {
      const prev = pbs[pbKey(run)];
      if (!prev || run.wpm > prev.wpm) {
        isPb = true; run.pb = true;
        pbs[pbKey(run)] = { wpm: run.wpm, acc: run.acc, raw: run.raw, ts: run.ts, id: run.id, prev: prev ? prev.wpm : null };
      }
    }
    history.push(run);
    if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
    last = { run, seconds: r.seconds, keys: r.keys, words: test.words.slice(0, Math.min(test.words.length, test.index + 1)), cfg: Object.assign({}, cfg), isPb };
    saveAll();
    showResults(last);
    renderProgress();
    setStatus('Finished · ' + r0(run.wpm) + ' wpm');
    if (isPb) ZL.toast('New personal best: ' + r0(run.wpm) + ' wpm, ' + fmtTest(run).toLowerCase());
    else ZL.toast('Result saved · ' + r0(run.wpm) + ' wpm');
  }

  function restart(fromButton) {
    const wasRunning = state === 'running';
    if (last && last.isPreview) last = store.get('last', null);
    newTest(cfg && cfg.drill ? { drill: cfg.drill } : {});
    if (fromButton && wasRunning) ZL.toast('Test restarted. Nothing was saved.', { type: 'info' });
  }

  /* ---------- view switching ---------- */
  function showTyping() {
    el.results.hidden = true; el.results.classList.remove('show');
    el.typing.hidden = false;
    $('#ks-config').style.display = '';
  }
  function setView(v) {
    view = v;
    $('#ks-tab-test').setAttribute('aria-selected', String(v === 'test'));
    $('#ks-tab-progress').setAttribute('aria-selected', String(v === 'progress'));
    $('#ks-view-test').hidden = v !== 'test';
    $('#ks-view-progress').hidden = v !== 'progress';
    if (v === 'progress') {
      if (state === 'running') { clearInterval(ticker); setState('ready'); newTest({ focus: false }); }
      renderProgress();
      setStatus(history.length ? history.length + (history.length === 1 ? ' test saved' : ' tests saved') : 'No tests yet');
    } else {
      if (!el.results.hidden && shownResult) setStatus('Finished · ' + r0(shownResult.run.wpm) + ' wpm');
      else { setStatus('Ready · ' + describe(cfg)); requestAnimationFrame(() => placeCaret(true)); }
    }
  }

  /* ---------- results ---------- */
  function showResults(res, opts) {
    opts = opts || {};
    shownResult = res;
    const run = res.run;
    el.typing.hidden = true;
    el.results.hidden = false;
    el.results.classList.remove('show'); void el.results.offsetWidth; el.results.classList.add('show');
    const wpmEl = $('#ks-r-wpm');
    wpmEl.textContent = r0(run.wpm);
    wpmEl.classList.remove('pop'); void wpmEl.offsetWidth; wpmEl.classList.add('pop');
    $('#ks-r-acc').textContent = r0(run.acc) + '%';
    $('#ks-r-acc').title = run.acc.toFixed(1) + '%';
    const pb = $('#ks-pb');
    pb.hidden = !res.isPb;
    pb.lastChild.textContent = res.isPb && pbs[pbKey(run)] && pbs[pbKey(run)].prev ? 'New personal best · up from ' + r0(pbs[pbKey(run)].prev) : 'New personal best';
    if (res.isPb) { pb.classList.remove('pop'); void pb.offsetWidth; pb.classList.add('pop'); }
    const meta = [fmtTest(run)];
    if (run.mode === 'time' || run.mode === 'words') meta.push(run.diff === 'all' ? 'all words' : 'common words');
    if (run.punct) meta.push('punctuation');
    if (run.nums) meta.push('numbers');
    $('#ks-r-meta').innerHTML = `<span>${esc((opts.preview ? 'Example result · ' : '') + meta.join(' · '))}</span>` + (opts.preview ? '' : `<span>${esc(fmtDate(run.ts))}</span>`);
    $('#ks-r-raw').textContent = r0(run.raw);
    $('#ks-r-cons').textContent = r0(run.cons) + '%';
    const c = run.chars;
    $('#ks-r-chars').innerHTML = `<span class="c-ok" data-tip="Correct">${c.correct}</span><i>/</i><span class="c-bad" data-tip="Incorrect">${c.incorrect}</span><i>/</i><span class="c-extra" data-tip="Extra">${c.extra}</span><i>/</i><span class="c-miss" data-tip="Missed">${c.missed}</span>`;
    $('#ks-r-time').textContent = fmtSecs(run.elapsed);
    $('#ks-r-time-hint').textContent = run.mode === 'time' ? 'Fixed test length' : 'From first to last key';
    C.speed($('#ks-chart-box'), res.seconds);
    const weakLetters = E.weakKeys(res.keys, 5, true);
    C.keyboard($('#ks-keyboard'), res.keys, weakLetters);
    renderWeak(weakLetters);
    if (!opts.preview) setStatus('Finished · ' + r0(run.wpm) + ' wpm');
    el.results.setAttribute('tabindex', '-1');
    if (opts.focus !== false) el.results.focus({ preventScroll: true });
  }

  function renderWeak(weak) {
    const list = $('#ks-weak-list'), btn = $('#ks-drill'), hint = $('#ks-drill-hint');
    if (!weak.length) {
      list.innerHTML = '<li><p class="ks-weak-empty">No missed letters this time. Every letter key was right.</p></li>';
      btn.disabled = true;
      hint.textContent = 'Miss a letter and a drill for it will be ready here.';
      return;
    }
    list.innerHTML = weak.map(w => `<li><span class="k">${esc(w.key)}</span><span class="bar" aria-hidden="true"><i style="width:${Math.max(4, 100 - w.acc).toFixed(0)}%"></i></span><span class="v">${r0(w.acc)}%<small>${w.miss} of ${w.total} missed</small></span></li>`).join('');
    btn.disabled = false;
    btn.dataset.letters = weak.map(w => w.key).join('');
    hint.textContent = 'A ' + DRILL_SIZE + '-word drill packed with ' + weak.map(w => w.key).join(', ') + '.';
  }

  function startDrill() {
    const letters = ($('#ks-drill').dataset.letters || '').split('').filter(Boolean);
    if (!letters.length) return;
    newTest({ drill: letters });
    ZL.toast('Drill ready: ' + letters.join(', '));
  }

  function copyResult() {
    if (!shownResult) return;
    const r = shownResult.run;
    const text = `Keystroke: ${r0(r.wpm)} wpm at ${r0(r.acc)}% accuracy (${fmtTest(r)}). Raw ${r0(r.raw)}, consistency ${r0(r.cons)}%. ${ZL.app.url}`;
    Promise.resolve(ZL.copy(text)).then(ok => ZL.toast(ok === false ? 'Could not copy. Select the numbers and copy them by hand.' : 'Copied to clipboard', { type: ok === false ? 'bad' : 'good' }));
  }

  /* ---------- progress ---------- */
  function avg(list, f) { return list.length ? list.reduce((a, r) => a + f(r), 0) / list.length : 0; }

  function renderProgress() {
    const count = $('#ks-tab-count');
    count.hidden = !history.length; count.textContent = history.length;
    const empty = !history.length;
    $('#ks-progress').hidden = empty;
    $('#ks-prog-empty').hidden = !empty;
    if (empty || view !== 'progress') return;
    const last10 = history.slice(-10);
    const best = history.reduce((b, r) => (r.wpm > b ? r.wpm : b), 0);
    const total = history.reduce((a, r) => a + (r.elapsed || 0), 0);
    $('#ks-avgs').innerHTML = [
      [r0(avg(last10, r => r.wpm)), 'wpm', 'Average of last ' + last10.length],
      [r0(avg(history, r => r.wpm)), 'wpm', 'All-time average'],
      [r0(avg(last10, r => r.acc)), '%', 'Accuracy, last ' + last10.length],
      [r0(best), 'wpm', 'Fastest test'],
      [history.length, history.length === 1 ? 'test' : 'tests', fmtDuration(total) + ' spent typing']
    ].map(([v, u, l]) => `<div><b>${v}${u ? `<small>${u}</small>` : ''}</b><span>${esc(l)}</span></div>`).join('');
    const runs = history.slice(-60);
    C.progress($('#ks-prog-box'), runs, fmtDate, fmtTest);
    // personal bests
    const freshId = last && last.isPb ? last.run.id : null;
    const groups = [['time', 'Time', n => n + ' s'], ['words', 'Words', n => n + ' words'], ['sentences', 'Sentences', n => n + (n === 1 ? ' sentence' : ' sentences')]];
    $('#ks-pbs').innerHTML = groups.map(([mode, label, unit]) =>
      `<div class="ks-pb-row"><span class="ks-pb-mode">${label}</span>` + LENGTHS[mode].map(n => {
        const p = pbs[mode + '-' + n];
        return p ? `<div class="ks-pb-cell${p.id === freshId ? ' fresh' : ''}"><span class="t">${unit(n)}</span><b>${r0(p.wpm)}</b><small>${r0(p.acc)}% · ${esc(fmtDate(p.ts))}</small></div>`
          : `<div class="ks-pb-cell none"><span class="t">${unit(n)}</span><b>–</b><small>Not yet</small></div>`;
      }).join('') + '</div>').join('');
    // history table
    const rows = history.slice().reverse();
    const shown = showAll ? rows : rows.slice(0, 10);
    $('#ks-table tbody').innerHTML = shown.map(r => `<tr><td>${esc(fmtDate(r.ts))}</td><td>${esc(fmtTest(r))}${r.punct ? ' <span class="mut-s">· punctuation</span>' : ''}${r.pb ? '<span class="tag">PB</span>' : ''}</td><td class="r w">${r0(r.wpm)}</td><td class="r">${r0(r.acc)}%</td><td class="r hide-sm">${r0(r.raw)}</td><td class="r hide-sm">${r0(r.cons)}%</td></tr>`).join('');
    const more = $('#ks-more');
    more.hidden = rows.length <= 10;
    more.textContent = showAll ? 'Show fewer' : 'Show all ' + rows.length;
  }

  async function clearHistory() {
    if (!history.length) { ZL.toast('History is already empty', { type: 'info' }); return; }
    const ok = await ZL.confirm({
      title: 'Clear all history?',
      body: `This deletes ${history.length} saved ${history.length === 1 ? 'result' : 'results'} and your personal bests from this device. It can't be undone.`,
      confirmLabel: 'Clear history', danger: true
    });
    if (!ok) return;
    history = []; pbs = {}; last = null; shownResult = null;
    saveAll();
    renderProgress();
    $('#ks-last').hidden = true;
    setStatus('No tests yet');
    ZL.toast('History cleared');
  }

  /* ---------- example data ---------- */
  // A simulated typist run through the real engine, so the example chart, heatmap and numbers are genuine.
  function simulate(o) {
    const rnd = E.rng(o.seed);
    const s = E.createTest(E.pickWords(W.common, 160, rnd), { fixedLength: false });
    const weak = o.weak || { b: .16, h: .1, m: .08, y: .06, p: .05, v: .07, g: .04 };
    const base = 60000 / (o.wpm * 5), dur = o.secs * 1000;
    const wrong = () => 'etaoinshrdlucmfwypvbgk'[Math.floor(rnd() * 22)];
    let t = 0;
    while (t < dur) {
      const pace = base * (1 + 0.16 * Math.sin(t / 2600) + (t < 2200 ? 0.3 : 0) + (rnd() - 0.5) * 0.55);
      t += Math.max(35, pace);
      if (t >= dur) break;
      const target = s.words[s.index], typed = s.typed[s.index];
      if (typed.length >= target.length) { E.typeChar(s, ' ', t); continue; }
      const want = target[typed.length];
      if (rnd() < 0.003 + (weak[want] || 0)) {
        let w = wrong(); if (w === want) w = 'x';
        E.typeChar(s, w, t);
        if (rnd() < 0.72) { t += pace * 1.7; E.backspace(s, t); t += pace * 0.7; E.typeChar(s, want, t); }
      } else E.typeChar(s, want, t);
    }
    return { r: E.results(s, dur), words: s.words.slice(0, s.index + 1) };
  }

  function buildExample() {
    const rnd = E.rng(20261031);
    const plan = ['time-30', 'time-30', 'words-25', 'time-60', 'time-30', 'time-15', 'sentences-3', 'time-30', 'words-50', 'time-30', 'time-60', 'drill-25',
      'time-30', 'time-15', 'words-25', 'time-30', 'time-120', 'sentences-1', 'time-30', 'words-10', 'time-60', 'time-30', 'words-25', 'time-15', 'time-30', 'sentences-3', 'time-60'];
    const day = 864e5, start = Date.now() - 20 * day;
    const hist = [], best = {};
    plan.forEach((p, i) => {
      const [mode, len] = p.split('-'); const length = +len;
      const wpm = 58 + i * 0.75 + (rnd() - 0.5) * 10 + (mode === 'time' && length === 15 ? 4 : 0) - (length >= 60 ? 3 : 0);
      const acc = 92.5 + rnd() * 5.5;
      const secs = mode === 'time' ? length : mode === 'words' ? (length * 5.6 / 5) / wpm * 60 : mode === 'drill' ? (25 * 5.6 / 5) / wpm * 60 : (length * 10 * 5.6 / 5) / wpm * 60;
      const d0 = new Date(start + (i / plan.length) * 20 * day); d0.setHours(8 + Math.floor(rnd() * 13), Math.floor(rnd() * 60), 0, 0); const ts = d0.getTime();
      const total = Math.round(wpm / 60 * secs * 5 / (acc / 100));
      hist.push({
        id: 'ex' + i, ts, ex: true, mode, length, punct: i % 7 === 3, nums: false, diff: i % 5 === 2 ? 'all' : 'common', drill: mode === 'drill' ? ['b', 'h', 'm'] : null,
        wpm, raw: wpm * (1 + (100 - acc) / 70), acc, cons: 68 + rnd() * 16, elapsed: Math.round(secs * 1000),
        chars: { correct: Math.round(total * acc / 100), incorrect: Math.round(total * (100 - acc) / 160), extra: Math.round(rnd() * 2), missed: Math.round(rnd() * 2) }
      });
    });
    // The newest run is a real simulated 30-second test.
    const sim = simulate({ seed: 7, wpm: 86, secs: 30 });
    const r = sim.r;
    const run = { id: 'ex-last', ts: Date.now() - 4 * 60000, ex: true, mode: 'time', length: 30, punct: false, nums: false, diff: 'common', drill: null,
      wpm: r.wpm, raw: r.raw, acc: r.accuracy, cons: r.consistency, chars: r.chars, elapsed: r.elapsed };
    hist.push(run);
    const pbsOut = {};
    hist.forEach(h => {
      if (h.mode === 'drill') return;
      const k = pbKey(h), prev = pbsOut[k];
      if (!prev || h.wpm > prev.wpm) { h.pb = true; pbsOut[k] = { wpm: h.wpm, acc: h.acc, raw: h.raw, ts: h.ts, id: h.id, prev: prev ? prev.wpm : null }; }
    });
    return { history: hist, pbs: pbsOut, last: { run, seconds: r.seconds, keys: r.keys, words: sim.words, cfg: { mode: 'time', length: 30, punct: false, nums: false, diff: 'common', drill: null }, isPb: !!run.pb } };
  }

  async function loadExample() {
    const real = history.filter(r => !r.ex).length;
    if (real) {
      const ok = await ZL.confirm({ title: 'Replace your history with the example?', body: `Your ${real} saved ${real === 1 ? 'result' : 'results'} and personal bests will be replaced. You can undo straight after.`, confirmLabel: 'Load example' });
      if (!ok) return;
    }
    const backup = { history, pbs, last };
    const ex = buildExample();
    history = ex.history; pbs = ex.pbs; last = ex.last;
    saveAll();
    if (state === 'running') { clearInterval(ticker); setState('ready'); }
    setState('done');
    setView('test');
    showResults(last, { focus: false });
    renderProgress();
    $('#ks-last').hidden = false;
    ZL.toast('Example loaded: ' + history.length + ' tests', {
      action: { label: 'Undo', fn: () => { history = backup.history; pbs = backup.pbs; last = backup.last; saveAll(); renderProgress(); $('#ks-last').hidden = !last; newTest({ focus: false }); ZL.toast('Example removed'); } }
    });
  }

  function ensureResultForTour() {
    setView('test');
    if (!el.results.hidden) return;
    if (last) { setState('done'); showResults(last, { focus: false }); return; }
    const ex = buildExample().last;
    setState('done');
    showResults(Object.assign(ex, { isPb: false }), { preview: true, focus: false });
    setStatus('Example result');
  }

  /* ---------- events ---------- */
  $('#ks-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.mode !== settings.mode) changeSetting({ mode: b.dataset.mode }); });
  $('#ks-length').addEventListener('click', e => { const b = e.target.closest('button'); if (b) changeSetting({ [settings.mode]: +b.dataset.len }); });
  $('#ks-punct').addEventListener('click', () => changeSetting({ punct: !settings.punct }));
  $('#ks-nums').addEventListener('click', () => changeSetting({ nums: !settings.nums }));
  $('#ks-diff').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) changeSetting({ diff: b.dataset.diff }); });

  $('#ks-tab-test').addEventListener('click', () => setView('test'));
  $('#ks-tab-progress').addEventListener('click', () => setView('progress'));
  document.querySelector('.ks-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = view === 'test' ? 'progress' : 'test';
    setView(next); $('#ks-tab-' + next).focus();
  });

  el.input.addEventListener('input', onInput);
  el.input.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); el.restart.focus(); el.restart.classList.add('ks-restart-armed'); }
    else if (e.key === 'Enter') e.preventDefault();
  });
  el.input.addEventListener('focus', syncFocus);
  el.input.addEventListener('blur', () => setTimeout(syncFocus, 0));
  el.restart.addEventListener('click', () => restart(true));
  el.restart.addEventListener('blur', () => el.restart.classList.remove('ks-restart-armed'));
  el.results.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && document.activeElement === el.results) { e.preventDefault(); $('#ks-next').focus(); }
  });
  $('#ks-next').addEventListener('click', () => newTest(shownResult && shownResult.run.mode === 'drill' && shownResult.run.drill ? {} : {}));
  $('#ks-repeat').addEventListener('click', () => {
    if (!shownResult) return newTest();
    const c = shownResult.cfg || {};
    newTest(c.drill ? { words: shownResult.words, cfg: c } : { words: shownResult.words, cfg: c });
    ZL.toast('Same text loaded. Go again.', { type: 'info' });
  });
  $('#ks-copy').addEventListener('click', copyResult);
  $('#ks-drill').addEventListener('click', startDrill);
  $('#ks-last').addEventListener('click', () => { if (last) { setState('done'); showResults(last); } });
  $('#ks-clear').addEventListener('click', clearHistory);
  $('#ks-more').addEventListener('click', () => { showAll = !showAll; renderProgress(); });
  $('#ks-example').addEventListener('click', loadExample);
  $('#ks-empty-example').addEventListener('click', loadExample);
  $('#ks-empty-start').addEventListener('click', () => { setView('test'); newTest(); });

  // Typing anywhere near the test focuses it, so you never lose the first key.
  document.addEventListener('keydown', e => {
    if (view !== 'test' || el.typing.hidden || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== el.app && !el.app.contains(a)) return;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (document.querySelector('.zl-tour-card, dialog[open]')) return;
    const r = el.app.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    focusInput();
  });
  el.typing.addEventListener('mousedown', e => { if (!e.target.closest('button')) setTimeout(focusInput, 0); });

  // Focus mode lifts as soon as the mouse moves.
  let mx = null, my = null;
  document.addEventListener('mousemove', e => {
    if (!document.body.classList.contains('ks-focus')) { mx = e.clientX; my = e.clientY; return; }
    if (mx === null || Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) > 12) document.body.classList.remove('ks-focus');
    mx = e.clientX; my = e.clientY;
  });

  if ('ResizeObserver' in window) new ResizeObserver(() => { if (test && !el.typing.hidden) placeCaret(true); }).observe(el.wrap);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (test) placeCaret(true); });

  /* ---------- hero demo ---------- */
  function heroDemo() {
    const box = $('#ks-demo-text'); if (!box) return;
    const line = 'pack the blue jacket before the storm rolls in';
    const script = []; // [char typed, correct?]
    for (let i = 0; i < line.length; i++) {
      if (i === 14) { script.push(['x', false], ['back']); }
      script.push([line[i], true]);
    }
    let pos = 0, typed = '', errs = 0, keys = 0, vt = 0, timer = null, visible = true;
    function paint(wrongAt) {
      let h = '';
      for (let i = 0; i < line.length; i++) {
        const cls = i < typed.length ? (i === wrongAt ? 'bad' : 'ok') : '';
        h += `<span class="${cls}${i === typed.length ? ' cur' : ''}">${line[i] === ' ' ? '&nbsp;' : line[i]}</span>`;
      }
      box.innerHTML = h;
    }
    function step() {
      if (!visible) { timer = setTimeout(step, 400); return; }
      if (pos >= script.length) { timer = setTimeout(() => { pos = 0; typed = ''; errs = 0; keys = 0; vt = 0; paint(-1); step(); }, 2600); return; }
      const [ch, ok] = script[pos++];
      let wrongAt = -1;
      if (ch === undefined || script[pos - 1][0] === 'back') typed = typed.slice(0, -1);
      else { keys++; if (!ok) { errs++; wrongAt = typed.length; } typed += ok ? ch : line[typed.length]; }
      paint(wrongAt);
      const delay = ok === false ? 300 : 120 + Math.random() * 90;
      vt += delay;
      $('#ks-demo-wpm').textContent = keys > 4 ? r0((typed.length / 5) / (vt / 60000)) : 0;
      $('#ks-demo-acc').textContent = r0(((keys - errs) / Math.max(1, keys)) * 100) + '% accuracy';
      timer = setTimeout(step, delay);
    }
    if (reduced()) { typed = line.slice(0, 26); paint(-1); $('#ks-demo-wpm').textContent = '84'; $('#ks-demo-acc').textContent = '98% accuracy'; return; }
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(box);
    paint(-1);
    setTimeout(step, 900);
  }

  /* ---------- tour ---------- */
  ZL.tour([
    { el: '#ks-config', title: 'Pick a test', body: 'Time, word count or real sentences. Add punctuation or numbers, or switch to the full word list.', before: () => { if (view !== 'test' || el.typing.hidden) { setView('test'); newTest({ focus: false }); } } },
    { el: '#ks-words-wrap', title: 'Just start typing', body: 'The clock starts on your first key. Mistakes show in red, and backspace works inside the current word.' },
    { el: '#ks-live', title: 'Live numbers', body: 'Time left, speed and accuracy update as you type. Everything else fades so you can focus.' },
    { el: '#ks-chart', title: 'Every second, charted', body: 'After each test, see speed and raw speed per second. Red dots mark errors. Hover for detail.', before: ensureResultForTour },
    { el: '#ks-heatmap', title: 'Key-by-key accuracy', body: 'Each key is shaded by how often you hit it right. Your weakest letters get a one-tap drill.', before: ensureResultForTour },
    { get el() { return history.length ? '#ks-history' : '#ks-prog-empty'; }, title: 'Your progress', body: 'Personal bests for every test length, averages and a full history. It all stays on this device.', before: () => setView('progress') }
  ]);

  /* ---------- start ---------- */
  renderConfig();
  newTest({ focus: false });
  renderProgress();
  $('#ks-last').hidden = !last;
  syncFocus();
  heroDemo();

  // Small read-only hooks for the automated tests.
  window.Keystroke = {
    get test() { return test; }, get cfg() { return cfg; }, get state() { return state; },
    get last() { return last; }, get history() { return history; }, get pbs() { return pbs; },
    newTest, finish, setView, simulate, buildExample
  };
})();
