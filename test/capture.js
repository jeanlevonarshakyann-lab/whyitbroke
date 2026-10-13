// Capture has one job that outranks the rest: whatever gets dropped, the part of the
// log that says why the command failed has to survive. That part is at the END almost
// every time - pytest's summary, cargo's error, the stack trace - so these tests care
// most about what happens when the budget runs out long before the output does.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createCapture, elision } from "../src/capture.js";
import { analyse, EXTRACTORS } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "bin", "whyitbroke.js");
const fx = (n) => readFileSync(join(here, "fixtures", n), "utf8");

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

/** Feed text through the accumulator, optionally in chunks of a given size. A truncated
 *  capture's map of its lines onto the output's comes back as what it says of every line,
 *  so two captures compare equal only when they map their lines the same way too. */
function capture(text, maxBytes, chunk = 0) {
  const c = createCapture(maxBytes);
  const buf = Buffer.from(text, "utf8");
  if (!chunk) c.push(buf);
  else for (let i = 0; i < buf.length; i += chunk) c.push(buf.subarray(i, i + chunk));
  const { lines, ...result } = c.finish();
  return lines ? { ...result, lines: lines(0, result.text.split("\n").length - 1) } : result;
}

const MARKER = /\n~~~ whyitbroke: \d+ bytes of output elided here[^\n]*~~~\n/g;

/** The kept lines of a capture of `text` that do not map onto the output line they are
 *  part of - each kept line has to be one run of one line of the output, holding it whole
 *  or, cut at a carriage return, part of it. Marker lines map onto nothing. */
function misplaced(text, maxBytes) {
  const c = createCapture(maxBytes);
  c.push(Buffer.from(text));
  const { text: kept, lines } = c.finish();
  const original = text.split("\n");
  const wrong = [];
  kept.split("\n").forEach((line, k) => {
    const runs = lines(k, k);
    if (!runs.length) { if (line && !/^~~~ whyitbroke: \d+ bytes of output elided here/.test(line)) wrong.push(`${k}: ${line}`); return; }
    if (runs.length !== 1 || runs[0].start !== runs[0].end || !original[runs[0].start].includes(line)) {
      wrong.push(`${k}: ${JSON.stringify(line.slice(0, 80))} is not in line ${JSON.stringify(runs)} of the output`);
    }
  });
  return wrong.slice(0, 5);
}

// ------------------------------------------------------------- under the cap

test("output that fits is returned byte for byte", () => {
  const text = fx("pytest_fail.txt");
  const r = capture(text, 10 * 1024 * 1024);
  assert.equal(r.truncated, false);
  assert.equal(r.text, text, "an ordinary run must be completely unaffected");
  assert.equal(r.elided, 0);
});

test("chunk boundaries do not change the result", () => {
  const text = fx("eslint_bulk_fail.txt");
  for (const size of [1, 7, 64, 4096]) {
    assert.equal(capture(text, 10 * 1024 * 1024, size).text, text, `chunked by ${size}`);
  }
});

// -------------------------------------------------------------- over the cap

test("the end of the log survives the cap", () => {
  const tail = fx("pytest_fail.txt");
  const r = capture("filler that means nothing\n".repeat(60000) + tail, 100000);
  assert.equal(r.truncated, true);
  assert.ok(r.text.endsWith(tail.slice(-200)), "the last bytes of the log must be kept");
  assert.match(r.text, MARKER);
});

test("the beginning of the log is kept too", () => {
  const r = capture("FIRST_LINE_MATTERS\n" + "x\n".repeat(200000) + "LAST_LINE\n", 10000);
  assert.match(r.text, /^FIRST_LINE_MATTERS\n/, "the command and its banner live at the top");
  assert.match(r.text, /LAST_LINE\n$/);
});

