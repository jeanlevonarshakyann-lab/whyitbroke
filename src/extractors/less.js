// lessc puts everything on the header line - the class, the message, the file, the line
// and the column - and echoes the source under it:
//
//   NameError: variable @undefined-var is undefined in /abs/bad.less on line 1, column 13:
//   1 .a { color: @undefined-var; }
//
// Self-bounding: there is nothing to scan for, because the whole diagnostic is one line.
import { withSource } from "../ownership.js";
import { lazyIn, tailFirst } from "../util.js";
import { lastPathIn } from "../location.js";

// The header, as the pattern
//   /^(\w*(?:Error|Exception)):[^\S\n]*(.+?)[^\S\n]+in[^\S\n]+(.+?)[^\S\n]+on line[^\S\n]+(\d+)(?:,[^\S\n]+column[^\S\n]+(\d+))?:?[^\S\n]*$/
// matches it, without trying the rest of a long line again from every ` in ` in it.
export const headLine = (line) => tailFirst(line, {
  tail: /on line[^\S\n]+(\d+)(?:,[^\S\n]+column[^\S\n]+(\d+))?:?[^\S\n]*$/, spaceBefore: 1, emptyMessage: false,
  heads: function* (l, c, clear, from) {
    const word = /^\w*/.exec(l)[0];
    if (l[word.length] !== ":" || !/(?:Error|Exception)$/.test(word)) return;
    for (const { end, message } of lazyIn(l, word.length + 1, 0, c, clear, from)) yield { end, groups: [word, message] };
  },
});
// "1 .a { color: @undefined-var; }" - the number, a space, the source.
const SOURCE_RE = /^[^\S\n]*(\d+)[^\S\n](.*)$/;

export default {
  name: "less",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["on line"],
  category: "compile",
  commands: ["lessc", "less"],

  detect: (s) => s.split("\n").some((l) => headLine(l)),

  extract(s) {
    const lines = s.split("\n");
    const failures = [];
    for (let i = 0; i < lines.length; i++) {
      const m = headLine(lines[i]);
      if (!m) continue;
      let stmt, end = i + 1;
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        const src = lines[j].match(SOURCE_RE);
        if (src && +src[1] === +m[4]) { stmt = src[2].trim(); end = j + 1; break; }
      }
      // The header, and the source it echoes when it does. The message can name a file with
      // " in " in it - an import that is missing, `theme in progress.less` - and the file is
      // the path after the last " in ": see lastPathIn.
      const { message, file } = lastPathIn(m[2], m[3]);
      failures.push(withSource({
        file, line: +m[4], col: m[5] ? +m[5] : undefined,
        title: m[1], code: m[1], severity: "error",
        message: message.trim(), stmt,
      }, i, end));
    }
    if (!failures.length) return null;
    const n = failures.length;
    return { tool: "less", summary: n > 1 ? `${n} errors` : undefined, failures };
  },
};
