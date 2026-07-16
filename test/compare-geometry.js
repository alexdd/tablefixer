'use strict';

/**
 * Vergleicht die CALS-Geometrie der Node-Ausgabe mit result.sgml.
 *
 * Whitespace und der Python-2-Print-Softspace werden ignoriert.
 * Geprüft werden pro Tabelle: Zeilenanzahl, Entry-Attribute
 * (morerows / namest / nameend) und die Fix-Log-Kommentare.
 */

const fs = require('fs');
const path = require('path');
const { fixCalsTables, tokenize, getAttr } = require('../src/tablefixer');

const root = path.join(__dirname, '..');
const broken = fs.readFileSync(path.join(root, 'broken.sgml'), 'utf8');
const expected = fs.readFileSync(path.join(root, 'result.sgml'), 'utf8');

const { sgml: actual, log, brokenRowCount } = fixCalsTables(broken);

/**
 * Extrahiert aus serialisiertem SGML die Tabellen-Geometrie.
 * @param {string} text
 */
function extractGeometry(text) {
  // Log-Kommentare am Anfang einsammeln
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
  'Fix-Log-Kommentare stimmen mit result.sgml überein'
);

assert(
  act.tables.length === exp.tables.length,
  `Tabellenanzahl: actual=${act.tables.length} expected=${exp.tables.length}`
);

const n = Math.min(act.tables.length, exp.tables.length);
for (let t = 0; t < n; t++) {
  const aRows = act.tables[t].rows;
  const eRows = exp.tables[t].rows;
  assert(
    aRows.length === eRows.length,
    `Tabelle ${t + 1}: Zeilenanzahl actual=${aRows.length} expected=${eRows.length}`
  );

  const rMax = Math.min(aRows.length, eRows.length);
  for (let r = 0; r < rMax; r++) {
    const aEnt = aRows[r];
    const eEnt = eRows[r];
    assert(
      aEnt.length === eEnt.length,
      `Tabelle ${t + 1} Zeile ${r + 1}: Entry-Anzahl actual=${aEnt.length} expected=${eEnt.length}`
    );
    const eMax = Math.min(aEnt.length, eEnt.length);
    for (let e = 0; e < eMax; e++) {
      assert(
        aEnt[e].morerows === eEnt[e].morerows &&
          aEnt[e].namest === eEnt[e].namest &&
          aEnt[e].nameend === eEnt[e].nameend,
        `Tabelle ${t + 1} Zeile ${r + 1} Entry ${e + 1}: ` +
          `actual=${JSON.stringify(aEnt[e])} expected=${JSON.stringify(eEnt[e])}`
      );
    }
  }
}

assert(brokenRowCount === 7, `7 Phantom-Zeilen entfernt (war ${brokenRowCount})`);
assert(log.includes('FIXED EPIC ERROR'), 'Log enthält FIXED EPIC ERROR');

// broken.sgml darf nicht verändert worden sein
const brokenNow = fs.readFileSync(path.join(root, 'broken.sgml'), 'utf8');
assert(brokenNow === broken, 'broken.sgml unverändert');

if (failed) {
  console.error(`\nGeometrie-Vergleich fehlgeschlagen (${passed} Checks ok).`);
  process.exit(1);
}

console.log(`Alle ${passed} Geometrie-Checks bestanden.`);
console.log(`Entfernte Phantom-Zeilen: ${brokenRowCount}`);
