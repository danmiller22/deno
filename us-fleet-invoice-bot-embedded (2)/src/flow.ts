import { kb, sendMessage, getFile } from "./telegram.ts";
import { appendRow } from "./google/sheets.ts";
import { uploadInvoiceFromUrl } from "./google/drive.ts";
import { getState, setState, setnx } from "./kv.ts";

const ASK = {
  assetType: () => kb([["Truck","Trailer"]]),
  location:  () => kb([["Shop","Roadside"],["Yard","TA/Petro"],["Loves","Other"]]),
};

function resolveReporter(from:any): string {
  if (!from) return "Unknown";
  if (from.username) return `@${from.username}`;
  const n = [from.first_name, from.last_name].filter(Boolean).join(" ");
  return n || "Unknown";
}

export async function start(chat: number, from: any) {
  await setState(chat, { step: "assetType", reportedBy: resolveReporter(from) });
  await sendMessage(chat, "New entry", kb([["Truck","Trailer"]]));
  await sendMessage(chat, "Select asset type:", ASK.assetType());
}

export async function onText(chat: number, text: string, from: any) {
  const st = await getState(chat) || { step: "assetType", reportedBy: resolveReporter(from) };

  switch (st.step) {
    case "assetType": {
      if (!/^(Truck|Trailer)$/i.test(text)) return sendMessage(chat, "Choose: Truck or Trailer", ASK.assetType());
      st.assetType = text;
      st.step = "assetNumber";
      await setState(chat, st);
      return sendMessage(chat, "Enter unit number:");
    }
    case "assetNumber": {
      if (!/^[A-Za-z0-9-]{3,}$/.test(text)) return sendMessage(chat, "Enter a valid unit number");
      st.assetNumber = text.toUpperCase();
      st.step = "location";
      await setState(chat, st);
      return sendMessage(chat, "Where was the repair?", ASK.location());
    }
    case "location": {
      st.location = text;
      st.step = "repair";
      await setState(chat, st);
      return sendMessage(chat, "Describe the repair (short):");
    }
    case "repair": {
      st.repair = text;
      st.step = "total";
      await setState(chat, st);
      return sendMessage(chat, "Total amount? Examples: 10, $10, 10,50");
    }
    case "total": {
      const n = parseAmount(text);
      if (n == null) return sendMessage(chat, "Enter a valid amount");
      st.total = n;
      st.step = "comments";
      await setState(chat, st);
      return sendMessage(chat, "Any comments? If none, send '-'");
    }
    case "comments": {
      st.comments = text === "-" ? "" : text;
      st.step = "invoice";
      await setState(chat, st);
      return sendMessage(chat, "Send invoice photo or file.");
    }
    default:
      return sendMessage(chat, "Use /new to start.");
  }
}

export async function onPhotoOrDoc(
  chat: number,
  messageId: number,
  photos: any[] | null,
  document: any | null,
  date: number,
  from: any,
) {
  const st = await getState(chat);
  if (!st || st.step !== "invoice") return sendMessage(chat, "Use /new to start.");

  try {
    await sendMessage(chat, "Processing...");
    let fileUrl = "", mime = "image/jpeg";

    if (photos && photos.length) {
      const best = photos[photos.length - 1];
      const f = await getFile(best.file_id);
      fileUrl = f.url;
      mime = "image/jpeg";
    } else if (document) {
      const f = await getFile(document.file_id);
      fileUrl = f.url;
      mime = document.mime_type || "application/octet-stream";
    } else {
      return sendMessage(chat, "Send a photo or a file (PDF/JPG).");
    }

    const title = `${st.assetType}-${st.assetNumber}-${date}`;
    const link = await uploadInvoiceFromUrl(title, fileUrl, mime);

    const msgKey = `${chat}:${messageId}`;
    if (!(await setnx(msgKey))) return sendMessage(chat, "Duplicate ignored");

    const iso = new Date(date * 1000).toISOString();
    await appendRow([
      iso,
      st.assetType,
      st.assetNumber,
      st.location,
      st.repair,
      st.total,
      st.comments || "",
      st.reportedBy || resolveReporter(from),
      link,
      msgKey,
    ]);
    await setState(chat, null);
    return sendMessage(chat, "Saved");
  } catch (e) {
    console.error("save error", e);
    return sendMessage(chat, "Failed to save. Check Drive/Sheet access and try again.");
  }
}

function parseAmount(s: string): number | null {
  const t = s.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  const n = Number(t);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}
