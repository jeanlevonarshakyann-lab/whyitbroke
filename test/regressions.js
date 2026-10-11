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

// `go test ./...` over a module whose three packages each fail the same three tests, captured
// from go 1.24 - verbose, and as `go test -json` (its output events). The testing package
// prints a file's basename alone, so the packages write the very same failures.
const GO_THREE_PACKAGES = [
    "=== RUN   TestOk1",
    "--- PASS: TestOk1 (0.00s)",
    "=== RUN   TestInvoice2",
    "    shop_test.go:6: computing invoice 2",
    "    shop_test.go:6: Total() = 4, want 5",
    "--- FAIL: TestInvoice2 (0.00s)",
    "=== RUN   TestOk3",
    "--- PASS: TestOk3 (0.00s)",
    "=== RUN   TestInvoice4",
    "    shop_test.go:8: computing invoice 4",
    "    shop_test.go:8: Total() = 8, want 9",
    "--- FAIL: TestInvoice4 (0.00s)",
    "=== RUN   TestOk5",
    "--- PASS: TestOk5 (0.00s)",
    "=== RUN   TestInvoice6",
    "    shop_test.go:10: computing invoice 6",
    "    shop_test.go:10: Total() = 12, want 13",
    "--- FAIL: TestInvoice6 (0.00s)",
    "FAIL",
    "FAIL\texample.com/mono/pkg1\t0.005s",
    "=== RUN   TestOk1",
    "--- PASS: TestOk1 (0.00s)",
    "=== RUN   TestInvoice2",
    "    shop_test.go:6: computing invoice 2",
    "    shop_test.go:6: Total() = 4, want 5",
    "--- FAIL: TestInvoice2 (0.00s)",
    "=== RUN   TestOk3",
    "--- PASS: TestOk3 (0.00s)",
    "=== RUN   TestInvoice4",
    "    shop_test.go:8: computing invoice 4",
    "    shop_test.go:8: Total() = 8, want 9",
    "--- FAIL: TestInvoice4 (0.00s)",
    "=== RUN   TestOk5",
    "--- PASS: TestOk5 (0.00s)",
    "=== RUN   TestInvoice6",
    "    shop_test.go:10: computing invoice 6",
    "    shop_test.go:10: Total() = 12, want 13",
    "--- FAIL: TestInvoice6 (0.00s)",
    "FAIL",
    "FAIL\texample.com/mono/pkg2\t0.004s",
    "=== RUN   TestOk1",
    "--- PASS: TestOk1 (0.00s)",
    "=== RUN   TestInvoice2",
    "    shop_test.go:6: computing invoice 2",
    "    shop_test.go:6: Total() = 4, want 5",
    "--- FAIL: TestInvoice2 (0.00s)",
    "=== RUN   TestOk3",
    "--- PASS: TestOk3 (0.00s)",
    "=== RUN   TestInvoice4",
    "    shop_test.go:8: computing invoice 4",
    "    shop_test.go:8: Total() = 8, want 9",
    "--- FAIL: TestInvoice4 (0.00s)",
    "=== RUN   TestOk5",
    "--- PASS: TestOk5 (0.00s)",
    "=== RUN   TestInvoice6",
    "    shop_test.go:10: computing invoice 6",
    "    shop_test.go:10: Total() = 12, want 13",
    "--- FAIL: TestInvoice6 (0.00s)",
    "FAIL",
    "FAIL\texample.com/mono/pkg3\t0.003s",
    "FAIL",
  ].join("\n");
