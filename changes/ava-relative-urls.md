- An AVA failure is put in its own file. AVA cuts the working directory off a frame's URL,
  so in a plain project it writes `file://test/a.js` - a URL with a host named `test` - and
  the failure was put in `//test/a.js`, a file on no machine. A `file://` with no third slash
  is, in AVA's frames, a path from the working directory.
