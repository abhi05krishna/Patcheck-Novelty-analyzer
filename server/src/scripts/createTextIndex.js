/**
 * createTextIndex.js
 *
 * One-time setup for sparse (keyword-based) retrieval: creates a text
 * index on Chunk.text so MongoDB's $text search works. Safe to run
 * more than once -- createIndex() is a no-op if an equivalent index
 * already exists.
 *
 * On your existing ~193K chunks, this triggers a background index
 * build -- may take a few minutes, but won't block reads/writes to the
 * collection while it runs.
 *
 * Usage: node src/scripts/createTextIndex.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "../config/config.js";
import Chunk from "../models/chunk.js";

dotenv.config();

async function run() {
    await connectDB();

    console.log("Creating text index on Chunk.text (background build on existing data)...");
    await Chunk.collection.createIndex({ text: "text" });
    console.log("Text index ready.");

    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Failed to create text index:", err);
    process.exit(1);
});
