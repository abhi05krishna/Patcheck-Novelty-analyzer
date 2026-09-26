import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import mammoth from "mammoth";

// pdf-parse@2.4.5's export shape doesn't map cleanly to ES module's
// `import default` syntax (confirmed: plain `import pdfParse from
// "pdf-parse"` either throws "does not provide an export named
// 'default'" or silently leaves pdfParse undefined depending on how
// Node resolves it). createRequire loads it the way CommonJS always
// could, sidestepping the ESM interop question entirely.
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

/**
 * fileExtraction.service.js
 *
 * Extracts plain text from an uploaded file, dispatched by extension.
 * Returns plain text -- callers (the upload controller) just hand this
 * straight to the EXISTING compareDocument() function, unchanged. No
 * new comparison logic needed here; this is purely "get text out of a
 * file."
 *
 * VERSION NOTE: pdf-parse's API has changed across major versions
 * historically. This uses the commonly-documented pattern (pass a
 * Buffer, get back {text, ...}) -- if your installed pdf-parse@2.4.5
 * has a different export shape, this will error clearly on the first
 * real PDF upload rather than silently misbehaving; report the exact
 * error back if that happens and it's a quick fix.
 *
 * NOT SUPPORTED: legacy .doc (binary Word format, pre-2007) -- only
 * modern .docx. Parsing old .doc reliably needs a much heavier
 * dependency for limited benefit; if a user hits this, the file
 * filter in multer.config.js already rejects it with a clear message
 * before it gets here.
 */

export async function extractTextFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case ".pdf":
            return extractFromPdf(filePath);
        case ".docx":
            return extractFromDocx(filePath);
        case ".txt":
            return extractFromTxt(filePath);
        default:
            throw new Error(`No extractor for file type "${ext}"`);
    }
}

async function extractFromPdf(filePath) {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
}

async function extractFromDocx(filePath) {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

async function extractFromTxt(filePath) {
    return fs.readFile(filePath, "utf8");
}
