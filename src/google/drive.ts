import { getAccessToken } from "./auth.ts";
import { DRIVE_FOLDER_ID } from "../config.ts";

export async function uploadInvoiceFromUrl(title: string, url: string, mime = "image/jpeg") {
  const token = await getAccessToken();
  const meta = { name: title, parents: [DRIVE_FOLDER_ID] };
  const boundary = "deno--" + crypto.randomUUID();
  const body = new Uint8Array([
    ...new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`),
    ...new TextEncoder().encode(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    ...new Uint8Array(await (await fetch(url)).arrayBuffer()),
    ...new TextEncoder().encode(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await res.json();
  if (!file.id) throw new Error("drive upload failed: " + JSON.stringify(file));
  // make public link
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return `https://drive.google.com/uc?id=${file.id}`;
}
