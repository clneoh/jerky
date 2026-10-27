#!/usr/bin/env bash
# print-bridge/install-linux.sh — run the label print bridge as a background service on Linux.
#
# ⭐ The Linux twin of `install-mac.sh`, and it does the same job a different way: macOS starts it with
# launchd, Linux with **systemd**. ⚠️ The bridge itself is byte-identical — same script, same config, same
# protocol — so a bridge moved from the Mac to a home server needs no code change at all.
#
# ⚠️⚠️ IT IS A *USER* SERVICE ON PURPOSE. Nothing here needs root: the unit lives in YOUR home directory, the
# config stays `~/.munchies-print.json` (mode 600), and the log goes to your own journal. ⭐ Root is asked for
# exactly once, and only to let the service start at boot WITHOUT anyone logging in (`enable-linger`).
#
# ⚠️⚠️ ONE BRIDGE PER SITE NAME. If this machine and another bridge both run as "main", **every label prints
# twice.** Stop the other one before you install this.
#
# Usage:   bash print-bridge/install-linux.sh
# Remove:  bash print-bridge/uninstall-linux.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$DIR/print-bridge/bridge.mjs"
NODE="$(command -v node || true)"
NAME="munchies-print"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/$NAME.service"

if [ -z "$NODE" ]; then
  echo "Node is not installed (or not on PATH)."
  echo "  Debian/Ubuntu:  sudo apt install nodejs npm   (then check: node -v)"
  echo "  Raspberry Pi OS: sudo apt install nodejs      (Raspberry Pi OS ships v18 or newer)"
  echo "Node 18 or newer is required, then run this again."
  exit 1
fi

NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node $("$NODE" -v) is too old — the bridge needs 18 or newer."
  echo "  Raspberry Pi OS 'bullseye' ships 12; install the NodeSource build or use 'bookworm' or newer."
  exit 1
fi

if [ ! -f "$SCRIPT" ]; then
  echo "The bridge script is not at $SCRIPT — is this the jerky folder?"
  exit 1
fi

if [ ! -f "$HOME/.munchies-print.json" ]; then
  echo "No bridge config yet. Run it once by hand first, so it can ask for the printer's address:"
  echo "  cd \"$DIR\" && node print-bridge/bridge.mjs"
  echo "Answer its questions, press Ctrl-C once it says \"signed in to the shared queue\", then run this again."
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "This shell cannot reach the user systemd manager."
  echo "On a server you reach only by SSH, run:  sudo loginctl enable-linger $USER   then log out and back in."
  exit 1
fi

mkdir -p "$UNIT_DIR"

# ⚠️ `Restart=always` is the point of installing it: a bridge that crashed at 3am must come back by itself.
# ⚠️ `After=network-online.target` stops it racing the Wi-Fi: signing in before the network is up would leave
# it in the retry loop her first attempt sat in.
cat > "$UNIT" <<EOF
[Unit]
Description=Munchies Furkidz label print bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$NODE $SCRIPT
Restart=always
RestartSec=10
# The label job is small and the printer is on the LAN; nothing here needs privileges.
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$NAME.service"
systemctl --user restart "$NAME.service"

# ⭐ Start at boot without anyone logging in. ⚠️ This is the one step that needs root, and it is optional: an
# unprivileged home server someone logs into is fine without it.
if ! loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q "Linger=yes"; then
  echo
  echo "One more step so it starts at boot with nobody logged in:"
  echo "  sudo loginctl enable-linger $USER"
fi

sleep 2
echo
if systemctl --user is-active --quiet "$NAME.service"; then
  echo "Installed and running. It now starts at boot and restarts itself if it stops."
else
  echo "Installed, but it is NOT running. Look at why:"
  echo "  journalctl --user -u $NAME -n 40 --no-pager"
  exit 1
fi
echo "  status: systemctl --user status $NAME"
echo "  log:    journalctl --user -u $NAME -f"
echo "  stop:   systemctl --user stop $NAME"
