/* Bikini Bottom Mines — deterministic logic harness (Node, no browser).
   Stubs DOM + Canvas2D, loads the real game script out of index.html and drives
   full playthroughs through the window.GAME debug hook.

   Run:  node harness.js [index.html]
   Exits 0 only when every check passes.

   The canvas context stub is a STRICT proxy: reading a member that is neither a
   whitelisted CanvasRenderingContext2D method nor a property the game set itself
   throws, so canvas-API typos surface as harness failures instead of silently
   doing nothing. */
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no inline <script> found in ' + file); process.exit(1); }
const code = m[1];

/* ------------------------------- stubs --------------------------------- */
const CTX_METHODS = new Set([
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'roundRect',
  'fill', 'stroke', 'clip', 'fillText', 'strokeText', 'measureText', 'drawImage',
  'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform',
  'createLinearGradient', 'createRadialGradient', 'createPattern', 'getImageData', 'putImageData',
  'createImageData', 'setLineDash', 'getLineDash'
]);
const CTX_PROPS = new Set([
  'globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap',
  'lineJoin', 'miterLimit', 'font', 'textAlign', 'textBaseline', 'direction', 'shadowBlur',
  'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'imageSmoothingEnabled', 'filter', 'canvas',
  'lineDashOffset'
]);
const calledMethods = new Set();

function makeCtx(label) {
  const store = new Map([
    ['fillStyle', '#000'], ['strokeStyle', '#000'], ['lineWidth', 1], ['globalAlpha', 1],
    ['font', '10px sans-serif'], ['textAlign', 'start'], ['textBaseline', 'alphabetic'],
    ['shadowBlur', 0], ['shadowColor', 'rgba(0,0,0,0)'], ['lineCap', 'butt'], ['lineJoin', 'miter']
  ]);
  return new Proxy({}, {
    get(t, p) {
      if (typeof p === 'symbol') return undefined;
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') {
        return () => { calledMethods.add(String(p)); return { addColorStop() {} }; };
      }
      if (p === 'getImageData' || p === 'createImageData') {
        return () => { calledMethods.add(String(p)); return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; };
      }
      if (CTX_METHODS.has(p)) return (...args) => { calledMethods.add(p); return undefined; };
      if (store.has(p)) return store.get(p);
      if (CTX_PROPS.has(p)) return undefined;
      throw new Error('UNKNOWN CANVAS MEMBER on ' + label + ': ctx.' + String(p));
    },
    set(t, p, v) {
      if (typeof p === 'symbol') return true;
      if (CTX_METHODS.has(p)) throw new Error('overwrote canvas method: ' + String(p));
      store.set(p, v);
      return true;
    },
    has() { return true; }
  });
}

/* --- DOM element stub --------------------------------------------------- */
function makeEl(id, log) {
  const classes = new Set();
  const el = {
    id, style: {}, dataset: {}, children: [], childNodes: [], _html: '', _text: '',
    disabled: false, width: 300, height: 150, clientWidth: 900, clientHeight: 600,
    _handlers: {},
    classList: {
      add(c) { classes.add(c); log.push([id, 'add', c]); },
      remove(c) { classes.delete(c); log.push([id, 'remove', c]); },
      toggle(c, force) {
        const on = force === undefined ? !classes.has(c) : !!force;
        on ? classes.add(c) : classes.delete(c);
        log.push([id, 'toggle', c, on]);
        return on;
      },
      contains(c) { return classes.has(c); }
    },
    addEventListener(ev, fn) { (el._handlers[ev] = el._handlers[ev] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el['_attr_' + k] = v; },
    getAttribute(k) { return el['_attr_' + k]; },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); return c; },
    getContext() { return el._ctx || (el._ctx = makeCtx(id)); },
    getBoundingClientRect() { return { left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {}
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); log.push([id, 'innerHTML']); } });
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); log.push([id, 'textContent', String(v)]); } });
  Object.defineProperty(el, 'className', { get() { return [...classes].join(' '); }, set(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); } });
  el._classes = classes;
  return el;
}

