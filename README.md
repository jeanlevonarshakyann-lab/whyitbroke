# whyitbroke

**Your command failed. Here's what matters.**

[![Tests](https://github.com/jeanlevonarshakyann-lab/whyitbroke/actions/workflows/test.yml/badge.svg)](https://github.com/jeanlevonarshakyann-lab/whyitbroke/actions/workflows/test.yml)

whyitbroke turns noisy test, build, and lint output into a short diagnosis. It
runs locally, has no runtime dependencies, and does not upload your logs.

[![Real whyitbroke report from a pytest run](https://raw.githubusercontent.com/jeanlevonarshakyann-lab/whyitbroke/main/demo/preview.png)](https://raw.githubusercontent.com/jeanlevonarshakyann-lab/whyitbroke/main/demo/demo.gif)

*A real pytest run, followed by `whyitbroke -q pytest` on the same tests.
[Watch the recording](https://raw.githubusercontent.com/jeanlevonarshakyann-lab/whyitbroke/main/demo/demo.gif) · [Fixture and recording script](https://github.com/jeanlevonarshakyann-lab/whyitbroke/tree/main/demo).*

[Get started](#get-started) · [Supported tools](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/supported-tools.md) · [CLI guide](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/cli.md)

## Get started

Run a command through whyitbroke:

```bash
npx --yes whyitbroke -q npm test
```

Or inspect output you already have:

```bash
npm test 2>&1 | npx --yes whyitbroke
npx --yes whyitbroke < build.log
```

The first command runs `npm test` and returns its exit status. With a pipe, your
shell controls the upstream command's exit status. For regular use, install the
CLI once with `npm install -g whyitbroke`.

## What it does

- **Finds the useful failure.** Tool-specific readers extract the message,
  location, and supporting evidence. Uncertain readings are labelled as guesses.
- **Keeps failures visible.** An unrecognized failed command still shows its
  captured output instead of silently producing an empty report.
- **Works in local shells and CI.** The command's exit status passes through;
  terminal, JSON, and GitHub Actions output come from the same report.

It recognizes common test, build, and lint output from pytest, Jest, Vitest,
ESLint, TypeScript, Go, Rust, Docker, Terraform, Maven, Gradle, and more. The
[compatibility matrix](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/supported-tools.md)
lists what each reader extracts and how it is tested.

The default capture limit is 10 MiB, and truncated reports say what was left
out. Terminal reports can read nearby source lines inside your working directory;
use `--no-source` before sharing output from a sensitive checkout. GitHub
annotations and summaries do not add source read from disk. See
[reliability and safety](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/reliability.md)
for the exact boundaries.

## Learn more

| Guide | Covers |
| --- | --- |
| [CLI and GitHub Actions](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/cli.md) | Options, saved logs, CI examples, and JSON output |
| [Supported tools](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/supported-tools.md) | Tool and reporter compatibility |
| [Reports and history](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/reporting.md) | Evidence, cause grouping, and `--since-last` |
| [Reliability and safety](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/docs/reliability.md) | Exit codes, large logs, source reads, and limits |
| [Contributing](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/CONTRIBUTING.md) | Adding a reader and running the tests |

## License

whyitbroke is **source-available** under the Apache License 2.0 with the Commons
Clause. Commercial use inside an organization is permitted; selling the software
itself or a product or service whose value derives substantially from its
functionality is not. This is not an OSI-approved open-source license. Read the
full [license](https://github.com/jeanlevonarshakyann-lab/whyitbroke/blob/main/LICENSE)
before redistributing it.
