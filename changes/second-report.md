- A report followed by the same tool's report about other files is two reports. A workspace
  runs its tests once per package, and each run says the same things about its own files.
  Bun's JUnit report knew a test by its name alone, so the second package's
  `cart > totals an invoice` was the first one said again; make knew a missing include by
  the name of the include, whichever makefile asked for it; and jasmine read the blocks
  under its first `Failures:` heading and no other. In each, every failure of the second
  run was nothing. A test is now the same test only in the same file, an include is
  missing from the makefile that names it, and each of jasmine's runs is read, with a
  tally that counts them all.
