// scenario.js — a production scenario: modules laid out on a clock.
//
// Pure and DOM-free, so the arithmetic can be trusted and tested with
// node --test (test/scenario.test.js). The screen in views/scenario.js draws
// whatever this returns and decides nothing itself.
//
// This is a DESIGN tool, and it is a different question from js/production.js.
// That model answers "how fast can this line go"; this one lays the day out in
// TIME — when each module starts, how long it holds, and when you have to be
// standing at it. The thing it can say that the capacity model cannot is the one
// she asked for: move a module's start time and the number of people you need
// changes, while the pans do not.
//
// The idea holding it up is a CELL, not a station: a module is a piece of
// equipment AND the pair of hands that tends it, counted as one unit with its own
// batch time. That is what gives a per-batch output, and it is why the same
// machine with the same hands can be one person's job or two depending only on
// when it starts.

// A module, and what each field means in her terms. Her words, 2026-09-22: a
// MODULE is the station; a BATCH is one lot through it; a CYCLE is one piece of
// that batch's process. A batch is a count and nothing else — "batch is not a
// process but cycle is" — so the minutes and the hands live on the cycles.
//
//   cycles    the batch's process, in order. Each one is { name, min, load,
//             unload }: how long it takes, and the minutes of a person it costs
//             at its LOAD (the start) and at its UNLOAD (the end). A fold is a
//             30-minute rest with a 1-minute unload; an oven is a 13-minute bake
//             and then a 2-minute load for the swap. A cycle cannot begin before
//             the one before it has ended, so a cycle has no start of its own.
//   cycleMin  how long ONE batch occupies the module — the sum of its cycles.
//             Derived; a module saved without `cycles` gets one cycle that
//             reproduces this exactly (see cyclesOf).
//   batch     how many pans one batch deals with
//   touchMin  how many minutes of a person one batch costs, summed over its
//             cycles. 0 = it runs itself, which is the honest reading of the
//             retard and of the oven's bake
//   everyMin  minutes from the start of one batch to the start of the next. This
//             IS the module's pace, so a module with repeats is a loop — her
//             fold, rest then fold, is just this with a batch longer than the touch
//   repeats   how many BATCHES in the scenario
//   starts    one editable start per BATCH, in minutes from the start of the day
//   startMin  the first batch's start. THE KNOB: this is the "repeating of module
//             start time" she tunes to shrink the people
//   people    how many people one batch needs standing at it
//
// Every number here is a starting figure she is expected to move — the screen
// says so, and she tunes them against her own kitchen.

// Scenario 1 — "What I have now". No fridge: the line as it stands, on the
// chiller she already owns. The fridge is seeded but switched OFF, so the first
// thing the screen shows her is the scenario she asked for, and the buy-something
// option is one tap away rather than hidden.
// The clock her day starts at, as minutes from midnight. Every module's start
// is counted from HERE, so "let me start at 8 am" is one field rather than ten
// module starts to retype.
//
// 3 pm is the seed because it is the day her own process describes: mix in the
// afternoon, retard overnight, bake in the morning. The last unload lands at
// about twenty to eleven the next morning.
export const DEFAULT_DAY_START = 15 * 60;

// How wide a minute is drawn. She asked to be able to change the time scale:
// Coarse fits the whole day on a phone, Fine separates a fifteen-minute bake
// from the one before it. The last two are her ask of 24 September — "i want to
// have 2 step more closer scale" — and they are where two bars a few minutes
// apart finally come apart under the finger.
//
// Six, and SCALE_NAMES and TICK_MIN in the screen carry one entry each: the three
// are read by index, so a stop without a name or without a ruler step is a stop
// the ruler cannot be drawn at.
export const PX_PER_MIN_DEFAULT = 1.6;
export const PX_PER_MIN_CHOICES = [1.2, 1.6, 2.4, 3.2, 4.8, 7.2];

// How a module takes its start from the module above it — ONE choice per module,
// hers to make, and the only place this rule lives. Her own words, 2026-09-22:
// "the behaviour has to base on configuration, not a hard wired".
//
//   "after" batch 1 starts the minute the module above finishes its batch 1, batch
//           2 on batch 2 and so on — a TIGHT follow. The only one of the three
//           that can pull a batch EARLIER than the time she typed, which is what
//           makes a packing step land on the end of the cooling before it.
//   "wait"  never before that minute, but a later time of hers stands. This is
//           what the old "Waits for the module above" switch did.
//   "own"   the module above does not touch this module at all.
//
// The labels are here rather than in the screen because the same three sentences
// are read on the module card, in the batch card and in the guide, and two copies
// of a rule's own words are two answers waiting to disagree.
export const START_MODES = ["after", "wait", "own"];
export const START_MODE_LABELS = {
  after: "As the one above finishes",
  wait: "Never before the one above finishes",
  own: "Its own time",
};
export const START_MODE_HINTS = {
  after: "Batch 1 of this module starts the minute the module above finishes its own batch 1, batch 2 on batch 2, and so on — a tight follow with no gap. Use it for a step the one above really feeds: put it on Cutting and packing and the packing starts the moment the cooling ends, whatever you call the modules above it and in whatever order you keep them.",
  wait: "A batch here can never start before the module above has finished that same batch, but a later time you set yourself stands. This is the floor, and it is what the old Waits for the module above switch did — a module set this way keeps the time you gave it whenever that time is already the later one.",
  own: "The module above has no say over this one. Its batches sit at the times you gave them and only its own minutes can move them. Use it for anything you place by hand.",
};

// The same three in the short form the batch card reads out beside the clock,
// where there is room for a phrase and not for the sentence above.
export const START_MODE_READINGS = {
  after: "follows the module above",
  wait: "never before the module above",
  own: "on the line",
};

// Which of the three a module is on, read the SAME way from a module straight out
// of storage and from one the model has already filled in. Every reader in the app
// goes through here, so the screen and the arithmetic cannot end up with two
// answers to "what is this module set to" — the same rule startMin and person are
// kept equal to their first answers under.
export function startModeOf(src) {
  const m = src || {};
  return START_MODES.includes(m.startMode) ? m.startMode : (m.follow === true ? "wait" : "own");
}

// Her tap, written once: the mode itself, and the old flag beside it so a phone
// still running the older app reads the closest thing that version has — a module
// that follows tightly reads there as one that waits, which is one answer to a
// question that version can only ask one way.
export function setStartMode(live, mode) {
  const m = START_MODES.includes(mode) ? mode : "own";
  live.startMode = m;
  live.follow = m !== "own";
  return m;
}

export const DEFAULT_SCENARIO = {
  name: "What I have now",
  note: "No new fridge — the line as it stands, using the chiller you already own.",
  // The pans she is asking this scenario for. It is the top of the climb: she
  // raises it until something stops her, fixes that, and raises it again.
  target: 36,
  dayStartMin: DEFAULT_DAY_START,
  pxPerMin: PX_PER_MIN_DEFAULT,
  // Which people a person row is standing in for. Her words: combining person 1
  // with person 3 makes "person 1_3" — one pair of hands covering both jobs, and
  // the collisions that appear are the price of it. See cleanMerges.
  merges: {},
  // When each person is here, in minutes from the start of HER day, and which
  // modules each of them is trained for. Both are absent until she writes one,
  // and both absences have one meaning each: no hours means here all day, and no
  // skills means able to work anything — which is exactly how every day read
  // before either existed. See cleanShifts, cleanSkills and peopleRows.
  shifts: {},
  skills: {},
  modules: [
    // `person` is who she has put on this module: 0 means "whoever is free", and
    // a number names a person so two modules can be given to the same one and the
    // clash shown. See peopleRows().
    { id: "mixer", icon: "🥣", name: "The mixer", job: "mix", on: true, person: 0,
      cycleMin: 20, batch: 28, touchMin: 6, everyMin: 20, repeats: 1, startMin: 0, people: 1 },
    // Her own description of the fold: 28 minutes of rest and then a 2-minute
    // fold. So the module holds for 28 and restarts 30 minutes after the last
    // time — the rest is the gap, not part of the pass.
    { id: "fold", icon: "🫙", name: "The fold loop", on: true, person: 0,
      cycleMin: 28, batch: 28, touchMin: 2, everyMin: 30, repeats: 4, startMin: 30, people: 1 },
    { id: "wash", icon: "🥘", name: "Wash, oil and fill", job: "wash", on: true, person: 0,
      cycleMin: 18, batch: 6, touchMin: 18, everyMin: 18, repeats: 6, startMin: 150, people: 1 },
    { id: "load", icon: "🧊", name: "Load the chiller", on: true, person: 0,
      cycleMin: 15, batch: 12, touchMin: 15, everyMin: 15, repeats: 1, startMin: 258, people: 1 },
    { id: "retard", icon: "❄️", name: "Retard overnight", job: "retard", on: true, person: 0,
      cycleMin: 720, batch: 12, touchMin: 0, everyMin: 720, repeats: 1, startMin: 273, people: 1 },
    { id: "unload", icon: "🔓", name: "Unload the chiller", on: true, person: 0,
      cycleMin: 15, batch: 12, touchMin: 15, everyMin: 720, repeats: 1, startMin: 993, people: 1 },
    { id: "top", icon: "🫳", name: "Dimple and top", job: "top", on: true, person: 0,
      cycleMin: 8, batch: 6, touchMin: 8, everyMin: 15, repeats: 6, startMin: 1008, people: 1 },
    { id: "oven", icon: "🔥", name: "The oven", job: "oven", on: true, person: 0,
      cycleMin: 15, batch: 6, touchMin: 4, everyMin: 15, repeats: 6, startMin: 1016, people: 1 },
    { id: "pack", icon: "📦", name: "Cool and pack", job: "cool", on: true, person: 0,
      cycleMin: 12, batch: 6, touchMin: 12, everyMin: 15, repeats: 6, startMin: 1095, people: 1 },
    { id: "fridge", icon: "🧺", name: "The fridge (WIP buffer)", on: false, person: 0,
      cycleMin: 1440, batch: 24, touchMin: 0, everyMin: 1440, repeats: 1, startMin: 0, people: 1 },
  ],
};

// ── A second line, to compare against the first ────────────────────────────
//
// Her sister's proposal, in her words (21 Sep 2026): *"using a bigger plastic
// container that is able to fill 4 dough, she mix all ingredient in, by
// spatula, as focaccia dough is highly hydrated and sticky. Using a big mixer
// might not be a good answer."* Then *"in the same container she do a stretch
// and fold every 30min once, repeat for 3 times. After 1.5hrs, she will
// transfer it to 4 pans, transfer into proofer that able to hold 12 pan any
// time, the proofer is temperature control, time control and humidity control.
// For 1hrs. After proof, in each pan will do dimple, oil, and it take 1min per
// pan after that will leave it for another 30min before going into oven."*
//
// It is the same kitchen answering the same question with different equipment:
// no mixer and no chiller at all, a tub instead of a bowl, and a proofing
// cabinet in place of the overnight retard. So the two scenarios sit side by
// side and can be compared module for module, which is the whole reason this one
// is a starting point rather than something she has to retype.
//
// Two of its numbers are NOT hers and are marked as such below, because a
// figure she never gave must never be dressed up as one she did — see the v135
// mixer note. Every number on every module is hers to change; nothing here is a
// setting she cannot reach from the module editor.
export const SISTER_SCENARIO = {
  id: "s_sister_21_9_2026",
  name: "My sister proposal 21/9/2026",
  note: "No mixer and no chiller: mixed by hand in one tub, folded in the tub, then a proofing cabinet. Every number can be changed on the module itself.",
  target: 12,
  dayStartMin: DEFAULT_DAY_START,
  pxPerMin: PX_PER_MIN_DEFAULT,
  merges: {},
  modules: [
    // PLACEHOLDER, not her number: she said the dough is mixed by hand with a
    // spatula but never said for how long, so the 20 minutes here is the length
    // of her own mixer pass, standing in until she types the real figure. The
    // module is named so she can see at once that this is the one to set.
    { id: "tubmix", icon: "🥣", name: "Mixing by hand in the tub (set the minutes)", on: true, person: 0,
      cycleMin: 20, batch: 4, touchMin: 20, everyMin: 20, repeats: 1, startMin: 0, people: 1 },
    // Her own fold, in a tub holding four: 28 minutes of rest and a fold, three
    // times over. Same shape as the fold module in the scenario above, so the two
    // can be read against each other.
    { id: "tubfold", icon: "🫙", name: "Stretch and fold in the tub", on: true, person: 0,
      cycleMin: 28, batch: 4, touchMin: 2, everyMin: 30, repeats: 3, startMin: 30, people: 1 },
    // DERIVED, not her number: she gave no time for tipping the dough into the
    // pans, so this uses her own measured 3 minutes a pan (the 18 minutes for 6
    // pans she has already confirmed), which is 12 minutes for four.
    { id: "panfill", icon: "🥘", name: "Into the pans", on: true, person: 0,
      cycleMin: 12, batch: 4, touchMin: 12, everyMin: 12, repeats: 1, startMin: 90, people: 1 },
    // The proofer holds twelve pans and proofs for an hour. It has no person on
    // it, which is the point of it: the dough waits in a cabinet while she does
    // something else.
    { id: "proofer", icon: "🌡️", name: "The proofer", on: true, person: 0,
      cycleMin: 60, batch: 12, touchMin: 0, everyMin: 60, repeats: 1, startMin: 102, people: 1 },
    // Her number, exactly: *"it take 1min per pan"* — four pans, four minutes.
    { id: "dimpleoil", icon: "🫳", name: "Dimple and oil in the pan", job: "top", on: true, person: 0,
      cycleMin: 4, batch: 4, touchMin: 4, everyMin: 4, repeats: 1, startMin: 162, people: 1 },
    // Her number again: the 30 minutes the pans rest before the oven. No hands.
    { id: "bench", icon: "⏳", name: "Rest before the oven", on: true, person: 0,
      cycleMin: 30, batch: 4, touchMin: 0, everyMin: 30, repeats: 1, startMin: 166, people: 1 },
    { id: "oven", icon: "🔥", name: "The oven", job: "oven", on: true, person: 0,
      cycleMin: 15, batch: 6, touchMin: 4, everyMin: 15, repeats: 1, startMin: 196, people: 1 },
    { id: "pack", icon: "📦", name: "Cool and pack", job: "cool", on: true, person: 0,
      cycleMin: 12, batch: 6, touchMin: 12, everyMin: 12, repeats: 1, startMin: 211, people: 1 },
  ],
};

