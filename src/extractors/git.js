// git is the most-run command that can fail, and what it prints is mostly advice.
//
// A merge conflict says "Automatic merge failed; fix conflicts and then commit the
// result", which is the mechanism - the answer is the two CONFLICT lines above it
// naming the files. A rejected push says "failed to push some refs", then five lines of
// hint: explaining fast-forwards - the answer is the one ! [rejected] line. Both were
// coming back as a labelled guess pointing at the wrong line, or as nothing at all.

import { alsoFrom, withSource } from "../ownership.js";
import { append } from "../util.js";
import { ELIDED } from "../capture.js";

const CONFLICT = /^CONFLICT \(([^)]+)\): (.+)$/;
// The file a conflict leaves to resolve, as git writes it for each kind. A branch has no
// space in its name, so where one is named is where the paths around it end. A conflict of
// another kind than these names no file here.
const CONFLICTED = [
  // content, add/add, submodule
  /^Merge conflict in (.+)$/,
  // modify/delete, and rename/delete before merge-ort: the version left in the tree
  /[^\S\n]Version \S+ of (.+) left in tree\.$/,
  // rename/delete: the name it was given
  /^.+? renamed to (.+) in \S+, but deleted in \S+\.$/,
  // rename/rename, from the name both sides renamed - with merge-ort, and before it
  /^(.+?) renamed to .+ in \S+ and to .+ in \S+\.$/,
  /^Rename "?(.+?)"?->/,
  // file/directory, and two kinds of thing at one path
  /^directory in the way of (.+) from \S+; moving it to .+ instead\.$/,
  /^(.+?) had different types on each side;/,
];
const conflicted = (text) => CONFLICTED.map((re) => text.match(re)?.[1]).find(Boolean);
const REJECTED = /^[^\S\n]*!\s+\[([^\]]+)\][^\S\n]+(\S+)[^\S\n]+->[^\S\n]+(\S+)(?:[^\S\n]+\((.+)\))?$/;
const OVERWRITE = /^error: Your local changes to the following files would be overwritten by (\w+):$/;
// ...and under it, one of the files, indented.
const OVERWRITTEN = /^([^\S\n]+)\S/;
const DIAGNOSTIC = /^(fatal|error): (.+)$/;
// Even as a fallback, a bare `fatal:`/`error:` has to say something git would say.
// Gating the fallback on "git found nothing structural" is not enough on its own: in a
// log holding more than one tool git still scraped the other one's lines, and claimed
// cargo's "error: failed to run custom build command for `m2 v0.1.0`" as a git failure.
const GIT_ISH = /\b(?:git|repository|repo|branch|remote|refs?|HEAD|commits?|merge|rebase|checkout|clone|fetch|pull|push|stash|worktree|index|upstream|pathspec|revision|tree|tracked|untracked|working tree|\.git)\b/i;

// Everything git prints to be helpful rather than to say what went wrong.
const ADVICE = [
  /^hint: /, /^Please commit your changes or stash them/, /^Aborting$/,
  /^Use '--' to separate paths from revisions/, /^'git <command>/,
  /^Auto-merging /, /^Updating [0-9a-f]+\.\.[0-9a-f]+$/, /^To /,
  /^Either specify the URL from the command-line/, /^[^\S\n]*git remote add /,
  /^Automatic merge failed; fix conflicts/,
];
// "failed to push some refs" restates a rejection the ! line already explained.
const RESTATES = /^failed to push some refs/;
// ...and these restate a conflict the CONFLICT lines already named: what git will not do
// until it is resolved, and the commit a rebase could not apply because of it.
const RESTATES_CONFLICT = /(?:is not possible because you have unmerged files|^Exiting because of an unresolved conflict|^could not apply\b)/;

// Three things git says with no `fatal:` or `error:` in front of them. The clause in
// detect below is what keeps a bare severity word from claiming another tool's log, and
// it is written around that word - so these never reached this parser at all, and
// `git merge <missing-branch>`, `git pull` with no upstream and `git stash pop` with an
// empty stash each came back as "whyitbroke could not identify a diagnostic" and the log
// handed back. Each phrase is git's own and no other tool's, which is what lets it
// stand on its own where a bare `fatal:` cannot; and each IS the whole diagnostic. What
// follows the pull one is eight lines of advice on how to set an upstream, which is the
// remedy, not a second thing that went wrong - none of it starts with a severity word,
// so nothing below reads it.
const PLAIN = [
  [/^merge: (.+? - not something we can merge)$/m, "merge"],
  [/^(There is no tracking information for the current branch\.)$/m, "pull"],
  [/^(No stash entries found\.)$/m, "stash"],
];

