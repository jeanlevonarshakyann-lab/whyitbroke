// What holds for the source itself.
//
// A function a module calls by name is one the module has: it declares it, imports it, is
// handed it, or the language provides it. A call left behind when its function was removed
// is not found by running the code until a log reaches that line - and here not even then.
// deno's JUnit reader called one for a failure with no text; a parser that throws is taken
// for one that read nothing, so the report was dropped and nothing said why. It is found
// by reading the code instead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".js")) modules.push(path);
  }
};
walk(join(root, "src"));
walk(join(root, "bin"));

// Words that take brackets and are not calls.
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await", "new", "throw", "void",
  "delete", "in", "of", "do", "else", "yield", "case", "super", "import", "with", "instanceof", "async"]);
// What can stand before a `/` that starts a pattern rather than divides.
const BEFORE_PATTERN = /[(,=:[!&|?{};+\-*%<>~^]/;
const WORD_BEFORE_PATTERN = /\b(?:return|typeof|case|of|in|yield|void|do|else)$/;

/** A module's code with what is not code blanked, at the same length: its comments, the
 *  text of its strings and templates, and its patterns. What a template evaluates,
 *  `${...}`, is code and is kept. */
function codeOf(source) {
  const blank = (from, to) => source.slice(from, to).replace(/[^\n]/g, " ");
  let out = "", last = "";
  for (let i = 0; i < source.length;) {
    const c = source[i], d = source[i + 1];
    if (c === "/" && (d === "/" || d === "*")) {
      const found = d === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
      const end = found === -1 ? source.length : found + (d === "/" ? 0 : 2);
      out += blank(i, end); i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      out += c + blank(i + 1, j) + c; i = j + 1; last = c;
    } else if (c === "`") {
      let j = i + 1;
      out += "`";
      while (j < source.length && source[j] !== "`") {
        if (source[j] === "\\") { out += "  "; j += 2; continue; }
        if (source[j] === "$" && source[j + 1] === "{") {
          let depth = 1, k = j + 2;
          while (k < source.length && depth) { if (source[k] === "{") depth++; else if (source[k] === "}") depth--; k++; }
          out += `\${${codeOf(source.slice(j + 2, k - 1))}}`; j = k; continue;
        }
        out += source[j] === "\n" ? "\n" : " "; j++;
      }
      out += "`"; i = j + 1; last = "`";
    } else if (c === "/" && (last === "" || BEFORE_PATTERN.test(last) || WORD_BEFORE_PATTERN.test(out.trimEnd()))) {
      let j = i + 1, inClass = false;
      for (; j < source.length && source[j] !== "\n"; j++) {
        if (source[j] === "\\") j++;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
      }
      out += `/${blank(i + 1, j)}/`; i = j + 1; last = "/";
    } else {
      out += c; if (!/\s/.test(c)) last = c; i++;
    }
  }
  return out;
}

/** The names `code` calls and nowhere else mentions. A name the module has is written
 *  somewhere other than in front of a bracket: where it is declared, imported or handed in.
 *  `name(...) {` writes a method and `function name(` a function; neither is a call. */
function callsToNothing(code) {
  const names = new Map();
  for (const match of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(\s*\()?/g)) {
    const entry = names.get(match[1]) ?? { calls: 0, others: 0 };
    names.set(match[1], entry);
    if (!match[2]) { entry.others++; continue; }
    let depth = 1, after = match.index + match[0].length;
    while (after < code.length && depth) { if (code[after] === "(") depth++; else if (code[after] === ")") depth--; after++; }
    const written = /(?:function\*?|async)\s+$/.test(code.slice(Math.max(0, match.index - 12), match.index)) || /^\s*\{/.test(code.slice(after, after + 40));
    if (written) entry.others++; else entry.calls++;
  }
  return [...names].filter(([name, { calls, others }]) => calls && !others && !KEYWORDS.has(name) && !(name in globalThis)).map(([name]) => name);
}

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};

console.log("\nthe source");

test("the reading of a module finds a call to nothing, and only that", () => {
  const found = (source) => callsToNothing(codeOf(source));
  assert.deepEqual(found("const a = () => 1;\nfunction b(c) { return c(a()) + gone(1); }\n"), ["gone"]);
  // Declared, imported, handed in, a method, a method being written, the language's own.
  assert.deepEqual(found('import { x } from "./y.js";\nconst o = { m(v) { return v; } };\nexport function f(g, { h }) { return g(h(x(String(o.m(1))))); }\n'), []);
  // A call inside what is not code is not one: a comment, a string, a template's text, a pattern.
  assert.deepEqual(found("// gone(1)\n/* gone(2) */\nconst s = 'gone(3)' + \"gone(4)\" + `gone(5)`;\nconst p = /gone\\(6\\)|[/]gone(7)/;\n"), []);
  // ...and inside what a template evaluates, it is.
  assert.deepEqual(found("const s = `${gone(1)} text ${[1].map((n) => n)}`;\n"), ["gone"]);
});

test("every function a module calls is one it has", () => {
  assert.ok(modules.length > 80, `only ${modules.length} modules were read`);
  const lost = modules.flatMap((path) => callsToNothing(codeOf(readFileSync(path, "utf8")))
    .map((name) => `${relative(root, path).replace(/\\/g, "/")} calls ${name}(), and has no ${name}`));
  assert.deepEqual(lost, []);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