// ── The day she bakes alone ────────────────────────────────────────────────
//
// Her ask, in her own words (22 Sep 2026): *"i need you to create one scenario
// and save it as One baker day. Set the modules for me, with latest start time
// each module batch."*
//
// So this is her own bake day from the Production line, set on the one pair of
// hands she actually has. Every module carries her chain's own minutes, and every
// module's FIRST batch is the latest start v145 works out backwards from the oven
// (the anchor is the first 6 pans at the oven at 8:00 am):
//
//   mixing the dough in the tub          4:01 am   (239 min before the oven)
//   the rests and the stretch and folds  4:21 am
//   oil the pans and weigh the dough out 6:24 am
//   into the proofer                     6:39 am
//   dimple and top                       7:24 am
//   the proofer again                    7:30 am
//   the oven swap and the bake           8:00 am   (the anchor, batch 1)
//   cutting and packing                  8:57 am
//
// ONE number is not simply her chain's own offset, and it is the whole finding
// of this scenario: the packing starts at 8:57 am where her chain says 8:15,
// because alone she is still folding the last tub until 8:57 — that is the first
// minute the packing needs nobody else. Start it a single minute earlier and the
// day asks for a second pair of hands.
//
// TWO of the modules carry their hands at the far end of a batch rather than at
// its door, and that is where her day really does them:
//
//   the rests and the stretch and folds   folded at the END of the 30-minute rest
//   the oven swap and the bake            the 2-minute swap AFTER the 13-minute bake
//
// The old drawing put every module's hands at the module's start, which had her
// folding two rests early and swapping the pans before they were baked. Correcting
// it costs her one work slot the old drawing was hiding, and that is why the
// rhythm below is 87 minutes and not 81.
//
// The batch rhythm is 87 minutes, not the 40.5 the proofer allows. 40.5 assumes
// somebody is free to feed the cabinet the moment it empties; with one pair of
// hands there is no such minute, because the six jobs of a batch come to 58
// minutes of hands. Every rhythm was swept through this model rather than reasoned
// out by eye: 87 is the soonest-finishing pace on WHOLE minutes, and 81 no longer
// holds at all — at 81 minutes the second rest's fold lands on minute 82 and the
// second batch's mixing has to begin on minute 82 as well, so the app puts a
// second person on it, and no start time for the packing can undo a clash that
// happens that far upstream. The sweep is finer than whole minutes, so the honest
// statement of the boundary is this: 86 fails outright, 86.5 and 86.75 both hold
// and both finish a shade sooner (minute 568.5 and 569.25 against 87's 570), and
// 87 is the pace this day was seeded at because a baker plans a day in whole
// minutes — ninety seconds off a nine-and-a-half-hour day is not worth reading
// every start time as half past something.
//
// Checked and clean at 87: no machine is ever doubled. The proofer holds one batch
// at a time and the oven never bakes two, so at one baker the wall is her own
// hands and not the cabinet.
//
// Nothing is a gate. Every number is on a module she can open and move, the way
// all three scenarios in this file are.
export const ONE_BAKER_SCENARIO = {
  id: "s_one_baker_day",
  name: "One baker day",
  note: "Your own bake day on one pair of hands: the six-pan chain end to end, four batches 87 minutes apart, so the packing starts at 8:57 am and the last one is packed at 1:18 pm.",
  target: 24,
  // 4 am, because the dough goes into the tub at 4:01 and the first batch is at
  // the oven at eight. Starting the window at four keeps the whole day on one
  // screen without an empty hour in front of it.
  dayStartMin: 240,
  pxPerMin: PX_PER_MIN_DEFAULT,
  merges: {},
  modules: [
    // Her own 20 minutes, and the tub is what a 24-pan day starts four times.
    { id: "solo_mix", icon: "🥣", name: "Mixing the dough in the tub", job: "mix", on: true, person: 0,
      cycles: [{ name: "Mix it", min: 20, load: 20, unload: 0 }],
      batch: 6, everyMin: 87, repeats: 4, startMin: 1, people: 1 },
    // The four rests with a stretch and fold inside each: 4 x 30 + 3 x 1 = 123
    // minutes, of which three are her hands — and the hands are the UNLOAD of the
    // first three, because the rest is what comes first and the fold is what she
    // does at the end of it. Marked as overlapping because the dough is what is
    // holding the time — she is free to be somewhere else, which is exactly the
    // criterion v140 put the switch behind. Nothing here is clamped, so the rest
    // runs as long as the rest runs.
    { id: "solo_fold", icon: "🫙", name: "The rests and the stretch and folds", on: true, person: 0,
      cycles: [
        { name: "Rest, then fold", min: 31, load: 0, unload: 1 },
        { name: "Rest, then fold", min: 31, load: 0, unload: 1 },
        { name: "Rest, then fold", min: 31, load: 0, unload: 1 },
        { name: "Rest", min: 30, load: 0, unload: 0 },
      ],
      batch: 6, everyMin: 87, repeats: 4, startMin: 21, people: 1,
      overlap: true },
    { id: "solo_scale", icon: "🥘", name: "Oil the pans and weigh the dough out", job: "scale", on: true, person: 0,
      cycles: [{ name: "Oil and weigh out", min: 15, load: 15, unload: 0 }],
      batch: 6, everyMin: 87, repeats: 4, startMin: 144, people: 1 },
    // No hands at all: the dough waits in the cabinet. It appears twice because
    // her day does — the pans go in, come out to be dimpled one at a time, and go
    // back in.
    { id: "solo_proof1", icon: "🌡️", name: "Into the proofer", on: true, person: 0,
      cycles: [{ name: "Proofing", min: 45, load: 0, unload: 0 }],
      batch: 6, everyMin: 87, repeats: 4, startMin: 159, people: 1 },
    { id: "solo_top", icon: "🫳", name: "Dimple and top", job: "top", on: true, person: 0,
      cycles: [{ name: "Dimple and top", min: 6, load: 6, unload: 0 }],
      batch: 6, everyMin: 87, repeats: 4, startMin: 204, people: 1 },
    { id: "solo_proof2", icon: "🌡️", name: "The proofer again", on: true, person: 0,
      cycles: [{ name: "Proofing again", min: 30, load: 0, unload: 0 }],
      batch: 6, everyMin: 87, repeats: 4, startMin: 210, people: 1 },
    // Her anchor: the first six pans are at the oven at 8:00 am, which is the
    // minute the whole card is counted backwards from. Thirteen minutes of baking
    // with nobody watching, then the swap — which is why the swap is a cycle of
    // its own and why its hands are a LOAD rather than an unload.
    { id: "solo_oven", icon: "🔥", name: "The oven swap and the bake", job: "oven", on: true, person: 0,
      cycles: [
        { name: "The bake", min: 13, load: 0, unload: 0 },
        { name: "Take 6 out, put 6 in", min: 2, load: 2, unload: 0 },
      ],
      batch: 6, everyMin: 87, repeats: 4, startMin: 240, people: 1 },
    { id: "solo_pack", icon: "📦", name: "Cutting and packing", job: "cool", on: true, person: 0,
      cycles: [{ name: "Cut and pack", min: 12, load: 12, unload: 0 }],
      batch: 6, everyMin: 87, repeats: 4, startMin: 297, people: 1 },
  ],
};

// The window the timeline draws. A day, because the retard runs through the
// night — and a scenario whose modules run past it stretches the window rather
// than being drawn off the edge.
//
// It is also the hard cap on how many times a module can run, and that cap is
// the whole reason this screen can be trusted to talk her out of a purchase as
// well as into one. A 12-hour retard fits TWICE in a day and no more, so twelve
// trays is twenty-four pans a day however much she wants otherwise. Telling her
// to run the retard a third time would be telling her to do 36 hours of work in
// 24 — and it would hide the real answer, which is more trays.
const DAY_MIN = 24 * 60;
const MIN_WINDOW_MIN = DAY_MIN;

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const atLeast = (v, floor, fallback = 0) => Math.max(floor, num(v, fallback));

// A person is a number from 0 to 8, where 0 means "whoever is free". Clamped in
// one place so a module, a line and a combination cannot disagree about what a
// person is.
const clampPerson = (v) => Math.max(0, Math.min(8, Math.round(num(v, 0))));

// What to CALL the person doing the work. She asked for this on 22 Sep 2026 —
// "when we click on the person module, we should be allow to change person1 to a
// name" — and it is here rather than in the screen because three places have to
// agree about it: the person row, the collision notes, and the call the day makes.
//
// A person is a NUMBER, and the name is looked up by that number, so one name
// serves every scenario she has. Say that plainly rather than hiding it: the
// numbers restart at 1 in each scenario, so a name given to person 1 shows
// wherever person 1 is working.
//
// Pure, and it never invents a name: an unnamed person is still "Person 1".
export function personName(who, names) {
  const n = clampPerson(who);
  if (n === 0) return "Whoever is free";
  const given = names && typeof names === "object" ? names[n] : "";
  const name = String(given == null ? "" : given).trim();
  return name || `Person ${n}`;
}

// Every module filled in and clamped, and every scenario told apart from a
// half-written one. Everything below reads modules through here, and the screen
// reads the same values back out of computeScenario().modules — so a number
// shown on screen is always the number the arithmetic used.
export function scenarioOf(saved) {
  const s = { ...DEFAULT_SCENARIO, ...(saved || {}) };
  const mods = Array.isArray(s.modules) && s.modules.length ? s.modules : DEFAULT_SCENARIO.modules;
  return {
    // The working copy keeps its own id once it has been saved, so saving again
    // updates that scenario rather than growing a second copy of it.
    id: s.id ? String(s.id) : "",
    name: String(s.name || DEFAULT_SCENARIO.name),
    note: String(s.note || ""),
    target: atLeast(s.target, 0, DEFAULT_SCENARIO.target),
    // Any hour of the clock, wrapped rather than rejected — 25:00 is 1 am.
    dayStartMin: wrapDay(num(s.dayStartMin, DEFAULT_DAY_START)),
    pxPerMin: clampScale(num(s.pxPerMin, PX_PER_MIN_DEFAULT)),
    merges: cleanMerges(s.merges),
    // When each person is here, and what each of them is trained for. Read here
    // rather than at the screen because this is the one funnel every answer below
    // goes through: left out of this literal and the boxes would still write, still
    // save and still sync, and only the day itself would go on ignoring them.
    shifts: cleanShifts(s.shifts),
    skills: cleanSkills(s.skills),
    modules: mods.map(moduleOf),
  };
}

// Which people a person row stands in for: { "1": [1, 3] } reads as "person 1,
// who is also covering person 3's jobs". It is a LABEL, not arithmetic — the
// modules themselves carry the person they were given, so nothing about the day
// depends on this. Scrubbed on the way in so a hand-edited import can put
// nothing but person numbers in it.
function cleanMerges(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) {
    const who = Math.round(num(k));
    if (!(who >= 1 && who <= 8) || !Array.isArray(v)) continue;
    const members = [...new Set(v
      .map((x) => Math.round(num(x)))
      .filter((x) => x >= 1 && x <= 8 && x !== who))].sort((a, b) => a - b);
    if (members.length) out[String(who)] = members;
  }
  return out;
}

// When one person is here, as two minutes counted from the start of HER day —
// never as clock times. Her reading, 23 September: "the working hours is relative
// to the chart, not exact hours, end also relative to the chart". So moving the
// day's own start slides every shift with it and nothing is retyped, which is the
// whole reason this is an offset and not two times of day.
//
// Returns null for anything that is not two real minutes in the right order, and
// null is not "no hours" — it is HERE ALL DAY, the answer every day gave before
// anybody had hours. One spelling of unset is the point: a shift from 4 to 4, or
// one that ends before it starts, says exactly what an absent entry says, so it is
// stored as the absent entry rather than as a second way of writing it.
function cleanShift(v) {
  if (!v || typeof v !== "object") return null;
  const from = num(v.startMin, NaN);
  const to = num(v.endMin, NaN);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const startMin = Math.max(0, Math.min(DAY_MIN, Math.round(from)));
  const endMin = Math.max(0, Math.min(DAY_MIN, Math.round(to)));
  if (endMin <= startMin) return null;
  if (startMin === 0 && endMin === DAY_MIN) return null;
  return { startMin, endMin };
}

// The whole table, scrubbed — person numbers 1 to 8 and nothing else in it, the
// same guard cleanMerges puts on the labels, and for the same reason: a
// hand-edited import must not be able to put a shift on a person who cannot exist.
function cleanShifts(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) {
    const who = Math.round(num(k));
    if (!(who >= 1 && who <= 8)) continue;
    const sh = cleanShift(v);
    if (sh) out[String(who)] = sh;
  }
  return out;
}

// What one MODULE each person is trained for. Her words, 23 September: "a person
// we should be able to specify their skill, by module, can be more then one, by
// module". Kept by the module's own id rather than its name — the name is hers to
// change and a rename must not silently lose somebody's training.
function cleanSkills(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(src)) {
    const who = Math.round(num(k));
    if (!(who >= 1 && who <= 8) || !Array.isArray(v)) continue;
    const ids = [...new Set(v
      .map((x) => String(x == null ? "" : x).trim())
      .filter((x) => x && x.length <= 40))];
    if (ids.length) out[String(who)] = ids;
  }
  return out;
}

