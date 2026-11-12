- A second run of `node --test` whose file crashed says what it threw. The spec reporter
  prints a crash above the list of failing tests, and it was looked for above the first
  such list in the log: a second package's crashed file came back as `test failed`, by the
  bare name the list gave it, with the exception and the path nowhere.
