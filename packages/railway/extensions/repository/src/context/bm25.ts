export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

const CJK_RUN_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const TOKEN_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu;

export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
  matchedTerms: number;
  termFrequency: number;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
  limit?: number;
}

/**
 * Tokenizes Unicode words and augments CJK runs with characters and adjacent bigrams.
 * The extra CJK terms let a query such as "全文検索" match text without spaces.
 */
export function tokenize(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("und");
  const tokens: string[] = [];

  for (const match of normalized.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (!CJK_RUN_PATTERN.test(token)) {
      tokens.push(token);
      continue;
    }

    const characters = Array.from(token);
    tokens.push(token);
    tokens.push(...characters);
    for (let index = 0; index + 1 < characters.length; index++) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }

  return tokens;
}

function validateOptions(options: Bm25Options): { k1: number; b: number; limit?: number } {
  const k1 = options.k1 ?? BM25_K1;
  const b = options.b ?? BM25_B;
  const limit = options.limit;
  if (!Number.isFinite(k1) || k1 <= 0) throw new RangeError("k1 must be a positive number");
  if (!Number.isFinite(b) || b < 0 || b > 1) throw new RangeError("b must be between 0 and 1");
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError("limit must be a non-negative integer");
  }
  return { k1, b, ...(limit === undefined ? {} : { limit }) };
}

/**
 * Ranks documents with Okapi BM25. Documents with no query terms are omitted.
 */
export function rankDocuments(
  documents: readonly Bm25Document[],
  query: string,
  options: Bm25Options = {},
): Bm25Hit[] {
  const { k1, b, limit } = validateOptions(options);
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || documents.length === 0) return [];

  const indexed = documents.map((document) => {
    const tokens = tokenize(document.text);
    const termFrequency = new Map<string, number>();
    for (const token of tokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
    return { document, length: tokens.length, termFrequency };
  });

  const documentFrequency = new Map<string, number>();
  for (const item of indexed) {
    for (const term of item.termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalLength = indexed.reduce((sum, item) => sum + item.length, 0);
  const averageLength = totalLength / indexed.length || 1;
  const documentCount = indexed.length;
  const hits: Bm25Hit[] = [];

  for (const item of indexed) {
    let score = 0;
    let matchedTerms = 0;
    let termFrequency = 0;

    for (const term of queryTerms) {
      const frequency = item.termFrequency.get(term) ?? 0;
      if (frequency === 0) continue;
      matchedTerms++;
      termFrequency += frequency;
      const frequencyInDocuments = documentFrequency.get(term) ?? 0;
      const idf = Math.log1p(
        (documentCount - frequencyInDocuments + 0.5) / (frequencyInDocuments + 0.5),
      );
      const normalization = k1 * (1 - b + b * (item.length / averageLength));
      score += idf * ((frequency * (k1 + 1)) / (frequency + normalization));
    }

    if (matchedTerms > 0) {
      hits.push({ id: item.document.id, score, matchedTerms, termFrequency });
    }
  }

  hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return limit === undefined ? hits : hits.slice(0, limit);
}
