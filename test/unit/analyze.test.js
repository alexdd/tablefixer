'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, analyze } = require('../../src/tablefixer');

/** Minimal 3-column CALS table fragment. */
function tableSgml(rowsInner) {
  return (
    `<TABLE>` +
    `<TGROUP COLS="3">` +
    `<COLSPEC COLNAME="COL1">` +
    `<COLSPEC COLNAME="COL2">` +
    `<COLSPEC COLNAME="COL3">` +
    `<TBODY>` +
    rowsInner +
    `</TBODY>` +
    `</TGROUP>` +
    `</TABLE>`
  );
}

describe('analyze', () => {
  it('builds a tree keyed by token index for every tag', () => {
    const tags = tokenize('<A>x</A>');
    const { tree } = analyze(tags);
    assert.ok(tree instanceof Map);
    assert.equal(tree.get(0).body, '');
    assert.ok([...tree.keys()].includes(1));
  });

  it('detects a phantom row when cells + active spans exceed cols', () => {
    // Row 1 spans all 3 columns into row 2; row 2 is an empty phantom.
    const sgml = tableSgml(
      `<ROW>` +
        `<ENTRY MOREROWS="1">a</ENTRY>` +
        `<ENTRY MOREROWS="1">b</ENTRY>` +
        `<ENTRY MOREROWS="1">c</ENTRY>` +
        `</ROW>` +
        `<ROW><ENTRY></ENTRY></ROW>`
    );
    const { brokenRows, log } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 1);
    assert.match(log, /FIXED EPIC ERROR.*Table 1 Row 2/);
  });

  it('does not mark a correct empty cell as broken', () => {
    // One empty entry in a free column — geometry is fine.
    const sgml = tableSgml(
      `<ROW>` +
        `<ENTRY>a</ENTRY>` +
        `<ENTRY>b</ENTRY>` +
        `<ENTRY></ENTRY>` +
        `</ROW>`
    );
    const { brokenRows, log } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 0);
    assert.equal(log.includes('FIXED EPIC ERROR'), false);
  });

  it('logs ERROR when @cols is missing on tgroup', () => {
    const sgml =
      `<TABLE><TGROUP>` +
      `<COLSPEC COLNAME="COL1">` +
      `<TBODY><ROW><ENTRY>x</ENTRY></ROW></TBODY>` +
      `</TGROUP></TABLE>`;
    const { log } = analyze(tokenize(sgml));
    assert.match(log, /ERROR: @cols not declared!/);
  });

  it('logs when only one of namest/nameend is set', () => {
    const sgml = tableSgml(
      `<ROW><ENTRY NAMEST="COL1">x</ENTRY><ENTRY>y</ENTRY><ENTRY>z</ENTRY></ROW>`
    );
    const { log } = analyze(tokenize(sgml));
    assert.match(log, /namest or nameend inconsistent! Table 1/);
  });

  it('logs when spans remain open at </table>', () => {
    // morerows="1" but no following row to absorb the span
    const sgml = tableSgml(
      `<ROW>` +
        `<ENTRY MOREROWS="1">a</ENTRY>` +
        `<ENTRY>b</ENTRY>` +
        `<ENTRY>c</ENTRY>` +
        `</ROW>`
    );
    const { log } = analyze(tokenize(sgml));
    assert.match(log, /morerows attributes incinsistent! Table 1/);
  });

  it('numbers tables independently across the document', () => {
    const sgml =
      tableSgml(
        `<ROW><ENTRY MOREROWS="1">a</ENTRY><ENTRY MOREROWS="1">b</ENTRY><ENTRY MOREROWS="1">c</ENTRY></ROW>` +
          `<ROW><ENTRY></ENTRY></ROW>`
      ) +
      tableSgml(
        `<ROW><ENTRY MOREROWS="1">a</ENTRY><ENTRY MOREROWS="1">b</ENTRY><ENTRY MOREROWS="1">c</ENTRY></ROW>` +
          `<ROW><ENTRY></ENTRY></ROW>`
      );
    const { log, brokenRows } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 2);
    assert.match(log, /Table 1 Row 2/);
    assert.match(log, /Table 2 Row 2/);
  });

  it('resolves horizontal spans when checking geometry', () => {
    // namest/nameend COL1-COL3 with morerows fills all columns; empty next row is phantom
    const sgml = tableSgml(
      `<ROW><ENTRY MOREROWS="1" NAMEST="COL1" NAMEEND="COL3">wide</ENTRY></ROW>` +
        `<ROW><ENTRY></ENTRY></ROW>`
    );
    const { brokenRows } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 1);
  });

  it('leaves a heavily merged but consistent table without broken rows', () => {
    const sgml = tableSgml(
      `<ROW>` +
        `<ENTRY MOREROWS="1">a</ENTRY>` +
        `<ENTRY>b</ENTRY>` +
        `<ENTRY>c</ENTRY>` +
        `</ROW>` +
        `<ROW>` +
        `<ENTRY>d</ENTRY>` +
        `<ENTRY>e</ENTRY>` +
        `</ROW>`
    );
    const { brokenRows, log } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 0);
    assert.equal(log.includes('FIXED EPIC ERROR'), false);
  });
});
