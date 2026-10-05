// views/message_style.js — how the four customer messages open (v315).
//
// ⚠️ THIS CARD USED TO BE ONE OF ELEVEN IN SETTINGS. It is not a default of the
// app; it is how her WORDS reach a customer, which is the same subject as the
// offers and the reviews. Her instruction: __"move Message Style to the shop"__.
// The card below is the same card, moved whole.
//
// WhatsApp carries no fonts — the letters always come from the customer's own
// phone — so the only lever over how her words land is WhatsApp's own marks, and
// leaning the opening line over is the whole of this choice. The note under the
// picker is re-worded in place rather than re-rendered, so a save does not throw
// her back to the top of the screen.

import { el } from "../ui.js";
import { save } from "../state.js";
import { maybeSync } from "../supabase.js";

export function renderMessageStyle(root, state) {
  const cur = state.settings ??= {};

  const msNote = el("p", { class: "card-sub", style: "margin:6px 0 0" });
  const msNoteFor = (style) => (style === "greeting"
    ? "The opening line arrives leaning over. Everything below it — the order code, the items, the money — is untouched."
    : "Every message goes out word for word as it does today.");
  msNote.textContent = msNoteFor(cur.messageStyle);

  const msSelect = el("select", { class: "input",
    onchange: () => {
      // Anything that is not exactly "greeting" is Plain — the same reading the
      // message builders and the importer make, so the three can never disagree.
      cur.messageStyle = msSelect.value === "greeting" ? "greeting" : "plain";
      msNote.textContent = msNoteFor(cur.messageStyle);
      save(state); maybeSync(state);
    } },
    el("option", { value: "plain", selected: cur.messageStyle !== "greeting" },
      "Plain — exactly what you send today"),
    el("option", { value: "greeting", selected: cur.messageStyle === "greeting" },
      "The greeting leans over"));

  root.replaceChildren(
    el("h2", { class: "section" }, "Message style"),
    el("div", { class: "card" },
      el("h3", { style: "margin:0 0 4px" }, "How your messages open"),
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "How the four WhatsApp messages to a customer open — the confirmation, the payment reminder, \"on its way\" and \"ready\". WhatsApp has no fonts: the letters come from the customer's own phone, and the only marks it carries are bold, italics, strikethrough and monospace. So this leans the opening line over and nothing else moves."),
      el("div", { class: "field" }, el("label", {}, "Opening line"), msSelect, msNote)));
}
