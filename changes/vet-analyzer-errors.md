- `go vet -json` keeps a package's findings beside an analyzer that could not run. go vet
  writes each analyzer's result on its own, and one that failed - a package that did not
  type-check, say - writes `{"error": "..."}` in place of its list of findings. A package
  holding one was not read as go vet's at all, and the findings of every other analyzer in
  it were lost. The error is still no finding of its own.
