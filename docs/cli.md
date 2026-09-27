# Using whyitbroke

[← Project overview](../README.md)

Install it, run a command or feed it a log, and choose terminal, JSON, or GitHub Actions output.

## Install

```bash
npm install -g whyitbroke
```

Or don't install anything:

```bash
npx whyitbroke pytest
```

Either way the command is `whyitbroke`.

## Use

```bash
whyitbroke npm test        # run it, print the distillation after
whyitbroke -q cargo build  # hide the command's own output entirely
npm test 2>&1 | whyitbroke # or pipe into it
whyitbroke < build.log     # or distil a log file you already saved
whyitbroke --json npm test # emit a stable result for CI and editor integrations
whyitbroke --github-actions npm test # add clickable errors to GitHub Actions logs
whyitbroke --format github npm test # equivalent long-form format selector
whyitbroke --no-source npm test # show failures without reading source files
whyitbroke --max-bytes 2000000 npm test # bound captured logs for large CI jobs
```

When wrapping a command, its exit code is passed straight through, so `whyitbroke`
can be left in a Makefile or a CI step. Piped input does not carry the upstream
command's exit status: whyitbroke exits `0` after processing it, which does not mean
the upstream command succeeded. Wrap the command when you need its exit status.
An optional `-` supports explicit piped input (`cmd | whyitbroke -`).

Unknown options and invalid option values exit `2` without starting the command.
Options belong before the command; its own arguments are passed through unchanged.
Use `--` to explicitly end whyitbroke's options. `--max-bytes` takes a decimal
integer of at least 1024.

If a failed command produces no recognized diagnostic, whyitbroke reports its exit
code and shows captured output (or points to output already streamed above).
If nothing was captured, it says so. Unrecognized piped text is also shown, with
the upstream status labelled unknown. In GitHub Actions, failed commands get an
error annotation and a summary; unrecognized pipes get a notice rather than an
assumed command failure. Captured output remains subject to `--max-bytes` and is
labelled incomplete when truncated. GitHub fallback annotations show a preview
capped at 3,500 encoded bytes; job summaries and JSON retain the captured output.

