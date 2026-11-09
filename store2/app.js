// store2/app.js — the second shop's front door.
//
// ⭐ THE ENGINE IS NOT COPIED. `store/app.js` is the whole working shop — the calendar, the menu,
// the basket, the Supabase read, the track box and the WhatsApp hand-off — and every module it
// imports does so relative to ITS OWN folder, so importing it from here runs exactly the shop
// that /store/ runs, with the same fixes and the same order path. **One engine, two doors.**
//
// ⚠️ NOTHING ELSE GOES IN THIS FILE. A local change that lives here would be a second copy of
// the shop's behaviour, and the two copies would drift the first time either was touched.
// The only thing that is different on this page is `theme.css` — presentation, never behaviour.
//
// ⭐ The page it was loaded from is recorded by the engine itself (`visits.js` sends
// `location.pathname`), so visits to /store2/ are counted separately from /store/ without
// either page knowing this file exists.
import "../store/app.js";
