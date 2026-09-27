# Reliability and safety

[← Project overview](../README.md)

The boundaries behind the short answer: what is preserved, what is inferred, and what is never read.

## How it works

whyitbroke uses parsers for known output formats. It finds diagnostics locally and
deterministically, without a model or a service call. When a parser cannot identify
a failure, the report preserves the captured output and labels any generic reading
as a guess.

## What it promises

These hold whatever the log says, and each is a test that fails the day it stops being
true.

- **The exit code is the command's own**, in every output mode: the shell's code for a
  signal, and 127 for a command that could not be started. *(test/guarantees.js)*
- **A failed command never reads as anything else.** A headline over real failures never
  sounds like success, and a guess says it is one. *(test/guarantees.js, test/tools/generic.js)*
- **Output it cannot read is never swallowed.** The command's output streams as it runs
  unless you pass `-q` or `--json`, and when nothing in it could be read, the captured
  output comes back in every mode — printed, in JSON's `fallback.rawOutput`, or in the
  GitHub summary — up to `--max-bytes`, with a note when it was cut. *(test/commandline.js, test/report.js)*
- **Reading takes time in proportion to the log**, whatever it holds.
  *(test/bounds.js)*
- **The directory it runs in is only read**, for the source lines around a failure. The
  cache `--since-last` keeps and the step summary GitHub Actions names are all it writes.
  *(test/guarantees.js)*
- **`--json` prints what `report.schema.json` says it does**: for every fixture, every
  log the fuzz suite damages, and every way the command line can end.
  *(test/report.js, test/fuzz.js)*

One limit, stated rather than hidden: when whyitbroke runs the command, stdout and stderr
arrive on two pipes, so their order relative to each other is the order they reached
whyitbroke, not the order the command wrote them. A program that buffers stdout when it is
not writing to a terminal — Python does, and so do most C programs — can look reordered.
Where the interleaving matters, merge the streams in the command itself:
`whyitbroke sh -c 'pytest 2>&1'`, or set `PYTHONUNBUFFERED=1` for Python.

## When nothing was printed

A command that is killed writes nothing on the way out. `cargo build` stopped by the
kernel's out-of-memory killer, a suite cancelled by a job timeout, a crash in a C
extension — each ends with an empty log and a number, and there is no diagnostic for any
parser to find. The number is not nothing:

```
$ whyitbroke -- cargo build

Command failed with exit code 137.
Killed by SIGKILL, which no program can catch or shut down cleanly for. On a build
machine that is usually the kernel running out of memory, or a runner enforcing a limit.
No output was captured.
```

Two different kinds of thing are said there, and whyitbroke keeps them apart. **A signal is
a fact**: the operating system reports which one ended the process, and whyitbroke names
it. **What usually sends that signal is a guess**, written as one — it is the second
sentence, and it says "usually".

An **exit code** is a number a program chose, so almost none of them mean anything on
their own: `1` and `2` are what every program in the world returns, and `grep` returns `1`
for finding nothing. Three are read, as the conventions they are — `127` and `126`, which
a shell returns for a command that does not exist and one it could not run, and `124`,
which `timeout` returns when its deadline passed — and only for a command whyitbroke ran
itself, where the shell in question is the one it spawned. A piped log's upstream status
never reached whyitbroke and is never guessed at.

A run that was killed part-way still printed whatever it got to print, and that is read as
usual. The signal is reported beside the diagnosis rather than instead of it, because a
diagnosis from a run that did not finish is not the whole story:

```
  ✗ 1 error in 1 file

  bad.ts:3  TS2322
    Type "x" is not assignable to type "number".

  ! Killed by SIGKILL, which no program can catch or shut down cleanly for. On a build
    machine that is usually the kernel running out of memory, or a runner enforcing a limit.
```

## When whyitbroke runs the command itself

`whyitbroke vitest` tells whyitbroke which leaf tool is about to fail, and that is strong
evidence when two parsers recognise the same log. Each parser declares the commands that
imply it, and a named leaf tool is tried first — including through a path or launcher, so
`npx vitest run` and `./node_modules/.bin/vitest` both count.

`python -m pytest` is the same shape and the commonest way pytest is run — the
interpreter puts the working directory on `sys.path`, which is why projects prefer it. The
module named after `-m` is the tool; the interpreter that carried it is not. That only
applies to an interpreter, and only as its first argument: `pytest -m slow` selects a
marker, and `-m` means something else again to plenty of tools.

Script runners are deliberately different. `npm test`, `pnpm test`, and `yarn build`
name a parent process whose child produced the useful Jest, Vitest, Vite, or other
diagnostic. Their lifecycle error remains in the result, but cannot replace the child's
actionable failure as the primary diagnosis.

It only reorders. The parser still has to recognise the output and find something, so
naming a tool that did not produce the log changes nothing, and piped logs — which carry
no command — use the evidence in the log alone.

## When something else is printing your log

Turborepo puts `api:test: ` in front of every line. Docker BuildKit puts `#12 1.234 `.
pnpm names the package and script, kubectl names the pod. Every parser here anchors on
the start of a line, so before whyitbroke understood these, a wrapped pytest run produced
*nothing* — not a worse answer, no answer at all.

whyitbroke finds the prefix and removes it, then says which one it removed, because
knowing the failure came from `api:test:` is worth keeping.

