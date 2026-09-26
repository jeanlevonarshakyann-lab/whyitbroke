import { normTitle } from "./cluster.js";
import { TRUNCATION_NOTICE, wrapperName } from "./report.js";

// The runner unescapes only these three in a message body. Escaping a colon there
// too leaves "AssertionError%3A expected 1" on screen, so : and , are escaped in
// property values only - where the , and :: separators genuinely need it.
const escapeData = (value) => String(value)
  .replace(/%/g, "%25")
  .replace(/\r/g, "%0D")
  .replace(/\n/g, "%0A");
const escapeAnnotation = (value) => escapeData(value)
  .replace(/:/g, "%3A")
  .replace(/,/g, "%2C");

// GitHub accepts at most ten warning/error annotations from one workflow step, limits
// each annotation message to 64 KiB, and caps a step summary at 1 MiB. Stay below the
// byte limits after workflow-command escaping and always leave room to say what was
// omitted and where the complete machine-readable report can be found.
const MAX_ANNOTATIONS = 10;
const MAX_ANNOTATION_BYTES = 60 * 1024;
const MAX_PROPERTY_BYTES = 4096;
const MAX_SUMMARY_BYTES = 1024 * 1024;
const ANNOTATION_CLIPPED = " [message truncated; use --json for the complete report]";
const SUMMARY_CLIPPED = "\n\n> Summary truncated to GitHub's limit. Use `--json` for the complete report.\n";

function prefixByBytes(value, budget, encode = String) {
  let out = "", bytes = 0;
  for (const char of String(value ?? "")) {
    const encoded = encode(char);
    const size = Buffer.byteLength(encoded);
    if (bytes + size > budget) break;
    out += encoded;
    bytes += size;
  }
  return out;
}

function boundText(value, limit, suffix) {
  const text = String(value ?? "");
  if (Buffer.byteLength(text) <= limit) return text;
  return prefixByBytes(text, Math.max(0, limit - Buffer.byteLength(suffix))) + suffix;
}

function annotation(f, tool) {
  const params = [];
  if (f.file) {
    const file = escapeAnnotation(f.file);
    // A truncated file would point at a different path. Omit an impossible property
    // instead; the complete location remains in the summary and JSON report.
    if (Buffer.byteLength(file) <= MAX_PROPERTY_BYTES) params.push(`file=${file}`);
  }
  if (f.line) params.push(`line=${f.line}`);
  if (f.col) params.push(`col=${f.col}`);
  // Name the producing tool when it is not the one that owns the log, so a reader can
  // tell an eslint marker from a jest one at a glance.
  const label = [tool, f.title].filter(Boolean).join(" ");
  if (label) {
    const encoded = escapeAnnotation(label);
    params.push(`title=${Buffer.byteLength(encoded) <= MAX_PROPERTY_BYTES
      ? encoded : prefixByBytes(label, MAX_PROPERTY_BYTES - 3, escapeAnnotation) + "..."}`);
  }
  const prefix = `::error${params.length ? ` ${params.join(",")}` : ""}::`;
  const raw = f.message ?? f.stmt ?? "Command failed";
  const whole = prefix + escapeData(raw);
  if (Buffer.byteLength(whole) <= MAX_ANNOTATION_BYTES) return whole;
  const budget = Math.max(0, MAX_ANNOTATION_BYTES - Buffer.byteLength(prefix + ANNOTATION_CLIPPED));
  return prefix + prefixByBytes(raw, budget, escapeData) + ANNOTATION_CLIPPED;
}

