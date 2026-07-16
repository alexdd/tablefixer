# tablefixer

Repariert inkonsistente **CALS-Tabellen-Geometrie** in SGML-Dokumenten — speziell fehlerhafte `@morerows`-Zeilenspans.

---

## Wofür wurde der Algorithmus gebraucht?

Der Originalcode (`tablefixer.py`, © Alex Düsel 2014) stammt aus der technischen Dokumentation / SGML-Welt rund um das [CALS-Tabellenmodell](https://www.oasis-open.org/specs/a502.htm) (häufig in DocBook und ähnlichen DTDs).

In CALS bedeutet `@morerows` an einem `<entry>`: die Zelle reicht über so viele *weitere* Zeilen nach unten. In diesen Folgezeilen darf für die betroffene Spalte **kein** eigenes `<entry>` stehen — die Spalte ist bereits durch den Span belegt.

Beim Bearbeiten solcher Tabellen in SGML-/XML-Editoren (historisch u. a. **PTC Arbortext Editor / „Epic“**) entstanden typische Korruptionsmuster:

* leere „Phantom“-`<row>`-Zeilen mit einem leeren `<entry>`
* obwohl darüberliegende `@morerows` die Spalten dort noch belegen
* die Summe aus neuen Zellen + aktiven Spans wird dann größer als `@cols`

Der Fixer war ein **Batch-Reparaturwerkzeug** für genau diesen Fall: kaputte CALS-Geometrie in SGML wieder gültig machen, ohne die restliche Dokumentstruktur anzufassen.

Referenz / Blog (Original): <http://www.mandarine.tv/#post-667>

---

## Was macht der Algorithmus genau?

Eingabe: SGML mit CALS-Tabellen (`broken.sgml`).  
Ausgabe: SGML, in dem die Geometrie wieder stimmt (`result.sgml` als Referenz), plus Log-Kommentare über durchgeführte Fixes.

Ablauf in vier Phasen:

1. **Tokenisieren** — Zeichengenau in eine flache Liste von Tags zerlegen (kein vollständiger SGML-Parser; reicht für `table` / `tgroup` / `colspec` / `row` / `entry`).
2. **Geometrie simulieren** — Pro Spalte einen Span-Zähler führen. Am Ende jeder Zeile prüfen:
   `Anzahl neuer Zellen + noch aktive Spans > cols` → Geometrie kaputt.
3. **Phantom-Zeilen erkennen** — Kaputte Zeilen, die nur aus einem leeren `<entry>` bestehen, als Löschkandidaten merken („FIXED EPIC ERROR …“).
4. **Reparieren** — Diese Zeilen entfernen und alle `@morerows`, die in die gelöschte Zeile hineinragten, um `1` verringern.

Korrekte, auch komplex gemergete Tabellen (siehe letzte Tabelle in den Testdaten) bleiben unverändert.

Die SGML-Testdaten (`broken.sgml`) werden **nicht** verändert; sie sind die feste Eingabe-Referenz.

---

## Experiment: Kurz-Python damals vs. LLM-Port heute

Der ursprüngliche Python-2-Code war ein **Experiment**, wie kurz sich dieser kniffelige Spezialfall mit der Python-Standardbibliothek lösen lässt — dicht, wenig Abstraktion, dafür schwer lesbar.

**Dieses Projekt ist das Gegenexperiment:** Wie gut können LLMs heute so einen Algorithmus analysieren, erklären und in eine klar strukturierte, ausführlich kommentierte Implementierung portieren?

| Damals (2014) | Heute |
|---|---|
| `tablefixer.py` — Python 2, möglichst kurz | `src/tablefixer.js` — Node.js, möglichst nachvollziehbar |
| implizite Zustände, knappe Kommentare | benannte Phasen, dokumentierte Invarianten |
| `run.bat` → `result.sgml` | `npm start` / `npm test` |

Der Originalcode bleibt im Repo erhalten.

---

## Node.js-Modul (Standalone)

Keine Dependencies. Nur die Node.js-Standardbibliothek.

### Installation / Nutzung

```bash
# Reparatur auf stdout (Standard-Eingabe: broken.sgml)
npm start
# oder
node bin/tablefixer.js broken.sgml > fixed.sgml

# Beliebige Eingabedatei
node bin/tablefixer.js pfad/zur/datei.sgml > out.sgml

# Geometrie gegen result.sgml prüfen
npm test
```

### API

```js
const { fixCalsTables } = require('./src/tablefixer');

const input = require('fs').readFileSync('broken.sgml', 'utf8');
const { sgml, log, brokenRowCount } = fixCalsTables(input);
// sgml = Log-Kommentare + repariertes Dokument
```

### Dateien

| Datei | Rolle |
|---|---|
| `tablefixer.py` | Original-Algorithmus (Python 2, 2014) |
| `broken.sgml` | Testdaten mit kaputter CALS-Geometrie (**unveränderlich**) |
| `result.sgml` | Referenzausgabe des Originals |
| `src/tablefixer.js` | Klar kommentierter Node.js-Port |
| `bin/tablefixer.js` | CLI |
| `test/compare-geometry.js` | Vergleich der CALS-Geometrie mit `result.sgml` |

---

## Lizenz / Herkunft

Originalalgorithmus: © Alex Düsel 2014 — <http://www.mandarine.tv>  
Node.js-Port: LLM-gestütztes Analyse- und Portierungs-Experiment auf Basis dieses Repos.
