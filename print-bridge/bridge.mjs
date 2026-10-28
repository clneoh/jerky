#!/usr/bin/env node
// print-bridge/bridge.mjs — the Mac side of the Wi-Fi label printer.
//
// ⭐ WHY IT EXISTS. Her printer (Gprinter GP-1326D, Wi-Fi) speaks TSPL over raw TCP on port 9100. A web page
// cannot open a raw socket, and an HTTPS page cannot call a plain-HTTP device on the LAN. ⭐ So the phone
// drops a job into Supabase (`print_jobs`) and this script, on the Mac, prints it through the same Wi-Fi.
// ⚠️ It signs in as HER app login. The config lives in the Mac's home folder, never in the repo.
//
// Run:  node print-bridge/bridge.mjs
// Setup: see print-bridge/README.md

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pickPrinterHost } from "./printer.mjs";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { tsplForBitmap } from "./tspl.mjs";
import { isConnectivityError } from "./retry.mjs";

// ⭐ WHICH CONFIG — so ONE MACHINE CAN BE MORE THAN ONE BRIDGE (v672). ⚠️ Her plan: a bakery kitchen and a
// munchies kitchen, each its own printer and its own site name. ⭐ One file path per instance is all it takes:
// `BRIDGE_CONFIG` names it, and with nothing set the old default is used, so every bridge already running keeps
// working unchanged.
const CONFIG_PATH = String(process.env.BRIDGE_CONFIG || "").trim()
  || join(homedir(), ".munchies-print.json");
const POLL_MS = 3000;
const MAX_ATTEMPTS = 5;
// ⚠️ A JOB WAITING FOR A SLEEPING PRINTER IS LOGGED ONCE, not every three seconds.
const waitingLogged = new Set();

function say(msg) { process.stdout.write(`${msg}\n`); }

