import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compareRoutes from "./routes/compare.route.js";
import uploadRoutes from "./routes/upload.route.js";
import authRoutes from "./routes/auth.route.js";
import historyRoutes from "./routes/history.route.js";
const app = express();
app.use(cors({
  origin: "https://patcheck-novelty-analyzer.vercel.app",
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", authRoutes);
app.use("/api", historyRoutes);
app.use("/api", compareRoutes);
app.use("/api", uploadRoutes);
export default app;
