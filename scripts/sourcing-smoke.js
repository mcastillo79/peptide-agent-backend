#!/usr/bin/env node
// Catalog-gated sourcing: ARA-290 is Altura-only; BPC-157 is pharmacy and Altura.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Readable } = require('stream');
const {
  loadCatalogs,
  catalogAvailability,
  formatAvailabilityNote,
  sourcingContextText,
  stripUnauthorizedPharmacySourcing,
  ALTURA_DISCLAIMER
} = require('../lib/catalogs');
const { pipeFilteredChatStream } = require('../lib/chat-stream');

const PHARMACY_FL = 'https://bit.ly/RXpeptides';
const PHARMACY_NY = 'http://bit.ly/sterile503aPpharmacyNY';
const ALTURA = 'https://bit.ly/AlturaUSASups';
const PHARMACY_EXAMPLES = [
  'BPC-157',
  'TB-500',
  'GHK-Cu',
  'Semaglutide',
  'Tirzepatide',
  'Retatrutide',
  'NAD+',
  'MOTS-c',
  'Sermorelin',
  'Tesamorelin',
  'CJC-1295/Ipamorelin',
  'Semax',
  'Selank',
  'KPV',
  'PT-141',
  'Glutathione'
];

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function assertNoPharmacy(text, label) {
  if (text.indexOf('RXpeptides') !== -1 || text.indexOf('sterile503aPpharmacyNY') !== -1) {
    fail(label + ' included a pharmacy link: ' + text);
  }
}

function assertHas(text, needles, label) {
  needles.forEach(function(needle) {
    if (text.indexOf(needle) === -1) fail(label + ' missing ' + needle);
  });
}

function assertPharmacyAndAltura(text, label) {
  assertHas(text, [PHARMACY_FL, PHARMACY_NY, ALTURA, 'FGP15'], label);
}

const catalogs = loadCatalogs();

['ARA-290', 'ara-290', 'Ara-290'].forEach(function(name) {
  const availability = catalogAvailability(catalogs, 'What protocol should I use for ' + name + '?');
  assert.deepStrictEqual(availability.pharmacy, [], name + ' pharmacy list');
  assert.deepStrictEqual(availability.altura, ['ARA-290']);
  assert.deepStrictEqual(availability.notInPharmacy, ['ARA-290']);
  assertNoPharmacy(availability.sourcingLine, name);
  assert.ok(availability.sourcingLine.indexOf(ALTURA) !== -1, name + ' Altura link');
  assert.ok(availability.sourcingLine.indexOf('FGP15') !== -1, name + ' discount code');
  assert.ok(availability.sourcingLine.indexOf(ALTURA_DISCLAIMER) !== -1, name + ' disclaimer');
  const note = formatAvailabilityNote(availability);
  assert.ok(note.indexOf('Pharmacy carries: []; Altura carries: [ARA-290]; Not in pharmacy catalog: [ARA-290].') !== -1, note);
  assert.ok(note.indexOf('not currently on the pharmacy\'s list') !== -1);
});

['BPC-157', 'bpc-157', 'bpc 157'].forEach(function(name) {
  const availability = catalogAvailability(catalogs, 'Write a protocol for ' + name + '.');
  assert.deepStrictEqual(availability.pharmacy, ['BPC-157'], name + ' pharmacy list');
  assert.deepStrictEqual(availability.altura, ['BPC-157'], name + ' altura list');
  assert.deepStrictEqual(availability.notInPharmacy, []);
  assertPharmacyAndAltura(availability.sourcingLine, name);
  assertHas(availability.sourcingLine, [ALTURA_DISCLAIMER], name);
  const note = formatAvailabilityNote(availability);
  assert.ok(note.indexOf('Pharmacy carries: [BPC-157]; Altura carries: [BPC-157]; Not in pharmacy catalog: [].') !== -1, note);
});

PHARMACY_EXAMPLES.forEach(function(name) {
  const availability = catalogAvailability(catalogs, name);
  if (!availability.pharmacy.length) fail(name + ' was not matched to the pharmacy catalog');
});

const reta = catalogAvailability(catalogs, 'Where can I buy RETA?');
assert.deepStrictEqual(reta.pharmacy, ['Retatrutide']);
assert.strictEqual(reta.retatrutide, true);
assertNoPharmacy(reta.sourcingLine, 'RETA');
assert.ok(formatAvailabilityNote(reta).indexOf('rule 2') !== -1, 'RETA note should keep rule 2');

const direct = catalogAvailability(catalogs, 'Does the pharmacy carry ARA-290?');
assert.deepStrictEqual(direct.notInPharmacy, ['ARA-290']);
assertNoPharmacy(direct.sourcingLine, 'direct pharmacy question');

const araReply = [
  'ARA-290 has been studied for neuropathic pain.',
  'Option 2: Pharmaceutical-grade through the licensed compounding pharmacy partner (Florida ' + PHARMACY_FL + ', New York ' + PHARMACY_NY + ').',
  'For USA third-party-tested lyophilized powders with 10% off (code FGP15) - and remember to add bacteriostatic water - see Altura USA Sups: ' + ALTURA + '.'
].join(' ');
const strippedAra = stripUnauthorizedPharmacySourcing(araReply, catalogs, 'What protocol for ARA-290?');
assertNoPharmacy(strippedAra, 'stripped ARA-290 reply');
assert.ok(strippedAra.indexOf(ALTURA) !== -1, 'stripped reply kept Altura');
assert.ok(strippedAra.indexOf('FGP15') !== -1, 'stripped reply kept the discount code');
assert.ok(strippedAra.indexOf('ARA-290 has been studied') !== -1, 'stripped reply kept the protocol text');

