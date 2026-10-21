// print-bridge/retry.mjs — is this a printer that is not there YET, or a job that cannot print?
//
// ⚠️⚠️ A SLEEPING PRINTER IS NOT A BROKEN JOB (v621). ⚠️ MEASURED: the first attempt after the printer had been
// idle failed with EHOSTUNREACH, and the next poll printed it. ⚠️ The old bridge counted that as one of five
// attempts and would mark the label FAILED — ⚠️ **so a printer asleep for longer than about fifteen seconds
// lost the label.** ⭐ A network-level "not there" is a wait; only a real print fault is a failure.

const WAIT_CODES = new Set([
  "EHOSTUNREACH", "EHOSTDOWN", "ENETUNREACH", "ENETDOWN",
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE",
]);

export function isConnectivityError(err) {
  if (!err) return false;
  const code = String(err.code || "").toUpperCase();
  if (WAIT_CODES.has(code)) return true;
  const msg = String(err.message || "");
  // The bridge's own timeout message, and the shapes Node uses when a socket stalls.
  return /did not answer|timed? ?out|socket hang up/i.test(msg);
}
