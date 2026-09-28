// production.js — the focaccia line as a capacity model.
//
// Pure and DOM-free, so the arithmetic can be trusted and tested with
// node --test (test/production.test.js). The screen in views/production.js
// draws whatever this returns and decides nothing itself.
//
// One idea holds the whole thing up: a line's capacity is its slowest station,
// and a day's capacity is that limit held for the hours she will actually bake.
// Every station is expressed in the same unit — pans per hour — so they can be
// compared directly and the lowest one named.

// Every timed task she measured was timed on 6 pans (see /form/).
export const PANS_PER_TASK = 6;

// The numbers she measured on /form/ (19 Sep 2026) and told me directly. These
// are only a starting point: every one is hers to correct on the screen, and
// nothing else in the app reads them.
export const DEFAULT_PLAN = {
  people: 1,       // pairs of hands on a bake day
  hours: 5,        // hours she is willing to bake for
  target: 60,      // pans she wants on a delivery day
  pans: 12,        // baking pans she owns
  prooferPans: 12, // pans her proofer holds at once
  mixerPans: 6,    // pans one tub of dough makes
  ovenPans: 6,     // pans per bake
  // The pans are in the oven 13 minutes and the swap around them is 2, so one
  // turn of the oven is 15. Kept as the one figure the oven station reads, so
  // "the oven does six pans every 15 minutes" stays reachable from her numbers.
  ovenMin: 15,     // minutes one turn of the oven takes — bake and swap together
  ovenShelves: 2,  // shelves used
  scaleMin6: 15,   // oil the pans and weigh the dough out into 6 pans
  topMin6: 6,      // dimple and top 6 pans — her 1 minute a pan
  swapMin6: 2,     // take 6 out and put 6 in, both halves
  // The bake day on a clock (22 Sep 2026), the chain the backwards plan walks.
  // Her corrected order — see memory/bake-day. These are the minutes a step
  // TAKES, which is not the same as the minutes her hands are busy on it: the
  // proofer holds the dough for 45 and asks nothing of her.
  mixMin: 20,       // mixing the dough in the tub, ONE mix — spread over the batch
  foldRests: 4,     // how many rests the dough takes before it goes into pans
  foldRestMin: 30,  // minutes of rest between folds
  foldMin: 1,       // minutes ONE stretch and fold takes
  proofMin1: 45,    // minutes in the proofer before the dimple
  proofMin2: 30,    // minutes in the proofer after the dimple
  coolWaitMin: 30,  // minutes the baked pans cool before they are cut
  // The clock the backwards plan is built from, and the two bands she asked for.
  readyAtMin: 480,  // when the first batch must be standing at the oven (8:00 am)
  rhythmMin: 15,    // minutes between batches she would like — one oven turn
  tolMin: 5,        // minutes earlier than a latest start that are still fine
  // The hand-work that is still 0 until she times it, and 0 means NOT MEASURED,
  // not "free": the screen names every untimed step rather than quietly
  // promising a day the hands could not actually deliver.
  coolMin6: 0,      // cutting and packing 6 pans
};

