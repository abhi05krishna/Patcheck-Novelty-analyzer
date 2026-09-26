/**
 * enrichCitations.js
 *
 * Fetches citationCount / influentialCitationCount / referenceCount
 * from Semantic Scholar for every Paper that doesn't have it cached yet
 * (or whose cache is older than STALE_AFTER_DAYS), and writes it onto
 * the Paper document.
 *
 * RATE LIMIT: Semantic Scholar's unauthenticated tier allows roughly
 * 100 requests / 5 minutes. This throttles to stay comfortably under
 * that. If you get a free API key (semanticscholar.org/product/api),
 * your limit goes up substantially -- worth doing before running this
 * over your full ~50K-paper corpus, since at the unauthenticated rate
 * that's realistically a multi-day background job. No key is REQUIRED
 * to run this at all, just slower.
 *
 * RESUMABLE BY DESIGN: re-running only picks up papers where
 * citationFetchedAt is null or stale -- stop it anytime (Ctrl+C),
 * rerun later, no separate checkpoint file needed since the "already
 * done" state lives on the documents themselves.
 *
 * Usage: node src/scripts/enrichCitations.js [--limit=1000]
 */

import connectDB from "../config/config.js"; // adjust path/name if your db connector file differs
import Paper from "../models/paper.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const S2_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || null; // optional
const REQUEST_DELAY_MS = S2_API_KEY ? 1100 : 4200; // 1100ms respects the stated "1 request/second introductory limit" (with small safety margin) even WITH a key -- a key doesn't automatically raise this, only requesting a rate limit increase from S2 does
const STALE_AFTER_DAYS = 90;
const S2_API_BASE = "https://api.semanticscholar.org/graph/v1/paper";
const MAX_RETRIES = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Your dataset's `id` column isn't a real arXiv ID -- it looks like it
 * was extracted from a URL path (arxiv.org/abs/0905.3766) and had the
 * slash swapped for a hyphen, with "abs-" left stuck on the front.
 * Real arXiv IDs: modern = "0905.3766", legacy = "cs/9309101" (slash,
 * not hyphen).
 *
 * ALSO strips the version suffix (v1, v2, ...) entirely -- Semantic
 * Scholar's arXiv lookup resolves the canonical paper record, not a
 * specific revision, so a trailing "v1" likely causes a false 404 even
 * when the base paper genuinely exists in their index.
 *
 * Examples this handles:
 *   "abs-0905.3766v1" -> "0905.3766"
 *   "cs-9309101v1"    -> "cs/9309101"
 */
function toRealArxivId(rawId) {
    let id = rawId.replace(/^abs-/, "");

    const legacyMatch = id.match(/^([a-z-]+)-(\d{7})(v\d+)?$/i);
    if (legacyMatch) {
        return `${legacyMatch[1]}/${legacyMatch[2]}`; // version dropped, not carried through
    }

    return id.replace(/v\d+$/, ""); // strip trailing version from modern-format ids too
}

async function fetchWithRetry(url, attempt = 1) {
    const headers = S2_API_KEY ? { "x-api-key": S2_API_KEY } : {};

    let res;
    try {
        res = await fetch(url, { headers });
    } catch (networkErr) {
        // THIS is the fix: fetch() throwing (no response received at all --
        // dropped connection, DNS issue, temporary block) used to skip
        // retry logic entirely and fail on the first attempt. Now it
        // retries with backoff just like an HTTP 429/5xx does.
        if (attempt > MAX_RETRIES) {
            throw new Error(`Network error after ${MAX_RETRIES} retries: ${networkErr.message}`);
        }
        await sleep(REQUEST_DELAY_MS * attempt * 2);
        return fetchWithRetry(url, attempt + 1);
    }

    if (res.status === 429) {
        if (attempt > MAX_RETRIES) throw new Error("Rate limited after max retries");
        await sleep(REQUEST_DELAY_MS * attempt * 3);
        return fetchWithRetry(url, attempt + 1);
    }

    if (res.status === 404) return null; // paper not indexed by S2 -- not an error

    if (!res.ok) {
        if (attempt > MAX_RETRIES) throw new Error(`S2 API failed: ${res.status}`);
        await sleep(REQUEST_DELAY_MS * attempt);
        return fetchWithRetry(url, attempt + 1);
    }

    return res.json();
}

async function run() {
    const limitArg = process.argv.find(a => a.startsWith("--limit="));
    const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

    await connectDB();

    const staleThreshold = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const query = {
        $or: [
            { citationFetchedAt: null },
            { citationFetchedAt: { $lt: staleThreshold } }
        ]
    };

    const totalPending = await Paper.countDocuments(query);
    console.log(`${totalPending} papers need citation enrichment${limit ? ` (processing up to ${limit} this run)` : ""}`);
    if (!S2_API_KEY) {
        console.log("No SEMANTIC_SCHOLAR_API_KEY set -- running at the slower unauthenticated rate limit.");
    }

    // PAGE-BASED instead of a long-lived streaming cursor. A held-open
    // MongoDB cursor gets killed by the server after ~10 minutes of
    // inactivity between fetches -- and this loop does slow work per
    // document (external API calls, sleeps, retry backoffs), so a
    // single cursor left open across the whole run eventually hit that
    // timeout and crashed with CursorNotFound.
    //
    // Fix: run a small, FRESH find().limit() query each time instead.
    // Each query is fast and closes immediately -- it's never open
    // during the slow part. This works cleanly because already-
    // processed papers drop out of `query` automatically once their
    // citationFetchedAt gets set, so re-running the same query each
    // loop naturally returns the next unprocessed page.
    const PAGE_SIZE = 25;
    const failedThisRun = new Set(); // prevents a persistently-failing paper from being re-fetched every single page within this run

    let processed = 0, updated = 0, notFound = 0, failed = 0;

    while (true) {
        if (limit && processed >= limit) break;

        const pageLimit = limit ? Math.min(PAGE_SIZE, limit - processed) : PAGE_SIZE;
        const pageQuery = failedThisRun.size > 0
            ? { ...query, _id: { $nin: [...failedThisRun] } }
            : query;
        const page = await Paper.find(pageQuery).limit(pageLimit);

        if (page.length === 0) break; // nothing left to process

        for (const paper of page) {
            const realArxivId = toRealArxivId(paper.arxivId);
            const url = `${S2_API_BASE}/arXiv:${realArxivId}?fields=citationCount,influentialCitationCount,references.paperId`;

            try {
                const data = await fetchWithRetry(url);

                if (data === null) {
                    notFound++;
                    paper.citationFetchedAt = new Date(); // don't retry every run
                } else {
                    paper.citationCount = data.citationCount ?? 0;
                    paper.influentialCitationCount = data.influentialCitationCount ?? 0;
                    paper.referenceCount = data.references?.length ?? 0;
                    paper.citationFetchedAt = new Date();
                    updated++;
                }

                await paper.save();

            } catch (err) {
                failed++;
                failedThisRun.add(paper._id.toString());
                console.error(`Failed to enrich ${paper.arxivId}: ${err.message}`);
                // citationFetchedAt left untouched -> eligible for retry on the NEXT run
            }

            processed++;
            if (processed % 50 === 0) {
                console.log(`${processed} processed | updated ${updated} | not on S2 ${notFound} | failed ${failed}`);
            }

            await sleep(REQUEST_DELAY_MS);

            if (limit && processed >= limit) break;
        }
    }

    console.log("--- Citation enrichment complete ---");
    console.log(`Processed: ${processed} | Updated: ${updated} | Not found on S2: ${notFound} | Failed: ${failed}`);

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Enrichment run failed:", err);
    process.exit(1);
});
