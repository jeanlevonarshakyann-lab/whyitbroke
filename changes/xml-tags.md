- An XML tag is read to its end, whatever its values hold. A `>` inside a quoted attribute
  value is that value's text - `message="expected a => b"` - and a tag ended at the first
  one: a Maven or Gradle report whose failure said `=>` came back with its message cut in
  two, or as no report at all. Space around an attribute's `=`, which XML allows, is read
  too: `classname = "shop.CartTest"` was no attribute, and the test it named was skipped.
