#!/usr/bin/env node
// print-bridge/status.mjs — READ-ONLY: what is in the label queue, and which site this bridge prints.
//
// ⭐ For the case where the app says "Sent" and nothing prints: ⚠️ the row itself shows whether the job's
// `site` matches this bridge and whether it is still `new`. ⚠️ It never prints, updates or deletes anything.

import { readFileSync, existsSync } from "node:fs";
import net from "node:net";
import { execFile } from "node:child_process";
import { PRINTER_MAC, addressForMac } from "./printer.mjs";
import { homedir } from "node:os";
import { join } from "node:path";

// ⭐ WHICH CONFIG — so ONE MACHINE CAN BE MORE THAN ONE BRIDGE (v672). ⚠️ Her plan: a bakery kitchen and a
// munchies kitchen, each its own printer and its own site name. ⭐ One file path per instance is all it takes:
// `BRIDGE_CONFIG` names it, and with nothing set the old default is used, so every bridge already running keeps
// working unchanged.
const CONFIG_PATH = String(process.env.BRIDGE_CONFIG || "").trim()
  || join(homedir(), ".munchies-print.json");

function say(msg) { process.stdout.write(`${msg}\n`); }

async function deadlined(url, init = {}, ms = 15000) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  if (!existsSync(CONFIG_PATH)) {
    say("No bridge config at " + CONFIG_PATH + " — start the bridge once first.");
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  say(`this bridge prints site "${cfg.site || "main"}" to ${cfg.printerHost}:${cfg.printerPort}`);
  try {
    const auth = await deadlined(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: cfg.email, password: cfg.password }),
    });
    if (!auth.ok) throw new Error(`sign-in failed (${auth.status})`);
    const { access_token: token } = await auth.json();
    const res = await deadlined(
      `${cfg.url}/rest/v1/print_jobs?select=id,created_at,status,site,attempts&order=created_at.desc&limit=8`,
      { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`the queue could not be read (${res.status})`);
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      say("the queue is EMPTY — no label has ever reached it.");
      return;
    }
    say("newest jobs:");
    for (const r of rows) {
      say(`  #${r.id}  ${r.created_at}  status=${r.status}  site=${r.site}  attempts=${r.attempts}`);
    }
    const mine = rows.filter((r) => r.site === (cfg.site || "main") && r.status === "new");
    say(mine.length
      ? `⚠️ ${mine.length} job(s) are WAITING for this bridge — is the service running?`
      : "No waiting job for this bridge. A 'Sent' label with no row here means the phone is on another project or cannot read it.");
  } catch (err) {
    say(`could not read the queue: ${err.message}`);
    process.exit(1);
  }
  await sayWhereThePrinterIs(cfg);
}

// ★★★ WHERE IS THE PRINTER, WHEN THE ADDRESS HAS MOVED (v669).
//
// ⚠️⚠️ The printer's address comes from the router's DHCP unless a reservation is set, so one morning it can be
// at a different number — and ⭐ **the bridge fails every job with a connection error while the printer itself is
// perfectly well.** ⭐ This is READ-ONLY: it opens one TCP connection (which is also what WAKES the printer) and,
// if that fails, looks up the printer's own MAC in this Mac's address table and prints the address it is at now,
// with the one line to change. It never edits the config and never prints a label.
function canConnect(host, port, ms = 4000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => { try { sock.destroy(); } catch { /* already gone */ } resolve(ok); };
    const timer = setTimeout(() => done(false), ms);
    sock.on("connect", () => { clearTimeout(timer); done(true); });
    sock.on("error", () => { clearTimeout(timer); done(false); });
  });
}

const arpTable = () => new Promise((resolve) => {
  execFile("arp", ["-an"], { timeout: 5000 }, (err, out) => resolve(err ? "" : String(out || "")));
});

async function sayWhereThePrinterIs(cfg) {
  const host = String(cfg.printerHost || "");
  const port = Number(cfg.printerPort) || 9100;
  if (!host) { say("⚠️ no printerHost in the config — the bridge has nowhere to print."); return; }
  say(`printer: ${host}:${port}`);
  if (await canConnect(host, port)) {
    // ⭐ A reply is what wakes it; silence is NOT proof it is missing (it does not answer a ping at rest).
    say(`  ✔ answered at ${host} — that is where it is right now.`);
    return;
  }
  say(`  ✘ nothing answered at ${host}:${port}.`);
  const found = addressForMac(await arpTable());
  if (found && found !== host) {
    say(`  ⚠️ the printer's own MAC (${PRINTER_MAC}) is at ${found} on this network now — the address has MOVED.`);
    say(`  fix: change "printerHost" in ${CONFIG_PATH} to "${found}", then restart the bridge:`);
    say("       launchctl kickstart -k gui/$(id -u)/com.munchies.printbridge");
    return;
  }
  say("  ⚠️ its MAC is not in this Mac's address table either — the printer may be off, or on another network.");
  say("  ⚠️ A fixed address from the router (a DHCP reservation for " + PRINTER_MAC + ") stops this happening at all.");
}

main();
