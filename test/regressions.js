import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse } from "../src/index.js";
import { createCapture } from "../src/capture.js";
import { nodeFrame } from "../src/location.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fx = (name) => readFileSync(join(fixtures, name), "utf8");
let passed = 0;

function test(name, run) {
  try {
    run();
    passed++;
    console.log("  ok   " + name);
  } catch (error) {
    console.error("  FAIL " + name + "\n       " + (error.stack ?? error));
    process.exitCode = 1;
  }
}

test("--max-bytes includes generated elision markers", () => {
  const limit = 1024;
  const capture = createCapture(limit);
  capture.push(Buffer.from("ordinary output\n".repeat(10_000)));
  const result = capture.finish();
  assert.equal(result.truncated, true);
  assert.match(result.text, /bytes of output elided here/);
  assert.ok(Buffer.byteLength(result.text) <= limit,
    "returned " + Buffer.byteLength(result.text) + " bytes for a " + limit + "-byte cap");
});

test("pytest keeps spaces in parameter ids and history identity", () => {
  const text = fx("pytest_fail.txt").replaceAll("test_param[2]", "test_param[case with space]");
  const result = analyse(text, { cluster: false });
  const failure = result.failures.find((item) => item.title === "test_param[case with space]");
  assert.equal(result.tool, "pytest");
  assert.equal(failure?.subject, "test_shop.py::test_param[case with space]");
  assert.equal(failure?.file, "test_shop.py");
  assert.equal(failure?.line, 12);
});

test("Python keeps a bare custom exception type", () => {
  const text = [
    "Traceback (most recent call last):",
    '  File "/tmp/project/main.py", line 7, in <module>',
    "    raise BuildStopped",
    "BuildStopped",
    "",
  ].join("\n");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "python");
  assert.equal(result.failures[0].message, "BuildStopped");
});

test("Deno test accepts paths containing spaces", () => {
  const text = fx("deno_fail.txt")
    .replaceAll("./math_test.ts", "./my project/math_test.ts")
    .replaceAll("file:///home/dev/denoproj/", "file:///home/dev/my project/denoproj/");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "deno test");
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.every((failure) => failure.file === "./my project/math_test.ts"));
});

test("Jest stack locations accept paths containing spaces", () => {
  const text = fx("jest_fail.txt")
    .replaceAll("./sum.test.js", "./my project/sum.test.js")
    .replaceAll("sum.test.js:", "my project/sum.test.js:")
    .replaceAll("matching sum.test.js", "matching my project/sum.test.js");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "jest");
  assert.ok(result.failures.every((failure) => failure.file === "my project/sum.test.js"));
});

test("Vitest distinguishes a root directory from a frame function", () => {
  const text = fx("vitest_fail.txt")
    .replaceAll("/home/dev/js", "/home/dev/my project/js")
    .replaceAll("shop.test.js", "my project/shop.test.js");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "vitest");
  assert.ok(result.failures.every((failure) => failure.file === "my project/shop.test.js"));
});

test("Flake8 paths containing spaces are not stripped as wrappers", () => {
  const text = fx("flake8_fail.txt").replaceAll("lint_me.py", "my project/lint_me.py");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "flake8");
  assert.equal(result.failures.length, 8);
  assert.ok(result.failures.every((failure) => failure.file === "my project/lint_me.py"));
  assert.equal(result.wrappers, undefined);
});

// A path may hold a space, so a line-start location reads a runner's stamp as the start of
// its file: `12:34:56 lint_me.py`. The strip that takes the stamp off then reads the same
// tool and the same count, which is how a repeated source directory looks too. Before
// paths could hold spaces, none of these lines read at all until the stamp came off.
const wrapped = (text, prefix) => text.split("\n").map((line) => (line ? prefix + line : line)).join("\n");

