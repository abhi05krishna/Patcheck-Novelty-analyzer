// /**
//  * llmRecommendation.service.js
//  *
//  * Takes the ALREADY-COMPUTED output of compareDocument() -- real
//  * novelty scores, real matched papers -- and asks an LLM to explain it
//  * in plain English with actionable suggestions. The LLM is
//  * deliberately NEVER asked to judge novelty or similarity itself; it
//  * only writes about numbers and matches that were already computed by
//  * the actual retrieval/scoring pipeline. That's the whole point of
//  * doing retrieval first: the LLM has something real and grounded to
//  * explain, instead of hallucinating a judgment from scratch.
//  *
//  * GROUNDING CHECK: after the LLM responds, every arxivId it claims to
//  * cite is checked against the actual matched papers it was given. Any
//  * citation that doesn't correspond to a real match is a caught
//  * hallucination -- filtered out, not silently trusted. This is a real
//  * safeguard, not just a design note.
//  *
//  * MODEL NAME: configurable via GEMINI_MODEL env var. Default is
//  * "gemini-flash-latest" -- a Google-maintained ALIAS, not a pinned
//  * version. This matters because pinned version names (gemini-2.0-flash,
//  * then gemini-2.5-flash) both stopped working within the same week of
//  * building this, despite being "current" when first chosen -- Gemini
//  * models get retired faster than any hardcoded name stays valid. The
//  * "-latest" alias always points to whatever Google currently considers
//  * the right default Flash model, so this shouldn't need updating again
//  * for this reason. If you ever want a SPECIFIC pinned version instead
//  * (e.g. for reproducibility), check what's actually available to your
//  * key first: curl https://generativelanguage.googleapis.com/v1beta/models
//  * with your x-goog-api-key header -- the catalog listing something
//  * doesn't guarantee your account can still call it.
//  */

// // NOTE: these are deliberately NOT read into module-level constants.
// // Reading process.env.* at the top of a file captures its value the
// // MOMENT this file is first imported -- which can happen before your
// // .env has actually loaded, depending on which file imports which
// // first. That's an ES-module import-ordering race condition, not a
// // wrong key value -- reading inside the function instead means this
// // only ever runs at REQUEST time, by which point the server has fully
// // started and .env is guaranteed loaded, no matter the import order.

// /**
//  * Builds a prompt containing ONLY real, already-computed data --
//  * nothing the LLM is asked to determine on its own. Every arxivId
//  * listed here is exactly what the grounding check will verify against
//  * afterward.
//  */
// const MAX_PROMPT_CHUNKS = 8;
// const MAX_CHUNK_CHARACTERS = 1200;

// function buildPrompt(comparisonResult) {
//     const chunkSummaries = (comparisonResult.chunks || []).slice(0, MAX_PROMPT_CHUNKS).map((chunk, i) => {
//         const matchLines = (chunk.topMatches || []).slice(0, 3).map(m => `  - arxivId: ${m.arxivId} | title: "${m.paperTitle}" | similarity: ${m.similarity?.toFixed(3) ?? "n/a"} | relevance score: ${m.rerankScore?.toFixed(3) ?? "n/a"}`).join("\n");
//         const submittedChunk = (chunk.submittedChunk || "").slice(0, MAX_CHUNK_CHARACTERS);
//         const noveltyScore = Number.isFinite(chunk.noveltyScore) ? chunk.noveltyScore.toFixed(3) : "n/a";
//         return `Section ${i + 1} (novelty score: ${noveltyScore}, 0=heavily overlapping, 1=highly novel):\n"${submittedChunk}"\nTop matched papers:\n${matchLines}`;
//     }).join("\n\n");
//     return `You are analyzing a research submission against existing literature. Below are ALREADY-COMPUTED novelty scores and the ACTUAL papers the system found as the closest matches. Do not invent, guess, or reference any paper not explicitly listed below -- only cite papers by the exact arxivId values given.

// Overall novelty score: ${comparisonResult.overallNoveltyScore.toFixed(3)} (0=heavily overlapping with existing work, 1=highly novel)

// ${chunkSummaries}

