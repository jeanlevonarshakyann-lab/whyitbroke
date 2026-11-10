- A JSON report written on one line survives the cap however long it grows. rubocop and
  jest write theirs on one line that grows with what they found, and a line still unended
  after 64KiB of it was skipped to its end, so that a minified blob could not hold the
  capture: past the cap, a report in the middle of a log, or across the start of its tail,
  came back as the marker alone. A line that opens a JSON document whose start reads like a
  diagnostic is now read on, for as long as the diagnostic budget could still keep it.
