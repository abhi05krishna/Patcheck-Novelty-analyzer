import mongoose from "mongoose";

/**
 * ingestionState.service.js
 *
 * One tiny collection, one document per data source, tracking "the
 * last date we successfully pulled up to." This is what makes
 * incremental ingestion possible without re-scanning everything every
 * run -- each run only asks for "everything since last time."
 */

const ingestionStateSchema = new mongoose.Schema({
    source: { type: String, unique: true, required: true }, // e.g. "arxiv-papers"
    lastPulledDate: { type: Date, required: true },
    lastRunAt: { type: Date, default: Date.now }
});

const IngestionState = mongoose.model("IngestionState", ingestionStateSchema);

/**
 * @param {string} source
 * @param {Date} fallbackDate - used the very first time this source runs, when no cursor exists yet
 * @returns {Promise<Date>}
 */
export async function getLastPulledDate(source, fallbackDate) {
    const state = await IngestionState.findOne({ source });
    return state ? state.lastPulledDate : fallbackDate;
}

export async function setLastPulledDate(source, date) {
    await IngestionState.findOneAndUpdate(
        { source },
        { lastPulledDate: date, lastRunAt: new Date() },
        { upsert: true }
    );
}