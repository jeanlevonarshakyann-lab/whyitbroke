- A lint plugin's findings are read whatever the plugin is called. Each reader allowed rule
  names of its own making, and a finding whose rule was named any other way was dropped
  from the row that reported it, or lost its rule: stylelint's `@stylistic/indentation`,
  eslint's `local.plugin/no-foo`, a deno lint plugin's `my-plugin/no-foo`, oxlint's
  `@pandacss(no-physical-properties)` in every format, and ruff's rule names -
  `unused-import`, written in place of `F401` when preview's `output-prefer-rule-codes`
  is off. A rule is now named as these tools name one: parts joined by `/`, each of word
  characters, `-` and `.`, the first led by `@` for a scope - and for ruff, its code or
  its name.
