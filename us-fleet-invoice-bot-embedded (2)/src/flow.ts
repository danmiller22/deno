import { kb, sendMessage, getFile } from "./telegram.ts";
import { appendRow } from "./google/sheets.ts";
import { uploadInvoiceFromUrl } from "./google/drive.ts";
import { getState, setState, setnx } from "./kv.ts";

const ASK = {
  assetType: () => kb([["Truck", "Trailer"], ["Cancel"]]),
  location: () => kb([["Shop", "Roadside"], ["Yard", "TA/Petro"], ["Loves", "Other"]]),
  reporter: () => kb([["Driver", "Dispatcher"], ["Mechanic", "Other"]]),
};

export async function start(chat: number) {
  await setState(chat, { step: "assetType" });
  await sendMessage(chat, "Asset type?", ASK.assetType());
}

export async function onText(chat: number, text: string) {
  const st = await getState(chat) || { step: "assetType" };
  switch (st.step) {
    case "assetType": {
      if (!(/^(Truck|Trailer)$/i).test(text)) return sendMessage(chat, "Choose Truck or Trailer", ASK.assetType());
      st.assetType = text;
      st.step = "assetNumber";
      await setState(chat, st);
      return sendMessage(chat, "Asset number? e.g. 12345 or ABC-12");
    }
    case "assetNumber": {
      if (!/^[A-Za-z0-9-]{3,}$/.test(text)) return sendMessage(chat, "Enter a valid asset number");
      st.assetNumber = text.toUpperCase();
      st.step = "location";
      await setState(chat, st);
      return sendMessage(chat, "Where was the repair?", ASK.location());
    }
    case "location": {
      st.location = text;
      st.step = "repair";
      await setState(chat, st);
      return sendMessage(chat, "Repair summary? (short)");
    }
    case "repair": {
      st.repair = text;
      st.step = "total";
      await setState(chat, st);
      return sendMessage(chat, "Total amount? e.g. 1250.50 or $1,250.50");
    }
    case "total": {
      const n = parseAmount(text);
      if (n == null) return sendMessage(chat, "Enter a valid amount");
      st.total = n;
      st.step = "comments";
      await setState(chat, st);
      return sendMessage(chat, "Comments? (optional). Send '-' to skip");
    }
    case "comments": {
      st.comments = text === "-" ? "" : text;
      st.step = "reportedBy";
      await setState(chat, st);
      return sendMessage(chat, "Who is reporting?", ASK.reporter());
    }
    case "reportedBy": {
      st.reportedBy = text;
      st.step = "photo";
      await setState(chat, st);
      return sendMessage(chat, "Send the invoice photo now");
    }
    default:
      return sendMessage(chat, "Use /new to start.");
  }
}

export async function onPhoto(chat: number, messageId: number, photos: any[], date: number) {
  const st = await getState(chat);
  if (!st || st.step !== "photo") return sendMessage(chat, "Use /new to start.");
  const best = photos[photos.length - 1];
  const { url } = await getFile(best.file_id);
  const title = `${st.assetType}-${st.assetNumber}-${date}`;
  const link = await uploadInvoiceFromUrl(title, url);

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
    st.reportedBy,
    link,
    msgKey,
  ]);
  await setState(chat, null);
  return sendMessage(chat, "Saved");
}

function parseAmount(s: string): number | null {
  const t = s.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}
