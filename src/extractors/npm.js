import { findJsonDocument, jsonDocumentsAt } from "../util.js";
import { alsoFrom, withSource } from "../ownership.js";
// npm's own failures - a missing script, a bad engine, an unreachable registry.
// Modern npm prefixes every line with "npm error"; older versions used "npm ERR!".
// Neither starts with the word "error", so the generic fallback never matched them
// and the whole run came back silent.
const LINE_RE = /^npm (?:error|ERR!)\s?(.*)$/;
// npm's codes are not all words. ERESOLVE and ENOENT are, but a registry failure is
// E404, E401, E403 - and a pattern written E[A-Z_]+ matches none of those, so the line
// naming the code was read as the first line of the MESSAGE and the failure carried no
// code at all. What npm declares there is "code" and then whatever it calls it.
const CODE_RE = /^code[^\S\n]+([A-Z][A-Z0-9_]*|\d+)[^\S\n]*$/;
// what npm says after it has already told you the problem
const CHATTER = [
  /^A complete log of this run can be found in/,
  /^To see a list of scripts, run/,
  /^[^\S\n]*npm run[^\S\n]*$/,
  /^This is (?:probably not )?a problem with npm/,
  /^Log files were not written/,
  /^errno\s/,
  // npm's standing advice for a package it could not fetch. It is the same two lines
  // whatever the package was, and keeping them spends the message on saying nothing.
  /^Note that you can also install from a$/,
  /^tarball, folder, http url, or git url\.$/,
  // ...and for a dependency tree it could not resolve, which says where the full report went.
  /^Fix the upstream dependency conflict, or retry this command with --force/,
  /^For a full report see:$/,
  /^\S*[\\/]_logs[\\/]\S+$/,
];
// The last line of a run's block, after which the next run's starts.
const FOOTER = /^A complete log of this run can be found in/;
// ERESOLVE needs four: what failed, which package's tree it was, what it found there, and the
// requirement it could not meet - the conflict itself, which a budget of three cut off.
const MAX_MESSAGE_LINES = 4;

// `npm --json` writes its diagnosis twice: the same "npm error" block on stderr, and a
// document on stdout. A pipeline that keeps only stdout keeps only the document - and
// nothing read it, so a failed install came back with no diagnosis at all.
//
// The shape is npm's own: an object whose only business is an `error` carrying the code
// it just printed, a one-line summary and the detail under it.
const REPORT = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !!v.error &&
  typeof v.error === "object" && typeof v.error.code === "string" &&
  typeof v.error.summary === "string" && typeof v.error.detail === "string";
const report = (s) => s.includes('"summary"') ? findJsonDocument(s, REPORT) : null;

export default {
  name: "npm",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["npm error", "npm ERR!", "\"summary\""],
  category: "package",
  commands: ["npm", "pnpm", "yarn"],
  commandHints: [],
  detect: (s) => /^npm (?:error|ERR!)\s/m.test(s) || report(s) !== null,

  extract(s) {
    const lines = s.split("\n");
    // Each run's block ends with the line saying where its whole log was written. A log
    // holding two runs holds two blocks, and read as one the second run's lines went under
    // the first run's code - or past the end of its message.
    const runs = [];
    let run = null;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(LINE_RE);
      if (!m) continue;
      run ??= { code: "", codeAt: -1, msg: [] };
      const t = m[1].trim();
      const c = t.match(CODE_RE);
      if (c) { if (!run.code) { run.code = c[1]; run.codeAt = i; } }
      // An indented line under a sentence is the dependency chain behind it, and a line
      // naming a node_modules directory is where that package sits: ERESOLVE's report is
      // made of both, and they took the lines that say what the conflict is.
      else if (t && !/^[^\S\n]/.test(m[1]) && !/^node_modules[\\/]/.test(t)) run.msg.push({ text: t, at: i });
      if (FOOTER.test(t)) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    for (const r of runs) {
      // npm repeats the code in front of every line of the block it belongs to -
      // "npm error 404 Not Found - GET ..." - and prints the bare code on the lines
      // between them. Once the code is the code, saying it again on every line is noise -
      // and the noise was being counted against the budget below, so the lines that said
      // WHICH package could not be fetched fell off the end of a three-line message.
      // A registry failure is coded E404 and then prefixed 404, because the number is the
      // HTTP status underneath it. That is the only case where the two differ, and it is
      // bounded to it: EPERM is not stripped down to PERM.
      const repeated = [r.code, /^E\d+$/.test(r.code) ? r.code.slice(1) : null].filter(Boolean);
      r.said = []; r.saidAt = [];
      let kept = -1;
      for (const [k, { text: line, at }] of r.msg.entries()) {
        let without = line;
        for (const token of repeated) {
          if (without === token) { without = ""; break; }
          without = without.replace(new RegExp(`^${token}[^\\S\\n]+`), "").trim();
        }
        // ...and only then is it chatter or not. npm prints its standing advice behind the
        // same repeated prefix as the diagnosis, so a chatter test run before the prefix
        // came off never matched it, and half the message was spent on it.
        if (!without || CHATTER.some((re) => re.test(without))) continue;
        // A sentence that ends in a colon is finished by the line under it: "Could not
        // resolve dependency:" says nothing until the requirement after it does.
        if (kept === k - 1 && r.said.at(-1)?.endsWith(":")) { r.said[r.said.length - 1] += ` ${without}`; kept = k; continue; }
        if (r.said.length >= MAX_MESSAGE_LINES) break;
        r.said.push(without);
        r.saidAt.push(at);
        kept = k;
      }
    }
    const said = runs.flatMap((r) => r.said);

    // The document says the same thing, so it is only read when the block is not there.
    // Where both are, the block is what npm showed the person running it.
    if (!said.length) {
      let doc = null, where = null;
      if (s.includes('"summary"')) for (const found of jsonDocumentsAt(s, REPORT)) { ({ value: doc, where } = found); break; }
      if (!doc) return null;
      const detail = doc.error.detail.split("\n").map((l) => l.trim())
        .filter((l) => l && !CHATTER.some((re) => re.test(l)));
      const { start, end } = where(doc.error);
      return {
        tool: "npm",
        summary: undefined,
        failures: [withSource({
          title: doc.error.code, code: doc.error.code, severity: "error",
          message: [doc.error.summary.trim(), ...detail].slice(0, MAX_MESSAGE_LINES).join("\n"),
        }, start, end)],
      };
    }
    // The lines of npm's block the message was read from, and the one that named the code.
    const failures = runs.filter((r) => r.said.length).map(({ code, codeAt, said: message, saidAt }) => {
      let failure = withSource({
        title: code, ...(code ? { code } : { label: "npm" }),
        severity: "error", message: message.join("\n"),
      }, saidAt[0], saidAt[0] + 1);
      for (const at of [...saidAt.slice(1), ...(codeAt >= 0 ? [codeAt] : [])]) failure = alsoFrom(failure, at, at + 1);
      return failure;
    });
    return {
      tool: "npm",
      summary: undefined,
      // npm only sometimes prints a code (ENOENT, ELIFECYCLE). Without one the failure
      // still has to say what it is, or it reads as unclassified and gets filtered as an
      // unanchored claim when it turns up alongside another tool's output.
      failures,
    };
  },
};
