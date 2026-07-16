'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveHorizontalSpans } = require('../../src/tablefixer');

describe('resolveHorizontalSpans', () => {
  const cols = ['COL1', 'COL2', 'COL3'];

  it('maps a plain entry to a single resolved column', () => {
    const resolved = resolveHorizontalSpans(
      [{ morerows: 0, namest: null, nameend: null }],
      cols,
      () => {},
      1
    );
    assert.deepEqual(resolved, [0]);
  });

  it('preserves the morerows value on a single-column entry', () => {
    const resolved = resolveHorizontalSpans(
      [{ morerows: 2, namest: null, nameend: null }],
      cols,
      () => {},
      1
    );
    assert.deepEqual(resolved, [2]);
  });

  it('expands namest/nameend across intermediate columns', () => {
    // COL2..COL3 → one extra column + the end column = 2
    const resolved = resolveHorizontalSpans(
      [{ morerows: 1, namest: 'COL2', nameend: 'COL3' }],
      cols,
      () => {},
      1
    );
    assert.deepEqual(resolved, [1, 1]);
  });

  it('expands a full-width horizontal span to all columns', () => {
    const resolved = resolveHorizontalSpans(
      [{ morerows: 0, namest: 'COL1', nameend: 'COL3' }],
      cols,
      () => {},
      1
    );
    assert.deepEqual(resolved, [0, 0, 0]);
  });

  it('concatenates multiple entries in document order', () => {
    const resolved = resolveHorizontalSpans(
      [
        { morerows: 2, namest: null, nameend: null },
        { morerows: 0, namest: null, nameend: null },
        { morerows: 1, namest: null, nameend: null },
      ],
      cols,
      () => {},
      1
    );
    assert.deepEqual(resolved, [2, 0, 1]);
  });

  it('logs the original error message when colspec names are missing', () => {
    let logged = '';
    const resolved = resolveHorizontalSpans(
      [{ morerows: 1, namest: 'MISSING', nameend: 'COL3' }],
      cols,
      (msg) => {
        logged += msg;
      },
      4
    );
    assert.match(
      logged,
      /@namest or @namend no correspondence in colspec! Table 4/
    );
    // Still appends the end-column morerows even after the failed span lookup
    assert.deepEqual(resolved, [1]);
  });

  it('returns an empty list for a row with no entries', () => {
    assert.deepEqual(resolveHorizontalSpans([], cols, () => {}, 1), []);
  });
});
