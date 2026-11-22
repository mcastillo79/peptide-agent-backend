#!/usr/bin/env node
// Pure filter for "Add all to My Stack".
// Side-effect and expectation sections contribute nothing.
// A morning/bedtime routine contributes its dosed lines.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const stack = require('../lib/routine-stack');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function fail(message) {
  console.error('FAIL ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const NOISE = [
  '**Option B: Reduce to maintenance dose**',
  '- Best for: Cost savings, maintenance-phase immune support',
  '**What to Expect (Side Effects)**',
  '- \u2705 Nothing \u2014 silent efficacy',
  '- \u2705 Better sleep \u2014 immune system calming',
  '- \u2705 Reduced anxiety',
  '**Unlikely but possible (usually indicates dose too high or reconstitution issue)**',
  '- Mild local reaction at injection site \u2014 redness, itching',
  '- Mild systemic response \u2014 fatigue, body ache \u2014 reduce to 0.25 mg and then resume if it settles'
].join('\n');

const GOOD = [
  '**Morning**',
  '- BPC-157: 250 mcg \u2014 8:00 AM',
  '- TB-500: 2 mg \u2014 2x weekly',
  '**Bedtime**',
  '- Magnesium glycinate: 400 mg'
].join('\n');

const ROUTINE = [
  '**Your Updated Protocol**',
  '**Daily peptides:**',
  '- TA-1: 0.5 mg (0.1 mL) \u2014 7 AM \u2190 NEW, replacing the morning capsule',
  '- BPC-157: 500 mcg',
  '**2\u20133x weekly:**',
  '- TB-500: 2.5 mg',
  '**Acute mast cell support (while healing):**',
  '- Quercetin: 500 mg, 2x daily',
  '**Gut healing (ongoing):**',
  '- L-glutamine: 5\u201310 g daily'
].join('\n');

const noise = stack.parseRoutineCandidates(NOISE);
assert(noise.length === 0, 'side-effect sections produced ' + JSON.stringify(noise));
assert(stack.parseRoutineReply(NOISE) === null, 'side-effect reply should not show the button');

[
  ['Option B: Reduce to maintenance dose', 'Best for: Cost savings, maintenance-phase immune support'],
  ['What to Expect (Side Effects)', '\u2705 Nothing \u2014 silent efficacy'],
  ['What to Expect (Side Effects)', '\u2705 Better sleep \u2014 immune system calming'],
  ['What to Expect (Side Effects)', '\u2705 Reduced anxiety'],
  ['Unlikely but possible (usually indicates dose too high or reconstitution issue)', 'Mild local reaction at injection site \u2014 redness, itching'],
  ['Unlikely but possible (usually indicates dose too high or reconstitution issue)', 'Mild systemic response \u2014 fatigue, body ache \u2014 reduce to 0.25 mg and then resume if it settles'],
  ['What to Expect (Side Effects)', 'BPC-157: 250 mcg daily'],
  ['Daily peptides', 'Best for: 10 mg daily'],
  ['Daily peptides', '\u2705 BPC-157: 250 mcg'],
  ['Daily peptides', '\u274C Skip this: 250 mcg'],
  ['Daily peptides', '\u26A0\uFE0F Watch this: 1 mg daily'],
  ['Daily peptides', 'Reduce the dose: 0.25 mg daily'],
  ['Daily peptides', 'Increase to 1 mg daily'],
  ['Daily peptides', 'BPC-157: 250 mcg then resume tomorrow'],
  ['Daily peptides', 'If flushing starts, reduce to 0.25 mg'],
  ['Daily peptides', 'Mild local reaction at the injection site: 1 mg daily'],
  ['Notes', 'BPC-157: 250 mcg daily'],
  ['How it works', 'TB-500: 2 mg weekly']
].forEach(function(pair) {
  const got = stack.routineStackCandidate(pair[0], pair[1]);
  assert(got === null, 'kept a non-item ' + JSON.stringify(pair) + ' -> ' + JSON.stringify(got));
});

const good = stack.parseRoutineCandidates(GOOD);
assert(good.length === 3, 'expected 3 routine items, got ' + JSON.stringify(good));
assert(stack.parseRoutineReply(GOOD).length === 3, 'positive reply should show the button');
assert(good[0].name === 'BPC-157' && good[0].dose === '250 mcg' && good[0].time === '8:00 AM' && good[0].group === 'Morning' && good[0].schedule === 'Morning', 'BPC ' + JSON.stringify(good[0]));
assert(good[1].name === 'TB-500' && good[1].dose === '2 mg \u2014 2x weekly' && good[1].time === '' && good[1].schedule === '2x weekly' && good[1].group === 'Morning', 'TB-500 ' + JSON.stringify(good[1]));
assert(good[2].name === 'Magnesium glycinate' && good[2].dose === '400 mg' && good[2].time === '' && good[2].group === 'Bedtime' && good[2].schedule === 'Bedtime', 'magnesium ' + JSON.stringify(good[2]));

