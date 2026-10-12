import { append, stripAnsi } from "./util.js";
// Capturing a command's output has one job that matters: whatever else is dropped, the
// part that says why it failed has to survive. That part is almost always at the END -
// pytest's summary, cargo's error, jest's failure list, the stack trace. Keeping the
// first N bytes and discarding the rest loses exactly the thing being looked for, and
// it does so precisely on the large logs that are hardest to read by hand.
//
// So the cap is spent from both ends, with a bounded set of complete lines around
// probable diagnostics rescued from the middle. The diagnostic copy is only charged
// against the tail when it is actually used, so ordinary logs retain the old 25/75
// split while a buried failure can trade some shutdown noise for the lines that matter.

const HEAD_SHARE = 0.25;   // the beginning is worth keeping, but the end is worth more
const DIAGNOSTIC_SHARE = 0.25;
const CONTEXT_LINES = 8;
// Pretty-printed machine reports put the useful fields after an envelope marker. Eight
// lines is enough context for human diagnostics, but it cut Terraform's JSON halfway
// through its first range and made the otherwise valid report unreadable. Keep a
// bounded larger window after a structured diagnostic array begins; later `severity`
// lines refresh the window for reports with more than one diagnostic.
const STRUCTURED_CONTEXT_LINES = 64;
// What to KEEP when the log is too big to keep all of it. The asymmetry matters: too
// broad costs budget, too narrow loses a failure outright - the opposite of the
// vocabularies the parsers use to decide ownership, where a false claim is the danger.
//
// Burying each captured fixture in three megabytes of build chatter and capping the
// result lost the diagnosis in 25 of 124. Three causes, all of them narrowness:
//
//   - a leading \b cannot match a class name. KeyError, SyntaxError, NoMethodError and
//     AssertionError all carry "Error" behind a word character, and that is how Ruby,
//     Node, Perl and every assertion library announce a failure.
//   - "panic" with a trailing \b does not match Rust's "panicked", and "cannot" does
//     not match "can't".
//   - some tools write no failure word at all. Go says "./main.go:9:2: fmt.Printf call
//     needs 1 arg", jest draws a bullet, and a custom perl die carries only the
//     author's own words - for those, the shape of a location has to stand in.
//
// No alternative starts with \w* or .*: an unanchored pattern finds "Error" inside
// "KeyError" on its own, and a leading \w* only makes the engine retry at every
// position. That mattered - it cost three quarters of the scan's throughput.
const PROBABLE_DIAGNOSTIC = new RegExp([
  "(?:error|exception)s?\\b",
  "\\b(?:fail\\w*|fatal|panic\\w*|traceback|abort\\w*|crash\\w*)\\b",
  "\\b(?:assert\\w*|refused|denied|timed out|not found|no such|unable to)\\b",
  "\\b(?:cannot|can't|(?:could|did|does|is|was|were)\\s?n[o']?t)\\b",
  "\\bsegmentation fault\\b",
  "\\bDATA RACE\\b",
  "\\bdie[ds]?\\b",
  // diagnostic codes: TS2322, CS0103, MSB4018, E0277, F401, SC2086
  "\\b[A-Z]{1,4}\\d{3,5}\\b",
  // a location is a diagnostic by shape, whatever words follow it
  "^\\s*\\.?[\\w./\\\\-]+\\.\\w+:\\d+(?::\\d+)?:",
  "\\bat [\\w./\\\\-]+\\.\\w+ line \\d+",
  // TAP says it with two words that are not otherwise failure vocabulary at all
  "^[^\\S\\n]*not ok\\b",
  // prettier --check writes nothing but "[warn] file.js", and exits non-zero on it. A
  // warning is not a failure, which is why the word is otherwise excluded here - but
  // for deciding what to KEEP, a log made entirely of them has nothing else to keep.
  "^\\[(?:warn|error)\\]",
  // black --check says only "would reformat x.py" and exits non-zero. Nothing in that
  // sentence admits a failure, and it is the entire log.
  "\\bwould (?:reformat|be reformatted|fail to reformat)\\b",
  // git refuses three things in words that hold no failure vocabulary at all, and in
  // each case the refusal is the entire log: "merge: x - not something we can merge"
  // ("can merge" is not "cannot"), "There is no tracking information for the current
  // branch." and "No stash entries found." ("entries found" is not "not found").
  "^(?:merge: .+ - not something we can merge|There is no tracking information|No stash entries found)\\b",
  // Poetry says a file it cannot read in one sentence with no failure word in it at all:
  // "Invalid TOML file /app/pyproject.toml: Unexpected character: ... at line 1 col 8".
  // The path is in the middle, so the location shape above does not reach it either.
  "^Invalid \\w+ file\\b",
  // make announces its own fatal errors with "***" and ends them "Stop.". Neither
  // half is failure vocabulary, the makefile is often named `Makefile` with no
  // extension so the location pattern above does not match it either, and the whole
  // log is frequently that one line.
  "^(?:make(?:\\[\\d+\\])?:|[^\\s:]+:\\d+:)[^\\S\\n]+\\*\\*\\*[^\\S\\n]",
  // A structured report only means anything whole. eslint's and jest's arrive on one
  // line, so keeping that line keeps the document - but `mocha --reporter json` pretty
  // prints across forty, and dropping the braces between two interesting lines leaves
  // something no parser can read. A line of JSON is cheap to keep and absent from
  // ordinary build chatter, so keeping all of them costs a budget nothing in practice
  // and is the only way a multi-line report survives being buried.
  "^[^\\S\\n]*(?:[{}\\[\\],]+[^\\S\\n]*$|\"[\\w.$-]+\"[^\\S\\n]*:)",
  // Go's tally and the bullets test runners draw carry no word at all
  "^\\s*(?:---\\s*FAIL|FAIL\\b|\\u25cf|\\u2717|\\u2716|\\u00d7)",
  // A tool that refuses to start says why in one sentence and stops. eslint's three
  // are all the log there is, and none of them uses failure vocabulary: an option it
  // does not know, a formatter it no longer ships, a pattern that matched nothing.
  "^Invalid option '",
  "^The \\S+ formatter is no longer part of core\\b",
  "^No files matching the pattern\\b",
  // ...and three more of the same kind, each the whole log of a command that never ran.
  // None of them carries a failure word: the interpreter could not find a module, the go
  // tool was handed a flag it does not have, terraform a subcommand it does not ship.
  "^\\S*python[\\d.]*(?:\\.exe)?: No module named ",
  "^flag provided but not defined: -",
  "^go \\S+: unknown command[^\\S\\n]*$",
  "^(?:Terraform|OpenTofu|Tofu) has no command named \"",
  // ...and a reporter told to write to a file says so and prints nothing else, so that
  // one line is the entire log of a failed run.
  "^[A-Z][A-Z-]* report written to ",
  // deno fmt --check heads each file it would rewrite with "from <file>:" and draws the
  // change under it; the one failure word is in the tally at the very end, so every file
  // but the last was cut from a large log.
  "^from [^\\s:][^\\n]*\\.\\w+:[^\\S\\n]*$",
  // `cargo fmt --check` heads each place with "Diff in <file>:<line>:" and draws a diff
  // under it. There is no failure word in any of it, and the location pattern above wants
  // the path at the start of the line - so a format check buried in a build log lost every
  // place it found, and a one-place run lost the only one it had.
  "^Diff in [^\\s][^\\n]*:\\d+:[^\\S\\n]*$",
  // `gofmt -d` has the same problem and a different shape: it names the file once, in a
  // header with no failure word in it either, and every place it found is an @@ line
  // underneath. Losing the header loses every place in that file, because nothing else
  // in the diff says which file it is about.
  "^diff [^\\s]+\\.orig [^\\s]+[^\\S\\n]*$",
  // `terraform fmt -check -diff` is the same problem a third time. Its header is the pair
  // `--- old/<path>` / `+++ new/<path>`, and the file is named nowhere else in the diff.
  "^--- old/[^\\s][^\\n]*$",
  // go's module loader writes no failure word at all. "go: <module>@<version>: <reason>"
  // and the "go: <package> imports" chain are the whole log of a failed `go mod tidy`,
  // and the chain's own lines are indented, so nothing in it anchors either.
  "^go: \\S+@\\S+:",
  "^go: \\S+ imports[^\\S\\n]*$",
  // VSTest's console is translated into the SDK's thirteen UI languages, and every
  // failure word above is English. What survives translation is the shape: a result line
  // is an indented word or two, the test, and its timing in brackets; the run's tally
  // ends with the assembly it ran and the framework it ran on.
  "^[^\\S\\n]{2}\\S[^\\n]*[^\\S\\n]\\[(?:<[^\\S\\n]+)?\\d+(?:\\.\\d+)?[^\\S\\n]*m?s\\][^\\S\\n]*$",
  "^\\S[^\\n]*![^\\n]*\\.dll[^\\S\\n]+\\((?:net|\\.NET)[^)\\n]*\\)[^\\S\\n]*$",
  // oxlint draws its report the way miette does, and in a pipe it draws it in ASCII: an
  // `x` or a `!`, then the location on the next line in `,-[file:line:col]`. Neither is a
  // failure word, and the rule is spelled `plugin(rule)`. The run ends with a line only
  // oxlint writes, which is all that marks a finding with no rule as oxlint's.
  "^[^\\S\\n]*[x!][^\\S\\n]+[\\w-]+\\([\\w/-]+\\):[^\\S\\n]",
  "^[^\\S\\n]*(?:,-|\\u256d\\u2500)\\[[^\\]\\n]+:\\d+:\\d+\\][^\\S\\n]*$",
  "^Finished in [\\d.]+\\S*s on \\d+ files? with \\d+ rules using \\d+ threads\\.",
  // rubocop --format json is one line, and nothing in it is failure vocabulary: its
  // offenses are conventions and warnings. It opens by naming rubocop.
  "^\\{\"metadata\":\\{\"rubocop_version\":",
  // ...and its simple, quiet and markdown formats name each file in a heading and write
  // each offense under it as a severity letter or word, with no failure word anywhere.
  "^== \\S[^\\n]* ==[^\\S\\n]*$",
  "^[CWEFRI]:[^\\S\\n]*\\d+:[^\\S\\n]*\\d+:[^\\S\\n]",
  "^# RuboCop Inspection Report",
  "^### [^\\n]+ - \\(\\d+ offenses?\\)",
  // sass ends every diagnostic with a trace whose last frame is the root stylesheet, and a
  // module loop draws a box for each file between its message and that trace - more than
  // the eight lines kept after the message, and the trace is how sass's is told apart.
  "^[^\\S\\n]+\\S[^\\n]*[^\\S\\n]\\d+:\\d+[^\\S\\n]+root stylesheet[^\\S\\n]*$",
  "^[^\\S\\n]*\\* \\*\\*Line # \\d+ - \\w+:\\*\\*",
].join("|"), "im");

