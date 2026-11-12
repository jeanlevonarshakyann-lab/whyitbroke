// `mocha --reporter xunit`. The node parser was claiming these logs, because the stack
// inside the <failure> body looks exactly like one of node's - so the failure came back
// titled "AssertionError [ERR_ASSERTION]", with the test's name nowhere, no count of what
// passed, and XML markup left in the message.
//
// mocha names itself in the root element - `<testsuite name="Mocha Tests">` - which is
// what tells this apart from every other tool that writes a JUnit-shaped report.
import { cutElements, firstTag, isNoise, lineAt, xmlAttributes, xmlText } from "../util.js";
import { withSource } from "../ownership.js";
import { fileReference, v8Frame } from "../location.js";

const ROOT_RE = /<testsuite\b[^>]*\bname="Mocha Tests"/;
// An ES module's frames are URLs, `file:///repo/test.mjs:4:7`, and a URL is the path it names.
const frameAt = (line) => {
  const frame = v8Frame(line, { indented: true, unclosed: "split" });
  return frame && { ...frame, file: fileReference(frame.file) };
};
const MAX_MESSAGE_LINES = 3;

export default {
  name: "mocha xunit",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["name=\"Mocha Tests\""],
  category: "test",
  commands: ["mocha"],

  detect: (s) => !!firstTag(s, ROOT_RE),

  // The report is read as the document it is: each of Mocha's roots, the cases inside it,
  // and a case's failure inside the case. It was read a line at a time - the root on a
  // line, the cases on the lines after it, a failure on its case's own line - so a report
  // written without line breaks was no report, every case in the rest of the log was
  // Mocha's once one root had been seen, and a failure that had lost its closing tag read
  // on into the next case's. A report cut by a capture is still read: see cutElements.
  extract(s) {
    const failures = [];
    let failing = 0, passing = 0;
    for (const suite of cutElements(s, ["testsuite"])) {
      const root = xmlAttributes(suite.attributes);
      if (root.name !== "Mocha Tests") continue;
      const count = (key) => (/^\d+$/.test(root[key] ?? "") ? +root[key] : 0);
      // mocha files an assertion under `errors` and a reporter failure under `failures`.
      // Both are tests that did not pass, and the headline is what mocha's own reporters
      // would have printed for the same run.
      const failed = count("failures") + count("errors");
      failing += failed;
      passing += Math.max(0, count("tests") - failed - count("skipped"));
      for (const test of cutElements(suite.body, ["testcase"])) {
        // A test that passed is written as a self-closing tag with no body at all.
        const [outcome] = cutElements(test.body, ["failure", "error"]);
        if (!outcome) continue;
        const a = xmlAttributes(test.attributes);
        let file, line, col;
        const message = [];
        for (const raw of xmlText(outcome.body).split("\n")) {
          const frame = frameAt(raw);
          if (frame) {
            if (!file && !isNoise(frame.file)) { file = frame.file; line = frame.line; col = frame.col; }
            continue;
          }
          const t = raw.trim();
          // The class and message are repeated below the diff; the first telling is enough.
          if (t && message.length < MAX_MESSAGE_LINES && !message.includes(t)) message.push(t);
        }
        const name = [a.classname, a.name].filter(Boolean).join(" ").trim() || "test";
        // The test case, from its opening tag to where it ends.
        const from = suite.bodyAt + test.at, to = suite.bodyAt + test.textEnd;
        failures.push(withSource({
          file: file ?? a.file, line, col,
          title: name, subject: name, severity: "error",
          message: message.join("\n") || name,
        }, lineAt(s, from), lineAt(s, Math.max(from, to - 1)) + 1));
      }
    }
    if (!failures.length) return null;
    return {
      tool: "mocha",
      summary: `${failing || failures.length} failing, ${passing} passing`,
      failures,
    };
  },
};
