import { counted, jsonDocuments, jsonDocumentsAt, terminatorFree } from "../util.js";
import { joinSources, withSource } from "../ownership.js";
const MAX_NOTES = 2;
const SPACE = /[^\S\n]/;

/** The match `line` gives the diagnostic pattern
 *    /^(.+?):(\d+)(?::(\d+))?:[^\S\n]+(error|warning|note):[^\S\n]+(.+?)(?:[^\S\n]+\[([^\]]+)\])?$/
 *  read in one pass. The pattern tried the optional `[code]` at every character of the
 *  message, each time reading on to look for its closing bracket: a message of many ` [`
 *  and no `]` was read again from each. A `[code]` can only start after the last `]`
 *  before the one that ends the line, so where it can start is found once, and the message
 *  of each head runs to the first of those places after it, or to the end. */
export function diagnosticLine(line) {
  const n = line.length;
  const clear = terminatorFree(line);
  const opens = [];
  if (line[n - 1] === "]") {
    for (let q = line.lastIndexOf("]", n - 2) + 1; q <= n - 3; q++) if (line[q] === "[" && SPACE.test(line[q - 1] ?? "")) opens.push(q);
  }
  let next = 0;
  const runStart = (q) => { let s = q; while (s > 0 && SPACE.test(line[s - 1])) s--; return s; };
  const head = /:(\d+)(?::(\d+))?:[^\S\n]+(error|warning|note):/y;
  for (let p = line.indexOf(":", 1); p !== -1; p = line.indexOf(":", p + 1)) {
    if (!clear(0, p)) break;
    head.lastIndex = p;
    const m = head.exec(line);
    if (!m) continue;
    const after = head.lastIndex;
    let start = after;
    while (start < n && SPACE.test(line[start])) start++;
    if (start === after) continue;
    const found = (from, to, code) => Object.assign([line, line.slice(0, p), m[1], m[2], m[3], line.slice(from, to), code], { index: 0, input: line, groups: undefined });
    // The message from the end of the whitespace, to the first `[code]` after it or the end.
    while (next < opens.length && opens[next] < start + 2) next++;
    if (next < opens.length) {
      const q = opens[next], end = Math.max(runStart(q), start + 1);
      if (clear(start, end)) return found(start, end, line.slice(q + 1, n - 1));
    } else if (start < n && clear(start, n)) return found(start, n, undefined);
    // Or the whitespace given back: one character of it as the message, before the end of
    // the line or before a `[code]` right after the whitespace.
    if (start === n) {
      if (start - 1 > after && clear(start - 1, n)) return found(start - 1, n, undefined);
    } else if (opens.includes(start)) {
      for (let s = start - 2; s > after; s--) if (clear(s, s + 1)) return found(s, s + 1, line.slice(start + 1, n - 1));
    }
  }
  return null;
}
// mypy only ever reports Python source. "file:line: error: message" is not its shape
// alone - javac writes it, and swiftc writes "<unknown>:0: error: ..." when the driver
// has no source to point at, which a mypy run pasted above it claimed as a fourth type
// error. The detect gate already required an extension on the no-summary path; the
// extract had no such gate, so a run carrying "Found N errors" claimed anything.
const PYTHON_SRC = /\.pyi?$/;
// --output=json writes one record per line rather than one sentence per line. It carries
// a column where the text form prints none, and a `hint` where the text form writes a
// note under the error. Nothing read it, so a run that found four type errors came back
// with no diagnosis at all.
const RECORD = (v) => !!v && typeof v === "object" && !Array.isArray(v) &&
  typeof v.file === "string" && Number.isInteger(v.line) &&
  typeof v.message === "string" && typeof v.severity === "string" &&
  ("hint" in v) && ("code" in v);
const records = (s) => s.includes('"severity"') ? [...jsonDocuments(s, RECORD)] : [];
// ...with where each was written, for reading them rather than deciding.
const placedRecords = (s) => s.includes('"severity"') ? [...jsonDocumentsAt(s, RECORD)] : [];

