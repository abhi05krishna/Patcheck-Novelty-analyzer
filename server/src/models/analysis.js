import mongoose from "mongoose";
const analysisSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }, title: { type: String, required: true, maxlength: 140 }, result: { type: mongoose.Schema.Types.Mixed, required: true } }, { timestamps: true });
export default mongoose.model("Analysis", analysisSchema);