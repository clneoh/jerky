# The label print bridge (Mac)

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
   - **Supabase URL** — `https://hzpyblqygnntixkijeem.supabase.co`
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
