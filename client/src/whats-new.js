/**
 * What changed between two shells (#93). Pure, so it is tested without a DOM.
 *
 * Shell versions are `vN` and nothing else — `sw.js` names its cache after
 * one, and CI refuses a client change that does not move it — so "everything
 * she skipped" is a comparison of integers, not of dates or strings.
 */

/** "v36" → 36. Anything else is NaN, which compares false with every number. */
export function versionNumber(version) {
  const match = /^v(\d+)$/.exec(String(version ?? ""));
  return match ? Number(match[1]) : NaN;
}

/**
 * The changelog entries newer than `from` and no newer than `to`, newest
 * first.
 *
 * Every version in between, not only the last: pressing "Later" three times
 * and then updating is exactly the case where the last entry alone would
 * describe a fraction of what arrived.
 */
export function notesSince(changelog, from, to) {
  const lo = versionNumber(from);
  const hi = versionNumber(to);
  if (!Array.isArray(changelog) || Number.isNaN(lo) || Number.isNaN(hi)) return [];
  return changelog
    .filter((entry) => {
      const n = versionNumber(entry?.version);
      return n > lo && n <= hi;
    })
    .sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
}

/** Past this many summaries the sheet stops listing and counts (#114). */
export const SUMMARIES_SHOWN = 4;

/**
 * What the sheet says above "More info" (#114).
 *
 * One entry: its summary, as before. Several: every summary, newest first —
 * the newest one alone used to stand for all of them, so a phone updating
 * from v42 to v45 read about a fix to three buttons and not about the tab bar
 * that had changed shape two versions earlier. Past `SUMMARIES_SHOWN` the rest
 * are counted rather than listed, because a sheet that scrolls before it
 * reaches "Update" is not a sheet any more; every one is still under "More
 * info".
 */
export function sheetSummary(entries) {
  const summaries = (entries ?? []).map((entry) => entry?.summary).filter(Boolean);
  if (summaries.length <= 1) return { text: summaries[0], items: [], more: 0 };
  const items = summaries.slice(0, SUMMARIES_SHOWN);
  return { text: `${summaries.length} updates in one:`, items, more: summaries.length - items.length };
}

/**
 * Which shell to count from when this device has never recorded one.
 *
 * A device that already has a deck was running the app before the record
 * existed — her phone, on the first shell that keeps it — so it is told what
 * this version brought. A device with no deck has just installed the app, and
 * a list of changes to an app she has never seen would be noise.
 */
export function startingPoint({ seen, running, hasDeck }) {
  if (!Number.isNaN(versionNumber(seen))) return seen;
  if (!hasDeck) return running;
  return `v${versionNumber(running) - 1}`;
}
