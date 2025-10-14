import { getAccessToken } from "./auth.ts";
import { SHEET_ID } from "../config.ts";

// Пишем в лист "TMS"
const RANGE = "TMS!A1";

export async function appendRow(values: any[]) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(RANGE)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) throw new Error(`Sheets HTTP ${res.status}: ${await res.text()}`);
}
