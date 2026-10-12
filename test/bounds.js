// Hostile logs.
//
// A log is untrusted input, so what it holds cannot decide whether reading it finishes.
// Each shape below once made a reader take time that grew as the square of the log:
// a reader walked from every line of one kind to the end of the log, or re-read the
// same stretch once per line. None of them needed much input. 50 KB of lines that each
// open a brace took 87 seconds, and 32,000 lines of oxlint parse errors took 49.
//
// Timing a test against the clock fails on a slow machine and passes on a fast one, so
// every case here compares the reader with itself. Four times the log may cost about
// four times the time, where a reader that re-reads per line costs sixteen - the bound is
// eight. And a hostile log may cost at most twenty times an ordinary log of the same size
// read on the same machine a moment earlier. The budget that caps locating ranges is
// tested without a clock at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse } from "../src/index.js";
import { createCapture } from "../src/capture.js";
import { wrapperCandidates } from "../src/normalize.js";
import { lineAt } from "../src/util.js";
import { trackedCauseId } from "../src/history.js";
import { render } from "../src/render.js";
import bundler from "../src/extractors/rubygems.js";
import pytest from "../src/extractors/pytest.js";
import swift from "../src/extractors/swift.js";
import markdownlint from "../src/extractors/markdownlint.js";
import gotest, { PANIC_LINE, panicMessage } from "../src/extractors/gotest.js";
import terraform from "../src/extractors/terraform.js";
import rspec from "../src/extractors/rspec.js";
import ruff from "../src/extractors/ruff.js";
import vitest from "../src/extractors/vitest.js";
import docker from "../src/extractors/docker.js";
import phpunit from "../src/extractors/phpunit.js";
import { unixLine } from "../src/extractors/stylelint.js";
import { issueLine } from "../src/extractors/golangci.js";
import { gccLine } from "../src/extractors/shellcheck.js";
import { raiseLine } from "../src/extractors/ruby.js";
import { FRAME_WITH_CALL } from "../src/extractors/node.js";
import { FAILED_TALLY } from "../src/extractors/junitjvm.js";
import jest from "../src/extractors/jest.js";
import ava from "../src/extractors/ava.js";
import jasmine from "../src/extractors/jasmine.js";
import mocha from "../src/extractors/mocha.js";
import mochaxunit from "../src/extractors/mochaxunit.js";
import bun, { bunRuntime } from "../src/extractors/bun.js";
import node from "../src/extractors/node.js";
import taptext from "../src/extractors/taptext.js";
import nodetest from "../src/extractors/nodetest.js";
import junitjvm from "../src/extractors/junitjvm.js";
import deno from "../src/extractors/deno.js";
import shellcheck from "../src/extractors/shellcheck.js";
import { xmlAttributes, xmlText } from "../src/util.js";
import gojson, { isEvent } from "../src/extractors/gojson.js";
import jvm, { gradleTestLine } from "../src/extractors/jvm.js";
import less, { headLine as lessHead } from "../src/extractors/less.js";
import php, { fatalLine, parseLine, uncaughtLine } from "../src/extractors/php.js";
import dotnettest, { atLine } from "../src/extractors/dotnettest.js";
import eslintjson from "../src/extractors/eslintjson.js";
import git from "../src/extractors/git.js";
import pip from "../src/extractors/pip.js";
import playwright from "../src/extractors/playwright.js";
import { collapseRepeats } from "../src/util.js";
import { githubOutput } from "../src/github.js";
import cargo, { panicLine } from "../src/extractors/cargo.js";
import ruby, { frameLine } from "../src/extractors/ruby.js";
import minitest from "../src/extractors/minitest.js";
import cmake, { headLine as cmakeHead } from "../src/extractors/cmake.js";
import mypy, { diagnosticLine } from "../src/extractors/mypy.js";
import perl, { bracketed } from "../src/extractors/perl.js";

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const test = (name, fn) => {
  try {
    const returned = fn();
    // This runner is synchronous. An async body returns a promise it would never await,
    // so every assertion inside becomes an unhandled rejection and the test passes
    // whatever it finds. One written that way sat green against the exact bug it was
    // meant to catch, so the shape is refused rather than trusted.
    if (returned && typeof returned.then === "function") {
      throw new Error("test body returned a promise; this runner does not await, so nothing in it would be checked");
    }
    console.log(`  ok   ${name}`); pass++;
  } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};

// A read that takes a fraction of a millisecond is mostly the clock and whatever else the
// process happens to be doing, and the ratio of two of them says nothing about growth: once
// a parser is asked only about logs it could read, a long line of node frames read in a
// third of a millisecond, and four times as much "took eleven times as long". So a read is
// repeated until twenty milliseconds have passed, and its time is the average. A read that
// is slow on its own - which a quadratic one is - is still taken once.
//
// Every parser is asked about every log here. A parser is only asked about a log holding
// one of its signals, and most of these shapes hold none - a log of lines that each open a
// brace names no JSON report - so with the router on they would never reach the readers
// they exist to hold to account. A log that holds the shape and a signal does.
const FLOOR_MS = 20;
const took = (text) => {
  let runs = 0;
  const at = performance.now();
  do { analyse(text, { route: false }); runs++; } while (performance.now() - at < FLOOR_MS);
  return (performance.now() - at) / runs;
};
const ms = (t) => (t < 10 ? t.toFixed(1) : Math.round(t));
const fastest = (text, runs) => Math.min(...Array.from({ length: runs }, () => took(text)));

/** Reading `grow(4n)` costs about four times reading `grow(n)`, not sixteen. The larger
 *  log is read once before it is read again, so a reader that has gone quadratic fails
 *  after one slow read instead of three. */
function linear(grow, n) {
  const small = fastest(grow(n), 5);
  const big = grow(4 * n - 3);
  let large = took(big);
  if (large < small * 8) large = Math.min(large, fastest(big, 2));
  assert.ok(large < small * 8,
    `${ms(small)}ms for the log, ${ms(large)}ms for four times as much - x${(large / small).toFixed(1)}`);
}

/** Reading `text` costs at most twenty times reading build chatter of the same size. One
 *  slow read is enough to fail. */
function nearOrdinary(text) {
  const lines = [];
  for (let size = 0, i = 0; size < text.length; i++) {
    lines.push(`  vite:build transforming src/components/Widget${i}.tsx +2ms`);
    size += lines[lines.length - 1].length + 1;
  }
  const ordinary = fastest(lines.join("\n"), 3);
  let hostile = took(text);
  if (hostile < ordinary * 20) hostile = Math.min(hostile, fastest(text, 2));
  assert.ok(hostile < ordinary * 20,
    `${ms(hostile)}ms against ${ms(ordinary)}ms for ordinary output of the same size - x${(hostile / ordinary).toFixed(1)}`);
}

// An even number of identical lines is an exact retry of itself and collapses before any
// parser sees it, so every repeated shape is repeated an odd number of times.
const repeat = (line) => (n) => Array(n).fill(line).join("\n");

/** `linear`, for one parser asked about the log on its own. A parser whose cost is the
 *  whole question needs no other parser's time in the comparison. A first read of the
 *  larger log within the bound is enough; one past it is read twice more, so that a pause
 *  in the machine during a read of a few milliseconds does not fail it. */
function linearIn(extractor, grow, n) {
  const read = (text) => { if (extractor.detect(text)) extractor.extract(text); };
  // A log's time is its fastest read. One parser's read can take a tenth of a millisecond,
  // and a collection of the heap landing among twenty milliseconds of them takes longer
  // than all of them together - Node 18 pauses for ten to forty milliseconds at a time late
  // in this file - so their average read a log four times as long as eight times as slow.
  // A quadratic reader is slow on every read.
  const once = (text) => {
    let best = Infinity;
    const at = performance.now();
    do {
      const start = performance.now();
      read(text);
      best = Math.min(best, performance.now() - start);
    } while (performance.now() - at < FLOOR_MS);
    return best;
  };
  const small = Math.min(...Array.from({ length: 5 }, () => once(grow(n))));
  const big = grow(4 * n - 3);
  let large = once(big);
  if (large >= small * 8) large = Math.min(large, once(big), once(big));
  assert.ok(large < small * 8,
    `${extractor.name}: ${ms(small)}ms for the log, ${ms(large)}ms for four times as much - x${(large / small).toFixed(1)}`);
}

