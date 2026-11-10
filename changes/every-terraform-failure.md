- Every terraform run in a log is read. An init error was looked for only under the last step
  of init's narration in the whole log, and only where nothing else had been found, so a
  second init's error - or one after a failed validate - was lost; a refused subcommand was
  read once, and only where nothing else failed.
