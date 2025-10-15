import { SHEET_ID, SHEET_NAME } from "../config.ts";
import { getAccessToken } from "./auth.ts";

const RANGE = encodeURIComponent(`${SHEET_NAME}!A:H`);

export async function appendRow(values: (string | number)[]) {
  const token = await getAccessToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] }),
  });
  if (!r.ok) throw new Error(await r.text());
}
