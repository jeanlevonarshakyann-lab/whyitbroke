- A file URL is read as the path it names by every reader of one. Clang's and ruff's SARIF,
  deno's frames and messages, node's test reporters and the last resort took `file://` off
  and decoded the rest, so a drive's `file:///C:/work/a.py` was the file `/C:/work/a.py`
  and a host's `file://server/share/a.py` was `server/share/a.py`; and mocha's text, JSON
  and xUnit readers kept an ES module's frame, `file:///repo/test.mjs:4:7`, as a URL, which
  no file is. Each now reads it as location.js's fileReference does.
