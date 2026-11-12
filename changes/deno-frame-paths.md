- A crash under `deno run` is read whatever the path of its file holds. deno writes a
  folder named `my folder` into a frame's URL as it is, and the frame's path was read only
  up to a space: the frame was no frame, the crash was not deno's, and it came back as a
  guess. Its frames are read as every other V8 frame is, from the end of the line.
