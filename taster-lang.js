// taster-lang.js — the landing page's own words (taster/), in English, 中文 and
// Bahasa Malaysia, the same three languages as the homepage and the shop.
//
// Only the page's fixed chrome lives here. Two kinds of wording deliberately do
// NOT: the heading and the sentence under it come from Settings → the page's own
// copy (published as `taster`), so she can rewrite them without a redeploy; and
// the offer line comes from store-lang.js, so a label's words are identical
// wherever the customer meets them — on the landing page and on the shop banner
// above the basket. One label, one sentence.

const en = {
  title: "A treat for your pet",
  heading: "A little something for your pet",
  body: "Welcome — have a look at what we make.",
  friend: "A friend sent you here",
  ended: "This offer has finished",
  noCode: "This link has no label code.",
  askPet: "Who is this treat for?",
  dog: "My dog",
  cat: "My cat",
  thanks: "Noted — lovely to meet you both.",
  go: "See the treats",
  goHint: "Freshly dehydrated, posted nationwide.",
  typeCode: "Type the code from your label",
  typeCodeHint: "The short letters printed beside the square.",
  codePh: "e.g. K3X9",
  badCode: "We don't know that code — check the letters beside the square.",
  follow: "Follow us",
};

const zh = {
  title: "给你的宠物一份小礼物",
  heading: "给你的宠物一份小礼物",
  body: "欢迎 — 看看我们做的零食。",
  friend: "朋友介绍你来的",
  ended: "这个优惠已经结束了",
  noCode: "这个链接没有标签编号。",
  askPet: "这份零食是给谁的？",
  dog: "我的狗",
  cat: "我的猫",
  thanks: "好的 — 很高兴认识你们。",
  go: "看看零食",
  goHint: "新鲜风干，全国邮寄。",
  typeCode: "输入标签上的编号",
  typeCodeHint: "印在方块旁边的小字。",
  codePh: "例如 K3X9",
  badCode: "我们找不到这个编号 — 请核对方块旁边的小字。",
  follow: "关注我们",
};

const ms = {
  title: "Hadiah untuk haiwan anda",
  heading: "Hadiah kecil untuk haiwan anda",
  body: "Selamat datang — lihat apa yang kami buat.",
  friend: "Seorang rakan menghantar anda ke sini",
  ended: "Tawaran ini telah tamat",
  noCode: "Pautan ini tiada kod label.",
  askPet: "Untuk siapa makanan ini?",
  dog: "Anjing saya",
  cat: "Kucing saya",
  thanks: "Baik — gembira bertemu anda.",
  go: "Lihat makanan",
  goHint: "Dikeringkan segar, dihantar ke seluruh negara.",
  typeCode: "Taip kod pada label anda",
  typeCodeHint: "Huruf pendek yang tercetak di sebelah petak itu.",
  codePh: "cth. K3X9",
  badCode: "Kami tidak kenal kod itu — semak huruf di sebelah petak.",
  follow: "Ikuti kami",
};

export const TASTER = { en, zh, ms };