Nothing is stripped on a hunch. A candidate prefix is removed only if removing it
demonstrably improves the parse: a real parser finds something it could not find before,
a different tool turns out to own the log, or the prefix was being swallowed into the
messages of the parser that did read it. That last one is how perl is handled — it writes
its location as prose at the end of the message rather than as an anchor at the start, so
it keeps parsing straight through a wrapper, and the wrapper then splits one diagnosis in
two. npm's `npm error ` and mypy's repeated source directory, which look exactly like
wrappers, are left alone: mypy's ends up in the `file` of its failures, which is a parser
reading a path correctly, and a swallowed wrapper leads the message instead. The
invariant is not "strip prefixes", it is "never come out worse than going in", and it is
tested by wrapping every captured fixture in every runner's prefix and requiring the same
tool and the same failures out the other side.

Docker gets the same treatment. A failing `docker build` ends with
`ERROR: failed to solve: process "/bin/sh -c npm test" did not complete successfully`,
which names the mechanism and not the cause — the cause is the step's own output, either
under BuildKit's `#8 0.234 ` stamps or quoted in the block above that line. whyitbroke
reads whichever is there and hands it to the tool that actually failed.

Wrappers stack, too: a monorepo runner relaying a container relaying a test run is peeled
a layer at a time, and each layer is named on the result.

Tools that redraw progress with bare carriage returns pack many logical lines into one
physical line. A CI collector stamps that blob once, so whyitbroke removes a vetted CI
stamp before expanding the redraws into lines.

A prefix with no vetted shape — a pod name, a compose service — has to be inferred by
comparing lines against each other, and a redraw blob is a single physical line with
nothing to compare it with. That one case is not recoverable. A short log is: the length
floor that used to guard it is gone, because refusing a strip that does not improve the
parse is the guard that actually does the work, and a one-line failure inside a runner's
prefix is exactly the log whose whole diagnosis is that line.

## When the log is too big

`--max-bytes` caps how much output is kept (10 MB by default). The cap keeps a slice of
the beginning, where the command line and build banner live, bounded windows around
probable diagnostic lines in the middle, and as much of the end as the remaining budget
allows. If there are no middle diagnostics, the tail keeps its full share as before.

What is dropped is stated, never silently stitched:

```
~~~ whyitbroke: 1743102 bytes of output elided here (raise --max-bytes to keep them) ~~~
```

Cuts land on line boundaries, so a parser is never handed half a line, and multi-byte
characters are never split.

Reading a log takes time in proportion to its length rather than its square, whatever it
holds. A log is untrusted input, and a line of one kind repeated thousands of times — a
brace that never balances, a start tag that never closes, a traceback header with
nothing under it — used to make a reader walk the rest of the log from each copy: 50 KB
of braces took 87 seconds. So did one long line that looked like diagnostics, which six
line patterns read again from every colon in it: 256 KB of repeated compiler errors on a
single line took eight seconds, and now takes 70 milliseconds. `test/bounds.js` builds
each shape at one size and at four times it, and fails if the larger takes more than
eight times as long.

A parser is only asked about a log that holds one of the strings it can read nothing
without - `Traceback (most recent call last):` for Python's tracebacks, `.go:` or
`--- FAIL` for go - and one pass over the log finds which are there. 10 MiB of build
output that no parser reads takes 0.7 seconds, where asking every parser took 3.3; 10 MiB
of an eslint run takes 0.9 where it took 2.3. A log holding every tool's output at once
still asks all of them: 10 MiB of the whole corpus takes 5.5 seconds. `npm run bench`
prints the times on your machine.

One step has a ceiling instead. Telling that two tools read the same line means comparing
what each one read, and past four million comparisons in one log it stops: both readings
are kept. A huge log with many tools in it can show a finding twice, rather than hide one
as a copy of something it was never compared with.

## Safety

whyitbroke reads source context from disk to show you the lines around a failure.
Output can come from anywhere — a pasted log, a CI artifact, someone else's machine —
so it will only ever read files **inside the directory you ran it in**. Crafted output
naming `/etc/passwd` or `~/.ssh/id_rsa` gets the error printed, never the file.

That boundary protects files outside the checkout; it does not classify files inside it.
Terminal source context may include neighboring lines the original tool never printed,
including secrets beside a reported setting. Use `--no-source` for shared terminal output
or sensitive checkouts. GitHub-format annotations and summaries do not add source read
from disk.

Containment is enforced on the *canonical* path, so a symlink inside the tree pointing
somewhere else — or a symlinked parent directory — is refused rather than followed. A
working directory that is itself reached through a link still reads its own files.

Reads are bounded before anything is allocated: the size is taken from the open
descriptor and files over 2 MiB are skipped. Lines are read whole and narrowed only for
display — a 200-character window that slides to wherever the reported column is, so the
caret stays beside the code it marks instead of a screen of spaces away from it. Only
regular files are read, and they are opened non-blocking, so a directory, socket, device
or FIFO named in a log cannot stall the run. Any of these refusals drops the snippet and
keeps the diagnostic — you still get the error, just no source under it.

One honest limit: the check resolves the path and then opens it, so a sufficiently
determined attacker who can already write inside your working directory could swap a
directory component in between. `O_NOFOLLOW` narrows that window but does not close it.
Anyone with that access could simply put the content in a real file instead.

It runs your command without a shell (`spawn`, not `sh -c`), so nothing in a filename
or argument is expanded. SIGINT, SIGTERM and SIGHUP are forwarded to the command; on
noninteractive POSIX runs they reach its process group, so cancelling a CI wrapper also
stops descendants it started. It has zero dependencies and makes no network calls.

It writes to disk in exactly two cases, both of which you have to ask for. When
`GITHUB_STEP_SUMMARY` is set — which GitHub Actions sets for you — `--format github`
appends a run summary to that file. And `--since-last` records a list of fingerprints
under your OS cache directory (`WHYITBROKE_CACHE_DIR` overrides it). Never inside your
project, never anywhere else, and never at all unless you pass the flag or set the
variable.
