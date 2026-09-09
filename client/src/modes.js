/**
 * The four practice modes, as four metro lines. One colour each, and the
 * colours belong to the modes alone — nothing else in the app uses them.
 */
export const MODES = [
  { key: "choose", jp: "選ぶ", en: "Pick the meaning", colour: "var(--line-choose)" },
  { key: "listen", jp: "聞く", en: "Listen only", colour: "var(--line-listen)" },
  { key: "speak", jp: "話す", en: "Say it aloud", colour: "var(--line-speak)" },
  { key: "flip", jp: "めくる", en: "Flip the card", colour: "var(--line-flip)" },
];

export const modeByKey = (key) => MODES.find((m) => m.key === key);
