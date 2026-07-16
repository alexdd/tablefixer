'use strict';

/**
 * tablefixer — CALS-Tabellen-Geometrie reparieren
 * ================================================
 *
 * Port des Python-2-Experiments von Alex Düsel (2014).
 *
 * Problem
 * -------
 * Im CALS-Tabellenmodell beschreibt @morerows an einem <entry>, über wie viele
 * *weitere* Zeilen die Zelle nach unten reicht. In den betroffenen Zeilen
 * dürfen dann keine eigenen <entry>-Elemente für diese Spalte stehen — die
 * Spalte ist bereits „belegt“.
 *
 * Manche SGML-/XML-Editoren (historisch u. a. PTC Arbortext Editor / „Epic“)
 * erzeugen beim Bearbeiten von Zeilenspans fehlerhafte Zwischenzeilen:
 * eine praktisch leere <row> mit einem leeren <entry>, obwohl alle Spalten
 * noch von darüberliegenden @morerows belegt sind. Die Tabellen-Geometrie
 * stimmt dann nicht mehr (zu viele Zellen / Spans pro Zeile).
 *
 * Lösung (dieser Algorithmus)
 * ---------------------------
 * 1. SGML grob in eine flache Tag-Liste tokenisieren (kein vollständiger Parser).
 * 2. Pro Tabelle die Spaltenbelegung zeilenweise simulieren.
 * 3. Zeilen erkennen, in denen Zellen + aktive Spans > @cols wären.
 * 4. Leere „Phantom“-Zeilen entfernen und alle @morerows, die in diese Zeile
 *    hineinragten, um 1 verringern.
 *
 * Das Modul ist absichtlich standalone (nur Node.js-Standardbibliothek).
 */

/**
 * Liest ein Attribut aus dem Tag-Rumpf (alles zwischen < und >).
 * Beispiel: getAttr('ENTRY MOREROWS="2" NAMEST="COL1"', 'morerows') → '2'
 *
 * Wie im Original: Attribute werden an Leerzeichen gesplittet; Werte dürfen
 * in doppelten Anführungszeichen stehen. Ein optionales '/' am Ende
 * (Selbstschluss <Colspec …/>) wird mit abgeschnitten.
 *
 * @param {string} tagBody
 * @param {string} name  Attributname, case-insensitive
 * @returns {string|null}
 */
