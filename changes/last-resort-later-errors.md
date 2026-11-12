- A log no parser reads is read past its first twelve lines that look like errors. A step
  that is retried says the same thing each time round, and those twelve were all the last
  resort looked at: fourteen tellings of `curl: (7) Failed to connect ...` were one failure,
  and the line after them that said why the run stopped - `error: deployment aborted: disk
  quota exceeded` - was nothing. The lines after are now read for what has not been said
  yet, up to the eight failures it shows.
