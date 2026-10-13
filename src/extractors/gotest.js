import { append, uniqueFailures } from "../util.js";
import { alsoFrom, sourceRange, withScope, withSource } from "../ownership.js";

const FAIL_RE = /^[^\S\n]*--- (FAIL|SKIP): (\S+)/;
// A panic line: `panic: ` with anything after it, which is all detect asks of a log.
export const PANIC_LINE = /^panic: ./m;
const SPACE = /\s/;
// What `.` will not take.
const TERMINATORS = ["\n", "\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029)];

/** The message `line.match(/^panic: (.+?)(?:\s\[recovered.*\])?$/)` captures, read in one
 *  pass. The pattern tried its ` [recovered ...]` ending after every character of the
 *  message, and each try read on to the end of the line for the closing `]`: a line of
 *  many ` [recovered` and no `]` was read again from each. The ending runs to the end of
 *  the line, so it can begin only past the last character `.` will not take, the message
 *  can run only to the first, and the message ends at the first ` [recovered` between the
 *  two - or with the line. */
export function panicMessage(line) {
  if (!line.startsWith("panic: ")) return null;
  const n = line.length;
  let first = n, last = -1;
  for (const terminator of TERMINATORS) {
    const at = line.indexOf(terminator, 7);
    if (at !== -1 && at < first) first = at;
    last = Math.max(last, line.lastIndexOf(terminator));
  }
  if (line[n - 1] === "]") {
    for (let r = line.indexOf("[recovered", 9); r !== -1 && r - 1 <= first; r = line.indexOf("[recovered", r + 1)) {
      if (SPACE.test(line[r - 1]) && r + 10 <= n - 1 && last < r + 10) return line.slice(7, r - 1);
    }
  }
  return n > 7 && first === n ? line.slice(7) : null;
}
const LOC_RE = /^[^\S\n]+([\w./\\-]+\.go):(\d+):[^\S\n]*(.*)$/;
// `go vet` prefixes the line when the package will not compile at all - "vet: ./main.go:
// 6:17: cannot use ..." - and that prefix defeated the anchor, so a vet run that hit a
// type error came back as a guess with no location, with the file and line sitting in
// plain sight inside the message. Vet's own findings carry no prefix and already matched.
//
// On Windows the prefix is `vet.exe: ` and the path is `pkg\helper.go` or `.\main.go`,
// separators and all. A class written [\w./-] matches none of that, so `go build` on a
// Windows runner fell through to the fallback and `go vet` lost both its locations -
// while `go test` was unaffected, because the testing package prints a bare basename and
// the runtime writes its frames with forward slashes even there. Captured on
// windows-latest rather than assumed; go_windows_build_fail is that output.
//
// Nor is a path only word characters: go names a file outside the directory it ran in by
// its whole path, so a checkout under `My Project` puts its space in the path, and with -L
// the compiler writes every path whole, `C:\work\pkg\a.go` - and both were a build error
// read as nothing. A file's own name may hold a space too, `./my file.go`. A path that says
// where it starts - a drive, a separator, `./`, `../` - is anything up to its `.go:line:col: `
// but a colon, past a drive's, so a timestamp or a prefix ending in one is never part of it.
// Any other is read without spaces, as before: read with them, a runner's prefix in front of
// the path, `pod/api-7d9 ./main.go`, was taken as the start of it and never taken off. Only a
// file's own name in a package below could have one there - an import path has none - and it
// reads exactly as a prefix does.
const BUILD_RE = /^(vet(?:\.exe)?: )?(?:\.[\\/])?((?:[A-Za-z]:[\\/]|[\\/]|\.\.[\\/]|(?<=\.[\\/]))[^:\n]*?\.go|[\w./\\-]+\.go):(\d+):(\d+): (.+)$/;
const BUILD_ANY = /^(?:vet(?:\.exe)?: )?(?:\.[\\/])?(?:(?:[A-Za-z]:[\\/]|[\\/]|\.\.[\\/]|(?<=\.[\\/]))[^:\n]*?|[\w./\\-]+)\.go:\d+:\d+: /m;   // same, but scans a whole blob
// golangci-lint prints its findings in exactly go's shape and names the linter in
// brackets at the end. Go writes no such tag - its messages end "in variable
// declaration", never "(errcheck)" - so a line carrying one belongs to golangci-lint and
// reading it here reported a lint run as `go build`, and attached golangci's findings to
// a tool nobody ran. The untagged lines in a golangci typecheck report ARE go's own,
// verbatim, and are still read.
const LINTER_TAG = /[^\S\n]\([a-z][\w-]*\)[^\S\n]*$/;
// `go test -v` - and every `go test -json` stream, which runs verbose underneath - frames
// each test's output with a line naming the test it belongs to. The output comes BEFORE
// the test's "--- FAIL" line, not after it, and parallel tests interleave, switching with
// "=== NAME". Reading forward from "--- FAIL" found nothing for a test that had failed
// and then read on into the next test's frame, so every failure in a verbose log was
// pinned to the NEXT test's output: TestAdd reported with TestTable/zero's error, and
// TestTable/zero with TestParallelA's, a passing test's log included. This is how Go's
// own test2json attributes a line - to the test named in the most recent frame.
const FRAME_RE = /^=== (?:RUN|PAUSE|CONT|NAME)[^\S\n]+(\S+)[^\S\n]*$/;
// The go tool refusing a flag it does not have. Go's flag package writes that first line
// for every program built with it, so it says nothing about WHOSE flag it was - the usage
// underneath is what does, and go is the only thing that writes "usage: go <verb>". A CI
// script passing a flag the installed toolchain is too old for stops exactly here.
const BAD_FLAG_RE = /^flag provided but not defined:[^\S\n]+(-\S+)[^\S\n]*$/;
const GO_USAGE_RE = /^(?:usage: go[^\S\n]|Run 'go help)/;
// The other three ways the tool stops before running anything. Each names go or speaks
// go's own vocabulary: a subcommand it does not have, a sentence it ends by pointing at
// `go help`, and a package pattern that resolves to nothing because there is no module
// here - the failure of running go in the wrong directory, which is a CI staple.
const UNKNOWN_CMD_RE = /^go[^\S\n]+(\S+):[^\S\n]+unknown command[^\S\n]*$/;
const SEE_HELP_RE = /^go:[^\S\n]+(\S.*?);[^\S\n]*see 'go help[^\S\n]+[^']+'[^\S\n]*$/;
// Read to its last character that is not a space, at once: read lazily, it stopped at each space of
// a long stretch and read the rest of the stretch again from there.
export const NO_MODULE_RE = /^pattern[^\S\n]+(\S+):[^\S\n]+(\S.*?\bmain module\b(?:.*\S)?)[^\S\n]*$/;

/** Where the tool said it would not run, and what it said, or null. */
function refusal(lines) {
  for (let i = 0; i < lines.length; i++) {
    const flag = lines[i].match(BAD_FLAG_RE);
    // Go's flag package writes that line for every program built with it, so it says
    // nothing about whose flag it was; go's own usage underneath is what does.
    if (flag && lines.slice(i + 1, i + 3).some((l) => GO_USAGE_RE.test(l))) {
      return { at: i, subject: flag[1], message: lines[i].trim() };
    }
    const cmd = lines[i].match(UNKNOWN_CMD_RE);
    if (cmd) return { at: i, subject: cmd[1], message: lines[i].trim() };
    const help = lines[i].match(SEE_HELP_RE);
    if (help) return { at: i, subject: "go.mod", message: help[1] };
    const pattern = lines[i].match(NO_MODULE_RE);
    if (pattern) return { at: i, subject: pattern[1], message: pattern[2] };
  }
  return null;
}
const RESULT_RE = /^[^\S\n]*--- (PASS|FAIL|SKIP): (\S+)/;
// A package's closing lines end attribution, so a TestAdd in one package is never read
// as the same test as a TestAdd in the next.
const TRAILER_RE = /^(?:(?:FAIL|ok)[^\S\n]+\S+[^\S\n]+(?:[\d.]+s|\(cached\))|FAIL|PASS)[^\S\n]*$/;

// The package a stretch of the log belongs to. `go test ./...` closes each package with a
// line naming it, `FAIL\texample.com/mono/pkg1\t0.012s`, and the testing package prints a
// file's basename alone - so the same failing test in two packages writes the very same
// lines, and only that closing line tells them apart. `go build` and `go vet` head each
// package's errors with `# example.com/mono/pkg1` instead.
const PACKAGE_TRAILER_RE = /^(?:FAIL|ok)[^\S\n]+(\S+)[^\S\n]+(?:[\d.]+s|\(cached\)|\[[^\]\n]*\])/;
const PACKAGE_HEADER_RE = /^#[^\S\n]+(\S+(?:[^\S\n]+\[[^\]\s]+\])?)[^\S\n]*$/;

