/**
 * hybridRetrieval.service.js
 *
 * Reciprocal Rank Fusion (RRF): combines multiple already-ranked lists
 * into one fused ranking. The key idea, worth being precise about: it
 * uses each item's RANK POSITION in each list, not its raw score.
 * That matters because dense cosine similarity (roughly 0-1) and
 * MongoDB's text-search score (an unbounded TF-IDF-style number) live
 * on completely different, incomparable scales -- there's no honest
 * way to average "0.7 similarity" with "4.2 text score" directly. RRF
 * sidesteps the problem entirely by only asking "how highly did each
 * method rank this document," which is always comparable regardless
 * of the underlying scoring scheme.
 *
 * RRF_K = 60 is the standard constant from the original RRF paper
 * (Cormack et al.) and what most production systems (e.g.
 * Elasticsearch's built-in RRF) default to -- not tuned for this
 * project specifically, a reasonable, well-established starting point.
 */

const RRF_K = 60;

/**
 * @param {string[][]} rankedLists - e.g. [denseRanking, sparseRanking],
 *   each an array of documentIds, already ranked best-first, deduped
 * @returns {string[]} fused documentId ranking, best first
 */
export function reciprocalRankFusion(rankedLists) {
    const scores = new Map();

    for (const list of rankedLists) {
        list.forEach((docId, index) => {
            const rank = index + 1; // RRF is defined on 1-indexed rank
            const contribution = 1 / (RRF_K + rank);
            scores.set(docId, (scores.get(docId) || 0) + contribution);
        });
    }

    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([docId]) => docId);
}
