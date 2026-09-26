/**
 * importDataset.js
 *
 * Streams a CSV file into the Paper collection row-by-row (never loads
 * the whole file into memory — matters once your dump is multi-GB).
 *
 * Pipeline per row: parse -> validate -> dedup-check -> normalize -> batch -> insertMany
 *
 * RESUMABLE: writes a checkpoint file every BATCH_SIZE rows. If the
 * process crashes or you Ctrl+C partway through, rerun the same command
 * — it skips rows already processed instead of starting over.
 *
 * Usage: node scripts/importDataset.js <path-to-csv> [--limit=50000]
 *
 * --limit stops the import after N successfully INSERTED rows (not raw
 * file lines) -- use this instead of truncating the CSV file yourself
 * with `head`. CSV rows aren't guaranteed to be one line each: a
 * summary/abstract field containing an embedded newline makes that row
 * span multiple physical lines while inside its quotes. Cutting a file
 * with `head -n` doesn't know about that and can slice straight through
 * the middle of a quoted field, leaving an unclosed quote at the cutoff
 * point -- which is exactly what "Quote Not Closed" errors mean. Let
 * the CSV parser itself decide where rows end; --limit just stops
 * reading once you've got enough real data.
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Paper from "../models/Paper.js";
import { validateRow, normalizeRow, BatchDedupTracker } from "../services/validation.service.js";

const BATCH_SIZE = 500;
const CHECKPOINT_PATH = path.resolve("data/.import_checkpoint.json");

function loadCheckpoint() {
    try {
        return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
    } catch {
        return { rowsProcessed: 0 };
    }
}

function saveCheckpoint(rowsProcessed) {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ rowsProcessed }), "utf8");
}

async function run() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error("Usage: node scripts/importDataset.js <path-to-csv> [--limit=50000]");
        process.exit(1);
    }
    if (!fs.existsSync(inputPath)) {
        console.error(`File not found: ${inputPath}`);
        process.exit(1);
    }

    const limitArg = process.argv.find(a => a.startsWith("--limit="));
    const insertLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

    await connectDB();

    const checkpoint = loadCheckpoint();
    const dedup = new BatchDedupTracker();

    let rowIndex = 0;
    let batch = [];
    let inserted = 0;
    let skippedInvalid = 0;
    let skippedDuplicate = 0;

    const parser = fs.createReadStream(inputPath).pipe(
        parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    const flushBatch = async () => {
        if (batch.length === 0) return;
        try {
            const result = await Paper.insertMany(batch, { ordered: false });
            inserted += result.length;
        } catch (err) {
            if (err.insertedDocs) inserted += err.insertedDocs.length;
            const writeErrors = err.writeErrors ?? [];
            skippedDuplicate += writeErrors.length;
        }
        batch = [];
    };

    for await (const row of parser) {
        rowIndex++;

        if (rowIndex <= checkpoint.rowsProcessed) continue; // resume: skip already-processed rows

        const { valid, errors, warnings } = validateRow(row);

        if (!valid) {
            skippedInvalid++;
            if (skippedInvalid <= 20) {
                console.warn(`Row ${rowIndex} invalid: ${errors.join("; ")}`);
            }
            continue;
        }

        if (warnings.length > 0 && rowIndex % 500 === 0) {
            console.log(`Row ${rowIndex} warnings: ${warnings.join("; ")}`);
        }

        const normalized = normalizeRow(row);

        if (!dedup.checkAndTrack(normalized.arxivId)) {
            skippedDuplicate++;
            continue;
        }

        batch.push({ ...normalized, ingestSource: path.basename(inputPath) });

        if (batch.length >= BATCH_SIZE) {
            await flushBatch();
            saveCheckpoint(rowIndex);
            if (rowIndex % (BATCH_SIZE * 10) === 0) {
                console.log(`Processed ${rowIndex} rows | inserted ${inserted} | invalid ${skippedInvalid} | duplicate ${skippedDuplicate}`);
            }
        }

        if (insertLimit && inserted + batch.length >= insertLimit) {
            console.log(`Reached --limit=${insertLimit} inserted rows, stopping.`);
            break;
        }
    }

    await flushBatch();
    saveCheckpoint(rowIndex);

    console.log("--- Import complete ---");
    console.log(`Total rows read: ${rowIndex}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Skipped (invalid): ${skippedInvalid}`);
    console.log(`Skipped (duplicate): ${skippedDuplicate}`);

    if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Import failed:", err);
    process.exit(1);
});
