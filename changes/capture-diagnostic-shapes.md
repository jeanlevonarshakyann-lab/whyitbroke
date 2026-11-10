- A capture past its cap keeps the rows that name a failure without a failure word. git
  names each conflicted file on a `CONFLICT (content): Merge conflict in <file>` row and
  each refused ref on a `! [rejected]` one, and only the footer under them says "failed":
  a merge that conflicted in forty files, in the middle of a long log, came back with the
  last four. A translated Testing Platform failure whose exception names nothing in
  English, and a bare `ERR_PNPM_*` row from a recursive pnpm run, were not kept at all.
  Those rows are now kept with the lines around them - for Testing Platform, a stack frame
  that names its source file and line, which only a failure prints.
