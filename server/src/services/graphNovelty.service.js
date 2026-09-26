/**
 * graphNovelty.service.js
 *
 * Turns citation counts of a submission's matched papers into a
 * novelty component. Deliberately just math -- no external API call
 * (that already happened once, in enrichCitations.js, and got cached
 * on the Paper documents) and no model, so this belongs in Node, not
 * the Python ML service.
 *
 * HEURISTIC, stated plainly: if a submission's closest semantic
 * matches are heavily-cited, well-established papers, it's treading
 * familiar ground -- lower novelty. If the closest matches are
 * themselves obscure/uncited, that suggests a less-charted area. This
 * is a simple, explainable proxy, NOT a trained model -- describe it
 * that way in any writeup ("citation-metadata-informed scoring"), not
 * as "graph neural network," which was never built.
 */

/**
 * @param {Array<{citationCount: number|null}>} matchedPapers - the
 *   Paper documents (or a subset with just citationCount) corresponding
 *   to a submission's top semantic matches
 * @returns {number} score in [0, 1], higher = more novel
 */
export function computeGraphNoveltyScore(matchedPapers) {
    if (!matchedPapers || matchedPapers.length === 0) {
        // No matches at all -- maximally novel by this signal, but this
        // says more about corpus coverage than confirmed originality.
        // The caller (compare endpoint) should surface that distinction
        // to the user rather than presenting it as a confident verdict.
        return 1;
    }

    const validCounts = matchedPapers
        .map(p => p.citationCount)
        .filter(c => c !== null && c !== undefined);

    if (validCounts.length === 0) {
        // None of the matches have citation data cached yet (enrichCitations.js
        // hasn't reached them, or they're not indexed by Semantic Scholar).
        // Return neutral rather than letting a missing signal masquerade
        // as a real "novel" or "not novel" verdict.
        return 0.5;
    }

    const avgCitations = validCounts.reduce((a, b) => a + b, 0) / validCounts.length;

    // Log-scale and invert: heavily-cited neighborhood -> low novelty.
    // The 100-citation reference point is a starting assumption, not a
    // validated constant -- if you build the hand-labeled evaluation set
    // discussed earlier, this is one of the things worth checking against
    // real judgments rather than trusting as-is.
    const normalized = Math.min(Math.log10(avgCitations + 1) / Math.log10(101), 1);
    return 1 - normalized;
}
