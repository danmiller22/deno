// main.ts — Deno Deploy
// ENV: TELEGRAM_TOKEN, SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY (с \n), WEBHOOK_SECRET (любой), TZ=America/Chicago (пример)

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN")!;
const SHEET_ID = Deno.env.get("SHEET_ID")!;
const CLIENT_EMAIL = Deno.env.get("GOOGLE_CLIENT_EMAIL")!;
const PRIVATE_KEY = (Deno.env.get("GOOGLE_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "secret";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const kv = await Deno.openKv().catch(() => undefined);

type TUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number; title?: string; username?: string; type: string; };
    from?: { id: number; first_name?: string; last_name?: string; username?: string; };
    text?: string;
    caption?: string;
    photo?: { file_id: string; file_unique_id: string; width: number; height: number; }[];
    document?: { file_id: string; file_name?: string; mime_type?: string; };
  };
};

function tsToDateStr(ts: number) {
  // UTC→локаль не нужен: пиши ISO в шит
  return new Date(ts * 1000).toISOString();
}

async function getAccessToken(): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = btoa(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp,
    iat
  }));
  const encoder = new TextEncoder();
  const toSign = `${header}.${claimSet}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(toSign));
  const jwt = `${toSign}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GAuth ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

function pemToArrayBuffer(pem: string) {
  const b64 = pem.replace(/-----.*?-----/g, "").replace(/\s+/g, "");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

async function appendRow(values: any[]) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const body = { values: [values] };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Sheets ${r.status} ${await r.text()}`);
}

async function tg(method: string, payload: Record<string, any>) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`[tg.${method}] ${r.status} ${JSON.stringify(j)}`);
  return j.result;
}

async function getFileUrl(file_id: string): Promise<string> {
  const { file_path } = await tg("getFile", { file_id });
  // URL содержит токен. Если хочешь — отключим и будем заливать в Drive на шаге 2.
  return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file_path}`;
}

// Либеральный парсер полей из caption/text
function parseFields(text: string) {
  const comments = text.trim();
  const amountMatch = text.match(/(?:^|\s)(?:\$)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})|\d+(?:[.,]\d{1,2}))/i);
  const total = amountMatch ? amountMatch[1].replace(",", ".") : "";
  const paidByMatch = text.match(/\bpaid\s*by\s*[:\-]?\s*(company|driver)/i);
  const paidBy = paidByMatch ? paidByMatch[1].toLowerCase() : "";
  const assetMatch = text.match(/\b(truck|trailer)\s*[:\-]?\s*([A-Z0-9\-]+)/i);
  const asset = assetMatch ? `${assetMatch[1]} ${assetMatch[2]}` : "";
  // Repair — первая осмысленная строка без суммы
  const firstLine = text.split(/\n/).map(s => s.trim()).find(s => s && !s.includes("$"));
  const repair = firstLine || "";
  return { asset, repair, total, paidBy, comments };
}

async function handleUpdate(upd: TUpdate) {
  if (!upd.message) return;
  if (kv) {
    const key = ["upd", upd.update_id];
    const seen = await kv.get(key);
    if (seen?.value) return; // дубликат
    await kv.set(key, 1, { expireIn: 1000 * 60 * 60 * 24 });
  }

  const msg = upd.message;
  const text = (msg.caption || msg.text || "").slice(0, 4000);
  const { asset, repair, total, paidBy, comments } = parseFields(text);
  const reportedBy = msg.from?.username || msg.from?.first_name || "";
  const msgKey = `${msg.chat.id}:${msg.message_id}:${upd.update_id}`;

  let invoiceLink = "";
  if (msg.photo && msg.photo.length) {
    // берем самый крупный
    invoiceLink = await getFileUrl(msg.photo[msg.photo.length - 1].file_id);
  } else if (msg.document?.file_id) {
    invoiceLink = await getFileUrl(msg.document.file_id);
  }

  const row = [
    tsToDateStr(msg.date),
    asset,            // Asset
    repair,           // Repair
    total,            // Total Amount
    invoiceLink,      // InvoiceLink
    paidBy,           // PaidBy
    comments,         // Comments
    reportedBy,       // ReportedBy
    msgKey            // MsgKey
  ];

  await appendRow(row);

  // немой ответ, чтобы телега не ждала
  if (msg.chat.type !== "channel") {
    await tg("sendMessage", { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: "ok" }).catch(() => {});
  }
}

function verifySecret(req: Request) {
  const url = new URL(req.url);
  return url.searchParams.get("token") === WEBHOOK_SECRET;
}

Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("ok");
  if (req.method === "POST") {
    if (!verifySecret(req)) return new Response("forbidden", { status: 403 });
    const upd = await req.json() as TUpdate;
    try {
      await handleUpdate(upd);
      return new Response("OK");
    } catch (e) {
      // минимальный лог в ответ для отладки
      return new Response(`ERR ${String(e)}`, { status: 200 });
    }
  }
  return new Response("method not allowed", { status: 405 });
});
