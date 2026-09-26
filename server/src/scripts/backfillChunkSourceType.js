/**
 * backfillChunkSourceType.js
 *
 * One-off: every Chunk document ingested before this turn has no
 * sourceType field (it didn't exist yet). Since your corpus was 100%
 * papers until now, backfilling "paper" onto all of them is exactly
 * correct, not a guess -- there was nothing else it could have been.
 *
 * Safe to run once; matches nothing on a second run.
 *
 * Usage: node src/scripts/backfillChunkSourceType.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/config.js";
import Chunk from "../models/chunk.js";

dotenv.config();

async function run() {
    await connectDB();

    const result = await Chunk.updateMany(
        { sourceType: { $exists: false } },
        { $set: { sourceType: "paper" } }
    );

    console.log(`Backfilled sourceType="paper" on ${result.modifiedCount} chunks.`);

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Backfill failed:", err.message);
    process.exit(1);
});