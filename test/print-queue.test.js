// test/print-queue.test.js — the Wi-Fi print queue: bitmap packing, TSPL framing, and the job insert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { packBitmap, bytesToBase64, labelBitmap } from "../admin/js/label_image.js";
import { tsplForBitmap } from "../print-bridge/tspl.mjs";

const rgba = (pixels) => Uint8ClampedArray.from(pixels.flat());

test("★★★ a dark pixel is ink and a light or transparent one is paper (v617)", () => {
  // A 2 x 2: black at (0,0), white at (1,0), transparent at (0,1), white at (1,1).
  const frame = rgba([
    [0, 0, 0, 255], [255, 255, 255, 255],
    [0, 0, 0, 0], [255, 255, 255, 255],
  ]);
  const out = packBitmap(frame, 2, 2);
  assert.equal(out.widthBytes, 1, "two pixels do not pack into one byte");
  assert.equal(out.height, 2);
  assert.equal(out.bytes[0], 0x80, "★ the black pixel is not the top bit of the first byte");
  assert.equal(out.bytes[1], 0x00, "★ a transparent pixel was printed as ink");
});

test("★★ a pixel in the SECOND byte lands on its top bit (v617)", () => {
  const frame = new Uint8ClampedArray(10 * 4);
  for (let i = 0; i < 10; i += 1) { frame[i * 4] = 255; frame[i * 4 + 1] = 255; frame[i * 4 + 2] = 255; frame[i * 4 + 3] = 255; }
  frame[8 * 4] = 0; frame[8 * 4 + 1] = 0; frame[8 * 4 + 2] = 0; // the first pixel of the second byte, x = 8
  const out = packBitmap(frame, 10, 1);
  assert.equal(out.widthBytes, 2, "ten dots must span two bytes");
  assert.equal(out.bytes[0], 0x00);
  assert.equal(out.bytes[1], 0x80, "★ the pixel at x=8 is not bit 7 of the second byte");
});

test("★★★ the job's bytes become a real TSPL print (v617)", () => {
  const data = Buffer.from([0xff, 0x00, 0x81]).toString("base64");
  const out = tsplForBitmap({ widthMm: 100, heightMm: 150, widthBytes: 12, height: 7, data });
  const text = out.toString("latin1");
  assert.match(text, /^SIZE 100 mm,150 mm\r\n/, "★ the stock size is not declared first");
  assert.match(text, /GAP 2 mm,0 mm\r\n/, "★ the label gap is missing — the prints will drift");
  assert.match(text, /BITMAP 0,0,12,7,0,/, "★ the bitmap command does not match the job");
  assert.match(text, /\r\nPRINT 1\r\n$/, "★ the job never asks the printer to print");
  // The binary payload is carried byte-for-byte between the command and the line end.
  const at = out.indexOf(Buffer.from([0xff, 0x00, 0x81]));
  assert.ok(at > 0, "★ the bitmap bytes are missing from the command");
});

test("★★ a job with no bitmap is refused, not sent as a blank label (v617)", () => {
  assert.throws(() => tsplForBitmap({ widthBytes: 0, height: 0, data: "" }), /bitmap/);
  assert.throws(() => tsplForBitmap(null), /job/);
});

test("★★ with no canvas there is no job — never a broken one (v617)", () => {
  assert.equal(labelBitmap([["customer", "Lucy"]]), null);
});

test("★★ the phone sends the job to the queue and reports only a real landing (v617)", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
  };
  store.set("bakeadmin.supabase", JSON.stringify({ access_token: "tok", expires_at: Date.now() + 3600000 }));
  const { sendPrintJob } = await import("../admin/js/supabase.js");
  const state = { settings: { supabase: { enabled: true, url: "https://p.supabase.co", anonKey: "anon",
    email: "a@b.c", password: "p" } }, orders: [] };
  let seen = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("/rest/v1/print_jobs")) { seen = { url: String(url), body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: false };
  };
  const job = { widthMm: 100, heightMm: 150, widthBytes: 1, height: 1, data: "gA==" };
  assert.deepEqual(await sendPrintJob(state, job), { ok: true, why: "" });
  assert.match(seen.url, /\/rest\/v1\/print_jobs$/, "★ the job did not go to the queue table");
  assert.deepEqual(seen.body.payload, job, "★ the job's payload changed on the way out");
  assert.equal(seen.body.site, "main", "★ the job does not say which printer it is for");
  globalThis.fetch = async () => ({ ok: false });
  assert.deepEqual(await sendPrintJob(state, job), { ok: false, why: "refused" },
    "a refused insert was reported as sent");
});

