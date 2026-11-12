// What share of real failing commands whyitbroke reads: `npm run coverage`.
//
// Every other measurement in this repo runs against the corpus, which is captures taken
// once and committed. This one runs the tools. It writes a small broken project for each
// one, runs the command that fails on it, and reports what came back - so a claim about
// coverage can be re-made on another machine instead of quoted from whenever it was last
// measured.
//
// Nothing here is a test. It needs the tools installed, it reaches the network for the
// package managers, and what a tool prints changes between versions - all three of which
// are why the corpus exists. A tool that is not installed is skipped and said so; the
// share is of what actually ran.
//
// A run counts as READ only when a real parser owns the log and reports a failure. The
// fallback getting the right line still counts as a guess, because the point of the
// number is how much is read by something that knows the tool.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CASES, have } from "./cases.js";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "whyitbroke.js");

function read(dir, argv) {
  const r = spawnSync(process.execPath, [cli, "--json", "--", ...argv],
    { cwd: dir, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  try {
    const j = JSON.parse(r.stdout);
    const n = j.failures?.length ?? 0;
    if (!j.tool || n === 0) return { state: "none" };
    return { state: j.guessed ? "guess" : "read", tool: j.tool, n };
  } catch { return { state: "none" }; }
}

const tally = { read: 0, guess: 0, none: 0, skip: 0 };
// Cases are written where they were found rather than sorted, so gather them by group
// before printing: a heading that appears twice reads as two different things.
const order = [...new Set(CASES.map(([g]) => g))];
const grouped = order.flatMap((g) => CASES.filter(([c]) => c === g));
let group = "";
for (const [g, name, files, argv, probe, setup] of grouped) {
  if (g !== group) { group = g; console.log(`\n  ${group}`); }
  if (!have(argv, probe)) { console.log(`    skip  ${name.padEnd(17)} not installed`); tally.skip++; continue; }
  const dir = mkdtempSync(join(tmpdir(), "whyitbroke-coverage-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    }
    // Some tools need the directory to be a project before the failing command means
    // anything - a git repository, or a node_modules the test file can import its own
    // framework from. This was one hardcoded `git init`; naming it per case is what lets
    // ava, playwright and tap be run at all, since each imports itself in the test.
    //
    // A setup that did not succeed is not a measurement. Without this an install that
    // could not reach the registry would leave the command failing on a missing module,
    // whyitbroke would read that honestly, and the run would be counted as a gap in
    // coverage - the same false gap `which` produced for javac.
    if (setup) {
      const r = spawnSync(setup[0], setup.slice(1), { cwd: dir, timeout: 300000 });
      if (r.error || r.status !== 0) {
        console.log(`    skip  ${name.padEnd(17)} could not be set up`);
        tally.skip++;
        continue;
      }
    }
    const got = read(dir, argv);
    const mark = got.state === "read" ? "ok  " : got.state === "guess" ? "GUESS" : "NONE";
    console.log(`    ${mark.padEnd(6)}${name.padEnd(17)}${got.tool ? `${got.tool}, ${got.n} failure(s)` : "nothing read"}`);
    tally[got.state]++;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const ran = tally.read + tally.guess + tally.none;
console.log(`\n  ${tally.read} of ${ran} read by a real parser` +
  `${tally.guess ? `, ${tally.guess} by the fallback` : ""}` +
  `${tally.none ? `, ${tally.none} not read` : ""}` +
  `${tally.skip ? ` (${tally.skip} tools not installed)` : ""}\n`);
process.exitCode = 0;