// One person's hours out of whatever the caller happens to hold — the scenario the
// model has already scrubbed, or the raw one on a phone that has not caught up.
// Exported because the person card's two boxes are built from the same reading, and
// a second one would be a second answer to what "in at 4" means.
export function shiftOf(shifts, who) {
  const p = clampPerson(who);
  if (p <= 0) return null;
  return cleanShift((shifts || {})[String(p)]);
}

// Whether somebody's own hours hold a whole stretch of work. Half-open, which is
// the rule the bars are already drawn by: a job that ends at the minute they leave
// fits, and one that begins at the minute they arrive fits. NO hours at all holds
// everything — the sentence that keeps every day built before hours existed
// reading exactly as it did.
export function coversWindow(shift, w) {
  if (!shift) return true;
  return w.from >= shift.startMin && w.to <= shift.endMin;
}

// The modules one person is trained for. An ABSENT or EMPTY list is not "no
// skills" but "can work anything" — the answer every day gave before skills
// existed, and the whole of canWork below.
export function skillsOf(skills, who) {
  const p = clampPerson(who);
  if (p <= 0) return [];
  const raw = skills && typeof skills === "object" ? skills[String(p)] : null;
  return Array.isArray(raw) ? raw : [];
}

// Whether this person can be given this module. Nothing on the list is a yes to
// every module, and so is a module with no id of its own: nothing can be trained
// for a thing that has no name.
export function canWork(skills, who, moduleId) {
  const id = String(moduleId == null ? "" : moduleId);
  if (!id) return true;
  const list = skillsOf(skills, who);
  if (!list.length) return true;
  return list.includes(id);
}

// How SPECIALISED a person is: how many modules they are trained for, with the
// ultimate generalist — somebody who has no list, and so can work anything —
// ranking last of all.
//
// Her rule, in her own words, 23 September: "say one person have all skill, person2
// have have the skill, person3 have only 1 skill, module should select the one that
// specialised". So this is the tie-break that decides which of two qualified people
// gets a job, and it is deliberately NOT the person number: a specialist left idle
// while a generalist does their job is how a trained pair of hands stops being worth
// training.
export function skillRank(skills, who) {
  const list = skillsOf(skills, who);
  return list.length ? list.length : Infinity;
}

// A minute of the day, wrapped into one: 1440 is midnight again, -60 is 11 pm.
function wrapDay(m) {  const d = 24 * 60;
  const r = Math.round(num(m)) % d;
  return r < 0 ? r + d : r;
}

// The drawing scale, kept to the six she can pick so a hand-typed number cannot
// make a day a hair's width or a hundred screens wide.
function clampScale(px) {
  const choice = PX_PER_MIN_CHOICES.reduce(
    (best, c) => (Math.abs(c - px) < Math.abs(best - px) ? c : best), PX_PER_MIN_DEFAULT);
  return choice;
}

// The cycles inside ONE batch of a module, in order.
//
// A BATCH is one lot through the module — a count, not a process: it has no
// minutes and no hands of its own, only a number (repeats) and a start time. The
// CYCLE is the process. It owns the minutes, it owns the labour, and it can hold
// that labour at its start (the LOAD), at its end (the UNLOAD), or at both.
//
// Her own words: "Batch is not a process but cycle is." So the minutes of a
// module are the sum of its cycles' minutes, and its hands are the sum of every
// cycle's load and unload. A cycle cannot start before the one ahead of it ends,
// and that is STRUCTURAL here rather than a rule to enforce: a cycle's start is
// the batch's start plus the minutes of the cycles before it, so the only way it
// could ever begin early is by editing the cycle ahead of it to be shorter.
//
// A module with no `cycles` of its own keeps the shape it had before this existed:
// one cycle, the whole of cycleMin, carrying touchMin at its start as the load.
// That is byte-for-byte what passesOf drew before, which is why every scenario she
// has built and every figure on screen reads exactly as it did.
function normaliseCycle(c) {
  const src = c && typeof c === "object" ? c : {};
  return {
    name: String(src.name || ""),
    min: atLeast(src.min, 0, 0),
    // The minutes of a person at the load, and at the unload. Either may be 0.
    load: atLeast(src.load, 0, 0),
    unload: atLeast(src.unload, 0, 0),
  };
}

// Rounded to a hundredth of a minute, the same discipline startsOf uses, so that
// reading a module back through moduleOf a second time changes nothing: a test
// asserts moduleOf(moduleOf(m)) deep-equals moduleOf(m).
function cyclesOf(src, cycleMin, touchMin) {
  const given = Array.isArray(src.cycles) ? src.cycles.filter((c) => c && typeof c === "object") : [];
  // `cycles` is the finer truth: where they are present they win, and the stored
  // scalars are read as the mirrors they are kept as. A half-migrated module — one
  // carrying both — therefore resolves one way rather than two.
  if (given.length) {
    return given.map(normaliseCycle).map((c) => ({
      ...c, min: Math.round(c.min * 100) / 100,
      load: Math.round(c.load * 100) / 100, unload: Math.round(c.unload * 100) / 100,
    }));
  }
  return [{ name: "", min: cycleMin, load: touchMin, unload: 0 }];
}

function cycleSpan(cycles) {
  return (cycles || []).reduce((n, c) => n + c.min, 0);
}

function cycleLabour(cycles) {
  return (cycles || []).reduce((n, c) => n + c.load + c.unload, 0);
}

// Where each cycle of ONE batch sits, relative to the batch's own start: the
// running total of the minutes before it. This is the sequential rule, written
// once so the solver, the people rows and the drawing cannot disagree about where
// a cycle begins.
export function cycleOffsets(cycles) {
  const out = [];
  let at = 0;
  for (const c of cycles || []) {
    out.push(at);
    at += c.min;
  }
  return out;
}

// The minutes of a person on one batch, at their real end of each cycle: the LOAD
// window at the cycle's start, the UNLOAD window at its end, or both when she does
// the whole turn herself. `at` is the batch's own start.
export function cycleTouches(cycles, at) {
  const list = cycles || [];
  const offs = cycleOffsets(list);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    const from = at + offs[i];
    const to = from + c.min;
    const who = { cycle: i, name: c.name };
    // Both windows are built with the same clamp: hands cannot be at a cycle before
    // it starts or after it ends, so a load of 20 minutes on a 5-minute cycle is 5.
    if (c.load > 0) out.push([from, from + Math.min(c.load, c.min), who]);
    if (c.unload > 0) out.push([to - Math.min(c.unload, c.min), to, who]);
  }
  // A load and an unload that meet or overlap are ONE window — a cycle worked end
  // to end is one stretch of her time, not two that happen to touch. Merged before
  // anything reads them so the people rows never count the same minute twice. A
  // merged window keeps the earlier cycle's name, which is the one it began in.
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const w of out) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged.map(([f, t, who]) => ({ from: f, to: t, ...who }));
}

// The start minute of every BATCH, one per repeat — the list that lets each
// batch of a module be its own thing she can move.
//
// It is BUILT here rather than merely kept, so a module's batch count and its
// batch times can never disagree: a stored list is adopted, an absent or short
// one is continued at the module's own pace, and a long one is cut back to what
// she asked for. That last part is what lets the day's limit hold fewer batches
// than she planned without losing where she put the ones that do run.
//
// A module she has never moved comes out as `startMin + k * everyMin`, which is
// exactly the sum this file did before the list existed — so every scenario built
// earlier keeps its day to the minute.
//
// The two knobs must agree about batch 1, and this is where they are made to:
// the start-time box writes `startMin`, the batch control writes `starts`, and
// when she TYPES a new start the list is re-based onto it. So a typed number
// always moves the module, and the shape she has already set — the batches that
// are no longer evenly spaced — comes with it instead of being silently
// overruled by a stale list.
function startsOf(src, rawStart, n, everyMin) {
  const given = Array.isArray(src)
    ? src.map((v) => Number(v)).filter((v) => Number.isFinite(v)).map((v) => Math.max(0, v))
    : [];
  // With no start time of its own, the list's own first batch IS the start.
  const base = given.length && !Number.isFinite(Number(rawStart))
    ? given[0]
    : Math.max(0, num(rawStart, 0));
  const out = [];
  for (let k = 0; k < n; k += 1) {
    if (k < given.length) out.push(base + (given[k] - given[0]));
    else if (given.length) out.push(out[given.length - 1] + (k - given.length + 1) * everyMin);
    else out.push(base + k * everyMin);
  }
  // Rounded to a hundredth of a minute so a moved-then-chained time cannot
  // accumulate float dust, and so what she stores is readable.
  return out.map((v) => Math.max(0, Math.round(v * 100) / 100));
}

// Where a batch's own start time is allowed to land, in minutes from the start of
// the day. Zero at the near end, and at the far end the last minute at which the
// batch still finishes inside the day — dough still in the oven at midnight is a
// typing mistake, not a plan.
//
// It lives in the model, not the screen, for one reason: the screen has TWO ways
// to set a batch's time — a typed number and a press of the +/- buttons — and the
// only way to promise they are the same answer is for both to go through the same
// function. test/scenario.test.js proves the promise by stepping and by typing.
export function clampBatchStart(start, mod) {
  const span = num(mod && (mod.cycleMin != null ? mod.cycleMin : mod), 0);
  const top = Math.max(0, DAY_MIN - Math.max(0, span));
  return Math.max(0, Math.min(top, Math.round(num(start, 0))));
}

