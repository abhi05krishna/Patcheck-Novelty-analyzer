import Chunk from "../models/chunk.js";

/**
 * Writes chunk METADATA to MongoDB, using the ids and text the Python
 * ML service already returned from /ingest -- it did the chunking and
 * already added the vectors to FAISS, this just makes those chunks
 * visible/queryable from the Node/Mongo side for display purposes
 * (e.g. showing "matched chunk 3 of paper X" in a report).
 *
 * @param {string} paperId - Mongo _id of the parent Paper
 * @param {string} fileName - paper title, stored for display convenience
 * @param {Array<{chunk_id: string, chunk_number: number, text: string}>} chunksFromMlService
 * @returns {Promise<{stored: number}>}
 */
export async function saveChunkMetadata(paperId, fileName, chunksFromMlService) {
    const records = chunksFromMlService.map(c => ({
        _id: c.chunk_id,
        documentId: paperId,
        fileName,
        chunkNumber: c.chunk_number,
        text: c.text
    }));

    const inserted = await Chunk.insertMany(records, { ordered: false });
    return { stored: inserted.length };
}