// Write a JSON response with this exact structure:
// {
//   "summary": "2-3 sentence plain-English summary of how novel this submission is and why",
//   "noveltyVerdict": "one short phrase",
//   "recommendations": ["specific, actionable suggestion 1", "suggestion 2", "suggestion 3"],
//   "citedSources": [{"arxivId": "exact id from the list above", "note": "one sentence on why this paper is relevant"}]
// }

// Only include arxivIds in citedSources that appear in the matched papers above. Respond with ONLY the JSON object, no markdown formatting.`;
// }

// const RETRYABLE_GEMINI_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
// const MAX_GEMINI_ATTEMPTS = 5;
// const retryDelay = attempt => Math.min(1000 * (2 ** (attempt - 1)), 8000) + Math.floor(Math.random() * 350);

// async function waitAndRetry(prompt, attempt, reason) {
//     const delay = retryDelay(attempt);
//     console.warn(`Gemini ${reason} (attempt ${attempt}/${MAX_GEMINI_ATTEMPTS}), retrying in ${delay}ms...`);
//     await new Promise(resolve => setTimeout(resolve, delay));
//     return callGemini(prompt, attempt + 1);
// }

// async function callGemini(prompt, attempt = 1) {
//     const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
//     const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
//     if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set in .env");
//     let res;
//     try {
//         res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
//             method: "POST", headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
//             body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" }, noveltyVerdict: { type: "STRING" }, recommendations: { type: "ARRAY", items: { type: "STRING" } }, citedSources: { type: "ARRAY", items: { type: "OBJECT", properties: { arxivId: { type: "STRING" }, note: { type: "STRING" } }, required: ["arxivId", "note"] } } }, required: ["summary", "noveltyVerdict", "recommendations", "citedSources"] }, temperature: 0.3 } })
//         });
//     } catch (err) {
//         if (attempt < MAX_GEMINI_ATTEMPTS) return waitAndRetry(prompt, attempt, `network error: ${err.message}`);
//         throw new Error(`Gemini request failed after ${MAX_GEMINI_ATTEMPTS} attempts: ${err.message}`);
//     }
//     if (RETRYABLE_GEMINI_STATUSES.has(res.status) && attempt < MAX_GEMINI_ATTEMPTS) return waitAndRetry(prompt, attempt, `returned ${res.status}`);
//     if (!res.ok) { const errText = (await res.text().catch(() => "")).slice(0, 500); throw new Error(`Gemini API returned ${res.status}: ${errText}`); }
//     const data = await res.json(); const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
//     if (!text) throw new Error("Gemini response had no usable text content -- possibly blocked by safety filters or an unexpected response shape.");
//     return text;
// }
// /**
//  * Filters citedSources down to only arxivIds that genuinely appear in
//  * the comparison's matched papers. Anything else is a hallucination --
//  * removed, and logged so it's visible during development rather than
//  * silently disappearing.
//  */
// function applyGroundingCheck(llmResult, comparisonResult) {
//     const realArxivIds = new Set(
//         comparisonResult.chunks.flatMap(c => c.topMatches.map(m => m.arxivId)).filter(Boolean)
//     );

//     const grounded = (llmResult.citedSources || []).filter(c => {
//         const isReal = realArxivIds.has(c.arxivId);
//         if (!isReal) {
//             console.warn(`Grounding check: LLM cited "${c.arxivId}" which was not in the actual matched papers -- removed.`);
//         }
//         return isReal;
//     });

//     return { ...llmResult, citedSources: grounded };
// }

// /**
//  * @param {object} comparisonResult - the full output of compareDocument()
//  * @returns {Promise<{summary, noveltyVerdict, recommendations, citedSources}>}
//  */
// export async function generateRecommendation(comparisonResult) {
//     const prompt = buildPrompt(comparisonResult);
//     const rawText = await callGemini(prompt);

