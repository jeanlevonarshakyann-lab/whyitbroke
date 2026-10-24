// Docker's own build failures - a Dockerfile it cannot parse, a base image it cannot
// pull, a COPY whose source is not there. These carry a location, and BuildKit prints it
// in a shape nothing here read:
//
//   Dockerfile:2
//   --------------------
//      1 |     FROM debian:stable-slim
//      2 | >>> COPY missing-file.txt /tmp/
//      3 |
//   --------------------
//   ERROR: failed to build: failed to solve: ... "/missing-file.txt": not found
//
// The fallback scraped the ERROR lines and reported the failure twice, because BuildKit
// says it once per step and again at the end, and used neither the file nor the line.
//
// `process "/bin/sh -c pytest -q" did not complete successfully: exit code: 1` is docker
// relaying an inner command's exit status, and whatever ran inside said it better - the
// same thing make's `Error N` does. Usually that means declining, and those logs stay
// with the tool that actually failed: docker_buildkit_pytest_fail is still pytest's.
//
// Usually, but not always. `RUN exit 3` fails without printing anything, and then the
// relayed line is the only account of the failure that exists - declining left the
// fallback to scrape docker's two ERROR lines as two failures and drop the location.
// BuildKit says which case it is, so this does not have to be guessed at: it tags every
// line a step printed with that step's own number and elapsed time. A failing step with
// no such line said nothing, and docker's account of it is the only one there is.
import { alsoFrom, withSource } from "../ownership.js";
import { pinnedMessage } from "../util.js";

const LOC = /^(\S+):(\d+)[^\S\n]*$/;
const FENCE = /^-{5,}[^\S\n]*$/;
// `   2 | >>> COPY missing-file.txt /tmp/` - BuildKit marks the offending line itself.
// The instruction is read to its last character that is not a space at once: read lazily, it stopped
// at each space of a long stretch and read the rest of the stretch again from there.
export const POINTED = /^[^\S\n]*\d+[^\S\n]*\|[^\S\n]*>>>[^\S\n]?((?:.*\S)?)[^\S\n]*$/;
// It ends where the trailing whitespace starts - see pinnedMessage in util.js.
export const STEP_ERROR = pinnedMessage(String.raw`^#(\d+)[^\S\n]+ERROR:`, { separator: String.raw`[^\S\n]*`, least: 0, tail: "$" });
// Its message ends where the trailing whitespace starts - see pinnedMessage in util.js.
export const FINAL_ERROR = pinnedMessage(String.raw`^ERROR:[^\S\n]+(?:failed to build:[^\S\n]+)?failed to solve:`,
  { separator: String.raw`[^\S\n]*`, least: 0, tail: "$" });
// docker saying that the command it ran exited non-zero. The command said why.
const RELAYED = /^process[^\S\n]+".*"[^\S\n]+did not complete successfully:[^\S\n]+exit code:[^\S\n]*\d+[^\S\n]*$/;
// Docker CLI 28 on macOS uses the first form; Linux commonly uses the second,
// and older Windows clients put the same diagnosis behind `error during connect`.
// These lines are Docker's own failure. Earlier tar-writer errors are consequences of
// the missing daemon and must not become extra diagnoses.
const DAEMON = /^(?:failed to connect to the docker API at .+?(?:daemon is running|connect: .+)|Cannot connect to the Docker daemon at .+|error during connect: .*(?:docker daemon|docker_engine).*)$/i;

/** The build steps of lines [from, to) that printed anything of their own. BuildKit tags a
 *  step's output with the step number and the elapsed time - `#9 0.211 FF.` - and nothing
 *  else it writes about a step takes that shape. Read in one pass: asking the whole log
 *  again for each failed step made a log of many relayed steps quadratic. */
