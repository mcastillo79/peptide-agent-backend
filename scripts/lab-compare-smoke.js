#!/usr/bin/env node
// Compare view, year overview, stricter lab filter, and 390px screenshots.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.LAB_COMPARE_SHOTS || '/opt/cursor/artifacts';

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const markers = require('../lib/lab-markers');
const compare = require('../lib/lab-compare');

assert(markers.isLabUnit('mg/dL') && !markers.isLabUnit('mg') && !markers.isDoseUnit('mg/dL'), 'mg/dL is a lab unit and mg is a dose');
assert(!markers.isLabMarker({ name: 'Magnesium Glycinate', value: '1000', unit: 'mg' }), 'magnesium glycinate dose is not a lab');
assert(!markers.isLabMarker({ name: 'Tirzepatide', value: '10', unit: 'mg/mL' }), 'a peptide concentration is not a lab');
assert(!markers.isLabMarker({ name: 'Widget', value: '4', unit: '' }), 'a bare number outside the dictionary is excluded');
assert(markers.isLabMarker({ name: 'Hemoglobin', value: '14.2', unit: '' }), 'a known marker can be saved without a unit');
assert(markers.isLabMarker({ name: 'Magnesium', value: '2.0', unit: 'mg/dL' }), 'serum magnesium stays');
assert(markers.panelFor('Free T4').label === 'Thyroid', 'free t4 panel');
assert(compare.changeText(44, 22, 'ng/mL', 'ng/mL') === '↑ changed by 22 (100%)', 'percent change');
assert(compare.changeText(5, 0, 'mg/dL', 'mg/dL').indexOf('%') === -1, 'no percent when the earlier value is 0');
assert(compare.changeText(10, 10, 'g/dL', 'g/dL') === 'no change', 'zero change');

process.env.PORT = '0';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_lab_compare_smoke';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-lab-compare-smoke';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'lab-compare-smoke';
process.env.PINECONE_HOST = process.env.PINECONE_HOST || 'localhost';
const serverModule = require('../server');
const parsed = serverModule.parseBiomarkers([
  'Panel: CBC',
  'Hemoglobin: 14.2 g/dL (13-17)',
  'Panel: Lipid panel',
  'LDL-C: 128 mg/dL (0-99)',
  'Tirzepatide 7.5 mg',
  'Magnesium Glycinate 1000 mg'
].join('\n'));
assert(parsed.length === 2, 'parser kept non-labs: ' + JSON.stringify(parsed));
assert(parsed[0].name === 'Hemoglobin' && parsed[0].panel === 'CBC', 'CBC panel was not kept: ' + JSON.stringify(parsed[0]));
assert(parsed[1].name === 'LDL-C' && parsed[1].panel === 'Lipid panel', 'lipid panel was not kept: ' + JSON.stringify(parsed[1]));
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
      res.end(JSON.stringify({ names: ['Tirzepatide', 'BPC-157', 'Glutathione', 'Magnesium Glycinate'] }));
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

function marker(name, value, unit, low, high, flag) {
  const item = { name: name, value: String(value), unit: unit, flag: flag || 'normal' };
  if (low != null && high != null) { item.refLow = low; item.refHigh = high; }
  return item;
}