test("A stamp in front of a line-start location is a wrapper, not part of the path", () => {
  const located = (result) => [result.tool, result.failures.map((f) => [f.file, f.line, f.col, f.code ?? f.title])];
  const names = [
    "flake8_fail.txt", "flake8_pylint_fail.txt", "oxlint_agent_same_fail.txt", "oxlint_unix_fail.txt",
    // The same mistake made other ways: pyright and dotnet indent the path the stamp sits
    // in front of, deno lint writes it as a file URL, Ruby's tab-indented frames share the
    // stamp and the tab, and dotnet's MSBUILD is no file at all.
    "pyright_fail.txt", "dotnet_terminal_logger_fail.txt", "dotnet_noproject_fail.txt",
    "denolint_compact_fail.txt", "ruby_keyerror_fail.txt", "ruby_require_fail.txt", "ruff_github_fail.txt",
  ];
  for (const prefix of ["12:34:56 ", "web-1  | ", "ci> "]) {
    for (const name of names) {
      const label = `${name} under ${JSON.stringify(prefix)}`;
      const result = analyse(wrapped(fx(name), prefix), { cluster: false });
      assert.deepEqual(located(result), located(analyse(fx(name), { cluster: false })), label);
      assert.deepEqual(result.wrappers, [prefix], label);
    }
  }
});

test("A wrapper of five words is still taken off whole", () => {
  // Task's prefixed output writes whatever prefix a task names. Five words have four stops
  // in front of the whole prefix, and the candidate list stopped at four. In a short log the
  // shared prefix runs on into the tool's own text, so the label has to be found among them.
  const located = (result) => [result.tool, result.failures.map((f) => [f.file, f.line, f.col, f.code ?? f.title])];
  const prefix = "[api backend integration test shard] ";
  for (const name of ["jest_fail.txt", "mocha_fail.txt", "pytest_fail.txt", "eslint_json_fail.txt", "gotest_json_fail.txt", "cargo_short_fail.txt"]) {
    const result = analyse(wrapped(fx(name), prefix), { cluster: false });
    assert.deepEqual(located(result), located(analyse(fx(name), { cluster: false })), name);
    assert.deepEqual(result.wrappers, [prefix], name);
  }
});

test("A spaced directory shared by every line is still part of the path", () => {
  for (const directory of ["my project/", "C:\\My Project\\"]) {
    const text = fx("flake8_fail.txt").replaceAll("lint_me.py", `${directory}lint_me.py`);
    const result = analyse(text, { cluster: false });
    assert.equal(result.failures.length, 8, directory);
    assert.ok(result.failures.every((failure) => failure.file === `${directory}lint_me.py`), directory);
    assert.equal(result.wrappers, undefined, directory);
  }
});

test("Oxlint agent and unix paths accept spaces", () => {
  for (const name of ["oxlint_agent_same_fail.txt", "oxlint_unix_fail.txt"]) {
    const text = fx(name).replaceAll("src/", "my project/src/");
    const result = analyse(text, { cluster: false });
    assert.equal(result.tool, "oxlint", name);
    assert.ok(result.failures.every((failure) => failure.file.startsWith("my project/src/")), name);
    assert.equal(result.wrappers, undefined, name);
  }
});

test("Webpack module paths accept spaces", () => {
  const text = fx("webpack_parse_fail.txt")
    .replaceAll("./wsrc/syn.js", "./my project/wsrc/syn.js");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "webpack");
  assert.equal(result.failures[0].file, "./my project/wsrc/syn.js");
  assert.equal(result.failures[0].line, 1);
  assert.equal(result.failures[0].col, 11);
});

test("Less paths accept spaces", () => {
  const text = fx("less_fail.txt")
    .replaceAll("/home/dev/app/bad.less", "/home/dev/my project/app/bad.less");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "less");
  assert.equal(result.failures[0].file, "/home/dev/my project/app/bad.less");
});

test("Jasmine normalises Windows file URLs independently of the host OS", () => {
  const text = fx("jasmine_fail.txt")
    .replaceAll("file:///home/dev/app/jas/", "file:///C:/Users/dev/my%20project/jas/");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "jasmine");
  assert.equal(result.failures[0].file, "C:/Users/dev/my project/jas/sum.spec.js");
});

test("AVA keeps locations whose paths contain spaces", () => {
  const text = fx("ava_fail.txt").replaceAll("av/sum.test.js", "my project/av/sum.test.js");
  const result = analyse(text, { cluster: false });
  assert.equal(result.tool, "ava");
  assert.ok(result.failures.every((failure) => failure.file === "my project/av/sum.test.js"));
  assert.deepEqual(result.failures.map((failure) => [failure.line, failure.col]), [[3, 38], [4, 69]]);
});