/** The package go means by `desc`. A package compiled for its tests is named with the test
 *  binary after it, `example.com/mono/pkg [example.com/mono/pkg.test]`, its external test
 *  package as `example.com/mono/pkg_test [example.com/mono/pkg.test]`, and vet calls the
 *  test variant `[example.com/mono/pkg]` - all of them one package, whose tests run as
 *  `example.com/mono/pkg`. */
export function goPackage(desc) {
  const named = String(desc ?? "").trim();
  const binary = named.match(/\[([^\]\s]+)\]$/)?.[1];
  return binary ? binary.replace(/\.test$/, "") : named.split(/\s/)[0];
}

/** Each failure under the package it was reported in - see SCOPE in ownership.js. A test's
 *  package is named by the first closing line at or after it, a compile error's by the
 *  last header above it - unless the caller knows a line's package outright, as `go test
 *  -json` says on every event. A stream of events can carry plain lines too, and those
 *  are named by their own closing lines and headers, never by an event's. */
function packaged(failures, lines, packageOf) {
  const closing = new Array(lines.length + 1).fill(null), heading = new Array(lines.length).fill(null);
  for (let k = lines.length - 1; k >= 0; k--) {
    closing[k] = (!packageOf?.(k) && lines[k].match(PACKAGE_TRAILER_RE)?.[1]) || closing[k + 1];
  }
  for (let k = 0, last = null; k < lines.length; k++) {
    const header = !packageOf?.(k) && lines[k].match(PACKAGE_HEADER_RE)?.[1];
    heading[k] = last = header ? goPackage(header) : last;
  }
  return failures.map((failure) => {
    const at = sourceRange(failure)?.start;
    if (at === undefined) return failure;
    const known = packageOf?.(at);
    if (known) return withScope(failure, known);
    return withScope(failure, failure.title === "compile error" ? heading[at] : closing[at]);
  });
}

