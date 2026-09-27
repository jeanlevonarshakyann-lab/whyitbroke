# whyitbroke

**Find the failure in noisy command output.**

whyitbroke runs your test, build, or lint command and pulls out the useful diagnosis:
what failed, where, and why. It works locally, has no runtime dependencies, and does
not send your logs to a service.

[![A concise whyitbroke report for a failing pytest run](https://raw.githubusercontent.com/jeanlevonarshakyann-lab/whyitbroke/main/demo/preview.png)](https://raw.githubusercontent.com/jeanlevonarshakyann-lab/whyitbroke/main/demo/demo.gif)

[Watch the terminal demo](https://raw.githubusercontent.com/jeanlevonarshakyann-lab/whyitbroke/main/demo/demo.gif)

## Get started

```bash
npx --yes whyitbroke -q npm test
```

That runs `npm test` and prints a compact report. Install it once if you prefer a
shorter command:

```bash
npm install -g whyitbroke
whyitbroke cargo build
```

You can also read output you already have:

```bash
npm test 2>&1 | whyitbroke
whyitbroke < build.log
```

For a failing pytest run, the report looks like this:

```text
✗ 3 failed, 1 passed in 0.01s

test_shop.py:5  test_invoice_total
  assert 1049 == 1050
  + where 1049 = total([1000, 49], 0.5)

test_shop.py:10  test_expired_token
  KeyError: 'exp'
```

See the [CLI guide](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/cli.md) for quiet mode, saved logs, JSON, and GitHub Actions.

## What you can count on

- **Your command keeps its exit status.** whyitbroke can sit in a CI step without
  turning a failed command green. A piped log has no upstream exit status to pass on.
- **Unknown output stays visible.** If no parser recognizes a failed command's log,
  the report says so and returns the captured text within the configured size limit.
- **A diagnosis points to evidence.** Tool-specific parsers identify failures and
  locations; uncertain readings are labelled as guesses. JSON and GitHub output are
  rendered from the same report.
- **It stays local.** The CLI makes no network calls. Terminal reports can read
  nearby source lines inside your working directory; use `--no-source` before sharing
  output from a sensitive checkout. GitHub annotations and summaries do not add
  source read from disk.

The default capture limit is 10 MiB. Truncated reports say what was left out.
[Reliability and safety](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/reliability.md) explains the boundaries in detail.

## Supported tools

whyitbroke recognizes failures from tools across common stacks, including pytest,
Jest, Vitest, ESLint, TypeScript, Go, Rust, Docker, Terraform, Maven, and Gradle.
It also reads many structured reporters and logs wrapped by CI or monorepo tools.

The [full compatibility matrix](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/supported-tools.md) states what each parser
extracts. Its entries are checked against captured failures in the test suite.

## Documentation

| Guide | When to use it |
|---|---|
| [CLI and GitHub Actions](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/cli.md) | Commands, options, CI examples, and JSON output |
| [Supported tools](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/supported-tools.md) | Tool and reporter compatibility |
| [Reports and history](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/reporting.md) | Evidence, cause grouping, and `--since-last` |
| [Reliability and safety](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/reliability.md) | Exit codes, large logs, source reads, and limits |
| [Contributing](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/CONTRIBUTING.md) | Adding a parser and running the tests |
| [JSON Schema](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/report.schema.json) | The versioned machine-readable report |

## License

whyitbroke is **source-available** under the Apache License 2.0 with the Commons
Clause. Commercial use inside an organization is permitted; selling the software
itself or a product or service whose value derives substantially from its
functionality is not. This is not an OSI-approved open-source license. Read the
full [license](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/LICENSE) before redistributing it.
