'use strict';

/**
 * Compare CALS geometry of the Node output against result.sgml.
 *
 * Whitespace and Python 2 print softspace are ignored.
 * Per table we check: row count, entry attributes
 * (morerows / namest / nameend), and the fix-log comments.
 */

const fs = require('fs');
const path = require('path');
const { fixCalsTables, tokenize, getAttr } = require('../src/tablefixer');

const root = path.join(__dirname, '..');
const broken = fs.readFileSync(path.join(root, 'broken.sgml'), 'utf8');
const expected = fs.readFileSync(path.join(root, 'result.sgml'), 'utf8');

const { sgml: actual, log, brokenRowCount } = fixCalsTables(broken);

/**
 * Extract table geometry from serialized SGML.
 * @param {string} text
 */
function extractGeometry(text) {
  // Collect fix-log comments at the top
  const fixLogs = [...text.matchAll(/<!-- FIXED[^>]*-->/g)].map((m) => m[0]);

  const tags = tokenize(text);
  const tables = [];
  let current = null;
  let currentRow = null;

  for (const tag of tags) {
    const lower = tag.body.toLowerCase();

    if (lower === 'table' || lower.startsWith('table ')) {
      current = { rows: [] };
      tables.push(current);
      currentRow = null;
    } else if (lower.startsWith('/table')) {
      current = null;
      currentRow = null;
    } else if (current && (lower === 'row' || lower.startsWith('row '))) {
      currentRow = [];
      current.rows.push(currentRow);
    } else if (current && lower.startsWith('/row')) {
      currentRow = null;
    } else if (
      currentRow &&
      (lower === 'entry' || lower.startsWith('entry '))
    ) {
      currentRow.push({
        morerows: getAttr(tag.body, 'morerows'),
        namest: getAttr(tag.body, 'namest'),
        nameend: getAttr(tag.body, 'nameend'),
        text: tag.content.replace(/\s+/g, ' ').trim(),
      });
    }
  }

  return { fixLogs, tables };
}

const exp = extractGeometry(expected);
const act = extractGeometry(actual);

let failed = false;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed = true;
  } else {
    passed += 1;
  }
}

assert(
  act.fixLogs.join('\n') === exp.fixLogs.join('\n'),
  'Fix-log comments match result.sgml'
);

assert(
  act.tables.length === exp.tables.length,
  `Table count: actual=${act.tables.length} expected=${exp.tables.length}`
);

const n = Math.min(act.tables.length, exp.tables.length);
for (let t = 0; t < n; t++) {
  const aRows = act.tables[t].rows;
  const eRows = exp.tables[t].rows;
  assert(
    aRows.length === eRows.length,
    `Table ${t + 1}: row count actual=${aRows.length} expected=${eRows.length}`
  );

  const rMax = Math.min(aRows.length, eRows.length);
  for (let r = 0; r < rMax; r++) {
    const aEnt = aRows[r];
    const eEnt = eRows[r];
    assert(
      aEnt.length === eEnt.length,
      `Table ${t + 1} row ${r + 1}: entry count actual=${aEnt.length} expected=${eEnt.length}`
    );
    const eMax = Math.min(aEnt.length, eEnt.length);
    for (let e = 0; e < eMax; e++) {
      assert(
        aEnt[e].morerows === eEnt[e].morerows &&
          aEnt[e].namest === eEnt[e].namest &&
          aEnt[e].nameend === eEnt[e].nameend,
        `Table ${t + 1} row ${r + 1} entry ${e + 1}: ` +
          `actual=${JSON.stringify(aEnt[e])} expected=${JSON.stringify(eEnt[e])}`
      );
    }
  }
}

assert(brokenRowCount === 7, `7 phantom rows removed (was ${brokenRowCount})`);
assert(log.includes('FIXED EPIC ERROR'), 'Log contains FIXED EPIC ERROR');

// broken.sgml must not have been modified
const brokenNow = fs.readFileSync(path.join(root, 'broken.sgml'), 'utf8');
assert(brokenNow === broken, 'broken.sgml unchanged');

if (failed) {
  console.error(`\nGeometry comparison failed (${passed} checks ok).`);
  process.exit(1);
}

console.log(`All ${passed} geometry checks passed.`);
console.log(`Phantom rows removed: ${brokenRowCount}`);