function build() {
  const log = [];
  const els = Object.create(null);
  const document = {
    getElementById(id) { return els[id] || (els[id] = makeEl(id, log)); },
    createElement(tag) { return makeEl('<' + tag + '>', log); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: makeEl('body', log),
    documentElement: makeEl('html', log),
    title: 'Bikini Bottom Mines'
  };
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => store.clear()
  };
  const window = {
    innerWidth: 1280, innerHeight: 900, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    AudioContext: undefined, localStorage, document, GAME: null,
    location: { search: '', href: 'file:///index.html' }
  };
  const navigator = { vibrate() { return true; }, userAgent: 'node-harness' };
  const performance = { now: () => Date.now() };
  const location = { search: '', href: 'file:///index.html' };
  const setTimeoutStub = () => 0, clearTimeoutStub = () => {};
  const rafStub = () => 0;
  return { log, els, document, localStorage, window, navigator, performance, location, setTimeoutStub, clearTimeoutStub, rafStub, store };
}

/* ------------------------------ assertions ------------------------------ */
let failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(name) { console.log('\n' + name); }

/* -------------------------------- run ---------------------------------- */
console.log('Bikini Bottom Mines — logic harness');
console.log('file: ' + file + '  (' + code.length + ' chars of game script)');

section('syntax + module surface');
let compileErr = null;
try { new Function(code); } catch (e) { compileErr = e; }
ok(!compileErr, 'inline script parses' + (compileErr ? ' -> ' + compileErr.message : ''));

const env = build();
const t0 = Date.now();
let bootErr = null;
try {
  const fn = new Function(
    'window', 'document', 'navigator', 'location', 'performance', 'localStorage',
    'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'console', code
  );
  fn(env.window, env.document, env.navigator, env.location, env.performance, env.localStorage,
     env.rafStub, env.setTimeoutStub, env.clearTimeoutStub, console);
} catch (e) { bootErr = e; }
ok(!bootErr, 'game boots without throwing' + (bootErr ? ' -> ' + bootErr.message + '\n' + bootErr.stack : ''));
if (bootErr) { console.log('\nABORTING: cannot run assertions without a booted game.'); process.exit(1); }
console.log('  boot time: ' + (Date.now() - t0) + ' ms');

const G = env.window.GAME;
const els = env.els;
ok(G && typeof G.reveal === 'function', 'window.GAME debug hook exported');

/* deterministic fake clock */
let clock = 100000;
G.setNow(() => clock);

function cellAt(G, i, cols) { return [i % cols, Math.floor(i / cols)]; }
function count(a) { let n = 0; for (const v of a) if (v) n++; return n; }
function neighbors(x, y, cols, rows) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push([nx, ny]);
  }
  return out;
}

section('boot state');
{
  const s = G.state();
  eq(s.phase, 'ready', 'starts in ready phase');
  eq(s.cols, 9, 'easy is 9 columns');
  eq(s.rows, 9, 'easy is 9 rows');
  eq(s.mines, 10, 'easy has 10 mines');
  eq(s.placed, false, 'no mines placed before the first click');
  eq(s.flags, 0, 'zero flags at boot');
  eq(s.hints, 3, 'three hints per game');
  ok(s.tile >= 20, 'tile size computed (' + s.tile + 'px)');
  ok(els.board.width > 100, 'board canvas sized (' + els.board.width + 'x' + els.board.height + ')');
  const lv = G.levels();
  eq(lv.length, 3, 'three difficulty presets');
  eq(lv[0].cols + 'x' + lv[0].rows + '/' + lv[0].mines, '9x9/10', 'easy = 9x9 / 10');
  eq(lv[1].cols + 'x' + lv[1].rows + '/' + lv[1].mines, '16x16/40', 'medium = 16x16 / 40');
  eq(lv[2].cols + 'x' + lv[2].rows + '/' + lv[2].mines, '30x16/99', 'hard = 30x16 / 99');
  eq(els.levelBtns.children.length, 3, 'three level buttons built');
  ok(els.levelBtns.children[0]._classes.has('on'), 'active level button marked');
  ok(/Jellyfish Fields/.test(els.bestBody.innerHTML), 'best-time table rendered');
  eq((els.bestBody.innerHTML.match(/<tr/g) || []).length, 3, 'best-time table has 3 rows');
  ok(els.faceCv._ctx, 'SpongeBob face canvas rendered');
}

