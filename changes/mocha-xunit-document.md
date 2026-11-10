- Mocha's xunit report is read as the document it is, whole or cut. It was read a line at
  a time: a report written without line breaks between its tags was no report at all;
  once one of Mocha's roots had been seen, every case in the rest of the log - another
  tool's report among them - was read as Mocha's; and in a report a capture had cut, a
  failure that had lost its closing tag read on into the next case's, which was then never
  read. Each root is now read to its end, each case inside its root and each failure
  inside its case, and where a closing tag is missing a case ends where the next one
  starts. Two runs in one log are two reports, and the tally counts both.