export function moduleOf(m) {
  const src = m || {};
  // The cycles of one batch, in order. Present they win; absent, the module is
  // read as the single cycle it has always been — see cyclesOf.
  const cycles = cyclesOf(src, atLeast(src.cycleMin, 0, 0), atLeast(src.touchMin, 0, 0));
  // Derived, never stored independently: a module's minutes ARE its cycles, and
  // its hands ARE their loads and unloads. Writing these two back onto the stored
  // module is what keeps a scenario readable by a phone that has not synced yet.
  const cycleMin = cycleSpan(cycles);
  const touchMin = cycleLabour(cycles);
  // Whether the pace is hers or is simply this module's own cycle length, so one
  // batch begins the moment the one before it ends. Read from ABSENCE, the same
  // rule the cycles upgrade used: a module that has never been given a pace of its
  // own is automatic, and a module that already stores one keeps it. The number is
  // still resolved and still drives the arithmetic below — this only remembers
  // that she left it to the usual answer, so the box can come back empty and stay
  // empty when she lengthens a cycle.
  const everyAuto = src.everyMin == null ? true : src.everyAuto === true;
  // A module with no pace of its own runs back to back, which is what "minutes
  // from one batch to the next" means for a simple machine. Auto is that same
  // answer given a name — and because it reads off the cycles, lengthening a cycle
  // lengthens the rhythm instead of leaving behind a number she never typed.
  const everyMin = everyAuto ? cycleMin : (atLeast(src.everyMin, 0, 0) || cycleMin);
  const repeats = Math.max(1, Math.round(atLeast(src.repeats, 1, 1)));
  // Whether the batch count is hers or follows the module above. Same absence
  // rule: no count of its own means automatic, and a count of its own — which is
  // every module she has, so nothing of hers changes — means hers. chainLine is
  // what actually follows the module above; this is only the flag it reads.
  const repeatsAuto = src.repeats == null ? true : src.repeatsAuto === true;
  const starts = startsOf(src.starts, src.startMin, repeats, everyMin);
  // The little later-than-the-line nudge she can put on ONE batch, in minutes, so
  // a batch at any module below the first can be moved the way the first module's
  // can. Built to be exactly `repeats` long, the same way `starts` and `crew` are,
  // so raising the count does not forget the nudge she put on the batches that
  // remain. It is a DELTA on purpose: move the module above and this batch follows
  // with its offset intact. See chainLine for where it is added, and for why it can
  // only ever hold a batch back.
  const givenDelta = Array.isArray(src.startDelta) ? src.startDelta : [];
  const startDelta = [];
  for (let i = 0; i < repeats; i += 1) startDelta.push(Math.max(0, Math.round(num(givenDelta[i], 0))));
  const person = clampPerson(src.person);
  const count = Math.max(1, Math.min(8, Math.round(atLeast(src.count, 1, 1))));
  // Who is on each line, built to be exactly `count` long the same way `starts`
  // is built to be exactly `repeats` long: one name per line she has, the ones
  // she set kept, a line she has only just bought filled from the person she gave
  // the module. Short is continued and long is cut back rather than the whole list
  // being thrown away, so raising how many of a module she has does not forget
  // which worker was on which line.
  const given = Array.isArray(src.crew) ? src.crew : [];
  const crew = [];
  for (let i = 0; i < count; i += 1) {
    const stored = num(given[i], NaN);
    crew.push(Number.isFinite(stored) ? clampPerson(stored) : person);
  }
  // A person named for ONE stretch of one batch. Her own ask of 23 September: "The
  // reassign job to next person is not whole day, it is that slot only … Say a labour
  // slot belongs to person1, clicking that slot, will offer to swap it to others, this
  // basically to balance work load." What she points at on the timeline is a single
  // stretch of hands, and a fold loop that folds three times in one batch draws three
  // of them — so the assignment is kept per stretch, and moving one leaves the other
  // two exactly where they were. That is also why this is a sparse map keyed
  // "<batch>.<stretch>" rather than a list built to a length the way starts and crew
  // are: there is no count of stretches for it to be built to, and an entry she has
  // not made must stay ABSENT so the module's own person goes on answering for it.
  //
  // Never pruned against the module's batch count, and that is deliberate. A module
  // whose count follows the one above it is given its batches by chainLine, AFTER
  // this has run — so a key judged too high here could be a real assignment for a
  // batch that is about to exist. An entry that no longer resolves is simply never
  // read, which costs nothing and can never move a job to the wrong place.
  const givenSlots = src.slotPerson && typeof src.slotPerson === "object" ? src.slotPerson : {};
  const slotPerson = {};
  for (const [at, v] of Object.entries(givenSlots)) {
    if (!/^\d+\.\d+$/.test(at)) continue;
    slotPerson[at] = clampPerson(v);
  }
  // How this module takes its start from the module above it — see START_MODES.
  // Every scenario she has saved carries `follow` and nothing else, and those two
  // answers map one for one onto two of the three modes: follow on was the floor,
  // follow off (or absent) was no touch at all. So a day saved before this release
  // answers "wait" or "own" and behaves exactly as it behaved then; nothing of hers
  // moves by being read here, and nothing of hers is rewritten by it either — the
  // deriving happens on the way IN, and only her own tap writes a mode back out.
  const startMode = startModeOf(src);
  return {
    id: String(src.id || ""),
    icon: String(src.icon || "•"),
    name: String(src.name || "A module"),
    // Which station of the production line this module is, if any. Kept apart
    // from the name so renaming a module cannot break the link between the two
    // screens — see LINE_JOBS.
    job: String(src.job || ""),
    on: src.on !== false,
    cycleMin,
    batch: atLeast(src.batch, 0, 0),
    touchMin,
    everyMin,
    // Whether that pace, and the batch count below, are hers or are following —
    // so a module she has filled in is never given a default she did not choose,
    // and a module she has not is never left as a row of zeroes.
    everyAuto,
    repeats,
    repeatsAuto,
    // A batch's process, in order. A module with no cycles of its own gets the
    // single cycle its stored minutes always described, so nothing in a saved
    // scenario has to be rewritten — see cyclesOf. Every batch of this module
    // runs this same list, one after the other, and a cycle cannot begin before
    // the one ahead of it ends because its start is the batch's start plus the
    // minutes of everything before it.
    cycles,
    // When each BATCH starts — one number per batch, in minutes from the start of
    // the day. Batch 1's time IS the module's start time, and they are kept equal
    // HERE rather than left to agree by hand — otherwise moving the first batch and
    // typing a start could drift apart and the module would have two answers to one
    // question.
    starts,
    startMin: starts[0],
    // One nudge per batch, in minutes, always exactly `repeats` long so it reads
    // back the same way `starts` and `crew` do. Kept beside `starts` because the
    // two are the module's two answers to "when does this batch start": `starts`
    // is the time it lands on, and this is only the part of that time SHE put
    // there — see chainLine, which adds it back on after the chain has spoken.
    startDelta,
    // How many of this module she has: two mixers, two ovens, two chillers, two
    // people folding. See moduleFacts for what a second one buys, and for the one
    // thing it does not — it never invents batches she did not plan. It also
    // relaxes the module's own lot-at-a-time rule to one lot per module she has;
    // `overlap` is the switch that takes that rule off altogether. And because
    // the rule takes them in TURNS — batch 3 waits on batch 1 — two of them are
    // two LINES, the odd lots on one and the even lots on the other, which is how
    // the screen draws them. See linesInForce.
    count,
    // How this module takes its start from the module above it. See START_MODES,
    // and chainLine for where it is obeyed.
    startMode,
    // Whether the module above gets a say over this one at all — true for a tight
    // follow as well as for the floor. Derived rather than stored a second time,
    // because the two could then disagree; kept because the bar's own mark and the
    // "modules that wait" card ask only "does anything above me get a say", and
    // because a phone still running the older app reads this one key.
    follow: startMode !== "own",
    // Whether this module may hold two lots at once. Off, one lot at a time (or one
    // per module, with `count`); on, her own times stand and the chain above is the
    // only thing left that can move them. See chainLine for the criteria.
    overlap: src.overlap === true,
    people: Math.max(1, Math.round(atLeast(src.people, 1, 1))),
    // Who is on each line — one name per line she has, so a module worked by two
    // people is two people on the screen and a worker can be given one job rather
    // than the whole day. 0 = whoever is free.
    crew,
    // 0 = whoever is free. 1..8 = that person, by name, so two modules can be
    // given to one person and the collision drawn rather than hidden. Kept EQUAL
    // to the first line's person here, the same way startMin is kept equal to the
    // first batch's start, so a module cannot answer "who is on you" two ways.
    person: crew[0],
    // Who she has named for a single stretch of a single batch, keyed
    // "<batch>.<stretch>" — see above, where it is read. This is the module's own
    // person's exception list, not a second answer to "who is on you": a stretch
    // with no entry here belongs to `person` (or to the line's own crew, for a
    // module drawn as lines) exactly as it always did.
    slotPerson,
  };
}

// How many LINES this module is worked as: its copies, when they really do take
// turns. Two of them means batches 1, 3, 5 on the first line and 2, 4, 6 on the
// second — which is what `count` already means in chainLine — so each line can be
// given its own person.
//
// Zero means "not drawn as lines", and there are two ways to get there: a module
// she has one of, and a module whose overlap switch is on. With overlap on its
// cycles no longer take turns per copy at all (the clamp is off), so a per-line
// person would be a claim the arithmetic does not support — the module keeps the
// one person she gave it, and its crew is kept in storage untouched for the day
// she switches the lines back on.
export function linesInForce(m) {
  const mod = moduleOf(m);
  return mod.count > 1 && !mod.overlap ? mod.count : 0;
}

// Which LINE each batch is worked on.
//
// Her rule: the batches leaving one module go into whichever line is free, not
// round-robin. So this walks the batches in order and hands each one the line
// that has been free longest — and when every line is still busy, the one that
// frees up first. A tie is broken by the turn-taking the old drawing used, which
// is what keeps a regular day exactly where it always was: same lines, same
// numbers, no saved scenario moved. The two rules part company only on starts
// she has moved, which is the case this exists for.
//
// `overlap` keeps the old drawing outright: a module free to hold two batches at
// once never waits on itself, so its lines simply alternate.
export function pickLines(count, starts, cycleMin, overlap) {
  const n = Math.max(1, Math.round(count) || 1);
  const list = starts || [];
  const out = [];
  const lineEnd = new Array(n).fill(-Infinity);
  let rot = 0;
  for (let k = 0; k < list.length; k += 1) {
    if (overlap) { out.push(k % n); continue; }
    const base = num(list[k], 0);
    // Free lines first: the one free longest (smallest end), ties from `rot`.
    // Failing that, the line that frees up soonest — the batch has to wait for
    // somebody, and the soonest somebody is the honest answer.
    let pick = -1;
    for (let sweep = 0; sweep < 2 && pick < 0; sweep += 1) {
      let best = Infinity;
      for (let i = 0; i < n; i += 1) {
        const j = (rot + i) % n;
        const e = lineEnd[j];
        if (sweep === 0 && e > base) continue;
        if (e < best) { best = e; pick = j; }
      }
    }
    if (pick < 0) pick = 0;
    out.push(pick);
    // The line is hers for the whole span of the batch, cycles and all — one
    // batch at a time per line is the rule the cycles in a batch rely on.
    lineEnd[pick] = Math.max(base, lineEnd[pick]) + cycleMin;
    rot = (pick + 1) % n;
  }
  return out;
}

// When each batch of a module happens. Every module — a single mix and a fold
// loop alike — is the same list of batches; the loop is simply one with more of
// them, which is why the fold needs no concept of its own. A "pass" here IS one
// batch placed on the day: where it landed, which line took it, and the hands it
// asks for.
export function passesOf(m) {
  const mod = moduleOf(m);
  const lines = pickLines(mod.count, mod.starts, mod.cycleMin, mod.overlap);
  const out = [];
  for (let k = 0; k < mod.repeats; k += 1) {
    const at = mod.starts[k];
    out.push({
      at,
      end: at + mod.cycleMin,
      // Which line this lot is on. The picker gives it to whichever line is free,
      // so the copies take the lots in turn; the fallback covers a module whose
      // stored starts are shorter than its batch count. This is the single place
      // the batch list is built, so everything downstream — the bars, the people,
      // the collisions — reads the same answer.
      line: lines[k] ?? (k % mod.count),
      // The minutes of a person, taken from the START of the batch. A touch
      // longer than the batch itself is clamped: you cannot be at a module after
      // it has finished with the dough.
      touchFrom: at,
      touchTo: at + Math.min(mod.touchMin, mod.cycleMin),
      // The same hands, at their real end of each cycle — a rest folded at the
      // end of its 30 minutes is a window at minute 30, not at minute 0. Kept
      // BESIDE touchFrom/touchTo rather than replacing them so that a module read
      // as its one traditional cycle still has the single window it always had,
      // and so anything reading only the first window keeps working.
      touches: cycleTouches(mod.cycles, at),
    });
  }
  return out;
}

// What one module delivers, and what it costs.
export function moduleFacts(m) {
  const mod = moduleOf(m);
  const perBatch = mod.cycleMin / (mod.batch || 1);
  // How many times this module can possibly run in a day. A retard that holds
  // the dough for 720 minutes cannot be started a third time inside 1440 of
  // them; a 15-minute wash can be started ninety-six times.
  //
  // Two of a module is two of that capacity — two chillers hold twice the bins,
  // two mixers fit twice the mixes — so the day's room multiplies by how many
  // she has. At one, which is where every module starts, this is the old sum
  // exactly.
  const fitsInDay = mod.everyMin > 0
    ? mod.count * Math.max(1, Math.floor(DAY_MIN / mod.everyMin))
    : mod.repeats;
  // What she asked for, and what the day allows. The second is what the line
  // can actually get through — see DAY_MIN for why this is not a detail.
  const repeatsHeld = Math.min(mod.repeats, fitsInDay);
  const held = { ...mod, repeats: repeatsHeld };
  const passes = passesOf(held);
  return {
    ...mod,
    passes,
    // Minutes of the module for every pan through it — the same shape as the
    // capacity model's "minutes a pan", so the two screens can be compared.
    perPan: mod.batch > 0 ? perBatch : 0,
    // Pans out of this module across the whole scenario. The line can only turn
    // out what its stingiest module turns out, so this is what the day is
    // measured on. Note what is NOT here: `count`. A second mixer does not make
    // pans she did not plan — it makes the BATCHES she planned achievable. To put
    // a second one to work she raises how many batches the module runs, which is
    // the climb's job.
    output: mod.batch * repeatsHeld,
    // Pans an hour, from this module's own pace — and twice that with two of it.
    rate: mod.everyMin > 0 && mod.batch > 0
      ? (mod.count * mod.batch * 60) / mod.everyMin
      : 0,
    // Minutes of a person for the whole scenario, and for every pan.
    touchTotal: mod.touchMin * repeatsHeld,
    needsYou: mod.touchMin > 0,
    // The end of the last batch that actually runs, read off the placed batches
    // rather than worked out from a formula. So a batch she has moved later
    // lengthens the day instead of being contradicted by it, and a module she has
    // never touched still ends exactly where it always did: the last batch sits
    // at `startMin + (repeatsHeld-1) * everyMin`, which is this same number.
    endMin: passes.reduce((t, p) => Math.max(t, p.end), mod.startMin + mod.cycleMin),
    fitsInDay,
    repeatsHeld,
    // How many lines this module is worked as, or 0 when it is not drawn as lines
    // at all. Decided here, once, so the bars, the people rows and the collisions
    // all read the same answer rather than each working it out. See linesInForce.
    lines: mod.count > 1 && !mod.overlap ? mod.count : 0,
    // True when she has asked for more batches than a day can hold. The screen
    // says so out loud rather than quietly counting fewer.
    capped: repeatsHeld < mod.repeats,
  };
}

