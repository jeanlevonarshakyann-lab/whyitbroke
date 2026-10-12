// PHP says everything twice. A fatal goes to the error log with a "PHP " prefix and to
// stdout without one, so a single failure arrives as two identical blocks:
//
//   PHP Fatal error:  Uncaught Error: Call to a member function call() on null in /a/p.php:4
//   Stack trace:
//   #0 /a/p.php(8): Gateway->charge(1050)
//   #1 {main}
//     thrown in /a/p.php on line 4
//
//   Fatal error: Uncaught Error: ... (the same again)
//
// The two copies produce identical failures, so the pipeline's own de-duplication
// collapses them - which is why nothing here counts blocks.
import { withSource } from "../ownership.js";
import { lazyIn, pinnedMessage, tailFirst } from "../util.js";

// Each header is matched as its pattern matches it, without trying the rest of a long line
// again from every ` in ` in it. "PHP " may come first, and then `word`: where it ends, or -1.
const after = (line, word) => {
  const at = /^(?:PHP[^\S\n]+)?/.exec(line)[0].length;
  return line.startsWith(word, at) ? at + word.length : -1;
};
//   /^(?:PHP[^\S\n]+)?Fatal error:[^\S\n]+Uncaught[^\S\n]+([\w\\]+):[^\S\n]+(.+?)[^\S\n]+in[^\S\n]+(.+?):(\d+)$/
export const uncaughtLine = (line) => tailFirst(line, {
  tail: /:(\d+)$/, adjacent: true, emptyMessage: false,
  heads: function* (l, c, clear, from) {
    const at = after(l, "Fatal error:");
    if (at < 0) return;
    const head = /[^\S\n]+Uncaught[^\S\n]+([\w\\]+):/y;
    head.lastIndex = at;
    const m = head.exec(l);
    if (!m) return;
    for (const { end, message } of lazyIn(l, head.lastIndex, 1, c, clear, from)) yield { end, groups: [m[1], message] };
  },
});
// Not every fatal is a thrown exception: a call to an undefined function, an abstract
// class instantiated. Those name the file the long way round.
//   /^(?:PHP[^\S\n]+)?Fatal error:[^\S\n]+(?!Uncaught[^\S\n])(.+?)[^\S\n]+in[^\S\n]+(.+?)[^\S\n]+on line[^\S\n]+(\d+)$/
//   /^(?:PHP[^\S\n]+)?Parse error:[^\S\n]+(.+?)[^\S\n]+in[^\S\n]+(.+?)[^\S\n]+on line[^\S\n]+(\d+)$/
const onLine = (word, ok) => (line) => tailFirst(line, {
  tail: /on line[^\S\n]+(\d+)$/, spaceBefore: 1, emptyMessage: false,
  heads: function* (l, c, clear, from) {
    const at = after(l, word);
    if (at < 0) return;
    for (const { end, message } of lazyIn(l, at, 1, c, clear, from, ok && ((start) => ok(l, start)))) yield { end, groups: [message] };
  },
});
export const fatalLine = onLine("Fatal error:", (l, start) => !/^Uncaught[^\S\n]/.test(l.slice(start, start + 9)));
export const parseLine = onLine("Parse error:");
// The include path is longer than the diagnosis and never varies, while the file it
// could not find is the answer. Same shape of noise as perl's @INC list.
// It starts where the whitespace in front of it starts. From each place inside a long stretch the
// pattern read the rest of the stretch again, and the match never started anywhere but its start.
export const INCLUDE_PATH = /(?<![^\S\n])[^\S\n]*\(include_path='[^']*'\)/;
const WARNING_RE = /^(?:PHP[^\S\n]+)?(?:Warning|Notice|Deprecated):[^\S\n]/;
// "#0 /app/src/Cart.php(12): Cart->total()". The whitespace in front of the file, and in front of
// the call, is taken whole; a file or call starting inside it is the last of it, as it was, and
// only where nothing else matched. Divided every way, a long stretch was read again from each place.
const CALL_AT = String.raw`(?:[^\S\n]+(?![^\S\n])|[^\S\n]+(?=[^\S\n\r\u2028\u2029]$))`;
export const FRAME_RE = new RegExp(String.raw`^#(\d+)(?:[^\S\n]+(?![^\S\n])|[^\S\n]+(?=[^\S\n\r\u2028\u2029]\(\d+\):${CALL_AT}.+$))` +
  String.raw`(?:(.+?)\((\d+)\):${CALL_AT}(.+)|\{main\})$`);