test("a failure at the end is still diagnosed, not lost", () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-cap-"));
  try {
    const log = join(dir, "big.log");
    writeFileSync(log, "filler that means nothing\n".repeat(60000) + fx("pytest_fail.txt"));
    const r = spawnSync(process.execPath, [cli, "--json", "--max-bytes", "100000"], {
      input: readFileSync(log, "utf8"), encoding: "utf8",
    });
    const out = JSON.parse(r.stdout);
    assert.equal(out.tool, "pytest", "the parser must still recognise the tool");
    assert.equal(out.failures.length, 3);
    assert.equal(out.truncated, true, "and the run must still declare it was truncated");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a diagnostic in the middle survives clean output on both sides", () => {
  const failure = fx("pytest_fail.txt");
  const text = "build started\n"
    + "ordinary compiler output\n".repeat(5000)
    + failure
    + "cleanup completed\n".repeat(10000);
  const r = capture(text, 32768);
  for (const chunk of [7, 4096]) {
    assert.deepEqual(capture(text, 32768, chunk), r, `capture changed at chunk size ${chunk}`);
  }
  const parsed = analyse(r.text);
  assert.equal(r.truncated, true);
  assert.equal(parsed?.tool, "pytest", "the middle diagnostic must still reach its parser");
  assert.equal(parsed?.failures.length, 3);
  assert.match(r.text, /cleanup completed\n$/, "the tail remains available for shutdown errors");
  const gaps = [...r.text.matchAll(/whyitbroke: (\d+) bytes of output elided here/g)];
  assert.ok(gaps.length >= 2, "separate missing regions must remain visibly separate");
  assert.equal(gaps.reduce((sum, match) => sum + Number(match[1]), 0), r.elided);
  assert.equal(r.elided + Buffer.byteLength(r.text.replace(MARKER, "")), Buffer.byteLength(text));
  // Every line kept is the line of the output it came from, and a marker is nobody's line:
  // evidence read from a capture cut short numbers the output's lines, not the capture's.
  const c = createCapture(32768);
  c.push(Buffer.from(text));
  const { text: kept, lines } = c.finish();
  const original = text.split("\n");
  const wrong = [];
  let markers = 0;
  kept.split("\n").forEach((line, k) => {
    const runs = lines(k, k);
    if (!runs.length) { if (line && !/^~~~ whyitbroke: \d+ bytes of output elided here/.test(line)) wrong.push(`${k}: ${line}`); else markers++; return; }
    if (runs.length !== 1 || runs[0].start !== runs[0].end || original[runs[0].start] !== line) {
      wrong.push(`${k}: ${JSON.stringify(line)} is not line ${JSON.stringify(runs)} of the output`);
    }
  });
  assert.deepEqual(wrong.slice(0, 5), []);
  assert.ok(markers >= 2 * gaps.length, "the markers map onto nothing");
});

test("diagnostics already in the tail do not spend the capture budget twice", () => {
  const max = 20000;
  const r = capture("ordinary output\n".repeat(20000) + fx("pytest_fail.txt"), max, 997);
  const payload = Buffer.byteLength(r.text.replace(MARKER, ""));
  assert.ok(payload <= max, "kept " + payload + " bytes of the log under a cap of " + max);
  assert.ok(payload > max - 250, "only " + payload + " of " + max + " available bytes were used");
  assert.equal(analyse(r.text)?.failures.length, 3);
});

test("the capture keeps the log within its budget, and its markers within theirs", () => {
  // --max-bytes counts the log's own bytes; the markers come on top of it.
  const r = capture("y\n".repeat(500000), 8192);
  assert.ok(Buffer.byteLength(r.text.replace(MARKER, "")) <= 8192, "kept " + Buffer.byteLength(r.text.replace(MARKER, "")) + " bytes of the log");
  assert.ok((r.text.match(MARKER) ?? []).join("").length <= 4096, "the markers took more than 4KB");
});

test("nearby gaps share a marker, so the markers cannot add up", () => {
  // Sixty failures, each kept with the lines around it and one line apart: a marker for
  // every gap would take more than the markers may. The smallest windows give way, the
  // oldest first among equals, each joining the gaps on either side of it - so the one
  // window larger than the rest stays although it is the oldest.
  let text = "ordinary compiler output\n".repeat(200);
  text += '  "severity": "error",\n' + "x\n".repeat(70) + "ordinary compiler output\n".repeat(20) + "x\n".repeat(17);
  for (let k = 0; k < 60; k++) text += `FAIL ${String(k).padStart(2, "0")}\n` + "x\n".repeat(17);
  text += "cleanup completed\n".repeat(600);
  const r = capture(text, 16384);
  const markers = r.text.match(MARKER) ?? [];
  assert.ok(markers.join("").length <= 4096, `${markers.length} markers took ${markers.join("").length} bytes`);
  assert.ok(Buffer.byteLength(r.text.replace(MARKER, "")) <= 16384);
  assert.match(r.text, /"severity": "error"/, "the larger window gave way to smaller ones");
  const kept = [...r.text.matchAll(/^FAIL (\d+)$/gm)].map((m) => +m[1]);
  assert.ok(kept.length > 0 && kept.length < 60, `${kept.length} of 60 kept`);
  assert.deepEqual(kept, Array.from({ length: kept.length }, (_, k) => 60 - kept.length + k), "among equals the oldest gave way");
});

