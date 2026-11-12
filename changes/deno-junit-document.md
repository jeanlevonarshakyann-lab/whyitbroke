- Deno's JUnit report is read as the document it is, whole or cut. Its root was known
  only when its tag and name were on one line, its cases were looked for on the lines
  after the root's, and a case's name, file and line were those on the line its tag
  started: a report compacted onto one line, or reflowed with an attribute to a line, was
  no report of deno's and fell to a guess. In a report a capture had cut, a failure that
  had lost its closing tag read on into the next case's, which was then never read.