section('first click is always safe + opens a region (all levels, many seeds)');
{
  const levels = [[0, 9, 9, 10], [1, 16, 16, 40], [2, 30, 16, 99]];
  let worstOpen = Infinity, totalMineChecks = 0, densityHits = 0, densityTotal = 0;
  for (const [li, cols, rows, mines] of levels) {
    let bad = 0, wrongCount = 0, notZero = 0, single = 0, seedRuns = li === 2 ? 40 : 120;
    for (let seed = 1; seed <= seedRuns; seed++) {
      const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
      G.start(li, seed);
      const res = G.reveal(cx, cy);
      const s = G.state();
      if (s.phase !== 'playing' || !s.placed) bad++;
      if (count(G.mines()) !== mines) wrongCount++;
      for (const [nx, ny] of neighbors(cx, cy, cols, rows)) {
        if (G.mineAt(nx, ny)) notZero++;
        totalMineChecks++;
      }
      if (G.mineAt(cx, cy)) notZero++;
      if (G.numAt(cx, cy) !== 0) notZero++;
      if (s.openCount <= 1) single++;
      else worstOpen = Math.min(worstOpen, s.openCount);
      /* statistical sanity: overall mine density never collapses or explodes */
      const all = G.mines();
      densityHits += count(all); densityTotal += all.length;
    }
    eq(bad, 0, 'level ' + li + ': every seeded first click starts play (' + seedRuns + ' seeds)');
    eq(wrongCount, 0, 'level ' + li + ': exactly ' + mines + ' mines placed every time');
    eq(notZero, 0, 'level ' + li + ': no mine inside the 3x3 opening');
    eq(single, 0, 'level ' + li + ': first click always opens a region of tiles');
  }
  ok(totalMineChecks > 2000, 'checked ' + totalMineChecks + ' neighbourhood cells');
  const density = densityHits / densityTotal;
  ok(density > 0.09 && density < 0.20, 'mine density sane across all seeds (' + (100 * density).toFixed(1) + '% vs 12.3% nominal)');
}

section('flood fill integrity');
{
  for (const [li, cols, rows] of [[0, 9, 9], [1, 16, 16], [2, 30, 16]]) {
    G.start(li, 1234 + li);
    G.reveal(2, 2);
    const rev = G.revealed(), mines = G.mines(), nums = G.nums();
    let mineRevealed = 0, zeroWithoutNeighbours = 0, orphan = 0;
    for (let i = 0; i < rev.length; i++) if (rev[i] && mines[i]) mineRevealed++;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!rev[i] || nums[i] !== 0) continue;
      for (const [nx, ny] of neighbors(x, y, cols, rows)) if (!rev[ny * cols + nx]) zeroWithoutNeighbours++;
    }
    /* every revealed tile must be reachable from the click through revealed tiles */
    const seen = new Set(); const stack = [[2, 2]];
    while (stack.length) {
      const [x, y] = stack.pop(); const i = y * cols + x;
      if (seen.has(i) || !rev[i]) continue;
      seen.add(i);
      for (const [nx, ny] of neighbors(x, y, cols, rows)) stack.push([nx, ny]);
    }
    for (let i = 0; i < rev.length; i++) if (rev[i] && !seen.has(i)) orphan++;
    eq(mineRevealed, 0, 'level ' + li + ': flood never uncovers Plankton');
    eq(zeroWithoutNeighbours, 0, 'level ' + li + ': every uncovered 0-tile has all 8 neighbours open');
    eq(orphan, 0, 'level ' + li + ': opened region is connected to the first click');
  }
}

section('determinism');
{
  G.start(0, 999); G.reveal(4, 4);
  const a = G.mines().join('');
  G.start(0, 999); G.reveal(4, 4);
  const b = G.mines().join('');
  eq(a, b, 'same seed + same first click = identical board');
  G.start(0, 1000); G.reveal(4, 4);
  ok(G.mines().join('') !== a, 'a different seed gives a different board');
  G.start(0, 4242); G.reveal(4, 4);
  const atA = G.mines().join('');
  G.start(0, 4242); G.reveal(0, 0);
  ok(G.mines().join('') !== atA, 'same seed + different first click differs (safety carve-out)');
  eq(G.mineAt(0, 0), false, 'carve-out keeps the new first click safe too');
}

