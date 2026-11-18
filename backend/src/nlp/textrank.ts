import type { SparseVector } from './tfidf.js';

export interface Graph {
  /** neighbours[i] lists the nodes connected to node i. */
  neighbours: number[][];
  /** weights[i][k] is the weight of the edge from i to neighbours[i][k]. */
  weights: number[][];
}

interface PageRankOptions {
  damping?: number;
  maxIterations?: number;
  tolerance?: number;
}

/**
 * Weighted PageRank by power iteration over an undirected graph. Returns one
 * score per node, scaled so the highest score is 1.
 */
export function pageRank(graph: Graph, options: PageRankOptions = {}): number[] {
  const { damping = 0.85, maxIterations = 60, tolerance = 1e-6 } = options;
  const size = graph.neighbours.length;
  if (size === 0) return [];

  const strength = graph.weights.map((row) => row.reduce((sum, weight) => sum + weight, 0));
  let scores = new Float64Array(size).fill(1 / size);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const next = new Float64Array(size).fill((1 - damping) / size);
    for (let node = 0; node < size; node++) {
      if (strength[node] === 0) continue;
      const share = (damping * scores[node]) / strength[node];
      const neighbours = graph.neighbours[node];
      const weights = graph.weights[node];
      for (let k = 0; k < neighbours.length; k++) next[neighbours[k]] += share * weights[k];
    }
    let change = 0;
    for (let node = 0; node < size; node++) change += Math.abs(next[node] - scores[node]);
    scores = next;
    if (change < tolerance * size) break;
  }

  let max = 0;
  for (const score of scores) if (score > max) max = score;
  return Array.from(scores, (score) => (max > 0 ? score / max : 0));
}

interface SimilarityGraphOptions {
  /** Edges weaker than this cosine similarity are dropped as noise. */
  threshold?: number;
}

/**
 * Build the sentence-similarity graph used by TextRank: nodes are sentences
 * and edge weights are the cosine similarity of their TF-IDF vectors.
 *
 * An inverted index means only sentence pairs that share a term are ever
 * compared, which keeps long transcripts fast. For very long transcripts,
 * terms that occur in a large share of sentences are skipped when pairing:
 * they carry little weight and would otherwise make the graph nearly complete.
 */
export function buildSimilarityGraph(vectors: SparseVector[], options: SimilarityGraphOptions = {}): Graph {
  const { threshold = 0.04 } = options;
  const size = vectors.length;
  const neighbours: number[][] = Array.from({ length: size }, () => []);
  const weights: number[][] = Array.from({ length: size }, () => []);

  const postings = new Map<string, { doc: number; weight: number }[]>();
  vectors.forEach((vector, doc) => {
    for (const [term, weight] of vector) {
      let list = postings.get(term);
      if (!list) postings.set(term, (list = []));
      list.push({ doc, weight });
    }
  });

  const maxPostings = size > 2000 ? Math.max(60, Math.floor(size * 0.2)) : Infinity;
  const seenPerTerm = new Map<string, number>();
  const dot = new Float64Array(size);
  const touched: number[] = [];

  for (let doc = 0; doc < size; doc++) {
    for (const [term, weight] of vectors[doc]) {
      const list = postings.get(term)!;
      // Postings are in document order, so entries after this one are later sentences.
      const position = seenPerTerm.get(term) ?? 0;
      seenPerTerm.set(term, position + 1);
      if (list.length > maxPostings) continue;
      for (let k = position + 1; k < list.length; k++) {
        const other = list[k];
        if (dot[other.doc] === 0) touched.push(other.doc);
        dot[other.doc] += weight * other.weight;
      }
    }
    for (const other of touched) {
      const similarity = dot[other];
      dot[other] = 0;
      if (similarity < threshold) continue;
      neighbours[doc].push(other);
      weights[doc].push(similarity);
      neighbours[other].push(doc);
      weights[other].push(similarity);
    }
    touched.length = 0;
  }

  return { neighbours, weights };
}

/** TextRank: centrality of each sentence in the similarity graph, scaled to a maximum of 1. */
export function textRank(vectors: SparseVector[]): number[] {
  return pageRank(buildSimilarityGraph(vectors));
}
