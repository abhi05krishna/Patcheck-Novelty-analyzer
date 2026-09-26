import express from "express";
import { deleteHistoryItem, listHistory } from "../controllers/history.controller.js";
import { requireAuth } from "../middleware/authenticate.js";
const router = express.Router();
router.get("/history", requireAuth, listHistory);
router.delete("/history/:id", requireAuth, deleteHistoryItem);
export default router;