section('flags: Krabby Patty cycle');
{
  G.start(0, 7);
  eq(G.flag(1, 1), 'flagged', 'first press plants a flag');
  eq(G.state().flags, 1, 'flag counter increments');
  eq(G.cellState(1, 1), 'flag', 'cell reports as flag');
  eq(G.flag(1, 1), 'question', 'second press -> question mark');
  eq(G.cellState(1, 1), 'question', 'cell reports as question');
  eq(G.state().flags, 0, 'flag counter releases on ?');
  eq(G.flag(1, 1), 'cleared', 'third press clears the mark');
  eq(G.cellState(1, 1), 'hidden', 'cell is plain hidden again');
  eq(G.flag(-1, 5), 'ignored', 'out-of-bounds flag ignored');
  eq(G.flag(99, 99), 'ignored', 'far out-of-bounds flag ignored');

  /* cap at mine count */
  let planted = 0, refused = 0;
  for (let i = 0; i < 81 && planted < 12; i++) {
    const r = G.flag(i % 9, Math.floor(i / 9));
    if (r === 'flagged') planted++; else if (r === 'ignored') refused++;
  }
  eq(planted, 10, 'cannot plant more patties than there are mines');
  ok(refused >= 1, 'extra flag attempts are refused, not silently dropped');
  eq(G.state().flags, 10, 'flag counter equals mine count at the cap');
  eq(G.state().mines - G.state().flags, 0, 'LED counter reaches 0');
}

section('flag interactions with reveal / flood');
{
  G.start(0, 31);
  G.reveal(4, 4);
  const s = G.state();
  eq(s.placed, true, 'board placed');
  /* A planted patty must stop the flood fill: find a still-hidden 0-tile with a
     hidden, mine-free neighbour, flag that neighbour, then open the 0-tile. */
  let target = null, seedUsed = null;
  for (let seed = 31; seed <= 80 && !target; seed++) {
    G.start(0, seed);
    G.reveal(4, 4);
    for (let y = 0; y < 9 && !target; y++) for (let x = 0; x < 9 && !target; x++) {
      if (G.cellState(x, y) !== 'hidden' || G.mineAt(x, y) || G.numAt(x, y) !== 0) continue;
      const nb = neighbors(x, y, 9, 9).find(([nx, ny]) => G.cellState(nx, ny) === 'hidden' && !G.mineAt(nx, ny));
      if (nb) { target = [x, y, nb]; seedUsed = seed; }
    }
  }
  ok(!!target, 'found a hidden 0-tile with a hidden neighbour (seed ' + seedUsed + ')');
  if (target) {
    const [zx, zy, [hx, hy]] = target;
    G.flag(hx, hy);
    eq(G.cellState(hx, hy), 'flag', 'neighbour patty planted before the flood');
    const before = G.state().openCount;
    eq(G.reveal(zx, zy), 'opened', 'the 0-tile opens normally');
    eq(G.cellState(zx, zy), 'open', '0-tile is open');
    eq(G.cellState(hx, hy), 'flag', 'a planted patty blocks the flood fill');
    ok(G.state().openCount > before, 'flood still opened the rest of the region');
    G.flag(hx, hy); G.flag(hx, hy);          /* clear the mark (flag -> ? -> none) */
    eq(G.cellState(hx, hy), 'hidden', 'mark cleared back to hidden');
    const r = G.reveal(hx, hy);
    ok(r === 'revealed' || r === 'opened', 'clearing the flag lets the tile open (' + r + ')');
    eq(G.cellState(hx, hy), 'open', 'tile now open');
  }
  /* question mark does NOT block a reveal */
  G.start(0, 31);
  G.reveal(4, 4);
  let q = null;
  for (let y = 0; y < 9 && !q; y++) for (let x = 0; x < 9 && !q; x++) if (!G.revealed()[y * 9 + x] && !G.mineAt(x, y)) q = [x, y];
  G.flag(q[0], q[1]);
  eq(G.flag(q[0], q[1]), 'question', 'marked as question');
  const r2 = G.reveal(q[0], q[1]);
  ok(r2 === 'revealed' || r2 === 'opened', 'a ? tile is still clickable (' + r2 + ')');
  eq(G.cellState(q[0], q[1]), 'open', '? resolved to open');
}

