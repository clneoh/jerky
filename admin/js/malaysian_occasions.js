// Malaysia's dates for the "Add Malaysia's occasions" import button, from the
// Delivery-calendar "Mark an occasion" mode. Curated to what Malaysians across
// the Peninsular actually celebrate — nationwide public holidays + big
// cultural/family days + the year-end school break + the extra public holidays
// each state or territory observes on top of the nationwide ones (rows name
// the states that observe them, so the baker can tick or delete by what
// applies to her). `pub: true` = an official public holiday somewhere
// (imports red); everything else imports orange.
//
// Dates follow the published calendar where one exists. Anything the state or
// federal gazette has not yet confirmed is labelled "(est.)" — lunar and
// annually-gazetted holidays — and she can Edit any imported mark later
// anyway. Rows whose `to` is in the past are never offered for import.
export const MALAYSIAN_OCCASIONS = [
  // ── 2026 (from today, 5 Sep) ──────────────────────────────────────────────
  { label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", cat: "national", pub: true },
  { label: "Mid-Autumn Festival", from: "2026-09-25", to: "2026-09-25", cat: "festive", pub: false },
  { label: "Sultan of Kelantan's Birthday — Kelantan", from: "2026-09-29", to: "2026-09-30", cat: "state", pub: true },
  { label: "Halloween", from: "2026-10-31", to: "2026-10-31", cat: "festive", pub: false },
  { label: "Sultan of Perak's Birthday — Perak", from: "2026-11-06", to: "2026-11-06", cat: "state", pub: true },
  { label: "Deepavali", from: "2026-11-08", to: "2026-11-09", cat: "festive", pub: true },
  { label: "Year-end school holidays", from: "2026-12-04", to: "2027-01-03", cat: "school", pub: false },
  { label: "Sultan of Selangor's Birthday — Selangor", from: "2026-12-11", to: "2026-12-11", cat: "state", pub: true },
  { label: "Christmas", from: "2026-12-25", to: "2026-12-25", cat: "festive", pub: true },

  // ── 2027 ─────────────────────────────────────────────────────────────────
  { label: "New Year's Day", from: "2027-01-01", to: "2027-01-01", cat: "festive", pub: true },
  { label: "Israk & Mikraj (est.) — Kedah, Negeri Sembilan, Perlis & Terengganu", from: "2027-01-06", to: "2027-01-06", cat: "state", pub: true },
  { label: "Yang di-Pertuan Besar's Birthday — Negeri Sembilan", from: "2027-01-14", to: "2027-01-14", cat: "state", pub: true },
  { label: "Thaipusam", from: "2027-01-22", to: "2027-01-22", cat: "festive", pub: true },
  { label: "Federal Territory Day — Kuala Lumpur & Putrajaya", from: "2027-02-01", to: "2027-02-01", cat: "state", pub: true },
  { label: "Chinese New Year", from: "2027-02-06", to: "2027-02-07", cat: "festive", pub: true },
  { label: "Awal Ramadan (est.) — Johor & Kedah", from: "2027-02-08", to: "2027-02-08", cat: "state", pub: true },
  { label: "Valentine's Day", from: "2027-02-14", to: "2027-02-14", cat: "family", pub: false },
  { label: "Melaka Independence Declaration Day — Melaka", from: "2027-02-20", to: "2027-02-20", cat: "state", pub: true },
  { label: "Nuzul Al-Quran (est.) — Selangor, KL, Penang, Perak, Pahang, Perlis, Kelantan & Terengganu", from: "2027-02-24", to: "2027-02-24", cat: "state", pub: true },
  { label: "Sultan of Terengganu's Installation Anniversary (est.) — Terengganu", from: "2027-03-04", to: "2027-03-04", cat: "state", pub: true },
  { label: "Hari Raya Aidilfitri (est.)", from: "2027-03-10", to: "2027-03-11", cat: "festive", pub: true },
  { label: "Sultan of Johor's Birthday — Johor", from: "2027-03-23", to: "2027-03-23", cat: "state", pub: true },
  { label: "Sultan of Terengganu's Birthday — Terengganu", from: "2027-04-26", to: "2027-04-26", cat: "state", pub: true },
  { label: "Labour Day", from: "2027-05-01", to: "2027-05-01", cat: "national", pub: true },
  { label: "Mother's Day", from: "2027-05-09", to: "2027-05-09", cat: "family", pub: false },
  { label: "Teacher's Day", from: "2027-05-16", to: "2027-05-16", cat: "family", pub: false },
  { label: "Arafat Day (est.) — Kelantan & Terengganu", from: "2027-05-16", to: "2027-05-16", cat: "state", pub: true },
  { label: "Hari Raya Haji", from: "2027-05-17", to: "2027-05-17", cat: "festive", pub: true },
  { label: "Raja of Perlis' Birthday (est.) — Perlis", from: "2027-05-17", to: "2027-05-17", cat: "state", pub: true },
  { label: "Hari Raya Haji second day (est.) — Kedah, Perlis, Kelantan & Terengganu", from: "2027-05-18", to: "2027-05-18", cat: "state", pub: true },
  { label: "Wesak Day", from: "2027-05-20", to: "2027-05-20", cat: "festive", pub: true },
  { label: "Hari Hol Pahang — Pahang", from: "2027-05-22", to: "2027-05-22", cat: "state", pub: true },
  { label: "Awal Muharram (est.)", from: "2027-06-06", to: "2027-06-06", cat: "festive", pub: true },
  { label: "Yang di-Pertuan Agong's Birthday (est.)", from: "2027-06-07", to: "2027-06-07", cat: "national", pub: true },
  { label: "Father's Day", from: "2027-06-20", to: "2027-06-20", cat: "family", pub: false },
  { label: "Sultan of Kedah's Birthday (est.) — Kedah", from: "2027-06-20", to: "2027-06-20", cat: "state", pub: true },
  { label: "George Town World Heritage City Day — Penang", from: "2027-07-07", to: "2027-07-07", cat: "state", pub: true },
  { label: "Yang di-Pertua Negeri's Birthday — Penang", from: "2027-07-10", to: "2027-07-10", cat: "state", pub: true },
  { label: "Hari Hol Almarhum Sultan Iskandar (est.) — Johor", from: "2027-07-10", to: "2027-07-10", cat: "state", pub: true },
  { label: "Sultan of Pahang's Birthday (est.) — Pahang", from: "2027-07-30", to: "2027-07-30", cat: "state", pub: true },
  { label: "Prophet Muhammad's birthday (est.)", from: "2027-08-15", to: "2027-08-15", cat: "festive", pub: true },
  { label: "Yang di-Pertua Negeri's Birthday — Melaka", from: "2027-08-24", to: "2027-08-24", cat: "state", pub: true },
  { label: "Merdeka Day", from: "2027-08-31", to: "2027-08-31", cat: "national", pub: true },
  { label: "Mid-Autumn Festival", from: "2027-09-15", to: "2027-09-15", cat: "festive", pub: false },
  { label: "Malaysia Day", from: "2027-09-16", to: "2027-09-16", cat: "national", pub: true },
  { label: "Sultan of Kelantan's Birthday (est.) — Kelantan", from: "2027-09-29", to: "2027-09-30", cat: "state", pub: true },
  { label: "Deepavali (est.)", from: "2027-10-28", to: "2027-10-28", cat: "festive", pub: true },
  { label: "Halloween", from: "2027-10-31", to: "2027-10-31", cat: "festive", pub: false },
  { label: "Sultan of Perak's Birthday — Perak", from: "2027-11-05", to: "2027-11-05", cat: "state", pub: true },
  { label: "Sultan of Selangor's Birthday — Selangor", from: "2027-12-11", to: "2027-12-11", cat: "state", pub: true },
  { label: "Christmas", from: "2027-12-25", to: "2027-12-25", cat: "festive", pub: true },
];

// The import colour rule the baker chose: public holiday = red, else orange.
// (She can re-colour any imported mark afterwards, like her own marks.)
export function importOccColour(entry) {
  return entry.pub ? "red" : "orange";
}
