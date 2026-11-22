// Stack items parsed from a routine-style reply.
// Side-effect, expectation, and instruction lines are not items.
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RoutineStack = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  var SECTION_SKIP = [
    /what\s+to\s+expect/,
    /side[\s-]+effects?/,
    /\bunlikely\b/,
    /\bpossible\b/,
    /\bwarnings?\b/,
    /\bcaution\b/,
    /\brisks?\b/,
    /\bbenefits?\b/,
    /\bbest\s+for\b/,
    /\bpros\b/,
    /\bcons\b/,
    /\bnotes?\b/,
    /\btips?\b/,
    /\bsigns?\b/,
    /\bsymptoms?\b/,
    /\bavoid\b/,
    /\bif\s+you\b/,
    /\btroubleshoot/,
    /\breconstitution\b/,
    /\bstorage\b/,
    /\bwhy\b/,
    /how\s+it\s+works/,
    /\bsummary\b/,
    /\bsources?\b/
  ];

  var GENERIC_LABELS = {
    'best for': 1,
    pros: 1,
    cons: 1,
    note: 1,
    notes: 1,
    tip: 1,
    tips: 1,
    goal: 1,
    goals: 1,
    why: 1,
    cost: 1,
    costs: 1,
    result: 1,
    results: 1,
    benefit: 1,
    benefits: 1,
    expect: 1,
    expectation: 1,
    expectations: 1
  };

  var NAME_VERB = /^(?:reduc(?:e|ed|ing)|rotat(?:e|ed|ing)|tak(?:e|es|ing|en)|stop(?:s|ped|ping)?|increas(?:e|ed|ing)|resum(?:e|ed|ing)|lower(?:s|ed|ing)?|rais(?:e|ed|ing)|decreas(?:e|ed|ing)|discontinu(?:e|ed|ing)|if|then|when)\b/i;

  var DOSE_RE = /\d+(?:\.\d+)?(?:\s*[-\u2013\u2014]\s*\d+(?:\.\d+)?)?\s*(?:mcg|mg|µg|μg|ug|iu|mls?|grams?|g|capsules?|caps?|tablets?|tabs?|drops?|scoops?|units?)\b(?!\/)/i;

  var TIMING_RE = [
    /\b\d+\s*[-\u2013\u2014]\s*\d+\s*x\b/i,
    /\b\d+\s*x\b/i,
    /\b(?:daily|weekly|nightly|monthly)\b/i,
    /\b(?:morning|evening|bedtime)\b/i,
    /\bbefore\s+bed\b/i,
    /\bevery\s+other\s+day\b/i,
    /\bevery\s+\d+\s*(?:hours?|hrs?|days?|weeks?)\b/i,
    /\b(?:a|p)\.?\s*m\.?\b/i,
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/,
    /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?(?:\s*\/\s*(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?)+\b/i,
    /\b[mtwrfsu](?:\s*\/\s*[mtwrfsu])+\b/i
  ];

  var ADJUST_RE = /\b(?:reduce|increase|lower|raise|drop|cut|decrease)\s+to\b|\bthen\s+resume\b/i;

  function routineSourceText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(function(part) {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      }).join('\n');
    }
    return '';
  }

  function routineHeaderText(line) {
    var match = String(line || '').trim().match(/^\*\*([^*]+)\*\*\s*:?\s*$/);
    if (!match) return '';
    return match[1].replace(/\s*:\s*$/, '').trim();
  }

  function routineBulletBody(line) {
    var match = String(line || '').trim().match(/^[-*•–—]\s+(.+)$/);
    if (!match) return '';
    return match[1].trim();
  }

  function colonOutsideParens(text) {
    var depth = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '(') depth += 1;
      else if (ch === ')' && depth) depth -= 1;
      else if (ch === ':' && depth === 0) return i;
    }
    return -1;
  }

  function splitTimeFromDetails(details) {
    var text = String(details || '');
    if (!text) return null;
    var re = /(?:\s[—–-]\s*|[—–]\s*)(\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)|\d{1,2}:\d{2})\b/gi;
    var match = null;
    var found;
    while ((found = re.exec(text))) match = found;
    if (!match) return null;
    return {
      dose: text.slice(0, match.index).replace(/[\s—–-]+$/g, '').trim(),
      time: match[1].replace(/\s+/g, ' ').trim()
    };
  }

  function frequencyPhrase(text) {
    var source = String(text || '');
    if (!source) return '';
    var patterns = [
      /\b\d+\s*[–-]\s*\d+\s*x\s*(?:daily|weekly|a\s+week|per\s+week|a\s+day|per\s+day)\b/i,
      /\b\d+\s*x\s*(?:daily|weekly|a\s+week|per\s+week|a\s+day|per\s+day|\/day|\/week)\b/i,
      /\b(?:once|twice|three\s+times|\d+\s+times)\s+(?:daily|a\s+day|per\s+day|weekly|a\s+week|per\s+week)\b/i,
      /\bevery\s+other\s+day\b/i,
      /\bevery\s+day\b/i,
      /\b(?:daily|weekly|nightly)\b/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var found = source.match(patterns[i]);
      if (found) return found[0].replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function parseRoutineBullet(body, header) {
    var text = String(body || '').replace(/\*\*/g, '').trim();
    if (!text) return null;
    var name = '';
    var details = '';
    var colon = colonOutsideParens(text);
    if (colon > 0) {
      name = text.slice(0, colon).trim();
      details = text.slice(colon + 1).trim();
    } else {
      var wrapped = text.match(/^([^():]+?)\s*\(([^)]*)\)\s*(.*)$/);
      if (!wrapped) return null;
      name = wrapped[1].trim();
      details = wrapped[2].trim();
      var tail = wrapped[3].trim();
      if (tail) details = details ? (details + ' ' + tail) : tail;
    }
    if (!name || !/[A-Za-z0-9]/.test(name)) return null;
    var split = splitTimeFromDetails(details);
    var dose = split ? split.dose : details;
    var schedule = frequencyPhrase(details) || header;
    return { name: name, dose: dose, time: split ? split.time : '', group: header, schedule: schedule };
  }

  function routineSectionSkipped(header) {
    var text = String(header || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!text) return false;
    for (var i = 0; i < SECTION_SKIP.length; i++) {
      if (SECTION_SKIP[i].test(text)) return true;
    }
    return false;
  }

  function genericLabel(name) {
    var key = String(name || '').toLowerCase().replace(/[:.]+$/g, '').replace(/\s+/g, ' ').trim();
    return !!GENERIC_LABELS[key];
  }

  function plausibleItemName(name) {
    var text = String(name || '').replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z]/.test(text)) return false;
    var words = text.split(' ');
    if (words.length > 6) return false;
    if (NAME_VERB.test(text)) return false;
    return true;
  }

  function startsWithOutcomeMark(text) {
    var plain = String(text || '').replace(/\*\*/g, '').trim();
    return /^(?:✅|❌|⚠|✔️|✔|✖️|✖|✘)(?:\uFE0F)?/.test(plain);
  }

  function firstMatchIndex(text, re) {
    var flags = re.ignoreCase ? 'i' : '';
    if (re.global) flags += 'g';
    var copy = new RegExp(re.source, flags);
    var found = copy.exec(text);
    return found ? found.index : -1;
  }

  function doseIndex(text) {
    var re = new RegExp(DOSE_RE.source, 'gi');
    var match;
    while ((match = re.exec(text))) {
      var before = text.slice(Math.max(0, match.index - 32), match.index);
      if (/\b(?:reduce|increase|lower|raise|drop|cut|decrease)\s+to\s*$/i.test(before)) continue;
      return match.index;
    }
    return -1;
  }

  function timingIndex(text) {
    var at = -1;
    for (var i = 0; i < TIMING_RE.length; i++) {
      var found = firstMatchIndex(text, TIMING_RE[i]);
      if (found >= 0 && (at < 0 || found < at)) at = found;
    }
    return at;
  }

  function isAdjustmentLine(text) {
    var source = String(text || '');
    if (ADJUST_RE.test(source)) return true;
    if (/^\s*if\b/i.test(source)) return true;
    var ifAt = firstMatchIndex(source, /\bif\b/i);
    if (ifAt < 0) return false;
    var doseAt = doseIndex(source);
    var timeAt = timingIndex(source);
    var signal = -1;
    if (doseAt >= 0) signal = doseAt;
    if (timeAt >= 0 && (signal < 0 || timeAt < signal)) signal = timeAt;
    return signal < 0 || ifAt < signal;
  }

  function hasStackSignal(text) {
    return doseIndex(text) >= 0 || timingIndex(text) >= 0;
  }

  // header + bullet body -> stack item, or null when the line is not one.
  function routineStackCandidate(header, body) {
    if (routineSectionSkipped(header)) return null;
    var text = String(body || '').replace(/\*\*/g, '').trim();
    if (!text) return null;
    if (startsWithOutcomeMark(text)) return null;
    if (isAdjustmentLine(text)) return null;
    var parsed = parseRoutineBullet(text, header);
    if (!parsed || !parsed.name) return null;
    if (genericLabel(parsed.name)) return null;
    if (!plausibleItemName(parsed.name)) return null;
    if (!hasStackSignal(text)) return null;
    return parsed;
  }

  function parseRoutineCandidates(content) {
    var raw = routineSourceText(content).replace(/\r\n/g, '\n');
    if (!raw.trim()) return [];
    var lines = raw.split('\n');
    var header = '';
    var items = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var nextHeader = routineHeaderText(line);
      if (nextHeader) {
        header = nextHeader;
        continue;
      }
      if (!header) continue;
      var body = routineBulletBody(line);
      if (!body) continue;
      var parsed = routineStackCandidate(header, body);
      if (parsed && parsed.name) items.push(parsed);
    }
    return items;
  }

  function parseRoutineReply(content) {
    var items = parseRoutineCandidates(content);
    if (!items || items.length < 2) return null;
    return items;
  }

  return {
    routineStackCandidate: routineStackCandidate,
    parseRoutineCandidates: parseRoutineCandidates,
    parseRoutineReply: parseRoutineReply
  };
});
