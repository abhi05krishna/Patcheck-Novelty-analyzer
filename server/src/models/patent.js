import mongoose from "mongoose";

/**
 * Deliberately mirrors paper.js's shape and resumability pattern
 * (chunksGenerated flag, ingestSource) so the rest of the pipeline
 * (generateEmbeddings.js, compare.service.js) can treat papers and
 * patents uniformly wherever possible.
 *
 * Field choices reflect Google Patents Public Data's actual schema
 * (patents-public-data.patents.publications on BigQuery) -- publicationNumber
 * is that dataset's unique identifier, not a US-only patent number,
 * since the dataset spans USPTO/EPO/WIPO.
 */
const patentSchema = new mongoose.Schema({

    publicationNumber: {
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

    countryCode: {
        type: String
    },

    filingDate: {
        type: Date
    },

    publicationDate: {
        type: Date
    },

    grantDate: {
        type: Date
    },

    // CPC (Cooperative Patent Classification) codes -- the patent-world
    // equivalent of arXiv categories (cs.CV, cs.LG, etc.)
    cpcCodes: {
        type: [String],
        default: [],
        index: true
    },

    assignees: {
        type: [String],
        default: []
    },

    inventors: {
        type: [String],
        default: []
    },

    chunksGenerated: {
        type: Boolean,
        default: false,
        index: true
    },

    ingestSource: {
        type: String,
        default: "bigquery-patents-public-data"
    }

}, {
    timestamps: true
});

export default mongoose.model("Patent", patentSchema);