const history = [
  { id: 'l1', date: '2025-11-18T16:00:00.000Z', filenames: ['quest-nov-2025.pdf'], summary: 'CBC metabolic lipids thyroid', biomarkers: [
    marker('WBC', '5.6', 'K/uL', 4, 11),
    marker('Hemoglobin', '14.2', 'g/dL', 13, 17),
    marker('Hematocrit', '42', '%', 38, 50),
    marker('Platelets', '220', 'K/uL', 150, 450),
    marker('Glucose', '102', 'mg/dL', 70, 99, 'high'),
    marker('Creatinine', '0.9', 'mg/dL', 0.6, 1.3),
    marker('ALT', '22', 'U/L', 7, 56),
    marker('eGFR', '92', 'mL/min'),
    marker('LDL-C', '128', 'mg/dL', 0, 99, 'high'),
    marker('HDL-C', '52', 'mg/dL', 40, 80),
    marker('Triglycerides', '142', 'mg/dL', 0, 149),
    marker('TSH', '2.4', 'mIU/L', 0.4, 4.5),
    marker('Free T4', '1.1', 'ng/dL', 0.8, 1.8),
    marker('Vitamin D, 25-OH', '22', 'ng/mL', 30, 100, 'low'),
    marker('Ferritin', '38', 'ng/mL', 30, 400),
    marker('HbA1c', '5.5', '%', 4, 5.6)
  ] },
  { id: 'l2', date: '2026-03-02T16:00:00.000Z', filenames: ['quest-mar-2026.pdf'], summary: 'Follow up', biomarkers: [
    marker('WBC', '6.1', 'K/uL', 4, 11),
    marker('Hemoglobin', '14.0', 'g/dL', 13, 17),
    marker('Platelets', '210', 'K/uL', 150, 450),
    marker('Glucose', '96', 'mg/dL', 70, 99),
    marker('Creatinine', '0.98', 'mg/dL', 0.6, 1.3),
    marker('LDL-C', '118', 'mg/dL', 0, 99, 'high'),
    marker('HDL-C', '55', 'mg/dL', 40, 80),
    marker('TSH', '2.1', 'mIU/L', 0.4, 4.5),
    marker('Vitamin D, 25-OH', '28', 'ng/mL', 30, 100, 'low'),
    marker('Ferritin', '45', 'ng/mL', 30, 400),
    marker('HbA1c', '5.4', '%', 4, 5.6),
    marker('Tirzepatide', '2.5', 'mg', null, null, 'info')
  ] },
  { id: 'l3', date: '2026-07-14T16:00:00.000Z', filenames: ['quest-jul-2026.pdf'], summary: 'Mid year', biomarkers: [
    marker('WBC', '5.8', 'K/uL', 4, 11),
    marker('Hemoglobin', '13.8', 'g/dL', 13, 17),
    marker('Glucose', '108', 'mg/dL', 70, 99, 'high'),
    marker('LDL-C', '104', 'mg/dL', 0, 99, 'high'),
    marker('TSH', '1.9', 'mIU/L', 0.4, 4.5),
    marker('Vitamin D, 25-OH', '36', 'ng/mL', 30, 100),
    marker('Ferritin', '52', 'ng/mL', 30, 400),
    marker('Tirzepatide', '5', 'mg', null, null, 'info'),
    marker('Magnesium Glycinate', '1000', 'mg', null, null, 'info')
  ] },
  { id: 'l4', date: '2026-11-04T16:00:00.000Z', filenames: ['quest-nov-2026.pdf'], summary: 'Latest', biomarkers: [
    marker('WBC', '5.9', 'K/uL', 4, 11),
    marker('Hemoglobin', '14.4', 'g/dL', 13, 17),
    marker('Hematocrit', '43', '%', 38, 50),
    marker('Platelets', '220', 'K/uL', 150, 450),
    marker('Glucose', '91', 'mg/dL', 70, 99),
    marker('Creatinine', '0.9', 'mg/dL', 0.6, 1.3),
    marker('ALT', '19', 'U/L', 7, 56),
    marker('eGFR', '93', 'mL/min'),
    marker('LDL-C', '96', 'mg/dL', 0, 99),
    marker('HDL-C', '61', 'mg/dL', 40, 80),
    marker('Triglycerides', '110', 'mg/dL', 0, 149),
    marker('TSH', '2.2', 'mIU/L', 0.4, 4.5),
    marker('Free T4', '1.15', 'ng/dL', 0.8, 1.8),
    marker('Vitamin D, 25-OH', '44', 'ng/mL', 30, 100),
    marker('Ferritin', '61', 'ng/mL', 30, 400),
    marker('HbA1c', '5.3', '%', 4, 5.6),
    marker('hs-CRP', '1.4', 'mg/L', 0, 3),
    marker('Tirzepatide', '7.5', 'mg', null, null, 'info'),
    marker('Magnesium Glycinate', '1000', 'mg', null, null, 'info')
  ] }
];

const SEED = `
localStorage.setItem('peptideUserProfile', JSON.stringify({name:'Alex',age:'34',state:'Florida',goal:'Longevity and anti-aging',conditions:'None noted',experience:'Some experience'}));
localStorage.setItem('peptideTheme', 'light');
localStorage.removeItem('peptideUserEmail');
localStorage.removeItem('peptideChatHistory');
localStorage.removeItem('peptideTextSize');
localStorage.removeItem('peptideLabNoiseFiltered');
localStorage.removeItem('peptideLabExcludedDismissed');
localStorage.setItem('peptideUserStack', JSON.stringify([{id:'s-existing', name:'Tirzepatide', dose:'2.5 mg', schedule:'weekly', active:true, status:'taking'}]));
localStorage.setItem('peptideLabHistory', ${JSON.stringify(JSON.stringify(history))});
`;

