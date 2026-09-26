import { compareDocument } from "../services/compare.service.js";
import { generateRecommendation } from "../services/llmRecommendation.service.js";
import { saveAnalysis } from "./history.controller.js";

/**
 * POST /api/compare
 * Body: { text: string, sourceTypeFilter?: "paper" | "patent" }
 *
 * Takes raw text for now (paste-in abstract). File upload (PDF/DOCX)
 * shares this same controller pattern via upload.controller.js.
 */
export async function handleCompare(req, res) {
    const { text, sourceTypeFilter } = req.body;

    if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Request body must include a non-empty 'text' string." });
    }

    if (text.trim().length < 50) {
        return res.status(400).json({ error: "Text is too short to compare meaningfully (minimum 50 characters)." });
    }

    if (sourceTypeFilter && !["paper", "patent"].includes(sourceTypeFilter)) {
        return res.status(400).json({ error: "sourceTypeFilter must be 'paper', 'patent', or omitted." });
    }

    let result;
    try {
        result = await compareDocument(text, { sourceTypeFilter });
    } catch (err) {
        console.error("Compare failed:", err.message);

        if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
            return res.status(503).json({ error: "Comparison service is temporarily unavailable. Please try again shortly." });
        }
        return res.status(500).json({ error: "Comparison failed unexpectedly." });
    }

    // LLM recommendation is a SEPARATE try/catch -- retrieval already
    // succeeded and is genuinely useful on its own, so a Gemini outage
    // or missing API key shouldn't turn a working result into a total
    // failure. The response just omits `recommendation` and says why.
    try {
        result.recommendation = await generateRecommendation(result);
    } catch (err) {
        console.error("LLM recommendation failed (retrieval results still returned):", err.message);
        result.recommendation = null;
        result.recommendationError = "AI-generated recommendation is temporarily unavailable.";
    }

    if (req.auth) await saveAnalysis(req.auth.sub, text, result);
    return res.status(200).json(result);
}
