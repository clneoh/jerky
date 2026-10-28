#!/bin/sh
# print-bridge/uninstall-linux.sh — stop a site's bridge and take its service away.
#
# ⚠️ ONE MACHINE CAN BE SEVERAL BRIDGES (v672), so the site names which one: `sh print-bridge/uninstall-linux.sh kitchen`.
# ⭐ It removes the SERVICE and nothing else — the config file stays, so installing again brings the same printer back.
#
# Usage:  sh print-bridge/uninstall-linux.sh [site]

set -e

SITE="${1:-main}"
UNIT="munchies-print@$SITE.service"
FILE="/etc/systemd/system/$UNIT"

if [ ! -f "$FILE" ]; then
  echo "Nothing to remove — $UNIT is not installed."
  exit 0
fi

sudo systemctl disable --now "$UNIT" 2>/dev/null || true
sudo rm -f "$FILE"
sudo systemctl daemon-reload

echo "Removed $UNIT. That site's bridge will not start again."
echo "Its config file is still there, so installing again brings the same login and printer back."
