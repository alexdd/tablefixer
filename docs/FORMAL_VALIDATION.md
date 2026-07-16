# Formal validation of `tablefixer.py`

## Claim

For the repository fixtures, the 2014 Python algorithm is **correct** with respect
to the CALS occupancy invariant \(I\) defined below.

\[
\texttt{broken.sgml} \not\models I
\;\xrightarrow{\;\texttt{tablefixer.py}\;}\;
\texttt{result.sgml} \models I
\]

## Invariant \(I\) (occupancy model)

For every CALS table with `@cols = N`, scan rows top-to-bottom while maintaining
a per-column remaining-span vector \(S\):

1. **Row bound.** At each row \(r\) with resolved cell count \(C(r)\)
   (horizontal `@namest`/`@nameend` spans expand to \(|end-start|+1\) cells):

   \[
   C(r) + \bigl|\{c \mid S[c] > 0\}\bigr| \le N
   \]

2. **Table closure.** After the last row, \(S\) is the zero vector
   (no `@morerows` extends past `</table>`).

This is exactly the model implemented by `tablefixer.py` (and the Node port).

## Theorems checked by `test/formal-validation.py`

| ID | Statement | Result on fixtures |
|---|---|---|
| **T1** | Precondition: `broken.sgml` ⊭ \(I\) | 7 `row_overflow` violations |
| **T2a** | Python fix-log ≡ `result.sgml` fix-log | equal (7 FIXED EPIC ERROR lines) |
| **T2b** | Python output geometry ≡ `result.sgml` | equal (5 tables) |
| **T2c** | Softspace-accurate Python stdout == `result.sgml` | exact byte match |
| **T3a** | Postcondition: `result.sgml` ⊨ \(I\) | 0 violations |
| **T3b** | Live Python output ⊨ \(I\) | 0 violations |
| **T4a–c** | Node port geometry, invariant, and log ≡ Python | agree |
| **T5a–e** | Repair soundness / completeness | 7 empty phantoms deleted; final merged table unchanged (10 rows) |

## Scope

This is a **fixture-complete formal validation** of the algorithm’s intended
special case (Epic/Arbortext phantom rows), not a proof for arbitrary SGML:

- Correctness is relative to invariant \(I\) and the recorded oracle `result.sgml`.
- The algorithm deletes only empty phantom rows that cause overflow; it does not
  attempt a general CALS normalizer for all possible corruptions.
- Non-geometry concerns (DTD validity, omitted-tag minimization, etc.) are out of scope.

## How to run

```bash
python3 test/formal-validation.py
# or
npm run test:formal
```
