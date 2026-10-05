# Munchies Furkidz — change history (v54 → v312)

What changed in each version of the backoffice app, newest first. Each version
number is the "Engine" you can see on the app's **More** screen, so you can
always tell which build a phone is running.

**05 Oct 2026 — engine v312, THE MORE SCREEN GROUPED BY THE WORK (no database step, nothing to
upload — pushing this one is the whole of it).**

**Why.** Your words: __"when i work on Products, i have to alway go into Others to find, ingredient,
unit, category"__ — and __"Everything about delivery should be group under logistic."__

You were right on both counts. Seventeen screens sat in ONE list under a single heading called
"Manage", in roughly the order they were built. Nothing was wrong with any row; the problem was that
its neighbours told you nothing. Categories, Units and Ingredients were at rows 13, 11 and 14 — two
of them separated by other screens — and the four delivery screens were at rows 7 to 10, mixed in
among the money screens.

**What you see now.** Seven headings, in the order you reach for them:

- **Logistic** — Delivery run · Delivery dates · Self collection Points · Parcel couriers

- **Products & ingredients** — Categories · Units · Ingredients

- **Buying** — Purchase Order · PO history · Suppliers

- **Money** — Money · Profit

- **The kitchen** — Production line · Scenario planner

- **The shop** — Promo codes · Reviews

- **Settings & this app** — Settings · Change history · Developer contact

**Logistic is your word**, and it carries all four ways an order leaves the kitchen. **Products &
ingredients is the one your sentence asked for**: the three things you reach for while working on a
product, together, under the name of the screen they belong to.

**And the trip out of the screen is gone.** The Products screen now carries the same three at its
top, under the same heading — Categories, Units and Ingredients, one tap from where you are editing.
It sits BELOW the ＋ New product fold, so the thing you came there to do is still the first thing on
the screen.

**"About" is gone as its own section**, because Settings and the change history are the same subject
— the app itself — and two headings for one subject was one too many.

**Nothing moved that has to be found twice.** All seventeen addresses are exactly what they were, so
an old bookmark still lands where it always did, and every row keeps the words it had underneath it;
only the heading above it changed. **Two of those second lines now say the moment rather than the
mechanism** — "Which days you deliver, and who is on each" instead of "Set and manage delivery
dates", and PO history reads "Your saved shopping lists".

**⚠️ AND THE ONE THING WORTH KNOWING: A ROW DROPPED IN A REGROUP IS SILENT.** The screen still
exists and its address still works — it has simply become unreachable from the menu, and nothing
goes red. So the new test reads the app's own route table and walks it against this menu, and fails
by name if a screen is missing. It was watched going red before it was trusted, and it caught a real
fault on the way in: the first cut passed the rows as raw lists and drew four empty headings with
nothing under them.

**Your data is untouched.** No SQL, no order, product, price or posting day touched, and **no database
step**. The suite is **2,769 tests, all green**.

**Measured at 375 wide, same phone, same data: 1,994 px became 2,263 px.** Grouping costs height —
about **+269 px**, a third of a screen of extra scrolling. Finding beats scrolling here, but it is a
real trade and it is worth knowing about.

**05 Oct 2026 — engine v311, THE ADDRESS BOX SAYS WHY IT ISN'T SUGGESTING (ONE STEP FOR YOU, BELOW —
the app side is a push, the reason needs a redeploy).**

**Why.** Your words: __"why sometimes in add order or edit order, the address is not auto complete,
and the map dont show?"__ — and then, precisely: __"the suggestion list never appear"__. **It was
true, and the app never said why. It knew, and stayed quiet.**

**★ WHAT WAS HAPPENING.** The suggestions are a Google feature that has to be switched on, and the
server deliberately answered a switched-off one with **a plain "no" and no error** — its own words:
__"this reaches her as a box that simply does not suggest, which is exactly what it did before this
version existed."__ That reads well until the feature __does__ exist and **never works**: a box that
never suggests and never explains itself is indistinguishable from a broken box.

**What you see now.** When the suggestions cannot work, the box says so, in the place the list would
have been:

  **Address suggestions are switched off — Google refused the request. The Google key needs Places
  API (New) enabled and allowed.**

**★ AND IT SAYS IT ONCE, THEN STOPS ASKING.** A line under a field she is typing in must not flicker,
and a phone must not spend a request per keystroke to be told the same thing. And the box now
**marks the difference between the two kinds of failure**: something you must fix (not signed in;
the Google key not allowed to use Places) is **said out loud**; a signal dropping out is **not**,
because that one passes on its own and the suggestions come back by themselves.

**⚠️ THE ONE THING THIS NEEDS FROM YOU: the __reason__ travels in the server's answer, so the `courier`
function has to be uploaded again.** The exact line is in the commit notes below. **Until it is
uploaded the box stays exactly as it is today.** Nothing else changes, and nothing is broken by
uploading it.

**⚠️ AND THE SCREENSHOT FOUND A SECOND FAULT THAT HAD ALREADY SHIPPED — a real one, mine, and this
one is worth reading.** Looking at the real card, the EasyParcel block was printing the **literal
word "null"** under the weight box and **three more beside its buttons**. The block builds its own
contents as a list with optional parts in it, and **`replaceChildren(null)` does not skip a null — it
inserts a text node reading "null".** **Every one of the 2,758 tests passed while it was on your
screen**, because the test shims quietly filter nulls for you. **A forgiving stub hid a real fault**
— the same lesson as v226, word for word. It is fixed, and the real-browser check that would have
caught it is now in place and was watched going red.

**Your data is untouched.** No SQL, no order, product, price or posting day touched. The suite is
**2,758 tests, all green**, and the real card now runs **41 checks** on the Orders screen and **9**
on the address box.

**04 Oct 2026 — engine v310, THE SAME DIVIDE ON EVERY CARD (no database step, nothing to upload —
pushing this one is the whole of it).**

**Why.** Your words, right behind v309: __"the drawing of line between parcel and lalamove should be
consistent over the app"__. You were only half-served — v309 put the two headings on the **Edit**
card and nowhere else.

**★ THREE CARDS CARRY BOTH KINDS, SO ALL THREE NOW SAY THE SAME TWO THINGS.** The **Edit** card, the
**Note / tracking** card, and the **＋ New order** card each draw **Post a parcel** over the parcel
fields and **Send a van** over the van fields — **from one definition**, so the words cannot drift
apart. **Two headings on each is not the check; the same two is**, and that is exactly what the new
test compares.

**⚠️ AND THE WAY I GOT IT WRONG FIRST IS WORTH KNOWING, because it is the kind of thing that would
have looked fine on paper.** I tried putting the heading __inside__ the parcel block, so that no card
could ever forget it. **That put it BELOW the consignment number on the Edit card** — the number is
a field the card itself draws just above that block — so the heading landed in the middle of its own
group and left the number stranded above it. The test caught it. **The words can be shared; the
position cannot**, because only the card knows where its own fields are.

**Your data is untouched, and there is nothing to run.** No SQL, no upload, no key. No order,
product, price or posting day is touched, and no field moved on any card. The suite is **2,756 tests,
all green**, and the real Orders screen now runs **40 checks** — including that each heading sits
above its own fields in document order, that neither one says "kind 1", and that **all three cards
show the same two.**

**04 Oct 2026 — engine v309, THE TWO WAYS AN ORDER LEAVES ARE SAID APART (no database step,
nothing to upload — pushing this one is the whole of it).**

**Why.** Your words: __"what i see is easy parcel is kind 1, lalamove is kind 2, but the interface
din draw a clean border between them, so it is quite confusing for user"__. **The first half of that
sentence is the proof.** You had the two the wrong way round — which you could only do because the
card never told you which was which. Four labels sat next to each other — **Parcel carrier**,
**EasyParcel**, **Courier charge**, **Get a delivery price** — with nothing saying what belonged to
what.

**What changed.** The card now draws a **rule with a name on it**, twice:

  **Post a parcel**  __Nationwide, a few days__
  — the consignment number, the parcel carrier, and EasyParcel

  **Send a van**  __Today, locally__
  — the courier charge, who paid it, and **Get a delivery price**

**⚠️ AND THE NAME SAYS WHAT IT DOES, NEVER "KIND 1" OR "KIND 2".** Those are this app's own words
for the two kinds of courier and they mean nothing on your screen. What you need to know is that one
of them is a van today and the other is a parcel over a few days — so that is what it says. **Nothing
moved:** every field is exactly where it was, and each heading went above the fields it already sat
on, so a heading can never end up announcing the other one's controls.

**⚠️ TWO THINGS I MEASURED RATHER THAN GUESSED, and both would have failed quietly.** My first rule
used the card's own line colour — **1.25:1 against the surface**, a faint tint that disappears on a
phone in Malaysian daylight, which is exactly where you read it. **A boundary you cannot see would not
have answered you.** It is now **3.5:1**, which clears the 3:1 the standard asks of an interface
edge. And the small grey beside the name — __"Nationwide, a few days"__ — was **3.5:1**, **under the
4.5:1 that applies to any text**; it is now **5.69:1**. Both were measured in the browser by reading
the rendered pixels, not worked out on paper.

**Your data is untouched, and there is nothing to run.** No SQL, no upload, no key. No order,
product, price or posting day is touched, and no field moved on any card. The suite is **2,756 tests,
all green**, and the real Edit card now runs **36 checks** — including that each heading sits above
its own fields in document order, and that neither one says "kind 1".

**04 Oct 2026 — engine v308, THE EASYPARCEL BLOCK READS AS OFF, NOT AS BROKEN (no database step,
nothing to upload — pushing this one is the whole of it).**

**Why.** You looked at EasyParcel's top-up offer and found the thing that decides this: **only an
account topped up by RM500 enjoys integration.** For a shop that posts the occasional parcel that
is the wrong money, so **you decided not to sign up** — and you were right. This version is the
consequence: the EasyParcel block now says so plainly instead of sitting there looking broken.

**What changed.** The block asks the server once, when it opens, whether EasyParcel is set up. If it
is not, you now get one short paragraph rather than a set of controls that can only ever fail:

  **EasyParcel** — Not set up yet — and nothing here is needed to post a parcel by hand. Record the
  carrier above and type the consignment number, exactly as before.
  EasyParcel is not set up yet — its key has not been saved on the server.

**⚠️ AND IT OFFERS NO PRESS AT ALL IN THAT STATE.** No weight box, no "Check the price", no
"Book it". A button whose only possible answer is the same sentence every time is the shape of a
dead control, and this app treats a dead control as a bug — so when it is off, it is off.

**The important half is the reassurance, not the apology:** nothing is missing. Posting a parcel by
hand is how this app has always posted one — record the carrier, type the consignment number — and
that is completely unchanged. **The API was only ever going to save you the retyping.**

**⚠️ AND A REAL FAULT THIS FOUND, WHICH IS THE PART WORTH KEEPING.** The first attempt had the block
call the pop-up's own repaint when its answer came back. **That repaint arrived at an unpredictable
moment while she was working further down the same card — and stranded the door block's own pending
look-up.** A test caught it (a pin the card had just found was thrown away). **Every other block in
this app paints ITSELF and leaves the card alone** — `paintCourier`, `paintParcel`, `paintPoint` —
and this block now does the same. One repaint of the whole card, on the booking, because that one
changes the tracking box above it.

**Your data is untouched, and there is nothing to run.** No SQL, no upload, no key, no account. No
order, product, price or posting day is touched. The suite is **2,756 tests, all green**, and the real
Edit card now runs **29 checks** — including five that can only be answered with the key absent,
which is how it will be for you.

**04 Oct 2026 — engine v307, THE EASYPARCEL SEAM (no database step in the app — but ONE
one-time step for you, below).**

**Why.** You asked to compare Ninja Van and SPX, and the honest answer turned out to be that
**you do not integrate with a carrier — you integrate with an aggregator.** Ninja Van's own API
is not self-serve (you must have an account, ask their sales team by email for even a sandbox,
and production keys come only after an "integration audit" with sample orders). SPX has no public
direct API at all for someone who is not a Shopee seller. **EasyParcel carries both** — along with
J&T, Pos Laju and DHL — and its API **is** self-serve, with a free demo environment. That is the
same choice you made back on 28 September: __"record first, the booking API after / EasyParcel
behind that API"__.

**★ WHAT YOU GET: ONE PRESS, EVERY CARRIER, PRICED FOR THIS PARCEL.** On an order's **Edit** card
there is now an **EasyParcel** block. Type the parcel's weight, press **Check the price**, and
every carrier they use comes back with a price for **that parcel, to that postcode, at that
weight** — cheapest first, with the delivery time and whether they collect or you drop off:

  **J&T Express — RM6.20** · J&T Standard · 3-5 working day(s) · drop off · they collect · cheapest
  **SPX — RM7.10** · SPX Express · 3-4 working day(s) · drop off · they collect
  **Ninjavan — RM9.40** · Ninja Van Standard · 2-3 working day(s) · they collect

**That is the comparison you asked for, done per parcel instead of guessed at from a blog post.**
The cheapest is marked but **never chosen for you** — which carrier to use is your call, and the
reason to show several is that the cheapest is not always the one you want.

**★ AND YOUR WALLET IS WARNED BEFORE, NOT AFTER.** EasyParcel is **prepaid**: a booking with too
little credit fails **with the parcel already packed**. So the balance is shown beside the price,
and when it is short it says so plainly — __"Your EasyParcel balance is RM4.20 and this parcel
costs RM6.20 — top it up before booking, or the booking will fail with the parcel already
packed."__ When a booking does come back refused, **their own words are shown** — "Insufficient
Credit" — rather than a generic failure.

**★ BOOKING SAYS THE PRICE AND THEN PAYS IT.** Pressing Book asks first, naming the courier and the
amount — __"Book this parcel with SPX for RM7.10?"__ — and only then books and pays in one call.
**The consignment number is SAVED AT ONCE**, not left waiting for a Save that may never come: the
same rule your booked trips already follow, because a parcel that has been paid for must not be
discardable by closing a card. It lands in the tracking box, where every screen already reads it.

**WHAT THIS DOES NOT DO, said plainly rather than discovered.**

- **It does not write the consignment number onto the customer's card by itself** — it goes in the
  tracking box, exactly as a parcel you booked by hand does.
- **It does not pick your carrier record for you.** EasyParcel's name for a service is not your
  own list's entry, so booking fills in the number and leaves the carrier box alone — one press
  above if you want it named.
- **It is not required.** Posting a parcel by hand still works exactly as it did — record the
  carrier, type the number. This is offered beside that, never instead of it.
- **Dry and sealed only, unchanged.** Fresh focaccia and anything frozen are still not parcels.

**⚠️ ONE THING ONLY YOU CAN DO, and it is a signup, not a key in chat.** Sign up at
easyparcel.my, complete the account verification, and register the key for API access — their
three steps. Then the key is stored **on the server** (never in the app, never in a browser) with
two Terminal commands, which are written at the top of the new function. Until that is done the
block says so in words and nothing else changes. **Set it to DEMO first** — the demo host books a
parcel nobody collects, which is how you can try the whole thing before a sen is spent.

**Your data is untouched, and there is nothing to run in the app.** No SQL, no upload. No order,
product, price or posting day is touched, and every screen behaves exactly as it did. The suite is
**2,756 tests, all green**, including **thirty-six** new ones — the wire format against
EasyParcel's own 55-page document, the address reading, and the seam end to end on the real card.

**04 Oct 2026 — engine v306, THE SMALLEST BASKET A POINT WILL TAKE (no database step, nothing to
upload — pushing this one is the whole of it).**

**Why.** Your ask: __"the per-point minimum order, this should be switchable"__. It is exactly
that — **per Point, and switchable**, on the Point's own card.

**★ THE SWITCH, AND WHERE IT COMES FROM.** On a Point you now get **Minimum order** with two
choices — **No minimum** and **Only on a basket of at least** — and the second one opens a
**Smallest basket (RM)** box. That is the SAME switch the Promo codes screen has used since v269,
because a minimum is a minimum and learning a second shape for one idea is how two screens come to
mean two different things by one word. **You picked ringgit**, out of the two units offered, so
"a basket of RM30" means the same thing everywhere in the app.

**⚠️ EVERY POINT STARTS WITH NO MINIMUM**, which is where they already are and what you asked for
when this whole feature was being discussed — __"keep it as simple as possible, say no minimum for
self collect order"__. The card says so plainly: **No minimum order — one loaf still goes.**

**On your card.** Each Point's row now reads **Minimum order RM30.00**, or the sentence above.

**In your shop.** A Point whose smallest basket the customer has not reached is **PARKED, NOT
HIDDEN** — it stays on the page with the reason in its own line:

  **Farlim, Air Itam**
  Needs a basket of RM30.00 or more — yours is RM15.00 so far

Tapping it says the same sentence rather than silently doing nothing, and **the moment their basket
reaches RM30 the Point opens up — on the same repaint, with no reload.** Add a loaf and watch it;
take one back and it parks again, **and a Point they had already chosen falls back to your
kitchen**, because the shop cannot post an order to a Point whose basket is not met.

**⚠️ THIS IS YOUR RULE, SO THE SHOP HONOURS IT — and that is not the same as a gate.** The thing
your standing instruction forbids is a rule **the app invents** (a closed day, a sold-out line)
standing between you and a sale. A smallest basket is a rule **you typed on your own Point**, so
enforcing it is the shop doing what you asked. **Nothing on your own side is blocked:** an order you
take over the phone for one loaf at Farlim is yours to take, and the app will not argue.

**⚠️ AND ONLY WHAT THE SHOP NEEDS LEAVES YOUR APP.** The Point's smallest basket is now published
along with its id and name — **the receiver, their phone, the fee and the address still never do**.
A smallest basket is the opposite of private: it is exactly what the customer has to know __before__
choosing, and without it the page could only take an order the Point does not want.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. Every
Point you already have carries no minimum, so **every one of them behaves exactly as it did
yesterday** — proved rather than asserted: the shop's own v299 checks still pass, 20 of 20, with
Points published that have no minimum at all. The suite is **2,720 tests, all green**, including
eight new ones, and every one was watched going red with the fault put back.

**04 Oct 2026 — engine v305, THE HOURS ON THE RUN ROW (no database step, nothing to upload —
pushing this one is the whole of it).**

**Why.** Your ask, and it is the one number the Delivery run was missing. The collection hours you
set on a Point decide **when the treats has to BE THERE and handed over** — so a trip booked for the
wrong part of the day should be visible on the screen where you spend the money on a van, not
discovered a day later.

**What you see.** A Point's row on the run now reads:

  **Farlim, Air Itam** — 2 orders collecting here · Lebuhraya Thean Teik · **collect 2-6 pm** ·
  Focaccia x2 · Focaccia x1 · Focaccia x3

**Where, then when, then what** — the address, then the hours, then the treats.

**And it says nothing when you have not set any.** The card already tells you a Point has no
collection window; repeating it on every run row would be noise on the screen you read while
working. A customer's own doorstep never claims hours either — a doorstep is not a place with
opening times.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. A
Point with no hours behaves exactly as it did yesterday, a doorstep's row is unchanged, and the
load line is untouched. The suite is **2,712 tests, all green**, including three new ones, and
every one was watched going red with the fault put back. **One of them taught something worth
keeping:** the check that a doorstep never shows hours stayed GREEN under the first fault I tried
— because reading a null Point already gives nothing — so the fault was not the one I had chosen.
Re-pointed at the mistake that would really do it, *taking the hours from whatever Point happens
to be first rather than from this row's*, it turns red by its own name.

**04 Oct 2026 — engine v304, THE COLLECTION WINDOW (no database step, nothing to upload —
pushing this one is the whole of it).**

**Why.** This is the piece we left open, and you chose it from three: **the window belongs to the
PLACE.** You type it once on the Point — __"Farlim: collect 2-6 pm"__ — and every order collecting
there is promised it. Not the van's arrival window, which is a different thing entirely.

**What you see, on More → Self collection Points.** Every Point's card gains **"Customers can
collect from"** and **"and until"** — two time boxes, the same pair the Delivery run fills in for
the van, so a window means one thing in this app and is read by one piece of code. And the row
itself now says which of the two it is: **🕑 Collect 2-6 pm**, or **🕑 No collection window —
customers are told the day only.**

**What your customer is told.** The confirmation, the payment reminder and the pickup reminder all
name the place **and the hours**: __"Self collect at Farlim, Air Itam, collect 2-6 pm."__ Leave both
boxes empty and they are told the day and nothing else, which is a promise you can keep rather than
one that reads as open all day.

**⚠️ THE ONE THING TO GET RIGHT, and it is your judgement rather than the app's: SET THE HOURS FROM
WHEN THE TREATS IS THERE, NOT FROM WHEN THE SHOP OPENS.** The van arrives during the round, so a
window starting at opening time can have a customer standing at the counter before their order has
been delivered. The app deliberately does **not** work this out for you — the same way it never
works out the fee — because a time the app derives is a time it can get wrong.

**⚠️ AND THE VAN'S OWN WINDOW IS NEVER QUOTED TO THEM.** When you book a round, the trip's window is
stamped on every order it carries — and for a collection that is when the **treats reaches the
Point**, which is your business, not the customer's. Telling them both would be telling them two
different times in one message. So a collecting customer gets the place's hours or nothing at all,
and never the van's.

**A hole that fixing this found, and it was mine.** The **pickup reminder** said only __"Packed and
ready for pickup on ..."__ and named **no place at all** — so a customer collecting at Farlim was
told their order was ready and never where to go, while the confirmation, the payment reminder and
the shipped message all named it. v299 claimed all four later messages named the Point; three of
them did. It now reads **"Packed and ready to collect from Farlim, Air Itam on ..."**, and a
collection from your own kitchen keeps the words it has always had.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. A
Point with no hours behaves exactly as it did yesterday, and every order already placed is
unaffected. The suite is **2,709 tests, all green**, including eighteen new ones — the model, the
one place that decides whose window a customer is told, the card's own time boxes, and the three
messages a collecting customer actually receives, driven through the real builders rather than
through the helper behind them. **Every one was watched going red** with the fault put back.

**Also in this version, and it is housekeeping you will never see:** the window stopped being the
courier's own and became a small module both the courier and the Points card read, so **a window
cannot mean one thing on one screen and another somewhere else**, and its own tests moved with it.

**04 Oct 2026 — engine v303, A POINT YOU SET UP AND HAND OUT BY HAND (no database step, nothing
to upload — pushing this one is the whole of it).**

**Why.** Two things you found while watching v301 and v302 land, and they are the same gap:
everything about Points worked for a **customer** ordering from your shop, and almost nothing
worked for an order **you** take.

**1. ＋ New order and Edit now let you say where it collects from.**

Your words: __"how about + new order, and add edit order?"__ You were right, and it is the
important half — you take a great many orders over the phone and in chats, and until now an order
you keyed in yourself **could not be a Point order at all.** It could not go on the Delivery run,
the Point's fee was never counted for it, and the customer was never told where to collect.

- **A "Collect from" picker**, under **Fulfillment** — **My kitchen** first, which is the default
  and is what every order you have ever taken already means, then your open Points in your order.
- **It appears only when there is something to choose.** With no Point open, or on a Courier
  order, it is absent rather than sitting there doing nothing.
- **The Point's name is frozen onto the order** the moment you take it, so renaming or ending a
  Point later leaves every order that already went there still saying where it went. The same rule
  that keeps a sold price on an order.
- **Choosing your kitchen clears it.** An order collecting from your kitchen carries no Point at
  all, which is exactly what it has always meant.

**2. A Point's address box now asks Google as you type.**

Your words: __"there is no address auto complete for collection point?"__ — and then the better
question, __"why not make the point consistent with the customer card?"__ Both fair. The
suggestion box was written for the order's delivery address and had never been given to this one,
so the address a **driver** is sent to — and the address the pin is looked up from — was the one
address you had to peck out in full on a phone.

- **The same behaviour as the order's address box, because it is now literally the same code**,
  moved into one place so the two boxes cannot drift apart.
- **Nothing is ever blocked by it:** a lookup that fails shows nothing at all, and whatever you
  typed is what gets saved.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. An
order taken before today carries no Point, which is what "collect from my kitchen" has always
meant, so nothing needs migrating and no order is rewritten. The suite is **2,691 tests, all
green**, including twelve new ones — nine driving both order cards, and three driving the Point's
own address box through the real suggestion channel. **Every one of them was watched going red**
with the fault put back before it was called done.

**04 Oct 2026 — engine v302, AN ORDER COLLECTED AT A POINT REACHES THE RUN (no database step,
nothing to upload — pushing this one is the whole of it).**

**Why, and it is a fault I found while starting the collection window you asked for.** The run was
not carrying Points at all. Not rarely — **never**, and it said so quietly: a day where customers
were collecting at Farlim read **"Nothing to run yet"**.

**★ WHAT WAS WRONG.** Choosing a Self collection Point in your shop **never changes the Self collect
/ Courier choice** — that is by design, a Point IS a collection. So the order is stored as a
__collection__, and the run screen used that word to decide what needs a vehicle and **skipped every
collection**. Every Point order was thrown away **before** the row work v301 added could ever see
one. v301 built the right rows and they were unreachable.

**The rule now, and it is the one that was always meant: a courier order needs a vehicle, and a
collection AT A POINT needs one too — the treats still has to reach the Point.** A collection from
**your own kitchen** still needs none, because you hand those over yourself. That half is the one a
careless fix breaks, and it has its own test.

**What you see now.** A day of collections at Farlim **offers the run**, the day's own line reads
**"1 stop"** rather than "2 courier orders", and the Delivery dates screen's **Run (N)** button
appears on that day counting the same stops. **A Point is ONE stop however many customers collect
there**, so two customers at Farlim still read **1 stop - 6 items**.

**⚠️ AND ONE RULE NOW LIVES IN ONE PLACE, which is why it went wrong.** The run screen and the
Delivery dates screen's **Run (N)** button both have to answer __"does this order need a van?"__, and
they each answered it themselves. **Two readings of one rule is how they came apart**, so the rule
and the stop's own name are now asked of one function in `courier_job.js` and read from there.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. An
ordinary courier day behaves exactly as it always has, and a collection from your kitchen behaves
exactly as it always has — **a run with no Points on it is unchanged**. The suite is **2,679 tests,
all green**, including eleven new ones: six on the rule itself, three driving the run screen with a
**real** Point order, and two on the Run badge. **Every one of them was watched going red** with the
fault put back — the gate, the kitchen half, the shared stop name and the badge — before it was
called done. One of them is worth naming: the test fixture itself had been modelling a Point order
as a courier order, **which the shop has never produced**, and that is the reason nothing caught
this. **A fixture that cannot happen is not a test.**

**04 Oct 2026 — engine v301, THE DELIVERY RUN CARRIES POINTS (no database step, nothing to
upload — pushing this one is the whole of it).**

**Why.** This is the piece you asked for: the Delivery run carrying Self collection Points.

**★ A POINT IS ONE STOP, AND THAT IS THE WHOLE VERSION.** A courier charges **a base fare plus a
fee for every extra stop**, so the run screen's oldest rule is __one stop per customer__ — a customer
who bought three things is one doorstep, not three. A **Self collection Point is the next version
of the same idea**: four customers collecting at Farlim are **one place the van goes**. A run built
one-stop-per-customer would send the same driver back to the same shop and **bill you a stop fee
each time**.

**What you see on the run now.**

- **A Point gets a row of its own**, listing **how many orders are collecting there** — __"2 orders
  collecting here"__ — and its own address. The customer's name is deliberately **not** on it: the
  treats is going to Farlim and the customer is meeting it there.
- **The load line counts STOPS**, so two customers at one Point read **"1 stop · 6 items"**, not
  two stops. Every line of treats is still counted.
- **A Point you have not pinned offers "Pin the Point"** right there, because the run cannot price a
  trip to a place with no coordinates.
- **A Point and a doorstep on the same run are two stops** — the mixed run you described.

**Three things it is careful about, and each one is money.**

- **⚠️ THE VAN GOES TO THE POINT, NEVER TO THE CUSTOMER'S HOUSE.** A customer who chose to collect
  at Farlim is **not at Farlim** — and she may still have a doorstep of her own pinned from an
  earlier delivery. That door is **ignored** for a collection order. Sending a driver to her house
  with four other people's treats would be the most expensive way to be wrong on this screen.
- **⚠️ ONE DROP ON THE WIRE, and this is the one that shows up on your bill.** The price request is
  read back in the test on the **bytes that would leave your phone** — because a trip built
  one-drop-per-customer is priced for a journey you are not taking. Two customers at one Point:
  **one drop.**
- **⚠️ A POINT YOU PAUSE STILL SENDS THE VAN.** Pausing decides what is **offered**, never what an
  order already promised — the customer was already told to go to Farlim, and their treats still has
  to get there. And a Point you have **deleted** has no pin to give, so that order falls back to the
  customer's own door rather than a van sent to coordinates nobody has any more.

**And the double-booking guard still sees everyone.** A Point is treated as already on a trip if
**any** of its customers is — so a Point can never be quietly swept onto a second van, which is the
fault you reported in v242, at a place instead of a door.

**★ AND A POINT YOU ADD NOW ACTUALLY REACHES YOUR SHOP.** You reported this while the run was being
built — __"the point added still not able to appear on store?"__ — and **you were right, and the
fault was mine.** Your Points travel to the shop inside the **storefront row** the shop reads, and
**the Points card was not republishing that row.** Every other screen that changes something the
shop shows — Promo codes, Products, Categories, Settings — ends its save with a republish; the
Points card only ever saved to your phone. So a Point you added **stayed on your phone and never
went out**, and your shop went on offering only the Points it had last been told about. The test
proves it on the **request itself**: adding a Point **publishes**, pausing one **republishes**, and
**pinning one does not** — because the pin is deliberately never published, so republishing for a
drag would be a request that changes nothing.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. **A
run with no Points on it behaves exactly as it always has** — every order that is not collecting at
a Point keeps a row, and a stop, to itself. The suite is **2,668 tests, all green** — including two
new ones that fail if a Point change ever stops reaching your shop. Proved live on
the real Delivery run at a phone width, and on the wire: **two customers collecting at one Point
price ONE drop, at the Point's own address**, and the mixed run prices the Point and the doorstep as
two. The Points card was driven at a phone width too — **40 checks, all green** — including the
three that read the publish request itself, and every one of them was **watched going red** with the
fault put back before it was called done.

**04 Oct 2026 — engine v300, EVERY POINT GETS A PIN ON THE MAP (no database step, nothing to
upload — pushing this one is the whole of it).**

**Why.** You asked for the Delivery run to carry Points, and said a Point should **"get like what
customer is getting location pin"**. This is that pin — and it is the piece the run cannot work
without, which is why it comes first.

**A courier is not given an address. It is given a point.** Lalamove wants
**"5.41405,100.31408"**, and "Farlim, Air Itam" is a guess about one — the courier itself says so
when it cannot place an address. So **a Point with no pin is a name you can read and a place a van
cannot be sent to**, and the run cannot price a trip until every end is a real point.

**What a Point has now, on More → Self collection Points.**

- **A line saying where it is** — **📍 Farlim, Air Itam · 5.41405, 100.31408**. **Both the name and
  the two numbers**, because a name alone cannot be checked and a pin in the wrong place is only ever
  noticed by looking at the numbers.
- **"Put the pin on the map"** under every Point, opening **the same map a customer's doorstep is
  placed with**. It is the same act, so there is nothing new to learn — and your Point's own address
  is handed to the lookup, so if you have already typed where it is you may not have to drag anything.
- **An unpinned Point says so plainly**: __"Not pinned yet — a van cannot be sent to a name
  alone."__ It never pretends to have a door.
- Once it is pinned, the press becomes **"Move the pin"**.

**Two things this version is careful about.**

- **⚠️ Correcting a Point never un-pins it.** The pin is not a field of the form — it is placed on a
  map — so an edit had to be made to carry it across deliberately. Without that, fixing a spelling
  would have silently taken the door away, and you would have found out when a driver was sent
  nowhere. There is a test that edits a pinned Point and checks the pin is exactly where it was.
- **⚠️ The pin never leaves your app.** The shop is still told only the Point's **name** — a
  customer chooses a Point by name, and the driver is the only one who needs the door.

**And a half-typed pin is not a pin.** Anything malformed — one number and no other, a latitude of
91 — reads as **unpinned** rather than as a point in the sea. A row half-synced between your phones
can never send a driver somewhere absurd.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. Points
you have already defined simply start unpinned. The suite is **2,656 tests, all green**. Proved live
on the real card at a phone width: **37 checks**, including that an unpinned Point says so, that the
press opens the map picker, that a pinned Point shows its numbers, and that correcting a Point leaves
the pin where it was.

**Next, and it is the thing you actually asked for:** the **Delivery run** carrying Points. It is
its own version because the run screen is the one that spends your money, and it needs changing
carefully — a Point's orders have to become **one stop** on the trip rather than one stop each, and
the screen that ticks them has to say so.

**04 Oct 2026 — engine v299, THE CUSTOMER CAN COLLECT FROM A POINT (no database step, nothing to
upload — pushing this one is the whole of it).**

**Why.** v298 gave you the card that defines your Self collection Points. This is the other half:
**your customers can now choose one**, your order carries which one, and **the customer is told
where to go**.

**What your customers see, in the shop.**

- **"Collect from"**, under the Self collect / Courier choice. **Your kitchen is first** — it is not
  a Point and needs no record — and **your open Points follow, in your order.**
- **The whole thing only appears once you have a Point open.** With none, the shop is
  **byte-for-byte the shop it was**, which is how you said you would do it: one at a time.
- **The chosen row takes the brand's orange edge**, the same "this one is on" the buttons already
  use.
- **A Point paused or deleted while a customer has it chosen falls back to your kitchen.** The shop
  cannot post an order to a place you have stopped offering — and the kitchen is always there.

**What your customers are told.** The confirmation, and all four later messages, say
**"Self collect at Farlim, Air Itam"** and give the **address of the place**. That wording is
written **once** and read by both message builders, so a customer cannot be told one thing in the
confirmation and another in the reminder.

**Three things this version is careful about.**

- **⚠️ Only the Point's NAME ever leaves your app.** The receiver's name, their phone, the fee and
  even the address **stay in your app**. The shop is a public page with no login, and publishing the
  receiver's number would put a private person's phone on a page anyone can read. The address is
  withheld for a plainer reason: the message that tells a customer where to go is built from **your**
  copy.
