#!/usr/bin/env node
// Smoke-check image paste into the chat composer.
// Static source checks always run. The browser half drives headless Chrome
// at a 390px viewport and pastes a synthetic ClipboardEvent/DataTransfer.

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const ARTIFACT_DIR = process.env.PASTE_ARTIFACT_DIR || '/opt/cursor/artifacts';
const html = fs.readFileSync(HTML_PATH, 'utf8');

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

assert(/<textarea id="cinput"[\s>]/.test(html), 'composer must be a textarea so iOS can paste images');
assert(!/<input\b[^>]*\bid="cinput"/.test(html), 'composer must not be an input');
assert(html.includes('function onComposerPaste'), 'composer paste handler missing');
assert(html.includes('function onDocumentPaste'), 'document paste handler missing');
assert(html.includes("addEventListener('paste', onComposerPaste)"), 'paste listener missing on the composer');
assert(html.includes("addEventListener('paste', onDocumentPaste, true)"), 'document paste listener missing');
assert(html.includes('clipboardData.items'), 'paste path must read clipboardData.items');
assert(html.includes('clipboardData.files'), 'paste path must read clipboardData.files');
assert(html.includes('function addPendingUploads'), 'shared upload pipeline missing');
assert(html.includes('addPendingUploads(selected)'), 'file picker must use the shared pipeline');
assert(html.includes('addPendingUploads(images)'), 'paste must use the shared pipeline');
assert(html.includes('addPendingUploads(files)'), 'clipboard.read must use the shared pipeline');
assert(html.includes('id="attach-paste"') && html.includes('>Paste image<'), 'Paste image action missing');
assert(html.includes('clip.read'), 'Paste image must call navigator.clipboard.read');
assert(html.includes('The browser blocked clipboard access.'), 'clipboard block fallback missing');
assert(html.includes('Long-press the message box and choose Paste'), 'iOS paste fallback missing');
assert(html.includes('id="sel-ask"') && html.includes('Ask about this'), 'selection ask action missing');
assert(html.includes('id="text-size-btn"'), 'text size control missing');
assert(html.includes('Add to My Stack?'), 'stack suggestion card missing');
assert(html.includes('function trackClick'), 'click tracking missing');
assert(html.includes('bit.ly/RXpeptides'), 'pharmacy link missing');
assert(html.includes('bit.ly/sterile503aPpharmacyNY'), 'New York pharmacy link missing');
assert(html.includes('bit.ly/AlturaUSASups'), 'Altura link missing');
assert(html.includes("e.key === 'Enter' && !e.shiftKey"), 'Enter-to-send handler missing');
assert(html.includes("accept=\".pdf,image/*\" multiple"), 'multi-image file input missing');

const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(function(match) {
  return match[1];
});
assert(scripts.length >= 2, 'expected inline scripts');
scripts.forEach(function(code, index) {
  try {
    new vm.Script(code, { filename: 'inline-' + index + '.js' });
  } catch (err) {
    fail('inline script ' + index + ' did not parse: ' + err.message);
  }
});

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript';
  if (ext === '.png') return 'image/png';
  if (ext === '.webmanifest') return 'application/manifest+json';
  return 'application/octet-stream';
}

function startServer() {
  const publicDir = path.join(ROOT, 'public');
  const server = http.createServer(function(req, res) {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const full = path.normalize(path.join(publicDir, rel));
    if (!full.startsWith(publicDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(full, function(err, data) {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType(full) });
      res.end(data);
    });
  });
  return new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', function() {
      resolve({ server: server, port: server.address().port });
    });
  });
}

function connectCdp(wsUrl) {
  return new Promise(function(resolve, reject) {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const listeners = [];
    const api = {
      send: function(method, params, sessionId) {
        const id = ++nextId;
        return new Promise(function(res, rej) {
          pending.set(id, { res: res, rej: rej });
          const payload = { id: id, method: method, params: params || {} };
          if (sessionId) payload.sessionId = sessionId;
          ws.send(JSON.stringify(payload));
        });
      },
      on: function(fn) { listeners.push(fn); },
      close: function() { try { ws.close(); } catch (e) {} }
    };
    ws.addEventListener('open', function() { resolve(api); });
    ws.addEventListener('error', function() { reject(new Error('CDP websocket failed')); });
    ws.addEventListener('message', function(ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) waiter.rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else waiter.res(msg.result || {});
        return;
      }
      listeners.forEach(function(fn) {
        try { fn(msg); } catch (e) {}
      });
    });
  });
}

function waitFor(cdp, method, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const timer = setTimeout(function() { reject(new Error('timed out waiting for ' + method)); }, timeoutMs || 15000);
    cdp.on(function(msg) {
      if (msg.method !== method) return;
      clearTimeout(timer);
      resolve(msg.params || {});
    });
  });
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('GET ' + url + ' -> ' + res.status);
  return res.json();
}

