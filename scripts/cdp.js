/* Minimal Chrome DevTools Protocol driver — no npm dependencies (Node >= 22,
   uses the built-in global fetch + WebSocket).

   Why this exists: `chrome --headless --window-size=390,844` does NOT give a
   390px layout viewport on Windows — the platform enforces a ~500px minimum
   window width, so a "phone" test silently measures a tablet and the
   screenshot comes back as a crop. Real device emulation needs
   Emulation.setDeviceMetricsOverride over CDP.

   CLI:
     node scripts/cdp.js shot <url> <out.png> [w] [h] [dpr] [mobile] [full]
     node scripts/cdp.js eval <url> <js-expression> [w] [h] [dpr] [mobile]
     node scripts/cdp.js sizes                 # chrome path + defaults
   Module: require('./cdp').withPage(opts, fn) */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  throw new Error('no Chrome/Edge binary found (set CHROME_PATH)');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Launch headless Chrome, return {port, proc, dir}. */
async function launch(chrome, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank', ...extraArgs];
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  const portFile = path.join(dir, 'DevToolsActivePort');
  let port = null;
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, 'utf8').split('\n');
      if (txt[0] && +txt[0] > 0) { port = +txt[0]; break; }
    }
    await sleep(100);
  }
  if (!port) { try { proc.kill(); } catch (e) {} throw new Error('Chrome did not expose a debugging port'); }
  return { port, proc, dir };
}

/* Open a CDP session on a fresh tab. */
async function connect(port) {
  const ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', ev => {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message + ' (' + JSON.stringify(msg.error.data || '') + ')')) : res(msg.result);
    } else if (msg.method) {
      listeners.forEach(fn => fn(msg));
    }
  });
  function send(method, params = {}, sessionId) {
    const id = nextId++;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 30000);
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { ws, send, sessionId, close: () => { try { ws.close(); } catch (e) {} } };
}

/* Drive one page: emulate a device, navigate, run fn(api).
   Chrome's first launch can be slow (AV scanning, cold start) and occasionally
   never writes DevToolsActivePort — retry the whole launch rather than failing
   the gate on a flake. */
async function withPage(opts, fn) {
  const {
    url, width = 390, height = 844, dpr = 3, mobile = true,
    waitMs = 900, chrome = findChrome(), attempts = 3
  } = opts;
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let proc = null, dir = null, cdp = null;
    try {
      const launched = await launch(chrome);
      proc = launched.proc; dir = launched.dir;
      cdp = await connect(launched.port);
      const { send, sessionId } = cdp;
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: dpr, mobile }, sessionId);
      if (mobile) {
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
        await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }, sessionId);
      }
      await send('Page.navigate', { url }, sessionId);
      await sleep(waitMs);
      return await fn({
        send: (m, p) => send(m, p, sessionId),
        /* evaluate an expression in the page and return its JSON value */
        evaluate: async (expr) => {
          const r = await send('Runtime.evaluate',
            { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
          if (r.exceptionDetails) throw new Error('page eval threw: ' + (r.exceptionDetails.exception || {}).description);
          return r.result ? r.result.value : undefined;
        },
        /* poll until expr returns a truthy value (for delayed in-page reports) */
        poll: async (expr, timeoutMs = 8000) => {
          const t0 = Date.now();
          for (;;) {
            const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
            const v = r.result ? r.result.value : undefined;
            if (v) return v;
            if (Date.now() - t0 > timeoutMs) return v;
            await sleep(200);
          }
        },
        screenshot: async (file, { fullPage = true } = {}) => {
          const r = await send('Page.captureScreenshot',
            { format: 'png', captureBeyondViewport: fullPage }, sessionId);
          fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
          return file;
        }
      });
    } catch (e) {
      lastErr = e;
      if (attempt === attempts) break;
      await sleep(600 * attempt);
    } finally {
      if (cdp) cdp.close();
      if (proc) { try { proc.kill(); } catch (e) {} }
      await sleep(150);
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
    }
  }
  throw new Error('CDP session failed after ' + attempts + ' attempts: ' + (lastErr && lastErr.message));
}

module.exports = { withPage, findChrome, sleep };

/* --------------------------------- CLI --------------------------------- */
if (require.main === module) {
  (async () => {
    const [cmd, url, arg3, w, h, dpr, mob, full] = process.argv.slice(2);
    const width = +(w || 390), height = +(h || 844), ratio = +(dpr || 3), mobile = mob !== '0';
    if (cmd === 'sizes') {
      console.log('chrome: ' + findChrome());
      console.log('default device: ' + width + 'x' + height + ' @' + ratio + 'x mobile=' + mobile);
      return;
    }
    if (cmd === 'shot') {
      const out = await withPage({ url, width, height, dpr: ratio, mobile, waitMs: 2500 },
        api => api.screenshot(arg3, { fullPage: full !== '0' }));
      console.log('wrote ' + out + ' (' + fs.statSync(out).size + ' bytes)');
      return;
    }
    if (cmd === 'eval') {
      const v = await withPage({ url, width, height, dpr: ratio, mobile, waitMs: 1200 },
        api => api.evaluate(arg3));
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
      return;
    }
    console.error('usage: node scripts/cdp.js shot|eval|sizes ...');
    process.exit(2);
  })().catch(e => { console.error('CDP error: ' + e.message); process.exit(1); });
}
