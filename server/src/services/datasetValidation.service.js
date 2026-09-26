/**
 * validation.service.js
 *
 * Field names match your actual CSV header:
 *   id, title, category, category_code, published_date, updated_date,
 *   authors, first_author, summary, summary_word_count
 */

const MIN_TITLE_LENGTH = 5;
const MAX_TITLE_LENGTH = 500;
const MIN_ABSTRACT_LENGTH = 50;   // catches truncated/corrupted rows
const MAX_ABSTRACT_LENGTH = 10000;

// Modern arXiv IDs: 2301.12345 or 2301.12345v2
const MODERN_ARXIV_ID_PATTERN = /^\d{4}\.\d{4,5}(v\d+)?$/;
// Legacy (pre-2007) IDs: hep-th/9901001 — common across a full-history dump
const LEGACY_ARXIV_ID_PATTERN = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/;

/**
 * Validates one row's structure/types/lengths.
 *
 * @param {object} row
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 *   errors   -> row is unusable, gets skipped
 *   warnings -> row is still inserted, flagged for manual review
 */
export function validateRow(row) {
    const errors = [];
    const warnings = [];

    const id = row?.id;
    const title = row?.title;
    const abstract = row?.summary;

    if (!id) {
        errors.push("missing id");
    } else if (typeof id !== "string") {
        errors.push("id must be a string");
    } else {
        const trimmed = id.trim();
        if (!MODERN_ARXIV_ID_PATTERN.test(trimmed) && !LEGACY_ARXIV_ID_PATTERN.test(trimmed)) {
            warnings.push(`id "${id}" doesn't match modern or legacy arXiv ID format — kept, verify manually`);
        }
    }

    if (!title || typeof title !== "string") {
        errors.push("missing or non-string title");
    } else if (title.trim().length < MIN_TITLE_LENGTH || title.trim().length > MAX_TITLE_LENGTH) {
        errors.push(`title length ${title.trim().length} outside [${MIN_TITLE_LENGTH}, ${MAX_TITLE_LENGTH}]`);
    }

    if (!abstract || typeof abstract !== "string") {
        errors.push("missing or non-string summary");
    } else if (abstract.trim().length < MIN_ABSTRACT_LENGTH || abstract.trim().length > MAX_ABSTRACT_LENGTH) {
        errors.push(`summary length ${abstract.trim().length} outside [${MIN_ABSTRACT_LENGTH}, ${MAX_ABSTRACT_LENGTH}]`);
    }

    if (row?.category_code) {
        const cats = String(row.category_code).trim().split(/[\s,]+/).filter(Boolean);
        if (cats.length === 0) {
            warnings.push("category_code present but empty after parsing");
        }
    }

    // Sanity-check against summary_word_count when the dataset provides
    // it — a large mismatch usually means truncation/encoding issues.
    if (row?.summary_word_count && abstract) {
        const statedCount = parseInt(row.summary_word_count, 10);
        const actualCount = abstract.trim().split(/\s+/).filter(Boolean).length;
        if (!isNaN(statedCount) && Math.abs(statedCount - actualCount) > statedCount * 0.15) {
            warnings.push(`summary_word_count (${statedCount}) doesn't match actual word count (${actualCount})`);
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

/**
 * Tracks arxivIds seen so far in one ingestion run to catch duplicate
 * rows WITHIN the file. Mongo's unique index catches cross-run
 * duplicates, but catching in-file duplicates before attempting the
 * insert is faster and quieter than letting every one hit a write error.
 */
export class BatchDedupTracker {
    constructor() {
        this.seen = new Set();
    }

    checkAndTrack(arxivId) {
        const key = arxivId.trim().toLowerCase();
        if (this.seen.has(key)) return false;
        this.seen.add(key);
        return true;
    }

    get count() {
        return this.seen.size;
    }
}

/**
 * Normalizes a raw CSV row into the shape the Paper model expects,
 * once validateRow has confirmed the row is usable.
 */
export function normalizeRow(row) {
    const categories = row.category_code
        ? String(row.category_code).trim().split(/[\s,]+/).filter(Boolean)
        : [];

    const authors = row.authors
        ? String(row.authors).split(/[;,]/).map(a => a.trim()).filter(Boolean)
        : (row.first_author ? [row.first_author.trim()] : []);

    return {
        arxivId: row.id.trim(),
        title: row.title.trim(),
        abstract: row.summary.trim(),
        categories,
        authors,
        publishedDate: row.published_date ? new Date(row.published_date) : undefined
    };
}