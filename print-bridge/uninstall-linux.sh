#!/usr/bin/env bash
# print-bridge/uninstall-linux.sh — stop the bridge on a Linux machine and take the service away.
#
# ⚠️ It removes the SERVICE and nothing else: your answers stay in `~/.munchies-print.json`, so running the
# installer again brings it straight back with the same printer. ⭐ Delete that file by hand only when you mean
# to forget the login and the printer's address.
#
# Usage: bash print-bridge/uninstall-linux.sh

set -euo pipefail

NAME="munchies-print"
UNIT="$HOME/.config/systemd/user/$NAME.service"

if [ ! -f "$UNIT" ]; then
  echo "Nothing to remove — $NAME is not installed for this user."
  exit 0
fi

systemctl --user disable --now "$NAME.service" 2>/dev/null || true
rm -f "$UNIT"
systemctl --user daemon-reload

echo "Removed. The bridge will not start again."
echo "Your printer and login answers are still in ~/.munchies-print.json — this only took the service away."
