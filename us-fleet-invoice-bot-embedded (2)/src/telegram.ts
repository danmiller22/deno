import { TELEGRAM_TOKEN } from "./config.ts";
const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
export async function sendMessage(chat_id: number, text: string, reply_markup?: any, reply_to_message_id?: number) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, reply_markup, reply_to_message_id, parse_mode: "HTML" }),
  });
}
export async function getFile(file_id: string) {
  const r = await fetch(`${API}/getFile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id }) });
  const j = await r.json();
  if (!j.ok) throw new Error("getFile failed");
  const path = j.result.file_path as string;
  const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${path}`;
  return { path, url };
}
export function kb(rows: string[][]) {
  return { keyboard: rows.map((r) => r.map((t) => ({ text: t }))), resize_keyboard: true, one_time_keyboard: true };
}
export async function answer(text: string) { return new Response(text, { status: 200 }); }
