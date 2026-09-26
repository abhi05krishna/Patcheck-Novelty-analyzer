import Analysis from "../models/analysis.js";

export async function listHistory(req, res) {
  const items = await Analysis.find({ userId: req.auth.sub }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ items });
}

export async function saveAnalysis(userId, submittedText, result) {
  const title = submittedText?.replace(/\s+/g, " ").trim().slice(0, 120) || "Uploaded research document";
  return Analysis.create({ userId, title, result });
}

export async function deleteHistoryItem(req, res) {
  const deleted = await Analysis.findOneAndDelete({ _id: req.params.id, userId: req.auth.sub });
  if (!deleted) return res.status(404).json({ error: "Analysis not found." });
  return res.status(204).send();
}