async function waitForJson(url) {
  let last = '';
  for (let i = 0; i < 50; i++) {
    try {
      return await getJson(url);
    } catch (err) {
      last = err.message;
      await new Promise(function(resolve) { setTimeout(resolve, 200); });
    }
  }
  throw new Error('debugger never came up: ' + last);
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome'
  ].filter(Boolean);
  return candidates.find(function(candidate) { return fs.existsSync(candidate); }) || '';
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const text = (details.exception && details.exception.description) || details.text || JSON.stringify(details);
    fail('page error: ' + text);
  }
  return result.result && result.result.value;
}

const PAGE_HELPERS = `
window.__dispatchPaste = function(target, files, text, html) {
  var dt = new DataTransfer();
  (files || []).forEach(function(file) { dt.items.add(file); });
  if (text != null) dt.setData('text/plain', text);
  if (html != null) dt.setData('text/html', html);
  var event;
  try {
    event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  } catch (err) {
    event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
  }
  var usable = false;
  try {
    usable = !!(event.clipboardData && (event.clipboardData.files.length || event.clipboardData.items.length || (text != null && event.clipboardData.getData('text/plain') === text)));
  } catch (err) { usable = false; }
  if (!usable) {
    Object.defineProperty(event, 'clipboardData', { configurable: true, value: dt });
  }
  target.dispatchEvent(event);
  return {
    defaultPrevented: event.defaultPrevented,
    itemCount: event.clipboardData && event.clipboardData.items ? event.clipboardData.items.length : -1,
    fileCount: event.clipboardData && event.clipboardData.files ? event.clipboardData.files.length : -1
  };
};
window.__pngFile = function(name, color) {
  var canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 120;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 120, 120);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(18, 18, 84, 84);
  ctx.fillStyle = color;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('LAB', 32, 70);
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      resolve(new File([blob], name, { type: 'image/png' }));
    }, 'image/png');
  });
};
window.__chipCount = function() {
  return document.querySelectorAll('#file-chips .file-chip').length;
};
window.__waitImages = function() {
  var images = Array.prototype.slice.call(document.querySelectorAll('#file-chips img'));
  return Promise.all(images.map(function(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(function(resolve) {
      img.onload = function() { resolve(); };
      img.onerror = function() { resolve(); };
    });
  }));
};
`;

