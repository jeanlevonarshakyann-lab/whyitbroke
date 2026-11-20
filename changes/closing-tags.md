- An XML end tag is read however XML spells it. XML allows space after an end tag's name,
  and a line break - `</testcase >` - and every reader found an element's end as
  `</testcase>`: a JUnit, checkstyle or TRX report written that way lost every test in it,
  or was not read at all. The copy of a report its elements are found in writes each end
  tag tight, with that space after it, so nothing moves.
