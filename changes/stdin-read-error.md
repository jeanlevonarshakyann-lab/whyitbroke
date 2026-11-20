- A log that cannot be read to its end is reported as far as it was read. A redirected file
  on a disk that fails, or on a share that goes away, ended the run in node's own stack
  trace, with nothing of what had been read. The failures read before the error are
  reported, a line on stderr says the log was not read whole, and the exit status is 1.
