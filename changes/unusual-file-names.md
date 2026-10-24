- A file is read by the name its tool gives it, however unusual. A JVM test whose source is
  named with a space, `Cart Test.java`, a localized .NET test run from a share,
  `\\fileserver\shop`, a minitest failure in a file with brackets in its name, a PHPUnit test
  file with the suffix `.php8`, and a flake8 finding in a file named `::bad.py` were each
  read without their place - or, for a run of nothing else, not read at all: the frame,
  place or line was taken only from a name without them.
