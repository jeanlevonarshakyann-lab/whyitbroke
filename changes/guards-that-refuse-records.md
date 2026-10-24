- Four guards keep out only what they are there for. swiftc's diagnostic for a file named
  `1|bad.swift` was taken for a line of the source it draws, and skipped; stylelint's
  heading for a file named `✖.css` was taken for one of its status lines, and its
  problems named no file; a TAP file's roll-up was skipped as repeating its members'
  failures even where none had failed - a file that would not load has none, and the
  roll-up is the only record of it; and babel's error in code read from stdin, which it
  names `unknown`, was not read at all.