export default {
  name: "mypy",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["\"severity\"", "Found ", ".py"],
  category: "typecheck",
  commands: ["mypy"],
  detect: (s) =>
    (records(s).length > 0 ||
      /^[^\S\n]*Found \d+ errors? in \d+ files?/m.test(s) ||
      // Python source and stubs can include columns and omit the summary.
      // A bare file:line diagnostic also matches javac, so require an extension.
      /^.+\.pyi?:\d+(?::\d+)?:[^\S\n]+(?:error|warning|note):[^\S\n]+/m.test(s)),

  extract(s) {
    // mypy reports a problem with its own invocation - an unreadable file, a bad flag -
    // as "mypy: error: ...", with no file:line for the diagnostic pattern to find.
    const own = s.match(/^mypy: error: (.+)$/m);
    const lines = s.split("\n");
    const ownAt = own ? lines.findIndex((l) => /^mypy: error: (.+)$/.test(l)) : -1;
    const failures = [];
    let warnings = 0;
    for (let i = 0; i < lines.length; i++) {
      const match = diagnosticLine(lines[i]);
      if (!match || match[4] === "note" || !PYTHON_SRC.test(match[1])) continue;
      if (match[4] === "warning") { warnings++; continue; }
      // A note at the SAME file and line continues this error - for a call-overload
      // failure the notes carry the valid signatures, which is the whole answer.
      // Notes elsewhere are separate remarks and stay out.
      const notes = [];
      for (let j = i + 1; j < lines.length && notes.length < MAX_NOTES; j++) {
        const n = diagnosticLine(lines[j]);
        if (!n || n[4] !== "note" || n[1] !== match[1] || n[2] !== match[2]) break;
        notes.push(n[5]);
      }
      // The error's line and the notes under it that continue it.
      failures.push(withSource({
        file: match[1], line: +match[2], col: match[3] ? +match[3] : undefined,
        title: match[6] ?? "mypy", code: match[6], severity: match[4], 
        message: [match[5], ...notes].join("\n"),
      }, i, i + 1 + notes.length));
    }
    // ...and the same diagnostics as --output=json writes them. A record already read
    // from the text form is not read twice; the formats differ only over the column,
    // which the text form does not print unless it is asked to.
    const seen = new Map();
    failures.forEach((f, i) => { const key = [f.file, f.line, f.code].join("\u0000"); if (!seen.has(key)) seen.set(key, i); });
    const found = placedRecords(s);
    for (let i = 0; i < found.length; i++) {
      const r = found[i].value;
      if (r.severity === "note" || !PYTHON_SRC.test(r.file)) continue;
      if (r.severity !== "error") { warnings++; continue; }
      const key = [r.file, r.line, r.code ?? undefined].join("\u0000");
      // A note at the same position continues this error, exactly as it does in the
      // text form - for a call-overload failure the notes carry the valid signatures.
      const notes = [];
      let last = found[i];
      if (r.hint) notes.push(String(r.hint));
      for (let j = i + 1; j < found.length && notes.length < MAX_NOTES; j++) {
        const n = found[j].value;
        if (n.severity !== "note" || n.file !== r.file || n.line !== r.line) break;
        notes.push(n.message);
        last = found[j];
      }
      // The record, and the notes written after it.
      const failure = withSource({
        file: r.file, line: r.line,
        col: Number.isInteger(r.column) ? r.column : undefined,
        title: r.code ?? "mypy", code: r.code ?? undefined, severity: "error",
        message: [r.message, ...notes].join("\n"),
      }, found[i].where().start, last.where().end);
      if (seen.has(key)) { failures[seen.get(key)] = joinSources(failures[seen.get(key)], failure); continue; }
      seen.set(key, failures.length);
      failures.push(failure);
    }
    if (own) {
      failures.push(withSource({ title: "mypy", label: "mypy", severity: "error", message: own[1] }, ownAt, ownAt + 1));
    }
    if (!failures.length) return null;
    const summaryMatch = s.match(/^[^\S\n]*Found (\d+) errors? in (\d+) files?/m);
    const summary = summaryMatch
      ? `${summaryMatch[1]} error${summaryMatch[1] === "1" ? "" : "s"} in ${summaryMatch[2]} file${summaryMatch[2] === "1" ? "" : "s"}`
      : counted(failures.length, "error");
    return {
      tool: "mypy",
      summary: warnings ? `${summary} — ${warnings} warning${warnings > 1 ? "s" : ""} hidden` : summary,
      failures,
    };
  },
};
