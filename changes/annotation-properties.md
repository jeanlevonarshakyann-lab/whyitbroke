- A GitHub annotation is read as GitHub reads it. Its properties end at `::`, and their
  values have `%3A`, `%2C`, `%0D`, `%0A` and `%25` unescaped and are not trimmed. The reader
  biome, vitest, oxlint, yamllint, rubocop and jest share ended them at the first colon, so
  a file on a drive written raw, `file=C:\work\a.yml`, lost its annotation; it unescaped
  nothing, so a path or a title whose colon or comma was escaped - as whyitbroke's own
  annotations escape them - read as another; and it trimmed them.
