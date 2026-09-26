/**
 * compare.service.js
 *
 * UPDATED: now uses hybrid retrieval (dense + sparse, fused via RRF)
 * + cross-encoder rerank, instead of dense-only + rerank. This isn't
 * a guess -- it's the exact configuration the eval framework proved
 * best on real data:
 *
 *   Dense + rerank:        recall@1 0.74, recall@10 0.82
 *   Hybrid + rerank:       recall@1 0.88, recall@10 0.98
 *
 * Pipeline, step by step:
 *
 *   1. Chunk + embed the submitted text (Python /prepare -- NOT
 *      /ingest, since a comparison shouldn't permanently add the
 *      submission to the searchable corpus)
 *   2. Batch-search FAISS (dense) using those embeddings directly
 *   3. Sparse-search MongoDB's text index on the same chunk text
 *   4. Fuse dense + sparse rankings per chunk via Reciprocal Rank
 *      Fusion -- comparing rank position, not raw score, since dense
 *      cosine similarity and sparse TF-IDF scores aren't on
 *      comparable scales
 *   5. Rerank hybrid's top candidates with the cross-encoder, using
 *      each candidate's ACTUAL best-matching chunk text (not an
 *      arbitrary chunk belonging to that paper -- reranking the wrong
 *      chunk was a real, measured bug during eval development; see
 *      the eval script's history for the full story)
 *   6. Pull cached citation counts for the matched papers
 *   7. Combine semantic similarity + rerank score + graph novelty into
 *      one weighted score per submitted chunk, then an overall result
 *
 * NOTE ON WEIGHTS: same caveat as everywhere else in this project --
 * the weights below are a reasonable starting point, not validated
 * against labeled data. Say so wherever this score is presented.
 *
 * KNOWN GAP: sourceType for sparse-originated matches defaults to
 * "paper" below, since the Chunk model doesn't store it (only FAISS's
 * id-mapping does, and sparse search never touches FAISS). Harmless
 * right now since the corpus is 100% papers -- add a sourceType field
 * to the Chunk model when patent ingestion is built, so this stops
 * being an assumption.
 */

import Chunk from "../models/chunk.js";
import Paper from "../models/paper.js";
import { computeGraphNoveltyScore } from "./graphNovelty.service.js";
import { sparseSearchDocuments } from "./sparseSearch.service.js";
import { reciprocalRankFusion } from "./hybridRetrieval.service.js";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

const WEIGHTS = {
    semantic: 0.35,
    technical: 0.40,
    graph: 0.25
};

const CANDIDATES_PER_CHUNK = 20; // how many each of dense/sparse fetch, before fusion
const HYBRID_TOP_N_FOR_RERANK = 15; // how many fused candidates get reranked
const RERANK_TOP_N = 5; // how many survive reranking, shown in the final result

/**
 * Plain cosine similarity -- kept self-contained here rather than
 * importing from a shared util, deliberately, after several import-
 * mismatch issues this session (pdf-parse, etc.). One small pure
 * function costs nothing to duplicate and removes a whole class of
 * risk.
 */
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * When a chunk's TOP match was found only via sparse search (no dense
 * score exists -- similarity is null, meaning "never measured," not
 * "measured as zero"), this measures it for real instead of letting
 * the scoring formula silently treat "unknown" as "confirmed
 * dissimilar." Only called for the single top match, only when needed
 * -- one small extra embedding call, not a change to the whole pipeline.
 */
async function backfillSimilarityIfMissing(match, chunkEmbedding) {
    if (match.similarity !== null && match.similarity !== undefined) return match.similarity;

    const embedResult = await callMlService("/embed", { texts: [match.matchedText] });
    const matchEmbedding = embedResult.embeddings[0];
    return cosineSimilarity(chunkEmbedding, matchEmbedding);
}

