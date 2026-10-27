// store-lang.js — the store's (store/) customer-facing strings in English,
// 中文 and Bahasa Malaysia. English values copy the authored copy exactly so a
// visit in English is identical to today. Values may contain a %1 placeholder
// (e.g. the cut-off time) that the caller substitutes at render time.
//
// The order data the baker reads (product names, order lines, the WhatsApp
// message) deliberately stays in the products' English names — only what the
// customer sees on the page is localized.

const en = {
  titleWord: "Order",
  // ★★ IS THIS PAGE OLDER THAN THE SITE? (12 Oct 2026). The shop re-fetches its DATA every
  // 30 seconds but never its own code, so a phone holding an old copy shows fresh numbers on stale
  // behaviour — which is exactly how she spent an afternoon looking at a two-month-old shop. The app
  // has had an "Update now" strip since v255; the shop had nothing.
  // ⚠️ A CUSTOMER READS THIS, so it is calm and blames nobody: the page works, it is simply not the
  // newest one. And it must not promise a fix it cannot make — the second line is what to do when
  // reloading brings the old script straight back.
  buildStale: "A newer version of this page is ready.",
  buildStuck: "A newer version is ready. Close this page completely, then open it again.",
  buildReload: "Reload",
  homeLink: "🏠 Our homepage",
  referral: "🎁 You were referred — you have a welcome discount on your first order",
  deliveryDays: "Posting days",

  // ★★ THE SHOP'S OWN BUILD NOTICE (v492). It is the only line on this page about the PAGE
  // rather than about bread, and it is only ever read by a customer who left the shop open
  // across an update — so it is quiet, it is not an alarm, and it never blames them.
  // ⚠️ THE SECOND ONE EXISTS BECAUSE THE FIRST CANNOT ALWAYS WORK: pressing Reload asks the
  // browser for the page again, and a browser still holding the old script serves it straight
  // back. After one try this page stops offering a press that has already been shown not to
  // work and says what actually does.
  buildWarnTitle: "Your order is not saved yet.",
  buildWarnBody: "Reloading starts this page again — the posting day, the basket and anything you have typed will be gone. Press Reload again if you want to update now.",
  buildAnyway: "Reload anyway",

  // Promo codes (v269). The offer is composed in store/app.js out of the engine's
  // PARTS — kind and value — so a percentage, an amount and free delivery each
  // read naturally here rather than being an English sentence handed over whole.
  promoLabel: "Have a code?",
  promoPh: "e.g. FRESH10",
  promoApply: "Use it",
  promoRemove: "Remove the code",
  // ★★ SAID AGAIN AT THE BUTTON, NOT ONLY AT THE CODE BOX (v408). Her words: __"If there is promo
  // coupon attached, say it on top of Place Order, word like: Your promo coupon will be attached
  // together to the order for validation, actual payable will be confirm by Whatsapp."__
  //
  // ⭐ SHE IS RIGHT THAT THE PLACE MATTERS, and the page already half-said it: the line under the
  // code box reads __"We'll take it off when we confirm your order"__, which is true and **up the
  // page**. At the bottom, the customer is looking at ONE figure — the total on the bar — and that
  // figure is the GOODS, before the code (see renderBar). This is the moment they are about to
  // commit, and the moment the promise needs repeating.
  //
  // ⚠️ %1 IS THE CODE ITSELF, named back to them, because "your code" is abstract on a page they
  // may have been reading for ten minutes.
  // ⚠️ IT PROMISES NO FIGURE. The discount she can honour is hers to decide at the confirmation
  // (a code can be one-per-customer, or first-order only — see promoAcceptedUsed/First), so the
  // line says the amount is CONFIRMED, never that it is already correct.
  promoBar: "Code %1 goes with your order. We'll check it and confirm the final amount on WhatsApp.",
  // The standing line at the top of the shop. It NAMES the code, because typing
  // it is what puts it on the order — the shop never takes the money off itself.
  promoToday: "Today: %1 — use code %2",
  promoAccepted: "%1 — code %2 is on. We'll take it off when we confirm your order.",
  // The two the shop can only ever GUESS at, because a public page has no login
  // and knows nobody: "one per customer" and "first orders only" can only be
  // remembered by this phone, and a new phone or a cleared browser remembers
  // nothing. So the code still goes on the order and you settle it by
  // hand — these two say the code is on AND that we will confirm it, rather than
  // refusing a discount on a guess.
  promoAcceptedUsed: "%1 — code %2 is on. It's one per customer, so we'll confirm it when we take your order.",
  promoAcceptedFirst: "%1 — code %2 is on. It's for a first order, so we'll confirm it when we take your order.",
  promoUnknown: "We don't know that code — check the letters and try again.",
  // Every other reason a code can be turned down, each in its own words. %1 is a
  // date for the two that name one, and the amount still needed for the last.
  promoPaused: "That code is on hold — it isn't available at the moment.",
  promoEnded: "That code ended on %1 — it's no longer available.",
  promoNotYet: "That code hasn't started yet — it starts on %1.",
  promoClaimed: "That code has been fully claimed — all of it has been used.",
  promoClash: "That code can't be used with the welcome discount you already have — message us and we'll sort it out.",
  promoSmall: "Not quite enough yet — add %1 more to use it.",
  // Until each reason has its own wording, anything else the rules refuse says
  // this. Deliberately not "we don't know that code", which would be untrue.
  promoNo: "That code can't be used at the moment — message us and we'll sort it out.",
  promoFreeDelivery: "Free delivery",
  promoOffAmount: "%1 off",
  promoOffPercent: "%1% off",
  promoOffPercentCap: "%1, up to %2",
  promoOnMin: "%1 on %2 and above",
  // Appended only when the code has an end date, so the standing line says when
  // the offer runs out instead of the customer finding out at the box.
  promoUntil: "%1, until %2",
  orderBy: "Order by",
  beforeVal: "%1 the day before posting",
  madeToOrder: "Made to order · closes %1 the day before",

  // ★★ THE ANSWER, AND THE THREE STEPS (v405). ⚠️ ENGLISH ONLY SO FAR, AND THAT IS DELIBERATE: these
  // are behind the `?trial=1` flag while she judges the wording, and `pick()` falls back to English
  // rather than blanking, so a 中文 or BM visitor meets a real sentence rather than a hole. **They must
  // be translated before the flag comes off** — a Chinese customer reading English is a downgrade, and
  // the two below are the first thing anyone reads on the page.
  ansClosed: "Today's order window has closed",
  ansInTime: "You're in time",
  ansNext: "The next day you can order is %1.",
  ansBy: "Order before %2 on %1, and it's yours.",
  stepsLede: "You'll do the 4 steps, ordering 1, 2, 3, 4 — and then we take over.",
  // ★★ WHAT A BAKE DAY IS (v434). Her words: __"I think customer 1st confusion is that we never
  // explain what is a bake day to them. The very reason was we promote the idea of freshness, so if
  // user consume their bake from the bake day, that is the freshest they can get. They have to be
  // told that the day being bake day, the earliest they should expect collection will be late
  // afternoon or afternoon."__
  //
  // ⚠️⚠️ **IT IS USED FIVE TIMES ON THIS PAGE AND WAS EXPLAINED NONE.** Worse, the only hint about
  // WHEN the bread is ready sat inside the Self collect option — **so a courier customer never
  // learned it at all.** ⭐ Same fault v405 named: the page *stated the rules and never the answer.*
  //
  // ⚠️ IT SITS UNDER "1 Pick a bake day" — the customer is choosing a day, and that is the moment
  // he wonders what one is.
  //
  // ⭐ "the afternoon", NOT "late afternoon": the late afternoon is the COLLECTION WINDOW at a
  // Point, and the earliest the bread can be ready is earlier than that. Saying the window here
  // would promise less than the bakery can keep.
  bakeDayWhat: "A posting day is the day we make and post your treats. They are made that morning, so they are at their freshest — and the earliest they can be ready for you is the afternoon, not the morning.",

  sPickDay: "Pick a posting day",
  sWhat: "What would you like?",
  sYourDetails: "Your details",
  yourName: "Your name",
  namePh: "e.g. Aisyah",
  whatsappNo: "WhatsApp number",
  whatsPh: "e.g. 012-345 6789",
  waSub: "We use this to confirm your order and send your payment QR — we'll never spam you.",

  // The small privacy notice under the customer's details (v348). The PDPA wants a
  // customer to be able to make a choice BEFORE sending their details, so the notice
  // sits at the point of collection and not only in a policy page. ⚠️ THE CONTACT
  // NUMBER IS NOT HERE — store/app.js fills it in from the bakery's own setting, so
  // this sentence must end where the number begins.
  // v350 — the notice moved to the ORDER BAR: one line under Place order, and this
  // panel behind it. ⚠️ TWO OF THE FOUR FACTS WERE REWRITTEN AT v353: "we COLLECT your
  // name..." became "we USE your name... only to...", because "collect" reads to an Asian
  // ear as "we take it and keep it" (her words: "we are sensitive to when you said you
  // collect, that mean you keep it"). And "Nobody else sees your details" was simply NOT
  // TRUE - the driver gets the name, number and address, and the alert that pings her
  // phone carries them too. Both now name the CLASS of people who handle an order, which
  // is what s.7 asks for, with no company name in it.
  // privacyLead is GONE: the Act no
  // longer opens the notice (the Commissioner's own template does not open with the
  // law, and neither do the large platforms) — it closes it instead, on privacyDate.
  privacyLine: "By ordering you agree to our",
  privacyLink: "privacy notice.",
  factsLink: "Good to know",
  factsHead: "Before you order",
  // ★★★ THESE THREE WERE THE BAKERY'S OWN LINES, WORD FOR WORD (found 27 Oct 2026). ⚠️ They told a TREATS
  // shop's customer that "the bread is made the morning of its day" and that it comes "by Lalamove, Penang
  // Island only" — on a shop that posts nationwide. ⭐ Her shop's facts are only ever the ones she really
  // sells; the moment these stop being true, they change here or she writes her own in Settings.
  factBake: "Your treats are made on the day they are posted, so they reach you as fresh as they can be.",
  factCutoff: "Orders close the evening before your posting day — the exact time is always in the card above the calendar.",
  factGet: "We post nationwide, or you can collect locally. Postage is a flat fee per order, added when we confirm your order on WhatsApp — the total on this page is for the treats.",
  factPay: "Your order is confirmed when the payment reaches us — we send the payment QR on WhatsApp.",
  allergenLabel: "What is in it",
  keepingLabel: "Keeping it",
  againTitle: "Your last order",
  waitTitle: "Tell you if it frees up?",
  waitName: "Your name (optional)",
  waitPhone: "WhatsApp number",
  waitAsk: "Tell me when it frees",
  waitDone: "You're on the list — we'll message you if that day frees up.",
  waitAlready: "You're already on the list for that day.",
  waitBad: "That doesn't look like a WhatsApp number.",
  waitFail: "Couldn't add you just now — try again in a moment, or message us.",
  againWhen: "on %1",
  againAdd: "Add these again",
  againForget: "Forget",
  againSaved: "Saved on this phone only.",
  againGone: "%1 is not on the menu today.",
  againFull: "%1 is full today.",
  againAdded: "Added %1 from your last order.",
  factChange: "To move or cancel an order, message us on WhatsApp as early as you can and we will tell you honestly what can be done.",
  factAsk: "Ask us anything — WhatsApp",
  privacyHead: "How we use your details",
  privacyWhat: "We use your data only to make your order, get it to you, and talk to you about it. To post it we also need your address and the pin on your door.",
  // ⚠️ 'THE DRIVER' IS THE BAKERY'S WORD (v348). This shop POSTS — its own fulfilment
  // option is 'Post (nationwide)' — so the party who receives a customer's name and
  // address is the postal service. Left as the bakery had it, the notice would describe
  // a van nobody drives for this business.
  privacyWho: "To post your order to you, the postal service is given your name, number and address. Your confirmation reaches you on WhatsApp, and an alert carrying your order pings our phone. Nobody else sees your details, and we never sell them.",
  privacyKeep: "Your details stay with your order in our order book, on a secure cloud service and on our own phones behind a PIN. We keep the sales record for seven years, as the tax office asks — but your name, number and address are not part of that record, so ask us any time and we will delete them.",
  privacyContact: "Ask us any time to see, correct or delete what we hold — WhatsApp",
  privacyDate: "Under Malaysia's Personal Data Protection Act 2010 (Act 709). Last reviewed: 7 October 2026.",
  howGet: "How will you get your order?",
  // ★★ THE PROMPT UNDER THE QUESTION, AND THE STOP IF HE NEVER ANSWERS (v416). Her words:
  // __"you need a 'click to choose' after the title, and self collect should not be default"__.
  fulfilPick: "Tap to choose one.",
  fulfilAskTitle: "Please say how you will get your order.",
  fulfilAskBody: "Tap Collect (local) or Post (nationwide) above — that is how we know whether to have it ready for you or post it to your door.",
  // ★★ THE QUESTION BEFORE A CUSTOMER CHANGES HOW HE GETS HIS ORDER (v436). Her words: __"a
  // confirmation pop up, asking whether customer intend to change to delivery? the point selection
  // will be cleared, vise versa"__ — ⭐ the same rule she gave me for bake days at v404: **taking
  // something away always asks first.**
  //
  // ⚠️⚠️ THE BODY NAMES WHAT IS LOST, and that is the whole point rather than good manners: a
  // customer who switched to delivery was left looking at a collection point still selected, with
  // nothing saying whether it still applied to his order — the fault v416 named, of a page that has
  // answered its own question. ⭐ A change that names what it takes away is the same shape as a
  // refund that names the money it leaves.
  //
  // ⭐ AND IT IS ASKED ONLY WHEN SOMETHING WOULD ACTUALLY BE CLEARED — a question guarding nothing
  // is noise on a page that already carries four notices a customer must read.
  //
  // ⚠️ `%1` is the point he picked, and it is only ever filled for the delivery question. The
  // collecting question names no place, because there is nothing to name: he typed an address, and
  // the menu of points is the thing he is going back to.
  askToDeliveryTitle: "Change to post?",
  askToDeliveryBody: "You chose to collect from %1. Changing to post clears that, and we post your order to your address instead.",
  askToDeliveryYes: "Yes, change",
  askToDeliveryNo: "Keep Collect (local)",
  askToCollectTitle: "Change to Collect (local)?",
  askToCollectBody: "You gave us a postal address. Changing to Collect (local) clears it, and you collect from one of our collection points instead.",
  askToCollectYes: "Yes, change",
  askToCollectNo: "Keep post",
  selfCollect: "Collect (local)",
  // ★★ EACH WAY SAYS WHAT IT IS (v407). Her customer chose a courier when he wanted to
  // collect: the page named both ways and explained neither. ⚠️ BOTH LINES ARE TRUE BEFORE
  // ANYTHING IS TAPPED, so he can compare without tapping.
  // ⚠️ The courier line promises NO amount, because the shop has none — she quotes carriage
  // by hand. What it can say honestly is that the total on this page is the bread's, which is
  // the thing a customer would otherwise assume wrongly.
  // ⚠️ AND IT SAYS WHEN, IN HER OWN TERMS (v407). Her words: __"order can be collected late on the
  // bake day, a message will be send to you when your order is ready if you chose self collect"__.
  // ⭐ A customer collecting had two questions, not one: what does it cost (nothing), and WHEN do
  // I come. ⚠️ The answer is deliberately the MESSAGE rather than a clock — a pickup time is not a
  // promise (v340), and the bread is only ready when it is ready.
  // ⚠️ AND IT STILL NAMES THE PLACE, which is not decoration: **a customer collecting may have NO
  // Point chosen at all** — the collect-from list is empty and hidden while she has none published,
  // and `#point-field` is not shown. So this line is the only place the shop can say where to come,
  // and it says it the only way that is always true: she messages it.
  // ⚠️ HER WORDS, TIDIED (v417). __"You come to us - no delivery charges. We message you the exact
  // collection point, and time window for collection., it is normally late afternoon on the bake day."__
  // ⭐ "NORMALLY" IS DOING REAL WORK IN THAT LAST SENTENCE and must stay: **a pickup time is not a
  // promise** (v340), and the time window the page names is hers to set per Point, so the app
  // describes the usual shape of a bake day rather than committing to a clock.
  selfCollectSub: "You come to us — nothing to pay for postage. We message you the exact collection point and the time window for collection. It is normally late afternoon on the posting day.",
  courier: "Post (nationwide)",
  courierSub: "We post it to you, nationwide. Your postage is told to you on WhatsApp — the total shown is for the treats only, and we add the postage when we confirm.",
  // v299 — where a Self collect order is collected FROM. Written once for the kitchen and
  // once for a Point; the Point's own NAME is her data and is never translated.
  ourKitchen: "Our kitchen",
  kitchenSub: "Where your treats are made — we'll message you the exact spot and time",
  pointSub: "Collection Point — we'll message you the exact spot and time once your order is confirmed",
  pointMin: "Needs a basket of RM%1 or more — yours is RM%2 so far",
  // ★★ THE INSTRUCTION OVER THE PLACES (v415). Her words: __"the self collect have to have message
  // follow, click to choose point, without click it should not highlight"__. ⚠️ Nothing is
  // highlighted until the customer TAPS a place, so without this line the card would open on a
  // list of names with no sign that any of them is a thing to press.
  pointPick: "Tap to choose which collection point you want to collect your orders from.",
  addressLabel: "Postal address",
  addressPh: "Full address — street, area, town & postcode",
  addressSub: "We post nationwide — your treats are made on the day you pick and posted to this address.",
  // The door pin (v197). Optional in every sense: with no pin the order goes
  // exactly as it always has, and the baker pins the door herself.
  pinHintShort: "Door hard to find?",
  pinHint: "Skip this and the driver goes to the address you typed — that is fine for most houses. Pin it only if the address alone will not find your door: a condo block, a guard house. Either way, put the block and unit number in the address above.",
  pinOnMap: "Pin on the map",
  pinSet: "Pin set — the courier will drive to the spot you marked.",
  pinLoading: "Loading the map…",
  pinTapFirst: "Tap the map once to drop the pin — then drag it to the exact door.",
  pinKeep: "Keep this spot",
  pinCancel: "Cancel",
  pinMapFailed: "The map didn't load. Type your address above and we'll find you.",
  // The address box was edited after a suggestion was taken, so the pin that answered
  // the old wording is gone (store/app.js, dropListPin). It has to say so: a pin that
  // quietly disappears is the dead control this shop has a standing rule against, and
  // the sentence names both ways to put one back.
  pinAddrChanged: "You changed the address, so the pin you picked no longer goes with it. Tap a suggestion above, or set the pin again.",
  // A row from the PREVIOUS wording was tapped, in the moment between the typist and the
  // new list arriving (store/app.js, takeHit). A different sentence from the one above
  // because it is a different fact: there may have been no pin at all, and what is wrong
  // here is the row rather than the pin.
  addrStale: "That suggestion was for the address you had before. Pick one for the new address, or set the pin again.",
  // Looking the typed address up (v202). The two failures are worded to send the
  // customer to the map, because the map is the one thing that still works when the
  // lookup does not — and neither of them is ever a reason an order cannot be placed.
  addrLooking: "Looking up your address…",
  addrPick: "Tap the one that matches your address.",
  addrNone: "We couldn't find that address. Tap the map and put the pin on your door instead.",
  addrFailed: "The address lookup isn't available right now. Tap the map and put the pin on your door instead.",
  // ★ IT IS A NOTE FOR EITHER WAY (v408). Her words: __"change the Delivery Notes(optional) to
  // Notes for Collection/Delivery"__. ⚠️ Same fault as the bake day and the two bare words: the
  // label named ONE of the two things the field is for, so a customer collecting his own bread
  // read "Delivery note" and skipped a box that asks him for the thing that actually gets him
  // his bread — the gate code, the landmark. ⚠️ The PLACEHOLDER moved with it for the same
  // reason: "delivery time" is wrong for the person who is coming to fetch it.
  noteLabel: "Notes for Collection/Delivery (optional)",
  notePh: "e.g. collect 6pm / prefer deliver 6 to 8pm",
  // The note a customer can add to ONE item (v236). The link is what they tap
  // to open the box; the placeholder is the example that shows them what kind
  // of thing belongs in it.
  addNoteLink: "＋ Add a note",
  lineNotePh: "e.g. no nuts, write “Happy Birthday”",
  sTrack: "Track your order",
  trackHint: "Placed an order? Enter the order number from your confirmation (it starts with <strong>#</strong>, e.g. #A3F9C2) and the phone number you ordered with.",
  trackPh: "e.g. A3F9C2",
  trackNoLabel: "Order number",
  trackPhonePh: "phone you ordered with",
  trackPhoneLabel: "Phone you ordered with",
  trackNeedPhone: "Enter the phone number this order was placed with, and we will find it.",
  trackBtn: "Track",
  sPolicies: "Policies",

  items: "%1 items",
  oneItem: "1 item",
  placeOrder: "Place order",
  sending: "Sending…",
  soldOut: "Sold out",
  qtyLess: "One less",
  qtyMore: "One more",
  onlyLeft: "Only %1 left",
  qtyAria: "How many",
  langAria: "Language",
  journeyAria: "Order status journey",
  noDates: "No upcoming posting days right now — check back soon.",
  noOpenDates: "All upcoming posting days are full right now — check back soon.",
  calChosen: "Your posting day: %1",
  // ★★ SAID OUT LOUD WHEN THE DAY WAS CHOSEN FOR HIM (v434). Her words: __"say, moonday was
  // selectted for you, just click on the prefered date if you have one"__ — ⚠️ **and it is the
  // better answer than simply not lighting the step:** the page picked his day for him so an order
  // is never blocked by forgetting to tap, and a page that does something on his behalf must SAY
  // so. It is the same rule this shop has followed since v405 — it ANSWERS the question rather
  // than stating the rules.
  calChosenFor: "%1 is suggested for you. Tap it to confirm your posting day.",
  calMiss: "%1 is not a posting day — please pick a green day.",
  calClose: "Orders for %1 have closed — please pick a green day.",
  calPrev: "Earlier weeks",
  calNext: "Later weeks",
  // ★★ WHAT THE GREEN CIRCLE MEANS, SAID UNDER THE GRID (v512). Her words: __"simple note that date in
  // green circle are bake dates"__.
  // ⚠️ THE SYMBOL WAS NEVER EXPLAINED ANYWHERE. A first-time customer met a month of dates where some
  // wear a green ring and some do not, and the only thing that said what the ring meant was the day she
  // finally tapped, in the line underneath. ⭐ **A symbol a stranger has to tap to decode is a symbol
  // that has not been explained** — and this is the one fact the whole grid turns on.
  // ⚠️ IT NAMES THE COLOUR AND THE SHAPE, because both are what he is looking at: "in a green circle".
  // The ring is drawn beside it (`.cal-key-dot`), so the words and the thing cannot drift apart.
  calKey: "Days in a green circle are posting days.",
  // ★★ A FULL DAY SAYS SO, AND ANSWERS "WHEN CAN I?" (v631_2).
  calFull: "FULL",
  fullDaySay: "%1 is full.",
  fullDayNext: "The next day you can have treats is %1.",
  fullDayChoose: "Choose %1",
  fullDayNone: "There is no open day to show yet.",

  // Why a product reads "Sold out" on a date it can't be ordered for, and the
  // notes above the menu when a refresh changes the basket. The rule comes from
  // pool.js as data, so the sentence is built here in the visitor's language —
  // including the date, which must not arrive as an English weekday. The advice
  // is separate from the clause because the basket notes quote the clause alone.
  closedFrom: "Only available for posting from %1",
  closedTo: "Only available for posting up to %1",
  closedClose: "Orders close %1 days before the posting day",
  closedCloseAdvice: " — pick a later date",
  // The owner's marked sell days, when the chosen posting day is not one of
  // them. %1 is a weekday list the page joins in this language ("Mon, Wed and
  // Fri"), so the names are built by the page, not here.
  closedWeekday: "Only available on %1",
  closedUnmarked: "Not sold on this day",
  // A product you keep on the shop when it cannot be ordered (the switch in its
  // Availability card): the stamp it wears on a day that is not one of its sell
  // days, and the line naming the next date it CAN be ordered — with how many are
  // left that day, when a daily limit publishes a count. %1 is the date (fmtDay),
  // %2 the count.
  unavailable: "Unavailable",
  nextAvailable: "Next available: %1",
  nextAvailableLeft: "Next available: %1 · %2 left",
  sentenceEnd: ".",
  // Shown where the menu would be when every product is marked off today's
  // delivery date — an empty space reads like a broken page.
  noMenuToday: "Nothing is on the menu for this day. Please pick another posting day.",
  noMenu: "The menu is empty right now — please check back soon.",
  // The last heading on the menu, over the products the baker has not filed
  // under any category. Nothing is ever hidden for want of filing, so the
  // heading is plainly a place rather than a warning.
  moreItems: "More items",
  fixSoldOut: "%1 just sold out — removed from your order.",
  // ⚠️ A PRODUCT THAT LEFT THE MENU (v548) — see `reconcileCart`.
  fixGone: "%1 is no longer on the menu — removed from your order.",
  fixPoolClamp: "%1: only %2 can fit with the rest of your order now — we changed your %3 to %2.",
  fixClamp: "%1: only %2 left now — we changed your %3 to %2.",
  fixClosed: "%1: %2 — we removed it.",

  // How long a customer may still change or cancel this product's order (the
  // owner's stated window — shown, never enforced) and the same window on the
  // order receipt, where it carries the no-refund rule. One day needs its own
  // key so English never reads "1 days".
  cancelNote: "Change or cancel up to %1 days before the posting day.",
  cancelNoteOne: "Change or cancel up to 1 day before the posting day.",
  orderCancelNote: "Change or cancel up to %1 days before the posting day. Payments are not refundable — your order can be moved to another day.",
  orderCancelNoteOne: "Change or cancel up to 1 day before the posting day. Payments are not refundable — your order can be moved to another day.",

  confirmAddWaTitle: "Please add your WhatsApp number.",
  confirmAddWaBody: "We use it to confirm your order and send your payment QR.",
  confirmAddWaShape: "That does not look like a complete phone number — please check it, and add the country code if you are outside Malaysia.",
  // ⚠️ A RIDER NEEDS A DOOR (v548) — see the gate in store/app.js.
  // ★★ THE FIRST THING STILL OUTSTANDING, IN HIS OWN ORDER (v452). Her words: __"if the previous step not
  // completed user should be inform accordingly"__ ⚠️ **A dead button says nothing at all on a phone** — it
  // does not even acknowledge the tap — so the button stays live and ANSWERS instead.
  needItemTitle: "Nothing in your order yet.",
  needItemBody: "Pick something from the menu above first — then you can place your order.",
  // ★★ STEP 1 FIRST (v453). Her words: __"complet step1 before step2 is allow, and so forth"__ — and
  // __"dont allow and a message inform about why"__.
  needDayTitle: "Choose your posting day first.",
  // ⚠️ v459: it said "then the menu opens" — AND THE MENU IS ALREADY OPEN. The cards are on screen; it
  // is ORDERING that is held back. A message that describes the screen wrongly is worse than a vague one,
  // because the customer looks for a menu that is already in front of him.
  needDayBody: "Step 1, at the top. Pick the day you want your treats made — then you can add them.",
  confirmAddNameTitle: "Please add your name.",
  confirmAddNameBody: "It is how we know who the order is for when we confirm it with you.",
  confirmAddrTitle: "Please add your postal address.",
  confirmAddrBody: "We post nationwide — your treats can't be sent without your full address (street, area, town & postcode).",
  confirmClosedTitle: "That day's orders are closed.",
  confirmClosedBody: "Orders for this day close at %1 the day before — please pick a new posting day.",
  confirmChangedTitle: "Your order changed just now.",
  confirmChangedBody: "Something sold out while you were ordering — we've fixed your cart to match what's left.",
  confirmChangedSub: "Please review your order and tap Place order again.",
  sendingToBakery: "Sending your order…",
  orderRecvTitle: "🎉 Order received!",
  orderRecvBody: "%1 has your order.",
  orderRecvThanksBody: "Thanks %1! %2 has your order.",
  orderRecvLine: "📅 %1 · %2 · RM%3",
  orderRecvSub: "Your order is in — we'll WhatsApp you once we confirm it.",
  failTitle: "We couldn't send your order just now.",
  failBody: "Don't worry — send your order on WhatsApp so it isn't lost.",
  failOpened: "WhatsApp has opened with your order — press Send so it isn't lost.",
  failLink: "📲 Send your order via WhatsApp",
  failRetry: "Please try again in a moment.",

  trackEnter: "Enter your order number to track it.",
  trackUnavailable: "Tracking isn't available right now.",
  trackLooking: "Looking up your order…",
  // ⚠️⚠️ THE SENTENCE NAMED ONLY THE CODE (v569). Since v558 the lookup needs the order number AND the phone
  // it was placed with, so a customer with the right code and a mistyped number was told to re-check the one
  // thing that was already right — and could loop for ever. ⭐ Both are named now.
  trackNotFound: "We couldn't find order #%1 with that phone number. Check both: the order number is the 6 characters after the # in your confirmation message, and the phone number is the WhatsApp number you ordered with.",
  orderCode: "Order #%1",
  forCustomer: "For %1",
  trkNew: "New",
  trkConfirmed: "Confirmed",
  trkPaid: "Paid",
  trkBaking: "Preparing",
  trkReady: "Packed",
  trkFinal: "Collected / Posted",
  trkItems: "Items: %1",
  itemsTotal: "Items total: %1",
  trkTotal: "Total: %1",
  trackingNo: "Tracking number: %1",
  // The same slot when a booked courier trip handed back a share link rather than a
  // number. The value is the link itself and is rendered tappable, so there is no %1.
  trackDelivery: "Track your order:",
  // The charge a courier made for this order, when one was recorded — drawn instead of
  // the flat postage, never beside it (v124, 20 Sep 2026). The card names no subtotal:
  // the shop's flat nationwide postage is never published, so a subtotal worked out
  // from the published total would be too high. The same line, in the same place, is in
  // the customer's WhatsApp message — see moneyLines in admin/js/courier.js, which owns
  // the English wording there.
  // ⚠️ THIS SHOP POSTS. The engine's word is "Courier charge" (a van); munchies' is its own, and it
  // matches the default in `admin/js/courier.js`. ⚠️ If she renames the charge in Settings, HER messages and
  // receipts follow that setting but these two shop strings do NOT — edit them here as well.
  courierCharge: "Postage: %1",
  // The same charge when the courier collects it at the door: COD is the word
  // Malaysians know for a parcel the receiver pays for, so it is kept, with what to
  // do about it spelled out beside it (19 Sep 2026).
  courierCod: "Postage: %1 - COD, pay the courier on delivery",
  // When the delivery cost is not settled at all: the shop quotes each posted order by
  // courier, and this order has no charge recorded on it yet (28 Sep 2026). Carries no
  // figure, so it is not a %1 string — and it is word for word what the customer's
  // WhatsApp confirmation says at the same moment, because the two are read side by
  // side and one of them understating the cost would be worse than neither saying it.
  postageQuoted: "Postage: quoted separately - we'll message you the exact amount",
  // The promo code on the order and what it took off, %1 the code and %2 the ringgit —
  // the same line the customer's WhatsApp message carries, so the two can be read side
  // by side without disagreeing (v272).
  promoLine: "Promo %1: -%2",
  // The bring-a-friend first-order discount, which carries NO code — so the same money
  // line needs its own words. Matched to the WhatsApp confirmation, which names it the
  // same way (v323).
  promoFriend: "Bring-a-friend you were sent: -%1",
  // ⚠️ THE OTHER HALF OF THE SAME LINE (v571): a referrer spending what they EARNED was told it was a
  // coupon somebody sent them.
  promoReward: "Bring-a-friend reward: -%1",
  // The booked trip, as the courier's own reply last said. %1 is one of a handful of
  // NEUTRAL phase words below rather than the courier's own vocabulary — the backoffice
  // publishes the phase, this page owns the words, so no company's status list is
  // written into this file (v190). A phase this page has not been taught draws nothing.
  tripStatus: "Delivery: %1",
  tripFinding: "Finding a driver",
  tripOnTheWay: "The driver is on the way",
  tripCollected: "Collected",
  tripDelivered: "Delivered",
  tripStopped: "Called off",
  tripNoDriver: "No driver took it",
  // Who is bringing it, once the courier has matched one — which it does only shortly
  // before the pickup, so this line is absent for most of the wait. The plate is shown
  // with the name when there is one, and on its own when there is not.
  driverLine: "Driver: %1",
  vehicleLine: "Vehicle: %1",
  callDriver: "Call the driver",
  // A PARCEL she posted herself (v226): a carrier has a name and no driver, so this
  // is drawn where the driver line would be, and never beside one.
  carrierLine: "Carrier: %1",
  nextBlockedBasket: "Your basket is for %1. To order for another day, choose it on the calendar above.",

  devBy: "Website by",
  devWa: "WhatsApp the developer",

  // The question printed IN the box, which the customer types over. Its length is
  // MEASURED, not written (see promptHeight in store/app.js): a phone offers ~323px at
  // 13px and "the User Interface" costs about 150px of it, so this string wraps to a
  // second line on a 375px phone and the box opens to show the whole question rather
  // than clipping its tail. Raise it and re-measure.
  fbPh: "Webmaster: Like the User Interface? Tell me & I will improve it!",
  fbHint: "Press Enter to send",
  fbSending: "Sending…",
  fbThanks: "Your idea is well taken care of. New updates soon!",
  fbFailed: "Couldn't send just now — please try again, or WhatsApp the developer.",
  fbEmpty: "Please write your idea first.",
};

