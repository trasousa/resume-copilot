// D1 access. Every function takes the D1 binding (env.DB) as its first
// argument -- Workers have no module-level connection to hold.
//
// Rows are snake_case in SQL and camelCase over the wire, so the frontend
// keeps working unchanged. The row<->object mapping lives here and nowhere
// else.

export const STAGES = [
  "saved",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];

const cvFromRow = (r) =>
  r && {
    id: r.id,
    label: r.label,
    content: r.content,
    isMaster: !!r.is_master,
    parentId: r.parent_id,
    sourceFile: r.source_file ?? undefined,
    createdAt: r.created_at,
  };

const appFromRow = (r) =>
  r && {
    id: r.id,
    company: r.company,
    role: r.role,
    location: r.location,
    link: r.link,
    source: r.source,
    jobPostText: r.job_post_text,
    cvId: r.cv_id,
    stage: r.stage,
    stageEnteredAt: r.stage_entered_at,
    appliedAt: r.applied_at,
    compEstimate: r.comp_estimate,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

const docFromRow = (r) =>
  r && {
    id: r.id,
    applicationId: r.application_id,
    type: r.type,
    content: r.content,
    createdAt: r.created_at,
  };

// --- CVs -------------------------------------------------------------------

export async function listCvs(db) {
  const { results } = await db
    .prepare("SELECT * FROM cvs ORDER BY created_at DESC")
    .all();
  return results.map(cvFromRow);
}

export async function getCv(db, id) {
  return cvFromRow(
    await db.prepare("SELECT * FROM cvs WHERE id = ?").bind(id).first()
  );
}

export async function getMasterCv(db) {
  return cvFromRow(
    await db.prepare("SELECT * FROM cvs WHERE is_master = 1 LIMIT 1").first()
  );
}

/** The CV to work from: an explicit id if it resolves, else the master. */
export async function resolveCv(db, id) {
  return (id && (await getCv(db, id))) || (await getMasterCv(db));
}

export async function createCv(db, cv) {
  const stmts = [];
  // A new master demotes the others, atomically with the insert.
  if (cv.isMaster) stmts.push(db.prepare("UPDATE cvs SET is_master = 0"));
  stmts.push(
    db
      .prepare(
        `INSERT INTO cvs (id, label, content, is_master, parent_id, source_file, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        cv.id,
        cv.label,
        cv.content,
        cv.isMaster ? 1 : 0,
        cv.parentId ?? null,
        cv.sourceFile ?? null,
        cv.createdAt
      )
  );
  await db.batch(stmts);
  return cv;
}

export async function setMasterCv(db, id) {
  await db.batch([
    db.prepare("UPDATE cvs SET is_master = 0"),
    db.prepare("UPDATE cvs SET is_master = 1 WHERE id = ?").bind(id),
  ]);
  return getCv(db, id);
}

export async function deleteCv(db, id) {
  await db.prepare("DELETE FROM cvs WHERE id = ?").bind(id).run();
}

export async function countCvs(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM cvs").first();
  return row?.n ?? 0;
}

// --- Applications ----------------------------------------------------------

export async function listApplications(db) {
  const { results } = await db
    .prepare("SELECT * FROM applications ORDER BY updated_at DESC")
    .all();
  return results.map(appFromRow);
}

export async function getApplication(db, id) {
  return appFromRow(
    await db.prepare("SELECT * FROM applications WHERE id = ?").bind(id).first()
  );
}

export async function createApplication(db, app) {
  await db
    .prepare(
      `INSERT INTO applications
         (id, company, role, location, link, source, job_post_text, cv_id,
          stage, stage_entered_at, applied_at, comp_estimate, notes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      app.id,
      app.company,
      app.role,
      app.location,
      app.link,
      app.source,
      app.jobPostText,
      app.cvId,
      app.stage,
      app.stageEnteredAt,
      app.appliedAt,
      app.compEstimate,
      app.notes,
      app.createdAt,
      app.updatedAt
    )
    .run();
  return app;
}

const PATCHABLE = {
  notes: "notes",
  link: "link",
  location: "location",
  compEstimate: "comp_estimate",
  cvId: "cv_id",
  jobPostText: "job_post_text",
};

/**
 * Targeted UPDATE of only the supplied fields.
 *
 * This is the fix for the lost-write bug: the old code re-serialised the whole
 * database over a snapshot it had read before a 30-90s Claude call, so any
 * concurrent edit vanished. Here a slow route touches only its own columns.
 */
export async function updateApplication(db, id, patch) {
  const sets = [];
  const vals = [];

  for (const [key, col] of Object.entries(PATCHABLE)) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(patch[key]);
    }
  }

  if (patch.stage !== undefined) {
    const now = new Date().toISOString();
    sets.push("stage = ?", "stage_entered_at = ?");
    vals.push(patch.stage, now);
    // First transition into "applied" records the date; later ones don't.
    if (patch.stage === "applied") {
      sets.push("applied_at = COALESCE(applied_at, ?)");
      vals.push(now);
    }
  }

  if (!sets.length) return getApplication(db, id);

  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), id);

  await db
    .prepare(`UPDATE applications SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();

  return getApplication(db, id);
}

export async function deleteApplication(db, id) {
  await db.prepare("DELETE FROM applications WHERE id = ?").bind(id).run();
}

// --- Documents -------------------------------------------------------------

export async function listDocuments(db, applicationId) {
  const { results } = await db
    .prepare(
      "SELECT * FROM documents WHERE application_id = ? ORDER BY created_at"
    )
    .bind(applicationId)
    .all();
  return results.map(docFromRow);
}

export async function createDocument(db, doc) {
  await db
    .prepare(
      `INSERT INTO documents (id, application_id, type, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(doc.id, doc.applicationId, doc.type, doc.content, doc.createdAt)
    .run();
  return doc;
}

export async function deleteDocument(db, id) {
  await db.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
}

// --- Chat ------------------------------------------------------------------

export async function listChatMessages(db, cvId) {
  const { results } = await db
    .prepare(
      "SELECT * FROM chat_messages WHERE cv_id = ? ORDER BY created_at"
    )
    .bind(cvId)
    .all();
  return results.map((r) => ({
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export async function addChatMessage(db, msg) {
  await db
    .prepare(
      `INSERT INTO chat_messages (id, cv_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(msg.id, msg.cvId, msg.role, msg.content, msg.createdAt)
    .run();
}
