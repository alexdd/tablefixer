#!/usr/bin/env node
'use strict';

/**
 * CLI for tablefixer
 *
 * Usage:
 *   node bin/tablefixer.js [input.sgml] > output.sgml
 *   npm start
 *
 * Without an argument, broken.sgml in the current working directory is read.
 */

const fs = require('fs');
const path = require('path');
const { fixCalsTables } = require('../src/tablefixer');

const inputPath = path.resolve(process.argv[2] || 'broken.sgml');

if (!fs.existsSync(inputPath)) {
  console.error(`tablefixer: file not found: ${inputPath}`);
  process.exit(1);
}

const input = fs.readFileSync(inputPath, 'utf8');
const { sgml } = fixCalsTables(input);
process.stdout.write(sgml);
