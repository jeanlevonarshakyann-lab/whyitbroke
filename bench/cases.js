// The real failing commands the benches run: `npm run coverage` and `npm run accuracy`.
//
// Each is a small broken project and the command that fails on it. Nothing here is a
// test: it needs the tools installed, and what a tool prints changes between versions.
import { spawnSync } from "node:child_process";

/** [group, tool, files to write, argv that fails on them] */
export const CASES = [
  ["lint", "ruff", { "shop.py": "import os\nimport sys\n\n\ndef total(items):\n    x = 1\n    return sum(items)\n" }, ["ruff", "check", "."]],
  ["lint", "shellcheck", { "s.sh": "#!/bin/bash\nif [ $1 == \"x\" ]; then\n  echo $undefined\nfi\n" }, ["shellcheck", "s.sh"]],
  ["lint", "yamllint", { "y.yaml": "key: value\n  bad: indent\n" }, ["yamllint", "y.yaml"]],
  ["lint", "markdownlint", { "m.md": "#Heading no space\nSome text\n" }, ["markdownlint", "m.md"]],
  ["lint", "pylint", { "m.py": "def add(a, b):\n    return a + b\n" }, ["pylint", "m.py"]],
  ["lint", "flake8", { "f.py": "import os\nx=1\n" }, ["flake8", "f.py"]],
  ["type", "mypy", { "m.py": "def add(a: int, b: int) -> int:\n    return a + b\n\nadd(\"x\", 1)\n" }, ["mypy", "m.py"]],
  ["type", "pyright", { "m.py": "def add(a: int, b: int) -> int:\n    return a + b\n\nadd(\"x\", 1)\n" }, ["pyright", "m.py"]],
  ["type", "tsc", { "bad.ts": "const n: number = \"hello\";\n" }, ["tsc", "--noEmit", "bad.ts"]],
  ["compile", "clang", { "bad.c": "int main(void) { return undefined_symbol; }\n" }, ["clang", "-c", "bad.c", "-o", "/dev/null"]],
  ["compile", "swiftc", { "bad.swift": "let x: Int = \"hello\"\n" }, ["swiftc", "bad.swift", "-o", "/dev/null"]],
  // The probe: /usr/bin/javac exists on every Mac, and is a stub without a JDK behind it.
  ["compile", "javac", { "Bad.java": "public class Bad { public static void main(String[] a) { int x = \"s\"; } }\n" }, ["javac", "Bad.java"], ["javac", "-version"]],
  ["compile", "cargo", { "Cargo.toml": "[package]\nname = \"c\"\nversion = \"0.1.0\"\nedition = \"2021\"\n", "src/main.rs": "fn main() { let x: i32 = \"hello\"; }\n" }, ["cargo", "build"]],
  ["test", "go test", { "go.mod": "module g\n\ngo 1.21\n", "s_test.go": "package g\n\nimport \"testing\"\n\nfunc TestA(t *testing.T) { t.Errorf(\"got %d, want 3\", 2) }\n" }, ["go", "test", "./..."]],
  ["test", "node --test", { "t.test.js": "const { test } = require(\"node:test\");\nconst a = require(\"node:assert\");\ntest(\"adds\", () => { a.strictEqual(1 + 1, 3); });\n" }, ["node", "--test"]],
  ["test", "pytest", { "test_shop.py": "def test_one():\n    assert 1 == 2\n" }, ["python3", "-m", "pytest", "-q"]],
  ["test", "unittest", { "test_u.py": "import unittest\n\nclass T(unittest.TestCase):\n    def test_a(self):\n        self.assertEqual(1, 2)\n" }, ["python3", "-m", "unittest"]],
  // The nine parsers below were the ones no case here ran: without them the share was a
  // claim about the tools that happened to be listed, not about what whyitbroke reads.
  ["test", "jest", { "package.json": "{\"name\":\"j\",\"version\":\"1.0.0\"}\n", "a.test.js": "test(\"adds\", () => { expect(1 + 1).toBe(3); });\n" }, ["jest"]],
  ["test", "jasmine", { "package.json": "{\"name\":\"j\",\"version\":\"1.0.0\"}\n", "spec/support/jasmine.json": "{\"spec_dir\":\"spec\",\"spec_files\":[\"*.spec.js\"]}\n", "spec/a.spec.js": "describe(\"math\", function () { it(\"adds\", function () { expect(1 + 1).toBe(3); }); });\n" }, ["jasmine"]],
  // TAP as a stream. node's own parser wins this one, which is the right answer and the
  // point of having it: the format changes, the reading does not.
  ["test", "node --test tap", { "t.test.js": "const { test } = require(\"node:test\");\nconst a = require(\"node:assert\");\ntest(\"adds\", () => { a.strictEqual(1 + 1, 3); });\n" }, ["node", "--test", "--test-reporter=tap"]],
  // And TAP as prove leaves it: no plan and no results, only Test::More's diagnostics.
  ["test", "prove", { "shop.t": "use strict;\nuse warnings;\nuse Test::More tests => 1;\n\nis(total(), 1050, 'invoice total');\n\nsub total { 1049 }\n" }, ["prove", "shop.t"]],
  // Maven and Gradle fetch their test dependencies on a cold cache, which is why the
  // read timeout is generous. The framework-backed cases install into their disposable
  // project before running, so the command measures the runner rather than a missing gem.
  // Runners whose parsers the corpus covers. Each was run by hand against the real tool
  // first. A test that imports its framework installs it before the command runs.
  ["test", "mocha", { "package.json": "{\"name\":\"t\",\"version\":\"1.0.0\"}\n", "test/a.test.js": "const assert = require(\"assert\");\ndescribe(\"shop\", () => { it(\"adds\", () => { assert.strictEqual(1 + 1, 3); }); });\n" }, ["mocha"]],
  ["test", "vitest", { "package.json": "{\"name\":\"t\",\"version\":\"1.0.0\",\"type\":\"module\"}\n", "a.test.js": "import { test, expect } from \"vitest\";\ntest(\"adds\", () => { expect(1 + 1).toBe(3); });\n" }, ["vitest", "run"]],
  ["test", "ava", { "package.json": "{\"name\":\"t\",\"version\":\"1.0.0\",\"type\":\"module\"}\n", "test/a.js": "import test from \"ava\";\ntest(\"adds\", t => { t.is(1 + 1, 3); });\n" }, ["npx", "ava"], undefined, ["npm", "install", "--silent", "--no-audit", "--no-fund", "ava"]],
  ["test", "node-tap", { "package.json": "{\"name\":\"t\",\"version\":\"1.0.0\"}\n", "test/a.test.js": "const t = require(\"tap\");\nt.equal(1 + 1, 3, \"adds\");\n" }, ["npx", "tap"], undefined, ["npm", "install", "--silent", "--no-audit", "--no-fund", "tap"]],
  ["test", "playwright", { "package.json": "{\"name\":\"t\",\"version\":\"1.0.0\"}\n", "a.spec.js": "const { test, expect } = require(\"@playwright/test\");\ntest(\"adds\", async () => { expect(1 + 1).toBe(3); });\n" }, ["npx", "playwright", "test"], undefined, ["npm", "install", "--silent", "--no-audit", "--no-fund", "@playwright/test"]],
  ["test", "mvn", { "pom.xml": "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>shop</groupId><artifactId>shop</artifactId><version>1.0</version>\n  <properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties>\n  <dependencies><dependency>\n    <groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId>\n    <version>5.10.2</version><scope>test</scope>\n  </dependency></dependencies>\n</project>\n", "src/test/java/ShopTest.java": "import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ShopTest {\n  @Test void invoiceTotal() { assertEquals(1050, 1049); }\n}\n" }, ["mvn", "-q", "-B", "test"], ["mvn", "-v"]],
  ["test", "gradle", { "settings.gradle": "rootProject.name = 'shop'\n", "build.gradle": "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\n", "src/test/java/shop/ShopTest.java": "package shop;\n\nimport org.junit.Test;\nimport static org.junit.Assert.*;\n\npublic class ShopTest {\n  @Test public void invoiceTotal() { assertEquals(1050, 1049); }\n}\n" }, ["gradle", "--no-daemon", "test"], ["gradle", "--version"]],
  ["test", "rspec", { "Gemfile": "source 'https://rubygems.org'\ngem 'rspec', '~> 3.13'\n", "spec/shop_spec.rb": "RSpec.describe 'shop' do\n  it 'adds' do\n    expect(1 + 1).to eq(3)\n  end\nend\n" }, ["bundle", "exec", "rspec"], ["bundle", "--version"], ["bundle", "install", "--quiet"]],
  ["test", "phpunit", { "composer.json": "{\"require-dev\":{\"phpunit/phpunit\":\"^13.0\"}}\n", "tests/ShopTest.php": "<?php\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class ShopTest extends TestCase\n{\n    public function testAdds(): void\n    {\n        $this->assertSame(3, 1 + 1);\n    }\n}\n" }, ["php", "vendor/bin/phpunit", "tests"], ["composer", "--version"], ["composer", "install", "--no-interaction", "--no-progress", "--quiet"]],
  ["runtime", "python", { "boom.py": "raise KeyError(\"missing config key\")\n" }, ["python3", "boom.py"]],
  ["runtime", "ruby", { "r.rb": "def f\n  x = \nend\n" }, ["ruby", "r.rb"]],
  ["runtime", "perl", { "p.pl": "use strict;\nmy $x = ;\n" }, ["perl", "p.pl"]],
  ["runtime", "php", { "p.php": "<?php\nfunction f( {\n" }, ["php", "-l", "p.php"]],
  ["runtime", "deno", { "d.ts": "throw new RangeError(\"out of stock\");\n" }, ["deno", "run", "d.ts"]],
  ["runtime", "bun", { "b.ts": "throw new RangeError(\"out of stock\");\n" }, ["bun", "b.ts"]],
  ["build", "cmake", { "CMakeLists.txt": "cmake_minimum_required(VERSION 3.10)\nundefined_command(foo)\n" }, ["cmake", "."]],
  ["build", "esbuild", { "e.js": "const x = {a:1,\n" }, ["esbuild", "e.js"]],
  ["package", "npm", { "package.json": "{\"name\":\"x\",\"private\":true,\"scripts\":{\"build\":\"true\"}}\n" }, ["npm", "run", "nosuchscript"]],
  ["package", "pip", {}, ["pip", "install", "nonexistent-package-xyzzy-12345==9.9.9"]],
  ["vcs", "git", {}, ["git", "pull"], undefined, ["git", "init", "-q", "."]],

  // Tools that read a project rather than a single file. Each still writes only what it
  // needs; anything wanting an install step is left out, because a measurement that has
  // to fetch a dependency tree first is measuring the network.
  ["lint", "eslint", { "eslint.config.js": "export default [{ rules: { eqeqeq: \"error\" } }];\n", "package.json": "{\"name\":\"c\",\"type\":\"module\",\"private\":true}\n", "shop.js": "if (1 == 2) {}\n" }, ["eslint", "shop.js"]],
  ["lint", "oxlint", { "shop.js": "const unused = 1;\nif (unused == null) { debugger; }\n" }, ["oxlint", "-D", "correctness", "-D", "suspicious", "shop.js"]],
  ["lint", "stylelint", { ".stylelintrc.json": "{ \"rules\": { \"length-zero-no-unit\": true } }\n", "shop.css": ".c { margin: 0px; }\n" }, ["stylelint", "shop.css"]],
  ["lint", "rubocop", { ".rubocop.yml": "AllCops:\n  NewCops: disable\n", "shop.rb": "class shop\nend\n" }, ["rubocop", "shop.rb"]],
  ["lint", "golangci-lint", { "go.mod": "module g\n\ngo 1.21\n", "shop.go": "package g\n\nfunc T() int {\n\tunused := 1\n\treturn 0\n}\n" }, ["golangci-lint", "run", "./..."]],
  ["lint", "biome", { "b.js": "const unused = 1;\nif (unused == null) { debugger; }\n" }, ["biome", "check", "b.js"]],
  ["format", "prettier", { "p.js": "const x = {a:1,\n" }, ["prettier", "--check", "p.js"]],
  ["format", "black", { "f.py": "def  bad( ):\n    return  1\n" }, ["black", "--check", "f.py"]],
  ["format", "rustfmt", { "Cargo.toml": "[package]\nname = \"rf\"\nversion = \"0.1.0\"\nedition = \"2021\"\n", "src/main.rs": "fn main(){let x=1;println!(\"{}\",x);}\n" }, ["cargo", "fmt", "--check"]],
  ["format", "sass", { "shop.scss": ".a {\n  color: $missing-var;\n}\n" }, ["sass", "shop.scss"]],
  ["compile", "dotnet", { "Shop.csproj": "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net9.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n", "Program.cs": "class Shop { static void Main() { int x = \"hello\"; } }\n" }, ["dotnet", "build"]],
  ["build", "swc", { "e.js": "const x = {a:1,\n" }, ["swc", "e.js"]],
  ["build", "webpack", { "e.js": "const x = {a:1,\n" }, ["webpack", "--entry", "./e.js", "--mode", "production"]],
  ["build", "make", { "Makefile": "all: bad.o\n\nbad.o: bad.c\n\tclang -c bad.c -o bad.o\n", "bad.c": "int main(void) { return undefined_symbol; }\n" }, ["make"]],
  ["package", "bundle", { "Gemfile": "source \"https://rubygems.org\"\n\ngem \"invoice-formatter-xyzzy\"\n" }, ["bundle", "install"]],
  ["package", "composer", { "composer.json": "{\n  \"name\": \"shop/api\",\n  \"require\": { \"vendor/definitely-not-real-xyzzy\": \"^1.0\" }\n}\n" }, ["composer", "install", "--no-interaction"]],
  ["package", "uv", { "pyproject.toml": "[project]\nname = \"shop\"\nversion = \"0.1.0\"\ndependencies = [\"definitely-not-real-xyzzy>=1.0\"]\n" }, ["uv", "lock"]],
  ["package", "poetry", { "pyproject.toml": "[project]\nname = \"shop\"\nversion = \"0.1.0\"\ndependencies = [\"definitely-not-real-xyzzy>=1.0\"]\n" }, ["poetry", "lock"]],
  ["infra", "terraform", { "main.tf": "output \"o\" {\n  value = var.undefined_one\n}\n" }, ["terraform", "validate"]],
  ["infra", "kubectl", { "bad.yaml": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: shop\nspec:\n  containers:\n  - name: api\n    image: nginx\n    ports:\n    - containerPort: \"80\"\n" }, ["kubectl", "apply", "--dry-run=client", "-f", "bad.yaml"]],
  ["infra", "docker", { "Dockerfile": "FROM alpine:3.19\nRUN nosuchcommand --help\n" }, ["docker", "build", "."]],
  // A host that cannot exist makes the daemon failure reproducible even on a machine
  // whose real Docker engine is running.
  ["infra", "docker daemon", {}, ["docker", "--host", "unix:///tmp/whyitbroke-no-docker.sock", "version"]],
];

/** `which` proves a name resolves. It does not prove the tool runs, and this machine is
 *  the case in point: macOS ships /usr/bin/javac whether or not a JDK is installed, and
 *  without one it prints where to download Java and exits 1. The bench ran it, read
 *  nothing out of that, and reported javac as a tool whyitbroke cannot read - a gap in the
 *  headline number that was not whyitbroke's and pointed at a parser nobody needs.
 *
 *  So a case may name a probe that has to succeed too. Only the ones where `which` is
 *  known to lie carry one; a probe on every tool would be 47 more guesses about exit
 *  codes, and a wrong one would hide a real tool instead of a missing one. */
export const have = (argv, probe) => {
  const which = process.platform === "win32" ? "where" : "which";
  if (spawnSync(which, [argv[0]], { encoding: "utf8" }).status !== 0) return false;
  if (!probe) return true;
  const r = spawnSync(probe[0], probe.slice(1), { encoding: "utf8", timeout: 60000 });
  return !r.error && r.status === 0;
};
