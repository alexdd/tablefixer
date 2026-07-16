'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getAttr } = require('../../src/tablefixer');

describe('getAttr', () => {
  it('reads a double-quoted attribute value', () => {
    assert.equal(
      getAttr('ENTRY MOREROWS="2" NAMEST="COL1"', 'morerows'),
      '2'
    );
  });

  it('is case-insensitive for the attribute name', () => {
    assert.equal(getAttr('ENTRY MoreRows="3"', 'morerows'), '3');
    assert.equal(getAttr('ENTRY MOREROWS="3"', 'MOREROWS'), '3');
  });

  it('returns null when the attribute is missing', () => {
    assert.equal(getAttr('ENTRY COLNAME="c1"', 'morerows'), null);
  });

  it('strips surrounding quotes from the value', () => {
    assert.equal(getAttr('TGROUP COLS="10"', 'cols'), '10');
  });

  it('strips a trailing slash from self-closing tags', () => {
    assert.equal(
      getAttr('Colspec colnum="1" colname="col1" colwidth="*"/', 'colname'),
      'col1'
    );
    assert.equal(
      getAttr('Colspec colnum="1" colname="col1" colwidth="*"/', 'colwidth'),
      '*'
    );
  });

  it('handles values that contain "=" after the first separator', () => {
    assert.equal(getAttr('X FOO="a=b"', 'foo'), 'a=b');
  });

  it('does not match a longer attribute name prefix', () => {
    // "col" must not match "colname" / "colnum"
    assert.equal(getAttr('Colspec colname="c1" colnum="2"', 'col'), null);
  });

  it('matches the attribute that actually starts with name=', () => {
    assert.equal(
      getAttr('ENTRY NAMEST="COL2" NAMEEND="COL3"', 'namest'),
      'COL2'
    );
    assert.equal(
      getAttr('ENTRY NAMEST="COL2" NAMEEND="COL3"', 'nameend'),
      'COL3'
    );
  });
});