// ⚠️⚠️ THE FAILURE SAYS WHICH ONE IT WAS (v629). **A job this phone could not hand to the cloud never reached
// the queue, so the bridge was never asked for anything** — and the toast used to ask whether the bridge was
// running, which sent her to check a Mac that was never the fault. Her case: a Supabase incident, nothing
// wrong in the shop at all.
test("★★★ a print that cannot be sent names the real cause, never the bridge (v629)", async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
  };
  const { sendPrintJob } = await import("../admin/js/supabase.js");
  const job = { widthMm: 100, heightMm: 150, widthBytes: 1, height: 1, data: "gA==" };
  const sb = { enabled: true, url: "https://p.supabase.co", anonKey: "anon", email: "a@b.c", password: "p" };
  const state = { settings: { supabase: sb }, orders: [] };

  // Sharing off: nothing on this phone can be sent, and it says what to turn on.
  const offState = { settings: { supabase: { ...sb, enabled: false } }, orders: [] };
  assert.deepEqual(await sendPrintJob(offState, job), { ok: false, why: "not-set-up" },
    "★ sharing off was reported as a queue refusal");

  // No cached session and the sign-in is refused.
  store.clear();
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  assert.deepEqual(await sendPrintJob(state, job), { ok: false, why: "sign-in" },
    "★ a refused sign-in was reported as a queue refusal");

  // A cached session, but the connection never answers.
  store.set("bakeadmin.supabase", JSON.stringify({ access_token: "tok", expires_at: Date.now() + 3600000 }));
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  assert.deepEqual(await sendPrintJob(state, job), { ok: false, why: "no-answer" },
    "★ a dead connection was reported as a refusal");

  // And the words on screen never ask about the bridge: it was never reached.
  const src = readFileSync(new URL("../admin/js/views/orders.js", import.meta.url), "utf8");
  assert.ok(!/is the bridge running/i.test(src),
    "★ the toast still asks whether the bridge is running — the job never got that far");
  assert.match(src, /printRefusal\("invoice", sent\.why\)/, "the invoice's refusal is not named");
  assert.match(src, /printRefusal\("label", sent\.why\)/, "the label's refusal is not named");
});

test("★★★ the bridge flips the bits for this printer, and only when asked (v618)", () => {
  // ⚠️ Measured on her GP-1326D: the first print had a dark background and white letters — the printer reads
  // a set bit as PAPER. ⭐ The phone's job keeps one meaning (1 = ink); the flip belongs to the bridge.
  const data = Buffer.from([0x0f, 0xf0]).toString("base64");
  const job = { widthMm: 100, heightMm: 150, widthBytes: 2, height: 1, data };
  const flipped = tsplForBitmap(job, { invert: true });
  assert.ok(flipped.includes(Buffer.from([0xf0, 0x0f])), "★ the bits print inverted again");
  const asIs = tsplForBitmap(job);
  assert.ok(asIs.includes(Buffer.from([0x0f, 0xf0])), "a printer that reads 1 as ink was flipped without being asked");
});

test("★★★ each device names the printer it prints to, and the name stays on that device (v619)", async () => {
  // ⚠️ Two sites, one book: without a name every bridge would print every label, twice.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => store.delete(k),
  };
  const { printSite, setPrintSite } = await import("../admin/js/print_site.js");
  assert.equal(printSite(), "main", "a fresh device does not default to main");
  assert.equal(setPrintSite("  second  "), "second", "the name was not trimmed");
  assert.equal(printSite(), "second");
  assert.equal(setPrintSite(""), "main", "clearing the name did not return to main");
  assert.equal(store.has("bakeadmin.printSite"), false, "a cleared name was left behind");
});

