/**
 * Runs the paper-freshness pipeline within the API process.
 * The schedule is configured with PAPER_UPDATE_CRON and PAPER_UPDATE_TIMEZONE.
 */
import cron from "node-cron";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const DEFAULT_SCHEDULE = "0 3 * * 1"; // Monday, 03:00
const STAGES = [
  { name: "Update papers from arXiv", script: "src/scripts/updatePapersFromArxiv.js" },
  { name: "Generate embeddings", script: "src/scripts/generateEmbeddings.js" },
  { name: "Enrich citations", script: "src/scripts/enrichCitations.js" },
];
let pipelineRunning = false;

async function runStage(stage) {
  console.log(`\n=== ${stage.name} — starting ===`);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [stage.script], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20,
    });
    if (stdout) console.log(stdout);
    if (stderr) console.warn(stderr);
    console.log(`=== ${stage.name} — complete ===`);
  } catch (err) {
    console.error(`=== ${stage.name} — failed: ${err.message} ===`);
    console.error("Continuing to the next stage; each stage is independently resumable.");
  }
}

export async function runFullPipeline() {
  if (pipelineRunning) {
    console.warn("Paper update skipped because a previous pipeline run is still active.");
    return;
  }
  pipelineRunning = true;
  console.log(`\n########## Paper update started at ${new Date().toISOString()} ##########`);
  try {
    for (const stage of STAGES) await runStage(stage);
  } finally {
    pipelineRunning = false;
    console.log(`########## Paper update finished at ${new Date().toISOString()} ##########\n`);
  }
}

export function startPaperUpdateScheduler() {
  const schedule = process.env.PAPER_UPDATE_CRON || DEFAULT_SCHEDULE;
  const timezone = process.env.PAPER_UPDATE_TIMEZONE || "Asia/Kolkata";
  if (!cron.validate(schedule)) throw new Error(`Invalid PAPER_UPDATE_CRON expression: ${schedule}`);

  const task = cron.schedule(schedule, () => {
    runFullPipeline().catch((err) => console.error("Paper update crashed unexpectedly:", err));
  }, { timezone });

  console.log(`Paper update scheduler started: "${schedule}" (${timezone}).`);
  return task;
}

// Preserve a safe manual test command: npm run schedule:now
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  if (process.argv.includes("--now")) {
    runFullPipeline().catch((err) => { console.error("Manual paper update failed:", err); process.exitCode = 1; });
  } else {
    startPaperUpdateScheduler();
  }
}