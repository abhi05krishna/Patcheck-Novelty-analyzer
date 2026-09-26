import fs from "fs/promises";
import { extractTextFromFile } from "../services/fileExtraction.service.js";
import { compareDocument } from "../services/compare.service.js";
import { generateRecommendation } from "../services/llmRecommendation.service.js";
import { saveAnalysis } from "./history.controller.js";

/**
 * POST /api/compare/upload
 * multipart/form-data, field name: "file" (PDF, DOCX, or TXT)
 * Optional form field: sourceTypeFilter ("paper" | "patent")
 *
 * Reuses the EXACT SAME compareDocument() the text-paste endpoint
 * uses -- extraction is the only new logic here, comparison isn't
 * duplicated or reimplemented.
 */
export async function handleCompareUpload(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded. Expected multipart/form-data with field name 'file'." });
    }

    const { sourceTypeFilter } = req.body;
    if (sourceTypeFilter && !["paper", "patent"].includes(sourceTypeFilter)) {
        await cleanup(req.file.path);
        return res.status(400).json({ error: "sourceTypeFilter must be 'paper', 'patent', or omitted." });
    }

    let result;
    try {
        const text = await extractTextFromFile(req.file.path);

        if (!text || text.trim().length < 50) {
            return res.status(400).json({ error: "Extracted text is too short to compare meaningfully (minimum 50 characters). The file may be scanned/image-based, empty, or extraction failed." });
        }

        result = await compareDocument(text, { sourceTypeFilter });

    } catch (err) {
        console.error("Compare (upload) failed:", err.message);

        if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
            return res.status(503).json({ error: "Comparison service is temporarily unavailable. Please try again shortly." });
        }
        if (err.message.includes("No extractor")) {
            return res.status(400).json({ error: err.message });
        }
        return res.status(500).json({ error: "Comparison failed unexpectedly." });

    } finally {
        await cleanup(req.file.path);
    }

    // Same independently-failable pattern as the text endpoint -- see
    // compare.controller.js for the full reasoning.
    try {
        result.recommendation = await generateRecommendation(result);
    } catch (err) {
        console.error("LLM recommendation failed (retrieval results still returned):", err.message);
        result.recommendation = null;
        result.recommendationError = "AI-generated recommendation is temporarily unavailable.";
    }

    if (req.auth) await saveAnalysis(req.auth.sub, req.file?.originalname, result);
    return res.status(200).json(result);
}

async function cleanup(filePath) {
    try {
        await fs.unlink(filePath);
    } catch (err) {
        console.warn(`Failed to delete uploaded file ${filePath}: ${err.message}`);
    }
}