const NL = 0x0a;
const CR = 0x0d;

/** Trim the end of `buf` back to the last line end.
 *
 *  A newline can never appear inside a multi-byte UTF-8 sequence - every continuation
 *  byte is >= 0x80 - so cutting on one is encoding-safe for free, and it also hands a
 *  parser whole lines instead of a severed one. A fragment of one enormous line has
 *  lost its grammar: after a marker gives it a new line boundary, text inside a JSON
 *  string such as `error:` can become a diagnosis that never existed. Drop that
 *  fragment rather than asking any parser to interpret it.
 *
 *  A carriage return ends a line as well. It is how a progress bar redraws itself, every
 *  parser reads a bare one as a line break, and it cannot sit inside a multi-byte sequence
 *  either. Output made of nothing but redraws holds no newline at all: cut on newlines
 *  alone, a large log of them kept only the marker. */
function trimEndToLine(buf) {
  const at = Math.max(buf.lastIndexOf(NL), buf.lastIndexOf(CR));
  return at === -1 ? buf.subarray(0, 0) : buf.subarray(0, at + 1);
}

/** How many lines end in `buf`. */
function newlines(buf) {
  let n = 0;
  for (let at = buf.indexOf(NL); at !== -1; at = buf.indexOf(NL, at + 1)) n++;
  return n;
}

