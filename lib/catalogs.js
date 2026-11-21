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

const STACK_ALTURA_LABEL = 'Altura research-use-only';
const STACK_PHARMACY_LABEL = 'Licensed pharmacy compound, Rx';
const STACK_USER_LABEL = "You said you're taking this";
const STACK_CARD_DISCLAIMER = 'Third-party research-use-only product (Altura). Not medical advice. Not for human consumption.';
const AMBIGUOUS_NAMES = new Set(['glow', 'summit', 'sunset', 'reforge', 'traverse', 'basecamp', 'riptide', 'everest', 'vip']);
const MENTION_STOPWORDS = new Set(['a', 'an', 'the', 'was', 'were', 'is', 'are', 'am', 'be', 'been', 'nice', 'about', 'what', 'should', 'know', 'for', 'with', 'my', 'your', 'please', 'help', 'tell', 'and', 'or', 'of', 'to', 'in', 'on', 'it', 'them', 'this', 'that', 'some', 'just', 'really', 'also', 'too', 'very', 'good', 'bad', 'morning', 'night', 'daily', 'weekly', 'peptides', 'peptide', 'supplements', 'supplement', 'meds', 'medications', 'medication', 'nothing', 'none', 'stuff']);

const EXTRA_ALIASES = {
  'ALT-EPITHALON': ['Epitalon'],
  'ALT-FOXO4': ['FOXO4', 'FOXO4-DRI', 'FOXO4 DRI'],
  'ALT-TB-500': ['Thymosin Beta-4', 'Thymosin Beta 4'],
  'ALT-THYMOSIN-ALPHA-1': ['Thymosin Alpha-1', 'Thymosin Alpha 1', 'TA-1'],
  'ALT-SS-31': ['Elamipretide'],
  'ALT-PT-141': ['Bremelanotide'],
  'ALT-IGF-1-LR3': ['IGF-1LR3', 'IGF1-LR3'],
  'ALT-BAC-WATER': ['BAC water'],
  'ALT-CJC-1295': ['CJC-1295'],
  'pharmacy:Retatrutide': ['RETA', 'Reta'],
  'pharmacy:TB-500 (Thymosin Beta-4)': ['Thymosin Beta-4', 'Thymosin Beta 4'],
  'pharmacy:CJC-1295 without DAC / Ipamorelin': ['CJC-1295/Ipamorelin', 'CJC-1295 + Ipamorelin']
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lettersOnly(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function productKey(product) {
  if (product.sku) return product.sku;
  return product.source + ':' + product.name;
}

function pushAlias(list, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < 3 || text.length > 80) return;
  if (!/[A-Za-z]/.test(text)) return;
  list.push(text);
}

function aliasesFor(product) {
  const found = [];
  pushAlias(found, product.name);
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(product.name);
  if (paren) {
    pushAlias(found, paren[1]);
    const inner = paren[2].trim();
    if (!/^no\s+dac$/i.test(inner) && /[A-Za-z]{3,}/.test(inner)) pushAlias(found, inner);
  }
  const seeded = found.slice();
  seeded.forEach(function(alias) {
    const spaced = alias.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (spaced !== alias) pushAlias(found, spaced);
    const compact = alias.replace(/[\s-]+/g, '');
    if (compact !== alias) pushAlias(found, compact);
  });
  (EXTRA_ALIASES[productKey(product)] || []).forEach(function(alias) {
    pushAlias(found, alias);
  });
  const unique = [];
  const seen = {};
  found.forEach(function(alias) {
    const key = alias.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    unique.push(alias);
  });
  return unique;
}

function sourceLabelFor(product) {
  if (product.source === 'altura') return STACK_ALTURA_LABEL;
  if (product.source === 'pharmacy') return STACK_PHARMACY_LABEL;
  return '';
}

function suggestionFromProduct(product) {
  const item = {
    id: product.source + ':' + (product.sku || product.name),
    name: product.name,
    source: product.source,
    sourceLabel: sourceLabelFor(product)
  };
  if (product.source === 'altura') item.disclaimer = STACK_CARD_DISCLAIMER;
  return item;
}

function buildMatchers(catalogs) {
  const matchers = [];
  [catalogs.altura, catalogs.pharmacy].forEach(function(catalog) {
    catalog.products.forEach(function(product) {
      aliasesFor(product).forEach(function(alias) {
        matchers.push({
          alias: alias,
          ambiguous: AMBIGUOUS_NAMES.has(lettersOnly(alias)),
          product: product,
          length: alias.length
        });
      });
    });
  });
  return matchers;
}

function findSpans(text, alias, sensitive) {
  const flags = sensitive ? 'g' : 'gi';
  const re = new RegExp('(^|[^A-Za-z0-9])(' + escapeRegExp(alias) + ')(?![A-Za-z0-9])', flags);
  const spans = [];
  let match;
  while ((match = re.exec(text))) {
    const start = match.index + match[1].length;
    spans.push({ start: start, end: start + match[2].length });
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return spans;
}

function matchCatalog(catalogs, text, options) {
  const source = String(text || '');
  if (!source.trim()) return [];
  const relaxAmbiguous = !!(options && options.ambiguousInsensitive);
  const hits = [];
  buildMatchers(catalogs).forEach(function(matcher) {
    const sensitive = matcher.ambiguous && !relaxAmbiguous;
    const forms = [matcher.alias];
    if (sensitive) {
      const upper = matcher.alias.toUpperCase();
      if (upper !== matcher.alias) forms.push(upper);
    }
    forms.forEach(function(form) {
      findSpans(source, form, sensitive).forEach(function(span) {
        hits.push({
          start: span.start,
          end: span.end,
          product: matcher.product
        });
      });
    });
  });
  hits.sort(function(a, b) {
    return (b.end - b.start) - (a.end - a.start) || a.start - b.start;
  });
  const kept = [];
  hits.forEach(function(hit) {
    const inside = kept.some(function(other) {
      return hit.start >= other.start && hit.end <= other.end && (hit.end - hit.start) < (other.end - other.start);
    });
    if (!inside) kept.push(hit);
  });
  kept.sort(function(a, b) {
    return a.start - b.start || sourceRank(a.product.source) - sourceRank(b.product.source);
  });
  const items = [];
  const seen = {};
  kept.forEach(function(hit) {
    const item = suggestionFromProduct(hit.product);
    if (seen[item.id]) return;
    seen[item.id] = true;
    items.push(item);
  });
  return items;
}

function sourceRank(source) {
  if (source === 'altura') return 0;
  if (source === 'pharmacy') return 1;
  return 2;
}

function addUnique(items, item) {
  if (items.some(function(existing) { return existing.id === item.id; })) return;
  items.push(item);
}

const TAKING_PATTERNS = [
  /(?:i['’]?m|i am|i['’]?ve been|ive been|we['’]?re|we are|currently|still)\s+(?:taking|using)\s+([^.\n?;!]{2,160})/gi,
  /(?:i['’]?ve been|ive been|i['’]?m|i am)\s+on\s+([^.\n?;!]{2,160})/gi,
  /\b(?:i|we)\s+(?:take|use|started)\s+([^.\n?;!]{2,160})/gi,
  /(?:my|our)\s+(?:current\s+)?stack\s*(?:is|includes|:)\s+([^.\n?;!]{2,160})/gi
];

function extractTakingFragments(userText) {
  const fragments = [];
  TAKING_PATTERNS.forEach(function(pattern) {
    pattern.lastIndex = 0;
    let match;
    const flags = new RegExp(pattern.source, pattern.flags);
    while ((match = flags.exec(String(userText || '')))) {
      String(match[1] || '').split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i).forEach(function(part) {
        const text = part.trim();
        if (text) fragments.push(text);
      });
      if (match.index === flags.lastIndex) flags.lastIndex += 1;
    }
  });
  return fragments;
}

function cleanMention(fragment) {
  let text = String(fragment || '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  text = text.replace(/^(?:a|an|the|some|my)\s+/i, '').trim();
  text = text.replace(/\s+(?:for|because|since|after|before|please|every|each|once|twice|daily|weekly|nightly)\b[\s\S]*$/i, '').trim();
  text = text.replace(/[.?!,;:]+$/g, '').trim();
  if (!text || text.length > 40) return '';
  const words = text.split(/\s+/);
  if (!words.length || words.length > 4) return '';
  if (words.some(function(word) { return MENTION_STOPWORDS.has(word.toLowerCase().replace(/[^a-z0-9]/g, '')); })) return '';
  if (!/[A-Za-z]/.test(text)) return '';
  return text;
}

function suggestStackItems(catalogs, reply, userText) {
  const items = [];
  matchCatalog(catalogs, reply).forEach(function(item) { addUnique(items, item); });
  matchCatalog(catalogs, userText).forEach(function(item) { addUnique(items, item); });
  extractTakingFragments(userText).forEach(function(fragment) {
    const cleaned = cleanMention(fragment);
    if (!cleaned) return;
    const relaxed = matchCatalog(catalogs, cleaned, { ambiguousInsensitive: true });
    if (relaxed.length) {
      relaxed.forEach(function(item) { addUnique(items, item); });
      return;
    }
    const id = 'mentioned:' + lettersOnly(cleaned);
    if (!id || id === 'mentioned:') return;
    if (items.some(function(item) { return lettersOnly(item.name) === lettersOnly(cleaned); })) return;
    addUnique(items, {
      id: id,
      name: cleaned,
      source: 'mentioned',
      sourceLabel: STACK_USER_LABEL
    });
  });
  return items.slice(0, 12).map(function(item) {
    const out = {
      id: item.id,
      name: item.name,
      source: item.source,
      sourceLabel: item.sourceLabel
    };
    if (item.disclaimer) out.disclaimer = item.disclaimer;
    return out;
  });
}

module.exports = {
  ALTURA_LABEL: ALTURA_LABEL,
  ALTURA_DISCLAIMER: ALTURA_DISCLAIMER,
  PHARMACY_LABEL: PHARMACY_LABEL,
  STACK_ALTURA_LABEL: STACK_ALTURA_LABEL,
  STACK_PHARMACY_LABEL: STACK_PHARMACY_LABEL,
  STACK_USER_LABEL: STACK_USER_LABEL,
  STACK_CARD_DISCLAIMER: STACK_CARD_DISCLAIMER,
  loadCatalogs: loadCatalogs,
  catalogSummary: catalogSummary,
  formatModelCatalog: formatModelCatalog,
  suggestStackItems: suggestStackItems,
  aliasesFor: aliasesFor
};
