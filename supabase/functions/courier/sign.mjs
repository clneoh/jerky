// supabase/functions/courier/sign.mjs — the Lalamove request signature
// (25 Sep 2026).
//
// WHY THIS IS A .mjs FILE AND NOT PART OF index.ts. It is the highest-risk code in
// the whole courier feature and the least forgiving: a signature that is wrong by
// one character is not a wrong answer, it is a 401 with no useful words, on every
// call, for every trip. So it lives in a plain ES module with no Deno API in it —
// WebCrypto only, which Deno and Node both have — and the app's own Node test suite
// imports this very file and checks it against an independently computed HMAC. The
// alternative was a copy of this logic written twice, which is how a signature ends
// up right on one side and wrong on the other.
//
// The scheme, from Lalamove's developer documentation:
//
//   base  = <TIMESTAMP>\r\n<METHOD>\r\n<PATH>\r\n\r\n<BODY>
//   HMAC-SHA-256 of that base with the SECRET, lowercase hex
//   Authorization: hmac <KEY>:<TIMESTAMP>:<SIGNATURE>
//
// and the four things about it that are easy to get wrong, each of which is pinned
// by a test rather than trusted:
//
//   • TIMESTAMP is milliseconds, not seconds.
//   • The four parts are joined with CRLF, not "\n" — and there are TWO CRLFs
//     between the path and the body, because the body of a GET is the empty string.
//   • METHOD is uppercase.
//   • The signed PATH carries no query string: the GET parameters are sent in the
//     URL but not in the signature.

// Unix milliseconds as the string that goes into the base — and into the header, and
// it must be the SAME value in both, which is why they are produced together below.
export function nowMs() {
  return Date.now();
}

// The exact string that gets signed. Exported so a test can assert its shape
// character for character — the CRLFs included, since that is where this breaks.
export function signatureBase(timestampMs, method, path, body = "") {
  const when = String(timestampMs == null ? "" : timestampMs);
  const verb = String(method || "").toUpperCase();
  const where = String(path || "");
  const payload = body == null ? "" : String(body);
  return `${when}\r\n${verb}\r\n${where}\r\n\r\n${payload}`;
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// Lowercase hex HMAC-SHA-256. WebCrypto, so this is the same call in Deno and in
// Node, and there is no import to get wrong.
export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, enc.encode(String(message)));
  return toHex(signed);
}

// The Authorization header value for one request.
export function authHeader(key, timestampMs, signature) {
  return `hmac ${String(key)}:${String(timestampMs)}:${String(signature)}`;
}

// Sign one request. Returns the header, plus the parts it was built from, so a
// caller that has to log a failure can log what was actually signed instead of
// guessing. The secret itself is never returned and never logged.
export async function signRequest({ key, secret, method, path, body = "", timestampMs }) {
  const when = timestampMs == null ? nowMs() : timestampMs;
  const base = signatureBase(when, method, path, body);
  const signature = await hmacHex(secret, base);
  return { timestamp: when, base, signature, authorization: authHeader(key, when, signature) };
}

// ── verifying an incoming webhook ──────────────────────────────────────────
//
// Lalamove signs its callbacks too, with the same key and secret, so the public
// hook can prove a request really came from Lalamove before it believes one word of
// it. A webhook carries no Authorization header to compare, and its signature is
// recomputed over the request URL and body rather than over a path we chose.
//
// The comparison is constant-time on purpose: a plain `===` on a signature leaks,
// through how long it takes to say no, how many leading characters were right, and
// a secret that can be walked out one character at a time is not a secret.
export function timingSafeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
