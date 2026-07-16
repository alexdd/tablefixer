'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteMorerows } = require('../../src/tablefixer');

describe('rewriteMorerows', () => {
  it('replaces an uppercase MOREROWS value', () => {
    assert.equal(
      rewriteMorerows('ENTRY MOREROWS="2"', 1),
      'ENTRY MOREROWS="1"'
    );
  });

  it('matches lowercase morerows but writes uppercase MOREROWS', () => {
    assert.equal(
      rewriteMorerows('Entry morerows="8"', 7),
      'Entry MOREROWS="7"'
    );
  });

  it('clamps negative values to zero', () => {
    assert.equal(
      rewriteMorerows('ENTRY MOREROWS="0"', -1),
      'ENTRY MOREROWS="0"'
    );
  });

  it('leaves the body unchanged when no morerows attribute is present', () => {
    assert.equal(rewriteMorerows('ENTRY COLNAME="c1"', 1), 'ENTRY COLNAME="c1"');
  });

  it('only rewrites the first MOREROWS occurrence', () => {
    // Defensive: attribute should appear once, but document replace behavior
    assert.equal(
      rewriteMorerows('ENTRY MOREROWS="2" MOREROWS="9"', 1),
      'ENTRY MOREROWS="1" MOREROWS="9"'
    );
  });
});
