// Compare saved lab dates. Numbers only. No interpretation.
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LabCompare = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function finiteNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (value == null) return null;
    var text = String(value).replace(/,/g, '').trim();
    if (!text || !/^-?\d+(?:\.\d+)?/.test(text)) return null;
    var n = Number(text);
    return isFinite(n) ? n : null;
  }

  function labNumber(value) {
    var direct = finiteNumber(value);
    if (direct != null) return direct;
    var match = String(value == null ? '' : value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    var n = Number(match[0]);
    return isFinite(n) ? n : null;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function dayKey(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function markerKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function canonicalUnit(unit) {
    return String(unit || '').trim().toLowerCase().replace(/[μµ]/g, 'u').replace(/\s+/g, '');
  }

  function formatNumber(n) {
    if (n == null || !isFinite(n)) return '';
    var rounded = Math.round(n * 100) / 100;
    return String(rounded);
  }

  function rangeStatus(numeric, refLow, refHigh) {
    if (refLow == null || refHigh == null || !(refHigh >= refLow)) return '';
    if (numeric == null || !isFinite(numeric)) return '';
    if (numeric >= refLow && numeric <= refHigh) return 'within';
    return 'outside';
  }

  function statusLabel(status) {
    if (status === 'within') return 'Within saved reference range';
    if (status === 'outside') return 'Outside saved reference range';
    return '';
  }

  function changeText(current, previous, unitA, unitB) {
    if (current == null || previous == null || !isFinite(current) || !isFinite(previous)) return '';
    if (canonicalUnit(unitA) !== canonicalUnit(unitB) && (canonicalUnit(unitA) || canonicalUnit(unitB))) return 'Units differ';
    var diff = Math.round((current - previous) * 100) / 100;
    if (diff === 0) return 'no change';
    var arrow = diff > 0 ? '↑' : '↓';
    var abs = formatNumber(Math.abs(diff));
    var pct = '';
    if (previous !== 0) {
      var p = Math.round((Math.abs(diff) / Math.abs(previous)) * 1000) / 10;
      pct = ' (' + formatNumber(p) + '%)';
    }
    return arrow + ' changed by ' + abs + pct;
  }

  function sortedLabs(labs) {
    return (labs || []).filter(function(lab) { return lab && lab.date; }).slice().sort(function(a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  }

  function datesFromLabs(labs) {
    var seen = {};
    var out = [];
    sortedLabs(labs).forEach(function(lab) {
      if (!lab.biomarkers || !lab.biomarkers.length) return;
      var day = dayKey(lab.date);
      if (!day || seen[day]) return;
      seen[day] = true;
      out.push({ day: day, iso: lab.date });
    });
    return out;
  }

  function defaultPair(dates) {
    if (!dates || !dates.length) return { a: '', b: '' };
    if (dates.length === 1) return { a: dates[0].day, b: '' };
    return { a: dates[0].day, b: dates[dates.length - 1].day };
  }

  function cellFromItem(item) {
    if (!item) return null;
    var numeric = labNumber(item.value);
    var refLow = finiteNumber(item.refLow);
    var refHigh = finiteNumber(item.refHigh);
    if (refLow == null || refHigh == null || refHigh < refLow) {
      refLow = null;
      refHigh = null;
    }
    return {
      text: String(item.value == null ? '' : item.value),
      numeric: numeric,
      unit: String(item.unit || ''),
      refLow: refLow,
      refHigh: refHigh,
      status: rangeStatus(numeric, refLow, refHigh)
    };
  }

  function mergeDay(labs, day) {
    var map = {};
    var order = [];
    sortedLabs(labs).forEach(function(lab) {
      if (dayKey(lab.date) !== day) return;
      (lab.biomarkers || []).forEach(function(item) {
        var key = markerKey(item && item.name);
        if (!key) return;
        if (!map[key]) order.push(key);
        map[key] = item;
      });
    });
    return { map: map, order: order };
  }

  function sharedUnit(a, b) {
    if (a && b) {
      if (canonicalUnit(a.unit) === canonicalUnit(b.unit)) return a.unit || b.unit;
      return '';
    }
    if (a) return a.unit;
    if (b) return b.unit;
    return '';
  }

  function rowChanged(a, b) {
    if (!a || !b) return true;
    if (canonicalUnit(a.unit) !== canonicalUnit(b.unit) && (canonicalUnit(a.unit) || canonicalUnit(b.unit))) return true;
    if (a.numeric != null && b.numeric != null) return a.numeric !== b.numeric;
    return String(a.text) !== String(b.text);
  }

  function buildRows(labs, dayA, dayB) {
    var left = mergeDay(labs, dayA);
    var right = mergeDay(labs, dayB);
    var seen = {};
    var keys = [];
    left.order.concat(right.order).forEach(function(key) {
      if (seen[key]) return;
      seen[key] = true;
      keys.push(key);
    });
    return keys.map(function(key) {
      var aItem = left.map[key] || null;
      var bItem = right.map[key] || null;
      var source = aItem || bItem;
      var a = cellFromItem(aItem);
      var b = cellFromItem(bItem);
      var group = '';
      if (aItem && aItem.panel) group = String(aItem.panel);
      else if (bItem && bItem.panel) group = String(bItem.panel);
      return {
        key: key,
        name: String((source && source.name) || key),
        unit: sharedUnit(a, b),
        group: group,
        a: a,
        b: b,
        change: (a && b && a.numeric != null && b.numeric != null) ? changeText(b.numeric, a.numeric, a.unit, b.unit) : '',
        changed: rowChanged(a, b),
        outOfRange: !!((a && a.status === 'outside') || (b && b.status === 'outside'))
      };
    });
  }

  function filterRows(rows, filter) {
    var list = rows || [];
    if (filter === 'changed') return list.filter(function(row) { return row.changed; });
    if (filter === 'out') return list.filter(function(row) { return row.outOfRange; });
    return list.slice();
  }

  function sortRows(rows, order) {
    var rank = {};
    (order || []).forEach(function(name, index) { rank[name] = index; });
    return (rows || []).slice().sort(function(a, b) {
      var ra = rank[a.group] == null ? 999 : rank[a.group];
      var rb = rank[b.group] == null ? 999 : rank[b.group];
      if (ra !== rb) return ra - rb;
      var an = String(a.name || '').toLowerCase();
      var bn = String(b.name || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
  }

  function groupRows(rows) {
    var list = rows || [];
    var any = false;
    list.forEach(function(row) { if (row.group) any = true; });
    if (!any) return [{ name: '', rows: list.slice() }];
    var groups = [];
    var index = {};
    list.forEach(function(row) {
      var name = row.group || 'Other';
      if (index[name] == null) {
        index[name] = groups.length;
        groups.push({ name: name, rows: [] });
      }
      groups[index[name]].rows.push(row);
    });
    return groups;
  }

  function yearModel(labs) {
    var dates = datesFromLabs(labs);
    var map = {};
    var order = [];
    sortedLabs(labs).forEach(function(lab) {
      var day = dayKey(lab.date);
      if (!day) return;
      (lab.biomarkers || []).forEach(function(item) {
        var key = markerKey(item && item.name);
        if (!key) return;
        if (!map[key]) {
          map[key] = {
            key: key,
            name: String(item.name),
            unit: String(item.unit || ''),
            group: item.panel ? String(item.panel) : '',
            cells: {}
          };
          order.push(key);
        }
        var row = map[key];
        if (item.unit) row.unit = String(item.unit);
        if (!row.group && item.panel) row.group = String(item.panel);
        row.cells[day] = cellFromItem(item);
        row.name = String(item.name || row.name);
      });
    });
    var rows = order.map(function(key) { return map[key]; });
    return { dates: dates, rows: rows };
  }

  return {
    dayKey: dayKey,
    markerKey: markerKey,
    formatNumber: formatNumber,
    rangeStatus: rangeStatus,
    statusLabel: statusLabel,
    changeText: changeText,
    datesFromLabs: datesFromLabs,
    defaultPair: defaultPair,
    buildRows: buildRows,
    filterRows: filterRows,
    sortRows: sortRows,
    groupRows: groupRows,
    yearModel: yearModel
  };
});
