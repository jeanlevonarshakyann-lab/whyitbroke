# Supported tools

[← Project overview](../README.md)

These are the output formats whyitbroke reads. Each parser is checked against a
captured, sanitized failure log. The table summarizes what the report extracts;
where an output format omits a location or message, whyitbroke does not invent one.

## What it reads

### Tests and runtimes

| Tool | What you get |
|---|---|
| **pytest** | test name, `file:line`, the assertion, the `E` explanation |
| **pytest `--tb=...`** | The short summary identifies each failed test across traceback styles; tracebacks add locations where available. `--tb=line` failures are matched by message, not position. |
| **unittest** | same, with the deepest *your-code* frame — not the harness |
| **`python -m` with nothing to run** | `python -m pytest` when pytest is not installed prints one line and stops — the interpreter's path and the module it could not find. No traceback, no location, and it is the whole log of a step that never ran a test |
| **Python tracebacks** | the frame in your code, not the 9 in site-packages |
| **deno test** | test name and `file:line` from the header, without the assert-library frames |
| **deno lint / deno fmt --check** | Default, compact, and JSON lint diagnostics; formatting failures from `deno fmt --check`. JSON columns are adjusted to match the human formats. |
| **deno test `--reporter=junit`** | Each failed test, including JUnit messages that span lines and contain assertion diffs. |
| **deno run** | the exception class, `file:line:col` and your frames — the message without `error:` and without the `file://` scheme |
| **deno check** | the `TS` code, the explanation and the location — not the `error: Type checking failed.` tally underneath them |
| **bun test** | Test name, location, and failure block, including coloured output. Incomplete captures are labelled rather than assigned another test’s failure. |
| **bun test `--reporter=junit`** | Failed test name and declaration location. Bun’s JUnit failures have no message body, so no message is inferred. |
| **bun** | a runtime crash read as bun's rather than node's, keyed on the version bun stamps at the foot of one |
| **node --test** | test name, `file:line`, and the assertion out of TAP's YAML block |
| **Node stack traces** | the error, the caret, your frames; `node:internal` hidden |
| **Playwright** | the test name, the line that actually threw, and the offending expression — not the paths to its artifact files |
| **Playwright `--reporter=json` and `junit`** | Test names, source locations, and failures from JSON or JUnit reports. JSON includes suite names and source lines. |
| **jest / jest --json** | test name, `file:line`, the matcher, expected vs received; the machine report is read as the same Jest failures when stdout is all the log retained |
| **jest `--reporters=github-actions`** | Failures from workflow annotations and groups, counted once; assertion locations take precedence over test declaration locations. |
| **tap** | test name, `file:line:col` from its own `at:` block, and the values out of its diff — not the file-level roll-up, which counts failures rather than being one |
| **bare TAP** (`mocha --reporter tap`, Test::More, `prove`, `prove -v`) | Failed test names and available locations from plain TAP, including Test::More and `prove`. Verbose and default `prove` layouts are both supported; counts come from their own diagnostics. |
| **jasmine** | spec name, the assertion, and the frame in your spec — its own frames name no file at all, so they cannot be mistaken for yours |
| **ava** | test name, the assertion and the value it is about — the diff for a comparison, the prose for anything else; a thrown class names the failure without pretending to be its identity |
| **mocha** | suite and test name, the assertion, and the frame in your test — not the ten `node:internal` ones under it; a timeout reports no location rather than a line inside node's timers. The diff under an assertion is kept, not the `+ expected - actual` legend over it |
| **mocha --reporter json / json-stream / xunit** | Full test names and failure locations from JSON, JSON stream, and xUnit reports, including pretty-printed JSON. |
| **vitest** | same, with the real source line — not vitest's truncated `…` version |
| **vitest `--reporter=junit` / `github-actions`** | Failed tests and locations from JUnit or GitHub annotations; value diffs are retained without empty diff headers. |
| **vitest `--reporter=json`** | Failed tests and messages from Vitest’s Jest-shaped JSON report. The JSON message omits the pretty reporter’s value diff. |
| **vitest writing to a file** | the console's report-file location when a reporter writes its full results elsewhere |
| **vitest --reporter=tap / tap-flat** | Vitest TAP and tap-flat failures, with test locations, exception classes, and comparison values; file-level roll-ups are excluded. |
### Linters, compilers, and formatters

