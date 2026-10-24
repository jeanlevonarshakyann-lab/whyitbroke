// Terraform draws each diagnostic in a box, and everything inside it is prefixed with a
// vertical bar that is part of the drawing rather than the message:
//
//   ╷
//   │ Error: Missing required argument
//   │
//   │   on main.tf line 1, in resource "local_file" "demo":
//   │    1: resource "local_file" "demo" {
//   │
//   │ The argument "filename" is required, but no definition was found.
//   ╵
//
// Read as prose that comes to "│ Error: Missing required argument" and nothing else -
// no file, no line, and not the sentence at the bottom that says what to do about it.
import { sourceRange, withSource } from "../ownership.js";
import { append, jsonDocumentsAt } from "../util.js";

const BAR = /^[^\S\n]*[│|][^\S\n]?/;
const HEAD_RE = /^[^\S\n]*[│|][^\S\n]*(Error|Warning):[^\S\n]*(.*)$/;
// The whitespace in front of the block's name is taken whole; the name starts inside it only on the
// last of it, right before the colon, as it did. From each place in a long stretch the pattern read
// the rest of the line again.
export const AT_RE = /^[^\S\n]*on[^\S\n]+(\S+)[^\S\n]+line[^\S\n]+(\d+)(?:,[^\S\n]+in(?:[^\S\n]+(?![^\S\n])|[^\S\n]+(?=[^\S\n\r\u2028\u2029]:[^\S\n]*$))(.+?))?:[^\S\n]*$/;
const SRC_RE = /^[^\S\n]*\d+:[^\S\n]?(.*)$/;
const CLOSE_RE = /^[^\S\n]*[╵╷][^\S\n]*$/;
const MAX_MESSAGE = 4;

// `terraform init` does not draw a box. It writes the error flat, with the explanation
// indented under it and no location at all, because nothing has been parsed yet:
//
//   Initializing provider plugins...
//   Error: Invalid provider registry host
//   The host "example.com" given in provider source address ... does not offer a
//   Terraform provider registry.
//
// "Error: <anything>" is every tool's shape, so what identifies this one is the banner
// terraform prints above it. Without this branch a failed `init` - the first command
// anyone runs, and the one that fails on a bad provider or an unreachable backend -
// came back as a guess.
const INIT_BANNER_RE = /^[^\S\n]*Initializing (?:the backend|provider plugins|modules)\b/m;
const FLAT_HEAD_RE = /^(Error|Warning):[^\S\n]*(.*)$/;

// What `terraform validate -json` writes: one document per run, holding every diagnostic.
const REPORT = (value) => !!value && typeof value === "object" && typeof value.format_version === "string" &&
  typeof value.valid === "boolean" && Number.isInteger(value.error_count) &&
  Number.isInteger(value.warning_count) && Array.isArray(value.diagnostics);

/** Terraform's `validate -json` document(s), even when another tool wrote beside it, each
 *  with the lines [start, end) it was written on. They are found by the scan every JSON
 *  reader shares. This reader once kept its own: it counted the braces of every line of
 *  any log that named "format_version", into three arrays the length of the log in lines -
 *  sixteen bytes a line, 160MiB for a 10MiB log of empty lines. */
function jsonReports(text) {
  if (!text.includes('"format_version"')) return [];
  return [...jsonDocumentsAt(text, REPORT)].map(({ value, where }) => ({ value, ...where(value) }));
}

/** Diagnostic events from Terraform's newline-delimited `plan -json` UI stream. */
function jsonEvents(text) {
  // Every event read here names Terraform's UI module, so a log that never does holds none.
  if (!text.includes("terraform.ui")) return [];
  const events = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Parse only Terraform diagnostic candidates. A mixed machine log may contain
    // thousands of JSON events from other tools, and none should become ours merely
    // because it has a `diagnostic` property.
    if (!line.startsWith("{") || !line.endsWith("}") ||
        !/"@module"\s*:\s*"terraform\.ui"/.test(line) ||
        !/"type"\s*:\s*"diagnostic"/.test(line)) continue;
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    const diagnostic = value?.diagnostic;
    if (value?.["@module"] !== "terraform.ui" || value?.type !== "diagnostic" ||
        !diagnostic || typeof diagnostic !== "object") continue;
    events.push({ value: { diagnostics: [diagnostic] }, start: i, end: i + 1 });
  }
  return events;
}