// ⚠️⚠️ A REQUEST THAT NEVER ANSWERS MUST NOT STOP THE POLL (v622). ⚠️ `fetch` has no timeout of its own, so a
// dropped connection left the loop awaiting for ever — ⚠️ **the bridge looked alive but stopped taking jobs,
// and the log said nothing.** ⭐ Every request is deadlined; a timeout comes back as "did not answer", which
// the queue treats as a wait.
async function fetchDeadlined(url, init = {}, ms = 15000) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
  } catch (err) {
    if (err && (err.name === "AbortError" || String(err.message || "").includes("aborted"))) {
      throw new Error(`the shared queue did not answer in ${Math.round(ms / 1000)} seconds`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function askConfig() {
  const rl = createInterface({ input: stdin, output: stdout });
  say("First run — the answers are saved on this computer only, in " + CONFIG_PATH);
  say("The password is your app login, and it is typed here, not into any chat.");
  const url = (await rl.question("Supabase URL (https://….supabase.co): ")).trim().replace(/\/+$/, "");
  const anonKey = (await rl.question("Supabase anon public key: ")).trim();
  const email = (await rl.question("App login email: ")).trim();
  const password = (await rl.question("App login password: ")).trim();
  const printerHost = (await rl.question("Printer IP (from its Wi-Fi app): ")).trim();
  const portRaw = (await rl.question("Printer port [9100]: ")).trim();
  const gapRaw = (await rl.question("Label gap in mm [2]: ")).trim();
  const siteRaw = (await rl.question("Printer name for this site [main]: ")).trim();
  rl.close();
  const cfg = {
    url,
    anonKey,
    email,
    password,
    printerHost,
    printerPort: Number(portRaw) > 0 ? Number(portRaw) : 9100,
    gapMm: Number(gapRaw) >= 0 ? Number(gapRaw) : 2,
    site: siteRaw || "main",
    // ⚠️ The GP-1326D prints a set bit as PAPER (measured: dark background, white letters), so its bits are
    // flipped at print time. A different printer can set this to false in the config file.
    invert: true,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
  say("Saved. Keep this computer on the same Wi-Fi as the printer.");
  return cfg;
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return cfg && cfg.url && cfg.anonKey && cfg.email && cfg.password && cfg.printerHost ? cfg : null;
  } catch { return null; }
}

async function login(cfg) {
  const res = await fetchDeadlined(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  if (!res.ok) throw new Error(`sign-in failed (${res.status}) — check the email and password in ${CONFIG_PATH}`);
  const body = await res.json();
  if (!body || !body.access_token) throw new Error("sign-in returned no token");
  return {
    token: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60000,
  };
}

function sendToPrinter(cfg, bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: cfg.printerHost, port: cfg.printerPort });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("the printer did not answer in 10 seconds"));
    }, 10000);
    sock.on("connect", () => {
      sock.write(bytes, () => {
        clearTimeout(timer);
        sock.end();
        resolve();
      });
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ⚠️ A SLEEPING PRINTER WAKES ON A CONNECTION (v621): three quick tries inside one job, instead of making it
// wait for the next three-second poll. ⚠️ Only a network-level "not there" is retried here; a real fault is
// returned at once.
async function sendWithRetry(cfg, bytes) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await sendToPrinter(cfg, bytes);
      return;
    } catch (err) {
      last = err;
      if (!isConnectivityError(err)) throw err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw last;
}

async function rest(cfg, session, path, init = {}) {
  return fetchDeadlined(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function patchJob(cfg, session, id, fields) {
  await rest(cfg, session, `print_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
}

async function tidyOldJobs(cfg, session) {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    await rest(cfg, session, `print_jobs?status=eq.printed&printed_at=lt.${encodeURIComponent(cutoff)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } });
  } catch { /* a tidy that fails is not a print that failed */ }
}

async function pollOnce(cfg, session) {
  const res = await rest(cfg, session,
    `print_jobs?status=eq.new&site=eq.${encodeURIComponent(cfg.site || "main")}`
    + "&order=created_at.asc&select=id,attempts,payload&limit=5");
  if (res.status === 401) return { relogin: true };
  if (!res.ok) throw new Error(`the queue could not be read (${res.status})`);
  const jobs = await res.json().catch(() => []);
  for (const job of Array.isArray(jobs) ? jobs : []) {
    try {
      // ⚠️ A config written before this option existed has no `invert`; this printer needs it, so the
      // default here is true rather than undefined.
      const bytes = tsplForBitmap(job.payload, { gapMm: cfg.gapMm, invert: cfg.invert !== false });
      await sendWithRetry(cfg, bytes);
      await patchJob(cfg, session, job.id, { status: "printed", printed_at: new Date().toISOString() });
      waitingLogged.delete(String(job.id));
      say(`printed job ${job.id}`);
    } catch (err) {
      // ⚠️⚠️ A PRINTER THAT IS NOT THERE YET IS A WAIT, NOT A FAILED LABEL (v621). ⚠️ Counting it as one of five
      // attempts abandoned a label when the printer slept for more than about fifteen seconds. ⭐ It stays
      // `new`, and prints on the first poll that reaches the printer.
      if (isConnectivityError(err)) {
        if (!waitingLogged.has(String(job.id))) {
          waitingLogged.add(String(job.id));
          say(`job ${job.id} is waiting for the printer: ${err.message}`);
        }
        continue;
      }
      const attempts = Number(job.attempts || 0) + 1;
      const fields = attempts >= MAX_ATTEMPTS ? { status: "failed", attempts } : { attempts };
      try { await patchJob(cfg, session, job.id, fields); } catch { /* retried next poll */ }
      say(`job ${job.id} failed (${attempts}/${MAX_ATTEMPTS}): ${err.message}`);
    }
  }
  return {};
}

// ⭐ THE ADDRESS SHE SET ON HER PHONE (v670). ⚠️ The phone cannot print — a web page has no raw socket and this
// printer has no print page — but it can TELL THIS MAC where the printer is, so a moved address is fixed in
// Settings instead of in a file here. ⚠️ Read once a minute, not once a poll: her setting changes when she says,
// and a queued label must never wait on it.
async function readPrinterHost(cfg, session) {
  try {
    const res = await rest(cfg, session, "bakery?kind=eq.settings&id=eq.default&select=data");
    if (!res.ok) return "";
    const rows = await res.json();
    const data = Array.isArray(rows) && rows[0] ? rows[0].data : null;
    return data && typeof data.printerHost === "string" ? data.printerHost : "";
  } catch {
    return ""; // ⚠️ an unreadable setting is NO setting — the Mac's own address keeps printing
  }
}

async function main() {
  say("Munchies Furkidz print bridge for GP1326D Gprinter — Ctrl-C to stop.");
  // ⚠️⚠️ IT MUST NOT PROMPT WHERE THERE IS NOBODY TO ANSWER (v671). ⚠️ The first-run questions read from a
  // terminal; on a SERVER — her UGREEN box, a Pi, or inside Docker — there is no terminal, and a prompt would
  // hang for ever looking exactly like a bridge that is running. ⭐ So with `BRIDGE_NO_PROMPT` set it says what
  // is missing and stops, rather than waiting for a keystroke that will never come.
  let cfg = readConfig();
  if (!cfg && String(process.env.BRIDGE_NO_PROMPT || "") === "1") {
    say(`No bridge config at ${CONFIG_PATH}. On a server this is written by hand — see print-bridge/README.md, "Running it on a server".`);
    process.exit(1);
  }
  const cfgOrAsked = cfg || await askConfig();
  // ⚠️ The file's own address is kept as the FALLBACK: a blank or mistyped setting must never stop a label.
  cfg = cfgOrAsked;
  const ownHost = cfg.printerHost;
  let session = null;
  let tidiedAt = 0;
  let saidHost = "";
  let settingCheckedAt = 0;
  for (;;) {
    try {
      if (!session || Date.now() >= session.expiresAt) {
        session = await login(cfg);
        say(`signed in to the shared queue — this bridge prints site "${cfg.site || "main"}"`);
      }
      if (Date.now() - tidiedAt > 3600 * 1000) {
        tidiedAt = Date.now();
        await tidyOldJobs(cfg, session);
      }
      let cloudHost = "";
      if (Date.now() - settingCheckedAt > 60 * 1000) {
        settingCheckedAt = Date.now();
        cloudHost = await readPrinterHost(cfg, session);
      }
      const pick = pickPrinterHost(cloudHost, ownHost);
      if (pick.host && pick.host !== cfg.printerHost) {
        cfg.printerHost = pick.host;
        if (saidHost !== pick.host) {
          saidHost = pick.host;
          say(`printing to ${pick.host} (${pick.from})`);
        }
      }
      const out = await pollOnce(cfg, session);
      if (out.relogin) session = null;
    } catch (err) {
      say(`waiting: ${err.message}`);
      session = null;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