| Tool | What you get |
|---|---|
| **eslint** | errors only; warnings counted and set aside |
| **eslint that never ran** | Configuration crashes, invalid options, missing formatters, and unmatched file patterns. Actionable advice stays with the error. |
| **eslint `-f json`** | Rules and exact locations from ESLint JSON and `json-with-metadata`, including reports inside package-runner logs. |
| **go test** | test name, `file:line`, the message; panics resolved past the runtime frames, and `-race` reports at the racing line |
| **go test -json** | the same failures as `go test -v`, from the test2json stream gotestsum and most Go CI keep. Each output event is a line of the verbose log, so the log is rebuilt line for line and read by go's own parser — subtests, parallel tests and panics included |
| **go build** | compile errors with source context |
| **go vet** | the location, which sits inside the message when vet reports a package that will not compile |
| **go mod** | Malformed `go.mod` files with line numbers; missing modules with the reason and the import chain that required them. Download progress is excluded. |
| **gofmt `-d`** | Each diff hunk’s starting line and current source, so separate formatting problems in one file remain separate. |
| **go refusing to run** | Unknown flags or commands, missing package patterns, and other Go CLI refusals before a build starts. |
| **go vet `-json`** | Analyzer names such as `printf` and `copylocks` as codes, with locations from every package document. |
| **cargo test** | test name, `file:line`, the assertion and its left/right values |
| **cargo build** | error code and the inline annotation — not the 25 lines of trait impls — and `--message-format=short`, which puts the whole diagnostic on one line with no `-->` beneath it. The warnings it hid are counted as cargo counts them, a duplicate once, in every format |
| **cargo clippy** | the lint name as the title, so you know what to fix or allow |
| **cargo fmt `--check`** | Each formatting diff hunk and its starting line, for `cargo fmt --check` and `rustfmt --check`. Parse errors use Rust compiler diagnostics. |
| **cargo `--message-format=json`** | Rust compiler diagnostics from Cargo or rustc JSON, with primary spans and source lines. Duplicate diagnostics across targets are counted once. |
| **less** | the class, message, `file:line:col` and the offending line — lessc puts all of it on one line, with the location as prose at the end |
| **swc** | the message and location miette drew, not the `Failed to compile 1 file with swc.` tally underneath them |
| **babel** | the file out of the middle of the message and the marked line of its code frame — not the twenty `@babel/parser` frames underneath |
| **sass** | Messages and locations from Sass error boxes, including ASCII output, import loops, fatal deprecations, and warnings. |
| **webpack** | the module, the line and the explanation — not the forty lines of resolver diary that follow it |
| **prettier** | which files failed the format check, so a job that exits non-zero on formatting says which ones |
| **Biome** | Rule path, location, severity, and message for lint, parse, and format diagnostics. Advice and fix diffs are excluded. |
| **Biome `--reporter=`** | JSON, GitHub, GitLab, JUnit, and summary reporters. Formats without columns or severity keep those limits instead of inventing values. |
| **oxlint** | Rules, locations, and messages from terminal, agent, JSON, checkstyle, GitLab, JUnit, SARIF, stylish, and Unix output. Help text is separate. |
| **stylelint** | the rule name as the code, `file:line:col`, and the problem — warnings counted and set aside, like eslint |
| **stylelint `--formatter unix` / `json` / `compact` / `tap`** | Rules, locations, and warning counts from Unix, JSON, compact, and TAP formatters, consistent with the default output. |
| **markdownlint** | rule code, location, and expected versus actual values. Multiple aliases still count as one rule. |
| **markdownlint `--json`** | the same violations as records, worded exactly as the text form words them |
| **flake8** | the check code as the code and `file:line:col` — the code is what goes in a `noqa` comment — and `--format=pylint`, which brackets the code and prints no column. pylint's own parseable format always names the check in the bracket too, which is how the two stay apart |
| **pylint** | the symbolic name as the title and the numeric code beside it; when a run has real errors the convention and refactor advice steps aside and is counted. A path may contain a space — the message code after it is what bounds the name |
| **pylint `-f parseable` / `msvs` / `json` / `json2`** | Findings from parseable, MSVS, JSON, and JSON2 reports. Formats without columns remain location-only. |
| **black** | which files failed the format check, and for one it cannot parse, the reason and the position |
| **ruff** | Rule codes, locations, messages, and available fix hints across Ruff text, JSON, annotation, XML, and SARIF reporters. Ambiguous `pylint` output follows Flake8’s compatible format. |
| **pyright** | the rule name as the code, the column, and the indented line that says *why* — not the column pasted into the message |
| **pyright `--outputjson`** | the same failures from the document, basedpyright's too. It counts lines and characters from zero where the text counts from one, and its rule is a field rather than the end of the explanation; the summary's counts are the document's own |
| **mypy** | error code, `file:line`, the type-checking message; notes and warnings set aside |
| **mypy `--output=json`** | the same errors as records, one per line, agreeing with the text form. This form always carries a column, which the default output prints only when asked, and a `hint` where the text form writes a note under the error |
### Build, infrastructure, and CI

