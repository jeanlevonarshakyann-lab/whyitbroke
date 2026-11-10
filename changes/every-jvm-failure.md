- Every failure in a JVM build is read, beside whatever else failed. `mvn --fail-at-end`
  goes on past a module that will not compile and fails the next one on a dependency, a
  plugin or its tests, and a log can hold more than one Gradle build. Maven's failed goals,
  Surefire's failed tests and Gradle's "What went wrong" were each read only where nothing
  before them had been found, and only the first of each. A goal or a section that says
  again what was read - the compiler's goal over its errors, Surefire's over the tests,
  Gradle's compile and test tasks - still adds nothing.