async function main() {
  const started = await startServer();
  const bin = chromePath();
  if (!bin) fail('google-chrome is not installed');
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const userData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'composer-paste-'));
  const debugPort = 9333 + Math.floor(Math.random() * 1000);
  let chromeLog = '';
  const chrome = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + userData,
    '--allow-insecure-localhost',
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stdout.on('data', function(chunk) { chromeLog += chunk.toString(); });
  chrome.stderr.on('data', function(chunk) { chromeLog += chunk.toString(); });
  let cdp;
  try {
    const version = await waitForJson('http://127.0.0.1:' + debugPort + '/json/version');
    const browser = await connectCdp(version.webSocketDebuggerUrl);
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = await getJson('http://127.0.0.1:' + debugPort + '/json/list');
    const page = targets.find(function(target) { return target.id === created.targetId; }) || targets.find(function(target) { return target.type === 'page'; });
    if (!page || !page.webSocketDebuggerUrl) fail('no page target. chrome: ' + chromeLog.slice(-500));
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    cdp.on(function(msg) {
      if (msg.method !== 'Fetch.requestPaused') return;
      const body = Buffer.from('/* firebase stub for paste smoke */').toString('base64');
      cdp.send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
        body: body
      }).catch(function() {});
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*firebasejs*', requestStage: 'Request' }, { urlPattern: '*gstatic.com*', requestStage: 'Request' }] });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "try{localStorage.setItem('peptideUserProfile', JSON.stringify({name:'Alex',age:'34',state:'Florida',goal:'Longevity',conditions:'None noted',experience:'No prior peptide experience'})); localStorage.setItem('peptideTheme','light'); localStorage.removeItem('peptideUserEmail'); localStorage.removeItem('peptideChatHistory');}catch(e){}"
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    const loaded = waitFor(cdp, 'Page.loadEventFired', 20000);
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + started.port + '/' });
    await loaded;
    await evaluate(cdp, "new Promise(function(resolve){ if (document.getElementById('cinput') && typeof onComposerPaste === 'function') resolve(true); else document.addEventListener('DOMContentLoaded', function(){ resolve(true); }); })");
    const ready = await evaluate(cdp, "({ tag: document.getElementById('cinput') && document.getElementById('cinput').tagName, width: window.innerWidth, paste: typeof onComposerPaste, intake: getComputedStyle(document.getElementById('intake-overlay')).display })");
    assert(ready && ready.tag === 'TEXTAREA', 'composer tag was ' + (ready && ready.tag));
    assert(ready.width === 390, 'viewport width was ' + (ready && ready.width));
    assert(ready.paste === 'function', 'onComposerPaste was not installed');
    assert(ready.intake === 'none', 'intake overlay still visible');

    await evaluate(cdp, PAGE_HELPERS);

    const single = await evaluate(cdp, `(async function() {
      clearPendingFiles();
      var input = document.getElementById('cinput');
      input.value = 'keep me';
      input.focus();
      var file = await window.__pngFile('labs.png', '#1a6b3c');
      var result = window.__dispatchPaste(input, [file]);
      await window.__waitImages();
      var img = document.querySelector('#file-chips img');
      return {
        value: input.value,
        chips: window.__chipCount(),
        name: document.querySelector('.file-chip-name') && document.querySelector('.file-chip-name').textContent,
        preview: !!(img && img.naturalWidth > 0 && img.src.indexOf('blob:') === 0),
        note: document.getElementById('upload-status').textContent,
        prevented: result.defaultPrevented,
        items: result.itemCount,
        files: result.fileCount,
        dump: input.value.indexOf('data:image') !== -1 || input.value.indexOf('<img') !== -1
      };
    })()`);
    assert(single.items > 0 && single.files > 0, 'synthetic clipboard did not expose items and files: ' + JSON.stringify(single));
    assert(single.prevented === true, 'image paste was not cancelled');
    assert(single.chips === 1, 'expected 1 preview chip, got ' + single.chips);
    assert(single.value === 'keep me', 'image paste changed the text: ' + JSON.stringify(single.value));
    assert(single.dump === false, 'image payload landed in the composer');
    assert(single.preview === true, 'preview image did not render');
    assert(single.name === 'labs.png', 'chip name was ' + single.name);
    assert(/1 file ready/.test(single.note), 'ready note was ' + single.note);

    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const shot1Path = path.join(ARTIFACT_DIR, 'composer_pasted_image_390.png');
    fs.writeFileSync(shot1Path, Buffer.from(shot1.data, 'base64'));

    const mixed = await evaluate(cdp, `(async function() {
      clearPendingFiles();
      var input = document.getElementById('cinput');
      input.value = 'Hello world';
      input.focus();
      input.setSelectionRange(6, 11);
      var first = await window.__pngFile('cbc.png', '#1a6b3c');
      var second = await window.__pngFile('cmp.png', '#9b1c1c');
      var result = window.__dispatchPaste(input, [first, second], 'labs');
      await window.__waitImages();
      var names = Array.prototype.map.call(document.querySelectorAll('.file-chip-name'), function(node) { return node.textContent; });
      var previews = Array.prototype.filter.call(document.querySelectorAll('#file-chips img'), function(img) { return img.naturalWidth > 0; }).length;
      document.body.dataset.pasteShot = 'mixed';
      return {
        value: input.value,
        chips: window.__chipCount(),
        names: names,
        previews: previews,
        prevented: result.defaultPrevented,
        dump: input.value.indexOf('<img') !== -1 || input.value.indexOf('data:image') !== -1
      };
    })()`);
    assert(mixed.prevented === true, 'mixed paste was not cancelled');
    assert(mixed.value === 'Hello labs', 'mixed paste text was ' + JSON.stringify(mixed.value));
    assert(mixed.chips === 2, 'expected 2 chips, got ' + mixed.chips + ' ' + JSON.stringify(mixed.names));
    assert(mixed.previews === 2, 'expected 2 previews, got ' + mixed.previews);
    assert(mixed.dump === false, 'mixed paste put image markup in the composer');
    assert(mixed.names.indexOf('cbc.png') !== -1 && mixed.names.indexOf('cmp.png') !== -1, 'chip names ' + JSON.stringify(mixed.names));

    const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const shot2Path = path.join(ARTIFACT_DIR, 'composer_pasted_images_with_text_390.png');
    fs.writeFileSync(shot2Path, Buffer.from(shot2.data, 'base64'));

    const rest = await evaluate(cdp, `(async function() {
      var errors = [];
      function check(cond, message) { if (!cond) errors.push(message); }
      clearPendingFiles();
      var input = document.getElementById('cinput');
      input.value = 'Hello ';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      var textPaste = window.__dispatchPaste(input, [], 'world');
      check(textPaste.defaultPrevented === false, 'plain text paste was cancelled');
      check(window.__chipCount() === 0, 'plain text paste added a chip');
      check(input.value === 'Hello ', 'plain text paste rewrote the composer');

      var file = await window.__pngFile('image.png', '#1d4ed8');
      input.value = '';
      var htmlPaste = window.__dispatchPaste(input, [file], 'image.png', '<meta charset="utf-8"><img src="blob:http://localhost/pic" alt="image.png">');
      check(input.value === '', 'image-only html paste inserted text: ' + JSON.stringify(input.value));
      check(window.__chipCount() === 1, 'image-only html paste chip count ' + window.__chipCount());

      clearPendingFiles();
      input.value = '';
      input.focus();
      window.__dispatchPaste(input, [file], 'Hemoglobin looks high', '<p>Hemoglobin looks high</p><img src="blob:http://localhost/pic" alt="labs">');
      check(input.value === 'Hemoglobin looks high', 'caption paste text was ' + JSON.stringify(input.value));
      check(window.__chipCount() === 1, 'caption paste did not keep the image');

      clearPendingFiles();
      input.value = '';
      var other = document.createElement('input');
      other.type = 'text';
      other.id = 'paste-other';
      other.style.position = 'fixed';
      other.style.top = '0';
      document.body.appendChild(other);
      other.focus();
      check(document.activeElement === other, 'could not move focus off the composer');
      window.__dispatchPaste(document, [file]);
      check(window.__chipCount() === 0, 'paste while another field was focused added a chip');
      other.remove();

      clearPendingFiles();
      input.focus();
      check(document.activeElement === input, 'composer did not take focus');
      window.__dispatchPaste(document, [file]);
      check(window.__chipCount() === 1, 'document paste while the composer was focused did not add a chip');
      clearPendingFiles();
      input.focus();
      window.__dispatchPaste(input, [file]);
      check(window.__chipCount() === 1, 'composer and document listeners double-added a pasted image');

      var remove = document.querySelector('.file-chip-remove');
      check(!!remove, 'remove button missing');
      if (remove) remove.click();
      check(window.__chipCount() === 0, 'remove did not clear the chip');

      var picker = document.getElementById('file-upload');
      var opened = false;
      picker.click = function() { opened = true; };
      document.getElementById('upload-btn').click();
      var menu = document.getElementById('attach-menu');
      check(menu && menu.hidden === false, 'attach menu did not open');
      check(document.getElementById('attach-paste').textContent === 'Paste image', 'Paste image label missing');
      document.getElementById('attach-choose').click();
      check(opened === true, 'Photos or PDF did not open the file picker');
      check(picker.multiple === true, 'file picker is not multiple');
      check(picker.accept.indexOf('image/*') !== -1, 'file picker accept changed');

      clearPendingFiles();
      document.getElementById('upload-btn').click();
      document.getElementById('attach-paste').click();
      await new Promise(function(resolve) { setTimeout(resolve, 300); });
      var status = document.getElementById('upload-status').textContent || '';
      check(/clipboard|Long-press the message box and choose Paste/.test(status), 'paste button fallback was: ' + status);
      check(window.__chipCount() === 0 || /file ready/.test(status), 'paste button left the composer in a bad state: ' + status);

      document.getElementById('text-size-btn').click();
      var pop = document.getElementById('text-size-popover');
      check(pop && pop.hidden === false, 'text size popover did not open');
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      check(pop.hidden === true, 'text size popover stayed open');

      switchTab('stack');
      var stack = document.getElementById('panel-stack');
      check(stack.classList.contains('active'), 'stack tab did not activate');
      check(stack.textContent.indexOf('My Stack') !== -1, 'My Stack heading missing');
      check(typeof addSelectedFromCard === 'function', 'stack card handler missing');
      switchTab('chat');
      check(document.getElementById('panel-chat').classList.contains('active'), 'chat tab did not return');

      clearPendingFiles();
      input.value = '';
      input.focus();
      var shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(shift);
      check(shift.defaultPrevented === false, 'Shift+Enter was cancelled');
      var send = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(send);
      check(send.defaultPrevented === true, 'Enter no longer sends');
      check(document.getElementById('sel-ask') && document.getElementById('sel-copy'), 'selection actions missing');
      return errors;
    })()`);
    assert(Array.isArray(rest) && rest.length === 0, (rest || []).join(' | ') || 'browser checks returned nothing');

    const stat1 = fs.statSync(shot1Path);
    const stat2 = fs.statSync(shot2Path);
    assert(stat1.size > 1000, 'first screenshot was empty');
    assert(stat2.size > 1000, 'second screenshot was empty');
    console.log('ok composer paste');
    console.log(shot1Path);
    console.log(shot2Path);
  } catch (err) {
    if (chromeLog) console.error(chromeLog.slice(-2000));
    fail(err && err.stack ? err.stack : String(err));
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGKILL');
    started.server.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(function(err) {
  fail(err && err.stack ? err.stack : String(err));
});