//     let parsed;
//     try {
//         parsed = JSON.parse(rawText);
//     } catch (firstErr) {
//         try {
//             // Fallback 1: strip markdown code fences in case responseMimeType
//             // was somehow ignored
//             const stripped = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
//             parsed = JSON.parse(stripped);
//         } catch {
//             // Fallback 2: strip stray control characters (raw newlines/tabs
//             // inside string values, etc.) that can break strict JSON.parse
//             // even with responseSchema enforced -- this was the likely
//             // cause of the "Expected ',' or '}'" error seen in testing.
//             const cleaned = rawText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
//             parsed = JSON.parse(cleaned); // if this also throws, let it bubble up -- genuinely malformed
//         }
//     }

//     return applyGroundingCheck(parsed, comparisonResult);
// }


/**
 * llmRecommendation.service.js
 *
 * Takes the ALREADY-COMPUTED output of compareDocument() -- real
 * novelty scores, real matched papers -- and asks an LLM to explain it
 * in plain English with actionable suggestions. The LLM is
 * deliberately NEVER asked to judge novelty or similarity itself; it
 * only writes about numbers and matches that were already computed by
 * the actual retrieval/scoring pipeline. That's the whole point of
 * doing retrieval first: the LLM has something real and grounded to
 * explain, instead of hallucinating a judgment from scratch.
 *
 * GROUNDING CHECK: after the LLM responds, every arxivId it claims to
 * cite is checked against the actual matched papers it was given. Any
 * citation that doesn't correspond to a real match is a caught
 * hallucination -- filtered out, not silently trusted. This is a real
 * safeguard, not just a design note.
 *
 * MODEL NAME: configurable via GROQ_MODEL env var. Default is
 * "llama-3.2-90b-vision-preview" - a stable model that's been reliable
 * and cost-effective for structured JSON generation.
 * 
 * AVAILABLE GROQ MODELS (as of 2024):
 * - mixtral-8x7b-32768 (great for complex tasks)
 * - llama-3.2-90b-vision-preview (latest, best for JSON)
 * - llama-3.1-70b-versatile (very capable)
 * - llama-3-8b-instruct (fastest, lower quality)
 * - gemma2-9b-it (Google's model, lightweight)
 */

// NOTE: these are deliberately NOT read into module-level constants.
// Reading process.env.* at the top of a file captures its value the
// MOMENT this file is first imported -- which can happen before your
// .env has actually loaded, depending on which file imports which
// first. That's an ES-module import-ordering race condition, not a
// wrong key value -- reading inside the function instead means this
// only ever runs at REQUEST time, by which point the server has fully
// started and .env is guaranteed loaded, no matter the import order.

/**
 * Builds a prompt containing ONLY real, already-computed data --
 * nothing the LLM is asked to determine on its own. Every arxivId
 * listed here is exactly what the grounding check will verify against
 * afterward.
 */
const MAX_PROMPT_CHUNKS = 8;
const MAX_CHUNK_CHARACTERS = 1200;

function buildPrompt(comparisonResult) {
    const chunkSummaries = (comparisonResult.chunks || []).slice(0, MAX_PROMPT_CHUNKS).map((chunk, i) => {
        const matchLines = (chunk.topMatches || []).slice(0, 3).map(m => `  - arxivId: ${m.arxivId} | title: "${m.paperTitle}" | similarity: ${m.similarity?.toFixed(3) ?? "n/a"} | relevance score: ${m.rerankScore?.toFixed(3) ?? "n/a"}`).join("\n");
        const submittedChunk = (chunk.submittedChunk || "").slice(0, MAX_CHUNK_CHARACTERS);
        const noveltyScore = Number.isFinite(chunk.noveltyScore) ? chunk.noveltyScore.toFixed(3) : "n/a";
        return `Section ${i + 1} (novelty score: ${noveltyScore}, 0=heavily overlapping, 1=highly novel):\n"${submittedChunk}"\nTop matched papers:\n${matchLines}`;
    }).join("\n\n");
    
    return `You are analyzing a research submission against existing literature. Below are ALREADY-COMPUTED novelty scores and the ACTUAL papers the system found as the closest matches. Do not invent, guess, or reference any paper not explicitly listed below -- only cite papers by the exact arxivId values given.

Overall novelty score: ${comparisonResult.overallNoveltyScore.toFixed(3)} (0=heavily overlapping with existing work, 1=highly novel)

${chunkSummaries}

Write a JSON response with this exact structure:
{
  "summary": "2-3 sentence plain-English summary of how novel this submission is and why",
  "noveltyVerdict": "one short phrase",
  "recommendations": ["specific, actionable suggestion 1", "suggestion 2", "suggestion 3"],
  "citedSources": [{"arxivId": "exact id from the list above", "note": "one sentence on why this paper is relevant"}]
}

Only include arxivIds in citedSources that appear in the matched papers above. Respond with ONLY the JSON object, no markdown formatting.`;
}