- **⚠️ The name on an order comes from YOUR record, never from the page.** The shop is public, so a
  name it sent could be anything at all; the order is matched against **your own Points** and an id
  you do not have falls back to the kitchen. This is the same rule the promo codes follow.
- **⚠️ A Point you PAUSE is still honoured for orders already placed.** Pausing decides what is
  **offered**, never what an order already promised — the customer was already told where to go.
  Exactly the rule that keeps an ended promo code coming off the order it was placed on.

**And your own screens say it too.** The order row and the packing label read
**"Self collect · Farlim, Air Itam"**, so whoever is packing a bag can see where it is going. A
kitchen collection reads exactly as it always has.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key — the
Points travel in the storefront row your shop already reads. **Every order already placed is
unaffected**: an order with no Point IS a collection from your kitchen, which is what it has always
meant, so nothing needs migrating. The suite is 2,650 tests, all green. Proved live in the real shop
at a phone width: **20 checks**, including that the kitchen is first and carries no id, that a paused
Point cannot stay chosen, that with no Points open the shop is unchanged, and that a long Point name
does not push the page sideways.

**⚠️ 04 Oct 2026 — a correction to this entry.** This entry says your Points travel in the storefront
row your shop reads, and they do — **but only once your phone has actually republished that row**,
and the Points card was **not** republishing it. Adding a Point kept it on your phone and **never
sent it to the shop**, so the shop went on showing only the Points it had last been told about.
You reported exactly this — __"the point added still not able to appear on store"__ — and it is
fixed in **v301**: every change to a Point now republishes, which is the same call the Promo codes,
Products and Categories screens have always made. **Pinning a Point still does not republish**, on
purpose — the pin is never published at all. Nothing else in this entry changes.

**04 Oct 2026 — engine v298, SELF COLLECTION POINTS — THE CARD (no database step, nothing to
upload — pushing this one is the whole of it).**

**Why.** You asked to get the system ready for collecting from places that are not your kitchen
— Sg Ara, Farlim, Chai Leng Park, Bukit Mertajam — and to discuss it first. We did, and this is
the first piece of it: **the card**, which is the piece you scoped yourself.

Her words: __"we just need to have a card for points"__

**What you see now, on More → 📍 Self collection Points.**

- **A "New Self collection Point" card**, and your Points listed under it.
- **Five things per Point:** its name, the address, **who receives**, **their phone**, and **the
  fee per order** — what __you__ pay whoever receives there.
- **Pause · Edit · Delete** on every row. A paused Point sinks to the bottom and goes pale, and
  **Resume** brings it back.
- **Every Point is its own record**, so opening one changes nothing about the others — which is
  how you said you'd do it: __"open collection point one by one… and not likely will open all
  point one go."__

**Three things the card is careful about, and each is one of your rules.**

- **Your kitchen is NOT a Point.** Collecting from Sg Ara is what your shop already offers — free,
  no minimum, always there. It gets no record, no fee and no provider, because it has none of
  those. A Point is a __third__ thing beside it.
- **Delete never rewrites where an order went.** An order keeps the Point's **name frozen onto
  it**, so an order that went to Farlim still says Farlim after the Point is deleted — the same
  way an order keeps the name and price a product was sold at.
- **Pause is a normal ending, not a failure.** You said most Points you open will end this way, so
  pausing is one press and completely reversible.

**⚠️ WHAT THIS VERSION DOES NOT DO YET, said plainly rather than discovered.** This is the **card
only**. Your shop does **not** offer Points to customers yet, an **order does not carry which
Point** it went to, and the **Delivery run does not include them**. Those are the next pieces. So
today: you can define your Points and see them, and nothing else changes.

**And the fee is yours to set, with no arithmetic done for you.** You said __"allow me to manually
set it fee x2 or x3, but default x1"__ — so the app never measures an order's size. There is no
product-size field and no volume sum anywhere.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. One
new list is added and starts empty; no order, product, ingredient, price or posting day is touched.
The suite is 2,646 tests, all green. Proved live on the real card at a phone width: **26 checks**,
including that a nameless Point is refused with a reason, that pausing one Point leaves every other
alone, that deleting one leaves the order still saying where it went, and that nothing scrolls
sideways at 375px.

**04 Oct 2026 — engine v297, THE OFFERS REALLY FLIP, WITH DOTS, AND A CLICK NO LONGER
FREEZES THEM (no database step, nothing to upload — pushing this one is the whole of it).**

**Why.** Three things in one message, and the third was a fault of mine. Her words:
__"I dont like the flip, the flip should be 3D flip, and also i came with a flaw, once we put mouse
over it or click it, the flip stop, there should be 2 dot if there is 2 message, 3 dot if 3
message. move the mouse outside the window, the flip should be back"__

**1 — The flip is properly 3D now.** v296 turned both panels through the **same** arc — the old one
out one way, the new one in from where it had just left — which mirrors them the whole time and
reads as a vertical **squash**. Now the offer being replaced tips **away over the top** while the
next rises from **below**. Two panels turning through opposite arcs is a card turning over; that
one difference is the whole of it.

**2 — One dot per offer.** Two messages, two dots; three messages, three dots; **one message, no
dots at all** — the same rule that already leaves the turn unarmed, because one offer is a
statement. Pressing a dot goes straight to that offer, and **does not stop the turn**.

**3 — The flaw you found, and it was mine.** v292 paused the flip for **twenty seconds on any
click**. It was meant as the only pause a phone had, but it was a **clock, not the pointer** — so
clicking the strip trapped it for twenty seconds, and moving the mouse away could not release it.
That is exactly the symptom you described. **The pointer being over the strip is now the whole of
the pause**, so moving the mouse out — of the strip, or out of the window entirely — always starts
it again.

**4 — I read your own design skill, which I should have done before touching this, and it caught
four things I had wrong:**

- **The dots were 22 pixels across. WCAG 2.5.8's floor is 24.** They are 28 now — the dot you see
  is still the same size as the ones on your homepage, and it is the button around it that carries
  the size.
- **They had no focus ring**, so anyone tabbing to them could not see where they were. They have
  one.
- **The turn used the same easing both ways.** Your skill says __ease-out coming in, ease-in going
  out__ — that is what it does now, and it is the difference between a turn that settles and one
  that just stops.
- **The turn was 420 milliseconds**, just outside the 250–400 band your skill names for a change
  like this. It is **380** now.

**One thing I did NOT change, and it is yours to call.** Your skill asks for body text to be pushed
toward **7:1 contrast** because your customers read it on a phone in Malaysian daylight. The offer
line sits at **5.3:1** — comfortably past the 4.5:1 that is required, but short of that goal.
Getting to 7:1 means darkening the amber text noticeably, which is a change to how the strip
looks. Say the word and it is one line.

**What I could not check from here, said plainly.** The preview pane was off-screen the whole time,
and **a hidden page does not run animations at all** — so I could verify __where__ each panel ends up
(it is the opposite side, which is the 3D fact) but **I could not watch the turn itself**. Please
look at it on your phone. Everything else was measured: the strip holds **169.4 pixels** and the
page below it **380.1**, identical on every single turn, so the dots have not brought the jumping
back.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no key. The
shop's page and nothing else. The suite is 2,635 tests, all green. Proved live on the real shop
page at a phone width: **26 checks**, including that a click no longer freezes the turn, that a
pointer leaving the window starts it again, that pressing a dot goes to that offer without
stopping the turn, and that the two panels sit on opposite sides.

**04 Oct 2026 — engine v296, THE OFFERS FLIP RATHER THAN FADE (no database step, nothing
to upload — pushing this one is the whole of it).**

**Why.** Your question, straight after v295 landed: __"can the flip be an animation"__.
Until now the offers cross-faded into each other. Now they actually **turn**.

**What you see.** Each offer is a panel that **turns a quarter-turn into place**: the one
leaving tips away from you while the next swings up to face you. Straight on when it
settles, so it stays perfectly readable — it is the change between them that moves, never
the text you are reading.

**How the two halves stay out of each other's way.** Both panels travel through the same
angle as they swap, so if they faded at the same rate you would catch them **both
half-turned and half-visible in the middle** — which reads as a smudge rather than as a
turn. So the one leaving fades out quickly, in about a sixth of a second, and is gone
before it is half-way round; the one arriving holds its fade back until the turn is nearly
finished, then comes up. Two timing rules, no timer in the script.

**The height fix from v295 is untouched, and I checked rather than assumed.** A turn is
paint-only — it cannot change how tall anything is — but the same measurement was run
again with the animation in place, taken **mid-turn** rather than at rest: the strip holds
**135.4 pixels** and the page below it stays at **346.1**, exactly as before. So it flips
without the page moving.

**If a customer has asked their phone for less movement**, the offers still change — they
simply arrive facing them, with no turn. That setting has been respected here since v292
and still is.

**One thing to watch, and it is yours to tune.** The turn takes about four tenths of a
second out of every 1.5 seconds, so the words sit still for about a second. Whether that
is the right balance is much easier to judge on the real shop than in a description — if
it feels busy, say so, and either the turn gets quicker or the 1.5 seconds gets longer.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no
key. The shop's page and nothing else: no order, product, ingredient, price, posting day or
promo code is touched. The suite is 2,631 tests, all green. Proved live on the real shop
page at a phone width — 14 checks, all passing, measured mid-turn — and the turn itself was
frozen part-way round in a browser and looked at, to be sure it is a real turn and not a
squash.

**04 Oct 2026 — engine v295, THE SHOP'S OFFER STRIP STOPS MOVING THE PAGE (no database
step, nothing to upload — pushing this one is the whole of it).**

**Why.** Your report, two codes running: __"when the message switch, the page is like
jumping up and down repeatedly… The window should be fix, base on the tallest message."__
You were right, and it was mine to fix — **v292 caused it.**

**What was wrong.** The strip is only as tall as the message it is showing. When one of
your codes carries a sentence of your own and the other does not, those are **two
different heights** — so every time the strip turned, it grew or shrank and **everything
below it moved with it**. Measured on the fault, on a real browser at phone width: the
strip swung between **40.8 and 135.4 pixels** and dragged the whole page up and down by
almost a hundred pixels, every second and a half, for as long as a customer stayed on the
page.

**What it does now.**

- **The strip is exactly as tall as your TALLEST message, and never changes.** Every
  running offer is drawn at once and stacked under each other; only the current one is
  lit. The box is sized by the longest, so a short offer simply sits inside it. Measured
  again with the fix: the strip holds **135.4 pixels** and the page below it stays put at
  **346.1**, through turn after turn.
- **It turns every 1.5 seconds**, your number.
- **Pointing at it still stops it**, and a press on a phone still holds it — both unchanged.
- **The slight dimming is gentler** now that the offers come round twice as fast, so the
  words are readable for most of the time they are up.

**One thing worth knowing about the 1.5 seconds.** A two-line message — the offer plus a
sentence of yours — gives a customer about a second and a half to read it before it goes.
That is quick. It is exactly what you asked for and it is one number to change, so if it
turns out to be too fast once you watch it with real customers, say so.

**One more thing it fixes, quietly.** The lit offer now says which one it is to a screen
reader, and the others are marked as behind it — previously, with all the offers in the
strip, a reader could have taken all of them in turn as though they were one message.

**Your data is untouched, and there is nothing to run.** No database step, no upload, no
key. This is the shop's page and nothing else: no order, product, ingredient, price, bake
day or promo code is touched, and no code's terms change. The suite is 2,630 tests, all
green. Proved live on the real shop page at a phone width: 14 checks, including that the
strip's height is identical on every turn, that the page under it never moves, and that
the box measures the same whichever offer is lit. The fault was then put back on purpose —
the strip immediately swung 94.6 pixels and the checks went red — which is what proves the
measurement can see it.

**04 Oct 2026 — engine v294, THE INVOICE NUMBER IS THE ORDER'S OWN CODE (no database
step, nothing to upload — pushing this one is the whole of it).**

**Why.** Your words, the day v293 shipped: __"for the invoice, i think we can use the
order code as invoice number"__. You were right, and it turns out to be **simpler and
safer** than the running number v293 gave you.

**What an invoice is numbered with now.** The order's own code — **Invoice #A3F9C2** —
which is the same six characters already on that order's row, in the confirmation
message, in the payment reminder and on the customer's tracking card. **One order, one
reference, everywhere.**

**Three things that got better, and they are the reason this is a real improvement and
not just a preference.**

- **No two phones can ever take the same number.** The order code is unique by
  construction. The running number v293 used had one case where that was not guaranteed,
  and it had to be explained and accepted.
- **Pressing Invoice now writes nothing at all.** v293 stamped a number onto the order the
  first time you opened its invoice. There is no number to stamp now, so the press only
  reads — nothing on the order moves, and there is nothing to keep in step between your
  two phones.
- **There is no number for you to look up.** A reprint is the same invoice because the
  number was never stored in the first place.

**The trade-off, said plainly rather than discovered later.** The code is **not
sequential**: nothing on an invoice says how many you have issued, or which of two
invoices came first. And two different orders could in principle draw the same six
characters — that is the same risk the order tag has carried everywhere since the shop
was built, and it is unchanged by this version.

**Please read the v293 entry below with this in mind.** Everything in it still holds
except the number: the letterhead, the items at the price they were sold at, the courier
charge, the code taken off, the Total, Print and Share. Where that entry describes a
running number that goes up one each time, **this entry replaces it.**

**Your data is untouched, and there is nothing to run.** No database step, no upload, no
key. This version **removes** the two fields v293 could write onto an order, and writes
neither of them — an order you invoice is not touched at all, and no order, product,
ingredient or price is rewritten. The suite is 2,625 tests, all green. Proved live on the
real Orders screen at a phone width: 21 checks, including that the invoice number is the
order's own code, that making an invoice writes nothing onto the order, that opening it
twice is the same invoice, and that the paper carries your letterhead with your shop's
name said once.

**04 Oct 2026 — engine v293, AN INVOICE FOR A CUSTOMER (no database step, nothing
to upload — pushing this one is the whole of it).**

**Why.** Your words: __"And customer need an invoice"__. Asked what it should carry,
you chose __"One order, one invoice"__ and __"Yes — name, address, a number"__.

**What you see now, on Orders → any order → Invoice** (beside Edit and Note / tracking).

- **A card opens with the invoice on it**, and **Print** and **Share** underneath —
  the same two presses every other book in the app has. Share hands it over as a
  **PDF file**, so it goes into WhatsApp as a document the customer can keep.
- **It carries your real address at the top.** That address already exists — it is
  the one you typed for the Mailing labels in Settings, the same block that prints
  as FROM on a parcel. So an invoice and a parcel can never show two different
  addresses for one shop, and **there is nothing new to type**.
- **One order, one invoice.** The number is given the first time you open it and is
  never given again: open the same order next year and it is the same invoice, with
  the same number and the same date.
  **__(Superseded by v294, 04 Oct 2026: the number is now the order's own code —
  Invoice #A3F9C2 — so there is no number to give, nothing is written onto the order,
  and the two-phone caveat below no longer applies at all. Read the v294 entry at the
  top of this page.)__**
- **The order's own code prints beside the number** — __Invoice 0007 · Order
  #A3F9C2__ — which is what a real invoice does, and it means two invoices could
  never be confused for one another.
  **__(v294: the code is no longer beside the number — it IS the number.)__**

**What the paper says.** Your name and address, then **Invoice 0007 · Order #A3F9C2 ·
the date the order was placed**, then one row per item as **4 × Focaccia** with the
line total in the money column, the **courier charge** when the customer bears it, the
**code taken off as a minus row** named after the code, and finally the **Total**.

**Why the figures can never disagree with anything else.** Every figure on the invoice
is read from the one function your confirmation message, your tracking card and your
order rows already read, and the item names and prices are the ones **frozen onto the
order** — so an invoice for an old order never shows a product you have since renamed
or today's price. An invoice cannot state a sum the rest of the app contradicts.

**The one limit, said plainly rather than hidden.** Your two phones hold one shared
copy of your business, and a running invoice counter kept in Settings would be
**overwritten by whichever phone saved last** — numbers would repeat or skip without
warning. So the number is written **on the order itself**, which is a record of its
own and cannot be lost. The consequence: **two phones issuing an invoice in the same
instant could take the same number.** Nothing is lost when that happens — both
invoices exist, each on its own order — and the order code tells them apart. With one
person and two phones it is vanishingly unlikely, and the alternative would be an
invoice you cannot write without the internet, which is worse for a home business.
**__(Superseded by v294, 04 Oct 2026: the order's own code IS the number now, so this
whole limit is gone — there is no counter to share, and pressing Invoice writes nothing
at all. Read the v294 entry at the top of this page.)__**

**What is deliberately NOT on it.** Your customer's per-item note is not printed — it
is a production instruction, not a line item. Say the word if you would rather it were,
and it is a one-line change.

**Your data is untouched, and there is nothing to run.** No database step, no upload,
no key. Two fields are added to an order **only when you press Invoice on it** — an
order you never invoice is not touched at all, and no order, product, ingredient or
price is rewritten. The suite is 2,627 tests, all green. Proved live on the real
Orders screen at a phone width: 22 checks, including that the Total is the customer's
own total to the cent, that the number is written on every row of the cart, that
opening the invoice a second time is the same invoice, that Print really reaches the
printer, and that your address block never says your shop's name twice.

**04 Oct 2026 — engine v292, THE SHOP'S OFFERS TURN INSTEAD OF HIDING (no
database step, nothing to upload — pushing this one is the whole of it).**

**Why.** Your words: __"the public code shown in shop, if more than one hide behind
each other, we need a carousel, where it message turn, put the mouse over it stop
rotate."__ And you were reading it exactly right. The shop's offer line took the
**first** live public code and quietly dropped every other one — so a week when you
were running three offers, your shop was advertising one of them and hiding two
behind it.

**What your customers see now, at the top of the shop.**

- **Every code you have running takes its turn.** About six seconds each, then the
  next one — the same pace as the reviews carousel on your homepage.
- **The words fade; the strip does not.** The amber box stays exactly where it is
  and only the line inside it changes. The whole box blinking off and on would read
  as a broken page rather than as a second offer.
- **Point at it and it stops.** It waits while the pointer is over it and starts
  again when you move away.
- **On a phone, a tap holds it still for about twenty seconds** — long enough to
  read a long offer — and then it carries on by itself. A tap can never leave the
  strip stuck on one offer.
- **A background tab stops it**, and it starts again when the tab comes back.
- **With only one code running, nothing turns at all** — no movement, and literally
  no timer running. One offer is a statement, not a one-slide carousel.
- **And if a customer has asked their phone for less movement**, the words still
  change so they see every offer — they simply change without fading. The setting is
  about movement, not about hiding things from them.

**Which code shows first, and what counts as running.** The first one you published.
A code is advertised only if it is public, switched on, inside its dates and not
used up — asked through the same rule the code box already uses, so the standing
line and the box can never disagree about what "still running" means. A **personal**
code is never advertised; being unadvertised is the whole of what personal buys.
If you pause or end a code while someone is looking at the shop, the strip picks up
the change on its own and does not leave them reading an offer that has gone.

**Your data is untouched, and there is nothing to run.** No database step, no
upload, no key. This version changes the shop's page and nothing else — your orders,
products, ingredients, prices, posting days and promo codes are exactly as they were,
and no code's terms are changed by it. The suite is 2,611 tests, all green. Proved
live against the real shop page: 50 checks across three states — three codes
running, one code running, and three codes with reduced motion — including that the
turn wraps at the end, that hovering and pressing both stop it, that it starts
again by itself after a press, that a hidden tab stops it, and that the amber strip
itself is never faded.

**04 Oct 2026 — engine v291, A REWARD YOU CAN ACTUALLY HAND OVER (no database
step, nothing to upload — pushing this one is the whole of it).**

**Why.** You asked the question that made this version: __"how do we exercise their
reward, if the reward is only written text?"__ Until now the reward was a sentence on
the customer — you read it and settled up by hand, and the app neither reminded you
nor remembered what you had given. Nothing said **when** a reward had come round.

**What you see now, on More → Customers → open a customer.**

- **The reward is a card of its own on their record**, in amber so it does not
  read as the green bring-a-friend ledger below it.
- **It says what they brought in, and what is due.** __"9 brought in · every 5 · 1
  due"__ — the count is from your own orders, recounted every time, so nothing can
  double-count.
- **A Given button records the hand-over.** Their card then says __"1 given"__ with
  the date, so the next time you open them you can see what you have already settled.
- **Undo last takes a press back**, if you tapped it twice or they returned it.

**Their reward, and its number, are two separate boxes.** Your sentence stays exactly
as you wrote it — __"a free loaf for every five friends"__. Beside it is a number box,
**"Given every … customers brought in"**. Nothing is ever read out of your sentence:
a parser that misread "every five" would tell you a partner is owed a loaf you never
agreed to. Leave the number empty if it is not a set figure — the app still counts
what they brought in, it just never calls one due.

**What counts as "brought in" is one number, whichever way they work.** A friend with
a share link and a partner with a code are counted the same way, and a person can be
both — so the count is the union of the two, never their sum. A cart that carried both
a link and a code counts **once**. And a friend who had **already ordered from you**
is not a new customer here, exactly as the Give-credit button has always judged it.

**Every hand-over is its own record, and that is deliberate.** Both your phones hold
one shared copy of your business. A "rewards given" tally kept as a single number
would be **overwritten by whichever phone saved last** — one phone's hand-over would
vanish in silence. One record per hand-over cannot lose an update. It is the same
reason your credit ledger is a list.

**Nothing is ever blocked.** The Given button is offered whether or not the app's
arithmetic says a reward is due — you may settle a favour early, or hand one over for
a reason the app cannot see. The count is information, never a gate.

**Your data is untouched, and there is nothing to run.** No database step, no upload,
no new key. This version adds one new list and touches nothing you already have: your
orders, products, ingredients, prices, posting days and saved plans are exactly as they
were. The suite is 2,607 tests, all green. Proved live at a phone width: 29 checks,
including that a cart carrying both a link and a code counts once, that a second
hand-over is recorded rather than replacing the first, that Undo takes back exactly
one, and that the number box really reaches the customer's record.

**04 Oct 2026 — engine v290, YOU CAN ADD A CUSTOMER YOURSELF, AND READ YOUR
REMARK ON THE LIST (no database step, nothing to upload — pushing this one is the
whole of it).**

**Why.** Two things, and they arrived together. **A partner who has never ordered
from you had nowhere to live** — until now a person existed only by placing an
order, so a partner you recruited to hand out labels could not be named as a promo
code's owner. And you wanted to **read your note about someone without opening
them**.

**What you see now, on More → Customers.**

- **A "New customer" card.** Add someone by hand — a partner, or a friend who sends
  people your way. **A name or a number is enough**; everything else (their reward,
  their note, a photo) is written exactly where it always was.
- **They appear under their own heading: "Added by hand — no orders yet"**, at the
  bottom of the list, with a count. Their card opens like anyone else's, and
  fine-tuning their reward works there too.
- **Your remark now shows on the row itself**, so you can read it without opening
  anyone — in your own words, on one line, whichever is longest clipped with the
  full note still one tap away.

**The important part, and why they are in the same list rather than a separate one.**
Your customer list stays what it was — **people who have ordered**, with their spend
and their last order — and the people you added simply sit underneath, grouped.
They are counted, they export to the CSV, they can be messaged in bulk, and **they
are offered by the name box when you take an order**. That last one matters most: if
they had been kept in a list of their own, the day your partner finally ordered the
app would have offered you nothing, you would have typed the name and number by
hand, and that one person would have become **two records** — one keyed by name, one
by number, for good. **The moment they order they move up into the list proper, by
themselves.**

**Two things that would have read as faults.** A hand-added person has no orders,
and their row would have said **"0 orders · 0 units · about RM 0.00"** — the shape
this app uses for a broken screen. It now says what is true: __"Added by hand — no
orders yet"__. And opening their card said __"This customer's orders were removed"__,
which is untrue of someone who never had any, and reads as lost data. It now says
they have not ordered yet.

**No database step and nothing to upload** — `admin/` only.

**04 Oct 2026 — engine v289, A NAMED REWARD, AND A CODE THAT NAMES ITS PERSON
(no database step, nothing to upload — pushing this one is the whole of it).**

**Why.** Two schemes, one missing half each. The **bring-a-friend** link is for a
casual advocate and costs you nothing to hand out — but its reward could only ever
be a flat **RM3**, the same for everyone, set once in Settings. And a **promo code**
was anonymous: its orders and its label's opens were counted, but not __whose__ they
were, so a partner's label couldn't be told from anyone else's.

**Both stay, and the difference between them is the thing you hand over** — a __link__
for a friend, which travels and costs nothing; a __code and a label__ for a partner who
prints brochures and runs their own marketing.

**What you see now, in two places.**

- **On a customer's card** — a line you write yourself: **Reward**, e.g. __"a free
  loaf for every five friends"__. Not a number, because a partner may be owed a loaf,
  a favour, or an arrangement of their own. It sits in the profile block, above the
  bring-a-friend block, so it shows **whether or not that person has a WhatsApp
  number** — the casual friend-to-friend advocate is exactly the one who may not.
  The RM3 and 90-day settings are untouched and still the defaults.
- **On a promo code** — a new choice: **Whose code is this**. Pick a customer and
  their name appears on the code's row as __Aunty Bee's code__, beside "public —
  shown in the shop". Their label now tells itself apart from anyone else's, and the
  code's own count and opens are their tally.

**THE THING TO KNOW: their name is never published.** The data your shop is given is
readable by anyone holding its public key. A code's person is kept in your own app —
**never** sent to the shop, and **never** printed on the label. The label stays
impersonal, which is right for a piece of paper handed to whoever walks past.

**What the reward is, and is not, said plainly.** It is a **label you apply by hand**,
exactly like the credits. The app names it and counts what that person brought in; it
does **not** total what you owe, and it does not track what you have already given.
That is the trade for being able to write __"a free loaf"__ instead of a figure.

**No database step and nothing to upload** — `admin/` only.

**04 Oct 2026 — engine v288, HOW MANY TIMES EACH LABEL WAS OPENED.**
**⚠️ THIS ONE HAS A DATABASE STEP — run `supabase/promo_visits.sql` once, see
the box below.**

**Why.** You could already see what a code **sold**, worked out from your own
orders. What you could not see is whether the label was **picked up at all** —
and those are different problems needing different answers. __"Nobody followed the
link"__ means print more cards, or hand them out somewhere else. __"Forty people
followed it and two bought"__ means the card is fine and the offer needs work.

**What you see now.** On **More → Promo codes**, each code's row shows **how many
times its link was opened**, and under that a strip of the **last 28 days, one bar
a day** — so a label going cold is visible at a glance rather than something you
have to work out from a date list. A day with no opens is a faint stub rather than
a gap, so "quiet" never reads as "no data". A code the app __did__ get an answer for
and which nobody has opened yet says **"Not opened yet"** in words — that zero is
real and worth knowing.

**What the number is, and what it is not — please read this part.**

- It counts **opens, not people**. You chose that: a reload counts again, and a
  phone that leaves the page open counts once. It is a **pulse for alive-versus-
  cold**, not a headcount.
- **Sharing the link in WhatsApp or Facebook adds an open with nobody behind it** —
  those apps fetch a link to draw the preview. And your own testing counts.
- **A customer who types the code at the shop, with no link, is not counted.** This
  measures the CARDS, not the code in general.
- The app will not show a figure it does not have. If Supabase cannot be reached,
  the row is left **exactly as it was** rather than showing a zero — because a zero
  here is a claim ("nobody opened your label") and it must not be made on the
  strength of a request that never came back.

**⚙️ The one step, and it is yours: run `supabase/promo_visits.sql` once.** Open
**Supabase → your project → SQL Editor → New query**, paste the whole file, press
**Run**. It is safe to run more than once. **You can run it before or after you
push** — if you push first, nothing breaks: the shop's page simply fails to record
opens until the table exists, quietly, and the Promo screen shows no count. (Your
own browser's console will show a **404** while the table is missing. That is the
missing table, not a fault, and no customer ever sees it.)

**What was built, and why it is shaped this way.** One row is stored per open. The
shop page records it in the background and never waits for it — a visit that cannot
be recorded must not slow a customer down or change a word on the page. **The shop
counts an open once per page load**, which matters more than it sounds: that page
re-reads its settings every 30 seconds while it is open, so without that rule a
single customer leaving the tab open would have added an open every half-minute and
a label that sold nothing would have read as a triumph. Measured live: the settings
were re-read **7 times in one minute and the open was recorded exactly once**.

**No SQL runs on its own and nothing is uploaded** — the Edge Functions are untouched.

**04 Oct 2026 — engine v287, EVERY CODE HAS A LABEL, AND PRINTING NO LONGER
FREEZES IT (no database step, nothing to upload — pushing this one is the whole
of it).**

**Why.** In your words: __"instead of printed card, i think something like what we
have in shop and code is more useful, we have QRs, some active some retired, when
a promo code come together with a QR, when you tab on label, you are allow to copy,
print."__ Until now the only QR in the app was drawn on a **separate printed-card
page**, reached by a **Print it** press that was a deliberate point of no return —
it froze the offer permanently. There was no copy, and no QR anywhere on screen.

**Every code now has a label, on its own row.** Under **More → Promo codes**, each
code carries **its own QR**, so the list reads as a set of labels with the life
chips saying which are still going. **Tap the label** and it opens: the QR drawn
large enough to hold another phone up to, the link in words, **Copy link**, and
**Print it**. The square is built from the very address the printed card uses, so a
label and a card always point at one place — and **Copy link** pastes straight into
WhatsApp, where the shop opens with the code already in the box.

**A retired code keeps its label.** An **ended** code still shows its QR and still
offers **Copy link** — a dead link is worth being able to look at — but it is **not
offered a print**, because a label with an ended code in it would not work. It says
so rather than simply hiding the button.

**Printing no longer freezes anything.** Until this version, the first print pinned
the offer for good: the amount, who it is for, the smallest basket, what it cannot
sit beside and the name all stopped moving, an end date could only be moved later, a
ceiling could only be raised, and the code could not be deleted at all. **All of
that is gone.** Print and copy as often as you like, change the offer whenever you
like, and **retire a label by ending the code** — which is what ending was always
for: it stops new uses and leaves orders already placed with what they were promised.
There is no new thing to learn; **End** is the retirement, and **Pause** is the
reversible version of it.

**The one thing to know, and the app says it on the label itself.** A label already
in someone's hand is honoured at whatever the offer says when the customer **orders**,
not when they picked it up. So if you print a hundred cards and then change the offer,
those cards give the new offer. That is the trade, and it is better to read it here
than to find out from a customer.

**What has NOT changed.** A code still needs a **name** and a **cost ceiling** before
it can be given a label — a label carries no number and no end date, so the ceiling is
the only thing bounding what it can cost you. Editing a code still cannot reach back
into an order that already used it: every order keeps the code as it was written when
the customer typed it.

**No database step and nothing to upload.** This is `admin/` only — no SQL, no Edge
Function, no key. Pushing it is the whole of it.

**03 Oct 2026 — engine v286, A SUGGESTED PROMO CODE YOU CAN READ OFF A CARD (no
database step, nothing to upload — pushing this one is the whole of it).**

**Why.** You asked me to compare your promo codes with the printed-label codes
munchies used to run and see if there was anything worth taking. There was one
thing, and it is small: a code is read by eye **twice** — you type it when you make
it, and the customer types it off the printed card. The pairs people get wrong
doing that are **0 and O**, and **1 and I or L**. Your codes were allowed to
contain any of them.

**What you see now.** On **More → Promo codes**, the **New code** card has a
**Suggest one** button beside the code box. Press it and the box fills with a code
such as `PCX68` — five characters drawn from an alphabet with no **0**, **O**,
**1**, **I** or **L** in it, so there is nothing on the card to misread.

**Nothing is chosen for you.** The box is still yours to type in, and the button
only fills it — type over it, or ignore it and type your own code as you always
have. **Every code you already have keeps working exactly as it did**, including
ones with those characters in them: a code that is already printed cannot be
renamed, and none of them were touched.

**It will not hand you a name you already use.** Before suggesting, it checks
every code on the list and never offers one that is spoken for — two codes sharing
a name is the one thing the shop could not recover from, because it would take the
wrong amount off.

**The button leaves the room to the box.** The code box asks for a sensible minimum
width; if the screen is wide enough they sit on one line, and if it is not the
button drops below and the box takes the whole width. Either way the box is never
the part that gets squeezed — measured at a 375-pixel phone screen the box is 181
pixels beside the button, and on anything narrower it is 208 or more.

**Where this came from.** Munchies' printed-label codes carried the same idea, and
their comment names the reason exactly: __"a customer or the owner may type the code
by hand off a printed label, and those pairs are the ones people get wrong."__ This
is the only piece of theirs worth taking; the rest of theirs is a printed-label
pipeline for shops, which you do not have. **No database step and nothing to
upload.**

**03 Oct 2026 — engine v285, THE SHOPPING LIST CAN BE CORRECTED AT THE SHOP, AND
AN INGREDIENT KEEPS ITS PRICES (no database step, nothing to upload — pushing
this one is the whole of it).**

**Why.** In your words: __"PO, say it is created an base on the po we go shopping,
same supplier price change and we decide to buy more, i would like to change the
price and the qty, i need the PO to be amendable, ingredient price journaled,
ingredient price updated accordingly. So an ingredient need a journals."__ A saved
shopping list was frozen the moment it was saved. So when you got to the supplier
and the price had moved, or you decided to take more, there was nowhere to put
it — and the app's idea of what that ingredient costs stayed wrong until you
remembered to go and correct it on another screen.

**The list is now amendable — until you tap Bought.** On a saved list you now
have an **Amend** press. It opens the list with two boxes per line: **how many
packs** you took, and **what each pack cost**. Change either and the line's total
and the list's total follow as you type. You can also **Remove** a line you
didn't take, **add a line** for something you picked up that wasn't on the list,
and — if the shelf already covered something — press **buy some** on it to decide
to stock up anyway.

**Once you tap Bought, the list is what happened.** That is deliberate. Bought has
already put the packs on your shelf and asked you what you paid, so correcting the
list afterwards would mean unpicking both. Amend is offered only while the list is
still un-bought; the correction belongs at the shop, which is where you are when
you discover it.

