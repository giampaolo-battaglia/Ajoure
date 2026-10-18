#!/bin/bash
# Double-click me in Finder to launch Ajouré in your browser.
# Close this Terminal window (or press Ctrl+C) to stop it.

cd "$(dirname "$0")" || exit 1
printf '\033]0;Ajouré\007'   # window title

# Finder-launched Terminals don't always load your shell setup, so look for Node in the usual places.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Ajouré needs Node.js, and it couldn't be found."
  echo "  Install it from https://nodejs.org, then double-click this file again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

# Already running? Just open it.
if curl -s --max-time 1 http://localhost:5173/ 2>/dev/null | grep -q "Ajouré"; then
  echo "  Ajouré is already running — opening it."
  open "http://localhost:5173/"
  sleep 1
  exit 0
fi

exec node tools/serve.mjs
