import type { ProjectRow, FeedbackRow, FeedbackStatus } from "../types";

export const VALID_STATUSES: readonly FeedbackStatus[] = [
  "pending", "diagnosing", "diagnosed", "confirmed", "fixing", "fixed", "rejected", "needs_review",
] as const;

interface InsertProjectInput {
  id: string;
  name: string;
  repo: string;
  description?: string;
}

interface InsertFeedbackInput {
  project_id: string;
  source: "telegram" | "google_form";
  description: string;
  reporter_id?: string;
  reporter_name?: string;
  screenshot_urls?: string[];
}

interface DiagnoseInput {
  diagnosis: string;
  fix_plan: string;
}

interface StatusUpdateInput {
  status: FeedbackStatus;
  pr_url?: string;
}

export async function insertProject(
  db: D1Database,
  input: InsertProjectInput
): Promise<ProjectRow> {
  const row = await db
    .prepare(
      "INSERT INTO projects (id, name, repo, description) VALUES (?1, ?2, ?3, ?4) RETURNING *"
    )
    .bind(input.id, input.name, input.repo, input.description ?? "")
    .first<ProjectRow>();

  if (!row) throw new Error("Failed to insert project");
  return row;
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM projects ORDER BY created_at")
    .all<ProjectRow>();
  return results;
}

export async function insertFeedback(
  db: D1Database,
  input: InsertFeedbackInput
): Promise<FeedbackRow> {
  const screenshotJson = JSON.stringify(input.screenshot_urls ?? []);
  const row = await db
    .prepare(
      `INSERT INTO feedbacks (project_id, source, description, reporter_id, reporter_name, screenshot_urls)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       RETURNING *`
    )
    .bind(
      input.project_id,
      input.source,
      input.description,
      input.reporter_id ?? "",
      input.reporter_name ?? "",
      screenshotJson
    )
    .first<FeedbackRow>();

  if (!row) throw new Error("Failed to insert feedback");
  return row;
}

export async function listFeedbacksByStatus(
  db: D1Database,
  status: FeedbackStatus
): Promise<FeedbackRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM feedbacks WHERE status = ?1 ORDER BY created_at ASC"
    )
    .bind(status)
    .all<FeedbackRow>();
  return results;
}

export async function updateFeedbackDiagnosis(
  db: D1Database,
  id: number,
  input: DiagnoseInput
): Promise<FeedbackRow> {
  const row = await db
    .prepare(
      `UPDATE feedbacks
       SET diagnosis = ?1, fix_plan = ?2, status = 'diagnosed', updated_at = datetime('now')
       WHERE id = ?3
       RETURNING *`
    )
    .bind(input.diagnosis, input.fix_plan, id)
    .first<FeedbackRow>();

  if (!row) throw new Error(`Feedback ${id} not found`);
  return row;
}

export async function updateFeedbackStatus(
  db: D1Database,
  id: number,
  input: StatusUpdateInput
): Promise<FeedbackRow> {
  const row = await db
    .prepare(
      `UPDATE feedbacks
       SET status = ?1, pr_url = COALESCE(?2, pr_url), updated_at = datetime('now')
       WHERE id = ?3
       RETURNING *`
    )
    .bind(input.status, input.pr_url ?? null, id)
    .first<FeedbackRow>();

  if (!row) throw new Error(`Feedback ${id} not found`);
  return row;
}

export async function getFeedbackById(
  db: D1Database,
  id: number
): Promise<FeedbackRow | null> {
  return db
    .prepare("SELECT * FROM feedbacks WHERE id = ?1")
    .bind(id)
    .first<FeedbackRow>();
}

export async function incrementRetryCount(
  db: D1Database,
  id: number
): Promise<FeedbackRow> {
  const row = await db
    .prepare(
      `UPDATE feedbacks
       SET retry_count = retry_count + 1, updated_at = datetime('now')
       WHERE id = ?1
       RETURNING *`
    )
    .bind(id)
    .first<FeedbackRow>();

  if (!row) throw new Error(`Feedback ${id} not found`);
  return row;
}

export async function getGoogleSheetCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT last_row FROM google_sheet_cursor WHERE id = 1")
    .first<{ last_row: number }>();
  return row?.last_row ?? 1;
}

export async function setGoogleSheetCursor(
  db: D1Database,
  lastRow: number
): Promise<void> {
  await db
    .prepare("UPDATE google_sheet_cursor SET last_row = ?1 WHERE id = 1")
    .bind(lastRow)
    .run();
}

export async function getTelegramSession(
  db: D1Database,
  userId: number
): Promise<string | null> {
  const row = await db
    .prepare("SELECT project_id FROM telegram_sessions WHERE user_id = ?1")
    .bind(userId)
    .first<{ project_id: string }>();
  return row?.project_id ?? null;
}

export async function setTelegramSession(
  db: D1Database,
  userId: number,
  projectId: string
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO telegram_sessions (user_id, project_id) VALUES (?1, ?2)"
    )
    .bind(userId, projectId)
    .run();
}

export async function deleteTelegramSession(
  db: D1Database,
  userId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM telegram_sessions WHERE user_id = ?1")
    .bind(userId)
    .run();
}
