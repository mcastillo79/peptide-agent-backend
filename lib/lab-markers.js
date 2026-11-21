// Bloodwork markers only. Supplement-facts doses (mg, mcg, IU) are not labs.
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LabMarkers = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  var DOSE_UNIT = /^(mg|mcg|ug|g|iu|i\.?u\.?|milligram|milligrams|microgram|micrograms|gram|grams|cfu)$/;
  var DOSE_TAIL = /\/(serving|servings|serv|cap|caps|capsule|capsules|tablet|tablets|tab|tabs|softgel|softgels|gummy|gummies|drop|drops|scoop|scoops|dose|doses|day|daily)$/;
  var PLAIN_LAB = { fl: 1, pg: 1, ratio: 1, sec: 1, seconds: 1, s: 1 };

  function canonicalUnit(unit) {
    return String(unit || '').trim().toLowerCase().replace(/[μµ]/g, 'u').replace(/\s+/g, '');
  }

  function isPercentUnit(unit) {
    var u = canonicalUnit(unit);
    return u === '%' || u === 'percent' || u === 'pct';
  }

  function isDoseUnit(unit) {
    var u = canonicalUnit(unit);
    return !!u && DOSE_UNIT.test(u);
  }

  function isLabUnit(unit) {
    var u = canonicalUnit(unit);
    if (!u || isDoseUnit(u)) return false;
    if (isPercentUnit(u)) return true;
    if (PLAIN_LAB[u]) return true;
    if (u.indexOf('/') === -1) return false;
    if (DOSE_TAIL.test(u)) return false;
    return true;
  }

  function isStrictConcentration(unit) {
    return isLabUnit(unit) && !isPercentUnit(unit);
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

  function isLabMarker(item) {
    if (!item || typeof item !== 'object') return false;
    var name = String(item.name || item.marker || '').trim();
    var value = String(item.value == null ? '' : item.value).trim();
    if (name.length < 2 || !value) return false;
    if (isDoseUnit(item.unit)) return false;
    if (!isLabUnit(item.unit)) return false;
    return true;
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

  function normName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function nameMatchesProduct(markerName, names) {
    var left = normName(markerName);
    if (!left || !names || !names.length) return false;
    for (var i = 0; i < names.length; i++) {
      var right = normName(names[i]);
      if (!right) continue;
      if (left === right) return true;
      var shortOne = left.length <= right.length ? left : right;
      var longOne = left.length <= right.length ? right : left;
      if (shortOne.length < 8) continue;
      var re = new RegExp('(?:^| )' + escapeRegExp(shortOne) + '(?: |$)');
      if (re.test(longOne)) return true;
    }
    return false;
  }

  function sourceBlob(lab) {
    if (!lab || typeof lab !== 'object') return '';
    var files = Array.isArray(lab.filenames) ? lab.filenames.join(' ') : '';
    return String(lab.summary || '') + '\n' + files;
  }

  // Hide supplement doses already stored in labHistory. Real concentration
  // results stay visible, and nothing here deletes the saved entry.
  function markerHiddenFromLabs(item, lab, names) {
    if (!isLabMarker(item)) return true;
    if (nameMatchesProduct(item.name, names) && !isStrictConcentration(item.unit)) return true;
    if (looksLikeSupplementLabel(sourceBlob(lab)) && !isStrictConcentration(item.unit)) return true;
    return false;
  }

  return {
    canonicalUnit: canonicalUnit,
    isDoseUnit: isDoseUnit,
    isLabUnit: isLabUnit,
    isStrictConcentration: isStrictConcentration,
    isLabMarker: isLabMarker,
    hasReferenceRange: hasReferenceRange,
    looksLikeSupplementLabel: looksLikeSupplementLabel,
    filterLabMarkers: filterLabMarkers,
    nameMatchesProduct: nameMatchesProduct,
    markerHiddenFromLabs: markerHiddenFromLabs
  };
});
