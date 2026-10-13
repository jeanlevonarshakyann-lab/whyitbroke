import { isNoise, pinnedMessage } from "../util.js";
import { joinSources, withSource } from "../ownership.js";

// Babel names the file inside the message and follows the code frame with its own
// parser's stack - twenty frames of @babel/parser, which is the bulk of the log:
//
//   SyntaxError: /abs/bad.jsx: Unexpected token (1:10)
//   > 1 | const x = ;
//       |           ^
//     2 |
//       at constructor (/abs/node_modules/@babel/parser/lib/index.js:325:19)
//       ... twenty more
//
// The position is in the message rather than beside it, and the file is in front of the
// message rather than in a field of its own.
// The message ends where the whitespace before `(line:col)` starts - see pinnedMessage in util.js.
// It could end anywhere in a long stretch of spaces, and the whitespace on both sides of it could
// be divided every way as well: 8,000 spaces at the end of one line took three and a half minutes.
export const HEAD_RE = pinnedMessage(String.raw`^(\w*(?:Error|Exception)):[^\S\n]*(\S[^:]*?):`,
  { before: 0, separator: String.raw`[^\S\n]*`, least: 0, tail: String.raw`\((\d+):(\d+)\)[^\S\n]*$` });
// "> 1 | const x = ;" - the marked line of the code frame.
const MARKED_RE = /^[^\S\n]*>[^\S\n]*(\d+)[^\S\n]*\|[^\S\n]?(.*)$/;

export default {
  name: "babel",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["Error", "Exception"],
  category: "compile",
  commands: ["babel", "babel-node"],

  // The header alone is a plain SyntaxError, which node writes too. What makes it
  // Babel's is that the file is embedded in the message with the position after it.
  detect: (s) => s.split("\n").some((l) => HEAD_RE.test(l)),

  extract(s) {
    const lines = s.split("\n");
    const failures = [];
    const seen = new Map();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HEAD_RE);
      if (!m) continue;
      // A path is a path; anything else in that position is part of the message - but for
      // `unknown`, which is what babel names code it read from stdin with no filename given:
      // that error is babel's all the same, in no file.
      const stdin = m[2] === "unknown";
      if (!stdin && !/[/\\]|\.\w+$/.test(m[2])) continue;
      if (isNoise(m[2])) continue;
      const key = `${m[2]}:${m[4]}:${m[5]}`;

      let stmt, end = i + 1;
      for (let j = i + 1; j < lines.length && j <= i + 6; j++) {
        const marked = lines[j].match(MARKED_RE);
        if (marked) { stmt = marked[2].trim(); end = j + 1; break; }
      }
      // The header, down to the marked line of the code frame under it. Babel counts the
      // column in its header from 0 - `const x = ;` fails at `(1:10)`, with the caret under
      // the semicolon, the eleventh character - and a column here counts from 1.
      const failure = withSource({
        file: stdin ? undefined : m[2], line: +m[4], col: +m[5] + 1,
        title: m[1], code: m[1], severity: "error",
        message: m[3].trim(), stmt,
      }, i, end);
      if (seen.has(key)) { failures[seen.get(key)] = joinSources(failures[seen.get(key)], failure); continue; }
      seen.set(key, failures.length);
      failures.push(failure);
    }
    if (!failures.length) return null;
    const n = failures.length;
    return { tool: "babel", summary: n > 1 ? `${n} errors` : undefined, failures };
  },
};