console.log("\nhostile logs");

// JIT compilation belongs to whichever test runs first, and it is not what is measured.
analyse(readFileSync(join(here, "fixtures", "pytest_fail.txt"), "utf8"));

test("lines that each open a brace", () => {
  // Every bracket that opens a line is where a JSON document may start, and each was
  // scanned from to wherever its brackets balanced - here, never.
  linear(repeat("{"), 3001);
});

test("start tags that never close", () => {
  // `<testcase ...>([\s\S]*?)</testcase>` looks to the end of the log for the closing tag
  // from every start tag that has none.
  linear(repeat(`    <testcase name="errcheck" classname="main.go:10:15">`), 1201);
});

test("traceback headers with no exception under them", () => {
  // A traceback steps over a header inside it, so every header's block ran to the end.
  linear(repeat("Traceback (most recent call last):"), 1201);
});

test("vitest suite headers with nothing under them", () => {
  // A block reads on past its assertion to the next failure header or location.
  linear(repeat(" FAIL  t/crash.test.js [ t/crash.test.js ]"), 801);
});

test("oxlint parse errors, which name no rule", () => {
  // A drawn heading without a rule is oxlint's only if every line below it down to the
  // tally is part of the drawing - asked by walking there from each heading.
  const report = (n) => [
    ...Array.from({ length: n }, () => ["  x Expected `,` or `)` but found `{`", "   ,-[src/broken.js:1:28]"]).flat(),
    "", "Found 0 warnings and 1 error.", "Finished in 3ms on 1 file with 96 rules using 8 threads.",
  ].join("\n");
  linear(report, 801);
});

test("yamllint findings with no filename above them", () => {
  // Whether a filename opened the block was asked of every finding by looking back over
  // every line above it.
  linear(repeat(`  1:1       warning  missing document start "---"  (document-start)`), 4001);
});

test("thousands of rust panics", () => {
  // Whether the run was a build script, a test run or a program was asked of the whole
  // log once per panic.
  const panic = "thread 'tests::invoice_total' (7732159) panicked at src/lib.rs:11:9:\nassertion `left == right` failed";
  linear(repeat(panic), 801);
});

test("thousands of Test::More failures, as prove -v and plain TAP print them", () => {
  // Each result asked the whole list of Test::More's diagnostics which of them lay in its
  // block, and a bare result asked it again which had its name. `prove -v` prints all the
  // diagnostics first and the results after them; plain TAP puts each under its result.
  const diagnostic = (k) => [`#   Failed test 'invoice total ${k}'`, "#   at shop.t line 5.", `#          got: '${k}'`, `#     expected: '${k + 1}'`];
  const numbers = (n) => Array.from({ length: n }, (_, k) => k + 1);
  const prove = (n) => [
    ...numbers(n).flatMap((k) => ["", ...diagnostic(k)]), `# Looks like you failed ${n} tests of ${n}.`,
    "shop.t .. ", `1..${n}`, ...numbers(n).map((k) => `not ok ${k} - invoice total ${k}`),
    `Dubious, test returned 254 (wstat 65024, 0xfe00)`, `Failed ${n}/${n} subtests `,
  ].join("\n");
  const plain = (n) => [
    `1..${n}`, ...numbers(n).flatMap((k) => [`not ok ${k} - invoice total ${k}`, ...diagnostic(k)]),
    `# Looks like you failed ${n} tests of ${n}.`,
  ].join("\n");
  linear(prove, 3001);
  linear(plain, 3001);
});

test("numbers that each claim the rest of the log", () => {
  // swiftc's parseable output puts a byte count above each record, and every such count
  // was decoded and parsed to see whether a record was there.
  const claims = (n) => {
    const lines = [];
    let after = 0;
    for (let i = 0; i < n; i++) {
      const claim = String(Math.max(after - 1, 1));
      lines.push(claim);
      after += claim.length + 1;
    }
    return lines.reverse().join("\n") + "\n";
  };
  linear(claims, 16001);
});

test("one finding printed thousands of times", () => {
  // Each copy is one more place the finding was read from, and joining a place into the
  // ones kept compares it with each of them.
  linear(repeat("lint_me.py:1:8: F401 'os' imported but unused"), 4001);
});

test("the first two lines of a terraform report, over and over", () => {
  // terraform balanced the braces of every report-looking line down to wherever they
  // balanced, and these never do.
  linear(repeat(`{\n  "format_version": "1.0",`), 401);
});

test("a log of a million empty lines that names format_version once", () => {
  // terraform counted the braces of every line of any log that named its schema identifier,
  // into three arrays as long as the log in lines: sixteen bytes a line, and 16MB to decide
  // whether this log of 1MB was its own.
  // A collection during one call can free what that call made, so the most any of three
  // calls leaves behind is what is measured.
  const log = '"format_version"\n' + "\n".repeat(1_000_000);
  const grew = Math.max(...[1, 2, 3].map(() => {
    const before = process.memoryUsage().arrayBuffers;
    terraform.detect(log);
    return process.memoryUsage().arrayBuffers - before;
  }));
  assert.ok(grew < log.length, `deciding a ${(log.length / 1e6).toFixed(0)}MB log took ${(grew / 1e6).toFixed(0)}MB of arrays`);
});

test("two tools whose findings share no text", () => {
  // Each reading of a second tool was compared with every reading of the first.
  const log = (n) => {
    const lines = [];
    for (let i = 0; i < n; i++) {
      lines.push(`src/mod_${i % 997}.py:${(i % 400) + 1}:1: F401 'os' imported but unused`);
      lines.push(`src/mod_${(i * 7) % 991}.py:${(i % 350) + 1}: error: Name "value_${i}" is not defined  [name-defined]`);
    }
    lines.push(`Found ${n} errors in 991 files (checked 991 source files)`);
    return lines.join("\n");
  };
  linear(log, 3000);
});

// eslint's table and its JSON report, the same message on every line of both - "Unexpected
// any" is every finding in plenty of TypeScript runs - at locations that do not coincide,
// so neither reading is an exact copy of the other.
function tableAndReport(n, fixText = null) {
  const message = "Unexpected any. Specify a different type";
  const table = ["", "/app/src/types.ts"];
  for (let i = 0; i < n; i++) table.push(`  ${i + 1}:10  error  ${message}  @typescript-eslint/no-explicit-any`);
  table.push("", `\u2716 ${n} problems (${n} errors, 0 warnings)`, "");
  const messages = Array.from({ length: n }, (_, i) => ({
    ruleId: "@typescript-eslint/no-explicit-any", severity: 2, message: `${message}.`, line: i + 100001, column: 10,
  }));
  if (fixText) messages[0].fix = { range: [1, 2], text: fixText };
  return [...table, JSON.stringify([{ filePath: "/app/src/other.ts", messages, errorCount: n, warningCount: 0 }])].join("\n");
}

test("the same message across two tools, most of it on one line", () => {
  // When ranges were guessed, every finding was placed by sorting the lines that mention
  // it, and every comparison in the sort searched the report line - the whole JSON
  // document - again: 2,001 findings, 471 KB, took three minutes. The comparison of the
  // two tools' readings that ranges decide is still quadratic in principle.
  nearOrdinary(tableAndReport(801));
});

test("a location search inside a long unbroken token", () => {
  // Guessing a range asked whether a line writes `file.ext:line:col`, which backtracked
  // through every run of path characters from each position in it; a fix's 5,000-character
  // token cost that per comparison, per finding.
  nearOrdinary(tableAndReport(51, "x".repeat(5000)));
});

