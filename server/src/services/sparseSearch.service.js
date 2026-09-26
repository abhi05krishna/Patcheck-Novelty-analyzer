import Chunk from "../models/chunk.js";

/**
 * sparseSearch.service.js
 *
 * Sparse (keyword-based) retrieval using MongoDB's built-in text index
 * -- TF-IDF-style scoring on Chunk.text. This is the "sparse" half of
 * hybrid retrieval: it catches exact terminology, acronyms, and jargon
 * matches that dense embeddings can sometimes miss (dense similarity
 * cares about MEANING, sparse cares about exact TERM overlap -- they
 * fail in different, complementary ways).
 *
 * Deliberately doesn't touch the Python ML service at all -- this is
 * pure MongoDB, consistent with the project's existing split (Python
 * only for things that genuinely need a model; this doesn't).
 *
 * PREREQUISITE: run scripts/createTextIndex.js once before this works.
 */

/**
 * @param {string} queryText
 * @param {number} k - how many distinct PAPERS to return (not chunks)
 * @returns {Promise<{ranking: string[], bestChunkText: Map<string,string>}>}
 *   ranking: deduped documentId list, best first
 *   bestChunkText: each document's TOP-SCORING chunk's text -- the
 *   specific chunk that earned it its rank, not an arbitrary one.
 *   (Needed by hybrid+rerank: reranking a random chunk instead of the
 *   one that actually matched was a real bug -- see hybridRetrieval
 *   usage in runRetrievalEval.js for the full explanation.)
 */
export async function sparseSearchDocuments(queryText, k = 20) {
    let results;
    try {
        results = await Chunk.find(
            { $text: { $search: queryText } },
            { score: { $meta: "textScore" }, documentId: 1, text: 1 }
        )
            .sort({ score: { $meta: "textScore" } })
            .limit(k * 3) // over-fetch chunks -- several will dedupe down to the same paper
            .lean();
    } catch (err) {
        if (err.message.includes("text index required")) {
            throw new Error("No text index on Chunk.text -- run: node src/scripts/createTextIndex.js");
        }
        throw err;
    }

    const seen = new Set();
    const ranking = [];
    const bestChunkText = new Map();

    for (const r of results) {
        const docId = r.documentId.toString();
        if (seen.has(docId)) continue; // first occurrence per doc = its top-scoring chunk, since results are already sorted
        seen.add(docId);
        ranking.push(docId);
        bestChunkText.set(docId, r.text);
        if (ranking.length >= k) break;
    }

    return { ranking, bestChunkText };
}
