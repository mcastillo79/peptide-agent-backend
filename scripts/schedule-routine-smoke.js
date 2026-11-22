#!/usr/bin/env node
// Schedule routine layout, inline edit, and "Add all to My Stack".
// Static checks plus a 390px headless Chrome pass. A fake /chat stream
// delivers the sample routine through the real reply path.

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const OUT = process.env.SCHEDULE_ARTIFACT_DIR || '/opt/cursor/artifacts';
const html = fs.readFileSync(HTML_PATH, 'utf8');

const ROUTINE = [
  '**Your Updated Protocol**',
  '**Daily peptides:**',
  '- TA-1: 0.5 mg (0.1 mL) \u2014 7 AM \u2190 NEW, replacing the morning capsule',
  '- BPC-157: 500 mcg',
  '**2\u20133x weekly:**',
  '- TB-500: 2.5 mg',
  '**Acute mast cell support (while healing):**',
  '- Quercetin: 500 mg, 2x daily',
  '**Gut healing (ongoing):**',
  '- L-glutamine: 5\u201310 g daily'
].join('\n');

const POSITIVE = [
  '**Morning**',
  '- BPC-157: 250 mcg \u2014 8:00 AM',
  '- TB-500: 2 mg \u2014 2x weekly',
  '**Bedtime**',
  '- Magnesium glycinate: 400 mg'
].join('\n');

const NOISE = [
  '**Option B: Reduce to maintenance dose**',
  '- Best for: Cost savings, maintenance-phase immune support',
  '**What to Expect (Side Effects)**',
  '- \u2705 Nothing \u2014 silent efficacy',
  '- \u2705 Better sleep \u2014 immune system calming',
  '- \u2705 Reduced anxiety',
  '**Unlikely but possible (usually indicates dose too high or reconstitution issue)**',
  '- Mild local reaction at injection site \u2014 redness, itching',
  '- Mild systemic response \u2014 fatigue, body ache \u2014 reduce to 0.25 mg and then resume if it settles'
].join('\n');

const SIDE_EFFECTS = [
  '**Option B: Reduce to maintenance dose**',
  '- Thymosin Alpha-1: 0.5 mg \u2014 2x weekly',
  NOISE.split('\n').slice(1).join('\n'),
  '**Bedtime**',
  '- Magnesium glycinate: 400 mg'
].join('\n');

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

assert(html.includes('Your example day'), 'schedule title changed');
assert(html.includes('Built from the schedule you entered in My Stack.'), 'schedule subtitle changed');
assert(html.includes('Add items in My Stack to see an example day.'), 'empty state changed');
assert(html.includes('For illustrative purposes only. Not medical advice.'), 'schedule footer changed');
assert(html.includes('Add all to My Stack'), 'routine button label missing');
assert(html.includes('function parseRoutineReply'), 'parser missing');
assert(html.includes('function attachRoutineAdd'), 'routine attach missing');
assert(html.includes('attachRoutineAdd(msgDiv, fullText)'), 'stream path does not attach the routine button');
assert(html.includes('attachRoutineAdd(el, msg.content)'), 'history replay does not attach the routine button');
assert(html.includes('Remove from schedule'), 'remove-from-schedule control missing');
assert(html.includes('data-edit="time"') && html.includes('data-edit="group"'), 'My Stack edit is missing Time or Group');
assert(html.includes('+ Add item'), 'schedule add button missing');
assert(!html.includes('SYSTEM_PROMPT'), 'this change should stay out of the system prompt');

const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(function(match) {
  return match[1];
});
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
    if (urlPath === '/lab-markers.js' || urlPath === '/lab-compare.js' || urlPath === '/routine-stack.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'lib', path.basename(urlPath))));
      return;
    }
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
    fail('page error: ' + text + '\n---\n' + String(expression).slice(0, 240));
  }
  return result.result && result.result.value;
}

async function shot(cdp, file) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  const full = path.join(OUT, file);
  fs.writeFileSync(full, Buffer.from(result.data, 'base64'));
  const buf = fs.readFileSync(full);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert(width === 390 && height === 844, file + ' was ' + width + 'x' + height + ' (expected 390x844)');
  assert(buf.length > 1000, file + ' was empty');
  return full;
}

const SEED = `
localStorage.setItem('peptideUserProfile', JSON.stringify({name:'Alex',age:'34',state:'Florida',goal:'Longevity',conditions:'None noted',experience:'No prior peptide experience'}));
localStorage.setItem('peptideTheme', 'light');
localStorage.removeItem('peptideUserEmail');
localStorage.removeItem('peptideChatHistory');
localStorage.removeItem('peptideTextSize');
localStorage.setItem('peptideUserStack', JSON.stringify([{id:'s-bpc', name:'BPC-157', dose:'250 mcg', schedule:'daily', notes:'keep this note', source:'altura', sourceLabel:'Altura', active:false, status:'stopped', timeOfDay:''}]));
localStorage.setItem('peptideScheduleShow', '1');
localStorage.setItem('peptideScheduleOpen', '0');
`;

