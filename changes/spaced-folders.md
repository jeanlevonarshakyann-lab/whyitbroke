- A folder with a space in its name is read as a folder by every reader that was still
  reading a path up to its first space. Each of these was found with the real tool, run on a
  file in such a folder: Playwright's heading and its `at` line - and a heading with the
  project in front of it, `[chromium] › tests/a.spec.js:2:1 › adds up`, which its starter
  config always has and which turned a whole run into a guess; rustc's lints and parse
  errors, which carry no code; `node --test`'s frames; node's own header above a syntax
  error; `gofmt -d`'s diff header; and `go build`, `go vet` and `go test` on files named on
  the command line, under `# command-line-arguments`. A syntax error at the very end of a
  file, which node writes with no source under its header, now names its file too.
