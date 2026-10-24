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
  // ...and pnpm's, which come with no failure word: "ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND
  // No package.json ... was found". In a recursive run with its prefixes hidden, nothing
  // near it has one either.
  "\\bERR_PNPM_[A-Z0-9_]+",
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
  // ...and what it says when it does go wrong holds no failure word either: each conflicted
  // file is a "CONFLICT (content): Merge conflict in <file>" row, and each refused ref a
  // "! [rejected] <ref> -> <ref>" one. The footer under them has the word - "Automatic merge
  // failed", "failed to push some refs" - and kept only the last eight rows of a long list.
  "^CONFLICT \\([^)\\n]+\\): ",
  "^[^\\S\\n]*![^\\S\\n]+\\[[^\\]\\n]+\\][^\\S\\n]+\\S+[^\\S\\n]+->",
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
  // Testing Platform's console is translated as well, and a failure whose message holds no
  // English word - a custom exception, say - gave the scan nothing to find: its heading is a
  // translated word and a timing, and its assembly line is printed under passing tests too.
  // Its stack is not. A frame naming its source file and line - four spaces in, a translated
  // "at" before the method and "in" before the path - is a failure's alone.
  "^[^\\S\\n]{4}\\S+[^\\S\\n]+(?:\\S+[^\\S\\n]+)?[^\\s(]+\\([^()\\n]*\\)[^\\S\\n]+\\S+(?:[^\\S\\n]+\\S+)?[^\\S\\n]+(?:\\/|[A-Za-z]:[\\\\/])\\S*:\\d+[^\\S\\n]*$",
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
/** The marker's own line, for a reader that reads a block of lines: what is on the far side
 *  of it may be the rest of the block, or something else altogether. */
