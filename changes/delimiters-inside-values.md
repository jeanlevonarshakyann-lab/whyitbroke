- A file named with the character that ends it is read whole. Azure's logging command splits
  each property at its first `=`, and ruff writes the file as it has it: ruff's Azure output
  for `pkg/bad=name.py` was read as the file `pkg/bad`, which is no Python file, and the
  finding was dropped. Poetry writes the file it could not read, `: `, and why - which says
  `: ` again: a project under `/work/project: scratch` was read as the file `/work/project`.
