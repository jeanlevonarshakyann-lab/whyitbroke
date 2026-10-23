- Every crash a log holds is read, beside whatever else failed. A log holds more than one
  run - a job that tests each package in turn, a script that runs two programs - and bun
  read the crash at its first footer only, Python the first file that would not compile
  (`python -m compileall` reports every one), mocha, PHPUnit and AVA the first file that
  would not load, and go the first panic; mocha, AVA and go read one only where nothing else
  had failed. A plain `go test` failure followed by another program's panic also took that
  panic, and its file and line, for the test's own.
