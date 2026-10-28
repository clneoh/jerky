# The print bridge for the GP1326D Gprinter

Your printer is a **Gprinter GP-1326D** on Wi-Fi. It speaks **TSPL** over a raw TCP connection (port 9100), and
it has **no IPP/AirPrint and no web page** — which is why Android, iOS and Chrome cannot see it. This bridge is
the small piece on your Mac that can reach it. The phone sends the label through your Supabase, and this
script prints it.

⭐ **It does not use the Mac's printer settings or a macOS driver.** Nothing needs to be "added" in System
Settings → Printers. It connects to the printer's IP directly.

## One-time setup

1. **Run the table once.** In Supabase → SQL Editor, open `supabase/print_jobs.sql`, paste the whole file, Run.
   You should see a row with `table_exists = 1` and `policy_count = 4`.
2. **Check Node.** In Terminal on the Mac: `node -v` — any version 18 or newer is fine.
3. **Start the bridge.** In Terminal:
   ```
   cd ~/Downloads/jerky
   node print-bridge/bridge.mjs
   ```
   The first run asks for:
   - **Supabase URL** — `https://ircwozniiyywsowamixy.supabase.co`
   - **Anon public key** — the same one the app uses (Settings in the backoffice, or the Supabase dashboard)
   - **App login email** and **password** — your own login; typed here, never into a chat
   - **Printer IP** — the address the printer's Wi-Fi app showed you (for example `192.168.1.50`)
   - **Port** — press Enter for `9100`
   - **Label gap** — press Enter for `2` mm (use `0` for continuous stock)
   - **Printer name for this site** — press Enter for `main`, or a name you choose. ⚠️ It must match the name
     in the app's Settings on the devices at this site; **two bridges with the same name would both print
     every label.**

   The answers are saved in `~/.munchies-print.json`, readable only by you. They are never in this repo.

4. **Leave it running.** It prints `signed in to the shared queue` and then waits. Every label sent from the
   app prints within about three seconds.

## Run it in the background (recommended)

⚠️ **Closing the Terminal window stops the bridge** — it is the program. To keep it running with no window,
start it at login and have it restart itself, install it as a background service once:

```
sh print-bridge/install-mac.sh
```

It uses the same saved config, so answer the setup questions once in Terminal first (step 3). After that:

- it starts **at login** and keeps running after the Terminal is closed;
- its log is `~/Library/Logs/munchies-print.log` — `tail -f` that file to watch it;
- to stop and remove it: `sh print-bridge/uninstall-mac.sh` (the config file is left in place).

⚠️ The Mac must still be **awake** to print; sleep pauses it.

## Printing

In the backoffice: an order at **Baked** or later → **Print label** → choose the style → **Print over Wi-Fi**.
The phone can be on mobile data or any Wi-Fi; only the Mac needs to be on the printer's network.

The same press works on **Android and iPhone** — nothing different to set up on either.

## If it does not print: the status command

Run this in Terminal — it only READS the queue, it never prints or changes anything:

```
node print-bridge/status.mjs
```

It prints the site this bridge prints, then the newest jobs with their `status` and `site`. ⚠️ If the job's
site differs from the bridge's, set Settings → Your address → *Label printer name for this device* to match.
If it is `new` and the site matches, the service is not polling.

## If it does not print

- **"waiting: sign-in failed"** — the email or password in `~/.munchies-print.json` is wrong. Delete that file
  and run the script again.
- **"job failed … the printer did not answer"** — the printer is off, asleep, or on a different network; check
  the IP in its Wi-Fi app. The job is retried up to five times.
- **Nothing happens at all** — is the script still running in Terminal? A closed Terminal window stops it.
- **The print is shifted or split** — adjust the **gap** (2 mm for die-cut labels; 0 for continuous) or the
  label size in the printer's own settings. The bridge sends 100 × 150 mm.
- **The label comes out inverted** (dark background, white letters) — this bridge flips the bits by default,
  because the GP-1326D reads a set bit as paper. If you ever use a different printer that prints inverted
  with that default, set `"invert": false` in `~/.munchies-print.json` and restart it.