async function main() {
  const started = await startServer();
  const bin = chromePath();
  if (!bin) fail('google-chrome is not installed');
  const userData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'schedule-routine-'));
  const debugPort = 9400 + Math.floor(Math.random() * 400);
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
  ], { stdio: 'ignore' });
  let browser;
  let cdp;
  try {
    const version = await waitForJson('http://127.0.0.1:' + debugPort + '/json/version');
    browser = await connectCdp(version.webSocketDebuggerUrl);
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = await getJson('http://127.0.0.1:' + debugPort + '/json/list');
    const page = targets.find(function(target) { return target.id === created.targetId; }) || targets.find(function(target) { return target.type === 'page'; });
    if (!page || !page.webSocketDebuggerUrl) fail('no page target');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    cdp.on(function(msg) {
      if (msg.method !== 'Fetch.requestPaused') return;
      cdp.send('Fetch.fulfillRequest', {
        requestId: msg.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
        body: Buffer.from('/* firebase stub */').toString('base64')
      }).catch(function() {});
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*gstatic.com*', requestStage: 'Request' }, { urlPattern: '*firebasejs*', requestStage: 'Request' }] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{' + SEED + '}catch(e){}' });
    const loaded = new Promise(function(resolve) {
      cdp.on(function(msg) { if (msg.method === 'Page.loadEventFired') resolve(); });
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + started.port + '/' });
    await Promise.race([
      loaded,
      new Promise(function(_, reject) { setTimeout(function() { reject(new Error('page load timed out')); }, 20000); })
    ]);
    await evaluate(cdp, 'new Promise(function(resolve){ if (document.getElementById("cinput") && historyReady) resolve(true); else setTimeout(resolve, 400); })');

    const ready = await evaluate(cdp, `({
      width: window.innerWidth,
      historyReady: historyReady,
      intake: getComputedStyle(document.getElementById('intake-overlay')).display,
      title: document.getElementById('schedule-title') && document.getElementById('schedule-title').textContent,
      foot: document.getElementById('schedule-foot') && document.getElementById('schedule-foot').textContent,
      scheduleBtn: document.getElementById('schedule-btn') && document.getElementById('schedule-btn').textContent
    })`);
    assert(ready.width === 390, 'viewport was ' + ready.width);
    assert(ready.historyReady === true, 'history was not ready');
    assert(ready.intake === 'none', 'intake overlay still open');
    assert(ready.title === 'Your example day', 'title was ' + ready.title);
    assert(ready.foot === 'For illustrative purposes only. Not medical advice.', 'footer was ' + ready.foot);
    assert(ready.scheduleBtn === 'Schedule', 'schedule button was ' + ready.scheduleBtn);

    const parsed = await evaluate(cdp, `(function() {
      var routine = ${JSON.stringify(ROUTINE)};
      var items = parseRoutineReply(routine);
      var tooFew = parseRoutineReply('**Daily:**\\n- A: 1 mg');
      var pair = parseRoutineReply('**Daily:**\\n- A: 1 mg\\n- B: 2 mg');
      var noHeader = parseRoutineReply('- A: 1\\n- B: 2\\n- C: 3');
      var paren = parseRoutineReply('**Evening:**\\n- Magnesium (400 mg)\\n- Vitamin D (5000 IU) \\u2014 8 PM\\n- Zinc (25 mg, daily)');
      var nameless = parseRoutineReply('**Daily:**\\n- : missing\\n- OK: 1 mg\\n- Also (2 mg)\\n- Third: 3 mg');
      var el = addMsg('bot', fmt('**Daily:**\\n- A: 1 mg'), false);
      attachRoutineAdd(el, '**Daily:**\\n- A: 1 mg');
      var shortButton = !!(el.nextElementSibling && el.nextElementSibling.classList.contains('routine-add'));
      if (el.parentNode) el.parentNode.removeChild(el);
      return {
        count: items && items.length,
        items: items,
        tooFew: tooFew,
        pair: pair && pair.map(function(item) { return item.name; }),
        noHeader: noHeader,
        paren: paren,
        nameless: nameless && nameless.map(function(item) { return item.name; }),
        shortButton: shortButton
      };
    })()`);
    assert(parsed.tooFew === null, 'one bullet should not count as a routine');
    assert(parsed.pair && parsed.pair.join('|') === 'A|B', 'two dosed bullets should count ' + JSON.stringify(parsed.pair));
    assert(parsed.noHeader === null, 'bullets without a header should not count');
    assert(parsed.shortButton === false, 'one-line reply rendered an Add all button');
    assert(parsed.count === 5, 'expected 5 routine items, got ' + parsed.count + ' ' + JSON.stringify(parsed.items));
    const byName = {};
    parsed.items.forEach(function(item) { byName[item.name] = item; });
    assert(byName['TA-1'] && byName['TA-1'].dose === '0.5 mg (0.1 mL)' && byName['TA-1'].time === '7 AM' && byName['TA-1'].group === 'Daily peptides' && byName['TA-1'].schedule === 'Daily peptides', 'TA-1 parsed as ' + JSON.stringify(byName['TA-1']));
    assert(byName['BPC-157'].dose === '500 mcg' && byName['BPC-157'].time === '' && byName['BPC-157'].group === 'Daily peptides' && byName['BPC-157'].schedule === 'Daily peptides', 'BPC parsed as ' + JSON.stringify(byName['BPC-157']));
    assert(byName['TB-500'].dose === '2.5 mg' && byName['TB-500'].group === '2\u20133x weekly' && byName['TB-500'].schedule === '2\u20133x weekly', 'TB-500 parsed as ' + JSON.stringify(byName['TB-500']));
    assert(byName['Quercetin'].dose === '500 mg, 2x daily' && byName['Quercetin'].schedule === '2x daily' && byName['Quercetin'].group === 'Acute mast cell support (while healing)', 'Quercetin parsed as ' + JSON.stringify(byName['Quercetin']));
    assert(byName['L-glutamine'].dose === '5\u201310 g daily' && byName['L-glutamine'].schedule === 'daily' && byName['L-glutamine'].time === '', 'glutamine parsed as ' + JSON.stringify(byName['L-glutamine']));
    assert(parsed.paren && parsed.paren.length === 3, 'paren routine failed ' + JSON.stringify(parsed.paren));
    assert(parsed.paren[0].name === 'Magnesium' && parsed.paren[0].dose === '400 mg' && parsed.paren[0].schedule === 'Evening', 'magnesium ' + JSON.stringify(parsed.paren[0]));
    assert(parsed.paren[1].name === 'Vitamin D' && parsed.paren[1].dose === '5000 IU' && parsed.paren[1].time === '8 PM', 'vitamin D ' + JSON.stringify(parsed.paren[1]));
    assert(parsed.paren[2].schedule === 'daily', 'zinc schedule ' + JSON.stringify(parsed.paren[2]));
    assert(parsed.nameless && parsed.nameless.join('|') === 'OK|Also|Third', 'nameless lines were kept ' + JSON.stringify(parsed.nameless));

    const positiveSheet = await evaluate(cdp, `(function() {
      hideSaveModal();
      var text = ${JSON.stringify(POSITIVE)};
      var el = addMsg('bot', fmt(text), false);
      el.id = 'shot-positive';
      attachRoutineAdd(el, text);
      var btn = el.nextElementSibling && el.nextElementSibling.querySelector('button');
      if (!btn) return { ok: false };
      btn.click();
      var names = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .suggest-name'), function(node) { return node.textContent; });
      var metas = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .routine-item-meta'), function(node) { return node.textContent; });
      var groups = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .routine-item-group'), function(node) { return node.textContent; });
      return {
        ok: true,
        hidden: document.getElementById('routine-sheet').hidden,
        names: names,
        metas: metas,
        groups: groups,
        checked: document.querySelectorAll('#routine-sheet input:checked').length
      };
    })()`);
    assert(positiveSheet.ok && positiveSheet.hidden === false, 'positive sheet did not open ' + JSON.stringify(positiveSheet));
    assert(positiveSheet.names.join('|') === 'BPC-157|TB-500|Magnesium glycinate', 'positive names ' + positiveSheet.names.join('|'));
    assert(positiveSheet.metas.join('|') === '250 mcg \u2014 8:00 AM|2 mg \u2014 2x weekly|400 mg', 'positive lines ' + positiveSheet.metas.join('|'));
    assert(positiveSheet.groups.join('|') === 'Morning|Morning|Bedtime', 'positive groups ' + positiveSheet.groups.join('|'));
    assert(positiveSheet.checked === 3, 'positive checked ' + positiveSheet.checked);
    await shot(cdp, 'routine_positive_confirm_390.png');

    const sideSheet = await evaluate(cdp, `(function() {
      closeRoutineSheet(false);
      var previous = document.getElementById('shot-positive');
      if (previous) {
        var extra = previous.nextElementSibling;
        if (extra && extra.classList.contains('routine-add')) extra.parentNode.removeChild(extra);
        previous.parentNode.removeChild(previous);
      }
      var text = ${JSON.stringify(SIDE_EFFECTS)};
      var el = addMsg('bot', fmt(text), false);
      el.id = 'shot-side';
      attachRoutineAdd(el, text);
      var btn = el.nextElementSibling && el.nextElementSibling.querySelector('button');
      if (!btn) return { ok: false, buttons: document.querySelectorAll('.routine-add').length };
      btn.click();
      var names = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .suggest-name'), function(node) { return node.textContent; });
      var body = document.getElementById('routine-sheet-body').textContent;
      var msgs = document.getElementById('msgs');
      var anchor = null;
      el.querySelectorAll('strong').forEach(function(node) {
        if (!anchor && node.textContent.indexOf('What to Expect') !== -1) anchor = node;
      });
      if (anchor) {
        var top = anchor.getBoundingClientRect().top;
        msgs.scrollTop += top - 72;
      }
      return {
        ok: true,
        hidden: document.getElementById('routine-sheet').hidden,
        names: names,
        body: body,
        chat: el.textContent,
        buttons: document.querySelectorAll('.routine-add').length
      };
    })()`);
    assert(sideSheet.ok && sideSheet.hidden === false, 'protocol sheet did not open ' + JSON.stringify(sideSheet));
    assert(sideSheet.names.join('|') === 'Thymosin Alpha-1|Magnesium glycinate', 'protocol sheet names ' + sideSheet.names.join('|'));
    assert(sideSheet.body.indexOf('Best for') === -1 && sideSheet.body.indexOf('Nothing') === -1 && sideSheet.body.indexOf('Mild') === -1, 'sheet kept non-items ' + sideSheet.body);
    assert(sideSheet.chat.indexOf('What to Expect') !== -1 && sideSheet.chat.indexOf('Best for') !== -1 && sideSheet.chat.indexOf('reduce to 0.25 mg') !== -1, 'protocol text missing ' + sideSheet.chat.slice(0, 240));
    await shot(cdp, 'routine_protocol_side_effects_390.png');

    const noiseOnly = await evaluate(cdp, `(function() {
      closeRoutineSheet(false);
      var previous = document.getElementById('shot-side');
      if (previous) {
        var extra = previous.nextElementSibling;
        if (extra && extra.classList.contains('routine-add')) extra.parentNode.removeChild(extra);
        previous.parentNode.removeChild(previous);
      }
      var text = ${JSON.stringify(NOISE)};
      var parsed = parseRoutineReply(text);
      var el = addMsg('bot', fmt(text), false);
      el.id = 'shot-noise';
      attachRoutineAdd(el, text);
      var msgs = document.getElementById('msgs');
      el.scrollIntoView({ block: 'start' });
      msgs.scrollTop = Math.max(0, el.offsetTop - 8);
      return {
        parsed: parsed,
        button: !!(el.nextElementSibling && el.nextElementSibling.classList.contains('routine-add')),
        hasExpect: el.textContent.indexOf('What to Expect') !== -1,
        hasBest: el.textContent.indexOf('Best for') !== -1,
        hasMild: el.textContent.indexOf('Mild local reaction') !== -1
      };
    })()`);
    assert(noiseOnly.parsed === null && noiseOnly.button === false, 'side-effect-only reply showed the button ' + JSON.stringify(noiseOnly));
    assert(noiseOnly.hasExpect && noiseOnly.hasBest && noiseOnly.hasMild, 'side-effect reply did not render ' + JSON.stringify(noiseOnly));
    await shot(cdp, 'routine_side_effects_no_button_390.png');

    await evaluate(cdp, `(function() {
      closeRoutineSheet(false);
      var el = document.getElementById('shot-noise');
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return document.querySelectorAll('.routine-add').length;
    })()`);

    await evaluate(cdp, `window.__routine = ${JSON.stringify(ROUTINE)};
      window.fetch = function(url) {
        var u = String(url || '');
        if (u.indexOf('/chat') !== -1) {
          var payload = 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: window.__routine } }) + '\\n\\ndata: [DONE]\\n\\n';
          var stream = new ReadableStream({ start: function(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } });
          return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
        }
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      emailSaveModalShown = true;
      hideSaveModal();
      document.getElementById('cinput').value = 'Please update my protocol';
      sendMsgFromInput();
      new Promise(function(resolve, reject) {
        var tries = 0;
        var timer = setInterval(function() {
          tries += 1;
          var btn = document.querySelector('.routine-add-btn');
          var user = document.querySelector('#msgs .msg.usr');
          if (btn && user) { clearInterval(timer); resolve(true); }
          else if (tries > 40) { clearInterval(timer); reject(new Error('routine button did not render')); }
        }, 50);
      })`);

    const chat = await evaluate(cdp, `(function() {
      hideSaveModal();
      var btn = document.querySelector('.routine-add-btn');
      var user = document.querySelector('#msgs .msg.usr');
      var bot = btn.closest('.routine-add').previousElementSibling;
      var box = document.getElementById('msgs');
      box.scrollTop = Math.max(0, bot.offsetTop - 8);
      var rect = btn.getBoundingClientRect();
      return {
        label: btn.textContent,
        user: user && user.textContent,
        strongs: bot ? bot.querySelectorAll('strong').length : 0,
        hasTa: bot && bot.textContent.indexOf('TA-1') !== -1,
        h: rect.height,
        composer: document.getElementById('cinput').value
      };
    })()`);
    assert(chat.label === 'Add all to My Stack', 'button label ' + chat.label);
    assert(chat.user && chat.user.indexOf('Please update my protocol') !== -1, 'user message missing ' + chat.user);
    assert(chat.composer === '', 'composer was not cleared');
    assert(chat.strongs >= 4 && chat.hasTa, 'bot reply did not render the routine ' + JSON.stringify(chat));
    assert(chat.h >= 44, 'routine button height ' + chat.h);
    await shot(cdp, 'schedule_routine_chat_add_all_390.png');

    const opened = await evaluate(cdp, `(function() {
      var btn = document.querySelector('.routine-add-btn');
      var info = { found: !!btn, items: btn && btn._items ? btn._items.length : -1, parent: btn && btn.parentNode && btn.parentNode.className };
      btn.click();
      var sheetEl = document.getElementById('routine-sheet');
      info.hidden = sheetEl.hidden;
      info.boxes = document.querySelectorAll('#routine-sheet input').length;
      info.body = document.getElementById('routine-sheet-body').textContent.slice(0, 180);
      return info;
    })()`);
    assert(opened.hidden === false && opened.boxes === 5, 'sheet did not open ' + JSON.stringify(opened));
    const sheet = await evaluate(cdp, `(function() {
      var sheetEl = document.getElementById('routine-sheet');
      var names = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .suggest-name'), function(node) { return node.textContent; });
      var metas = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .routine-item-meta'), function(node) { return node.textContent; });
      var groups = Array.prototype.map.call(document.querySelectorAll('#routine-sheet .routine-item-group'), function(node) { return node.textContent; });
      var boxes = document.querySelectorAll('#routine-sheet input[type="checkbox"]');
      var checked = Array.prototype.filter.call(boxes, function(box) { return box.checked; }).length;
      var confirmBtn = document.getElementById('routine-sheet-confirm').getBoundingClientRect();
      var boxRect = boxes[0].getBoundingClientRect();
      var active = document.activeElement;
      return {
        hidden: sheetEl.hidden,
        names: names,
        metas: metas,
        groups: groups,
        checked: checked,
        confirmH: confirmBtn.height,
        boxH: boxRect.height,
        focus: active && active.type
      };
    })()`);
    assert(sheet.hidden === false, 'confirm sheet did not open');
    assert(sheet.names.join('|') === 'TA-1|BPC-157|TB-500|Quercetin|L-glutamine', 'sheet names ' + sheet.names.join('|'));
    assert(sheet.metas[0] === '0.5 mg (0.1 mL) \u2014 7 AM', 'TA-1 sheet line ' + sheet.metas[0]);
    assert(sheet.metas[1] === '500 mcg', 'BPC sheet line ' + sheet.metas[1]);
    assert(sheet.groups[2] === '2\u20133x weekly', 'TB group ' + sheet.groups[2]);
    assert(sheet.groups[3] === 'Acute mast cell support (while healing)', 'quercetin group ' + sheet.groups[3]);
    assert(sheet.checked === 5, 'expected all boxes checked, got ' + sheet.checked);
    assert(sheet.confirmH >= 44 && sheet.boxH >= 44, 'sheet tap targets ' + sheet.confirmH + ' ' + sheet.boxH);
    assert(sheet.focus === 'checkbox', 'sheet did not focus a checkbox');
    await shot(cdp, 'schedule_routine_confirm_sheet_390.png');

    const saved = await evaluate(cdp, `(function() {
      document.getElementById('routine-sheet-confirm').click();
      var stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      var toast = document.getElementById('copy-toast').textContent;
      var bpc = stack.filter(function(item) { return item.name === 'BPC-157'; })[0];
      document.getElementById('copy-toast').classList.remove('show');
      return { count: stack.length, toast: toast, bpc: bpc, names: stack.map(function(item) { return item.name; }) };
    })()`);
    assert(saved.count === 5, 'stack count ' + saved.count + ' ' + saved.names.join('|'));
    assert(saved.toast === 'Added 4 to My Stack. Updated 1.', 'toast was ' + saved.toast);
    assert(saved.bpc && saved.bpc.dose === '500 mcg' && saved.bpc.status === 'taking' && saved.bpc.notes === 'keep this note' && saved.bpc.source === 'altura' && saved.bpc.group === 'Daily peptides', 'BPC update ' + JSON.stringify(saved.bpc));

    await evaluate(cdp, `hideSaveModal();
      setScheduleOpen(true, 'toggle');
      new Promise(function(resolve) { requestAnimationFrame(function() { requestAnimationFrame(function() { setTimeout(resolve, 80); }); }); })`);
    const light = await evaluate(cdp, `(function() {
      var body = document.getElementById('schedule-body');
      body.scrollTop = 0;
      var headers = Array.prototype.map.call(body.querySelectorAll('h3'), function(node) { return node.textContent; });
      var lines = Array.prototype.map.call(body.querySelectorAll('.schedule-line-text'), function(node) { return node.textContent; });
      var edit = document.querySelector('.schedule-edit').getBoundingClientRect();
      var add = document.getElementById('schedule-add').getBoundingClientRect();
      var firstLine = body.querySelector('.schedule-line').getBoundingClientRect();
      var foot = document.getElementById('schedule-foot').textContent;
      var title = document.getElementById('schedule-title').textContent;
      var sub = document.querySelector('.schedule-sub').textContent;
      return {
        open: document.getElementById('schedule-btn').getAttribute('aria-expanded'),
        stored: localStorage.getItem('peptideScheduleOpen'),
        headers: headers,
        lines: lines,
        editH: edit.height,
        addH: add.height,
        lineTop: Math.round(firstLine.top),
        foot: foot,
        title: title,
        sub: sub,
        dark: document.body.classList.contains('dark')
      };
    })()`);
    assert(light.open === 'true' && light.stored === '1', 'schedule did not stay open');
    assert(light.title === 'Your example day' && light.sub === 'Built from the schedule you entered in My Stack.', 'chrome copy changed');
    assert(light.foot === 'For illustrative purposes only. Not medical advice.', 'footer changed while open');
    assert(light.headers[0] === 'Daily peptides' && light.headers.indexOf('2\u20133x weekly') !== -1 && light.headers.indexOf('Gut healing (ongoing)') !== -1, 'headers ' + light.headers.join(' | '));
    assert(light.lines.some(function(line) { return line.indexOf('TA-1') === 0 && line.indexOf('0.5 mg (0.1 mL)') !== -1 && line.indexOf('7 AM') !== -1; }), 'TA-1 line missing ' + light.lines.join(' || '));
    assert(light.lines.some(function(line) { return line.indexOf('Quercetin') === 0 && line.indexOf('2x daily') !== -1; }), 'quercetin line missing');
    assert(light.editH >= 44 && light.addH >= 44, 'schedule tap targets ' + light.editH + ' ' + light.addH);
    assert(light.lineTop > 80 && light.lineTop < 560, 'first schedule line was off screen at ' + light.lineTop);
    assert(light.dark === false, 'theme was dark before the light shot');
    await shot(cdp, 'schedule_routine_panel_light_390.png');

    await evaluate(cdp, `applyTheme('dark'); document.getElementById('schedule-body').scrollTop = 0;`);
    const darkOn = await evaluate(cdp, 'document.body.classList.contains("dark")');
    assert(darkOn === true, 'dark theme did not apply');
    await shot(cdp, 'schedule_routine_panel_dark_390.png');

    await evaluate(cdp, `hideSaveModal();
      applyTheme('light');
      var buttons = document.querySelectorAll('.schedule-edit');
      var target = null;
      for (var i = 0; i < buttons.length; i++) { if (buttons[i].getAttribute('aria-label') === 'Edit TA-1') target = buttons[i]; }
      target.click();
      var form = document.getElementById('schedule-edit-name');
      var scroller = document.getElementById('schedule-body');
      var block = form.closest('li') || form.closest('form');
      scroller.scrollTop = Math.max(0, block.offsetTop - 4);
      ({
        focus: document.activeElement && document.activeElement.id,
        name: document.getElementById('schedule-edit-name').value,
        dose: document.getElementById('schedule-edit-dose').value,
        time: document.getElementById('schedule-edit-time').value,
        group: document.getElementById('schedule-edit-group').value,
        schedule: document.getElementById('schedule-edit-schedule').value
      })`);
    const editing = await evaluate(cdp, `(function() {
      hideSaveModal();
      var name = document.getElementById('schedule-edit-name');
      var scroller = document.getElementById('schedule-body');
      var block = name.closest('li') || name.closest('form');
      scroller.scrollTop = Math.max(0, block.offsetTop - 4);
      function y(id) { var el = document.getElementById(id); var r = el.getBoundingClientRect(); return Math.round(r.top); }
      return {
        focus: document.activeElement && document.activeElement.id,
        name: name.value,
        dose: document.getElementById('schedule-edit-dose').value,
        time: document.getElementById('schedule-edit-time').value,
        group: document.getElementById('schedule-edit-group').value,
        expanded: document.querySelector('.schedule-edit[aria-expanded="true"]') && document.querySelector('.schedule-edit[aria-expanded="true"]').getAttribute('aria-label'),
        ys: { name: y('schedule-edit-name'), dose: y('schedule-edit-dose'), time: y('schedule-edit-time'), tod: y('schedule-edit-tod'), group: y('schedule-edit-group') }
      };
    })()`);
    assert(editing.focus === 'schedule-edit-name', 'edit form focus was ' + editing.focus);
    assert(editing.name === 'TA-1' && editing.dose === '0.5 mg (0.1 mL)' && editing.time === '7 AM' && editing.group === 'Daily peptides', 'edit form values ' + JSON.stringify(editing));
    assert(editing.expanded === 'Edit TA-1', 'expanded control ' + editing.expanded);
    assert(editing.ys.name > 60 && editing.ys.group < 820 && editing.ys.group > editing.ys.name, 'edit fields were not on screen ' + JSON.stringify(editing.ys));
    await shot(cdp, 'schedule_routine_inline_edit_390.png');

    const edited = await evaluate(cdp, `(function() {
      document.getElementById('schedule-edit-time').value = '7:30 AM';
      document.getElementById('schedule-edit-group').value = 'Daily peptides';
      document.querySelector('.schedule-form').requestSubmit();
      var stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      var ta = stack.filter(function(item) { return item.name === 'TA-1'; })[0];
      var line = '';
      document.querySelectorAll('.schedule-line-text').forEach(function(node) { if (node.textContent.indexOf('TA-1') === 0) line = node.textContent; });
      var stackLine = '';
      document.querySelectorAll('#stack-list .stack-item').forEach(function(node) {
        if (node.textContent.indexOf('TA-1') !== -1) stackLine = node.textContent;
      });
      return { time: ta && ta.time, line: line, stackHas: stackLine.indexOf('7:30 AM') !== -1, formGone: !document.getElementById('schedule-edit-name') };
    })()`);
    assert(edited.time === '7:30 AM' && edited.line.indexOf('7:30 AM') !== -1, 'save did not write the time ' + JSON.stringify(edited));
    assert(edited.stackHas === true && edited.formGone === true, 'My Stack did not refresh ' + JSON.stringify(edited));

    await evaluate(cdp, `hideSaveModal();
      switchTab('stack');
      var card = null;
      document.querySelectorAll('#stack-list .stack-item').forEach(function(node) { if (!card && node.textContent.indexOf('TA-1') !== -1) card = node; });
      card.querySelector('[data-action="edit"]').click();
      card = null;
      document.querySelectorAll('#stack-list .stack-item').forEach(function(node) { if (!card && node.querySelector('[data-edit="time"]')) card = node; });
      var time = card.querySelector('[data-edit="time"]');
      var scroller = document.querySelector('#panel-stack .panel-scroll');
      var top = time.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 120;
      scroller.scrollTop = Math.max(0, top);`);
    const stackEdit = await evaluate(cdp, `(function() {
      hideSaveModal();
      var time = document.querySelector('#stack-list [data-edit="time"]');
      var group = document.querySelector('#stack-list [data-edit="group"]');
      time.scrollIntoView({ block: 'center' });
      var timeRect = time.getBoundingClientRect();
      var groupRect = group.getBoundingClientRect();
      return {
        tab: document.querySelector('#tabs .tab.active').getAttribute('data-tab'),
        time: time && time.value,
        group: group && group.value,
        timeLabel: time && time.parentNode.textContent,
        groupLabel: group && group.parentNode.textContent,
        timeTop: Math.round(timeRect.top),
        groupTop: Math.round(groupRect.top)
      };
    })()`);
    assert(stackEdit.tab === 'stack', 'stack tab was ' + stackEdit.tab);
    assert(stackEdit.time === '7:30 AM' && stackEdit.group === 'Daily peptides', 'stack fields ' + JSON.stringify(stackEdit));
    assert(stackEdit.timeLabel.indexOf('Time') !== -1 && stackEdit.groupLabel.indexOf('Group') !== -1, 'labels ' + JSON.stringify(stackEdit));
    assert(stackEdit.timeTop > 70 && stackEdit.timeTop < 700 && stackEdit.groupTop > stackEdit.timeTop && stackEdit.groupTop < 780, 'stack fields off screen ' + JSON.stringify(stackEdit));
    await shot(cdp, 'schedule_routine_stack_edit_390.png');

    const stackWrite = await evaluate(cdp, `(function() {
      var time = document.querySelector('#stack-list [data-edit="time"]');
      var group = document.querySelector('#stack-list [data-edit="group"]');
      time.value = '8 AM';
      group.value = 'Morning peptides';
      time.dispatchEvent(new Event('change', { bubbles: true }));
      group.dispatchEvent(new Event('change', { bubbles: true }));
      var ta = JSON.parse(localStorage.getItem('peptideUserStack')).filter(function(item) { return item.name === 'TA-1'; })[0];
      return { time: ta.time, group: ta.group };
    })()`);
    assert(stackWrite.time === '8 AM' && stackWrite.group === 'Morning peptides', 'stack edit did not save ' + JSON.stringify(stackWrite));

    const flows = await evaluate(cdp, `(function() {
      var errors = [];
      function check(cond, message) { if (!cond) errors.push(message); }
      switchTab('chat');
      setScheduleOpen(true, 'toggle');
      document.getElementById('schedule-add').click();
      check(document.activeElement && document.activeElement.id === 'schedule-edit-name', 'add form did not focus name');
      document.getElementById('schedule-edit-name').value = 'Magnesium';
      document.getElementById('schedule-edit-dose').value = '400 mg';
      document.getElementById('schedule-edit-schedule').value = 'nightly';
      document.getElementById('schedule-edit-time').value = '9 PM';
      document.getElementById('schedule-edit-tod').value = 'bedtime';
      document.getElementById('schedule-edit-group').value = 'Gut healing (ongoing)';
      document.querySelector('#schedule-body form').requestSubmit();
      var stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      var mag = stack.filter(function(item) { return item.name === 'Magnesium'; })[0];
      check(!!mag && mag.status === 'taking' && mag.dose === '400 mg' && mag.time === '9 PM' && mag.group === 'Gut healing (ongoing)' && mag.timeOfDay === 'bedtime', 'add item failed ' + JSON.stringify(mag));
      var before = stack.length;
      var edit = null;
      document.querySelectorAll('.schedule-edit').forEach(function(btn) { if (btn.getAttribute('aria-label') === 'Edit Magnesium') edit = btn; });
      edit.click();
      document.querySelector('[data-schedule-action="stop"]').click();
      stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      mag = stack.filter(function(item) { return item.name === 'Magnesium'; })[0];
      check(stack.length === before, 'remove-from-schedule deleted the item');
      check(mag && mag.status === 'stopped' && mag.active === false, 'status was not stopped ' + JSON.stringify(mag));
      check(!Array.prototype.some.call(document.querySelectorAll('.schedule-line-text'), function(node) { return node.textContent.indexOf('Magnesium') === 0; }), 'stopped item still on the schedule');
      document.getElementById('stack-name').value = 'Zinc';
      document.getElementById('stack-dose').value = '25 mg';
      document.getElementById('stack-schedule').value = 'daily';
      addStackFromForm();
      stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      var zinc = stack.filter(function(item) { return item.name === 'Zinc'; })[0];
      check(!!zinc && zinc.status === 'taking', 'My Stack add failed');
      removeStackItem(zinc.id);
      stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      check(!stack.some(function(item) { return item.name === 'Zinc'; }), 'My Stack remove failed');
      switchTab('labs');
      check(document.getElementById('panel-labs').classList.contains('active'), 'labs tab did not open');
      check(document.getElementById('labs-list').textContent.indexOf('No labs saved yet') !== -1, 'labs empty state missing');
      switchTab('sources');
      check(document.getElementById('panel-sources').classList.contains('active'), 'sources tab did not open');
      switchTab('chat');
      closeSchedulePanel();
      check(localStorage.getItem('peptideScheduleOpen') === '0', 'close did not persist');
      document.getElementById('hdr-menu-btn').click();
      document.getElementById('schedule-show-toggle').click();
      check(document.getElementById('schedule-btn').hidden === true, 'show switch did not hide the button');
      check(localStorage.getItem('peptideScheduleShow') === '0', 'show switch did not persist');
      document.getElementById('schedule-show-toggle').click();
      check(document.getElementById('schedule-btn').hidden === false, 'show switch did not restore the button');
      check(document.getElementById('sbtn').disabled === false, 'send button stayed disabled');
      return { errors: errors };
    })()`);
    assert(!flows.errors.length, flows.errors.join('; '));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    const narrow = await evaluate(cdp, `(function() {
      switchTab('chat');
      setScheduleOpen(true, 'toggle');
      document.querySelector('.routine-add-btn').click();
      function overflow(el) { return !el ? 0 : el.scrollWidth - el.clientWidth; }
      var edit = document.querySelector('.schedule-edit').getBoundingClientRect();
      var add = document.getElementById('schedule-add').getBoundingClientRect();
      var routine = document.querySelector('.routine-add-btn').getBoundingClientRect();
      var confirmBtn = document.getElementById('routine-sheet-confirm').getBoundingClientRect();
      return {
        width: window.innerWidth,
        wrap: overflow(document.getElementById('wrap')),
        panel: overflow(document.getElementById('schedule-panel')),
        sheet: overflow(document.getElementById('routine-sheet-panel')),
        editH: edit.height,
        addH: add.height,
        routineH: routine.height,
        confirmH: confirmBtn.height
      };
    })()`);
    assert(narrow.width === 320, 'narrow viewport ' + narrow.width);
    assert(narrow.wrap <= 1 && narrow.panel <= 1 && narrow.sheet <= 1, 'horizontal overflow at 320 ' + JSON.stringify(narrow));
    assert(narrow.editH >= 44 && narrow.addH >= 44 && narrow.routineH >= 44 && narrow.confirmH >= 44, '320 tap targets ' + JSON.stringify(narrow));

    const limited = await evaluate(cdp, `(function() {
      closeRoutineSheet(false);
      var items = [];
      for (var i = 0; i < 40; i++) items.push({ id: 'full-' + i, name: 'Item ' + i, dose: '1 mg', schedule: 'daily', status: 'taking', active: true });
      items[0].name = 'TA-1';
      localStorage.setItem('peptideUserStack', JSON.stringify(items));
      var routine = '**Daily:**\\n- TA-1: 9 mg\\n- New A: 1 mg\\n- New B: 2 mg\\n- New C: 3 mg';
      var el = addMsg('bot', fmt(routine), false);
      attachRoutineAdd(el, routine);
      el.nextElementSibling.querySelector('button').click();
      document.getElementById('routine-sheet-confirm').click();
      var stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      var ta = stack.filter(function(item) { return item.name === 'TA-1'; })[0];
      return {
        count: stack.length,
        error: document.getElementById('routine-sheet-error').textContent,
        toast: document.getElementById('copy-toast').textContent,
        hidden: document.getElementById('routine-sheet').hidden,
        taDose: ta && ta.dose,
        added: stack.filter(function(item) { return item.name === 'New A' || item.name === 'New B' || item.name === 'New C'; }).length
      };
    })()`);
    assert(limited.count === 40, 'limit changed the stack size ' + limited.count);
    assert(limited.added === 0, 'new items were added past the limit');
    assert(limited.taDose === '9 mg', 'existing item was not updated at the limit ' + limited.taDose);
    assert(limited.hidden === true, 'partial save should close the sheet and explain the rest in the toast');
    assert(limited.toast.indexOf('Updated 1') !== -1 && limited.toast.indexOf('40') !== -1, 'limit toast ' + limited.toast);

    const blocked = await evaluate(cdp, `(function() {
      var routine = '**Daily:**\\n- Brand New: 1 mg\\n- Another: 2 mg\\n- Third New: 3 mg';
      var el = addMsg('bot', fmt(routine), false);
      attachRoutineAdd(el, routine);
      el.nextElementSibling.querySelector('button').click();
      document.getElementById('routine-sheet-confirm').click();
      return {
        error: document.getElementById('routine-sheet-error').textContent,
        hidden: document.getElementById('routine-sheet').hidden,
        count: JSON.parse(localStorage.getItem('peptideUserStack')).length
      };
    })()`);
    assert(blocked.hidden === false, 'blocked confirm closed the sheet');
    assert(blocked.count === 40, 'blocked confirm changed the count ' + blocked.count);
    assert(/full/i.test(blocked.error), 'limit message was ' + blocked.error);

    console.log('schedule routine smoke passed');
  } finally {
    if (cdp) cdp.close();
    if (browser) browser.close();
    chrome.kill();
    if (started && started.server) started.server.close();
  }
}

main().catch(function(err) {
  console.error('FAIL ' + (err && err.stack || err));
  process.exit(1);
});
