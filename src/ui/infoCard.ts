/** The inspector's card: one plain DOM panel, top-right, below the date
 * HUD. Esc or click-away closes; showing replaces. */
import type { InfoCard } from './inspect';

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
      p.textContent = line;
      card.append(p);
    }
    card.style.display = '';
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  card.addEventListener('pointerdown', (e) => e.stopPropagation()); // clicking the card is not click-away
  return { show, hide };
}
