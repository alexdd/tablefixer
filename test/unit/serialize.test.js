'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { serialize } = require('../../src/tablefixer');

describe('serialize', () => {
  it('emits tags in ascending index order as <body>content', () => {
    const tree = new Map([
      [2, { body: '/A', content: '' }],
      [1, { body: 'A', content: 'hi' }],
    ]);
    assert.equal(serialize(tree, ''), '<A>hi</A>');
  });

  it('prefixes the log and adds a blank line before the document', () => {
    const tree = new Map([[1, { body: 'X', content: '' }]]);
    const out = serialize(tree, '<!-- LOG -->\n');
    assert.equal(out, '<!-- LOG -->\n\n<X>');
  });

  it('adds a trailing newline to a log that lacks one', () => {
    const tree = new Map([[1, { body: 'X', content: '' }]]);
    const out = serialize(tree, '<!-- LOG -->');
    assert.equal(out.startsWith('<!-- LOG -->\n\n'), true);
  });

  it('omits the blank separator when the log is empty', () => {
    const tree = new Map([[1, { body: 'X', content: 'y' }]]);
    assert.equal(serialize(tree, ''), '<X>y');
  });

  it('does not insert artificial spaces between consecutive tags', () => {
    const tree = new Map([
      [1, { body: 'A', content: '' }],
      [2, { body: 'B', content: '' }],
      [3, { body: '/B', content: '' }],
      [4, { body: '/A', content: '' }],
    ]);
    assert.equal(serialize(tree, ''), '<A><B></B></A>');
  });

  it('preserves content whitespace exactly', () => {
    const tree = new Map([
      [1, { body: 'P', content: '  hello\n' }],
      [2, { body: '/P', content: '\t' }],
    ]);
    assert.equal(serialize(tree, ''), '<P>  hello\n</P>\t');
  });
});
