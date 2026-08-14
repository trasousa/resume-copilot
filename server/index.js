import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initDb } from "./lib/db.js";
import { listSkills } from "./lib/skills.js";
import cvsRouter from "./routes/cvs.js";
import applicationsRouter from "./routes/applications.js";
import documentsRouter from "./routes/documents.js";
import jobsearchRouter from "./routes/jobsearch.js";
import tailorRouter from "./routes/tailor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/cvs", cvsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/applications/:id/documents", documentsRouter);
app.use("/api/jobsearch", jobsearchRouter);
app.use("/api/tailor", tailorRouter);

app.get("/api/skills", (_req, res) => {
  res.json(listSkills());
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Centralized error handler -- every route's async errors land here via next(err).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 4173;

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`resume-copilot running at http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("⚠️  ANTHROPIC_API_KEY is not set -- AI features will fail until you set it in .env");
    }
  });
});
