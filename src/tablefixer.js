'use strict';

/**
 * tablefixer — repair CALS table geometry
 * =========================================
 *
 * Port of Alex Düsel's Python 2 experiment (2014).
 *
 * Problem
 * -------
 * In the CALS table model, @morerows on an <entry> says how many *additional*
 * rows the cell extends downward. In those following rows there must be no
 * <entry> for that column — the column is already occupied.
 *
 * Some SGML/XML editors (historically including PTC Arbortext Editor / “Epic”)
 * produce bad intermediate rows when editing row spans: a nearly empty <row>
 * with an empty <entry>, even though every column is still covered by
 * overlying @morerows. Table geometry then breaks (too many cells/spans per row).
 *
 * Solution (this algorithm)
 * -------------------------
 * 1. Tokenize SGML into a flat tag list (not a full parser).
 * 2. Simulate per-table column occupancy row by row.
 * 3. Detect rows where cells + active spans would exceed @cols.
 * 4. Delete empty “phantom” rows and decrement every @morerows that reached
 *    into that row by 1.
 *
 * The module is intentionally standalone (Node.js standard library only).
 */

/**
 * Read an attribute from a tag body (everything between < and >).
 * Example: getAttr('ENTRY MOREROWS="2" NAMEST="COL1"', 'morerows') → '2'
 *
 * Same as the original: attributes are split on spaces; values may use double
 * quotes. A trailing '/' (self-closing <Colspec …/>) is stripped.
 *
 * @param {string} tagBody
 * @param {string} name  attribute name, case-insensitive
 * @returns {string|null}
 */
