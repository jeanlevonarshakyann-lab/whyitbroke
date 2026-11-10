- A PHP or Less error whose message says "in" names the file after its last " in ". Both
  name the file after an " in ", and both were read at the first: PHP's "the name is
  already in use in /var/www/app/Foo.php" came back as the message "...already" in the
  file "use in /var/www/app/Foo.php", "previously declared in /app/a.php:3) in
  /app/b.php" as the wrong file, and a missing Less import named `theme in progress.less`
  as a file made of the rest of the sentence. The file is now the path written whole after
  the last " in "; a path with " in " in it is still read whole.