const GO_THREE_PACKAGES_JSON = [
    "{\"Time\":\"2026-10-11T01:36:08.73824125Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestOk1\",\"Output\":\"=== RUN   TestOk1\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738295511Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestOk1\",\"Output\":\"--- PASS: TestOk1 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738309158Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice2\",\"Output\":\"=== RUN   TestInvoice2\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738312123Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice2\",\"Output\":\"    shop_test.go:6: computing invoice 2\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73831541Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice2\",\"Output\":\"    shop_test.go:6: Total() = 4, want 5\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738319015Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice2\",\"Output\":\"--- FAIL: TestInvoice2 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738327418Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestOk3\",\"Output\":\"=== RUN   TestOk3\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738330751Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestOk3\",\"Output\":\"--- PASS: TestOk3 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738338091Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice4\",\"Output\":\"=== RUN   TestInvoice4\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738340403Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice4\",\"Output\":\"    shop_test.go:8: computing invoice 4\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738342966Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice4\",\"Output\":\"    shop_test.go:8: Total() = 8, want 9\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738346083Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice4\",\"Output\":\"--- FAIL: TestInvoice4 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738355645Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestOk5\",\"Output\":\"=== RUN   TestOk5\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738358468Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestOk5\",\"Output\":\"--- PASS: TestOk5 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738365324Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice6\",\"Output\":\"=== RUN   TestInvoice6\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738367536Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice6\",\"Output\":\"    shop_test.go:10: computing invoice 6\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738369767Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice6\",\"Output\":\"    shop_test.go:10: Total() = 12, want 13\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738381429Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Test\":\"TestInvoice6\",\"Output\":\"--- FAIL: TestInvoice6 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738386607Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Output\":\"FAIL\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738398928Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestOk1\",\"Output\":\"=== RUN   TestOk1\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738410934Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestOk1\",\"Output\":\"--- PASS: TestOk1 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73841987Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice2\",\"Output\":\"=== RUN   TestInvoice2\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738422258Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice2\",\"Output\":\"    shop_test.go:6: computing invoice 2\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738424527Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice2\",\"Output\":\"    shop_test.go:6: Total() = 4, want 5\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738427422Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice2\",\"Output\":\"--- FAIL: TestInvoice2 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738439578Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestOk3\",\"Output\":\"=== RUN   TestOk3\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738442335Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestOk3\",\"Output\":\"--- PASS: TestOk3 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738449507Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice4\",\"Output\":\"=== RUN   TestInvoice4\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738451826Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice4\",\"Output\":\"    shop_test.go:8: computing invoice 4\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738454188Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice4\",\"Output\":\"    shop_test.go:8: Total() = 8, want 9\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738457056Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice4\",\"Output\":\"--- FAIL: TestInvoice4 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738464281Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestOk5\",\"Output\":\"=== RUN   TestOk5\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738466724Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestOk5\",\"Output\":\"--- PASS: TestOk5 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73847353Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice6\",\"Output\":\"=== RUN   TestInvoice6\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738479347Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice6\",\"Output\":\"    shop_test.go:10: computing invoice 6\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738485732Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice6\",\"Output\":\"    shop_test.go:10: Total() = 12, want 13\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738488608Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Test\":\"TestInvoice6\",\"Output\":\"--- FAIL: TestInvoice6 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738493177Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Output\":\"FAIL\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73850508Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestOk1\",\"Output\":\"=== RUN   TestOk1\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738516559Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestOk1\",\"Output\":\"--- PASS: TestOk1 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738523345Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice2\",\"Output\":\"=== RUN   TestInvoice2\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738525676Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice2\",\"Output\":\"    shop_test.go:6: computing invoice 2\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738528139Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice2\",\"Output\":\"    shop_test.go:6: Total() = 4, want 5\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738531035Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice2\",\"Output\":\"--- FAIL: TestInvoice2 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738537695Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestOk3\",\"Output\":\"=== RUN   TestOk3\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738540377Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestOk3\",\"Output\":\"--- PASS: TestOk3 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73854704Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice4\",\"Output\":\"=== RUN   TestInvoice4\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738549262Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice4\",\"Output\":\"    shop_test.go:8: computing invoice 4\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738552413Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice4\",\"Output\":\"    shop_test.go:8: Total() = 8, want 9\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73855562Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice4\",\"Output\":\"--- FAIL: TestInvoice4 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738562622Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestOk5\",\"Output\":\"=== RUN   TestOk5\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738565161Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestOk5\",\"Output\":\"--- PASS: TestOk5 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738574807Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice6\",\"Output\":\"=== RUN   TestInvoice6\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.73857706Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice6\",\"Output\":\"    shop_test.go:10: computing invoice 6\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738579425Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice6\",\"Output\":\"    shop_test.go:10: Total() = 12, want 13\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738582138Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Test\":\"TestInvoice6\",\"Output\":\"--- FAIL: TestInvoice6 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.738586829Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Output\":\"FAIL\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.739269464Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg2\",\"Output\":\"FAIL\\texample.com/mono/pkg2\\t0.004s\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.739273225Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg3\",\"Output\":\"FAIL\\texample.com/mono/pkg3\\t0.003s\\n\"}",
    "{\"Time\":\"2026-10-11T01:36:08.739411699Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg1\",\"Output\":\"FAIL\\texample.com/mono/pkg1\\t0.004s\\n\"}",
  ].join("\n");