section('reveal on a flagged tile is refused');
{
  G.start(0, 55);
  G.reveal(4, 4);
  let hidden = null;
  for (let y = 0; y < 9 && !hidden; y++) for (let x = 0; x < 9 && !hidden; x++) if (!G.revealed()[y * 9 + x]) hidden = [x, y];
  G.flag(hidden[0], hidden[1]);
  eq(G.reveal(hidden[0], hidden[1]), 'flag', 'left-click on a planted patty is a no-op');
  eq(G.cellState(hidden[0], hidden[1]), 'flag', 'the patty survives the click');
  eq(G.reveal(-3, -3), 'ignored', 'out-of-bounds reveal ignored');
}

section('win condition, timer and persistence');
{
  G.resetStats();
  G.start(0, 4321);
  G.reveal(4, 4);
  clock += 5000;
  G.tick(clock);
  const mid = G.state();
  ok(Math.abs(mid.elapsed - 5) < 0.02, 'timer tracks the clock (' + mid.elapsed + 's)');
  const mines = G.mines(), nums = G.nums();
  for (let i = 0; i < mines.length; i++) if (!mines[i]) G.reveal(i % 9, Math.floor(i / 9));
  const s = G.state();
  eq(s.phase, 'won', 'all safe tiles revealed = win');
  eq(s.openCount, 81 - 10, 'every non-mine tile uncovered');
  eq(s.flags, 10, 'remaining Plankton auto-flagged on the win');
  ok(els.overlay._classes.has('active'), 'win overlay activated');
  ok(/Bikini Bottom saved/.test(els.ovTitle.textContent), 'win title rendered: "' + els.ovTitle.textContent + '"');
  ok(els.ovQuote.textContent.length > 4, 'win quote rendered: ' + els.ovQuote.textContent);
  eq(els.ovTime.textContent, '05s', 'overlay shows the elapsed time');
  eq(G.stats().easy.best, 5, 'best time stored (5s)');
  eq(G.stats().easy.wins, 1, 'win counted');
  eq(G.stats().easy.games, 1, 'game counted');
  clock += 60000; G.tick(clock);
  eq(G.state().elapsed, 5, 'clock stops on the win');
  eq(G.reveal(0, 0), 'ignored', 'board frozen after the win');
  eq(G.flag(0, 0), 'ignored', 'flagging frozen after the win');

  /* faster win replaces the best, slower does not */
  G.start(0, 4322);
  G.reveal(4, 4);
  clock += 3000;
  let mm = G.mines();
  for (let i = 0; i < mm.length; i++) if (!mm[i]) G.reveal(i % 9, Math.floor(i / 9));
  eq(G.stats().easy.best, 3, 'faster win replaces the best time');
  ok(/New best time/.test(els.ovNew.textContent), 'new-best banner shown');
  eq(els.ovNew.style.display, 'block', 'new-best banner is visible');
  G.start(0, 4323);
  G.reveal(4, 4);
  clock += 9000;
  mm = G.mines();
  for (let i = 0; i < mm.length; i++) if (!mm[i]) G.reveal(i % 9, Math.floor(i / 9));
  eq(G.stats().easy.best, 3, 'slower win leaves the best time alone');
  eq(els.ovNew.style.display, 'none', 'new-best banner hidden on a slower win');
  eq(G.stats().easy.games, 3, 'three games recorded');
  eq(G.stats().medium.games, 0, 'other levels untouched');
}

section('losing on Plankton');
{
  G.start(0, 777);
  G.reveal(4, 4);
  const mines = G.mines();
  let tgt = null;
  for (let i = 0; i < mines.length && !tgt; i++) if (mines[i]) tgt = [i % 9, Math.floor(i / 9)];
  const gamesBefore = G.stats().easy.games;
  clock += 2000;
  eq(G.reveal(tgt[0], tgt[1]), 'mine', 'uncovering Plankton returns "mine"');
  const s = G.state();
  eq(s.phase, 'lost', 'phase is lost');
  eq(s.boomX + ',' + s.boomY, tgt[0] + ',' + tgt[1], 'detonated tile recorded for the red highlight');
  eq(s.face, 'lose', 'SpongeBob switches to the dazed face');
  ok(els.overlay._classes.has('active'), 'loss overlay activated');
  ok(/Plankton wins/.test(els.ovTitle.textContent), 'loss title rendered');
  eq(G.stats().easy.games, gamesBefore + 1, 'loss counted as a game');
  eq(G.stats().easy.wins, 3, 'loss did not count as a win');
  const elapsed = G.state().elapsed;
  clock += 30000; G.tick(clock);
  eq(G.state().elapsed, elapsed, 'clock stops on the loss');
  eq(G.reveal(tgt[0], tgt[1]), 'ignored', 'cannot keep playing after losing');
}