// -------------------------------------------------------------- cut quality

test("cuts land on line boundaries, never mid-line", () => {
  const line = (n) => `line ${String(n).padStart(6, "0")} of the log\n`;
  let text = "";
  for (let i = 0; i < 100000; i++) text += line(i);
  const r = capture(text, 20000);
  for (const part of r.text.split(MARKER)) {
    for (const l of part.split("\n")) {
      if (l === "") continue;
      assert.match(l, /^line \d{6} of the log$/, `severed line: ${JSON.stringify(l)}`);
    }
  }
});

test("multi-byte characters are never split", () => {
  // A run of 3-byte characters straddling every plausible cut point.
  const text = "x".repeat(2040) + "日本語テスト日本語\n" + "y".repeat(4000) + "\n語末\n";
  for (let max = 1024; max <= 4100; max += 37) {
    const r = capture(text, max);
    assert.ok(!r.text.includes("�"), `replacement character at --max-bytes ${max}`);
  }
});

test("output with no newline at all is still cut safely", () => {
  const r = capture("語".repeat(4000), 1024);   // one line, all multi-byte
  assert.equal(r.truncated, true);
  assert.ok(!r.text.includes("�"), "a cut with no newline to aim for still must not split");
  assert.match(r.text, MARKER);
});

test("output made only of redraws keeps its last lines", () => {
  // A progress bar redraws itself with a carriage return and never ends a line. Cut on
  // newlines alone, a log of nothing else kept only the marker, and the error printed
  // after the last redraw was cut with everything before it.
  const text = "downloading layer 3/7 [=====>     ] 45%\r".repeat(20000) +
    "error: failed to fetch layer: connection reset by peer\r";
  const whole = capture(text, 8192);
  for (const chunk of [1, 7, 4096]) assert.deepEqual(capture(text, 8192, chunk), whole, `chunked by ${chunk}`);
  assert.equal(whole.truncated, true);
  assert.match(whole.text, /^downloading layer 3\/7/, "the head is kept");
  assert.match(whole.text, /error: failed to fetch layer: connection reset by peer\r$/, "and so is the tail");
  assert.match(analyse(whole.text)?.failures[0]?.message ?? "", /connection reset by peer/);
  assert.deepEqual(misplaced(text, 8192), []);
});

test("a failure printed after a redraw survives in the middle", () => {
  // The redraws and the error after them were one line until a newline ended it, and a
  // line longer than the scan was skipped whole: buried in the middle of a large log,
  // the error was never kept.
  const text = "build started\n" + "ordinary compiler output\n".repeat(5000) +
    "compiling crates [=====>     ] 45%\r".repeat(4000) + "error: linking with `cc` failed: exit status: 1\n" +
    "cleanup completed\n".repeat(10000);
  const whole = capture(text, 32768);
  for (const chunk of [7, 4096]) assert.deepEqual(capture(text, 32768, chunk), whole, `chunked by ${chunk}`);
  assert.equal(whole.truncated, true);
  assert.ok(whole.text.includes("\rerror: linking with `cc` failed: exit status: 1\n"), "the error is kept");
  assert.match(analyse(whole.text)?.failures.map((f) => f.message).join("\n") ?? "", /linking with `cc` failed/);
  assert.deepEqual(misplaced(text, 32768), []);
});