// Captured from node 22 and mocha 10; only the capturing machine's directory is rewritten.
const NODE_EVAL = [
    "<anonymous_script>:2",
    "null.price;",
    "     ^",
    "",
    "TypeError: Cannot read properties of null (reading 'price')",
    "    at eval (eval at run (/home/dev/my project/evalcase.js:2:3), <anonymous>:2:6)",
    "    at run (/home/dev/my project/evalcase.js:2:3)",
    "    at Object.<anonymous> (/home/dev/my project/evalcase.js:4:1)",
    "    at Module._compile (node:internal/modules/cjs/loader:1706:14)",
    "    at Object..js (node:internal/modules/cjs/loader:1839:10)",
    "    at Module.load (node:internal/modules/cjs/loader:1441:32)",
    "    at Function._load (node:internal/modules/cjs/loader:1263:12)",
    "    at TracingChannel.traceSync (node:diagnostics_channel:328:14)",
    "    at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)",
    "    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)",
    "",
    "Node.js v22.22.0",
  ].join("\n");
const NODE_COMPUTED_NAME = [
    "/home/dev/my project/computed.js:1",
    "const cache = { [\"cache (layer\"]() { throw new Error(\"stale layer\"); } };",
    "                                     ^",
    "",
    "Error: stale layer",
    "    at cache (layer (/home/dev/my project/computed.js:1:44)",
    "    at Object.<anonymous> (/home/dev/my project/computed.js:2:22)",
    "    at Module._compile (node:internal/modules/cjs/loader:1706:14)",
    "    at Object..js (node:internal/modules/cjs/loader:1839:10)",
    "    at Module.load (node:internal/modules/cjs/loader:1441:32)",
    "    at Function._load (node:internal/modules/cjs/loader:1263:12)",
    "    at TracingChannel.traceSync (node:diagnostics_channel:328:14)",
    "    at wrapModuleLoad (node:internal/modules/cjs/loader:237:24)",
    "    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)",
    "    at node:internal/main/run_main_module:36:49",
    "",
    "Node.js v22.22.0",
  ].join("\n");
const MOCHA_TAP_SPACED = [
    "not ok 1 cart totals an invoice",
    "  Expected values to be strictly equal:",
    "  ",
    "  4 !== 5",
    "  ",
    "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "  ",
    "  4 !== 5",
    "  ",
    "      at Context.<anonymous> (My Project (v2)/test/cart.test.js:4:12)",
    "      at process.processImmediate (node:internal/timers:485:21)",
    "# tests 1",
    "# pass 0",
    "# fail 1",
    "1..1",
  ].join("\n");

test("A frame inside eval'd code points at the call to eval", () => {
  const result = analyse(NODE_EVAL, { cluster: false });
  assert.equal(result.tool, "node");
  assert.deepEqual([result.failures[0].file, result.failures[0].line, result.failures[0].col],
    ["/home/dev/my project/evalcase.js", 2, 3]);
});

test("A method name holding ` (` is not part of the path", () => {
  const result = analyse(NODE_COMPUTED_NAME, { cluster: false });
  assert.equal(result.tool, "node");
  assert.equal(result.failures[0].file, "/home/dev/my project/computed.js");
  assert.equal(result.failures[0].line, 1);
});

test("Mocha TAP keeps a frame whose path holds spaces and brackets", () => {
  const result = analyse(MOCHA_TAP_SPACED, { cluster: false });
  assert.equal(result.tool, "tap");
  assert.deepEqual([result.failures[0].file, result.failures[0].line, result.failures[0].col],
    ["My Project (v2)/test/cart.test.js", 4, 12]);
});

test("Every reader of V8 frames reads them the same way", () => {
  const frames = {
    "    at eval (eval at outer (eval at inner (/app/t.js:9:2), <anonymous>:1:1), <anonymous>:2:3)": ["eval", "/app/t.js", 9, 2],
    "    at cache (layer (/app/x.js:1:44)": ["cache (layer", "/app/x.js", 1, 44],
    "    at fn (/home/dev/my (copy)/x.js:1:2)": ["fn", "/home/dev/my (copy)/x.js", 1, 2],
    "      at async file:///home/dev/app/lib/runner.js:515:21": [undefined, "/home/dev/app/lib/runner.js", 515, 21],
    "    at new Promise (<anonymous>)": null,
    "    at async Promise.all (index 0)": null,
  };
  for (const [line, want] of Object.entries(frames)) {
    const frame = nodeFrame(line);
    assert.deepEqual(frame && [frame.fn, frame.file, frame.line, frame.col], want, line);
  }
});

if (!process.exitCode) console.log("\n" + passed + " regression tests passed");
