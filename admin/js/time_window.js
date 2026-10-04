// time_window.js - the app's ONE time window: how it is read, packed, checked and said.
//
// MOVED HERE FROM courier_job.js (v304). A window was the courier's own until the Self collection
// Point needed one too - a place's collection hours - and a second way of spelling a window is a
// second way of getting one wrong: "2:00" meaning pm on one screen and am on another, or a
// window with a start and no end going out as a promise with a hole in it.
//
// It is a LEAF: nothing here imports anything, so both `courier_job.js` (which imports
// `points.js`) and `points.js` can read it without a cycle.

export // A time box, read once. The app's own pickup box already speaks "14:00", so a window
// does too, and the reading is shared by everything below rather than written four
// times — which is how "2:00" ends up meaning pm in one place and am in another.
const pad2 = (n) => String(n).padStart(2, "0");

export function clockOf(time) {
  const t = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!t) return null;
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (hh > 23 || mm > 59) return null;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return {
    am: hh < 12,
    mins: hh * 60 + mm,
    // Two spellings of the same time, and both are needed: `said` is what she reads
    // ("2-5 pm", with the ":00" dropped so it stays short) and `packed` is what is
    // STORED ("14:00"), zero-padded so the stored value is unambiguous and sorts.
    said: `${h12}${mm ? `:${pad2(mm)}` : ""}`,
    packed: `${pad2(hh)}:${pad2(mm)}`,
  };
}

// The two boxes packed into the one value the order carries: "14:00" + "17:00" ->
// "14:00-17:00". Empty when either half is not a time the app can read.
//
// ONE packed string rather than two keys or a `{from, to}` object, because a window
// with a start and no end is not half a promise, it is a promise with a hole in it —
// and a single value cannot half-exist. It is also what makes the window travel to her
// other phone for free: an order row syncs whole, and a string needs no explaining.
export function windowAt(from, to) {
  const a = clockOf(from);
  const b = clockOf(to);
  if (!a || !b) return "";
  return `${a.packed}-${b.packed}`;
}

// That value taken apart again, for the two boxes on the run screen when she comes back
// to a day she already set a window on. Null rather than a half-filled pair when it is
// not a window, so a box can never be seeded with a time that was never set.
export function windowParts(w) {
  const m = String(w || "").trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
  if (!m) return null;
  const a = clockOf(m[1]);
  const b = clockOf(m[2]);
  if (!a || !b) return null;
  return { from: a.packed, to: b.packed };
}

// Is this a window at all? Both ends readable, and the end after the start. An EMPTY
// window is not valid — it is the day's promise, which is what the shop already makes,
// and the caller says which of the two it is holding.
export function validWindow(w) {
  const parts = windowParts(w);
  if (!parts) return false;
  const a = clockOf(parts.from);
  const b = clockOf(parts.to);
  return !!a && !!b && b.mins > a.mins;
}

// What is wrong with the two boxes, in words, or "" when nothing is — including when
// both are empty, because "no window" is a legitimate answer and not a mistake. This is
// the form's question, so it asks about the two boxes rather than about the packed
// value they have not been packed into yet.
export function windowProblem(from, to) {
  const said = String(from || "").trim();
  const till = String(to || "").trim();
  if (!said && !till) return "";
  const a = clockOf(said);
  const b = clockOf(till);
  if (!a || !b) {
    return "A delivery window needs both ends — the earliest the van could arrive, and the latest.";
  }
  if (b.mins <= a.mins) {
    return "That window ends before it starts, so a customer would be told to expect the van before it left your place.";
  }
  return "";
}

// The window as she would say it: "2-5 pm". The repeated meridiem is dropped when both
// ends share it and kept when they do not ("11 am-2 pm"), because "11-2 pm" reads as
// eleven at night and a delivery promise is not a place to be terse.
export function fmtWindow(w) {
  const parts = windowParts(w);
  if (!parts) return "";
  const a = clockOf(parts.from);
  const b = clockOf(parts.to);
  if (!a || !b) return "";
  const end = b.am ? "am" : "pm";
  return a.am === b.am ? `${a.said}-${b.said} ${end}` : `${a.said} ${a.am ? "am" : "pm"}-${b.said} ${end}`;
}
