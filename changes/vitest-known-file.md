- vitest's JUnit and GitHub Actions reports read a frame by the file they already name. A
  frame with no function in front of its path was read as a function and a file when the
  path's first part had a space in it - `my tests/cart.test.js` was `tests/cart.test.js` -
  and replaced the file the report had right.
