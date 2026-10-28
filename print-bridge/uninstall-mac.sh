#!/bin/sh
# print-bridge/uninstall-mac.sh — stop the background bridge and remove its startup entry.
# ⚠️ It does NOT delete the printer config in ~/.munchies-print.json; remove that file yourself if you want
# the login details gone too.

set -e
LABEL="com.munchies.printbridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "The background bridge is stopped and removed. The config file is still at ~/.munchies-print.json."
