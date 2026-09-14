// suggest.js — accept a field's greyed suggestion with the right-arrow key.
//
// A field opts in by carrying data-suggest="<the value to insert>" next to the
// placeholder that shows it greyed on screen. Pressing → on an empty field (or
// tapping the small arrow drawn at its right edge, for a phone with no arrow
// key) puts the suggestion in as the value, exactly as if it had been typed:
// bubbling input + change events fire, so the view's own handlers run.
//
// Deliberately opt-in, never guessed from the placeholder text. The same greyed
// slot elsewhere carries instructions ("4 digits", "app login password",
// "https://xxxx.supabase.co") — accepting one of those would drop nonsense into
// the app, so only fields that really have a recommendation are marked.
//
// The tap half has to survive the field moving under the baker's thumb. On a
// phone, tapping a text box opens the keyboard, which shrinks and pans the page —
// so a spot that accepted a tap a moment ago can sit somewhere else a moment
// later, and the arrow seems to stop working after the first time. Three rules
// keep it dependable: taking a suggestion never opens the keyboard, so nothing
// shifts between taps; the strip that counts is generous around the drawn arrow;
// and the tap is judged against the field's own box as well as the page, so
// whichever reading survives a shifted page finds the arrow.

// The value a field would accept, or "" when it has none to offer. Only an
// empty, enabled field offers it: a field with text is the baker's own.
function suggestionValue(field) {
  if (!field || (field.tagName !== "INPUT" && field.tagName !== "TEXTAREA")) return "";
  if (field.disabled || field.readOnly) return "";
  if (field.value !== "") return "";
  const raw = field.dataset ? field.dataset.suggest : "";
  return typeof raw === "string" ? raw : "";
}

// A number input silently blanks a value it cannot parse, so a suggestion that
// doesn't fit the field's type is refused rather than half-applied.
function fitsType(field, value) {
  if (field.type === "number") {
    return value.trim() !== "" && Number.isFinite(Number(value));
  }
  return true;
}

// Put the field's suggestion in and tell the view about it, as if typed.
// Returns true when something was accepted.
//
// The two events carry `suggested = true`, because a view cannot otherwise tell
// an accepted recommendation from the baker's own typing: both arrive as an
// ordinary input event. Products uses it to keep a machine translation machine
// (never frozen as hand-written just because → was tapped). Views that don't
// care simply ignore the flag.
export function acceptSuggestion(field) {
  const value = suggestionValue(field);
  if (!value || !fitsType(field, value)) return false;
  field.value = value;
  const input = new Event("input", { bubbles: true });
  const change = new Event("change", { bubbles: true });
  input.suggested = true;
  change.suggested = true;
  field.dispatchEvent(input);
  field.dispatchEvent(change);
  return true;
}

// How wide the arrow's tap strip is on a field this wide. A thumb is blunt, so
// the strip is generous around the drawn arrow (which is 15px, ending 9px in from
// the right). It can safely be generous: the strip is only ever live while the
// field is EMPTY — the arrow and the greyed text appear together — so there is no
// typed text underneath for a wide strip to swallow.
function arrowZoneWidth(width) {
  return Math.min(52, Math.max(30, width * 0.28));
}

// Was this event a tap on the drawn arrow (the right edge of the field)? Two
// readings are taken and EITHER one landing in the strip counts. That makes this
// strictly more forgiving than the single page-coordinate reading it replaces: it
// can accept a tap that reading would have missed, but never refuse one it took.
//   • the field's own offset (offsetX) — the reading that stays true however the
//     page has been scrolled or panned, as the keyboard opening under a thumb
//     does; and
//   • the page coordinate (clientX) — the plain reading, for an event that
//     carries no offset of its own.
function inArrowZone(field, ev) {
  const own = Number(field.clientWidth);
  if (ev.target === field && Number.isFinite(ev.offsetX) && own > 0 &&
      ev.offsetX >= own - arrowZoneWidth(own)) {
    return true;
  }
  if (typeof field.getBoundingClientRect !== "function") return false;
  if (!Number.isFinite(ev.clientX)) return false;
  const rect = field.getBoundingClientRect();
  if (!rect.width) return false;
  return ev.clientX >= rect.right - arrowZoneWidth(rect.width);
}

// A tap anywhere but the arrow is an ordinary tap — placing the caret — so the
// field still behaves normally.
function acceptIfArrowTapped(field, ev) {
  if (!suggestionValue(field)) return false;
  if (!inArrowZone(field, ev)) return false;
  // Keep the tap from also opening the keyboard: taking the suggestion needs no
  // focus, and a keyboard sliding up would shift the page under the next tap.
  if (typeof ev.preventDefault === "function") ev.preventDefault();
  return acceptSuggestion(field);
}

// Wire the delegated listeners. Installed once on `document` (not a single
// screen) because the admin's pop-ups and dialogs mount OUTSIDE #view. Returns a
// remover, so a test can take it back off again.
export function installSuggestionAccept(root = (typeof document !== "undefined" ? document : null)) {
  if (!root || typeof root.addEventListener !== "function") return () => {};
  const onKeydown = (ev) => {
    if (ev.key !== "ArrowRight" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const field = ev.target;
    if (!suggestionValue(field)) return;
    ev.preventDefault(); // the caret has nowhere to go anyway — take the value
    acceptSuggestion(field);
  };
  const onPointerdown = (ev) => { acceptIfArrowTapped(ev.target, ev); };
  // A second path for the tap: browsers without pointer events (older iOS) only
  // send this one, and where the first path already took the value this lands on
  // a filled field and does nothing.
  const onClick = (ev) => { acceptIfArrowTapped(ev.target, ev); };
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("pointerdown", onPointerdown);
  root.addEventListener("click", onClick);
  return () => {
    root.removeEventListener("keydown", onKeydown);
    root.removeEventListener("pointerdown", onPointerdown);
    root.removeEventListener("click", onClick);
  };
}
