/**
 * generateEmbeddings.js
 *
 * REPLACES the version you have now. Biggest change: this script no
 * longer does any embedding or chunking itself. It just sends each
 * paper's abstract to the Python ML service's /ingest endpoint, which
 * chunks it, embeds every chunk, and adds the vectors to FAISS -- then
 * this script writes the returned chunk metadata into MongoDB.
 *
 * Why: chunking needs an embedding model to detect topic boundaries.
 * Since embeddings only happen in Python now, chunking has to live
 * there too -- there's no way to keep it in Node without also keeping
 * a second, separate embedding model around, which is exactly the
 * duplication we're removing.
 *
 * PREREQUISITE: the Python ML service must be running before you run
 * this (uvicorn app.main:app --port 8000). Set ML_SERVICE_URL in .env
 * to wherever it's reachable.
 *
 * Usage: node scripts/generateEmbeddings.js [--limit=1000]
 */

import connectDB from "../config/config.js"; // adjust path/name if your db connector file differs
import Paper from "../models/paper.js";
import { saveChunkMetadata } from "../services/chunkStorage.service.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const CONCURRENCY = 4; // now bound by the Python service's capacity, not local CPU -- raise only if you've confirmed the service handles it
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const SAVE_INDEX_EVERY = 100; // call /index/save after every N papers, not on every single one

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            console.warn(`${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
            if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
        }
    }
    throw lastErr;
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

async function processPaper(paper, stats) {
    try {
        const ingestResult = await withRetry(
            () => callMlService("/ingest", {
                parent_id: paper._id.toString(),
                source_type: "paper",
                text: paper.abstract,
                file_name: paper.title
            }),
            `ingest[${paper.arxivId}]`
        );

        await saveChunkMetadata(paper._id, paper.title, ingestResult.chunks);

        paper.chunksGenerated = true;
        await paper.save();

        stats.succeeded++;
    } catch (err) {
        stats.failed++;
        console.error(`Permanently failed: ${paper.title} (${paper.arxivId}) -- ${err.message}`);
        // chunksGenerated stays false -> retried automatically next run
    } finally {
        stats.processed++;
        if (stats.processed % 25 === 0) {
            console.log(`${stats.processed}/${stats.total} | succeeded ${stats.succeeded} | failed ${stats.failed}`);
        }
        if (stats.processed % SAVE_INDEX_EVERY === 0) {
            await callMlService("/index/save", {}).catch(err =>
                console.warn(`Periodic /index/save failed (continuing): ${err.message}`)
            );
        }
    }
}

async function runWorkerPool(papers, stats) {
    let index = 0;

    async function worker() {
        while (index < papers.length) {
            const paper = papers[index++];
            await processPaper(paper, stats);
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, papers.length) }, () => worker());
    await Promise.all(workers);
}

async function run() {
    const limitArg = process.argv.find(a => a.startsWith("--limit="));
    const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

    await connectDB();

    // Fail fast with a clear message rather than a confusing timeout
    // deep inside processPaper() if the ML service isn't up.
    try {
        const health = await fetch(`${ML_SERVICE_URL}/health`);
        if (!health.ok) throw new Error(`status ${health.status}`);
    } catch (err) {
        console.error(`Cannot reach ML service at ${ML_SERVICE_URL}. Is it running? (${err.message})`);
        process.exit(1);
    }

    const query = { chunksGenerated: false };
    const total = await Paper.countDocuments(query);

    if (total === 0) {
        console.log("All papers already have chunks generated.");
        await mongoose.disconnect();
        process.exit(0);
    }

    console.log(`${total} papers need chunking + embedding${limit ? ` (processing up to ${limit} this run)` : ""}`);

    const papers = await Paper.find(query).limit(limit ?? 0);
    const stats = { processed: 0, succeeded: 0, failed: 0, total: papers.length };

    await runWorkerPool(papers, stats);

    // Always save at the end, even if we also saved periodically --
    // covers whatever's left since the last periodic checkpoint.
    await callMlService("/index/save", {}).catch(err =>
        console.warn(`Final /index/save failed: ${err.message}`)
    );

    console.log("--- Ingestion into ML service complete ---");
    console.log(`Processed: ${stats.processed} | Succeeded: ${stats.succeeded} | Failed: ${stats.failed}`);
    if (stats.failed > 0) {
        console.log("Failed papers remain chunksGenerated=false and will be retried on the next run.");
    }

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Run failed:", err);
    process.exit(1);
});
