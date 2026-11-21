#!/usr/bin/env node
// Regenerates data/catalogs/altura-ruo.json from Altura's public catalog.
// Descriptions and the RUO label are copied verbatim. Prices are omitted.

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const vm = require('vm');
const { ALTURA_DISCLAIMER, ALTURA_LABEL } = require('../lib/catalogs');

const CATALOG_URL = 'https://altura-preview.vercel.app/js/catalog.js';
const PRODUCT_PAGE_URL = 'https://altura-preview.vercel.app/product.html';
const I18N_URL = 'https://altura-preview.vercel.app/js/i18n.js';
const OUT_PATH = path.join(__dirname, '..', 'data', 'catalogs', 'altura-ruo.json');

function fetchText(url, redirectsLeft) {
  return new Promise(function(resolve, reject) {
    const lib = url.indexOf('http://') === 0 ? http : https;
    const req = lib.get(url, { headers: { 'user-agent': 'peptide-agent-catalog-sync', accept: '*/*' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirectsLeft) return reject(new Error('Too many redirects for ' + url));
        return resolve(fetchText(new URL(res.headers.location, url).href, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('GET ' + url + ' failed with ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    });
    req.on('error', reject);
  });
}

function decodeHtml(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function(_, num) { return String.fromCharCode(Number(num)); })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function ruoLabelFromProductPage(html) {
  const match = html.match(/<p class="ruo"[^>]*>([\s\S]*?)<\/p>/);
  if (!match) throw new Error('RUO label not found on the Altura product page');
  return decodeHtml(match[1].replace(/\s+/g, ' ').trim());
}

function ruoLabelFromI18n(source) {
  const match = source.match(/['"]pdp\.ruo['"]\s*:\s*'((?:\\'|[^'])*)'/);
  if (!match) throw new Error('pdp.ruo not found in Altura i18n.js');
  return match[1].replace(/\\'/g, "'");
}

function loadCatalogSource(source) {
  const code = source + '\nmodule.exports.ALTURA_CATALOG = ALTURA_CATALOG;\nmodule.exports.OUT_OF_STOCK_SKUS = OUT_OF_STOCK_SKUS;\nmodule.exports.isOutOfStock = isOutOfStock;\n';
  const sandbox = { module: { exports: {} }, exports: {} };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(code, sandbox, { filename: 'catalog.js' });
  return sandbox.module.exports;
}

function withoutPrices(items, fields) {
  return items.map(function(item) {
    const copy = {};
    fields.forEach(function(field) {
      if (item[field] != null && item[field] !== '') copy[field] = item[field];
    });
    return copy;
  });
}

function availabilityFor(sku, isOutOfStock, blocked) {
  // The storefront helper is out of stock when the SKU is in OUT_OF_STOCK_SKUS,
  // including a stack whose component SKU (or ALT-BAC-WATER) is listed there.
  return isOutOfStock(sku, blocked) ? 'out of stock' : 'in stock';
}

async function main() {
  const catalogSource = await fetchText(CATALOG_URL, 5);
  const productPage = await fetchText(PRODUCT_PAGE_URL, 5);
  const i18nSource = await fetchText(I18N_URL, 5);
  const pageLabel = ruoLabelFromProductPage(productPage);
  const i18nLabel = ruoLabelFromI18n(i18nSource);
  if (pageLabel !== i18nLabel) {
    throw new Error('Product-page RUO label does not match i18n pdp.ruo');
  }

  const loaded = loadCatalogSource(catalogSource);
  const catalog = loaded.ALTURA_CATALOG;
  const blocked = Array.isArray(loaded.OUT_OF_STOCK_SKUS) ? loaded.OUT_OF_STOCK_SKUS : [];
  if (!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.cats)) {
    throw new Error('ALTURA_CATALOG is missing products or categories');
  }

  const categoryBySlug = {};
  catalog.cats.forEach(function(category) {
    categoryBySlug[category.slug] = category.name;
  });

  const seen = {};
  const products = catalog.products.map(function(product) {
    if (!product || !product.sku || !product.name) throw new Error('Catalog product is missing a name or SKU');
    if (seen[product.sku]) throw new Error('Duplicate SKU ' + product.sku);
    seen[product.sku] = true;
    const category = categoryBySlug[product.cat];
    if (!category) throw new Error(product.sku + ' has unknown category ' + product.cat);
    if (typeof product.desc !== 'string' || !product.desc) {
      throw new Error(product.sku + ' is missing a site description');
    }

    const record = {
      name: product.name,
      sku: product.sku,
      category: category,
      availability: availabilityFor(product.sku, loaded.isOutOfStock, blocked),
      source: 'altura',
      type: 'RUO',
      label: ALTURA_LABEL,
      site_description_verbatim: product.desc,
      ruo_label_verbatim: pageLabel
    };
    if (Array.isArray(product.sizes) && product.sizes.length) {
      record.sizes = withoutPrices(product.sizes, ['label', 'mg']);
    }
    if (Array.isArray(product.components) && product.components.length) {
      record.variants = withoutPrices(product.components, ['name', 'mg']);
    }
    if (record.site_description_verbatim !== product.desc) {
      throw new Error('Description was altered for ' + product.sku);
    }
    return record;
  });

  const payload = {
    source: 'altura',
    type: 'RUO',
    label: ALTURA_LABEL,
    disclaimer: ALTURA_DISCLAIMER,
    ruo_label_verbatim: pageLabel,
    scraped_at: new Date().toISOString(),
    sources: {
      catalog_js: CATALOG_URL,
      product_page: PRODUCT_PAGE_URL
    },
    products: products
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log('Wrote ' + products.length + ' Altura products to ' + OUT_PATH);
}

main().catch(function(err) {
  console.error(err.message || err);
  process.exit(1);
});
