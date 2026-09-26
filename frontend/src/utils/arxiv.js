// Older CSV imports stored the arXiv URL path as an ID (for example,
// "abs-2112.12940v1"), while newer sources store the clean ID directly.
export function toRealArxivUrl(rawId) {
  const cleanedId = rawId.replace(/^abs-/, "");
  return `https://arxiv.org/abs/${cleanedId}`;
}
