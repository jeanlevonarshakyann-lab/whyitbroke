- Every package manager run in a log is read. A workspace installs and runs scripts one
  package at a time, and each failed run says so in its own block: pnpm read the first boxed
  error, yarn stopped at the first run's closing advice line, poetry read the first invalid
  file and the first resolver chain, and npm read every run's lines as one failure under the
  first run's code. pip named every package that failed to build after the first package in
  the log, so a second package's failure was folded into the first, and it read the same bad
  requirement in two files as one. npm's ERESOLVE message also keeps the requirement it could
  not resolve - the conflict itself - which was past the end of the lines a message was given.
