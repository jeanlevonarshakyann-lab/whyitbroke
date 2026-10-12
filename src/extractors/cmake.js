// CMake reports a configure failure with the script and line, the command that raised
// it, and an indented block of prose below:
//
//   CMake Error at CMakeLists.txt:3 (add_executable):
//     Cannot find source file:
//
//       missing_source.c
//
// Nothing in that shape looks like a compiler diagnostic, so a configure failure - a
// missing source, a package that will not be found, a parse error in the script itself -
// produced no diagnosis at all.
//
// ninja deliberately has no parser: what fails under it is a compiler, and that already
// has one. Its own "FAILED: [code=1] <object>" line restates the failure without adding
// to it, exactly as make's exit line does. make does have a parser, but only for the
// failures make itself raises - see src/extractors/make.js for where that line is drawn.
import { withSource } from "../ownership.js";
import { terminatorFree } from "../util.js";

const SPACE = /[^\S\n]/;

/** The match `line` gives the heading pattern
 *    /^CMake (Error|Warning|Deprecation Warning)(?:[^\S\n]+at[^\S\n]+(.+?):(\d+)(?:[^\S\n]+\(([^)]+)\))?)?:[^\S\n]*$/
 *  read in one pass. The heading ends in a colon, which can be in one place; each `path:N`
 *  before it is asked whether a `(command)` or nothing stands between it and that colon -
 *  where the pattern looked for the command's closing bracket to the end of the line from
 *  every one of them. */
export function headLine(line) {
  const kind = /^CMake (Error|Warning|Deprecation Warning)/.exec(line);
  if (!kind) return null;
  const k = kind[0].length;
  let t = line.length;
  while (t > 0 && SPACE.test(line[t - 1])) t--;
  t--;
  if (t < k || line[t] !== ":") return null;
  const found = (groups) => Object.assign([line, kind[1], ...groups], { index: 0, input: line, groups: undefined });
  const space = (at) => { while (at < line.length && SPACE.test(line[at])) at++; return at; };
  const clear = terminatorFree(line);
  // What follows the line number: nothing, or ` (command)`, and then the last colon.
  const command = (d) => {
    if (d === t) return [undefined];
    if (!SPACE.test(line[d] ?? "")) return null;
    const q = space(d);
    if (line[q] !== "(") return null;
    const x = line.indexOf(")", q + 1);
    return x === t - 1 && x > q + 1 ? [line.slice(q + 1, x)] : null;
  };
  const at = space(k);
  if (at > k && line.startsWith("at", at)) {
    const path = space(at + 2);
    if (path > at + 2) {
      const number = /:(\d+)/y;
      const located = (p, start) => {
        number.lastIndex = p;
        const n = number.exec(line);
        const c = n && command(number.lastIndex);
        return c ? found([line.slice(start, p), n[1], c[0]]) : null;
      };
      for (let p = line.indexOf(":", path + 1); p !== -1 && p < t; p = line.indexOf(":", p + 1)) {
        if (!clear(path, p)) break;
        const m = located(p, path);
        if (m) return m;
      }
      // The space before the path given back to it: a path of one space, right before a colon.
      if (path - (at + 2) >= 2 && clear(path - 1, path) && line[path] === ":") {
        const m = located(path, path - 1);
        if (m) return m;
      }
    }
  }
  return t === k ? found([undefined, undefined, undefined]) : null;
}
// cmake refusing before it reads any script: a source directory that is not there, one
// with no CMakeLists.txt in it, a generator it does not have. The message sits on the
// banner's own line and there is no location, because nothing has been read yet - so the
// pattern above, which ends at the colon, matches none of it and the whole log, which is
// usually that one line, went unread.
// Read to its last character that is not a space, at once: read lazily, it stopped at each space of
// a long stretch and read the rest of the stretch again from there.
export const FLAT_RE = /^CMake (Error|Warning):[^\S\n]+(\S(?:.*\S)?)[^\S\n]*$/;
// Everything from here down is the run reporting that it gave up.
const TAIL_RE = /^(?:--[^\S\n]|CMake Generate step failed|Configuring incomplete)/;
const MAX_MESSAGE = 4;

export default {
  name: "cmake",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["CMake "],
  category: "build",
  commands: ["cmake", "ctest"],

  detect: (s) => s.split("\n").some((l) => headLine(l) || FLAT_RE.test(l)),

  extract(s) {
    const lines = s.split("\n");
    const failures = [];
    let warnings = 0;
    for (let i = 0; i < lines.length; i++) {
      const flat = lines[i].match(FLAT_RE);
      if (flat) {
        if (flat[1] !== "Error") { warnings++; continue; }
        failures.push(withSource({
          title: "cmake error", label: "cmake error", severity: "error", message: flat[2],
        }, i, i + 1));
        continue;
      }
      const h = headLine(lines[i]);
      if (!h) continue;
      const message = [];
      // The heading and the indented prose under it.
      let end = i + 1;
      for (let j = i + 1; j < lines.length && message.length < MAX_MESSAGE; j++) {
        if (headLine(lines[j]) || TAIL_RE.test(lines[j])) break;
        // the block is indented; an unindented line has left it
        if (lines[j].trim() && !/^[^\S\n]/.test(lines[j])) break;
        if (lines[j].trim()) { message.push(lines[j].trim()); end = j + 1; }
      }
      if (h[1] !== "Error") { warnings++; continue; }
      failures.push(withSource({
        file: h[2], line: h[3] ? +h[3] : undefined,
        // The command that raised it - add_executable, find_package - is the closest
        // thing CMake gives to a code, and is what you would search for.
        title: h[4] ?? "cmake error", ...(h[4] ? { code: h[4] } : { label: "cmake error" }),
        severity: "error", message: message.join("\n"),
      }, i, end));
    }
    if (!failures.length) return null;
    const n = failures.length;
    return {
      tool: "cmake",
      summary: `${n} error${n > 1 ? "s" : ""}` +
        (warnings ? ` — ${warnings} warning${warnings > 1 ? "s" : ""} hidden` : ""),
      failures,
    };
  },
};
