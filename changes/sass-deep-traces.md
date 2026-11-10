- A sass error under a deep trace is read to the trace's end. sass ends every trace with
  `root stylesheet`, and in its ASCII drawing that frame is all that says the error is
  sass's; a diagnostic was read only forty lines past its heading, so a mixin sixty calls
  deep left the error unread. The trace is now read to its end, however deep.
