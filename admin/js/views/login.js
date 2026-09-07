// views/login.js — sign-in gate for shared data (cloud sync).
// Shown when shared data is enabled but there's no session and no stored
// credentials to auto-login with. Collects the Supabase connection (URL +
// anon key, same as Live availability) plus the baker's own login.

import { el, button } from "../ui.js";
import * as sync from "../sync.js";

export function renderLogin(root, state, { onSuccess, onOffline } = {}) {
  const sb = state.settings.supabase || {};
  const url = el("input", { class: "input", type: "url", inputmode: "url", autocomplete: "off",
    placeholder: "https://xxxx.supabase.co", value: sb.url || "" });
  const anonKey = el("input", { class: "input", type: "text", autocomplete: "off",
    placeholder: "anon public key (eyJ…)", value: sb.anonKey || "" });
  const email = el("input", { class: "input", type: "email", autocomplete: "off",
    placeholder: "you@example.com", value: sb.email || "" });
  const password = el("input", { class: "input", type: "password", autocomplete: "off",
    placeholder: "app login password", value: sb.password || "" });
  const errLine = el("p", { class: "card-sub", style: "margin:10px 0 0;color:#c0392b" });
  const btn = button("Sign in", doSignIn, "primary block");

  function doSignIn() {
    if (!url.value.trim() || !anonKey.value.trim() || !email.value.trim() || !password.value) {
      errLine.textContent = "Fill in the URL, anon key, email and password.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    sync.signIn(state, url.value, anonKey.value, email.value, password.value)
      .then(() => { if (onSuccess) onSuccess(); })
      .catch((err) => {
        btn.disabled = false;
        btn.textContent = "Sign in";
        errLine.textContent = err.message || "Sign in failed";
      });
  }

  const card = el("div", { class: "card", style: "margin:24px auto;max-width:440px" },
    el("h3", { style: "margin:0 0 4px" }, "Shared data sign-in"),
    el("p", { class: "card-sub", style: "margin:0 0 14px" },
      "Sign in to share orders, products and delivery dates across phones. Use your own Supabase login. The URL and anon key are the same ones from the Live availability setup — fill them in once on a new phone."),
    el("div", { class: "field" }, el("label", {}, "Supabase URL"), url),
    el("div", { class: "field" }, el("label", {}, "Anon public key"), anonKey),
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Email"), email),
      el("div", {}, el("label", {}, "Password"), password)),
    errLine,
    el("div", { class: "field", style: "margin-top:12px" }, btn),
    el("div", { class: "btn-row" },
      button("Use without cloud sync", () => { if (onOffline) onOffline(); }, "ghost block")));

  root.replaceChildren(card);
}