## Stopping it

- If it is running in a Terminal window: press **Ctrl-C**.
- If it is installed in the background: `sh print-bridge/uninstall-mac.sh`.
- To start it again, repeat step 3, or run `sh print-bridge/install-mac.sh`.

Keep the Mac awake while you expect labels: System Settings → Lock Screen → "Prevent automatic sleeping when
the display is off" (or simply leave a Terminal window active).

## Running it on a server (Ubuntu — the UGREEN box at 192.168.51.90, a Pi, any always-on Linux)

⭐ **The Mac is only one place this can run.** The bridge is plain Node with no macOS calls in it, so an
always-on Linux box in the house prints the labels just as well — and keeps printing when the Mac is asleep.

⚠️ **It still prints OVER THE NETWORK.** The printer stays on Wi-Fi; this asks it at `<address>:9100`. **USB is
not used** — the bridge speaks TCP 9100 and nothing else.

### The config, written by hand

The first-run questions need a terminal, and a server or a container has none. So write the file yourself:
`~/.munchies-print.json`, readable only by you:

```json
{
  "url": "https://ircwozniiyywsowamixy.supabase.co",
  "anonKey": "<the anon public key the app uses>",
  "email": "<your app login email>",
  "password": "<your app login password>",
  "site": "main",
  "printerHost": "192.168.51.32",
  "printerPort": 9100,
  "gapMm": 2
}
```

```bash
chmod 600 ~/.munchies-print.json
```

⚠️ **Your login email and password are typed ON THE SERVER, never into a chat** — and the file holds them, which
is why it is `chmod 600` and never in this repo. ⭐ **And `printerHost` is optional once v670 is on:** the app's
**Settings → Label printer address** wins when it is set, and this file is the fallback.

### More than one printer on one machine (a second site)

⭐ **One server can be several bridges.** Each site gets its **own config file** and its **own service**, so a
bakery kitchen and a second printer never share a file and never print each other's labels:

```bash
cp ~/print-bridge/config.example.json ~/.munchies-print-kitchen.json
# edit it: "site": "kitchen", and that site's printer address
chmod 600 ~/.munchies-print-kitchen.json
sh ~/print-bridge/install-linux.sh kitchen ~/.munchies-print-kitchen.json
```

- The unit becomes **`munchies-print@kitchen.service`**, so `systemctl status munchies-print@kitchen` is
  unambiguous.
- ⚠️ **The `site` in the file must match the name you pass** — the installer refuses to install if they differ,
  because two bridges with one name both print every label.
- ⚠️ **A second APP is a second cloud.** Munchies' labels come from munchies' own queue: its config needs
  *its* project's `url`, `anonKey` and login, not the munchies'.

### Route 1 — as a service (recommended)

```bash
sh print-bridge/install-linux.sh
```

It starts at boot, restarts if it stops, and logs to the journal:

```bash
systemctl status munchies-print
journalctl -u munchies-print -f
```

### Route 2 — as a container

```bash
docker build -t gp1326d-print print-bridge
docker run -d --name gp1326d-print --restart unless-stopped \
  --network host -v "$HOME/.munchies-print.json:/config/.munchies-print.json:ro" \
  gp1326d-print
```

- **`--network host`** is what lets it reach the printer on your home network. ⚠️ Without it the container
  cannot see `192.168.x.x` at all.
- The config is **mounted read-only**, never baked into the image.
- ⚠️ `BRIDGE_NO_PROMPT=1` is set in the image: with no terminal, a first-run question would hang for ever and
  look exactly like a bridge that is running.

### Which address does the server need?

**None of its own.** DHCP is fine — the server only has to be on the same Wi-Fi as the printer and to reach the
internet. ⭐ **The printer's address is the one that matters**, and since v670 you fix it from the phone:
Settings → **Label printer address (for the bridge)**. If that box is blank, the address in this file is used,
and if the printer has moved, `node print-bridge/status.mjs` on that machine will name the address it is at now.