test("a carriage return and newline split between chunks end one line", () => {
  // Windows output ends its lines with both. Split across two chunks they are still one
  // line end, so the capture is what it is when they arrive together.
  const text = "build started\r\n" + "ordinary compiler output\r\n".repeat(5000) + fx("pytest_fail.txt").replace(/\n/g, "\r\n") +
    "cleanup completed\r\n".repeat(10000);
  const whole = capture(text, 32768);
  for (const chunk of [1, 2, 3, 7, 4096]) assert.deepEqual(capture(text, 32768, chunk), whole, `chunked by ${chunk}`);
  assert.equal(analyse(whole.text)?.failures.length, 3);
});

test("a tail that starts where a line does keeps that line", () => {
  // Cutting the tail to a line start dropped its first line even when the tail already
  // began on one. PHPUnit names a test when it starts and fails it by name; when the tail
  // began at the failing test's start, its failure had nothing to belong to.
  const flow = "flowId='1'";
  const pass = (k) => `##teamcity[testStarted name='testPass${k}' locationHint='php_qn:///app/tests/PassTest.php::\\PassTest::testPass${k}' ${flow}]\n` +
    `##teamcity[testFinished name='testPass${k}' duration='0' ${flow}]\n`;
  const started = `##teamcity[testStarted name='testSnapshot' locationHint='php_qn:///app/tests/SnapTest.php::\\SnapTest::testSnapshot' ${flow}]\n`;
  const rest = `##teamcity[testFailed name='testSnapshot' message='snapshot mismatch' details='/app/tests/SnapTest.php:12|n' duration='0' ${flow}]\n` +
    `##teamcity[testFinished name='testSnapshot' duration='0' ${flow}]\n##teamcity[testSuiteFinished name='SnapTest' ${flow}]\n` +
    `##teamcity[testSuiteStarted name='LaterTest' locationHint='php_qn:///app/tests/LaterTest.php::\\LaterTest' ${flow}]\n` +
    Array.from({ length: 4 }, (_, k) => pass(`Later${k}`)).join("") + `##teamcity[testSuiteFinished name='LaterTest' ${flow}]\n`;
  const text = `##teamcity[testCount count='2005' ${flow}]\n` +
    `##teamcity[testSuiteStarted name='PassTest' locationHint='php_qn:///app/tests/PassTest.php::\\PassTest' ${flow}]\n` +
    Array.from({ length: 2000 }, (_, k) => pass(k)).join("") + `##teamcity[testSuiteFinished name='PassTest' ${flow}]\n` +
    `##teamcity[testSuiteStarted name='SnapTest' locationHint='php_qn:///app/tests/SnapTest.php::\\SnapTest' ${flow}]\n` + started + rest;
  // The tail is the last three quarters of the cap: at this one, it starts with `started`.
  const tail = Buffer.byteLength(started + rest);
  const max = 1834;
  assert.equal(max - Math.floor(max / 4), tail, "the reproduction depends on where the tail starts");
  const r = capture(text, max);
  assert.ok(r.text.includes(started), "the line the tail starts with is kept");
  assert.deepEqual(analyse(r.text)?.failures.map((f) => f.title), ["SnapTest::testSnapshot"]);
});

test("a clipped structured record cannot invent a diagnosis", () => {
  // One valid one-line ESLint report, one byte over the public minimum cap. It contains
  // a warning only. If the tail starts inside its message, `error: decoy text` looks
  // like a new generic diagnostic after the marker gives the fragment its own line.
  const text = JSON.stringify([{
    filePath: "/tmp/bug.js",
    messages: [{
      ruleId: "no-thing", severity: 1, message: "x".repeat(258) + "error: decoy text",
      line: 7, column: 3, endLine: 7, endColumn: 4,
    }],
    suppressedMessages: [], errorCount: 0, fatalErrorCount: 0, warningCount: 1,
    fixableErrorCount: 0, fixableWarningCount: 0, source: "x".repeat(456),
    usedDeprecatedRules: [],
  }]);
  assert.equal(Buffer.byteLength(text), 1025, "the boundary itself is part of the reproduction");
  assert.equal(analyse(text), null, "the complete warning-only report has no failure");

  for (const chunk of [0, 1, 257]) {
    const kept = capture(text, 1024, chunk);
    assert.equal(kept.truncated, true);
    assert.equal(analyse(kept.text), null,
      `a clipped warning must not become an error with ${chunk || "one"} input chunk`);
  }
});