**Your ingredient follows the price you actually paid.** Change a price on the
list, save, and the app writes that price onto the ingredient — so your recipes,
your product costs, and your next shopping list all use it, with nothing else to
set. The app tells you it did it rather than doing it quietly.

**And every price move is now recorded.** Open an ingredient and, once its price
has moved at least once, it carries a **Journal** press. It lists **only the
moments the price moved, newest last**, each row saying what it moved to and what
it was before — and with **the price you are on now at the top**, because a list of
changes on its own never says where you ended up. Buying the same thing again at
the same price is stock, not news, so it is not listed. The journal prints and
shares like every other book in the app, including as a PDF.

**Why a journal matters here.** Your Profit screen reads Cost of sales from your
recipes and the ingredient prices as they stand **today** — so changing a price
moves months that have already closed. That has always been true and the screen
says so; what was missing was any record of **when** a price moved, and this is it.

**A fault found and fixed while building this.** The **"What did you pay?"** box
you get after tapping Bought was **never pre-filled** with your list's total. It
had been reading the total from the wrong place since the box was built, so it
always opened blank and its sentence never named the figure. It is now filled in
from the list's own total, which is also what makes amending worth doing.

**What did not change.** Nothing that was already saved was rewritten, no figure
moved on its own, and the money is still recorded exactly where and when it always
was — at Bought, from the account you choose in that box. A list's own totals
still pre-fill that box. **No database step and nothing to upload.**

**03 Oct 2026 — engine v284, A LONG COURIER LINK NO LONGER RUNS OFF THE CARD
(no database step, nothing to upload — pushing this one is the whole of it).**

**Why.** A booked trip came back with a long tracking link — one unbroken run of about 150
characters, with no spaces anywhere in it. Your customer's card draws that link as
a **rounded button**, and a button cannot break a word it cannot find a space in.
So the link stayed one enormous line and grew straight out of the card and off the
screen.

**What you see now.** The link stays **inside** the card. It wraps onto as many
lines as it needs, and the button grows downwards instead of sideways. Nothing
else about the card moved: the wording, the order of the lines, the money and the
progress line are all exactly as they were, and the link still opens the courier's
own page in a new tab.

**A short link is untouched.** Measured on the card at a 375-pixel phone screen:
a short link such as `https://track.jt.com.my/A3F9C2` is still exactly the **38
pixels** tall it has always been, because the button's own floor and its centring
are unchanged. Only a link long enough to need a second line behaves differently.

**Measured before and after, on an order.** The order's link is 131
characters. Before: it ran past the card's right edge and off the screen. After:
it wraps to five lines, its right edge sits at 344 against the card's 361, and the
page no longer scrolls sideways — the page's own scroll width equals the phone's
width. **Your backoffice card was never affected**: the booked-trip card on your
own screen already carried this rule, so both of your screens now stop a long link
the same way.

**Where else that link is drawn — checked, not assumed.** You asked me to check
everywhere it lives, so I did. The link is stored once, on the order, and reaches
your customer in three places: the **customer's track card** (the one that was
broken — fixed here); the **shipped WhatsApp message**, which carries it as plain
text that WhatsApp wraps in the chat itself, so it was never at risk; and your
**own booked-trip card**, which was already right. The delivery-run screen only
mentions it in a passing message, and the orders list draws it as a number to read
out rather than a link, so neither of those can overflow.

**No database step, and nothing to upload.** This is one style rule in the shop's
stylesheet — no SQL, no Edge Function, no key, and your
data is untouched. Pushing it is the whole of it.

**03 Oct 2026 — engine v283, SHARE SENDS THE JOURNAL AS A PDF FILE (no database
step, nothing to upload — pushing this one is the whole of it).**

**Why.** You pressed Share on a journal and the share sheet opened **without
WhatsApp in it**. Nothing was broken — a phone is handed a journal as ordinary
text, and WhatsApp does not offer itself for a bare block of text. It does offer
itself for a **file**. You said to make it share by PDF, and that is what this is.

**What you see now.** The **Share** button does the same thing it always did, and
what comes out of it is different: the journal arrives in the chat as a **PDF
document** — `Cash journal.pdf`, `Profit and loss.pdf` — which you can open, keep,
forward and print again. It is listed for Mail, Notes and Save to Files exactly as
before, and WhatsApp is on that list now.

**Worked out with your phone, in this order.** The app asks the phone what it can
take rather than assuming:

- The phone can share a file — you get the **PDF**, which is what happens on yours.
- The phone says it can share, but not a file — you get the journal as **text**,
  so it still leaves the app rather than nothing happening.
- The phone has no share sheet at all — the **PDF is saved to the phone** and a
  short message says so. You send it from WhatsApp yourself.
- Even saving is impossible — the journal is **copied** instead, with a message
  saying so.

**If you open the share sheet and change your mind**, closing it does nothing
else. Nothing is copied and nothing is saved behind your back, at any of those
four steps. A cancel is your decision, not a fault.

**What is on the document.** Your shop name as a letterhead, the journal's name
and the stretch it covers, every row and every total in the same words and the
same order as the screen, the note that explains the figures, and along the bottom
`From More → Profit · printed 3 Oct 2026`. Money that went out reads `-RM 12.00`.
A long journal runs onto a second page, which says at the top what it continues.
A4, black on white, 20 mm margins. It is about 3 KB — small enough for any chat.

**Print has not changed.** The Print button still opens the phone's own print
sheet, and **Save as PDF** is still a choice inside it.

**What did not change.** No figure moved and no rule about your money changed. The
screen is identical. The document is a fourth rendering of the same journal the
screen, the paper and the sent message already shared, so the figure in the file
is the figure on the screen, to the cent.

**03 Oct 2026 — engine v282, EVERY JOURNAL CAN LEAVE THE SCREEN: PRINT IT OR SEND
IT (no database step, nothing to upload — pushing this one is the whole of it).**

**What you asked for.** You were reading a journal and said: __"those journals in
profits and other journals should be printable and able to be shared"__. Until
now a journal existed only inside the pop-up you were scrolling. You could read
it, and there was no way to hand it to anyone or keep it.

**What you see now.** Every journal in the app wears the same two buttons, in the
same order, under its last line:

- **Print** — the phone's own print sheet opens with the journal on it. That is
  also where **Save as PDF** lives, so a journal can leave as a file.
- **Share** — the phone's own share sheet opens with the journal as plain text,
  ready to go straight into WhatsApp, Mail or Notes.
  - A phone with no share sheet — or a share that fails for any other reason —
    **copies the journal instead** and says so in a short message. You paste it
    wherever you want it. The fallback carries exactly the same text the share
    sheet would have been handed.
  - **If you open the share sheet and change your mind**, closing it does nothing
    else. The journal is not copied behind your back. A cancel is your decision,
    not a fault.
  - __Superseded the next day by v283: the phone is handed a PDF file now, not
    plain text, because WhatsApp was not appearing in the share sheet.__

**Where the two buttons are.** Every book in the app:

- **More → Profit** — the Sales journal, the Cost of sales journal, and every
  spending category's journal, including Total expenses.
- **More → Profit** — the **Profit and loss** statement itself. You chose that
  the whole statement gets the pair and not only the journals: Sales down to Net
  profit, with its two notes underneath. A journal on its own is half a document,
  and this is the other half.
- **More → Money** — one method's book, opened either from its row on the screen
  or from **Books**. In Books, only the book you have opened can print; the list
  underneath never does.

**What the printed sheet says.** Your shop name as a letterhead, then what the
journal is and the stretch it covers; every row and every total, in the same words
and the same order as the screen; a line in the journal's own words saying what
the figures mean and where they come from; and along the bottom, `From More →
Profit · printed 3 Oct 2026`. The statement's sheet carries the Cost of sales note
as well, because anyone reading Gross profit needs it. It is plain black on white.

**One rule this build rests on.** The screen, the paper and the sent message are
three renderings of **one** description of the journal. They cannot disagree about
a row or a total: whatever figure is on the screen is on the paper to the cent, and
the same figure is in the message.

**On the phone.** Pressing Print opens the phone's real print dialog — the same one
any other app uses — and **Save as PDF** is a choice inside it. Choosing a printer
there is the only way to see the true paper; the sheet itself is built by the app.

**What did not change.** No figure moved, and no rule about your money changed.
Every pop-up looks as it did; the two new buttons sit under the last line of each.

**3 Oct 2026 — no new engine (still v281), THE "SHOPS & CODES" SCREEN IS RETIRED (nothing to run,
nothing to upload — pushing this one is the whole of it).**

**Why.** The More menu carried two code screens side by side — **Shops & codes** (the pet shops you
hand samples to, the printed QR labels, the page a scan opened, and the scan counts) and **Promo
codes** (the codes a customer types at the shop). You said the promo code was meant to replace the
other and only one should survive. That is now so: **Promo codes stays exactly as it is; Shops &
codes is gone.**

**What went.** The **Shops & codes** screen; the pet-shop sample list; the printed QR labels and the
page a scan opened (the whole stand-alone landing page); the **Label visits** counts; the "Scan a
label" camera; and the line an order carried when a customer had arrived by scanning a card. The
shop page no longer states a scanned label's offer, because there are no labels any more. An order
the customer typed a **promo** code onto is untouched by any of this.

**What stayed, and it is the part that matters.** Everything on **Promo codes**: making a code,
what it gives, whether the shop may show it, pausing and ending it, the printed promo card with its
QR, the "Have a code?" box on the shop, and the code coming off the total. Bring-a-friend, the
delivery calendar, and every order's own record are untouched too — only the label/QR-label side
has gone.

**What you must do.** Nothing but push. There is no SQL to paste, no Edge Function to upload and
nothing to change on the phones. You confirmed no QR labels are out with any shop, so no card in
anyone's hand breaks — the addresses those labels used to open are simply gone.

**3 Oct 2026 — engine v281, THE STATEMENT SAYS WHAT KIND OF COST IT IS SHOWING (no database step,
nothing to upload — pushing this one is the whole of it).**

**Why.** You asked whether Cost of sales is really your recipe's ingredient cost — the theoretical
figure — rather than money you had spent. It is, and the screen did not say so where the figure is.
It only said a part of it in the small print underneath, and nothing at all about the part that
matters most: that the cost is read from your recipe and your ingredient prices __as they stand
today__.

**What you see now, on More → Profit.** A short line sits under **Gross profit**, inside the
statement, in the same quiet grey as the other notes:

- **"Cost of sales is built from the recipe and the ingredient prices you have recorded, read as they
  stand today — so editing a recipe or a price moves past months too. It is not what you actually
  spent. Gross profit is therefore a guide to your pricing, not your bank balance — the Money screen
  is where the cash is."**

Two things that follow from it, now said on the screen rather than left for you to work out:

- **A month that has already closed can still move.** If you fix a recipe, or update what an
  ingredient costs, the Cost of sales of a past month changes with it, and so does that month's gross
  profit. The sold price never moves — that is frozen on the order — but the cost side is read fresh
  every time you look.
- **Gross profit and Net profit are a plan, not a bank balance.** What you really spent is cash, and
  the Money screen is where you check it. A gap between the two is normal and not a fault.

**The small print at the bottom changed too**, so the two do not repeat each other. It now leads with
the cash half — a pack bought today is cash on the Money screen and stock on the shelf, and only
becomes cost of sales as the treats made from it are sold.

**What did not change.** No figure moved. The Sales journal, the Cost of sales journal, the month
arrows and every spending line behave exactly as they did in v280. This is words on the screen,
nothing else.

**3 Oct 2026 — engine v280, THE WHOLE STATEMENT OPENS: SALES AND COST OF SALES TOO (no database
step, nothing to upload — pushing this one is the whole of it).**

**What you asked for.** You were on More → Profit, reading the statement, and asked: __"at the
profit section, can the sales and cost of sales be clickable to reveal its journal"__. The spending
lines had opened on a tap since 17 September; these two did not.

**What you see now.** Tap **Sales** and its journal opens; tap **Cost of sales** and that one opens.
Both read the same orders — one from the side of what the customer paid, the other from the side of
what your recipes say those treats cost to make — so the two can never disagree about which orders
the month held. Each row is one order line: the day it is delivered, what sold and how many, and the
customer's own name, with the figure on the right. A product you have since renamed or deleted still
reads as the treat that was sold, because the name is the one frozen on the order. The rows land on
the figure you tapped, exactly. A line your recipe prices at nothing is marked "no recipe cost"
rather than sitting there as a plain RM 0.00, and the footer counts them — that is a profit reading
too high, the one thing worth chasing here. A month with nothing in it opens and says so.

**One thing that stays a figure, not a door.** Gross profit and Net profit are worked out from the
lines above them, so they have no rows of their own to open.

**3 Oct 2026 — engine v279, THE PRINTED CARD: PRINT IT, AND THE OFFER IS FIXED (no database step,
nothing to upload — pushing this one is the whole of it).**

**What you asked for.** Of the eleven promo steps, step 6 — Print it — was the last one with nothing
behind it, and it is the step that puts a code into a customer's hand. You asked for the printed card
next.

**What you see now, on More → Promo codes.** A **public** code's row has a **Print it** button, first
ahead of Edit and Delete, and only where a card makes sense: on a public code, never on one that has
**ended**, and never on one **already printed** — that one wears its "Printed — fixed" chip instead. A
**paused** code can still be printed, because pausing is a break. Pressing it asks first, and the
question is honest: from here the amount, who it is for, the smallest basket and the name all go on
saying what they say, because the card in a customer's hand cannot be amended; the end date may be
moved later (never earlier) and that is all that stays yours. **It refuses a code with no cost
ceiling, and says why** — a card carries no number and no end date, so the ceiling is the only thing
left bounding what the card can cost you. A code with no name is refused too.

**What the card looks like.** A new tab opens on a print-sized page holding **four identical cards on
one sheet of A4**, with a hairline guide to cut along. Each card carries your shop name and tagline,
the offer in the customer's own words, the smallest basket if there is one, your own sentence when you
wrote one, the rules that stay true ("First order only", "One per customer", "Not with the
bring-a-friend welcome discount"), the code in large letters, and a square to scan. The square points
at your shop with the code already filled in, and the same address is printed underneath in words — so
a card that ever pointed somewhere wrong would be wrong visibly, on the paper, before anyone was handed
it. It carries **no end date, no count and no ceiling figure** on purpose: those three are promises
paper cannot keep. Opened by itself the page never prints a blank sheet — with no code, or an unknown
one, it says so and offers no Print button at all. Once a code is printed you can still raise its
ceiling, extend its end date and end it; you cannot change what it gives, who it is for, or the
smallest basket.

**3 Oct 2026 — engine v278, A CODE'S LIFE: PAUSE, END, AND WHAT PRINTING FIXES (no database step,
nothing to upload — pushing this one is the whole of it).**

**What you asked for.** The Promo codes screen had a half-finished piece: the eleven management steps
were a plain grey box, and the Pause and End controls were not wired to anything. You chose __"Finish
it properly"__.

**Every row now says what its code's life is.** A chip on the name: **Paused**, **Ended**, or
**Printed — fixed** (a live code wears nothing). **Pause** and **End** sit on the row under the offer,
and they are different on purpose: Pause is a break — the shop stops offering and accepting the code,
it switches back on any time, and nothing about the orders already carrying it changes; End is final —
new uses stop and it cannot be switched back on. Both say what they are about to do first, including
how many orders already hold the promise, and that they keep it either way, because ending stops new
uses and never rewrites history.

**A printed code is fixed.** Once a code is on a card in someone's hand, the offer has to go on being
true, so a printed code refuses any change to what it gives, who it is for, the smallest basket, what
it cannot sit beside, or its name. Two things stay open, one way round only: the end date may be moved
later or dropped, never pulled earlier; the ceiling may be raised or removed, never lowered. The Edit
button on such a row reads **"Update the end date and ceiling"**. A printed code cannot be deleted
either — the tap says why, and names End instead.

**The eleven steps fold.** The life of a promotion, in order, is a proper list under a fold line, and
the fold line is the answer you came for: "1 live · 1 paused · 1 ended · RM 20.00 given away".
Printing, step six, is the only one that cannot be undone, so it is the only shaded row, and it says
**point of no return** in words rather than by colour alone.

**3 Oct 2026 — engine v277, THE MONEY LINED UP IN ONE COLUMN (no database step, nothing to upload —
pushing this one is the whole of it).**

**What you asked for.** The day after the receipt you said: __"the format still not as clear as a
receipt, the money have to align up"__. Asked which screen looked wrong you named the customer's
tracking page and your own order list; asked what lining up meant, you picked **"Line up in one
column"**.

**The customer's tracking page.** The figures now line up in one right-hand column, and the
decimal points sit on that line. **On this shop the card keeps its own shape, and that is
deliberate.** Your shop adds a flat nationwide postage to every posted order, and that fee is never
published, so the card cannot work out an items subtotal from the total it is given — it would be
wrong by the postage. So the card keeps the one line it has always drawn, "what they ordered — the
total", which cannot be wrong because it names no subtotal at all. What the card *does* name, and now
does name, is the code the customer used: the discount is published on the order itself, so no
working out is needed. See the v272 entry below.

**The order list.** Every order row now ends with its own total, on a line of its own across the foot
of the row, at the same right edge as every other row. Before this a row said "×2" and stopped — the
one screen you work from all day was the one place an order's money never reached. Three things worth
knowing: it is one figure worked out once, so the row, the receipt and the customer's message can
never disagree; an order nobody has priced says nothing rather than "RM 0.00"; and the WhatsApp
message is deliberately unchanged, because you were shown both ways and chose the plain lines.

**3 Oct 2026 — engine v276, AN ORDER'S MONEY READS AS A RECEIPT (no database step, nothing to
upload — pushing this one is the whole of it).**

**What you asked for.** __"can the showing of promo be more streight forward, clearer, like putting
them in an accounting format, clearly shown the working, how they add up."__ So the promo showing was
rebuilt the way the Profit statement already reads. On both screens that show an order's money — the
Edit pop-up and the Note / tracking card — the one run-on sentence is replaced by a receipt: Items
total, Courier charge, Promo FRESH10, a dashed hairline, then Total.

**Four things this changed.** A code that gave nothing is now a **line on the receipt reading RM
0.00**, not left out — before, an order that carried a code which paid nothing looked identical to one
with no code at all. The reason sits under the figures in your own terms: the basket the code wanted,
the basket this order was, and a plain statement that the rule is a **guide**, not a gate. The
customer's WhatsApp message says the same thing in one quiet line, "Code FRESH10 not applied: basket
below RM 100.00", where before it said nothing. And nothing about a missed code touches the money:
the line explains, it never deducts. An order with no code is unchanged, line for line.

**3 Oct 2026 — engine v275, A DISCOUNT NOBODY EARNED (no database step, nothing to upload — pushing
this one is the whole of it).**

**What you reported.** __"the arithmatic is not rigght, the fresh10 promo code discount 10 for order
of 100, but my order only 16, it deduct 10 and customer have to pay 6 only. if thats the case bakery
will broke."__ You were right, and it was the worst kind of wrong: nothing crashed, nothing looked
odd, and the app quietly took money off an order that had never earned it.

**What happened.** A code has two separate things about it, and only one was being asked. The shop's
box has always asked "is this basket big enough for this code at all?" and refuses a code below its
smallest basket. But the arithmetic that takes the money off only ever asked "what is this offer worth
on these goods?" — a question about the offer, not about the sale. So once a code was on an order, the
smallest basket was never looked at again.

**The fix.** The smallest basket is now asked wherever the money is worked out, which is one place —
the same single figure the customer messages and your own screens all read. A code on an order whose
basket never reached its smallest basket now gives nothing, and the order reads exactly as one with no
code. The tally on your Promo codes screen counts it the same way, so such an order counts RM0 given
and cannot eat a ceiling it never touched — though it still counts as a use, since the code did ride on
the order. **What has not changed:** a code you have since paused, ended or used up still comes off the
order it was actually placed on. Nothing here blocks an order or refuses a code you want to honour; it
only stops the app doing arithmetic on a discount that was never earned.

**3 Oct 2026 — engine v274, THE SHOP'S OWN SENTENCE IN THE HAND YOU PICKED (no database step, nothing
to upload — pushing this one is the whole of it).**

**You picked the chalk hand** — rounder and fatter, like chalk on a board — from five real versions
drawn inside the shop's own strip. The amber strip at the top of the shop has two lines. The first, the
offer and the code, is untouched: same lettering, same size, still first, because it is the part a
customer has to act on. The **second line** — the words you wrote yourself about the code — is now set
in the chalk hand, and a little larger than before, so it reads as your own note under the offer rather
than a second announcement. **One limit, said plainly:** the hand is a Latin face and carries no
Chinese characters, so a sentence you write in Chinese keeps exactly the plain lettering it has always
had — the words are the same and nothing moves, it simply cannot wear the hand. English and Bahasa
Malaysia wear it. The font travels inside the shop, in the shop's own folder with its licence, so
nothing is fetched from a font company when a customer opens the page.

**3 Oct 2026 — engine v273, YOUR MESSAGES IN A VOICE YOU CHOSE (no database step, nothing to upload —
pushing this one is the whole of it).**

**One limit, said plainly.** A font cannot be chosen in a WhatsApp message — WhatsApp carries no fonts
at all, and its only four marks are bold, italics, strikethrough and monospace. So the closest thing
that exists is making your opening line lean over. **Message style, on More → Settings**, is a card
with one choice, and it applies to all four messages you send a customer: **Plain** — exactly what you
send today, the default, word for word the message that went out before this card existed — or **the
greeting leans over**, where only the first line moves, and only into italics. One switch for all four
on purpose: four separate switches are four ways for your messages to end up opening differently from
each other. The bold Total is not affected, and the choice travels to your other phone.

**3 Oct 2026 — engine v272, THE CODE COMES OFF THE TOTAL (ONE SMALL DATABASE STEP FIRST — run it
before you push, the order matters; nothing to upload otherwise).**

**What you reported.** __"pushed. The whatsapp message still withhout the promo discount."__ You were
right, and this time it was a design that had gone stale: since the code arrived, it rode on the order
and every discount was taken off by you, by hand, in WhatsApp. You have now said the app should do
that arithmetic itself, and this is that.

**The code now comes off the Total** in all four places the customer reads it — the confirmation, the
payment reminder, the "on its way" message, and their own track page — as its own line, named by the
code, between the workings and the total, so the figure can still be added up by the person reading
it: __Total: RM 30.00 · Promo FRESH10: -RM 10.00 · To pay: RM 20.00__ (shown here in this shop's own
words). On your own screen the two figures you read move with it — the amount the customer owes in the
Note / tracking window and the Order total in the Edit window — and the "Still to collect" figure on
your Money screen follows, because it was always worked out from the same number.

**What does not change.** An order with no code reads word for word as it did before. A code that has
since been paused, ended or used up still comes off the order it was actually placed on: ending a code
is a decision about future orders, and it never reaches back and re-prices one you have already
promised. A code whose terms come to nothing on this order prints no line rather than -RM 0.00. A
discount larger than the order leaves you asking for RM 0.00, never a negative. A percentage comes off
the goods and not off the courier's charge. A free-delivery code has nothing to waive on a Collect
order, so it says nothing.

**THE DATABASE STEP — do this first, before you push.** In your Supabase SQL editor, run the file
**supabase/promo_track.sql** (Dashboard, SQL, New query, paste, Run). It adds two columns,
`promo_code` and `promo_rm`, to the customer tracking table. **Order matters here:** your app
publishes a whole tracking row in one call, and if those columns do not exist yet that call is refused
as a whole and the customer's tracking page stops updating for every order, not only the orders that
carried a code. This is the same trap the courier charge tables set. Run the SQL once, then push. It is
safe to run twice.

**One thing that has not changed, so it does not surprise you.** Your sales and profit figures still
count the full price of what you sold; the discount comes out of the money you actually collect, not
out of the goods' own value. That is a real question about where a discount should sit in your books,
and it is yours to decide.

**3 Oct 2026 — engine v271, A CODE THAT KNOWS WHEN TO STOP (no database step, nothing to upload —
pushing this one is the whole of it).**

**A card has no number on it and no end date on it** — deliberately, because a date is a promise a
card cannot keep. That left one real question: how does a code with a card stop being a good idea? Now
you say so yourself, on the code screen. The new box, **"Stop after giving away (RM)"**, stops the
code the moment it has given away that much money. It sits beside the order limit, and whichever runs
out first is the end of it — so you can say "the first 5 orders, or RM50, whichever comes first".
Leave it empty and the code has no limit at all. It works for every kind of code, including a
percentage, which otherwise has no natural end.

**Where the numbers come from matters.** They are counted from your own orders, freshly, every single
time — not kept in a tally on the code, so the figure cannot drift. A basket counts once: a customer
who orders three things in one go used the code once. Your screen shows how far through its limits a
code is, and a code that has finished says so in an amber banner. The customer never sees the figure
or the reason: they get the one sentence, "that code has been fully claimed". A code that has given
away everything you allowed stops being advertised at the top of the shop — so after you push, **open
the app once on your phone with a connection** and the shop will be told.

**3 Oct 2026 — engine v270, THE CODE THAT WAS THERE ALL ALONG, AND A PROMO SCREEN WITH SOMETHING TO
SAY (no database step, nothing to upload — pushing this one is the whole of it).**

**What you reported.** __"i dont see the promo code fresh10 send over to app together with the
order."__ You were right: the code had been travelling with the order since v269, but no screen ever
showed it — and a code that arrives and cannot be read is a code that did not arrive. An order placed
with a code now wears a small amber **FRESH10** tag beside its order number, on every row you read an
order on: the delivery day's list, the unread inbox at the top, the search results, and the Edit order
window. It shows the code itself and not the word "promo", because you take the money off by hand, so
which code it was is what tells you whether it is RM10 or RM5. An order placed without a code looks
exactly as it always did.

**The shop's line now says the whole offer** — the smallest basket it works on and, when you have set
one, the day it runs out: "Today: RM10.00 off on RM30.00 and above, until 31 October — use code
FRESH10". And you can add your own sentence to it, in English, Chinese and Bahasa Malaysia, with a
**Translate** button that fills the two other languages and never overwrites anything you typed. The
code screen is now a full one: who it is for, when it runs, the smallest basket, how often it can be
used, what it cannot be used with, and who can see it — all optional, all defaulting to the widest,
simplest answer. **The shop now says exactly why it will not take a code** — nine plain sentences,
including "that code ended on 30 September", which names the day so it does not read as a glitch. Two
of those are stated rather than refused: the shop is a public page with no sign-in, so "once per
customer" and "first order only" can only ever be a good guess, and a rule on the website must never
block or hide a sale you take by hand.

**3 Oct 2026 — engine v269, PROMO CODES, THE FIRST SLICE (no database step, nothing to upload —
pushing this one is the whole of it).**

**What is new for you.** A new screen, **Promo codes**, at the bottom of the **More** menu. You make
a code there: the code itself, what it gives, and whether the shop may show it to everybody or you are
giving it to one person. Three kinds of offer are in this first version — a ringgit amount off, a
percentage off, or free delivery.

**What is new for your customers.** The shop page has a **Have a code?** box. A customer types the
code and presses **Use it**. If it is a code you made, the page says what it gives and tells them you
will take it off when you confirm the order. And when you are running a code the shop may show, the top
of the page carries a line naming it — for example __Today: RM10.00 off, use code FRESH10__.

**The most important thing about it.** The total on the shop page **never moves**. A code does not
change what the customer is charged; it is a note that travels with the order, and you take the money
off by hand in WhatsApp exactly as you already do for the bring-a-friend credit. An order that used a
code carries that code into your app. A code you made on one phone also reaches your other phone. One
thing worth knowing about "personal" codes: a personal code is never shown on the shop page and never
advertised, but the shop's own data is readable by anyone who looks at the page, so personal means
**never shown** and not **secret**.

**3 Oct 2026 — engine v268, FIVE PLACES THAT DISAGREED WITH EACH OTHER (no database step, nothing to
upload — pushing this one is the whole of it).**

**What you said.** __"pushed. when i schange the courier delivery to self pickup, the courier chages
tag still there, just wondering are details well taken care of?"__ — and then the audit you asked for:
__"pls run whole system audit for the well being of the system later"__. v267 had fixed the tag you
could see; reading the whole system after it turned up four more places where one screen had been told
the truth about a self-collect order and another had not, and one button that made a claim it could not
know. They are all the same fault underneath: a fact is written on the order, and only some of the
screens that read it ask the companion question that goes with it.

**Five things, fixed together.** (1) The customer's track card was still being sent the courier's half
of a self-collect order — a driver's name, a plate, a phone number, "on the way", a waybill — and it
now publishes none of it. (2) The trip card counted a parked charge, and now counts only the orders
actually going by courier. (3) Picking **Cash** or **TNG transfer** on an order wrote down how they
paid and stopped there, so the row could wear a TNG tag while the day's till, the Money screen and the
customer's card all still counted it as owing — it now records the payment itself, with **Not
recorded** as the way back. (4) **Print label** vanished the moment the order was packed; it is now on
every stage from Baked to the end. (5) **Send confirmation** turned the order green before the message
was sent — it opens WhatsApp but does not press Send — so the button now only drafts the message, and a
small **I have sent it** beside it is what turns Confirmed green. One extra tap on each confirmation,
in exchange for never marking something sent that was not.

**3 Oct 2026 — engine v267, A COURIER CHARGE GOES QUIET WHILE THE ORDER IS A SELF COLLECT (no database
step, nothing to upload — pushing this one is the whole of it).**

**What you said.** __"when i schange the courier delivery to self pickup, the courier chages tag still
there, just wondering are details well taken care of?"__ and __"confirmation message still include
courier charges"__.

**What was happening.** Switching an order from Courier to Self collect never deleted the courier
charge, on purpose — you might switch back. But nothing on the reading side ever asked whether the
order was still going by courier. So a self-collect order went on wearing a **Courier RM 8.00** tag on
its row, went on adding that RM8 into the customer's total in the confirmation message, in every
WhatsApp message and on their track card, and went on being counted in **Still to collect** on your
Money screen.

**An order that is a Self collect now carries nothing for a courier to charge for.** The charge is
parked, not thrown away: it is still written on the order, so switching **Fulfilment** back to Courier
brings the whole thing back exactly as it was, with nothing to type again. Both courier charge cards
say in words that the charge is recorded but not added to the customer's total while the order is a
self collect, and that switching Fulfilment back is how it goes back to work.

**3 Oct 2026 — engine v266, A BUTTON SAYS WHAT HAPPENS IF YOU PRESS IT, AND WHAT HAPPENS IF YOU DON'T
(no database step, nothing to upload — pushing this one is the whole of it).**

**What you said.** __"when i see the button, i might self have to ask, i dont know what will happen or
what will happen if i din press that button, these create confusion"__.

**What was happening.** Two places put a choice in front of you without saying what the choice cost. On
the **shop page**, the line above the pin buttons read "Optional: drop a pin where the courier should
stop" — which tells a customer the pin does not matter without telling them what they get if they do
it, or lose if they skip it. It now answers both halves: skip this and the driver goes to the address
you typed, which is fine for most houses; pin it only if the address alone will not find your door; and
either way put the block and unit number in the address above. Written in all three languages. In your
own **pin window**, the **Coordinates** box with its **Use these numbers** button stood open under
every map; it now comes out only when the map cannot load, so the sentence that names it points at
something really there. On a working map it waits behind one small button reading **Have a Google Maps
link?**, because a Google Maps link is the most accurate point a customer ever sends you.

**3 Oct 2026 — engine v265, THE CONSIGNMENT BOX IS A PARCEL'S, SO IT IS DRAWN WITH THE PARCEL (no
database step, nothing to upload — pushing this one is the whole of it).**

**What you said.** __"after i get price from lalamove, click use this fee, it closes the window, but
user might confuse as at that page there is stick fields that user have not fill in"__. On the **+ New
order** card the courier half drew the **Courier tracking number** box on every courier order, whatever
kind of courier it was — and a consignment number is a parcel's, not a Lalamove trip's. So on a trip
that box was empty, about nothing, and stood beside a finished price: that is what read as an order
with something still to fill in. The box now belongs to the parcel, so it is drawn with the parcel and
nowhere else. Nothing became unreachable: the parcel carrier picker is still on the card, saying **Not
a parcel — nothing recorded** until you pick one, and a number you had already typed is never hidden.
The Edit window and the Note / tracking box keep the layout they had.

**3 Oct 2026 — engine v264, A TAP ON THE MAP DOES NOT MOVE THE PIN (no database step, nothing to
upload — pushing this one is the whole of it).**

**What you said.** __"click on the map should not move the pin, only dragging the pin will"__. A tap
on the map no longer moves the pin; only dragging the pin itself moves it — on both maps you use to
place a pin, the order form's pin map and the pin window. Why it matters on a phone: that map is a
200-pixel strip inside a card you scroll, and before this any accidental touch moved the pin to
wherever your finger landed and pulled the map onto that spot, two things at once from one touch you
did not mean. The one place a tap still works: a map with nothing on it yet has no pin to move and
nothing to drag, so there a tap places the first pin. The shop's own customer map was deliberately left
alone — for a customer the map is often the only way to place their pin at all.

**3 Oct 2026 — engine v263, A DAY YOU DO NOT DELIVER IS DARKER STILL (no database step, nothing to
upload — pushing this one is the whole of it).**

**What you said.** __"can make the quite day more solid?"__, asked straight after seeing v262. A day
you do not deliver is now a solid, dark day — v262 had taken the fade off it, but it was still faint.
It is now very nearly twice as strong again. The colour sits exactly halfway between the app's quiet
grey and its ink, so it reads as a real day rather than a whisper, while still looking nothing like a
day you deliver. A day you deliver is still twice as dark as a day you do not, so the two can never be
mistaken for each other. The past grey itself is untouched, and one case is deliberately left faint: on
a product's availability calendar, a day you have marked as selling but which you do not deliver is
kept faded on purpose, because it means "this mark cannot become an order".

**3 Oct 2026 — engine v262, A DAY YOU DO NOT DELIVER IS SOLID, AND THE PAST IS ONE GREY AT LAST (no
database step, nothing to upload — pushing this one is the whole of it).**

