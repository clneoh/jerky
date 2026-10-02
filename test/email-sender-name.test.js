// test/email-sender-name.test.js — what a customer sees in their inbox before they
// open the mail.
//
// The two Resend functions each build their From header from `RESEND_FROM` with a
// hard-coded fallback. Until v260 that fallback read "BakeAdmin wishes", which is the
// APP's internal name — a word no customer has ever seen on the shop, the homepage or
// any label. It sat on the wish-list mail and on a customer's own suggestion coming
// back to her, so the one line of the mail a person reads without opening it was
// branded with something she does not sell.
//
// These sources cannot be imported (they start with `jsr:` and `Deno.serve`; see
// test/edge-function-imports.test.js for the long version), so this file reads them,
// the same way the suite already reads them for the engine number and the honeypot.
//
// The rule is the engine number's rule, applied to a name: ONE brand, declared in ONE
// place, and never retyped into a second file. The bakery's brand is the leading words
// of the homepage `<title>` — the same source [[project-homepage-brand]] names as the
// authority — so a change of brand surfaces here as a failing test naming the two
// functions that must move with it, instead of shipping as a silent disagreement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const HOME_SRC = read("../index.html");
const SOURCES = {
  "wish-mail": read("../supabase/functions/wish-mail/index.ts"),
  "shop-feedback": read("../supabase/functions/shop-feedback/index.ts"),
};

// `const from = Deno.env.get("RESEND_FROM") || "Display Name <address@domain>";`
// Both functions are written to this exact shape, and the reader says so out loud
// below rather than returning a quiet undefined.
const FROM_LINE = /const from = Deno\.env\.get\("RESEND_FROM"\)\s*\|\|\s*"([^"<]*?)\s*<([^>]*)>"/;

function sender(src, which) {
  const m = src.match(FROM_LINE);
  assert.ok(m, `${which} still declares its From default in the one shape this test reads`);
  return { name: m[1].trim(), address: m[2].trim() };
}

// The brand, as the homepage declares it: the leading words of the `<title>`, before
// the tagline that follows the dash, pipe or dot separator.
function brandFromHomepage() {
  const m = HOME_SRC.match(/<title>([\s\S]*?)<\/title>/);
  assert.ok(m, "the homepage still has a <title>, which is where the brand is declared");
  return m[1].split(/\s*[—–|·]\s*/)[0].trim();
}

test("the homepage still declares a brand for the inbox line to be taken from", () => {
  // Without this, a title edit could leave every assertion below comparing two empty
  // strings and passing — which reads exactly like a pass.
  const brand = brandFromHomepage();
  assert.ok(brand.length > 0, `the homepage title names a brand: ${JSON.stringify(brand)}`);
});

test("both mails are sent under the bakery's brand, taken from the homepage and never retyped", () => {
  const brand = brandFromHomepage();
  for (const [which, src] of Object.entries(SOURCES)) {
    assert.equal(sender(src, which).name, brand,
      `${which} greets the customer as the bakery. If the brand changed, this is the line to move with it — ` +
      `the homepage is the source, not this file`);
  }
});

test("no mail is ever sent under the app's own internal name", () => {
  // The name that caused this: a word that appears nowhere a customer looks. Pinned as
  // its own test because it is the fault, not merely a wrong string — any future display
  // name has to clear this, whatever it is.
  for (const [which, src] of Object.entries(SOURCES)) {
    assert.ok(!/BakeAdmin/.test(sender(src, which).name),
      `${which} sends under the app's internal name, which no customer has ever seen`);
  }
});

test("the two mails are recognisably from the same bakery", () => {
  // A wish-list mail and a suggestion coming back to the developer's own inbox arrive at
  // different times from the same sender. Two names would make them look like two senders.
  const [a, b] = Object.values(SOURCES).map((src) => sender(src, "the function").name);
  assert.equal(a, b, "the wish mail and the feedback mail carry one name between them");
});

test("the verified sending address is not moved by a change of display name", () => {
  // The display name is what a person reads; the address inside the angle brackets is
  // what Resend has verified for this domain. Changing the name is free; changing the
  // address in the same breath would stop the mail arriving at all.
  for (const [which, src] of Object.entries(SOURCES)) {
    assert.equal(sender(src, which).address, "wishlist@send.munchies.com.my",
      `${which} keeps the verified sending address`);
  }
});

test("RESEND_FROM still overrides the default, and the default is only a fallback", () => {
  // Worth stating because it is the one thing that can make all of the above moot on the
  // live project: if the secret is set in Supabase, the code's name is never used. The
  // `||` is what keeps the fallback a fallback.
  for (const [which, src] of Object.entries(SOURCES)) {
    assert.match(src, /const from = Deno\.env\.get\("RESEND_FROM"\)\s*\|\|/,
      `${which} prefers RESEND_FROM when the project sets it`);
  }
});
