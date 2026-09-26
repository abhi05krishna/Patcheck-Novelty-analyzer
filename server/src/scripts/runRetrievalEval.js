/**
 * runRetrievalEval.js
 *
 * Runs every pair in eval_set.json through the real retrieval pipeline
 * and reports Recall@k and MRR for THREE paths:
 *   1. Dense retrieval only
 *   2. Dense + cross-encoder rerank
 *   3. Hybrid (dense + sparse via RRF) -- NEW
 * so hybrid retrieval's actual value is measured against your
 * confirmed baseline (recall@1 0.40 dense / 0.74 reranked), not assumed.
 *
 * METHODOLOGY: each query is a short mid-abstract snippet of a real
 * paper; the correct target is that SAME paper. See buildEvalSet.js
 * for the full rationale.
 *
 * PREREQUISITE for the hybrid path: run createTextIndex.js once first.
 *
 * Usage: node src/scripts/runRetrievalEval.js
 * (run buildEvalSet.js first if data/eval_set.json doesn't exist yet)
 */

import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/config.js";
import Chunk from "../models/chunk.js";
import { sparseSearchDocuments } from "../services/sparseSearch.service.js";
import { reciprocalRankFusion } from "../services/hybridRetrieval.service.js";

dotenv.config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const EVAL_SET_PATH = "data/eval_set.json";
const OVER_FETCH_K = 50; // increased from 20 -- with ~3-4 chunks/paper on average, 20 raw chunks could dedupe down to fewer than 10 distinct papers, artificially capping recall@10. 50 gives real headroom to trust that number.
const K_VALUES = [1, 3, 5, 10];

async function callMlService(path, body) {
    const res = await fetch(`${ML_SERVICE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ML service ${path} returned ${res.status}: ${text}`);
    }
    return res.json();
}

/**
 * Resolves a ranked list of chunk-level results into an ordered,
 * DEDUPED list of documentIds, AND a map of each document's TOP
 * (first-seen, since input is already rank-sorted) chunk id -- the
 * specific chunk that earned that document its rank, not an arbitrary
 * one belonging to it.
 */
async function resolveToDocumentRanking(rawResults) {
    const chunkIds = rawResults.map(r => r.mongo_id);
    const chunks = await Chunk.find({ _id: { $in: chunkIds } }, { documentId: 1 }).lean();
    const chunkToDoc = new Map(chunks.map(c => [c._id, c.documentId.toString()]));

    const seen = new Set();
    const ranking = [];
    const bestChunkId = new Map();
    for (const r of rawResults) {
        const docId = chunkToDoc.get(r.mongo_id);
        if (!docId) continue; // unresolved chunk, skip
        if (seen.has(docId)) continue; // dedupe -- one paper can contribute several chunks
        seen.add(docId);
        ranking.push(docId);
        bestChunkId.set(docId, r.mongo_id); // first-seen = best-scoring, since rawResults is rank-sorted
    }
    return { ranking, bestChunkId };
}

function computeMetrics(rankings, expectedIds) {
    const recallAtK = {};
    for (const k of K_VALUES) {
        let hits = 0;
        for (let i = 0; i < rankings.length; i++) {
            if (rankings[i].slice(0, k).includes(expectedIds[i])) hits++;
        }
        recallAtK[`recall@${k}`] = Number((hits / rankings.length).toFixed(4));
    }

    let reciprocalSum = 0;
    for (let i = 0; i < rankings.length; i++) {
        const rank = rankings[i].indexOf(expectedIds[i]);
        if (rank !== -1) reciprocalSum += 1 / (rank + 1);
    }

    return { ...recallAtK, mrr: Number((reciprocalSum / rankings.length).toFixed(4)), n: rankings.length };
}