const GIT_MARKERS = /(not a git repository|CONFLICT \(|failed to push some refs|would be overwritten by|did not match any file\(s\) known to git|not something we can merge|No configured push destination|unknown revision or path not in the working tree|Automatic merge failed|unmerged files)/;

export default {
  name: "git",
  // Strings a log has to hold for this parser to read anything from it - see src/router.js.
  signals: ["not a git repository", "CONFLICT (", "failed to push some refs", "would be overwritten by", "did not match any file(s) known to git", "not something we can merge", "No configured push destination", "unknown revision or path not in the working tree", "Automatic merge failed", "unmerged files", "There is no tracking information for the current branch.", "No stash entries found."],
  category: "vcs",
  commands: ["git"],

  // `fatal:` and `error:` belong to half the tools in existence, so one of git's own
  // phrases has to be present too.
  detect: (s) =>
    PLAIN.some(([re]) => re.test(s)) ||
    ((/^(?:fatal|error): /m.test(s) || /^CONFLICT \(/m.test(s) || /^[^\S\n]*!\s+\[rejected\]/m.test(s)) &&
      GIT_MARKERS.test(s)),

  extract(s) {
    const lines = s.split("\n");
    const failures = [];
    let conflicts = 0;
    let rejected = false;
    // `error:` and `fatal:` at line start belong to half the tools in existence, and in
    // a log holding more than one they are as likely to be somebody else's - cargo's
    // "error: could not compile ... due to 3 previous errors" is a tally cargo itself
    // suppresses. Only a line that says something git would say is read - see GIT_ISH -
    // and it is read beside a conflict, a rejected push or files that would be
    // overwritten, not instead of nothing: a log holding two git commands can hold a
    // conflict from one and `fatal: not a git repository` from the other, and the second
    // was dropped. A line restating the conflict or the rejection is not a second failure.
    const bare = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (ADVICE.some((re) => re.test(l))) continue;

      // Structural, like a conflict: git named the one thing that went wrong, and said
      // it without a severity word. It is not a `bare` fallback line.
      const plain = PLAIN.map(([re, label]) => [l.match(re), label]).find(([m]) => m);
      if (plain) {
        failures.push(withSource({ title: plain[1], label: plain[1], severity: "error", message: plain[0][1] }, i, i + 1));
        continue;
      }

      // Each kind of conflict names its file in a sentence of its own. Read as whatever came
      // after the first " in ", a file deleted on one side and changed on the other was
      // "HEAD and modified in topic.  Version topic of file2 left in tree.", and a rename's
      // was the branch it was renamed in.
      const c = l.match(CONFLICT);
      if (c) {
        conflicts++;
        // A kind with no file to read keeps its sentence, which is all there is to say where.
        const file = conflicted(c[2]);
        failures.push(withSource({ file, title: "merge conflict", label: "merge conflict", severity: "error",
          message: file ? `${c[1]} conflict` : `${c[1]} conflict: ${c[2]}` }, i, i + 1));
        continue;
      }

      const r = l.match(REJECTED);
      if (r) {
        rejected = true;
        failures.push(withSource({ title: r[1], label: r[1], severity: "error", subject: undefined,
          message: `${r[2]} -> ${r[3]}${r[4] ? ` (${r[4]})` : ""}` }, i, i + 1));
        continue;
      }

      const o = l.match(OVERWRITE);
      if (o) {
        // the files follow, one per line, indented
        // Each file's own line, and the sentence above them all that says what would happen.
        // A capture can leave out the middle of a long list, and the rows on the far side
        // of its marker are still the list's when they are indented as its rows are: the
        // list stopped at the marker, and the files the capture kept after it went unread.
        let indent;
        for (let j = i + 1; j < lines.length; j++) {
          const gap = lines[j] === "" && ELIDED.test(lines[j + 1] ?? "") ? j + 2 : ELIDED.test(lines[j]) ? j + 1 : -1;
          if (gap >= 0 && indent !== undefined && lines[gap]?.match(OVERWRITTEN)?.[1] === indent) {
            j = gap - 1;
            continue;
          }
          const row = lines[j].match(OVERWRITTEN);
          if (!row) break;
          indent ??= row[1];
          failures.push(alsoFrom(withSource({ file: lines[j].trim(), title: "local changes", label: "local changes", severity: "error",
            message: `would be overwritten by ${o[1]}` }, j, j + 1), i, i + 1));
        }
        continue;
      }

      const d = l.match(DIAGNOSTIC);
      if (d && GIT_ISH.test(d[2]) && !(rejected && RESTATES.test(d[2]))) bare.push(withSource({ title: d[1], label: d[1], severity: "error", message: d[2] }, i, i + 1));
    }

    append(failures, conflicts ? bare.filter((f) => !RESTATES_CONFLICT.test(f.message)) : bare);
    if (!failures.length) return null;
    // A summary that just repeats the only failure's message says it twice. Count the
    // conflicted files, which is the one case where a tally adds something.
    const summary = conflicts ? `${conflicts} conflicted file${conflicts > 1 ? "s" : ""}` : undefined;
    return { tool: "git", summary, failures };
  },
};