const zh = {
  titleWord: "订购",
  buildStale: "这个页面有新版本了。",
  buildStuck: "有新版本了。请把这个页面完全关掉，再重新打开。",
  buildReload: "重新载入",
  homeLink: "🏠 我们的主页",
  referral: "🎁 朋友介绍的 — 首次下单有优惠！",
  deliveryDays: "发货日",

  // ★★ 商店的版本提示（v492）。这是整页唯一一句关于"页面本身"而不是面包的话，只有把商店
  // 一直开着、期间我们更新了的人才会看到。所以它安静、不吓人，也绝不怪他。
  // ⚠️ 第二句存在，是因为第一句不一定管用：按"重新载入"是请浏览器再抓一次这个页面，而浏览器
  // 如果还留着旧的程序，就会原封不动地送回来。试过一次之后，这一页就不再提供那个已经证明没用的
  // 按钮，而是直接说真正有效的办法。
  buildWarnTitle: "你的订单还没有保存。",
  buildWarnBody: "重新载入会让这一页从头开始 — 发货日、购物车和已经填写的内容都会消失。如果想现在更新，请再按一次载入。",
  buildAnyway: "仍然载入",

  promoLabel: "有优惠码吗？",
  promoPh: "例如 FRESH10",
  promoApply: "使用",
  promoRemove: "移除优惠码",
  // ⚠️⚠️ IT READ "优惠码 %1 会一起送到" UNTIL v421 — *"Code %1 will be delivered together"* — and
  // **A CODE IS NOT DELIVERED ANYWHERE.** ⭐ Found by reading every string I had written in 中文 and
  // BM rather than trusting them: the English says the code GOES WITH the order, and 「送到」 says it
  // is SHIPPED, which is a different fact and a confusing one on an order page. 「附在订单上」 is
  // *attached to the order*, which is what the English means.
  // ⚠️ The `%1` and the WhatsApp sentence are untouched — only the verb was wrong.
  promoBar: "优惠码 %1 会附在你的订单上。我们会核对，并在 WhatsApp 上确认最终金额。",
  promoToday: "今日优惠：%1 — 输入优惠码 %2",
  promoAccepted: "%1 — 已套用优惠码 %2，我们确认订单时会为你扣减。",
  promoAcceptedUsed: "%1 — 已套用优惠码 %2。此码每人限用一次，我们确认订单时会为你核实。",
  promoAcceptedFirst: "%1 — 已套用优惠码 %2。此码只限首次下单，我们确认订单时会为你核实。",
  promoUnknown: "我们找不到这个优惠码 — 请检查字母后再试一次。",
  promoPaused: "此优惠码已暂停 — 暂时无法使用。",
  promoEnded: "此优惠码已于 %1 结束 — 不再有效。",
  promoNotYet: "此优惠码还没开始 — 将于 %1 生效。",
  promoClaimed: "此优惠码已全数用完 — 名额已被领完。",
  promoClash: "此优惠码不能与你已享有的迎新优惠同时使用 — 请联络我们，我们帮你处理。",
  promoSmall: "还差一点 — 再加 %1 即可使用。",
  promoNo: "这个优惠码暂时无法使用 — 请联络我们，我们帮你处理。",
  promoFreeDelivery: "免运费",
  promoOffAmount: "减 %1",
  promoOffPercent: "减 %1%",
  promoOffPercentCap: "%1，最多 %2",
  promoOnMin: "满 %2 可享 %1",
  promoUntil: "%1，%2 截止",
  orderBy: "下单截止",
  beforeVal: "发货日前一天%1前",
  // ⚠️⚠️ MY OWN TRANSLATION, NOT A NATIVE ONE — the first thing anyone reads on the page, so it wants
  // a Chinese-speaking pair of eyes before the trial flag comes off. (Her internal circle testing the
  // trial link is exactly who should check it.)
  ansClosed: "今天的发货已经截单",
  ansInTime: "还来得及",
  ansNext: "下一次可以下单的日子是 %1。",
  ansBy: "在 %1 %2 之前下单，就是你的了。",
  stepsLede: "你会做 4 个步骤，按 1、2、3、4 的顺序 — 剩下的交给我们。",
  bakeDayWhat: "发货日就是我们把你的零食做好并寄出的那一天。当天早上做好，当天最新鲜 — 最快也要下午才能准备好，不是早上。",
  madeToOrder: "按订单制作 · 发货日前一天%1截单",
  sPickDay: "选择发货日",
  sWhat: "您想要什么？",
  sYourDetails: "您的资料",
  yourName: "您的名字",
  namePh: "例如：Aisyah",
  whatsappNo: "WhatsApp 号码",
  whatsPh: "例如：012-345 6789",
  waSub: "我们会用这个号码确认订单和发送付款二维码，不会拿来 spam 您。",

  privacyLine: "下单即表示你同意我们的",
  privacyLink: "个人资料声明。",
  factsLink: "下单前须知",
  factsHead: "下单之前",
  factBake: "你的零食在寄出当天制作，所以到手时最新鲜。",
  factCutoff: "订单在寄出日前一晚截止 — 确切时间请看日历上方的那张卡片。",
  factGet: "全国邮寄，也可以到本地自取。邮费每单固定，会在 WhatsApp 确认订单时加上 —— 本页的总额只是零食的价格。",
  factPay: "款项到账后订单才会确认 — 我们会通过 WhatsApp 发送付款二维码。",
  allergenLabel: "成分",
  keepingLabel: "保存",
  againTitle: "你上一次的订单",
  waitTitle: "空出来时通知你？",
  waitName: "你的名字（可不填）",
  waitPhone: "WhatsApp 号码",
  waitAsk: "空出来请通知我",
  waitDone: "已记录 — 那天若空出来，我们会通知你。",
  waitAlready: "那天你已经在名单上了。",
  waitBad: "这看起来不是 WhatsApp 号码。",
  waitFail: "暂时无法记录 — 请稍后再试，或直接联系我们。",
  againWhen: "%1",
  againAdd: "再来一次",
  againForget: "删除记录",
  againSaved: "只保存在这台手机上。",
  againGone: "%1 今天不在菜单上。",
  againFull: "%1 今天已满。",
  againAdded: "已加入你上次订单中的 %1。",
  factChange: "如需更改或取消订单，请尽早在 WhatsApp 告诉我们，我们会如实告知可以怎样处理。",
  factAsk: "有任何问题都可以问我们 — WhatsApp",
  privacyHead: "我们如何使用你的资料",
  privacyWhat: "你的资料，我们只用来制作你的订单、把它送到你手上，以及就订单与你联络。如果选择邮寄，我们也需要你的地址和门口定位。",
  privacyWho: "为了把订单寄到你手上，邮递员会收到你的姓名、号码和地址。确认讯息通过 WhatsApp 发给你，订单通知则会传到我们的手机。除此之外没有人会看到你的资料，我们也绝不会出售。",
  privacyKeep: "你的资料会随订单保存在我们的订单记录里，存放在安全的云端服务，以及我们自己的手机中（有密码保护）。销售记录我们依税务局的要求保存七年；你的姓名、号码和地址并不属于这份记录，随时可以要求我们删除。",
  privacyContact: "随时可以要求查阅、更正或删除我们持有的资料 —— WhatsApp",
  privacyDate: "依据《2010 年个人资料保护法令》（Act 709）。最后更新：2026 年 10 月 7 日。",
  howGet: "您希望怎样收货？",
  fulfilPick: "请点选一个。",
  fulfilAskTitle: "请选择取货方式。",
  fulfilAskBody: "请在上面点选「自取（本地）」或「邮寄（全马）」— 我们才知道要为你准备好，还是邮寄到你家。",
  askToDeliveryTitle: "改为邮寄？",
  askToDeliveryBody: "你选了在 %1 自取。改为邮寄会取消这个选择，我们改为寄到你的地址。",
  askToDeliveryYes: "好的，改吧",
  askToDeliveryNo: "保留自取",
  askToCollectTitle: "改为自取？",
  askToCollectBody: "你已填写邮寄地址。改为自取会取消它，你改为到我们的自取点取货。",
  askToCollectYes: "好的，改吧",
  askToCollectNo: "保留邮寄",
  selfCollectSub: "你自己来拿 — 不收邮费。我们会通知你确切的取货点和取货时段，通常是发货日的傍晚。",
  courier: "邮寄（全马）",
  courierSub: "我们邮寄给你，全马送达。邮费会在 WhatsApp 上告诉你 — 页面上显示的总额只是零食的钱，确认时才加上邮费。",
  ourKitchen: "我们的厨房",
  kitchenSub: "制作零食的地方 — 我们会通知你确切地点和时间",
  pointSub: "自取点 — 订单确认后，我们会通知你确切地点和时间",
  pointMin: "需消费 RM%1 或以上 — 你目前 RM%2",
  pointPick: "请点选你要取货的自取点。",
  addressLabel: "邮寄地址",
  addressPh: "完整地址 — 街道、地区、市镇与邮编",
  pinHintShort: "找不到门？",
  selfCollect: "自取（本地）",
  addressSub: "我们提供全马邮寄——您的零食会在所选发货日制作，并寄往这个地址。",
  pinHint: "不标记也可以 — 司机会去上面填写的地址，大多数房子这样就可以了。只有当地址本身找不到你家门时才需要标记：公寓楼、保安亭。无论是否标记，都请把座号和门牌号码写在上面。",
  pinOnMap: "在地图上标记",
  pinSet: "已标记位置 — 司机会前往你标记的地点。",
  pinLoading: "地图载入中…",
  pinTapFirst: "在地图上点一下放置标记 — 然后把它拖到准确的位置。",
  pinKeep: "确定这个位置",
  pinCancel: "取消",
  pinMapFailed: "地图无法载入。请在上面填写地址，我们会找到你。",
  pinAddrChanged: "你更改了地址，所以之前选的标记已经不对应了。请点选上面的建议地址，或重新标记位置。",
  addrStale: "这个建议对应的是你之前的地址。请点选新地址的建议，或重新标记位置。",
  addrLooking: "正在查询你的地址…",
  addrPick: "点选最接近你地址的一项。",
  addrNone: "找不到这个地址。请直接在地图上把标记放到你家门口。",
  addrFailed: "地址查询暂时无法使用。请直接在地图上把标记放到你家门口。",
  noteLabel: "取货／送货备注（可选）",
  notePh: "例如：6pm 来取 / 希望 6 到 8pm 送到",
  addNoteLink: "＋ 添加备注",
  lineNotePh: "例如：不要坚果、写上「生日快乐」",
  sTrack: "查询订单",
  trackHint: "已经下单了？请输入确认讯息里的订单编号（以 <strong>#</strong> 开头，例如 #A3F9C2），以及下单时使用的电话号码。",
  trackPh: "例如：A3F9C2",
  trackNoLabel: "订单编号",
  trackPhonePh: "下单时使用的电话号码",
  trackPhoneLabel: "下单时使用的电话号码",
  trackNeedPhone: "请输入这单使用的电话号码，我们就能找到它。",
  trackBtn: "查询",
  sPolicies: "条规",

  items: "%1 件",
  oneItem: "1 件",
  placeOrder: "提交订单",
  sending: "正在发送…",
  soldOut: "已售完",
  qtyLess: "少一个",
  qtyMore: "多一个",
  onlyLeft: "仅剩 %1 份",
  qtyAria: "数量",
  langAria: "语言",
  journeyAria: "订单进度",
  noDates: "目前没有可预订的发货日 — 请稍后再来。",
  noOpenDates: "近期发货日均已满 — 请稍后再来。",
  calChosen: "你的发货日：%1",
  calChosenFor: "我们建议 %1。点一下它来确认你的发货日。",
  calMiss: "%1不是发货日 — 请选择绿色圈起的日期。",
  calClose: "%1的订单已截止 — 请选择绿色圈起的日期。",
  calPrev: "前一周",
  calNext: "下一周",
  // ⚠️ MY WORDS, NOT HERS — for her to correct, like every other 中文 line in this file. 发货日 is this
  // shop's own word for a posting day (it is what `calChosen` uses above), and 绿色圆圈 names both the
  // colour and the shape the customer is looking at.
  calKey: "绿色圆圈里的日期是发货日。",
  calFull: "已满",
  fullDaySay: "%1 已满。",
  fullDayNext: "下一个可以拿到零食的日子是 %1。",
  fullDayChoose: "选择 %1",
  fullDayNone: "目前还没有开放的日子。",

  closedFrom: "只接受 %1 起的发货日订单",
  closedTo: "只接受 %1 或之前的发货日订单",
  closedClose: "需在发货日前 %1 天下单",
  closedCloseAdvice: " — 请另选较后的日期",
  closedWeekday: "只限 %1 供应",
  closedUnmarked: "这一天没有出售",
  unavailable: "暂无供应",
  nextAvailable: "下次可预订：%1",
  nextAvailableLeft: "下次可预订：%1 · 剩 %2 份",
  sentenceEnd: "。",
  noMenuToday: "这一天没有商品在菜单上，请另选一个发货日。",
  noMenu: "菜单暂时是空的 — 请稍后再来。",
  moreItems: "更多商品",
  fixSoldOut: "%1 刚刚售完 — 已从你的订单中移除。",
  fixGone: "%1 已不在菜单上 — 已从你的订单中移除。",
  fixPoolClamp: "%1：现在配合订单其余部分只装得下 %2 份 — 已把你的 %3 改为 %2。",
  fixClamp: "%1：现在只剩 %2 份 — 已把你的 %3 改为 %2。",
  fixClosed: "%1：%2 — 已移除。",

  cancelNote: "可在发货日前 %1 天更改或取消。",
  cancelNoteOne: "可在发货日前 1 天更改或取消。",
  orderCancelNote: "发货日前 %1 天可以更改或取消。不退款 — 订单可以换到其他发货日。",
  orderCancelNoteOne: "发货日前 1 天可以更改或取消。不退款 — 订单可以换到其他发货日。",

  confirmAddWaTitle: "请填写您的 WhatsApp 号码。",
  confirmAddWaBody: "我们会用它确认订单并发送付款二维码。",
  confirmAddWaShape: "这个号码看起来不完整，请检查一下；马来西亚以外的号码请加上国家代码。",
  needItemTitle: "订单还是空的。",
  needItemBody: "请先从上面的菜单选一样，然后就可以下单了。",
  needDayTitle: "请先选择发货日。",
  needDayBody: "在最上面的第 1 步。选好你要零食在哪一天做好 — 然后就可以加入订单。",
  confirmAddNameTitle: "请填写你的名字。",
  confirmAddNameBody: "这样我们在跟你确认订单时，才知道这份订单是谁的。",
  confirmAddrTitle: "请填写您的邮寄地址。",
  confirmAddrBody: "我们提供全马邮寄——没有完整的邮寄地址（街道、地区、市镇及邮编）就无法寄出您的零食。",
  confirmClosedTitle: "该日的订单已截止。",
  confirmClosedBody: "此日订单需在发货日前一天%1前下单 — 请另选一个发货日。",
  confirmChangedTitle: "您的订单刚刚有变动。",
  confirmChangedBody: "下单期间有零食售完了 — 我们已根据剩余数量更新您的购物车。",
  confirmChangedSub: "请再次确认订单并点击「提交订单」。",
  sendingToBakery: "正在发送您的订单…",
  orderRecvTitle: "🎉 订单已收到！",
  orderRecvBody: "%1 已收到您的订单。",
  orderRecvThanksBody: "谢谢 %1！%2 已收到您的订单。",
  orderRecvLine: "📅 %1 · %2 · RM%3",
  orderRecvSub: "订单已收到 — 确认后我们会通过 WhatsApp 通知您。",
  failTitle: "暂时无法发送您的订单。",
  failBody: "别担心 — 直接用 WhatsApp 把订单发过来，不要弄丢。",
  failOpened: "WhatsApp 已打开并带上您的订单 — 请按「发送」。",
  failLink: "📲 通过 WhatsApp 发送订单",
  failRetry: "请稍后再试一次。",

  trackEnter: "请输入订单编号查询。",
  trackUnavailable: "现在暂时无法查询。",
  trackLooking: "正在查询您的订单…",
  trackNotFound: "找不到订单 #%1 与这个电话号码。请检查两项：订单号是确认讯息中 # 号后的 6 个字符，电话号码是您下单时使用的 WhatsApp 号码。",
  orderCode: "订单 #%1",
  forCustomer: "顾客：%1",
  trkNew: "新订单",
  trkConfirmed: "已确认",
  trkPaid: "已付款",
  trkBaking: "准备中",
  trkReady: "已打包",
  trkFinal: "已取货 / 已寄出",
  trkItems: "商品：%1",
  itemsTotal: "商品小计：%1",
  trkTotal: "总计：%1",
  trackingNo: "快递单号：%1",
  trackDelivery: "查询您的订单：",
  courierCharge: "邮费：%1",
  courierCod: "邮费：%1 - 货到付款，收货时付给送货员",
  postageQuoted: "邮费：另行报价 — 我们会把准确金额发给你",
  promoLine: "优惠码 %1：-%2",
  promoFriend: "朋友推荐优惠：-%1",
  promoReward: "带朋友奖励：-%1",
  tripStatus: "配送：%1",
  tripFinding: "正在寻找司机",
  tripOnTheWay: "司机在路上",
  tripCollected: "已取货",
  tripDelivered: "已送达",
  tripStopped: "已取消",
  tripNoDriver: "无司机接单",
  driverLine: "司机：%1",
  vehicleLine: "车辆：%1",
  callDriver: "致电司机",
  carrierLine: "快递公司：%1",
  nextBlockedBasket: "你的购物篮是 %1 的。想订另一天，请在上面的日历选择。",

  devBy: "网站制作",
  devWa: "用 WhatsApp 找开发者",

  // The same one-line rule as the English: no more than about 23 characters here.
  fbPh: "网站管理员：喜欢这个界面吗？告诉我，我把它做好",
  fbHint: "按 Enter 发送",
  fbSending: "正在发送…",
  fbThanks: "你的建议我们收到了，会好好处理。新更新很快就来！",
  fbFailed: "刚才发送不成功 — 再试一次，或用 WhatsApp 找开发者。",
  fbEmpty: "先写下你的想法吧。",
};