async function callMlService(path, body) {
    const res = await fetch(`${ML_SERVICE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`ML service ${path} returned ${res.status}: ${errText}`);
    }

    return res.json();
}

/**
 * Resolves one submitted chunk's raw dense FAISS results into a
 * ranked, deduped documentId list, plus per-document metadata (the
 * SPECIFIC chunk that earned it the rank, its similarity score, and
 * source type) -- needed both for RRF fusion and for correct reranking.
 */
async function resolveDenseCandidates(rawResults, chunkDocsById) {
    const seen = new Set();
    const ranking = [];
    const metaByDoc = new Map();

    for (const r of rawResults) {
        const doc = chunkDocsById.get(r.mongo_id);
        if (!doc) continue;
        const docId = doc.documentId.toString();
        if (seen.has(docId)) continue; // first-seen = best-scoring, since rawResults is rank-sorted
        seen.add(docId);
        ranking.push(docId);
        metaByDoc.set(docId, {
            chunkId: r.mongo_id,
            text: doc.text,
            similarity: r.score,
            sourceType: r.source_type
        });
    }

    return { ranking, metaByDoc };
}

/**
 * @param {string} text - the submitted abstract/document text
 * @param {object} [options]
 * @param {string} [options.sourceTypeFilter] - restrict matches to 'paper' or 'patent' (omit for both)
 * @returns {Promise<object>} full comparison result
 */
export async function compareDocument(text, options = {}) {
    // 1. Chunk + embed (no indexing)
    const prepared = await callMlService("/prepare", { text });
    const chunks = prepared.chunks; // [{text, embedding}]

    if (chunks.length === 0) {
        throw new Error("Submitted text produced no usable chunks -- check it isn't empty or too short.");
    }

    // 2. Dense batch search for ALL submitted chunks in one call
    const denseSearchResult = await callMlService("/index/search/batch/vectors", {
        vectors: chunks.map(c => c.embedding),
        k: CANDIDATES_PER_CHUNK,
        source_type_filter: options.sourceTypeFilter ?? null
    });
    const denseCandidateLists = denseSearchResult.results; // one list per submitted chunk

    // 3. Fetch real chunk text for every dense candidate across all
    // chunks, in ONE query instead of one per candidate
    const allDenseChunkIds = [...new Set(denseCandidateLists.flat().map(c => c.mongo_id))];
    const denseChunkDocs = await Chunk.find({ _id: { $in: allDenseChunkIds } }).lean();
    const chunkDocsById = new Map(denseChunkDocs.map(c => [c._id, c]));

    // 4-6. Per submitted chunk: resolve dense, sparse-search, fuse, rerank
    const perChunkResults = [];

    for (let i = 0; i < chunks.length; i++) {
        const { ranking: denseRanking, metaByDoc: denseMeta } =
            await resolveDenseCandidates(denseCandidateLists[i], chunkDocsById);

        const { ranking: sparseRanking, bestChunkText: sparseBestChunkText } =
            await sparseSearchDocuments(chunks[i].text, CANDIDATES_PER_CHUNK);

        const hybridRanking = reciprocalRankFusion([denseRanking, sparseRanking]);
        const topDocIds = hybridRanking.slice(0, HYBRID_TOP_N_FOR_RERANK);

        if (topDocIds.length === 0) {
            perChunkResults.push({
                submittedChunk: chunks[i].text,
                topMatches: [],
                bestSimilarity: 0,
                bestRerankScore: 0
            });
            continue;
        }

        // Build rerank candidates using each doc's ACTUAL best chunk --
        // dense's best chunk if the doc came from dense results, else
        // sparse's best chunk text. This is the fix that matters -- an
        // arbitrary/wrong chunk here silently breaks reranking quality.
        const rerankCandidates = topDocIds
            .map(docId => {
                const denseInfo = denseMeta.get(docId);
                const text = denseInfo?.text ?? sparseBestChunkText.get(docId);
                return text ? { mongo_id: docId, text } : null;
            })
            .filter(Boolean);

        const reranked = await callMlService("/rerank", {
            query: chunks[i].text,
            candidates: rerankCandidates,
            top_n: RERANK_TOP_N
        });

        const topMatches = reranked.results.map(r => {
            const denseInfo = denseMeta.get(r.mongo_id);
            return {
                documentId: r.mongo_id, // already a documentId, not a chunk id, post-hybrid-fusion
                matchedText: r.text,
                similarity: denseInfo?.similarity ?? null, // null = found via sparse only, no dense score exists
                rerankScore: r.rerank_score,
                sourceType: denseInfo?.sourceType ?? "paper" // see KNOWN GAP note at top of file
            };
        });

        if (topMatches.length > 0) {
            topMatches[0].similarity = await backfillSimilarityIfMissing(topMatches[0], chunks[i].embedding);
        }

        perChunkResults.push({
            submittedChunk: chunks[i].text,
            topMatches,
            bestSimilarity: topMatches[0]?.similarity ?? 0,
            bestRerankScore: topMatches[0]?.rerankScore ?? 0
        });
    }

    // 6. Pull cached citation data for every matched paper
    const matchedDocumentIds = [...new Set(
        perChunkResults.flatMap(r => r.topMatches.map(m => m.documentId)).filter(Boolean)
    )];
    const matchedPapers = await Paper.find(
        { _id: { $in: matchedDocumentIds } },
        { citationCount: 1, title: 1, arxivId: 1 }
    ).lean();
    const paperById = new Map(matchedPapers.map(p => [p._id.toString(), p]));

    // 7. Combine into a score per chunk, then an overall result
    const scoredChunks = perChunkResults.map(r => {
        const topPapers = r.topMatches
            .map(m => paperById.get(m.documentId))
            .filter(Boolean);

        const graphNovelty = computeGraphNoveltyScore(topPapers);
        const technicalRelevance = r.bestRerankScore; // already sigmoid-normalized at the source

        const noveltyScore =
            WEIGHTS.semantic * (1 - (r.bestSimilarity ?? 0)) +
            WEIGHTS.technical * (1 - technicalRelevance) +
            WEIGHTS.graph * graphNovelty;

        return {
            submittedChunk: r.submittedChunk,
            noveltyScore: Number(noveltyScore.toFixed(4)),
            bestSimilarity: r.bestSimilarity,
            technicalRelevance,
            graphNovelty,
            topMatches: r.topMatches.map(m => ({
                paperTitle: paperById.get(m.documentId)?.title ?? null,
                arxivId: paperById.get(m.documentId)?.arxivId ?? null,
                matchedText: m.matchedText,
                similarity: m.similarity,
                rerankScore: m.rerankScore,
                sourceType: m.sourceType
            }))
        };
    });

    const overallNovelty = scoredChunks.length > 0
        ? scoredChunks.reduce((sum, c) => sum + c.noveltyScore, 0) / scoredChunks.length
        : 0;

    return {
        overallNoveltyScore: Number(overallNovelty.toFixed(4)),
        chunkCount: scoredChunks.length,
        chunks: scoredChunks
    };
}
