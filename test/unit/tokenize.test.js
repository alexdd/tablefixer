'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('../../src/tablefixer');

describe('tokenize', () => {
  it('returns a leading empty node (index 0) before the first tag', () => {
    const tags = tokenize('<A>x</A>');
    assert.equal(tags[0].index, 0);
    assert.equal(tags[0].body, '');
    assert.equal(tags[0].content, '');
  });

  it('captures tag body and following content separately', () => {
    const tags = tokenize('<ROW>\n  <ENTRY>hi</ENTRY>\n</ROW>');
    const row = tags.find((t) => t.body === 'ROW');
    const entry = tags.find((t) => t.body === 'ENTRY');
    const closeEntry = tags.find((t) => t.body === '/ENTRY');

    assert.ok(row);
    assert.match(row.content, /^\n/);
    assert.equal(entry.content, 'hi');
    assert.match(closeEntry.content, /^\n/);
  });

  it('preserves attributes inside the tag body', () => {
    const tags = tokenize('<ENTRY MOREROWS="2" NAMEST="COL1">cell</ENTRY>');
    const entry = tags.find((t) => t.body.startsWith('ENTRY'));
    assert.equal(entry.body, 'ENTRY MOREROWS="2" NAMEST="COL1"');
    assert.equal(entry.content, 'cell');
  });

  it('treats SGML comments as ordinary tags', () => {
    const tags = tokenize('<ENTRY></ENTRY><!-- broken row -->');
    const comment = tags.find((t) => t.body.startsWith('!--'));
    assert.ok(comment);
    assert.equal(comment.body, '!-- broken row --');
  });

  it('keeps self-closing slash inside the body', () => {
    const tags = tokenize('<Colspec colname="c1"/>');
    const col = tags.find((t) => t.body.startsWith('Colspec'));
    assert.ok(col.body.endsWith('/'));
  });

  it('assigns monotonically increasing indices', () => {
    const tags = tokenize('<a><b></b></a>');
    const indices = tags.map((t) => t.index);
    assert.deepEqual(indices, [0, 1, 2, 3, 4]);
  });

  it('includes trailing text after the last tag on that last node', () => {
    const tags = tokenize('<X>after');
    const last = tags[tags.length - 1];
    assert.equal(last.body, 'X');
    assert.equal(last.content, 'after');
  });

  it('handles an empty document', () => {
    const tags = tokenize('');
    assert.equal(tags.length, 1);
    assert.equal(tags[0].body, '');
    assert.equal(tags[0].content, '');
  });
});
