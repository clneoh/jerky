// views/lock.js — the 4-digit app-password gate. Painted into the full-screen
// #lock-layer overlay (not #view) so nothing behind it is reachable until the
// PIN matches. Shown on app load when settings.lock is enabled.

import { el, button } from "../ui.js";
import { hashPin, isPin } from "../pin.js";

export function renderLock(layerEl, state, { onUnlocked } = {}) {
  const input = el("input", {
    class: "input lock-input", type: "password", inputmode: "numeric", maxlength: "4",
    autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false",
    placeholder: "4 digits",
  });
  const err = el("p", { class: "lock-error" });
  const go = button("Unlock", doUnlock, "primary block");

  async function doUnlock() {
    if (!isPin(input.value)) {
      err.textContent = "Enter 4 digits";
      input.value = "";
      input.focus();
      return;
    }
    go.disabled = true;
    const h = await hashPin(input.value);
    if (h === state.settings.lock.pinHash) {
      err.textContent = "";
      close();
      if (onUnlocked) onUnlocked();
    } else {
      err.textContent = "Wrong password — try again";
      go.disabled = false;
      input.value = "";
      input.focus();
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doUnlock();
  });

  function close() {
    layerEl.hidden = true;
    layerEl.replaceChildren();
  }

  const card = el("div", { class: "lock-card" },
    el("p", { class: "lock-emoji" }, "🔒"),
    el("p", { class: "lock-title" }, "Enter your 4-digit password"),
    el("p", { class: "lock-sub" }, "This app is locked on this phone."),
    input,
    err,
    el("div", { class: "lock-actions" }, go));

  layerEl.replaceChildren(card);
  layerEl.hidden = false;
  setTimeout(() => input.focus(), 0);

  // Test seam (harmless on the real DOM): lets tests drive the gate without
  // walking child indexes.
  layerEl._pin = input;
  layerEl._btn = go;
  layerEl._err = err;
}
