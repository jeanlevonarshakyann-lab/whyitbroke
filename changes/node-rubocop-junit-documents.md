- node's and RuboCop's JUnit reports are read as the documents they are, whole or cut.
  Each was read a line at a time - a root or suite when a line named it, a case or failure
  when its tag sat on one line, RuboCop's place only on a line of its own - so a report
  compacted onto one line, or reflowed with an attribute to a line, was not that tool's
  report at all. With these two, every reader of an XML report reads a tag as XML writes
  it: space around an attribute's `=`, a line break inside a tag, and a `>` inside a
  quoted value.