**What you said.** __"I still feel that the greyed and the non grey contrast is not big?"__ — and then,
when offered the choice, make the non-grey more solid. v261 had put the shop's grey in the right place,
but it left the older half-transparent rule standing on a day you do not deliver. That half
transparency is applied to whatever colour the day ends up with, so the past was still being drawn in
two shades — and worse, a past day you do not deliver came out fainter than a future day you do not,
which is backwards. With the fade gone, a day you do not deliver is a solid, plainly readable day, and
the past is now genuinely one shade: a past day you deliver and a past day you do not are the identical
colour on screen. The shop's past grey itself is untouched, and anything on a past day that is telling
you something — a delivery day's green pill, a product's green tint — keeps its own colour.

**3 Oct 2026 — engine v261, EVERY CALENDAR NOW GREYS OUT A PAST DAY THE SAME WAY YOUR SHOP DOES (no
database step, nothing to upload — pushing this one is the whole of it).**

**What you asked.** __"Is all calendar passed day grey out same thru all calendar? I like the one at
store."__ It was not. On the Orders calendar a day that had gone by came out in two different greys
side by side in the same row — one shade for the days you deliver, a slightly different one for the
days you do not. On the other calendars there was only one grey, but it was the app's own faded grey,
not the shop's — and the shop's is the one you picked. A day already gone is now drawn in the shop's
own quiet grey, flat and one shade, whether or not you deliver that day: the Orders calendar, the
calendar inside Delivery Dates, the small calendar you open when you pick a delivery day, and the days
you mark on a product's availability. Nothing ahead of today is touched, and anything on a past day
that is telling you something keeps its own colour.

**3 Oct 2026 — engine v260, YOUR MAILS NOW COME FROM YOUR OWN SHOP'S NAME, NOT THE APP'S (two
functions must be uploaded — pushing alone does not change this one).**

**What a customer saw.** The two mails this system sends — the wish-list mail you send out, and a
customer's suggestion coming back to you from the shop page — each arrived with the name at the top of
the inbox list reading **"BakeAdmin wishes"**. BakeAdmin is the app's own internal name: a word that
appears nowhere on your homepage, nowhere in your shop, and on no label you print. It was the first
thing a customer read from you, before they opened anything.

**What they see now.** **Munchies Furkidz** — your own name, taken from your homepage title, which is
where your brand is written down. The address the mail is actually sent from has not moved: it is the
same verified address as before, and only the name in front of it changed.

**One thing to check, because it can silently win.** If the project has a saved setting called
`RESEND_FROM`, that setting is used instead of the name in the code, and this change would make no
difference to what a customer sees. Run `supabase secrets list` in Terminal to see whether it is set.

**Why pushing this one is not enough.** These two mails are sent by the two functions that live in
Supabase, not by the app on your phone. Uploading the code — a push — leaves Supabase running the old
copy. Both functions must be uploaded separately, from the repository folder: `wish-mail` and
`shop-feedback`. This changelog cannot do that part for you.

**No database step.** Nothing was added or changed in the database, and no existing setting moved.

**1 Oct 2026 — engine v259, AN ORDER'S EDIT CARD NO LONGER CLOSES ITSELF WHEN YOU LOOK AN ADDRESS
UP AGAIN (no database step, no redeploy, one push).**

**The fault, and it is one word.** Pressing "Look this address up again" inside an order's Edit
card found the address, wrote it onto the order, and then saved and closed the card — dropping you
on the Orders list with no chance to ask for a delivery price. The card declares its own button
called "Save changes", and that name silently took over the app's own saving step for the whole of
that card's code. So the one press did two jobs: it saved, and then it closed.

**The saving is kept apart from the button now.** The address is written down and the card you are
working in stays open, with the price press still there to use.

**How the cause was pinned down.** The tracking pop-up's own look-up carries the same saving step
and was never broken, because it has no button of its own to shadow it. That difference is what
named the fault rather than another guess at it.

**1 Oct 2026 — engine v258, THE APP NOW TELLS YOU WHEN YOUR PHONE IS RUNNING AN OLD BUILD (no
database step, no redeploy, one push).**

**This is the real answer to a fault you reported five times.** The fix was in the app; your phone
was still running an older copy of it. The site that serves your app lets a phone hold each file
for ten minutes, and the app is a single page you leave open, so a phone could keep yesterday's
build for as long as it stayed open. Worse, the Engine number on More reads a different file from
the one carrying a fix, so it could vouch for a build that was not the one running — which is why
the fault kept coming back after a fix had been published.

**Two halves fix it.**

- **The app re-checks its own files with the site before using its saved copy.** An unchanged file
  costs almost nothing to check; a changed one is fetched whole. Pictures are left alone.
- **An amber strip above the tab bar when the two differ.** It says which build is on the phone and
  which the site is serving, in plain words, with a single "Update now" press.

**It is never a dead control.** If the strip is still there after you press Update now, it stops
offering the button and tells you to close the app completely and open it again.

**30 Sep 2026 — engine v257, A PRESS ON A CONFIRMATION NO LONGER FOLDS THE CARD YOU ARE WRITING
(no database step, no redeploy, one push).**

**This was reported three times: landing back on the Orders list with a half-written order gone.**
The + New order card folds away when you press anywhere outside it, which is meant, so a stray
press never traps you in it. But the confirmation the card itself opens is drawn on a layer beside
the page rather than inside it, so pressing "Reset the pin" on that confirmation counted as a press
outside the card and folded the one you were writing — while the door's own look-up carried on and
wrote the order.

**A press landing inside the card's own confirmation now counts as a press on the card**, so the
card stays open. A press on the page itself still folds the card, exactly as before, and a layer
that is not showing shields nothing.

**v255 and v256 both changed the pin picker's "Look it up".** The reports you sent were about the
door block's "Look this address up again", and this is that fix.

**30 Sep 2026 — engine v256, THE LIST OF MATCHING ADDRESSES FLOATS, SO A LOOK-UP STOPS THROWING
THE CARD ABOUT (no database step, no redeploy, one push).**

**The pin picker's list of other matches was sitting in the card itself, above the map.** With
several matches the list was taller than the room it had, so everything under it was pushed down —
carrying the box you were typing in, and the button you had just pressed, up off the top of the
screen. That is the "it exits the page" you described.

**The list floats under the button now and takes up no room at all.** Nothing below it is shoved
anywhere: the button stays exactly where your finger left it, the card does not scroll, and only
the one answer line moves. The list's height no longer matters — it behaves the same with two
matches and with four.

**Picking a row now closes the list**, so it stops covering the map you most likely wanted to look
at next. The door block's own "Look this address up again" was re-measured at the same time and was
found not to have this fault.

**30 Sep 2026 — engine v255, LOOKING AN ADDRESS UP NO LONGER THROWS THE PIN CARD AROUND (no
database step, no redeploy, one push).**

**Your report: "when i say look this address up, why the interface jump out of the page?"** The
press you meant was the pin picker's own "Look it up". With four matches the list of other
addresses is taller than a phone's screen, and it sat in the card above the map, so the map — and
the "Use this spot" button under it — were shoved a whole screen down and off the page. The button
you pressed did not move at all, which is exactly why it read as the page jumping rather than as
the list pushing things down.

**The pin card now holds its place while the address is looked up**, using the same
hold-this-still rule the delivery-price card already had: the row of buttons you are working with
keeps its screen spot while the words below it extend downwards.

**That rule now lives in one shared place**, so every screen that grows while you watch uses the
same one and they cannot drift apart. Both of the app's scrolling areas — the page itself, and the
inside of a pop-up — are handled.

**30 Sep 2026 — engine v254, THE NEW-ORDER CARD HOLDS STILL, AND THE BUTTON NOW SAYS PLACE ORDER
(no database step, no redeploy, one push).**

**Three faults from your own report, all in the + New order card.**

- **The card grew under your finger on a pin reset.** A reset can change the card's height in
  eleven ways at once, and nothing held the screen still. The row of buttons under your thumb is
  now what the card is pinned to, so the row keeps its place and the words below it extend
  downwards.
- **Maps left running after their card had gone.** Each rebuild of the price block left a live map
  behind on a background listener, and one of them could paint over the confirmation box. They are
  now swept away once their card has left the page.
- **The button that finishes a new order now reads "+ Place Order".** The card's own title is still
  "+ New order", the "+ New order" button on Home is untouched, and an order's Edit card still ends
  on "Save changes".

**Measured, not guessed.** At a 375-pixel phone the button row held to the pixel while the page
scrolled; a press that made a map appear used to move everything below it by 210 pixels. And the
overlap with the confirmation box measured 16 spoiled rows of 24 before the fix, none after.

**30 Sep 2026 — engine v253, THE FEEDBACK MAIL NOW READS IN THE SAME ORDER AS YOUR WISH-LIST
MAIL (no database step, but the shop-feedback function must be redeployed).**

**The heading block moved to the top, and the customer's words now come last.** v252 put the
words first and the heading underneath a short rule. You asked for the wish-list mail to be the
reference, and the wish-list mail does the opposite: it opens with what the mail is, then who it
is about and when, and puts the content underneath. So the feedback mail now does exactly that,
with no rule in between and no closing line:

    New feedback for the shop page (Engine v253).

    Project: munchies.com.my/store/

    Sent: 2026-09-30 17:31

    Written in English.

    the words the customer typed

**The language is written out as a word.** v252 printed the short code it was handed, so the
line read "Written in en." The shop asks its questions in three languages, so the line is worth
having — but "en" is not a word anybody reads. It says **Written in English.**, **Written in
Malay.** or **Written in Chinese.** now, and it is left out entirely when the page did not say
which language the customer was reading.

**The subject line and the Project line are unchanged** from v252: the subject is still
`Shop feedback · Engine v<n> · <date>`, the project is still the live address the customer was
reading, and the time is still on your own clock in Penang. Only the order of the body and the
wording of the language line moved.

**One step on your machine.** The part of this that builds the email lives on your Supabase
project, not on GitHub, so pushing is not enough on its own. After pushing this version,
redeploy it once:

    supabase functions deploy shop-feedback --project-ref ircwozniiyywsowamixy

**30 Sep 2026 — engine v252, THE FEEDBACK MAIL SAYS WHICH SHOP AND WHICH BUILD, AND THE SHOP PAGE
NOW SAYS WHICH BUILD IT IS RUNNING (no database step, but the shop-feedback function must be
redeployed).**

**A customer's message now arrives with the same kind of heading your wish-list mail has.**
Before this version the email was the customer's words and nothing else, so a message saying
"the cart is confusing" could have come from either of your shops and from any build of the
page. Every one of these emails now carries:

- **Project** — the address the customer was actually reading, for example
  munchies.com.my/store. It is read off the live page rather than typed in anywhere, so your two
  shops can never be confused for one another, and the second half names which page of that shop
  the words were written on.
- **Sent** — the date and time on **your** clock, Penang time, so "16:52" means the same thing on
  the email, on your phone and in the backoffice.
- **Engine** — the build the customer was looking at, both in the subject line and in the line
  above the project, so you can tell whether a comment about the shop came from a phone that is
  still running yesterday's copy.
- **Written in** — the language, when the customer was reading the shop in Malay or Chinese.

**And the shop itself now says which build it is running.** At the very foot of the shop page,
under "Website by" and the developer's WhatsApp and email links, there is a new small line:

    Engine v252

**It is the same number your app shows on More**, and the two are read from one file rather than
kept as two copies that could drift apart. That is the point of it: when a customer tells you
something looks wrong, you can compare the number at the foot of their shop page with the number
on your own More screen and know in one glance whether they are seeing the same page you are. It
is the smallest type on the page and the same muted grey as the credit above it, in the
developer's own corner, out of the way of everything a customer came for.

**One step on your machine.** The part of this that builds the email lives on Supabase, so it
must be redeployed once, exactly as before:

    supabase functions deploy shop-feedback --project-ref ircwozniiyywsowamixy

Nothing else to set up — no new secret, no new database table, no new key. The email reuses the
same Resend account your wish list already sends with, and the same published settings row the
shop page reads for its "Website by" line.

**30 Sep 2026 — engine v251, THE SHOP'S QUESTION IN YOUR OWN WORDS (no database step, no
redeploy, one push).**

**The line at the foot of the shop now reads exactly as you wrote it.** "Webmaster: Like the
User Interface? Tell me & I will improve it!" — your words, your punctuation, with "Tell me"
back where you put it.

**It is a measurement, not a rewrite, and this version takes the measurement in both
directions.** A phone gives that box about 323px of room, and "the User Interface" spelled out
costs about 150px of that on its own. Your sentence runs to about 377px, so on a phone it takes
**two lines** — and the guard built for exactly this opens the box to show the whole question
rather than cutting the end off it. Nothing is clipped on any phone: at 320px the box simply
opens a little further, and the page never scrolls sideways.

**The Malay is your own sentence and holds one line — as long as it keeps the shape you wrote it
in.** It carries no "Webmaster:" prefix for that reason: the prefix would add another 76px and
push it onto a second line. The English and Chinese still say who is asking. The Chinese needed
no change at all — it already used the everyday word for a screen's interface.

**30 Sep 2026 — engine v250, THE SHOP'S QUESTION SPELLS OUT "USER INTERFACE" (no database step,
no redeploy, one push).**

**Shorthand is out.** You looked at the built page and said it plainly — "UI should be user
interface, ui is not a laymen term" — so the line at the foot of the shop read "Webmaster: Like
the user interface? I'll improve it", with the Malay and Chinese equivalents.

**And it stayed one line on a phone, which is what made this a measurement rather than a
rewrite.** A phone gives that box about 323px of room, and "user interface" spelled out takes
about 150px of it on its own. The full sentence you first wrote runs to about 373px — wider than
the box — so its tail would have been cut off. Everything you asked for was kept: who is asking,
the question in full words, and the promise that it gets improved. Only "Let me know" went,
because the question mark and a box waiting to be typed in already say it.

**30 Sep 2026 — engine v249, THE BOX AT THE FOOT OF THE SHOP SAYS WHO IS ASKING (no database
step, no redeploy, one push).**

The one quiet line at the foot of the shop page now introduces itself. It reads "Webmaster: Like
this UI? Tell me, I'll make it better" — the customer types over that sentence exactly as before,
and the whole of it still goes out as their own words when they send, with nothing to press but
Enter.

**And if a phone is narrow enough that the question does wrap anyway**, the box now opens itself
to show the whole question instead of hiding the rest. That is the one thing this version can do
that a shorter sentence alone could not: on any phone, in any of the three languages, the
customer always sees the entire question rather than its first line.

**30 Sep 2026 — engine v248, NOBODY HAS TO PRESS ANYTHING, AND NOBODY LOSES WHAT THEY WROTE (no
database step, no redeploy — the same one function, one push).**

Two more things you asked for on the little box at the foot of the shop.

**Closing the page is now a send.** A customer who writes a sentence and then closes the shop,
or taps a link out of it, has had their say — the words go as they leave, without them pressing
Enter at all. **Nothing goes out while they are still on the page**, so a sentence somebody is
midway through writing is never mailed off behind their back. Pressing Enter is still a send, and
still shows your reply straight away.

**And nothing they wrote is lost on the way.** If they step away from the box with words in it,
or the page is closed before anything could be sent, the sentence is **kept on their own device**
and is waiting in the box the next time they open the shop — it goes only once it has been sent.
If a send does not go through, their words are put back, so a failure nobody was around to read
is never a sentence lost. And **with no internet, nothing is sent at all**: the words simply wait
on their device for the next visit instead of going down with the page.

**And the Bahasa Malaysia has been rewritten to read the way Malaysians actually write.** Several
lines on the shop were correct textbook Malay but nobody writes that way on a Malaysian website —
"pembangun" for your developer, "telah" where anyone here would say "sudah", "Menghantar…" where a
shop would say "Sedang dihantar…", and a reply that read like a letter from an office rather than
from you. The words are the same promise, in the voice a Malaysian customer expects.

**The Chinese is now Malaysian Chinese**, which is what your customers read. Malaysian Chinese
read simplified characters exactly as mainland China does, so the characters stay as they are —
what changes is the words: the items count used the mainland measure word rather than the one a
Malaysian uses, the basket was called a shopping bag, and the two arrows on the delivery calendar
were in **traditional** characters, which is simply the wrong script for your customers.
Taiwanese Chinese was not used: it would mean changing every character to traditional, and your
customers do not read that.

**30 Sep 2026 — engine v247, THE SHOP FRONT NOW ASKS THE CUSTOMER WHAT THEY WOULD CHANGE (no
database step, one new function to deploy once, one push).**

You asked for a way for a customer to tell your developer what they would improve about the shop
page, in their own words, with a reply straight away.

**A single line now sits at the foot of the shop, under the "Website by" line.** It is printed
with your own question, and the customer types over that sentence and presses **Enter**. There is
no Send button, because you asked for none: Enter is the send. The line is one line tall and opens
further only when the words no longer fit, so at rest the whole thing is a single quiet row at the
foot of the page. Once there are words in the box a small grey line under it says **"Press Enter
to send"**, so the one key that does something is never something they have to discover by
accident.

The moment the send lands, the box is replaced by your reply — **"Your idea is well taken care
of. New updates soon!"** — so they see the answer without doing anything else. They are never
asked for an email address, and nothing is created on your side for them.

**The words come to you as an ordinary email**, at the developer address you already set in
**Settings → Website & developer** — the same address the shop's "Website by" line shows. It
runs on the **same email service your wish list already uses**, so there is no new account, no new
key and no new DNS record. Each message says which page it was written on, in which of the three
languages, and when it arrived.

**There is no box until you have set that address**, because the box has nowhere to send to
without it. That is on purpose: a box that quietly collects sentences nobody will ever read is
worse than no box at all.

**A send that did not go through says so, plainly.** If the email could not be sent the customer
is told, in words, to try again or to use the WhatsApp link that is already drawn just above the
box — and **their words stay in the box**, exactly as typed, so nothing they wrote is lost. A
thank-you drawn over a message that never left would stop them trying again and nobody would ever
find out, so that is the one thing this never does.

**It speaks all three languages.** The question, the line that says how to send and the reply are
written in English, Chinese and Bahasa Malaysia, and a customer who switches language keeps
whatever they had half-typed and whatever reply they had already been given.

**What you have to do, once.** This needs one small new function deployed in Supabase the same
way the wish-list function was — the file is `supabase/functions/shop-feedback`. Until it is
deployed the box still appears and still says plainly that the send did not go through. Nothing
else is required: no database step, no new key, no new setting — it uses the developer email you
have already saved.

**30 Sep 2026 — engine v246, THE NOTES ON THE ITEMS ARE NOW UNDERLINED ON THE COMPACT LABEL TOO (no
database step, no redeploy, one push).**

You spotted this one: on the Compact label a note like **no nuts** was printing as ordinary words, while
the same note stood out on the Full and Mailing labels. It was the last place a customer's own words went
unmarked, and it was easy to miss — Compact puts every item on ONE line, so the note sat in the middle of
that line with nothing to pick it out.

**Each noted item's words are underlined on that joined line now**, on the item they belong to, so a note
on the second of four items is underlined on the second item and not somewhere else on the line. **If two
items carry the same note, each one gets its own underline** — the line is not allowed to mark one item
twice and leave the other plain.

**The line itself has not changed at all.** It reads exactly as it did — the items in order, the notes in
brackets beside the item they belong to — and a label for an order with no notes on it is byte-for-byte
what it was. Nothing else about any label moved: the Full, Mailing and Name-only styles print exactly as
they did, and the delivery note on the Compact label is untouched by this.

**30 Sep 2026 — engine v245, THE DELIVERY NOTE IS UNDERLINED TOO, AND IT NOW PRINTS ON THE COMPACT
LABEL (no database step, no redeploy, one push).**

You made the point that the **delivery note** is not a courier thing — it applies to a self-collect order
just as much, so it should stand out and be printed wherever it belongs.

**It is underlined now wherever it is drawn.** The order row carries it as `Aunty Bee · 012-345 6789 ·
deliver after 3pm`, with the note itself drawn under, exactly as a note on a single item already was. The
same on the printed label: the `Note:` line keeps its label plain and underlines the customer's words.

**The Compact label prints it too.** Compact used to join every item onto one line and leave the delivery
note off entirely — so a note about the doorstep, the gate code or a collect time disappeared the moment
you picked the denser label, on a self-collect order as much as a courier one. It now prints in the same
place the Full label puts it: after the items, before the posting address.

**Everything else is unchanged.** The Mailing and Full labels read exactly as they did, the note box is
still offered on both self-collect and courier orders, and an order with no note on it looks and prints
exactly as before. Name-only stays a bag tag — code and name, no fields to read.

**30 Sep 2026 — engine v244, A NOTE A CUSTOMER LEAVES ON ONE ITEM IS NOW UNDERLINED, SO IT IS
HARD TO MISS (no database step, no redeploy, one push).**

You asked where the words a customer leaves actually reach you. The answer turned out to be uneven: the
**delivery note** on the whole order pings your phone the moment the order lands, but the **note on a single
item** — "no nuts", "write Happy Birthday" — only ever lived inside the app, sitting quietly in grey beside
its item where it is easy to skim past. You decided that is enough for it to be **underlined**, so it reads
as something you were meant to notice.

**On the Orders list**, an item that carries the customer's own words now has those words underlined —
`Chicken Jerky 100g ×2 (no nuts)` with the brackets drawn under. It is the same line in the same place, just
marked. Nothing moves, nothing is added, and an order with no notes on it looks exactly as it did.

**On the printed label**, the note beside its item is underlined the same way, on both the Full sheet and
the Mailing sheet — so what you hold in your hand while you kit an order is as easy to read as the screen.

**The line itself is unchanged.** Only the way it is drawn changed, so the row, the label and the search
still read the very same words — the underline cannot quietly disagree with what the line says.

**30 Sep 2026 — engine v243, THE DELIVERY-DAY CALENDAR IN THE ORDER SCREENS NOW FOLLOWS TODAY, THE
SAME AS YOUR SHOP (no database step, no redeploy, one push).**

Your words: you wanted the calendar in the ＋ New order card to behave like the one on your shop.

It does now, and it is the **same calendar in all three places it appears** — the ＋ New order card, the
strip at the top of Orders, and the day picker in the Edit-order pop-up. One behaviour in three places, so
a day sits in the same square wherever you meet it.

**What was wrong with it.** It was a **month** — the whole of September, then the whole of October —
exactly the calendar v231 replaced on your shop, for the same reason. On the 30th, most of what it drew
was days already gone; a delivery day on the 29th could not be seen at all; and both arrows were drawn
even at the ends, so a greyed button sat there inviting a press that would do nothing.

**From this version it is five whole weeks anchored on today.** The first row is the week just gone, the
second row is this week with today ringed so you can see where "now" is, and the three rows under it are
the weeks ahead, which is where your delivery days actually live. Today is always in the second row.
**Every square is a real date now** — no blanks, no padding, so a delivery day at the start of next month
is visible and openable from the moment you publish it.

**Your delivery days are unchanged on it.** Still circled, still carrying how booked each one is under the
number, still FULL in red where a day is at capacity, and a day already gone still dimmed but **still open**
— you backfill and review old days. A day you do not deliver still answers a tap, and still names where it
gets added, so a holiday falling on a day you do not deliver is never the one square with nothing to say.

**The arrows move one whole week, and are gone where there is nowhere to go.** A dead control reads as a
bug, so at the ends of the days you have set there is simply **no arrow** — nothing greyed out, nothing to
press that would do nothing. The window still stops where your shop's stops for the same list, so the two
calendars agree about where the far end is. A new week arrives **sliding up** going forward and **coming
down** going back — the direction you are travelling in — and only when you pressed an arrow: an ordinary
redraw never replays it.

**The marks you made on Delivery Dates are on it too** — the same single-day boxes and the same see-through
bands, in their own colours and their own depths.

**It opens on the day you are working on, not on today.** The Edit-order pop-up opens on the day that order
is actually on, so moving an order a season out does not leave you looking at a week with nothing to do
with it. And picking a day that is already on screen **does not move the window**, so the grid never slides
out from under your finger.

**One thing I deliberately left alone.** v231 ended with "nothing in the backoffice calendars changed; this
is the shop's calendar only" — that was your instruction then, and this version is you asking for the
opposite, for this one calendar. The **look** of the past days in the backoffice is untouched, and so are
the other admin calendars: the free order-date field, Delivery Dates, Profit and Deliveries. What changed
here is this one calendar's behaviour.

**30 Sep 2026 — engine v242, A CUSTOMER WHO ALREADY HAS A COURIER BOOKING IS NEVER QUIETLY PUT ON A
SECOND VAN (no database step, no redeploy, one push).**

Your report: if a customer's order already has a courier booked, the delivery run should not tick that
order, and it needs to say so, so that a delivery is not booked twice.

Here is what was happening. A booked trip is recorded on the order's own row, and the delivery run did not
look at it when it built the day. Every customer on the day opened already ticked, the Tick them all press
ticked them all, and a booked customer looked exactly like any other. The only thing that refused was the
app's own sentence at the Book press — so you could tick a customer a driver was already on the way to,
price the run, and press Book, and the refusal arrived afterwards as a message rather than as anything you
could see while you were choosing.

**From this version, a customer whose trip is already running opens OFF the run, with a line under their
name saying so.** The line names the courier and its own word for where the trip has got to, and it says
plainly that ticking them and booking the run would send a second vehicle to the same door. The head of the
list counts them too — it will read something like "Who is on the run — 3 of 5, 1 already booked", so the
number you tick and the number of rows in front of you never disagree.

**It is not a gate.** The tick is still live and still yours. If you tick a booked customer by hand the app
honours it, and the refusal comes at the price instead, in the same words as before. That is deliberate:
the tick is a decision you make, and the app's job is to make sure you can see what you are deciding.

**And the row offers the way out, rather than going grey.** Under the warning there is one press: Call off
the trip and add to this run. It asks you first, in the open, because calling a trip off is the half that
cannot be undone — the driver stops being sent, and the customer's tracking box keeps its link but nothing
will update it any more. If you say yes, the original booking is cancelled with the courier, the order's own
row records that it was you who called it off and when, the warning disappears, and that customer is put on
this run so their delivery can be consolidated with the rest of the day. If the courier refuses to call the
trip off, its own reason is shown and nothing is written.

A trip that has already finished — delivered, or cancelled earlier — is not a barrier at all. Those
customers open ticked like anyone else, with no warning, because a delivery that has to be done again still
has to go on a run.

Orders going out by parcel carrier are untouched by this version. They were never on the run list in the
first place, so there is no second van for them and nothing here to warn you about.

No database step, no redeploy, no new key, and no new setting to switch on.

**30 Sep 2026 — engine v241, THE RESET NOW ANSWERS ON EVERY CARD, NOT ONLY A FRESH ONE (no database
step, no redeploy, one push).**

You pushed v240 and you were right again: the press worked, but the card could still stay silent. This
version closes the last way it could.

Here is what was happening. The answer your press writes — the pin moved, or it found the same spot, or
the address could not be reached — has two possible places to be said. One is the line under the buttons
on the door card itself. The other is the line inside the delivery-price section. That section folds away,
and its line folds away with it. v240 made the press work before the price section existed at all, which
was the right fix — but the moment you opened **Get a delivery price** even once, the card handed every
later answer to the folded-away section and stopped using the door card's own line.

So the sequence that caught you was this: open an order, press **Get a delivery price**, close it again,
then reset the pin. The look-up really ran and the pin really moved, but the sentence saying so was
written inside the section you had folded away, and the door card said nothing at all. And where the
look-up answers with the same spot as before, nothing moved on the map either — so the whole press looked
exactly like a press that had never happened.

**From this version the answer is always said on the line you can actually see.** While the price section
is open it is said there, exactly as it always was. While it is folded away — or if you have never opened
it at all — it is said on the door card, right under the buttons. The two lines are never both used at
once, so they cannot come to disagree about what your press did.

**The same fault was on the pin you drag.** Moving the pin by hand ends through the same sentence about
the price section's numbers, and that sentence had the same problem: with the price section folded away, a
drag you had just made reported into a section you could not see. It now says what it did on the door card
in exactly the same way.

Nothing else changed. No database step, no redeploy, no new key, and no new setting to switch on.

**30 Sep 2026 — engine v240, THE RESET BUTTON NOW ACTUALLY PRESSES (no database step, no redeploy,
one push).**

You pushed v239, saw the reset button at last, and pressed it — and nothing happened. That was exactly
what your report said, and it was exactly right. The button was on the card, but its press was not
connected to anything yet.

Here is what was happening. The reset press was wired up at the same moment as the delivery-price half
of the card, and that half is only built the first time you press **Get a delivery price**. So on a card
you had just opened, the button was drawn and waiting but its press led nowhere: no look-up, no message,
no movement. The instant you happened to open the price fold once, the button started working — which is
why it looked like an ordinary working button that simply ignored you.

**From this version the reset press is connected the moment the card opens.** It never waits on the
delivery price again. You can open an order, see the pin, and reset it without touching the price button
at all — which is the order you would naturally do it in anyway, because you reset a stale pin when you
call the customer, not when you ask for a price.

**And the press now always tells you what it did, on the card itself, right under the buttons.** It says
it is looking the address up, then it says one of the three things that can happen: the pin moved, or the
look-up found the same spot and there was nothing to move, or the address could not be reached and the
pin has been left exactly as it was. Those words used to appear only up in the price section, which is
another reason a press on a fresh card looked like it had done nothing at all.

If a reset is about to replace a pin a person chose — the customer's own pin, or one you placed by hand —
it still asks you first, exactly as v239 described.

Nothing else changed. No database step, no redeploy, no new key, and no new setting to switch on.

**30 Sep 2026 — engine v239, THE RESET NOW SHOWS UP WHERE YOU ACTUALLY WORK (no database step, no
redeploy, one push).**

This is the fix for v238. You pushed it, opened an order, and the reset was still not there. You were
right, and the reason is this: v238 offered the reset when the pin was the customer's own, and hid it
when the pin was one **you** had placed by hand.

But placing the pin by hand is the only thing that card ever offered you. So a drag is what you did, and
a drag is exactly what then hid the reset. Every customer whose pin you had ever corrected by hand still
showed **Move this pin** and nothing else. v238 changed nothing at all for the doors you had touched
yourself, which is why it looked like it had not arrived.

**From this version the reset is offered wherever there is a pin to replace.** If a pin exists on the
order and an address is typed, the press is on the card — the customer's own pin, a pin you dragged by
hand, a pin an older look-up wrote, or one a reset already wrote. The only case with no press is an order
that has no pin yet, where there is simply nothing to replace; the price button looks one up on its own.

**Where it would replace something a person chose, it still asks first.** That is the customer's own pin,
and it is also now your own hand-placed pin. The wording names which of the two it is about to replace.
Over your own pin it says this is the door you placed on the map by hand, that a look-up may only find the
road and can be a step back from a door you already had right, and that you can drag the pin again
afterwards. Over the customer's pin it says, as v238 did, that this is their pin and you can switch back
to it. Either way the confirming button says **Reset the pin**, and Cancel changes nothing at all.

**Where it only replaces the app's own guess, it does not ask** — a look-up's answer, or a reset of one.
That is what this press has always done, so nothing new is put in your way there. The button says
**Look this address up again** on those, and **Reset the pin from the address** on the two that will ask.

Nothing else changed. No database step, no redeploy, no new key, and no new setting to switch on.

**30 Sep 2026 — engine v238, RESET THE PIN, AND LET THE MAP ZOOM (no database step, no redeploy, one
push).**

This one is yours, word for word: when you call a customer, their address may already have changed, and
the only thing on offer was to move the pin. The map would not zoom out, and dragging a pin onto the right
rooftop by thumb was slow and easy to get wrong. You asked why there was no way to reset the pin. There
wasn't one. There is now, and the map zooms.

**There is now a reset, on the pin card, where you can see it.** When the pin the driver is sent to is the
customer's own — the one they dropped on your shop page — the button under the map reads **Reset the pin
from the address**. One press asks your address service for the address on the order again and puts the
pin where that answer lands. That is the case you described: the pin was right when they dropped it, and
they have moved since.

**It asks before it replaces their pin.** The customer's own pin is a fact they gave you, so a button that
quietly overwrote it would be the pin moving on its own again — the fault several versions of this card
have been spent ending. So the press asks first, in plain words: this is their pin, resetting replaces it
with a fresh look-up of the address, and a look-up may only find the road. The confirming button says
**Reset the pin**. Cancel changes nothing at all, not even a look-up.

**And you can put their pin back.** Once a reset has replaced their pin, the same card offers **Use the
customer's pin instead**, one press, back to their exact point. The reset is not a one-way door.

**A reset yields to a pin they drop afterwards.** If that customer pins a new spot on your shop page after
you reset, their new pin wins again straight away — the same rule as before. A reset replaces one specific
stale pin, not every pin that customer will ever drop.

**The map zooms the whole time now.** The plus and minus buttons are drawn on the pin card, and pinch,
double-tap and a desktop box zoom all work — before you press anything. Only moving the pin is still behind
**Move this pin**: the map will not pan under a pin you are reading, and the pin will not take a drag, until
you say so. That split is the point of this version. Looking and correcting used to be one action; they are
two again.

**Nothing else changed.** Your prices, your delivery calendar, your messages, the order card, the packing
slip and the label sheet are all exactly as they were. Adding an order is still the one pass v237 made it,
and a pin you placed by your own hand is still not offered up for replacement.

**On two phones.** If your second phone has not been reloaded yet and is still running v237, it reads a
reset as the older kind of pin and will price to the pin you replaced until it is reloaded. Reloading it
fixes it, and there is nothing to run in Supabase for any of this.

**30 Sep 2026 — engine v237, AN ORDER IN ONE PASS, AND THE DAY ON ONE LINE (no database step, no
redeploy, one push).**

This one is yours, and it came from a complaint about your own way of working. Adding an order used to be
two steps: fill in the New order card, press Add order, then find the order again and open the Edit window
to finish it. You said that was redundant, that the flow was not smooth, and that it started in the wrong
place.

**A posted order is now one pass.** The reason it was ever two steps is that four things lived only in the
Edit window and not on the card: the courier charge, the tracking number, the parcel carrier, and the Get a
delivery price block. They are all on the card now. Choose Post (nationwide) and they unfold underneath it,
in the order you need them: the address with the map pin, the charge, the tracking number, the parcel, and
the price. Take the order, price the trip and record what it cost, all before you press Add order once.

