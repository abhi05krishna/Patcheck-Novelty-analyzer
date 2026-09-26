/**
 * updatePapersFromArxiv.js
 *
 * Pulls NEW papers from arXiv's live public API (export.arxiv.org),
 * incrementally -- only papers submitted since the last successful
 * run. This is what makes the paper corpus genuinely non-static,
 * unlike the original one-time CSV import.
 *
 * IMPORTANT: papers ingested here get CLEAN arxivIds directly from
 * arXiv's own API (e.g. "2301.12345v1") -- not the mangled
 * "abs-2301.12345v1" / "cs-9309101v1" format your original static CSV
 * dump had. No toRealArxivId()-style cleanup needed for these; that
 * hack was specific to the old dataset's export quirk.
 *
 * DOWNSTREAM PIPELINE UNCHANGED: new papers land with
 * chunksGenerated: false and citationFetchedAt: null, exactly like
 * any freshly-imported paper -- generateEmbeddings.js and
 * enrichCitations.js pick them up automatically on their next run,
 * with zero changes needed to either script.
 *
 * RATE LIMIT: arXiv's own docs specify no hard daily cap but ask for
 * a minimum 3-second delay between automated requests, with backoff
 * on 503s -- both implemented below. A weekly incremental pull is a
 * handful of requests at most, nowhere near a real constraint.
 *
 * Usage: node src/scripts/updatePapersFromArxiv.js [--categories=cs.AI,cs.CV,cs.LG,cs.CL] [--maxResults=200]
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { XMLParser } from "fast-xml-parser";
import connectDB from "../config/config.js";
import Paper from "../models/paper.js";
import { getLastPulledDate, setLastPulledDate } from "../services/ingestionState.service.js";

dotenv.config();

const SOURCE_NAME = "arxiv-papers";
const FIRST_RUN_LOOKBACK_DAYS = 7; // small on purpose -- this is a weekly recurring job, not a bulk backfill; minimizes overlap with the historical static dump
const REQUEST_DELAY_MS = 3200; // arXiv asks for a minimum 3s between automated requests
const MAX_RETRIES = 3;
const DEFAULT_CATEGORIES = ["cs.AI", "cs.CV", "cs.LG", "cs.CL"]; // matches the apparent focus of your existing corpus

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatArxivDate(date) {
    // arXiv wants YYYYMMDDHHMM in GMT -- strip dashes, colons, AND the
    // "T" date/time separator (the original version missed the "T",
    // which threw off slice(0,12) and produced a malformed date like
    // "20260815T124" instead of "202608151244" -- confirmed as the
    // cause of the 500 error seen in testing).
    return date.toISOString().replace(/[-:]/g, "").replace("T", "").slice(0, 12);
}

function cleanAbstract(text) {
    return text.replace(/\s+/g, " ").trim();
}

function extractArxivId(idUrl) {
    // idUrl looks like "http://arxiv.org/abs/2301.12345v1"
    return idUrl.split("/abs/")[1];
}

async function fetchWithRetry(url, attempt = 1) {
    let res;
    try {
        res = await fetch(url);
    } catch (networkErr) {
        if (attempt > MAX_RETRIES) throw new Error(`Network error after ${MAX_RETRIES} retries: ${networkErr.message}`);
        await sleep(REQUEST_DELAY_MS * attempt * 2);
        return fetchWithRetry(url, attempt + 1);
    }

    if (res.status === 503) {
        if (attempt > MAX_RETRIES) throw new Error("arXiv rate-limited (503) after max retries");
        await sleep(REQUEST_DELAY_MS * attempt * 3);
        return fetchWithRetry(url, attempt + 1);
    }

    if (!res.ok) {
        throw new Error(`arXiv API returned ${res.status}`);
    }

    return res.text();
}

function validateEntry(entry) {
    if (!entry.title || !entry.summary || !entry.id) return false;
    if (cleanAbstract(entry.summary).length < 50) return false;
    return true;
}

async function run() {
    const categoriesArg = process.argv.find(a => a.startsWith("--categories="));
    const categories = categoriesArg ? categoriesArg.split("=")[1].split(",") : DEFAULT_CATEGORIES;

    const maxResultsArg = process.argv.find(a => a.startsWith("--maxResults="));
    const maxResults = maxResultsArg ? parseInt(maxResultsArg.split("=")[1], 10) : 200;

    await connectDB();

    const runStartTime = new Date(); // capture BEFORE querying, so the cursor never has a gap or overlap regardless of how long this run takes

    const fallbackDate = new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const sinceDate = await getLastPulledDate(SOURCE_NAME, fallbackDate);

    console.log(`Pulling papers in [${categories.join(", ")}] submitted since ${sinceDate.toISOString()}...`);

    const xmlParserOpts = { ignoreAttributes: false, attributeNamePrefix: "@_" };
    const xmlParser = new XMLParser(xmlParserOpts);

    let totalInserted = 0, totalSkippedInvalid = 0, totalSkippedDuplicate = 0;

    for (const category of categories) {
        const searchQuery = `cat:${category}+AND+submittedDate:[${formatArxivDate(sinceDate)}+TO+${formatArxivDate(runStartTime)}]`;
        const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&sortBy=submittedDate&sortOrder=ascending&max_results=${maxResults}`;

        console.log(`Querying ${category}...`);
        const xml = await fetchWithRetry(url);
        const parsed = xmlParser.parse(xml);

        const entries = parsed.feed?.entry
            ? (Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry])
            : [];

        console.log(`  ${entries.length} entries returned for ${category}`);

        const batch = [];
        for (const entry of entries) {
            if (!validateEntry(entry)) {
                totalSkippedInvalid++;
                continue;
            }

            const authorField = entry.author;
            const authors = Array.isArray(authorField)
                ? authorField.map(a => a.name).filter(Boolean)
                : (authorField?.name ? [authorField.name] : []);

            batch.push({
                arxivId: extractArxivId(entry.id),
                title: cleanAbstract(entry.title),
                abstract: cleanAbstract(entry.summary),
                categories: [category],
                authors,
                publishedDate: entry.published ? new Date(entry.published) : undefined,
                ingestSource: "arxiv-api-live"
            });
        }

        if (batch.length > 0) {
            try {
                const result = await Paper.insertMany(batch, { ordered: false });
                totalInserted += result.length;
            } catch (err) {
                totalInserted += err.insertedDocs?.length ?? 0;
                totalSkippedDuplicate += (err.writeErrors ?? []).length;
            }
        }

        await sleep(REQUEST_DELAY_MS); // respect arXiv's requested delay between requests, including across categories
    }

    await setLastPulledDate(SOURCE_NAME, runStartTime);

    console.log("--- arXiv paper update complete ---");
    console.log(`Inserted: ${totalInserted} | Invalid: ${totalSkippedInvalid} | Duplicate: ${totalSkippedDuplicate}`);
    console.log(`Cursor advanced to: ${runStartTime.toISOString()}`);
    console.log("New papers have chunksGenerated=false -- run generateEmbeddings.js next to embed them, then enrichCitations.js.");

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("arXiv update failed:", err.message);
    process.exit(1);
});
