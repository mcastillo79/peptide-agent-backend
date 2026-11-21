// Bloodwork markers only. Supplement doses and peptide or compound names are not labs.
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LabMarkers = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  var DOSE_UNIT = /^(mg|mcg|ug|g|iu|i\.?u\.?|milligram|milligrams|microgram|micrograms|gram|grams|cfu|unit|units)$/;
  var DOSE_TAIL = /\/(serving|servings|serv|cap|caps|capsule|capsules|tablet|tablets|tab|tabs|softgel|softgels|gummy|gummies|drop|drops|scoop|scoops|dose|doses|day|daily)$/;

  var LAB_UNITS = {
    '%': 1, percent: 1, pct: 1,
    'ng/ml': 1, 'ng/dl': 1, 'ng/l': 1,
    'mg/dl': 1, 'mg/l': 1,
    'pg/ml': 1, 'pg/dl': 1,
    'mcg/dl': 1, 'ug/dl': 1, 'mcg/l': 1, 'ug/l': 1,
    'g/dl': 1, 'g/l': 1,
    'miu/l': 1, 'miu/ml': 1, 'uiu/ml': 1, 'iu/l': 1, 'iu/ml': 1, 'u/l': 1, 'u/ml': 1,
    'nmol/l': 1, 'umol/l': 1, 'mmol/l': 1, 'pmol/l': 1,
    'k/ul': 1, 'm/ul': 1, 'thou/ul': 1, 'mill/ul': 1, 'cells/ul': 1,
    'x10^3/ul': 1, 'x10^6/ul': 1, 'x10^9/l': 1, 'x10^12/l': 1,
    '10^3/ul': 1, '10^6/ul': 1, '10^9/l': 1, '10^12/l': 1,
    fl: 1, pg: 1, ratio: 1, sec: 1, seconds: 1, s: 1,
    'ml/min': 1, 'ml/min/1.73': 1, 'ml/min/1.73m2': 1,
    'mm/hr': 1, 'mm/h': 1
  };

  var PANELS = [
    { id: 'metabolic', label: 'Metabolic' },
    { id: 'lipids', label: 'Lipids' },
    { id: 'cbc', label: 'CBC' },
    { id: 'thyroid', label: 'Thyroid' },
    { id: 'hormones', label: 'Hormones' },
    { id: 'vitamins', label: 'Vitamins & Minerals' },
    { id: 'other', label: 'Other' }
  ];

  var MARKERS = {};
  var BLOCKED = [];

  function normName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function addMarkers(panelId, names) {
    names.forEach(function(name) {
      var key = normName(name);
      if (key) MARKERS[key] = panelId;
    });
  }

  addMarkers('cbc', [
    'wbc', 'white blood cells', 'white blood cell count', 'leukocytes', 'leukocyte count',
    'rbc', 'red blood cells', 'red blood cell count', 'erythrocytes',
    'hemoglobin', 'hgb', 'hb', 'hematocrit', 'hct',
    'platelets', 'platelet count', 'plt',
    'mcv', 'mch', 'mchc', 'rdw', 'rdw cv', 'rdw sd', 'mpv',
    'neutrophils', 'neutrophil', 'absolute neutrophils', 'lymphocytes', 'lymphocyte',
    'monocytes', 'monocyte', 'eosinophils', 'eosinophil', 'basophils', 'basophil',
    'immature granulocytes', 'nrbc', 'reticulocytes', 'reticulocyte count'
  ]);
  addMarkers('metabolic', [
    'glucose', 'fasting glucose', 'glucose fasting',
    'bun', 'blood urea nitrogen', 'urea nitrogen', 'urea',
    'creatinine', 'serum creatinine', 'creatinine serum',
    'egfr', 'gfr', 'estimated gfr',
    'sodium', 'potassium', 'chloride', 'carbon dioxide', 'co2', 'bicarbonate',
    'calcium', 'total protein', 'protein total', 'albumin', 'globulin',
    'a g ratio', 'ag ratio', 'albumin globulin ratio',
    'bilirubin', 'total bilirubin', 'direct bilirubin', 'indirect bilirubin',
    'alkaline phosphatase', 'alp', 'alt', 'alanine aminotransferase', 'sgpt',
    'ast', 'aspartate aminotransferase', 'sgot',
    'anion gap', 'uric acid', 'hba1c', 'hemoglobin a1c', 'a1c', 'glycated hemoglobin', 'hgb a1c',
    'ggt', 'gamma gt', 'gamma glutamyl transferase'
  ]);
  addMarkers('lipids', [
    'cholesterol', 'total cholesterol',
    'ldl', 'ldl c', 'ldl cholesterol', 'ldl cholesterol calc', 'ldl c calculated',
    'hdl', 'hdl c', 'hdl cholesterol',
    'triglycerides', 'triglyceride',
    'vldl', 'non hdl', 'non hdl cholesterol',
    'apolipoprotein b', 'apob', 'apo b',
    'lipoprotein a', 'lp a', 'lpa',
    'chol hdl ratio', 'cholesterol hdl ratio'
  ]);
  addMarkers('thyroid', [
    'tsh', 'thyroid stimulating hormone',
    'free t4', 'ft4', 't4 free', 'free thyroxine',
    'free t3', 'ft3', 't3 free', 'free triiodothyronine',
    't4', 'thyroxine', 'total t4',
    't3', 'triiodothyronine', 'total t3',
    'reverse t3', 'rt3',
    'tpo', 'tpo antibody', 'thyroid peroxidase', 'thyroid peroxidase antibody',
    'thyroglobulin', 'thyroglobulin antibody'
  ]);
  addMarkers('hormones', [
    'testosterone', 'total testosterone', 'free testosterone',
    'estradiol', 'e2', 'progesterone',
    'dhea', 'dhea s', 'dhea sulfate',
    'cortisol', 'fsh', 'lh', 'shbg',
    'prolactin', 'psa', 'free psa',
    'igf 1', 'igf1', 'somatomedin c',
    'insulin', 'fasting insulin', 'amh', 'pregnenolone', 'pth', 'parathyroid hormone'
  ]);
  addMarkers('vitamins', [
    'vitamin d', '25 oh vitamin d', 'vitamin d 25 oh', '25 hydroxy vitamin d',
    'vitamin d 25 hydroxy', '25 oh d', '25 hydroxyvitamin d',
    'vitamin b12', 'b12', 'cobalamin',
    'folate', 'folic acid', 'vitamin b9', 'vitamin b6',
    'ferritin', 'iron', 'serum iron', 'tibc', 'transferrin', 'transferrin saturation', 'iron saturation',
    'magnesium', 'serum magnesium', 'zinc', 'serum zinc', 'copper', 'selenium',
    'homocysteine', 'glutathione'
  ]);
  addMarkers('other', [
    'crp', 'hs crp', 'c reactive protein', 'esr', 'sedimentation rate',
    'ldh', 'ck', 'creatine kinase', 'amylase', 'lipase',
    'inr', 'pt', 'ptt', 'aptt', 'fibrinogen', 'c peptide', 'cystatin c'
  ]);

  [
    'magnesium glycinate', 'magnesium citrate', 'magnesium oxide', 'magnesium threonate',
    'magnesium malate', 'magnesium taurate', 'magnesium bisglycinate',
    'vitamin d3', 'vitamin d 3', 'cholecalciferol',
    'vitamin c', 'ascorbic acid',
    'tirzepatide', 'tinipyridine', 'semaglutide', 'retatrutide', 'liraglutide', 'dulaglutide',
    'bpc 157', 'bpc157', 'tb 500', 'tb500', 'ipamorelin', 'cjc 1295', 'tesamorelin', 'sermorelin',
    'aod 9604', 'melanotan', 'pt 141', 'bremelanotide', 'epithalon', 'epitalon',
    'selank', 'semax', 'ghk cu', 'mots c', 'cagrilintide', 'nad+', 'nad plus',
    'lactoferrin', 'ferrous bisglycinate', 'bac water', 'bacteriostatic water'
  ].forEach(function(name) {
    var key = normName(name);
    if (key) BLOCKED.push(key);
  });

  function canonicalUnit(unit) {
    return String(unit || '').trim().toLowerCase()
      .replace(/[μµ]/g, 'u')
      .replace(/×/g, 'x')
      .replace(/²/g, '2')
      .replace(/³/g, '^3')
      .replace(/⁶/g, '^6')
      .replace(/\s+/g, '');
  }

  function isPercentUnit(unit) {
    var u = canonicalUnit(unit);
    return u === '%' || u === 'percent' || u === 'pct';
  }

  function isDoseUnit(unit) {
    var u = canonicalUnit(unit);
    if (!u || LAB_UNITS[u]) return false;
    return DOSE_UNIT.test(u);
  }

  function isLabUnit(unit) {
    var u = canonicalUnit(unit);
    if (!u || isDoseUnit(u) || DOSE_TAIL.test(u)) return false;
    if (LAB_UNITS[u]) return true;
    if (/^x?10\^\d+\/(ul|l)$/.test(u)) return true;
    if (/^ml\/min(\/1\.73(m2)?)?$/.test(u)) return true;
    return false;
  }

  function isStrictConcentration(unit) {
    return isLabUnit(unit) && !isPercentUnit(unit);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function hasPhrase(hay, needle) {
    if (!hay || !needle) return false;
    if (hay === needle) return true;
    return new RegExp('(?:^| )' + escapeRegExp(needle) + '(?: |$)').test(hay);
  }

  function isKnownLabName(name) {
    return !!MARKERS[normName(name)];
  }

  function isBlockedProductName(name) {
    var key = normName(name);
    if (!key) return false;
    for (var i = 0; i < BLOCKED.length; i++) {
      if (hasPhrase(key, BLOCKED[i])) return true;
    }
    return false;
  }

  function nameMatchesProduct(markerName, names) {
    var left = normName(markerName);
    if (!left || !names || !names.length) return false;
    for (var i = 0; i < names.length; i++) {
      var right = normName(names[i]);
      if (!right) continue;
      if (left === right) return true;
      if (hasPhrase(left, right) && right.length >= 4) return true;
      var shortOne = left.length <= right.length ? left : right;
      var longOne = left.length <= right.length ? right : left;
      if (shortOne.length < 8) continue;
      if (hasPhrase(longOne, shortOne)) return true;
    }
    return false;
  }

  function nameIsBlocked(name, names) {
    return isBlockedProductName(name) || nameMatchesProduct(name, names);
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (value == null) return null;
    var text = String(value).replace(/,/g, '').trim();
    if (!text || text.toLowerCase() === 'null' || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    var n = Number(text);
    return isFinite(n) ? n : null;
  }

  function hasReferenceRange(item) {
    if (!item) return false;
    var low = finiteNumber(item.refLow);
    var high = finiteNumber(item.refHigh);
    return low != null && high != null && high >= low;
  }

  function keepsKnownLab(name, unit) {
    return isKnownLabName(name) && isStrictConcentration(unit);
  }

  function isLabMarker(item) {
    if (!item || typeof item !== 'object') return false;
    var name = String(item.name || item.marker || '').trim();
    var value = String(item.value == null ? '' : item.value).trim();
    if (name.length < 2 || !value) return false;
    if (isDoseUnit(item.unit)) return false;
    if (nameIsBlocked(name) && !keepsKnownLab(name, item.unit)) return false;
    if (isKnownLabName(name)) {
      if (!canonicalUnit(item.unit)) return true;
      return isLabUnit(item.unit);
    }
    return isLabUnit(item.unit);
  }

  function looksLikeSupplementLabel(text) {
    var t = String(text || '').toLowerCase();
    if (!t.trim()) return false;
    if (/supplement[\s_-]*facts/.test(t)) return true;
    if (/nutrition[\s_-]*facts/.test(t)) return true;
    if (/amount per serving/.test(t)) return true;
    if (/proprietary blend/.test(t)) return true;
    if (/serving size/.test(t) && /%\s*dv|daily value/.test(t)) return true;
    return false;
  }

  function filterLabMarkers(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isLabMarker);
  }

  function sourceBlob(lab) {
    if (!lab || typeof lab !== 'object') return '';
    var files = Array.isArray(lab.filenames) ? lab.filenames.join(' ') : '';
    return String(lab.summary || '') + '\n' + files;
  }

  // Hide anything that is not a saved bloodwork marker. Real dictionary
  // analytes with a concentration unit stay visible. Nothing here deletes storage.
  function markerHiddenFromLabs(item, lab, names) {
    if (!item || typeof item !== 'object') return true;
    var name = String(item.name || item.marker || '').trim();
    var value = String(item.value == null ? '' : item.value).trim();
    if (name.length < 2 || !value) return true;
    if (isDoseUnit(item.unit)) return true;
    var known = isKnownLabName(name);
    var blocked = nameIsBlocked(name, names);
    var label = looksLikeSupplementLabel(sourceBlob(lab));
    if (label && !(known && isStrictConcentration(item.unit) && !blocked)) return true;
    if (blocked && !keepsKnownLab(name, item.unit)) return true;
    if (known) {
      if (!canonicalUnit(item.unit)) return false;
      return !isLabUnit(item.unit);
    }
    if (!isLabUnit(item.unit)) return true;
    return false;
  }

  function panelCatalog() {
    return PANELS.map(function(panel) { return { id: panel.id, label: panel.label }; });
  }

  function panelById(id) {
    for (var i = 0; i < PANELS.length; i++) {
      if (PANELS[i].id === id) return { id: PANELS[i].id, label: PANELS[i].label };
    }
    return { id: 'other', label: 'Other' };
  }

  function hintedPanelId(hint) {
    var text = normName(hint);
    if (!text) return '';
    if (/lipid/.test(text)) return 'lipids';
    if (/cbc|blood count|hematol/.test(text)) return 'cbc';
    if (/thyroid/.test(text)) return 'thyroid';
    if (/hormone/.test(text)) return 'hormones';
    if (/vitamin|mineral/.test(text)) return 'vitamins';
    if (/metabolic|chemistry|chem panel|cmp|bmp/.test(text)) return 'metabolic';
    return '';
  }

  function panelFor(name, hint) {
    var id = MARKERS[normName(name)] || hintedPanelId(hint) || 'other';
    return panelById(id);
  }

  function excludedMarkers(labs, names) {
    var out = [];
    var seen = {};
    (labs || []).forEach(function(lab) {
      (lab.biomarkers || []).forEach(function(item) {
        if (!item || !item.name) return;
        if (!markerHiddenFromLabs(item, lab, names)) return;
        var key = normName(item.name);
        if (!key || seen[key]) return;
        seen[key] = true;
        out.push({ name: String(item.name).trim(), key: key });
      });
    });
    out.sort(function(a, b) {
      if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;
      if (a.name.toLowerCase() > b.name.toLowerCase()) return 1;
      return 0;
    });
    return out;
  }

  return {
    canonicalUnit: canonicalUnit,
    isDoseUnit: isDoseUnit,
    isLabUnit: isLabUnit,
    isStrictConcentration: isStrictConcentration,
    isLabMarker: isLabMarker,
    isKnownLabName: isKnownLabName,
    isBlockedProductName: isBlockedProductName,
    hasReferenceRange: hasReferenceRange,
    looksLikeSupplementLabel: looksLikeSupplementLabel,
    filterLabMarkers: filterLabMarkers,
    nameMatchesProduct: nameMatchesProduct,
    markerHiddenFromLabs: markerHiddenFromLabs,
    normName: normName,
    panelCatalog: panelCatalog,
    panelFor: panelFor,
    excludedMarkers: excludedMarkers
  };
});
