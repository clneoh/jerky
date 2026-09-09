// sharewarn.js — the amber "Not sharing right now" strip above every screen.
//
// Refreshed on each render (app.js) and whenever the shared-data switch
// changes (Settings). When this phone is sharing, the strip stays hidden; the
// moment it is not — shared data switched off, or the phone never set up, or
// signed out — the strip appears and stays until the cause is fixed. It is a
// reminder, never a lock: tapping it jumps to Settings > Shared data (cloud).
// Pure decision logic lives in sync.sharingState; this module only paints.

import { el } from "./ui.js";
import { sharingState } from "./sync.js";

const REASONS = {
  off: "Shared data is off. Orders and changes on this phone will not reach your other phone, and no cloud copies are saved from here, until you turn it back on.",
  unset: "This phone isn't connected to your shared cloud yet. Orders and changes here stay on this phone only until Shared data is set up.",
  signedout: "You're signed out of the shared cloud. Orders and changes here will not reach your other phone until you sign back in.",
};

export function refreshShareWarn(state) {
  const host = document.getElementById("share-warn");
  if (!host) return;
  const st = sharingState(state);
  if (st.on) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  const fix = "Fix it: More → Settings → Shared data (cloud).";
  host.replaceChildren(
    el("a", { class: "share-warn-inner", href: "#/settings", "aria-label": "Go to Shared data in Settings" },
      el("p", { class: "share-warn-msg" },
        el("b", {}, "⚠ Not sharing right now — "),
        (REASONS[st.kind] || "This phone is not on the shared cloud right now."), " ",
        fix)));
  host.hidden = false;
}