// ---------------------------------------------------------------- XML reports
// A report reader that looks for a case's failure, its document's root or the next literal
// section from the top of the report, or from where it stands to the end, reads the
// report again for each case - and a monorepo's report holds thousands of them.

test("a node --test JUnit report of thousands of cases", () => {
  // Each case looked for its failure from the first line of the log.
  const report = (n) => [
    '<?xml version="1.0" encoding="utf-8"?>', "<testsuites>",
    ...Array.from({ length: n }, (_, k) => [`\t<testcase name="skipped ${k}" time="0.0" classname="test">`, '\t\t<skipped type="skipped" message="true"/>', "\t</testcase>"].join("\n")),
    '\t<testcase name="fails" time="0.000417" classname="test" failure="Expected">', '\t\t<failure type="testCodeFailure" message="Expected">',
    "[Error [ERR_TEST_FAILURE]: Expected] {", "      at TestContext.&lt;anonymous> (file:///home/dev/reporter.test.js:7:10)", "}", "\t\t</failure>", "\t</testcase>",
    `\t<!-- tests ${n + 1} -->`, "\t<!-- pass 0 -->", "\t<!-- fail 1 -->", "</testsuites>",
  ].join("\n");
  linearIn(nodetest, report, 1001);
});

test("a Surefire report of thousands of failed cases", () => {
  // Each case searched all the log above it for its document's root.
  const report = (n) => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="shop.CartTest" time="0.004" tests="${n}" errors="0" skipped="0" failures="${n}">`,
    ...Array.from({ length: n }, (_, k) => [
      `  <testcase name="totals${k}" classname="shop.CartTest" time="0.002">`,
      `    <failure message="expected: &lt;${k}&gt;" type="org.opentest4j.AssertionFailedError"><![CDATA[org.opentest4j.AssertionFailedError: expected: <${k}> but was: <${k + 1}>`,
      `\tat shop.CartTest.totals${k}(CartTest.java:${k + 1})`, "]]></failure>", "  </testcase>",
    ].join("\n")),
    "</testsuite>",
  ].join("\n");
  linearIn(junitjvm, report, 1001);
});

test("a deno JUnit report cut off after thousands of testcase starts", () => {
  // A case that never closed read the rest of the report, from every such case.
  const report = (n) => [
    '<testsuites name="deno test" tests="1" failures="1" errors="0" time="0.007">',
    '    <testsuite name="./reporter_test.ts" tests="1" disabled="0" errors="0" failures="1">',
    '        <testcase name="adds" classname="./reporter_test.ts" time="0.001" line="1" col="6">',
    '            <failure message="Uncaught Error: expected three">Error: expected three',
    "    at file:///home/dev/reporter_test.ts:2:26</failure>", "        </testcase>",
    ...Array.from({ length: n }, (_, k) => `        <testcase name="t${k}" classname="./reporter_test.ts" time="0.001" line="${k + 3}" col="6">`),
  ].join("\n");
  linearIn(deno, report, 2001);
});

test("deno JUnit reports each right after another tool's TAP plan", () => {
  // Each report asked every line above it whether deno's own TAP had been printed.
  const runs = (n) => Array.from({ length: n }, (_, k) => [
    `ok ${k + 1} - other ${k}`, `1..${k + 1}`,
    '<testsuites name="deno test" tests="1" failures="1" errors="0" time="0.007">',
    '    <testsuite name="./reporter_test.ts" tests="1" disabled="0" errors="0" failures="1">',
    `        <testcase name="adds${k}" classname="./reporter_test.ts" time="0.001" line="1" col="6">`,
    `            <failure message="Uncaught Error: expected ${k}">Error: expected ${k}`,
    `    at file:///home/dev/reporter_test.ts:${k + 2}:26</failure>`,
    "        </testcase>", "    </testsuite>", "</testsuites>",
  ].join("\n")).join("\n");
  linearIn(deno, runs, 1001);
});

test("thousands of XML comments before a report's first CDATA section", () => {
  // Each comment sent the scan looking for the next CDATA section, to the end of the log.
  const checkstyle = (n) => [
    "<?xml version='1.0' encoding='UTF-8'?>", "<checkstyle version='4.3'>", "<file name='bad.sh' >",
    "<error line='3' column='6' severity='warning' message='a is referenced but not assigned.' source='ShellCheck.SC2154' />",
    "</file>", ...Array.from({ length: n }, (_, k) => `<!-- c${k} -->`), "<![CDATA[ tail ]]>", "</checkstyle>",
  ].join("\n");
  linearIn(shellcheck, checkstyle, 4001);
  // ...and so did the decoding of a failure's own text.
  const surefire = (n) => [
    '<testsuite name="shop.CartTest" tests="1" failures="1">',
    '  <testcase name="totals" classname="shop.CartTest" time="0.002">',
    `    <failure message="expected" type="org.opentest4j.AssertionFailedError">${"<!-- c -->".repeat(n)}<![CDATA[org.opentest4j.AssertionFailedError: expected`,
    "\tat shop.CartTest.totals(CartTest.java:9)", "]]></failure>", "  </testcase>", "</testsuite>",
  ].join("\n");
  linearIn(junitjvm, surefire, 4001);
});

test("a report's tag holding a long run of name characters and no `=`", () => {
  // An attribute name was tried from every character of the run.
  const checkstyle = (n) => [
    "<?xml version='1.0' encoding='UTF-8'?>", "<checkstyle version='4.3'>", `<file name='bad.sh' ${"a".repeat(n)}>`,
    "<error line='3' column='6' severity='warning' message='a is referenced but not assigned.' source='ShellCheck.SC2154' />",
    "</file>", "</checkstyle>",
  ].join("\n");
  linearIn(shellcheck, checkstyle, 5001);
});

// ------------------------------------------------------------- one long line

// A line pattern that finds its end by trying every place its start could stop - a lazy
// file name, then a lazy message, then a tail held to the end of the line - read a long
// line again from every colon in it. Nothing about the lines that trip it is unusual
// except that there is one of them and it is long.
const oneLine = (unit) => (n) => Array(n).fill(unit).join(" ");

test("one long line of stylelint-shaped findings", () => {
  linear(oneLine("cJSON.c:2600:34: error: too few arguments to function call, single argument hooks was not specified"), 401);
});

test("one long line of golangci-lint-shaped findings", () => {
  linear(oneLine("main.go:13:14: printf: fmt.Printf format %d has arg many of wrong type string"), 401);
});

test("one long line of shellcheck-shaped findings", () => {
  linear(oneLine("bad.c:4:5: error: call to undeclared function 'undefined_function'; ISO C99 and later do not support it"), 401);
});

test("one long line of ruby frames", () => {
  linear(oneLine("\tfrom /usr/lib/ruby/2.6.0/rubygems/core_ext/kernel_require.rb:54:in `require'"), 401);
});

test("one long line of node frames with calls in them", () => {
  linear(oneLine("    at Microsoft.VisualStudio.TestTools.UnitTesting.Assert.AreEqual[T](T expected, T actual, IEqualityComparer`1 comparer, String message"), 401);
});

test("a frame line padded with spaces, under every reader of V8 frames", () => {
  // A frame was read with a lazy name, an optional ` (` and a path held to the end of the
  // line, which tried the rest of the line from every place the name could stop. Two
  // thousand spaces after `at` cost jest, AVA and jasmine ten seconds a line.
  const padded = (name) => (n) => {
    const lines = readFileSync(join(here, "fixtures", name), "utf8").split("\n");
    const at = lines.findIndex((line) => /^[^\S\n]+at[^\S\n]/.test(line));
    lines.splice(at + 1, 0, `${lines[at].match(/^[^\S\n]*/)[0]}at${" ".repeat(n)}x`);
    return lines.join("\n");
  };
  for (const [extractor, name] of [
    [jest, "jest_fail.txt"], [ava, "ava_throw_fail.txt"], [jasmine, "jasmine_fail.txt"],
    [mocha, "mocha_fail.txt"], [mochaxunit, "mocha_xunit_fail.txt"], [bun, "bun_fail.txt"],
    [bunRuntime, "bunrun_crash_fail.txt"], [node, "node_stack.txt"], [taptext, "mocha_tap_fail.txt"],
  ]) linearIn(extractor, padded(name), 1001);
});

