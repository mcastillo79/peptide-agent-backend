const fs = require('fs');
const path = require('path');

const ALTURA_LABEL = 'Research-use-only products (Altura)';
const ALTURA_DISCLAIMER = 'Third-party research-use-only product suggestion (Altura). Not medical advice. Not for human consumption.';
const PHARMACY_LABEL = 'Licensed pharmacy compounds (Rx via provider)';
const PRICE_KEYS = new Set(['price', 'prices', 'unit_price', 'unit_amount', 'cost', 'msrp']);

function catalogDir() {
  return path.join(__dirname, '..', 'data', 'catalogs');
}

function readCatalog(filename) {
  const filePath = path.join(catalogDir(), filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertNoPriceKeys(value, where) {
  if (Array.isArray(value)) {
    value.forEach(function(item, index) {
      assertNoPriceKeys(item, where + '[' + index + ']');
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function(key) {
    if (PRICE_KEYS.has(String(key).toLowerCase())) {
      throw new Error('Price field ' + where + '.' + key + ' is not allowed in catalog data');
    }
    assertNoPriceKeys(value[key], where + '.' + key);
  });
}

function requireString(value, where) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing ' + where);
  }
  return value;
}

function loadCatalogs() {
  const altura = readCatalog('altura-ruo.json');
  const pharmacy = readCatalog('pharmacy-compounds.json');
  assertNoPriceKeys(altura, 'altura');
  assertNoPriceKeys(pharmacy, 'pharmacy');

  if (altura.source !== 'altura' || altura.type !== 'RUO') {
    throw new Error('Altura catalog source/type is invalid');
  }
  if (altura.label !== ALTURA_LABEL) throw new Error('Altura catalog label mismatch');
  if (altura.disclaimer !== ALTURA_DISCLAIMER) throw new Error('Altura disclaimer mismatch');
  requireString(altura.ruo_label_verbatim, 'altura.ruo_label_verbatim');
  requireString(altura.scraped_at, 'altura.scraped_at');
  if (!Array.isArray(altura.products) || !altura.products.length) {
    throw new Error('Altura catalog has no products');
  }
  altura.products.forEach(function(product) {
    requireString(product.name, 'altura product name');
    requireString(product.sku, 'altura sku');
    requireString(product.category, product.sku + ' category');
    requireString(product.site_description_verbatim, product.sku + ' site_description_verbatim');
    if (product.ruo_label_verbatim !== altura.ruo_label_verbatim) {
      throw new Error(product.sku + ' RUO label does not match the site label');
    }
    if (product.source !== 'altura' || product.type !== 'RUO' || product.label !== ALTURA_LABEL) {
      throw new Error(product.sku + ' is missing Altura RUO labeling');
    }
    if (product.availability !== 'in stock' && product.availability !== 'out of stock') {
      throw new Error(product.sku + ' has invalid availability');
    }
  });

  if (pharmacy.source !== 'pharmacy' || pharmacy.type !== 'Rx') {
    throw new Error('Pharmacy catalog source/type is invalid');
  }
  if (pharmacy.label !== PHARMACY_LABEL) throw new Error('Pharmacy catalog label mismatch');
  if (!Array.isArray(pharmacy.products) || !pharmacy.products.length) {
    throw new Error('Pharmacy catalog has no products');
  }
  pharmacy.products.forEach(function(product) {
    requireString(product.name, 'pharmacy product name');
    requireString(product.category, product.name + ' category');
    if (!Array.isArray(product.forms) || !product.forms.length) {
      throw new Error(product.name + ' is missing forms');
    }
    if (product.source !== 'pharmacy' || product.type !== 'Rx' || product.label !== PHARMACY_LABEL) {
      throw new Error(product.name + ' is missing pharmacy Rx labeling');
    }
  });

  return { altura: altura, pharmacy: pharmacy };
}

function countsByCategory(products) {
  const counts = {};
  products.forEach(function(product) {
    const category = product.category;
    counts[category] = (counts[category] || 0) + 1;
  });
  return counts;
}

function catalogSummary(catalogs) {
  return {
    catalogs: [
      {
        source: 'altura',
        type: 'RUO',
        label: catalogs.altura.label,
        disclaimer: catalogs.altura.disclaimer,
        ruo_label_verbatim: catalogs.altura.ruo_label_verbatim,
        count: catalogs.altura.products.length,
        by_category: countsByCategory(catalogs.altura.products)
      },
      {
        source: 'pharmacy',
        type: 'Rx',
        label: catalogs.pharmacy.label,
        count: catalogs.pharmacy.products.length,
        by_category: countsByCategory(catalogs.pharmacy.products)
      }
    ]
  };
}

function formatSizes(product) {
  const parts = [];
  if (Array.isArray(product.sizes) && product.sizes.length) {
    const sizes = product.sizes.map(function(size) {
      if (size.label && size.mg && size.label !== size.mg) return size.label + ' (' + size.mg + ')';
      return size.mg || size.label || '';
    }).filter(Boolean);
    if (sizes.length) parts.push('sizes: ' + sizes.join(', '));
  }
  if (Array.isArray(product.variants) && product.variants.length) {
    const variants = product.variants.map(function(variant) {
      return variant.mg ? variant.name + ' ' + variant.mg : variant.name;
    });
    parts.push('includes: ' + variants.join('; '));
  }
  return parts.join(' — ');
}

function formatModelCatalog(catalogs) {
  const pharmacy = catalogs.pharmacy;
  const altura = catalogs.altura;
  const lines = [
    'PRODUCT CATALOGS',
    'Two catalogs are listed below. When you suggest products, keep pharmacy compounds and research-use-only products in these separate, labeled groups. Do not mix them into one list. These catalogs do not change the sourcing links or the sourcing rules above.',
    '',
    pharmacy.label,
    'These are licensed compounds requiring a prescription from a licensed provider. Keep that label whenever you mention them. Do not present them as available without that prescription.',
    'When you mention a product from either catalog, give no dosing, protocol, or administration advice, ever.'
  ];

  pharmacy.products.forEach(function(product) {
    const forms = product.forms.map(function(form) { return form.form; }).filter(Boolean);
    let line = '- ' + product.name + ' — ' + product.category;
    if (forms.length) line += ' — forms: ' + forms.join(', ');
    lines.push(line);
  });

  lines.push('');
  lines.push(altura.label);
  lines.push(altura.disclaimer);
  lines.push('Altura products are research-use-only and not for human consumption. Never present them as something to take.');
  lines.push('You may suggest a relevant Altura product when a user describes a concern. Example of acceptable wording, and only when the association is well documented: if a user mentions neuropathic pain, you may say that ARA-290 has been studied for neuropathic pain. Do not say it treats neuropathic pain.');
  lines.push('Rules for that wording:');
  lines.push('- Use hedged, research-framed language only: "has been studied for", "research has suggested it may support", "has been reported to". Never say a product treats, cures, heals, or guarantees anything.');
  lines.push('- Only mention research associations that are well documented. If you are unsure, do not mention the association.');
  lines.push('- When you describe an Altura product, use its verbatim site description below. Do not paraphrase that site wording and do not add health or use claims of your own. The hedged frames above are the only extra wording allowed.');
  lines.push('- No dosing, protocol, or administration advice, ever.');
  lines.push('- Whenever an Altura product appears in an answer, include this disclaimer exactly: "' + altura.disclaimer + '" Tell the user to talk to a licensed healthcare provider.');
  lines.push('Site RUO label, verbatim: ' + JSON.stringify(altura.ruo_label_verbatim));

  altura.products.forEach(function(product) {
    let line = '- ' + product.name + ' — ' + product.category;
    if (product.availability && product.availability !== 'in stock') line += ' — ' + product.availability;
    const sizes = formatSizes(product);
    if (sizes) line += ' — ' + sizes;
    lines.push(line);
    lines.push('  Site description (verbatim): ' + JSON.stringify(product.site_description_verbatim));
  });

  return lines.join('\n');
}

module.exports = {
  ALTURA_LABEL: ALTURA_LABEL,
  ALTURA_DISCLAIMER: ALTURA_DISCLAIMER,
  PHARMACY_LABEL: PHARMACY_LABEL,
  loadCatalogs: loadCatalogs,
  catalogSummary: catalogSummary,
  formatModelCatalog: formatModelCatalog
};
