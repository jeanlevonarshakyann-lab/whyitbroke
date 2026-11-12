// Whether what whyitbroke reads from real failing commands is true: `npm run accuracy`.
//
// `npm run coverage` asks whether a real parser read each tool's output. A parser can read
// a log and be wrong about it - name a file that is half of the one the tool named, or put
// a failure on a line its file does not have - and a case written to check that is written
// by whoever wrote the parser, with the same idea of what the tool prints. So this checks
// each reading against two things nobody here wrote:
//
//   the project on disk    a file a failure names is a file that exists, and its line is
//                          one of that file's lines;
//   the project elsewhere  the same project under a directory with a space in its name,
//                          and under one with letters outside ASCII, reads as it did under
//                          a plain name - the same failures, in the same places. Most of
//                          these commands name their file as it lies in the project, and
//                          a tool then prints it that way, with the directory nowhere in
//                          it; so each is run there again with the file named by its full
//                          path, as a script or an editor names one - and once more
//                          with the file moved into a folder of the project whose name
//                          has a space in it, and named from the project as it lies there.
//
// A tool whose output is not the same twice - it prints how long it took, or an address -
// would fail the second check on its own account. So each command is also run a second
// time under the plain name, and a field that differs between those two runs is not
// compared for that tool.
//
// Nothing here is a test: it needs the tools installed, and what a tool prints changes
// between versions. A tool that is not installed is skipped and said so. Commands that
// fetch from a registry, a daemon or a cluster are skipped too unless `--network` is given,
// so that a run measures the readers and not the network. `--only <name>` runs one tool,
// and `--verbose` prints every failure read.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CASES, have } from "./cases.js";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "whyitbroke.js");
const args = process.argv.slice(2);
const network = args.includes("--network"), verbose = args.includes("--verbose");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

// Where a project is put, and how the command names the files it is given: as the case
// has them, by their full paths (true), or moved into a folder of the project with a space
// in its name ("folder"). The first is the one the others are compared with.
const PLACES = [
  ["a plain name", ["shop"], false],
  ["a space", ["My Project", "shop app"], false],
  ["beyond ASCII", ["café", "项目"], false],
  ["a space, by its full path", ["My Project", "shop app"], true],
  ["beyond ASCII, by its full path", ["café", "项目"], true],
  ["a folder with a space in the project", ["shop"], "folder"],
];

/** Does this case reach past the machine? Its own setup installs something, its command
 *  is fetched by npx, or it is one of the tools whose failing command is a download. */
const FETCHES = new Set(["pip", "bundle", "composer", "uv", "poetry", "mvn", "gradle", "docker", "dotnet", "kubectl", "terraform"]);
const reaches = (name, argv, setup) => FETCHES.has(name) || argv[0] === "npx" ||
  (!!setup && ["npm", "bundle", "composer", "pip"].includes(setup[0]));