Use `whyitbroke --help` for all options. `--json` suppresses the wrapped command's
output so stdout remains valid JSON, and emits a versioned report — `tool`, `summary`,
`exitCode`, `failures` and the rest, [described below](#json-output). It is intended
for CI wrappers and scripts. The wrapped command's stderr remains available on
stderr for debugging.

Output capture is bounded to 10 MiB by default. Use `--max-bytes` to tune the
limit; JSON reports `"truncated": true` if the limit was reached. Live terminal
output is still streamed normally.

Use `--no-source` when logs come from another machine, contain untrusted paths,
or when a CI job should not read the checkout after the command finishes. The
failure location, statement, and parser message are still shown.

Terminal source context can include neighboring lines that the failing tool did not
print. Those lines may contain secrets even when the reported line does not. Use
`--no-source` before saving or sharing terminal output, and in checkouts where nearby
lines may be sensitive. `--format github` never adds source read from disk to its
annotations or job summary.

### GitHub Actions

Keep the raw command available in the job log while adding a compact failure
summary to the step:

```yaml
- name: Test
  run: npx --yes whyitbroke npm test
```

To turn parsed failures into clickable annotations in the Actions UI:

```yaml
- name: Test with annotations
  run: npx --yes whyitbroke --github-actions npm test
```

When GitHub provides `GITHUB_STEP_SUMMARY`, the same mode also writes a report to the
job's Summary tab. That report leads with the likely causes, one section each, with
their sites folded behind a disclosure — the same shape the terminal prints. Failures
that were not grouped follow it, so the summary stays a complete account of the run.

For workflows that prefer GitHub's problem matcher protocol, add
[`whyitbroke.problem-matcher.json`](../.github/whyitbroke.problem-matcher.json) with:

```yaml
- run: echo "::add-matcher::.github/whyitbroke.problem-matcher.json"
- run: npx --yes whyitbroke --quiet npm test
```

### JSON output

For scripts that need to inspect the result without parsing terminal formatting:

```yaml
- name: Test (JSON)
  run: npx --yes whyitbroke --json npm test > whyitbroke.json
```

The JSON report is versioned, and [`report.schema.json`](../report.schema.json) — a JSON
Schema shipped in the package — describes every field in it. The terminal and
`--format github` render the same report, so none of the three can say something the
others do not. A pytest run piped in with `--no-cluster`, all but its first failure left
out:

```json
{
  "version": 1,
  "tool": "pytest",
  "summary": "3 failed, 2 passed in 0.01s",
  "guessed": false,
  "wrappers": [],
  "clusters": null,
  "others": null,
  "exitCode": 0,
  "inputMode": "pipe",
  "commandExitCode": null,
  "status": null,
  "fallback": null,
  "truncated": false,
  "error": null,
  "since": null,
  "failures": [
    {
      "tool": "pytest",
      "category": "test",
      "file": "test_shop.py",
      "line": 4,
      "title": "test_invoice_total",
      "subject": "test_invoice_total",
      "severity": "error",
      "message": "assert 1049 == 1050\n+  where 1049 = total([1000, 49], 0.5)",
      "stmt": "assert total([1000, 49], 0.5) == 1050",
      "evidence": [
        { "start": 9, "end": 16 },
        { "start": 37, "end": 37 }
      ]
    }
  ]
}
```

Every field of the report is always there, and `null` when there is nothing to say. A
failure leaves out what the output did not say: one with no line has no `line`. `line` and
`col` count from 1, and `col` is in the tool's own unit — bytes for some tools, UTF-16
code units or characters for others, with a tab one column to most of them — so on a line
of plain ASCII with no tabs, every tool agrees. Version 1 only gains fields, and a field it
has keeps its meaning. Spawn failures set `error` and use exit code `127`.

- `inputMode` is `"command"` or `"pipe"`.
- `commandExitCode` is the wrapped command's shell-compatible exit code, or `null`
  for piped input and commands that could not be started. `exitCode` is whyitbroke's
  own process exit code, including `0` for processed pipes and `127` for spawn failures.
- `status` is what the exit status says on its own, or `null` when it says nothing:
  `signal` (the signal that killed the command, as the operating system names it, or
  `null`), the `code` it was read from, and `says`, one sentence of what that means. See
  [When nothing was printed](reliability.md#when-nothing-was-printed).
- `fallback` is `null` for recognized diagnostics, successful commands, and empty
  pipes. Otherwise it contains `reason` (`"unrecognized-output"`, `"no-output"`,
  or `"spawn-error"`), a human-readable `message`, and `rawOutput` containing the
  captured text. `rawOutput` can be empty. Check the top-level `truncated` field
  before treating captured text as complete; spawn error details remain in `error`.
- `wrappers` names what was taken off the output before it could be read — `docker`, or a
  monorepo runner's `api:test: ` — outermost first. See
  [When something else is printing your log](reliability.md#when-something-else-is-printing-your-log).
- `clusters` groups `failures` by likely cause, and `others` holds the failures other
  tools printed into the same log. See [One bug, or eighty?](reporting.md#one-bug-or-eighty).
- `since` is set by `--since-last`. See [What changed since last time](reporting.md#what-changed-since-last-time).
- A failure's `evidence` is the lines of the output it was read from — above, pytest's
  block for the test and its line in the short summary. The lines count from 1 and end at
  a line feed, in the output as it arrived: all of a pipe's input, or everything a command
  wrote. When the capture was cut short, what was left out still counts, so the numbers
  are the output's own. A script holding the log can show the lines behind each finding.

An empty `failures` array means no diagnostics were extracted. It does not establish
command success: check `commandExitCode`, and treat `null` as unknown.

Repositories can use the bundled composite action:

```yaml
- uses: jeanlevonarshakyann-lab/whyitbroke/.github/actions/whyitbroke@v0.5.0
  with:
    command: npm test
    version: 0.5.0
```

Pin `version` to a known npm release for reproducible CI. The action preserves
the command's exit status and emits file/line annotations when a parser finds
them.