export const ELIDED = /^~~~ whyitbroke: \d+ bytes of output elided here /;

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
  // Whether the head's last part is the end of the chunk it came from, or only its start.
  let headEnds = true;
  // The tail is tail[tailFrom...]: the chunks before it have been shed.
  const tail = [];
  let tailFrom = 0;
  let tailBytes = 0;
  // The byte in front of the tail's first one, which says whether the tail starts a line.
  let beforeTail = NL;
  let totalBytes = 0;
  // Whether the last chunk with anything in it ended in a carriage return, and no empty one
  // has come since: an empty chunk ends that line where it is - see read().
  let trailingCr = false;

  // Output is read for diagnostics only once it leaves the tail. Under the cap nothing ever
  // does, and nothing is read: reading every line as it arrived kept a copy of each one that
  // looked like a diagnostic, in a record of its own, for output that came back whole. The
  // head is read before the first byte that leaves the tail, and whatever is left is read
  // when the capture finishes.
  let headRead = false;
  let allRead = false;

  // The lines saved for diagnostics, in the order the output has them: their bytes one after
  // another, a bit for each byte that ends a line, and for each run of lines that follow one
  // another, where it starts in the output, which line of the output it starts, and where its
  // bytes start. Complete lines make the final splice safe for both UTF-8 and multiline
  // parsers; where each starts lets adjacent lines join into one window without pretending
  // two separated regions were adjacent. A line is saved while it is one of the last few
  // read - that is the only time anything can save it - and stored once it is not, so the
  // store is in order and holds each line once.
  let store = Buffer.alloc(0);
  let stored = 0;
  let lineEnds = new Uint8Array(0);
  let runStart = new Float64Array(0);
  let runLine = new Float64Array(0);
  let runAt = new Float64Array(0);
  let runs = 0;
  let storedTo = -1;
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

  const storeLine = (record) => {
    if (!record.saved) return;
    const { start, buf } = record;
    // What is saved is within the diagnostic budget, so the store never grows past it.
    if (stored + buf.length > store.length) {
      const grown = Buffer.allocUnsafe(Math.min(diagnosticMax, Math.max(stored + buf.length, 2 * store.length, 4096)));
      store.copy(grown, 0, 0, stored);
      store = grown;
      const ends = new Uint8Array(Math.ceil(grown.length / 8));
      ends.set(lineEnds);
      lineEnds = ends;
    }
    if (start !== storedTo) {
      if (runs === runStart.length) {
        const more = (old) => { const a = new Float64Array(Math.max(16, 2 * runs)); a.set(old); return a; };
        runStart = more(runStart);
        runLine = more(runLine);
        runAt = more(runAt);
      }
      runStart[runs] = start;
      runLine[runs] = record.line;
      runAt[runs++] = stored;
    }
    buf.copy(store, stored);
    stored += buf.length;
    lineEnds[(stored - 1) >> 3] |= 1 << ((stored - 1) & 7);
    storedTo = start + buf.length;
  };

  const saveDiagnostic = (record) => {
    if (record.start + record.buf.length <= headMax || record.saved) return;
    if (record.buf.length > diagnosticMax - diagnosticBytes) return;
    record.saved = true;
    diagnosticBytes += record.buf.length;
  };

  const considerLine = (view, start) => {
    // The line is not copied here, only a line that is saved, into the store, once it is no
    // longer one of the last few read: a view into a large stream chunk keeps the whole
    // chunk alive, which for a few lines costs little, and for every saved line would
    // quietly defeat the memory bound.
    const record = { start, buf: view, line: linesEnded, saved: false };
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
    if (recent.length > CONTEXT_LINES) storeLine(recent.shift());
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
  //
  // `buf` starts at `start` in the output, and `ends` says whether it is the end of the chunk
  // it arrived in or only part of one: what is read does not depend on when it is read, but
  // where the chunks the output arrived in end decides which long lines are skipped, and an
  // empty chunk ends a line at a carriage return before it.
  const read = (buf, start, ends) => {
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
    if (ends && partsBytes > scanLineMax) {
      parts.length = 0;
      partsBytes = 0;
      skipping = true;
      for (const record of recent) storeLine(record);
      recent = [];
      after = 0;
    }
  };

  const readHead = () => {
    if (headRead) return;
    headRead = true;
    for (let i = 0, at = 0; i < head.length; at += head[i++].length) read(head[i], at, i < head.length - 1 || headEnds);
  };

  return {
    push(chunk) {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      totalBytes += buf.length;
      if (headBytes < headMax) {
        const take = Math.min(headMax - headBytes, buf.length);
        head.push(buf.subarray(0, take));
        headBytes += take;
        headEnds = take === buf.length;
        if (take) beforeTail = buf[take - 1];
        trailingCr = buf.length > 0 && buf[buf.length - 1] === CR;
        buf = buf.subarray(take);
      } else if (!buf.length) {
        // Nothing to keep, but an empty chunk still ends a line at the carriage return in
        // front of it, so it is kept in its place to be read there.
        if (trailingCr) tail.push(buf);
        trailingCr = false;
        return;
      } else {
        trailingCr = buf[buf.length - 1] === CR;
      }
      if (!buf.length) return;
      tail.push(buf);
      tailBytes += buf.length;
      // Ring: shed whole chunks from the front, then part of one, counting every
      // discarded byte so the marker can say how much went missing. The front moves by
      // index: shifting the array moved every chunk it held for each chunk that arrived,
      // and output written a line at a time arrives as a hundred thousand of them. What is
      // shed is read for diagnostics first, after the head.
      while (tailBytes > tailMax) {
        const excess = tailBytes - tailMax;
        const first = tail[tailFrom];
        const at = totalBytes - tailBytes;
        readHead();
        if (first.length <= excess) {
          read(first, at, true);
          if (first.length) beforeTail = first[first.length - 1];
          tail[tailFrom++] = null;
          tailBytes -= first.length;
        } else {
          read(first.subarray(0, excess), at, false);
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
      // Past the cap, what the tail still holds is read now, after the head.
      if (!allRead) {
        allRead = true;
        readHead();
        for (let i = tailFrom, at = totalBytes - tailBytes; i < tail.length; at += tail[i++].length) read(tail[i], at, true);
        if (partsBytes && !skipping) considerLine(Buffer.concat(parts, partsBytes), lineStart);
        for (const record of recent) storeLine(record);
        recent = [];
      }
      const keptHead = trimEndToLine(headBuf);
      // A saved line is store[at, lineEnd(at)), in the run r that holds it, and starts at
      // runStart[r] + at - runAt[r] in the output.
      const runEnd = (r) => (r + 1 < runs ? runAt[r + 1] : stored);
      const outputAt = (r, at) => runStart[r] + at - runAt[r];
      // Where the saved line starting at `at` in the store ends: past the next byte marked as
      // ending one.
      const lineEnd = (at) => {
        for (let i = at; ; i = (i | 7) + 1) {
          const bits = lineEnds[i >> 3] >> (i & 7);
          if (bits) return i + 32 - Math.clz32(bits & -bits);
        }
      };
      // Middle diagnostics borrow only the part of the old tail allocation that they
      // need. Candidates already present in the retained tail cost nothing. Moving the
      // tail start can expose another saved line, so find the small monotonic fixed point.
      //
      // The saved lines are whole lines, in the order the output has them, so in order of
      // where they start they are in order of where they end too, and those between the head
      // and a tail start are one run of them: store[fromAt, toAt). The run only grows: more
      // middle leaves less for the tail, which moves its start later and lets more middle in.
      // So one walk along the run finds the fixed point - filtering every saved line again on
      // each pass, and summing the middle again, was quadratic in a log of dense short
      // diagnostic lines.
      let fromRun = 0, fromAt = 0;
      while (fromAt < stored && outputAt(fromRun, fromAt) < keptHead.length) {
        fromAt = lineEnd(fromAt);
        if (fromAt === runEnd(fromRun)) fromRun++;
      }
      let toRun = fromRun, toAt = fromAt, middleBytes = 0;
      const admit = (limit) => {
        while (toAt < stored) {
          const end = runEnd(toRun);
          if (outputAt(toRun, end) <= limit) { middleBytes += end - toAt; toAt = end; toRun++; continue; }
          const next = lineEnd(toAt);
          if (outputAt(toRun, next) > limit) break;
          middleBytes += next - toAt;
          toAt = next;
        }
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
        const before = toAt;
        admit(tailStart);
        if (toAt === before) break;
      }
      // The windows of the middle are the runs of adjacent saved lines in it: runs
      // [fromRun, lastRun), the first from fromAt and the last to toAt - which ends either
      // where a run starts or inside the run toRun.
      const lastRun = toAt === fromAt ? fromRun : toRun < runs && runAt[toRun] < toAt ? toRun + 1 : toRun;
      const windowAt = (r) => (r === fromRun ? fromAt : runAt[r]);
      const windowEnd = (r) => Math.min(runEnd(r), toAt);
      const windowSpan = (r, at, end) => ({
        start: outputAt(r, at), buf: store.subarray(at, end), at,
        line: runLine[r] + (at > runAt[r] ? newlines(store.subarray(runAt[r], at)) : 0),
      });

      // --max-bytes counts the log's own bytes. The markers saying where output was left out
      // are not part of the log and come on top of it, and gaps near each other share one so
      // that they cannot add up: past a hundredth of the cap - four kilobytes, for a small one -
      // the smallest windows of the middle give way, the oldest first among equals, each
      // joining the two gaps around it into one, and what they held goes to the tail. A
      // window against the head or the tail costs no marker of its own, so only one with a
      // gap on each side gives way.
      const markerMax = elision(totalBytes).length;
      const allowed = Math.floor(Math.max(4096, Math.floor(maxBytes / 100)) / markerMax);
      // How many markers compose() writes for these windows: one wherever a part starts past the
      // end of the one before it, and one more if the last part ends before the output does.
      let markers = 0, cursor = 0;
      const part = (start, end) => { if (start > cursor) markers++; cursor = Math.max(cursor, end); };
      if (keptHead.length) part(0, keptHead.length);
      for (let r = fromRun; r < lastRun; r++) part(outputAt(r, windowAt(r)), outputAt(r, windowEnd(r)));
      if (keptTail.length) part(tailStart, totalBytes);
      if (cursor < totalBytes) markers++;
      // The windows kept, which past the marker budget are few: one more than it allows.
      let middle = [];
      if (markers > allowed) {
        const apart = [];
        for (let r = fromRun; r < lastRun; r++) {
          if (outputAt(r, windowAt(r)) > (r > fromRun ? outputAt(r - 1, windowEnd(r - 1)) : keptHead.length) &&
            outputAt(r, windowEnd(r)) < (r + 1 < lastRun ? outputAt(r + 1, windowAt(r + 1)) : keptTail.length ? tailStart : totalBytes)) apart.push(r);
        }
        const size = (r) => windowEnd(r) - windowAt(r);
        const drop = new Uint8Array(lastRun - fromRun);
        for (const r of apart.sort((a, b) => size(a) - size(b) || a - b).slice(0, markers - allowed)) drop[r - fromRun] = 1;
        middleBytes = 0;
        for (let r = fromRun; r < lastRun; r++) if (!drop[r - fromRun]) middleBytes += size(r);
        const tailBudget = Math.max(1, maxBytes - keptHead.length - middleBytes);
        const tailOffset = Math.max(0, tailBuf.length - tailBudget);
        const rawTail = tailBuf.subarray(tailOffset);
        keptTail = trimStartToLine(rawTail, tailOffset ? tailBuf[tailOffset - 1] : beforeTail);
        tailStart = totalBytes - tailBuf.length + tailOffset + (rawTail.length - keptTail.length);
        // A window the longer tail now holds is part of it.
        for (let r = fromRun; r < lastRun; r++) {
          if (!drop[r - fromRun] && outputAt(r, windowAt(r)) < tailStart) middle.push(windowSpan(r, windowAt(r), windowEnd(r)));
        }
      } else {
        for (let r = fromRun; r < lastRun; r++) middle.push(windowSpan(r, windowAt(r), windowEnd(r)));
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

      // Where the saved line ending at `end` in the store starts, in a window starting at `from`.
      const lineStartBefore = (from, end) => {
        for (let i = end - 2; i >= from; i--) if (lineEnds[i >> 3] & (1 << (i & 7))) return i + 1;
        return from;
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
          // The least recent lines of the middle go, as few as the cap needs: from the most
          // recent back, every line that still fits as text stays - though never the first.
          const room = maxBytes - Buffer.byteLength(headSpan.toString("utf8"));
          let i = middleSpans.length - 1, end = middleSpans[i].at + middleSpans[i].buf.length, used = 0, keep = null;
          for (;;) {
            const { at } = middleSpans[i];
            const start = lineStartBefore(at, end);
            if (i === 0 && start === at) break;
            used += Buffer.byteLength(store.subarray(start, end).toString("utf8"));
            if (used > room) break;
            keep = { i, start };
            if (start > at) end = start;
            else { i--; end = middleSpans[i].at + middleSpans[i].buf.length; }
          }
          if (!keep) middleSpans = [];
          else {
            const first = middleSpans[keep.i], cut = keep.start - first.at;
            middleSpans = [cut ? {
              start: first.start + cut, buf: first.buf.subarray(cut), at: keep.start,
              line: first.line + newlines(first.buf.subarray(0, cut)),
            } : first, ...middleSpans.slice(keep.i + 1)];
          }
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
