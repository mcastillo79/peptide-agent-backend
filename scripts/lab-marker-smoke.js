#!/usr/bin/env node
// Lab marker filter and Labs chart rendering.
// Static checks plus a 390px headless Chrome pass over the Labs tab.

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const markers = require('../lib/lab-markers');

assert(markers.isDoseUnit('mg') && markers.isDoseUnit('MCG') && markers.isDoseUnit('µg') && markers.isDoseUnit('IU') && markers.isDoseUnit('I.U.'), 'dose units should be recognized');
assert(!markers.isDoseUnit('mg/dL') && !markers.isDoseUnit('ng/mL') && !markers.isDoseUnit('mIU/L'), 'lab concentrations are not dose units');
assert(markers.isLabUnit('ng/mL') && markers.isLabUnit('mg/dL') && markers.isLabUnit('mcg/dL') && markers.isLabUnit('mIU/mL') && markers.isLabUnit('g/dL') && markers.isLabUnit('%') && markers.isLabUnit('fL'), 'common lab units should pass');
assert(!markers.isLabUnit('mg') && !markers.isLabUnit('mcg') && !markers.isLabUnit('IU') && !markers.isLabUnit('mg/serving') && !markers.isLabUnit(''), 'dose and per-serving units should fail');
assert(markers.looksLikeSupplementLabel('Supplement Facts Serving Size 1 capsule Iron 25 mg % Daily Value'), 'supplement facts text should be detected');
assert(!markers.looksLikeSupplementLabel('Ferritin 45 ng/mL reference range 30-400'), 'a lab line is not a supplement label');

const supplementRow = { name: 'Iron (Ferrous Bisglycinate Chelate)', value: '25', unit: 'mg', flag: 'info' };
const vitaminC = { name: 'Vitamin C (Ascorbic Acid)', value: '150', unit: 'mg', flag: 'info' };
const lactoferrin = { name: 'Lactoferrin (Bovine-Derived)', value: '100', unit: 'mg', flag: 'info' };
const ferritin = { name: 'Ferritin', value: '45', unit: 'ng/mL', flag: 'normal', refLow: 30, refHigh: 400 };
const serumIron = { name: 'Iron', value: '80', unit: 'mcg/dL', flag: 'normal', refLow: 50, refHigh: 170 };
assert(!markers.isLabMarker(supplementRow) && !markers.isLabMarker(vitaminC) && !markers.isLabMarker(lactoferrin), 'supplement doses are not lab markers');
assert(markers.isLabMarker(ferritin) && markers.isLabMarker(serumIron), 'blood results with lab units stay');
assert(markers.filterLabMarkers([supplementRow, ferritin, vitaminC, { name: 'Vitamin D3', value: '5000', unit: 'IU' }]).map(function(item) { return item.name; }).join(',') === 'Ferritin', 'filter keeps only the lab marker');

const labelEntry = {
  summary: 'Supplement Facts Serving Size 1 capsule Amount Per Serving % Daily Value',
  filenames: ['supplement-facts.jpg'],
  biomarkers: [supplementRow, vitaminC, lactoferrin]
};
assert(markers.markerHiddenFromLabs(supplementRow, labelEntry, ['Iron (Ferrous Bisglycinate Chelate)']), 'stored supplement dose is hidden');
assert(!markers.markerHiddenFromLabs(serumIron, { summary: 'Quest diagnostics Iron 80 mcg/dL', filenames: ['quest.pdf'] }, ['Iron (Ferrous Bisglycinate Chelate)']), 'serum iron is not hidden by a similarly named stack item');
assert(markers.markerHiddenFromLabs({ name: 'Vitamin C (Ascorbic Acid)', value: '125', unit: '%' }, labelEntry, ['Vitamin C (Ascorbic Acid)']), 'percent daily value matching a stack item is hidden');
assert(!markers.markerHiddenFromLabs({ name: 'Hematocrit', value: '44', unit: '%' }, { summary: 'CBC', filenames: ['cbc.pdf'] }, []), 'hematocrit percent stays visible');
assert(!markers.markerHiddenFromLabs({ name: 'Glutathione', value: '800', unit: 'µmol/L', refLow: 400, refHigh: 1200 }, { summary: 'Glutathione 800 µmol/L', filenames: ['labs.pdf'] }, ['Glutathione']), 'a real glutathione result is not hidden just because the catalog has that name');

