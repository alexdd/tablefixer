'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixCalsTables, tokenize, getAttr } = require('../../src/tablefixer');

const root = path.join(__dirname, '../..');

describe('fixCalsTables', () => {
  it('returns sgml, log, and brokenRowCount', () => {
    const result = fixCalsTables(
      `<TABLE><TGROUP COLS="1"><COLSPEC COLNAME="C1">` +
        `<TBODY><ROW><ENTRY>x</ENTRY></ROW></TBODY>` +
        `</TGROUP></TABLE>`
    );
    assert.equal(typeof result.sgml, 'string');
    assert.equal(typeof result.log, 'string');
    assert.equal(typeof result.brokenRowCount, 'number');
  });

  it('removes a classic epic phantom and shortens morerows', () => {
    const input =
      `<TABLE>` +
      `<TGROUP COLS="3">` +
      `<COLSPEC COLNAME="COL1"><COLSPEC COLNAME="COL2"><COLSPEC COLNAME="COL3">` +
      `<TBODY>` +
      `<ROW>` +
      `<ENTRY MOREROWS="1">A</ENTRY>` +
      `<ENTRY MOREROWS="1">B</ENTRY>` +
      `<ENTRY MOREROWS="1">C</ENTRY>` +
      `</ROW>` +
      `<ROW><ENTRY></ENTRY><!-- broken --></ROW>` +
      `</TBODY></TGROUP></TABLE>`;

    const { sgml, log, brokenRowCount } = fixCalsTables(input);

    assert.equal(brokenRowCount, 1);
    assert.match(log, /FIXED EPIC ERROR.*Table 1 Row 2/);
    assert.equal(sgml.includes('<!-- broken -->'), false);
    assert.match(sgml, /MOREROWS="0"/);
    // Phantom row gone: only one <ROW> open tag remains
    const rowOpens = [...sgml.matchAll(/<ROW\b/gi)];
    assert.equal(rowOpens.length, 1);
  });

  it('leaves a correct table structurally intact', () => {
    const input =
      `<TABLE><TGROUP COLS="2">` +
      `<COLSPEC COLNAME="C1"><COLSPEC COLNAME="C2">` +
      `<TBODY>` +
      `<ROW><ENTRY>a</ENTRY><ENTRY>b</ENTRY></ROW>` +
      `<ROW><ENTRY>c</ENTRY><ENTRY>d</ENTRY></ROW>` +
      `</TBODY></TGROUP></TABLE>`;

    const { sgml, brokenRowCount, log } = fixCalsTables(input);
    assert.equal(brokenRowCount, 0);
    assert.equal(log, '');
    assert.match(sgml, /<ENTRY>a<\/ENTRY>/);
    assert.match(sgml, /<ENTRY>d<\/ENTRY>/);
  });

  it('matches the fixture broken.sgml → geometry of result.sgml', () => {
    const broken = fs.readFileSync(path.join(root, 'broken.sgml'), 'utf8');
    const expected = fs.readFileSync(path.join(root, 'result.sgml'), 'utf8');
    const { sgml, brokenRowCount, log } = fixCalsTables(broken);

    assert.equal(brokenRowCount, 7);
    assert.equal(
      [...log.matchAll(/FIXED EPIC ERROR/g)].length,
      [...expected.matchAll(/FIXED EPIC ERROR/g)].length
    );

    // Compare entry-level geometry (attributes), ignoring whitespace softspace
    function geometry(text) {
      const tags = tokenize(text);
      const rows = [];
      let current = null;
      for (const tag of tags) {
        const lower = tag.body.toLowerCase();
        if (lower === 'row' || lower.startsWith('row ')) {
          current = [];
          rows.push(current);
        } else if (lower.startsWith('/row')) {
          current = null;
        } else if (current && (lower === 'entry' || lower.startsWith('entry '))) {
          current.push({
            morerows: getAttr(tag.body, 'morerows'),
            namest: getAttr(tag.body, 'namest'),
            nameend: getAttr(tag.body, 'nameend'),
          });
        }
      }
      return rows;
    }

    assert.deepEqual(geometry(sgml), geometry(expected));
  });

  it('does not mutate the input string', () => {
    const input = `<TABLE><TGROUP COLS="1"><COLSPEC COLNAME="C1"><TBODY>` +
      `<ROW><ENTRY>x</ENTRY></ROW></TBODY></TGROUP></TABLE>`;
    const copy = input.slice();
    fixCalsTables(input);
    assert.equal(input, copy);
  });

  it('keeps horizontal span attributes while repairing vertical spans', () => {
    const input =
      `<TABLE><TGROUP COLS="3">` +
      `<COLSPEC COLNAME="COL1"><COLSPEC COLNAME="COL2"><COLSPEC COLNAME="COL3">` +
      `<TBODY>` +
      `<ROW>` +
      `<ENTRY MOREROWS="1">a</ENTRY>` +
      `<ENTRY MOREROWS="1" NAMEST="COL2" NAMEEND="COL3">bc</ENTRY>` +
      `</ROW>` +
      `<ROW><ENTRY></ENTRY></ROW>` +
      `</TBODY></TGROUP></TABLE>`;

    const { sgml, brokenRowCount } = fixCalsTables(input);
    assert.equal(brokenRowCount, 1);
    assert.match(sgml, /NAMEST="COL2"/);
    assert.match(sgml, /NAMEEND="COL3"/);
    assert.match(sgml, /MOREROWS="0"/);
  });
});
