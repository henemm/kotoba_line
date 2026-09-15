/**
 * The practice modes, as metro lines. One colour each, and the colours belong
 * to the modes alone — nothing else in the app uses them.
 *
 * 書く is the fifth (#97), after design/ drew four. It sits beside 話す
 * because the two ask the same thing — the Japanese for an English meaning —
 * one aloud and one typed.
 */
export const MODES = [
  // `en` is the name in her interface language — German since Henning,
  // 2026-09-15. The key kept its old name; it is read in many places.
  { key: "choose", jp: "選ぶ", en: "Bedeutung wählen", colour: "var(--line-choose)" },
  { key: "listen", jp: "聞く", en: "Nur hören", colour: "var(--line-listen)" },
  { key: "speak", jp: "話す", en: "Laut sagen", colour: "var(--line-speak)" },
  { key: "type", jp: "書く", en: "Japanisch tippen", colour: "var(--line-type)" },
  { key: "flip", jp: "めくる", en: "Karte umdrehen", colour: "var(--line-flip)" },
];

export const modeByKey = (key) => MODES.find((m) => m.key === key);