assert(html.includes('<script src="/lab-markers.js"></script>'), 'labs page should load the shared marker filter');
assert(html.includes('Add another result to see a trend'), 'single-point charts need the trend hint');
assert(html.includes('They are still stored on this device and were not deleted.'), 'hidden doses must stay stored');
assert(html.includes('class="trend-plot"') && html.includes('class="trend-grid"') && html.includes('class="trend-frame"'), 'chart frame and grid missing');
assert(html.includes('points.length > 1'), 'the line should be drawn only when there are two or more points');
assert(html.includes('function recordLabResult'), 'lab save path missing');
assert(html.includes('filterLabMarkers'), 'new saves should drop non-lab markers');
assert(html.includes('looksLikeSupplementLabel'), 'supplement-label uploads should not be saved as labs');
assert(!/class="trend-axis"[^>]*font-size:\s*0\.\d+rem/.test(html), 'chart text must not use rem, which collapses SVG height on iOS');
assert(html.includes('min-height: 140px') && html.includes('padding-top: var(--trend-ratio'), 'chart box needs a nonzero height that does not depend on SVG intrinsic sizing');
assert(html.includes("localStorage.setItem(LAB_NOISE_KEY, '1')") || html.includes('peptideLabNoiseFiltered'), 'one-time cleanup flag missing');

const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(function(match) { return match[1]; });
scripts.forEach(function(code, index) {
  try {
    new vm.Script(code, { filename: 'inline-' + index + '.js' });
  } catch (err) {
    fail('inline script ' + index + ' did not parse: ' + err.message);
  }
});

process.env.PORT = '0';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_lab_marker_smoke';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-lab-marker-smoke';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'lab-marker-smoke';
process.env.PINECONE_HOST = process.env.PINECONE_HOST || 'localhost';
const serverModule = require('../server');
const names = serverModule.parseBiomarkers([
  'Ferritin: 45 ng/mL (30-400)',
  'TSH: 2.1 mIU/mL (0.4-4.5)',
  'Hemoglobin 14.2 g/dL',
  'HbA1c: 5.4 % (4.0-5.6)',
  'Serum Iron: 80 mcg/dL (50-170)',
  'Iron (Ferrous Bisglycinate Chelate) 25 mg',
  'Vitamin C (Ascorbic Acid) 150 mg',
  'Lactoferrin (Bovine-Derived) 100 mg',
  'Vitamin D3 5000 IU'
].join('\n')).map(function(item) { return item.name; });
assert(names.indexOf('Ferritin') !== -1, 'line parser dropped Ferritin: ' + names.join(', '));
assert(names.indexOf('TSH') !== -1, 'line parser dropped TSH');
assert(names.indexOf('Hemoglobin') !== -1, 'line parser dropped Hemoglobin');
assert(names.indexOf('HbA1c') !== -1, 'line parser dropped HbA1c');
assert(names.indexOf('Serum Iron') !== -1, 'line parser dropped Serum Iron');
assert(names.indexOf('Iron') === -1 && names.every(function(name) { return name.indexOf('Vitamin C') === -1 && name.indexOf('Lactoferrin') === -1 && name.indexOf('Vitamin D3') === -1; }), 'line parser kept a supplement dose: ' + names.join(', '));