| Tool | What you get |
|---|---|
| **Terraform** | the file, the line, the block, and the sentence at the bottom of the box that says what to do |
| **terraform refusing a command** | `Terraform has no command named "x".` — one sentence, no box, and the whole log of a pipeline that stopped before touching any state |
| **terraform fmt `-check -diff`** | Each diff hunk and starting line from Terraform’s `old/` and `new/` file headers. Plain `terraform fmt -check` lists files without line numbers. |
| **CMake** | the script line and the command that raised it — `add_executable`, `find_package` |
| **CMake refusing to start** | a source directory that is not there, one with no `CMakeLists.txt`, a generator it does not have. The message sits on the banner's own line with no location, because nothing has been read yet, and that one line is usually the whole log |
| **ninja** | no parser of its own: what fails under it is a compiler, which already has one |
| **kubectl** | the sentence a person wants, not five identical klog lines from inside client-go |
| **GCC/Clang** | C-family compiler errors, locations, driver failures, and warning counts. Interleaved logs distinguish extracted errors from the compiler’s own tally. |
| **clang `-fdiagnostics-format=msvc` / `vi`** | Clang diagnostics in MSVC and vi location formats, including mixed error-and-warning tallies; MSVC-shaped findings require a C-family source. |
| **swift test** | XCTest and swift-testing failures, including assertion messages and named crashes. Linux XCTest naming is not yet supported. |
| **Swift** | the diagnostic and the `[#group]` tag as its code — not the annotation swiftc draws underneath, which repeats the message word for word |
| **ShellCheck** | the `SCxxxx` code, the source line, and the column the carets are drawn under — from the block format it prints by default as well as `-f gcc`. A run that fails on nothing worse than style still says so, because shellcheck exits non-zero on those too |
| **ShellCheck `-f json` / `json1` / `checkstyle`** | The same findings as ShellCheck text output, from JSON, JSON1, and checkstyle. `-f quiet` prints nothing to read. |
| **yamllint** | the rule, matched as the last parenthesised word so a message like `line too long (106 > 80 characters)` keeps its own brackets. Warnings are set aside: yamllint exits zero on a run that found only those |
| **yamllint `-f github`** | GitHub annotations with the repeated yamllint position and rule verified against the annotation’s location. |
| **Docker / BuildKit** | Dockerfile line and the failed step’s own error, including unknown commands and daemon connection failures. Docker’s repeated summary is excluded. |
| **make** | Makefile parse errors, missing targets, and missing recipe commands. A recipe’s `Error N` only relays another tool’s exit status. |
### Ruby, JVM, .NET, and PHP