// The step summary is the one screen a human actually reads in CI, so it leads with
// causes exactly like the terminal does. Annotations stay one per failure - each is a
// marker on a line in the diff view, and dropping one hides a line - so nothing here
// removes information, it only decides what sits above the fold.
function summaryOf(report) {
  const markdown = (value) => String(value)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+\-.!|<>])/g, "\\$1")
    .replace(/\r?\n/g, " ");
  // A code span needs no escaping and must not receive any. It must also not contain
  // a backtick, or the span closes early and the rest of the path becomes markup.
  const code = (value) => "`" + String(value).replace(/[`\r\n]/g, " ").trim() + "`";
  const fails = report.failures;
  const at = (f) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : (f.title || "?"));
  const head = (f) => markdown(String(f.message ?? f.stmt ?? "").split("\n")[0]);
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

  // Same fallback as the terminal: with clustering off this is the old flat list.
  const units = report.clusters
    ?? fails.map((_, i) => ({ size: 1, members: [i], exemplar: i, reported: false }));
  const reported = units.filter((u) => u.reported);

  const lines = ["## whyitbroke", ""];
  if (report.summary) lines.push(`**${markdown(report.summary)}**`, "");
  if (report.status?.signal) lines.push(`> ${markdown(report.status.says)}`, "");
  // Which package or container the output came through - `api:test:` says which of a
  // monorepo's packages failed, and nothing else in the summary does.
  if (report.wrappers.length) lines.push(`via ${report.wrappers.map((w) => code(wrapperName(w))).join(" › ")}`, "");
  if (reported.length) {
    const sites = reported.reduce((n, u) => n + u.size, 0);
    const others = fails.length - sites;
    lines.push(`**${plural(reported.length, "likely cause")}, ${plural(sites, "site")}` +
               `${others ? ` (+${plural(others, "other")})` : ""}**`, "");
  }

  reported.forEach((u, n) => {
    const f = fails[u.exemplar];
    // one parametrized family reads as "N cases", not "N sites" - as in the terminal
    const family = u.members.every((i) => normTitle(fails[i].title) === normTitle(f.title));
    lines.push(`### ${n + 1}. ${markdown((family ? normTitle(f.title) : f.title) || "failure")}`, "");
    lines.push(`${code(at(f))} — ${head(f)}`, "");
    // Parametrized cases share a source line, so the member count and the number of
    // distinct places differ. Label the disclosure with what is actually inside it -
    // "6 sites" above a list of three is the tool contradicting its own evidence.
    const sites = [...new Set(u.members.map((i) => at(fails[i])))];
    const label = sites.length === u.size
      ? plural(u.size, family ? "case" : "site")
      : `${plural(u.size, "case")} at ${plural(sites.length, "site")}`;
    lines.push(`<details><summary>${label}</summary>`, "");
    for (const s of sites) lines.push(`- ${code(s)}`);
    lines.push("", "</details>", "");
  });

  const rest = units.filter((u) => !u.reported).map((u) => u.exemplar);
  if (rest.length) {
    if (reported.length) lines.push("### Other failures", "");
    const body = rest.map((i) => `- **${markdown(fails[i].title || "failure")}**` +
      `${fails[i].file ? ` ${code(at(fails[i]))}` : ""}: ${head(fails[i])}`);
    // A long ungrouped tail buries the causes above it. Fold it, never drop it: the
    // summary stays a complete account of everything that failed.
    if (body.length > 10) lines.push(`<details><summary>${body.length} more</summary>`, "", ...body, "", "</details>", "");
    else lines.push(...body, "");
  }

  // A second tool's failures are not a footnote. Give each one its own section rather
  // than a count the reader has to go back to the raw log to act on.
  for (const other of report.others ?? []) {
    if (!other.failures?.length) continue;
    lines.push(`### ${markdown(other.tool)} — ${plural(other.failures.length, "failure")}`, "");
    const body = other.failures.map((f) => `- **${markdown(f.title || "failure")}**` +
      `${f.file ? ` ${code(at(f))}` : ""}: ${head(f)}`);
    if (body.length > 10) lines.push(`<details><summary>${body.length} more</summary>`, "", ...body, "", "</details>", "");
    else lines.push(...body, "");
  }

  if (report.truncated) lines.push("", "> Output capture limit reached. Increase `--max-bytes` for complete diagnostics.");
  return boundText(`${lines.join("\n")}\n`, MAX_SUMMARY_BYTES, SUMMARY_CLIPPED);
}

// Bound the encoded preview too: newlines/percent signs expand during escaping,
// and Unicode characters can occupy several bytes. Never split an escape or code point.
function capturedOutputAnnotation(raw) {
  const prefix = "::notice title=whyitbroke captured output::";
  const suffix = " [preview truncated; use --json for full captured output]";
  const budget = 3500 - Buffer.byteLength(prefix + suffix + "\n");
  let preview = "", bytes = 0;
  for (const char of raw) {
    const escaped = escapeData(char);
    const size = Buffer.byteLength(escaped);
    if (bytes + size > budget) return prefix + preview + suffix + "\n";
    preview += escaped;
    bytes += size;
  }
  return prefix + preview + "\n";
}

