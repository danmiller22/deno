export const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN")!;
export const SHEET_ID = Deno.env.get("SHEET_ID")!;
export const SHEET_NAME = Deno.env.get("SHEET_NAME") || "TMS";
export const DRIVE_FOLDER_ID = Deno.env.get("DRIVE_FOLDER_ID") || "";
export const SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;
if (!TELEGRAM_TOKEN || !SHEET_ID || !SA_JSON) throw new Error("Missing env");