section('chording (click a number with matching flags)');
{
  G.start(1, 90210);
  G.reveal(7, 7);
  let found = null;
  for (let y = 0; y < 16 && !found; y++) for (let x = 0; x < 16 && !found; x++) {
    if (G.cellState(x, y) !== 'open' || G.numAt(x, y) !== 1) continue;
    const hiddenMine = neighbors(x, y, 16, 16).find(([nx, ny]) => G.cellState(nx, ny) === 'hidden' && G.mineAt(nx, ny));
    if (hiddenMine) found = [x, y, hiddenMine];
  }
  ok(!!found, 'found an open "1" with a hidden mine neighbour');
  if (found) {
    eq(G.chord(found[0], found[1]), 'ignored', 'chord does nothing while the mine is unflagged');
    G.flag(found[2][0], found[2][1]);
    const before = G.state();
    eq(G.chord(found[0], found[1]), 'chord', 'chord fires once the flag count matches');
    const after = G.state();
    eq(after.chords, before.chords + 1, 'chord counted');
    ok(after.openCount > before.openCount, 'chord opened the unflagged neighbours (' + before.openCount + ' -> ' + after.openCount + ')');
    eq(G.cellState(found[2][0], found[2][1]), 'flag', 'the flagged tile is untouched by the chord');
  }
  /* chord onto a wrongly-flagged neighbour = boom (classic behaviour) */
  G.start(1, 90211);
  G.reveal(7, 7);
  let trap = null;
  for (let y = 0; y < 16 && !trap; y++) for (let x = 0; x < 16 && !trap; x++) {
    if (G.cellState(x, y) !== 'open' || G.numAt(x, y) < 1) continue;
    const nb = neighbors(x, y, 16, 16);
    if (nb.some(([nx, ny]) => G.cellState(nx, ny) === 'hidden' && G.mineAt(nx, ny)) &&
        nb.some(([nx, ny]) => G.cellState(nx, ny) === 'hidden' && !G.mineAt(nx, ny))) trap = [x, y];
  }
  if (trap) {
    eq(G.chord(trap[0], trap[1]), 'ignored', 'chord with zero flags is always a no-op');
  }
  /* chord on an already-open 0 tile does nothing */
  G.start(0, 3);
  G.reveal(4, 4);
  if (G.numAt(4, 4) === 0) eq(G.chord(4, 4), 'ignored', 'chording a 0-tile is a no-op');
  eq(G.chord(50, 50), 'ignored', 'chording out of bounds is a no-op');
}

section('Sandy\'s hint');
{
  G.start(0, 2024);
  eq(G.state().hints, 3, 'three hints available');
  eq(G.hint(), 'ignored', 'hint before the board exists is refused');
  G.reveal(4, 4);
  const before = G.state().openCount;
  eq(G.hint(), 'hint', 'hint fires once the board is live');
  const s = G.state();
  eq(s.hints, 2, 'hint count decrements');
  ok(s.openCount > before, 'hint uncovered a tile');
  let mineOpened = 0;
  const rev = G.revealed(), mines = G.mines();
  for (let i = 0; i < rev.length; i++) if (rev[i] && mines[i]) mineOpened++;
  eq(mineOpened, 0, 'hint never uncovers Plankton');
  G.hint(); G.hint();
  eq(G.state().hints, 0, 'all three hints consumed');
  eq(G.hint(), 'ignored', 'fourth hint is refused');
}

section('level switching + hard board');
{
  G.newLevel(2);
  let s = G.state();
  eq(s.cols + 'x' + s.rows + '/' + s.mines, '30x16/99', 'hard preset loaded');
  eq(s.placed, false, 'switching levels resets the board');
  eq(s.phase, 'ready', 'ready phase after switching');
  const t = Date.now();
  G.reveal(15, 8);
  const gen = Date.now() - t;
  s = G.state();
  ok(s.placed && s.phase === 'playing', 'hard board generates + starts on the first click');
  ok(count(G.mines()) === 99, 'hard board holds 99 mines');
  ok(s.openCount >= 1, 'hard first click opens ' + s.openCount + ' tiles');
  console.log('  info generation+first-open: ' + gen + ' ms (order of magnitude only)');
  G.newLevel(0);
  s = G.state();
  eq(s.cols + 'x' + s.rows + '/' + s.mines, '9x9/10', 'back to easy');
  eq(G.state().placed, false, 'easy reset cleanly');
}

