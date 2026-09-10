/**
 * A very small DOM helper. Not a framework: the app is a handful of screens
 * with no shared mutable state beyond the deck cache, and a framework would be
 * a toolchain to keep working for years on a box maintained by one person
 * (phase-0-plan §1.5).
 */

/**
 * el("div.card", { onclick }, children)
 *
 * The tag accepts `tag.class.class` so markup reads close to the CSS it uses.
 * Text children are escaped by construction — there is no innerHTML here, which
 * is what keeps a card's content from ever being parsed as markup.
 */
export function el(spec, props, ...children) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = [node.className, value].filter(Boolean).join(" ");
    else if (key === "style") setStyle(node, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "text") node.textContent = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }

  append(node, children);
  return node;
}

/**
 * Object.assign does not set CSS custom properties — `style["--rail"] = x` is
 * silently ignored — so they go through setProperty. Getting this wrong left
 * --rail undefined for a whole session, which quietly removed the mode's
 * colour from the station strip, the speaker and the revealed sentence.
 */
function setStyle(node, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (value === undefined || value === null) continue;
    if (prop.startsWith("--")) node.style.setProperty(prop, String(value));
    else node.style[prop] = value;
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace a container's contents in one go. */
export function render(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

/** A station dot — the circle used for lines, offers and the active tab. */
export function station(colour, size = 30, border = 5) {
  return el("span.station", {
    style: {
      width: `${size}px`,
      height: `${size}px`,
      flex: "none",
      borderRadius: "50%",
      background: "var(--night)",
      border: `${border}px solid ${colour}`,
      position: "relative",
      zIndex: "1",
    },
  });
}

/** Formats an integer the way every screen shows one. */
export const num = (n) => Number(n ?? 0).toLocaleString("en-GB");
