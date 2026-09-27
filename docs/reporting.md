# Reports, grouping, and history

[← Project overview](../README.md)

The report keeps the evidence behind each diagnosis and distinguishes observed failures from guesses.

## What a failure is

Every failure carries what it is, not just a display string:

| field | meaning |
|---|---|
| `tool` | which parser produced it |
| `code` | a diagnostic identifier — `TS2551`, `no-unused-vars`, `E0308` |
| `subject` | the name of the site that failed — a test name, a method |
| `label` | a constant the tool prints for a class of failure — `compile error` |
| `category` | `test`, `lint`, `typecheck`, `compile`, `build`, `runtime`, `package`, `vcs`, `deploy`, or `unknown` for the generic reader's guesses |
| `severity` | `error` or `warning`; warnings never become failures |
| `file` `line` `col` `message` `stmt` `trace` | source location, diagnostic text, quoted statement, and stack; `line` and `col` count from 1 |

`code`, `subject` and `label` are alternatives — a parser declares whichever it actually
found, and never two. `title` is unchanged and still carries the display string, so
anything reading it keeps working.

This is what makes grouping work without a lookup table. A `code` is the identity of a
problem, so it stays in the fingerprint and the echoed source line drops out — the same
lint in forty places is one thing to fix. A `subject` is the axis being grouped across,
so it never enters the fingerprint and the failing expression stays as the discriminator.
That relationship comes from the field's meaning rather than a tool-specific rule.

## One bug, or eighty?

A single defect can make dozens of tests fail. Grouping related failures helps show
the shared cause without dropping the individual results.

whyitbroke groups failures that share a likely cause and leads with the count:

```
  ✗ 85 failed, 1973 passed, 25 skipped in 3.58s
    2 likely causes, 14 sites (+15 others)

  tests/test_basic.py:642  test_choice_argument_none  (+9 more sites)
    assert "Error: Missing argument" in "...Failure: Missing argument"
      also tests/test_options.py:1951
```

**Over-splitting is cheap; over-merging is fatal.** Split one cause in two and you
read an extra block. Merge two causes into one and you fix the exemplar, rerun, and
watch the rest still fail — after which the "likely cause" line is worth nothing
anywhere. So the grouping refuses whenever it is unsure, and it is designed to be
able to say nothing at all.

It is deterministic — an exact fingerprint, no similarity score, no model. A fuzzy
threshold would let the same suite report a different number of causes run to run,
and "these share this signature" is something you can check by eye in a way that
"these scored 0.72" is not.

What keeps it honest:

- Quoted text that is short and has no spaces is a **name** and is kept, so
  `KeyError: 'exp'` never merges with `KeyError: 'sub'`. Longer quoted text is data
  and is abstracted away.
- A path must prove itself with separators or a known extension, so `cart.total` is
  never mistaken for a filename.
- What a resolver says it could not find is the **operand**, not an incidental path, and
  is kept whatever it looks like. `Cannot find module './a.js'` and `'./b.js'` are two
  things to install, not one cause with two sites.
- A signature carrying fewer than two real words is refused outright — forty
  unrelated `assert 1 == 2` failures do not become "one likely cause".
- Three sites minimum. Two failures sharing a shape is usually coincidence.

Nothing is hidden silently: `failures` is unchanged in `--json`, and the GitHub job
summary carries the failure list up to GitHub's 1 MiB step limit before marking its own
truncation. Workflow annotations are capped at GitHub's ten-error limit and their
messages stay below 64 KiB; explicit notices point to the summary and `--json` whenever
a platform limit is reached. Grouping only decides
what leads: the terminal's five slots, the job summary's sections, and the run's notice
line. `--no-cluster` turns it off everywhere.

Source context is read from the file on disk. If the file has changed since the command
ran — you edited it, or you piped in saved output — whyitbroke says so and shows the line
the tool itself reported, rather than confidently pointing a caret at the wrong code. Most
tools count a tab as one column and a terminal draws it wider, so the line under the source
keeps the source's tabs, and the caret lands under the character the tool pointed at.

## What changed since last time

`--since-last` marks the causes that were not there the last time you ran the same
command, so a wall of red you have already read does not look the same as a wall that
just grew.

```console
$ whyitbroke --since-last pytest

  ✗ 3 failed, 2 passed in 0.01s
    1 new since your last run
    1 from that run is no longer reported

  test_shop.py:7  test_expired_token  new
    KeyError: 'aud'
```

A cause is identified by the fingerprint the grouping uses, so it survives moving to
another file, another line, or another position in the output — and two different bugs
never collapse into one. Where that fingerprint is too thin to group on, the test or
symbol it happened to is part of the identity as well: `assert 1 == 2` and `assert 3 == 4`
reduce to the same shape, and without that a second test failing would report nothing new
and the first being fixed would report nothing gone.

Runs only ever compare against runs of **the same command, in the same directory**.
`pytest tests/unit` and `pytest tests/api` do not cover the same code, so a cause missing
from one is not a cause that got fixed; they keep separate histories and never meet. If the
same command reports a different tool than it did last time — `npm test` moving from jest
to vitest — the run still compares, but "no longer reported" is withheld, because every
cause being missing is then a change of tool and not a change of code.

**A run that succeeds is part of the history.** It writes the empty baseline: nothing is
failing here now — decided by the exit code, not by the output, so a runner that exits
zero having printed something readable still records that nothing is failing. What it
printed is still reported in full; only the baseline is empty. Without it, a failure that came back after a green run was compared
against the run that first found it and called nothing new — which is exactly the moment a
reader wants to be told. Nothing is printed for a command that worked.

**A piped log has to be named.** `pytest tests/unit | whyitbroke --since-last` carries no
command at all, so nothing tells it from `pytest tests/api | whyitbroke --since-last` in the
same directory: they shared one record, overwrote each other, and each reported the other's
failures as fixed. Guessing the upstream command from its output is not available either —
the log is the thing in question. So an unnamed pipe is not compared and not recorded, and
says so; `--id NAME` is how a pipeline says which one it is.

```console
$ pytest tests/unit | whyitbroke --since-last
    not tracked: a piped log carries no command to tell it from another. Name it with --id NAME

$ pytest tests/unit | whyitbroke --since-last --id unit
    1 new since your last run
```

A name is scoped to the directory it is used in, and to the tool the log turned out to be
from, so one `--id ci` covering a job that pipes eslint and then pytest still keeps two
records rather than having each run wipe the other.

For mixed logs, the primary tool identifies the run, and comparison includes every
reported tool's causes. New failures are marked in their own tool's section; identical
messages from different tools keep separate identities. The last history format that
used 32-bit identifiers is compared once during migration, then the completed run is
saved under the current 96-bit identity — for a wrapped command, which names itself in
its argv. A record that scheme wrote for a *piped* run was keyed on the directory and the
tool alone, so it belongs to whichever unnamed pipe wrote it; a `--id` pipeline does not
adopt one, and starts its own baseline instead. Unchanged causes are not called new; the "no
longer reported" count is withheld for that transition because a collision in an old
saved hash cannot be ruled out. Older incompatible records start a fresh baseline.

The two claims are not equally cheap. "New" is a statement about what is present, and
it is safe. "No longer reported" is a statement about *absence*, and absence is only
evidence when the run actually got far enough to speak — so it is withheld whenever the
capture was truncated or the command never started. For the same reason a run like that
is never recorded: storing its short list would make the next run announce everything it
lost as newly appeared.

Nothing about tracking can change the outcome of a run. If the cache cannot be read or
written, whyitbroke says nothing about history and prints the same diagnosis it always
would.
