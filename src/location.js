/** Turn a file URL printed in a stack frame back into the path the tool meant.
 *
 * Logs are portable: a Windows log can be analysed on macOS or Linux, so Node's
 * fileURLToPath is the wrong operation here (it applies the host platform's path
 * rules). Decode the URL spelling directly and remove the slash that file URLs put
 * before a Windows drive letter.
 */
export function fileReference(value) {
  let file = String(value ?? "");
  if (file.startsWith("file://")) {
    const reference = file;
    try {
      const url = new URL(reference);
      let path;
      try { path = decodeURIComponent(url.pathname); }
      catch { path = url.pathname; }
      file = url.hostname && url.hostname.toLowerCase() !== "localhost"
        ? `//${url.hostname}${path}`
        : path;
    } catch {
      try { file = decodeURIComponent(reference.slice(7)); }
      catch { file = reference.slice(7); }
    }
  }
  if (/^\/[A-Za-z]:[\\/]/.test(file)) file = file.slice(1);
  return file;
}

/** Whether `text` could be part of a path that a project shares between platforms.
 *
 * A path may hold a space, so text that reads as the start of a path need not be one: a CI
 * stamp in front of a line-start location reads as the file `12:34:56 lint_me.py`. Windows
 * forbids `"*:<>?|` in a name, so no path a cross-platform project shares holds one - apart
 * from the colon after a drive letter and the one that ends a URL's scheme. A POSIX name may
 * still hold any of them, which is why this only ever breaks a tie and never rejects a
 * location on its own.
 */
