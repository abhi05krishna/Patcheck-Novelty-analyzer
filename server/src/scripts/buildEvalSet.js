/**
 * buildEvalSet.js
 *
 * REDESIGNED after discovering this corpus has exactly one row per
 * paper (no duplicate versions to exploit -- the original approach
 * assumed that and was wrong for this dataset).
 *
 * New approach: TRUNCATED-QUERY self-supervision. For each of N
 * randomly sampled papers, take just the first couple of sentences of
 * its abstract as the "query," and the expected match is that SAME
 * paper. This is NOT a trivial self-match -- only the truncated
 * snippet gets embedded, not the exact indexed text, so the system has
 * to recognize the paper from a partial, differently-shaped
 * description. This is a known, legitimate self-supervised IR
 * technique (query = partial document, target = full document), works
 * on any corpus with zero manual labeling, and arguably simulates a
 * real scenario better than exact-version duplicates would have: a
 * user describing their own related work in different words than an
 * existing abstract, not copy-pasting one verbatim.
 *
 * HONEST SCOPE: still not testing subtle cross-paper semantic
 * relevance judgment -- it tests "can the system find THIS paper from
 * a partial description of itself." A hand-labeled set testing
 * genuine cross-paper relevance is a good later supplement.
 *
 * DIFFICULTY NOTE: an earlier version of this script used the opening
 * 2 sentences as the query, which scored 98-100% recall@1 -- too close
 * to the ceiling to leave any room for a future comparison (hybrid
 * retrieval literally cannot show more than ~2 points of improvement
 * against a baseline that's already almost perfect). Opening sentences
 * of an abstract also tend to be generic topic sentences, which makes
 * them the EASIEST part to place. This version instead pulls a short
 * word window from the MIDDLE of the abstract -- past the generic
 * opening, into the specific methodological detail -- which is a
 * meaningfully harder, more realistic test.
 *
 * Usage: node src/scripts/buildEvalSet.js [--maxPairs=50]
 */

import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/config.js";
import Paper from "../models/paper.js";

dotenv.config();

const OUTPUT_PATH = "data/eval_set.json";
const QUERY_WORD_COUNT = 14; // short window -- much less text overlap with the full indexed abstract than 2 full sentences
const SKIP_FRACTION = 0.3;   // skip the first 30% of words -- avoids the generic opening topic sentence
const MIN_ABSTRACT_WORDS = 60; // skip abstracts too short to have a meaningful "middle"

function run_extractMiddleSnippet(abstract) {
    const words = abstract.replace(/\s+/g, " ").trim().split(" ");
    if (words.length < MIN_ABSTRACT_WORDS) return null;

    const startIndex = Math.floor(words.length * SKIP_FRACTION);
    const snippet = words.slice(startIndex, startIndex + QUERY_WORD_COUNT).join(" ");
    return snippet;
}

async function run() {
    const maxArg = process.argv.find(a => a.startsWith("--maxPairs="));
    const maxPairs = maxArg ? parseInt(maxArg.split("=")[1], 10) : 50;

    await connectDB();

    console.log(`Randomly sampling papers to build up to ${maxPairs} eval pairs...`);

    // Oversample since some abstracts will be too short to use -- filtered below.
    const sampled = await Paper.aggregate([
        { $sample: { size: maxPairs * 3 } },
        { $project: { arxivId: 1, abstract: 1 } }
    ]);

    const evalSet = [];
    for (const paper of sampled) {
        if (evalSet.length >= maxPairs) break;

        const queryText = run_extractMiddleSnippet(paper.abstract);
        if (!queryText) continue;

        evalSet.push({
            queryPaperId: paper._id.toString(),
            queryArxivId: paper.arxivId,
            queryText,
            // the query IS a snippet of this same paper -- that's the
            // point, see file header
            expectedMatchPaperId: paper._id.toString(),
            expectedMatchArxivId: paper.arxivId
        });
    }

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(evalSet, null, 2));
    console.log(`Wrote ${evalSet.length} eval pairs to ${OUTPUT_PATH}`);

    if (evalSet.length < 10) {
        console.warn("Fewer than 10 pairs -- try increasing --maxPairs or lowering MIN_ABSTRACT_WORDS.");
    }

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Failed to build eval set:", err);
    process.exit(1);
});
