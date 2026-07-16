#!/usr/bin/env node
'use strict';

/**
 * CLI für tablefixer
 *
 * Verwendung:
 *   node bin/tablefixer.js [input.sgml] > output.sgml
 *   npm start
 *
 * Ohne Argument wird broken.sgml im aktuellen Arbeitsverzeichnis gelesen.
 */

const fs = require('fs');
const path = require('path');
const { fixCalsTables } = require('../src/tablefixer');

const inputPath = path.resolve(process.argv[2] || 'broken.sgml');

if (!fs.existsSync(inputPath)) {
  console.error(`tablefixer: Datei nicht gefunden: ${inputPath}`);
  process.exit(1);
}

const input = fs.readFileSync(inputPath, 'utf8');
const { sgml } = fixCalsTables(input);
process.stdout.write(sgml);