**The price is on the card. The booking is not.** This is the way you asked for it. You can ask for a price
and take the fee onto the order from the card, but Book this trip stays on the order itself, where it has
always been. Booking a real vehicle against an order you have not finished taking would be the wrong thing
to put under your thumb one press away.

**The day is one line now.** The card used to open on a whole month of calendar, even though you had already
picked the day on the screen behind it. It now reads as one line — Delivering Fri, 2 Oct — with the calendar
unfolding underneath only when you tap it. Nothing about how a day is chosen has changed: tapping one still
switches the screen, so the products and the day's limits are right.

**The items come first.** After the day comes what the customer wants, then the customer. It is the order
things are actually said to you on the phone: they tell you what they want, then who they are. Everything
else on the card is unchanged and in the place it has always been.

**Your own note box is now the delivery note.** Your app and your shop both used to call the order's note
box simply Note. Now that every item carries its own note, that box was left doing a different job, so it
says what it does: it is the delivery note, for the gate code, the landmark and the time you should arrive.
The box on your shop and the box in your app now show a grey hint saying exactly that, so a customer knows
what belongs in it without you having to tell them.

**Nothing is written until you press Add order.** The card was, and still is, a draft. The charge, the
tracking number and the parcel are written onto the order at the same moment the order itself is created,
so an order you decide against leaves nothing behind it. And if you type a charge but do not say who paid
it, the card refuses in words and changes nothing, exactly as the Edit window does.

**Nothing else changed.** The order's own field order in the Edit window, your prices, the delivery
calendar, your WhatsApp messages, the packing slip and the label sheet are all exactly as they were.

**30 Sep 2026 — engine v236, A NOTE ON EACH ITEM, SWITCHED ON PER PRODUCT (no database step, no redeploy,
one push).**

This one is yours, word for word: you wanted to switch a note box on or off on a product card, so a customer
can leave a note on each thing they order — and switch it off on the products where a note makes no sense.
And you asked for the same box in your own app, so a note you are told over the phone can be written down in
the same place.

**The switch lives on the product card.** In your app, open a product and you will find a tick that reads
**Ask the customer for a note on this item**, sitting beside the other selling switches. Tick it and the
customer is offered a note on that item; leave it alone and they are not. It is off until you tick it, so
nothing on your shop changes until you decide it should.

**On the shop, the note is quiet.** A customer who puts an item in the basket sees a small **Add a note**
link under it. Nothing is opened on their screen until they tap it, so your menu still looks exactly as it
looks today. Tap it and a box opens on that item, with a short example in grey: no nuts, or a name to write
on the pack. Whatever they type stays with that one item and rides on that item's line when the order comes
in.

**The note belongs to the item, not to the order.** This is the whole point of it. If someone orders two
things and writes "no nuts" on one of them, that note comes through on that item's line only. The other
line is untouched, and the order's own note box at the bottom still works exactly as it did for anything
that is about the whole order.

**A note in your own app is offered on every line.** Your New order card, and the Edit order window, both
give every line its own small note box — whichever product it is, and whether or not you have switched the
customer's box on. The switch decides what you ASK a customer for; it must never decide what you are allowed
to write down. A phone order of "no nuts on the chicken jerky" has to have somewhere to go.

**You see the note where you work.** On the orders list it appears in brackets beside the item it belongs to,
so it sits next to the thing it is about rather than in a note line at the foot of the order. The same is
true of the packing slip and the label sheet: it prints beside that item and never as the order's own note.

**Nothing about a note blocks an order.** An empty box and no box at all place exactly the same order — there
is no such thing as a half-filled note to chase. Switching a product's note box off after the fact never
hides or loses a note you have already collected, and clearing a note you wrote puts that line back exactly
as it was.

**Your WhatsApp messages do not change.** The note stays in your app, which is what you asked for. Every
message you send reads exactly as it reads today, and your customers' tracking page is untouched by this
version.

**Nothing to set up.** There is no database step and nothing to redeploy. The switch travels to your shop
with the rest of the product details, and a note travels with the order from one of your phones to the other
on its own, the same way the rest of the order already does.

**Nothing else changed.** The order's own note box, the prices, the delivery calendar, the basket and the
place-order bar are all exactly as they were.

**29 Sep 2026 — engine v235, A BOOKED TRIP NOW SHOWS WHAT IT COST AGAINST WHAT YOU CHARGED (no database
step, no redeploy, one push).**

This one is yours, and it started as a worry rather than a request. A courier price you pick when you take an
order can turn out to be higher or lower by the time the trip is actually booked, and nothing was watching
that gap. You asked to see it rather than be protected from it: a real cost makes you aware, leaves room for
a promotion later, and lets you decide not to collect the delivery at all.

**So the booked-trip card now does the sum.** Under the line that tells you when calling the trip off stops
being free, the card compares what the trip actually cost against the courier charge on the order, and says
which way the difference fell. If the trip cost more than you charged, it says so and tells you that much
came out of your own pocket. If it cost less, it says that too, and that the difference stayed with you.
Neither direction is treated as the bad one.

**It shows both directions on purpose.** A gap that only spoke up when you were short would be an alarm; you
asked for a reading, so a surplus and a shortfall are worded the same way, in the same plain sentences.

**A trip you decided not to charge for says so.** If you have recorded no courier charge at all, the card
tells you the whole cost of the trip is your own, rather than staying silent. That is the free-delivery case
you named, and the one number worth seeing is the one you chose to give away.

**A charge that matches the trip says nothing at all.** When the two agree there is no line, because a
difference of nothing is not a difference, and an "RM 0.00" row on every card would be noise you would learn
to skip.

**A delivered trip keeps the reading.** The calling-off deadline disappears when a trip is over, because
there is nothing left to call off. This line stays, because a cost is money that has already been spent and
the whole point is to learn from it afterwards.

**This is on your screen only.** Nothing here goes near a customer. The price a customer was quoted does not
move, their messages do not change, and their tracking page is untouched by this version.

**Nothing else changed.** The van you pick, the prices, the five-minute life of a price, the booking buttons,
the charge box and the calling-off deadline are all exactly as they were.

**29 Sep 2026 — engine v234, A BOOKED TRIP NOW TELLS YOU WHEN CALLING IT OFF STOPS BEING FREE (no database
step, no redeploy, one push).**

This one started as your own question: if you book a trip and then need to call it off, when does it start
costing you money? The answer is a rule rather than a feeling. Lalamove lets you call off a scheduled pickup
at no charge up to 45 minutes before it, and it may charge a fee after that. That rule was living in your
head, so this version puts it on the page. Under the status line on a booked trip, the card now says
**Free to call off until 30 Sep, 10:15 am - Lalamove may charge a fee after that.**

**It turns over by itself when the window shuts.** Leave the card open and the sentence changes on its own
to **Lalamove's free calling-off window shut at 10:15 am, so a fee may apply from here.** You never have to
work out which side of the deadline you are on, because the card says it for you.

**A trip booked for as soon as possible is told apart honestly.** On an immediate booking the free window
runs from the moment a driver takes the job, and Lalamove never sends that moment back to the app. So rather
than inventing a time that could be wrong, the card states the rule instead: **Booked for collection as soon
as possible, so there is no pickup time to count back from. An immediate trip is free to call off only for a
short while after a driver takes it - check with Lalamove before you count on it.**

**Nothing is claimed that the app cannot stand behind.** Every sentence says the fee may apply rather than
that it will, because it is Lalamove's own terms that decide it and not this app. A trip that has finished,
or one you have already called off, shows no deadline line at all, since there is nothing left to call off.

**Nothing else about booking changed.** The vans, the prices, the five-minute life of a price, the customer's
tracking box, the charge box and the buttons on this card are all exactly as they were. This is one line
added to a card you already had.


**29 Sep 2026 — engine v233. The order page has a way back to your homepage. No database step —
nothing to run.**

One small thing, and it sits on the shop page rather than in the app.

Customers reach your order page from plenty of places that are not your homepage — an Instagram
bio, a link someone shared in a group, a bookmark saved on their phone. Until now that page had no
route back to your front page at all, so a visitor who landed on it first could never get to the
reviews, the gallery or your story: there was simply nothing to tap. From this version there is a
small "Our homepage" link in the orange banner, on its own line just under your tagline and marked
with a little house. It points at your homepage, and it reads in all three shop languages.

It sits on its own line rather than on the top row beside the EN, Mandarin and BM buttons on
purpose. That row already fills a phone — the line beside it wraps to two lines at 375px — and a
third item would have pushed the language buttons out of easy reach. The link is a full-size tap
target in the same pill shape as those buttons, so it looks like it belongs there and is easy to
hit. Nothing else on the order page moved, and nothing about taking an order changed.

**29 Sep 2026 — engine v232. A translated line you delete stays deleted, and the greyed hint is
readable. No database step — nothing to run.**

One version, and both halves are the same card: the Chinese / Bahasa Malaysia card on a product's
Edit screen.

**A line you empty on purpose goes quiet.** If you deleted the wording from a translated line
because you wanted the English shown for that line, the machine translation used to come straight
back into the box, greyed out — and the small right-pointing arrow that is meant to sit over those
words had gone. The greyed words and the arrow are one single offer: the arrow is drawn on the
words, and the words exist only because the arrow can take them. They were written in two separate
places, so they could disagree, and the box ended up showing machine words that nothing would
take. They are now written together in one place, so a line can never show words with no arrow over
them. An emptied line stays empty, says "Left blank - English shows." so blank is clearly meant,
and keeps its round arrow as the way back to a translation if you change your mind.

**The greyed hint no longer runs off the edge.** On a line you have not touched, the greyed hint
read "e.g. <the translation>......if blank, it will be filled with English". On a one-line box that
tail ran past the right edge and was cut off mid-word, right where the arrow sits — so the one
sentence meant to explain the line was the one you could not read. It is now just "e.g. <the
translation>", the same shape as every other suggested box in the app, and the promise that blank
means English is still made in full in the card's own line above.

Nothing you have already typed is touched. A line you typed is yours and is never overwritten, and
an untouched empty line behaves exactly as it did before: greyed suggestion, with the arrow.

**28 Sep 2026 — engine v229, v230 and v231. The delivery address box has room, and the
shop's posting-day picker is five whole weeks. No database step — nothing to run.**

Three versions in one go, and two of them are the same problem: an address does not fit on one
line, and the box you type it into gave it no room.

**v229 — the delivery address box has room for a whole address.** It was a single-line box, so a
real address — three lines, four, sometimes five — was cut off and you had to scroll it sideways
to read back what you had just typed. It is now a proper multi-line box: four lines tall on the
New order card and on an order's Edit pop-up, three on the pin card under "Put this doorstep on
the map". You can also drag its bottom edge to make it taller while you type. Nothing about what
the box stores, saves or pins changed — it is the same field, only taller.

**v230 — and it takes the whole width of the form.** An order form is laid out in two columns,
and the address sat in one of them with an empty cell beside it. The address is the longest single
thing you type on an order, so it now stretches across both columns. Nothing else on the form
moved.

**v231 — the shop's posting-day picker is weeks, not a month.** Your customers' calendar used to
be a month page, with the leading and trailing squares of the month padded out with dead numbers.
It is now five whole weeks that follow today: the week just gone at the top, faded because there is
nothing left to book in it, then this week with today ringed, then three weeks ahead — and every
square on it is a real date, so nothing is greyed out for no reason. Small arrows page it a week at
a time and the grid slides as it does. An arrow is drawn only when there is somewhere to go: at the
start there is usually nothing earlier, and a later arrow appears once you have published a posting
day further out. A control with nothing to do is left off rather than shown greyed out. A day you
have not published is still a real square, and tapping it still tells the customer why it cannot be
booked, in the same two sentences as before.

**28 Sep 2026 — engine v226, v227 and v228. Parcels you post yourself, an address that fills
itself in, and address suggestions as you type. No database step — nothing to run.**

Three versions in one go, and they all answer the same kind of question: how a posted order
finds its way to a door.

**v226 — the parcels you post yourself have somewhere to live.** Your flat postage and the
courier you could book were already here; the third case, the box you take to a counter or book
on a carrier's own website, was not. There is a new screen, **More then Parcel couriers**, that
keeps your list of carriers. J&T Express, Ninja Van, Line Clear, Pos Laju and SPX Express are one
press to add, and you can add or rename your own. On an order you pick the carrier, the app
remembers it, and the consignment number goes into the **tracking box the order already has** —
so it reaches the customer's page and the posted message through machinery that was there
already, with no new slot and nothing to run. A product can also be ticked **"Can travel as a
parcel"**, and that tick is deliberately not a switch the app obeys: it only changes the advice
you are shown when you record a parcel on a courier order, and it never blocks, hides or delays a
sale. Two things this version also repaired, both had been quietly broken for a long time: the
app's own dropdown control had a change handler that had been dead for around a hundred versions
(nothing depended on it until the carrier picker did), and the **Note / tracking card** on an
order rebuilt itself from scratch every time it repainted, so it threw away the carrier you had
just named and the number you had just typed.

**v227 — the delivery address remembers your regulars.** Type a customer's name into an order
and, if you have posted to them before, their delivery address fills itself in from the order you
sent them last. It helps the **returning** customer only, because it reads your own past orders —
and it never overwrites an address you typed yourself.

**v228 — the address suggests real ones while you type.** For the customer you have never posted
to, who has no history for v227 to read. As you type a delivery address, the app offers real
addresses that match and a tap writes the whole thing in. It is on both order forms, the New
order card and an order's Edit pop-up. It is deliberately quiet: it waits for you to stop typing
before it asks anything, it ignores a fragment, and an answer that arrives after you have typed
on is thrown away rather than painted over your words. This half needs one thing switched on in
your Google project — the same key the map lookup already uses, with the Places service ticked on
— and until that is done the address box behaves exactly as it did before.

**One day, three versions.** The bakery and this app had differed for eight days over the
bakery's bread-only Production line. That was settled earlier on 28 September, and v224 and v225
came the same day; v226 to v228 followed on that same day too, so the two apps read the same
number again and will after every future sync.

**28 Sep 2026 — engine v225. A product on the shop can always be hidden. No database step —
nothing to run.**

One button, in one place, and it fixes a rule that bit at the worst possible moment.

**What was wrong.** You published a product, looked at its row, and the only button there was
**Delete**. Its **Hide** button was missing exactly when you were most likely to want it. The
rule behind that was Hide-if-it-has-history, Delete-if-it-is-clean, and a product you have just
published has no history yet, so the app counted it as clean and offered you the one button that
throws work away. Delete takes the recipe with it. So the fresh product, the one you might simply
want off the shop for a while, was the one that could only be destroyed. Your report: after
publishing a product, only Delete is allowed, and it should not be.

**Fixed.** A product that is on the shop now always offers both buttons, side by side. **Hide**
takes it off the shop and keeps everything - the recipe, the photo, the price, the category and
its past orders - and **Unhide** on the Hidden list puts it back whenever you like. **Delete** is
still right there beside it for the product you really do want gone for good, and it still asks
you to confirm first. The older products that already carry orders are the exception, exactly as
before: they keep Hide alone, because deleting one would break the orders and the sets that point
at it. That is not a missing button, it is the app refusing to let you break your own books.

Nothing else about the Products screen changed - the same three lists, the same folded New
product card, the same rows. This is one button in one place.

**28 Sep 2026 (no new engine) — the address lookup in your back office now works. Nothing to run,
and nothing to update on your phones.**

Your back office had two address boxes that did nothing: you typed an address, pressed the button
beside it, and neither a map pin nor a list of suggestions ever came back. One cause, two symptoms
— those boxes ask a small helper that runs inside your own Supabase project, and that helper had
never been put there, so the request went nowhere. It is there now, deployed by you on 28 September
2026.

The same helper also holds the price-and-book half for a courier, and that half stays exactly where
it was: it needs a courier key you have not set up and do not need. So a courier price screen will
still say a key is missing — that is the honest answer rather than a fault, and nothing about your
orders, money, labels or postage is touched by it.

Two things worth knowing before you try it. First, the lookup sends your phone's sign-in along with
it, so the phone has to be signed in to your shared data, or you will be told that instead of being
given an answer. Second, the list of suggestions only appears when there is a real choice to make —
two or more matches. Now that your lookups come back with a house number, most addresses will return
one exact answer and therefore show no list at all, with the pin simply landing where it belongs.
That is the design, not the old fault returning.

**28 Sep 2026 — engine v224. The picture window is square, and a product's row shows only
what a customer sees. No database step — nothing to run.**

Two small changes, both about a product, and one tidy-up besides.

**The picture window is square, and your photo is cropped to fill it.** Until now the window
kept whatever shape your photo happened to be: a tall photo showed whole with the window's cream
colour at either side, a wide one filled across with cream above and below. You asked for the
crop by name, so a product photo is now trimmed to a square as it is chosen and fills the window
edge to edge with no cream at all. The square taken is the middle of your photo. The trade is
honest: whatever the square leaves out is gone from that picture, so the only way to change it is
to choose the photo again. A photo already saved keeps the shape it was stored in and is trimmed
to the square's middle when it is shown, rather than being reshaped on disk. This reverses v220
to v223, where nothing was cropped.

**A product's row on the Products screen now shows only what a customer sees.** The row used to
print the ingredient cost per unit ("RM 0.30 / unit") and the recipe's own ingredient lines under
the sell price. Both are gone from the row, on your word — the row is your shop view, and what a
packet costs you to make is not something a customer ever sees. Nothing was lost: the price per
unit and the full recipe are still on the product's **Edit** screen, which is where you build
them.

**And one tidy-up.** A product with no photo yet showed a small engraved bread loaf in the empty
picture box - a leftover from the bakery system the app was built from. It is a paw print now.
Nothing else changed about it: the box is the same size and a product with a photo never saw it.

**28 Sep 2026 — engine v223. Your app has caught up with the bakery in one jump, and it now
has the Production line.**

This is the biggest update this app has ever had: ninety engine versions at once, from v133 to
v223. Everything the bakery built since we last synced is now here, plus one new switch of your
own that has nothing to do with the bakery at all.

**Why one big jump rather than many small ones.** Improvements are always built on your bakery
app first, then copied here. The copying had gone quiet while you got Munchies Furkidz off the
ground, so the gap had grown wide. Doing it in one go means one copy job, one rebuild of every
document, and one engine number on both phones at the end of it — rather than a dozen tiny
pushes you would have to do yourself.

**Nothing you already had is lost.** Every figure, every order, every product name and price is
exactly as it was. This adds screens and fixes; it does not change your records.

**THE PRODUCTION LINE AND THE SCENARIO PLANNER (engine v133 to v187).**

**Two new screens, both under More.** **More → Production line** is a planner for a production
day: how many units you can make, which step is holding you up, and where the day's hours
actually go. **More → Scenario planner** is the wider screen next to it, where you build your
day out of blocks — a block is a machine and the pair of hands that tends it, counted as one
thing — and watch the day as a timing diagram. A block has its own cycle time, how many units
one pass deals with, how many minutes of you it takes, and how often it repeats. You raise the
numbers until something stops you, which is how you find your real ceiling.

**These screens are the bakery's, with the bakery's own words.** You asked for this one to be
copied exactly as it is rather than reworded, and that is what has been done: the screens talk
about ovens, pans, dough, mixes, trays and bake days. That is deliberate and not a mistake. The
reason it is worth having anyway is that the arithmetic underneath is about people, machines and
hours, and that part is not about bread at all — it works out how many of anything a day can
make, given what you have and how long each step takes.

**A block can be told to repeat, which is how a loop works.** Nothing special is needed for a
step you do several times: it is simply a block that repeats more often. A block you have two of
is drawn twice. A block can be switched off and sits in the list reading "not in this scenario",
so the screen answers without it — that is how you try a day with and without something you have
not bought yet.

**The day is drawn as a timeline you can read.** The hour ruler has its lines drawn, the clock
above your people sweeps as the day runs, every batch bar carries its own label, and the step
that sets your pace wears a mark and one sentence saying why it is the slow one. A person's row
is only as tall as the people in it, so three workers do not leave a tall empty box on screen.

**Said plainly: at your scale this is a toy until you put your own numbers in.** Every box it
seeds is the bakery's, and a seeded number is a guess, not a measurement. The screens say "not
timed yet" rather than quietly reading as free, so you can see which figures you have not given
it. If a mix box reads 25 and you know better, type 28 — the figure the app keeps is the one you
last typed, so a new seed only reaches a fresh phone.

**Windows that open over the app are taller, and cards fold.** Every pop-up in the app now sizes
itself to what it holds and scrolls inside itself rather than pushing past the bottom of your
phone. A long card on the planner folds away when you tap its title. Neither of these is a new
feature so much as the reason the new screens are usable on a phone at all.

**A NEW PHONE NO LONGER EMPTIES THE OTHER ONE (engine v181).** Worth its own line, because it is
about your records rather than a screen. A phone that had never seen one of your settings could
previously arrive and hand its own empty version back to the cloud. Staying quiet about a thing
is now correctly read as "no opinion", never as "delete this". This is the same rule that already
protected your delivery dates, and it now covers much more.

**COURIER WORK: PRICE IT, BOOK IT, FOLLOW IT (engine v188 to v193).**

**This is the part to set up later, not today.** It needs a Lalamove key on your Supabase
project before any of it does anything, and nothing about your app breaks or nags without it.
You told me Lalamove is not suitable for Munchies as your main arrangement, and this is built to
sit quietly as a secondary choice until you decide otherwise.

**What it does, when you want it.** On an order you are delivering, one press asks Lalamove what
the trip would cost on every vehicle it runs and shows the prices side by side with the distance
— the quotation lives five minutes, and the one you choose fills the courier charge box that was
already there. A second press books it for real, and the share link the courier hands back goes
into the tracking box your orders already carry. A third checks where the driver has got to, or
calls the trip off.

**One trip, several doorsteps, and what it saves.** A day's courier orders can be grouped into a
single trip. The app prices that trip against the same doorsteps sent one at a time and shows you
the difference as two numbers rather than as a claim. The saving stays with you: a customer who
bears a courier charge is charged what their own doorstep costs on its own, never a share of the
combined fee, so consolidating does not quietly become their discount.

**The customer can watch it.** A booked trip's own progress shows on their track card, in their
own language, with the driver's name, the number plate and a press to ring them. When the courier
says the parcel is on the vehicle, the order moves itself on. One honest limit, found and left in
place rather than papered over: the courier hands back ONE link for the whole trip, so a customer
opening it can see the other stops. There is no way to split it, so the app now warns you instead
of pretending otherwise.

**THE SHOP'S MAP, THE PIN, AND THE ADDRESS (engine v194 to v218).**

**Your customer can now put their door on a map, and the app uses it.** On the order page they
type their address, the app suggests doors underneath as they type, and they pick theirs. That
address is written straight into the delivery address box rather than making them type it twice.
If nothing comes up they can drop a pin by hand instead.

**The pin is a suggestion and never a fact.** Nothing is priced, booked or sent to a driver from
a customer's pin on its own; it is offered to you where you already look at a doorstep — on the
order's charge section and on the delivery run under that customer's row — and you are the one
who acts on it.

**A pin and an address can no longer disagree.** Before this they arrived as two bare numbers
with nothing tying them to the address written beside them, so the two could say different places
and your screen had no way to show you. Now the pin carries the customer's own typed address as
its name, and the app will not let the two drift apart.

**The order's Note / tracking box now opens with the door on it.** For a courier order the top of
that card tells you which door the driver would be sent to — the customer, the address, and a
small map with the pin on it — and you can look at it without pressing anything, or move it if it
is wrong.

**Nobody's door is another customer's business.** Said in the courier section above, and repeated
here because it is a privacy matter rather than a convenience: the courier's own link covers the
whole trip, so a customer following it can see the other stops. The app tells you this rather
than leaving you to find out.

**An address lookup that used to give up now says why.** A Malaysian address leads with its house
number, and the free map services the app asks often can only find the road. The screen now says
so in words — "this is the road, not the house" — rather than leaving you with a pin in the wrong
place and no explanation. An address with a unit number, which the lookup used to refuse
outright, is now found.

**PRODUCT CATEGORIES AND PICTURES (engine v219 to v223).**

**More → Categories is a new screen, and it starts empty on purpose.** This is where your shop's
headings live, built the same way your ingredients are: press New category, give it a name, and
it appears. Nothing is in it until you put it there, because your shop should say what you sell,
not what a program guessed for you.

**Your shop now lists by your headings instead of in whatever order the products happened to be
stored in.** That is the whole point. Under each heading sit the products you filed there, and
the order they appear in is the order you set — not alphabetical, not by price. A heading can
hold headings under it, as deep as you like, so "For Dog" and "For Cat" can sit at the top with
Pork, Duck and Fruits under them.

**A product with no heading yet is never hidden — it is shown last**, under a plain heading called
**More items**. Add something this evening and file it tomorrow: it is on sale tonight, it simply
sits at the end until you say where it belongs.

**A product can be in more than one heading, and you choose which one it is listed under by the
order you tick.** The box you tick first is the heading it is drawn under. Tick a second and the
product does not vanish from the first, and it is not drawn twice either — one product appears in
exactly one place on your shop. The other ticks are kept as a note to yourself, and the app's own
product row spells out which ones they are.

**Every product can now have a picture, and it is one standard window.** Choose a photo from your
phone in the product editor; your shop shows it at the left of the product's row and your own
Products list shows it too, so you can see at a glance which products have one and which are
still blank. Since v223 the window is the same size in all three places — your shop's card, the
app's list, and the editor where you choose the photo — and it is bigger than it was.

**Your photo went in whole (as of v223 — the v224 entry above reverses this).** A tall photo and
a wide photo both showed in full, with the window's soft cream colour filling the spare space
beside them. From v224 the photo is cropped to a square instead. **A product with no picture is
untouched** — no window, and its name and price read across the whole card exactly as before.

**Pictures already saved keep the shape they were stored in.** Re-choosing the photo is the step
that stores a fresh one for the window as it now is.

**Two things to know, said plainly rather than found out later.** The homepage grid is untouched
and still carries the photographs already written into it, so a picture set here reaches your shop
and your own product list but not the front page. And a picture costs weight twice: it travels
inside every backup and every export, and it is fetched again by every customer who opens your
shop. That is why it is kept small.

**Moving a heading, or a product inside one, is a drag.** Each row carries a small handle at its
left; press the handle and drag the row up or down. It is the first drag in the app, so it is the
part most worth a second look on your own phone.

**Deleting a heading is guarded, the way your ingredients and suppliers are.** A heading with
headings under it will not delete. A heading with products filed in it will not delete, and it
tells you how many. An empty one simply goes.

**THE POSTAGE SWITCH — flat fee, or quoted by courier (this app only; no engine bump).**

