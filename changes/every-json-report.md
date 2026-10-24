- Every report a log holds is read. A workspace that lints each package on its own prints a
  report per package, and biome (`json` and `gitlab`), deno lint, markdownlint, npm, pylint,
  rspec, ruff, shellcheck and stylelint each read the first document they recognised and
  stopped: every package after the first came back with nothing wrong, and where the first
  package was clean - biome, rspec and stylelint accept a report with nothing in it - the
  log read as nothing at all. The same report printed twice still reads as once, and
  rspec's headline counts every document's examples instead of repeating the first one's.