test("★★★ the bridge asks only for its own site (v619)", () => {
  const src = readFileSync(new URL("../print-bridge/bridge.mjs", import.meta.url), "utf8");
  assert.match(src, /site=eq\.\$\{encodeURIComponent\(cfg\.site/, "★ the bridge reads every site's jobs — two sites would double-print");
  assert.match(src, /Printer name for this site/, "the site is not part of the bridge's setup");
});

// ── v621: a sleeping printer is a wait, not a failed label ─────────────────

test("★★★ a printer that is not there yet is a WAIT, not a failure (v621)", async () => {
  // ⚠️ MEASURED: the first attempt after idle failed with EHOSTUNREACH and the next poll printed it. ⚠️ The old
  // bridge counted that among five attempts and could abandon a label while the printer slept.
  const { isConnectivityError } = await import("../print-bridge/retry.mjs");
  assert.equal(isConnectivityError(Object.assign(new Error("x"), { code: "EHOSTUNREACH" })), true);
  assert.equal(isConnectivityError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), true);
  assert.equal(isConnectivityError(new Error("the printer did not answer in 10 seconds")), true);
  assert.equal(isConnectivityError(new Error("the job has no bitmap data")), false,
    "★ a broken label was treated as a printer that might come back");
  assert.equal(isConnectivityError(null), false);
});

test("★★★ the bridge does not spend an attempt on a wait, and retries inside the job (v621)", () => {
  const src = readFileSync(new URL("../print-bridge/bridge.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(isConnectivityError\(err\)\) \{[\s\S]{0,220}continue;/,
    "★ a sleeping printer still counts against the five attempts");
  assert.match(src, /async function sendWithRetry/, "the bridge does not retry within the job");
  assert.match(src, /waitingLogged\.delete/, "the waiting note is never cleared after a print");
});

test("★★★ a queue request that never answers cannot stop the poll (v622)", () => {
  const src = readFileSync(new URL("../print-bridge/bridge.mjs", import.meta.url), "utf8");
  assert.match(src, /async function fetchDeadlined/, "the bridge has no deadlined request");
  assert.match(src, /new AbortController\(\)/, "nothing aborts a hung request");
  assert.match(src, /fetchDeadlined\(`\$\{cfg\.url\}\/rest\/v1/, "the queue read is not deadlined");
  assert.match(src, /prints site "/, "the bridge does not say which site it prints in its log");
});

test("★★ the status command only READS the queue (v622)", () => {
  const src = readFileSync(new URL("../print-bridge/status.mjs", import.meta.url), "utf8");
  assert.match(src, /select=id,created_at,status,site,attempts/, "the status command does not read the queue");
  assert.equal(/method:\s*"PATCH"/.test(src), false, "★ the status command can change a job");
  assert.equal(/method:\s*"DELETE"/.test(src), false, "★ the status command can delete a job");
  assert.equal(/\/rpc\//.test(src), false, "★ the status command calls a function");
});

// ── the bridge must never be pointed at the other business (v668) ───────────
//
// ⚠️⚠️ FOUND ON 2026-10-27, in this repo, while she was getting ready to TEST the printer: the bridge's own
// README told her to paste `https://hzpyblqygnntixkijeem.supabase.co` — **the BAKERY's project.** ⭐ Following
// the instructions would have pointed her Mac's print bridge at someone else's shared data: no labels would
// print, and the failure would look like a printer fault rather than a wrong address. ⚠️ It came in with the
// port, and the bridge's own files were localized while the README's one line was missed — the same shape as
// the shop copy, in a place no test was reading.
const BRIDGE = ["../print-bridge/README.md", "../print-bridge/bridge.mjs", "../print-bridge/install-mac.sh",
  "../print-bridge/install-linux.sh", "../print-bridge/uninstall-linux.sh", "../print-bridge/uninstall-mac.sh"];

test("★★★ the print bridge names THIS shop's project and this machine's own files", () => {
  for (const rel of BRIDGE) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/hzpyblqygnntixkijeem/.test(text),
      `${rel} carries the BAKERY's Supabase project — a bridge pointed there prints nothing`);
    assert.ok(!/jienluv2bake/.test(text), `${rel} carries the bakery's domain`);
    assert.ok(!/bakeadmin-print|com\.bakester|bakeadmin-print\.log/.test(text),
      `${rel} carries the bakery's identity — two bridges on one Mac must not share a config or a service`);
    // ⚠️ AND ITS OWN NAME ON SCREEN: the first line she reads when the bridge starts said "Bakeadmin label
    // bridge" (found 27 Oct 2026, on her Mac, mid-setup). It is the same fault as the shop copy — the code was
    // localized and one sentence was not.
    assert.ok(!/bakeadmin/i.test(text), `${rel} still prints the other business's name`);
  }
  // And the one place the whole chain is named: the project the app itself talks to.
  const config = readFileSync(new URL("../store/config.js", import.meta.url), "utf8");
  const ref = /([a-z]{20})\.supabase\.co/.exec(config);
  assert.ok(ref, "the shop's own Supabase project is no longer readable from store/config.js");
  assert.match(readFileSync(new URL("../print-bridge/README.md", import.meta.url), "utf8"), new RegExp(ref[1]),
    "★ the bridge's instructions name a DIFFERENT project from the one the app uses");
});

test("★★★ the Linux installer is a twin of the Mac one, and names this shop", () => {
  // ⭐ Two machines, one program: the bridge moves to a home server or a Raspberry Pi with **no code change**,
  // so the one thing that must not drift is the identity — the service name, the config file, and the project.
  const sh = readFileSync(new URL("../print-bridge/install-linux.sh", import.meta.url), "utf8");
  // ⚠️ ONE MACHINE, SEVERAL BRIDGES: the unit carries the SITE, so two printers on one box are two units.
  assert.match(sh, /UNIT="munchies-print@\$SITE\.service"/, "the systemd unit keeps this shop's own name");
  assert.match(sh, /does not say site/, "★ and it refuses to install a bridge whose config names a different site");
  assert.match(sh, /\.munchies-print\.json/, "and reads the same config file the bridge writes");
  assert.match(sh, /Restart=always/, "★ a service that does not restart itself is a service she has to watch");
  assert.match(sh, /After=network-online\.target/,
    "it must not race the network — signing in before it is up is the retry loop her first attempt sat in");
  assert.match(sh, /systemctl enable/, "and it has to start at boot");
  // ⚠️ It refuses to install without a config: the printer's address is only known after one run by hand.
  assert.match(sh, /No config at/, "the installer must stop and explain, not install a bridge that cannot print");
  // ⚠️ And it says so out loud: two bridges on one site name print every label twice.
  assert.match(sh, /print each other's labels|prints every label|every label prints/i,
    "the double-print warning is gone");
});

// ⭐ WHERE IS THE PRINTER, WHEN ITS ADDRESS HAS MOVED.
// ⚠️ The printer's address comes from the router unless a reservation is set, so one morning it can be at a
// different number — and the bridge fails every job while the printer itself is perfectly well.
import { addressForMac, cleanPrinterHost, pickPrinterHost } from "../print-bridge/printer.mjs";

test("★★★ the printer's own MAC is found in this machine's address table", () => {
  const arp = [
    "? (192.168.51.1) at 44:1c:a8:11:22:33 on en0 ifscope [ethernet]",
    "? (192.168.51.48) at a4:83:e7:01:02:03 on en0 ifscope [ethernet]",
    "? (192.168.51.61) at 38:44:be:88:37:a0 on en0 ifscope [ethernet]",
  ].join("\n");
  assert.equal(addressForMac(arp), "192.168.51.61", "★ the printer's address was not found");
  // ⚠️ An address the table does not hold is "" — never a guess, and never another device's number.
  assert.equal(addressForMac("? (192.168.51.5) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"), "");
  assert.equal(addressForMac(""), "");
  // ⚠️ And a MAC match must be the WHOLE address, not a prefix of another device's.
  const near = "? (192.168.51.70) at 38:44:be:88:37:a1 on en0 ifscope [ethernet]";
  assert.equal(addressForMac(near), "", "★ a neighbour's MAC was read as the printer's");
});

test("★★★ a typed address is used only when it looks like one", () => {
  assert.equal(cleanPrinterHost(" 192.168.51.32 "), "192.168.51.32");
  assert.equal(cleanPrinterHost("printer.local"), "printer.local");
  // ⚠️ An impossible address is NOT a hostname — it must be refused, not passed through as a name.
  assert.equal(cleanPrinterHost("192.168.51.999"), "", "★ an impossible address was accepted");
  assert.equal(cleanPrinterHost("http://192.168.51.32/print"), "");
  assert.equal(cleanPrinterHost("192.168.51.32:9100"), "", "the port is not part of the address");
  assert.equal(cleanPrinterHost(""), "");
  assert.equal(cleanPrinterHost(null), "");
});

test("★★★ the app's address wins, and this machine's own is the fallback that keeps printing", () => {
  assert.deepEqual(pickPrinterHost("192.168.51.61", "192.168.51.32"),
    { host: "192.168.51.61", from: "the address set in the app" });
  // ⚠️ A blank or mistyped setting must never stop a label — the machine's own address carries on.
  assert.deepEqual(pickPrinterHost("", "192.168.51.32"),
    { host: "192.168.51.32", from: "this computer's own config" });
  assert.deepEqual(pickPrinterHost("nonsense!!", "192.168.51.32"),
    { host: "192.168.51.32", from: "this computer's own config" });
  // And with neither, it says so rather than printing to nothing.
  assert.equal(pickPrinterHost("", "").host, "");
});

test("★★★ BRIDGE_CONFIG points a second bridge at its own file", () => {
  // ⚠️ Driven as a real process, because the path is read once at start-up — a unit test that re-imported the
  // module could not tell "reads the variable" from "reads it the first time".
  let out = "";
  try {
    execFileSync(process.execPath, ["print-bridge/bridge.mjs"], {
      env: { ...process.env, BRIDGE_NO_PROMPT: "1", BRIDGE_CONFIG: "/tmp/no-such-bridge-config.json" },
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    out = String((err && (err.stdout || err.message)) || "");
  }
  assert.match(out, /No bridge config at \/tmp\/no-such-bridge-config\.json/,
    "★ the bridge ignored BRIDGE_CONFIG and looked somewhere else — a second site would read the first site's file");
});