async function run() {
    await connectDB();

    if (!fs.existsSync(EVAL_SET_PATH)) {
        console.error(`${EVAL_SET_PATH} not found -- run buildEvalSet.js first.`);
        process.exit(1);
    }

    const evalSet = JSON.parse(fs.readFileSync(EVAL_SET_PATH, "utf8"));
    console.log(`Loaded ${evalSet.length} eval pairs.`);

    const denseRankings = [];
    const hybridRankings = [];
    const rerankedRankings = [];
    const hybridRerankedRankings = [];
    const expectedIds = [];

    let processed = 0, failed = 0;

    for (const pair of evalSet) {
        try {
            // 1. Chunk + embed the query text -- same /prepare path the real
            // compare endpoint uses, so this evaluates the actual production path.
            const prepared = await callMlService("/prepare", { text: pair.queryText });
            const queryChunk = prepared.chunks[0]; // opening chunk -- see note in buildEvalSet.js scope caveat

            // 2. Dense search, over-fetched so filtering self-matches doesn't
            // starve the candidate list.
            const searchResult = await callMlService("/index/search/batch/vectors", {
                vectors: [queryChunk.embedding],
                k: OVER_FETCH_K
            });
            const rawResults = searchResult.results[0];

            const { ranking: denseRanking, bestChunkId: denseBestChunkId } = await resolveToDocumentRanking(rawResults);
            denseRankings.push(denseRanking);

            // 2b. Hybrid: sparse retrieval (MongoDB text search) on the
            // same query text, fused with the dense ranking via RRF.
            const { ranking: sparseRanking, bestChunkText: sparseBestChunkText } =
                await sparseSearchDocuments(pair.queryText, OVER_FETCH_K);
            const hybridRanking = reciprocalRankFusion([denseRanking, sparseRanking]);
            hybridRankings.push(hybridRanking);

            // 3. Rerank the DENSE-ONLY candidates, evaluate the RERANKED order.
            const candidateChunks = await Chunk.find(
                { _id: { $in: rawResults.map(r => r.mongo_id) } },
                { text: 1 }
            ).lean();
            const chunkTextMap = new Map(candidateChunks.map(c => [c._id, c.text]));

            const rerankCandidates = rawResults
                .filter(r => chunkTextMap.has(r.mongo_id))
                .map(r => ({ mongo_id: r.mongo_id, text: chunkTextMap.get(r.mongo_id) }));

            const reranked = await callMlService("/rerank", {
                query: queryChunk.text,
                candidates: rerankCandidates
            });

            const { ranking: rerankedRanking } = await resolveToDocumentRanking(
                reranked.results.map(r => ({ mongo_id: r.mongo_id }))
            );
            rerankedRankings.push(rerankedRanking);

            // 3b. HYBRID + RERANK, FIXED: for each of hybrid's top candidate
            // papers, use the SPECIFIC chunk that actually earned it that
            // rank -- dense's best chunk if the paper came from dense
            // results, else sparse's best chunk. (The earlier version grabbed
            // an ARBITRARY chunk per paper, which meant the reranker often
            // judged the correct paper using an unrelated part of its
            // abstract -- that's why the first attempt scored WORSE than
            // hybrid alone despite reranking never being able to lose
            // information in principle. This fixes that.)
            const hybridTopDocIds = hybridRanking.slice(0, 15);

            const neededDenseChunkIds = hybridTopDocIds
                .filter(docId => denseBestChunkId.has(docId) && !chunkTextMap.has(denseBestChunkId.get(docId)))
                .map(docId => denseBestChunkId.get(docId));
            const extraChunks = neededDenseChunkIds.length
                ? await Chunk.find({ _id: { $in: neededDenseChunkIds } }, { text: 1 }).lean()
                : [];
            for (const c of extraChunks) chunkTextMap.set(c._id, c.text);

            const hybridRerankCandidates = [];
            for (const docId of hybridTopDocIds) {
                let text = null;
                if (denseBestChunkId.has(docId)) {
                    text = chunkTextMap.get(denseBestChunkId.get(docId));
                }
                if (!text && sparseBestChunkText.has(docId)) {
                    text = sparseBestChunkText.get(docId);
                }
                if (text) hybridRerankCandidates.push({ mongo_id: docId, text });
            }

            const hybridReranked = await callMlService("/rerank", {
                query: queryChunk.text,
                candidates: hybridRerankCandidates
            });

            // mongo_id here is already the documentId, no chunk->document
            // resolution needed -- just take the order /rerank returned.
            const hybridRerankedRanking = hybridReranked.results.map(r => r.mongo_id);
            hybridRerankedRankings.push(hybridRerankedRanking);

            expectedIds.push(pair.expectedMatchPaperId);

        } catch (err) {
            failed++;
            console.error(`Eval pair failed (query ${pair.queryArxivId}): ${err.message}`);
        }

        processed++;
        if (processed % 10 === 0) console.log(`${processed}/${evalSet.length} evaluated`);
    }

    const denseMetrics = computeMetrics(denseRankings, expectedIds);
    const hybridMetrics = computeMetrics(hybridRankings, expectedIds);
    const rerankedMetrics = computeMetrics(rerankedRankings, expectedIds);
    const hybridRerankedMetrics = computeMetrics(hybridRerankedRankings, expectedIds);

    console.log("\n--- Retrieval Evaluation Results ---");
    console.log(`Eval set: ${evalSet.length} pairs (truncated-abstract self-recognition) | ${failed} failed to evaluate`);
    console.log("\nDense retrieval only:");
    console.table(denseMetrics);
    console.log("\nHybrid (dense + sparse, RRF fused):");
    console.table(hybridMetrics);
    console.log("\nDense + cross-encoder rerank:");
    console.table(rerankedMetrics);
    console.log("\nHybrid + cross-encoder rerank:");
    console.table(hybridRerankedMetrics);

    const resultsPath = `data/eval_results_${Date.now()}.json`;
    fs.writeFileSync(resultsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        evalSetSize: evalSet.length,
        failed,
        dense: denseMetrics,
        hybrid: hybridMetrics,
        reranked: rerankedMetrics,
        hybridReranked: hybridRerankedMetrics
    }, null, 2));
    console.log(`\nSaved to ${resultsPath}`);

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Evaluation run failed:", err);
    process.exit(1);
});
