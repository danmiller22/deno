export const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN")!;
export const GOOGLE_SA_JSON = Deno.env.get("GOOGLE_SA_JSON")!; // entire JSON string
export const SHEET_ID = Deno.env.get("SHEET_ID")!;
export const DRIVE_FOLDER_ID = Deno.env.get("DRIVE_FOLDER_ID")!;
export const ALLOWED_CHAT_IDS = (Deno.env.get("ALLOWED_CHAT_IDS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const DASHBOARD_WEEKLY_URL = Deno.env.get("DASHBOARD_WEEKLY_URL")!;
export const DASHBOARD_MONTHLY_URL = Deno.env.get("DASHBOARD_MONTHLY_URL")!;
export const TZ = Deno.env.get("TZ") || "America/Chicago";
