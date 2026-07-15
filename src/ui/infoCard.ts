/** The inspector's card: one plain DOM panel, top-right, below the date
 * HUD. Esc or click-away closes; showing replaces. */
import type { InfoCard } from './inspect';

/** Plain-language glosses for the technical terms the cards use — the cards
 * keep hornvale's own vocabulary (obliquity, sidereal, …) and explain it in
 * place via native <abbr title> tooltips rather than dumbing the words down.
 * First pattern to match wins at each position; patterns are word-bounded so
 * "AU" never fires inside a name. */
const GLOSSARY: [RegExp, string][] = [
  [/\bobliquity\b/, 'the tilt of the world’s spin axis off its orbital plane — what makes seasons'],
  [/\bsidereal period\b/, 'time for one orbit measured against the fixed stars (not sun-to-sun)'],
  [/\bsynodic month\b/, 'the sun-relative cycle: one full moon to the next'],
  [/\bhabitable zone\b/, 'the band of orbits where liquid surface water can persist'],
  [/\btidally locked\b/, 'one face turned starward forever — the world spins exactly once per orbit, so it has no day–night cycle'],
  [/\bluminosity\b/, 'total light output, relative to Sol'],
  [/\billuminated\b/, 'how much of the disc is currently lit, seen from the world'],
  [/\bAU\b/, 'astronomical unit: the Earth–Sun distance'],
  [/\bMm\b/, 'megameter: 1,000 km'],
];

/** Append `line` to `el`, wrapping each glossary term in an <abbr> whose
 * title carries the gloss; text outside terms lands as plain text nodes. */
function renderGlossedLine(el: HTMLElement, line: string): void {
  let rest = line;
  while (rest.length > 0) {
    let earliest: { index: number; text: string; gloss: string } | null = null;
    for (const [pattern, gloss] of GLOSSARY) {
      const m = pattern.exec(rest);
      if (m && (earliest === null || m.index < earliest.index)) {
        earliest = { index: m.index, text: m[0], gloss };
      }
    }
    if (!earliest) {
      el.append(rest);
      return;
    }
    if (earliest.index > 0) el.append(rest.slice(0, earliest.index));
    const abbr = document.createElement('abbr');
    abbr.textContent = earliest.text;
    abbr.title = earliest.gloss;
    el.append(abbr);
    rest = rest.slice(earliest.index + earliest.text.length);
  }
}

export function mountInfoCard(root: HTMLElement): { show(c: InfoCard): void; hide(): void } {
  const card = document.createElement('div');
  card.className = 'info-card';
  card.style.display = 'none';
  root.append(card);
  function hide(): void { card.style.display = 'none'; }
  function show(c: InfoCard): void {
    card.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = c.title;
    const kind = document.createElement('p');
    kind.className = 'info-kind';
    kind.textContent = c.kindLine;
    card.append(title, kind);
    for (const line of c.lines) {
      const p = document.createElement('p');
      renderGlossedLine(p, line);
      card.append(p);
    }
    card.style.display = '';
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  card.addEventListener('pointerdown', (e) => e.stopPropagation()); // clicking the card is not click-away
  return { show, hide };
}
