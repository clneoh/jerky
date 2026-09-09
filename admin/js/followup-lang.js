// followup-lang.js — the "Copy follow-up" bring-a-friend check-in in English,
// Chinese and Bahasa Malaysia. The baker picks a language before copying, so
// the whole message (greeting, product line, feeding tip, the scheme pitch and
// the customer's own link) reads in the customer's language. English is the
// default and is byte-for-byte what the message said before this existed.
//
// (jerky-localized: the English tip line says "Feeding tip" — pet treats, not
// baked goods; see the product editor's "Feeding tip" field.)
//
// {p} {tip} {off} {ref} {n} are filled in by referrals.js at copy time — the
// product/serving-tip text is localized on the product itself (auto-translated
// into 中文 / BM), while the surrounding sentences live here.

export const FOLLOWUP = {
  en: {
    hi: "Hi",
    howProduct: "How did the {p} go? Hope you enjoyed it 😊",
    howOrder: "Hope your order was lovely 😊",
    serving: "Feeding tip: {tip}",
    pitch: "If you liked it, why not share your personal link below? A friend who is NEW to us gets {off} off their FIRST order — and you get {ref} off a future order for every friend who orders through your link.",
    yourLink: "Your link to share:",
    neverExpires: "Your credit never expires.",
    validDays: "Each credit is valid {n} days from when your friend orders.",
  },
  zh: {
    hi: "你好",
    howProduct: "你觉得{p}怎么样？希望你喜欢😊",
    howOrder: "希望你的订单一切都好😊",
    serving: "食用建议：{tip}",
    pitch: "如果喜欢的话，不妨把下面你的专属链接分享出去：新朋友首次下单立减 {off}，朋友通过你的链接每下一单，你的下一次订单也减 {ref}。",
    yourLink: "分享你的链接：",
    neverExpires: "你的奖励不会过期。",
    validDays: "每份奖励自朋友下单起 {n} 天内有效。",
  },
  ms: {
    hi: "Hai",
    howProduct: "Macam mana {p} tadi? Harap anda sukakannya 😊",
    howOrder: "Harap pesanan anda berjalan lancar 😊",
    serving: "Tip hidangan: {tip}",
    pitch: "Kalau anda suka, kongsikan pautan peribadi anda di bawah: rakan yang BARU kepada kami dapat {off} diskaun untuk pesanan PERTAMA mereka, dan untuk setiap rakan yang membuat pesanan melalui pautan anda, anda dapat {ref} diskaun untuk pesanan akan datang.",
    yourLink: "Pautan anda untuk dikongsi:",
    neverExpires: "Kredit anda tidak pernah luput.",
    validDays: "Setiap kredit sah {n} hari dari tarikh rakan anda membuat pesanan.",
  },
};

// Fill {placeholders} in a template sentence.
export function fmtFollowup(template, map) {
  let out = String(template);
  for (const [key, val] of Object.entries(map || {})) {
    out = out.split(`{${key}}`).join(String(val));
  }
  return out;
}