function jsonDiagnostics(text) {
  const failures = [];
  let warnings = 0;
  for (const report of [...jsonReports(text), ...jsonEvents(text)]) {
    for (const diagnostic of report.value.diagnostics) {
      if (!diagnostic || typeof diagnostic.summary !== "string") continue;
      if (diagnostic.severity === "warning") { warnings++; continue; }
      if (diagnostic.severity !== "error") continue;
      const range = diagnostic.range;
      const start = range?.start;
      const snippet = diagnostic.snippet;
      const snippetLine = Number.isInteger(start?.line) && Number.isInteger(snippet?.start_line)
        ? String(snippet.code ?? "").split("\n")[start.line - snippet.start_line]
        : undefined;
      // One JSON document is the raw region that supports every diagnostic it carries.
      failures.push(withSource({
        file: range?.filename, line: start?.line, col: start?.column,
        title: diagnostic.summary, subject: snippet?.context, severity: "error",
        message: typeof diagnostic.detail === "string" && diagnostic.detail.trim()
          ? diagnostic.detail.trim() : diagnostic.summary,
        ...(snippetLine?.trim() ? { stmt: snippetLine.trim() } : {}),
      }, report.start, report.end));
    }
  }
  return { failures, warnings };
}

/** `terraform validate -no-color` omits the box on current Terraform releases. */
function flatValidateDiagnostics(text) {
  const lines = text.split("\n");
  const failures = [];
  let warnings = 0;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(FLAT_HEAD_RE);
    if (!head) continue;
    let file, line, subject, stmt, end = i + 1;
    const detail = [];
    for (let j = i + 1; j < lines.length && j <= i + 16; j++) {
      if (FLAT_HEAD_RE.test(lines[j])) break;
      const inner = lines[j].trim();
      // A blank after the prose ends this diagnostic. Without this boundary, the first
      // lines of whatever command ran next were appended to Terraform's message in a
      // mixed CI log, changing the failure even though its count happened to agree.
      if (!inner && detail.length) break;
      const at = inner.match(AT_RE);
      if (at) { file ??= at[1]; line ??= +at[2]; subject ??= at[3]; end = j + 1; continue; }
      const source = inner.match(SRC_RE);
      if (source) {
        if (+inner.slice(0, inner.indexOf(":")) === line) stmt ??= source[1].trim();
        end = j + 1;
        continue;
      }
      if (file && inner && detail.length < MAX_MESSAGE) { detail.push(inner); end = j + 1; }
    }
    // `Error:` is universal. The nearby Terraform location is what owns this form.
    if (!file || !/\.tf(?:\.json)?$/.test(file) || !line) continue;
    if (head[1] === "Warning") { warnings++; continue; }
    // The header, its location, the source it quotes and the prose under it.
    failures.push(withSource({
      file, line, title: head[2].trim(), subject, severity: "error",
      message: detail.length ? detail.join("\n") : head[2].trim(), stmt,
    }, i, end));
  }
  return { failures, warnings };
}

// terraform refusing a subcommand it does not have. One sentence, no box, no "Error:" -
// and it is the whole log of a pipeline that stopped before it touched any state, usually
// because a script names a subcommand this version of terraform does not ship.
const NO_COMMAND_RE = /^(?:Terraform|OpenTofu|Tofu) has no command named "([^"\n]+)"\.?[^\S\n]*$/m;
const NO_COMMAND_LINE = new RegExp(NO_COMMAND_RE.source);

