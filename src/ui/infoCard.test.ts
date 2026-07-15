import { describe, expect, it } from 'vitest';
import { mountInfoCard } from './infoCard';

describe('info card glossary', () => {
  it('wraps technical terms in <abbr> carrying a plain-language tooltip', () => {
    const root = document.createElement('div');
    const card = mountInfoCard(root);
    card.show({
      title: 'the world',
      kindLine: 'world',
      lines: ['obliquity 21.8°', 'orbit 0.972 AU · year 368.1 d'],
    });
    const abbrs = [...root.querySelectorAll('abbr')];
    const terms = abbrs.map((a) => a.textContent);
    expect(terms).toContain('obliquity');
    expect(terms).toContain('AU');
    for (const a of abbrs) expect(a.title.length).toBeGreaterThan(0);
    // The visible text is unchanged by the wrapping.
    const lines = [...root.querySelectorAll('.info-card p')].map((p) => p.textContent);
    expect(lines).toContain('obliquity 21.8°');
    expect(lines).toContain('orbit 0.972 AU · year 368.1 d');
  });
  it('leaves lines without glossary terms as plain text', () => {
    const root = document.createElement('div');
    const card = mountInfoCard(root);
    card.show({ title: 'Daoqao', kindLine: 'settlement', lines: ['9.5°N 65.4°E'] });
    expect(root.querySelectorAll('abbr').length).toBe(0);
  });
});
