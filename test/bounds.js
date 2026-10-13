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
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse } from "../src/index.js";
import { createCapture } from "../src/capture.js";
import { wrapperCandidates } from "../src/normalize.js";
import { lineAt } from "../src/util.js";
import { trackedCauseId } from "../src/history.js";
import { render } from "../src/render.js";
import bundler, { CARET_NOTE as RUBYGEMS_CARET_NOTE, FROM as RUBYGEMS_FROM, MISSING as RUBYGEMS_MISSING } from "../src/extractors/rubygems.js";
import pytest from "../src/extractors/pytest.js";
import swift from "../src/extractors/swift.js";
import markdownlint from "../src/extractors/markdownlint.js";
import gotest, { NO_MODULE_RE as GOTEST_NO_MODULE_RE, PANIC_LINE, panicMessage } from "../src/extractors/gotest.js";
import rspec, { COMMENTED_FRAME as RSPEC_COMMENTED_FRAME, LOCATION_RE as RSPEC_LOCATION_RE } from "../src/extractors/rspec.js";
import ruff, { ARROW_RE as RUFF_ARROW_RE } from "../src/extractors/ruff.js";
import terraform, { AT_RE as TERRAFORM_AT_RE } from "../src/extractors/terraform.js";
import vitest from "../src/extractors/vitest.js";
import docker, { FINAL_ERROR as DOCKER_FINAL_ERROR, POINTED as DOCKER_POINTED, QUOTED_STEP as DOCKER_QUOTED_STEP, STEP_ERROR as DOCKER_STEP_ERROR } from "../src/extractors/docker.js";
import phpunit from "../src/extractors/phpunit.js";
import { unixLine } from "../src/extractors/stylelint.js";
import { EMBEDDED as GOLANGCI_EMBEDDED, issueLine, TAB as GOLANGCI_TAB } from "../src/extractors/golangci.js";
import { gccLine } from "../src/extractors/shellcheck.js";
import { raiseLine } from "../src/extractors/ruby.js";
import { FRAME_WITH_CALL } from "../src/extractors/node.js";
import { FAILED_TALLY } from "../src/extractors/junitjvm.js";
import jest, { JEST_GROUP as JEST_JEST_GROUP, SUITES_TALLY as JEST_SUITES_TALLY, TEST_RE as JEST_TEST_RE, TESTS_TALLY as JEST_TESTS_TALLY } from "../src/extractors/jest.js";
import ava from "../src/extractors/ava.js";
import jasmine, { HEAD_RE as JASMINE_HEAD_RE } from "../src/extractors/jasmine.js";
import mocha from "../src/extractors/mocha.js";
import mochaxunit from "../src/extractors/mochaxunit.js";
import bun, { bunRuntime, FAIL_ANY as BUN_FAIL_ANY, FAIL_RE as BUN_FAIL_RE } from "../src/extractors/bun.js";
import node from "../src/extractors/node.js";
import taptext from "../src/extractors/taptext.js";
import nodetest, { ALT_FAILURE_RE as NODETEST_ALT_FAILURE_RE, ALT_LOCATION_RE as NODETEST_ALT_LOCATION_RE, ERROR_INLINE_RE as NODETEST_ERROR_INLINE_RE, NOT_OK_RE as NODETEST_NOT_OK_RE } from "../src/extractors/nodetest.js";
import junitjvm from "../src/extractors/junitjvm.js";
import deno, { HEADER_RE as DENO_HEADER_RE, TAP_NOT_OK_RE as DENO_TAP_NOT_OK_RE } from "../src/extractors/deno.js";
import shellcheck, { CARET as SHELLCHECK_CARET, HEADER as SHELLCHECK_HEADER } from "../src/extractors/shellcheck.js";
import { ANNOTATION_RE as UTIL_ANNOTATION_RE, TRAILING_SPACE as UTIL_TRAILING_SPACE, xmlAttributes, xmlText } from "../src/util.js";
import gojson, { isEvent } from "../src/extractors/gojson.js";
import jvm, { CHEVRON as JVM_CHEVRON, gradleTestLine, MAVEN_RE as JVM_MAVEN_RE } from "../src/extractors/jvm.js";
import less, { headLine as lessHead } from "../src/extractors/less.js";
import php, { fatalLine, parseLine, uncaughtLine } from "../src/extractors/php.js";
import dotnettest, { atLine, VSTEST_ANY_RESULT_RE as DOTNETTEST_VSTEST_ANY_RESULT_RE, VSTEST_LABEL_RE as DOTNETTEST_VSTEST_LABEL_RE, VSTEST_RESULT_RE as DOTNETTEST_VSTEST_RESULT_RE } from "../src/extractors/dotnettest.js";
import clang, { CODE_RE, VI_RE } from "../src/extractors/clang.js";
import dotnet, { DIAGNOSTIC_RE, PROJECT_RE, PROJECT_SUFFIX as DOTNET_PROJECT_SUFFIX } from "../src/extractors/dotnet.js";
import { CANNOT_RE, REFORMAT_RE } from "../src/extractors/black.js";
import { BOXED_BODY, CAUSE as COMPOSER_CAUSE } from "../src/extractors/composer.js";
import { AT_VERSION_RE as GOMOD_AT_VERSION_RE, PARSE_LINE_RE as GOMOD_PARSE_LINE_RE, REASON_RE } from "../src/extractors/gomod.js";
import { AGENT_DETAIL_RE, DRAWN_HEAD_RE as OXLINT_DRAWN_HEAD_RE, HELP_RE, STYLISH_FILE_RE, STYLISH_ROW_RE as OXLINT_STYLISH_ROW_RE, UNIX_DETAIL_RE as OXLINT_UNIX_DETAIL_RE } from "../src/extractors/oxlint.js";
import { INTERNAL_LOCATION as PHPUNIT_INTERNAL_LOCATION, LOCATION_RE, TESTDOX_GROUP, TESTDOX_TEST as PHPUNIT_TESTDOX_TEST } from "../src/extractors/phpunit.js";
import { PO_INVALID as PYRESOLVE_PO_INVALID, UV_CAUSE, UV_ERROR, UV_MORE } from "../src/extractors/pyresolve.js";
import { BANNER_RE as PYTEST_BANNER_RE, ONE_LINE_RE, SUMMARY_ENTRY_RE as PYTEST_SUMMARY_ENTRY_RE, TALLY_RE as PYTEST_TALLY_RE, TRAILING_RE as PYTEST_TRAILING_RE } from "../src/extractors/pytest.js";
import { COMPACT_RE as STYLELINT_COMPACT_RE, FILE_RE as STYLELINT_FILE, PROBLEM_RE as STYLELINT_PROBLEM_RE, TAP_FILE_RE as STYLELINT_TAP_FILE_RE, TRAILING_RULE_RE } from "../src/extractors/stylelint.js";
import { FILE as YAMLLINT_FILE, IN_ANNOTATION as YAMLLINT_IN_ANNOTATION, PARSABLE as YAMLLINT_PARSABLE, TTY as YAMLLINT_TTY } from "../src/extractors/yamllint.js";
import { GUTTER_RE as DENO_GUTTER } from "../src/extractors/denorun.js";
import { ANNOTATION } from "../src/extractors/generic.js";
import { GROUP_RE, GUTTER_RE as SWIFT_GUTTER } from "../src/extractors/swift.js";
import { GUTTER_RE as WEBPACK_GUTTER, HEAD_RE as WEBPACK_HEAD_RE } from "../src/extractors/webpack.js";
import { CHEVRON as VITEST_CHEVRON, FAIL_RE as VITEST_FAIL_RE, LOC_RE as VITEST_LOC_RE, REPORT_WRITTEN as VITEST_REPORT_WRITTEN, SEP_RE, SUITE_RE as VITEST_SUITE_RE, TAP_RESULT_RE as VITEST_TAP_RESULT_RE, TEST_FILES_ANYWHERE as VITEST_TEST_FILES_ANYWHERE, TEST_FILES_LINE as VITEST_TEST_FILES_LINE, TESTS_LINE as VITEST_TESTS_LINE, TIME_SUFFIX as VITEST_TIME_SUFFIX } from "../src/extractors/vitest.js";
import { FRAME_RE as AVA_FRAME_RE, ROLL_RE as AVA_ROLL_RE, THROWN_IN_TEST as AVA_THROWN_IN_TEST, WHERE_RE as AVA_WHERE } from "../src/extractors/ava.js";
import { MARKDOWN_ROW as RUBOCOP_MARKDOWN_ROW, OFFENSE as RUBOCOP_OFFENSE, SIMPLE_ROW as RUBOCOP_SIMPLE_ROW, WHERE as RUBOCOP_WHERE } from "../src/extractors/rubocop.js";
import { ADVICE_RE } from "../src/extractors/kubectl.js";
import { CONTEXT_RE, VIOLATION_RE as MARKDOWNLINT_VIOLATION_RE } from "../src/extractors/markdownlint.js";
import { LOAD_RE as MOCHA_LOAD_RE, TRAILING_PATH } from "../src/extractors/mocha.js";
import { INC_LIST } from "../src/extractors/perl.js";
import { FRAME_RE as PHP_FRAME_RE, INCLUDE_PATH, THROWN_RE as PHP_THROWN_RE } from "../src/extractors/php.js";
import pip, { INVALID_REQUIREMENT as PIP_INVALID_REQUIREMENT, VERSION_LIST } from "../src/extractors/pip.js";
import { AT_RE as TAPTEXT_AT_RE, DIRECTIVE_RE, GOT_RE as TAPTEXT_GOT_RE, NOT_OK_RE as TAPTEXT_NOT_OK_RE, WANTED_RE as TAPTEXT_WANTED_RE } from "../src/extractors/taptext.js";
import cargo, { ARROW_RE as CARGO_ARROW_RE, panicLine, RAN_TESTS as CARGO_RAN_TESTS, SHORT_RE as CARGO_SHORT_RE, TEST_RESULT as CARGO_TEST_RESULT, WARNING_RE as CARGO_WARNING_RE } from "../src/extractors/cargo.js";
import eslintjson from "../src/extractors/eslintjson.js";
import git from "../src/extractors/git.js";
import playwright, { HEAD_RE as PLAYWRIGHT_HEAD_RE, JUNIT_HEAD_RE as PLAYWRIGHT_JUNIT_HEAD_RE } from "../src/extractors/playwright.js";
import { collapseRepeats } from "../src/util.js";
import { githubOutput } from "../src/github.js";
import ruby, { frameLine } from "../src/extractors/ruby.js";
import minitest from "../src/extractors/minitest.js";
import cmake, { FLAT_RE as CMAKE_FLAT_RE, headLine as cmakeHead } from "../src/extractors/cmake.js";
import mypy, { diagnosticLine } from "../src/extractors/mypy.js";
import perl, { bracketed } from "../src/extractors/perl.js";
import { HEAD_RE as BABEL_HEAD_RE } from "../src/extractors/babel.js";
import { FINDING_RE as PYLINT_FINDING_RE, MSVS_RE as PYLINT_MSVS_RE, PARSEABLE_RE as PYLINT_PARSEABLE_RE } from "../src/extractors/pylint.js";
import { DETAIL_RE as FLAKE8_DETAIL_RE, PYLINT_DETAIL_RE as FLAKE8_PYLINT_DETAIL_RE } from "../src/extractors/flake8.js";
import { AT_LINE as MAKE_AT_LINE, SELF as MAKE_SELF } from "../src/extractors/make.js";
import { ERROR_RE as PRETTIER_ERROR_RE, FILE_RE as PRETTIER_FILE_RE, FRAME_RE as PRETTIER_FRAME_RE } from "../src/extractors/prettier.js";
import { HEAD_RE as BIOME_HEAD_RE, MESSAGE_RE as BIOME_MESSAGE_RE, SUMMARY_ITEM as BIOME_SUMMARY_ITEM } from "../src/extractors/biome.js";
import { NEW_RE as TERRAFORMFMT_NEW_RE, OLD_RE as TERRAFORMFMT_OLD_RE } from "../src/extractors/terraformfmt.js";
import { PNPM_LINE as PKGMANAGER_PNPM_LINE, YARN_LINE as PKGMANAGER_YARN_LINE } from "../src/extractors/pkgmanager.js";
import { WHERE_RE as SASS_WHERE_RE } from "../src/extractors/sass.js";
import { PARSE_RE as ESLINT_PARSE_RE, PROB_RE as ESLINT_PROB_RE } from "../src/extractors/eslint.js";
import { AT_RE as DENOLINT_AT_RE, COMPACT_RE as DENOLINT_COMPACT_RE, FMT_FILE_RE as DENOLINT_FMT_FILE_RE, HEAD_RE as DENOLINT_HEAD_RE, HINT_RE as DENOLINT_HINT_RE } from "../src/extractors/denolint.js";
import { MESSAGE_RE as SWC_MESSAGE_RE } from "../src/extractors/swc.js";
import { DIFF_VALUE_RE as TAP_DIFF_VALUE_RE, NOT_OK_RE as TAP_NOT_OK_RE } from "../src/extractors/tap.js";
import { BUILDKIT_STEP as NORMALIZE_BUILDKIT_STEP } from "../src/normalize.js";
import { MISSING_OPERAND as CLUSTER_MISSING_OPERAND } from "../src/cluster.js";
import { BEFORE_CALL as LOCATION_BEFORE_CALL } from "../src/location.js";

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
const agrees = (name, expected, replacement, near, tries = 20000) => {
  const shown = (m) => (m ? JSON.stringify([...m]) : "null");
  const wrong = [];
  let matched = 0;
  for (let k = 0; k < tries && wrong.length < 3; k++) {
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
const splitting = (pattern) => (text) => text.split(pattern);
const replacing = (pattern) => (text) => [text.replace(pattern, "")];
const everyMatch = (pattern) => (text) => {
  const all = [...text.matchAll(pattern)];
  return all.length ? all.map((m) => JSON.stringify([...m, m.index])) : null;
};

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
  // Each window kept from the middle brings a marker, and the markers came out of the
  // budget: when they outgrew the tail, the middle was shed one line at a time, composing
  // the whole text again after each - seventy thousand windows took hours. Nearby gaps now
  // share a marker, and the text is composed once.
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

test("a capture of output that arrives a line at a time", () => {
  // The tail sheds its oldest chunks as new ones arrive, and shifting each one off the
  // front of an array moved every chunk the tail held: twelve megabytes written a line at
  // a time took four seconds past the default cap.
  const line = Buffer.from("info: compiled module 0000042\n");
  const capture = (maxBytes) => {
    const c = createCapture(maxBytes);
    for (let sent = 0; sent < 2 * maxBytes; sent += line.length) c.push(line);
    return c.finish();
  };
  linearStep(capture, (n) => n, 1048577);
});

test("a capture of output with no line end, arriving a few bytes at a time", () => {
  // A line longer than the scan is skipped to its end, and the scan kept its last 64KiB
  // to find that end - copying them again for every chunk that arrived. Each chunk of such
  // a line costs no more than a chunk of ordinary lines does.
  const pieces = (text) => {
    const buf = Buffer.from(text), out = [];
    for (let at = 0; at < buf.length; at += 64) out.push(buf.subarray(at, at + 64));
    return out;
  };
  const time = (chunks) => {
    const at = performance.now();
    const c = createCapture(10 * 1024 * 1024);
    for (const chunk of chunks) c.push(chunk);
    c.finish();
    return performance.now() - at;
  };
  const best = (chunks) => Math.min(time(chunks), time(chunks), time(chunks));
  const unbroken = best(pieces("x".repeat(4 * 1024 * 1024)));
  const lines = best(pieces("info: compiled module 0000042\n".repeat(4 * 1024 * 1024 / 30)));
  assert.ok(unbroken < lines * 2,
    `${ms(unbroken)}ms for 4MiB with no line end, ${ms(lines)}ms for 4MiB of lines - x${(unbroken / lines).toFixed(1)}`);
});

test("a capture of thousands of lines that look like diagnostics holds what it keeps", () => {
  // Every line that looked like a diagnostic was copied as it arrived, with a record, an array
  // slot and an index entry around it, and charged only its own bytes: 2.5MiB of five-byte FAIL
  // lines held 96MiB for output that came back whole under the 10MiB cap, and 101MiB past it.
  // Output is now read only once it leaves the tail, and a line it saves is stored once, in one
  // buffer. What a capture holds is measured in a process of its own, collected before and after.
  const held = (more) => {
    const r = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
      const { createCapture } = await import(${JSON.stringify(new URL("../src/capture.js", import.meta.url).href)});
      const MiB = 1024 * 1024, line = "ordinary build output line\\n";
      const parts = [Buffer.alloc(2.5 * MiB, line), Buffer.alloc(2.5 * MiB, "FAIL\\n"), Buffer.alloc(${more} * MiB, line)];
      const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
      gc(); gc();
      const before = used();
      const c = createCapture(10 * MiB);
      for (const part of parts) for (let at = 0; at < part.length; at += 65536) c.push(Buffer.from(part.subarray(at, at + 65536)));
      gc(); gc();
      console.log((used() - before) / MiB);`], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return Number(r.stdout);
  };
  const under = held(0), over = held(20);
  assert.ok(under < 6, `5MiB of output under a 10MiB cap held ${under.toFixed(1)}MiB`);
  assert.ok(over < 15, `25MiB of output past a 10MiB cap held ${over.toFixed(1)}MiB`);
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

// A part of a pattern that can stop inside a stretch of whitespace, or a pattern that can start
// inside one, read the rest of the stretch again from each place: 16,000 spaces took up to two
// thirds of a second for one pattern to refuse, and 32,000 four times as long. Each is now held
// to where the stretch starts, which is the only place it ever matched from - or, where a part
// may start with a space, to the one place more that it matched from too.
const PINNED = [
  ["clang vi", /^(.+?)[^\S\n]+\+(\d+):(\d+):[^\S\n]+(error|fatal error|warning|note):[^\S\n]+(.+)$/, VI_RE,
    () => gap() + pick(["a.c", "a b.c", "x", "+1"]) + gap() + pick(["+", "++"]) + pick(["2", "12", "x"]) + ":" + pick(["19", ""]) + ":" + gap() +
      pick(["error", "fatal error", "warning", "note"]) + ":" + gap() + pick(["msg", "", " ", "a +1:2: error: b"]) + gap()],
  ["clang warning flag", /[^\S\n]+\[(-W[\w-]+)\]$/, CODE_RE, () => pick(["unused variable", "", " ", "x [y]"]) + gap() + pick(["[-Wunused]", "[-W]", "[-Wa-b]", "[W]", "[-Wx] y"]) + gap()],
  ["dotnet diagnostic", /^[^\S\n]*(.+?\.(?:cs|fs|vb))\((\d+),(\d+)\):[^\S\n]+(error|warning)[^\S\n]+([A-Z][A-Z0-9]*):[^\S\n]+(.+)$/m, DIAGNOSTIC_RE,
    () => gap() + pick(["Program", "a b", "", ".", "x.cs"]) + pick([".cs", ".fs", ".vb"]) + pick(["(", "(("]) + pick(["1", "x"]) + "," + pick(["2", "2", ""]) + "):" + gap() +
      pick(["error", "warning"]) + gap() + pick(["CS0103", "FS1", "cs1"]) + ":" + gap() + pick(["msg", "", " ", "a.cs(1,2): error CS1: b"]) + gap()],
  ["dotnet project", /^[^\S\n]*(\S.*?)[^\S\n]+:[^\S\n]+(error|warning)[^\S\n]+((?:MSB|NU|NETSDK)\d+):[^\S\n]+(.+)$/, PROJECT_RE,
    () => gap() + pick(["app.csproj", "MSBUILD", "a b", "", "x : y"]) + gap() + pick([":", "::", ""]) + gap() + pick(["error", "warning", "x"]) + gap() +
      pick(["NU1101", "MSB1003", "NETSDK1", "CS1"]) + ":" + gap() + pick(["msg", "", " ", "a : error NU1: b"]) + gap()],
  ["black reformat", /^would reformat[^\S\n]+(\S.*?)[^\S\n]*$/, REFORMAT_RE, () => "would reformat" + gap() + words() + gap() + words() + gap()],
  ["black cannot format", /^error:[^\S\n]*cannot format[^\S\n]+(\S+?):[^\S\n]*(.+?)[^\S\n]*$/, CANNOT_RE,
    () => "error:" + gap() + "cannot format" + gap() + pick(["a.py", "a:b.py", "", "x"]) + ":" + gap() + words() + gap() + words() + gap()],
  ["composer box", /^[^\S\n]{2}(\S.*?)[^\S\n]*$/, BOXED_BODY, () => gap() + gap() + words() + gap() + words() + gap()],
  ["go mod reason", /^[^\S\n]+(\S+?):[^\S\n]*(\S.*?)[^\S\n]*$/, REASON_RE, () => gap() + pick(["example.com/a", "a:b", "", "x"]) + ":" + gap() + words() + gap() + words() + gap()],
  ["oxlint stylish file", /^(\S.*?)[^\S\n]*$/, STYLISH_FILE_RE, () => gap() + words() + gap() + words() + gap()],
  ["oxlint agent detail", /^[^\S\n]+(error|warning)[^\S\n]+(?:([\w-]+)\()?([\w-]+)\)?:[^\S\n]*(.+?)[^\S\n]*$/, AGENT_DETAIL_RE,
    () => gap() + pick(["error", "warning", "x"]) + gap() + pick(["eslint(no-x)", "no-x", "a(b", "b)"]) + ":" + gap() + words() + gap() + words() + gap()],
  ["oxlint help", /[^\S\n]*\bhelp:[^\S\n].*$/, HELP_RE, () => words() + gap() + pick(["help: x", "help:", "xhelp: y", "help:\u2028"]) + gap() + words()],
  ["phpunit testdox", /^(\S.*?)[^\S\n]*$/, TESTDOX_GROUP, () => gap() + words() + gap() + words() + gap()],
  ["phpunit location", /^[^\S\n]*(.+?):(\d+)$/, LOCATION_RE, () => gap() + pick(["/a/b.php", "", ":", "a:1", " "]) + gap() + pick([":12", ":", ":x", "12"]) + pick(["", ":3"])],
  ["uv error", /^error:[^\S\n]+(\S.*?)[^\S\n]*$/, UV_ERROR, () => "error:" + gap() + words() + gap() + words() + gap()],
  ["uv cause", /^[^\S\n]{2}cause:[^\S\n]+(\S.*?)[^\S\n]*$/, UV_CAUSE, () => pick(["  ", " \t", "\t "]) + "cause:" + gap() + words() + gap() + words() + gap()],
  ["uv wrapped cause", /^[^\S\n]{4,}(\S.*?)[^\S\n]*$/, UV_MORE, () => gap() + gap() + gap() + words() + gap() + words() + gap()],
  ["pytest one line", /^(.+?):(\d+):[^\S\n]+(\S.*?)[^\S\n]*$/, ONE_LINE_RE, () => pick(["a.py", "a b.py", "", "x:1"]) + ":" + pick(["12", "x", ""]) + ":" + gap() + words() + gap() + words() + gap()],
  ["stylelint file", /^(?![^\S\n])(\S.*?)[^\S\n]*$/, STYLELINT_FILE, () => gap() + words() + gap() + words() + gap()],
  ["stylelint rule", /[^\S\n]*\([\w-]+(?:\/[\w-]+)?\)[^\S\n]*$/, TRAILING_RULE_RE, () => words() + gap() + pick(["(rule)", "(a/b)", "()", "(a b)"]) + gap() + pick(["", "x"])],
  ["yamllint file", /^(\S.*?)[^\S\n]*$/, YAMLLINT_FILE, () => gap() + words() + gap() + words() + gap()],
  ["deno gutter", /^[^\S\n]*\d*[^\S\n]*\|/, DENO_GUTTER, () => gap() + pick(["", "12", "1 2"]) + gap() + pick(["|", "", "x|"]) + words()],
  ["generic annotation", /^[^\S\n]*\d*[^\S\n]*\|/, ANNOTATION, () => gap() + pick(["", "12", "1 2"]) + gap() + pick(["|", "", "x|"]) + words()],
  ["swift gutter", /^[^\S\n]*\d*[^\S\n]*\|/, SWIFT_GUTTER, () => gap() + pick(["", "12", "1 2"]) + gap() + pick(["|", "", "x|"]) + words()],
  ["swift group", /[^\S\n]+\[#([\w-]+)\]$/, GROUP_RE, () => words() + gap() + pick(["[#Group]", "[#a-b]", "[#]", "[#x] y"]) + pick(["", " "])],
  ["webpack gutter", /^[^\S\n]*\d*[^\S\n]*\|/, WEBPACK_GUTTER, () => gap() + pick(["", "12", "1 2"]) + gap() + pick(["|", "", "x|"]) + words()],
  ["vitest separator", /^[\u23af\u2500-\u257f\s]*(?:\[\d+\/\d+\])?[\u23af\u2500-\u257f\s]*$/, SEP_RE,
    () => pick(["\u23af\u23af", "\u2500", "", " "]) + gap() + pick(["[1/2]", "", "[x/2]", "[1/2"]) + gap() + pick(["\u23af", "", "x"])],
  ["ava location", /^[^\S\n]*(.+?\.\w+):(\d+)[^\S\n]*$/, AVA_WHERE, () => gap() + pick(["test.js", "", ".js", "a b.js", "a.b.c"]) + pick([":12", ":", ":x", ""]) + gap()],
  ["rubocop location", /^[^\S\n]*(.+):(\d+):(\d+)[^\S\n]*$/, RUBOCOP_WHERE, () => gap() + pick(["app.rb", "", ":", "a:1"]) + pick([":1:2", ":1", ":x:2", ""]) + gap()],
  ["kubectl advice", /;[^\S\n]*if you choose to ignore these errors.*$|[^\S\n]*-[^\S\n]did you specify the right host or port\?$/, ADVICE_RE,
    () => words() + gap() + pick(["; if you choose to ignore these errors, x", "- did you specify the right host or port?", "-  did you specify the right host or port?", ""]) + pick(["", " "])],
  ["markdownlint context", /[^\S\n]*\[Context:[^\]]*\][^\S\n]*$/, CONTEXT_RE, () => words() + gap() + pick(["[Context: \"x\"]", "[Context:]", "[Context: a] b", ""]) + gap()],
  ["mocha trailing path", /[^\S\n]*\((?:\/|[A-Za-z]:\\)[^)]*\)[^\S\n]*$/, TRAILING_PATH, () => words() + gap() + pick(["(/a/b.js:1:2)", "(C:\\a.js)", "(x)", "(/a"]) + gap()],
  ["perl @INC", /[^\S\n]*\(@INC (?:contains|entries checked):[^)]*\)/, INC_LIST, () => words() + gap() + pick(["(@INC contains: /a /b)", "(@INC entries checked: x)", "(@INC x)", ""]) + gap() + words()],
  ["php include path", /[^\S\n]*\(include_path='[^']*'\)/, INCLUDE_PATH, () => words() + gap() + pick(["(include_path='.:/usr')", "(include_path='')", "(include_path=x)", ""]) + gap() + words()],
  ["pip versions", /[^\S\n]*\(from versions:[^)]*\)/, VERSION_LIST, () => words() + gap() + pick(["(from versions: 1.0, 2.0)", "(from versions: none)", "(from x)", ""]) + gap() + words()],
  ["tap directive", /[^\S\n]*#[^\S\n]*(?:time=|SKIP\b|TODO\b).*$/i, DIRECTIVE_RE, () => words() + gap() + pick(["# time=1ms", "# SKIP", "#todo x", "# x", "#"]) + gap() + words()],
];
const words = () => pick(["msg", "", " ", "a b", "x  y", "'q'", "a:1", "\u00a0", "\u00e9"]);

test("each pattern pinned to where whitespace starts matches what it matched", () => {
  for (const [name, was, now, near] of PINNED) agrees(name, matching(was), matching(now), near);
});

test("lines with long stretches of whitespace, read by each pinned pattern", () => {
  // The lines each pattern found slowest - a stretch inside, at the start, at the end, or
  // the whole line - fifty of them a read, so that a read is long enough to time.
  const shapes = (n) => {
    const s = " ".repeat(n);
    return ["x" + s + "y", s, s + "y", "x" + s + "[y", "  x" + s + "[y", "  x" + s + "y", "x" + s.slice(n / 2) + "y" + s.slice(n / 2),
      "error: x" + s + "y", "  error r: x" + s + "y", "would reformat x" + s + "y", "error: cannot format a: x" + s + "y", "  cause: x" + s + "y",
      "    x" + s + "y", "a:1:2: x" + s + "y", "- x" + s + "y", "FAIL x" + s + "y"];
  };
  const slow = [];
  for (const [name, , pattern] of PINNED) {
    const once = (n) => {
      const lines = shapes(n);
      let best = Infinity;
      const at = performance.now();
      do {
        const start = performance.now();
        for (let k = 0; k < 50; k++) for (const line of lines) pattern.test(line);
        best = Math.min(best, performance.now() - start);
      } while (performance.now() - at < FLOOR_MS);
      return best;
    };
    const small = once(2000);
    let large = once(8000);
    if (large >= small * 8) large = Math.min(large, once(8000), once(8000));
    if (large >= small * 8) slow.push(`${name}: ${ms(small)}ms for the lines, ${ms(large)}ms for lines four times as long - x${(large / small).toFixed(1)}`);
  }
  assert.deepEqual(slow, []);
});

// The rest are held the same way, and each comes with lines of its own shape. What is compared is
// those lines changed at random - whitespace put into them or in place of some of them, pieces
// taken out, repeated, cut off or borrowed from another of the lines - and what is timed is the
// same lines with a long stretch of spaces put where their whitespace starts, at their end, and
// before them. Two are only ever asked whether a line matches, and are compared that way.
const SHAPED = [
  ["deno HEADER_RE", /^(\S.*?)[^\S\n]+=>[^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, DENO_HEADER_RE,
    ["adds numbers => ./math_test.ts:3:6", "a b  =>  file:///x/a.ts:10:2  "]],
  ["oxlint STYLISH_ROW_RE", /^[^\S\n]+(\d+):(\d+)[^\S\n]+(error|warning)[^\S\n]+(.+?)[^\S\n]{2,}([\w-]+)\(([\w/-]+)\)[^\S\n]*$/, OXLINT_STYLISH_ROW_RE,
    ["  3:14  error  Expected a conditional expression  eslint(no-cond-assign)"]],
  ["oxlint DRAWN_HEAD_RE", /^[^\S\n]*(x|!|\u00d7|\u26a0)[^\S\n]+(?:([\w-]+)\(([\w/-]+)\):[^\S\n]+)?(\S.*?)[^\S\n]*$/, OXLINT_DRAWN_HEAD_RE,
    ["  x eslint(no-cond-assign): Expected a conditional", "\u00d7 eslint(no-debugger): `debugger` statement  ", "! msg"]],
  ["babel HEAD_RE", /^(\w*(?:Error|Exception)):[^\S\n]*(\S[^:]*?):[^\S\n]*(.+?)[^\S\n]*\((\d+):(\d+)\)[^\S\n]*$/, BABEL_HEAD_RE,
    ["SyntaxError: /app/src/a.js: Unexpected token (3:14)", "SyntaxError: a.js:   Missing semicolon.   (1:2)  "]],
  ["rubocop OFFENSE", /^(#[^\S\n])?(.+?):(\d+):(\d+):[^\S\n]+([CWEFRI]):[^\S\n]+(?:\[[^\]]*\][^\S\n]+)?([A-Z]\w*\/[A-Z]\w*):[^\S\n]+(.+?)[^\S\n]*$/, RUBOCOP_OFFENSE,
    ["app/a.rb:3:5: C: Style/StringLiterals: Prefer single-quoted strings.", "# a.rb:1:1: W: [Correctable] Lint/X: msg  "]],
  ["rubocop SIMPLE_ROW", /^([CWEFRI]):[^\S\n]*(\d+):[^\S\n]*(\d+):[^\S\n]+(?:\[[^\]]*\][^\S\n]+)?([A-Z]\w*\/[A-Z]\w*):[^\S\n]+(.+?)[^\S\n]*$/, RUBOCOP_SIMPLE_ROW,
    ["C:  3:  5: Style/StringLiterals: Prefer single-quoted strings.", "W:1:1: [Correctable] Lint/X: msg  "]],
  ["rubocop MARKDOWN_ROW", /^[^\S\n]*\*[^\S\n]+\*\*Line # (\d+) - (\w+):\*\*[^\S\n]+([A-Z]\w*\/[A-Z]\w*):[^\S\n]+(.+?)[^\S\n]*$/, RUBOCOP_MARKDOWN_ROW,
    ["* **Line # 3 - convention:** Style/StringLiterals: Prefer single-quoted strings."]],
  ["docker FINAL_ERROR", /^ERROR:[^\S\n]+(?:failed to build:[^\S\n]+)?failed to solve:[^\S\n]+(.+?)[^\S\n]*$/, DOCKER_FINAL_ERROR,
    ["ERROR: failed to solve: process \"/bin/sh -c make\" did not complete successfully: exit code: 2", "ERROR: failed to build: failed to solve: x  "]],
  ["pylint FINDING_RE", /^(.+?):(\d+):(\d+):[^\S\n]+([CRWEF]\d{4}):[^\S\n]+(.+?)(?:[^\S\n]+\(([\w-]+)\))?[^\S\n]*$/, PYLINT_FINDING_RE,
    ["a.py:3:0: C0114: Missing module docstring (missing-module-docstring)", "a.py:1:2: E0401: Unable to import 'x'  "]],
  ["pylint PARSEABLE_RE", /^(.+?):(\d+):[^\S\n]+\[([CRWEF]\d{4})\(([\w-]+)\)[^\]]*\][^\S\n]+(.+?)[^\S\n]*$/, PYLINT_PARSEABLE_RE,
    ["a.py:3: [C0114(missing-module-docstring), ] Missing module docstring", "a.py:3: [E0401(import-error), f] Unable  "]],
  ["pylint MSVS_RE", /^(.+?)\((\d+)\):[^\S\n]+\[([CRWEF]\d{4})\(([\w-]+)\)[^\]]*\][^\S\n]+(.+?)[^\S\n]*$/, PYLINT_MSVS_RE,
    ["a.py(3): [C0114(missing-module-docstring), ] Missing module docstring"]],
  ["flake8 DETAIL_RE", /^[^\S\n]+([A-Z]{1,4}\d{3,4})[^\S\n]+(.+?)[^\S\n]*$/, FLAKE8_DETAIL_RE,
    ["    E501 line too long (88 > 79 characters)", "  W291  trailing whitespace  "]],
  ["flake8 PYLINT_DETAIL_RE", /^[^\S\n]+\[([A-Z]{1,4}\d{3,4})\][^\S\n]+(.+?)[^\S\n]*$/, FLAKE8_PYLINT_DETAIL_RE,
    ["    [E501] line too long (88 > 79 characters)"]],
  ["shellcheck CARET", /^([^\S\n]*)\^[-^]*[^\S\n]+(SC\d+)[^\S\n]+\((error|warning|info|style)\):[^\S\n]+(.+?)[^\S\n]*$/, SHELLCHECK_CARET,
    ["  ^-- SC2086 (info): Double quote to prevent globbing and word splitting.", "^---^ SC2034 (warning): foo appears unused.  "]],
  ["yamllint TTY", /^[^\S\n]+(\d+):(\d+)[^\S\n]+(error|warning)[^\S\n]+(.+?)[^\S\n]+\(([\w-]+)\)[^\S\n]*$/, YAMLLINT_TTY,
    ["  3:1       error    wrong indentation: expected 2 but found 0  (indentation)", "  1:1  warning  missing document start \"---\"  (document-start)"]],
  ["yamllint PARSABLE", /^(.+?):(\d+):(\d+):[^\S\n]+\[(error|warning)\][^\S\n]+(.+?)[^\S\n]+\(([\w-]+)\)[^\S\n]*$/, YAMLLINT_PARSABLE,
    ["a.yaml:3:1: [error] wrong indentation: expected 2 but found 0 (indentation)"]],
  ["yamllint IN_ANNOTATION", /^(\d+):(\d+)[^\S\n]+\[([\w-]+)\][^\S\n]+(.+?)[^\S\n]*$/, YAMLLINT_IN_ANNOTATION,
    ["3:1 [indentation] wrong indentation: expected 2 but found 0"]],
  ["cargo WARNING_RE", /^warning(?:\[(E\d+)\])?:[^\S\n]+(.+?)[^\S\n]*$/, CARGO_WARNING_RE,
    ["warning: unused variable: `x`", "warning[E0001]:   something  "]],
  ["cargo SHORT_RE", /^(.+?\.rs):(\d+):(\d+):[^\S\n]+(error|warning)(?:\[(E\d+)\])?:[^\S\n]*(.*?)[^\S\n]*$/, CARGO_SHORT_RE,
    ["src/main.rs:3:5: error[E0425]: cannot find value `x` in this scope", "src/a.rs:1:1: warning:   ", "src/a.rs:1:1: error:"]],
  ["make AT_LINE", /^([^\s:]+):(\d+):[^\S\n]+\*\*\*[^\S\n]+(.+?)[^\S\n]*Stop\.[^\S\n]*$/m, MAKE_AT_LINE,
    ["Makefile:3: *** missing separator.  Stop.", "x.mk:10: ***   recipe commences before first target. Stop.  "]],
  ["make SELF", /^make(?:\[\d+\])?:[^\S\n]+\*\*\*[^\S\n]+(.+?)[^\S\n]*Stop\.[^\S\n]*$/m, MAKE_SELF,
    ["make: *** No rule to make target 'x'.  Stop.", "make[2]: *** [all] Error 1 Stop."]],
  ["stylelint COMPACT_RE", /^(\S.*?):[^\S\n]+line[^\S\n]+(\d+),[^\S\n]+col[^\S\n]+(\d+),[^\S\n]+(error|warning)[^\S\n]+-[^\S\n]+(.+?)[^\S\n]*\(([\w-]+(?:\/[\w-]+)?)\)[^\S\n]*$/, STYLELINT_COMPACT_RE,
    ["/app/a.css: line 1, col 13, error - Expected \"#FFF\" to be \"#FFFFFF\" (color-hex-length)"]],
  ["stylelint PROBLEM_RE", /^[^\S\n]+(\d+):(\d+)[^\S\n]+([\u2716\u26a0\u24d8])[^\S\n]+(.+?)[^\S\n]{2,}([\w-]+(?:\/[\w-]+)?)[^\S\n]*$/, STYLELINT_PROBLEM_RE,
    ["  1:8   \u2716  Unknown property \"colr\"     property-no-unknown", "  4:6  \u26a0  Duplicate  declaration-block-no-duplicate-properties  "]],
  ["markdownlint VIOLATION_RE", /^(\S.*?):(\d+)(?::(\d+))?[^\S\n]+(?:error[^\S\n]+)?(MD\d{3})\/([\w-]+(?:\/[\w-]+)*)[^\S\n]+(.+?)[^\S\n]*$/, MARKDOWNLINT_VIOLATION_RE,
    ["README.md:3 MD022/blanks-around-headings Headings should be surrounded by blank lines", "a.md:3:1 error MD009/no-trailing-spaces Trailing spaces [Expected: 0; Actual: 1]  "]],
  ["gomod PARSE_LINE_RE", /^(\S*go\.mod):(\d+):[^\S\n]*(\S.*?)[^\S\n]*$/, GOMOD_PARSE_LINE_RE,
    ["go.mod:3: unknown directive: foo", "/a/go.mod:10:   usage: require module/path v1.2.3  "]],
  ["gomod AT_VERSION_RE", /^go:[^\S\n]+(\S+@\S+?):[^\S\n]*(\S.*?)[^\S\n]*$/, GOMOD_AT_VERSION_RE,
    ["go: example.com/x@v1.2.3: invalid version: unknown revision v1.2.3", "go: a@b:   reading  "]],
  ["prettier ERROR_RE", /^\[error\][^\S\n]+(\S.*?)[^\S\n]*$/, PRETTIER_ERROR_RE,
    ["[error] src/a.js: SyntaxError: Unexpected token (1:5)", "[error]  x  "]],
  ["rubygems CARET_NOTE", /^[^\S\n]*\|[^\S\n]*\^~*[^\S\n]*(\S.*?)[^\S\n]*$/, RUBYGEMS_CARET_NOTE,
    ["  | ^~~~~ note: here", "|^ x  "]],
  ["rubygems MISSING", /^(Could not find gem '([^'\n]+)' .+?)[^\S\n]*$/, RUBYGEMS_MISSING,
    ["Could not find gem 'rails (~> 7.0)' in locally installed gems.", "Could not find gem 'x'  in any source  "]],
  ["biome MESSAGE_RE", /^[^\S\n]*([!\u00d7\u2716\u26a0])[^\S\n]+(\S.*?)[^\S\n]*$/, BIOME_MESSAGE_RE,
    ["  \u00d7 This variable is unused.", "! msg  ", "\u2716 a"]],
  ["biome HEAD_RE", /^(.+?):(\d+):(\d+)[^\S\n]+(\S+?)(?:[^\S\n]+(?:FIXABLE|INFO|WARNING|ERROR|PARSE))*[^\S\n]*\u2501*[^\S\n]*$/, BIOME_HEAD_RE,
    ["src/a.js:3:7 lint/correctness/noUnusedVariables FIXABLE \u2501\u2501\u2501\u2501\u2501", "a.ts:1:1 parse \u2501\u2501", "a.ts:1:1 lint/x  "]],
  ["cmake FLAT_RE", /^CMake (Error|Warning):[^\S\n]+(\S.*?)[^\S\n]*$/, CMAKE_FLAT_RE,
    ["CMake Error: The source directory \"/x\" does not exist.", "CMake Warning:   y  "]],
  ["terraformfmt OLD_RE", /^---[^\S\n]+old\/(\S.*?)[^\S\n]*$/, TERRAFORMFMT_OLD_RE,
    ["--- old/main.tf", "--- old/a b.tf  "]],
  ["golangci EMBEDDED", /^(?:\.[\\/])?(\S+\.go):(\d+):(\d+):[^\S\n]+(\S.*?)[^\S\n]*$/m, GOLANGCI_EMBEDDED,
    ["a.go:3:5: undefined: x", "./b/c.go:1:2: msg  "]],
  ["golangci TAB", /^(?:\.[\\/])?(\S+?\.go):(\d+):(\d+)[^\S\n]+([\w-]+)[^\S\n]{2,}(\S.*?)[^\S\n]*$/, GOLANGCI_TAB,
    ["a.go:3:5  errcheck  Error return value is not checked", "./a.go:1:1 unused   x  "]],
  ["gotest NO_MODULE_RE", /^pattern[^\S\n]+(\S+):[^\S\n]+(\S.*?\bmain module\b.*?)[^\S\n]*$/, GOTEST_NO_MODULE_RE,
    ["pattern ./...: directory prefix . does not contain main module or its selected dependencies", "pattern x: a main module b  "]],
  ["pyresolve PO_INVALID", /^Invalid (\w+) file[^\S\n]+(\S.*?\.\w+):[^\S\n]+(\S.*?)[^\S\n]*$/, PYRESOLVE_PO_INVALID,
    ["Invalid poetry file pyproject.toml: invalid key", "Invalid lock file /a/poetry.lock:   bad  ", "Invalid TOML file /work/project: scratch/pyproject.toml: Unexpected character: 'x' at line 1 col 8"]],
  ["vitest REPORT_WRITTEN", /^([A-Z][A-Z-]*) report written to (\S.*?)[^\S\n]*$/m, VITEST_REPORT_WRITTEN,
    ["JUNIT report written to /app/junit.xml", "JSON report written to  a b  "]],
  ["vitest FAIL_RE", /^[^\S\n]*FAIL[^\S\n]+(.+?)[^\S\n]+>[^\S\n]+(.+?)[^\S\n]*$/, VITEST_FAIL_RE,
    [" FAIL  t/a.test.js > suite > adds", "FAIL a > b  "]],
  ["vitest SUITE_RE", /^[^\S\n]*FAIL[^\S\n]+(.+?)[^\S\n]+\[[^\S\n]*(.+?)[^\S\n]*\][^\S\n]*$/, VITEST_SUITE_RE,
    [" FAIL  t/crash.test.js [ t/crash.test.js ]", "FAIL |unit| a.js [a.js]  "]],
  ["pkgmanager PNPM_LINE", /^[^\S\n]+(ERR_PNPM_[A-Z0-9_]+|E[A-Z]{3,})[^\S\n]{2,}(.+?)[^\S\n]*$/, PKGMANAGER_PNPM_LINE,
    [" ERR_PNPM_NO_MATCHING_VERSION  No matching version found for x@99", "  ENOENT  no such file  "]],
  ["nodetest ALT_FAILURE_RE", /^\u2716[^\S\n]+(.+?)(?:[^\S\n]+\([\d.]+ms\))?[^\S\n]*$/, NODETEST_ALT_FAILURE_RE,
    ["\u2716 adds numbers (1.2ms)", "\u2716 a b  ", "\u2716  "]],
  ["bun FAIL_RE", /^(?:\(fail\)[^\S\n]+(.+?)(?:[^\S\n]+\[[\d.]+m?s\])?|\u2717[^\S\n]+(.+?)[^\S\n]+\[[\d.]+m?s\])[^\S\n]*$/, BUN_FAIL_RE,
    ["(fail) suite > name [3.10ms]", "\u2717 adds [1ms]", "(fail) x  "]],
  ["bun FAIL_ANY", /^(?:\(fail\)[^\S\n]+|\u2717[^\S\n]+.+?[^\S\n]+\[[\d.]+m?s\][^\S\n]*$)/m, BUN_FAIL_ANY,
    ["(fail) suite > name [3.10ms]", "\u2717 adds [1ms]"], testing],
  ["playwright HEAD_RE", /^[^\S\n]*(\d+)\)[^\S\n]+(\S+?):(\d+):(\d+)[^\S\n]+\u203a[^\S\n]+(.+?)[^\S\n]*(?:[\u2500\u2014-]{3,})?[^\S\n]*$/, PLAYWRIGHT_HEAD_RE,
    ["  1) a.spec.ts:3:5 \u203a adds \u2500\u2500\u2500\u2500\u2500\u2500", "  2) [chromium] \u203a a.spec.ts:3:5 \u203a x", "1) a.ts:1:1 \u203a t  "]],
  ["playwright JUNIT_HEAD_RE", /^[^\S\n]*()(\S+?):(\d+):(\d+)[^\S\n]+\u203a[^\S\n]+(.+?)[^\S\n]*[\u2500\u2014-]{3,}[^\S\n]*$/, PLAYWRIGHT_JUNIT_HEAD_RE,
    ["  a.spec.ts:3:5 \u203a adds \u2500\u2500\u2500\u2500\u2500"]],
  ["sass WHERE_RE", /^[^\S\n]+(\S.*?)[^\S\n]+(\d+):(\d+)[^\S\n]*(?:[^\S\n]{2,}(.*))?$/, SASS_WHERE_RE,
    ["    src/a.scss 3:5  root stylesheet", "  a b.scss 1:1"]],
  ["eslint PROB_RE", /^[^\S\n]+(\d+):(\d+)[^\S\n]+(error|warning)[^\S\n]+(.+?)\s{2,}([\w@/-]+)[^\S\n]*$/, ESLINT_PROB_RE,
    ["  3:14  error  'x' is defined but never used  no-unused-vars", "  1:1  warning  msg  @x/y"]],
  ["denolint COMPACT_RE", /^(.+?):[^\S\n]+line[^\S\n]+(\d+),[^\S\n]+col[^\S\n]+(\d+)[^\S\n]+-[^\S\n]+(.+?)[^\S\n]+\(([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\)[^\S\n]*$/, DENOLINT_COMPACT_RE,
    ["/app/a.ts: line 3, col 7 - `x` is never used (no-unused-vars)"]],
  ["cargo TEST_RESULT", /^test result: \w+\.[^\S\n]*(.+?)[^\S\n]*$/m, CARGO_TEST_RESULT,
    ["test result: FAILED. 1 passed; 1 failed; 0 ignored", "test result: ok.   "]],
  ["pip INVALID_REQUIREMENT", /^ERROR: Invalid requirement: '([^']*)': (.+?)(?:[^\S\n]*\(from line (\d+) of (.+?)\))?[^\S\n]*$/, PIP_INVALID_REQUIREMENT,
    ["ERROR: Invalid requirement: 'requests==': Expected end or semicolon", "ERROR: Invalid requirement: 'x':  (from line 3 of r.txt)", "ERROR: Invalid requirement: 'x': y (from line 1 of a b.txt)  "]],
  ["ava FRAME_RE", /^[^\S\n]*\u203a[^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, AVA_FRAME_RE,
    ["  \u203a file:///abs/av/sum.test.js:3:38", "\u203a a b.js:1:2  ", "  \u203a  :1:2", "\u203a x :1:2"]],
  ["biome SUMMARY_ITEM", /^[^\S\n]*-[^\S\n]+(\S.*?)(?:[^\S\n]+\(([^)]*)\))?[^\S\n]*$/, BIOME_SUMMARY_ITEM,
    ["  - src/checkout.js (1 error)", "- a b.js", "  -  x  (y)  ", "- a (b) (c)"]],
  ["rubygems FROM", /^[^\S\n]*#[^\S\n]+from[^\S\n]+(.+?):(\d+)[^\S\n]*$/, RUBYGEMS_FROM,
    [" #  from /home/dev/shop/Gemfile:4", "# from a b:1  ", "# from  :2"]],
  ["cargo ARROW_RE", /^[^\S\n]*-->[^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, CARGO_ARROW_RE,
    [" --> src/main.rs:3:5", "-->  a b.rs:1:2  ", "--> x :1:2"]],
  ["cargo RAN_TESTS", /^test result:|^----[^\S\n]+\S.*[^\S\n]+stdout[^\S\n]+----/m, CARGO_RAN_TESTS,
    ["test result: ok", "---- tests::a stdout ----", "---- a b  stdout ----", "----  x stdout  ----"]],
  ["ruff ARROW_RE", /^[^\S\n]*-->[^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, RUFF_ARROW_RE,
    [" --> src/main.py:3:5", "-->  a b.py:1:2  "]],
  ["denolint AT_RE", /^[^\S\n]*-->[^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, DENOLINT_AT_RE,
    ["  --> /app/a.ts:3:7", "-->  :1:2"]],
  ["denolint HEAD_RE", /^error\[([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]:[^\S\n]+(.+?)[^\S\n]*$/, DENOLINT_HEAD_RE,
    ["error[no-unused-vars]: `x` is never used", "error[a-b]:  msg  ", "error[x]:   "]],
  ["denolint HINT_RE", /^[^\S\n]*=[^\S\n]*hint:[^\S\n]*(.+?)[^\S\n]*$/, DENOLINT_HINT_RE,
    ["  = hint: Use a specific type other than `any`", "=hint:x  ", "= hint:   "]],
  ["denolint FMT_FILE_RE", /^from[^\S\n]+(.+?):[^\S\n]*$/, DENOLINT_FMT_FILE_RE,
    ["from /app/a.ts:", "from a b.ts:  ", "from  :"]],
  ["composer CAUSE", /^[^\S\n]{4}-[^\S\n]+(\S.*?)[^\S\n]*$/, COMPOSER_CAUSE,
    ["    - Root composer.json requires php ^5.3 but your php version (8.5.10) does not satisfy that requirement.", "    -  x  "]],
  ["mocha LOAD_RE", /^[^\S\n]*Exception during run:[^\S\n]*(.+?):(\d+)[^\S\n]*$/m, MOCHA_LOAD_RE,
    [" Exception during run: /home/dev/app/test/syn.test.js:2", "Exception during run:a b:1  ", "Exception during run:  :3"]],
  ["deno TAP_NOT_OK_RE", /^[^\S\n]*not ok[^\S\n]+\d+[^\S\n]*-?[^\S\n]*(.*?)[^\S\n]*$/, DENO_TAP_NOT_OK_RE,
    ["not ok 1 - adds", "not ok 12", "  not ok 3 -  x  ", "not ok 1-", "not ok 1 - - x"]],
  ["vitest TAP_RESULT_RE", /^[^\S\n]*(not )?ok[^\S\n]+\d+[^\S\n]*-?[^\S\n]*(.*?)[^\S\n]*$/, VITEST_TAP_RESULT_RE,
    ["ok 2 - ok", "not ok 1 - fails", "ok 3", "ok 4 -  a b  "]],
  ["docker POINTED", /^[^\S\n]*\d+[^\S\n]*\|[^\S\n]*>>>[^\S\n]?(.*?)[^\S\n]*$/, DOCKER_POINTED,
    ["   2 | >>> RUN exit 3", "1|>>>", "  3 | >>>   COPY x  ", "4 |>>>x"]],
  ["jasmine HEAD_RE", /^[^\S\n]*(\d+)\)[^\S\n]+(\S.*?)[^\S\n]*$/, JASMINE_HEAD_RE,
    ["2) invoice totals an invoice", "  1)  x  "]],
  ["jest TEST_RE", /^[^\S\n]*\u25cf(?![^\S\n]*(?:Console|Validation Warning|Deprecation Warning|Invalid testPattern))[^\S\n]+(.+?)[^\S\n]*$/, JEST_TEST_RE,
    ["  \u25cf invoice total", "\u25cf Console", "  \u25cf  x  ", "\u25cf Validation Warning:", "\u25cf  Validation Warning:", "\u25cf   "]],
  ["nodetest ALT_LOCATION_RE", /^(?:test|suite)[^\S\n]+at[^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, NODETEST_ALT_LOCATION_RE,
    ["test at crash.test.js:1:1", "suite at  a b.js:2:3  ", "test at  :1:2"]],
  ["nodetest NOT_OK_RE", /^([^\S\n]*)not ok[^\S\n]+\d+[^\S\n]+-[^\S\n]+(.+?)[^\S\n]*$/, NODETEST_NOT_OK_RE,
    ["not ok 1 - adds", "  not ok 2 -  x  ", "not ok 3 -   "]],
  ["nodetest ERROR_INLINE_RE", /^[^\S\n]*error:[^\S\n]*'?(.+?)'?[^\S\n]*$/, NODETEST_ERROR_INLINE_RE,
    ["  error: 'expected 1 to equal 2'", "error: msg", "error: ' '", "error: a '", "error:   ", "error: '", "error: '  x'  ", "error: 'it's'"]],
  ["prettier FILE_RE", /^\[warn\][^\S\n]+(\S.*?)[^\S\n]*$/, PRETTIER_FILE_RE,
    ["[warn] ugly.js", "[warn]  a b  "]],
  ["prettier FRAME_RE", /^\[error\][^\S\n]+(?:>[^\S\n]*)?\d*[^\S\n]*\|/, PRETTIER_FRAME_RE,
    ["[error]   2 |", "[error] > 1 | x", "[error]  |", "[error] >2|"]],
  ["swc MESSAGE_RE", /^[^\S\n]*[x\u00d7\u2717][^\S\n]+(\S.*?)[^\S\n]*$/, SWC_MESSAGE_RE,
    ["  x Expression expected", "\u00d7 a  ", "\u2717 b"]],
  ["tap DIFF_VALUE_RE", /^[^\S\n]*([-+])(?!--|\+\+)(\S.*?)[^\S\n]*$/, TAP_DIFF_VALUE_RE,
    ["        -1050", "+ x  ", "--- a", "+x"]],
  ["terraformfmt NEW_RE", /^\+\+\+[^\S\n]+new\/(\S.*?)[^\S\n]*$/, TERRAFORMFMT_NEW_RE,
    ["+++ new/main.tf", "+++ new/a b.tf  "]],
  ["webpack HEAD_RE", /^(ERROR|WARNING) in (.+?)(?:[^\S\n]+(\d+):(\d+)(?:-\d+)?)?[^\S\n]*$/, WEBPACK_HEAD_RE,
    ["ERROR in ./wsrc/syn.js 1:10", "ERROR in  1:2", "WARNING in a b  ", "ERROR in x 1:2-3", "ERROR in   "]],
  ["pkgmanager YARN_LINE", /^(error|warning|info)[^\S\n]+(.+?)[^\S\n]*$/, PKGMANAGER_YARN_LINE,
    ["warning package.json: No license field", "error  x  ", "info a", "error   "]],
  ["dotnettest VSTEST_RESULT_RE", /^[^\S\n]+(?:Failed|Passed|Skipped)[^\S\n]+(.+?)[^\S\n]+\[(?:<[^\S\n]+)?\d+(?:\.\d+)?[^\S\n]*(?:ms|s)\][^\S\n]*$/, DOTNETTEST_VSTEST_RESULT_RE,
    ["  Failed ArithmeticTests.Crash [< 1 ms]", "  Passed X [12 ms]", "  Skipped  a b  [1 s]"]],
  ["dotnettest VSTEST_ANY_RESULT_RE", /^[^\S\n]{2}\S[^\n]*?[^\S\n]+\[(?:<[^\S\n]+)?\d+(?:\.\d+)?[^\S\n]*(?:ms|s)\][^\S\n]*$/, DOTNETTEST_VSTEST_ANY_RESULT_RE,
    ["  Fehler ArithmeticTests.Crash [< 1 ms]", "  x y [1 ms]", "  a  [2.5 s]  "]],
  ["dotnettest VSTEST_LABEL_RE", /^[^\S\n]{2}\S[^\n]*?[^\S\n]*:[^\S\n]*$/, DOTNETTEST_VSTEST_LABEL_RE,
    ["  Error Message:", "  Stack Trace:", "  a :  ", "  x:"]],
  ["php FRAME_RE", /^#(\d+)[^\S\n]+(?:(.+?)\((\d+)\):[^\S\n]+(.+)|\{main\})$/, PHP_FRAME_RE,
    ["#0 /app/src/Cart.php(12): Cart->total()", "#1 {main}", "#2  a b(1):  f() ", "#3  (1): x", "#4 a(1):  "]],
  ["php THROWN_RE", /^[^\S\n]*thrown in[^\S\n]+.+[^\S\n]+on line[^\S\n]+\d+$/, PHP_THROWN_RE,
    ["  thrown in /home/dev/app/p3.php on line 2", "thrown in a b  on line 12", "thrown in    on line 1"], testing],
  ["pytest TRAILING_RE", /^(.+?):(\d+):[^\S\n]*(?:in[^\S\n]+\S+|(\w[\w.]*))?[^\S\n]*$/, PYTEST_TRAILING_RE,
    ["a.py:11: KeyError", "a.py:11:", "a.py:3: in test_x", "a.py:1:  x  ", "a.py:1: x y"]],
  ["pytest SUMMARY_ENTRY_RE", /^(?:FAILED|ERROR)[^\S\n]+((?:.+?::.+?)|(?:.+?\.[A-Za-z0-9]+))(?:[^\S\n]+-[^\S\n]+(.*))?[^\S\n]*$/, PYTEST_SUMMARY_ENTRY_RE,
    ["FAILED tests/test_a.py::test_x - AssertionError: assert 1 == 2", "ERROR test_broken.py", "FAILED a.py::b", "FAILED  a b.py::c d - e  ", "FAILED x::  - y", "FAILED x:: ", "FAILED   ::x", "FAILED  .py", "ERROR a.b - c"]],
  ["normalize BUILDKIT_STEP", /^[^\S\n]*>[^\S\n]+\[[^\]]+\][^\S\n]+.*:[^\S\n]*$/, NORMALIZE_BUILDKIT_STEP,
    [" > [2/2] RUN exit 3:", "> [1/3] x  :  ", ">  [a]  :"]],
  ["vitest TESTS_LINE", /^[^\S\n]*Tests[^\S\n]+(.+?)[^\S\n]*$/, VITEST_TESTS_LINE,
    [" Tests  1 failed | 2 passed (3)", "Tests x  "]],
  ["vitest TEST_FILES_LINE", /^[^\S\n]*Test Files[^\S\n]+(.+?)[^\S\n]*$/, VITEST_TEST_FILES_LINE,
    [" Test Files  1 failed (1)", "Test Files   "]],
  ["vitest TEST_FILES_ANYWHERE", /^[^\S\n]*Test Files[^\S\n]+(.+?)[^\S\n]*$/m, VITEST_TEST_FILES_ANYWHERE,
    [" Test Files  1 failed (1)\n Tests  1 failed", "x\nTest Files a  \n"]],
  ["jest TESTS_TALLY", /^Tests:[^\S\n]+(.+?)[^\S\n]*$/m, JEST_TESTS_TALLY,
    ["Tests:       1 failed, 1 total", "Tests: x  \nTest Suites: 1"]],
  ["jest SUITES_TALLY", /^Test Suites:[^\S\n]+(.+?)[^\S\n]*$/m, JEST_SUITES_TALLY,
    ["Test Suites: 1 failed, 1 total", "Test Suites:   "]],
  ["phpunit INTERNAL_LOCATION", /^Location:[^\S\n]+(.+?):(\d+)$/m, PHPUNIT_INTERNAL_LOCATION,
    ["Location: /home/dev/app/tests/CrashTest.php:2", "Location:  a b:1", "x\nLocation: a:1\n"]],
  ["rspec COMMENTED_FRAME", /^#[^\S\n]+(.+?):(\d+):in\b/, RSPEC_COMMENTED_FRAME,
    ["# ./spec/crash_spec.rb:1:in `<top (required)>'", "#  a b:2:in x", "#  :3:in"]],
  ["ava ROLL_RE", /^[^\S\n]*\u2718[^\S\n]+\[fail\]:[^\S\n]+(.+?)[^\S\n]*$/, AVA_ROLL_RE,
    ["  \u2718 [fail]: totals an invoice", "\u2718 [fail]:  a b  ", "\u2718 [fail]:   "]],
  ["shellcheck HEADER", /^In[^\S\n]+(.+?)[^\S\n]+line[^\S\n]+(\d+):[^\S\n]*$/, SHELLCHECK_HEADER,
    ["In JsonFile.php line 398:", "In a b  line 1:  ", "In   line 2:", "In x line 3: y"]],
  ["taptext NOT_OK_RE", /^[^\S\n]*not ok(?:[^\S\n]+(\d+))?[^\S\n]*(?:-[^\S\n]*)?(.*?)[^\S\n]*$/, TAPTEXT_NOT_OK_RE,
    ["not ok 1 - adds", "not ok", "  not ok 2", "not ok - x", "not ok 3 -  a b  ", "not ok12x"]],
  ["taptext AT_RE", /^[^\S\n]*#[^\S\n]*at[^\S\n]+(\S.*?)[^\S\n]+line[^\S\n]+(\d+)\.?[^\S\n]*$/, TAPTEXT_AT_RE,
    ["#   at shop.t line 5.", "# at a b  line 12  ", "#at x line 1."]],
  ["taptext GOT_RE", /^[^\S\n]*#[^\S\n]*got:[^\S\n]*(.*?)[^\S\n]*$/, TAPTEXT_GOT_RE,
    ["#          got: 'abc'", "# got:", "#got:  a b  "]],
  ["taptext WANTED_RE", /^[^\S\n]*#[^\S\n]*expected:[^\S\n]*(.*?)[^\S\n]*$/, TAPTEXT_WANTED_RE,
    ["#     expected: 'abd'", "# expected:", "#expected:  a b  "]],
  ["stylelint TAP_FILE_RE", /^not ok[^\S\n]+\d+[^\S\n]+-[^\S\n]+(\S.*?)[^\S\n]*$/, STYLELINT_TAP_FILE_RE,
    ["not ok 1 - /app/style.css", "not ok 2 -  a b  "]],
  ["docker STEP_ERROR", /^#(\d+)[^\S\n]+ERROR:[^\S\n]+(.+?)[^\S\n]*$/, DOCKER_STEP_ERROR,
    ["#5 ERROR: process \"/bin/sh -c exit 3\" did not complete successfully: exit code: 3", "#1 ERROR:  x  ", "#2 ERROR:   "]],
  ["docker QUOTED_STEP", /^[^\S\n]*>[^\S\n]*\[\d+\/\d+\][^\S\n]*(.*):[^\S\n]*$/, DOCKER_QUOTED_STEP,
    [" > [5/5] RUN pytest -q:", "> [1/2]   :", ">[1/1] x :  "], testing],
  ["terraform AT_RE", /^[^\S\n]*on[^\S\n]+(\S+)[^\S\n]+line[^\S\n]+(\d+)(?:,[^\S\n]+in[^\S\n]+(.+?))?:[^\S\n]*$/, TERRAFORM_AT_RE,
    ["  on main.tf line 1, in resource \"local_file\" \"demo\":", "on a.tf line 2:", "  on x line 3, in  :", "on a line 4, in   b c  :  "]],
  ["eslint PARSE_RE", /^[^\S\n]+(\d+):(\d+)[^\S\n]+error[^\S\n]+(Parsing error:[^\S\n].+?)[^\S\n]*$/, ESLINT_PARSE_RE,
    ["  1:11  error  Parsing error: Unexpected token ;", "  1:1  error  Parsing error:   ", "  2:3 error Parsing error:  x  "]],
  ["jvm MAVEN_RE", /^\[ERROR\][^\S\n]+(.+?):\[(\d+),(\d+)\][^\S\n]+(.+)$/, JVM_MAVEN_RE,
    ["[ERROR] /app/src/main/java/A.java:[3,5] cannot find symbol", "[ERROR]  a b:[1,2]  x", "[ERROR]  :[1,2]  ", "[ERROR] a:[1,2] "]],
  ["jest JEST_GROUP", /^[^\S\n]*::group::Errors thrown in[^\S\n]+(.+?)[^\S\n]*$/, JEST_JEST_GROUP,
    ["::group::Errors thrown in test/ship.test.js", "  ::group::Errors thrown in  a b  "]],
  ["phpunit TESTDOX_TEST", /^[^\S\n]+[\u2718\u2717][^\S\n]+(\S.*?)[^\S\n]*$/, PHPUNIT_TESTDOX_TEST,
    [" \u2718 Addition", "  \u2717 a b  "]],
  ["tap NOT_OK_RE", /^[^\S\n]*not ok[^\S\n]+(\d+)[^\S\n]*-?[^\S\n]*(.*?)[^\S\n]*$/, TAP_NOT_OK_RE,
    ["not ok 1 - totals an invoice", "    not ok 1 - x", "not ok 2", "not ok 3-", "not ok 4 -  a  "]],
  ["vitest LOC_RE", /^[^\S\n]*[\u276f>][^\S\n]+(.+?):(\d+):(\d+)[^\S\n]*$/, VITEST_LOC_RE,
    [" \u276f shop.test.js:6:53", "> a b.js:1:2  ", " \u276f  :1:2"]],
  ["rspec LOCATION_RE", /^[^\S\n]+#[^\S\n]+(.+):(\d+):in\b/, RSPEC_LOCATION_RE,
    ["     # ./spec/shop_spec.rb:12:in `fetch'", "  #  :3:in x", "  # a:1:in b:2:in c"]],
  ["cluster MISSING_OPERAND", /\b(?:(?:cannot|could not|can't|couldn't|unable to)[^\S\n]+(?:find|resolve|locate|load)(?:[^\S\n]+(?:module|package|crate|dependency|declaration file for module))?|no[^\S\n]+module[^\S\n]+named|unresolved[^\S\n]+import|module[^\S\n]+not[^\S\n]+found:?(?:[^\S\n]+Error:)?(?:[^\S\n]+Can't[^\S\n]+resolve)?|failed[^\S\n]+to[^\S\n]+resolve)[^\S\n]*:?[^\S\n]+(?!in\b|from\b)([^\s,;]+)/gi, CLUSTER_MISSING_OPERAND,
    ["Cannot find module './a.js'", "error: could not resolve:  x, y", "unable to load  in x", "No module named foo", "cannot find :x"], everyMatch],
  ["util ANNOTATION_RE", /^[^\S\n]*::(error|warning|notice)[^\S\n]+([^:\n]*)::(.*)$/, UTIL_ANNOTATION_RE,
    ["::error file=deploy.yml,line=9,col=18::9:18 [trailing-spaces] trailing spaces", "::warning  ::msg", "  ::notice a b::c"]],
  ["pytest BANNER_RE", /^_{3,}[^\S\n]+(.+?)[^\S\n]+_{3,}$/, PYTEST_BANNER_RE,
    ["______________________________ test_invoice_total ______________________________", "___ a b ___", "___    ___"]],
  ["pytest TALLY_RE", /^=+[^\S\n]+(.*?(?:failed|passed|error).*?)[^\S\n]+=+$/i, PYTEST_TALLY_RE,
    ["========================= 3 failed, 2 passed in 0.01s ==========================", "== a  ERROR  b ==", "=  failed  ="]],
  ["ava THROWN_IN_TEST", /[^\S\n]+\w*(?:Error|Exception) thrown in test$/, AVA_THROWN_IN_TEST,
    ["totals an invoice TypeError thrown in test", "a b  Error thrown in test", "x thrown in test"], replacing],
  ["dotnet PROJECT_SUFFIX", /[^\S\n]+\[[^\]]+\.csproj\][^\S\n]*$/, DOTNET_PROJECT_SUFFIX,
    ["error CS0103: The name 'x' does not exist [/app/App.csproj]", "msg  [a b.csproj]  ", "x [y]"], replacing],
  ["jvm CHEVRON", /[^\S\n]+>[^\S\n]+/, JVM_CHEVRON, ["CartTest > totals an invoice > FAILED", "a  >  b", "x>y"], splitting],
  ["vitest CHEVRON", /[^\S\n]+>[^\S\n]+/, VITEST_CHEVRON, ["t/a.test.js > suite > adds", "a > b >"], splitting],
  ["vitest TIME_SUFFIX", /[^\S\n]*#[^\S\n]*time=.*$/, VITEST_TIME_SUFFIX, ["not ok 1 - adds # time=1.2ms", "x #time=", "a # b"], replacing],
  ["location BEFORE_CALL", /[^\S\n]+\(/, LOCATION_BEFORE_CALL, ["at total (/app/a.js:1:2)", "f  (x", "g(y"]],
  ["util TRAILING_SPACE", /\s+$/, UTIL_TRAILING_SPACE, ["msg  ", "a b \t", "x"], replacing],
  ["oxlint UNIX_DETAIL_RE", /^[^\S\n]+(.+?)[^\S\n]+\[(Error|Warning)\/([\w-]+)\(([\w/-]+)\)\][^\S\n]*$/, OXLINT_UNIX_DETAIL_RE,
    [" `debugger` statement is not allowed [Error/eslint(no-debugger)]", "  a b  [Warning/x(y/z)]  ", "   [Error/a(b)]"]],
];
const WHITE = [" ", " ", " ", "\t", "\r", "\u00a0", "\u2028", "\u2029", "\u3000"];
/** One of `lines`, changed a few ways at random. */
const reshaped = (lines) => {
  let line = pick(lines);
  for (let n = 1 + Math.floor(rand() * 4); n > 0; n--) {
    const i = Math.floor(rand() * (line.length + 1)), j = Math.min(line.length, i + Math.floor(rand() * 9));
    let white = "";
    for (let k = 1 + Math.floor(rand() * 5); k > 0; k--) white += pick(WHITE);
    const other = pick(lines), from = Math.floor(rand() * other.length);
    switch (Math.floor(rand() * 6)) {
      case 0: line = line.slice(0, i) + white + line.slice(i); break;
      case 1: line = line.slice(0, i) + white + line.slice(j); break;
      case 2: line = line.slice(0, i) + line.slice(j); break;
      case 3: line = line.slice(0, i) + other.slice(from, from + 1 + Math.floor(rand() * 6)) + line.slice(i); break;
      case 4: line = line.slice(0, i); break;
      default: line = line.slice(0, i) + line.slice(i, j) + line.slice(i);
    }
  }
  return line;
};
/** `lines` with a stretch of `n` spaces put where each stretch of whitespace in them starts, at
 *  their end - with and without something after it - and before them. */
const stretched = (lines, n) => {
  const s = " ".repeat(n);
  return lines.flatMap((line) => {
    const out = [line + s + "y", line + s, s + line];
    for (let p = 0; p < line.length; p++) {
      if (/[^\S\n]/.test(line[p]) && (p === 0 || !/[^\S\n]/.test(line[p - 1]))) out.push(line.slice(0, p) + s + line.slice(p), line.slice(0, p) + s);
    }
    return out;
  });
};

test("each pattern held to where whitespace starts reads lines of its own shape as it did", () => {
  for (const [name, was, now, lines, compare = matching] of SHAPED) agrees(name, compare(was), compare(now), () => reshaped(lines), 5000);
});

test("lines of each held pattern's own shape with long stretches of whitespace in them", () => {
  const slow = [];
  for (const [name, , pattern, lines] of SHAPED) {
    const once = (n) => {
      const all = stretched(lines, n);
      let best = Infinity;
      const at = performance.now();
      do {
        const start = performance.now();
        for (let k = 0; k < 5; k++) for (const line of all) { pattern.lastIndex = 0; pattern.test(line); }
        best = Math.min(best, performance.now() - start);
      } while (performance.now() - at < FLOOR_MS);
      return best;
    };
    const small = once(2000);
    let large = once(8000);
    if (large >= small * 8) large = Math.min(large, once(8000), once(8000));
    if (large >= small * 8) slow.push(`${name}: ${ms(small)}ms for the lines, ${ms(large)}ms for lines four times as long - x${(large / small).toFixed(1)}`);
  }
  assert.deepEqual(slow, []);
});

test("C and .NET build logs with a line of thousands of spaces", () => {
  // A file or project could end anywhere in a stretch of whitespace, and from each place
  // the pattern read the rest of the stretch again: 32,000 spaces took a second.
  const padded = (n) => [
    "x" + " ".repeat(n) + "y", " ".repeat(n) + "y",
    "a.c:1:2: error: x" + " ".repeat(n) + "y",
    "Program.cs(1,2): error CS0103: x" + " ".repeat(n) + "y",
  ].join("\n");
  linearIn(clang, padded, 2001);
  linearIn(dotnet, padded, 2001);
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