/** What one test printed: its location, its messages, and a panic's own frame - and the
 *  lines of the log each came from, `at[j]` being where `block[j]` was. */
function details(block, at) {
  let file, line;
  const msg = [], used = [];
  // The first goroutine frame that is not runtime/testing at or after each line, found in
  // one pass on the first panic. Each panic line looked for it to the end of the test's
  // output, and a test can print `panic:` lines of its own by the thousand.
  let frames = null;
  const frameFrom = (j) => {
    if (!frames) {
      frames = new Array(block.length + 1).fill(null);
      for (let k = block.length - 1; k >= 0; k--) {
        const fm = block[k].match(/^\t(.+?):(\d+)(?:\s|$)/);
        frames[k] = fm && !STDLIB.test(fm[1]) ? { file: fm[1], line: +fm[2], k } : frames[k + 1];
      }
    }
    return frames[j];
  };
  for (let j = 0; j < block.length; j++) {
    const lm = block[j].match(LOC_RE);
    if (lm) { file ??= lm[1]; line ??= +lm[2]; if (lm[3]) msg.push(lm[3]); used.push(at[j]); continue; }
    const panic = panicMessage(block[j]);
    if (panic !== null) {
      msg.push(`panic: ${panic}`);
      used.push(at[j]);
      const frame = frameFrom(j + 1);
      if (frame) { file = frame.file; line = frame.line; used.push(at[frame.k]); }
    }
  }
  return { file, line, msg, used };
}

/** In a verbose log, the lines each failing test printed, keyed by the index of its
 *  "--- FAIL" line. Resolved only once the package is read: a panic's dump comes after
 *  the test's result line, and still belongs to it. A plain log has no frames, and gets
 *  an empty map. */
function verboseBlocks(lines, packageOf) {
  const out = new Map();
  if (!lines.some((l) => FRAME_RE.test(l))) return out;
  // Where each line's package is known, each package frames its own tests: a TestAdd in
  // one package is not the TestAdd in the next, and `go test -json` closes every package
  // only once all of them have run.
  const packages = new Map();
  const state = (i) => {
    const key = packageOf?.(i) ?? "";
    let st = packages.get(key);
    if (!st) packages.set(key, st = { seg: new Map(), current: null });
    return st;
  };
  const pending = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const st = state(i);
    const f = l.match(FRAME_RE);
    if (f) { st.current = f[1]; continue; }
    const r = l.match(RESULT_RE);
    if (r) { if (r[1] === "FAIL") pending.push([i, r[2], st.seg]); continue; }
    if (TRAILER_RE.test(l)) { st.current = null; st.seg = new Map(); continue; }
    if (st.current == null) continue;
    // Each line with where it was: parallel tests interleave, so a test's lines are
    // not one stretch of the log.
    if (!st.seg.has(st.current)) st.seg.set(st.current, { block: [], at: [] });
    st.seg.get(st.current).block.push(l);
    st.seg.get(st.current).at.push(i);
  }
  for (const [i, name, s] of pending) out.set(i, s.get(name) ?? { block: [], at: [] });
  return out;
}

