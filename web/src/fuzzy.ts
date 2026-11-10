export interface FuzzyMatch {
  score: number;
  indices: number[];
}

const BOUNDARY_PRECEDERS = new Set(' \t-_/.,:;()[]{}@#\'"');

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (BOUNDARY_PRECEDERS.has(prev)) return true;
  return prev >= 'a' && prev <= 'z' && text[i] >= 'A' && text[i] <= 'Z';
}

function contiguous(start: number, len: number): number[] {
  return Array.from({ length: len }, (_, k) => start + k);
}

export function fuzzyMatch(term: string, text: string): FuzzyMatch | null {
  const q = term.toLowerCase();
  if (!q) return null;
  const t = text.toLowerCase();

  const sub = t.indexOf(q);
  if (sub !== -1) {
    let score = 600 + q.length * 4;
    if (q === t) score += 400;
    else if (sub === 0) score += 300;
    else if (isBoundary(text, sub)) score += 200;
    score -= Math.min(sub, 60);
    return { score, indices: contiguous(sub, q.length) };
  }

  const anchors: number[] = [];
  for (let i = t.indexOf(q[0]); i !== -1; i = t.indexOf(q[0], i + 1)) {
    anchors.push(i);
    if (anchors.length >= 12) break;
  }
  anchors.sort((a, b) => (isBoundary(text, b) ? 1 : 0) - (isBoundary(text, a) ? 1 : 0));

  let best: FuzzyMatch | null = null;
  for (const anchor of anchors) {
    const indices = [anchor];
    let score = 10 + (isBoundary(text, anchor) ? 20 : 0);
    let prev = anchor;
    let failed = false;
    for (let qi = 1; qi < q.length; qi++) {
      const idx = t.indexOf(q[qi], prev + 1);
      if (idx === -1) { failed = true; break; }
      if (idx !== prev + 1 && !isBoundary(text, idx) && [...text.slice(prev + 1, idx)].some(ch => BOUNDARY_PRECEDERS.has(ch))) {
        failed = true; break;
      }
      score += 6;
      if (idx === prev + 1) score += 16;
      else score -= Math.min(idx - prev - 1, 10);
      if (isBoundary(text, idx)) score += 12;
      indices.push(idx);
      prev = idx;
    }
    if (failed) continue;
    score -= Math.floor(anchor / 8);
    if (!best || score > best.score) best = { score, indices };
  }
  return best;
}

export interface ScoredItem<T> {
  item: T;
  score: number;
  match: FuzzyMatch | null;
}

export function scoreItem<T extends { label: string; keywords?: string }>(
  query: string,
  item: T,
): ScoredItem<T> | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const haystack = item.label + ' ' + (item.keywords ?? '');
  let total = 0;
  const labelIndices: number[] = [];
  let allInLabel = true;
  for (const term of terms) {
    const lm = fuzzyMatch(term, item.label);
    if (lm && lm.score > 15 + term.length * 6) {
      total += lm.score;
      labelIndices.push(...lm.indices);
      continue;
    }
    allInLabel = false;
    const m = fuzzyMatch(term, haystack);
    if (!m || m.score <= 200) return null;
    total += m.score - 150;
  }
  return {
    item,
    score: total,
    match: allInLabel ? { score: total, indices: [...new Set(labelIndices)].sort((a, b) => a - b) } : null,
  };
}