// ── The chain ──────────────────────────────────────────────────────────────
//
// Her line, said as one rule: batch 10 of a module cannot start until the module
// before it has finished ITS batch 10. A batch is one lot of dough and a module
// is one station, so this is what a real batch line does — a slow fold holds
// every later lot up behind it, and that is the thing she is trying to plan away.
//
// It is one forward walk down the list, and every batch's real start is the
// latest of three answers:
//
//   * where SHE put it — the time she typed, or the module's own pace
//   * what the module itself allows — one of it cannot begin batch 3 until batch 2
//     has finished; two of it (count) cannot begin batch 3 until batch 1 has
//   * what the module above allows, and here the module itself says WHICH of two
//     things that is (see START_MODES): "wait" makes the module above a floor,
//     "after" makes it the answer outright, and "own" takes the module above off
//     this batch's question altogether
//
// Where the first two meet, the latest is the honest one, and it makes a time she
// sets a floor rather than a wall she is stopped by: she can always push a batch
// later, and the chain carries that same batch down the rest of the line with it.
// A module set to "after" is the one exception and it is deliberate: she has said
// the module above decides where this one begins, so the minute it finishes IS the
// start time, and the only thing left that can hold that batch back is her own
// offset on it (startDelta), which is what the +/- buttons on batch 1 write.
//
// The middle one is the module's own machine, and it is the one she asked to be
// able to switch off: "allow each module cycle to overlap". `cycleMin` can mean
// two different things on two different modules. On a wash it is minutes the sink
// is busy, so two lots really cannot be in it. On her fold it is dough RESTING,
// and folding a second lot while the first rests is the whole trick of the day.
// Only she can tell those apart, so `overlap` is the module saying which it is:
// off (where every module starts) keeps one lot at a time, and on takes the
// self-clamp away so her own times stand. Even then the chain still holds it, so
// overlap never lets a lot start before the dough exists.
//
// A switched-off module is not in the build, so nothing waits on it — the chain
// steps over it to the last module that IS running, which is what happens at the
// bench when a machine is not switched on.
export function chainLine(modules) {
  const list = (modules || []).map(moduleOf);
  const placed = new Map();
  const ends = new Map();
  const runs = new Map();
  const holds = new Map();
  let prev = null;

  for (const m of list) {
    // How many batches this module really runs. A module with no count of its own
    // follows the last module above it that is switched ON — her own rule, "we
    // just indicate in the 1st module" — and a module with a count of its own
    // keeps it. The first module of the line has nothing above it, so it is always
    // the one carrying the number the rest follow.
    const reps = m.repeatsAuto && prev ? Math.max(1, Math.round(prev.repeats)) : m.repeats;
    // The times they start from. When the count has just been followed, her own
    // list is only as long as the count it was stored with, so the rest of the
    // batches come off the module's own pace — exactly as they would for a module
    // she had typed the number into herself.
    const seed = reps === m.repeats ? m.starts : startsOf(m.starts, m.startMin, reps, m.everyMin);
    const out = [];
    const ownEnds = [];
    // One batch at a time per LINE. A module free to overlap its own batches
    // skips this entirely, leaving the chain above as the only thing that can
    // still move one of her times.
    const lineEnd = new Array(m.count).fill(-Infinity);
    const waits = [];
    for (let k = 0; k < reps; k += 1) {
      let at = seed[k];
      if (m.startMode !== "own" && prev) {
        const up = ends.get(prev.id) || [];
        if (up.length) {
          // A module above with fewer batches than this one cannot answer for a
          // batch it does not have, so this reads the last one it does — and the
          // screen says so rather than inventing a time for it.
          const above = up[Math.min(k, up.length - 1)];
          // Her own choice per module, never a wired-in rule — "after" is the tight
          // follow, taking this batch's time AS the minute the module above finished
          // its own batch k, while "wait" is the floor it has always been and only
          // ever moves a time she placed EARLIER than that. Both still hold a batch
          // behind the dough it is made of, which is why neither mode can run the
          // day out of order; only "after" can pull a batch back towards the one
          // above it, and that is the whole of what it is for.
          at = m.startMode === "after" ? above : Math.max(at, above);
        }
      }
      waits.push(at);
    }
    // Which line each batch lands on, decided once and for both lists: the times
    // below and the line labels the bars and the people rows read.
    const lines = pickLines(m.count, waits, m.cycleMin, m.overlap);
    // Her nudge, one per batch. Added AFTER the latest of the three answers above
    // rather than instead of one of them, so it can only ever hold a batch back —
    // never in front of what the module above or the module's own machine allows.
    // That is what lets the same button pair move a batch at any module while the
    // time she moves TO stays honest.
    const delta = [];
    for (let k = 0; k < reps; k += 1) delta.push(Math.max(0, num((m.startDelta || [])[k], 0)));
    for (let k = 0; k < reps; k += 1) {
      // A module free to hold two batches at once never waits on its own lines —
      // her times stand, and only the chain above can move one.
      const base = m.overlap ? waits[k] : Math.max(waits[k], lineEnd[lines[k]]);
      const at = Math.max(0, base + delta[k]);
      out.push(at);
      if (!m.overlap) lineEnd[lines[k]] = at + m.cycleMin;
      // Per BATCH, because this is what a module below waits for when it is told
      // to follow: its batch k waits on THIS batch k, not on a line's last one.
      ownEnds.push(at + m.cycleMin);
    }
    placed.set(m.id, out);
    ends.set(m.id, ownEnds);
    runs.set(m.id, reps);
    holds.set(m.id, delta);
    // What a following module reads is this module's REAL count, not the one it
    // happens to be stored with — otherwise a chain of two automatic modules would
    // follow a module that was itself following, and each would fall back to 1.
    if (m.on) prev = { ...m, repeats: reps };
  }

  // startMin is written back with the list, so that reading this result through
  // moduleOf a second time is a no-op. Without it the re-basing in startsOf would
  // pull a chained module back to where she typed it, and the chain would undo
  // itself the moment anything re-read the module.
  //
  // `repeats` is written back for the same reason: a module that followed the one
  // above has that count IN its times now, and handing it back a count of 1 would
  // throw all but the first of them away the moment anything re-read it.
  //
  // `startDelta` comes back ZEROED on a module whose start times are its own, and
  // that is the load-bearing half. The nudge is already inside `starts` above, so a
  // delta handed back as well would be applied a second time the moment anything
  // re-read this result — and `chainLine` is read through moduleOf by every screen
  // and every repaint. Consumed here, the function keeps its own invariant: reading
  // its answer again moves nothing.
  //
  // A module set to "after" is the one exception, and it has to be: its times are
  // NOT its own, it begins where the module above ends whatever `starts` says, so
  // the hold lives ONLY in the delta. Zeroing it there would drop the hold the
  // moment anything re-read the module, which is the same lost edit by another
  // road. Handed back, the second read puts the batch at the same minute: the hold
  // is the offset from the module above, and the module above has not moved.
  return list.map((m) => ({
    ...m,
    repeats: runs.get(m.id),
    starts: placed.get(m.id),
    startMin: placed.get(m.id)[0],
    startDelta: m.startMode === "after"
      ? (holds.get(m.id) || []).slice()
      : (placed.get(m.id) || []).map(() => 0),
  }));
}

// The backward pass this screen never had.
//
// Every other time on this screen is worked out forwards: chainLine walks the
// modules in list order and a module can only ever be pushed LATER, never pulled
// earlier. That is right for placing a day, and it is also why the day can only
// spill — change a pace and the finish moves, never the start.
//
// This is the other direction, and it is the one her trade actually plans in. Her
// own words of 22 September: "work backwards, from end of process, the previous
// process should have a latest start time, by going this way, we prevent preparing
// dough too early and prevent dough from over fermented." The Production line's
// own day-backwards card is built on the same sentence; this is it for the planner.
//
// The anchor is the END of the first batch at the last module in the build — the
// last thing her line has to do for that batch, whatever that last thing is. That
// module does not move, and every module above it gives back the room it does not
// need, so each is handed the last minute its own first batch may begin.
//
// The room is measured, not subtracted. The first version of this asked the anchor
// for the sum of every module's cycle minutes, and on a day whose modules do not
// sit end to end that answer is not the day she has: on her saved 24-pan line the
// sum is 853 minutes against the 1107 the chain really spans, so the mix was told
// it could start at 12:14 pm when it already starts at midnight, and the press
// then pushed the whole day later into an order the day itself does not have. What
// is measured instead is the room between one module's work and the module below
// it, lot by lot, and the pass walks down from the last module adding that room up:
//
//   back(last) = 0
//   back(i)    = the room between i and the module below it, plus back(i+1)
//
// Because the smallest room across the batches both of them run is the one taken,
// the tightest lot is the one that decides — and since every module keeps its own
// pace, that room is preserved for every lot at once. So the day comes out of the
// press valid: no module ends after the module below it has started the same lot.
//
// The only wall it can see is the chain. Her hands are not a wall a subtraction can
// see, and a pass that solved hand contention backwards as well would be a
// different and much larger piece of work, so this hands back the chain's own
// answer and the day's forward pass has the last word over it — the screen names
// whatever the day moved on afterwards.
//
// Two things it refuses to do. It never moves a module EARLIER: a latest start is
// a later start or no start. And where two modules already overlap — a day she has
// arranged deliberately, because nothing here waits on anything unless she says so
// — it neither widens that nor pretends to fix it; the room is simply not room.
//
// A switched-off module is stepped over, exactly as chainLine steps over one: a
// machine that is not switched on is not in the build, and nothing waits on it.
export function latestStarts(on) {
  const list = (on || []).filter((m) => m && Array.isArray(m.passes) && m.passes.length);
  const out = new Map();
  let back = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (i < list.length - 1) back = Math.max(0, back + roomBelow(m, list[i + 1]));
    // Clamped at zero, because a latest start before midnight is not a time she
    // can use. The screen says when it bites rather than quietly moving it.
    out.set(m.id, Math.max(0, Math.round((num(m.startMin, 0) + back) * 100) / 100));
  }
  return out;
}

// The room between one module's work and the module below it: the smallest gap
// across the lots both of them run, because the tightest lot is the one that would
// collide first. A lot is measured end-to-start — this module's own end against the
// same lot's start below — so a gap of zero is a handover and a negative one is an
// overlap she has arranged on purpose.
function roomBelow(above, below) {
  const n = Math.min(above.passes.length, below.passes.length);
  let room = Infinity;
  for (let k = 0; k < n; k += 1) {
    room = Math.min(room, num(below.passes[k].at, 0) - num(above.passes[k].end, 0));
  }
  return Number.isFinite(room) ? room : 0;
}

// Who has to be standing where, and when.
//
// A module's touch is a window, and two windows that overlap need two people.
// That is the whole point of the screen: the pans are set by the modules, but
// the PEOPLE are set by when the modules start — so moving a start can take the
// day from two people to one without costing a single pan.
//
// Every window in the scenario, earliest first — one lot's worth of hands at a
// time. Both readings of the day below are built from this same list, so they can
// never disagree about who is needed where.
export function touchWindows(modules) {
  const windows = [];
  for (const f of modules) {
    if (!f.on || f.touchMin <= 0) continue;
    for (let k = 0; k < f.passes.length; k += 1) {
      const p = f.passes[k];
      if (p.touchTo <= p.touchFrom) continue;
      // One window for every stretch of hands in the batch — the load of a cycle,
      // its unload, or the single traditional window of a module with no cycles of
      // its own. A cycle worked end to end came through as one window already, so
      // this is the list, not a doubling of it.
      const spans = p.touches && p.touches.length
        ? p.touches
        : [{ from: p.touchFrom, to: p.touchTo }];
      // Who this stretch belongs to if she has not named anyone for it. The person
      // on THIS lot's line, so a module worked as two lines gives its odd lots to
      // one worker and its even lots to the other; a module that is not drawn as
      // lines has one person, and `crew` was built from that same number, so both
      // roads lead to the person she named.
      const linePerson = f.lines && f.crew ? (f.crew[p.line] || 0) : (f.person || 0);
      const slots = f.slotPerson || {};
      for (let i = 0; i < spans.length; i += 1) {
        const span = spans[i];
        // And who she has named for this ONE stretch, if she has named anyone. Read
        // as absent-versus-stored rather than as a number, because a stored 0 is a
        // real answer — "whoever is free" — and is not the same as never having
        // touched this stretch at all.
        const named = slots[`${k}.${i}`];
        windows.push({
          module: f.id, icon: f.icon, name: f.name,
          person: named == null ? linePerson : named,
          // Which line it came off, so a job on a person's row can say so and a
          // clash can name which line of which module collided with what.
          line: f.lines ? p.line : -1,
          // Which cycle of the batch these hands are at, so a row can name the
          // rest she is folding rather than calling every window the module.
          cycle: span.cycle ?? -1,
          // Which BATCH, and which stretch of that batch, these hands are — the two
          // numbers her own hand-over is written back with, so the tap that moves
          // one stretch cannot move a neighbour. `k` counts the module's batches in
          // the order the day runs them, which is the order passesOf built them.
          batch: k,
          slot: i,
          from: span.from, to: span.to, people: f.people,
        });
      }
    }
  }
  windows.sort((a, b) => (a.from - b.from) || (a.to - b.to));
  return windows;
}