/** A report as GitHub Actions takes it: workflow commands for the log, and markdown for
 *  the job's Summary tab. `quiet` is whether the command's own output was held back. */
export function githubOutput(report, { quiet = false } = {}) {
  if (report.tool !== null) {
    // GitHub drops annotations past its per-step limit. Emit the first ten in report
    // order, then say exactly how many remain in the summary/JSON instead of sending a
    // stream the runner will silently discard.
    let stdout = "";
    const annotations = report.failures.map((failure) => ({ failure }));
    for (const other of report.others ?? []) {
      for (const failure of other.failures ?? []) annotations.push({ failure, tool: other.tool });
    }
    for (const { failure, tool } of annotations.slice(0, MAX_ANNOTATIONS)) stdout += `${annotation(failure, tool)}\n`;
    if (annotations.length > MAX_ANNOTATIONS) {
      const hidden = annotations.length - MAX_ANNOTATIONS;
      stdout += `::notice title=whyitbroke::${hidden} additional failure${hidden === 1 ? "" : "s"} ` +
        `are listed in the job summary and --json report.\n`;
    }
    // the notice is the line shown at the top of the run - it says causes, not just count
    const causes = (report.clusters ?? []).filter((c) => c.reported);
    const sites = causes.reduce((n, c) => n + c.size, 0);
    const lead = [report.summary, causes.length &&
      `${causes.length} likely cause${causes.length > 1 ? "s" : ""}, ${sites} site${sites > 1 ? "s" : ""}`,
      report.since?.compared && `${report.since.fresh.length} new since the last tracked run`,
      report.since?.reason === "unidentified-pipe"
        && "not tracked: a piped log carries no command to tell it from another (name it with --id NAME)",
      report.since?.reason === "cache-unavailable"
        && "history unavailable: the previous baseline was left unchanged"]
      .filter(Boolean).join(" — ");
    if (lead) stdout += `::notice title=whyitbroke::${escapeData(lead)}\n`;
    if (report.truncated) stdout += `::warning title=whyitbroke::${TRUNCATION_NOTICE}\n`;
    if (report.status?.signal) stdout += `::warning title=whyitbroke command status::${escapeData(report.status.says)}\n`;
    return { stdout, summary: summaryOf(report) };
  }
  const { fallback, truncated, error } = report;
  if (!fallback) return { stdout: "", summary: null };
  const piped = report.inputMode === "pipe";
  const raw = fallback.rawOutput;
  const status = report.status;
  const explanation = [error ?? status?.says ?? "whyitbroke could not identify a diagnostic.",
    ...(status && !error && raw ? ["whyitbroke could not identify a diagnostic."] : [])].join("\n");
  // Unknown upstream status is a notice, not an invented failed command.
  const level = piped ? "notice" : "error";
  let stdout = `::${level} title=whyitbroke::${escapeData(fallback.message + "\n" + explanation)}\n`;
  if (raw && (piped || quiet)) {
    // Escaped annotation data keeps raw workflow-command syntax inert.
    stdout += capturedOutputAnnotation(raw);
  } else if (!raw) {
    stdout += "::notice title=whyitbroke::No output was captured.\n";
  }
  if (truncated) stdout += `::warning title=whyitbroke::${TRUNCATION_NOTICE}\n`;

  const context = error ?? (raw || "No output was captured.");
  // A log may itself contain fenced Markdown. Use a longer fence so its text
  // stays inside the code block in the job summary.
  let fenceLength = 3;
  for (const match of context.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = "`".repeat(fenceLength);
  // The annotation says what the status was; a job summary that left it out would be the
  // one place a reader looks and does not find it.
  const summary = boundText(["## whyitbroke", "", fallback.message, ...(status && !error ? ["", status.says] : []), "",
    error ? "Launch error:" : "Captured output:", "", fence, context, fence, "",
    ...(truncated ? [`> ${TRUNCATION_NOTICE}`, ""] : []),
  ].join("\n"), MAX_SUMMARY_BYTES, SUMMARY_CLIPPED);
  return { stdout, summary };
}
