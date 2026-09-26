import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

/**
 * Connects to MongoDB once. Every script in this pipeline calls this
 * at startup before touching any model.
 */
export default async function connectDB() {
    if (!process.env.MONGO_URI) {
        throw new Error(
            "MONGO_URI is not set. Copy .env.example to .env and fill in your connection string."
        );
    }

    mongoose.connection.on("error", err => {
        console.error("MongoDB connection error:", err.message);
    });

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
}