// One row per person: who they are, what they are at, and where two of their
// jobs collide.
//
// A window she has given to person 2 goes to person 2 whether or not it fits —
// that is her plan, and a plan that overlaps has to be SHOWN rather than quietly
// rearranged. A window with nobody named (person 0) goes to the first person
// free at that minute, and only adds a new person when nobody is: that is the
// fewest hands that can cover the day, which is the number she is trying to get
// down to. The clashes on a named row are the whole point of the exercise — they
// are what she slides the modules along the day to remove.
//
// Her two per-person facts, added 23 September, narrow WHICH free person is
// asked for and nothing else. `shifts` is when each person is here, in minutes
// from the start of her day, and `skills` is which modules each of them is trained
// for; both are absent until she writes one, and an absent one holds everything,
// so a day that has never used either packs exactly as it always did. That is why
// both are optional arguments rather than a rewritten signature: every older
// caller — and every test — must keep reading the day it read before.
//
// Neither fact may ever change HOW MANY HANDS the day needs. That number is what
// she is planning down, so a job nobody qualified is free for still goes to a free
// pair of hands rather than inventing one, and a new person is still added only
// when nobody at all is free. What the two facts do instead is ORDER the choice
// among the people already free — and where the day had to reach past them, the row
// SAYS SO rather than the job quietly moving.
export function peopleRows(modules, shifts = {}, skills = {}) {
  const windows = touchWindows(modules);
  const rows = [];
  const rowFor = (p) => {
    let row = rows.find((x) => x.person === p);
    if (!row) {
      row = {
        person: p, named: p > 0, items: [], busy: 0, clashes: [],
        // This person's own hours, read once per row and carried out with it, so the
        // drawing, the tip and the card all read the same two numbers.
        shift: shiftOf(shifts, p),
        // The jobs on this row that this person cannot do, or cannot be here for.
        // Collected rather than prevented: her rule for a plan that does not fit is
        // that it is shown rather than quietly rearranged.
        outside: [],
      };
      rows.push(row);
    }
    return row;
  };
  // What is wrong with putting this stretch on this person, recorded on the STRETCH
  // so the bar can wear its own mark and the words can name which of the two it is.
  const mark = (row, w) => {
    if (!coversWindow(row.shift, w)) w.outsideHours = true;
    if (!canWork(skills, row.person, w.module)) w.outsideSkill = true;
  };

  for (const w of windows) {
    if (w.person > 0) {
      const row = rowFor(w.person);
      row.items.push(w);
      mark(row, w);
    }
  }

  const nextPerson = () => rows.reduce((m, x) => Math.max(m, x.person), 0) + 1;
  const freeAt = (row, w) => row.items.every((i) => i.to <= w.from || i.from >= w.to);
  for (const w of windows) {
    if (w.person > 0) continue;
    // A person free at the exact minute this one starts is free: finishing one
    // job and starting the next is one person, as it is in a real kitchen.
    const free = rows.filter((row) => freeAt(row, w));
    // Of the people already free, the ones who are trained for this module AND here
    // when it runs. Between two of those the tie-break is how SPECIALISED they are,
    // her own rule: "module should select the one that specialised". So a person who
    // can work one module is asked before a person who can work five, and somebody
    // who can work anything is asked last of all — which is what leaves the
    // specialist on their own job and the generalist on what is left.
    const fit = free.filter((row) => coversWindow(row.shift, w) && canWork(skills, row.person, w.module));
    // Nobody free fits: fall back to the rule this screen has always used, the
    // lowest-numbered free person, and the row will carry the reason. Deliberately
    // NOT sorted by specialisation — with nobody trained for the job, how specialised
    // anybody is has stopped meaning anything, and the day should read as it always
    // did rather than making a choice she cannot see the sense of.
    const pick = fit.length
      ? fit.slice().sort((a, b) => (skillRank(skills, a.person) - skillRank(skills, b.person)) || (a.person - b.person))[0]
      : free.slice().sort((a, b) => a.person - b.person)[0];
    // Nobody free at all: a new pair of hands, exactly as before, and no mark —
    // somebody the day has just invented has no hours and no training to be outside
    // of, so there is nothing here to warn about.
    if (!pick) { rowFor(nextPerson()).items.push(w); continue; }
    pick.items.push(w);
    mark(pick, w);
  }

  rows.sort((a, b) => a.person - b.person);
  for (const row of rows) {
    row.items.sort((a, b) => (a.from - b.from) || (a.to - b.to));
    // The jobs that do not fit, read off the items AFTER the sort rather than
    // collected as they were placed, so this list cannot hold a stretch twice and
    // cannot come out in a different order from the row it is about.
    row.outside = row.items.filter((i) => i.outsideHours === true || i.outsideSkill === true);
    // There is deliberately NOTHING here that works out a working stretch from the
    // day. v179 drew one — the person's first job to their last, gaps included — and
    // v180 suppressed it where she had typed hours. Her word of 24 September retires
    // the whole idea: "shade should just follow what i set, not other consideration".
    // So the only shade on a person's row is the two hours she typed (row.shift above,
    // drawn by the view), and a person whose hours nobody has typed carries no shade at
    // all. Measured on her own day before it went: Wei was shaded 93 minutes wide —
    // 4:00 am to 5:33 am — for five jobs totalling eleven minutes, against a whole day
    // whose hands come to 58. The shade was the stretch, not the work, and it read as
    // a lie beside the row's own "11 min of work".
    let edge = -1;
    let prev = null;
    for (const i of row.items) {
      // The row's minutes are the UNION of its jobs, not the sum: a person in
      // two places at once has not worked twice as long.
      if (i.from >= edge) row.busy += i.to - i.from;
      else {
        if (i.to > edge) row.busy += i.to - edge;
        row.clashes.push({ before: prev, after: i, from: i.from, to: Math.min(edge, i.to) });
      }
      if (i.to > edge) {
        edge = i.to;
        prev = i;
      }
    }
  }
  return rows;
}

// When the day calls each person. Her rule, in her words: "make announcement 1
// min before the next cycle start he is responsible to". So the call minute is
// the minute a stretch of their hands BEGINS, less one.
//
// One minute early is not a detail and it is not a rounding-up: a fold is a
// one-minute job, and telling her to fold at the very minute she should already
// be folding is telling her too late. A call is a call to go and stand somewhere.
//
// Every window is a call, so a person with three separate stretches is called
// three times. The day never calls twice for the same stretch: the caller reads
// this list by minute, so the same window arriving in two ticks is one call.
export function callWindows(sc) {
  const mods = chainLine((sc && sc.modules) || []).map(moduleFacts);
  const out = [];
  // The same two facts the packing reads, so a call follows the same arrangement the
  // chart draws. Deliberately NOT used to WITHHOLD a call: a job that landed on
  // somebody outside their hours is a job they still have to be told about — a rule
  // that silenced the call would be a rule that hides work.
  for (const row of peopleRows(mods, (sc && sc.shifts) || {}, (sc && sc.skills) || {})) {
    for (const w of row.items) {
      out.push({ ...w, who: row.person, at: Math.max(0, w.from - 1) });
    }
  }
  out.sort((a, b) => (a.at - b.at) || (a.to - b.to));
  return out;
}

// One call window's identity, as one string — the name the board writes a coach's
// acknowledgement under, and the name it looks that acknowledgement up by again.
//
// It has to hold every fact that makes the window a DIFFERENT job, and it has to be
// stable across a redraw: the same job on the same person at the same slot must key
// the same on every beat of the day. `who` is one of them deliberately — a coach is
// green because SOMEBODY has taken it, and moving a job to another person moves the
// claim with it, so the new person's coach starts red again. That is the honest
// reading at a bench, and it is the trade she is told about: a time shift keeps the
// tick, a change of hands loses it.
//
// Exported and built here, in the model, so the board, the toggle and the tests
// share one spelling of it. A second spelling would be a board that draws a green
// coach the tap cannot find again.
export function jobKey(w) {
  return `${w.who}|${w.module}|${w.batch}|${w.slot}|${w.cycle}`;
}

// How many different PLACES one person has to be in the day. It is the number she
// is planning down — one worker in one place is a worker who can be taught one job
// — so it belongs to the person's own row, not to the drawing.
//
// A LINE of a module is a place of its own, which is the whole reason this is not a
// count of modules: two lines of one fold running at once are two places, and a
// count of modules alone read exactly that doubling-up as one place — the one thing
// the row was there to show. `line` is -1 on a module that is not drawn as lines, so
// a module she has one of counts exactly as it always did.
export function placesOn(row) {
  const items = (row && row.items) || [];
  return new Set(items.map((w) => `${w.module}:${w.line}`)).size;
}

// How many people are needed AT ONCE, minute by minute — the "total person"
// she asked for, and the shape she is sliding the modules to flatten. Returned as
// runs of a constant count so the screen can draw the demand rather than only
// its peak.
export function concurrency(modules) {
  const events = [];
  for (const w of touchWindows(modules)) {
    events.push({ at: w.from, delta: w.people });
    events.push({ at: w.to, delta: -w.people });
  }
  // An ending at the same minute as a start is not an overlap: the sort puts
  // every ending before any starting at the same minute, so her finishing one
  // job and starting the next is one person, exactly as it is in a real kitchen.
  events.sort((a, b) => (a.at - b.at) || (a.delta - b.delta));

  const segments = [];
  let live = 0;
  let peak = 0;
  let peakAt = 0;
  let overlapMin = 0;
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const next = events[i + 1];
    live += e.delta;
    if (live > peak) {
      peak = live;
      peakAt = e.at;
    }
    // What this event leaves running holds until the next event of any kind.
    if (live > 0 && next && next.at > e.at) {
      segments.push({ from: e.at, to: next.at, count: live });
      if (live >= 2) overlapMin += next.at - e.at;
    }
  }
  return { segments, peak, peakAt, overlapMin };
}

// The whole answer, from one scenario.
export function computeScenario(saved) {
  const s = scenarioOf(saved);
  // The chain first, for the whole line in its own order, and only then the
  // facts — so every module below is read at the time it will ACTUALLY run rather
  // than the time she typed. With nothing set to wait, the times this hands over
  // are the ones the modules already had, which is what keeps every scenario
  // built before the chain existed reading exactly as it did.
  const facts = chainLine(s.modules).map((m) => ({ ...moduleFacts(m), on: m.on }));

  // Only the modules switched on can hold anything back. The fridge sits in the
  // list switched off in scenario 1 — a module that isn't in the build cannot
  // be its bottleneck.
  const on = facts.filter((f) => f.on);
  const live = on.filter((f) => f.output > 0);

  // The wall is the module that passes the fewest pans — that is what the day
  // can deliver — and ties go to the earlier module in the list, which is the
  // order the day itself runs in.
  const wall = live.length
    ? live.reduce((best, f) => (f.output < best.output ? f : best))
    : none();

  const pansPerDay = wall.output;
  const pacePansPerHour = wall.rate;
  const rows = peopleRows(on, s.shifts, s.skills);
  const demand = concurrency(on);
  const target = Math.max(0, num(s.target));

  // The day as it actually stretches, so the overnight retard is visible as
  // overnight rather than being folded into a number that hides it.
  const endMin = on.reduce((m, f) => Math.max(m, f.endMin), 0);
  const windowMin = Math.max(MIN_WINDOW_MIN, endMin);
  // The run as a length in its own right: from the first thing that happens to
  // the last, which is the "shorter hours" she is trying to buy. Kept here
  // rather than worked out in the view so the number she reads under the fact
  // grid and the number in the plan's cost line cannot drift apart.
  const firstMin = on.length ? on.reduce((m, f) => Math.min(m, f.startMin), endMin) : 0;
  const runMin = Math.max(0, endMin - Math.min(firstMin, endMin));

  return {
    scenario: s,
    modules: facts,
    on,
    wall,
    pansPerDay,
    pacePansPerHour,
    // "Cycle time" in the words she used, in the words this app already uses for
    // the same quantity: minutes for one pan off the line.
    cycleMin: pacePansPerHour > 0 ? 60 / pacePansPerHour : 0,
    // People is the most she needs at any one minute — the fewest hands that can
    // cover the day, which is the number she is trying to bring down.
    people: demand.peak,
    // And the rest of what the plan costs, in the words she used for the point
    // of all this: "less man, less manhours, shorter hours". These are the other
    // two. Minutes of a person is summed per ROW, so two modules given to one
    // person are that person's minutes and not two people's.
    personMin: rows.reduce((t, row) => t + (row.busy || 0), 0),
    rows,
    demand,
    target,
    shortfall: Math.max(0, Math.round(target) - pansPerDay),
    endMin,
    firstMin,
    runMin,
    windowMin,
    hours: windowMin / 60,
    // The clock minute 0 of this scenario is, so every time on the screen reads
    // as a time she would say out loud. See clockOf.
    dayStartMin: s.dayStartMin,
    pxPerMin: s.pxPerMin,
    // The modules not yet in this build, so the screen can name what she has
    // parked rather than looking like it simply forgot them.
    parked: facts.filter((f) => !f.on),
  };
}

function none() {
  return { id: "", icon: "•", name: "Nothing yet", output: 0, rate: 0, sub: "Switch a module on." };
}

// ── The modules themselves ──────────────────────────────────────────────────
//
// The order of the list IS the order of the day: the timeline is read top to
// bottom, and a tie for the wall goes to the earlier module. So moving one is a
// real edit to the day, not a sorting preference.

export function moveModule(mods, id, dir) {
  const list = (mods || []).slice();
  const at = list.findIndex((m) => m.id === id);
  const to = at + (dir < 0 ? -1 : 1);
  if (at < 0 || to < 0 || to >= list.length) return list;
  const [module] = list.splice(at, 1);
  list.splice(to, 0, module);
  return list;
}

export function removeModule(mods, id) {
  return (mods || []).filter((m) => m.id !== id);
}

// A name no other module is using, so two modules can never be edited as one.
export function newModuleId(mods) {
  const used = new Set((mods || []).map((m) => String((m || {}).id || "")));
  let n = 1;
  while (used.has(`brick${n}`)) n += 1;
  return `brick${n}`;
}

// A fresh module, arriving SWITCHED OFF. It is off so that a module with no
// numbers in it yet cannot become the wall and answer the day with "1 pan" —
// she fills it in and then switches it on, which is also the order she would do
// it in at the bench.
export function blankModule(id) {
  return moduleOf({
    id, icon: "🧱", name: "New module", on: false, person: 0,
    batch: 1, startMin: 0, people: 1,
    // A new module arrives usable rather than as a row of zeroes to fill in. Her
    // own list of what a module should open on, 22 Sep 2026: one 20-minute cycle
    // with all 20 minutes on the load, the pace left to Auto, the batch count
    // following the module above, waiting on that module, and free to hold more
    // than one production line at once.
    //
    // Every one of these is the module saying "the usual answer" — none of it is
    // written onto a module she has already filled in, because `everyMin` and
    // `repeats` are simply ABSENT here and both flags read from that absence. Every
    // module of every saved scenario stores both, so nothing of hers is touched.
    //
    // The start choice a new module arrives on is "wait" and not "after", which is
    // the answer the old switch gave and therefore the one that changes nothing for
    // her: a new module is one she has not yet told what feeds it, and "after" would
    // move the day the moment she added one. Choosing it is one tap on the card.
    startMode: "wait",
    follow: true,
    overlap: true,
    cycles: [{ name: "", min: 20, load: 20, unload: 0 }],
  });
}

// A copy of a scenario, numbers and all, under a name and an id of its own —
// what "save this as…" writes into the list of scenarios.
export function copyScenario(sc, name, id) {
  const s = scenarioOf(sc);
  return {
    id: String(id || ""),
    name: String(name || s.name),
    note: s.note,
    target: s.target,
    dayStartMin: s.dayStartMin,
    pxPerMin: s.pxPerMin,
    // Copied member by member, so editing one scenario's labels can never
    // rewrite the other's.
    merges: Object.fromEntries(Object.entries(s.merges).map(([k, v]) => [k, [...v]])),
    // The hours, one person at a time, and never by reference: a shift copied as the
    // same object would let editing one day's hours rewrite the other day's silently.
    shifts: Object.fromEntries(Object.entries(s.shifts).map(([k, v]) => [k, { ...v }])),
    // And the training, copied as a LIST for the reason `crew` and `cycles` are:
    // a plain spread would give both scenarios one array, so ticking a module on one
    // day would train that person on the other.
    skills: Object.fromEntries(Object.entries(s.skills).map(([k, v]) => [k, [...v]])),
    // `starts` is copied by hand because it is a LIST: a plain spread would give
    // both scenarios the same array, and moving one batch's start in one of them
    // would silently move the other. A module whose batches have never been moved
    // has no list at all — every module on her phone today — so it is left without
    // one and the module's own start and pace generate it, exactly as before.
    modules: s.modules.map((m) => ({
      ...m,
      starts: Array.isArray(m.starts) ? [...m.starts] : undefined,
      // Who is on each line is a list for the same reason, and is copied the same
      // way: two scenarios must never share one line's person.
      crew: Array.isArray(m.crew) ? [...m.crew] : undefined,
      // The cycles are copied one by one as well: they are the module's minutes,
      // so sharing the array would let editing a step in one scenario silently
      // rewrite the day in the other.
      cycles: Array.isArray(m.cycles) ? m.cycles.map((c) => ({ ...c })) : undefined,
    })),
  };
}

