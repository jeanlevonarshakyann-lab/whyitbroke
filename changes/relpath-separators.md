- On Windows, a path written with forward slashes is shown relative to the working
  directory too. Go writes its frames there as `D:/a/app/t/shop_test.go`, and the working
  directory is `D:\a\app`: the two were compared before their separators were, so the
  location was shown in full.