function printingSteps(lines, from, to) {
  const steps = new Set();
  for (let i = from; i < to; i++) {
    const tagged = lines[i].match(/^#(\d+)[^\S\n]+\d+\.\d+[^\S\n]/);
    if (tagged) steps.add(tagged[1]);
  }
  return steps;
}

// BuildKit opens a build by loading its definition, and numbers the steps of each build from 1.
const BUILD_START = /^#1[^\S\n]+\[internal\][^\S\n]+load build definition\b/;

/** The builds a log holds, each the lines [from, to): from where it opens, or where the one
 *  before it ended, to the error that ends it. CI goes on to the next image after one fails,
 *  and read as one build the first build's message took the last build's Dockerfile line -
 *  and step 5 printing in one build made a silent step 5 of another look like it had said
 *  why it failed. */
function builds(lines) {
  const out = [];
  let from = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i > from && BUILD_START.test(lines[i])) { out.push([from, i]); from = i; }
    if (FINAL_ERROR.test(lines[i])) { out.push([from, i + 1]); from = i + 1; }
  }
  if (from < lines.length) out.push([from, lines.length]);
  return out;
}

/** Whether docker is the one to answer for the build in lines [from, to): an error of its
 *  own, or a step that exited non-zero without printing anything. A step that printed is the
 *  inner tool's to explain - a pytest run inside the image says better what failed. */
function answers(lines, from, to) {
  let printing = null;
  for (let i = from; i < to; i++) {
    const st = lines[i].match(STEP_ERROR);
    if (st) {
      if (!RELAYED.test(st[2]) || !(printing ??= printingSteps(lines, from, to)).has(st[1])) return true;
      continue;
    }
    const fin = lines[i].match(FINAL_ERROR);
    if (fin && !RELAYED.test(fin[1])) return true;
  }
  return false;
}

// BuildKit ends a failed build by quoting the failing step's own output between two
// rules, which is the only place that output appears without its `#5 0.070 ` tag:
//
//   ------
//    > [2/2] RUN nosuchcommand --help:
//   0.070 /bin/sh: nosuchcommand: not found
//   ------
//
// Read from here rather than from the tagged lines, because the tags do not always
// survive: a log that arrived with a stray carriage return in it has the per-line shape
// stripped off before any parser sees it, and `#5 ERROR:` becomes `ERROR:`. The quoted
// block comes through either way, and normalize.js already describes it as the cause
// verbatim from whatever tool actually failed.
// The whitespace after the step's number is taken whole: divided with what follows, a long stretch
// was read again from each place in it.
export const QUOTED_STEP = /^[^\S\n]*>[^\S\n]*\[\d+\/\d+\][^\S\n]*(?![^\S\n])(.*):[^\S\n]*$/;
const STAMP = /^\d+\.\d+[^\S\n]/;

/** What the failing step of lines [from, to) said for itself, and the line it was read from.
 *  When the command inside is not a tool anything here knows, this is the only account of
 *  the failure that exists - the relayed line names the command and its exit code, and
 *  neither says why. */
function quotedCause(lines, from = 0, to = lines.length) {
  let head = -1;
  for (let i = from; i < to && head < 0; i++) if (QUOTED_STEP.test(lines[i])) head = i;
  if (head < 0) return null;
  let last = null;
  for (let i = head + 1; i < to && !FENCE.test(lines[i]); i++) {
    const text = lines[i].replace(STAMP, "").trim();
    if (text) last = { text, at: i };
  }
  return last;
}

