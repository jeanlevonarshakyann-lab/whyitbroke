# Regenerate with:  ./record.sh   (not vhs directly - it needs the staged dir)
Output demo.gif

Set Shell bash
Set FontSize 18
Set Width 840
Set Height 600
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Hide
Type 'cd /tmp/whyitbroke-demo'
Enter
Type 'export PS1="$ "'
Enter
Type 'export PATH="$PWD/.venv/bin:$PWD/bin:$PATH"'
Enter
Type 'export PYTEST_ADDOPTS="-p no:cacheprovider"'
Enter
Type 'clear'
Enter
Show

Sleep 700ms
Type 'pytest'
Enter
Sleep 3s

Type 'clear'
Enter
Sleep 400ms

Type 'whyitbroke -q pytest'
Enter
Sleep 6s