/** The project written under `segments` of a new temporary directory, and its report. */
const FOLDER = "my folder";
function run(given, argv, setup, segments, naming = false) {
  // In a folder: only the files the command names move, since the rest - a config, a
  // manifest - are found by where they are.
  const named = (arg) => Object.hasOwn(given, arg);
  const files = naming === "folder"
    ? Object.fromEntries(Object.entries(given).map(([path, body]) => [argv.includes(path) ? `${FOLDER}/${path}` : path, body])) : given;
  // The real path: macOS's temporary directory is a link, and a tool that resolves it
  // names files under a root this would otherwise not know for the project's.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "whyitbroke-accuracy-")));
  const root = join(base, ...segments);
  try {
    mkdirSync(root, { recursive: true });
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    if (setup) {
      const r = spawnSync(setup[0], setup.slice(1), { cwd: root, timeout: 300000 });
      if (r.error || r.status !== 0) return { state: "setup" };
    }
    const command = argv.map((arg) => (!named(arg) ? arg : naming === "folder" ? `${FOLDER}/${arg}` : naming ? join(root, arg) : arg));
    const r = spawnSync(process.execPath, [cli, "--json", "--", ...command],
      { cwd: root, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    let report;
    try { report = JSON.parse(r.stdout); } catch { return { state: "none" }; }
    const failures = report.failures ?? [];
    if (!report.tool || !failures.length) return { state: "none" };
    // Where the project is, is the one thing that differs between two places - and a tool
    // handed a full path prints one where it would have printed the file's own name. So
    // every path under the project is compared as it lies in the project.
    const placeless = (value) => (typeof value === "string"
      ? value.split(`${root}/`).join("").split(root).join(".").split(base).join("<tmp>").split(`${FOLDER}/`).join("") : value);
    return {
      state: report.guessed ? "guess" : "read", tool: report.tool,
      failures: failures.map((f) => ({ file: placeless(f.file), line: f.line, col: f.col, title: placeless(f.title), message: placeless(f.message) })),
      untrue: failures.flatMap((f) => untrue(f, root)),
    };
  } finally { rmSync(base, { recursive: true, force: true }); }
}

/** What a failure says of the project that the project does not bear out. */
function untrue(failure, root) {
  const { file, line } = failure;
  if (typeof file !== "string" || !file) return [];
  // Not every place is a file: node names its own modules `node:internal/...`, and a
  // runtime names code it was handed as `<anonymous>` or `[eval]`.
  if (/^(?:node:|<|\[)/.test(file)) return [];
  const path = isAbsolute(file) ? file : resolve(root, file);
  if (!existsSync(path)) return [`names ${JSON.stringify(file)}, which is not a file`];
  if (!Number.isInteger(line) || !statSync(path).isFile()) return [];
  const lines = readFileSync(path, "utf8").split("\n").length;
  return line < 1 || line > lines ? [`puts ${JSON.stringify(file)} at line ${line}, and it has ${lines}`] : [];
}

const FIELDS = ["file", "line", "col", "title", "message"];
/** The fields that are not the same in two readings of the same failures. */
function differing(a, b) {
  if (a.state !== b.state || a.tool !== b.tool) return ["tool"];
  if (a.failures.length !== b.failures.length) return ["count"];
  return FIELDS.filter((field) => a.failures.some((f, i) => f[field] !== b.failures[i][field]));
}

const tally = { true: 0, untrue: 0, moved: 0, guess: 0, none: 0, skip: 0 };
const order = [...new Set(CASES.map(([g]) => g))];
let group = "";
for (const [g, name, files, argv, probe, setup] of order.flatMap((o) => CASES.filter(([c]) => c === o))) {
  if (only && name !== only) continue;
  if (g !== group) { group = g; console.log(`\n  ${group}`); }
  const say = (mark, text) => console.log(`    ${mark.padEnd(7)}${name.padEnd(17)}${text}`);
  if (!network && reaches(name, argv, setup)) { say("skip", "reaches the network: run with --network"); tally.skip++; continue; }
  if (!have(argv, probe)) { say("skip", "not installed"); tally.skip++; continue; }
  const plain = run(files, argv, setup, PLACES[0][1]);
  if (plain.state === "setup") { say("skip", "could not be set up"); tally.skip++; continue; }
  if (plain.state === "none") { say("NONE", "nothing read"); tally.none++; continue; }
  if (plain.state === "guess") { say("GUESS", `${plain.failures.length} failure(s) by the fallback`); tally.guess++; continue; }
  // What this tool does not print the same twice is not held against another place.
  const again = run(files, argv, setup, PLACES[0][1]);
  const unstable = again.state === "read" ? differing(plain, again) : ["tool"];
  const problems = plain.untrue.map((text) => ["UNTRUE", text]);
  for (const [place, segments, naming] of PLACES.slice(1)) {
    // A command that names no file of the project has none to name another way.
    if (naming && !argv.some((arg) => Object.hasOwn(files, arg))) continue;
    const there = run(files, argv, setup, segments, naming);
    if (there.state !== "read") { problems.push(["MOVED", `under ${place}: ${there.state === "guess" ? "read by the fallback" : "nothing read"}`]); continue; }
    for (const text of there.untrue) problems.push(["UNTRUE", `under ${place}: ${text}`]);
    const fields = differing(plain, there).filter((field) => !unstable.includes(field));
    if (!fields.length) continue;
    const detail = fields.map((field) => {
      if (field === "tool") return `tool ${there.tool} for ${plain.tool}`;
      if (field === "count") return `${there.failures.length} failure(s) for ${plain.failures.length}`;
      const at = plain.failures.findIndex((f, i) => f[field] !== there.failures[i][field]);
      return `${field} ${JSON.stringify(there.failures[at][field])} for ${JSON.stringify(plain.failures[at][field])}`;
    });
    problems.push(["MOVED", `under ${place}: ${detail.join("; ")}`]);
  }
  const worst = problems.some(([kind]) => kind === "UNTRUE") ? "UNTRUE" : problems.length ? "MOVED" : "ok";
  say(worst, `${plain.tool}, ${plain.failures.length} failure(s)${unstable.length ? ` (not the same twice: ${unstable.join(", ")})` : ""}`);
  for (const [kind, text] of problems) console.log(`           ${kind.toLowerCase()}: ${text}`);
  if (verbose) for (const f of plain.failures) console.log(`           ${f.file ?? "-"}:${f.line ?? "-"}:${f.col ?? "-"}  ${String(f.message ?? f.title ?? "").split("\n")[0].slice(0, 90)}`);
  tally[worst === "UNTRUE" ? "untrue" : worst === "MOVED" ? "moved" : "true"]++;
}

const ran = tally.true + tally.untrue + tally.moved + tally.guess + tally.none;
console.log(`\n  ${tally.true} of ${ran} read truly, in every place` +
  `${tally.untrue ? `, ${tally.untrue} untrue of the project` : ""}` +
  `${tally.moved ? `, ${tally.moved} read differently elsewhere` : ""}` +
  `${tally.guess ? `, ${tally.guess} by the fallback` : ""}` +
  `${tally.none ? `, ${tally.none} not read` : ""}` +
  `${tally.skip ? ` (${tally.skip} skipped)` : ""}\n`);
process.exitCode = 0;