/** The failure the build in lines [from, to) describes, or null. */
function readBuild(lines, from, to) {
  let printing = null;
  let file, line, stmt, step, final, relayed, excerpt, said;
  // Where each part was read: the step's error, docker's closing one, the relayed exit.
  let stepAt, finalAt, relayedAt, saidAt;
  for (let i = from; i < to; i++) {
    // A location is only docker's if the fenced excerpt follows it, which is also what
    // keeps `foo.py:3` from somewhere else in the log being read as one.
    const at = lines[i].match(LOC);
    if (at && FENCE.test(lines[i + 1] ?? "")) {
      file = at[1]; line = +at[2];
      let j = i + 2;
      for (; j < to && !FENCE.test(lines[j]); j++) {
        const p = lines[j].match(POINTED);
        if (p) stmt = p[1];
      }
      excerpt = [i, Math.min(j, lines.length - 1) + 1];
      continue;
    }
    const st = lines[i].match(STEP_ERROR);
    // BuildKit repeats each step's error at the end, prefixed. Keeping the first
    // real one and ignoring the restatement is what stops the doubled report.
    if (st) {
      if (!RELAYED.test(st[2])) { if (step === undefined) { step = st[2]; stepAt = i; } }
      else if (!relayed && !(printing ??= printingSteps(lines, from, to)).has(st[1])) { relayed = st[2]; relayedAt = i; }
      continue;
    }
    const fin = lines[i].match(FINAL_ERROR);
    if (fin && !RELAYED.test(fin[1]) && final === undefined) { final = fin[1]; finalAt = i; }
  }
  // Last: the failing step's own words, for a relayed failure nothing else explained.
  // Its last line is the cause; the ones above it are progress.
  const spoke = (step ?? final ?? relayed) === undefined ? quotedCause(lines, from, to) : null;
  if (spoke) { said = spoke.text; saidAt = spoke.at; }
  const message = step ?? final ?? relayed ?? said;
  if (!message) return null;
  // The line the message was read from, and the fenced excerpt that located it.
  const at = step !== undefined ? stepAt
    : final !== undefined ? finalAt
    : relayed !== undefined ? relayedAt : saidAt;
  const failure = withSource({
    ...(file ? { file, line } : {}),
    title: "build failed", label: "build failed", severity: "error",
    message, ...(stmt ? { stmt } : {}),
  }, at, at + 1);
  return excerpt ? alsoFrom(failure, ...excerpt) : failure;
}

export default {
  name: "docker",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["ERROR:", "failed to connect to the docker API", "Cannot connect to the Docker daemon", "error during connect:"],
  category: "build",
  commands: ["docker", "buildx", "podman"],

  // An ERROR line is not enough to claim the log: the one BuildKit writes for a step
  // whose command exited non-zero is on every log of a failed `RUN`, and this parser
  // will not read those. Claim only what it can actually answer.
  detect(s) {
    const lines = s.split("\n");
    if (lines.some((l) => DAEMON.test(l))) return true;
    return builds(lines).some(([from, to]) => answers(lines, from, to));
  },

  // Asked only once src/index.js has established that no parser read this log. `detect`
  // above turns down a relayed failure whose step printed something, because that
  // something is usually a tool's own diagnostic and better than anything docker can
  // say. When it is `/bin/sh: nosuchcommand: not found`, no parser reads it, and docker
  // is the only thing in the log that knows which Dockerfile line was running.
  lastResort(s) {
    const lines = s.split("\n");
    return builds(lines).some(([from, to]) => {
      let relayed = false;
      for (let i = from; i < to && !relayed; i++) {
        const st = lines[i].match(STEP_ERROR);
        if (st) { relayed = RELAYED.test(st[2]); continue; }
        const fin = lines[i].match(FINAL_ERROR);
        relayed = !!fin && RELAYED.test(fin[1]);
      }
      return relayed && !!quotedCause(lines, from, to);
    });
  },

  extract(s) {
    const lines = s.split("\n");
    const daemonAt = lines.findIndex((l) => DAEMON.test(l));
    if (daemonAt >= 0) {
      const message = lines[daemonAt].trim();
      return {
        tool: "docker",
        summary: "1 docker error",
        failures: [withSource({
          title: "docker daemon unavailable", label: "docker daemon",
          severity: "error", category: "build", message,
        }, daemonAt, daemonAt + 1)],
      };
    }
    // Each build docker answers for, read on its own. Where it answers for none - every step
    // that failed printed something - this was asked because no parser read what they
    // printed either, and each build's own quoted words are all there is.
    const all = builds(lines);
    const answered = all.filter(([from, to]) => answers(lines, from, to));
    const failures = (answered.length ? answered : all).map(([from, to]) => readBuild(lines, from, to)).filter(Boolean);
    if (!failures.length) return null;
    const n = failures.length;
    return { tool: "docker", summary: `${n} error${n === 1 ? "" : "s"}`, failures };
  },
};