/** Drop the leading partial line, so the tail starts where a line does - unless it
 *  already does: `before` is the byte in front of `buf`, and a line starts after a newline
 *  or a bare carriage return. Dropping a whole first line lost the line a failure was read
 *  from, such as PHPUnit's testStarted for a test whose testFailed the tail still held. */
function trimStartToLine(buf, before) {
  if (before === NL || (before === CR && buf[0] !== NL)) return buf;
  const nl = buf.indexOf(NL);
  const cr = buf.subarray(0, nl === -1 ? buf.length : nl).indexOf(CR);
  if (cr === -1) return nl === -1 ? buf.subarray(buf.length) : buf.subarray(nl + 1);
  return buf.subarray(buf[cr + 1] === NL ? cr + 2 : cr + 1);
}

/** The gap has to be visible. Joining two halves silently would let a parser read the
 *  head of one failure and the tail of another as a single block and report a diagnosis
 *  that never happened. This line says what is missing and matches no extractor. */
export const elision = (bytes) =>
  `\n~~~ whyitbroke: ${bytes} bytes of output elided here (raise --max-bytes to keep them) ~~~\n`;

/** Accumulate bounded output, keeping the head, probable diagnostic windows and tail.
 *
 *  Under the cap this is byte-for-byte the input, with no marker and no trimming, so
 *  ordinary runs are completely unaffected. */
