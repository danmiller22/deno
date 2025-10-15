import { SHEET_ID, SHEET_NAME } from "../config.ts";
import { getAccessToken } from "./auth.ts";

export async function appendRow(values: (string | number)[]) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A1:append?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] }),
  });
  if (!r.ok) throw new Error(`Sheets ${r.status} ${await r.text()}`);
}