test("one long line of surefire tallies", () => {
  linear(oneLine("[INFO] Tests run: 45, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.015 s -- in org.json.junit.JSONParserConfigurationTest"), 401);
});

// ------------------------------------------------------- lines that nearly match
// A pattern with a lazy part before a part held to the end of the line tries that end
// from every place the lazy part could stop, and a line built of many such places and no
// such end was read again from each. Each of these is matched in one pass now, and held
// to its pattern below.

const capture = (name) => readFileSync(join(here, "fixtures", name), "utf8");
// A hostile line put where a real frame stands in a real capture.
const besides = (name, isFrame, line) => {
  const lines = capture(name).split("\n");
  lines.splice(lines.findIndex(isFrame) + 1, 0, line);
  return lines.join("\n");
};

test("a go test -json line of many \"Action\" keys and no closing brace", () => {
  linearIn(gojson, (n) => ['{"Action":"run","Package":"p","Test":"TestA"}', "{" + '"Action": 1, '.repeat(n)].join("\n"), 1001);
});

test("Less and PHP headers of many ` in ` and no line number", () => {
  linearIn(less, (n) => "ParseError: " + "x in y on line ".repeat(n) + "z", 1001);
  linearIn(php, (n) => [
    "Fatal error: " + "x in y on line ".repeat(n) + "z", "Fatal error: Uncaught E: " + "m in f:1 ".repeat(n) + "x",
    "Parse error: " + "x in y on line ".repeat(n) + "z",
  ].join("\n"), 1001);
});

test("a .NET frame of many ` in ` and no line number", () => {
  linearIn(dotnettest, (n) => besides("dotnettest_fail.txt", (l) => /^\s+at .+ in .+:\d+$/.test(l), "    at f" + " in g:1x".repeat(n)), 1001);
});

