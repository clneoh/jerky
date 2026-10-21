#!/usr/bin/env node
// print-bridge/status.mjs — READ-ONLY: what is in the label queue, and which site this bridge prints.
//
// ⭐ For the case where the app says "Sent" and nothing prints: ⚠️ the row itself shows whether the job's
// `site` matches this bridge and whether it is still `new`. ⚠️ It never prints, updates or deletes anything.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".munchies-print.json");

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
}

main();
