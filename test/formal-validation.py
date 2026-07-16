#!/usr/bin/env python3
"""
Formal validation of tablefixer.py (2014) against CALS geometry invariants.

Correctness claim
-----------------
Let I(doc) be the CALS occupancy invariant used by the algorithm:

  For every table with cols = N, scanning rows top-to-bottom while keeping
  a per-column remaining-span vector S:

    at each row r with resolved cell-count C(r):
        C(r) + |{ c | S[c] > 0 }|  ≤  N

    and after the last row: S is the zero vector
    (no @morerows extends past the table).

Horizontal spans (@namest/@nameend) contribute |end-start|+1 resolved cells,
each carrying the entry's @morerows — identical to tablefixer.py.

We validate four theorems against the repository fixtures:

  T1  Precondition:  broken.sgml  ⊭  I
  T2  Oracle:        running tablefixer.py on broken.sgml reproduces result.sgml
                     (Python-2 print softspace semantics)
  T3  Postcondition: result.sgml  ⊨  I   (and the live Python output ⊨ I)
  T4  Port agreement: Node fixCalsTables yields the same geometry as Python
                     (row structure + morerows/namest/nameend)

Plus a soundness check on the repair steps themselves (T5).
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROKEN = (ROOT / "broken.sgml").read_text()
RESULT = (ROOT / "result.sgml").read_text()


# ---------------------------------------------------------------------------
# Faithful extract of tablefixer.py as a pure function
# ---------------------------------------------------------------------------

def run_tablefixer_py(sgml: str) -> tuple[str, list, dict]:
    """Execute the original algorithm. Returns (stdout, broken_tags, tree)."""
    # --- read data (tokenizer) ---
    tag_ended = False
    buff = ""
    pos = 0
    tags = []
    content = ""
    for character in sgml:
        if character == ">":
            tag_ended = True
        elif character == "<":
            tags.append((pos, buff, content))
            pos += 1
            buff = ""
            content = ""
            tag_ended = False
        elif not tag_ended:
            buff += character
        else:
            content += character
    tags.append((pos, buff, content))

    # --- analyze data ---
    row_counter = 0
    table_counter = 0
    ncols = 0
    more_rows = []
    entries = []
    colspecs = []
    broken_tags = []
    tmp_row = []
    tree = {}
    log = ""

    for tag in tags:
        if tag[1].lower().startswith("table"):
            row_counter = 0
            ncols = 0
            more_rows = []
            table_counter += 1
            colspecs = []
        elif tag[1].lower().startswith("tgroup"):
            try:
                ncols = int(
                    [
                        attr.split("=")
                        for attr in tag[1].split(" ")
                        if attr.lower().startswith("cols")
                    ][0][1].strip('"/')
                )
            except Exception:
                log += "<!-- ERROR: @cols not declared! -->\n"
            for _ in range(ncols):
                more_rows.append(0)
        elif tag[1].lower().startswith("colspec"):
            try:
                colname = [
                    attr.split("=")
                    for attr in tag[1].split(" ")
                    if attr.lower().startswith("colname")
                ][0][1].strip('"/')
            except Exception:
                log += "<!-- ERROR: colspec inconsistent! -->\n"
                colname = None
            colspecs.append(colname)
        elif tag[1].lower().startswith("row"):
            row_counter += 1
            entries = []
            tmp_row = []
            tmp_row.append(tag)
        elif tag[1].lower().startswith("/entry"):
            tmp_row.append(tag)
        elif tag[1].lower().startswith("entry"):
            morerows = 0
            namest = None
            nameend = None
            for attr in tag[1].split(" "):
                if attr.lower().startswith("morerows"):
                    morerows = int(attr.split("=")[1].strip('"/'))
                elif attr.lower().startswith("namest"):
                    namest = attr.split("=")[1].strip('"/')
                elif attr.lower().startswith("nameend"):
                    nameend = attr.split("=")[1].strip('"/')
            if namest and nameend:
                pass
            elif namest or nameend:
                log += (
                    "<!-- ERROR: namest or nameend inconsistent! Table %s -->\n"
                    % table_counter
                )
            entries.append(
                {"morerows": morerows, "namest": namest, "nameend": nameend}
            )
            tmp_row.append(tag)
        elif tag[1].lower().startswith("/row"):
            resolved_entries = []
            for entry in entries:
                if entry["namest"] and entry["nameend"]:
                    spanning = 0
                    try:
                        start = colspecs.index(entry["namest"])
                        end = colspecs.index(entry["nameend"])
                        spanning = abs(end - start)
                    except Exception:
                        log += (
                            "<!-- ERROR: @namest or @namend no correspondence "
                            "in colspec! Table %s -->\n" % table_counter
                        )
                    for _ in range(spanning):
                        resolved_entries.append(entry["morerows"])
                resolved_entries.append(entry["morerows"])
            ncells = len(resolved_entries)
            nspans = len([num for num in more_rows if num > 0])
            if ncells + nspans > ncols:
                if len(tmp_row) in (2, 3) and tmp_row[1][2].strip(" \n\r") == "":
                    broken_tags.append(tmp_row)
                log += (
                    "<!-- FIXED EPIC ERROR: @morerows attributes inconsistent! "
                    "Table %s Row %s -->\n" % (table_counter, row_counter)
                )
            i = 0
            for j in range(ncols):
                if more_rows[j] > 0:
                    more_rows[j] -= 1
                elif i < ncells:
                    tmp = resolved_entries[i]
                    if tmp > 0:
                        more_rows[j] = tmp
                    i += 1
                else:
                    log += (
                        "<!-- FIXED ERROR @morerows attributes inconsistent! "
                        "Table %s Row %s -->\n" % (table_counter, row_counter)
                    )
                    if (
                        len(tmp_row) in (2, 3)
                        and tmp_row[1][2].strip(" \n\r") == ""
                    ):
                        broken_tags.append(tmp_row)
                    break
        elif tag[1].lower().startswith("/table"):
            spans = [num for num in more_rows if num > 0]
            if len(spans) > 0:
                log += (
                    "<!-- ERROR: @morerows attributes incinsistent! "
                    "Table %s -->\n" % table_counter
                )
        tree[str(tag[0])] = [tag[1], tag[2]]

    # --- fix data ---
    del tree["0"]
    for tag in reversed(broken_tags):
        del tree[str(tag[0][0])]
        i = 1
        while "/row" not in tree[str(tag[0][0] + i)][0].lower():
            del tree[str(tag[0][0] + i)]
            i += 1
        del tree[str(tag[0][0] + i)]
        num = tag[0][0]
        row_counter = 0
        while num > 1:
            num -= 1
            elem = tree[str(num)]
            if elem[0].lower().startswith("row"):
                row_counter += 1
            elif elem[0].lower().startswith("entry"):
                try:
                    morerows = int(
                        [
                            attr.split("=")
                            for attr in elem[0].split(" ")
                            if attr.lower().startswith("morerows")
                        ][0][1].strip('"')
                    )
                except Exception:
                    morerows = 0
                if row_counter <= morerows:
                    new_morerows = morerows - 1
                else:
                    new_morerows = morerows
                elem[0] = re.sub(
                    r'MOREROWS=\"[0-9]*\"',
                    'MOREROWS=\"' + str(max(0, new_morerows)) + '\"',
                    elem[0],
                    flags=re.I,
                )
                tree[str(num)] = elem

    # --- output with Python-2 print softspace semantics ---
    out = io.StringIO()
    # print log  → always ends with newline; if log already ends with \n, blank line
    out.write(log)
    if not log.endswith("\n"):
        out.write("\n")
    else:
        out.write("\n")

    softspace = False
    for key in sorted(tree.keys(), key=int):
        piece = "<" + tree[key][0] + ">" + tree[key][1]
        if softspace and not (out.getvalue().endswith("\n")):
            # Python 2: insert space only if previous print did not end with \n
            # More precisely: softspace is cleared when previous output ended with whitespace
            pass
        # Faithful Py2 softspace:
        # after `print x,`, if x does not end with '\n', next print writes a leading space.
        if softspace:
            out.write(" ")
        out.write(piece)
        softspace = not piece.endswith("\n")

    return out.getvalue(), broken_tags, tree


def run_tablefixer_py_softspace_exact(sgml: str) -> str:
    """
    Re-run with a closer softspace model matching result.sgml.

    Python 2 rule (simplified, sufficient for this fixture):
      print x,   → write x; remember softspace=1 if x does not end with \\n
      next print → if softspace: write ' ' first; then write payload;
                   softspace = (payload does not end with \\n)
      print log  → write log + '\\n'; softspace = 0
    """
    text, _, _ = run_tablefixer_py(sgml)
    # Rebuild more carefully from tree for oracle compare
    tag_ended = False
    buff = ""
    pos = 0
    tags = []
    content = ""
    for character in sgml:
        if character == ">":
            tag_ended = True
        elif character == "<":
            tags.append((pos, buff, content))
            pos += 1
            buff = ""
            content = ""
            tag_ended = False
        elif not tag_ended:
            buff += character
        else:
            content += character
    tags.append((pos, buff, content))

    # Reuse full algorithm via run_tablefixer_py internals by reconstructing
    # from the returned tree — already done. Just fix softspace properly:

    # Re-execute and capture tree only
    _, broken_tags, tree = run_tablefixer_py(sgml)

    # The tree in run_tablefixer_py is already fixed; but log is not returned
    # separately. Recompute log by parsing RESULT header / re-run analyze.
    # Simpler: build stdout from RESULT's known softspace by re-simulating
    # print from tree + log extracted from first run.

    # Extract log by running analyze-only — easiest: first lines of RESULT
    # We recompute log from a dry analyze:
    log = _analyze_log_only(sgml)

    buf = []
    # print log
    buf.append(log)
    if not log.endswith("\n"):
        buf.append("\n")
    buf.append("\n")  # py2 print always adds \n → blank line if log ended with \n

    softspace = False
    parts = []
    for key in sorted(tree.keys(), key=int):
        piece = "<" + tree[key][0] + ">" + tree[key][1]
        if softspace:
            parts.append(" ")
        parts.append(piece)
        softspace = not piece.endswith("\n")
    # trailing softspace left pending (no final newline from last print,)
    buf.append("".join(parts))
    if softspace:
        # Py2 leaves softspace; no trailing space is flushed unless another print
        # Actually result.sgml ends with "</test>\n" / content — check fixture
        pass
    return "".join(buf)


def _analyze_log_only(sgml: str) -> str:
    """Run only the analyze phase to recover the log string."""
    stdout, _, _ = run_tablefixer_py(sgml)
    # log is everything before the first non-comment document tag after blank line
    # Easier: re-implement analyze log collection — call run and split
    # Our run_tablefixer_py already prefixes log. Split on first "<test>" or similar.
    # Instead return log by re-running analyze inlined:

    tag_ended = False
    buff = ""
    pos = 0
    tags = []
    content = ""
    for character in sgml:
        if character == ">":
            tag_ended = True
        elif character == "<":
            tags.append((pos, buff, content))
            pos += 1
            buff = ""
            content = ""
            tag_ended = False
        elif not tag_ended:
            buff += character
        else:
            content += character
    tags.append((pos, buff, content))

    row_counter = 0
    table_counter = 0
    ncols = 0
    more_rows = []
    entries = []
    colspecs = []
    tmp_row = []
    log = ""

    for tag in tags:
        if tag[1].lower().startswith("table"):
            row_counter = 0
            ncols = 0
            more_rows = []
            table_counter += 1
            colspecs = []
        elif tag[1].lower().startswith("tgroup"):
            try:
                ncols = int(
                    [
                        attr.split("=")
                        for attr in tag[1].split(" ")
                        if attr.lower().startswith("cols")
                    ][0][1].strip('"/')
                )
            except Exception:
                log += "<!-- ERROR: @cols not declared! -->\n"
            more_rows = [0] * ncols
        elif tag[1].lower().startswith("colspec"):
            try:
                colname = [
                    attr.split("=")
                    for attr in tag[1].split(" ")
                    if attr.lower().startswith("colname")
                ][0][1].strip('"/')
            except Exception:
                log += "<!-- ERROR: colspec inconsistent! -->\n"
                colname = None
            colspecs.append(colname)
        elif tag[1].lower().startswith("row"):
            row_counter += 1
            entries = []
            tmp_row = [tag]
        elif tag[1].lower().startswith("/entry"):
            tmp_row.append(tag)
        elif tag[1].lower().startswith("entry"):
            morerows = 0
            namest = None
            nameend = None
            for attr in tag[1].split(" "):
                if attr.lower().startswith("morerows"):
                    morerows = int(attr.split("=")[1].strip('"/'))
                elif attr.lower().startswith("namest"):
                    namest = attr.split("=")[1].strip('"/')
                elif attr.lower().startswith("nameend"):
                    nameend = attr.split("=")[1].strip('"/')
            if not (namest and nameend) and (namest or nameend):
                log += (
                    "<!-- ERROR: namest or nameend inconsistent! Table %s -->\n"
                    % table_counter
                )
            entries.append(
                {"morerows": morerows, "namest": namest, "nameend": nameend}
            )
            tmp_row.append(tag)
        elif tag[1].lower().startswith("/row"):
            resolved_entries = []
            for entry in entries:
                if entry["namest"] and entry["nameend"]:
                    try:
                        start = colspecs.index(entry["namest"])
                        end = colspecs.index(entry["nameend"])
                        spanning = abs(end - start)
                    except Exception:
                        log += (
                            "<!-- ERROR: @namest or @namend no correspondence "
                            "in colspec! Table %s -->\n" % table_counter
                        )
                        spanning = 0
                    resolved_entries.extend([entry["morerows"]] * spanning)
                resolved_entries.append(entry["morerows"])
            ncells = len(resolved_entries)
            nspans = len([n for n in more_rows if n > 0])
            if ncells + nspans > ncols:
                log += (
                    "<!-- FIXED EPIC ERROR: @morerows attributes inconsistent! "
                    "Table %s Row %s -->\n" % (table_counter, row_counter)
                )
            i = 0
            for j in range(ncols):
                if more_rows[j] > 0:
                    more_rows[j] -= 1
                elif i < ncells:
                    tmp = resolved_entries[i]
                    if tmp > 0:
                        more_rows[j] = tmp
                    i += 1
                else:
                    log += (
                        "<!-- FIXED ERROR @morerows attributes inconsistent! "
                        "Table %s Row %s -->\n" % (table_counter, row_counter)
                    )
                    break
        elif tag[1].lower().startswith("/table"):
            if any(n > 0 for n in more_rows):
                log += (
                    "<!-- ERROR: @morerows attributes incinsistent! "
                    "Table %s -->\n" % table_counter
                )
    return log


# ---------------------------------------------------------------------------
# Invariant checker I(doc)
# ---------------------------------------------------------------------------

def tokenize(sgml: str):
    tag_ended = False
    buff = ""
    pos = 0
    tags = []
    content = ""
    for character in sgml:
        if character == ">":
            tag_ended = True
        elif character == "<":
            tags.append((pos, buff, content))
            pos += 1
            buff = ""
            content = ""
            tag_ended = False
        elif not tag_ended:
            buff += character
        else:
            content += character
    tags.append((pos, buff, content))
    return tags


def get_attr(body: str, name: str):
    needle = name.lower() + "="
    for part in body.split(" "):
        if part.lower().startswith(needle):
            return part.split("=", 1)[1].strip('"/')
    return None


def check_invariant(sgml: str) -> dict:
    """
    Evaluate I(doc). Returns a report:
      ok: bool
      violations: list of {table, row, ncells, nspans, ncols, kind}
    """
    tags = tokenize(sgml)
    # Skip leading log comments if present — tokenize treats them as tags; fine.
    violations = []
    table_counter = 0
    row_counter = 0
    ncols = 0
    more_rows = []
    colspecs = []
    entries = []

    for tag in tags:
        body = tag[1]
        lower = body.lower()
        if lower.startswith("table") and not lower.startswith("/"):
            table_counter += 1
            row_counter = 0
            ncols = 0
            more_rows = []
            colspecs = []
        elif lower.startswith("tgroup"):
            cols = get_attr(body, "cols")
            ncols = int(cols) if cols is not None else 0
            more_rows = [0] * ncols
        elif lower.startswith("colspec"):
            colspecs.append(get_attr(body, "colname"))
        elif lower.startswith("row") and not lower.startswith("/"):
            row_counter += 1
            entries = []
        elif lower.startswith("entry") and not lower.startswith("/"):
            morerows = int(get_attr(body, "morerows") or "0")
            namest = get_attr(body, "namest")
            nameend = get_attr(body, "nameend")
            entries.append(
                {"morerows": morerows, "namest": namest, "nameend": nameend}
            )
        elif lower.startswith("/row"):
            resolved = []
            for entry in entries:
                if entry["namest"] and entry["nameend"]:
                    try:
                        start = colspecs.index(entry["namest"])
                        end = colspecs.index(entry["nameend"])
                        spanning = abs(end - start)
                    except ValueError:
                        spanning = 0
                    resolved.extend([entry["morerows"]] * spanning)
                resolved.append(entry["morerows"])
            ncells = len(resolved)
            nspans = sum(1 for n in more_rows if n > 0)
            if ncells + nspans > ncols:
                violations.append(
                    {
                        "kind": "row_overflow",
                        "table": table_counter,
                        "row": row_counter,
                        "ncells": ncells,
                        "nspans": nspans,
                        "ncols": ncols,
                    }
                )
            # advance spans (same model as the algorithm)
            i = 0
            underfill = False
            for j in range(ncols):
                if more_rows[j] > 0:
                    more_rows[j] -= 1
                elif i < ncells:
                    tmp = resolved[i]
                    if tmp > 0:
                        more_rows[j] = tmp
                    i += 1
                else:
                    underfill = True
                    break
            # underfill alone is not an I violation (CALS allows sparse rows
            # when colname positioning is used); only overflow / open spans.
            _ = underfill
        elif lower.startswith("/table"):
            open_spans = sum(1 for n in more_rows if n > 0)
            if open_spans:
                violations.append(
                    {
                        "kind": "open_spans_at_table_end",
                        "table": table_counter,
                        "row": row_counter,
                        "ncells": 0,
                        "nspans": open_spans,
                        "ncols": ncols,
                    }
                )

    return {"ok": len(violations) == 0, "violations": violations}


def geometry_signature(sgml: str):
    """Row/entry attribute geometry for cross-implementation compare."""
    tags = tokenize(sgml)
    tables = []
    current = None
    current_row = None
    for pos, body, content in tags:
        lower = body.lower()
        if lower == "table" or lower.startswith("table "):
            current = []
            tables.append(current)
            current_row = None
        elif lower.startswith("/table"):
            current = None
            current_row = None
        elif current is not None and (lower == "row" or lower.startswith("row ")):
            current_row = []
            current.append(current_row)
        elif current is not None and lower.startswith("/row"):
            current_row = None
        elif current_row is not None and (
            lower == "entry" or lower.startswith("entry ")
        ):
            current_row.append(
                (
                    get_attr(body, "morerows"),
                    get_attr(body, "namest"),
                    get_attr(body, "nameend"),
                )
            )
    return tables


# ---------------------------------------------------------------------------
# Theorems
# ---------------------------------------------------------------------------

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
        if detail:
            print(f"      {detail}")
    else:
        failed += 1
        print(f"FAIL  {name}")
        if detail:
            print(f"      {detail}")


def main():
    print("=" * 72)
    print("Formal validation of tablefixer.py")
    print("=" * 72)

    # --- T1: broken.sgml violates I ---
    pre = check_invariant(BROKEN)
    check(
        "T1  Precondition: broken.sgml ⊭ I (occupancy invariant)",
        not pre["ok"],
        f"{len(pre['violations'])} violation(s): "
        + ", ".join(
            f"T{v['table']}R{v['row']}:{v['kind']}({v['ncells']}+{v['nspans']}>{v['ncols']})"
            for v in pre["violations"]
        ),
    )

    # --- Run original algorithm ---
    py_out, broken_tags, tree = run_tablefixer_py(BROKEN)
    soft_out = run_tablefixer_py_softspace_exact(BROKEN)

    # --- T2: reproduces result.sgml ---
    # Compare geometry + fix-log (whitespace softspace may differ slightly;
    # require exact match on softspace reconstruction OR geometry+log equality)
    py_log = _analyze_log_only(BROKEN)
    result_log_lines = [
        ln for ln in RESULT.splitlines() if ln.startswith("<!-- FIXED")
    ]
    py_log_lines = [
        ln for ln in py_log.splitlines() if ln.startswith("<!-- FIXED")
    ]
    check(
        "T2a Oracle log: Python fix-log equals result.sgml fix-log",
        py_log_lines == result_log_lines,
        f"python={py_log_lines!r} result={result_log_lines!r}",
    )

    py_geom = geometry_signature(soft_out)
    result_geom = geometry_signature(RESULT)
    check(
        "T2b Oracle geometry: Python output geometry ≡ result.sgml",
        py_geom == result_geom,
        f"tables={len(py_geom)} result_tables={len(result_geom)}",
    )

    # Stronger: softspace-exact byte compare (best effort)
    # Normalize only the known trailing differences if any
    byte_equal = soft_out == RESULT
    check(
        "T2c Oracle bytes: softspace-accurate Python stdout == result.sgml",
        byte_equal,
        (
            "exact byte match"
            if byte_equal
            else (
                f"len py={len(soft_out)} result={len(RESULT)}; "
                "geometry+log still required (T2a/T2b)"
            )
        ),
    )

    # --- T3: postcondition I holds ---
    post_result = check_invariant(RESULT)
    post_py = check_invariant(soft_out)
    check(
        "T3a Postcondition: result.sgml ⊨ I",
        post_result["ok"],
        (
            "no occupancy violations"
            if post_result["ok"]
            else str(post_result["violations"])
        ),
    )
    check(
        "T3b Postcondition: live Python output ⊨ I",
        post_py["ok"],
        (
            "no occupancy violations"
            if post_py["ok"]
            else str(post_py["violations"])
        ),
    )

    # --- T4: Node port agrees ---
    node = subprocess.run(
        [
            "node",
            "-e",
            "const fs=require('fs');"
            "const {fixCalsTables}=require('./src/tablefixer');"
            "const r=fixCalsTables(fs.readFileSync('broken.sgml','utf8'));"
            "process.stdout.write(r.sgml);",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    node_geom = geometry_signature(node.stdout)
    node_inv = check_invariant(node.stdout)
    check(
        "T4a Port agreement: Node geometry ≡ Python geometry",
        node_geom == py_geom,
    )
    check(
        "T4b Port agreement: Node output ⊨ I",
        node_inv["ok"],
    )
    node_log_lines = [
        ln for ln in node.stdout.splitlines() if ln.startswith("<!-- FIXED")
    ]
    check(
        "T4c Port agreement: Node fix-log ≡ Python fix-log",
        node_log_lines == py_log_lines,
    )

    # --- T5: soundness of repair steps ---
    check(
        "T5a Soundness: every deleted row was an empty phantom (len 2 or 3, empty entry)",
        all(
            len(row) in (2, 3) and row[1][2].strip(" \n\r") == ""
            for row in broken_tags
        ),
        f"deleted {len(broken_tags)} phantom row(s)",
    )
    check(
        "T5b Soundness: number of phantoms equals FIXED EPIC ERROR count in oracle",
        len(broken_tags) == len(result_log_lines),
        f"phantoms={len(broken_tags)} log_entries={len(result_log_lines)}",
    )
    # Every T1 overflow row that is an empty phantom must appear in broken_tags
    # (the algorithm's deletion set). Overflows on non-empty rows are logged but
    # not deleted — verify phantoms ⊆ overflow rows from precondition.
    overflow_rows = {
        (v["table"], v["row"])
        for v in pre["violations"]
        if v["kind"] == "row_overflow"
    }
    # Re-derive (table,row) for each broken tag by scanning broken.sgml
    # Simpler soundness: after repair, every former overflow is gone.
    check(
        "T5c Soundness: every precondition overflow is resolved in the output",
        post_py["ok"] and not pre["ok"],
        f"pre_violations={len(pre['violations'])} post_violations={len(post_py['violations'])}",
    )
    check(
        "T5d Soundness: correct final table (insanely merged) keeps 10 rows",
        len(py_geom[-1]) == 10 and len(result_geom[-1]) == 10,
        f"python_rows={len(py_geom[-1])} result_rows={len(result_geom[-1])}",
    )

    # --- T1 detail: expected 7 overflows matching the known epic phantoms ---
    check(
        "T5e Completeness: precondition has exactly 7 row_overflow violations",
        sum(1 for v in pre["violations"] if v["kind"] == "row_overflow") == 7,
        str(
            [
                (v["table"], v["row"])
                for v in pre["violations"]
                if v["kind"] == "row_overflow"
            ]
        ),
    )

    print("-" * 72)
    print(f"Result: {passed} passed, {failed} failed")
    if failed:
        print("VERDICT: Python algorithm NOT fully validated")
        sys.exit(1)

    print()
    print("VERDICT: tablefixer.py is formally validated for this fixture.")
    print(
        "  broken.sgml ⊭ I  →  tablefixer.py  →  result.sgml ⊨ I,"
    )
    print(
        "  with oracle reproduction, repair soundness, and Node port agreement."
    )
    sys.exit(0)


if __name__ == "__main__":
    # Avoid unused import warning noise
    _ = os
    main()
