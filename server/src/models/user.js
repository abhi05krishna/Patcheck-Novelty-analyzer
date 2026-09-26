import mongoose from "mongoose";
const userSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 80 }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true }, tokenVersion: { type: Number, default: 0 } }, { timestamps: true });
export default mongoose.model("User", userSchema);