function getAttr(tagBody, name) {
  const needle = name.toLowerCase();
  for (const part of tagBody.split(' ')) {
    if (!part.toLowerCase().startsWith(needle + '=')) continue;
    // Mirror Python str.strip('"/'): peel quotes/slashes from both ends
    return part
      .split('=')
      .slice(1)
      .join('=')
      .replace(/^["']+/, '')
      .replace(/["'/]+$/, '');
  }
  return null;
}

/**
 * Phase 1 — character-accurate tokenizer
 * --------------------------------------
 * Turn SGML text into an ordered list of nodes:
 *
 *   { index, body, content }
 *
 * - body:    tag body without angle brackets (“ENTRY MOREROWS="2"”)
 * - content: characters *after* this tag until the next “<”
 * - index:   running number (0 = text before the first tag)
 *
 * Comments (`<!-- … -->`) and PIs are treated like ordinary tags — good enough
 * here because we only evaluate table/row/entry.
 *
 * @param {string} sgml
 * @returns {{ index: number, body: string, content: string }[]}
 */
function tokenize(sgml) {
  const tags = [];
  let body = '';
  let content = '';
  let index = 0;
  let insideTag = false; // false == collecting content (after “>”)

  for (let i = 0; i < sgml.length; i++) {
    const ch = sgml[i];

    if (ch === '>') {
      // End of tag: everything from here belongs to this tag's content
      insideTag = false;
    } else if (ch === '<') {
      // New tag starts: finish the previous (body, content)
      tags.push({ index, body, content });
      index += 1;
      body = '';
      content = '';
      insideTag = true;
    } else if (insideTag) {
      body += ch;
    } else {
      content += ch;
    }
  }

  // Also keep the last tag (no further “<” after it)
  tags.push({ index, body, content });
  return tags;
}

/**
 * Expand one row's entry metadata into a “resolved” column list.
 *
 * Horizontal spans (@namest / @nameend) occupy multiple columns. For the
 * geometry check we count each occupied column once and remember the
 * @morerows value (the vertical span applies to every column of the
 * horizontal span).
 *
 * Example with colspecs = [COL1, COL2, COL3]:
 *   entry namest=COL2 nameend=COL3 morerows=1
 * → resolved = [1, 1]  (two columns, each morerows=1)
 *
 * @param {{ morerows: number, namest: string|null, nameend: string|null }[]} entries
 * @param {string[]} colspecs
 * @param {(msg: string) => void} log
 * @param {number} tableNumber
 * @returns {number[]}  morerows value per occupied column in this row
 */
function resolveHorizontalSpans(entries, colspecs, log, tableNumber) {
  const resolved = [];

  for (const entry of entries) {
    if (entry.namest && entry.nameend) {
      let spanning = 0;
      try {
        const start = colspecs.indexOf(entry.namest);
        const end = colspecs.indexOf(entry.nameend);
        if (start < 0 || end < 0) throw new Error('missing colspec');
        // Number of *extra* columns between start and end
        spanning = Math.abs(end - start);
      } catch (_) {
        // Message kept identical to the original (including typo “namend”)
        log(
          `<!-- ERROR: @namest or @namend no correspondence in colspec! Table ${tableNumber} -->\n`
        );
      }
      for (let i = 0; i < spanning; i++) {
        resolved.push(entry.morerows);
      }
    }
    // End column (or the only column when there is no horizontal span)
    resolved.push(entry.morerows);
  }

  return resolved;
}

/**
 * Whether the just-closed row looks like a phantom error row: exactly one
 * empty <entry> (with or without an explicit </entry>).
 *
 * tmpRow holds the nodes [row, entry] or [row, entry, /entry].
 *
 * @param {{ index: number, body: string, content: string }[]} tmpRow
 * @returns {boolean}
 */
function isEmptyPhantomRow(tmpRow) {
  if (tmpRow.length !== 2 && tmpRow.length !== 3) return false;
  // Content of the <entry> open tag must be empty aside from whitespace
  return tmpRow[1].content.replace(/[ \n\r]/g, '') === '';
}

/**
 * Phase 2 — analyze: simulate table geometry and find phantom rows
 * ----------------------------------------------------------------
 * For each column, `activeSpans[col]` is how many remaining rows are still
 * occupied by an overlying @morerows.
 *
 * At end of row:
 *   occupied columns = new cells in this row + still-active spans
 * If that is > cols, geometry is broken. Typical trigger in the test data:
 * an empty phantom row inserted by the editor while every column is still spanned.
 *
 * @param {{ index: number, body: string, content: string }[]} tags
 * @returns {{
 *   tree: Map<number, { body: string, content: string }>,
 *   brokenRows: { index: number, body: string, content: string }[][],
 *   log: string
 * }}
 */
function analyze(tags) {
  let log = '';
  const appendLog = (msg) => {
    log += msg;
  };

  /** @type {Map<number, { body: string, content: string }>} */
  const tree = new Map();

  /** Phantom rows to delete later (list of that row's nodes) */
  const brokenRows = [];

  let tableNumber = 0;
  let rowNumber = 0;
  let ncols = 0;
  /** @type {number[]} remaining lifetime of vertical spans per column */
  let activeSpans = [];
  /** @type {string[]} colname values in colspec order */
  let colspecs = [];
  /** @type {{ morerows: number, namest: string|null, nameend: string|null }[]} */
  let entries = [];
  /** @type {{ index: number, body: string, content: string }[]} */
  let tmpRow = [];

  for (const tag of tags) {
    const bodyLower = tag.body.toLowerCase();

    // ---- <table …> : new table, reset counters ----------------------------
    if (bodyLower.startsWith('table')) {
      rowNumber = 0;
      ncols = 0;
      activeSpans = [];
      colspecs = [];
      tableNumber += 1;
    }

    // ---- <tgroup cols="N"> : column count and span vector -----------------
    else if (bodyLower.startsWith('tgroup')) {
      const colsAttr = getAttr(tag.body, 'cols');
      if (colsAttr == null) {
        appendLog('<!-- ERROR: @cols not declared! -->\n');
        ncols = 0;
      } else {
        ncols = parseInt(colsAttr, 10);
      }
      activeSpans = Array(ncols).fill(0);
    }

    // ---- <colspec colname="…"> : column names for namest/nameend ----------
    else if (bodyLower.startsWith('colspec')) {
      const colname = getAttr(tag.body, 'colname');
      if (colname == null) {
        appendLog('<!-- ERROR: colspec inconsistent! -->\n');
        colspecs.push(undefined);
      } else {
        colspecs.push(colname);
      }
    }

    // ---- <row> : start a new row ------------------------------------------
    else if (bodyLower.startsWith('row')) {
      rowNumber += 1;
      entries = [];
      tmpRow = [tag];
    }

    // ---- </entry> : collect only for phantom-row detection in tmpRow -----
    else if (bodyLower.startsWith('/entry')) {
      tmpRow.push(tag);
    }

    // ---- <entry …> : cell with optional span attributes -------------------
    else if (bodyLower.startsWith('entry')) {
      let morerows = 0;
      let namest = null;
      let nameend = null;

      for (const attr of tag.body.split(' ')) {
        const lower = attr.toLowerCase();
        if (lower.startsWith('morerows=')) {
          morerows = parseInt(attr.split('=')[1].replace(/["'/]/g, ''), 10);
        } else if (lower.startsWith('namest=')) {
          namest = attr.split('=')[1].replace(/["'/]/g, '');
        } else if (lower.startsWith('nameend=')) {
          nameend = attr.split('=')[1].replace(/["'/]/g, '');
        }
      }

      if ((namest && !nameend) || (!namest && nameend)) {
        appendLog(
          `<!-- ERROR: namest or nameend inconsistent! Table ${tableNumber} -->\n`
        );
      }

      entries.push({ morerows, namest, nameend });
      tmpRow.push(tag);
    }

    // ---- </row> : check this row's geometry and advance spans -------------
    else if (bodyLower.startsWith('/row')) {
      const resolved = resolveHorizontalSpans(
        entries,
        colspecs,
        appendLog,
        tableNumber
      );
      const ncells = resolved.length;
      const nspans = activeSpans.filter((n) => n > 0).length;

      // Core condition: more occupations than columns → broken geometry
      if (ncells + nspans > ncols) {
        if (isEmptyPhantomRow(tmpRow)) {
          brokenRows.push(tmpRow);
        }
        // “EPIC” refers to the historical Arbortext editor bug
        appendLog(
          `<!-- FIXED EPIC ERROR: @morerows attributes inconsistent! Table ${tableNumber} Row ${rowNumber} -->\n`
        );
      }

      // Update the span vector for the *next* row:
      // - decrement active spans by 1
      // - fill free columns with the morerows values of the new cells
      let cellIndex = 0;
      for (let col = 0; col < ncols; col++) {
        if (activeSpans[col] > 0) {
          activeSpans[col] -= 1;
        } else if (cellIndex < ncells) {
          const span = resolved[cellIndex];
          if (span > 0) {
            activeSpans[col] = span;
          }
          cellIndex += 1;
        } else {
          // Too few cells while columns are free — also inconsistent
          appendLog(
            `<!-- FIXED ERROR @morerows attributes inconsistent! Table ${tableNumber} Row ${rowNumber} -->\n`
          );
          if (isEmptyPhantomRow(tmpRow)) {
            brokenRows.push(tmpRow);
          }
          break;
        }
      }
    }

    // ---- </table> : no spans may remain open at end of table --------------
    else if (bodyLower.startsWith('/table')) {
      const openSpans = activeSpans.filter((n) => n > 0);
      if (openSpans.length > 0) {
        // Message kept identical to the original (typo “incinsistent”)
        appendLog(
          `<!-- ERROR: @morerows attributes incinsistent! Table ${tableNumber} -->\n`
        );
      }
    }

    // Store every node in the tree (index → body/content), including non-table tags
    tree.set(tag.index, { body: tag.body, content: tag.content });
  }

  return { tree, brokenRows, log };
}

/**
 * Rewrite @morerows on a tag body, matching the original: replace the
 * MOREROWS="…" pattern; result is always written uppercase.
 *
 * @param {string} tagBody
 * @param {number} newMorerows
 * @returns {string}
 */
function rewriteMorerows(tagBody, newMorerows) {
  return tagBody.replace(
    /MOREROWS="[0-9]*"/i,
    `MOREROWS="${Math.max(0, newMorerows)}"`
  );
}

/**
 * Phase 3 — repair: delete phantom rows and adjust @morerows
 * ----------------------------------------------------------
 * Phantom rows are removed from back to front (important when one table has
 * several bad rows). For each deleted row we walk *backward* through the
 * document and decrement every @morerows whose span would have reached into
 * the deleted row:
 *
 *   rowDistance = number of <row> start tags between the entry and the phantom
 *   if rowDistance <= morerows → that span reached into it → morerows -= 1
 *
 * @param {Map<number, { body: string, content: string }>} tree
 * @param {{ index: number, body: string, content: string }[][]} brokenRows
 */
function fix(tree, brokenRows) {
  // Index 0 is text before the first “<” — discard it like the original
  tree.delete(0);

  // Back to front: later phantoms first so the backward walk for earlier
  // errors does not count already-deleted later rows
  for (const tmpRow of [...brokenRows].reverse()) {
    const rowStart = tmpRow[0].index;

    // Remove the whole phantom row: <row> … </row>
    tree.delete(rowStart);
    let i = 1;
    while (true) {
      const node = tree.get(rowStart + i);
      if (!node) break;
      if (node.body.toLowerCase().includes('/row')) {
        tree.delete(rowStart + i);
        break;
      }
      tree.delete(rowStart + i);
      i += 1;
    }

    // Walk backward toward the document start: shorten spans that pointed
    // into the deleted row
    let rowDistance = 0;
    // Same as the original: from rowStart-1 down through index 1 inclusive
    for (let num = rowStart - 1; num >= 1; num--) {
      const elem = tree.get(num);
      if (!elem) continue; // skip nodes already deleted

      const lower = elem.body.toLowerCase();
      if (lower.startsWith('row')) {
        rowDistance += 1;
      } else if (lower.startsWith('entry')) {
        let morerows = 0;
        const attr = getAttr(elem.body, 'morerows');
        if (attr != null) morerows = parseInt(attr, 10);

        // Span still reaches the deleted row → shorten by 1
        const newMorerows =
          rowDistance <= morerows ? morerows - 1 : morerows;

        elem.body = rewriteMorerows(elem.body, newMorerows);
        tree.set(num, elem);
      }
    }
  }
}

/**
 * Phase 4 — serialize back to SGML
 * --------------------------------
 * Emit nodes in index order as “<body>content”.
 * Unlike Python 2 `print` softspace, we deliberately insert *no* artificial
 * spaces between tags — CALS geometry (which rows/attributes) still matches
 * the original algorithm.
 *
 * @param {Map<number, { body: string, content: string }>} tree
 * @param {string} log
 * @returns {string}
 */
function serialize(tree, log) {
  const keys = [...tree.keys()].sort((a, b) => a - b);
  let out = log;
  if (log && !log.endsWith('\n')) out += '\n';
  // Blank line between log and document (like `print log` then further output)
  if (log) out += '\n';

  for (const key of keys) {
    const node = tree.get(key);
    out += `<${node.body}>${node.content}`;
  }
  return out;
}

/**
 * Public API: SGML string with broken CALS geometry → repaired string.
 *
 * @param {string} sgmlInput  e.g. contents of broken.sgml
 * @returns {{ sgml: string, log: string, brokenRowCount: number }}
 */
function fixCalsTables(sgmlInput) {
  const tags = tokenize(sgmlInput);
  const { tree, brokenRows, log } = analyze(tags);
  fix(tree, brokenRows);
  const sgml = serialize(tree, log);
  return {
    sgml,
    log,
    brokenRowCount: brokenRows.length,
  };
}

module.exports = {
  fixCalsTables,
  tokenize,
  analyze,
  fix,
  serialize,
  getAttr,
  resolveHorizontalSpans,
  isEmptyPhantomRow,
  rewriteMorerows,
};