| Tool | What you get |
|---|---|
| **RuboCop** | Cop name, location, and offending line across text, TAP, JSON, JUnit, GitHub, and Markdown output. Conventions yield to errors. |
| **golangci-lint** | Linter name, location, and message across text, JSON, SARIF, and CI-oriented formats; compiler diagnostics remain attributed to Go. |
| **minitest** | Minitest failures, exceptions, messages, source locations, and value diffs. Skips and rake’s repeated summary are excluded. |
| **RSpec** | example name, failure message, and `spec/file:line` location |
| **RSpec `-f json`** | Failed examples and backtrace locations from JSON. Pending examples are counted; the JSON includes exception classes but omits quoted source. |
| **Ruby** | the exception class, the line that raised, and the unwind — for a missing gem, the line that asked for it rather than `kernel_require.rb` |
| **Perl** | the location, which Perl writes as prose at the end of the message — but never out of a TAP comment, which is Test::More reporting a test rather than Perl dying; `near "= ;"` kept, the `@INC` list dropped, warnings told apart from a fatal die by what they say |
| **javac / Maven / Gradle** | JVM compiler errors with warnings excluded, Surefire test failures, and build scripts that fail to evaluate |
| **javac in other languages** | javac translates its severity into the three languages it ships — `Fehler:`, `エラー:`, `错误:`, and `Warnung:` or `警告:` for a warning. That set is javac's own and it is closed, so it is named rather than guessed at |
| **Gradle test failures** | Failed Gradle tests and their source locations across plain, rich, and full exception output. Quiet mode names no individual tests. |
| **JUnit XML from the JVM** | Maven Surefire and Gradle JUnit XML failures with Java test frames. Generic JUnit-shaped XML is not assumed to be a JVM run. |
| **.NET** | compiler error codes with `file:line:column`; warnings set aside |
| **dotnet format `--verify-no-changes`** | each location and formatting rule, including `WHITESPACE`, `IMPORTS`, and `ANALYZERS` |
| **dotnet test** | test name, `file:line`, the assertion; reflection frames dropped |
| **dotnet test in other languages** | Localized VSTest failures and counts in German, Japanese, French, Chinese, Korean, Russian, and Brazilian Portuguese. |
| **Microsoft.Testing.Platform in other languages** | Localized Microsoft.Testing.Platform failures, stacks, assemblies, and counts across its fourteen shipped languages. |
| **dotnet test `--logger trx`** | Test results, messages, and user-code stack locations from TRX; counters provide the run tally. |
| **PHPUnit** | test name, assertion message, and `file:line` location |
| **PHPUnit `--log-junit` / `--testdox` / `--log-teamcity`** | PHPUnit failures from JUnit XML, TestDox, and TeamCity output. JUnit gives assertion locations; TeamCity reports counts where no source location is present. |
| **PHP** | the exception class and the stack; PHP writes every diagnostic twice, and you get it once |
### Build tools and package managers

| Tool | What you get |
|---|---|
| **esbuild** | the diagnostic and its source line — not the CLI wrapper's `Command failed:` stack |
| **vite / rollup** | the rollup error code, `file:line:col` and the offending line |
| **tsc** | errors grouped by file, with the assignability chain down to the real reason — and `--pretty`, which writes `file:line:col - error TS2322:` instead of `file(line,col):`, and is the default whenever tsc thinks it is talking to a terminal |
| **git** | the conflicted files, not "Automatic merge failed"; the rejected ref, not five lines of `hint:`; what it refused to merge, pull or pop, not the advice on how to fix it |
| **npm** | its own failures — a missing script, a bad engine — without the trailing advice |
| **npm `--json`** | The same npm failure from JSON on stdout or text on stderr, counted once, with error code and useful message. |
| **pnpm** | its error code and message — indented with a thin space, which is why it needed one |
| **pnpm's boxed errors** | Error code, package, cause, and help from newer pnpm boxed output, including names wrapped across lines. |
| **yarn** | the failure without the documentation link that follows it |
| **composer** | Composer dependency-resolution problems by package, plus fatal errors with their relevant file. Progress, guesses, and help links are excluded. |
| **uv** | Dependency-resolution causes and TOML parse locations. Wrapped explanations are rejoined; repeated settings warnings are excluded. |
| **Poetry** | The complete dependency-resolution chain as one failure, or a malformed `pyproject.toml` with its location. |
| **bundle** | Missing gems, version conflicts, and Gemfile syntax errors, with relevant package names and source locations. |
| **pip** | the exception a build backend actually raised, not `subprocess-exited-with-error`; resolution failures once rather than twice, without the package index pasted in |
### Mixed and unfamiliar logs

