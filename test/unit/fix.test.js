'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, analyze, fix } = require('../../src/tablefixer');

function phantomFixture() {
  const sgml =
    `<TABLE>` +
    `<TGROUP COLS="3">` +
    `<COLSPEC COLNAME="COL1"><COLSPEC COLNAME="COL2"><COLSPEC COLNAME="COL3">` +
    `<TBODY>` +
    `<ROW>` +
    `<ENTRY MOREROWS="1">R1C1</ENTRY>` +
    `<ENTRY MOREROWS="1">R1C2</ENTRY>` +
    `<ENTRY MOREROWS="1">R1C3</ENTRY>` +
    `</ROW>` +
    `<ROW><ENTRY></ENTRY><!-- phantom --></ROW>` +
    `<ROW><ENTRY>R3C1</ENTRY><ENTRY>R3C2</ENTRY><ENTRY>R3C3</ENTRY></ROW>` +
    `</TBODY></TGROUP></TABLE>`;
  return analyze(tokenize(sgml));
}

describe('fix', () => {
  it('deletes the leading empty index-0 node', () => {
    const { tree, brokenRows } = phantomFixture();
    assert.ok(tree.has(0));
    fix(tree, brokenRows);
    assert.equal(tree.has(0), false);
  });

  it('removes the phantom row including its </row>', () => {
    const { tree, brokenRows } = phantomFixture();
    const rowStart = brokenRows[0][0].index;

    // Collect every index that belongs to the phantom row (up to </row>)
    const phantomIndices = [rowStart];
    for (let i = 1; ; i++) {
      const node = tree.get(rowStart + i);
      assert.ok(node, `expected phantom node at ${rowStart + i}`);
      phantomIndices.push(rowStart + i);
      if (node.body.toLowerCase().includes('/row')) break;
    }

    fix(tree, brokenRows);

    for (const idx of phantomIndices) {
      assert.equal(tree.has(idx), false, `phantom index ${idx} should be gone`);
    }
    // Surrounding real rows must still be present
    const remainingRows = [...tree.values()].filter(
      (n) => n.body.toLowerCase() === 'row' || n.body.toLowerCase().startsWith('row ')
    );
    assert.equal(remainingRows.length, 2);
  });

  it('decrements morerows that reached into the deleted row', () => {
    const { tree, brokenRows } = phantomFixture();
    fix(tree, brokenRows);

    const entries = [...tree.values()].filter((n) =>
      n.body.toLowerCase().startsWith('entry')
    );
    const spanned = entries.filter((n) => /MOREROWS="/i.test(n.body));
    assert.ok(spanned.length >= 3);
    for (const entry of spanned) {
      // Originally "1", after deleting the only following spanned row → "0"
      assert.match(entry.body, /MOREROWS="0"/);
    }
  });

  it('does not change entries when brokenRows is empty', () => {
    const sgml =
      `<TABLE><TGROUP COLS="1"><COLSPEC COLNAME="C1">` +
      `<TBODY><ROW><ENTRY MOREROWS="0">x</ENTRY></ROW></TBODY>` +
      `</TGROUP></TABLE>`;
    const { tree, brokenRows } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 0);
    const before = tree.get(1).body;
    fix(tree, brokenRows);
    // index 0 gone, other bodies unchanged
    assert.equal(tree.has(0), false);
    const entry = [...tree.values()].find((n) =>
      n.body.toLowerCase().startsWith('entry')
    );
    assert.equal(entry.body.includes('MOREROWS="0"') || entry.body.includes('morerows="0"'), true);
    assert.ok(before); // sanity
  });

  it('processes multiple phantoms from back to front', () => {
    const sgml =
      `<TABLE><TGROUP COLS="3">` +
      `<COLSPEC COLNAME="COL1"><COLSPEC COLNAME="COL2"><COLSPEC COLNAME="COL3">` +
      `<TBODY>` +
      `<ROW>` +
      `<ENTRY MOREROWS="2">a</ENTRY>` +
      `<ENTRY MOREROWS="2">b</ENTRY>` +
      `<ENTRY MOREROWS="2">c</ENTRY>` +
      `</ROW>` +
      `<ROW><ENTRY></ENTRY></ROW>` + // phantom mid-span
      `<ROW><ENTRY></ENTRY></ROW>` + // second phantom
      `</TBODY></TGROUP></TABLE>`;
    const { tree, brokenRows } = analyze(tokenize(sgml));
    assert.equal(brokenRows.length, 2);
    fix(tree, brokenRows);

    const rowOpens = [...tree.values()].filter(
      (n) => n.body.toLowerCase() === 'row' || n.body.toLowerCase().startsWith('row ')
    );
    // Only the first data row should remain
    assert.equal(rowOpens.length, 1);

    const firstEntry = [...tree.values()].find((n) =>
      /MOREROWS=/i.test(n.body)
    );
    // morerows started at 2, two phantoms removed → 0
    assert.match(firstEntry.body, /MOREROWS="0"/);
  });
});
