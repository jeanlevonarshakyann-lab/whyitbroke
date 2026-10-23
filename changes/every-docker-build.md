- Each docker build in a log is read on its own. CI goes on to the next image after one
  fails, and read as one build, the first build's message took the last build's Dockerfile
  line, and a later build whose step printed made an earlier silent step with the same
  number look like it had said why it failed - so that build was not read as docker's at all.