const kept = stack.routineStackCandidate('Option B: Reduce to maintenance dose', 'Thymosin Alpha-1: 0.5 mg \u2014 2x weekly');
assert(kept && kept.name === 'Thymosin Alpha-1' && kept.dose === '0.5 mg \u2014 2x weekly' && kept.schedule === '2x weekly', 'maintenance dose item ' + JSON.stringify(kept));

const mixed = stack.parseRoutineCandidates(NOISE + '\n**Bedtime**\n- Magnesium glycinate: 400 mg\n- Zinc: 25 mg, daily');
assert(mixed.map(function(item) { return item.name; }).join('|') === 'Magnesium glycinate|Zinc', 'mixed reply kept ' + JSON.stringify(mixed));

assert(stack.parseRoutineReply('**Daily:**\n- A: 1 mg') === null, 'one dosed line should not show the button');
const pair = stack.parseRoutineReply('**Daily:**\n- A: 1 mg\n- B: 2 mg');
assert(pair && pair.map(function(item) { return item.name; }).join('|') === 'A|B', 'two dosed lines should count ' + JSON.stringify(pair));
assert(stack.parseRoutineReply('- A: 1 mg\n- B: 2 mg\n- C: 3 mg') === null, 'bullets without a header should not count');

const routine = stack.parseRoutineReply(ROUTINE);
assert(routine && routine.length === 5, 'sample protocol ' + JSON.stringify(routine));
const byName = {};
routine.forEach(function(item) { byName[item.name] = item; });
assert(byName['TA-1'].dose === '0.5 mg (0.1 mL)' && byName['TA-1'].time === '7 AM' && byName['TA-1'].group === 'Daily peptides' && byName['TA-1'].schedule === 'Daily peptides', 'TA-1 ' + JSON.stringify(byName['TA-1']));
assert(byName['BPC-157'].dose === '500 mcg' && byName['BPC-157'].schedule === 'Daily peptides', 'BPC ' + JSON.stringify(byName['BPC-157']));
assert(byName['TB-500'].dose === '2.5 mg' && byName['TB-500'].group === '2\u20133x weekly' && byName['TB-500'].schedule === '2\u20133x weekly', 'TB ' + JSON.stringify(byName['TB-500']));
assert(byName['Quercetin'].dose === '500 mg, 2x daily' && byName['Quercetin'].schedule === '2x daily', 'quercetin ' + JSON.stringify(byName['Quercetin']));
assert(byName['L-glutamine'].dose === '5\u201310 g daily' && byName['L-glutamine'].schedule === 'daily', 'glutamine ' + JSON.stringify(byName['L-glutamine']));

const paren = stack.parseRoutineReply('**Evening:**\n- Magnesium (400 mg)\n- Vitamin D (5000 IU) \u2014 8 PM\n- Zinc (25 mg, daily)');
assert(paren && paren.length === 3, 'paren routine ' + JSON.stringify(paren));
assert(paren[0].name === 'Magnesium' && paren[0].dose === '400 mg' && paren[0].schedule === 'Evening', 'paren magnesium ' + JSON.stringify(paren[0]));
assert(paren[1].name === 'Vitamin D' && paren[1].dose === '5000 IU' && paren[1].time === '8 PM', 'paren D ' + JSON.stringify(paren[1]));
assert(paren[2].schedule === 'daily', 'paren zinc ' + JSON.stringify(paren[2]));

const nameless = stack.parseRoutineReply('**Daily:**\n- : missing\n- OK: 1 mg\n- Also (2 mg)\n- Third: 3 mg');
assert(nameless && nameless.map(function(item) { return item.name; }).join('|') === 'OK|Also|Third', 'nameless ' + JSON.stringify(nameless));

assert(stack.routineStackCandidate('Weekly', 'BPC-157: M/W/F').name === 'BPC-157', 'weekday timing');
assert(stack.routineStackCandidate('Night', 'Magnesium glycinate: before bed').name === 'Magnesium glycinate', 'before bed');
assert(stack.routineStackCandidate('Daily', 'TB-500: every 8 hours').name === 'TB-500', 'every N hours');
assert(stack.routineStackCandidate('Morning', 'TB-500: 3x').name === 'TB-500', '3x');
assert(stack.routineStackCandidate('Morning', 'BPC-157: 8:00 AM').name === 'BPC-157', 'clock time');

assert(html.includes('<script src="/routine-stack.js"></script>'), 'page should load the stack filter');
assert(html.includes('function parseRoutineReply'), 'page wrapper missing');
assert(html.includes('RoutineStack.parseRoutineReply'), 'page should call the shared parser');
assert(!html.includes('items.length < 3'), 'the old 3-line threshold should be gone');

const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(function(match) { return match[1]; });
scripts.forEach(function(code, index) {
  try {
    new vm.Script(code, { filename: 'inline-' + index + '.js' });
  } catch (err) {
    fail('inline script ' + index + ' did not parse: ' + err.message);
  }
});

console.log('routine stack filter passed');
