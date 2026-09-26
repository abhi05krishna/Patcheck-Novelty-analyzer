import "dotenv/config";
import app from "./src/app.js";
import connectDB from "./src/config/config.js";
import { startPaperUpdateScheduler } from "./src/scripts/scheduler.js";

const PORT = process.env.PORT || 5000;
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API server running on ${PORT}`);
      startPaperUpdateScheduler();
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB, server not starting:", err.message);
    process.exit(1);
  });