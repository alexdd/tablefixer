'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isEmptyPhantomRow } = require('../../src/tablefixer');

function node(body, content) {
  return { index: 0, body, content };
}

describe('isEmptyPhantomRow', () => {
  it('accepts [row, entry] with empty entry content', () => {
    assert.equal(
      isEmptyPhantomRow([node('ROW', '\n'), node('ENTRY', '')]),
      true
    );
  });

  it('accepts [row, entry, /entry] with empty entry content', () => {
    assert.equal(
      isEmptyPhantomRow([
        node('ROW', '\n'),
        node('ENTRY', ''),
        node('/ENTRY', ' '),
      ]),
      true
    );
  });

  it('treats whitespace-only entry content as empty', () => {
    assert.equal(
      isEmptyPhantomRow([node('ROW', ''), node('ENTRY', ' \n\r\t')]),
      false
    );
    // Original strip only removes space, \n, \r — not tabs.
    // Document that behavior: tab alone is NOT considered empty.
    assert.equal(
      isEmptyPhantomRow([node('ROW', ''), node('ENTRY', '\t')]),
      false
    );
    assert.equal(
      isEmptyPhantomRow([node('ROW', ''), node('ENTRY', ' \n\r ')]),
      true
    );
  });

  it('rejects a row whose entry has real text', () => {
    assert.equal(
      isEmptyPhantomRow([node('ROW', ''), node('ENTRY', 'blub')]),
      false
    );
  });

  it('rejects rows with the wrong number of collected nodes', () => {
    assert.equal(isEmptyPhantomRow([node('ROW', '')]), false);
    assert.equal(
      isEmptyPhantomRow([
        node('ROW', ''),
        node('ENTRY', ''),
        node('/ENTRY', ''),
        node('ENTRY', ''),
      ]),
      false
    );
  });
});
