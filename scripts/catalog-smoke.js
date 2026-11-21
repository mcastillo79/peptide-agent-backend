#!/usr/bin/env node
// Offline smoke check for the two product catalogs and the model-context text.
// Does not boot server.js (that process opens Pinecone and listens).

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadCatalogs, catalogSummary, formatModelCatalog, ALTURA_DISCLAIMER, PHARMACY_LABEL } = require('../lib/catalogs');

const RUO_LABEL = 'For laboratory research use only — not for human or animal consumption. Not a drug, food or cosmetic. Supply is restricted to qualified researchers.';
const ARA_290_DESCRIPTION = 'An 11-amino-acid peptide derived from the helix B domain of erythropoietin, studied in preclinical work on the innate repair receptor and small-fiber neuropathy models. Research use only.';
const EXPECTED_ALTURA_CATEGORIES = {
  'Tissue Repair': 2,
  Dermal: 2,
  Metabolic: 6,
  Endocrine: 8,
  Cellular: 5,
  Neuro: 8,
  'Research Stacks': 14,
  Immune: 5
};
const EXPECTED_PHARMACY_CATEGORIES = {
  'GLP-1/metabolic': 6,
  peptide: 10,
  'supplement/cofactor': 2,
  'nasal spray': 2,
  'compounded oral': 1
};

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

const catalogs = loadCatalogs();
const summary = catalogSummary(catalogs);
const prompt = formatModelCatalog(catalogs);
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.strictEqual(catalogs.altura.products.length, 50);
assert.strictEqual(catalogs.pharmacy.products.length, 21);
assert.deepStrictEqual(summary.catalogs[0].by_category, EXPECTED_ALTURA_CATEGORIES);
assert.deepStrictEqual(summary.catalogs[1].by_category, EXPECTED_PHARMACY_CATEGORIES);
assert.strictEqual(summary.catalogs[0].count, 50);
assert.strictEqual(summary.catalogs[1].count, 21);
assert.strictEqual(summary.catalogs[0].disclaimer, ALTURA_DISCLAIMER);
assert.strictEqual(summary.catalogs[0].ruo_label_verbatim, RUO_LABEL);
assert.strictEqual(summary.catalogs[1].label, PHARMACY_LABEL);
assert.ok(!Object.prototype.hasOwnProperty.call(summary.catalogs[0], 'products'));
assert.ok(!JSON.stringify(summary).includes('price'));

const ara = catalogs.altura.products.find(function(product) { return product.sku === 'ALT-ARA-290'; });
if (!ara) fail('ARA-290 missing');
assert.strictEqual(ara.site_description_verbatim, ARA_290_DESCRIPTION);
assert.strictEqual(ara.ruo_label_verbatim, RUO_LABEL);

catalogs.altura.products.forEach(function(product) {
  assert.strictEqual(product.site_description_verbatim.trim(), product.site_description_verbatim);
  assert.ok(!/\$\d/.test(product.site_description_verbatim), product.sku + ' description has a numeric price');
});

const excluded = /supply kit|shipping|hrt lab|lab panel/i;
catalogs.pharmacy.products.forEach(function(product) {
  assert.ok(!excluded.test(product.name), 'excluded item present: ' + product.name);
});

[
  'Licensed pharmacy compounds (Rx via provider)',
  'Research-use-only products (Altura)',
  ALTURA_DISCLAIMER,
  'licensed healthcare provider',
  'has been studied for',
  'research has suggested it may support',
  'has been reported to',
  'Never say a product treats, cures, heals, or guarantees anything.',
  'No dosing, protocol, or administration advice, ever.',
  'requiring a prescription from a licensed provider',
  'verbatim site description',
  ARA_290_DESCRIPTION,
  'Semaglutide — GLP-1/metabolic — forms: oral RDT, oral ODT, injectable'
].forEach(function(needle) {
  if (prompt.indexOf(needle) === -1) fail('model catalog missing: ' + needle);
});

assert.ok(prompt.indexOf('bit.ly') === -1, 'catalog prompt must not add partner links');
assert.ok(!/\$\d/.test(prompt), 'catalog prompt contains a numeric price');

[
  'https://bit.ly/RXpeptides',
  'http://bit.ly/sterile503aPpharmacyNY',
  'https://bit.ly/AlturaUSASups',
  'https://form.typeform.com/to/A1ojtRP6',
  "app.post('/api/track-click'",
  'scout_clicks',
  "app.get('/api/catalogs'",
  'formatModelCatalog(productCatalogs)',
  'getRelevantContext(question)'
].forEach(function(needle) {
  if (serverSource.indexOf(needle) === -1) fail('server.js missing unchanged behavior: ' + needle);
});

console.log('catalog smoke ok');
console.log(JSON.stringify(summary, null, 2));