// The steps of the line that are hers to time, in the order her day runs them.
//
// `per` says what the minutes are counted over, which is what lets a job timed
// on a whole batch be spread across the pans it makes: a bigger mixer genuinely
// costs less labour for every pan.
//
//   "mix"   counted over ONE mix, spread over the pans that mix makes
//   "fold"  counted over ONE fold, and a batch takes one fewer fold than it
//           takes rests — the last rest is a rest and nothing else
//   6       counted over six pans, which is how she timed them
//
// `name` is the full label for the list of jobs; `short` is the same job as it
// reads inside a sentence ("1 on the packing", "the rest — mixing, oiling and
// weighing out"), because a full label dropped into running prose turns a
// sentence into a paragraph.
//
// There is no wash step of its own. "Wash, oil and fill" and "weighing the
// dough out into pans" were always one job under two names — which is why her
// own count of the hand-work leaves one of them out — so they are one step now,
// measured by the same minutes she gave it to weigh out six pans.
export const LABOUR_STEPS = [
  { key: "mixMin", job: "mix", name: "Mixing the dough in the tub", short: "mixing", per: "mix" },
  { key: "foldMin", job: "fold", name: "The rests and the stretch and folds", short: "the folds", per: "fold" },
  { key: "scaleMin6", job: "scale", name: "Oil the pans and weigh the dough out", short: "oiling and weighing out", per: 6 },
  { key: "topMin6", job: "top", name: "Dimple and top", short: "topping", per: 6 },
  { key: "swapMin6", job: "swap", name: "The oven swap", short: "oven swap", per: 6 },
  { key: "coolMin6", job: "cool", name: "Cutting and packing", short: "packing", per: 6 },
];

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// A rate is Infinity when the station cannot limit anything (nothing measured,
// or nothing to measure) — treated as "never the bottleneck" everywhere below.
function ratePerHour(pansPerCycle, minutesPerCycle) {
  const pans = num(pansPerCycle);
  const mins = num(minutesPerCycle);
  if (pans <= 0 || mins <= 0) return Infinity;
  return (pans * 60) / mins;
}

// The plan, merged over the defaults and clamped to something the line can
// actually be asked. Everything below reads the plan through here, and the
// screen reads the same values back out of computeLine().plan — so a number
// shown on screen is always the number the arithmetic used. (A cleared field
// arrives as 0 or "", and a screen that printed "0 pairs of hands" beside a
// calculation that used 1 would be the worst kind of wrong.)
export function planOf(settingsProduction) {
  const p = { ...DEFAULT_PLAN, ...(settingsProduction || {}) };
  const atLeast = (v, floor, fallback) => Math.max(floor, num(v, fallback));
  return {
    people: atLeast(p.people, 1, 1),
    hours: atLeast(p.hours, 0.25, DEFAULT_PLAN.hours),
    target: atLeast(p.target, 0, 0),
    pans: atLeast(p.pans, 0, 0),
    prooferPans: atLeast(p.prooferPans, 0, 0),
    mixerPans: atLeast(p.mixerPans, 0, 0),
    ovenPans: atLeast(p.ovenPans, 0, 0),
    ovenMin: atLeast(p.ovenMin, 0, 0),
    ovenShelves: atLeast(p.ovenShelves, 0, 0),
    scaleMin6: atLeast(p.scaleMin6, 0, 0),
    topMin6: atLeast(p.topMin6, 0, 0),
    swapMin6: atLeast(p.swapMin6, 0, 0),
    mixMin: atLeast(p.mixMin, 0, 0),
    foldRests: atLeast(p.foldRests, 0, 0),
    foldRestMin: atLeast(p.foldRestMin, 0, 0),
    foldMin: atLeast(p.foldMin, 0, 0),
    proofMin1: atLeast(p.proofMin1, 0, 0),
    proofMin2: atLeast(p.proofMin2, 0, 0),
    coolWaitMin: atLeast(p.coolWaitMin, 0, 0),
    // The clock and the two bands. 0 is a legitimate answer for all three — a
    // day that starts at midnight, no rhythm asked for, no early tolerance — so
    // they are clamped at 0 rather than given the "0 means unset" fallback that
    // hours carries.
    readyAtMin: atLeast(p.readyAtMin, 0, 0),
    rhythmMin: atLeast(p.rhythmMin, 0, 0),
    tolMin: atLeast(p.tolMin, 0, 0),
    coolMin6: atLeast(p.coolMin6, 0, 0),
  };
}