// rubocop and jest write their JSON reports on one line, and the line grows with what they
// found. A line still unended after 64KiB of it is skipped to its end, so that a minified
// blob cannot hold the scan - and a report that outgrew it in the middle of a log past the
// cap came back as the marker alone. So did one across the start of the tail, which the
// tail does not keep a part of.
test("a one-line report longer than the scan survives the cap", () => {
  const report = (name, grow) => JSON.stringify(grow(JSON.parse(fx(name))));
  const rubocop = report("rubocop_json_fail.txt", (r) => {
    r.files = Array.from({ length: 120 }, (_, k) => ({ ...r.files[k % r.files.length], path: `app/models/m${k}.rb` }));
    r.summary = { ...r.summary, offense_count: r.files.reduce((n, f) => n + f.offenses.length, 0),
      target_file_count: r.files.length, inspected_file_count: r.files.length };
    return r;
  });
  const jest = report("jest_json_assertions_fail.txt", (r) => {
    r.testResults = Array.from({ length: 30 }, (_, k) => ({ ...r.testResults[0], name: `/home/dev/app/src/m${k}.test.js` }));
    return r;
  });
  const MiB = 1024 * 1024, filler = (bytes) => "info: compiling module of the build graph\n".repeat(Math.ceil(bytes / 42));
  for (const [tool, line] of [["rubocop", rubocop], ["jest", jest]]) {
    assert.ok(line.length > 64 * 1024 && line.length < MiB / 4, `${tool}: a report of ${line.length} bytes`);
    const alone = analyse(line);
    assert.equal(alone?.tool, tool);
    // In the middle, and across the start of the tail: 3/4MiB of a 1MiB cap.
    for (const after of [MiB, MiB * 3 / 4 - 1000]) {
      const text = filler(MiB / 2) + filler(MiB) + line + "\n" + filler(after);
      for (const chunk of [16 * 1024, 65536]) {
        const kept = capture(text, MiB, chunk);
        assert.equal(kept.truncated, true);
        assert.ok(kept.text.includes("\n" + line + "\n"), `${tool}, ${after} bytes after it, in chunks of ${chunk}: the report was not kept`);
        const read = analyse(kept.text);
        assert.equal(read?.tool, tool);
        assert.deepEqual(read.failures.map((f) => [f.file, f.line, f.message]), alone.failures.map((f) => [f.file, f.line, f.message]));
      }
    }
  }
  // A long line that is no document is still skipped to its end: a minified bundle that
  // says "Error" is not a diagnosis.
  const bundle = "!function(){" + "var a=new Error(\"x\");".repeat(8000) + "}();";
  const kept = capture(filler(MiB / 2) + filler(MiB) + bundle + "\n" + filler(MiB), MiB, 16 * 1024);
  assert.ok(!kept.text.includes(bundle.slice(0, 1000)), "a minified bundle was kept");
});

test("output that is not UTF-8 stays within the cap", () => {
  // A byte that is not UTF-8 reads as U+FFFD, three bytes of text. Output under the cap
  // came back whole, so 1024 such bytes handed back 3072 under a cap of 1024.
  const lines = Buffer.from("ordinary compiler output\n".repeat(32));
  for (const bytes of [Buffer.alloc(1024, 0xff), Buffer.concat([lines, Buffer.alloc(1024 - lines.length, 0xfe)])]) {
    const c = createCapture(1024);
    c.push(bytes);
    const r = c.finish();
    const own = Buffer.byteLength(r.text.replace(MARKER, ""));
    assert.ok(own <= 1024, `${own} bytes of the log's text under a cap of 1024`);
    assert.equal(r.truncated, true, "and it says it was cut");
  }
});

test("the least recent windows in the middle are shed first", () => {
  // Fifty failures, each kept with the lines around it and one line apart, need more
  // markers than they may take: what has to go comes from the oldest. The newest were shed
  // first, against what the capture says it does.
  let text = "ordinary compiler output\n".repeat(90) + "x\n".repeat(17);
  for (let k = 0; k < 50; k++) text += `FAIL ${String(k).padStart(2, "0")}\n` + "x\n".repeat(17);
  text += "cleanup completed\n".repeat(600);
  const r = capture(text, 8192);
  const kept = [...r.text.matchAll(/^FAIL (\d+)$/gm)].map((m) => +m[1]);
  assert.ok(Buffer.byteLength(r.text.replace(MARKER, "")) <= 8192);
  assert.ok(kept.length > 0 && kept.length < 50, `${kept.length} of 50 kept`);
  assert.deepEqual(kept, Array.from({ length: kept.length }, (_, k) => 50 - kept.length + k), "the newest are the ones kept");
});

