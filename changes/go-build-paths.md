- A Go path with spaces or a drive in it is read as go wrote it. go names a file outside
  the directory it ran in by its whole path, so under a checkout named `My Project` the
  path has a space in it; a file's own name can have one, `./my file.go`; and with `-L` the
  compiler writes every path whole, `C:\work\pkg\a.go`. A build error under any of them was
  read as nothing, a module file's parse error lost its place, a data race lost the line
  that raced, and golangci-lint's type errors went back to its own coarse place, often line
  1: each was read only from a path of word characters, or one without spaces. Only a path
  that says where it starts - a drive, a separator, `./` or `../` - is read with a space in
  it, so a runner's prefix in front of a path, `pod/api-7d9 ./main.go`, is still taken off
  rather than read as part of it.
