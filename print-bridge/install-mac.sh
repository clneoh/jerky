#!/bin/sh
# print-bridge/install-mac.sh — run the label bridge in the background on this Mac.
#
# ⭐ WHY: the bridge is a program, so closing its Terminal window stops it. As a launchd user agent it starts
# at login, keeps running with no window, and is restarted if it ever stops. ⚠️ It uses the SAME config file
# (`~/.munchies-print.json`) — run the bridge once in Terminal first if that file does not exist yet.

set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$DIR/print-bridge/bridge.mjs"
NODE="$(command -v node || true)"
LABEL="com.munchies.printbridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/munchies-print.log"

if [ -z "$NODE" ]; then
  echo "Node is not installed (or not on PATH). Install Node 18 or newer, then run this again."
  exit 1
fi
if [ ! -f "$SCRIPT" ]; then
  echo "The bridge script is not at $SCRIPT — is this the jerky folder?"
  exit 1
fi
if [ ! -f "$HOME/.munchies-print.json" ]; then
  echo "No bridge config yet. Run this once in Terminal first:"
  echo "  cd \"$DIR\" && node print-bridge/bridge.mjs"
  echo "Answer its questions, press Ctrl-C, then run this installer again."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$SCRIPT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF

# Replace any earlier copy, then load this one. A first install has nothing to boot out.
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo "Installed. The bridge now starts at login and keeps running with no Terminal window."
echo "  log:     $LOG"
echo "  stop:    launchctl bootout gui/$(id -u) \"$PLIST\""
echo "  remove:  sh \"$DIR/print-bridge/uninstall-mac.sh\""
