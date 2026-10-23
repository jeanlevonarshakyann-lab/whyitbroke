- A Go test is reported in its own package when another run writes into the same pipe -
  two modules tested at once. A test's package was the first closing line after the first
  line it printed, and a parallel test, which pauses and reports once the rest of its
  package is done, often had the other run's closing line in between: it came back in the
  other module's package, one that had passed. That closing line also ended the test's
  frames in a verbose run, so a test that went on printing after it was not read at all,
  and a test read from plain output read on past its own package's closing lines into
  whatever ran next. A test's package is now the first closing line after the last line it
  printed, and a closing line written while one of a verbose run's tests was still running
  is taken for another run's - a test binary closes its package only once its tests are done.
