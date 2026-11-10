- Every reader of an XML report reads a tag to its end. Biome's, Bun's, Vitest's and ruff's
  JUnit reports, a .NET trx, PHPUnit's JUnit tally, and Oxlint's and ShellCheck's
  checkstyle each asked the log itself for a tag, beside the shared reading of it, and
  there a tag still ended at the first `>` inside a value: a root written
  `<testsuites note="a => b" name="Biome">` was not that tool's report, and a checkstyle
  `<error>` with such a value before its `line` lost the finding.
