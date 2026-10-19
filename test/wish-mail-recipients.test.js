// test/wish-mail-recipients.test.js — who the wish-list mail is allowed to go to (v561).
//
// ⚠️⚠️ THE FAULT. The function took its recipients from `payload.to` — the list the caller put in the
// request body — gated only by "any valid session". ⭐ So **any account in the project could make her
// verified domain mail any address, on her Resend bill.** Creating accounts being switched off was the
// whole of the protection, which is not a rule the code held.
//
// ⚠️ IT CANNOT BE IMPORTED (it starts with a `jsr:` specifier and calls `Deno.serve` at module scope), so
// this reads the SOURCE — the same way `test/email-sender-name.test.js` and
// `test/edge-function-imports.test.js` already do for the things a function's own runtime would need a
// live project to show. ⭐ **A source check is weaker than a driven one, and it is named as such here: what
// it can prove is that the body is never read for recipients, which is exactly the line that was removed.**

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../supabase/functions/wish-mail/index.ts", import.meta.url), "utf8");

test("★★★ the recipients come from HER settings, never from the request body", () => {
  assert.doesNotMatch(SRC, /payload\s*\.\s*to\b|payload\s*\[\s*["']to["']\s*\]/,
    "★ the wish mail reads `to` off the request body again — **any signed-in account can then send mail "
    + "from her verified domain to any address, and it is her Resend bill that pays for it**");
  assert.match(SRC, /developerEmails\s*\(/,
    "★ nothing reads the developer emails from her settings, so there is no honest source for a recipient");
  assert.match(SRC, /to:\s*recipients\b/,
    "★ the send does not use the list read from her settings — the two ends no longer agree");
});

test("★★★ the vendor's own refusal stays in the log, not in the reply", () => {
  // ⚠️ Resend's error body can name the address, the domain or a quota figure. `shop-feedback` has
  // returned the status alone since it shipped; this function was echoing the whole thing.
  assert.match(SRC, /console\.error\([^\n]*detail/,
    "★ the vendor's detail is no longer logged, so a real refusal arrives with nothing to diagnose it");
  assert.doesNotMatch(SRC, /json\(\{[^\n]*\bdetail\b/,
    "★ the vendor's error body is returned to the caller again — **it names addresses and quota figures "
    + "that are not the caller's to read**");
});

test("★★★ the settings column is TEXT, and is read as text (v576)", () => {
  // ⚠️⚠️ THE FAULT: `storefront_config.data` is a text column holding JSON (`storefront.sql:12`), and the
  // helper accepted only an object — ⭐ **so it always found no recipient and every wish-list email was refused
  // with "no developer email is set".** ⚠️ The source cannot be imported here (`jsr:` + `Deno.serve`), so this
  // is a source check, and it is labelled as one.
  assert.match(SRC, /typeof raw === "string"/,
    "★ the wish-mail does not read a text settings row — **every send is refused with 'no developer email is set'**");
  assert.match(SRC, /JSON\.parse\(raw\)/, "and it does not parse the JSON a text row holds");
});