// The same events go wrote for pkg5's TestCart91 and pkg6's TestInvoice10, in the order it
// wrote them: running packages in parallel, it put pkg6's assertion right under pkg5's
// result line.
const GO_INTERLEAVED_JSON = [
    "{\"Time\":\"2026-10-11T01:32:23.975725067Z\",\"Action\":\"run\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975727049Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91\",\"Output\":\"=== RUN   TestCart91\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975729341Z\",\"Action\":\"run\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/a\"}",
    "{\"Time\":\"2026-10-11T01:32:23.97573176Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/a\",\"Output\":\"=== RUN   TestCart91/a\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975736112Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/a\",\"Output\":\"    shop_test.go:95: case a broke\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975741047Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/a\",\"Output\":\"--- FAIL: TestCart91/a (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975743824Z\",\"Action\":\"fail\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/a\",\"Elapsed\":0}",
    "{\"Time\":\"2026-10-11T01:32:23.975746989Z\",\"Action\":\"run\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/b\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975749737Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/b\",\"Output\":\"=== RUN   TestCart91/b\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975752368Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/b\",\"Output\":\"    shop_test.go:95: case b broke\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975755458Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/b\",\"Output\":\"--- FAIL: TestCart91/b (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.975758427Z\",\"Action\":\"fail\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91/b\",\"Elapsed\":0}",
    "{\"Time\":\"2026-10-11T01:32:23.976748523Z\",\"Action\":\"run\",\"Package\":\"example.com/mono/pkg6\",\"Test\":\"TestInvoice10\"}",
    "{\"Time\":\"2026-10-11T01:32:23.976750692Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg6\",\"Test\":\"TestInvoice10\",\"Output\":\"=== RUN   TestInvoice10\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.976753162Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg6\",\"Test\":\"TestInvoice10\",\"Output\":\"    shop_test.go:14: computing invoice 10\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.976747717Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91\",\"Output\":\"--- FAIL: TestCart91 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.976755905Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg6\",\"Test\":\"TestInvoice10\",\"Output\":\"    shop_test.go:14: Total() = 20, want 21\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.976757712Z\",\"Action\":\"fail\",\"Package\":\"example.com/mono/pkg5\",\"Test\":\"TestCart91\",\"Elapsed\":0}",
    "{\"Time\":\"2026-10-11T01:32:23.976759629Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg6\",\"Test\":\"TestInvoice10\",\"Output\":\"--- FAIL: TestInvoice10 (0.00s)\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.976763107Z\",\"Action\":\"fail\",\"Package\":\"example.com/mono/pkg6\",\"Test\":\"TestInvoice10\",\"Elapsed\":0}",
    "{\"Time\":\"2026-10-11T01:32:23.977034231Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Output\":\"FAIL\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.977089724Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg5\",\"Output\":\"FAIL\\texample.com/mono/pkg5\\t0.008s\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.979023584Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg6\",\"Output\":\"FAIL\\n\"}",
    "{\"Time\":\"2026-10-11T01:32:23.979085767Z\",\"Action\":\"output\",\"Package\":\"example.com/mono/pkg6\",\"Output\":\"FAIL\\texample.com/mono/pkg6\\t0.010s\\n\"}",
  ].join("\n");

test("The same failure in two Go packages is two failures", () => {
  for (const [name, text] of [["verbose", GO_THREE_PACKAGES], ["json", GO_THREE_PACKAGES_JSON]]) {
    const result = analyse(text, { cluster: false });
    assert.equal(result.tool, "go test", name);
    assert.equal(result.failures.length, 9, name);
    assert.equal(result.summary, "9 tests failed", name);
  }
});

test("A Go test's output is read from its own package when go test -json interleaves packages", () => {
  const result = analyse(GO_INTERLEAVED_JSON, { cluster: false });
  assert.deepEqual(result.failures.map((f) => [f.title, f.message.split("\n").pop()]), [
    ["TestCart91/a", "case a broke"], ["TestCart91/b", "case b broke"], ["TestInvoice10", "Total() = 20, want 21"],
  ]);
});

test("Two packages failing alike under a monorepo runner are two packages' failures", () => {
  for (const name of ["jest_fail.txt", "pytest_fail.txt", "vitest_fail.txt"]) {
    const bare = analyse(fx(name), { cluster: false });
    const both = analyse([wrapped(fx(name), "api:test: "), wrapped(fx(name), "web:test: ")].join("\n"), { cluster: false });
    assert.equal(both.tool, bare.tool, name);
    assert.equal(both.failures.length, 2 * bare.failures.length, name);
    // ...while one package printed twice is still one package's failures.
    const twice = analyse([wrapped(fx(name), "api:test: "), "unrelated output", wrapped(fx(name), "api:test: ")].join("\n"), { cluster: false });
    assert.equal(twice.failures.length, bare.failures.length, name);
  }
});