function getAttr(tagBody, name) {
  const needle = name.toLowerCase();
  for (const part of tagBody.split(' ')) {
    if (!part.toLowerCase().startsWith(needle + '=')) continue;
    return part.split('=').slice(1).join('=').replace(/^["']|["'/]$/g, '');
  }
  return null;
}

/**
 * Phase 1 — Zeichengenauer Tokenizer
 * ----------------------------------
 * Wandelt den SGML-Text in eine geordnete Liste von Knoten um:
 *
 *   { index, body, content }
 *
 * - body:    Tag-Rumpf ohne spitze Klammern („ENTRY MOREROWS="2"“)
 * - content: Zeichen *nach* diesem Tag bis zum nächsten „<“
 * - index:   laufende Nummer (0 = Text vor dem ersten Tag)
 *
 * Kommentare (`<!-- … -->`) und PI werden wie normale Tags behandelt —
 * das reicht für diesen Fixer, weil wir nur table/row/entry auswerten.
 *
 * @param {string} sgml
 * @returns {{ index: number, body: string, content: string }[]}
 */
function tokenize(sgml) {
  const tags = [];
  let body = '';
  let content = '';
  let index = 0;
  let insideTag = false; // false == wir sammeln content (nach „>“)

  for (let i = 0; i < sgml.length; i++) {
    const ch = sgml[i];

    if (ch === '>') {
      // Tag-Ende: ab jetzt gehört alles zum content dieses Tags
      insideTag = false;
    } else if (ch === '<') {
      // Neues Tag beginnt: vorheriges (body, content) abschließen
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

  // Letztes Tag (nach dem kein „<“ mehr kommt) ebenfalls übernehmen
  tags.push({ index, body, content });
  return tags;
}

/**
 * Erzeugt aus den Entry-Metadaten einer Zeile die „aufgelöste“ Spaltenliste.
 *
 * Horizontale Spans (@namest / @nameend) belegen mehrere Spalten. Für die
 * Geometrie-Prüfung zählen wir jede belegte Spalte einmal und merken uns
 * dabei den @morerows-Wert (vertikaler Span gilt für alle Spalten des
 * horizontalen Spans).
 *
 * Beispiel bei colspecs = [COL1, COL2, COL3]:
 *   entry namest=COL2 nameend=COL3 morerows=1
 * → resolved = [1, 1]  (zwei Spalten, jeweils morerows=1)
 *
 * @param {{ morerows: number, namest: string|null, nameend: string|null }[]} entries
 * @param {string[]} colspecs
 * @param {(msg: string) => void} log
 * @param {number} tableNumber
 * @returns {number[]}  morerows-Wert je belegter Spalte in dieser Zeile
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
        // Anzahl *zusätzlicher* Spalten zwischen Start und Ende
        spanning = Math.abs(end - start);
      } catch (_) {
        // Meldung bewusst wie im Original (inkl. Tippfehler „namend“)
        log(
          `<!-- ERROR: @namest or @namend no correspondence in colspec! Table ${tableNumber} -->\n`
        );
      }
      for (let i = 0; i < spanning; i++) {
        resolved.push(entry.morerows);
      }
    }
    // Die End-Spalte (bzw. die einzige Spalte ohne Horizontal-Span)
    resolved.push(entry.morerows);
  }

  return resolved;
}

/**
 * Prüft, ob die gerade geschlossene Zeile wie eine „Phantom“-Fehlerzeile
 * aussieht: genau ein leeres <entry> (mit oder ohne explizites </entry>).
 *
 * tmpRow enthält die Knoten [row, entry] oder [row, entry, /entry].
 *
 * @param {{ index: number, body: string, content: string }[]} tmpRow
 * @returns {boolean}
 */
function isEmptyPhantomRow(tmpRow) {
  if (tmpRow.length !== 2 && tmpRow.length !== 3) return false;
  // content des <entry>-Öffnungstags muss (bis auf Whitespace) leer sein
  return tmpRow[1].content.replace(/[ \n\r]/g, '') === '';
}

/**
 * Phase 2 — Analyse: Tabellen-Geometrie simulieren und Phantom-Zeilen finden
 * --------------------------------------------------------------------------
 * Pro Spalte hält `activeSpans[col]` die Anzahl verbleibender Zeilen, die
 * noch von einem darüberliegenden @morerows belegt sind.
 *
 * Am Zeilenende gilt:
 *   belegte Spalten = neue Zellen dieser Zeile + noch aktive Spans
 * Wenn das > cols ist, ist die Geometrie kaputt. Typischer Auslöser in den
 * Testdaten: eine leere Phantom-Zeile, die der Editor eingefügt hat, obwohl
 * alle Spalten noch gespannt sind.
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

  /** Phantom-Zeilen, die später gelöscht werden (Liste der Knoten der Zeile) */
  const brokenRows = [];

  let tableNumber = 0;
  let rowNumber = 0;
  let ncols = 0;
  /** @type {number[]} Restlaufzeit der vertikalen Spans je Spalte */
  let activeSpans = [];
  /** @type {string[]} colname-Werte der colspec-Reihenfolge */
  let colspecs = [];
  /** @type {{ morerows: number, namest: string|null, nameend: string|null }[]} */
  let entries = [];
  /** @type {{ index: number, body: string, content: string }[]} */
  let tmpRow = [];

  for (const tag of tags) {
    const bodyLower = tag.body.toLowerCase();

    // ---- <table …> : neue Tabelle, Zähler zurücksetzen --------------------
    if (bodyLower.startsWith('table')) {
      rowNumber = 0;
      ncols = 0;
      activeSpans = [];
      colspecs = [];
      tableNumber += 1;
    }

    // ---- <tgroup cols="N"> : Spaltenanzahl und Span-Vektor ----------------
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

    // ---- <colspec colname="…"> : Spaltennamen für namest/nameend ----------
    else if (bodyLower.startsWith('colspec')) {
      const colname = getAttr(tag.body, 'colname');
      if (colname == null) {
        appendLog('<!-- ERROR: colspec inconsistent! -->\n');
        colspecs.push(undefined);
      } else {
        colspecs.push(colname);
      }
    }

    // ---- <row> : neue Zeile beginnen --------------------------------------
    else if (bodyLower.startsWith('row')) {
      rowNumber += 1;
      entries = [];
      tmpRow = [tag];
    }

    // ---- </entry> : nur für Phantom-Erkennung in tmpRow sammeln ----------
    else if (bodyLower.startsWith('/entry')) {
      tmpRow.push(tag);
    }

    // ---- <entry …> : Zelle mit optionalen Span-Attributen -----------------
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

    // ---- </row> : Geometrie dieser Zeile prüfen und Spans fortschreiben --
    else if (bodyLower.startsWith('/row')) {
      const resolved = resolveHorizontalSpans(
        entries,
        colspecs,
        appendLog,
        tableNumber
      );
      const ncells = resolved.length;
      const nspans = activeSpans.filter((n) => n > 0).length;

      // Kernbedingung: mehr Belegungen als Spalten → Geometrie kaputt
      if (ncells + nspans > ncols) {
        if (isEmptyPhantomRow(tmpRow)) {
          brokenRows.push(tmpRow);
        }
        // „EPIC“ bezieht sich auf den historischen Arbortext-Editor-Bug
        appendLog(
          `<!-- FIXED EPIC ERROR: @morerows attributes inconsistent! Table ${tableNumber} Row ${rowNumber} -->\n`
        );
      }

      // Span-Vektor für die *nächste* Zeile aktualisieren:
      // - aktive Spans um 1 verringern
      // - freie Spalten mit den morerows-Werten der neuen Zellen belegen
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
          // Zu wenige Zellen, obwohl Spalten frei wären — ebenfalls inkonsistent
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

    // ---- </table> : am Tabellenende dürfen keine Spans „offen“ bleiben ----
    else if (bodyLower.startsWith('/table')) {
      const openSpans = activeSpans.filter((n) => n > 0);
      if (openSpans.length > 0) {
        // Meldung bewusst wie im Original (Tippfehler „incinsistent“)
        appendLog(
          `<!-- ERROR: @morerows attributes incinsistent! Table ${tableNumber} -->\n`
        );
      }
    }

    // Jeden Knoten im Baum ablegen (Index → body/content), auch Nicht-Table-Tags
    tree.set(tag.index, { body: tag.body, content: tag.content });
  }

  return { tree, brokenRows, log };
}

/**
 * Verringert @morerows an einem Tag-Rumpf um die Differenz, analog zum
 * Original: Ersetzung nach Muster MOREROWS="…", Ergebnis immer großgeschrieben.
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
 * Phase 3 — Reparatur: Phantom-Zeilen löschen und @morerows anpassen
 * ------------------------------------------------------------------
 * Phantom-Zeilen werden von hinten nach vorn entfernt (wichtig, wenn eine
 * Tabelle mehrere Fehlerzeilen hat). Für jede gelöschte Zeile laufen wir
 * im Dokument *rückwärts* und verringern jedes @morerows, dessen Span bis
 * in die gelöschte Zeile gereicht hätte:
 *
 *   rowDistance = Anzahl von <row>-Starttags zwischen Entry und Phantom-Zeile
 *   wenn rowDistance <= morerows → dieser Span ragte hinein → morerows -= 1
 *
 * @param {Map<number, { body: string, content: string }>} tree
 * @param {{ index: number, body: string, content: string }[][]} brokenRows
 */
function fix(tree, brokenRows) {
  // Index 0 ist der Text vor dem ersten „<“ — wie im Original verwerfen
  tree.delete(0);

  // Von hinten: spätere Phantom-Zeilen zuerst, damit der Rückwärtslauf
  // für frühere Fehler die schon gelöschten späteren Zeilen nicht mitzählt
  for (const tmpRow of [...brokenRows].reverse()) {
    const rowStart = tmpRow[0].index;

    // Komplette Phantom-Zeile entfernen: <row> … </row>
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

    // Rückwärts bis zum Dokumentanfang: Spans kürzen, die in die
    // gelöschte Zeile gezeigt haben
    let rowDistance = 0;
    // Wie im Original: von rowStart-1 abwärts bis einschließlich Index 1
    for (let num = rowStart - 1; num >= 1; num--) {
      const elem = tree.get(num);
      if (!elem) continue; // bereits gelöschte Knoten überspringen

      const lower = elem.body.toLowerCase();
      if (lower.startsWith('row')) {
        rowDistance += 1;
      } else if (lower.startsWith('entry')) {
        let morerows = 0;
        const attr = getAttr(elem.body, 'morerows');
        if (attr != null) morerows = parseInt(attr, 10);

        // Span reicht (noch) bis zur gelöschten Zeile → um 1 verkürzen
        const newMorerows =
          rowDistance <= morerows ? morerows - 1 : morerows;

        elem.body = rewriteMorerows(elem.body, newMorerows);
        tree.set(num, elem);
      }
    }
  }
}

/**
 * Phase 4 — Serialisierung zurück nach SGML
 * -----------------------------------------
 * Knoten in Index-Reihenfolge als „<body>content“ ausgeben.
 * Im Gegensatz zum Python-2-`print`-Softspace erzeugen wir hier bewusst
 * *keine* künstlichen Leerzeichen zwischen Tags — die CALS-Geometrie
 * (welche Zeilen/Attribute) bleibt identisch zum Originalalgorithmus.
 *
 * @param {Map<number, { body: string, content: string }>} tree
 * @param {string} log
 * @returns {string}
 */
function serialize(tree, log) {
  const keys = [...tree.keys()].sort((a, b) => a - b);
  let out = log;
  if (log && !log.endsWith('\n')) out += '\n';
  // Leerraum zwischen Log und Dokument (wie `print log` + folgende Ausgabe)
  if (log) out += '\n';

  for (const key of keys) {
    const node = tree.get(key);
    out += `<${node.body}>${node.content}`;
  }
  return out;
}

/**
 * Öffentliche API: SGML-String mit kaputter CALS-Geometrie → reparierter String.
 *
 * @param {string} sgmlInput  Inhalt z. B. von broken.sgml
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
};
