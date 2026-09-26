import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fingerprint, legacyFingerprint, causeId, keyOf } from "./cluster.js";

// Comparing two runs is only meaningful when they asked the same question. A pytest
// run and a jest run share no vocabulary; `pytest tests/unit` and `pytest tests/api`
// do not even cover the same code, so a cause missing from the second is not a cause
// that was fixed. The identity below is therefore the whole invocation, and runs that
// differ in any part of it simply never meet.
// 3: records now include every tool's causes, qualified by tool. Earlier records
// omitted secondary tools, so comparing them would invent new failures on upgrade.
// 4: a compile failure's echoed source line no longer enters its cause key - it is the
// instance, not the identity - so every such cause is fingerprinted differently. A
// record written before this would compare as all-new.
// 5: persistent identifiers move from 32-bit FNV-1a to a 96-bit SHA-256 prefix. A v4
// record can still be compared once using its legacy IDs, then the current run is saved
// under the new identity. Claims that causes disappeared are withheld during that one
// transition because a legacy collision cannot be disproved from the saved hashes.
// 6: the tool leaves the key and a weak signature gains a discriminator. The tool had to
// go because a command that SUCCEEDS prints no output to name a tool with, so a green run
// could not write the empty baseline that says "nothing is failing here now" - and the
// next time the same failure came back, whyitbroke called it nothing new. What the command
// was is already in its argv. A v5 record is not migrated: its causes were fingerprinted
// before `historyKeyOf` existed, so half of them would be read as different bugs. It is
// ignored instead, and the run after an upgrade says it is the first tracked one.
const IDENTITY_VERSION = 6;
const LEGACY_IDENTITY_VERSION = 4;

/** Identical words from different tools are separate causes in a mixed run. */
export const trackedCauseId = (failure, tool = failure.tool) =>
  fingerprint(JSON.stringify([tool ?? "", causeId(failure)]));

const legacyCauseId = (failure) => legacyFingerprint(keyOf(failure));
export const legacyTrackedCauseId = (failure, tool = failure.tool) =>
  legacyFingerprint(JSON.stringify([tool ?? "", legacyCauseId(failure)]));

/** Where a run's fingerprints live. Never the project: whyitbroke promises it writes
 *  nothing into your working directory, and a tool that quietly drops a state file
 *  next to your source has broken that promise however useful the feature is. */
export function cacheDir(env = process.env) {
  if (env.WHYITBROKE_CACHE_DIR) return env.WHYITBROKE_CACHE_DIR;
  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA || env.APPDATA || tmpdir(), "whyitbroke");
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "whyitbroke");
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "whyitbroke");
}

/** A stable name for "this command, in this directory" - or for a pipeline the user
 *  named with --id.
 *
 *  null where there is nothing honest to key on. A piped log carries no argv: every
 *  `... | whyitbroke --since-last` run from one directory used to share a single record,
 *  so `pytest tests/unit` and `pytest tests/api` overwrote each other's history and each
 *  reported the other's failures as newly gone - a claim that something was FIXED, made
 *  about a suite that had not run. Guessing the upstream command from its output is not
 *  available either: the log is what is in question. So an unnamed pipe is not compared
 *  and not recorded, and --id is how a pipeline says which one it is. */
export function runIdentity({ cwd, argv, tool = null, id = null }) {
  const piped = !argv?.length;
  // A named PIPELINE keeps the tool in its key: a CI job that pipes eslint and then
  // pytest under one --id wants two records rather than one that each run wipes, and a
  // pipe has no green case to need a toolless key for - its exit status is never known.
  // A named COMMAND still needs its argv in the key: --id "ci" may be reused for
  // different test selections, which cannot claim each other's failures are gone.
  // The tool stays out so that a green run writes to the same key as a failing one.
  if (id) return fingerprint(JSON.stringify([IDENTITY_VERSION, resolve(cwd), "id", String(id), piped ? tool ?? "" : argv]));
  if (piped) return null;
  return fingerprint(JSON.stringify([IDENTITY_VERSION, resolve(cwd), argv]));
}

/** The same run under the scheme before this one, or null where there cannot be one.
 *
 *  That scheme had no --id: every record it wrote was keyed on the directory, the tool and
 *  the argv alone, so a piped run's record was keyed on the directory and tool alone. A
 *  named pipeline therefore has no legacy record of its OWN - and the one sitting under
 *  its directory and tool was written by some unnamed pipe, which is the sharing --id
 *  exists to end. Migrating it would hand a brand-new pipeline another one's history and
 *  call it compared. There is nothing to migrate. */