// Go's own runtime/testing frames are never your bug
const STDLIB = /\/(libexec\/)?src\/(runtime|testing|internal)\//;

/** A panic with no test around it: the goroutine dump carries the location, and the
 *  first frame that is not the runtime is the one in your code. */
function standalonePanic(lines) {
  for (let i = 0; i < lines.length; i++) {
    const message = panicMessage(lines[i]);
    if (message === null) continue;
    let file, line, frame = -1;
    for (let k = i + 1; k < lines.length; k++) {
      const fm = lines[k].match(/^\t(.+?):(\d+)(?:[^\S\n]|$)/);
      if (fm && !STDLIB.test(fm[1])) { file = fm[1]; line = +fm[2]; frame = k; break; }
    }
    // The panic, and the frame in your code that the dump names.
    const panic = withSource({ file, line, title: "panic", label: "panic", category: "runtime",
      severity: "error", message }, i, i + 1);
    return frame >= 0 ? alsoFrom(panic, frame, frame + 1) : panic;
  }
  return null;
}

export default {
  name: "go",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["--- FAIL", "--- PASS", "--- SKIP", "--- BENCH", "ok ", "ok\t", "FAIL ", "FAIL\t", ".go:", "goroutine ", "flag provided but not defined", "unknown command", "see 'go help", "main module"],
  category: "compile",
  commands: ["go"],
  // `--- ` alone is not go's. A unified diff heads its two halves `--- expected` and
  // `+++ actual`, which is what minitest and PHPUnit print between two values that differ,
  // and go claimed every log holding one - reading nothing from it, which is the only reason
  // nothing went wrong. What follows go's dashes is one of its own words.
  detect: (s) =>
    /^[^\S\n]*--- (?:FAIL|PASS|SKIP|BENCH)\b/m.test(s) || /^(ok|FAIL)[^\S\n]+\S+\s/m.test(s) || BUILD_ANY.test(s) ||
    // A binary that panics outside a test run has none of the above: no test tally, no
    // --- FAIL line, nothing but the panic and its goroutine dump. `go run` produces
    // exactly that, and it is the commonest way a Go program fails.
    (PANIC_LINE.test(s) && /^goroutine \d+ \[/m.test(s)) ||
    refusal(s.split("\n")) !== null,

  /** `packageOf(k)`, where given, is the package line k of `s` came from. */
  extract(s, { packageOf } = {}) {
    const lines = s.split("\n");
    const failures = [];

    // --- compile errors: "./file.go:4:17: cannot use 42 ..." ---
    let vetted = false;
    lines.forEach((l, i) => {
      const m = l.match(BUILD_RE);
      if (m && !/^\s/.test(l) && !LINTER_TAG.test(l)) {
        if (m[1]) vetted = true;
        // Go writes no severity word at all, so there is no constant of its own to put
        // in `label` - but the line still needs a name, or it renders as a bare
        // "broken.go:4" that the problem matcher cannot read and CI never annotates.
        // "compile error" is what whyitbroke calls it, which is what `title` is for.
        failures.push(withSource({ file: m[2], line: +m[3], col: +m[4], title: "compile error", severity: "error", message: m[5] }, i, i + 1));
      }
    });
    // Compile errors used to end the read here. `go test ./...` over a package that will
    // not compile and another whose tests fail writes both into one stream - that is one
    // ordinary invocation, not two glued together - and returning here reported "1
    // compile error" and dropped every test that failed in the packages that did build.
    // --- data races ---
    // The detector names the exact line where the racing access happened, which is
    // the bug. The test assertion that follows only reports a wrong total, so
    // without this the output points at the symptom and drops the cause.
    for (let i = 0; i < lines.length; i++) {
      if (!/^WARNING: DATA RACE[^\S\n]*$/.test(lines[i])) continue;
      let file, line;
      const what = [];
      // The warning down to the rule of = signs the race detector closes it with.
      let j = i + 1;
      for (; j < lines.length && !/^={10,}$/.test(lines[j]); j++) {
        const op = lines[j].match(/^((?:Previous )?(?:read|write)) at 0x[0-9a-f]+ by (goroutine \d+|main goroutine)/i);
        if (op) { what.push(`${op[1]} by ${op[2]}`); continue; }
        // A frame's path can hold spaces: it ends at the last `:line +0x...` on the line.
        const at = lines[j].match(/^[^\S\n]+(\S(?:[^\n]*?\S)?):(\d+) \+0x[0-9a-f]+[^\S\n]*$/);
        if (at && !file && !STDLIB.test(at[1])) { file = at[1]; line = +at[2]; }
      }
      if (!what.length) continue;
      failures.push(withSource({
        file, line, title: "DATA RACE", label: "DATA RACE", category: "test", severity: "error",
        message: what.slice(0, 2).join(", ") + " - the same memory, without synchronisation",
      }, i, j < lines.length ? j + 1 : j));
    }

    // --- test failures ---
    const attributed = verboseBlocks(lines, packageOf);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(FAIL_RE);
      if (!m || m[1] !== "FAIL") continue;
      const name = m[2];

      // A verbose log says which lines are this test's; use them. Otherwise - and for a
      // test that printed nothing of its own - read on from the result line as a plain
      // log is laid out, but never into the next test's frame.
      const own = attributed.get(i);
      let found = own ? details(own.block, own.at) : { msg: [], used: [] };
      if (!found.msg.length && !found.file) {
        const ahead = [], at = [];
        // ...and never into another package's lines, which `go test -json` interleaves.
        const mine = (j) => !packageOf || packageOf(j) === packageOf(i);
        for (let j = i + 1; j < lines.length && !FAIL_RE.test(lines[j]) && !FRAME_RE.test(lines[j]) && mine(j); j++) { ahead.push(lines[j]); at.push(j); }
        found = details(ahead, at);
      }
      const { file, line, msg, used } = found;
      if (!msg.length && !file) continue;
      // The result line, and each line the test's own output was read from - a verbose
      // log interleaves parallel tests, so those need not sit together.
      let failure = withSource({ file, line, title: name, subject: name, category: "test", severity: "error", message: msg.join("\n") }, i, i + 1);
      for (const at of used) failure = alsoFrom(failure, at, at + 1);
      failures.push(failure);
    }

    const distinct = uniqueFailures(packaged(failures, lines, packageOf));
    failures.length = 0;
    append(failures, distinct);
    const builds = failures.filter((f) => f.title === "compile error").length;

    if (!failures.length) {
      const panic = standalonePanic(lines);
      if (panic) return { tool: "go", summary: "panic", failures: [panic] };
    }

    // count what we actually report: a parent of subtests prints its own
    // "--- FAIL" line but carries no failure of its own
    const races = failures.filter((f) => f.title === "DATA RACE").length;
    const tests = failures.length - races - builds;
    if (builds && !tests && !races) {
      const n = builds;
      // One log can hold both: `go build ./... ; ./prog` puts compile errors and then a
      // panic in the same stream, and golangci-lint prints go's own diagnostics above
      // its tally. Returning early dropped the panic without a word - it is the later and
      // usually the more interesting of the two, so it is kept rather than lost.
      const panic = standalonePanic(lines);
      if (panic) failures.push(panic);
      const andPanic = panic ? " and a panic" : "";
      // Vet's own findings are written exactly like a compile error, so a piped log gives
      // no way to tell them apart. The prefix is the one time it does say.
      return vetted
        ? { tool: "go vet", summary: `${n} error${n > 1 ? "s" : ""}${andPanic}`, failures }
        : { tool: "go build", summary: `${n} compile error${n > 1 ? "s" : ""}${andPanic}`, failures };
    }
    // The tool refusing a flag never ran anything, so it stands alone: there is no test
    // tally, no compile error and no panic to report it beside.
    const refused = refusal(lines);
    if (refused && !failures.length) {
      failures.push(withSource({
        title: refused.subject, subject: refused.subject, severity: "error",
        message: refused.message,
      }, refused.at, refused.at + 1));
      return { tool: "go", summary: "the command was refused", failures };
    }
    const bits = [];
    if (builds) bits.push(`${builds} ${vetted ? "vet" : "compile"} error${builds > 1 ? "s" : ""}`);
    if (tests) bits.push(`${tests} test${tests > 1 ? "s" : ""} failed`);
    if (races) bits.push(`${races} data race${races > 1 ? "s" : ""}`);
    const summary = bits.length ? bits.join(", ") : undefined;
    if (!failures.length) return null;
    return { tool: "go test", summary, failures };
  },
};
