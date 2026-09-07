// pin.js — device-local app-password helpers (pure, DOM-free).
// The 4-digit PIN is only ever stored as a SHA-256 fingerprint, never plaintext,
// and only under settings.lock so it never reaches the shared cloud.

export function isPin(s) {
  return typeof s === "string" && /^\d{4}$/.test(s);
}

const encoder = new TextEncoder();

export async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(String(pin)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hasStoredPin(settings) {
  const hash = settings && settings.lock && settings.lock.pinHash;
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}

// Both must hold: the toggle is on AND a well-formed hash exists. A partial or
// hand-edited stored lock can never lock the baker out of her own data.
export function lockEnabled(settings) {
  return !!(settings && settings.lock && settings.lock.enabled) && hasStoredPin(settings);
}