// One person's work, moved onto another — the two taps behind "Combine two…".
//
// Pure, and here rather than in the screen, because the LINES have to come with
// the modules: a module worked as two lines carries one person per line, so moving
// a person means rewriting every line that named them. Miss that and a line would
// point at a number with no row left under it — the work would still be done, by
// nobody, on a screen that showed nothing wrong.
//
// What moves is only who is standing at the module. Every module keeps the job it
// does and the minutes it takes; whatever collides afterwards is exactly the
// manpower the combination cannot pay for, which is the answer she is after.
export function combinedScenario(saved, into, from) {
  const s = scenarioOf(saved);
  const keep = clampPerson(into);
  const gone = clampPerson(from);
  const merges = { ...(s.merges || {}) };
  const fromMembers = merges[String(gone)] || [];
  const members = [...new Set([...(merges[String(keep)] || []), gone, ...fromMembers])]
    .filter((w) => w !== keep).sort((a, b) => a - b);

  const modules = s.modules.map((m) => {
    if (!m.crew.some((p) => p === gone)) return m;
    const crew = m.crew.map((p) => (p === gone ? keep : p));
    return { ...m, crew, person: crew[0] };
  });

  delete merges[String(gone)];
  merges[String(keep)] = members;
  return { ...s, modules, merges };
}

// One stretch of one batch, handed to somebody else — the drop-down behind a tap on
// a person's own marker on the timeline.
//
// Her own words, 23 September: "The reassign job to next person is not whole day, it
// is that slot only … Say a labour slot belongs to person1, clicking that slot, will
// offer to swap it to others, this basically to balance work load." So this writes a
// person for ONE stretch and touches nothing else — not the module's own person, not
// its crew, not its batches, not its times. Every module keeps its job and its
// minutes, so whatever collides afterwards is exactly the manpower the new
// arrangement costs, which is the answer she is reading the chart for.
//
// `batch` and `slot` are the two numbers touchWindows writes on every window: which
// batch of the module, and which stretch of that batch. Pure, and beside
// combinedScenario for the same reason that one is — the work is the model's, so it
// is one answer everywhere and can be tested without a screen.
//
// A stored 0 is written out rather than dropped, and it means what it means in every
// other person box in the app: whoever is free. Handing a stretch BACK to the module's
// own person is a different write — that person's own number — and both have to be
// reachable, which is why neither of them is the absence of an entry.
export function reassignSlot(saved, moduleId, batch, slot, who) {
  const s = scenarioOf(saved);
  const at = `${Math.max(0, Math.round(num(batch, 0)))}.${Math.max(0, Math.round(num(slot, 0)))}`;
  const p = clampPerson(who);
  const modules = s.modules.map((m) => (
    m.id === moduleId ? { ...m, slotPerson: { ...m.slotPerson, [at]: p } } : m
  ));
  return { ...s, modules };
}