export function createCapture(maxBytes) {
  const headMax = Math.max(1, Math.floor(maxBytes * HEAD_SHARE));
  const tailMax = Math.max(1, maxBytes - headMax);
  const diagnosticMax = Math.max(1, Math.floor(maxBytes * DIAGNOSTIC_SHARE));
  const scanLineMax = Math.max(1024, Math.min(64 * 1024, diagnosticMax));
  const head = [];
  let headBytes = 0;
  // The tail is tail[tailFrom...]: the chunks before it have been shed.
  const tail = [];
  let tailFrom = 0;
  let tailBytes = 0;
  // The byte in front of the tail's first one, which says whether the tail starts a line.
  let beforeTail = NL;
  let totalBytes = 0;

  // Diagnostic lines are stored with their absolute offsets. Complete lines make the
  // final splice safe for both UTF-8 and multiline parsers; offsets let nearby windows
  // merge without duplicating bytes or pretending two separated regions were adjacent.
  const diagnostics = [];
  const diagnosticOffsets = new Set();
  let diagnosticBytes = 0;
  let recent = [];
  let after = 0;
  // The line being read, as the parts of it that have arrived, joined once it ends: a line
  // that arrives a few bytes at a time is not copied again with each of them.
  const parts = [];
  let partsBytes = 0;
  let lineStart = 0;
  // A line that outgrows the scan is skipped to its end, and none of it is kept.
  let skipping = false;
  // A carriage return at the end of a chunk ends its line unless a newline comes next.
  let endsOnCr = false;
  // How many newlines have ended lines so far, which is the line a record starts on: a
  // line of the output ends at a newline, and a carriage return only splits it for reading.
  let linesEnded = 0;

  const saveDiagnostic = (record) => {
    if (record.start + record.buf.length <= headMax || diagnosticOffsets.has(record.start)) return;
    if (record.buf.length > diagnosticMax - diagnosticBytes) return;
    diagnostics.push(record);
    diagnosticOffsets.add(record.start);
    diagnosticBytes += record.buf.length;
  };

  const considerLine = (view, start) => {
    // Copy a line before retaining it: a subarray of a large stream chunk would keep
    // the entire parent allocation alive and quietly defeat the memory bound.
    const record = { start, buf: Buffer.from(view), line: linesEnded };
    // Decoded as UTF-8, not latin1. A bullet is three bytes - jest's "\u25cf" is
    // e2 97 8f - and latin1 turns those into three separate characters, so a pattern
    // written with the bullet in it can never match. The alternatives for jest's and
    // vitest's markers were added in that state and never once fired; what recovered
    // jest was the "FAIL" on the line above. Decoding correctly costs about a quarter
    // of the decode, which is not where this loop spends its time.
    //
    // Colour codes destroy the word boundaries above too: deno writes
    // "\x1b[31merror\x1b[0m:", where the "m" ending the escape sits against the "e" and
    // \berror never matches. Only pay for that strip when there is an escape to strip.
    const raw = view.toString("utf8");
    const interesting = PROBABLE_DIAGNOSTIC.test(raw.includes("\u001b") ? stripAnsi(raw) : raw);
    if (interesting) {
      saveDiagnostic(record);                 // the diagnostic itself outranks context
      for (let i = recent.length - 1; i >= 0; i--) saveDiagnostic(recent[i]);
      const structured = /^\s*"(?:diagnostics|severity)"\s*:/i.test(raw);
      after = Math.max(after, structured ? STRUCTURED_CONTEXT_LINES : CONTEXT_LINES);
    } else if (after > 0) {
      saveDiagnostic(record);
      after--;
    }
    recent.push(record);
    if (recent.length > CONTEXT_LINES) recent.shift();
  };

  // The line being read ends with buf[from, end), which `start` is the offset of.
  const endLine = (buf, from, end, start) => {
    if (!skipping) {
      parts.push(buf.subarray(from, end));
      considerLine(parts.length === 1 ? parts[0] : Buffer.concat(parts, partsBytes + end - from), lineStart);
    }
    if (end > from && buf[end - 1] === NL) linesEnded++;
    parts.length = 0;
    partsBytes = 0;
    skipping = false;
    lineStart = start + end;
  };

  // Lines end at a newline, at a carriage return and newline together, and at a carriage
  // return on its own - where a progress bar redraws itself, and where every parser will
  // break the line. A diagnostic printed after a redraw ended no line here, so in the
  // middle of a large log it was read as part of the bar, and never kept.
  const scanDiagnostics = (buf, start) => {
    let from = 0;
    if (endsOnCr) {
      endsOnCr = false;
      if (buf[0] === NL) { endLine(buf, 0, 1, start); from = 1; } else endLine(buf, 0, 0, start);
    }
    let nl = buf.indexOf(NL, from), cr = buf.indexOf(CR, from);
    while (from < buf.length) {
      if (nl !== -1 && nl < from) nl = buf.indexOf(NL, from);
      if (cr !== -1 && cr < from) cr = buf.indexOf(CR, from);
      let end;
      if (cr !== -1 && (nl === -1 || cr < nl)) {
        if (cr === buf.length - 1) { endsOnCr = true; break; }
        end = buf[cr + 1] === NL ? cr + 2 : cr + 1;
      } else if (nl !== -1) {
        end = nl + 1;
      } else {
        break;
      }
      endLine(buf, from, end, start);
      from = end;
    }
    if (from === buf.length || skipping) return;
    parts.push(buf.subarray(from));
    partsBytes += buf.length - from;
    // An unbroken minified blob must not become an unbounded scanner buffer. Such a
    // partial line is not useful context, so it is skipped to its end without holding
    // any of it - holding its last 64KiB copied them again for every chunk that arrived.
    if (partsBytes > scanLineMax) {
      parts.length = 0;
      partsBytes = 0;
      skipping = true;
      recent = [];
      after = 0;
    }
  };

  return {
    push(chunk) {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      const start = totalBytes;
      totalBytes += buf.length;
      scanDiagnostics(buf, start);
      if (headBytes < headMax) {
        const take = Math.min(headMax - headBytes, buf.length);
        head.push(buf.subarray(0, take));
        headBytes += take;
        if (take) beforeTail = buf[take - 1];
        buf = buf.subarray(take);
      }
      if (!buf.length) return;
      tail.push(buf);
      tailBytes += buf.length;
      // Ring: shed whole chunks from the front, then part of one, counting every
      // discarded byte so the marker can say how much went missing. The front moves by
      // index: shifting the array moved every chunk it held for each chunk that arrived,
      // and output written a line at a time arrives as a hundred thousand of them.
      while (tailBytes > tailMax) {
        const excess = tailBytes - tailMax;
        const first = tail[tailFrom];
        if (first.length <= excess) {
          beforeTail = first[first.length - 1];
          tail[tailFrom++] = null;
          tailBytes -= first.length;
        } else {
          beforeTail = first[excess - 1];
          tail[tailFrom] = first.subarray(excess);
          tailBytes -= excess;
        }
      }
      if (tailFrom > 1024 && tailFrom * 2 > tail.length) {
        tail.splice(0, tailFrom);
        tailFrom = 0;
      }
    },

    finish() {
      if (partsBytes && !skipping) considerLine(Buffer.concat(parts, partsBytes), lineStart);
      const headBuf = Buffer.concat(head);
      const tailBuf = Buffer.concat(tail.slice(tailFrom));
      if (totalBytes <= maxBytes) {
        // Everything fit. Hand back exactly what arrived - unless some of it was not UTF-8:
        // each such byte reads as U+FFFD, three bytes of text, so 1024 of them came back as
        // 3072 under a cap of 1024. Text that grew past the cap is cut like any output that
        // arrived past it.
        const text = Buffer.concat([headBuf, tailBuf]).toString("utf8");
        if (!text.includes("\uFFFD") || Buffer.byteLength(text) <= maxBytes) return { text, truncated: false, elided: 0 };
      }
      const keptHead = trimEndToLine(headBuf);
      // Middle diagnostics borrow only the part of the old tail allocation that they
      // need. Candidates already present in the retained tail cost nothing. Moving the
      // tail start can expose another saved line, so find the small monotonic fixed point.
      const ordered = diagnostics.sort((a, b) => a.start - b.start);
      // A saved record is a whole line, saved once, so in order of where they start the
      // records are in order of where they end too, and those between the head and a tail
      // start are one run of them. The run only grows: more middle leaves less for the
      // tail, which moves its start later and lets more middle in. So one walk along the
      // run finds the fixed point - filtering every record again on each pass, and summing
      // the middle again, was quadratic in a log of dense short diagnostic lines.
      let from = 0;
      while (from < ordered.length && ordered[from].start < keptHead.length) from++;
      let to = from, middleBytes = 0;
      const admit = (limit) => {
        while (to < ordered.length && ordered[to].start + ordered[to].buf.length <= limit) middleBytes += ordered[to++].buf.length;
      };
      admit(totalBytes - tailBuf.length);
      let keptTail = Buffer.alloc(0);
      let tailStart = totalBytes;
      for (;;) {
        const tailBudget = Math.max(1, maxBytes - keptHead.length - middleBytes);
        const tailOffset = Math.max(0, tailBuf.length - tailBudget);
        const rawTail = tailBuf.subarray(tailOffset);
        keptTail = trimStartToLine(rawTail, tailOffset ? tailBuf[tailOffset - 1] : beforeTail);
        tailStart = totalBytes - tailBuf.length + tailOffset + (rawTail.length - keptTail.length);
        const before = to;
        admit(tailStart);
        if (to === before) break;
      }
      let middle = ordered.slice(from, to);

      // --max-bytes counts the log's own bytes. The markers saying where output was left out
      // are not part of the log and come on top of it, and gaps near each other share one so
      // that they cannot add up: past a hundredth of the cap - four kilobytes, for a small one -
      // the smallest windows of the middle give way, the oldest first among equals, each
      // joining the two gaps around it into one, and what they held goes to the tail. A
      // window against the head or the tail costs no marker of its own, so only one with a
      // gap on each side gives way.
      const markerMax = elision(totalBytes).length;
      const allowed = Math.floor(Math.max(4096, Math.floor(maxBytes / 100)) / markerMax);
      const windows = [];
      for (const record of middle) {
        const last = windows.at(-1);
        if (last && last.end === record.start) { last.records.push(record); last.end += record.buf.length; last.bytes += record.buf.length; }
        else windows.push({ start: record.start, end: record.start + record.buf.length, bytes: record.buf.length, records: [record] });
      }
      // How many markers compose() writes for these windows: one wherever a part starts past the
      // end of the one before it, and one more if the last part ends before the output does.
      let markers = 0, cursor = 0;
      const part = (start, end) => { if (start > cursor) markers++; cursor = Math.max(cursor, end); };
      if (keptHead.length) part(0, keptHead.length);
      for (const w of windows) part(w.start, w.end);
      if (keptTail.length) part(tailStart, totalBytes);
      if (cursor < totalBytes) markers++;
      if (markers > allowed) {
        const apart = windows.filter((w, i) => w.start > (i ? windows[i - 1].end : keptHead.length) &&
          w.end < (i + 1 < windows.length ? windows[i + 1].start : keptTail.length ? tailStart : totalBytes));
        const drop = new Set(apart.sort((a, b) => a.bytes - b.bytes || a.start - b.start).slice(0, markers - allowed));
        const kept = windows.filter((w) => !drop.has(w));
        middleBytes = kept.reduce((n, w) => n + w.bytes, 0);
        const tailBudget = Math.max(1, maxBytes - keptHead.length - middleBytes);
        const tailOffset = Math.max(0, tailBuf.length - tailBudget);
        const rawTail = tailBuf.subarray(tailOffset);
        keptTail = trimStartToLine(rawTail, tailOffset ? tailBuf[tailOffset - 1] : beforeTail);
        tailStart = totalBytes - tailBuf.length + tailOffset + (rawTail.length - keptTail.length);
        // A window the longer tail now holds is part of it.
        middle = kept.filter((w) => w.start < tailStart).flatMap((w) => w.records);
      }

      let headSpan = keptHead;
      let middleSpans = middle;
      let tailSpan = keptTail;
      let tailAt = tailStart;

      const compose = () => {
        const spans = [];
        if (headSpan.length) spans.push({ start: 0, buf: headSpan, line: 0 });
        append(spans, middleSpans);
        if (tailSpan.length) spans.push({
          start: tailAt, buf: tailSpan, line: linesEnded - newlines(tailSpan),
        });

        let text = "";
        let cursor = 0;
        let kept = 0;
        let markerBytes = 0;
        // Which line of the output each line of the text is: runs of lines kept together.
        // A marker's lines are the capture's own, and in no run.
        const segments = [];
        let lineAt = 0;
        // Whether the text so far ends inside a line: a part can end at a carriage return.
        let open = false;
        for (const span of spans) {
          if (span.start > cursor) {
            const marker = elision(span.start - cursor);
            text += marker;
            markerBytes += marker.length;
            lineAt += marker.split("\n").length - 1;
            open = false;
          }
          const overlap = Math.max(0, cursor - span.start);
          if (overlap < span.buf.length) {
            const part = span.buf.subarray(overlap);
            const line = span.line + newlines(span.buf.subarray(0, overlap));
            const ended = newlines(part);
            const count = ended + (part[part.length - 1] === NL ? 0 : 1);
            const last = segments.at(-1);
            // A part that follows one ending inside a line, with nothing elided between
            // them, goes on with that line: it is one line of the text, and of the output.
            if (open && last.at + last.count - 1 === lineAt && last.line + last.count - 1 === line) last.count += count - 1;
            else if (last && last.at + last.count === lineAt && last.line + last.count === line) last.count += count;
            else segments.push({ at: lineAt, line, count });
            text += part.toString("utf8");
            lineAt += ended;
            kept += part.length;
            cursor = span.start + span.buf.length;
            open = part[part.length - 1] !== NL;
          }
        }
        if (cursor < totalBytes) {
          const marker = elision(totalBytes - cursor);
          text += marker;
          markerBytes += marker.length;
        }
        return { text, kept, segments, markerBytes };
      };

      // The size in bytes of the log's own text compose() hands back with the middle from
      // `first` on: each part as text, larger than its bytes where they are not UTF-8. The
      // markers are not counted.
      const decoded = new Map();
      const textBytes = (buf) => {
        let bytes = decoded.get(buf);
        if (bytes === undefined) decoded.set(buf, (bytes = Buffer.byteLength(buf.toString("utf8"))));
        return bytes;
      };
      const composedBytes = (first) => {
        let bytes = 0, cursor = 0;
        const add = (start, buf) => {
          const overlap = Math.max(0, cursor - start);
          if (overlap < buf.length) {
            bytes += overlap ? Buffer.byteLength(buf.subarray(overlap).toString("utf8")) : textBytes(buf);
            cursor = start + buf.length;
          }
        };
        if (headSpan.length) add(0, headSpan);
        for (let i = first; i < middleSpans.length; i++) add(middleSpans[i].start, middleSpans[i].buf);
        if (tailSpan.length) add(tailAt, tailSpan);
        return bytes;
      };

      // What was kept above is within the cap in bytes, and the cap holds for it as text as
      // well: a byte that is not UTF-8 reads as U+FFFD, three bytes, and output made of such
      // bytes outgrows the cap once read. Shed tail, then the least recent middle windows -
      // as many at once as the cap needs - and only then the head. The markers are not
      // counted, so output that is UTF-8 is never shed here.
      let captured = compose();
      let size = Buffer.byteLength(captured.text) - captured.markerBytes;
      while (size > maxBytes) {
        const overflow = size - maxBytes;
        if (tailSpan.length) {
          const before = tailSpan.length;
          const cut = Math.min(overflow, tailSpan.length);
          tailSpan = trimStartToLine(tailSpan.subarray(cut), tailSpan[cut - 1]);
          tailAt += before - tailSpan.length;
        } else if (middleSpans.length) {
          let low = 1, high = middleSpans.length;
          while (low < high) {
            const mid = (low + high) >> 1;
            if (composedBytes(mid) <= maxBytes) high = mid;
            else low = mid + 1;
          }
          middleSpans = middleSpans.slice(low);
        } else if (headSpan.length) {
          headSpan = trimEndToLine(headSpan.subarray(0, Math.max(0, headSpan.length - overflow)));
        } else {
          break;
        }
        captured = compose();
        size = Buffer.byteLength(captured.text) - captured.markerBytes;
      }
      return {
        text: captured.text,
        truncated: true,
        elided: totalBytes - captured.kept,
        /** Lines [start..end] of `text`, counting from 0, as the runs of the output's own
         *  lines they are - what was elided counted in, and the markers left out. */
        lines: (start, end) => {
          const runs = [];
          for (const { at, line, count } of captured.segments) {
            const from = Math.max(start, at), to = Math.min(end, at + count - 1);
            if (from <= to) runs.push({ start: line + from - at, end: line + to - at });
          }
          return runs;
        },
      };
    },
  };
}