function chromePath() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].filter(Boolean);
  return candidates.find(function(candidate) { return fs.existsSync(candidate); }) || '';
}

async function settle(ms) {
  await new Promise(function(resolve) { setTimeout(resolve, ms || 450); });
}

async function shot(cdp, file) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const full = path.join(OUT, file);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(full, Buffer.from(result.data, 'base64'));
  const buf = fs.readFileSync(full);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert(width === 390 && height === 844, file + ' was ' + width + 'x' + height);
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

async function main() {
  const started = await startServer();
  const bin = chromePath();
  if (!bin) fail('google-chrome is not installed');
  const userData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lab-compare-'));
  const debugPort = 9800 + Math.floor(Math.random() * 200);
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
    await new Promise(function(resolve) { setTimeout(resolve, 800); });
    const report = await evaluate(cdp, `(() => {
      switchTab('labs');
      applyTheme('light');
      var text = document.getElementById('lab-trends').innerText;
      var overviewBody = Array.prototype.map.call(document.querySelectorAll('.lab-group'), function(el) { return el.innerText; }).join('\\n');
      var groups = Array.prototype.map.call(document.querySelectorAll('.lab-group-name'), function(el) { return el.textContent; });
      var metas = Array.prototype.map.call(document.querySelectorAll('.lab-group-meta'), function(el) { return el.textContent; });
      labsView = 'compare';
      renderLabTrends();
      var compareText = document.getElementById('lab-trends').innerText;
      var compareTable = (document.querySelector('.compare-table') || { innerText: '' }).innerText;
      var changedBtn = document.querySelector('[data-compare-filter="changed"]');
      changedBtn.click();
      var changedText = document.getElementById('lab-trends').innerText;
      document.querySelector('[data-compare-filter="out"]').click();
      var outText = document.getElementById('lab-trends').innerText;
      document.querySelector('[data-compare-filter="all"]').click();
      labsView = 'year';
      renderLabTrends();
      var yearText = document.getElementById('lab-trends').innerText;
      var yearGrid = (document.querySelector('.year-grid') || { innerText: '' }).innerText;
      var yearButton = document.querySelector('[data-year-key="ferritin"]');
      if (yearButton) yearButton.click();
      var opened = document.getElementById('trend-ferritin');
      var chartVisible = opened && opened.querySelector('.lab-chart') && !opened.querySelector('.lab-chart').hidden;
      var selectStyle = getComputedStyle(document.querySelector('.lab-row-value')).userSelect;
      applyTextSize(150, false);
      var big = document.querySelector('.lab-row-name').getBoundingClientRect().height;
      applyTextSize(100, false);
      labsView = 'compare';
      compareFilter = 'all';
      renderLabTrends();
      applyTheme('dark');
      var outBadge = document.querySelector('.range-badge.out');
      var outBg = outBadge ? getComputedStyle(outBadge).backgroundColor : '';
      applyTheme('light');
      var saved = JSON.parse(localStorage.getItem('peptideLabHistory'));
      var still = JSON.stringify(saved).indexOf('Magnesium Glycinate') !== -1 && JSON.stringify(saved).indexOf('Tirzepatide') !== -1;
      return {
        width: window.innerWidth,
        text: text,
        overviewBody: overviewBody,
        compareTable: compareTable,
        groups: groups,
        metas: metas,
        compareText: compareText,
        changedText: changedText,
        outText: outText,
        yearText: yearText,
        yearGrid: yearGrid,
        chartVisible: !!chartVisible,
        selectStyle: selectStyle,
        big: big,
        outBg: outBg,
        still: still,
        pro: document.querySelector('#lab-trends .pro-badge') && document.querySelector('#lab-trends .pro-badge').textContent
      };
    })()`);
    assert(report.width === 390, 'viewport ' + report.width);
    assert(report.text.indexOf('We found 2 items that look like supplements or medications, not lab results.') !== -1, 'notice missing: ' + report.text.slice(0, 400));
    assert(report.text.indexOf('Magnesium Glycinate') !== -1 && report.text.indexOf('Tirzepatide') !== -1, 'excluded names missing from the notice');
    assert(report.text.indexOf('were not deleted') !== -1, 'stored-not-deleted line missing');
    assert(report.text.indexOf('For tracking only') !== -1, 'disclaimer missing');
    ['CBC', 'Metabolic', 'Lipids', 'Thyroid', 'Vitamins & Minerals', 'Other'].forEach(function(name) {
      assert(report.groups.indexOf(name) !== -1, 'missing group ' + name + ' in ' + report.groups.join(', '));
    });
    assert(report.metas.some(function(meta) { return meta.indexOf('outside saved reference range') !== -1; }), 'group summary missing: ' + report.metas.join(' | '));
    assert(report.overviewBody.indexOf('Tirzepatide') === -1 && report.overviewBody.indexOf('Magnesium') === -1, 'supplement still grouped as a lab: ' + report.overviewBody.slice(0, 400));
    assert(report.compareTable.indexOf('Tirzepatide') === -1 && report.compareTable.indexOf('Magnesium') === -1, 'supplement still in the compare table');
    assert(report.text.indexOf('Latest 7.5') === -1 && report.text.indexOf('Latest 1000') === -1, 'dose still charted');
    assert(report.compareText.indexOf('Date A') !== -1 && report.compareText.indexOf('Date B') !== -1, 'date pickers missing');
    assert(report.compareText.indexOf('changed by') !== -1, 'change wording missing');
    assert(report.compareText.indexOf('Within saved reference range') !== -1, 'in-range badge missing');
    assert(report.compareText.indexOf('Outside saved reference range') !== -1, 'out-of-range badge missing');
    assert(report.changedText.indexOf('Platelets') === -1, 'unchanged platelets stayed in the changed filter');
    assert(report.changedText.indexOf('Ferritin') !== -1, 'changed ferritin missing');
    assert(report.outText.indexOf('Glucose') !== -1 && report.outText.indexOf('Platelets') === -1, 'out of range filter: ' + report.outText.slice(0, 500));
    assert(report.yearText.indexOf('Nov') !== -1 && report.yearText.indexOf('Within saved reference range') !== -1, 'year legend missing');
    assert(report.yearGrid.indexOf('Magnesium') === -1 && report.yearGrid.indexOf('Tirzepatide') === -1, 'supplement in the year grid');
    assert(report.chartVisible, 'tapping a year marker did not open the trend chart');
    assert(report.selectStyle === 'text' || report.selectStyle === 'auto', 'row text is not selectable: ' + report.selectStyle);
    assert(report.big > 16, 'text size control did not grow the row');
    assert(report.outBg && report.outBg.indexOf('155, 28, 28') === -1, 'out of range color looks alarming: ' + report.outBg);
    assert(report.still, 'excluded items were deleted before a tap');
    assert(report.pro === 'PRO', 'PRO badge missing');

    await evaluate(cdp, `(() => {
      labsView = 'overview';
      openTrendKey = '';
      renderLabTrends();
      applyTheme('light');
      var panel = document.querySelector('#panel-labs .panel-scroll');
      var el = document.getElementById('lab-trends');
      panel.scrollTop = Math.max(0, el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 4);
    })()`);
    await settle();
    await shot(cdp, 'labs_after_overview_light_390.png');
    await evaluate(cdp, `(() => { applyTheme('dark'); })()`);
    await settle();
    await shot(cdp, 'labs_after_overview_dark_390.png');
    await evaluate(cdp, `(() => {
      applyTheme('light');
      var group = document.querySelector('.lab-group[data-panel="vitamins"]');
      if (group) group.open = true;
      var panel = document.querySelector('#panel-labs .panel-scroll');
      var top = group.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
      panel.scrollTop = Math.max(0, top - 8);
    })()`);
    await settle();
    await shot(cdp, 'labs_after_rows_light_390.png');
    await evaluate(cdp, `(() => { applyTheme('dark'); })()`);
    await settle();
    await shot(cdp, 'labs_after_rows_dark_390.png');
    await evaluate(cdp, `(() => {
      applyTheme('light');
      labsView = 'compare';
      compareFilter = 'all';
      renderLabTrends();
      var panel = document.querySelector('#panel-labs .panel-scroll');
      var el = document.querySelector('.compare-dates') || document.getElementById('lab-trends');
      panel.scrollTop = Math.max(0, el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 8);
    })()`);
    await settle();
    await shot(cdp, 'labs_after_compare_light_390.png');
    await evaluate(cdp, `(() => { applyTheme('dark'); })()`);
    await settle();
    await shot(cdp, 'labs_after_compare_dark_390.png');
    await evaluate(cdp, `(() => {
      applyTheme('light');
      labsView = 'year';
      renderLabTrends();
      var panel = document.querySelector('#panel-labs .panel-scroll');
      var el = document.querySelector('.year-wrap') || document.getElementById('lab-trends');
      panel.scrollTop = Math.max(0, el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 8);
    })()`);
    await settle();
    await shot(cdp, 'labs_after_year_light_390.png');
    await evaluate(cdp, `(() => { applyTheme('dark'); })()`);
    await settle();
    await shot(cdp, 'labs_after_year_dark_390.png');

    const moved = await evaluate(cdp, `(() => {
      labsView = 'overview';
      renderLabTrends();
      document.querySelector('[data-lab-action="move"]').click();
      var stack = JSON.parse(localStorage.getItem('peptideUserStack'));
      var mag = stack.filter(function(item) { return item.name === 'Magnesium Glycinate'; });
      var tir = stack.filter(function(item) { return item.name === 'Tirzepatide'; });
      var saved = JSON.parse(localStorage.getItem('peptideLabHistory'));
      var blob = JSON.stringify(saved);
      return {
        mag: mag.map(function(item) { return { dose: item.dose, status: item.status }; }),
        tirDose: tir.map(function(item) { return item.dose; }),
        tirCount: tir.length,
        blobHasMag: blob.indexOf('Magnesium Glycinate') !== -1,
        blobHasTir: blob.indexOf('Tirzepatide') !== -1,
        notice: document.getElementById('lab-trends').innerText.indexOf('We found') !== -1
      };
    })()`);
    assert(moved.mag.length === 1 && moved.mag[0].status === 'considering' && moved.mag[0].dose === '', 'move did not add magnesium as considering without a dose: ' + JSON.stringify(moved));
    assert(moved.tirCount === 1 && moved.tirDose[0] === '2.5 mg', 'existing tirzepatide dose was overwritten: ' + JSON.stringify(moved));
    assert(!moved.blobHasMag && !moved.blobHasTir, 'moved items stayed in lab history');
    assert(!moved.notice, 'notice stayed after the move');

    const dismissed = await evaluate(cdp, `(() => {
      localStorage.setItem('peptideLabHistory', ${JSON.stringify(JSON.stringify(history))});
      localStorage.removeItem('peptideLabExcludedDismissed');
      renderLabs();
      document.querySelector('[data-lab-action="dismiss"]').click();
      var saved = localStorage.getItem('peptideLabHistory');
      return {
        notice: document.getElementById('lab-trends').innerText.indexOf('We found') !== -1,
        kept: saved.indexOf('Magnesium Glycinate') !== -1 && saved.indexOf('Tirzepatide') !== -1,
        charts: document.getElementById('lab-trends').innerText.indexOf('Latest 1000') === -1
      };
    })()`);
    assert(!dismissed.notice && dismissed.kept && dismissed.charts, 'dismiss deleted data or left the notice: ' + JSON.stringify(dismissed));

    const empty = await evaluate(cdp, `(() => {
      localStorage.setItem('peptideLabHistory', JSON.stringify([]));
      localStorage.setItem('peptideLabExcludedDismissed', '[]');
      renderLabs();
      labsView = 'compare';
      renderLabTrends();
      var none = document.getElementById('lab-trends').innerText;
      localStorage.setItem('peptideLabHistory', JSON.stringify([{id:'one', date:'2026-11-04T16:00:00.000Z', filenames:['one.pdf'], summary:'', biomarkers:[{name:'Ferritin', value:'61', unit:'ng/mL', flag:'normal', refLow:30, refHigh:400}]}]));
      renderLabs();
      labsView = 'year';
      renderLabTrends();
      var one = document.getElementById('lab-trends').innerText;
      compareInPdf = true;
      buildLabPrint();
      var printed = document.getElementById('lab-print').innerText;
      return { none: none, one: one, printed: printed };
    })()`);
    assert(empty.none.indexOf('No lab dates saved yet') !== -1, 'zero-date empty state missing');
    assert(empty.one.indexOf('One lab date is saved') !== -1, 'one-date empty state missing: ' + empty.one.slice(0, 300));
    assert(empty.printed.indexOf('One lab date is saved') !== -1, 'pdf compare option missing the empty state');
    console.log('lab compare smoke ok');
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
