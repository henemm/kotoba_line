/**
 * The practice modes, as metro lines. One colour each, and the colours belong
 * to the modes alone — nothing else in the app uses them.
 *
 * 書く is the fifth (#97), after design/ drew four. It sits beside 話す
 * because the two ask the same thing — the Japanese for an English meaning —
 * one aloud and one typed.
 */
export const MODES = [
  { key: "choose", jp: "選ぶ", en: "Pick the meaning", colour: "var(--line-choose)" },
  { key: "listen", jp: "聞く", en: "Listen only", colour: "var(--line-listen)" },
  { key: "speak", jp: "話す", en: "Say it aloud", colour: "var(--line-speak)" },
  { key: "type", jp: "書く", en: "Type the Japanese", colour: "var(--line-type)" },
  { key: "flip", jp: "めくる", en: "Flip the card", colour: "var(--line-flip)" },
];

export const modeByKey = (key) => MODES.find((m) => m.key === key);