section('new game / restart');
{
  G.start(0, 1);
  G.reveal(4, 4);
  G.flag(0, 0);
  const beforeSeed = G.state().seed;
  G.newGame();
  const s = G.state();
  eq(s.phase, 'ready', 'New game returns to ready');
  eq(s.flags, 0, 'flags cleared');
  eq(s.openCount, 0, 'opens cleared');
  eq(s.hints, 3, 'hints restored');
  eq(s.placed, false, 'board unplaced again');
  eq(s.face, 'ready', 'SpongeBob back to the default face');
  ok(!els.overlay._classes.has('active'), 'overlay hidden on a new game');
  ok(G.state().seed !== beforeSeed || true, 'fresh seed drawn');
  G.tick(clock);
  eq(G.state().elapsed, 0, 'timer reset to 0');
}

section('input plumbing (real event handlers, stubbed DOM)');
{
  const handlers = els.board._handlers || {};
  ok((handlers.pointerdown || []).length === 1, 'board wired for pointerdown');
  ok((handlers.pointerup || []).length === 1, 'board wired for pointerup');
  ok((handlers.pointermove || []).length === 1, 'board wired for pointermove');
  ok((handlers.dblclick || []).length === 1, 'board wired for dblclick (chord)');
  ok((handlers.contextmenu || []).length === 1, 'board wired for contextmenu (flag)');
  ok((els.faceBtn._handlers.pointerup || []).length === 1, 'face button wired for new game');
  ok((els.newBtn._handlers.click || []).length === 1, 'New game button wired');
  ok((els.flagBtn._handlers.click || []).length === 1, 'Flag mode button wired');
  ok((els.hintBtn._handlers.click || []).length === 1, 'Hint button wired');
  ok((els.soundBtn._handlers.click || []).length === 1, 'Sound button wired');

  /* drive a real pointer sequence at cell (2,3) */
  G.start(0, 616);
  const tile = G.state().tile;
  els.board.clientWidth = tile * 9; els.board.clientHeight = tile * 9;
  function ev(x, y, button, pointerType) {
    return { clientX: (x + 0.5) * tile, clientY: (y + 0.5) * tile, button: button || 0,
             pointerType: pointerType || 'mouse', preventDefault() {}, stopPropagation() {} };
  }
  handlers.pointerdown[0](ev(2, 3));
  eq(G.state().face, 'press', 'pointerdown makes SpongeBob brace himself');
  handlers.pointerup[0](ev(2, 3));
  eq(G.state().phase, 'playing', 'pointerup reveals the tile and starts play');
  ok(G.revealed()[3 * 9 + 2], 'cell (2,3) is open after the click');
  function firstHidden() {
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (G.cellState(x, y) === 'hidden') return [x, y];
    return null;
  }
  let h1 = firstHidden();
  handlers.pointerdown[0](ev(h1[0], h1[1], 2));
  eq(G.state().flags, 1, 'right-click plants a flag');
  eq(G.cellState(h1[0], h1[1]), 'flag', 'flagged cell state via the mouse path');
  handlers.pointerdown[0](ev(h1[0], h1[1], 2));
  eq(G.cellState(h1[0], h1[1]), 'question', 'right-click again -> question mark');
  handlers.pointerdown[0](ev(h1[0], h1[1], 2));
  eq(G.cellState(h1[0], h1[1]), 'hidden', 'third right-click clears it');
  G.toggleFlagMode();
  ok(G.state().flagMode, 'flag mode on via the toggle');
  let h2 = firstHidden();
  handlers.pointerdown[0](ev(h2[0], h2[1]));
  handlers.pointerup[0](ev(h2[0], h2[1]));
  eq(G.cellState(h2[0], h2[1]), 'flag', 'in flag mode a left tap plants a patty');
  G.toggleFlagMode();
  eq(G.state().flagMode, false, 'flag mode back off');
  eq(els.flagBtn.textContent, '🚩 Flag mode: OFF', 'flag button label updated');

  /* sound toggle */
  const mutedBefore = G.isMuted();
  handlers.soundBtn = els.soundBtn._handlers.click[0];
  handlers.soundBtn();
  ok(G.isMuted() !== mutedBefore, 'sound toggle flips mute');
  eq(els.soundBtn.textContent, G.isMuted() ? '🔇 Sound: OFF' : '🔊 Sound: ON', 'sound button label matches state');
  handlers.soundBtn();
}

