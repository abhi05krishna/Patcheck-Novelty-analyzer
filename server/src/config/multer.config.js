import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = "uploads";
const MAX_FILE_SIZE_MB = 10;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        // timestamp + original name -- unique enough for a single-user
        // dev setup; if this ever gets real concurrent traffic, swap for
        // a proper uuid to rule out collisions entirely
        const unique = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
        cb(null, unique);
    }
});

function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return cb(new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
    }
    cb(null, true);
}

export const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 }
});
