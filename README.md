# tablefixer

Repairs inconsistent **CALS table geometry** in SGML documents — specifically broken `@morerows` row spans.

---

## What was the algorithm used for?

The original code (`tablefixer.py`, © Alex Düsel 2014) comes from technical documentation / the SGML world around the [CALS table model](https://www.oasis-open.org/specs/a502.htm) (common in DocBook and similar DTDs).

In CALS, `@morerows` on an `<entry>` means the cell extends that many *additional* rows downward. In those following rows, the affected column must **not** have its own `<entry>` — the column is already occupied by the span.

When editing such tables in SGML/XML editors (historically including **PTC Arbortext Editor / “Epic”**), a typical corruption pattern appeared:

* empty “phantom” `<row>` elements with a single empty `<entry>`
* even though overlying `@morerows` still occupy those columns
* so new cells + active spans become greater than `@cols`

The fixer was a **batch repair tool** for exactly that case: make broken CALS geometry in SGML valid again without rewriting the rest of the document structure.

Original reference / blog: <http://www.mandarine.tv/#post-667>

---

## What does the algorithm do?

Input: SGML with CALS tables (`broken.sgml`).  
Output: SGML with corrected geometry (`result.sgml` as reference), plus log comments describing the fixes.

Four phases:

1. **Tokenize** — Split character-by-character into a flat tag list (not a full SGML parser; enough for `table` / `tgroup` / `colspec` / `row` / `entry`).
2. **Simulate geometry** — Keep a per-column span counter. At the end of each row, check:
   `new cells + still-active spans > cols` → geometry is broken.
3. **Detect phantom rows** — Mark broken rows that consist of only one empty `<entry>` as deletion candidates (“FIXED EPIC ERROR …”).
4. **Repair** — Remove those rows and decrement every `@morerows` that reached into the deleted row by `1`.

Correct tables — including heavily merged ones (see the last table in the test data) — are left unchanged.

The SGML test data (`broken.sgml`) must **not** be modified; it is the fixed input reference.

---

## Experiment: short Python then vs. LLM port now

The original Python 2 code was an **experiment** in how briefly this tricky special case could be solved with the Python standard library — dense, little abstraction, hard to read.

**This project is the counter-experiment:** How well can LLMs today analyze such an algorithm, explain it, and port it into a clearly structured, thoroughly commented implementation?

| Then (2014) | Now |
|---|---|
| `tablefixer.py` — Python 2, as short as possible | `src/tablefixer.js` — Node.js, as understandable as possible |
| implicit state, sparse comments | named phases, documented invariants |
| `run.bat` → `result.sgml` | `npm start` / `npm test` |

The original code remains in the repository.

---

## Node.js module (standalone)

No dependencies. Node.js standard library only.

### Usage

```bash
# Repair to stdout (default input: broken.sgml)
npm start
# or
node bin/tablefixer.js broken.sgml > fixed.sgml

# Arbitrary input file
node bin/tablefixer.js path/to/file.sgml > out.sgml

# Unit tests for every exported function + geometry check vs result.sgml
npm test

# Unit tests only / geometry regression only
npm run test:unit
npm run test:geometry
```

### API

```js
const { fixCalsTables } = require('./src/tablefixer');

const input = require('fs').readFileSync('broken.sgml', 'utf8');
const { sgml, log, brokenRowCount } = fixCalsTables(input);
// sgml = log comments + repaired document
```

### Files

| File | Role |
|---|---|
| `tablefixer.py` | Original algorithm (Python 2, 2014) |
| `broken.sgml` | Test data with broken CALS geometry (**immutable**) |
| `result.sgml` | Reference output of the original |
| `src/tablefixer.js` | Clearly commented Node.js port |
| `bin/tablefixer.js` | CLI |
| `test/unit/*.test.js` | Unit tests for every exported function |
| `test/compare-geometry.js` | End-to-end CALS geometry comparison against `result.sgml` |

---

## License / provenance

Original algorithm: © Alex Düsel 2014 — <http://www.mandarine.tv>  
Node.js port: LLM-assisted analysis and porting experiment based on this repository.