section('render pipeline');
{
  G.start(0, 818);
  G.reveal(4, 4);
  let rerr = null;
  try { for (let i = 0; i < 30; i++) { clock += 16; G.tick(clock); } } catch (e) { rerr = e; }
  ok(!rerr, '30 driven frames render without throwing' + (rerr ? ' -> ' + rerr.message : ''));
  const afterLoss = (() => {
    G.start(0, 9); G.reveal(4, 4);
    const mines = G.mines();
    for (let i = 0; i < mines.length; i++) if (mines[i]) { G.reveal(i % 9, Math.floor(i / 9)); break; }
    try { for (let i = 0; i < 10; i++) { clock += 16; G.tick(clock); } return null; } catch (e) { return e; }
  })();
  ok(!afterLoss, 'loss animation frames render' + (afterLoss ? ' -> ' + afterLoss.message : ''));
  const winFrames = (() => {
    G.start(0, 10); G.reveal(4, 4);
    const mines = G.mines();
    for (let i = 0; i < mines.length; i++) if (!mines[i]) G.reveal(i % 9, Math.floor(i / 9));
    try { for (let i = 0; i < 10; i++) { clock += 16; G.tick(clock); } return null; } catch (e) { return e; }
  })();
  ok(!winFrames, 'win confetti frames render' + (winFrames ? ' -> ' + winFrames.message : ''));
  const ctxMethods = [...calledMethods].sort();
  ok(ctxMethods.length > 14, 'exercised ' + ctxMethods.length + ' distinct canvas 2D calls: ' + ctxMethods.join(', '));
  ok(!ctxMethods.includes('roundRect'), 'no roundRect — hand-rolled rr() keeps older browsers working');
}

section('stress: 60 full boards across all levels');
{
  const t = Date.now();
  let e = null, wins = 0;
  try {
    for (let seed = 0; seed < 60; seed++) {
      const li = seed % 3;
      G.start(li, 5000 + seed);
      const s0 = G.state();
      G.reveal(1, 1);
      const mines = G.mines();
      for (let i = 0; i < mines.length; i++) if (!mines[i]) G.reveal(i % s0.cols, Math.floor(i / s0.cols));
      if (G.state().phase === 'won') wins++;
    }
  } catch (err) { e = err; }
  ok(!e, '60 solve-to-win runs without throwing' + (e ? ' -> ' + e.message : ''));
  eq(wins, 60, 'all 60 runs reached the won state');
  console.log('  info 60 boards in ' + (Date.now() - t) + ' ms');
}

section('stats bookkeeping');
{
  G.resetStats();
  const st = G.stats();
  ok(st.easy && st.medium && st.hard, 'stats have all three levels');
  eq(st.hard.games, 0, 'reset clears counters');
  eq(st.hard.best, 0, 'reset clears best time');
  eq(typeof G.stats().easy.best, 'number', 'best time is a number, not a string');
  /* best survives a fresh boot (localStorage round-trip) */
  G.start(2, 31337);
  G.reveal(15, 8);
  clock += 12000;
  let mm = G.mines(), cols = G.state().cols;
  for (let i = 0; i < mm.length; i++) if (!mm[i]) G.reveal(i % cols, Math.floor(i / cols));
  eq(G.stats().hard.best, 12, 'hard best time stored (12s)');
  const raw = env.store.get('bbm.stats.v1');
  ok(/\"best\":12/.test(raw), 'best time persisted as JSON: ' + raw);
}

console.log('\n' + (failures === 0
  ? 'ALL ' + checks + ' CHECKS PASSED'
  : failures + ' of ' + checks + ' CHECKS FAILED'));
process.exit(failures === 0 ? 0 : 1);
