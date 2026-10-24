- A runner's prefix that reads like a directory comes off the paths it was read into.
  kubectl's pod, `pod/api-7d9 `, and pnpm's package and script, `packages/api test$ `, read
  like the start of every path - a parser took them for part of each file - and the strip
  was refused, since mypy's repeated source directory reads the same way and is data. A
  directory is in front of the files a tool names and nothing else; a runner's prefix is in
  front of every line it relays, the tool's heading and tally among them, and is now taken
  off where it is. A line that goes on into a file is not one of those: oxlint names a file
  again for each warning it holds back, and a directory such as `my project/` is in front of
  those too, so it stays. Of every fixture under five runners' prefixes, 174 readings that
  put the prefix in their paths now read as the log does bare; where every line a prefix
  opens names a file, as in yamllint's parsable output, the two cannot be told apart and the
  prefix stays in the paths, as before. A Turborepo task or a pnpm script named in mixed
  case, `api:TypeCheck: ` or `@shop/api TypeCheck: `, is also a runner's prefix.
