export type SparseVector = Map<string, number>;

export interface TfIdfModel {
  /** One L2-normalised TF-IDF vector per document. */
  vectors: SparseVector[];
  idf: Map<string, number>;
  documentFrequency: Map<string, number>;
}

/**
 * Build TF-IDF vectors for a set of documents (here: sentences), each given
 * as a list of terms. Term frequency is log-scaled and inverse document
 * frequency is smoothed, so no term gets a zero or infinite weight.
 */
export function buildTfIdf(documents: string[][]): TfIdfModel {
  const total = documents.length;
  const documentFrequency = new Map<string, number>();
  const counts: Map<string, number>[] = [];

  for (const terms of documents) {
    const tf = new Map<string, number>();
    for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
    counts.push(tf);
    for (const term of tf.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const [term, df] of documentFrequency) idf.set(term, Math.log((total + 1) / (df + 1)) + 1);

  const vectors = counts.map((tf) => {
    const vector: SparseVector = new Map();
    let squares = 0;
    for (const [term, count] of tf) {
      const weight = (1 + Math.log(count)) * idf.get(term)!;
      vector.set(term, weight);
      squares += weight * weight;
    }
    const norm = Math.sqrt(squares);
    if (norm > 0) for (const [term, weight] of vector) vector.set(term, weight / norm);
    return vector;
  });

  return { vectors, idf, documentFrequency };
}

/** Cosine similarity of two L2-normalised sparse vectors. */
export function cosine(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  return dot;
}

/** Sum a set of vectors and normalise the result to unit length. */
export function centroid(vectors: SparseVector[]): SparseVector {
  const sum: SparseVector = new Map();
  for (const vector of vectors) {
    for (const [term, weight] of vector) sum.set(term, (sum.get(term) ?? 0) + weight);
  }
  let squares = 0;
  for (const weight of sum.values()) squares += weight * weight;
  const norm = Math.sqrt(squares);
  if (norm > 0) for (const [term, weight] of sum) sum.set(term, weight / norm);
  return sum;
}