const bpcReply = araReply.replace(/ARA-290/g, 'BPC-157');
assert.strictEqual(
  stripUnauthorizedPharmacySourcing(bpcReply, catalogs, 'What protocol for BPC-157?'),
  bpcReply
);

const unnamed = 'For pharmaceutical-grade peptides through our licensed 503A compounding pharmacy partner, see: ' + PHARMACY_FL + ' (Florida) and ' + PHARMACY_NY + ' (New York).';
assert.strictEqual(stripUnauthorizedPharmacySourcing(unnamed, catalogs, 'protocol for BPC-157'), unnamed);
assertNoPharmacy(stripUnauthorizedPharmacySourcing(unnamed, catalogs, 'protocol for ARA-290'), 'unnamed pharmacy close');

const cleanAra = 'ARA-290 has been studied for neuropathic pain. ' + ALTURA_DISCLAIMER;
assert.strictEqual(stripUnauthorizedPharmacySourcing(cleanAra, catalogs, 'ARA-290'), cleanAra);

const followUp = sourcingContextText(catalogs, [
  { role: 'user', content: 'Tell me about ARA-290.' },
  { role: 'assistant', content: 'ARA-290 has been studied for neuropathic pain.' },
  { role: 'user', content: 'Where do I buy it?' }
], [{ name: 'BPC-157', status: 'active' }]);
const followAvailability = catalogAvailability(catalogs, followUp);
assert.deepStrictEqual(followAvailability.pharmacy, []);
assert.deepStrictEqual(followAvailability.altura, ['ARA-290']);

const namedOverHistory = sourcingContextText(catalogs, [
  { role: 'user', content: 'What about BPC-157?' },
  { role: 'assistant', content: 'BPC-157 is used in tissue-repair protocols.' },
  { role: 'user', content: 'And what about ARA-290?' }
], []);
const namedAvailability = catalogAvailability(catalogs, namedOverHistory);
assert.deepStrictEqual(namedAvailability.pharmacy, []);
assert.deepStrictEqual(namedAvailability.notInPharmacy, ['ARA-290']);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
[
  'catalogAvailability',
  'formatAvailabilityNote',
  'pipeFilteredChatStream',
  'Not in pharmacy catalog',
  'not currently on the pharmacy\'s list',
  PHARMACY_FL,
  PHARMACY_NY,
  ALTURA,
  'FGP15',
  'https://form.typeform.com/to/A1ojtRP6'
].forEach(function(needle) {
  if (serverSource.indexOf(needle) === -1) fail('server.js missing ' + needle);
});
if (serverSource.indexOf('covering both options') !== -1) fail('CLOSE rule still forces both sourcing options');
if (serverSource.indexOf('present the following two options') !== -1) fail('sourcing rule still forces two options');

function delta(text) {
  return 'data: ' + JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: text }
  }) + '\n\n';
}

function streamedText(output) {
  let text = '';
  String(output || '').split('\n').forEach(function(line) {
    if (line.indexOf('data:') !== 0) return;
    try {
      const parsed = JSON.parse(line.replace(/^data:\s?/, ''));
      if (parsed.delta && typeof parsed.delta.text === 'string') text += parsed.delta.text;
    } catch (err) {}
  });
  return text;
}

function runStream(events, contextText) {
  return new Promise(function(resolve, reject) {
    const upstream = new Readable({ read: function() {} });
    let output = '';
    const res = {
      write: function(chunk) { output += chunk; },
      end: function() { resolve(output); }
    };
    pipeFilteredChatStream(upstream, res, catalogs, contextText);
    upstream.on('error', reject);
    events.forEach(function(event) { upstream.push(event); });
    upstream.push(null);
  });
}

function protocol(name) {
  return [
    name + ' has been studied in preclinical models.\n\n',
    'Option 2: Pharmaceutical-grade through the licensed compounding pharmacy partner (Florida ' + PHARMACY_FL + ', New York ' + PHARMACY_NY + ').\n\n',
    'For USA third-party-tested lyophilized powders with 10% off (code FGP15) - and remember to add bacteriostatic water - see Altura USA Sups: ' + ALTURA + '.'
  ];
}

(async function() {
  const araEvents = ['event: message_start\ndata: {"type":"message_start"}\n\n']
    .concat(protocol('ARA-290').map(delta))
    .concat(['data: {"type":"message_stop"}\n\n']);
  const araOut = await runStream(araEvents, 'What protocol for ARA-290?');
  const araText = streamedText(araOut);
  assertNoPharmacy(araText, 'streamed ARA-290 reply');
  assert.ok(araText.indexOf('ARA-290 has been studied') !== -1, 'streamed ARA-290 reply dropped the protocol');
  assert.ok(araText.indexOf(ALTURA) !== -1, 'streamed ARA-290 reply dropped Altura');
  assert.ok(araText.indexOf('FGP15') !== -1, 'streamed ARA-290 reply dropped the discount code');
  assert.ok(araOut.indexOf('message_stop') !== -1, 'stream dropped message_stop');
  assert.ok(araOut.indexOf('message_start') !== -1, 'stream dropped message_start');

  const bpcEvents = protocol('BPC-157').map(delta).concat(['data: {"type":"message_stop"}\n\n']);
  const bpcText = streamedText(await runStream(bpcEvents, 'What protocol for BPC-157?'));
  assertPharmacyAndAltura(bpcText, 'streamed BPC-157 reply');
  assert.ok(bpcText.indexOf('BPC-157 has been studied') !== -1);

  console.log('sourcing smoke ok');
})().catch(function(err) {
  console.error(err);
  process.exit(1);
});
