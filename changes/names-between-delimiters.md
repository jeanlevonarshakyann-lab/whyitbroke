- A name is read to the delimiter its tool writes after it. Python writes a frame's file raw
  between quotes, so the file can hold `", line 900, in ` itself, and the traceback, unittest
  and pytest readers took the first such text for the frame's own: a file named
  `boom", line 900, in fake.py` was the file `boom` at line 900. The function after it is an
  identifier, which cannot hold that text, so the file now runs to the last of them. And
  terraform fmt's diff header for a root-level file named ` main.tf`, `--- old/ main.tf`, is
  read: the path starts straight after `old/`, whatever it starts with.
