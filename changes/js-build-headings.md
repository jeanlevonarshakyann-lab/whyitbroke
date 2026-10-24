- babel's heading names its file whole when the file is on a drive or has a colon in its
  name. The file was taken to end at the first colon: `C:\work\bad.js` was the file `C`,
  which is no path, so the error was not read at all, and `/work/src/foo:bar.js` was
  `/work/src/foo`, with the rest of its name read into the message. It now ends at the
  first colon a space follows, which is where babel ends it.
- webpack 4's error that belongs to no module is read as what went wrong. webpack 4 writes
  it on its heading line as a sentence, `ERROR in Entry module not found: Error: Can't
  resolve './src' in '/project'`, with nothing under it, and the sentence was read as the
  module the error was in: a file of that name, with "webpack reported an error with no
  explanation" for its message.
