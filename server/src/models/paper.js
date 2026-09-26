import mongoose from "mongoose";

/**
 * ADDED to your current models/paper.js: citation caching fields.
 *
 * Why cached rather than fetched live: Semantic Scholar's free API is
 * rate-limited (~100 req/5min unauthenticated). A user's real-time
 * compare request needs an answer in under a second -- it can't be
 * waiting on an external API call, and definitely can't be the thing
 * that burns through your rate limit. So citation data gets fetched
 * ONCE per paper by a batch script (enrichCitations.js) and cached
 * here; the compare flow only ever reads these fields, never calls
 * Semantic Scholar itself.
 */
const paperSchema = new mongoose.Schema({

    arxivId: {
        type: String,
        unique: true,
        required: true,
        index: true
    },

    title: {
        type: String,
        required: true
    },

    abstract: {
        type: String,
        required: true
    },

    categories: {
        type: [String],
        default: [],
        index: true
    },

    authors: {
        type: [String],
        default: []
    },

    publishedDate: {
        type: Date
    },

    chunksGenerated: {
        type: Boolean,
        default: false,
        index: true
    },

    ingestSource: {
        type: String
    },

    // --- citation caching, new ---

    citationCount: {
        type: Number,
        default: null
    },

    influentialCitationCount: {
        type: Number,
        default: null
    },

    referenceCount: {
        type: Number,
        default: null
    },

    // null = never fetched. Also used to skip papers Semantic Scholar
    // doesn't have indexed, so those aren't retried every single run --
    // see enrichCitations.js.
    citationFetchedAt: {
        type: Date,
        default: null,
        index: true
    }

}, {
    timestamps: true
});

export default mongoose.model("Paper", paperSchema);
