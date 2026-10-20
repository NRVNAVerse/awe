/**
 * Visitor-facing destination description (M4). Canonical descriptions still begin with an
 * engineering milestone marker ("M0 placeholder." / "M0 placeholder artist …"); the world removes it
 * for DISPLAY ONLY, with exactly the WEB's rule (`presentDescription` in NRVNAVerse/web
 * `src/lib/destinations/model.ts`), so both surfaces read the same. The manifest text is untouched
 * and unfinished places are still labelled honestly through `placeholder` / `preview`.
 */
export function presentDescription(text: string): string {
  const stripped = text.replace(/^M\d+ placeholder\.\s*/, "").replace(/^M\d+ (?=placeholder\b)/, "");
  const out = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return out.trim();
}
