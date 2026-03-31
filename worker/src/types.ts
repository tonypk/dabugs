export interface Env {
  DB: D1Database;
  DABUGS_API_KEY: string;
  BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  GOOGLE_SHEET_ID: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  repo: string;
  description: string;
  created_at: string;
}

export interface FeedbackRow {
  id: number;
  project_id: string;
  source: "telegram" | "google_form";
  status: string;
  description: string;
  screenshot_urls: string;
  reporter_id: string;
  reporter_name: string;
  diagnosis: string;
  fix_plan: string;
  pr_url: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export type FeedbackStatus =
  | "pending"
  | "diagnosing"
  | "diagnosed"
  | "confirmed"
  | "fixing"
  | "fixed"
  | "rejected"
  | "needs_review";
