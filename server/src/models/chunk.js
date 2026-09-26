import mongoose from "mongoose";

/**
 * CHANGED from the previous version:
 *   - `sourceType` ADDED. This closes a gap flagged since compare.service.js
 *     was first built: dense (FAISS) search already knew whether a match
 *     was a paper or patent, via Python's id-mapping -- but sparse
 *     (MongoDB text) search had no way to know, since it never touches
 *     FAISS at all, and compare.service.js was silently defaulting
 *     sparse-only matches to "paper". With this field on the Chunk
 *     document itself, sparse search can report the real value.
 *   - `documentId` is no longer hard-`ref`'d to "Paper" only -- it now
 *     points at whichever collection `sourceType` says (Paper or
 *     Patent). Mongoose's `ref` is just a hint for populate()
 *     convenience, not an enforced constraint, so this was always
 *     safe to generalize -- just needed the sourceType field to know
 *     WHICH collection to populate from.
 */
const chunkSchema = new mongoose.Schema({

    _id: {
        type: String,
        required: true
    },

    documentId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
        // no `ref` here -- resolve manually against Paper or Patent
        // based on sourceType, since a single static ref can't point
        // at two different collections
    },

    sourceType: {
        type: String,
        enum: ["paper", "patent"],
        required: true,
        index: true
    },

    fileName: {
        type: String,
        required: true
    },

    chunkNumber: {
        type: Number,
        required: true
    },

    text: {
        type: String,
        required: true
    }

}, {
    timestamps: true
});

export default mongoose.model("Chunk", chunkSchema);