// The day's own arrangement, written down and made hers — what has to happen before
// one stretch can be placed by hand on a day that is SHARING THEM OUT.
//
// Her report of 23 September 2026, in her words: "i have 4 persons, 1st Jien, 2nd Wei,
// 3rd and 4th. I saw Jien is heavy loaded, so i click one of Jien session, and select
// to switch that session to Wei, where he is free. BUt what happen is Jien disapper,
// and Jien name chage to Wei, and the originally Wei sessions disappeared." Reproduced
// exactly, on a day of eight modules all on 0 with two names given.
//
// On a day that is sharing them out the rows are not hers and not the modules': they
// are what peopleRows' packing invented, number by number — the first free window
// lands on person 1, the next on 2, and a new number appears only when nobody is free.
// Her names are kept by NUMBER and shared by every scenario (state.settings.personNames),
// which is why naming those rows is enough for the chart to read as people.
//
// Naming ONE stretch then moves the packing's own origin. The named window is placed
// first, so its row exists before the free windows are packed at all, the packing
// prefers the lowest free row, and every invented number shifts up by one. The row
// that was person 1 is person 2 and wears the name "Wei"; nobody is person 1 any more,
// so the row called "Jien" is gone; and a fifth row appears at the top. Those are
// exactly the three things she saw, and none of it was her doing.
//
// The fault is not in the write — reassignSlot puts the stretch on the person she
// picked, and it survives the trip through the cloud — it is that a row the packing
// invented has no number worth handing anything to. So before a stretch changes hands,
// the arrangement already on the screen is written down: a person for a module whose
// stretches all sit on one row, a person for a line of a module worked as lines, and a
// slotPerson entry where one module's stretches really do sit on more than one row.
// From that moment every row's number is a fact, and her names go on meaning what she
// sees. The chart itself does not move by a pixel: it is the same picture with its own
// numbers kept.
//
// Nothing is written for a stretch she has already answered for — a person on the
// module, a person on its line, or her own entry for that one stretch. A stored 0 is an
// answer too ("whoever is free"), and is read as one. So a day whose people were placed
// at the modules is handed back untouched, and this only ever pins what the day was
// quietly deciding for her.
//
// Returns the scenario with the arrangement written into it, and how many stretches
// were written down — which is 0 for every day that needed nothing, and is what lets
// the screen say out loud that the day has become hers to arrange.
export function pinArrangement(saved, rows) {
  const s = scenarioOf(saved);
  // What the chart is showing: every stretch of the day, and the row it is drawn on.
  // Read off the rows rather than re-derived, so what is written down is the picture
  // on the screen and never a second opinion about it.
  const chair = new Map();
  for (const row of rows || []) {
    const p = clampPerson(row && row.person);
    if (p <= 0) continue;
    for (const w of (row && row.items) || []) {
      if (!chair.has(w.module)) chair.set(w.module, []);
      chair.get(w.module).push({ w, p });
    }
  }

  let written = 0;
  const modules = s.modules.map((m) => {
    const stored = m.slotPerson || {};
    // Only the stretches the day decided for her. A stretch she has already answered
    // for is hers and is left exactly as it is — including one given back to "whoever
    // is free", which is a real answer and not the absence of one.
    const mine = (chair.get(m.id) || []).filter(({ w }) => (
      !Object.prototype.hasOwnProperty.call(stored, `${w.batch}.${w.slot}`)
    ));
    if (!mine.length) return m;
    // One group per LINE: a module worked as two lines gives its odd lots to one
    // worker and its even lots to the other, so what the module can say as itself is
    // one answer per line, and anything finer has to be said stretch by stretch.
    const groups = new Map();
    for (const item of mine) {
      const key = item.w.line;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const out = { ...m, slotPerson: { ...stored } };
    let touched = false;
    for (const [line, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      // What the module says about this line now, by the same rule touchWindows reads
      // it with: a module worked as lines answers by the line, any other by itself.
      const own = line < 0 ? clampPerson(out.person) : clampPerson(out.crew[line]);
      const people = [...new Set(list.map((x) => x.p))];
      // Every stretch of this line is on one row and this line has nobody yet: the
      // module can say it once, which is the shape its own card and the People box read.
      if (people.length === 1 && own === 0) {
        if (line < 0) {
          // The crew too, never the person on its own: this module keeps a crew of
          // its own, and `crew[0]` IS the module's person every time the day is read
          // (see moduleOf), so a person written alone is thrown straight back to 0 on
          // the next read and the whole write is lost. Both are written here, exactly
          // as the module card's own person box writes them.
          out.crew = [people[0], ...out.crew.slice(1)];
          out.person = people[0];
        } else {
          out.crew = [...out.crew];
          out.crew[line] = people[0];
          // The app keeps the two in step everywhere else it writes a crew, so the
          // first line's person IS the module's person.
          if (line === 0) out.person = people[0];
        }
        written += list.length;
        touched = true;
        continue;
      }
      // Otherwise this line needs more than one person, or it already has a person and
      // one of its stretches has been handed elsewhere. Named one stretch at a time,
      // which is the finest thing the model can hold.
      for (const { w, p } of list) {
        if (p === own) continue;
        out.slotPerson[`${w.batch}.${w.slot}`] = p;
        written += 1;
        touched = true;
      }
    }
    return touched ? out : m;
  });

  return { scenario: { ...s, modules }, written };
}

// ── A module, handed to the capacity screen ─────────────────────────────────
//
// The two screens answer different questions about the same day, and she asked
// for the one to feed the other: build the day out of modules here, then ask the
// line what that day can actually deliver.
//
// What crosses over is only what a module really knows. A module IS a station —
// its minutes are the hand-work and its batch is the batch — so the capacity
// screen's numbers can be read straight off it, and neither screen invents a
// figure the other one has to trust.
//
// `job` is what makes that mapping a fact rather than a guess: it says which
// station of the line a module is, and it is kept apart from the module's name so
// renaming "Wash, oil and fill" to something she prefers cannot silently break
// the link. A module saved before this existed has no job, so the name is read
// instead — which is why every seeded module's own name is listed here.
//
// Everything the capacity screen holds that a scenario simply does not know —
// how many pans she owns, how many hours she is willing to bake for — is left
// exactly as she typed it, and the screen says so rather than quietly filling it
// with a zero.
export const LINE_JOBS = [
  { key: "mix", label: "Weighing in and loading the mixer", short: "the mixer", unit: "mix",
    names: ["the mixer", "mixer", "weighing in and loading the mixer"] },
  { key: "wash", label: "Wash, oil and fill", short: "wash, oil and fill",
    names: ["wash, oil and fill", "wash oil and fill"] },
  { key: "scale", label: "Weighing the dough out into pans", short: "weighing the dough out",
    names: ["weighing the dough out into pans", "weigh the dough out into pans"] },
  { key: "top", label: "Dimple and top", short: "dimple and top", names: ["dimple and top"] },
  { key: "oven", label: "The oven swap and bake", short: "the oven", names: ["the oven", "oven"] },
  { key: "cool", label: "Cooling and packing", short: "cooling and packing",
    names: ["cool and pack", "cooling and packing"] },
  { key: "retard", label: "Retard overnight in the chiller", short: "the retard",
    names: ["retard overnight", "retard overnight in the chiller"] },
];

const tidy = (s) => String(s || "").trim().toLowerCase();

// Which station of the line this module is: the job she picked, or — for a module
// saved before jobs existed — the name it was seeded with.
export function jobOf(m) {
  const mod = moduleOf(m);
  if (LINE_JOBS.some((j) => j.key === mod.job)) return mod.job;
  const byName = LINE_JOBS.find((j) => j.names.includes(tidy(mod.name)));
  return byName ? byName.key : "";
}

export function jobLabel(key) {
  const j = LINE_JOBS.find((x) => x.key === key);
  return j ? j.label : "";
}

// The three steps the capacity screen wants minutes for EVERY 6 PANS. A module
// may deal with any batch, so its own minutes are scaled onto six pans — the
// only honest way to hand "30 min for 12 pans" to a field that says "6 pans".
function per6(m) {
  const mod = moduleOf(m);
  if (mod.batch <= 0 || mod.touchMin <= 0) return 0;
  return Math.round(((mod.touchMin * 6) / mod.batch) * 100) / 100;
}

// What this scenario would change on the capacity screen, and what it cannot.
//
// Returned rather than applied, because the screen shows it to her first: these
// are HER measured numbers, and a load that silently overwrote them would be the
// same sin as a website rule quietly hiding a sale.
export function scenarioPlanPatch(saved, plan) {
  const r = computeScenario(saved);
  const now = plan || {};
  const patch = {};
  const lines = [];
  const doubled = [];
  const unmapped = [];
  // Set when either of the two modules that share the oiling-and-weighing-out
  // field fed it, so that step is not then reported as one the scenario said
  // nothing about.
  let scaleFed = false;

  const take = (key, label, value, unit) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const before = num(now[key]);
    patch[key] = value;
    lines.push({ key, label, unit, from: before, to: value, changes: before !== value });
  };

  const byJob = {};
  for (const f of r.on) {
    const job = jobOf(f);
    // A retard module is named rather than carried. The chiller is a what-if she
    // has not bought, so it is not a station of the line she has any more, and
    // writing its trays onto a field that no longer exists would be the screen
    // quietly accepting a number it then does nothing with.
    if (!job || job === "retard") { unmapped.push(f.name); continue; }
    if (byJob[job]) { doubled.push(jobLabel(job)); continue; }
    byJob[job] = f;
  }

  // The pan she is asking the scenario for, and the hands the modules need at
  // once — the two numbers the whole exercise is about.
  take("target", "Pans you want on a delivery day", r.target, "pans");
  take("people", "Pairs of hands on a bake day", r.people, "pairs");

  const mix = byJob.mix;
  if (mix) {
    take("mixMin", "Minutes to mix one tub of dough", mix.touchMin, "min");
    take("mixerPans", "Pans one tub of dough makes", mix.batch, "pans");
  }

  // The wash and the weighing-out are one job under two names now, so a module of
  // either kind fills the one field. A scenario holding both was counting the
  // same work twice; the fuller of the two is taken, which is the reading that
  // never understates her hands, and it is hers to correct either way.
  const feeding = [byJob.scale, byJob.wash].filter(Boolean);
  if (feeding.length) {
    const f = feeding.reduce((best, x) => (per6(x) > per6(best) ? x : best));
    take("scaleMin6", "Minutes to oil the pans and weigh the dough out, for 6 pans", per6(f), "min");
    // One job, one field: whichever of the two modules fed it, both of its old
    // names are answered for, so neither is then reported as a step this scenario
    // said nothing about while the screen fills that very step in.
    scaleFed = true;
  }

  for (const [job, key] of Object.entries({ top: "topMin6", cool: "coolMin6" })) {
    const f = byJob[job];
    if (!f) continue;
    take(key, `Minutes for 6 pans — ${jobLabel(job).toLowerCase()}`, per6(f), "min");
  }

  // The oven module is the swap and the bake in one: her two minutes of hands and
  // the fifteen the pan is in there, and the two together are one oven turn.
  const oven = byJob.oven;
  if (oven) {
    take("swapMin6", "Minutes to take 6 pans out and put 6 in", per6(oven), "min");
    take("ovenPans", "Pans per bake", oven.batch, "pans");
    take("ovenMin", "Minutes one oven turn takes, bake and swap together", oven.cycleMin, "min");
  }

  // Every step of the line this scenario had nothing to say about. The retard is
  // not one of them — it is not a step of this line at all — so it is left out of
  // both lists rather than appearing on one of them twice.
  const fed = new Set(Object.keys(byJob));
  if (scaleFed) { fed.add("wash"); fed.add("scale"); }
  const left = LINE_JOBS.filter((j) => j.key !== "retard" && !fed.has(j.key)).map((j) => j.label);

  return { patch, lines, left, unmapped, doubled: [...new Set(doubled)], pans: r.pansPerDay, people: r.people };
}

// ── The climb ──────────────────────────────────────────────────────────────
//
// The five steps of a constraint, which is the method she described: ask for
// more than you make, find the one module that stops you, relieve exactly that
// one, watch the number rise, and meet the next wall. Repeat until the number is
// the one you wanted — or until the relief costs more than the pans are worth.
//
// The relief it proposes is always the same knob, and it is the one she named
// herself: repeats — how many batches that module runs in the day. It is the only
// knob that raises a module's output without touching the thing she has already
// measured, so the number on the screen stays HER number.

// How many batches of a module it would take to turn out `want` pans — never
// more than a day can hold, because a rung the day cannot fit is not a rung she
// can climb. When the cap bites, the climb stops there and names the real answer
// (a bigger batch, not a more frequent one). The name keeps the old word because
// the ladder and its tests call it by it; "pass" here means one batch placed.
export function repeatsToPass(module, want) {
  const batch = num(module.batch);
  if (batch <= 0) return 0;
  const need = Math.max(1, Math.ceil(num(want) / batch));
  const mod = moduleOf(module);
  // Counted with `count`, exactly as moduleFacts counts it, so the rung the
  // ladder proposes is a rung the day can really hold — with two of the module
  // the day has twice the room.
  const fits = mod.everyMin > 0
    ? mod.count * Math.max(1, Math.floor(DAY_MIN / mod.everyMin))
    : need;
  return Math.min(need, fits);
}

// The whole climb, run to the end: keep relieving whatever is the wall until the
// target is met or the number stops moving. Each step is one module and one
// change, so the list reads as the order she would actually do them in.
//
// There are TWO ways to relieve one module, and the ladder tries them in the
// order they cost her money:
//
//   more often   raise `repeats` — free, and the first thing to try
//   a second one raise `count` — the buying decision, and the ONLY answer left
//                when the day is already full: a 12-hour retard that fits twice
//                cannot be made to fit a third time by willpower
//
// The second rung has to raise `repeats` as well, or it would buy nothing: a
// second chiller holds twice the bins but it does not run the cycles she did not
// plan, so the rung asks for the cycles the target needs AND the second machine
// that can hold them.
//
// It stops on repetition as well as on success — a module that is still the wall
// after both rungs have been tried cannot be fixed by either, and looping on it
// for ever would be a hung screen rather than an answer. That is why the guard is
// per module AND per rung.
export function climbSteps(saved, target, limit = 12) {
  const want = Math.max(0, Math.round(num(target, 0)));
  let scenario = scenarioOf(saved);
  const steps = [];
  const seen = new Set();

  for (let i = 0; i < limit; i += 1) {
    const now = computeScenario(scenario);
    if (want <= 0 || now.pansPerDay >= want) {
      return { steps, reached: want > 0 && now.pansPerDay >= want, end: now, want };
    }
    const w = now.wall;
    if (!w.id || w.batch <= 0) return { steps, reached: false, end: now, want };

    const more = repeatsToPass(w, want);
    const kind = more > w.repeats ? "repeats" : "count";
    if (seen.has(`${w.id}:${kind}`)) return { steps, reached: false, end: now, want };
    seen.add(`${w.id}:${kind}`);

    const from = kind === "repeats" ? w.repeats : w.count;
    const to = kind === "repeats" ? more : w.count + 1;
    // What the second one has to be fed to be worth buying. This is the day's
    // room for the module WITH the extra one, asked of the model itself so the
    // rung and the arithmetic can never disagree.
    const roomier = kind === "count" ? moduleFacts({ ...w, count: to }).fitsInDay : 0;

    // What this rung writes into the module. A rung that buys a second one has to
    // raise the cycles too, or the second one has nothing to do — the day's room
    // doubles but the pans she asked for do not. The step carries the change it
    // made, so the button that applies the ladder cannot write a different one.
    const change = kind === "count"
      ? { count: to, repeats: Math.max(w.repeats, Math.min(wantBatches(w, want), roomier)) }
      // Re-spaced from `startMin` at the module's own pace: a new cycle count is a
      // new rhythm, and leaving the old times behind would place the extra
      // cycles wherever the last one happened to be.
      : { repeats: to, starts: undefined };
    scenario = {
      ...scenario,
      modules: scenario.modules.map((x) => (x.id === w.id ? { ...x, ...change } : x)),
    };
    const next = computeScenario(scenario);
    steps.push({
      id: w.id,
      kind,
      module: w.name,
      icon: w.icon,
      from,
      to,
      batch: w.batch,
      before: now.pansPerDay,
      after: next.pansPerDay,
      wallThen: next.wall,
      patch: change,
    });
  }
  return { steps, reached: false, end: computeScenario(scenario), want };
}

// The climb's other direction — the half it never had (2026-09-22).
//
// A day could be raised to a number and never brought back down. Every rung of the
// climb ADDS a batch and not one of them takes one away, so a scenario she had
// climbed to 36 sat above a box reading 24 with nothing to press — and the card
// said "already makes your 24 pans" directly under a line saying it makes 36. Her
// report, in her own words: "this does not agrees?"
//
// Coming down is ONE move and not a ladder, and that is the arithmetic rather than
// a shortcut. The day is the LEAST any module turns out, so every module sitting
// on that least is holding it there; taking them all down to what the target needs
// lands the day on the number in a single move. A module left above it would only
// become the wall again the moment the others came down, which is why the move
// takes every module at the day's own number and not just the first.
//
// `starts` is deliberately not re-spaced here, the one place this differs from the
// climb. Raising a count is a new rhythm and the old times cannot describe it;
// lowering one only removes batches from the END of the day, so the times she has
// already dragged stay exactly where she put them.
export function descentSteps(saved, target) {
  const want = Math.max(0, Math.round(num(target, 0)));
  const sc = scenarioOf(saved);
  const now = computeScenario(sc);
  if (want <= 0 || now.pansPerDay <= want) return { steps: [], reached: false, end: now, want };

  const holding = now.on.filter((f) => f.output > 0 && f.output === now.pansPerDay);
  const items = [];
  for (const f of holding) {
    const to = Math.max(1, Math.ceil(want / (f.batch || 1)));
    if (to < f.repeats) items.push({ id: f.id, icon: f.icon, name: f.name, from: f.repeats, to, batch: f.batch });
  }
  // Nothing can come off this way: one batch is already more than the number she
  // asked for. The mirror of the climb stopping at a day's limit, and it has to say
  // so rather than offer a press that would move nothing.
  if (!items.length) {
    const one = holding[0] || { batch: 1, name: "", icon: "" };
    return {
      steps: [], reached: false, end: now, want,
      tooBig: { batch: one.batch, name: one.name, icon: one.icon, floor: one.batch },
    };
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  const next = computeScenario({
    ...sc,
    modules: sc.modules.map((m) => (byId.has(m.id) ? { ...m, repeats: byId.get(m.id).to } : m)),
  });
  return {
    steps: [{ kind: "down", items, before: now.pansPerDay, after: next.pansPerDay }],
    reached: next.pansPerDay <= want,
    end: next,
    want,
  };
}

// How many batches this module would have to run to turn out `want` pans.
function wantBatches(module, want) {
  const batch = num(module.batch);
  if (batch <= 0) return 1;
  return Math.max(1, Math.ceil(num(want) / batch));
}

// The two facts about a saved day, kept APART so a table can put each in its own
// column. One source for both, so the number in the shelf's "Pans a day" column
// and the number in the one-line summary below cannot drift — which is the whole
// reason this is not two functions doing the same count twice.
export function scenarioFacts(saved) {
  const mods = Array.isArray(saved && saved.modules) ? saved.modules : [];
  const on = mods.filter((m) => m.on !== false);
  const r = computeScenario(saved);
  return { pansPerDay: r.pansPerDay, modules: on.length };
}

// One line about a scenario, in the same words wherever it is listed — on the
// scenario shelf and on the production line that can load it.
export function scenarioSummary(saved) {
  const { pansPerDay, modules } = scenarioFacts(saved);
  return `${pansPerDay} ${pansPerDay === 1 ? "pan" : "pans"} a day · ${modules} ${modules === 1 ? "module" : "modules"}`;
}

// Her rule for the batch counts, 2026-09-22: "follow the one before, and say when
// it does not." Her other sentence is the reason it exists — "the number of
// batches should align with batches from previous module".
//
// Two halves, and the second is what makes the first safe. alignBatches carries an
// edited batch count FORWARD down the modules that were in step with it and stops
// the moment one is not, so a number she has deliberately given a module of its own
// is never quietly overwritten. batchMismatches is the other half: it names every
// module whose count differs from the one before it, so a count that is out of step
// is a sentence she reads rather than a difference she has to spot.
//
// Only modules that are ON are in this chain. A module switched out of the day is
// not part of the line, so it neither follows nor breaks a run of them.
//
// Both MUTATE the modules they are given, the way the editor edits in place: the
// pop-up holds a reference to the module she is working on, so handing back fresh
// copies would leave the box she is typing in writing to a module the day no
// longer has.

// A module's batch count, as the day reads it.
const batchesOf = (m) => Math.max(1, Math.round(num(m && m.repeats, 1)));

// Carry a new batch count down from one module. The edited module always takes the
// number; each module after it follows only while its count still matched the one
// the edited module had a moment ago. Returns the list it was given.
export function alignBatches(mods, id, repeats) {
  const list = Array.isArray(mods) ? mods : [];
  const at = list.findIndex((m) => m && m.id === id);
  if (at < 0) return list;
  const want = Math.max(1, Math.round(num(repeats, 1)));
  const was = batchesOf(list[at]);
  list[at].repeats = want;
  for (let i = at + 1; i < list.length; i += 1) {
    if (list[i].on === false) continue;
    if (batchesOf(list[i]) !== was) break;
    list[i].repeats = want;
  }
  return list;
}

// Every module whose batch count is not the same as the module before it, in the
// day's order. The first module has nothing before it, so it is never named.
//
// A module whose count is AUTOMATIC is never named, because it cannot differ: it
// took the count from the module above it. Naming it would turn her own setting —
// "we just indicate in the 1st module" — into a note that reads as a fault.
export function batchMismatches(mods) {
  const chain = (Array.isArray(mods) ? mods : [])
    .filter((m) => m && m.on !== false)
    .map((m) => ({
      id: m.id,
      name: m.name || "A module",
      repeats: batchesOf(m),
      auto: m.repeatsAuto === true,
    }));
  const out = [];
  for (let i = 1; i < chain.length; i += 1) {
    if (chain[i].auto) continue;
    if (chain[i].repeats !== chain[i - 1].repeats) {
      out.push({ ...chain[i], before: chain[i - 1] });
    }
  }
  return out;
}

// "2 h 30 m" — for a timeline that runs through the night, where "14.5 hours"
// is a number she has to convert in her head and "14 h 30 m" is one she reads.
export function hoursAndMinutes(mins) {
  const m = Math.max(0, Math.round(num(mins)));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h <= 0) return `${rest} min`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} min`;
}

// A minute of the day as a clock reading she would recognise, so a start time
// reads "7:30 am" rather than "450".
export function clockOf(mins) {
  const m = Math.max(0, Math.round(num(mins))) % (24 * 60);
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 < 12 ? "am" : "pm";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ampm}`;
}

// Where the time cursor points, as minutes from the start of her day, from the
// px offset she is pointing at. It reads the minute the pointer is really on —
// the batch buttons step by five minutes AND by one, so a cursor that rounded to
// fives was stricter than the screen it was reading, and named a time no closer
// than the ruler beside it. It answers null — rather than guessing — when the
// pointer is past either end of the day, which is the caller's cue to take the
// cursor away. A minute is the only thing this returns: it reads the chart, and
// writes nothing.
export function minuteAtPx(px, pxPerMin, windowMin) {
  const scale = num(pxPerMin);
  const x = Number(px);
  if (!(scale > 0) || !Number.isFinite(x)) return null;
  const mins = x / scale;
  if (mins < 0 || mins > num(windowMin)) return null;
  // To the minute, and never past the end of the day, which need not land on one.
  return Math.min(Math.round(mins), num(windowMin));
}