const fromJson = serverModule.parseBiomarkers('Labs\nBIOMARKERS_JSON\n' + JSON.stringify([
  ferritin,
  supplementRow,
  vitaminC,
  lactoferrin,
  { name: 'Vitamin D3', value: '5000', unit: 'IU', flag: 'info', refLow: null, refHigh: null }
]));
assert(fromJson.length === 1 && fromJson[0].name === 'Ferritin', 'JSON parse kept non-lab rows: ' + JSON.stringify(fromJson));
const labelParsed = serverModule.parseBiomarkers('Supplement Facts\nServing Size 1 capsule\nAmount Per Serving\nBIOMARKERS_JSON\n' + JSON.stringify([ferritin, supplementRow]));
assert(labelParsed.length === 0, 'a supplement facts extraction should save no lab rows');
serverModule.server.close();

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.webmanifest') return 'application/manifest+json';
  return 'application/octet-stream';
}

function startServer() {
  const publicDir = path.join(ROOT, 'public');
  const server = http.createServer(function(req, res) {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/lab-markers.js' || urlPath === '/lab-compare.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'lib', path.basename(urlPath))));
      return;
    }
    if (urlPath === '/api/catalog-names') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ names: ['BPC-157', 'Glutathione', 'Semaglutide'] }));
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
      send: function(method, params) {
        const id = ++nextId;
        return new Promise(function(res, rej) {
          pending.set(id, { res: res, rej: rej });
          ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
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
      listeners.forEach(function(fn) { try { fn(msg); } catch (e) {} });
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
    try { return await getJson(url); } catch (err) {
      last = err.message;
      await new Promise(function(resolve) { setTimeout(resolve, 200); });
    }
  }
  throw new Error('debugger never came up: ' + last);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const text = (details.exception && details.exception.description) || details.text || JSON.stringify(details);
    fail('page error: ' + text);
  }
  return result.result && result.result.value;
}

const SEED = `
localStorage.setItem('peptideUserProfile', JSON.stringify({name:'Alex',age:'34',state:'Florida',goal:'Longevity and anti-aging',conditions:'None noted',experience:'Some experience'}));
localStorage.setItem('peptideTheme', 'light');
localStorage.removeItem('peptideUserEmail');
localStorage.removeItem('peptideChatHistory');
localStorage.removeItem('peptideTextSize');
localStorage.removeItem('peptideLabNoiseFiltered');
localStorage.setItem('peptideUserStack', JSON.stringify([
  {id:'s1', name:'Iron (Ferrous Bisglycinate Chelate)', dose:'25 mg', schedule:'daily', active:true, status:'taking'},
  {id:'s2', name:'Vitamin C (Ascorbic Acid)', dose:'150 mg', schedule:'daily', active:true, status:'taking'},
  {id:'s3', name:'Lactoferrin (Bovine-Derived)', dose:'100 mg', schedule:'daily', active:true, status:'taking'}
]));
localStorage.setItem('peptideLabHistory', JSON.stringify([
  {id:'l-fer-1', date:'2026-08-01T15:00:00.000Z', filenames:['quest-august.pdf'], summary:'Ferritin 38 ng/mL reference range 30-400 ng/mL', biomarkers:[{name:'Ferritin', value:'38', unit:'ng/mL', flag:'normal', refLow:30, refHigh:400}]},
  {id:'l-fer-2', date:'2026-11-01T15:00:00.000Z', filenames:['quest-november.pdf'], summary:'Ferritin 52 ng/mL reference range 30-400 ng/mL', biomarkers:[{name:'Ferritin', value:'52', unit:'ng/mL', flag:'normal', refLow:30, refHigh:400}]},
  {id:'l-d', date:'2026-11-21T15:00:00.000Z', filenames:['vitamin-d.pdf'], summary:'Vitamin D, 25-OH 28 ng/mL reference range 30-100', biomarkers:[{name:'Vitamin D, 25-OH', value:'28', unit:'ng/mL', flag:'low', refLow:30, refHigh:100}]},
  {id:'l-label', date:'2026-11-21T16:00:00.000Z', filenames:['supplement-facts.jpg'], summary:'Supplement Facts Serving Size 1 capsule Amount Per Serving Iron (Ferrous Bisglycinate Chelate) 25 mg Vitamin C (Ascorbic Acid) 150 mg Lactoferrin (Bovine-Derived) 100 mg % Daily Value', biomarkers:[
    {name:'Iron (Ferrous Bisglycinate Chelate)', value:'25', unit:'mg', flag:'info'},
    {name:'Vitamin C (Ascorbic Acid)', value:'150', unit:'mg', flag:'info'},
    {name:'Lactoferrin (Bovine-Derived)', value:'100', unit:'mg', flag:'info'}
  ]}
]));
`;