export default {
  name: "terraform",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["\"format_version\"", "\"terraform.ui\"", "Error:", "Warning:", "has no command named"],
  category: "build",
  commands: ["terraform", "tofu", "terragrunt"],

  detect: (s) =>
    jsonReports(s).length > 0 || jsonEvents(s).length > 0 ||
    (HEAD_RE.test(s.split("\n").find((l) => HEAD_RE.test(l)) ?? "") &&
      (/^[^\S\n]*╷[^\S\n]*$/m.test(s) || /[^\S\n]on[^\S\n]+\S+[^\S\n]+line[^\S\n]+\d+/.test(s))) ||
    flatValidateDiagnostics(s).failures.length > 0 ||
    (INIT_BANNER_RE.test(s) && s.split("\n").some((l) => FLAT_HEAD_RE.test(l))) ||
    NO_COMMAND_RE.test(s),

  extract(s) {
    const lines = s.split("\n");
    const json = jsonDiagnostics(s);
    const flat = flatValidateDiagnostics(s);
    const failures = [...json.failures, ...flat.failures];
    let warnings = json.warnings + flat.warnings;
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(HEAD_RE);
      if (!h) continue;
      let file, line, block, stmt, end = i + 1;
      const message = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (CLOSE_RE.test(lines[j]) || HEAD_RE.test(lines[j])) break;
        if (!BAR.test(lines[j])) break;
        end = j + 1;
        const inner = lines[j].replace(BAR, "").trimEnd();
        const at = inner.match(AT_RE);
        if (at) { file ??= at[1]; line ??= +at[2]; block ??= at[3]; continue; }
        const src = inner.match(SRC_RE);
        if (src) { stmt ??= src[1].trim(); continue; }
        if (inner.trim() && message.length < MAX_MESSAGE) message.push(inner.trim());
      }
      if (h[1] !== "Error") { warnings++; continue; }
      // The boxed diagnostic, from its header down to the box's last line.
      failures.push(withSource({
        file, line, title: h[2], subject: block, severity: "error",
        // The headline is already the title; repeating it as the first line of the
        // message says it twice. The prose underneath is what it did not say.
        message: (message.length ? message : [h[2]]).join("\n"), stmt,
      }, i, end));
    }
    if (INIT_BANNER_RE.test(s)) {
      // Bounded to the window after terraform's own banner. init says what it is doing
      // and then why it stopped, so its errors sit directly under the last "Initializing
      // ..." or "- Finding ..." line it wrote. Scanning the whole log for "Error: " -
      // which is every tool's shape - had terraform claiming Go's expected-error strings
      // out of a test log, fifteen of them.
      // Not a window - the very next thing it says. init narrates what it is doing and
      // then why it stopped, so the error is the first non-blank line after the last
      // step. A window of a dozen lines still reached past terraform's own output into
      // whatever followed it, and took sass's "Error: Undefined variable." with it.
      // ...after each narration: a log can hold more than one init, and the last step of
      // the whole log was the only place an error was looked for - and only where nothing
      // else had been found.
      const INIT_STEP_RE = /^[^\S\n]*(?:Initializing |- (?:Finding|Installing|Using|Downloading) )/;
      const read = new Uint8Array(lines.length);
      for (const f of failures) {
        const range = sourceRange(f);
        if (range) for (const { start: from, end: to } of range.also ? [range, ...range.also] : [range]) read.fill(1, from, to);
      }
      const stops = [];
      for (let i = 0, narrating = false; i < lines.length; i++) {
        if (INIT_STEP_RE.test(lines[i])) { narrating = true; continue; }
        if (!narrating || !lines[i].trim()) continue;
        stops.push(i);   // the first thing said after the narration, whatever it is
        narrating = false;
      }
      // The flat form. The prose under the header is the explanation; a blank line or
      // the next header ends it, and there is no location to find because init runs
      // before anything has been parsed.
      for (const i of stops) {
        const h = lines[i].match(FLAT_HEAD_RE);
        if (!h || read[i]) continue;
        // A blank line separates the header from the prose, so it cannot end it - but a
        // blank AFTER the prose has started does.
        const prose = [];
        let end = i + 1;
        for (let j = i + 1; j < lines.length && j <= i + 8 && prose.length < MAX_MESSAGE; j++) {
          if (FLAT_HEAD_RE.test(lines[j])) break;
          if (!lines[j].trim()) { if (prose.length) break; else continue; }
          prose.push(lines[j].trim());
          end = j + 1;
        }
        if (h[1] === "Warning") { warnings++; continue; }
        failures.push(withSource({
          title: h[2].trim(), label: h[2].trim(), severity: "error",
          message: prose.length ? prose.join(" ") : h[2].trim(),
        }, i, end));
      }
    }
    // A refused subcommand ran nothing, so it is a failure of its own - each one, beside
    // whatever another run in the log said. Only the first was read, and only where there
    // was nothing else.
    const refused = [];
    lines.forEach((line, i) => {
      const m = line.match(NO_COMMAND_LINE);
      if (!m) return;
      refused.push(withSource({ title: m[1], subject: m[1], severity: "error", message: line.trim() }, i, i + 1));
    });
    if (refused.length && !failures.length) {
      const n = refused.length;
      return { tool: "terraform", summary: n === 1 ? "the command was refused" : `${n} commands were refused`, failures: refused };
    }
    append(failures, refused);
    if (!failures.length) return null;
    const n = failures.length;
    return {
      tool: "terraform",
      summary: `${n} error${n > 1 ? "s" : ""}` +
        (warnings ? ` — ${warnings} warning${warnings > 1 ? "s" : ""} hidden` : ""),
      failures,
    };
  },
};