// One step's claim on the day, in minutes for every pan.
//
// Most steps are timed per 6 pans. Two are not, and both are spread over the
// batch they belong to — the honest reading, and the one that means a bigger
// tub really does cost less labour for every pan:
//
//   the mix    its minutes are for the whole mix, over the pans that mix makes
//   the folds  its minutes are for ONE fold, and a batch takes one fewer fold
//              than it takes rests, so the count comes from foldRests
//
// This is the ONE place that decides whether a step was measured at all: no
// minutes on it, or no batch size to spread the minutes over, and it claims
// nothing. unmeasuredSteps() reports exactly those, so a step can never quietly
// count as free while the screen presents a day the line could not deliver.
function stepMinutes(p, s) {
  const mins = num(p[s.key]);
  if (mins <= 0) return 0;
  if (s.per === "fold") {
    const folds = foldsIn(p);
    const pansPer = num(p.mixerPans);
    return folds > 0 && pansPer > 0 ? (mins * folds) / pansPer : 0;
  }
  const pansPer = s.per === "mix" ? num(p.mixerPans) : s.per;
  return pansPer > 0 ? mins / pansPer : 0;
}

// How many stretch-and-folds a batch gets. The last rest is a rest and nothing
// else, so it is always one fewer than the rests — her own description of the
// day, in one line.
export function foldsIn(plan) {
  const p = planOf(plan);
  return Math.max(0, Math.round(num(p.foldRests)) - 1);
}

// Minutes of hand-work for every pan, from every step she has timed.
export function labourPerPanOf(plan) {
  const p = planOf(plan);
  return LABOUR_STEPS.reduce((sum, s) => sum + stepMinutes(p, s), 0);
}

// The steps she has not timed yet, by their plain names.
export function unmeasuredSteps(plan) {
  const p = planOf(plan);
  return LABOUR_STEPS.filter((s) => stepMinutes(p, s) <= 0).map((s) => s.name);
}

// The four things that can hold the line back, each in pans per hour.
//
// The proofer is the equipment that decides her day: a batch of six pans is in
// it for the whole of both proofs with the dimple between them — 45, then 6,
// then 30, 81 minutes — and the cabinet holds as many pans as it holds, so a
// batch finishes every 81 minutes divided by the batches it can hold at once.
// At 12 pans that is 40.5 minutes a batch, which is the ceiling she worked out
// herself. She dimples one pan at a time, so the cabinet is never actually
// emptied and the 81 stands.
//
// It replaces the chiller, which used to read trays-over-hours and made a
// what-if fridge the wall of a day she does not run. The fridge is still hers to
// plan with — it is a module in the Scenario planner — but it is not a station of
// the line she has.
//
// The hands are the one shared pool: six jobs, one set of people. Their rate is
// the whole pool's, which is the balanced truth — see allocation() for who
// stands where.
export function stations(plan) {
  const p = planOf(plan);
  const people = p.people;
  const hours = p.hours;

  const labourPerPan = labourPerPanOf(p);
  const handsRate = labourPerPan > 0 ? (people * 60) / labourPerPan : Infinity;
  const ovenRate = ratePerHour(p.ovenPans, p.ovenMin);
  const panRate = ratePerHour(p.pans, p.ovenMin);
  const prooferPans = num(p.prooferPans);
  const proofMin = proofCycleOf(p);
  const prooferRate = prooferPans > 0 && proofMin > 0 ? ratePerHour(prooferPans, proofMin) : Infinity;

  return [
    {
      key: "hands", icon: "👋", name: "Your hands", rate: handsRate, plural: true,
      sub: `${people} ${people === 1 ? "pair of hands" : "pairs of hands"} · every hand-job, from mixing to packing`,
    },
    {
      key: "proofer", icon: "🌡️", name: "The proofer", rate: prooferRate,
      sub: `${prooferPans} ${prooferPans === 1 ? "pan" : "pans"} held for ${trim(proofMin)} min · six pans every ${trim(proofMin / Math.max(1, prooferPans / PANS_PER_TASK))} min`,
    },
    {
      key: "oven", icon: "🔥", name: "The oven", rate: ovenRate,
      sub: `${num(p.ovenPans)} pans every ${trim(num(p.ovenMin))} min`,
    },
    {
      key: "pans", icon: "🥘", name: "Your pans", rate: panRate, plural: true,
      sub: `${num(p.pans)} pans turning over, one bake at a time`,
    },
  ];
}

