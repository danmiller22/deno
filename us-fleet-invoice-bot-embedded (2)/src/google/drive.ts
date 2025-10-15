// src/google/drive.ts
// Upload invoice file from Telegram to Google Drive and return share link.
import { TELEGRAM_TOKEN, DRIVE_FOLDER_ID } from "../config.ts";
import { getAccessToken } from "./auth.ts";

async function tgGetFilePath(fileId: string): Promise<string> {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const j = await r.json();
  if (!j.ok) throw new Error("telegram getFile failed");
  return j.result.file_path as string;
}

async function tgDownload(filePath: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("telegram file download failed");
  const mime = res.headers.get("content-type") || "application/octet-stream";
  const arr = new Uint8Array(await res.arrayBuffer());
  const ext = filePath.includes(".") ? filePath.split(".").pop() : "bin";
  const name = `invoice_${Date.now()}.${ext}`;
  return { bytes: arr, mime, name };
}

async function gdriveUpload(bytes: Uint8Array, mime: string, name: string): Promise<string> {
  const token = await getAccessToken();
  const meta = { name, parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined };

  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  fd.append("media", new Blob([bytes], { type: mime }));

  const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!up.ok) throw new Error(`drive upload ${up.status}`);
  const info = await up.json();
  const fileId = info.id as string;

  // make link readable
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return `https://drive.google.com/uc?id=${fileId}`;
}

export async function saveToDrive(ctx: unknown, fileId: string): Promise<string> {
  // ctx не используется здесь; оставлен для совместимости сигнатуры
  const path = await tgGetFilePath(fileId);
  const { bytes, mime, name } = await tgDownload(path);
  return await gdriveUpload(bytes, mime, name);
}
