// Keystroke engine: pure typing-test logic with no DOM access.
// Times passed in are milliseconds from any clock; the engine stores them relative to the first keystroke.
(function (root) {
  'use strict';

  const MAX_EXTRA = 10; // extra letters allowed past the end of a word

  // Small seeded random generator so word lists can be reproduced.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Pick n words at random, never the same word twice in a row.
  function pickWords(list, n, rand, last) {
    const out = [];
    let prev = last;
    while (out.length < n) {
      const w = list[Math.floor(rand() * list.length)];
      if (w === prev && list.length > 1) continue;
      out.push(w);
      prev = w;
    }
    return out;
  }

  // Returns a function that decorates one word at a time with punctuation and numbers.
  // It keeps its own state, so capitalisation carries across batches in timed tests.
  function makeDecorator(opts, rand) {
    let capNext = true;
    return function decorate(word, isLast) {
      let w = word;
      if (opts.numbers && rand() < 0.12) {
        const r = rand();
        w = String(r < 0.4 ? Math.floor(rand() * 10) : r < 0.8 ? 10 + Math.floor(rand() * 90) : 100 + Math.floor(rand() * 9900));
      }
      if (!opts.punctuation) return w;
      if (capNext && /^[a-z]/.test(w)) w = w[0].toUpperCase() + w.slice(1);
      capNext = false;
      if (isLast) return w + '.';
      const r = rand();
      if (r < 0.08) { capNext = true; return w + '.'; }
      if (r < 0.105) { capNext = true; return w + '?'; }
      if (r < 0.12) { capNext = true; return w + '!'; }
      if (r < 0.22) return w + ',';
      if (r < 0.24) return '"' + w + '"';
      if (r < 0.255) return '(' + w + ')';
      if (r < 0.265) return w + ':';
      return w;
    };
  }

  function createTest(words, opts) {
    opts = opts || {};
    return {
      words: words.slice(),
      typed: [''],
      index: 0,
      fixedLength: !!opts.fixedLength, // words and sentences modes end on the last word
      startedAt: null,
      endedAt: null, // relative ms
      finished: false,
      keystrokes: 0,
      correctKeys: 0,
      committedCorrect: 0, // characters of correct words, plus the space after each
      events: [], // {t, kind: 'char'|'space'|'back', correct, cum}
      keys: {} // per physical key: {hit, miss}, judged against the key that should have been pressed
    };
  }

  // Characters that count toward WPM right now, including a correct prefix of the word in progress.
  function liveCorrect(s) {
    const target = s.words[s.index] || '';
    const typed = s.typed[s.index] || '';
    const prefix = typed.length && target.startsWith(typed) ? typed.length : 0;
    return s.committedCorrect + prefix;
  }

  // Shifted characters map to the physical key that produces them on a US QWERTY layout.
  const SHIFTED = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
  function keyFor(ch) {
    if (ch === ' ') return ' ';
    if (SHIFTED[ch]) return SHIFTED[ch];
    return ch.toLowerCase();
  }

  function markKey(s, expected, ok) {
    const k = keyFor(expected);
    const rec = s.keys[k] || (s.keys[k] = { hit: 0, miss: 0 });
    if (ok) rec.hit++; else rec.miss++;
  }

  function stamp(s, now) {
    if (s.startedAt === null) s.startedAt = now;
    return now - s.startedAt;
  }

  function log(s, t, kind, correct) {
    s.events.push({ t, kind, correct, cum: liveCorrect(s) });
  }

  function end(s, t) {
    s.finished = true;
    s.endedAt = t;
  }

  function typeChar(s, ch, now) {
    if (s.finished) return false;
    if (ch === ' ') return typeSpace(s, now);
    const i = s.index;
    const target = s.words[i];
    const typed = s.typed[i];
    if (typed.length >= target.length + MAX_EXTRA) return false;
    const t = stamp(s, now);
    const correct = typed.length < target.length && target[typed.length] === ch;
    // Typing past the end of a word means the space bar was the key you needed.
    markKey(s, typed.length < target.length ? target[typed.length] : ' ', correct);
    s.typed[i] = typed + ch;
    s.keystrokes++;
    if (correct) s.correctKeys++;
    log(s, t, 'char', correct);
    if (s.fixedLength && i === s.words.length - 1 && s.typed[i] === target) end(s, t);
    return true;
  }

  function typeSpace(s, now) {
    if (s.finished) return false;
    const i = s.index;
    const typed = s.typed[i];
    if (typed === '') return false; // a space on an empty word does nothing
    const t = stamp(s, now);
    const target = s.words[i];
    const correct = typed === target;
    // Pressing space early counts as a miss on the letter that was due; otherwise the space itself was right.
    if (typed.length < target.length) markKey(s, target[typed.length], false); else markKey(s, ' ', true);
    s.keystrokes++;
    if (correct) { s.correctKeys++; s.committedCorrect += target.length + 1; }
    s.index++;
    s.typed.push('');
    log(s, t, 'space', correct);
    if (s.fixedLength && s.index >= s.words.length) end(s, t);
    return true;
  }

  // Backspace only ever works inside the current word.
  function backspace(s, now, wholeWord) {
    if (s.finished) return false;
    const i = s.index;
    const typed = s.typed[i];
    if (!typed) return false;
    const t = stamp(s, now);
    s.typed[i] = wholeWord ? '' : typed.slice(0, -1);
    log(s, t, 'back', null);
    return true;
  }

  // Apply the full value of the input box (used for mobile keyboards and autocorrect),
  // turning the difference from the current word into backspaces, letters and spaces.
  function applyInput(s, value, now) {
    const parts = value.split(' ');
    for (let p = 0; p < parts.length; p++) {
      if (s.finished) break;
      if (p > 0) typeSpace(s, now);
      if (s.finished) break;
      const v = parts[p];
      const cur = s.typed[s.index];
      let k = 0;
      while (k < cur.length && k < v.length && cur[k] === v[k]) k++;
      for (let n = cur.length; n > k; n--) backspace(s, now);
      for (const ch of v.slice(k)) typeChar(s, ch, now);
    }
  }

  function consistency(values) {
    if (values.length < 2) return 100;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean <= 0) return 0;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length);
    return Math.max(0, Math.min(100, 100 * (1 - sd / mean)));
  }

  // Final numbers for a test that ran for elapsedMs.
  function results(s, elapsedMs) {
    const ms = Math.max(elapsedMs, 1);
    const minutes = ms / 60000;
    const i = s.index;
    let correctChars = s.committedCorrect;
    // The word under the caret counts only if it is complete and correct (no trailing space needed).
    if (i < s.words.length && s.typed[i] && s.typed[i] === s.words[i]) correctChars += s.words[i].length;

    let rawChars = 0;
    const chars = { correct: 0, incorrect: 0, extra: 0, missed: 0 };
    for (let j = 0; j <= i && j < s.typed.length; j++) {
      const typed = s.typed[j];
      const target = s.words[j] || '';
      const committed = j < i;
      rawChars += typed.length + (committed ? 1 : 0);
      for (let k = 0; k < Math.max(typed.length, committed ? target.length : 0); k++) {
        if (k >= target.length) chars.extra++;
        else if (k >= typed.length) chars.missed++;
        else if (typed[k] === target[k]) chars.correct++;
        else chars.incorrect++;
      }
    }

    // Per-second series. A final sliver under half a second is folded into the second before it.
    let n = Math.max(1, Math.ceil(ms / 1000 - 1e-9));
    if (n > 1 && ms - (n - 1) * 1000 < 500) n--;
    const keys = new Array(n).fill(0);
    const errs = new Array(n).fill(0);
    for (const e of s.events) {
      if (e.kind === 'back' || e.t > ms) continue;
      const b = Math.min(n - 1, Math.floor(e.t / 1000));
      keys[b]++;
      if (!e.correct) errs[b]++;
    }
    const seconds = [];
    let ei = 0, cum = 0;
    for (let b = 0; b < n; b++) {
      const tEnd = b === n - 1 ? ms : (b + 1) * 1000;
      const dur = tEnd - b * 1000;
      while (ei < s.events.length && s.events[ei].t <= tEnd) { cum = s.events[ei].cum; ei++; }
      seconds.push({
        second: b + 1,
        wpm: cum / 5 / (tEnd / 60000),
        raw: keys[b] / 5 / (dur / 60000),
        errors: errs[b]
      });
    }

    return {
      wpm: correctChars / 5 / minutes,
      raw: s.keystrokes / 5 / minutes, // every key press that produced a character or space, right or wrong
      accuracy: s.keystrokes ? (s.correctKeys / s.keystrokes) * 100 : 0,
      consistency: consistency(seconds.map(x => x.raw)),
      correctChars,
      rawChars,
      keystrokes: s.keystrokes,
      correctKeys: s.correctKeys,
      chars,
      seconds,
      elapsed: ms,
      keys: JSON.parse(JSON.stringify(s.keys))
    };
  }

  // Keys with at least one miss, weakest first. Only letters are returned when lettersOnly is set.
  function weakKeys(keys, limit, lettersOnly) {
    return Object.keys(keys || {})
      .map(k => ({ key: k, hit: keys[k].hit, miss: keys[k].miss, total: keys[k].hit + keys[k].miss }))
      .filter(r => r.miss > 0 && (!lettersOnly || /^[a-z]$/.test(r.key)))
      .map(r => Object.assign(r, { acc: (r.hit / r.total) * 100 }))
      .sort((a, b) => a.acc - b.acc || b.miss - a.miss || a.key.localeCompare(b.key))
      .slice(0, limit || 5);
  }

  // A drill of n words, weighted towards words that use the given letters a lot.
  // Every letter is guaranteed to appear at least once (when the list has a word containing it).
  function drillWords(list, letters, n, rand) {
    letters = (letters || []).filter(l => /^[a-z]$/.test(l));
    if (!letters.length) return pickWords(list, n, rand);
    const score = w => {
      let hits = 0;
      for (const ch of w) if (letters.includes(ch)) hits++;
      return hits / Math.sqrt(w.length);
    };
    const ranked = list.map(w => ({ w, sc: score(w) })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
    const pool = ranked.slice(0, Math.max(24, Math.ceil(ranked.length * 0.35))).map(x => x.w);
    const out = [];
    letters.forEach(l => { const w = ranked.find(x => x.w.includes(l)); if (w && out.length < n) out.push(w.w); });
    while (out.length < n && pool.length) {
      const w = pool[Math.floor(rand() * pool.length)];
      if (w !== out[out.length - 1] || pool.length === 1) out.push(w);
    }
    // Shuffle so the guaranteed words are not always at the front.
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  root.KeystrokeEngine = {
    MAX_EXTRA, rng, pickWords, makeDecorator, createTest,
    typeChar, typeSpace, backspace, applyInput, results, consistency, liveCorrect,
    keyFor, weakKeys, drillWords
  };
})(typeof window !== 'undefined' ? window : globalThis);