const ms = {
  titleWord: "Order",
  buildStale: "Versi baharu halaman ini sudah sedia.",
  buildStuck: "Versi baharu sudah sedia. Tutup halaman ini sepenuhnya, kemudian buka semula.",
  buildReload: "Muat semula",
  homeLink: "🏠 Laman utama kami",
  referral: "🎁 Anda dirujuk — anda ada diskaun sambutan untuk tempahan pertama",
  deliveryDays: "Hari pos",

  // ★★ NOTIS VERSI KEDAI (v492). Inilah satu-satunya baris di halaman ini tentang HALAMAN itu
  // sendiri, bukan tentang roti — dan hanya pelanggan yang membiarkan kedai terbuka semasa kami
  // mengemas kini yang akan membacanya. Jadi ia senyap, ia bukan amaran, dan ia tidak pernah
  // menyalahkan mereka.
  // ⚠️ YANG KEDUA ADA KERANA YANG PERTAMA TIDAK SELALU BERKESAN: menekan Muat semula meminta
  // pelayar mengambil halaman itu sekali lagi, dan pelayar yang masih memegang skrip lama akan
  // memberikannya semula. Selepas satu percubaan, halaman ini berhenti menawarkan butang yang
  // sudah terbukti tidak berkesan dan memberitahu apa yang benar-benar berkesan.
  buildWarnTitle: "Order anda belum disimpan.",
  buildWarnBody: "Memuat semula akan memulakan halaman ini semula — hari pos, troli dan apa yang anda taip akan hilang. Tekan Muat semula sekali lagi jika mahu dikemas kini sekarang.",
  buildAnyway: "Muat semula juga",

  promoLabel: "Ada kod?",
  promoPh: "cth. FRESH10",
  promoApply: "Guna",
  promoRemove: "Buang kod",
  promoBar: "Kod %1 disertakan dengan order anda. Kami akan semak dan sahkan jumlah akhir di WhatsApp.",
  promoToday: "Hari ini: %1 — guna kod %2",
  promoAccepted: "%1 — kod %2 telah disertakan. Kami akan tolakkan apabila kami sahkan order anda.",
  promoAcceptedUsed: "%1 — kod %2 telah disertakan. Satu sahaja setiap pelanggan, jadi kami akan sahkan apabila kami ambil order anda.",
  promoAcceptedFirst: "%1 — kod %2 telah disertakan. Kod ini untuk order pertama, jadi kami akan sahkan apabila kami ambil order anda.",
  promoUnknown: "Kami tidak kenal kod itu — semak hurufnya dan cuba lagi.",
  promoPaused: "Kod itu dihentikan sementara — ia tidak tersedia buat masa ini.",
  promoEnded: "Kod itu tamat pada %1 — ia tidak lagi tersedia.",
  promoNotYet: "Kod itu belum bermula — ia bermula pada %1.",
  promoClaimed: "Kod itu telah habis diambil — tiada lagi yang tinggal.",
  promoClash: "Kod itu tidak boleh digunakan bersama diskaun sambutan yang anda sudah ada — hubungi kami dan kami akan uruskannya.",
  promoSmall: "Belum cukup lagi — tambah %1 lagi untuk menggunakannya.",
  promoNo: "Kod itu tidak boleh digunakan buat masa ini — hubungi kami dan kami akan uruskannya.",
  promoFreeDelivery: "Penghantaran percuma",
  promoOffAmount: "Potongan %1",
  promoOffPercent: "Potongan %1%",
  promoOffPercentCap: "%1, sehingga %2",
  promoOnMin: "%1 untuk %2 ke atas",
  promoUntil: "%1, sehingga %2",
  orderBy: "Tempahan ditutup",
  beforeVal: "%1 sehari sebelum hari pos",
  // ⚠️ Same note as the Chinese above: mine, not a native speaker's, and worth checking before launch.
  ansClosed: "Tempahan hari ini sudah ditutup",
  ansInTime: "Anda masih sempat",
  ansNext: "Hari seterusnya anda boleh menempah ialah %1.",
  ansBy: "Pesan sebelum %2 pada %1, dan ia milik anda.",
  stepsLede: "Anda akan buat 4 langkah, mengikut susunan 1, 2, 3, 4 — selebihnya kami uruskan.",
  bakeDayWhat: "Hari pos ialah hari kami membuat dan mempos snek anda. Ia dibuat pada pagi itu, jadi ia paling segar — dan paling awal ia boleh siap untuk anda ialah pada sebelah petang, bukan pagi.",
  madeToOrder: "Dibuat mengikut tempahan · tutup %1 sehari sebelum",
  sPickDay: "Pilih hari pos",
  sWhat: "Apa yang anda mahukan?",
  sYourDetails: "Maklumat anda",
  yourName: "Nama anda",
  namePh: "cth. Aisyah",
  whatsappNo: "Nombor WhatsApp",
  whatsPh: "cth. 012-345 6789",
  waSub: "Kami guna nombor ini untuk sahkan order dan hantar QR pembayaran — kami tidak akan menghantar mesej sampah kepada anda.",

  privacyLine: "Dengan menempah, anda bersetuju dengan",
  privacyLink: "notis privasi.",
  factsLink: "Perlu tahu",
  factsHead: "Sebelum anda order",
  factBake: "Snek anda dibuat pada hari ia dihantar, jadi ia sampai dalam keadaan paling segar.",
  factCutoff: "Order ditutup pada petang sebelum hari pos anda — masa tepatnya sentiasa ada pada kad di atas kalendar.",
  factGet: "Kami pos ke seluruh negara, atau anda boleh ambil sendiri di tempat kami. Kos pos ialah kadar tetap setiap order, ditambah semasa kami sahkan pesanan anda di WhatsApp — jumlah di halaman ini hanya untuk snek.",
  factPay: "Order disahkan apabila bayaran sampai kepada kami — kami hantar kod QR bayaran melalui WhatsApp.",
  allergenLabel: "Kandungan",
  keepingLabel: "Penyimpanan",
  againTitle: "Order terakhir anda",
  waitTitle: "Nak diberitahu kalau ada ruang?",
  waitName: "Nama anda (pilihan)",
  waitPhone: "Nombor WhatsApp",
  waitAsk: "Beritahu saya bila ada ruang",
  waitDone: "Sudah dicatat — kami akan beritahu kalau hari itu ada ruang.",
  waitAlready: "Anda sudah ada dalam senarai untuk hari itu.",
  waitBad: "Nombor ini nampak bukan nombor WhatsApp.",
  waitFail: "Tidak dapat dicatat sekarang — cuba sebentar lagi, atau hubungi kami.",
  againWhen: "pada %1",
  againAdd: "Tambah semula",
  againForget: "Lupakan",
  againSaved: "Disimpan pada telefon ini sahaja.",
  againGone: "%1 tiada dalam menu hari ini.",
  againFull: "%1 penuh hari ini.",
  againAdded: "%1 daripada order lepas anda telah ditambah.",
  factChange: "Untuk tukar atau batal order, mesej kami di WhatsApp secepat mungkin dan kami akan beritahu dengan jujur apa yang boleh dibuat.",
  factAsk: "Tanya kami apa sahaja — WhatsApp",
  privacyHead: "Bagaimana kami menggunakan maklumat anda",
  privacyWhat: "Kami menggunakan data anda hanya untuk membuat tempahan anda, menghantarnya kepada anda, dan menghubungi anda mengenainya. Jika dipos, kami juga perlukan alamat dan pin pintu anda.",
  privacyWho: "Untuk mempos tempahan anda, pihak pos diberi nama, nombor dan alamat anda. Pengesahan sampai kepada anda melalui WhatsApp, dan notis tempahan masuk ke telefon kami. Tiada sesiapa lain melihat maklumat anda, dan kami tidak pernah menjualnya.",
  privacyKeep: "Maklumat anda disimpan bersama tempahan anda dalam buku tempahan kami, di perkhidmatan awan yang selamat dan dalam telefon kami sendiri di belakang PIN. Rekod jualan disimpan selama tujuh tahun seperti yang dikehendaki pihak cukai — tetapi nama, nombor dan alamat anda bukan sebahagian daripada rekod itu, jadi beritahu kami bila-bila masa dan kami akan padamkannya.",
  privacyContact: "Beritahu kami bila-bila masa untuk melihat, membetulkan atau memadam apa yang kami simpan — WhatsApp",
  privacyDate: "Di bawah Akta Perlindungan Data Peribadi 2010 (Akta 709). Kemas kini terakhir: 7 Oktober 2026.",
  howGet: "Macam mana anda mahu terima tempahan?",
  fulfilPick: "Tekan untuk pilih satu.",
  fulfilAskTitle: "Sila beritahu bagaimana anda mahu ambil order.",
  fulfilAskBody: "Tekan Ambil sendiri (setempat) atau Pos (seluruh negara) di atas — itu caranya kami tahu sama ada perlu disediakan untuk anda atau dipos ke pintu anda.",
  askToDeliveryTitle: "Tukar kepada pos?",
  askToDeliveryBody: "Anda memilih untuk ambil di %1. Menukar kepada pos membatalkan pilihan itu, dan kami pos ke alamat anda.",
  askToDeliveryYes: "Ya, tukar",
  askToDeliveryNo: "Kekal ambil sendiri",
  askToCollectTitle: "Tukar kepada ambil sendiri?",
  askToCollectBody: "Anda telah beri alamat pos. Menukar kepada ambil sendiri membatalkannya, dan anda ambil di salah satu titik ambilan kami.",
  askToCollectYes: "Ya, tukar",
  askToCollectNo: "Kekal pos",
  selfCollectSub: "Anda datang ambil sendiri — tiada caj pos. Kami maklumkan titik ambilan dan waktu ambilan yang tepat; biasanya lewat petang pada hari pos.",
  courier: "Pos (seluruh negara)",
  courierSub: "Kami pos kepada anda, ke seluruh negara. Caj pos dimaklumkan di WhatsApp — jumlah yang dipaparkan ialah untuk snek sahaja, dan kami tambah caj pos semasa mengesahkan.",
  ourKitchen: "Dapur kami",
  kitchenSub: "Tempat snek anda dibuat — kami akan maklumkan lokasi dan masa yang tepat",
  pointSub: "Titik ambilan — kami akan maklumkan lokasi dan masa yang tepat selepas tempahan disahkan",
  pointMin: "Perlu bakul RM%1 atau lebih — anda kini RM%2",
  pointPick: "Tekan untuk pilih titik ambilan yang anda mahu ambil order anda.",
  addressLabel: "Alamat pos",
  addressPh: "Alamat lengkap — jalan, kawasan, bandar & poskod",
  pinHintShort: "Pintu susah dicari?",
  selfCollect: "Ambil sendiri (setempat)",
  addressSub: "Kami hantar ke seluruh negara — snek anda dibuat pada hari yang anda pilih dan dihantar ke alamat ini.",
  pinHint: "Tak tandakan pun boleh — kurier akan pergi ke alamat yang anda taip, dan itu memadai untuk kebanyakan rumah. Tanda hanya jika alamat itu sahaja tidak cukup untuk mencari pintu anda: blok kondominium, pondok pengawal. Sama ada anda tandakan atau tidak, tulis nombor blok dan unit di ruang alamat di atas.",
  pinOnMap: "Tanda pada peta",
  pinSet: "Lokasi ditanda — kurier akan pergi ke tempat yang anda tandakan.",
  pinLoading: "Peta sedang dimuatkan…",
  pinTapFirst: "Ketik peta sekali untuk letak pin — kemudian seret ke pintu yang tepat.",
  pinKeep: "Simpan tempat ini",
  pinCancel: "Batal",
  pinMapFailed: "Peta tidak dapat dimuatkan. Taip alamat anda di atas, kami akan cari.",
  pinAddrChanged: "Anda menukar alamat, jadi tanda yang dipilih tadi tidak lagi sepadan. Ketik cadangan di atas, atau tandakan semula.",
  addrStale: "Cadangan itu untuk alamat anda yang sebelum ini. Pilih satu untuk alamat baharu, atau tandakan semula.",
  addrLooking: "Sedang mencari alamat anda…",
  addrPick: "Ketik yang paling hampir dengan alamat anda.",
  addrNone: "Alamat itu tidak ditemui. Ketik peta dan letakkan tanda pada pintu anda.",
  addrFailed: "Pencarian alamat tidak tersedia buat masa ini. Ketik peta dan letakkan tanda pada pintu anda.",
  noteLabel: "Nota untuk ambilan/penghantaran (pilihan)",
  notePh: "cth. ambil 6pm / mahu dihantar 6 hingga 8pm",
  addNoteLink: "＋ Tambah nota",
  lineNotePh: "cth. tanpa kacang, tulis “Selamat Hari Jadi”",
  sTrack: "Semak order anda",
  trackHint: "Sudah menempah? Masukkan nombor order dari mesej pengesahan (bermula dengan <strong>#</strong>, cth. #A3F9C2) dan nombor telefon yang anda guna semasa order.",
  trackPh: "cth. A3F9C2",
  trackNoLabel: "Nombor order",
  trackPhonePh: "nombor telefon semasa order",
  trackPhoneLabel: "Nombor telefon yang digunakan untuk order",
  trackNeedPhone: "Masukkan nombor telefon yang digunakan semasa order ini, dan kami akan mencarinya.",
  trackBtn: "Semak",
  sPolicies: "Polisi",

  items: "%1 item",
  oneItem: "1 item",
  placeOrder: "Hantar order",
  sending: "Sedang dihantar…",
  soldOut: "Habis",
  qtyLess: "Kurang satu",
  qtyMore: "Tambah satu",
  onlyLeft: "Tinggal %1 sahaja",
  qtyAria: "Berapa banyak",
  langAria: "Bahasa",
  journeyAria: "Perjalanan status order",
  noDates: "Tiada tarikh pos buat masa ini — sila datang lagi nanti.",
  noOpenDates: "Semua hari pos akan datang penuh buat masa ini — sila datang lagi nanti.",
  calChosen: "Hari pos anda: %1",
  calChosenFor: "%1 dicadangkan untuk anda. Ketik untuk mengesahkan hari pos anda.",
  calMiss: "%1 bukan hari pos — sila pilih tarikh bertanda hijau.",
  calClose: "Tempahan untuk %1 telah ditutup — sila pilih tarikh bertanda hijau.",
  calPrev: "Minggu sebelumnya",
  calNext: "Minggu seterusnya",
  // ⚠️ MY WORDS, NOT HERS — for her to correct. "Hari pos" is this shop's own word for a posting day
  // (see `calChosen` above); "bulatan hijau" is the green circle he is looking at.
  calKey: "Tarikh dalam bulatan hijau ialah hari pos.",
  calFull: "PENUH",
  fullDaySay: "%1 sudah penuh.",
  fullDayNext: "Hari seterusnya anda boleh dapat snek ialah %1.",
  fullDayChoose: "Pilih %1",
  fullDayNone: "Belum ada hari terbuka untuk ditunjuk.",

  closedFrom: "Hanya tersedia untuk pos dari %1",
  closedTo: "Hanya tersedia untuk pos sehingga %1",
  closedClose: "Tempahan ditutup %1 hari sebelum hari pos",
  closedCloseAdvice: " — sila pilih tarikh yang lebih lewat",
  closedWeekday: "Hanya tersedia pada %1",
  closedUnmarked: "Tidak dijual pada hari itu",
  unavailable: "Tidak tersedia",
  nextAvailable: "Seterusnya tersedia: %1",
  nextAvailableLeft: "Seterusnya tersedia: %1 · tinggal %2",
  sentenceEnd: ".",
  noMenuToday: "Tiada apa-apa pada menu untuk hari ini. Sila pilih hari pos yang lain.",
  noMenu: "Menu sedang kosong — sila semak semula nanti.",
  moreItems: "Lebih banyak item",
  fixSoldOut: "%1 baru habis — kami keluarkan dari order anda.",
  fixGone: "%1 tiada lagi dalam menu — kami keluarkan dari order anda.",
  fixPoolClamp: "%1: hanya %2 boleh dimuatkan bersama baki order anda — kami sudah tukar %3 anda kepada %2.",
  fixClamp: "%1: tinggal %2 sahaja sekarang — kami sudah tukar %3 anda kepada %2.",
  fixClosed: "%1: %2 — kami sudah keluarkan.",

  cancelNote: "Tukar atau batal sehingga %1 hari sebelum hari pos.",
  cancelNoteOne: "Tukar atau batal sehingga 1 hari sebelum hari pos.",
  orderCancelNote: "Tukar atau batal sehingga %1 hari sebelum hari pos. Bayaran tidak dikembalikan — tempahan boleh dipindah ke hari lain.",
  orderCancelNoteOne: "Tukar atau batal sehingga 1 hari sebelum hari pos. Bayaran tidak dikembalikan — tempahan boleh dipindah ke hari lain.",

  confirmAddWaTitle: "Sila masukkan nombor WhatsApp anda.",
  confirmAddrTitle: "Sila masukkan alamat pos anda.",
  confirmAddrBody: "Kami hantar ke seluruh negara — snek anda tidak dapat dihantar tanpa alamat lengkap (jalan, kawasan, bandar & poskod).",
  confirmAddWaBody: "Kami guna untuk sahkan tempahan dan hantar QR pembayaran anda.",
  confirmAddWaShape: "Nombor ini nampak tidak lengkap — sila semak, dan sertakan kod negara jika anda di luar Malaysia.",
  needItemTitle: "Order masih kosong.",
  needItemBody: "Pilih sesuatu dari menu di atas dahulu — kemudian anda boleh buat order.",
  needDayTitle: "Pilih hari pos anda dahulu.",
  needDayBody: "Langkah 1, di atas. Pilih hari anda mahu snek anda dibuat — kemudian anda boleh menambahnya.",
  confirmAddNameTitle: "Sila masukkan nama anda.",
  // ⚠️ THE LAST OF HER 16 TRANSLATION DECISIONS TO BE APPLIED (17 Oct 2026). ⚠️ **The old line dropped the
  // object of "guna" and dropped "with you"** — "Kami guna untuk tahu…" reads as an unfinished verb. Hers:
  // "Kami guna **ini** untuk tahu order ini untuk siapa semasa **kami** mengesahkannya **dengan anda**."
  // ⭐ **This string is not drawn on the shop yet** (it belongs to the step lock, which is unbuilt) — **which is
  // exactly why it was the one nobody had looked at.** See `test/store-vocab.test.js`.
  confirmAddNameBody: "Kami guna ini untuk tahu order ini untuk siapa semasa kami mengesahkannya dengan anda.",
  confirmClosedTitle: "Order untuk hari itu sudah ditutup.",
  confirmClosedBody: "Order untuk hari itu ditutup pada %1 sehari sebelum — sila pilih hari pos yang lain.",
  confirmChangedTitle: "Order anda baru sahaja berubah.",
  confirmChangedBody: "Ada barang yang habis semasa anda menempah — kami sudah kemas kini troli anda ikut apa yang tinggal.",
  confirmChangedSub: "Sila semak order anda dan tekan Hantar order sekali lagi.",
  sendingToBakery: "Sedang menghantar order anda…",
  orderRecvTitle: "🎉 Order diterima!",
  orderRecvBody: "%1 sudah terima order anda.",
  orderRecvThanksBody: "Terima kasih %1! %2 sudah terima order anda.",
  orderRecvLine: "📅 %1 · %2 · RM%3",
  orderRecvSub: "Tempahan anda sudah diterima — kami akan WhatsApp anda sebaik sahaja disahkan.",
  failTitle: "Kami tidak dapat menghantar tempahan anda buat masa ini.",
  failBody: "Jangan risau — hantar tempahan anda melalui WhatsApp supaya ia tidak hilang.",
  failOpened: "WhatsApp sudah dibuka dengan tempahan anda — tekan Hantar supaya ia tidak hilang.",
  failLink: "📲 Hantar tempahan anda melalui WhatsApp",
  failRetry: "Sila cuba sebentar lagi.",

  trackEnter: "Masukkan nombor order anda untuk disemak.",
  trackUnavailable: "Semakan tidak tersedia buat masa ini.",
  trackLooking: "Sedang cari order anda…",
  trackNotFound: "Kami tidak dapat mencari order #%1 dengan nombor telefon itu. Sila semak kedua-duanya: nombor order ialah 6 aksara selepas # dalam mesej pengesahan anda, dan nombor telefon ialah nombor WhatsApp yang anda gunakan untuk membuat order.",
  orderCode: "Order #%1",
  forCustomer: "Untuk %1",
  trkNew: "Baharu",
  trkConfirmed: "Disahkan",
  trkPaid: "Dibayar",
  trkBaking: "Sedang disediakan",
  trkReady: "Dibungkus",
  trkFinal: "Sudah diambil / Sudah dipos",
  trkItems: "Barang: %1",
  itemsTotal: "Jumlah barang: %1",
  trkTotal: "Jumlah keseluruhan: %1",
  trackingNo: "Nombor penjejakan: %1",
  trackDelivery: "Jejak order anda:",
  courierCharge: "Kos pos: %1",
  courierCod: "Kos pos: %1 - COD, bayar kepada kurier semasa penghantaran",
  postageQuoted: "Pos: disebut berasingan — kami akan beritahu jumlah tepat kepada anda",
  promoLine: "Kod %1: -%2",
  promoFriend: "Diskaun bawa rakan yang dihantar kepada anda: -%1",
  promoReward: "Ganjaran bawa kawan: -%1",
  tripStatus: "Penghantaran: %1",
  tripFinding: "Sedang mencari driver",
  // ⚠️ THE FIFTH DRIVER STRING, AND THE ONE HER DECISION MISSED (17 Oct 2026). ⭐ **Her rule was the WORD —
  // __""driver", never `pemandu`"__ — and the note that recorded it listed four keys. This is the fifth.**
  // ⭐⭐ **A rule recorded as a list of strings is a rule that stops at the end of the list**; the test below
  // sweeps the whole Malay dictionary instead.
  tripOnTheWay: "Driver dalam perjalanan",
  tripCollected: "Telah diambil",
  tripDelivered: "Telah dihantar",
  tripStopped: "Dibatalkan",
  tripNoDriver: "Belum ada driver",
  driverLine: "Driver: %1",
  vehicleLine: "Kenderaan: %1",
  callDriver: "Hubungi driver",
  carrierLine: "Kurier: %1",
  nextBlockedBasket: "Bakul anda untuk %1. Untuk hari lain, pilih pada kalendar di atas.",

  devBy: "Laman web oleh",
  devWa: "WhatsApp developer",

  // Her own wording, and it carries NO "Webmaster: " prefix - deliberately, and she wrote
  // it without one. Measured: as written it is 321.8px and holds one line in a phone's
  // 323px; adding the prefix costs 76px and wraps it onto two. Spells "User Interface"
  // out for the same reason the English does: "UI" is not a word a customer uses.
  fbPh: "Suka User Interface ini? Komen & Saya akan perbaiki!",
  fbHint: "Tekan Enter untuk hantar",
  fbSending: "Sedang dihantar…",
  fbThanks: "Idea anda sudah kami terima! Update terbaru akan datang tak lama lagi.",
  fbFailed: "Maaf, tadi tak berjaya dihantar. Cuba lagi, atau WhatsApp developer.",
  fbEmpty: "Tulis idea anda dulu ya.",
};

export const STORE = { en, zh, ms };