const RETRYABLE_GROQ_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_GROQ_ATTEMPTS = 5;
const retryDelay = attempt => Math.min(1000 * (2 ** (attempt - 1)), 8000) + Math.floor(Math.random() * 350);

async function waitAndRetry(prompt, attempt, reason) {
    const delay = retryDelay(attempt);
    console.warn(`Groq ${reason} (attempt ${attempt}/${MAX_GROQ_ATTEMPTS}), retrying in ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return callGroq(prompt, attempt + 1);
}

async function callGroq(prompt, attempt = 1) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set in .env");

    const requestBody = {
        model: GROQ_MODEL,
        messages: [
            {
                role: "system",
                content: "You are a research analysis assistant. Respond only with JSON matching the given schema."
            },
            { role: "user", content: prompt }
        ],
        temperature: 0.3,
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "novelty_recommendation",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        summary: { type: "string" },
                        noveltyVerdict: { type: "string" },
                        recommendations: {
                            type: "array",
                            items: { type: "string" }
                        },
                        citedSources: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    arxivId: { type: "string" },
                                    note: { type: "string" }
                                },
                                required: ["arxivId", "note"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["summary", "noveltyVerdict", "recommendations", "citedSources"],
                    additionalProperties: false
                }
            }
        },
        stream: false
    };

    let res;
    try {
        res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });
    } catch (err) {
        if (attempt < MAX_GROQ_ATTEMPTS) return waitAndRetry(prompt, attempt, `network error: ${err.message}`);
        throw new Error(`Groq request failed after ${MAX_GROQ_ATTEMPTS} attempts: ${err.message}`);
    }

    if (RETRYABLE_GROQ_STATUSES.has(res.status) && attempt < MAX_GROQ_ATTEMPTS) {
        return waitAndRetry(prompt, attempt, `returned ${res.status}`);
    }

    if (!res.ok) {
        const errText = (await res.text().catch(() => "")).slice(0, 500);
        throw new Error(`Groq API returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;

    if (!text) throw new Error("Groq response had no usable text content -- possibly blocked or an unexpected response shape.");

    return text;
}

/**
 * Filters citedSources down to only arxivIds that genuinely appear in
 * the comparison's matched papers. Anything else is a hallucination --
 * removed, and logged so it's visible during development rather than
 * silently disappearing.
 */
function applyGroundingCheck(llmResult, comparisonResult) {
    const realArxivIds = new Set(
        comparisonResult.chunks.flatMap(c => c.topMatches.map(m => m.arxivId)).filter(Boolean)
    );

    const grounded = (llmResult.citedSources || []).filter(c => {
        const isReal = realArxivIds.has(c.arxivId);
        if (!isReal) {
            console.warn(`Grounding check: LLM cited "${c.arxivId}" which was not in the actual matched papers -- removed.`);
        }
        return isReal;
    });

    return { ...llmResult, citedSources: grounded };
}

/**
 * @param {object} comparisonResult - the full output of compareDocument()
 * @returns {Promise<{summary, noveltyVerdict, recommendations, citedSources}>}
 */
export async function generateRecommendation(comparisonResult) {
    const prompt = buildPrompt(comparisonResult);
    const rawText = await callGroq(prompt);

    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (firstErr) {
        try {
            // Fallback 1: strip markdown code fences
            const stripped = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
            parsed = JSON.parse(stripped);
        } catch {
            // Fallback 2: strip stray control characters
            const cleaned = rawText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
            parsed = JSON.parse(cleaned);
        }
    }

    return applyGroundingCheck(parsed, comparisonResult);
}