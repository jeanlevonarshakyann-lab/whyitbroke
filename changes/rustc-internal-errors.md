- `cargo --message-format=json` reads a compile that crashed rustc. rustc gives its own
  crash a level of its own, `error: internal compiler error`, and the text form prints it as
  the error it is; the JSON record of it was passed over as a note is, and the compile came
  back with nothing found in it. It is now read as the text form reads it, `internal
  compiler error: ...` at the place rustc names.
