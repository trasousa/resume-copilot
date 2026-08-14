import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "..", "data");
const dbFile = path.join(dataDir, "db.json");

const defaultData = {
  cvs: [],          // { id, label, content, isMaster, sourceFile, createdAt, parentId }
  applications: [],  // { id, company, role, location, link, source, stage, jobPostText,
                     //   compEstimate, stageEnteredAt, appliedAt, notes, createdAt, updatedAt, cvId }
  documents: [],     // { id, applicationId, type, content, createdAt }
  chats: []          // { id, cvId, messages: [{role, content, createdAt}] }
};

const adapter = new JSONFile(dbFile);
export const db = new Low(adapter, defaultData);

export async function initDb() {
  await db.read();
  db.data ||= structuredClone(defaultData);
  for (const key of Object.keys(defaultData)) {
    if (!(key in db.data)) db.data[key] = structuredClone(defaultData[key]);
  }
  await db.write();
  return db;
}