// `go test ./...`, `go test -json ./...` and `go vet ./...` run in each of two modules whose
// util.go has the same mistake, captured from go 1.24. Each module prints its files from its
// own root, so both write `./util.go:8:15: undefined: missing`, and only the header above
// it says which module it was. go names a package compiled for its tests with the test
// binary after it, and vet names it `[example.com/billing]`.
const GO_TWO_MODULES = {
  plain: [
    "# example.com/billing [example.com/billing.test]",
    "./util.go:8:15: undefined: missing",
    "FAIL\texample.com/billing [build failed]",
    "FAIL",
    "# example.com/shipping [example.com/shipping.test]",
    "./util.go:8:15: undefined: missing",
    "FAIL\texample.com/shipping [build failed]",
    "FAIL",
  ].join("\n"),
  json: [
    "{\"ImportPath\":\"example.com/billing [example.com/billing.test]\",\"Action\":\"build-output\",\"Output\":\"# example.com/billing [example.com/billing.test]\\n\"}",
    "{\"ImportPath\":\"example.com/billing [example.com/billing.test]\",\"Action\":\"build-output\",\"Output\":\"./util.go:8:15: undefined: missing\\n\"}",
    "{\"ImportPath\":\"example.com/billing [example.com/billing.test]\",\"Action\":\"build-fail\"}",
    "{\"Time\":\"2026-10-11T02:08:19.349699836Z\",\"Action\":\"start\",\"Package\":\"example.com/billing\"}",
    "{\"Time\":\"2026-10-11T02:08:19.349861987Z\",\"Action\":\"output\",\"Package\":\"example.com/billing\",\"Output\":\"FAIL\\texample.com/billing [build failed]\\n\"}",
    "{\"Time\":\"2026-10-11T02:08:19.349876136Z\",\"Action\":\"fail\",\"Package\":\"example.com/billing\",\"Elapsed\":0,\"FailedBuild\":\"example.com/billing [example.com/billing.test]\"}",
    "{\"ImportPath\":\"example.com/shipping [example.com/shipping.test]\",\"Action\":\"build-output\",\"Output\":\"# example.com/shipping [example.com/shipping.test]\\n\"}",
    "{\"ImportPath\":\"example.com/shipping [example.com/shipping.test]\",\"Action\":\"build-output\",\"Output\":\"./util.go:8:15: undefined: missing\\n\"}",
    "{\"ImportPath\":\"example.com/shipping [example.com/shipping.test]\",\"Action\":\"build-fail\"}",
    "{\"Time\":\"2026-10-11T02:08:19.527527666Z\",\"Action\":\"start\",\"Package\":\"example.com/shipping\"}",
    "{\"Time\":\"2026-10-11T02:08:19.527565591Z\",\"Action\":\"output\",\"Package\":\"example.com/shipping\",\"Output\":\"FAIL\\texample.com/shipping [build failed]\\n\"}",
    "{\"Time\":\"2026-10-11T02:08:19.527572982Z\",\"Action\":\"fail\",\"Package\":\"example.com/shipping\",\"Elapsed\":0,\"FailedBuild\":\"example.com/shipping [example.com/shipping.test]\"}",
  ].join("\n"),
  vet: [
    "# example.com/billing",
    "# [example.com/billing]",
    "vet: ./util.go:8:15: undefined: missing",
    "# example.com/shipping",
    "# [example.com/shipping]",
    "vet: ./util.go:8:15: undefined: missing",
  ].join("\n"),
};

test("The same compile error in two Go modules is two failures, however go printed it", () => {
  for (const [name, text] of Object.entries(GO_TWO_MODULES)) {
    const result = analyse(text, { cluster: false });
    assert.equal(result.failures.length, 2, name);
    assert.equal(result.summary, name === "vet" ? "2 errors" : "2 compile errors", name);
  }
});

test("One Go run printed two ways is read once", () => {
  // A package's own failures, as text and as events, or as go test and go vet saw them,
  // are that package's whichever way they were printed...
  for (const [a, b] of [["plain", "json"], ["json", "plain"], ["vet", "plain"]]) {
    const result = analyse(`${GO_TWO_MODULES[a]}\n${GO_TWO_MODULES[b]}`, { cluster: false });
    assert.equal(result.failures.length, 2, `${a} + ${b}`);
  }
  const plain = fx("gotest_build_and_tests_fail.txt"), json = fx("gotest_build_and_tests_json_fail.txt");
  for (const [name, text, summary] of [
    ["text + events", `${plain}\n${json}`, "1 compile error, 3 tests failed"],
    ["events + text", `${json}\n${plain}`, "1 compile error, 3 tests failed"],
    ["go build + go vet", `${fx("go_windows_build_fail.txt")}\n${fx("go_windows_vet_fail.txt")}`, "4 errors"],
    // ...and a copy whose closing line was cut off, so that it names no package at all, is
    // still the same failure as the copy that names one.
    ["events + text cut short", `${json}\n${plain.split("\n").slice(0, 10).join("\n")}`, "1 compile error, 3 tests failed"],
  ]) {
    const result = analyse(text, { cluster: false });
    assert.equal(result.summary, summary, name);
    assert.equal(result.failures.length, 4, name);
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