export function legacyRunIdentity({ cwd, tool, argv, id = null }) {
  if (id) return null;
  return legacyFingerprint(JSON.stringify([
    LEGACY_IDENTITY_VERSION,
    resolve(cwd),
    tool ?? "",
    argv ?? [],
  ]));
}

const fileFor = (identity) => join(cacheDir(), `${identity}.json`);

function readRun(identity, version) {
  return readRunState(identity, version).record;
}

/** Read a record without collapsing "absent", "unreadable" and "invalid" into the
 * same answer. The CLI must not replace a record it failed to understand: doing so
 * silently erased the last trustworthy baseline and made an old failure look new on a
 * later run. `loadRun` keeps its historical null-returning API; stateful callers use
 * this richer result. */
function readRunState(identity, version) {
  if (!identity) return { record: null, state: "missing" };
  let raw;
  try {
    raw = readFileSync(fileFor(identity), "utf8");
  } catch (error) {
    return { record: null, state: error?.code === "ENOENT" ? "missing" : "unavailable" };
  }
  let saved;
  try { saved = JSON.parse(raw); }
  catch { return { record: null, state: "invalid" }; }
  if (saved?.version !== version || !Array.isArray(saved.causes)) return { record: null, state: "invalid" };
  const id = version === IDENTITY_VERSION ? /^[0-9a-f]{24}$/ : /^[0-9a-f]{8}$/;
  if (!saved.causes.every((cause) => typeof cause === "string" && id.test(cause))) {
    return { record: null, state: "invalid" };
  }
  if (new Set(saved.causes).size !== saved.causes.length) return { record: null, state: "invalid" };
  // Current records always spell out the tool, including `null` after a green run.
  // Missing it bypassed the tool-switch guard and allowed a false "gone" claim.
  if (version === IDENTITY_VERSION && !Object.hasOwn(saved, "tool")) return { record: null, state: "invalid" };
  if (saved.tool !== undefined && saved.tool !== null && typeof saved.tool !== "string") {
    return { record: null, state: "invalid" };
  }
  if (saved.ranAt !== undefined && saved.ranAt !== null && typeof saved.ranAt !== "string") {
    return { record: null, state: "invalid" };
  }
  return { record: saved, state: "valid" };
}

export const loadRun = (identity) => readRun(identity, IDENTITY_VERSION);
export const loadLegacyRun = (identity) => readRun(identity, LEGACY_IDENTITY_VERSION);
export const loadRunState = (identity) => readRunState(identity, IDENTITY_VERSION);

/** Write via a temporary file and rename, so an interrupted run leaves the previous
 *  state intact rather than a half-written file that reads as "nothing was failing". */
export function saveRun(identity, record) {
  const target = fileFor(identity);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const existing = readRunState(identity, IDENTITY_VERSION).state;
    if (existing === "invalid" || existing === "unavailable") return false;
    writeFileSync(temp, JSON.stringify({ version: IDENTITY_VERSION, ...record }));
    renameSync(temp, target);
    return true;
  } catch {
    try { unlinkSync(temp); } catch { /* nothing to clean up */ }
    return false;   // a cache that cannot be written must never fail the run
  }
}

/** What this run can honestly say about the last one.
 *
 *  `fresh` is a claim about presence and is always safe: this cause was not in the
 *  previous run's list. `gone` is a claim about ABSENCE, and absence is only evidence
 *  when the current run actually got far enough to speak. A truncated capture, a
 *  command that never started, or a run whose parser found nothing all produce an
 *  empty-ish list for reasons that have nothing to do with anything being fixed - so
 *  in those cases the count is withheld rather than guessed at. */
export function compare(previous, currentIds, { truncated = false, trustworthy = true, tool = null } = {}) {
  if (!previous) return { compared: false, reason: "no-previous-run", fresh: [], gone: null };
  const before = new Set(previous.causes);
  const fresh = currentIds.filter((id) => !before.has(id));
  // Both directions are set membership. Scanning the current list once per remembered
  // cause made a run with a thousand of each do a million comparisons for an answer that
  // is one number, and a suite big enough to want --since-last is exactly the one that
  // has them.
  const now = new Set(currentIds);
  // The same argv can run a different tool than it did last week - `npm test` moved from
  // jest to vitest - and then every cause is missing for a reason that is not a fix.
  const switched = Boolean(tool && previous.tool && previous.tool !== tool);
  const gone = truncated || !trustworthy || switched ? null
    : previous.causes.filter((id) => !now.has(id)).length;
  return {
    compared: true,
    reason: null,
    fresh,
    gone,
    ranAt: previous.ranAt ?? null,
    goneWithheld: gone === null
      ? (truncated ? "truncated" : switched ? "tool-changed" : "run-not-comparable")
      : null,
  };
}
