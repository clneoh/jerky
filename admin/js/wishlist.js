// wishlist.js — the software wish list on More: what the baker hopes the app
// will one day do. Behaviourally a twin of the Home to-do list (weekly.js): a
// tick toggles each item's `done`, ✎ renames, ✕ removes, and a "+ add your own"
// row appends. Pure module — no DOM, runs under Node for tests.
//
// Storage: settings.wishList = [{ id, label, done }]. Like the to-do tasks, the
// list is LAZY — nothing is written until the baker edits it, and there is no
// preset seed in defaultState. A phone that never opened the wish list therefore
// has no wishList key and (via the sync guard in sync.js) never pushes an empty
// list over the other phone's. Ticks persist forever (each item remembers its
// own `done`), unlike the weekly routine which resets every Sunday.

import { newId, save } from "./state.js";

// The stored list, or [] before she has ever added anything.
export function wishList(state) {
  const list = state.settings && state.settings.wishList;
  return Array.isArray(list) ? list : [];
}

function listFor(state) {
  if (!state.settings) state.settings = {};
  if (!Array.isArray(state.settings.wishList)) state.settings.wishList = [];
  return state.settings.wishList;
}

export function addWish(state, label) {
  const text = String(label || "").trim();
  if (!text) return false;
  listFor(state).push({ id: newId("wsh"), label: text, done: false });
  save(state);
  return true;
}

export function renameWish(state, id, label) {
  const text = String(label || "").trim();
  if (!text) return false;
  const item = wishList(state).find((w) => w.id === id);
  if (!item) return false;
  item.label = text;
  save(state);
  return true;
}

export function removeWish(state, id) {
  const list = wishList(state);
  if (!list.some((w) => w.id === id)) return false;
  state.settings.wishList = list.filter((w) => w.id !== id);
  save(state);
  return true;
}

export function toggleWish(state, id) {
  const item = wishList(state).find((w) => w.id === id);
  if (!item) return false;
  item.done = !item.done;
  save(state);
  return true;
}
