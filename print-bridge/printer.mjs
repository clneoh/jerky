// print-bridge/printer.mjs — which printer, and where it is on the network.
//
// ⭐ Split out of `status.mjs` (v669) for one reason: **importing `status.mjs` RAN it** — it signed in and read
// the queue, which no test should ever start. A pure module can be imported and held to account without any of
// that.

// Her label printer's own hardware address (Gprinter GP-1326D). ⚠️ A MAC is stable; an IP is not.
export const PRINTER_MAC = "38:44:be:88:37:a0";

// The address this Mac last saw for that MAC, out of `arp -an`'s own text — or "" when it has not seen it.
// ⚠️ The match must be the WHOLE hardware address: a prefix match would hand back a neighbour's number.
export function addressForMac(arpText, mac = PRINTER_MAC) {
  const want = String(mac || "").toLowerCase();
  if (!want) return "";
  for (const line of String(arpText || "").split("\n")) {
    const m = line.match(/\(([0-9.]+)\)\s+at\s+([0-9a-f:]+)/i);
    if (!m) continue;
    if (m[2].toLowerCase() === want) return m[1];
  }
  return "";
}

// ★★ THE ADDRESS SHE TYPES ON HER PHONE (v670). ⚠️ The PHONE still cannot print — a web page has no raw socket,
// and her printer has no HTTP print page — but it CAN tell the Mac where to print. ⭐ So the address is a SETTING
// now, and this decides which one wins.
//
// ⚠️ **A typed address is accepted only when it looks like one.** A blank or a typo must never replace an address
// that works, or one bad keystroke on a phone would stop every label.
export function cleanPrinterHost(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s || s.length > 253) return "";
  // An IPv4 address, or a plain hostname (letters, digits, dots, dashes) — never a URL, a port or a path.
  // ⚠️ A DOTTED QUAD OF DIGITS IS AN IPV4 OR IT IS NOTHING — ⚠️ it must NOT fall through to the hostname rule,
  // which would happily accept 192.168.51.999 as a name and hand the bridge an address that cannot exist.
  const quad = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (quad.test(s)) {
    return s.split(".").every((n) => Number(n) >= 0 && Number(n) <= 255) ? s : "";
  }
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(s)) return s;
  return "";
}

// Which address to use: ⭐ the one she typed (once it is valid), else the one in the bridge's own config. ⚠️ The
// config is never overwritten — it is the fallback that keeps printing alive when the setting is blank or wrong.
export function pickPrinterHost(fromCloud, fromConfig) {
  const typed = cleanPrinterHost(fromCloud);
  if (typed) return { host: typed, from: "the address set in the app" };
  const own = String(fromConfig == null ? "" : fromConfig).trim();
  if (own) return { host: own, from: "this computer's own config" };
  return { host: "", from: "nowhere — no address is set" };
}