**Your ask: "add a switch whether a flat postage or quote by courier".** On **Settings →
Storefront**, the Postage card now carries a switch: **Quote each posted order by courier instead
of a flat fee**. Off is exactly what this app has always done — the flat fee you set (RM8 unless
you change it) is added to the To-pay line on every posted order. On, the flat fee is taken away
and nothing stands in its place: you find out what the courier charged and record it on the order
(More → the order's Note / tracking), and that figure is what the customer is told.

**What the customer hears while the figure is unknown.** They are told plainly rather than quoted
a number that is not the real one: **"Postage: quoted separately - we'll message you the exact
amount"**, with no To-pay line at all, because there is nothing extra to pay yet. The very same
sentence is on their track card, word for word, so the two can never say different things. It
goes away by itself the moment you record what the courier asked for, and the ordinary courier
charge line takes over.

**The flat fee is kept, not thrown away.** Switch back to a flat fee and your RM8 is still there
and quotes exactly as before. A collect order, and an order whose charge you absorbed, say
nothing about postage in either mode — they owe nothing for delivery, and they say so by saying
nothing.

**This choice syncs between your phones**, like the fee itself and for the same reason: whichever
phone you set it on last wins, so both quote the same. It is never shown to customers.

**WHAT IS DELIBERATELY NOT HERE.**

**The bakery's v199 money layout is left out on purpose, and it is worth knowing why.** From v199
the bakery's WhatsApp messages and track page set the money out as a small addition — "items total
this, plus the courier's charge, reaching this total". That works on the bakery because the
courier's charge is the only delivery cost it has. Here it is not: your flat RM8 postage is also
inside the total and is deliberately never published to the shop page. A subtotal worked out from
the published total would therefore be RM8 too high, which is worse than not showing the working
at all. So this app keeps its own money lines — **Total**, then **Postage (nationwide)** or the
recorded **Courier charge**, then **To pay** — which are already an addition the customer can
follow, in the place where your postage actually lives.

**WHAT YOU MUST DO BEFORE YOU PUSH THIS.**

**Two new database scripts, and one rule that matters.** Run **`supabase/courier_job.sql`** and
**`supabase/postage_mode.sql`** in your Supabase SQL editor before this build is live. Both are
safe to run twice. The reason for the order is not tidiness: the app publishes the whole tracking
row for an order in a single call, so a column that does not exist yet rejects that call as a
whole — every customer's track page would stop updating, not only the charged ones. If you have
not already run `courier_fee.sql` and `courier_cod.sql`, those are needed as well.

**Two optional Edge Functions, for later.** `courier` and `shop-geocode` sit in
`supabase/functions/`. They are what talks to Lalamove and to the address lookup. Deploy them
when you set the courier up, not before; until then the courier screens say plainly that no key
has been added rather than blaming the build.

**Nothing else to run.** No new table beyond those scripts, no change to how you push, and
**Engine v223** on your **More** screen once this is live.

**27 Sep 2026 (no new engine) — Pear Chicken Roll is RM24.**
One card changed price.

Pear Chicken Roll was **RM25**; it is **RM24** now. The card's size line already said 50g pack, so
only the figure moved.

No new engine — nothing changed on your phone. No SQL to run.

**26 Sep 2026 (no new engine) — the homepage grid carries your new prices.**
Seven cards changed price, the three jerky now name both pack sizes, and one card's price came off.

**What each card says now.** Chicken Potato Puff, Carrot Chicken Biscuit, Pear Chicken Roll and
Chinese Yam Chicken RM24 → **RM25**. Apple Chicken Roll **RM24** and Okra Chicken Roll **RM24** are
the prices you already had, so they are unchanged. (Pear Chicken Roll went back to RM24 the next
day — see the 27 Sep entry at the top.)

**The three jerky show two prices on one line.** They sell in a 50g pack and a 100g pack, so the
price line now reads **50g RM16 · 100g RM29** (Duck **50g RM18 · 100g RM33**, Pork
**50g RM17 · 100g RM31**). Before this they carried a single figure. The two-price line is set a
little smaller than a one-price line on purpose: at the full size it wrapped onto a second row on
every screen and pushed the description down on those three cards only.

**Egg Yolk Melts has no price on it now.** You asked for the price to come off, and it is off — the
card shows the name, its OUT OF STOCK pill, the weight and the description. Putting a figure back
is one line whenever it returns.

**Nothing here needs translating.** A price is a plain number written into the page, not a
dictionary entry, so English, Chinese and Malay all show the same figure and a language switch
cannot show an old price beside a new one. This is the homepage's own copy: the live menu in the
backoffice is a separate list, and its prices are still yours to set there.

No new engine — nothing changed on your phone. No SQL to run.

**23 Sep 2026 (no new engine) — the website says "pack", and the three jerky come in two sizes.**
Three wording changes on the homepage grid.

**"Pack", not "pouch".** Every card's size line used to end in "pouch"; the website now says
**pack** throughout, and the note under the grid reads "Every pack is clearly labelled with its
meat". This is the homepage's own wording — the shop menu in the backoffice is separate copy and
was left alone, so the unit box on a product still holds whatever you typed there.

**Chicken, Duck and Pork Jerky also come in a 50g pack.** Their size line now reads
**50/100g pack**, showing both sizes in one label. The other seven are unchanged — 80g for the
puff, the biscuit and the Chinese yam chicken; 50g for the three rolls; 40g for the melts.

**One small correction to the wording you sent.** The Carrot Chicken Biscuit's description said
"make into little dinosaur biscuits" and now reads **"made into"**.

The page is read in three languages, so Chinese and Malay were updated to match. The Chinese size
lines now use the Chinese word for a pack rather than the word for a bag, and the Chinese note
under the grid changed with them; Malay already said Pek for a pack, so only the weight changed
there. A language switch can never show an old word beside a new one.

**The card showed one price — the 100g price — at the time.** A second size did not get a second
price on the card until you asked; you asked on 26 Sep and both prices are now on the line (see the
top entry).

No new engine — nothing changed on your phone. No SQL to run.

**23 Sep 2026 (no new engine) — the homepage grid carries your new prices and the full treat
descriptions.** Every card in the homepage's "Our Treats" grid now reads the price and the
wording you sent, for all ten treats (the weights at the time were the ones you gave — 80g puff,
biscuit and Chinese yam, 50g rolls, 40g melts; the jerky gained a second size the same day, see
above).

**Prices.** Four went up: Chicken Potato Puff RM22 → RM24, Carrot Chicken Biscuit RM23 → RM24,
and all three rolls (Apple, Pear, Okra) RM20 → RM24. Chicken Jerky RM24, Duck Jerky RM26, Pork
Jerky RM28, Chinese Yam Chicken RM24 and Egg Yolk Melts RM22 are the prices you already had.

**Wording.** Each card carries your **full** description word for word — what it is made of, that
nothing else goes in, and how it behaves in the hand — replacing the older short lines. The page
is read in three languages, so the Chinese and Malay versions were updated to match: switching
language can never show the old words beside a new price.

**Egg Yolk Melts is marked out of stock.** Its card keeps its price and wears a small "OUT OF
STOCK" pill beside the name — the same pill style the PORK note already uses — in whichever
language the reader has chosen.

**The short one-line descriptions were not used.** Your instruction was the full description on
the homepage, so the short lines are kept aside rather than discarded — they are ready if you
would like them somewhere smaller later (the shop menu, or a printed label). The treat photos are
untouched.

No new engine — nothing changed on your phone. No SQL to run.

**21 Sep 2026 (no new engine) — tapping a day you do not post is answered.** On the order page,
tapping a day on the calendar that is not one of your posting days used to do nothing at all: no
highlight, no message, nothing moved. A customer tapping the day they wanted read that as a
broken page rather than as an answer. The grid now answers — one line under the calendar, naming
the day in words, in whichever of the three languages the customer is reading.

**It says one of two things, because there are two different facts.** A day you do not post gets
*"Tue, 22 Sep is not a posting day — please pick a green day."* A day you **do** post, tapped
after its 6pm window has shut, gets *"Orders for Mon, 21 Sep have closed — please pick a green
day."* That second sentence matters more than it looks: your orders close at 6pm **the day
before**, so from 6pm on Tuesday that Wednesday is gone, and today's own day is always gone. Both
of those are days you really do post, and the card right above the calendar names them as posting
days — telling a customer "that is not a posting day" on your own posting day would have had the
page contradict itself every single evening. So a day that has shut says **closed** instead.

**Nothing else answers.** Choosing a green day takes the sentence away with it, so it can never
outlive the question. A day already past stays quiet — it *was* a posting day, so the sentence
would be a lie on it, and it is dimmed besides. And a day you post whose window is still open,
but which the shop has not put on offer yet, stays quiet too: neither sentence would be true of
it. The sentence also disappears by itself if you later make that day one you post.

No new engine — nothing changed on your phone. No SQL to run.

**21 Sep 2026 (no new engine) — the cut-off time is written out in words.** The order page's
info card used to read **"Order by 18:00 the day before"**. It now reads **"Order by 6pm the day
before posting"**: the time the way you would say it out loud, and the word *posting* spelled
out. Settings is untouched — the cut-off box still takes a time (18:00), because that is what a
clock reading is for; only the customer's page changed. The other two places the page names the
deadline changed with it, so the whole page agrees: the line under your business name ("Made to
order · closes 6pm the day before") and the note a customer sees if they left the page open
across the deadline ("Orders for this day close at 6pm the day before — please pick a new
posting day."). The Chinese page and the BM page say it their own way too (the
BM page reads **"6 petang"**), so a reader in any language gets words rather than a clock face,
and the wording the shop uses to describe a posting day is now the same in all three.

**20 Sep 2026 (Engine v124–v130, v132) — the courier's charge, and who bore it.** An order
can now carry a **courier charge** beside its note and tracking number. The **Note / tracking**
button on the row opens the box for it, and the same box sits in **Edit**. You record what the
courier asked for, and then **who paid it** — the customer or you. Because the same charge
means two completely different things depending on the answer, it lands in two different places:
a charge **the customer bears** is added to what they owe for delivery and named in their
WhatsApp message and on their own track page; a charge **you bore** becomes an ordinary
**Delivery & fuel** expense in your books, so it comes off your profit like any other cost and
the customer owes no delivery charge at all.

**One delivery charge per order — your rule, applied.** This app already quotes a flat RM8
postage on every posted order, so a recorded charge and the flat fee were two answers to one
question. As you decided, a recorded charge **replaces** the postage rather than joining it: a
customer-borne charge is the **one** delivery line they are quoted, never two, and a charge **you
bore** takes the flat fee away with it, so that order asks them for nothing on delivery at all.
An order with **no** charge recorded is quoted exactly as it was before any of this existed, and
a box half filled in — an amount typed with the payer left blank — changes nothing either.
**The postage fee itself is still never published to the storefront** — but it is now inside the
figure on the track page, so the customer's page and your WhatsApp message ask for the same
amount.

**Cash on delivery, if anyone ever asks for it.** The same box can be ticked so the courier
collects the charge at the door. The charge is still named in full, so the customer knows what to
have ready, but it is kept **out** of the amount your message asks for — asking for it up front
as well would be asking for the same money twice — and their page words it as a payment to the
courier, not to you. This is entirely optional and off unless you tick it; an order without it
behaves exactly as before.

**And the customer's own card catches up properly (v132).** Your phones have always agreed — an
order is a synced record — but the customer's track page was only re-sent when the day, the
tracking number or the charge moved. Edit the items, a price, the address or the name and their
page carried on quoting the order it used to be. The app now compares the **whole card** it is
about to send with the last one it sent, and re-sends it whenever anything on it differs. If a
write is refused — most likely because a SQL step has not been run yet — it is not remembered as
done, so it is retried rather than leaving that page wrong for good.

**Two SQL scripts to run once each, before this build goes live:** `supabase/courier_fee.sql`
and `supabase/courier_cod.sql`. Paste each into your Supabase SQL editor. The app publishes a
customer's whole track card in a single call, so a missing column refuses that call **as a
whole** — every customer's card would stop updating, not only orders with a charge. Both scripts
are safe to run twice. As always, **a commit or a push never runs SQL**: publishing the file to
your site does nothing to your database.

**Left out on purpose — your bakery has one thing this app does not.** The bakery gained a
**Production line** (a planner for focaccia bake days) in the same batch of work. Posting pouches
of jerky has no bake-day planner in it, so it was deliberately not copied across. That is the
first time the two apps have genuinely differed, and it is why this app's engine number is now
**its own** rather than a twin of the bakery's. Everything else is still the same code, and
future improvements still arrive here the same way.

**20 Sep 2026 (manual v123e) — a customer can put a code in, and the order tells you what
to take off (no new engine number: built here first, so both your apps stay on the same
number).** The order page now carries a small **Have a code?** box at the top, on every
visit. Until now a code could only arrive by scanning a label's square, so a customer who
was told the code at the counter — or who copied the letters off a card by hand — had
nowhere to put it. Typing a code **replaces** whatever the link brought, and clearing the box
and pressing Apply puts the label's own code back. **A code the app never printed is still
quietly ignored**, so a made-up code never lands in your books as a label that never existed.

**The page now says what will happen to the code.** Under the offer it reads, word for word:
__"We'll take this off when we confirm on WhatsApp — the total shown is before the
discount."__ If the basket is below the code's minimum spend it says how much more is needed
instead — __"Add RM8.00 more to use it."__ **The total on the page never moves, and that is the
whole point.** An order keeps the price it was sold at, so a discount quietly taken off on the
page would rewrite the money you actually earned — and __new customers only__ cannot be
checked from the page at all, because that needs your entire order book.

**So your app does the telling.** An order that came in on a code now carries a promo line on its
row and in its **Edit** box: the code, the name you gave that label, what it promised, and
__"take it off when you confirm."__ Two warnings appear when they apply — that the offer is for
new customers only and this person has bought from you before, or that the order is under the
code's minimum spend, naming both figures. Both warnings show only while the offer is still
live. **The line never goes blank:** a code you have since retired, or even deleted, is still
named, because the order records the label the customer actually came in on.

**One word in this entry was wrong, and is now fixed.** It said the promo line names "the shop or
product it was for". It does not, and could not: a code keeps only the *ids* of the shop or
product it was made for — their names are written for the customer's page and are never stored
in your book — so the line names the **label**, which is what you typed beside the square, and
the code itself when you left the label unnamed. That is the name you recognise on the shelf
anyway. **Nothing you see on screen has changed** — the two look-ups that read the missing
names never found anything and have simply been removed, which makes the code match the words
that describe it.

**One fix came with it.** The offer shown on the order page now honours its own **Ends** date —
a label whose offer has run out stops showing it, the way the landing page already did. The
label itself keeps working; only the expired offer goes quiet.

**Nothing in your books changes.** The line states; it never subtracts. Money, Profit, the
WhatsApp confirmation and the customer's track page all keep reading the price the order was
sold at, and what you take off at confirmation is still your decision — exactly how a
bring-a-friend credit already works. One small consequence: the counts on **Shops & codes** now
also include orders where a customer typed the code rather than scanned it, which is right —
it is the same printed label.

**20 Sep 2026 (manual v123c) — your landing pages: one page per promotion, picked on
each label (no new engine number: built here first, so both your apps stay on the same
number).** Under **More → Shops & codes** there is now a **Your pages** card, and a
**Landing page** dropdown on every label you make or edit. A page is a set of words for
one activity — __"Sample card"__, __"Raya promo 2026"__, __"Clearance"__ — so a promotion
running on a dozen printed cards is written **once** and every card on it follows. Leave
the dropdown on its first choice, **the shared page**, and the label reads the words you
already had.

**The words now come in three layers, and each line is decided on its own.** A customer
reading a label gets, for the heading and for the paragraph, in each of English, 中文 and
Bahasa Malaysia: the **shared page** first, then the **page the label picked**, then
anything that **label typed for itself** — the last one wins. So a page supplies the
lines it has and everything it leaves blank still comes from the shared page, and a label
on that page can still shout its own line over the top of both. Each language falls back
on its own: a page with only English typed still shows the shared page's 中文, rather than
going blank or mixing languages.

**A page is live, and that is the point.** Every printed label carries only its short
code and its words are read at scan time, so editing __"Raya promo 2026"__ changes what the
cards **already in customers' hands** say, with no reprint — one edit, every card on it
follows. A label that needs to differ types its own line, which always wins.

**Deleting a page loses nothing.** The labels sitting on it go back to reading the shared
page, and any lines those labels typed for themselves stay exactly where they are. The
confirm box tells you how many labels that is before it acts, and each page's row shows
the count too.

**20 Sep 2026 — printed labels with QR codes, and the page each one opens (no new
engine number: this was built here first, so both your apps stay on the same number).**
A new screen, **More → Shops & codes**, makes a code for anything you print: a pet
shop's sample card, a short promotion, a bring-a-friend card, or a plain card that
just says hello. Each code gets its own square — a **QR** you can download as a picture
or print as a sheet of labels — and that same code's short letters, like **K3X9**, are
printed small beside the square so you can tell two labels apart by eye.

**One code is one printed label.** A code can carry more than a promotion. It can name
the **shop** that handed the card out (with its contact, its commission rate and how
many samples you gave it), a **product and an offer** (a percentage or a ringgit
amount off, an optional minimum spend, an end date), an **introducing friend**, or
nothing at all. The screen keeps them in one list, so a new idea is one more row and
not a change to the app.

**What the customer sees.** Scanning the square opens a page carrying that label's
code. It says hello in your own words, states what that label offers — *"10% off · on
RM30 and above · new customers only · valid until 30 Sep"* — asks whether the treat is
for a **dog or a cat**, and sends them on to your shop **with the label still attached**,
so the order that follows is counted against it. Once an offer's end date has passed
the page stops promising it and says the offer has finished instead. **New customers
only** means exactly what you described: a WhatsApp number that has never bought from
you before.

**One label can say its own words.** Every label opens the same page unless you give it a
page of its own, and the shared page's heading and sentence are what a customer reads —
unless a label wants to say something the others do not. Open a code and tap **What this
label says on the page**:
a heading and a paragraph, in English, Chinese and Bahasa Malaysia, and a **Fill 中文 /
BM** button, exactly like the shared page's own copy. Anything left blank falls back to
the shared page's line for that same language, and the greyed text in an empty box is
the line a customer will actually get — so a label that says nothing for itself changes
nothing at all. Every translated box also carries a small **中文** or **BM** tag beside
it, so you can always see which language you are typing into: on a label the greyed text
inside the box is the shared page's line rather than the language's name, and two boxes
whose shared line is blank would otherwise both read as the same English. And a line you
have typed yourself stays yours — pressing **Fill 中文 / BM** again after you change one
line translates only the lines you left alone, and never overwrites what you wrote. That
is how one promotion card can shout its own offer while a shop's sample card keeps the
shop's words.

**You can see what a label brought in.** Every opening of a label's page is counted for
you, along with the dog-or-cat answer, on the same screen under **Label visits** — how
many visits, how many dogs and cats, and a line per label, busiest first. A shop's label
also shows the orders it has produced. The counts live in your own cloud behind your
login, so only you can read them; the public page can only add one. The order page's
own banner states the offer too, so a customer meets the same sentence twice.

**Hold a phone up to a printed label.** **Scan a label** opens the camera so you can
point it at a square and see at once which code it is, what it offers and how many
orders it has brought. Typing the short letters always works as well, and sits right
beside the camera button. The camera works on Android and on a computer; an iPhone's
Safari cannot read a QR inside a web page — that is Apple's rule — so on your phone,
type the code. (A customer's own camera app reads the square fine; that happens outside
the page.)

**Your own words, and the money stays yours.** The page's heading and sentence are
yours to write on **More → Shops & codes** — the shared page every label opens, and any
single label that needs its own — in English, Chinese and Bahasa Malaysia, so you can
change what a scanned label says without touching the app.
**No discount is ever applied silently**: the app states the offer and shows you what to
apply when you confirm the order on WhatsApp — exactly how the existing bring-a-friend
credit works. Your recorded prices and profit are never rewritten by a promotion.

**Your part, once.** Run **`supabase/taster_visits.sql`** in your Supabase SQL editor.
It makes the small table the visits are written into, and is safe to re-run. Until it is
run, labels print and scan normally — only the visit counts are missing, and the
**Label visits** card says so rather than going blank.

**What did not change.** Your prices, orders, customers, posting dates, the shop and the
way messages are written are exactly as they were. A code changes nothing until someone
actually scans one.

**18 Sep 2026 — engine v123 (no database setup needed). The product list's middle
section now groups sold out and not-sold-that-day together, and a product the shop does
not sell on a day is named by the days it IS sold instead of being given a count for a
day it was never on.**

**What was wrong.** The middle section was called **Sold out** and read its count for the day you
were adding to. But a product the shop does not sell on that day at all — a weekend-only treat on a
Wednesday — was sitting in **On the shop**, and worse, could be labelled "sold out" from a count for
a day it was never on the menu. Neither told you anything true.

**What it does now.** The middle section is **Unavailable**, and it holds both kinds together: a
product that has **sold out** for the day you are adding to, and a product the shop **does not sell
on that day**. The second kind is named by the days it IS sold — a weekend-only product on a
Wednesday reads "Chicken Jerky 100g — only Sat & Sun". The three headings are now **On the shop**,
**Unavailable**, **Taken down**.

**Why they are one section, not two.** They are the same thing to you: an active product you can
still choose. You make to a plan of your own, and as you put it — every day the kitchen may make 12
pouches, ordering closes the day before at 6pm, and the 12 are not necessarily sold off, so some go
to a walk-in or into the fridge. **The picker is a guide while you sell, never a gate**: nothing is
blocked, and the order-by deadline you set on a product is deliberately not counted, because that
deadline stops a stranger ordering — it says nothing about what you may sell by hand.

**Where to see it.** Orders → **＋ New order** → Items, and Orders → open an order → **Edit**.

Nothing else moved — your prices, customers, posting dates, the shop and the way messages are
written are all exactly as they were.

**18 Sep 2026 — engine v122 (no database setup needed). The product list now shows the three kinds
inside the list itself: each kind sits under its own heading, and on a newer phone each section is
tinted in its colour.**

**What changed.** Adding items to an order — in **＋ New order** and in **Edit** — the product list
now comes in three labelled sections instead of one long run of names: **On the shop** first, then
the ones you cannot sell for that day, then **Taken down**. The headings appear on every phone,
because they are part of the list itself.

**The colour.** On a phone with the very latest system — a new iPhone or a recent Android — each
section is also tinted inside the open list: **green** for on the shop, **amber** for unavailable,
**grey** for taken down. The list then reads as three blocks you can tell apart without reading a
word.

**On an older phone.** The open list is drawn by your phone itself, and an older phone will not let
a page colour it. You get the same three headings in the same order, and the closed box still wears
the colour of whatever it holds — you lose the section tint and nothing else. Nothing is broken,
and nothing has moved; only the colour is missing.

**This replaces the v121 note below.** v121 put the colour on the closed box alone, because the
open list could not be reached. Newer phones can be reached, so the list carries the colour too.

**Where to see it.** Orders → **＋ New order** → Items, and Orders → open an order → **Edit**. The
list is otherwise unchanged: the same products, the same "(hidden)" marker, the same "12 left"
count.

Nothing else moved — your prices, customers, posting dates, the shop and the way messages are
written are all exactly as they were.

**18 Sep 2026 — engine v121 (no database setup needed). The product list now shows you which kind
of product each choice is, in colour, and lists them in the order you would look for them.**

**What changed.** Adding items to an order — in **＋ New order** and in **Edit** — the product list
is now sorted into the three kinds you already know, in the order you would reach for them: what is
**On the shop** first, then anything that has **sold out** for the day you are adding to, then
whatever you have **taken down** (still marked "(hidden)"). A product still in Draft stays out of
these lists entirely, as it always has.

**The colour.** The closed box wears the colour of whatever is picked — **green** for on the shop,
**amber** for sold out, **grey** for taken down. On an order with several lines that means one
glance down the list tells you which lines need a second look, without reading each one.

**Why only the closed box.** The open list is drawn by your phone itself, and iOS does not let a
page colour the rows inside it. So the colour sits on the box you see while the list is shut, which
is where you read it anyway.

**Where to see it.** Orders → **＋ New order** → Items, and Orders → open an order → **Edit**. The
list itself is unchanged: the same products, the same "(hidden)" marker, the same "12 left" count.

Nothing else moved — your prices, customers, posting dates, the shop and the way messages are
written are all exactly as they were.

**18 Sep 2026 — engine v120 (no database setup needed). One customer is one row. The app now
recognises a phone number by its digits, so the same person can no longer appear twice just because
their number was written with a + in front of it — and the duplicate already in your app joins
itself into one the first time you open it after updating.**

**What was wrong.** A customer used to be identified by their number written in exactly the same way
every time. So **+60123456789** and **60123456789** looked like two different people, and the
Customers list showed the same customer twice. Your messages always went to the right person — only
the list disagreed. Numbers are now read by their digits, which means **012-345 6789**,
**+60 12-345 6789** and **60123456789** are one person, the same way "012345" already found
"012-345" in the finder.

**It tidies itself once.** The first time you open the app after updating, it joins any customer who
was split this way, carrying their pet's name and photo, what they like and avoid, and their note
across to the one that remains. There is nothing to do — you will simply find one row where there
were two. If you are the careful sort, take a cloud backup first from **More → Backups**: that is the
way back if anything looks wrong, and it costs one tap.

**New: "Join with another customer".** Open a customer's history and you will find the button under
their number. Tap it, pick the duplicate from the list, and confirm. Reach for it when two rows are
split for some other reason — a misspelt name with no number beside it, say — which the tidy above
cannot guess at. It moves the other person's orders under the name and number of the customer you
were looking at, so open the row you want to KEEP. This one cannot be undone inside the app; your
cloud backup is the way back, and the confirm box says so before it acts.

**Two things worth knowing.** Update both phones — a phone still on v119 can save a number the old
way from its Profile card, and only the updated build does the tidy. And on the Profile card itself,
the number you type is now stored in the one form every label, message and link already uses, so a
"+" or a space can never split a customer again.

Nothing else changed — your prices, your posting dates, the shop and the way messages are written
are all exactly as they were.

**18 Sep 2026 — engine v119 (no database setup needed). Start typing a customer's name in an
order form and the people you have already served appear underneath — tap one and their name and
WhatsApp number fill themselves in.**

**How it works.** Type two letters — "aun" is plenty — and a short list appears right under the
name box. Each row shows their number, how many orders they have placed, and the item they buy
most, like **012-345 6789 · 5 orders · usually Chicken Jerky 100g**. Tap the right person and the
name and the number both go in; the posting day, the items and collect-or-post stay yours to set.
One letter on its own is not a search — it would offer you half your address book — and a name you
have never served offers nothing at all. Typing a number without its dashes finds them too, so
"012345" works the way "012-345" does.

**Both order forms do it** — the **＋ New order** card and the **Edit** pop-up, the same way.

**Two things worth knowing.** It draws on the orders already in the app, so on a brand-new setup it
has nothing to offer until your first order is saved. And on the **Edit** form, saving a changed
name has always carried that name to every other order belonging to the person it was — that is the
one-saved-name rule from v68 and it has not changed, but picking a name is now much easier than
typing one, so it is easier to do by accident. If you ever pick the wrong person while editing an
order and save it, tell me and I will add a confirmation that asks first.

Nothing else changed — the Customers screen, its finder, your prices and the shop are all exactly
as they were.

**18 Sep 2026 — your phone pings the moment an order lands (no new engine; the
phones did not change).** Until now the app only found out about a customer's
order when you opened it, so an order placed at night sat unseen until morning.
Your database can now send the alert itself: **the instant a customer taps Place
order, a notification arrives on your phone** — even with the app closed, the
phone locked, and no computer switched on.

**How it works.** A rule in your Supabase project watches the orders table. The
moment a new order lands it writes a short summary — the customer's name and
WhatsApp number, the items and quantities, the posting day, the total, and any
note or address — and hands it to the free **ntfy** app, which pushes it to
whichever phones have subscribed to your private channel. Orders you add by hand
in the app stay silent; only orders customers place on the order page ping.

**Your part, once per phone.** Install the free **ntfy** app, tap **+**, and type
your own private topic (the 16 letters and numbers after 'furkidz-orders-' that
your setup script showed you). Leave the server at the default **ntfy.sh**, then
allow notifications. Every phone holding that topic pings at the same moment, so
a helper's phone can hear it too.

**The topic is a password.** Anyone who knows it can read your alerts — so it is
stored in your own database and deliberately kept out of the app and out of
GitHub. The app cannot leak it. If it ever does leak, one line in the SQL editor
gives you a fresh topic and you re-subscribe the phones.

**A failed ping can never block an order.** If the alert cannot be sent for any
reason, the customer's order is still saved — and the reason is written down in
`order_alert_errors` so you can read it later. The whole setup is one script,
`supabase/order_alerts.sql`, which is safe to re-run. Since nothing on the phones
changed, this is not a new engine version.

**17 Sep 2026 — engine v118 (no database setup needed). The Paid step now stays in
its place on every order, wearing an X until the money is in — and turns into a
green tick when it is.** This replaces what v117 did, on your instruction.

**Your reasoning, and you are right.** The customer's track page is the design:
they must see the same steps in the same places every time, and your own app has
to read the same way. v117 left the Paid step **off** an order that skipped it —
five dots instead of six — which meant the two lines did not line up, and a
missing step is itself a thing to puzzle over.

**What happens now.** A regular who pays when you collect still never passes
through Paid. But that step keeps its place in the line, and it wears an **X** —
amber, deliberate — instead of a tick, and it never turns green while the money
is outstanding:

> New: done  ·  Confirmed: done  ·  **Paid: x**  ·  Preparing: done  ·  Packed: done  ·  Collected / Posted: current

Press **Paid · Cash** or **Paid · TNG** when the money is handed over — at
whatever stage the order has reached — and **the X becomes the tick**: the
ordinary green tick, in the same spot, with the **Cash** or **TNG** tag beside the
row. The order itself stays where it was: taking the money never drags it
backwards.

**Both lines change together.** Your row's map and the **customer's own track
page** draw the same six steps, so the X is on their page too, and it turns green
there the moment you record the money. A step that is *deliberately gone past but
not paid* now looks different from a step that has not been reached (grey) and
from a step that is done (green) — which is exactly the distinction that was
missing.

**17 Sep 2026 — engine v117 (no database setup needed). A regular who pays when
you collect no longer has a Paid step on that order — and the Paid · Cash /
Paid · TNG buttons stay on until the money is actually recorded, wherever the
order has got to.** From your note about close customers paying by TNG or cash at
pickup.

**What was wrong.** Move an order from Confirmed straight to Preparing — no
payment — and the row's map still showed **Paid with a green tick**. It was
claiming money you had not taken. The app assumed "past Paid means paid", which
is fine for your older orders but false for a regular who settles up at the
counter.

**What happens now.**
- **A bypassed order has no Paid step.** That route reads New → Confirmed →
  Preparing → Packed → Collected / Posted: **five dots instead of six**, and no
  tick for a payment that never happened.
- **The Paid · Cash / Paid · TNG buttons stay on** at every stage from Paid
  onwards — Paid, Preparing, Packed, and Collected / Posted — until the money is
  recorded. So the moment the cash is handed over at the counter, wherever the
  order has got to, you press the button right there: **the order stays where it
  is** (marking an order paid never drags it backwards) and the money is stamped
  with the day it landed, which is the day the Money screen counts it.
- **And the Paid step comes back once it is paid** — a green tick, in its proper
  place in the line, with the **Cash** or **TNG** tag beside the row. So the map
  ends up telling the truth about that order either way.
- The buttons disappear the moment the payment is recorded, and they never appear
  before the order reaches the Paid stage.
- **The customer's own track page follows the same rule** — same five dots, no
  Paid tick for a payment that has not happened, and the step appears there too
  once it is recorded.

One rule behind it, worth knowing: moving an order into Paid **or any later
stage** without having pressed a Paid button is taken as *this order owes money*.
That is what your older orders are protected from — nothing already in the app
changes, because only orders you move now are marked.

**17 Sep 2026 — engine v116 (no database setup needed). A Day one form: your
opening balance — the cash in the tin, the money on your phone and what is on
your shelf — entered once, in one place.** From you telling me *"we need to enter
opening balance"*.

**What an opening balance is here.** Four answers about the morning your books
begin: what is in the tin, what is on your phone, what is on your shelf, and who
still owes you. Until now the app could take all four, but in three different
places and one ingredient at a time, which is a poor way to start.

**The form.** More → Money → the new **Day one** line (under **Books**) → **Set**.
It asks for:

- **Cash in your tin** and **Money on your phone (TNG)** — two boxes, and the day
  your books begin, which takes any date but should be the day you are starting
  from.
- **What is on your shelf** — your ingredients, one box each, already in the unit
  you use for that ingredient (kg for the meat, g for the oil — no converting).
  Ingredients you have marked as *not something I buy*, like labour, are left
  out: they have no shelf to count.
- **Who still owes you** needs no box — those orders stay unpaid and show under
  **Still to collect**.

**Nothing is half-saved.** Every box is checked before anything is written: if
one has something that is not a number, nothing saves at all until you fix it.
And **a box you leave empty is left exactly as it is** — so the form is safe to
reopen later just to correct one figure, and safe to run again without wiping
what you already had.

**What it writes.** The tin and the phone become ordinary money-in rows dated
that day (so from then on the Money screen's **Net** is what you should really
hold, and the weekly check works from the first week), and the shelf becomes each
ingredient's **On hand** — the figure your shopping lists subtract, so your first
list buys only what you are genuinely short of.

**What it deliberately does not do.** Money you **owe** — a loan you took out for
equipment, a supplier you have not paid — has nowhere to go: the app keeps a loan
as a way of paying, not as a debt, so record what it pays for as it happens. Your
own money in shows under **Capital you put in** on Profit, never as income. And
the tin must not be entered as a sale: a sale has a customer behind it.

**17 Sep 2026 — engine v115 (no database setup needed). The month arrows on Profit
work both ways again.** From you telling me *"the profit month can move earlier but
cannot move later"*.

**What was wrong.** Open Profit — it starts on this month, where the forward arrow
is correctly switched off, because there are no numbers after today. Press the back
arrow to step back to August, and the forward arrow stayed switched off too, so you
could not get back to
September. You could walk backwards through the months but never forwards again: to
return you had to leave the screen and open it again. The arrow's state was worked out
once, when you opened the screen, and then reused on every step — so it kept answering
for the month you started on rather than the month you were looking at.

**Fixed.** The arrows are worked out fresh on every step, so the back and forward
arrows now move both ways between the months you have, and the forward arrow switches
off again only when you are
back on this month. The same fault did not exist on the other calendars — Orders,
Delivery dates and the date pickers all recompute their arrows each time they draw.

**17 Sep 2026 — engine v114 (no database setup needed). Every spending line in Profit &
Loss now opens — including the ones reading 0.00 — and the lines are twice as tall, so
they are easy to tap.** From you asking *"in profit the expenses is not clickable, is
that a bug?"*

**You were right, and it was my mistake.** The lines that open their journal were the
ones with money in them. A line showing **0.00** was deliberately left dead, because
there is no journal to show — but I made it look **exactly** the same as a live one:
same colour, same font, no hint. So if your month has most categories at 0.00, nearly
every line you tapped did nothing, and "not clickable" was the only sensible conclusion.
A line that looks alive and does nothing is worse than no line.

**What it does now.** Every spending line opens: *Packaging*, *Utilities*, *Delivery &
fuel*, the categories you have added, and **Total expenses**. A line with money in it
shows its journal as before. An empty one opens and **says so in your own words** —
*"Nothing recorded under Utilities in September 2026"*, In / Out / Net at zero, and a
line telling you it will fill up on its own as you record spending under that category.
The statement's own totals (**Sales**, **Cost of sales**, **Gross profit**, **Net
profit**) stay figures rather than doors — they are not spending, and you did not ask
for those.

**Two more things found while fixing it.**

- **The lines were only 17 pixels tall** — a small target for a finger, and easy to land
  in the gap between two lines and hit nothing. Tappable rows everywhere (the Profit
  statement, the Money screen's cash rows, the Books list) are now **36 pixels**,
  comfortably thumb-sized.
- **The Total expenses journal did not say which category a row belonged to.** It read
  *"2 Sep · boxes · Cash"* with no way to tell what "boxes" was for. It now names it —
  *"2 Sep · Packaging — boxes · Cash"* — while a single category's journal still reads
  short, since its title already says which category it is.

**17 Sep 2026 — engine v113 (no database setup needed). Every way you pay now has
a book you can always open — including a pocket that has been quiet — behind a new
Books line on the Money screen.**

**What was wrong.** The journal rows live on the money card, and that card only shows
a pocket's row **when that pocket moved money in the stretch you are looking at**.
The card opens on **Today**, so a pocket that paid for something last week had no row
today — and no way into its book at all. Cash and TNG never had the problem: their
four rows (Cash in, Cash out, TNG in, TNG out) are always there. The pockets were the
only books that could go missing.

**The Books line.** Under the two money cards there is now a second line beside
*Categories & ways to pay*:

> **Books**
> Every way you pay · each opening into its own rows

**Open** lists **every** way you pay — Cash, TNG, Loan, a personal pocket you have
added, and anything you add later — each with what moved by it in the stretch on
screen, each opening into its own book **under the line you tapped**, so the list
stays in front of you and you can step from one book to the next. The first method
with anything in it opens ready; a quiet pocket says so plainly — *"Nothing moved this
way in this stretch"* — with its In / Out / Net at zero.

Two things this keeps honest: a method you have since **renamed or deleted** still
gets a line, because its money is still in the books and a figure you cannot open is a
figure you have to take on faith; and every figure in the list comes off the Money
screen's own rows, so the list and those totals cannot drift apart.

**17 Sep 2026 — engine v112 (no database setup needed). You can pay a personal pocket
back out of the till in one go, and the category list on the expense form is no longer
cut off.**

**Pay back a pocket.** On **More → Money**, beside **＋ Put money in**, there is now
**＋ Pay back a pocket**. It is for the case where a pocket of yours — a personal
pocket you added, a loan — paid for something, so the money left you rather than the
till; that pocket's line on the Money screen then reads **−RM 40.00**, which means
*the till owes it 40*. Open the form and it comes up **already on the pocket that is
owed**, with the amount filled in, and a line saying so. Say whether the money came out
of **Cash** or **TNG**, check the day, and press **Pay back**.

It writes both halves at once, which is the whole point: the **till goes down** by that
amount (it shows in Cash out and in the Net, and in the Cash journal with your note),
and the **pocket's line comes back to zero**. One pocket can be paid back without
touching another. Because it is your own money going back to you, the till's side is
recorded as a withdrawal — so it never counts as a cost and your **profit does not
move**. On the pocket's own list it reads *"Paid back by the till"*, not *"From my
pocket"* — the two are different things and now say so. Paying it back in part is fine:
pay RM 25 of the RM 40 and the pocket reads −15 after.

**The category list was being cut off — fixed.** Thank you for catching this. On the
expense form, the row of categories ran off the side of the screen: it was laid out as
one single line, so at phone width everything past about the sixth category — *Salary
(you)*, *EPF / SOCSO*, *Marketing*, *Equipment & tools*, *Other*, *My own withdrawal*,
and the **＋ New category** chip — was off the screen and impossible to reach. Measured
on a 375-pixel phone, the row was 744 pixels wide inside a 343-pixel box. The pills now
**wrap onto as many lines as they need**, the same fix applies to the ways-to-pay row
and to the new pay-back form, and the whole list is visible and tappable. Nothing about
the categories themselves changed.

**17 Sep 2026 — engine v111 (no database setup needed). Every figure on the books is
now a door: a journal behind each line of spending in Profit & Loss, and a book for
every way you pay.**

**Profit & Loss — tap a spending line and see what made it up.** On **More → Profit**,
the running-cost lines (Packaging, Utilities, Delivery & fuel…) are now tappable, and
so is **Total expenses**. Tapping one opens its journal for the month on screen: every
expense behind that figure, oldest first, each reading *"<day> · <what it was for> ·
<how it was paid>"* and ending on the total the statement itself shows. So *"Packaging
RM -58.00"* opens two lines — the boxes paid from a pocket and the bags paid in cash. A
line with nothing in it that month is not tappable; there is nothing behind it. The
header now says **Running costs · tap a line to see the spending behind it**.

**Money — one line and one book per way of paying.** The single *"Paid by loan / other"*
row is gone. In its place, every way of paying that is not cash or TNG gets **its own
line** with what moved by it, and its own journal behind it: **Paid by Loan**, **Paid by
Personal Pocket …** — whatever you have called them. Money of your own you put in that
way reads as a plus on that line; what was paid out of it reads as a minus. Cash in, TNG
in, Cash out, TNG out and the Net are exactly as they were, and none of these other ways
is in the net — it never came out of your purse.

**Why they appear by themselves.** The lines are read off your own transactions, not off
a fixed list, so a method you add tomorrow needs nothing from me: record one payment
with it and it has a line and a book. And a method you have since **renamed** keeps a
line for the name its older rows were written with — those rows are still in the books,
and a figure you cannot open is a figure you have to take on faith. Each book ends on
**In / Out / Net** for that method.

**One small correction while here:** the note at the foot of the Profit screen now
matches v110 — either pay yourself a **Salary (you)** expense (with EPF / SOCSO as their
own category), or mark Labour as a not-bought ingredient and put the hours into the
recipes. Count them one way, never both.

**17 Sep 2026 — engine v110 (no database setup needed). An ingredient you never buy —
your own labour, electricity, gas — can be marked as a cost, and it then never appears
on a shopping list again.**

**What it does.** Open **More → Ingredients** and tap **Edit** on the ingredient (or
fill in the New ingredient card at the top). Above the cost there is now a switch: **Not
something I buy — it only ever costs. It still counts in a recipe's cost, but it never
appears on a shopping list or a purchase order.** Turn it on for Labour, Electricity,
Gas, your own time.

**Where you see it.**
- The ingredient's **card** stops showing an On hand and a Keep-at-least line, and says
  instead: *Not bought — a cost in your recipes, never on a shopping list*. Nothing else
  about the card changes, and the cost you typed is untouched.
- Every **shopping list** (the preview, the list you save, and an "orders changed"
  follow-up) leaves that ingredient out — and says so at the foot of the list: *Not on
  this list: Labour, Electricity — marked as not something you buy. Their cost still
  counts in the products that use them.* So it reads as deliberate, not as something the
  app forgot.
- The **recipe cost** is unchanged: a recipe using Labour at RM 8 an hour for 15 minutes
  still adds RM 2.00 to that product's cost, and that runs on into the Profit screen's
  cost of sales.

**Switching it OFF restores the ingredient exactly as it was** — the app removes the
mark rather than storing a "No", so nothing that exists today changes unless you turn
this on.

**And a word on the books, since this touches Profit:** if you mark Labour as
not-for-purchase because it is your own unpaid time, it is already inside each product's
cost of sales through the recipe — so do **not** also record it as a Salary expense, or
the same hours get counted twice. The **Salary (you)** category is for when you actually
pay yourself money out of the till.

**16 Sep 2026 — engine v109 (no database setup needed). A journal for each way the money
moves — the cash book, the TNG book — and a bug that was hiding in the TNG column.**

**A bug first, because it matters.** Every order you marked **Paid · TNG** since v106
was landing in "Paid, no method" instead of the TNG column. The app was checking for the
old way of writing it ("tng") while the paid buttons write the list's own label ("TNG") —
so the TNG in figure read RM 0.00 with the money in your phone, and the same money showed
as unaccounted for. Fixed, and there is now a test that would have caught it. If your TNG
column has looked wrong since v106, that was it.

**Tap a figure, see its journal.** On the Money screen, **Cash in / TNG in / Cash out /
TNG out** (and the loan line) can be tapped. Each opens that method's book for the
stretch: every order paid that way with its code and customer, everything you spent out
of it with its note, anything of your own you put in — in date order, ending on In / Out
/ **Net**, and a line saying what that is meant to be (your purse, your phone, or money
that never went near either).

**16 Sep 2026 — engine v108 (no database setup needed). Where the two lists live, and
how to change one.**

**Why.** v106 put them in a Settings card and you could not find it, and there was no way
to change an entry once it existed — *"dont put the setting separately, it should be at
where it suppose to be."*

**They are on the Money screen now**, as a line under the money lists reading
"Categories & ways to pay · 11 categories · Cash, TNG, Loan" with an **Edit** beside it.
Tap Edit and the lists open: every category with its kind (ingredients / running cost /
your own money) and every way to pay, each line saying "edit".

**Tap a line and it turns into the form**: rename it, change what kind it is, or delete
it — in place, with the rest of the list still in front of you. Renaming moves what you
have already recorded with it, so a slip of the thumb does not split your history into
"Packaging" and "Packing".

**And the ＋ chips sit where you are working**: the Add an expense form and Put money in
each end their pills with **＋ New category** / **＋ New way to pay**, which opens the
same small form in place — the amount and the note you had already typed stay put.

**No window inside a window.** These forms expand in place instead of opening a pop-up of
their own, the same rule the date field follows: the app has one pop-up layer, so a
second one would wipe out the form underneath it.

**16 Sep 2026 — engine v107 (no database setup needed). The item line on an order reads
properly again.**

**What was wrong.** When the selling price joined the line (v101) it took most of the
row. Measured on a 375px phone: the price box was 183 pixels wide and the product
dropdown was squeezed to **2** — so the name of what you had picked was pushed onto a
line of its own and unreadable, and the whole line looked broken.

**What it does now.** Each item line is two clean lines: **the product across the top**,
full width so its name reads, and its controls under it — how many, the selling price on
the right, and the ✕ to remove. The same shape in the ＋ New order card and in the Edit
pop-up, since both are the same row.

**16 Sep 2026 — engine v106 (no database setup needed). A note on every transaction, and
two lists you shape yourself.**

**A note on each one.** Add an expense now takes a note ("Mydin run, 2 boxes") — the Put
money in form already had one — and both lists on the Money screen show it beside the
amount, so a row reads as what it was, not just a figure.

**The categories are yours.** Every category shows what it means to the accounts
(ingredients / running cost / your own money), each has a ✕ to delete it, and you can add
your own — "Pet expo", "SSM licence" — choosing which of the three it is. Deleting one
never touches what you have already recorded: those rows keep their label and still
count, printed at the end of the statement's cost list rather than dropped.

**And the ways to pay are yours too.** The list is Cash, TNG and **Loan** — the third
choice you asked for — and you can add your own, a **Bank OD** or a cheque, so a shopping
run nobody would pay for out of the till can still be recorded honestly. The same list
appears on the Bought prompt (where the receipt is still in your hand) and on both money
forms.

**One thing that follows from it.** Money that never came out of your purse — a loan, an
overdraft — no longer sits in the net. The Money screen leaves it out of the cash figures
and names it on its own line, with a sentence saying why. Net now means exactly what it
says: what should be in your purse and on your phone.

**16 Sep 2026 — engine v105 (no database setup needed). The books: a profit and loss
account, a month at a time.** One new screen, More → Profit.

**Why.** Money told you what was in your purse. It could not tell you whether the making
made money — a RM250 meat run makes one week look like a disaster while the treats it
went into sell the week after.

**What it shows.** More → Profit, month by month (arrows either side), reading down like
a set of accounts: Sales, Cost of sales, Gross profit, the running costs one line each,
Total expenses and Net profit — with the gross margin beside the order count. Then, kept
apart from all of it, your own money: capital you put in, drawings you took out, and what
is left in the business.

**The one rule that makes it accounting rather than a cash total.** Ingredient cost is
what the making cost, taken from your RECIPES as the treats sell — not the packs you
bought. Buying and using sit in different places on purpose: a shopping run is money out
on the Money screen and stock on your shelf, and it becomes a cost of sales here as the
treats made from it go out. Nothing is counted twice, and a big stock-up week stops
looking like a loss.

**Your own money is neither income nor a cost.** What you put in is capital; what you
take out is drawings (including the "My own withdrawal" category). Both move cash — Money
counts them — and neither changes profit. If you pay yourself a proper salary, record it
as **Salary (you)**, with **EPF / SOCSO** as its own category, and those DO count as
running costs.

**The category list is now a chart of accounts:** Ingredients & shopping (stock),
Packaging, Rent, Utilities, Delivery & fuel, Salary (you), EPF / SOCSO, Marketing,
Equipment & tools, My own withdrawal, Other — the same list the Add an expense form
offers, so every row lands on the right line of the statement.

**Two things it will not pretend to know.** Your own unpaid hours are not a cost — if
your time is worth paying, pay yourself a salary and it becomes one. And a product whose
recipe prices to nothing is counted as costing nothing; the screen says how many lines
that was, so it is visible rather than flattering.

**16 Sep 2026 — engine v104 (no database setup needed). Money you put in yourself, and
taking it back out.** One change, on More → Money.

**Why.** Some spending happens before any order money arrives — a packet of meat paid
from your own purse, a float of change for the day — and there was nowhere to put it. The
Money screen only counted what customers paid.

**Put money in.** More → Money now has a **Put money in** button beside Add an expense:
how much, the day you put it in, cash or TNG, and a short line saying what it was for. It
counts into the Cash in / TNG in rows, because your own money really is in your purse and
those rows are what you check the purse against — and one line underneath says how much
of the money in was yours: "of the money in, RM 100.00 was your own". The entry is listed
in its own **Money in** card, so you can see where it came from, and take it off again.

**Taking it out again.** Add an expense has a new category, **My own withdrawal** — money
you take back for yourself rather than a cost of making. It leaves through the same
money-out list as everything else, so the net, the day lines and your backups count it
with no new machinery.

**16 Sep 2026 — engine v103 (no database setup needed). Money out: what you spend, beside
what you take in.** One change, on the shopping side of the app.

**Why.** v101 gave you the money coming in. Spending had nowhere to go: a purchase order
worked out what a shopping run should cost, and tapping Bought put the packs on your
shelf, but nothing recorded what you actually paid.

**A shopping run now asks.** Tap **Bought** on a saved list and, once the packs are on
your stock, a small box opens: **What did you pay?** — pre-filled with the list's own
total, with **Cash** or **TNG** beside it. Accept the guess with one tap, or type what the
receipt really said. **Skip the money** leaves the stock added and records nothing,
exactly as the app behaved before.

**Everything else goes in by hand.** More → Money now carries an **Add an expense** form
for what a purchase order never sees — packaging, delivery and fuel, utilities, equipment,
or a market top-up — each with the day you paid it, so a receipt found in your bag later
still counts on the right day.

**The Money screen adds it up both ways.** Cash in, TNG in, Cash out, TNG out and **Net**
— what should be in your purse and on your phone for Today / This week / This month —
with that stretch's spending listed underneath, each line showing what it was for and how
you paid. What is still to collect stays out of the net: it is money owed, not money held.

**One fix along the way.** A payment taken just after midnight was being counted as the
day before, because the app read the date off the stamp in UTC. It counts on your own day
now.

**16 Sep 2026 — engine v102 (no database setup needed). Swipe across the calendar
to pick a run of delivery dates.** One small change, on More → Delivery dates.

The delivery-date calendar now works the way a product's availability calendar does:
**drag across days and the whole run fills in under your finger**, then **Add
selected** puts them on the calendar. It is the same gesture as dragging a sell
period on a product. A single tap still picks one day (or puts it back), and a day
that is already a delivery date is left alone by a drag — it comes off by tapping
it, the way it went on.

That makes four ways in: tap dates, swipe a run, tap a weekday letter for every one
of that day in the month, or **Generate the next dates** on your Settings pattern.

**What I deliberately did NOT copy: the From / To boxes.** On a product's
availability card those two boxes are how a SEASON is said — a sell period genuinely
has two ends. A delivery date is one day, not a stretch, so a From/To here would only
ever have been a slower way to do what swiping now does.

**16 Sep 2026 — engine v101 (no database setup needed). A price you can change on
an order, and the money recorded as cash or TNG.** Three things, all about money.

**A price you can change on an order.** Every item line on the ＋ New order form and
in the Edit pop-up now carries its selling price. It opens on what the product costs;
type over it and THAT order is sold at your price — the confirmation, the payment and
pickup reminders, the receipt, the customer's own track page and every money number in
the app follow it. Your menu price is untouched, and a menu price you change next week
never rewrites a sale already made. Blank keeps "whatever the product costs", which is
how an unpriced product has always behaved. Both forms also show the items total as
you go.

**Cash or TNG, written down when the money lands.** The Paid button is now **Paid ·
Cash** and **Paid · TNG** — one tap each. The order remembers which, and when, and
shows it beside its status. The Note / tracking box (now **Note / tracking /
payment**) carries a **Paid by** box as well, for an order you marked paid before you
could tell, or one to correct later. None of this reaches the customer: their page
just shows Paid.

**Two places to check it against.** The delivery day's own header on Orders now
carries a short till — "Cash RM 95 · TNG RM 120 · 1 to collect". And More → **Money**
is a screen of its own, with **Today / This week / This month**: cash collected, TNG
collected, paid but no method recorded, and what is still to collect with the number
of orders. Collected money is counted by the day it LANDED, so a transfer that comes
in today counts today even when the order goes out on Friday; what is still to
collect is counted by the delivery day, because that is the day you hand it over. An
order paid before any of this existed shows under "Paid, no method" rather than being
guessed at.

**16 Sep 2026 — engine v100 (no database setup needed). Making delivery dates for
a weekday is one tap again.** One change, on More → Delivery dates.

**Why.** You found the function missing: adding your delivery dates for, say, every
Monday meant tapping each Monday by hand. Nothing had been removed — the app's only
"do the dates for me" button lived on Home, inside the "No delivery dates yet"
message. That message shows only while you have no upcoming dates, and pressing the
button creates the very dates that hide it: it was a one-shot button that took
itself off the page the moment it worked. So once you had dates, which is every day
since your first week, it was never there again.

**Three ways in now.** On More → Delivery dates: tap dates and **Add selected**, as
before; or **tap a weekday letter** — tap **M** and every Monday in the month shown
is picked for you, tap it again to put them back, and the letter underlines solid
once that whole weekday is picked; or press **Generate the next dates**, which is
always there, follows the delivery days in your Settings, and adds the next six
dates that are not on the calendar yet. Generate moves the calendar to the month the
new dates start in, so you can see what it just did.

**One wrong line fixed with it.** Home's "no dates yet" message used to say "the next
Mon/Wed/Fri dates" whatever your delivery days really were. It names your own days
now (and so does the line under Generate).

**15 Sep 2026 — engine v99 (no database setup needed). The customer can tap the
"Next available" line and be given that day.** One change, on the order page.

**Why.** A product you keep on the shop, on a day it cannot be ordered, tells the
customer when it can be had — "Next available: Sat 19 Sep". Until now they had to
go and find that date on the calendar themselves.

**What it does now.** The line is a control: tapping it takes that posting day, so
the product in front of them can be ordered straight away, and the page moves up to
the calendar, where the chosen day is written out in words. It keeps its gentle
pulse, and wears a small arrow so it reads as something to tap.

**The one time it does not take the day.** If the customer already has something in
their basket, the line stays a plain label and tapping it answers instead: "Your
basket is for Fri, 18 Sep. To order for another day, choose it on the calendar
above." Taking a day then would silently move their whole order to a new date — and
drop anything that does not fit there — which is not something a tap on a product
line should ever do. Changing the day is what the calendar is for.

**16 Sep 2026 — engine v98 (no database setup needed). The last status reads
Collected / Posted, and a placed order gains a Note / tracking button.** Two
small changes on the Orders screen.

**One label for the last stage.** v97 named it per order — Collected on one the
customer fetches, Posted on one you mail. You asked for the pair itself instead,
so the stage now reads **Collected / Posted** everywhere it is named: the row's
status list, the row's own journey map, the day's status filter, and the map on
the customer's track page (in all three languages). Which message the row offers
is still decided by how the order leaves — a post order shows **Send posted
message**, a Collect one **Send pickup reminder**.

**A way in for the two fields you reach for most.** Beside Edit, every order now
carries a **Note / tracking** button. It opens a small box with exactly two fields
— the order's **Note** and the courier's **Courier tracking number** — and a Save.
Send, and the note lands on the order, while the tracking number also goes onto
the customer's track card and into the posted message. Nothing else moved:
**Edit** still opens the full form (the posting day, the customer, the address,
the items, the quantities) whenever you need it. The tracking box that sat on the
row itself in v97 is gone — the button is the quicker, tidier way to the same
field, and it works on any order rather than only a posted one.

**16 Sep 2026 — engine v97 (one database line to run once). The last status is
named for how the order leaves, and a posted order can carry its courier's
tracking number.** One change, across the order row, the WhatsApp messages and
the customer's track page.

**The last status is Collected or Posted.** The final step used to say
"Delivered" for everything. It now reads **Collected** on an order the customer
fetches from you and **Posted** on one you mail — the same step in the journey,
named for what actually happened. That is true everywhere the status is named:
the row's status list, the row's own journey map, the day's status filter, and the
map the customer sees on their track page (in all three languages). Nothing about
the step's behaviour changed, and every order already sitting at that step keeps
its place — only the word is different.

**A tracking number, typed where you post the parcel.** A posted order shows a
**Courier tracking number** box under its details from Packed onwards, and a
**Send posted message** button beside the status. Type the number the courier gave
you, press the button, and WhatsApp opens with the message already drafted: the
order code, what was sent, and the tracking number. The box is in the Edit pop-up
too, for a number you need to fix or read back over the phone.

**The customer sees it.** The number is published with the order, so a posted
order's track page shows it on its own line under the delivery details — they can
read it to the courier without messaging you. Collect orders show no such line.
The posted message is only offered on post orders: a Collect order keeps its
**Send pickup reminder**, which is the message that fits that hand-over.

**What you need to run once.** The tracking number needs one column added to the
tracking table — `supabase/track_no.sql` (a single ALTER, safe to re-run). Until
that runs, everything else works; the number just reaches the message and not yet
the customer's page.

**16 Sep 2026 — a stray "null" removed from two screens (no engine change; the
phones did not change behaviour otherwise).** Found while checking the new v96
pop-up, and fixed in the same pass.

**What was wrong.** The word **null** could be printed on the page under the day's
total, and at the very bottom of Settings under "Delete all data". Nothing was
broken behind it — no order, price or setting was ever wrong — but a stray line
reading "null" is alarming to read, so it is gone.

**Why it happened.** The app builds its screens from pieces, and a piece that is
only sometimes needed was being handed over empty in a way the browser prints as
the word rather than skipping. The two places that could show it were the day
pop-up (when every product on sale that day was counted, which is the usual case)
and the Settings screen (whenever you have any product or ingredient — that is to
say, always, once you are set up).

**The guard.** A new automatic check builds both screens and fails if the word
"null" can appear on either, so a future update cannot quietly bring it back.

**16 Sep 2026 — engine v96 (no database setup needed). "Set day's availability"
now shows how the day adds up.** One change, on the pop-up you already use.

**Why.** v95 made a day's total count only the products you sell that day, but the
pop-up that sets those numbers still showed nothing about where the total came
from — and a product you do not sell that day sat in the list looking as if it were
part of it.

**What it does now.** Under the product rows, the pop-up ends with **How the day
adds up:** one line per product on sale that day with what it contributes, and a
final line with the total — **the same number the order page uses for that day**.
Type a + or a − and the lines and the total move as you type. Underneath, the
pop-up names what it left out ("Not counted: Duck Jerky — not sold on this day,
so no order can go on them here") and says what is already booked, so you can read
how much the order page can still take. A product not sold that day keeps its row
so you can still set its numbers; it simply does not enter the total.

**One number, one place.** That sum and the day's capacity are worked out by the
same code the shop's own numbers come from, so what you read on screen and what
your customers get cannot drift apart.

**16 Sep 2026 — engine v95 (no database setup needed). A day's total now counts
only the products you actually sell that day.** One change, on your side of the
app, with one knock-on for customers.

**What it was doing.** The "x/y" on a day — the chip beside the date on Orders, the
same number on the day in the month calendar, and the dials on Home — was adding up
the daily limit of every product on your menu, whether or not that product can be
ordered on the day you were looking at. So a day with one product on it (a limit of
12, say) still read **1/42**: thirty of those units were limits belonging to
products that could never take an order that day.

**What it does now.** Only the products on sale that day count. A Saturday-only item
adds nothing to a Wednesday, and a product kept on the shop as **Unavailable** adds
nothing to a day it is not sold on. The same day now reads **1/12** — what that day
can really take. Products with no sell marks are unchanged (they sell every day, so
they always count), and a day where nothing on sale has a daily limit falls back to
the **default capacity** in Settings, exactly as before — it does not drop to 0,
which would make the app call the day Sold out.

**The knock-on worth knowing.** This same number is what the app tells the order
page about a day, so a day now turns FULL at the moment every unit you are actually
selling that day is booked, rather than at some larger number padded out by products
that were never on sale. Past every real slot being taken, the order page stops
offering that day — which was always the intent, and now happens at the right moment
rather than late.

**Nothing else moved.** Your over-capacity warning, the "N ordered · N left" line on
a delivery date, the shopping list and each product's own "N left" stamp all read the
same number they always did for products that are on sale.

**16 Sep 2026 — engine v94 (no database setup needed). One sentence on the
customer's greyed card, reworded.** Wording only — nothing behaves differently.

On a product you keep on the shop, the line saying why it cannot be ordered today
now reads **Only available on Mon.** where it read "Only sold on Mon." The old
wording was the seller's voice on a customer's card, and "available" is what the
rest of that same card already says ("Only available for posting from 19 Sep"). The
Chinese and Bahasa Malaysia say the same thing as before, in their own words.

**16 Sep 2026 — engine v93 (no database setup needed). The track link now lands
on the track card, lit.** One change, on the customer's side of the shop.

**Why.** Your WhatsApp confirmation ends with a Track your order link. Tapping it
opened the order page at the very top, with the tracking card somewhere below the
fold — the customer had to scroll and hunt for the very thing they had just
tapped, on a page they had never seen before.

**What it does now.** The page comes up with the Track your order card already in
view **and gently glowing**, so it cannot be missed. The glow does not fade on a
timer: it goes when their finger (or mouse) actually reaches the card, so it is
still burning while they are looking around for it. That is the same rule your own
app already uses when you tap an order in New Orders and its row flashes — the
flash stays until you arrive. On a phone with Reduce Motion on, the card is lit
steadily instead of pulsing.

**Nothing else changed.** Typing a code into the box on the page behaves exactly as
before (the card is already in front of them, so nothing moves), and a customer who
simply opens the shop gets no glow at all — the link is the only thing that lights
it.

**15 Sep 2026 — engine v92 (no database setup needed). The New product card on
Products folds away.** One change, on one screen.

**Why.** The card that adds a product sat open at the top of the Products screen,
and open it is a long form — it pushed your three lists (On the shop, Draft,
Hidden) right off the bottom, so every look at what you sell began with a scroll
past a form you were not filling in.

**What it does now.** The card arrives folded to a single line reading **＋ New
product**. Tap it and the form opens; tap the title again, or tap anywhere else on
the screen, to fold it away. It stays open after you add a product — the toast
still says it was saved as a draft — so you can type the next one straight away,
and it starts folded again the next time you come to the screen. Nothing about
adding a product changed: the form inside is exactly as it was, and it is still
the same card that stays on the page while an Edit pop-up is open over it.

**15 Sep 2026 — engine v91 (no database setup needed). The Orders calendar now
answers a tap it cannot act on.** One change, on one screen.

**Tapping a day you do not post on.** The month calendar at the top of Orders
rings your posting days in green with how booked each one is, and draws every
other day of the month plain. A plain day never did anything before — tapping it
was silent, which left you guessing at the reason. Now the calendar answers: a
warm line appears under the grid naming the day and saying it is not a posting
day, and that posting days are added in More → Delivery dates. A marked day says
its usual name above the day at the same time, so a holiday that is not a posting
date now tells you both what it is and why no order can go on it. Opening a real
day, or tapping another plain one, replaces the line. Nothing can be ordered on a
plain day, and nothing is created by the tap — the calendar simply says so now
instead of staying quiet. A plain day already gone stays silent: there is nothing
left to add to it.

**Where it appears.** The month calendar at the top of Orders, the day picker
inside the ＋ New order card, and the Delivery day picker in an order's Edit
pop-up — every calendar in the app that offers only your posting days.

**Nothing else changed.** Posting dates are still made in exactly one place, More
→ Delivery dates (or **Generate next posting dates** on Home). Tapping a calendar
elsewhere in the app does not create one, and a tap that could open a day before
still opens it.

**15 Sep 2026 — engine v90 (no database setup needed). A product can stay on the
shop on a day it cannot be ordered, with the date a customer can next have it.**
One new switch, off unless you turn it on.

**Keep it on the shop.** A product's Availability card now opens with a switch at
the very top, above the sell-day calendar. It is for the two or three hot items
customers come back looking for — if it is not listed they wonder whether you
still make it — but leave it on for everything and the menu fills up, so it is a
decision you make one product at a time. The card's own title carries the state
too, so you can read it while the card is still closed.

**What the shop shows with it on.** On a posting day the product is not sold on,
the card stays instead of vanishing: greyed, stamped **Unavailable** (a day you
never sell it is not the same as a day it ran out), with the reason it already
writes ("Only sold on Mon") and one more line — the next date it can be ordered.
On a day it has sold out the card is exactly what it was, **Sold out** stamp and
all, and gains that same line. The line reads **Next available: Sat, 19 Sep**, and
names how many are left that day when a daily limit is set; it pulses gently so
it reads through the dimming, and sits still — simply lit — if your phone asks for
reduced motion. Nothing on a greyed card can be ordered: the + and − do nothing,
it never enters a basket, and a line already in a basket still leaves with a note
when the day changes. The switch never overrides **Draft** or **Hidden** — those
still take a product off the shop entirely.

**With the switch off, nothing at all changes.** Off is the default and no product
you already have carries the setting, so every product behaves exactly as it does
today until you switch one on. One consequence worth knowing: on a day where
every product is unavailable, a shop with kept items shows those greyed cards
instead of the "nothing is on the menu" line.

**15 Sep 2026 — engine v89 (no database setup needed). The Delivery dates screen
trades its list for the calendar: a ticked day comes off when you tap it again,
and the past dates fold away into one group.** Three small changes, all on one
screen.

**Tapping a ticked day takes it back off.** A posting date that was already on the
calendar used to come off only from the list underneath it. Now tapping that
green day takes it off on the spot — the same tap that put it there undoes it, so
the calendar is the one place you both add and remove dates. If that day already
has an order on it the app asks first ("2026-09-16 has 2 order(s) on it. Delete
the date? The orders are kept in your delivery history."), because that is the one
removal worth a second look; a day with nothing on it just goes, with a small
"Delivery date removed" note. The date is all that is ever removed — the orders
stay in your history either way.

**The list of dates still to come is gone.** The calendar already draws every
posting date as a green tick, and now it lets you take any one of them back, so
the list below was repeating what was already in front of you. That is most of
why this screen reads so much lighter. Nothing else moved: the green tick, the
coloured holiday tags and the "N ordered · N left" line are all as they were.

**The past dates are one group, folded away.** Dates already gone keep their
green tick but cannot be tapped, so nothing on a past day can be changed by a
stray touch. They now sit together under a **Past dates (12)** heading that starts
folded — tap the heading to open the list, tap it again to fold it back. Every
past date is in there now: the old list showed only the ten most recent and left
the rest out of reach. Each one still opens its orders or can be deleted exactly
as before, with the same "Del" button and the same question when orders sit on it.

**14 Sep 2026 — engine v88 (no database setup needed). The holiday tint sits on
the dates at Orders, and a mouse resting on a marked day names it.** Two small
things, both about the Orders screen and the bubble.

**The tint now sits on the line of dates.** On the Orders calendar each posting
day carries its booking count, and that count sat *under* the date number, which
pushed the number 5.5px above the middle of its row. The occasion wash is centred
on the row, so on this one screen the tint sat lower than the numbers it was meant
to be washing — and the dates themselves did not line up with each other. The count
now sits at the foot of the day, every date number sits on one line, and the tint
runs through that line. Nothing else about the calendar moved: the green ring, the
chosen day's fill, and the counts all read exactly as before.

**On a computer the name comes up on hover.** v87's bubble needed a tap. With a
mouse, resting the pointer on a marked day now shows its name on its own, exactly
as the customer's page does. This is deliberately only for a pointer that can
hover: a phone keeps the tap, so a finger sweeping a run of days across the
Availability or Delivery Dates calendars never drags a bubble along with it.

**14 Sep 2026 — engine v87 (no database setup needed). Tap a marked day and it
tells you its name — on every calendar in the app.** v85 drew your marks on all
five of the app's month calendars, but only as colour: a wash and a band, with
nothing to say which holiday it was. The customer's own page has answered this
since its calendar arrived — tap a marked day and a small dark bubble above it
says the name — so the app now does the same thing, with the same look.

**A tap names the day and still does that day's usual job.** The bubble appears
above the day ("Malaysia Day") and goes away as soon as you tap anywhere else.
Nothing else about the tap changed: on the Orders calendar it still opens the day,
on a product's Availability calendar it still marks or unmarks the sell day, on
Delivery Dates it still starts the range you are about to mark. A day that sits
inside two marks takes the name of the shorter one — the same rule the colours
already follow, so the name and the colour always belong to the same mark. A day
already gone is never named, because no mark is drawn on a past day either.

**Two kinds of day could not be read at all before, and now can.** On the Orders
calendar a marked day you do not post for was a quiet number with nothing to tap,
and on the Delivery Dates calendar a marked day that is *already* one of your
posting dates could not be tapped either — its tick is removed from the list
below the calendar, never by tapping its square, so its tap was free. Both now
say their name when tapped, and nothing else about them moved: a Delivery Dates
square still never ticks or unticks a date.

**The Order date boxes name their day above the date, not above a day of the
month.** Those two fields fold their calendar the moment a day is picked, so a
bubble drawn on the day would vanish with it. The name sits above the date the
box is showing instead, which also means an order recorded on a public holiday
says so for as long as that date is on the field.

Nothing was added, moved or removed, and the shop is not touched: this is the
same bubble the shop's calendar has been showing, arriving on your own calendars.

**14 Sep 2026 — engine v86 (no database setup needed). On the Orders screen your
marked days now sit on their days, at the same depth as everywhere else.** v85
put your marks on every calendar in the app. On the Orders screen the wash did
not line up with the days underneath it. Two things were behind that, and both
came from the same fact: the days on that one screen are taller than the days
anywhere else, because a posting day there carries its booking count ("3/12")
under its number.

**A holiday band was stretched to fill its week row.** Where every day is the
app's usual height, a band came out the same depth a single-day box is, so the two
shapes matched — which is how the rest of the app has always drawn them. On the
Orders screen the rows are taller, so the band there came out deeper than a
single-day box, and deeper in the weeks that held a posting day than in the weeks
that did not, so one holiday's own band changed depth from row to row inside the
same month. **A band is now a sheet of one depth, centred on its row** — the same
depth a single-day box has, on every calendar, whatever height the days around it
happen to be.

**A plain day kept the app's usual height inside a taller row**, so it sat at the
top of the row rather than on its middle. A single-day mark was therefore drawn
6px higher on a day you do not post for than on a day you do: the same holiday, on
a different line, decided by whether you post that day. **Every day of the Orders
month is now drawn at one height**, posting day or not, so a mark sits on the same
line as the day it covers, beside the booking counts.

One more thing fell out of that. Today's soft glow is drawn around a whole day on
the app's shorter calendars, and around a taller day it would have become a box
again — the very thing that glow replaced. **Today on the Orders screen now glows
around its number**, the same round glow a posting day's number carries, so today
reads the same whether or not you post that day.

Nothing else changed. The shop's calendar and your Delivery Dates calendar look
exactly as before (their days are all one height, so they never had this), and no
mark was added, moved or removed: this is the drawing only.

**14 Sep 2026 — engine v85 (no database setup needed). Your marked days are now
drawn on every calendar in the app, not just the one you marked them on.** Until
now a holiday only appeared on the customer's calendar and on the Delivery Dates
screen you marked it on. Every other calendar in the app drew a plain month: the
month calendar at the top of the Orders screen, the little **Order date**
calendars in the new-order form and in the Edit-order pop-up, the posting-day
picker inside that pop-up, and a product's **Availability** calendar where you
mark the days it sells. So a holiday you were planning around was invisible on
every screen you actually plan on.

**Now all of them draw your marks, in the same two shapes and the same colours as
the Delivery Dates calendar** — a see-through band across a run of days, deeper
the shorter the run, and a box for a single day. A mark on a day you do not post
for is drawn too, on a dimmed day, since that is the only way a holiday on a quiet
day can be seen at all. Nothing about the marks themselves changed: they are still
only ever something to see, and a mark still never adds or removes a posting day
or changes what a product sells. Two small pieces of the drawing were tidied while
moving it: the green tint on a day a product sells is now a see-through wash
rather than a flat fill, so a holiday band running behind it still shows through
instead of the mark disappearing on exactly the days you sell (the tint itself
looks the same as before); and a marked day that happens to be today now keeps the
soft glow that says "this is today", the way the shop's calendar has always drawn
it.

**14 Sep 2026 — engine v84 (no database setup needed). A day you marked is now
the same gentle wash everywhere, whichever calendar you are looking at.** A
marked day was drawn one of two ways, decided by a single question: is this a day
you post for? On a day you post for the mark went pale, so the green "you can
order" ring stayed the first thing the eye read. On a day you do not, the mark was
drawn at full colour, as a solid block with the number turned white. September's
Malaysia Day sat on a posting day and read as a quiet tint; October's World Animal
Day fell past the posting days published so far and read as a loud solid block —
so the same kind of holiday looked like two different things, and a mark quietly
changed its own appearance as the posting window moved towards it.

**Now a mark is only ever a see-through wash of its own colour, and its depth
follows how long the mark runs: a one-day holiday the deepest, a long school break
the palest.** The customer's calendar and your own Delivery Dates calendar read
that depth from the same place, so a day wears exactly the same mark on both sides
of the shop and in every month. Nothing is ever a solid block of colour any more,
which also means the date number and the green posting pill always read on top of
a mark, whether or not you post that day. Only the look changed: marking,
removing, renaming and loading standard occasions all work exactly as before, and
a mark still never adds or removes a posting day.

**14 Sep 2026 — engine v83 (no database setup needed). Marking a holiday now
tells the shop straight away.** A day you mark on the Delivery Dates calendar is
drawn on the customer's own calendar (engine v79 to v81). But saving a mark only
ever sent your posting days to the cloud — it never sent the customer's page
anything — so the marks reached the shop only by accident, whenever you next
happened to save a product or a setting. Mark the holiday, open the shop, and
nothing had changed. Found while you were looking for a holiday on the shop and
finding none.

**Now the same save does both.** Marking a day, removing a mark, loading a set
from the standard list, or renaming or recolouring one all republish the
customer's page within a couple of seconds, exactly the way editing a product
does. Nothing else about a mark changed: it is still only ever something to see
while planning, it still never adds or removes a posting day, and a name you
typed yourself still never leaves your phone.

**One tap to catch up the marks you already have.** The fix sends the marks from
now on; the ones already on your calendar have never been sent at all, so open
More → Settings → Storefront and tap **Publish now** once. After that the shop's
calendar follows your marks by itself. Nothing to run in Supabase.

**14 Sep 2026 — engine v82 (no database setup needed). A product's selling days
are now marked on a little calendar inside the product's own screen — weekend,
certain days, a season, or any mix of them.** Until today a product could say
only two things about *when*: a notice period, and one from-date and to-date for
a season. You asked to set it freely instead, so the two date boxes have become a
card you mark.

**Open a product and tap the Availability card.** It sits under Daily limit and
stays folded until you tap its title, exactly like the product-text card you
already know. Folded, its title tells you what is marked — "Every day", or "Sat
& Sun", or "1-24 Dec 2026" — so the Products screen alone tells you a product's
selling days without opening anything.

**Inside, it is a month calendar and four gestures.** Tap a weekday letter (M, T,
W...) and every one of that weekday **in the month shown** is marked: tap S twice
and the product sells on Saturdays and Sundays. Tap one day to mark just that
day. Slide your finger across several days and the whole run is marked. Tapping
or sliding over a day that is already marked takes it back. Everything you mark
is added together — mark Saturday and Sunday, then a week in the middle, and the
product sells on all of them.

**Nothing carries over into the next month**, which is the point of it: marks
belong to the days you marked and no others, so a December-only set stays
December-only and January starts with nothing marked. Page to another month with
the arrows and mark that one too if you want to sell then. And a product whose
card you have never opened sells on every posting day exactly as before, so
nothing on your live shop moves until you mark it.

**A period that crosses a month or a year is one mark with two ends you can
stretch.** The card lists your marks under the calendar; tap one and its
**Starts** and **Ends** dates appear above it, and you can push either end as far
as you like — a Sat & Sun run from 1 Dec to 4 Jan is one line, not two marks.
Leave an end empty and the mark simply has no bound on that side ("from here
on", or "up to here"). Type the two dates the wrong way round and they are put
in order for you. A small x on a listed mark removes it whole.

**On the order page, a day a product is not sold for is not a note — the product
is simply not there.** No card, nothing to want and not have. If a customer
already had it in their basket and then switches to a day it is not sold for, it
leaves the basket and a short line says why. The one rule that keeps its note is
the notice period: a product needing 14 days IS sold that day, it only has to be
ordered earlier, so it stays on the menu reading "Orders close 14 days before the
posting day — pick a later date" — the two are different questions, and only the
second one hides anything.

**Two things worth saying plainly.** The old From/To season boxes are gone; a
product that had them opens with that period already sitting in the card as one
mark, so nothing you set before is lost. And a product whose selling days have
all gone by keeps them, on purpose: your own rule is "if I have not indicated a
selling date, it is not selling", so a mark you leave on says exactly that, and
the way to put a product back on sale every day is to take its marks off with the
x. No database setup, and posting days, capacity, value packs, ingredients,
suppliers and everything else are untouched.

**14 Sep 2026 — engine v81 (no database setup needed). A holiday you marked is
now drawn on the shop's calendar exactly the way your own calendar draws it: a
pale band across a run of days, a solid box for a single day.** The marks were
already reaching the shop; it was only their shape that differed, and a mark
that looks different on the customer's page than on yours is a mark your
customer has to learn twice.

**On the shop, a marked day now wears the mark your own calendar gives it.** The
shop had been drawing each marked day as its own flat pale square, so a holiday
running over a week read as a row of separate blocks where your own calendar
shows one continuous shape. Now a holiday running over **several days** is a
**pale see-through band** across those days — one unbroken rounded band per week
row it crosses, in its own colour, and **deeper the shorter the run**, so a
one-day holiday still stands out inside a long school break. A **single-day**
holiday is a **solid box** in its full colour on its one day, a touch narrower
than the band so a longer band still peeks out at its sides. The eight colours
are your own calendar's eight, and the strength steps are the same three, so a
marked day reads the same to your customer as it does to you.

**The one place it gives way: a day you post for.** Green is the colour the
posting ring uses, and a solid box would swallow that ring — so on a day you post
for, the day a customer can actually order, the box goes pale there and the
**green ring stays the first thing the eye reads**. The mark is still there on
that day, and the day is still named on a tap. This is the one guard on the
shop's calendar, and it covers every mark colour rather than green alone, so no
colour can ever hide the days that can be ordered for.

**Nothing else moves.** Tap a marked day — or, on a computer, rest the mouse
pointer on it — and the same small bubble names it, e.g. "Malaysia Day"; tapping
anywhere else puts the bubble away, and still nothing is listed under the grid.
Today still breathes its soft glow. A run still stops at today rather than
colouring days already gone, exactly as your own calendar leaves past days
alone. And your own typed-in days still never reach the shop: only a day that is,
by name and date, one of the built-in standard days can be published, exactly as
before. No SQL, no schema change. The calendar the shop draws with is still a
copy of your app's own, and a test now pins the two copies' mark rules together
as well as their month grids, so a day can never again look like one thing here
and something else there.

**14 Sep 2026 — engine v80 (no database setup needed). Today glows instead of
wearing a box, a holiday you marked is a soft tint you can tap to name, and the
Orders screen's sideways date strip becomes the same month calendar the shop
shows.** Three small things, all pulling the same way: a calendar should read the
same on both sides of the shop, and nothing drawn on it should look like
something it is not.

**On the shop, today no longer wears a little red rectangle.** It always meant
to be a ring around the date, but on a day you do not post for the app had no
circle to draw that ring on, so it traced the day's number as a box instead —
which is why it looked like a red square on the quiet days and only looked
right on the days you post for. Today is now a **gentle glow** that breathes
around the number, with no box at all, and it sits happily on a day you post
for too: the **green ring** says you can order for this day, the soft brown
glow says it is today. Under **prefers-reduced-motion** (a phone set to calm
its animations) the glow holds steady instead of pulsing, so it is still there
to find. The same fix reaches the app: the today marker on the Delivery Dates
calendar, and inside every date picker, was a hard outline and is now the same
soft glow.

**A holiday you marked is now a soft wash, and its name comes out on a tap.**
The shop's calendar used to mark a standard day with a small coloured dot and
then list the month's names in a "Holidays" line under the grid — which crowded
the very line that line was there to keep clear, and made a holiday compete
with the days a customer can actually order for. A marked day now wears a
**pale wash** of its own colour over the whole day. The wash is deliberately
neither a ring nor a filled dot, because a ring is what "you can order for this
day" looks like, and the two must never be read for each other. Tap a tinted
day — or, on a computer, rest the mouse pointer on it — and a small dark
**bubble** above it names the day, e.g. "Malaysia Day". Tapping anywhere else
puts the bubble away. The "Holidays" line under the grid is gone. Your own
typed-in days still never reach the shop: only a day that is, by name and date,
one of the built-in standard days can be published, exactly as before.

In the app the same holiday is named **beside the day** instead of in a list:
open a posting day and, if it carries a mark, its name sits under the date in
the mark's own colour. Nothing at all is drawn on a day you have not marked.

**The Orders screen's date strip is now a month calendar.** The row of date
chips at the top of Orders grew a little longer every week. It is now the same
**month calendar** the customer sees — one month at a time, with left and right
arrow buttons either side of the month's name. The days you post for are
ringed in **green**, and under each one is **how booked it is**: the same
"3/12" the Home dials show, or **FULL** when the day has no room left. A day
whose orders have already closed shows its count in **red**; a day already gone
is dimmed but still opens, because you backfill and look back at old days.
Every other day of the month is plain and cannot be tapped. Tap a green day and
the app's view moves to it — that day is filled in on the calendar and its
orders appear below — and tapping a day in the list below moves the calendar
with it, so the two always agree. The arrows reach only the months your
posting days fall in, so paging never strands you on an empty month.

**The ＋ New order card arrives folded, and leads with the calendar.** It used
to sit open on every posting day, which is not what that screen is for day to
day. It now starts **shut**, showing just its title, "＋ New order" — tap the
title to open it, and tap the title again (or tap anywhere else on the screen)
to fold it away. Opened, it reads in the order you think in: **the month
calendar first**, the same one the shop shows, already sitting on the day you
are looking at, so tapping another green day moves the whole screen before you
have typed anything; **then the customer's details** — name, WhatsApp number,
post or collect, a note; **then the items**, with "＋ Add another item"
and "＋ Add order" at the end. It stays open after you add an order, so you can
type the next one straight away, and coming back to the screen later starts it
folded again.

**The Edit pop-up now reads the same way.** Its **Delivery day** control was a
button you had to tap to reveal a calendar; the calendar is simply there now,
already open on the order's current day. The pop-up then reads the day, then
the customer's details, then the items — the same order as the card. Every day
still to come is tappable, plus the order's own day even if it has passed, so
an old order always shows where it is, and the soft notes re-read underneath
the moment you pick a different day. Moving an order is unchanged in every way
that matters: still one posting day per order, and capacity, the confirmation
and the payment reminder, the track page and the WhatsApp messages are all
exactly as they were. The button-style day picker the app used in these two
places has been deleted along with its tests, because nothing calls it any
more.

**14 Sep 2026 — engine v79 (no database setup needed). The customer picks a
posting day on a calendar, and so do you in the app.** The shop used to show
its posting days as a row of date chips laid out sideways. Now, under **Pick a
posting day**, the customer sees a **month calendar** — one month at a time,
with the arrow buttons either side of the month's name to look ahead or back.
The days you are taking orders for are picked out in **green**; every other day
of the month is plain and cannot be tapped. They tap a green day, and the day
they chose is written out in words just underneath — **"Your posting day: Wed,
16 Sep"**. That is the one line of text below the calendar, exactly as asked:
no dates floating outside the grid, and still **one posting day per order**.
The first open day is already chosen for them when the page opens, so ordering
can never be blocked by forgetting to tap. Nothing else about taking orders
changed: a day you have cut off is still not shown at all, and a day that is
full still greys out with a red **Sold out** badge and cannot be tapped.

**Only the standard days you have marked reach the customer.** If you have
loaded days from the built-in list onto your own Delivery Dates calendar, those
days now wear a small coloured dot on the customer's calendar, and a short
**Holidays** line under the grid names the month's ones (e.g. "16 Sep ·
Malaysia Day"). They follow the colour you gave them. A day **you typed
yourself** — a birthday, a promo, a school break — never appears: only a day
that is, by name and date, one of the built-in standard days can be published,
so your own notes stay private to your phone. Mark nothing in the app and the
shop's calendar simply carries no dots and no caption.

**In the app, the same little calendar now stands wherever you name a date.**
Three places changed. In the **Edit** pop-up, **Delivery day** is no longer a
drop-down list: it names the order's current day, and tapping it opens a small
month calendar beneath it — every day still to come is tappable, plus the
order's own day even if it has passed, so an old order always shows where it
is. The **Order date** box in that pop-up is a calendar too, with a **Today**
shortcut for an order you are typing in right now. And the **＋ New order**
card has gained a **Delivery day** picker at its top: tap another green day and
the whole screen moves to that day, so the product list you are choosing from
is always the one that is actually sellable for the day you picked. The soft
notes that help you decide — the change/cancel window, a warning, a closed day,
too little left — all still sit under the calendar, and none of them stop you.

The calendar expands in place under the button rather than opening in its own
window, because the app's pop-ups share one layer and a calendar opened inside
one would wipe out the Edit pop-up it was opened from; expanding in place also
reads better on a phone. No database setup needed — nothing about how orders
are stored, counted, bought for or messaged changed.

**14 Sep 2026 — tapping a New Orders row now takes you all the way to the order
(no new engine; the phones did not change).** Tapping a row in the **New Orders**
inbox opened that order's delivery date and stopped there. On a day holding a
long list that is as good as landing on the wrong order: you then had to scan
down the list to find the very order you had just tapped, and could easily open
a neighbour instead. A tap now **scrolls the order to the middle of the screen
and flashes it**, and it clears any status filter on the way so a narrowed list
cannot hide it. The inbox's own hint line now reads "Tap a row to jump to that
order on its delivery date and confirm it." Finding an order with the search box
already did this — the two now share the same reveal.

**14 Sep 2026 — the TNG QR is a WhatsApp payment code, and Settings now says so
(no new engine; the phones did not change).** The box in **Settings →
Storefront** that holds your TNG QR image link promised it was "shown on the
customer's track page". It never was — and it should not be. Your QR reaches the
customer **inside the WhatsApp confirmation and the payment reminder**, and your
order page has always told customers you send it over WhatsApp; nothing on the
shop has ever drawn a payment code. Only the wording was wrong. The box, the link
it holds and the way you take payment are all unchanged, and the value still
syncs between your phones through the storefront settings row — that row is how
it travels, not a shop surface.

**10 Sep 2026 — the back-office link is off the homepage (no new engine; the
phones did not change).** The homepage footer carried a small "Back-office
login" line — the only public link to your app anywhere on the site — and it has
been removed, so nothing on your public pages now points at `/admin/`. You open
the app exactly as before: the **Home Screen icon** on your phone (open
`munchies.com.my/admin/` once in Safari, Share → Add to Home Screen), and the
login itself is unchanged — it still asks for your 4-digit PIN and your sign-in.
The WhatsApp number under the footer link now also writes itself the Malaysian
way (**+60 18-913 6389**) whatever you type in Settings, and it still follows
**Settings → Storefront** like the rest of the footer.

**10 Sep 2026 — the app can no longer be handed a web page where it asked for a
script (no new engine; the phones did not change).** So the app can open without
a connection, it keeps a background copy of itself. Whenever a file failed to
download, that copy used to answer with the app's own **web page** — even when
what had failed was a **script** or a **picture**. A browser handed a web page
where it asked for a script cannot run the script, so whatever that script was
meant to set up would quietly stop working, with nothing on screen to explain
why. Now only a real page — opening or refreshing the app — may fall back to the
stored copy; a script, a stylesheet or an image that fails simply fails, so a
fault shows itself as a fault instead of hiding behind a page. Opening the app
offline still works exactly as before. Your website has always run its app from
`/admin/`, so it never had the leftover copy that caused the visible version of
this fault elsewhere; the guard is in for good anyway, so it cannot start here.

**10 Sep 2026 — the homepage's contact details now follow your Storefront
settings (no new engine; the phones did not change).** The WhatsApp number,
Instagram and Facebook links in your homepage footer were typed into the page
itself, so changing them under **Settings → Storefront** moved your order page
and left the homepage still showing the old ones. The homepage now reads the
same published settings as the order page, so the two always quote the same
number and the same handles. Leave a box blank and the homepage keeps the link
it already has, so an empty box never breaks a working link. (The homepage's
contact **email** has no Settings box behind it — tell me if you want one.)

**10 Sep 2026 — review photos load one at a time on the homepage (no new engine;
the phones did not change).** The **What customers say** section on your homepage
used to fetch **every published review photo up front** — including the reviews a
visitor never waited around to see. A photo is now fetched **as its review comes
around**, one step ahead of time so it is ready before it slides in, and the
reviews a visitor never reaches are never downloaded at all. On a phone that
means less data and a quicker page, and it changes nothing about how the section
looks or behaves.

A review photo is also shrunk a little harder before it is stored — to 1000
pixels across instead of 1600. The card on the homepage shows a picture no more
than 340 pixels high, so the smaller copy looks just as sharp while being about
**a third of the size**, which is kinder to the customer's mobile data and keeps
your stored photos light. This applies to photos left from now on; the reviews
already on your page keep the picture they were stored with. (Your homepage
itself already loads its pictures as separate files — its page is only about
29 KB — so nothing needed changing there.)

## v78 — The calendar's Add buttons now say what they do (14 Sep 2026)
On the **Delivery Dates** screen, **Mark an occasion** carried a small button
reading "＋ Add occasion". The name did not tell you it opens a ready-made list of
Malaysia's holidays and fun days, all ticked and waiting — so you had to open it
to find out. It now reads **"＋ Load standard occasions"**, and the window it opens
is titled the same.

Inside that window there were two buttons both called "Add": the big one at the
bottom that files the days you ticked, and a smaller one in the "My own day" strip
just above it, which files a day you name yourself (a birthday, a one-off promo).
Reaching for "Add" and hitting the wrong one gave you "Type a name first", for a
day you never meant to name. The smaller one is now spelled out as **"Add my own
day"**, so the only plain Add in the window is the one that adds the days you
ticked. Nothing else moved — the import picker, the Untick all / Tick all buttons,
the heading tick boxes, the "My own day" box and the way a day is marked on the
calendar are all unchanged. Engine v78, guide v78.

## v77 — The translated-text card says what a blank line means (14 Sep 2026)
A wording fix on top of the fold-away card that arrived in v76. The greyed line in
a product's translated-text card used to end "blank keeps English"; it now
finishes **"if blank, it will be filled with English"** — stating what the customer
gets, rather than what the line does. The card's own sub-line ends the same way.

Nothing else moves. Delete what is in a line and the greyed suggestion and its
arrow come back exactly as before; the card still folds on a tap outside, the
right arrow still takes the words, and the ↻ still re-translates that one line.
Engine v77, guide v77.

## v76 — The translated text is one quiet card that folds away (14 Sep 2026)
Every product's translated-text corner was the busiest part of the screen: always
open, eight lines each with its own "Translate this one" button, two "Fill all"
buttons above them, and an "auto" tag in a word you had to decode. It is now **one
quiet card that starts shut and stays shut** — it is setup, not daily use. Tap the
title to open it; tap anywhere outside to fold it back.

Opened, each empty line shows its translation **already worked out** as the app's
standard greyed suggestion, with the → at its right edge — the same gesture as
every other suggested box in the app. Taking it replaces the arrow with a **↻**
that re-translates just that one line, in place. Typing your own words hides the ↻
(the line is yours); a blank line keeps the English. The two "Fill all" buttons,
the eight "Translate this one" buttons and the "auto" tag are gone.

A product you never open the card for still reads in all three languages on the
shop — the automatic translation still runs after every save and publish. Engine
v76, guide v76.

## v75 — The green glow on a jumped-to order waits for you (14 Sep 2026)
Tapping a row in the **New Orders** inbox (or a result in **Find an order**) takes
you to that order's delivery day and lights the order up green. That glow used to
fade after under two seconds — no time at all while your eye is still travelling
down a long day, so you were left hunting for a row that was no longer lit. The
glow now **keeps pulsing until your finger arrives on the row**, and ends the
moment you reach it.

If your phone is set to reduce motion, the same green ring holds steady instead of
pulsing, so it still stays until you reach the row. Engine v75, guide v75.

## v74 — The little arrow in an empty box keeps working (14 Sep 2026)
Engine v73 added the small right-arrow at the right edge of a box showing a greyed
example: press **→** on a keyboard, or tap the arrow, and the example drops in as
real text. On a phone the tap worked the first time and then stopped — once you had
tapped into any box, tapping the arrow on the next one did nothing.

Two things caused it, both about the box moving under your thumb. Taking a
suggestion focused the box, which opened the phone's keyboard and shrank and panned
the page, so the arrow was no longer where the finger landed; and the strip that
counted the tap was narrow and measured only as a position on the page. Taking a
suggestion **no longer opens the keyboard**, the strip is about **half again as
wide**, and a tap is judged against the box's own edge as well as its place on the
page — either reading can take the tap, so the rule can only accept a tap the old
one refused, never refuse one it took.

The drawn arrow is kept exactly as it was — same size, same place — a tap on the
greyed example itself is still an ordinary tap that puts the cursor there, and the
sign-in and cloud boxes still carry no arrow. Engine v74, guide v74.

## v73 — Change windows, moving an order, Policies, and a one-tap suggestion (14 Sep 2026)
An order is not refundable, but it can be moved to another posting day — and a
customer may ask until a set number of days before the day it is due. That number
is now **per product**: a new **"Changes or cancellations (days before delivery)"**
box sits beside the other date rules when you edit a product. It only ever tells
the customer — **blank** means no window is stated, an explicit **0** states no
advance limit, and neither ever blocks you, who move every order by hand. The
customer reads the sentence on the product's card and again on their green **"Order
received!"** card, and when one order holds products with different windows they
see the strictest (largest) figure, so a mixed basket gives one clear number. The
sentence is written in **English / 中文 / BM** with the rest of the page. The
order's own track card stays silent — it is read days later, when the window may
have changed.

An order's posting day can now be **changed in the app** instead of deleted and
re-typed — a deletion reads as a cancellation. The **Edit order** pop-up gains a
**"Delivery day"** select of every day still to come; saving moves the whole order
across in one step, and heals an order whose rows had somehow ended up on different
days. Soft notes under the select tell you the order's own window, warn when the
new day falls inside it, say when that day has already closed, and say when it is
short an item — none of them block you. The destination day's availability is
checked, and the customer's tracking page is republished so it shows the new day.
The old date is left for the **Del** button on the Deliveries screen to clear.

A **Policies** box in **Settings → Storefront** holds your own cancellation and
refund wording: type it once in English, translate it to Chinese and Bahasa
Malaysia with the same free machine translation the product text uses, and it is
drawn on your shop under **Track your order**, in the visitor's language, with the
line breaks you typed. Blank hides the section.

And app-wide: wherever an empty box shows the app's greyed recommendation, the
**right arrow** — or a tap on the small arrow drawn at the box's right edge, for a
phone with no arrow key — **accepts it as real text**, the same gesture as an AI
chat prompt. It is offered only where the grey text really is a value: the Supabase
email, key and password boxes and the sign-in fields carry no arrow, so a made-up
login can never be accepted by accident. Engine v73, guide v73.

## v72 — A sold-out note reads in the customer's language (10 Sep 2026)
Your order page switches language the moment a customer taps it, but two corners
of it had stayed English whichever language they chose: the short note on a
product that **cannot be ordered for the posting day they picked** (that it only
opens from a certain date, only runs up to one, or that orders close so many days
ahead — with the date written in the page's language), and the notes that appear
above the menu when the page **has to change a basket** — something that just
sold out, or a quantity trimmed to what is actually left.

Both now read in **English / 中文 / BM** along with everything else. The reason a
product is closed is handed to the page as a plain fact — which kind of rule, and
the day or number of days behind it — and the page writes the sentence itself, so
no English can slip into a Chinese or Malay page. An English visit reads word for
word as it did. Engine v72, guide v72.

## v71 — The order page's 中文 / BM buttons answer instantly (10 Sep 2026)
On your order page, tapping **EN / 中文 / BM** used to reload the whole page. That
re-downloaded the page and fetched the menu, the "only N left" numbers and your
saved order-page settings all over again, so each tap sat there for a moment
before anything changed — and the slower the customer's connection, the longer
the wait. A reload could also wipe a basket that was already half filled.

Now the order page switches **in place**, exactly like your homepage already did:
the words change the moment they tap, and nothing is downloaded again. Whatever
the customer has already done is left exactly as it was — the items in their
basket, the posting day they picked, the name, WhatsApp number and postal address
they typed — and if they are looking up an order, that card re-reads in the new
language too. Nothing to set up.

## v70 — An order keeps the name and price it was sold at (10 Sep 2026)
Until now an order did not remember what it was sold as — it just looked the
product up afresh each time it was shown. So if you renamed a product or changed
its price, **every past order changed with it**: last month's orders, the labels
you printed, and even the amount a customer saw on their own tracking page all
silently moved to today's wording and today's price. And if you later deleted a
product, its orders fell back to "(deleted product)" with no price at all.

Now each order **freezes the name and price at the moment it is taken** — whether
it came from your shop or you typed it in yourself — and every message, the
tracking page, customer spend totals and the Home estimate read that frozen
record. Rename or reprice a product and the past stays as it was; a product you
delete later still shows what it was that someone bought.

Two careful edges: if you deliberately **swap a line to a different product**
when editing an order, that line picks up the new product's price (you changed
what is being sold), while a line you leave untouched keeps the price it was sold
at. And orders taken **before** today are stamped just once with what they were
already showing, so they stop moving from here on — a line whose product is gone,
or has no price set, is left alone rather than guessed at. Engine v70, guide v70.

## v69 — Either place updates the customer (10 Sep 2026)
Yesterday's fix put a customer's name and number back in one place — but it made
the **customer card** the side that always won, so if the card and an order
disagreed, the card's name was the one shown. That is no longer the rule: now it
is simply **whichever you edited last**. Correct a customer's name with **Edit**
on one of their orders and that is the name the list, the history pop-up and the
"Hi {name}!" greeting use; open their card, type the name and save, and the
card's is the one used. Either place updates the customer — neither is the boss.
They normally read the same anyway, because each save writes through to the
other side; this only decides the rare case where an old copy and a newer one
are both sitting there. Nothing to set up; the phones pick it up with the next
sync.

## v68 — One name and one number per customer (10 Sep 2026)
A customer's name and WhatsApp number used to be held in two places at once — on
their orders, and on their customer card — and the two did not always agree. If
you opened a customer and typed their name on their card, the customer list could
carry on showing the old one, because it read the name off the order. And
renaming someone who has **no WhatsApp number** on file could lose them: the name
is what ties a numberless customer to their history, so the new name slid off
their orders and appeared nowhere at all.

Now the name and number you save on a customer are the ones that count, and
fixing them once fixes them everywhere: saving their card writes the name and
number onto **every order they have**, so the labels, the WhatsApp messages and
the customer list all follow. It works the other way round too — correct a wrong
number with **Edit** on an order and that customer's card updates as well, so the
two can never drift apart again. Correcting a number carries that customer's
bring-a-friend credits across with it, and renaming someone who has no number no
longer loses them.

Leaving a box empty means "leave this as it is" — it never wipes a number your
confirmations depend on. And if you renamed anyone before today and it never
stuck, the app puts their orders right the first time this version opens. Engine
v68, guide v68.

**9 Sep 2026 — the wish list's automatic email went live (no new engine; the
phones did not change).** Adding a wish on **More → Software wish list** now
emails the **full wish list** — every wish, ticked or not, newest first, with
the app version and the date — to the developer address(es) you set under
Settings → **Website & developer**, all on its own, whenever the phone is signed
in and sharing data. Before today that automatic email needed a behind-the-scenes
service that was not switched on yet, so only the **"Email the full wish list"**
row sent it by hand; that row is still there as a backup any time.

## v67 — Naming a "No name" customer (10 Sep 2026)
A customer who reached you without a name — a storefront order that carried none
— used to stay **"No name"** in your customer book even after you opened them and
typed a name. Now it sticks: open them, tap **Add details**, type the name (and
the pet's name, what they like, and so on) and save, and their row shows that
name straight away — in the list, the finder and the 'Hi {name}!' WhatsApp
greeting. A tidy-up; nothing else about your customers changes. Engine v67,
guide v67.

## v66 — Products that translate themselves + Draft / On the shop / Hidden (9 Sep 2026)
**Product text now translates itself into 中文 and Bahasa Malaysia.** When you
save or publish a product, the app quietly fills Chinese and Malay versions of
its name, description, selling unit and feeding tip — machine-made from your
English, free, whenever you're online. Each translated box is tagged **"auto"**.
Type over any box and it becomes yours, never overwritten again; and in
**Products → Edit** you can tap **Fill all 中文** / **Fill all Bahasa Malaysia**
to fill a whole language now, or **↻ Translate this one** for a single line. If
you later change the English, the box is re-filled to match; delete the English
and the translation is dropped. Shoppers reading in that language then see the
product in their own words on your order page.

**Products now have three states, shown as three lists** — **On the shop**
(live, orderable), **Draft — not on the shop yet** (a brand-new product starts
here, fully built but not for sale), and **Hidden — taken down** (off the menu,
history and recipe kept). Publish a draft to put it on the shop; Hide a live
product to pause it. Drafts and Hidden products never appear on the storefront
and can't be ordered, so building a new recipe can't accidentally go live.

**The "Copy follow-up" referral message now has a language choice.** In a
customer's profile, before you copy the follow-up, pick **English / 中文 / BM** —
the whole check-in (greeting, the product's translated name and feeding tip, the
scheme pitch, the link) is written in that language, ready to paste into
WhatsApp. English stays the default. No SQL this version.

## v65 — Reviews to publish, one at a time (9 Sep 2026)
**More → Reviews** now walks you through the reviews **one at a time**, drawing
each exactly as it will look on your homepage (photo, stars, message, name).
The ones waiting for you to publish come first; **Publish** puts it on the
homepage, **Take down** hides it again, **Delete** removes it for good — and
every action moves you on to the next review. It deliberately does not
auto-play, because you are deciding, not watching: the review in front of you
stays until you move it with the arrow buttons, the dots, or a swipe.

Two places now tell you when reviews are waiting on you: **Home** shows an
"N new review(s) to publish" card near the top (tap it straight into
Reviews), and the **Reviews** row on More gains a green "N waiting" pill.
The count refreshes every ~45 seconds while Home is open. No SQL this version.

## v64 — Your site in 中文 / English / Bahasa Malaysia + a website credit (9 Sep 2026)
Your **homepage and ordering page now speak three languages.** Tap **English /
中文 / BM** at the top of either page and every word — navigation, product
cards, the delivery-day and order form, even the track page — switches over on
the spot, and each phone remembers the language it picked. Because the choice
lives in the browser, one shop link serves every customer in their own
language. Each product can also carry a Chinese or Malay **shop name** in
Products (e.g. Jerky Ayam, or a Chinese name): it shows on the product card while the
order and your records keep the English name.

The homepage **reviews** section is now a **swipeable carousel** — drag left or
right through the reviews you have published, or tap the dots — and if your
website was built for you, **Settings → Website & developer** lets you name who
made it. A small **"Website by …"** credit then appears at the bottom of your
homepage and order page, and **More → About** adds a WhatsApp and an email row
to reach them. That same developer is who the **software wish list** emails:
add a wish on More and the whole list is sent to them automatically (quietly —
if it can't send, a gentle note points you to the always-works **"Email the
full list"** row underneath). The credit and the email links stay hidden until
you type a name and an email in Settings.

## v63 — Customers tab, wish list, holidays fix (8 Sep 2026)
**Customers** is a real tab of its own, swapped with **Purchase Order** (now
under **More → Purchase Order**). The tab stays your automatic customer list —
who ordered, how much, their favourite — and now every person can carry a
**profile** (the **Edit** button in their history pop-up): their pet's name and
a small photo (auto-shrunk to a thumb), what they like, what to avoid, and a
note. Profiles save into a synced `customers` collection, so both phones know
the same people, and they build up quietly for a future AI chat about your
customers. A **finder** box at the top of the tab filters the list as you type —
name, number, pet's name, likes, notes — and says how many match, just like
"Find an order" on Orders. A saved profile shows as a paw or photo beside the
name and a small line under the row.

On **Home**, the "Upcoming holidays" card is fixed: it used to vanish whenever
nothing was marked on the Delivery calendar. It is now always there — up to
three marks at a glance, a scroll for any more, and a friendly empty state that
still opens the calendar so you can add days.

On **More**, a small green **Engine v63** pill (in the header card) shows which
build this phone runs, a **Software wish list** sits at the bottom and behaves
exactly like your to-do list (add, tick, reword, remove — a tick stays ticked
and never touches the weekly routine), and **Full change history** opens this
history as a PDF kept on your website. No SQL this version.

## v62 — "Not sharing" strip + read-only View (8 Sep 2026)
When a phone is not on the shared cloud — shared data off, never set up, or
signed out — a thin amber strip at the very top of every screen reads **"Not
sharing right now"** with a one-line reason and a **Fix it** tap straight to
Settings → Shared data. It never locks the app, and it disappears on its own the
moment sharing is back on. (Set up once per phone: no SQL — the shared-data
setup you already did covers it.)

Also, every backup copy in Settings → **Backup & safety** now has a **View**
button: a purely read-only look inside that copy — its orders grouped by
delivery date (customer, product, quantity, status), the product price list and
ingredient stock at that time. Looking at a June price confirms the detail
without moving today: no rewind, nothing written, ever.

## v61 — Cloud backups (8 Sep 2026)
Every time the app opens while signed in, it quietly saves a full **Daily**
copy (first open each day), a **Weekly** copy (Mondays) and a **Monthly** copy
(the 1st) to your own Supabase cloud, keeping the newest 7 daily / 4 weekly /
3 monthly. A "Back up to cloud now" button, and one "Before restore" copy
saved before every restore, stay until you delete them. Each copy can be
**Restored** (steps the phone — and the shared cloud — back to that copy; a
"Before restore" copy is always saved first, so it is never one-way),
**Downloaded** as `furkidz-backup-YYYY-MM-DD-KIND.json` (which re-imports
like an Export), or **Deleted**. Lives under More → Settings → "Backup &
safety". The copies never contain the per-phone app-login email/password or
the app password. Setup: run `supabase/backups.sql` once.

## v60 — Homepage customer reviews (8 Sep 2026)
Customers can leave a **What customers say** review on the homepage — name,
1–5 stars, a message in English / 中文 / Bahasa Malaysia, and an optional
photo. Every review lands __unpublished__ in More → Reviews, where **Publish**
shows it on the homepage, **Take down** hides it, and **Delete** removes it —
nothing becomes public until you tap Publish. Reviews appear on the homepage
only. Setup: run `supabase/reviews.sql` once.

## v59 — Occasion import tidy-up (8 Sep 2026)
Added **World Animal Day** (4 Oct) to the fun/pet-day import, plus
whole-group ticking — tick a heading box, or use **Untick all / Tick all**.

## v58 — Occasion import (8 Sep 2026)
A one-tap **＋ Add occasion** import of Malaysia's days plus fun days (pet,
people & kindness days, and more), and a **My own day** quick-add.

## v57 — Private notes per product ingredient (8 Sep 2026)
Each ingredient line in a product can carry a short private description
__for that product only__ (e.g. which cut or brand of chicken that product
uses).
Typed and seen on the Products screens only — never on the shop, a label, or
the product cards.

## v56 — "Keep at least" reserve (8 Sep 2026)
Ingredients can set a **Keep at least** level. The order list tops an
ingredient back up to that level in whole packs when your stock drops more
than 10% under it, and low items ride along even when today's posting run
doesn't use them. The Ingredients screen shows a red low-stock strip.

## v55 — Time & length units (7 Sep 2026)
**min/hr** and **cm/m** are pre-loaded in Units (under More), like g/kg — so
oven or dehydrator times and treat sizes can be measured and converted
(1 hr = 60 min, 1 m = 100 cm). Stock is guarded so a time or length unit can
never distort a gram count.

## v54 — Ingredients on hand (7 Sep 2026)
Ingredients now have **On hand** stock. The PO buys only what you don't have
(rows you already have drop out), "Bought" on a saved list adds its packs
once, and marking an order **Preparing** (the engine step the bakery calls
"Baked") subtracts its ingredients (undo restores them).

---

__This history covers the two-phone cloud era (v54+). Earlier versions
(pre-v54) were never recorded version by version, so they are not listed here
rather than invented. Each new version is added here as it ships.__
