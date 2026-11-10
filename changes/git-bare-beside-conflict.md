- git's own `fatal:` and `error:` are read beside a conflict, a rejected push or files that
  would be overwritten. A log holding two git commands could hold a conflict from one and
  `fatal: not a git repository` from the other, and the second was dropped. What git says
  again about a conflict - that it cannot commit with unmerged files, the commit a rebase
  could not apply - is still not a second failure.