| Tool | What you get |
|---|---|
| **a log stamped by CI** | GitHub Actions and `gh run view --log`, Jenkins' Timestamper, Buildkite `--timestamp-lines`, `docker logs --timestamps`, journald — the stamp comes off before anything reads the log |
| *anything else* | best-effort: lines that look like errors, including plain unix ones like `curl: (7) Failed to connect`, marked as a guess. A `warning:` or `note:` is not one, after a location or not — a javac run that only warned is not a failed build |

Unrecognised output is never silently swallowed — you get a labelled guess, or the raw text back.

A CI job usually runs a linter, then a typechecker, then the tests, and pastes all of
it into one log. Only one parser can own that output, but every tool's failures are
extracted and shown, each under the tool that found it:

```
  ✗ 2 failed | 12 passed (14)
    this log also contains failures from eslint (90), tsc (5), shown below

  shop.test.js:3  invoice total
    AssertionError: expected 1049 to be 1050

  — eslint 90 problems (90 errors, 0 warnings)
    5 likely causes, 52 sites

  lib/adapters/fetch.js:133  eqeqeq  (22 cases)
    Expected '!==' and instead saw '!='
```

Each tool's failures are grouped using its own vocabulary. In `--format github`, the
first ten get annotations — GitHub's per-step error limit — with the tool named when it
is not the one that owns the log. Every failure remains in the job summary and JSON
report, and the log says how many annotations GitHub could not accept. In `--json`,
`failures` still means what the winning tool reported — unchanged — and the rest arrive
under `others`.

The same diagnosis is never reported twice: unittest prints its failures *as* Python
tracebacks, and that is one failure read two ways, not two failures. Two different tools
flagging the same line for different reasons are both kept, because they are. So are two
runs that say the same thing at the same line: a failure is found where its location is
written as a location, `src/main.rs:2:22`, before anywhere its numbers merely appear — a
one-line JSON record is full of numbers, and a byte offset is not a column.

A tool that does not own the log has to say where its failure is, or what it is — a
diagnostic with no location and no identifier is a stray match on somebody else's text
far more often than a finding. The tool that *does* own the log is never filtered that
way, so `error: linking with cc failed`, which has neither, is still the answer when
cargo owns the output.

One failure read two ways is not two failures. A Python traceback ends
`KeyError: 'taxrate'`, and Node's parser recognises that shape too — so the second
reading is dropped, because it says strictly less: its message sits inside the other's
and it knows less about where the failure is.

Every extracted failure carries a private source range identifying the raw diagnostic
region that produced it. That ownership never appears in terminal output or JSON v1,
but it prevents two parsers from reporting the same region. The ordered-pair sweep now
requires exact recovery of both logs' standalone failures across all 13,414 applicable
cross-parser fixture pairs, rather than merely checking that the combined count did not
grow.

CI and log viewers stamp every line — GitHub Actions prefixes an ISO timestamp, Azure
Pipelines uses `##[debug]`, and `kubectl logs --prefix` identifies the source as
`[pod/name/container]`. Every parser here anchors on the start of a line, so a stamped
log would match nothing at all. whyitbroke strips vetted shapes before parsing; inferred
prefixes are removed only when nearly every line carries one and parsing improves, so a
log that merely mentions a timestamp is left exactly as it is. Paste a CI log straight
in.

Repeated identical diagnostics are shown once. Distinct tests or diagnostics
that happen to share a file and line are preserved.
