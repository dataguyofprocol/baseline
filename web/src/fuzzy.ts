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

/**
 * Score a single term against a single string. Higher is better; null when
 * not every character of the term appears in order. Rough scale: substring
 * matches land in the 600+ range, boundary-anchored subsequences 50-300,
 * scattered matches can drop below 0.
 */
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

  // Try each occurrence of the first character as an anchor — boundary
  // occurrences first — and keep the best greedy completion. Anchoring on
  // "scoring" beats anchoring on the "s" of "reset" for the query "sc".
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
  /** Match indices into item.label, for highlighting; null when the match relied on keywords. */
  match: FuzzyMatch | null;
}

/**
 * Whitespace-split multi-term match, Linear-style: every term must match
 * somewhere (order-independent), terms are scored independently. Label hits
 * outrank keyword-only hits and carry highlight indices. Terms matching
 * poorly (deep-scattered subsequence junk) are rejected outright.
 */
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
    if (lm && lm.score > 15) {
      total += lm.score;
      labelIndices.push(...lm.indices);
      continue;
    }
    allInLabel = false;
    const m = fuzzyMatch(term, haystack);
    // Keyword-only hits need a strong match: for issues the keywords mirror
    // the title, so a weak keyword match is scattered-junk noise.
    if (!m || m.score <= 200) return null;
    total += m.score - 150;
  }
  return {
    item,
    score: total,
    match: allInLabel ? { score: total, indices: [...new Set(labelIndices)].sort((a, b) => a - b) } : null,
  };
}