// How long one batch of six pans is in the proofer, start to finish: the proof
// before the dimple, the dimple itself, and the proof after it. This is the
// figure that decides the proofer's rhythm, and it is the same 81 she arrived
// at by hand.
export function proofCycleOf(plan) {
  const p = planOf(plan);
  return num(p.proofMin1) + num(p.topMin6) + num(p.proofMin2);
}

// The whole answer, from one plan.
export function computeLine(settingsProduction) {
  const p = planOf(settingsProduction);
  const hours = Math.max(0.25, num(p.hours, DEFAULT_PLAN.hours));
  const rows = stations(p);

  const live = rows.filter((r) => Number.isFinite(r.rate) && r.rate > 0);
  // Ties go to the earlier row, so the hands are named before the oven when both
  // read the same — the hands are the one she can actually move today.
  const bottleneck = live.length
    ? live.reduce((best, r) => (r.rate < best.rate ? r : best))
    : { key: "none", icon: "•", name: "Nothing yet", rate: 0, sub: "Fill in your numbers above." };

  const lineRate = live.length ? bottleneck.rate : 0;
  const dayCapacity = Math.floor(hours * lineRate);

  // The best the line could do with unlimited hands — the ceiling the hands are
  // measured against. When the hands already clear it, more people buy nothing.
  const withoutHands = rows
    .filter((r) => r.key !== "hands" && Number.isFinite(r.rate) && r.rate > 0)
    .map((r) => r.rate);
  const otherRate = withoutHands.length ? Math.min(...withoutHands) : Infinity;

  const labourPerPan = labourPerPanOf(p);

  return {
    plan: p,
    hours,
    labourPerPan,
    stations: rows,
    bottleneck,
    lineRate,
    dayCapacity,
    target: Math.max(0, num(p.target)),
    shortfall: Math.max(0, Math.round(num(p.target)) - dayCapacity),
    // How many pairs of hands this line can actually use. Past this, a new
    // person stands around — which is the honest answer to "optimise manpower".
    usefulPeople: usefulPeople(p, otherRate),
    handsRate: rows[0].rate,
    otherRate,
    allocation: allocation(p),
    mixes: mixesFor(p, dayCapacity),
    levers: leversFor(p, dayCapacity),
    // The steps not yet timed, so the screen can say the day looks faster than
    // it is rather than quietly presenting a number it cannot stand behind.
    unmeasured: unmeasuredSteps(p),
  };
}

// The fewest pairs of hands that already keep up with everything except the
// hands themselves. One more than this buys no pans.
export function usefulPeople(plan, otherRate = null) {
  const p = planOf(plan);
  const perPan = labourPerPanOf(p);
  if (perPan <= 0) return 1;
  let ceil = otherRate;
  if (ceil == null) {
    const prooferPans = num(p.prooferPans);
    const proofMin = proofCycleOf(p);
    const rates = [
      ratePerHour(p.ovenPans, p.ovenMin),
      ratePerHour(p.pans, p.ovenMin),
      prooferPans > 0 && proofMin > 0 ? ratePerHour(prooferPans, proofMin) : Infinity,
    ].filter((r) => Number.isFinite(r) && r > 0);
    ceil = rates.length ? Math.min(...rates) : Infinity;
  }
  if (!Number.isFinite(ceil)) return Math.max(1, num(p.people, 1));
  return Math.max(1, Math.ceil((ceil * perPan) / 60));
}

// Who stands where. With people able to move between the three jobs, the line
// runs fastest when every job finishes at the same moment — so each job's claim
// on the people is its share of the work, and the seats are split by largest
// remainder (so 3 people over shares of 60/27/13% become 2 on the wash and 1
// on the top, not 1 and nobody).
export function allocation(plan) {
  const p = planOf(plan);
  const people = Math.max(1, Math.round(num(p.people, 1)));
  // Built from the same list the model measures, so the jobs on screen and the
  // jobs in the arithmetic can never drift apart. Each is weighed by its claim
  // on the day — minutes a pan — and a step she has not timed claims nothing.
  const jobs = LABOUR_STEPS.map((s) => ({
    key: s.job,
    name: s.name,
    short: s.short,
    mins: num(p[s.key]),
    perPan: stepMinutes(p, s),
  }));
  const total = jobs.reduce((s, j) => s + j.perPan, 0);
  const seats = apportion(jobs.map((j) => j.perPan), people);
  return jobs.map((j, i) => ({
    ...j,
    share: total > 0 ? j.perPan / total : 0,
    seats: seats[i],
  }));
}