function chromePath() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome'].filter(Boolean);
  return candidates.find(function(candidate) { return fs.existsSync(candidate); }) || '';
}

async function main() {
  const started = await startServer();
  const bin = chromePath();
  if (!bin) fail('google-chrome is not installed');
  const userData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lab-marker-'));
  const debugPort = 9600 + Math.floor(Math.random() * 300);
  const chrome = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--remote-debugging-port=' + debugPort, '--user-data-dir=' + userData, 'about:blank'
  ], { stdio: 'ignore' });
  let browser;
  let cdp;
  try {
    const version = await waitForJson('http://127.0.0.1:' + debugPort + '/json/version');
    browser = await connectCdp(version.webSocketDebuggerUrl);
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = await getJson('http://127.0.0.1:' + debugPort + '/json/list');
    const page = targets.find(function(target) { return target.id === created.targetId; });
    if (!page) fail('no page target');
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
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + started.port + '/' });
    await new Promise(function(resolve) { setTimeout(resolve, 700); });
    const report = await evaluate(cdp, `(() => {
      switchTab('labs');
      var panel = document.querySelector('#panel-labs .panel-scroll');
      if (panel) panel.scrollTop = 0;
      Array.prototype.forEach.call(document.querySelectorAll('#lab-trends details'), function(el) { el.open = true; });
      Array.prototype.forEach.call(document.querySelectorAll('#lab-trends .lab-chart'), function(el) { el.hidden = false; });
      function card(name) {
        var cards = Array.prototype.slice.call(document.querySelectorAll('#lab-trends .trend-card'));
        return cards.find(function(el) { return el.querySelector('.trend-latest') && el.querySelector('.trend-latest').textContent === name; }) || null;
      }
      function measure(size) {
        applyTextSize(size, false);
        var boxes = Array.prototype.slice.call(document.querySelectorAll('#lab-trends .trend-svg')).map(function(svg) {
          var rect = svg.getBoundingClientRect();
          return { h: rect.height, w: rect.width };
        });
        return boxes;
      }
      var sizes = {};
      [87.5, 100, 112.5, 125, 150].forEach(function(size) { sizes[String(size)] = measure(size); });
      applyTextSize(100, false);
      applyTheme('light');
      var single = card('Vitamin D, 25-OH');
      var trend = card('Ferritin');
      var saved = JSON.parse(localStorage.getItem('peptideLabHistory'));
      var stillThere = saved.some(function(lab) {
        return (lab.biomarkers || []).some(function(item) { return item.name === 'Iron (Ferrous Bisglycinate Chelate)' && item.unit === 'mg'; });
      });
      var lightPlot = getComputedStyle(single.querySelector('.trend-plot')).fill;
      var lightFrame = getComputedStyle(single.querySelector('.trend-frame')).stroke;
      applyTheme('dark');
      var darkPlot = getComputedStyle(single.querySelector('.trend-plot')).fill;
      var darkFrame = getComputedStyle(single.querySelector('.trend-frame')).stroke;
      var darkGrid = getComputedStyle(single.querySelector('.trend-grid')).stroke;
      var darkDot = getComputedStyle(single.querySelector('.trend-dot')).fill;
      applyTheme('light');
      return {
        width: window.innerWidth,
        titles: Array.prototype.slice.call(document.querySelectorAll('#lab-trends .trend-latest')).map(function(el) { return el.textContent; }),
        listText: document.getElementById('labs-list').textContent,
        note: document.getElementById('lab-trends').textContent.indexOf('were not deleted') !== -1,
        hint: single ? single.querySelector('.trend-hint') && single.querySelector('.trend-hint').textContent : '',
        trendHint: trend ? !!trend.querySelector('.trend-hint') : true,
        singleLine: single ? !!single.querySelector('.trend-line') : true,
        trendLine: trend ? !!trend.querySelector('.trend-line') : false,
        points: trend ? trend.querySelectorAll('.trend-line').length : 0,
        singleRadius: single ? single.querySelector('.trend-dot').getAttribute('r') : '',
        singleValue: single ? single.querySelector('.trend-value').textContent : '',
        band: single ? !!single.querySelector('.trend-band') : false,
        plot: single ? !!single.querySelector('.trend-plot') : false,
        grid: single ? single.querySelectorAll('.trend-grid').length : 0,
        frame: single ? !!single.querySelector('.trend-frame') : false,
        stillThere: stillThere,
        flagged: localStorage.getItem('peptideLabNoiseFiltered'),
        sizes: sizes,
        lightPlot: lightPlot,
        lightFrame: lightFrame,
        darkPlot: darkPlot,
        darkFrame: darkFrame,
        darkGrid: darkGrid,
        darkDot: darkDot
      };
    })()`);
    assert(report.width === 390, 'viewport was ' + report.width);
    assert(report.titles.indexOf('Iron (Ferrous Bisglycinate Chelate)') === -1, 'iron dose still charted');
    assert(report.titles.indexOf('Vitamin C (Ascorbic Acid)') === -1, 'vitamin C dose still charted');
    assert(report.titles.indexOf('Lactoferrin (Bovine-Derived)') === -1, 'lactoferrin dose still charted');
    assert(report.titles.indexOf('Vitamin D, 25-OH') !== -1 && report.titles.indexOf('Ferritin') !== -1, 'real labs missing: ' + report.titles.join(', '));
    assert(report.listText.indexOf('Ferrous Bisglycinate') === -1, 'supplement dose still listed in the timeline');
    assert(report.listText.indexOf('Ferritin') !== -1, 'ferritin missing from the timeline');
    assert(report.note, 'hidden-dose note missing');
    assert(report.hint === 'Add another result to see a trend', 'single-point hint was ' + report.hint);
    assert(report.trendHint === false, 'multi-point chart should not show the single-point hint');
    assert(report.singleLine === false, 'a single point should not draw a line');
    assert(report.trendLine === true, 'two ferritin results should draw a line');
    assert(report.singleRadius === '8', 'single point radius was ' + report.singleRadius);
    assert(report.singleValue === '28', 'single point value label was ' + report.singleValue);
    assert(report.band && report.plot && report.frame && report.grid >= 3, 'chart frame, grid, or reference band missing');
    assert(report.stillThere, 'cleanup deleted a saved supplement dose');
    assert(report.flagged === '1', 'one-time cleanup flag was not set');
    Object.keys(report.sizes).forEach(function(size) {
      var boxes = report.sizes[size];
      assert(boxes.length >= 2, 'missing charts at text size ' + size);
      boxes.forEach(function(box) {
        assert(box.h >= 120 && box.h <= 280, 'svg height ' + box.h + ' at text size ' + size);
        assert(box.w >= 200, 'svg width ' + box.w + ' at text size ' + size);
      });
    });
    assert(report.lightPlot !== report.lightFrame, 'light mode chart frame matches the plot');
    assert(report.darkPlot !== report.darkFrame && report.darkPlot !== report.darkGrid && report.darkDot !== report.darkPlot, 'dark mode chart has no contrast: ' + JSON.stringify(report));
    console.log('lab marker smoke ok');
  } finally {
    if (cdp) cdp.close();
    if (browser) browser.close();
    chrome.kill('SIGKILL');
    started.server.close();
  }
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
