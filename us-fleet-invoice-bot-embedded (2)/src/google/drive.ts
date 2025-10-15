import { TELEGRAM_TOKEN, DRIVE_FOLDER_ID } from "../config.ts";
import { getAccessToken } from "./auth.ts";

async function tgFilePath(fileId: string) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const j = await r.json();
  if (!j.ok) throw new Error("telegram getFile failed");
  return j.result.file_path as string;
}
async function tgDownload(path: string) {
  const res = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${path}`);
  if (!res.ok) throw new Error("telegram file download failed");
  const mime = res.headers.get("content-type") || "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = path.split(".").pop() || "bin";
  return { bytes, mime, name: `invoice_${Date.now()}.${ext}` };
}
async function gdriveUpload(bytes: Uint8Array, mime: string, name: string) {
  const token = await getAccessToken();
  const meta = { name, parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined };
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  fd.append("media", new Blob([bytes], { type: mime }));
  const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  if (!up.ok) throw new Error(`drive upload ${up.status}`);
  const info = await up.json(); const id = info.id as string;
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return `https://drive.google.com/uc?id=${id}`;
}
export async function saveToDrive(_ctx: unknown, fileId: string): Promise<string> {
  const path = await tgFilePath(fileId);
  const f = await tgDownload(path);
  return await gdriveUpload(f.bytes, f.mime, f.name);
}