// PHP repeats the location under the stack. The line above already said it. Its file ends where the
// whitespace before "on line" starts - see pinnedMessage in util.js.
export const THROWN_RE = pinnedMessage(String.raw`^[^\S\n]*thrown in`, { separator: String.raw`[^\S\n]+`, least: 1, tail: String.raw`on line[^\S\n]+\d+$` });

export default {
  name: "php",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["Fatal error:", "Parse error:"],
  category: "runtime",
  commands: ["php", "php-cgi"],

  detect: (s) => {
    const lines = s.split("\n");
    return lines.some((l) => uncaughtLine(l) || fatalLine(l) || parseLine(l));
  },

  extract(s) {
    const lines = s.split("\n");
    const failures = [];
    // Warnings arrive doubled like everything else, so counting lines said "2 warnings"
    // for one. The two copies differ only by the "PHP " prefix the error log adds.
    const warned = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (THROWN_RE.test(line)) continue;
      // The error log writes "Warning:  x" with two spaces, stdout writes "Warning: x"
      // with one, so the runs have to be flattened before the two copies compare equal.
      if (WARNING_RE.test(line)) { warned.add(line.replace(/^PHP[^\S\n]+/, "").replace(/\s+/g, " ").trim()); continue; }

      const uncaught = uncaughtLine(line);
      const fatal = !uncaught && fatalLine(line);
      const parse = !uncaught && !fatal && parseLine(line);
      if (!uncaught && !fatal && !parse) continue;

      let trace, end = i + 1;
      if (uncaught || fatal) {
        // "Stack trace:" then "#0 /a/p.php(8): Gateway->charge(1050)", innermost first.
        // "#N {main}" is the entry point and carries nothing.
        const frames = [];
        for (let j = i + 1; j < lines.length && j <= i + 32; j++) {
          // The block ends at the `thrown in` line that repeats the location.
          if (THROWN_RE.test(lines[j])) { end = j + 1; break; }
          if ((!lines[j].trim() && j > i + 1) ||
              (j > i + 1 && (uncaughtLine(lines[j]) || fatalLine(lines[j]) || parseLine(lines[j])))) break;
          if (/^Stack trace:$/.test(lines[j])) { end = j + 1; continue; }
          const f = lines[j].match(FRAME_RE);
          if (!f) { if (frames.length) break; else continue; }
          end = j + 1;
          if (f[2]) frames.push(`${f[4]} (${f[2]}:${f[3]})`);
        }
        if (frames.length) trace = frames.slice(0, 4);
      }

      failures.push(withSource(uncaught
        ? { file: uncaught[3], line: +uncaught[4], title: uncaught[1], code: uncaught[1],
            severity: "error", message: uncaught[2].replace(INCLUDE_PATH, ""), trace }
        : fatal
          ? { file: fatal[2], line: +fatal[3], title: "fatal error", label: "fatal error",
              severity: "error", message: fatal[1], trace }
          : { file: parse[2], line: +parse[3], title: "parse error", label: "parse error",
              severity: "error", message: parse[1] }, i, end));
    }

    if (!failures.length) return null;
    // The count is of distinct failures, which is not known until the pipeline has
    // collapsed PHP's doubled output - so the headline says what failed, not how many.
    // The warnings PHP printed first are context, not the headline: "2 warnings before
    // it" over a fatal error reads as though nothing broke, which is the one thing a
    // headline must never do. The count of what failed leads, and the warnings follow it.
    //
    // `failures` is still doubled here - the pipeline collapses PHP's two copies after
    // this returns - so the count is of distinct locations rather than of lines.
    const warnings = warned.size;
    const distinct = new Set(failures.map((f) => `${f.file}:${f.line}:${f.message}`)).size;
    const summary = distinct > 1 || warnings
      ? `${distinct} error${distinct === 1 ? "" : "s"}${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"} first` : ""}`
      : undefined;
    return { tool: "php", summary, failures };
  },
};
