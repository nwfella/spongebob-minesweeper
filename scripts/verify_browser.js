/* Browser gate for Bikini Bottom Mines — no npm dependencies.

     1. ?selftest=1 — drives a full game in headless Chrome, samples real
                      canvas pixels (board / face / patty / Plankton / LED)
                      and asserts the in-page verdict.
     2. ?audit=1    — real device emulation over CDP (see scripts/cdp.js) at
                      phone / tablet / desktop viewports, asserting that no
                      page chrome overflows and the board sizes sensibly.

   Usage:  node scripts/verify_browser.js [path/to/index.html]
   Env:    CHROME_PATH  override the Chrome/Edge binary
   Exit 0 only when every check passes. */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { withPage, findChrome } = require('./cdp.js');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
if (!fs.existsSync(PAGE)) { console.error('FAIL: page not found: ' + PAGE); process.exit(1); }
const fileUrl = 'file:///' + PAGE.replace(/\\/g, '/');
const CHROME = findChrome();

let failures = 0, checks = 0;
function ok(cond, msg) { checks++; console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; }

function dumpDom(url, { w = 1280, h = 1000, budget = 10000 } = {}) {
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--virtual-time-budget=' + budget,
    '--window-size=' + w + ',' + h, '--dump-dom', url];
  try {
    return execFileSync(CHROME, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return (e.stdout || '') + ''; }
}

console.log('Bikini Bottom Mines — browser gate');
console.log('chrome: ' + CHROME);
console.log('page:   ' + fileUrl);

/* ---------------------------- 1. in-page selftest ------------------------ */
console.log('\nrender + gameplay selftest (?selftest=1, desktop viewport)');
{
  const dom = dumpDom(fileUrl + '?selftest=1');
  const titleM = dom.match(/<title>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1] : '';
  const m = title.match(/^SELFTEST (ALL PASS|(\d+) FAILED) \((\d+)\/(\d+) checks\)/);
  ok(!!m, 'selftest reported a result ("' + title + '")');
  if (m) {
    ok(m[1] === 'ALL PASS', 'selftest verdict: ' + m[1]);
    ok(+m[3] >= 35, 'selftest ran ' + m[3] + ' passing checks (>= 35)');
  }
  const pre = dom.match(/<pre id="st"[^>]*>([\s\S]*?)<\/pre>/);
  const report = pre ? pre[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : '';
  const lines = report.split('\n').filter(Boolean);
  ok(lines.length > 0, 'full report captured in the DOM (' + lines.length + ' lines)');
  const failed = lines.filter(l => l.startsWith('FAIL'));
  ok(failed.length === 0, 'no FAIL lines in the report' + (failed.length ? '\n     ' + failed.join('\n     ') : ''));
  const art = lines.filter(l => l.includes('art:'));
  ok(art.length >= 6, 'art pixel probes ran (' + art.length + ' probes)');
  art.forEach(l => console.log('       ' + l.trim()));
}

/* ------------------------------ 2. layout audit ------------------------- */
/* Real emulation: --window-size cannot go below Windows' ~500px minimum, so a
   "--window-size=390" run silently measures a tablet and returns a crop. */
console.log('\nresponsive layout audit (?audit=1, CDP device emulation)');
const VIEWS = [
  { name: 'phone       390x844 @3x', w: 390, h: 844, dpr: 3, mobile: true, level: 0, minTile: 28, minFill: 0.7 },
  { name: 'small phone 360x740 @3x', w: 360, h: 740, dpr: 3, mobile: true, level: 0, minTile: 26, minFill: 0.7 },
  { name: 'phone hard  390x844 @3x', w: 390, h: 844, dpr: 3, mobile: true, level: 2, minTile: 20, minFill: 0 },
  { name: 'tablet      768x1024 @2x', w: 768, h: 1024, dpr: 2, mobile: true, level: 0, minTile: 40, minFill: 0 },
  { name: 'desktop    1440x900 @1x', w: 1440, h: 900, dpr: 1, mobile: false, level: 0, minTile: 34, minFill: 0 }
];
(async () => {
  for (const v of VIEWS) {
    const audit = await withPage(
      { url: fileUrl + '?audit=1&level=' + v.level, width: v.w, height: v.h, dpr: v.dpr, mobile: v.mobile, chrome: CHROME, waitMs: 1500 },
      api => api.poll('(function(){ var t = document.title; return t.indexOf("AUDIT ") === 0 ? t.slice(6) : ""; })()')
    );
    let a = null;
    try { a = JSON.parse(audit); } catch (e) {}
    ok(!!a, v.name + ': audit report returned');
    if (!a) continue;
    ok(a.vw === v.w && a.vh === v.h, v.name + ': emulated viewport is exactly ' + v.w + 'x' + v.h + ' (got ' + a.vw + 'x' + a.vh + ')');
    ok(a.docW <= a.vw + 1, v.name + ': document does not exceed the viewport (' + a.docW + ' <= ' + a.vw + ')');
    ok((a.overflow || []).length === 0, v.name + ': no page chrome overflows' +
      (a.overflow && a.overflow.length ? ' -> ' + a.overflow.map(o => o.sel + '@' + o.right + 'px').join(', ') : ''));
    ok(a.tile >= v.minTile, v.name + ': tile ' + a.tile + 'px (>= ' + v.minTile + ')');
    ok(a.board.w > 0 && a.board.h > 0, v.name + ': board drawn ' + a.board.w + 'x' + a.board.h);
    ok(a.board.w <= a.wrap.w || a.wrapScroll === 'auto', v.name + ': board ' + (a.board.w <= a.wrap.w
      ? 'fits inside its frame (' + a.board.w + ' <= ' + a.wrap.w + ')'
      : 'scrolls inside its frame (' + a.board.w + ' > ' + a.wrap.w + ', overflow-x:' + a.wrapScroll + ')'));
    if (v.minFill) ok(a.board.w >= v.w * v.minFill, v.name + ': board uses ' +
      Math.round(100 * a.board.w / v.w) + '% of the screen width (>= ' + Math.round(v.minFill * 100) + '%)');
    ok(a.face.h >= 44, v.name + ': face button ' + a.face.h + 'px tall (>= 44px touch target)');
    ok(a.ctl.h >= 34, v.name + ': control buttons ' + a.ctl.h + 'px tall');
    ok(a.overlayBlocksCanvas === false, v.name + ': overlay does not swallow clicks at rest');
    ok(a.canvasPainted === true, v.name + ': canvas painted pixels present');
    console.log('       level ' + v.level + ' -> ' + a.cols + 'x' + a.rows + ' grid, tile ' + a.tile +
      'px, board ' + a.board.w + 'x' + a.board.h + ', frame ' + a.wrap.w + 'px');
  }

  console.log('\n' + (failures === 0
    ? 'ALL ' + checks + ' BROWSER CHECKS PASSED'
    : failures + ' of ' + checks + ' BROWSER CHECKS FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})();
