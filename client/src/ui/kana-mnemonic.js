import { mediaUrl } from "../audio.js";
import { el, render } from "./dom.js";

/**
 * A kana card's picture and its hook (#177, v88), as `npm run import-kana`
 * stored them: `{ file, hook }`, or null where the card has none — every card
 * but the 46 basic kana of each script. Unreadable is none, never an error on
 * a card.
 *
 * Here rather than in session.js since #208: the kana deck's own page shows
 * the same picture, and a sheet should not import a screen to get it — the
 * reason sound.js is its own module too.
 */
export function kanaMnemonic(card) {
  if (!card?.word_mnemonic) return null;
  try {
    const picture = JSON.parse(card.word_mnemonic);
    // The hook is optional: ク has a drawing and deliberately no words
    // (import/lib/kana-mnemonics.js).
    return picture?.file ? picture : null;
  } catch {
    return null;
  }
}

/**
 * The picture that holds a kana's shape (#177, v88): B. Domangue's drawing
 * with the kana laid over it, and her hook under it, from the import
 * (`import/lib/kana-mnemonics.js`). Only the 46 basic kana of each script
 * have one; dakuten and yōon show nothing rather than a borrowed picture.
 *
 * On a card's answer it is always there, not only while the card is new.
 * Henning (2026-09-16): "sie stören ja auch nicht", and a picture that comes
 * and goes on its own is one more thing to work out. A file missing or not yet
 * cached takes the block away, as the stroke order does, rather than leaving a
 * broken image.
 *
 * `className` adds to the block's own: the session passes "reveal" so it
 * fades in with the rest of the answer.
 */
export function kanaMnemonicBlock(card, { className } = {}) {
  const picture = kanaMnemonic(card);
  if (!picture) return null;
  const block = el(className ? `div.kana-mnemonic.${className}` : "div.kana-mnemonic");
  const hide = () => block.remove();
  // Henning, 2026-09-16: the picture is small on the card, and at 132 × 84 a
  // drawing like ぬ's noodles is hard to make out. Tapping it opens it as big
  // as the screen allows; tapping again, or Escape, closes it. A button
  // rather than an image with a handler, so it can be reached and told apart
  // without sight.
  const zoom = () => {
    const close = () => {
      sheet.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const sheet = el(
      "div.mnemonic-zoom",
      { role: "dialog", "aria-label": `Merkbild für ${card.word}`, onclick: close },
      el("img", { src: mediaUrl(picture.file), alt: "" }),
      picture.hook ? el("span.mnemonic-zoom-hook", { text: picture.hook }) : null,
      el("span.mnemonic-zoom-close", { text: "Tippen zum Schließen" }),
    );
    document.addEventListener("keydown", onKey);
    document.body.append(sheet);
  };
  render(
    block,
    el(
      "button.kana-mnemonic-open",
      { type: "button", "aria-label": "Merkbild größer zeigen", onclick: zoom },
      el("img.kana-mnemonic-picture", { src: mediaUrl(picture.file), alt: "", onerror: hide }),
    ),
    picture.hook ? el("span.kana-mnemonic-hook", { text: picture.hook }) : null,
    // CC BY-SA 4.0 asks for the attribution wherever the drawing is shown.
    el("span.kana-credit", { text: "Merkbild: B. Domangue (CC BY-SA 4.0)" }),
  );
  return block;
}