test("Ruby lines of many `:1:in '` and no closing quote", () => {
  linearIn(ruby, (n) => "a:1:in `x' ".repeat(n) + "(RuntimeError)", 1001);
  linearIn(ruby, (n) => ["app.rb:3:in `run': boom (RuntimeError)", "   from " + "a:1:in 'b".repeat(n)].join("\n"), 1001);
  linearIn(minitest, (n) => besides("minitest_fail.txt", (l) => /:in [`']/.test(l), "    " + "a:1:in 'b".repeat(n)), 1001);
});

test("a mypy error of many ` [` and no closing bracket", () => {
  linearIn(mypy, (n) => ["a.py:1: error: " + "m [".repeat(n), "Found 1 error in 1 file (checked 1 source file)"].join("\n"), 1001);
});

test("a cargo panic line of many threads and no location", () => {
  linearIn(cargo, (n) => ["error[E0308]: mismatched types", " --> src/main.rs:2:22", "thread 'A' panicked at a:1:1x".repeat(n)].join("\n"), 1001);
});

test("a CMake heading of many `:1 (` and no closing bracket", () => {
  linearIn(cmake, (n) => "CMake Error at " + "f:1 (".repeat(n), 1001);
});

test("a Perl diagnostic repeating the start of a warning it never finishes", () => {
  linearIn(perl, (n) => 'Argument "x" '.repeat(n) + "at a.pl line 1.", 2001);
});

test("a Go panic line of many ` [recovered` and no closing bracket", () => {
  // The message was tried against the ` [recovered ...]` ending after each of its
  // characters, and each try read on to the end of the line for the `]` - in deciding the
  // log was Go's, in a panic outside any test, and in one inside a test's output. Read once,
  // the line takes a twentieth of a millisecond, too little to time on its own, so each log
  // also holds two thousand lines of ordinary output.
  const output = Array.from({ length: 2000 }, (_, k) => `  building step ${k}`);
  linearIn(gotest, (n) => [...output, "panic: boom" + " [recovered".repeat(n), "", "goroutine 1 [running]:", "main.main()", "\t/src/main.go:9 +0x1d", "exit status 2"].join("\n"), 1001);
  linearIn(gotest, (n) => [
    "=== RUN   TestA", ...output, "panic: boom" + " [recovered".repeat(n), "", "goroutine 7 [running]:", "example.com/p.TestA(0xc0000a)",
    "\t/src/p/a_test.go:9 +0x1d", "--- FAIL: TestA (0.00s)", "FAIL\texample.com/p\t0.004s", "FAIL",
  ].join("\n"), 1001);
});

test("a passing Gradle test whose name holds many ` > `", () => {
  // The pattern repeated a group whose lazy name could take the next ` > ` in, and tried
  // every way of dividing the name between them: each two more doubled the time and then
  // some. Twenty-one of them took a sixth of a second, and a few more took minutes.
  linearIn(jvm, (n) => ["> Task :test FAILED", "com.Foo" + " > a".repeat(n) + " PASSED", "", "2 tests completed, 1 failed"].join("\n"), 6);
});

// Each replacement answers exactly what its pattern answered - every group, on lines built
// to nearly match and on lines of loose pieces, including the line terminators `.` refuses
// to cross.
let seed = 2027;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rand() * a.length)];
const gap = () => pick(["", " ", "  ", "\t", " \t ", "\u2028", "\r", "   "]);
const junk = () => pick(["", "x", ":", "1", ":1:2:", "(", ")", "[", "]", "'", "`", "':", ".go", "./", ".\\", "\u2028", "\u2029", "\r", " ", "SC", "Error", "a:b", "at ", "<<<", "Time elapsed:"]);
const agrees = (name, expected, replacement, near) => {
  const shown = (m) => (m ? JSON.stringify([...m]) : "null");
  const wrong = [];
  let matched = 0;
  for (let k = 0; k < 20000 && wrong.length < 3; k++) {
    let line = near();
    if (rand() < 0.5) { const at = Math.floor(rand() * (line.length + 1)); line = line.slice(0, at) + junk() + line.slice(at); }
    let loose = "";
    for (let i = 1 + Math.floor(rand() * 10); i > 0; i--) loose += junk();
    for (const text of [line, loose]) {
      const want = shown(expected(text)), got = shown(replacement(text));
      if (want !== "null") matched++;
      if (want !== got) wrong.push(`${JSON.stringify(text)}: pattern ${want}, replacement ${got}`);
    }
  }
  assert.deepEqual(wrong, [], name);
  assert.ok(matched > 200, `${name}: only ${matched} lines matched, which tests little`);
};

const matching = (pattern) => (text) => text.match(pattern);
const testing = (pattern) => (text) => (pattern.test(text) ? [text] : null);

test("each replacement matches exactly what its pattern matched", () => {
  agrees("stylelint -f unix", matching(/^(\S.*?):(\d+):(\d+):[^\S\n]+(.+?)[^\S\n]*\(([\w-]+(?:\/[\w-]+)?)\)[^\S\n]*\[(error|warning)\][^\S\n]*$/), unixLine,
    () => pick(["a.css", "src/x y.scss", "a:b.css", ":1", ""]) + ":" + pick(["1", "12", "x"]) + ":" + pick(["2", "34", ""]) + ":" + gap() +
      pick(["msg", "m (x)", "", " ", "a:1:2: b"]) + gap() + pick(["(rule)", "(a/b)", "(a/b/c)", "()"]) + gap() + pick(["[error]", "[warning]", "[x]", ""]) + gap());
  agrees("golangci-lint", matching(/^(?:\.[\\/])?(.+?\.go):(\d+):(\d+):[^\S\n]+(.+?)[^\S\n]+\(([\w-]+)\)[^\S\n]*$/), issueLine,
    () => pick(["", "./", ".\\", "../"]) + pick(["main.go", "a.go", ".go", "x.gox", "a b.go"]) + ":" + pick(["1", "13", "x"]) + ":" + pick(["14", ""]) + ":" + gap() +
      pick(["msg", "printf: fmt (x)", "", " "]) + gap() + pick(["(govet)", "(err-check)", "()", "(a b)"]) + gap());
  agrees("shellcheck -f gcc", matching(/^(.+?):(\d+):(\d+):[^\S\n]+(error|warning|note):[^\S\n]+(.+?)[^\S\n]+\[(SC\d+)\][^\S\n]*$/), gccLine,
    () => pick(["bad.sh", " a.sh", "a:b.sh", "", "x"]) + ":" + pick(["4", "10"]) + ":" + pick(["5", ""]) + ":" + gap() + pick(["error", "warning", "note", "info"]) + ":" + gap() +
      pick(["msg", "Use x [y]", "", " "]) + gap() + pick(["[SC2086]", "[SC]", "[SC2086] x"]) + gap());
  agrees("ruby", matching(/^(.+?):(\d+):in [`'](.+?)':[^\S\n]+(.*?)[^\S\n]+\(([A-Z][\w:]*(?:Error|Exception|Interrupt|Signal|Timeout))\)$/), raiseLine,
    () => pick(["app.rb", "a b.rb", "x", "", "a:1"]) + ":" + pick(["3", "12", "x"]) + ":in " + pick(["`", "'"]) + pick(["run", "block in run", "it's", "", "a':b"]) + "':" + gap() +
      pick(["boom", "", " ", "a (b)"]) + gap() + pick(["(RuntimeError)", "(Foo::BarError)", "(Timeout)", "(error)"]));
  // These two are only ever asked whether they match.
  agrees("node frame", testing(/^[^\S\n]+at .+\(.+:\d+:\d+\)$/m), testing(FRAME_WITH_CALL),
    () => pick(["  ", " ", "\n ", "\r "]) + "at " + pick(["f ", "(", "a (b) ", ""]) + pick(["(", "(("]) + pick(["x.js", "", ":1"]) + ":" + pick(["1", "x"]) + ":" + pick(["2", ""]) + ")" + pick(["", "\n", "\u2028", " "]));
  agrees("surefire tally", testing(/Time elapsed:.*<<<[^\S\n]+(?:FAILURE|ERROR)!/), testing(FAILED_TALLY),
    () => pick(["", "Tests run: 1, ", "x"]) + "Time elapsed:" + pick([" 0.01 s ", "", "\u2028", "\n"]) + pick(["<<<", "<<", ""]) + gap() + pick(["FAILURE!", "ERROR!", "FAIL"]) + pick(["", " -- in T"]));
  // Every attribute of a tag, as the pattern xmlAttributes used to read them.
  const attributes = (read) => (tag) => { const found = Object.entries(read(tag)); return found.length ? found : null; };
  // ...and the readers that replaced the patterns of lines that nearly match.
  const test = (pattern) => (text) => (pattern.test(text) ? [text] : null);
  const yes = (read) => (text) => (read(text) ? [text] : null);
  agrees("go test -json event", test(/^[^\S\n]*\{.*"Action"[^\S\n]*:.*\}[^\S\n]*$/), yes(isEvent),
    () => gap() + pick(["{", "x{"]) + pick(['"Action"', '"Action" :', ' "Test":"T", "Action":"run"', "x"]) + pick([":", ""]) + pick(['"run"', "1", "}", ""]) + pick(["}", ""]) + gap());
  agrees("gradle test", matching(/^([A-Za-z_$][\w.$]*(?:[^\S\n]+>[^\S\n]+.+?)+)[^\S\n]+FAILED[^\S\n]*$/), gradleTestLine,
    () => pick(["com.Foo", "a.b$c", "1x"]) + gap() + pick([">", ">>", "x"]) + gap() + pick(["a", "b c", "test()", ">", ""]) + pick(["", gap() + ">" + gap() + pick(["x", "x > y", " "])]) + gap() + pick(["FAILED", "PASSED", "FAILEDX"]) + gap());
  agrees("less", matching(/^(\w*(?:Error|Exception)):[^\S\n]*(.+?)[^\S\n]+in[^\S\n]+(.+?)[^\S\n]+on line[^\S\n]+(\d+)(?:,[^\S\n]+column[^\S\n]+(\d+))?:?[^\S\n]*$/), lessHead,
    () => pick(["NameError", "Error", "Errorx"]) + ":" + gap() + pick(["x", "a b", "in", ""]) + gap() + pick(["in", "in in", "within"]) + gap() + pick(["/a.less", "in"]) + gap() + "on line" + gap() + pick(["1", "x"]) + pick(["", ", column 3"]) + pick(["", ":"]) + gap());
  agrees("php fatal", matching(/^(?:PHP[^\S\n]+)?Fatal error:[^\S\n]+(?!Uncaught[^\S\n])(.+?)[^\S\n]+in[^\S\n]+(.+?)[^\S\n]+on line[^\S\n]+(\d+)$/), fatalLine,
    () => pick(["", "PHP "]) + "Fatal error:" + gap() + pick(["", "Uncaught "]) + pick(["x", "a b", ""]) + gap() + pick(["in", "in in"]) + gap() + pick(["/a.php", "a b.php"]) + gap() + "on line" + gap() + pick(["1", "x"]));
  agrees("php parse", matching(/^(?:PHP[^\S\n]+)?Parse error:[^\S\n]+(.+?)[^\S\n]+in[^\S\n]+(.+?)[^\S\n]+on line[^\S\n]+(\d+)$/), parseLine,
    () => pick(["", "PHP "]) + "Parse error:" + gap() + pick(["x", "a b", ""]) + gap() + pick(["in", "in in"]) + gap() + pick(["/a.php", "a b.php"]) + gap() + "on line" + gap() + pick(["1", "x"]));
  agrees("php uncaught", matching(/^(?:PHP[^\S\n]+)?Fatal error:[^\S\n]+Uncaught[^\S\n]+([\w\\]+):[^\S\n]+(.+?)[^\S\n]+in[^\S\n]+(.+?):(\d+)$/), uncaughtLine,
    () => pick(["", "PHP "]) + "Fatal error:" + gap() + "Uncaught" + gap() + pick(["Exception", "App\\Err"]) + ":" + gap() + pick(["x", "a b", "in"]) + gap() + pick(["in", "in in"]) + gap() + pick(["/a.php", "x:1"]) + ":" + pick(["1", "x"]));
  agrees("dotnet frame", matching(/^[^\S\n]*at[^\S\n]+(.+?)[^\S\n]+in[^\S\n]+(.+?):(?:line[^\S\n]+)?(\d+)[^\S\n]*$/), atLine,
    () => gap() + "at" + gap() + pick(["Ns.C.M()", "M(a, b)", "in"]) + gap() + pick(["in", "in in"]) + gap() + pick(["/a.cs", "C:\\a b.cs"]) + ":" + pick(["line 3", "12", "x"]) + gap());
  agrees("cargo panic", matching(/^[^\S\n]*thread '(.+?)'(?: \(\d+\))? panicked at (.+?):(\d+):(\d+):$/), panicLine,
    () => gap() + "thread '" + pick(["main", "a'b", ""]) + "'" + pick(["", " (12)"]) + pick([" panicked at ", "panicked at "]) + pick(["src/main.rs", "x:1:2"]) + ":" + pick(["3", "x"]) + ":" + pick(["4", "5"]) + pick([":", ""]));
  agrees("ruby frame", matching(/^[^\S\n]+from[^\S\n]+(.+?):(\d+):in [`'](.+?)'$/), (l) => frameLine(l, "from"),
    () => pick([" ", "  ", ""]) + "from" + gap() + pick(["app.rb", "a b.rb", "", " "]) + ":" + pick(["3", "x"]) + ":in " + pick(["`", "'"]) + pick(["run", "a'b", ""]) + pick(["'", ""]));
  agrees("minitest frame", matching(/^[^\S\n]+(.+?):(\d+):in [`'](.+?)'$/), (l) => frameLine(l, ""),
    () => pick([" ", "  ", ""]) + pick(["app.rb", "a b.rb", "", " "]) + ":" + pick(["3", "x"]) + ":in " + pick(["`", "'"]) + pick(["run", "a'b", ""]) + pick(["'", ""]));
  agrees("cmake heading", matching(/^CMake (Error|Warning|Deprecation Warning)(?:[^\S\n]+at[^\S\n]+(.+?):(\d+)(?:[^\S\n]+\(([^)]+)\))?)?:[^\S\n]*$/), cmakeHead,
    () => "CMake " + pick(["Error", "Warning", "Deprecation Warning"]) + pick(["", gap() + "at" + gap() + pick(["CMakeLists.txt", "a b", ":1", ""]) + ":" + pick(["1", "x"]) + pick(["", gap() + "(" + pick(["add_x", "a(b", ""]) + ")"])]) + pick([":", ""]) + gap());
  agrees("mypy", matching(/^(.+?):(\d+)(?::(\d+))?:[^\S\n]+(error|warning|note):[^\S\n]+(.+?)(?:[^\S\n]+\[([^\]]+)\])?$/), diagnosticLine,
    () => pick(["a.py", "x:1"]) + ":" + pick(["1", "12"]) + pick(["", ":3"]) + ":" + gap() + pick(["error", "note", "x"]) + ":" + gap() + pick(["Name x", "a [b", "[c]", "", " "]) + pick(["", gap() + "[" + pick(["name-defined", "a [b", ""]) + "]"]) + gap());
  agrees("perl argument", test(/\bArgument ".*" isn't numeric\b/), yes((l) => bracketed(l, 'Argument "', "\" isn't numeric", 0)),
    () => pick(["", "x", "_"]) + pick(['Argument "', "Argument"]) + pick(["x", "", '"']) + pick(["\" isn't numeric", " isn't numeric"]) + pick(["", "x", " at a.pl line 1."]));
  agrees("perl useless", test(/\bUseless use of .+ in void context\b/), yes((l) => bracketed(l, "Useless use of ", " in void context", 1)),
    () => pick(["", "x"]) + "Useless use of " + pick(["x", "", "a b"]) + pick([" in void context", " in void"]) + pick(["", "s", " at a.pl line 1."]));
  agrees("go panic", matching(/^panic: (.+?)(?:\s\[recovered.*\])?$/), (l) => { const message = panicMessage(l); return message === null ? null : [l, message]; },
    () => "panic:" + pick([" ", "  ", ""]) + pick(["boom", "", "a b", "[recovered]"]) +
      pick(["", gap() + "[recovered" + pick(["", "x", gap(), " x" + gap()]) + pick(["]", "]]", ""])]) + pick(["", "", gap()]));
  agrees("go panic, anywhere in a log", test(/^panic: (.+?)(?:[^\S\n]\[recovered.*\])?$/m), test(PANIC_LINE),
    () => pick(["", "x\n", "x\r", "x" + gap()]) + pick(["panic: ", "panic:", "xpanic: "]) + pick(["", "a", "[recovered]"]) + gap() + pick(["", "\ny"]));
  agrees("xml attributes", attributes((tag) => {
    const found = {};
    for (const match of tag.matchAll(/([\w:.-]+)=(?:"([^"]*)"|'([^']*)')/g)) found[match[1]] = xmlText(match[2] ?? match[3]);
    return found;
  }), attributes(xmlAttributes),
  () => pick(["<file", "<testcase", "<a", ""]) + gap() + pick(["name", "a:b", "x.y-z", "", "aaaa", "1", "\u00e9"]) + pick(["=", "", "=="]) +
      pick(['"v"', "'v'", '"a b"', "'it''s'", "v", '""', '"x', "&amp;"]) + gap() + pick(["name", "classname", "a", "-", ":"]) + pick(["=", ""]) +
      pick(['"1"', "'2'", "3", ""]) + pick([">", "/>", ""]));
});

// ------------------------------------------------------ what every log goes through
// After its parsers, every log is de-duplicated, compared tool against tool and printed,
// and before them a capture keeps its head and its tail. Those steps see every failure of
// every tool in the log at once, so a monorepo's log is their largest input.

/** `linear`, for a step every log goes through: `read(grow(4n))` costs about four times
 *  `read(grow(n))`. Only the readers a log names are asked, as in a real run, so that their
 *  own time does not hide the step's. A first read of the larger input within the bound is
 *  enough; one past it is read twice more, so that a pause in the machine does not fail it. */
function linearStep(read, grow, n) {
  // An input's time is its fastest read. A read can take a tenth of a millisecond, and a
  // collection of the heap landing among twenty milliseconds of them takes longer than all
  // of them together - Node 18 pauses for ten to forty milliseconds at a time late in this
  // file. A quadratic step is slow on every read.
  const once = (input) => {
    let best = Infinity;
    const at = performance.now();
    do {
      const start = performance.now();
      read(input);
      best = Math.min(best, performance.now() - start);
    } while (performance.now() - at < FLOOR_MS);
    return best;
  };
  const small = Math.min(...Array.from({ length: 3 }, () => once(grow(n))));
  const big = grow(4 * n - 3);
  let large = once(big);
  if (large >= small * 8) large = Math.min(large, once(big), once(big));
  assert.ok(large < small * 8,
    `${ms(small)}ms for the log, ${ms(large)}ms for four times as much - x${(large / small).toFixed(1)}`);
}

test("one diagnosis quoting a different source line each time", () => {
  // A reading was asked about every earlier reading of the same diagnosis, to keep apart
  // two that quote different lines. Two thousand cargo runs of one E0308 took six seconds.
  const runs = (n) => Array.from({ length: n }, (_, k) => [
    "error[E0308]: mismatched types", " --> src/main.rs:2:22", "  |",
    `2 |     let total: i32 = "value number ${k}";`,
    "  |                ---   ^^^^^^^^^^^^^^^^ expected `i32`, found `&str`",
    "  |                |", "  |                expected due to this", "",
    "For more information about this error, try `rustc --explain E0308`.",
    "error: could not compile `shop` (bin \"shop\") due to 1 previous error", "",
  ].join("\n")).join("\n");
  linearStep(analyse, runs, 501);
});

test("two tools reporting thousands of different things on one line", () => {
  // Each second tool's finding was compared with every finding the first tool made on
  // its line, outside the budget every other comparison of two tools' text keeps to.
  const log = (n) => [
    "", "/home/dev/app/src/cart.ts",
    ...Array.from({ length: n }, (_, k) => `  1:${k + 1}  error  Unexpected thing ${k}  rule-${k}`),
    "", `\u2716 ${n} problems (${n} errors, 0 warnings)`, "",
    ...Array.from({ length: n }, (_, k) => `src/cart.ts(1,${k + 1}): error TS2322: Type 'string' is not assignable to type 'number' number ${k}.`),
  ].join("\n");
  linearStep(analyse, log, 1201);
});

test("a tool's located findings beside thousands of another's unlocated ones", () => {
  // A finding that names no file is dropped as an echo when another tool's message holds
  // it, and each one searched every located finding in the log, outside the budget too.
  const log = (n) => [
    "TAP version 13", "not ok 1 - adds", "  ---", "  location: '/home/dev/app/test/t.test.js:1:3'",
    "  error: 'Expected 1 to equal 2'", "  ...", "1..1", "# fail 1",
    ...Array.from({ length: n }, (_, k) => `src/mod${k}.py:${k + 1}:1: F401 'pkg${k}.util' imported but unused`),
    ...Array.from({ length: n }, (_, k) => `python3: No module named pkg${k}`),
  ].join("\n");
  linearStep(analyse, log, 3001);
});

test("a capture whose tail is thousands of short diagnostic lines", () => {
  // Keeping a diagnostic line from the middle of a log leaves less room for its tail,
  // which can let another line into the middle. Each line let in filtered every saved
  // line again and summed the middle again.
  const filler = (bytes) => {
    const line = "info: compiling module of the build graph\n";
    return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes - 1) + "\n";
  };
  const capture = (maxBytes) => {
    const head = Math.floor(maxBytes * 0.25);
    const c = createCapture(maxBytes);
    c.push(Buffer.from(filler(head)));
    c.push(Buffer.from(filler(64 * 1024)));
    c.push(Buffer.from("FAIL\n".repeat(Math.ceil((maxBytes - head + 5) / 5))));
    return c.finish();
  };
  linearStep(capture, (n) => n, 262145);
});

test("a capture of thousands of separate diagnostic windows", () => {
  // Each window kept from the middle brings a marker the budget did not count, and when
  // the markers outgrew the tail the middle was shed one line at a time, composing the
  // whole text again after each line: seventy thousand windows took hours.
  const filler = (bytes) => "info: compiling module of the build graph\n".repeat(Math.ceil(bytes / 42));
  const capture = (maxBytes) => {
    const c = createCapture(maxBytes);
    c.push(Buffer.from(filler(maxBytes / 4)));
    let windows = "";
    for (let k = 0; k < maxBytes / 4 / 37; k++) windows += "FAIL\n" + "x\n".repeat(17);
    c.push(Buffer.from(windows));
    c.push(Buffer.from(filler(maxBytes)));
    return c.finish();
  };
  linearStep(capture, (n) => n, 65537);
});

test("a large log that nothing wraps, asked what wraps it", () => {
  // Every wrapper shape, and the search for a literal prefix, asked for the log's first two
  // hundred lines by splitting and filtering all of it: ten readings of the whole log for
  // each log analysed, a quarter of a second for 10MB with no wrapper on it.
  const words = ["compiling", "linking", "Resolving", "warning:", "src/a.ts", "npm", "Done", "  at x", "Downloading", "info"];
  const log = Array.from({ length: 50000 }, (_, k) => `${words[k % 10]} module ${k} of the monorepo`).join("\n");
  const fastestOf = (read) => Math.min(...Array.from({ length: 5 }, () => {
    const at = performance.now();
    read();
    return performance.now() - at;
  }));
  const once = fastestOf(() => log.split("\n").filter((line) => line.trim()));
  const asked = fastestOf(() => wrapperCandidates(log));
  assert.ok(asked < once * 5, `${ms(asked)}ms to ask, against ${ms(once)}ms to read the log's lines once`);
});

test("thousands of failures, every one of them new since the last run", () => {
  // Each failure printed was looked up in the list of new causes, one entry at a time.
  const report = (n) => {
    const result = analyse([
      "", "/home/dev/app/src/cart.ts",
      ...Array.from({ length: n }, (_, k) => `  ${k + 1}:3  error  Unexpected thing ${k}  rule-${k}`),
      "", `\u2716 ${n} problems (${n} errors, 0 warnings)`, "",
    ].join("\n"), { cluster: false });
    const fresh = result.failures.map((f) => trackedCauseId(f, result.tool));
    return { result, since: { compared: true, reason: null, fresh, gone: 0 } };
  };
  linearStep(({ result, since }) => render(result, { max: Infinity, cluster: false, since }), report, 2001);
});

test("the line of an offset, asked again of a fresh copy of the same log", () => {
  // lineAt caches where a log's lines start, and checked the cache by comparing strings,
  // which compares their content. A fresh string with the same text matched without
  // replacing the cached one, so each later lookup compared the whole log again. Every
  // first read rebuilds the cache and is fast, which is why a scaling test that keeps
  // its fastest run never saw it; the next read of an equal log was quadratic.
  const copy = () => ["{", "x".repeat(8_000_000), "}"].join("");
  const first = copy();
  let at = performance.now();
  lineAt(first, 5);
  const build = performance.now() - at;
  const again = copy();
  at = performance.now();
  for (let k = 0; k < 2000; k++) lineAt(again, k);
  const lookups = performance.now() - at;
  // Building the cache takes well under a millisecond, so the bound has a floor: twenty
  // milliseconds is far above any noise in the fixed lookups and far below the bug's
  // half a second.
  assert.ok(lookups < Math.max(build, 5) * 4,
    `2,000 lookups on an equal copy took ${lookups.toFixed(0)}ms, against ${build.toFixed(1)}ms to build the cache`);
});

test("the lines of each of thousands of elements of a report written on one line", () => {
  // Every reader of an XML report asks lineAt for the line each element starts on and the
  // line it ends on. Where one function held lineAt twice, Node 18's compiler ran the first
  // two newline searches of the cache's rebuild on every call, ahead of the check that the
  // cache still held the log: each element searched the log to its second newline, and a
  // report written on one line has none. The compiler does this to a rebuild it has seen
  // run, so the cache is rebuilt a few hundred times first.
  for (let k = 0; k < 500; k++) lineAt(`a\nb\n${k}`, 3);
  const report = (n) => ({ n, text: `<testsuites>${'<testcase name="t"><failure/></testcase>'.repeat(n)}</testsuites>` });
  linearStep(({ n, text }) => {
    const element = (at, length) => ({ start: lineAt(text, at), end: lineAt(text, at + length - 1) + 1 });
    for (let k = 0; k < n; k++) element(12 + 40 * k, 40);
  }, report, 4001);
});

// ------------------------------------------------------------- runner formats
// A reader that goes back to the top of the log for each block it finds, or reads on past
// where the next block starts, reads the log again for every block - and a monorepo's run
// prints thousands of blocks.

test("thousands of bundler conflicts", () => {
  // Each conflict looked for its explanation from the top of the log.
  const unexplained = (n) => ["Resolving dependencies...", ...Array(n).fill("Could not find compatible versions")].join("\n");
  const explained = (n) => Array.from({ length: n }, (_, k) => [
    "Could not find compatible versions", "", `Because gem${k} >= 1 depends on dep${k} ~> 2`,
    `  and Gemfile depends on dep${k} = 1,`, "  version solving has failed.",
  ].join("\n")).join("\n");
  linearIn(bundler, unexplained, 1001);
  linearIn(bundler, explained, 4001);
});

test("a pytest summary of thousands of failures and nothing else", () => {
  // With --tb=no there are no tracebacks, and each summary line asked every failure read
  // before it for its node id and then for its name.
  const summary = (n) => [
    "=========================== short test summary info ============================",
    ...Array.from({ length: n }, (_, k) => `FAILED tests/test_m${k}.py::test_total_${k} - assert ${k} == ${k + 1}`),
    `============================== ${n} failed in 1.23s ===============================`,
  ].join("\n");
  linearIn(pytest, summary, 2001);
});

test("swiftc's parseable output from thousands of compile jobs", () => {
  // Each error searched every record before it for its location.
  const records = (n) => Array.from({ length: n }, (_, k) => {
    const body = JSON.stringify({ kind: "finished", name: "compile", pid: k + 1, output: `src/f${k}.swift:${k + 1}:3: error: cannot find 'thing${k}' in scope\n`, "exit-status": 1 });
    return `${Buffer.byteLength(body)}\n${body}`;
  }).join("\n");
  linearIn(swift, records, 1001);
});

test("a markdownlint JSON report of thousands of violations", () => {
  // Each record compared itself with every violation before it - by file first, and a
  // monorepo's paths are long.
  const file = `docs/${"chapter-".repeat(48)}index.md`;
  const report = (n) => JSON.stringify(Array.from({ length: n }, (_, k) => ({ fileName: file, lineNumber: k + 1, ruleNames: ["MD013"], ruleDescription: "L" })));
  linearIn(markdownlint, report, 4001);
});

test("a Go test that prints thousands of lines starting with panic:", () => {
  // Each one looked for a stack frame to the end of the test's output.
  const noisy = (n) => [
    "=== RUN   TestNoisy", ...Array.from({ length: n }, (_, k) => `panic: not really ${k}`), "    noisy_test.go:9: it broke",
    "--- FAIL: TestNoisy (0.00s)", "FAIL", "FAIL\texample.com/noisy\t0.004s", "FAIL",
  ].join("\n");
  linearIn(gotest, noisy, 1001);
});

test("rspec failing to load hundreds of spec files", () => {
  // Each load error read on to the one footer they share, through every later one.
  const loads = (n) => [
    ...Array.from({ length: n }, (_, k) => [
      "", `An error occurred while loading ./spec/f${k}_spec.rb.`, `Failure/Error: raise "spec ${k} blew up at load"`, "",
      "RuntimeError:", `  spec ${k} blew up at load`, `# ./spec/f${k}_spec.rb:1:in \`<top (required)>'`,
    ].join("\n")),
    "No examples found.", "", "Finished in 0.00001 seconds (files took 0.03182 seconds to load)",
    `0 examples, 0 failures, ${n} errors occurred outside of examples`,
  ].join("\n");
  linearIn(rspec, loads, 301);
});

test("thousands of unclosed arrays where ruff's JSON could be", () => {
  // Each bracket that opened a line was scanned from to the end of the log.
  const brackets = (n) => ['{"filename": "x.py", "code": "F401"}', ...Array(n).fill("[")].join("\n");
  linearIn(ruff, brackets, 1001);
});

test("vitest TAP whose YAML blocks never close", () => {
  // Each block read on to the end of the log, through every later result.
  const tap = (n) => ["TAP version 13", `1..${n}`, ...Array.from({ length: n }, (_, k) => [
    `not ok ${k + 1} - adds ${k}`, "  ---", `  at: "src/a.test.js:${k + 1}:3"`, `  message: "expected ${k}"`,
  ].join("\n"))].join("\n");
  linearIn(vitest, tap, 301);
});

test("thousands of docker build steps whose commands failed", () => {
  // Each step asked the whole log whether it had printed anything.
  const steps = (n) => [
    ...Array.from({ length: n }, (_, k) => `#${k + 1} ERROR: process "/bin/sh -c step${k}" did not complete successfully: exit code: 1`),
    ...Array.from({ length: n }, (_, k) => `#${k + 1} 0.${String(k).padStart(3, "0")} step ${k} said something`),
  ].join("\n");
  linearIn(docker, steps, 1001);
});

test("thousands of PHPUnit tallies above one failure", () => {
  // Each tally read on to the end of the run, through every tally after it.
  const tallies = (n) => [
    "PHPUnit 11.0.0 by Sebastian Bergmann and contributors.", "", ...Array(n).fill("There was 1 failure:"), "",
    "1) App\\CartTest::testTotal", "Failed asserting that 4 is identical to 5.", "", "/app/tests/CartTest.php:12",
  ].join("\n");
  linearIn(phpunit, tallies, 2001);
});

// ---------------------------------------------------------------- large reports
// `list.push(...items)` and `Math.min(...items)` hand each item over as an argument of its
// own, and past about 125,000 of them V8 throws. A reader that throws is skipped, so a
// report that large lost everything in it - and the capture, which nothing catches, took
// the whole run down. 150,000 is past that on every platform.

const LARGE = 150000;
const failuresOf = (extractor, log) => (extractor.detect(log) ? extractor.extract(log).failures.length : 0);

test("a verbose go test run of 150,000 failing tests", () => {
  const log = ["=== RUN   TestA", ...Array.from({ length: LARGE }, (_, k) => `--- FAIL: T${k} (0.00s)\n    a_test.go:${k + 1}: m${k}`), "FAIL", "FAIL\tex/p\t0.1s", "FAIL"].join("\n");
  assert.equal(failuresOf(gotest, log), LARGE);
});

test("a pip build whose subprocess printed 150,000 lines", () => {
  const log = ["Processing ./pkg", "  error: subprocess-exited-with-error", "  × Building wheel for pkg (pyproject.toml) did not run successfully.",
    `  ╰─> [${LARGE} lines of output]`, ...Array.from({ length: LARGE }, (_, k) => `      line ${k}`), "      [end of output]",
    "error: subprocess-exited-with-error"].join("\n");
  assert.equal(pip.extract(log).failures[0]?.message, `line ${LARGE - 1}`);
});

test("a legacy ESLint JSON report of 150,000 files", () => {
  const log = JSON.stringify(Array.from({ length: LARGE }, (_, k) => ({ filePath: `/s/${k}.js`, errorCount: k % 1000 ? 0 : 1, warningCount: 0,
    messages: k % 1000 ? [] : [{ ruleId: "no-undef", severity: 2, message: "x is not defined", line: 1, column: 1 }] })));
  assert.equal(failuresOf(eslintjson, log), LARGE / 1000);
});

test("a message holding 150,000 blank lines", () => {
  assert.equal(collapseRepeats("a\n" + "\n".repeat(LARGE) + "b").split("\n").length, LARGE + 2);
});

test("a ShellCheck JSON report of 150,000 comments", () => {
  const log = JSON.stringify({ comments: Array.from({ length: LARGE }, (_, k) => ({ file: "a.sh", line: k + 1, endLine: k + 1, column: 1, endColumn: 2,
    level: "warning", code: 2086, message: "Double quote to prevent globbing and word splitting.", fix: null })) });
  assert.equal(failuresOf(shellcheck, log), LARGE);
});

test("a Playwright JUnit failure naming 150,000 tests", () => {
  const heads = Array.from({ length: LARGE }, (_, k) => `  a.spec.ts:${k + 1}:3 › t${k} ────────────`).join("\n");
  const log = ['<?xml version="1.0" encoding="UTF-8"?>', '<testsuites id="" name="" tests="1" failures="1">', '<testsuite name="a.spec.ts" tests="1" failures="1">',
    `<testcase name="t" classname="a.spec.ts" time="1"><failure message="a.spec.ts:1:3 t" type="FAILURE"><![CDATA[${heads}\n\n    Error: boom\n]]></failure></testcase>`,
    "</testsuite>", "</testsuites>"].join("\n");
  assert.equal(failuresOf(playwright, log), LARGE);
});

test("a .NET run beside a TRX document of 150,000 failed results", () => {
  const log = ["Running tests from /home/dev/A.Tests/bin/Debug/net10.0/A.Tests.dll (net10.0|arm64)", "failed A.Tests.Console.Fails (11ms)",
    "  Assert.Equal() Failure: Values differ", "  from /home/dev/A.Tests/bin/Debug/net10.0/A.Tests.dll (net10.0|arm64)",
    '<?xml version="1.0" encoding="utf-8"?>', '<TestRun id="1" name="r" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010"><Results>',
    ...Array.from({ length: LARGE }, (_, k) => `<UnitTestResult testName="A.T${k}" outcome="Failed"><x/></UnitTestResult>`), "</Results></TestRun>"].join("\n");
  assert.equal(failuresOf(dotnettest, log), LARGE + 1);
});

test("150,000 git errors", () => {
  const log = Array.from({ length: LARGE }, (_, k) => `error: pathspec 'f${k}' did not match any file(s) known to git`).join("\n");
  assert.equal(failuresOf(git, log), LARGE);
});

test("a capture with 150,000 diagnostic lines between its head and its tail", () => {
  const max = 10 * 1024 * 1024, filler = "info: compiling module of the build graph\n";
  const c = createCapture(max);
  c.push(Buffer.from(filler.repeat(Math.ceil(max / 4 / filler.length))));
  c.push(Buffer.from("FAIL\n".repeat(LARGE)));
  c.push(Buffer.from(filler.repeat(Math.ceil(max * 2 / filler.length))));
  assert.equal(c.finish().text.split("\n").filter((line) => line === "FAIL").length, LARGE);
});

test("a GitHub summary of 150,000 failures", () => {
  const failures = Array.from({ length: LARGE }, (_, k) => ({ title: `T${k}`, message: "m", severity: "error", file: "a_test.go", line: k + 1 }));
  const { summary } = githubOutput({ tool: "go test", summary: "x", failures, others: [], wrappers: [] });
  assert.ok(summary.includes("**T0**"), "the summary names the first failure");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