// Largest-remainder apportionment (Hamilton): hand out the whole seats first,
// then give what is left to the biggest fractional claims.
function apportion(weights, seats) {
  const out = weights.map(() => 0);
  const total = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (total <= 0 || seats <= 0) return out;
  const exact = weights.map((w) => ((w > 0 ? w : 0) / total) * seats);
  exact.forEach((v, i) => { out[i] = Math.floor(v); });
  let left = seats - out.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  for (let k = 0; k < order.length && left > 0; k += 1, left -= 1) out[order[k].i] += 1;
  return out;
}

// How many mixes a day takes. The mixer is not a station — it only ever splits
// the day into batches, and it only matters when it splits it into more than one.
export function mixesFor(plan, dayCapacity) {
  const p = planOf(plan);
  const per = num(p.mixerPans);
  if (per <= 0 || dayCapacity <= 0) return 1;
  return Math.max(1, Math.ceil(dayCapacity / per));
}

// The moves she could make, each scored by how many pans it actually buys.
// Anything that buys nothing keeps its row and says why, rather than sitting
// there looking like a button that does nothing.
const MOVES = [
  {
    key: "people", label: "One more pair of hands",
    apply: (p) => ({ ...p, people: num(p.people, 1) + 1 }),
    cost: "the help",
  },
  {
    key: "prooferPans", label: "A proofer holding six more pans",
    apply: (p) => ({ ...p, prooferPans: num(p.prooferPans) + 6 }),
    cost: "a bigger proofer",
  },
  {
    key: "pans", label: "Six more pans",
    apply: (p) => ({ ...p, pans: num(p.pans) + 6 }),
    cost: "the pans",
  },
  {
    key: "scale", label: "Oil the pans and weigh the dough out 10% faster",
    apply: (p) => ({ ...p, scaleMin6: num(p.scaleMin6) * 0.9 }),
    cost: "a better routine",
  },
  {
    key: "hours", label: "One more hour in the day",
    apply: (p) => ({ ...p, hours: num(p.hours, DEFAULT_PLAN.hours) + 1 }),
    cost: "your time",
  },
  {
    key: "oven", label: "One more pan per bake",
    apply: (p) => ({ ...p, ovenPans: num(p.ovenPans) + 1 }),
    cost: "a bigger oven",
  },
];

export function leversFor(plan, baseCapacity) {
  const p = planOf(plan);
  return MOVES.map((m) => {
    const next = computeDay(m.apply(p));
    return {
      key: m.key,
      label: m.label,
      cost: m.cost,
      capacity: next.dayCapacity,
      bottleneck: next.bottleneck,
      gain: next.dayCapacity - baseCapacity,
    };
  }).sort((a, b) => (b.gain - a.gain) || a.label.localeCompare(b.label));
}

// The slice of computeLine a lever needs — not the whole answer, so scoring six
// moves never costs six allocations.
function computeDay(plan) {
  const hours = Math.max(0.25, num(plan.hours, DEFAULT_PLAN.hours));
  const live = stations(plan).filter((r) => Number.isFinite(r.rate) && r.rate > 0);
  if (!live.length) return { dayCapacity: 0, bottleneck: { key: "none", name: "Nothing yet" } };
  const bottleneck = live.reduce((best, r) => (r.rate < best.rate ? r : best));
  return { dayCapacity: Math.floor(hours * bottleneck.rate), bottleneck };
}

// 5 not 5.0, 2.5 not 2.50 — for the numbers she reads.
export function trim(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v);
}
