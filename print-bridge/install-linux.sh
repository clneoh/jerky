#!/bin/sh
# print-bridge/install-linux.sh — run the label bridge in the background on a Linux server (Ubuntu / Debian).
#
# ⭐ The Mac's installer uses launchd; Linux uses systemd. Same program, same config file
# (~/.munchies-print.json) — ⚠️ a bridge that only knows how to start on one operating system is a bridge that
# stops when she moves it.
#
# Usage:  sh print-bridge/install-linux.sh [site] [config-path]
#         sh print-bridge/install-linux.sh                 → site "main", ~/.munchies-print.json
#         sh print-bridge/install-linux.sh kitchen         → site "kitchen", ~/.munchies-print-kitchen.json
#         ⚠️ ONE MACHINE, SEVERAL BRIDGES (v672): each site gets its OWN unit and its OWN config, so a bakery
#         kitchen and a second printer never argue over one file or print each other's labels.
# ⚠️ Run it as the USER WHO HAS THE CONFIG, not with sudo — the service then runs as that user and can read its
# own ~/.munchies-print.json. (sudo is used internally only for the one step that needs it.)

set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$DIR/print-bridge/bridge.mjs"
NODE="$(command -v node || true)"
SITE="${1:-main}"
CFG="${2:-$HOME/.munchies-print.json}"
# ⚠️ The unit's name carries the site, so two bridges on one machine are two units — and `systemctl status
# munchies-print@kitchen` is unambiguous about which printer it is talking about.
UNIT="munchies-print@$SITE.service"

if [ -z "$NODE" ]; then
  echo "Node is not installed (or not on PATH). Install Node 18 or newer, then run this again."
  exit 1
fi
if [ ! -f "$CFG" ]; then
  echo "No config at $CFG — copy print-bridge/config.example.json there and fill it in (see"
  echo "print-bridge/README.md, \"Running it on a server\"). The bridge cannot start without the queue's address and login."
  exit 1
fi
if ! grep -q "\"site\"[[:space:]]*:[[:space:]]*\"$SITE\"" "$CFG"; then
  echo "⚠️  $CFG does not say site \"$SITE\". Set it there, or the two bridges print each other's labels."
  exit 1
fi

echo "Installing $UNIT so the bridge starts at boot and restarts if it stops…"
sudo tee "/etc/systemd/system/$UNIT" >/dev/null <<UNITFILE
[Unit]
Description=Munchies Furkidz print bridge for GP1326D Gprinter (site $SITE)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Environment=BRIDGE_NO_PROMPT=1
Environment=BRIDGE_CONFIG=$CFG
WorkingDirectory=$DIR
ExecStart=$NODE $SCRIPT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITFILE

sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT"
echo "Started. Check it with:  systemctl status $UNIT   ·   journalctl -u $UNIT -f"
