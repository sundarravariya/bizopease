/**
 * Build an Odoo domain requiring ALL words to appear in the field (AND semantics).
 * Single-word queries fall back to a plain ilike.
 */
export function fuzzyOdooDomain(field: string, q: string): any[] {
  const words = q.trim().split(/\s+/).filter(w => w.length >= 2);
  if (words.length <= 1) return [[field, 'ilike', q]];
  // N words need N-1 AND operators (Odoo prefix domain notation)
  const andOps = Array(words.length - 1).fill('&');
  const clauses = words.map(w => [field, 'ilike', w]);
  return [...andOps, ...clauses];
}

/**
 * Score how well `name` matches `query`.
 *
 * Ranking (per query word, averaged):
 *   400  exact full-name match
 *   300  query word is an exact token in the name  ("100" → token "100")
 *   150  name token starts with the query word     ("100" → token "100w")
 *    80  query word is a substring inside a token  ("100" → inside "m1000")
 *     0  query word not found anywhere → no match (whole item excluded)
 *
 * This prevents "UPS 1000VA" from outranking "Samsung 100" when searching "100"
 * (both score 150 as prefix matches; only the exact-token form scores 300).
 */
export function fuzzyScore(name: any, query: any): number {
  const n = (typeof name === 'string' ? name : String(name || '')).toLowerCase();
  const q = (typeof query === 'string' ? query : String(query || '')).toLowerCase().trim();
  if (!q || !n) return 0;

  if (n === q) return 400;

  const nWords = n.split(/[\s,./\-_()[\]|+@#%]+/).filter(Boolean);
  const qWords = q.split(/\s+/).filter(Boolean);
  if (!qWords.length) return 0;

  let totalScore = 0;
  for (const qw of qWords) {
    if (nWords.includes(qw)) {
      totalScore += 300;                                   // exact token
    } else if (nWords.some(nw => nw.startsWith(qw))) {
      totalScore += 150;                                   // token prefix
    } else if (n.includes(qw)) {
      totalScore += 80;                                    // buried substring
    } else {
      return 0;                                            // word absent → exclude
    }
  }

  return Math.round(totalScore / qWords.length);
}

/**
 * Sort an array of named items by match quality. Zero-score items are removed.
 */
export function sortByFuzzy<T extends { name: any }>(items: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return items;
  return items
    .map(item => ({ item, score: fuzzyScore(item.name || '', q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.item);
}