// ------------------------------------------------------------ the marker

test("the marker declares how much went missing", () => {
  const r = capture("z\n".repeat(100000), 5000);
  const said = Number(r.text.match(/whyitbroke: (\d+) bytes/)[1]);
  assert.equal(said, r.elided);
  const kept = Buffer.byteLength(r.text.replace(MARKER, ""));
  assert.equal(said + kept, 200000, "elided plus kept must account for the whole input");
});

test("the marker can never be reported as a failure", () => {
  const m = elision(123456);
  for (const ex of EXTRACTORS) {
    let failures = [];
    try { if (ex.detect(m)) failures = ex.extract(m)?.failures ?? []; } catch { /* covered elsewhere */ }
    assert.equal(failures.length, 0, `${ex.name} turned the elision marker into a failure`);
  }
  // and spliced into a real log it must not disturb the diagnosis
  const real = fx("pytest_fail.txt");
  const r = analyse(real.slice(0, 200) + m + real.slice(200));
  assert.equal(r.tool, "pytest");
  assert.equal(r.failures.filter((f) => JSON.stringify(f).includes("elided")).length, 0);
});

// ------------------------------------------- the failure has to survive the cap

// The whole point of keeping windows in the middle is that a real failure cannot vanish
// because cleanup output followed it. Burying each captured fixture in three megabytes
// of build chatter and capping the result lost the diagnosis in 25 of 124 - six of them
// completely, to no diagnosis at all - and the cap size made no difference, because what
// decides is which lines the scan calls probable, not how much room there is.
//
// Three kinds of narrowness did it, and they are worth naming because the temptation is
// to widen by feel: a leading \b cannot match "KeyError" or "SyntaxError"; "panic" with
// a trailing \b does not match "panicked"; and some tools write no failure word at all,
// so a location's shape has to stand in for one. Colour codes hid the rest - deno writes
// "\x1b[31merror\x1b[0m:", where the "m" ending the escape sits against the "e".
test("a buried failure survives the cap, whatever tool wrote it", () => {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

  const line = "  vite:build transforming src/components/Widget.tsx +2ms\n";
  const noise = (bytes) => line.repeat(Math.ceil(bytes / line.length));
  const head = noise(1_500_000), tail = noise(1_500_000);

  const lost = [];
  let checked = 0;
  for (const name of readdirSync(fixtures)) {
    const raw = readFileSync(join(fixtures, name), "utf8");
    let plain;
    try { plain = analyse(raw); } catch { continue; }
    if (!plain?.failures.length) continue;
    checked++;

    const c = createCapture(120_000);
    c.push(Buffer.from(head, "utf8"));
    c.push(Buffer.from(`${raw}\n`, "utf8"));
    c.push(Buffer.from(tail, "utf8"));
    const kept = c.finish();
    const text = typeof kept === "string" ? kept : kept.text;

    let got = null;
    try { got = analyse(text); } catch { got = null; }
    // Every failure, not just the tool. Losing one to the budget was tolerated while
    // jest lost one of its two - and what caused that turned out to be a bug rather
    // than a budget: the scan decoded lines as latin1, so a pattern written with jest's
    // bullet in it could never match three UTF-8 bytes. With that fixed nothing in the
    // corpus degrades at all, so the bar is where it should be.
    if (got?.tool !== plain.tool || got?.failures.length !== plain.failures.length) {
      lost.push(`${name}: ${plain.tool}/${plain.failures.length} -> ${got?.tool ?? "none"}/${got?.failures.length ?? 0}`);
    }
  }
  assert.ok(checked > 100, `only ${checked} fixtures buried`);
  assert.deepEqual(lost.slice(0, 8), [], "a real failure disappeared under cleanup output");
  console.log(`       ${checked} fixtures buried in 3MB of chatter and capped to 120KB`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
