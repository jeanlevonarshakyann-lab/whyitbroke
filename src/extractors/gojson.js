// `go test -json` is a stream of test2json events, one JSON object per line, and it is
// what gotestsum and most Go CI tooling keep. Nothing here could read a word of it: four
// real failures came back as a single guess made of raw JSON.
//
// It needs no parser of its own. Every "output" event carries a line of what go would
// have printed in verbose mode, so replacing each event with that line - and every other
// event with an empty one - rebuilds the verbose log line for line, and go's own parser
// reads it with everything it already knows about subtests, parallel tests, panics and
// data races. That reading of verbose output is what made this possible: until go's
// parser attributed a verbose line to the test named in the frame above it, the
// rebuilt log was read as wrongly as `go test -v` itself.
//
// The rebuilding happens inside the parser, not as a rewrite of the log, so each
// failure's private source range is still located in the JSON that was actually given.
import gotest, { goPackage } from "./gotest.js";
import { throughOrigin } from "../ownership.js";

const SPACE = /[^\S\n]/, TERMINATOR = /[\n\r\u2028\u2029]/;

/** Whether `line` is shaped like one event - an object with an "Action" key - as the pattern
 *  /^[^\S\n]*\{.*"Action"[^\S\n]*:.*\}[^\S\n]*$/ says it is. Its two wildcards made a line
 *  holding many `"Action":` and no closing brace look for that brace at the end again from
 *  every one of them; the brace can only be in one place, so it is looked at first. */
export function isEvent(line) {
  let a = 0;
  while (a < line.length && SPACE.test(line[a])) a++;
  if (line[a] !== "{") return false;
  let b = line.length - 1;
  while (b > a && SPACE.test(line[b])) b--;
  if (b <= a || line[b] !== "}") return false;
  // `.` takes no line terminator, but the space before the colon may hold one.
  let first = -1, last = -1;
  for (let k = a + 1; k < b; k++) if (TERMINATOR.test(line[k])) { if (first === -1) first = k; last = k; }
  for (let i = line.indexOf('"Action"', a + 1); i !== -1 && i < b; i = line.indexOf('"Action"', i + 1)) {
    if (first !== -1 && first < i) break;
    let j = i + 8;
    while (j < b && SPACE.test(line[j])) j++;
    if (j < b && line[j] === ":" && last < j) return true;
  }
  return false;
}

/** The verbose log a test2json stream was made from, and the line of the stream each of
 *  its lines came from - or null if this is not one. */
function rebuild(s) {
  let events = 0;
  // The package each event names, kept beside the line it becomes. go names the package
  // on every event and nowhere in the output it carries, and it closes every package only
  // once all of them have run - so the rebuilt log alone cannot tell two packages apart.
  const owner = [];
  const out = s.split("\n").map((line, i) => {
    if (!isEvent(line)) return line;
    let e;
    try { e = JSON.parse(line); } catch { return line; }
    if (typeof e?.Action !== "string") return line;
    events++;
    // A package that will not build names itself as `ImportPath`, and its test variant as
    // `example.com/mono/pkg [example.com/mono/pkg.test]` - see goPackage.
    const pkg = typeof e.Package === "string" ? e.Package : typeof e.ImportPath === "string" ? goPackage(e.ImportPath) : "";
    if (pkg) owner[i] = pkg;
    // A package that will not compile reports its errors as "build-output", not "output"
    // - and keeping only "output" lost a compile error without a word, so a stream with a
    // package that never built read as though every package had.
    return (e.Action === "output" || e.Action === "build-output") && typeof e.Output === "string"
      ? e.Output.replace(/\r?\n$/, "") : "";
  });
  if (!events) return null;
  // An event's output is one line as a rule; one that holds a line break becomes more.
  const origin = [];
  out.forEach((line, i) => {
    origin.push(i);
    if (line.includes("\n")) for (let k = line.split("\n").length - 1; k > 0; k--) origin.push(i);
  });
  return { text: out.join("\n"), origin, packageOf: (k) => owner[origin[k]] };
}

export default {
  name: "go test -json",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["\"Action\""],
  category: "test",
  commands: ["gotestsum"],

  detect: (s) => rebuild(s) !== null,

  extract(s) {
    const rebuilt = rebuild(s);
    const result = rebuilt === null ? null : gotest.extract(rebuilt.text, { packageOf: rebuilt.packageOf });
    if (!result) return null;
    // go's parser says where in the rebuilt log; the events are where in this one.
    return { ...result, failures: result.failures.map((f) => throughOrigin(f, rebuilt.origin)) };
  },
};