export function portablePath(text) {
  const rest = String(text).replace(/^[A-Za-z]:(?=[\\/]|$)|^[A-Za-z][\w+.-]*:\/\//, "");
  return !/[|<>"?*:]/.test(rest);
}

/** A Node-style stack frame, including paths that contain spaces.
 *
 * `{ fn, file, line, col }` for a named frame and `{ file, line, col }` for a location
 * alone, with file URLs turned back into paths. See v8Frame.
 */
export function nodeFrame(line) {
  const frame = v8Frame(line);
  if (!frame) return null;
  const where = { file: fileReference(frame.file), line: frame.line, col: frame.col };
  return frame.closed ? { fn: frame.fn, ...where } : where;
}

const INLINE_SPACE = /[^\S\n]/;
const LINE_TERMINATOR = /[\r\u2028\u2029]/;
const spaceAt = (text, i) => i >= 0 && i < text.length && INLINE_SPACE.test(text[i]);
const digitAt = (text, i) => { const c = text.charCodeAt(i); return c >= 48 && c <= 57; };

/** `file:line:col` at the end of a location, read back from its end. */
function lineAndColumn(location) {
  let i = location.length;
  const colEnd = i;
  while (i > 0 && digitAt(location, i - 1)) i--;
  if (i === colEnd || location[i - 1] !== ":") return null;
  const col = +location.slice(i, colEnd);
  const lineEnd = --i;
  while (i > 0 && digitAt(location, i - 1)) i--;
  if (i === lineEnd || location[i - 1] !== ":") return null;
  const file = location.slice(0, i - 1);
  return file ? { file, line: +location.slice(i, lineEnd), col } : null;
}

/** Where code run by eval came from. V8 writes `eval at run (/app/test.js:2:3),
 *  <anonymous>:2:6` for a frame inside an eval'd string: the call to eval, then the place
 *  inside a string no one can open. Nested evals name each call in turn, outermost first,
 *  and the file is the innermost of them. */
function evalOrigin(location) {
  if (!location.startsWith("eval at ")) return location;
  // Every bracket's partner, in one pass: following the chain a level at a time with a
  // scan of its own cost the depth of the nest times its length.
  const partner = new Map(), open = [];
  for (let i = 0; i < location.length; i++) {
    if (location[i] === "(") open.push(i);
    else if (location[i] === ")" && open.length) partner.set(open.pop(), i);
  }
  let from = 0, to = location.length;
  while (location.startsWith("eval at ", from)) {
    const start = location.indexOf("(", from);
    const close = start === -1 ? undefined : partner.get(start);
    if (close === undefined || close >= to) break;
    from = start + 1;
    to = close;
  }
  return location.slice(from, to);
}

// The whitespace before a frame's `(`, from where it starts: from each place inside a long stretch
// the pattern read the rest of the stretch again.
export const BEFORE_CALL = /(?<![^\S\n])[^\S\n]+\(/;

/** A V8 stack frame, read in one pass: `{ fn?, file, line, col, closed }` or null.
 *
 *  V8 writes `at <name> (<location>)`, or `at <location>` for code with no name, and the
 *  location ends in `:line:column`. Every JavaScript reader here used to find the two parts
 *  with a lazy name, an optional ` (` and a path held to the end of the line - which retried
 *  the rest of the line from every place the name could stop. A frame line padded with two
 *  thousand spaces took ten seconds to refuse, and four thousand over a minute.
 *
 *  So the location is read from the end instead: the closing bracket's partner opens it,
 *  and `:line:column` comes off its end. That is also what V8 means. A name can hold ` (`
 *  - a computed method called `cache (layer` is written `at cache (layer (/app/x.js:1:4)` -
 *  and a path can hold brackets of its own, and only the last group on the line is the
 *  location. A frame inside an eval'd string points at the call to eval.
 *
 *  `indented`: the line must begin with whitespace, as a stack under an error does.
 *  `unclosed`: what a line with no closing bracket is - `"whole"`, a location with no name,
 *  or `"split"`, which takes a name before the first ` (` as well, for a frame cut short.
 */
export function v8Frame(text, { indented = false, unclosed = "whole" } = {}) {
  const line = String(text);
  let at = 0;
  while (spaceAt(line, at)) at++;
  if (indented && at === 0) return null;
  if (line[at] !== "a" || line[at + 1] !== "t" || !spaceAt(line, at + 2)) return null;
  at += 2;
  while (spaceAt(line, at)) at++;
  let end = line.length;
  while (end > at && spaceAt(line, end - 1)) end--;
  if (end <= at) return null;
  const body = line.slice(at, end);
  // `.` in the patterns this replaces never crossed a line terminator, and neither does this.
  if (LINE_TERMINATOR.test(body)) return null;
  if (body.endsWith(")")) {
    let depth = 0, open = -1;
    for (let k = body.length - 1; k >= 0; k--) {
      if (body[k] === ")") depth++;
      else if (body[k] === "(" && --depth === 0) { open = k; break; }
    }
    if (open === -1) return null;
    const head = body.slice(0, open);
    if (head && !spaceAt(head, head.length - 1)) return null;
    const where = lineAndColumn(evalOrigin(body.slice(open + 1, -1)));
    if (!where) return null;
    const fn = head.trimEnd();
    return { ...(fn ? { fn } : {}), ...where, closed: true };
  }
  if (unclosed === "split") {
    const cut = BEFORE_CALL.exec(body);
    if (cut && cut.index > 0) {
      const where = lineAndColumn(body.slice(cut.index + cut[0].length));
      if (where) return { fn: body.slice(0, cut.index), ...where, closed: false };
    }
  }
  // V8 marks a frame of an async function with no name by writing `async ` in front of
  // its location: `at async file:///app/node_modules/ava/lib/runner.js:515:21`.
  const where = lineAndColumn(body.replace(/^async[^\S\n]+(?=\S)/, ""));
  return where ? { ...where, closed: false } : null;
}

/** Read a location at the beginning of a line without backtracking across the line.
 *
 * A path regex that accepts arbitrary text retries its remaining grammar at every colon
 * on an untrusted one-line log and can go quadratic. Walk the numeric separators once
 * and let the caller validate the bounded grammar after them. If a path itself contains
 * a numeric-colon sequence, a rejected candidate does not stop the search.
 */
export function locatedPrefix(value, readRest, { column = true } = {}) {
  const text = String(value);
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) !== 58) continue; // :
    let end = at + 1;
    while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) end++;
    if (end === at + 1 || text.charCodeAt(end) !== 58) continue;
    const line = +text.slice(at + 1, end);
    let col;
    if (column) {
      const start = ++end;
      while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) end++;
      if (end === start || text.charCodeAt(end) !== 58) continue;
      col = +text.slice(start, end);
    }
    const file = text.slice(0, at);
    if (!file) continue;
    const detail = readRest(text.slice(end + 1));
    if (detail) return { file, line, ...(column ? { col } : {}), ...detail };
  }
  return null;
}
