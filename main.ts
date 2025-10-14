// Deno Deploy: Telegram → Google Sheets (SA) + Google Drive (SA) + Debug
// ENV required:
// BOT_TOKEN, SHEET_ID, GDRIVE_FOLDER_ID, GDRIVE_SA_EMAIL, GDRIVE_SA_KEY
// Optional: DASHBOARD_URL, REPORT_CHAT_ID, REPORT_THREAD_ID
import { SignJWT, importPKCS8 } from "npm:jose@5.2.4";

type Tg = { update_id?: number; message?: any; callback_query?: any };

const BOT = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${BOT}`;
const DASH = Deno.env.get("DASHBOARD_URL") ?? "";
const REPORT_CHAT = Deno.env.get("REPORT_CHAT_ID") ?? "";
const REPORT_THREAD = Deno.env.get("REPORT_THREAD_ID") ?? "";

const SHEET_ID = Deno.env.get("SHEET_ID") ?? "";
const DRIVE_FOLDER = Deno.env.get("GDRIVE_FOLDER_ID") ?? "";
const SA_EMAIL = Deno.env.get("GDRIVE_SA_EMAIL") ?? "";
const SA_KEY_RAW = Deno.env.get("GDRIVE_SA_KEY") ?? "";

const kv = await Deno.openKv();

// ---------- utils ----------
const j = (x: unknown) => JSON.stringify(x);
const json = (x: unknown, s = 200) =>
  new Response(j(x), { status: s, headers: { "content-type": "application/json" } });

const firstLine = (t = "") =>
  t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? "";

function parseAmount(s = "") {
  s = s.replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;
  const c = s.lastIndexOf(","), d = s.lastIndexOf(".");
  if (c > -1 && d > -1) s = (c > d) ? s.replace(/\./g, "") : s.replace(/,/g, "");
  else if (c > -1) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const safe = (s = "") => s.replace(/[^\w.-]/g, "_");

async function logErr(tag: string, detail: unknown) {
  const rec = { ts: new Date().toISOString(), tag, detail };
  console.error(tag, detail);
  await kv.set(["err", "last"], rec, { expireIn: 6 * 3600_000 });
}

function pemFromEnv(raw: string) {
  let s = (raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!s.includes("BEGIN PRIVATE KEY") || !s.includes("END PRIVATE KEY")) throw new Error("Bad SA key");
  return s;
}

// ---------- SA OAuth ----------
async function saToken(scope: string): Promise<string> {
  const key = await importPKCS8(pemFromEnv(SA_KEY_RAW), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const aud = "https://oauth2.googleapis.com/token";
  const jwt = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(SA_EMAIL).setSubject(SA_EMAIL)
    .setAudience(aud).setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const r = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) {
    await logErr("sa/token", { status: r.status, text: await r.text() });
    throw new Error("sa token failed");
  }
  const data = await r.json();
  return data.access_token as string;
}

// ---------- Google Drive ----------
function multipartMetaMedia(meta: Record<string, unknown>, media: Uint8Array, mime: string) {
  const boundary = "deno-" + crypto.randomUUID();
  const enc = new TextEncoder();
  const p1 = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`);
  const p2 = enc.encode(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const p3 = enc.encode(`\r\n--${boundary}--\r\n`);
  const buf = new Uint8Array(p1.length + p2.length + media.length + p3.length);
  buf.set(p1, 0); buf.set(p2, p1.length); buf.set(media, p1.length + p2.length); buf.set(p3, p1.length + p2.length + media.length);
  return { body: buf, boundary };
}

async function driveUpload(bytes: Uint8Array, filename: string, mime: string) {
  if (!DRIVE_FOLDER) throw new Error("GDRIVE_FOLDER_ID missing");
  const token = await saToken("https://www.googleapis.com/auth/drive");
  const meta = { name: filename, parents: [DRIVE_FOLDER] };
  const { body, boundary } = multipartMetaMedia(meta, bytes, mime);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) {
    await logErr("drive/upload", { status: r.status, text: await r.text() });
    throw new Error("drive upload failed");
  }
  const file = await r.json();

  // make public
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  }).catch(() => {});
  return `https://drive.google.com/uc?id=${file.id}&export=download`;
}

// ---------- Google Sheets ----------
async function sheetsAppend(values: any[]) {
  if (!SHEET_ID) throw new Error("SHEET_ID missing");
  const token = await saToken("https://www.googleapis.com/auth/spreadsheets");

  // ensure headers once
  try {
    const r1 = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:Z1?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const got = r1.ok ? await r1.json() : null;
    if (!got?.values) {
      const headers = [["ts","asset","unit","repair","total","paid_by","comments","reporter","file_url","msg_key"]];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=RAW`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: headers, range: "A1" }),
      }).catch(() => {});
    }
  } catch (_) {}

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range: "A1", values: [values] }),
  });
  if (!r.ok) {
    await logErr("sheets/append", { status: r.status, text: await r.text() });
    throw new Error("sheets append failed");
  }
}

// ---------- Telegram ----------
async function tg(method: string, payload: unknown) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: j(payload),
  });
  if (!r.ok) throw new Error(`${method} ${r.status} ${await r.text()}`);
  return r.json();
}
const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
const edit = (chat_id: number, message_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...extra });
const answerCb = (id: string) => tg("answerCallbackQuery", { callback_query_id: id });

async function tgFilePath(file_id: string) { const { result } = await tg("getFile", { file_id }) as any; return result.file_path as string; }
async function downloadTelegramFile(file_id: string) {
  const path = await tgFilePath(file_id);
  const url = `https://api.telegram.org/file/bot${BOT}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("tg file download failed");
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  const ab = await res.arrayBuffer();
  return { bytes: new Uint8Array(ab), mime, filename: path.split("/").pop() || "file" };
}

// ---------- state ----------
type State = {
  step: "asset"|"unit"|"repair"|"total"|"paid"|"comments"|"file"|"confirm";
  asset: string; unit: string; repair: string; total: number;
  paidBy: string; comments?: string; file_id?: string; file_kind?: "photo"|"document";
  reporter: string; msg_key: string;
};
const kState = (uid:number)=>["state",uid];
const getState = async (uid:number)=> (await kv.get<State>(kState(uid))).value ?? null;
const setState = (uid:number, st:State)=> kv.set(kState(uid), st, { expireIn: 6*3600_000 });
const clearState = (uid:number)=> kv.delete(kState(uid));

const kbMain = { keyboard: [[{text:"➕ New entry"},{text:"📊 Dashboard"}],[{text:"🧾 Status"},{text:"❌ Cancel"}]], resize_keyboard:true };
const ikAsset = { inline_keyboard: [[{text:"Truck",callback_data:"asset:Truck"},{text:"Trailer",callback_data:"asset:Trailer"}]] };
const ikPaid  = { inline_keyboard: [[{text:"Company",callback_data:"paid:company"},{text:"Driver",callback_data:"paid:driver"}]] };
const ikConfirm = { inline_keyboard: [[{text:"✅ Save",callback_data:"confirm_save"},{text:"✖️ Cancel",callback_data:"confirm_cancel"}]] };
const preview = (s: State) =>
  ["<b>Preview</b>",
   `Asset: ${s.asset}`, `Unit: ${s.unit}`, `Repair: ${s.repair}`,
   `Total: $${s.total.toFixed(2)}`, `Paid by: ${s.paidBy.toUpperCase()}`,
   `Comments: ${s.comments || "-"}`, `Reporter: ${s.reporter}`, "",
   "Save this entry?"].join("\n");

// ---------- handlers ----------
async function onMessage(m:any){
  if (!m.chat || m.chat.type!=="private") return;
  const uid = m.from.id as number;
  const t = (m.text ?? "").trim();

  if (t === "/ping") return send(m.chat.id, "pong");
  if (t === "/start") return send(m.chat.id, "Welcome. Use buttons below.", { reply_markup: kbMain });
  if (t === "📊 Dashboard" || t === "/dashboard")
    return send(m.chat.id, "Dashboard:", { reply_markup: { inline_keyboard: [[{ text:"Open Dashboard", url: DASH }]] } });

  let st = await getState(uid);

  if (t === "🧾 Status" || t === "/status") {
    if (!st) return send(m.chat.id,'No active entry. Tap "New entry".',{ reply_markup: kbMain });
    const lines = ["Current entry", `Step: ${st.step}`, `Asset: ${st.asset||""}`, `Unit: ${st.unit||""}`,
      `Repair: ${st.repair||""}`, `Total: $${(st.total||0).toFixed(2)}`, `Paid by: ${st.paidBy||""}`,
      `Comments: ${st.comments||"-"}`, `File: ${st.file_id ? "attached ✅" : "missing ❗"}`];
    return send(m.chat.id, lines.join("\n"), { reply_markup: kbMain });
  }

  if (t === "❌ Cancel" || t === "/cancel") { await clearState(uid); return send(m.chat.id, "Canceled.", { reply_markup: kbMain }); }

  if (t === "➕ New entry" || t === "/new" || !st) {
    st = {
      step:"asset", asset:"", unit:"", repair:"", total:0, paidBy:"", comments:"",
      file_id:"", file_kind: undefined,
      reporter:[m.from.first_name, m.from.last_name, m.from.username?`@${m.from.username}`:""].filter(Boolean).join(" "),
      msg_key:`${m.chat.id}:${m.message_id}`,
    };
    await setState(uid, st);
    return send(m.chat.id, "Select asset type:", { reply_markup: ikAsset });
  }

  if (st.step==="asset" && m.text) return send(m.chat.id, "Tap a button: Truck or Trailer.");

  if (st.step==="unit" && m.text) {
    if (!t) return send(m.chat.id, "Unit number is required.");
    st.unit = t; st.step="repair"; await setState(uid, st);
    return send(m.chat.id, "Describe the repair (short):");
  }
  if (st.step==="repair" && m.text) {
    const line = firstLine(t); if (!line) return send(m.chat.id, "Enter short repair description.");
    st.repair = line; st.step="total"; await setState(uid, st);
    return send(m.chat.id, "Total amount? Examples: 10, $10, 10,50");
  }
  if (st.step==="total" && m.text) {
    const val = parseAmount(t); if (val===null) return send(m.chat.id, "Enter a valid amount, e.g. 10 or $10 or 10,50");
    st.total = val; st.step="paid"; await setState(uid, st);
    return send(m.chat.id, "Who paid?", { reply_markup: ikPaid });
  }
  if (st.step==="comments" && m.text) {
    st.comments = t; st.step="file"; await setState(uid, st);
    return send(m.chat.id, "Send invoice photo or file.");
  }
  if (st.step==="file" && (m.photo || m.document)) {
    if (m.photo?.length) { st.file_id = m.photo.at(-1).file_id; st.file_kind="photo"; }
    else if (m.document) { st.file_id = m.document.file_id; st.file_kind="document"; }
    st.step="confirm"; await setState(uid, st);
    return send(m.chat.id, preview(st), { reply_markup: ikConfirm });
  }

  return send(m.chat.id, "Use buttons below.", { reply_markup: kbMain });
}

async function onCallback(q:any){
  const uid = q.from.id as number;
  const st = (await getState(uid))!;
  const data = q.data as string;

  if (data.startsWith("asset:")) {
    st.asset = data.split(":")[1];
    st.step="unit"; await setState(uid, st);
    await edit(q.message.chat.id, q.message.message_id, "Enter unit number:");
    return answerCb(q.id);
  }
  if (data.startsWith("paid:")) {
    st.paidBy = data.split(":")[1];
    st.step="comments"; await setState(uid, st);
    await edit(q.message.chat.id, q.message.message_id, "Any comments? If none, send '-'");
    return answerCb(q.id);
  }
  if (data === "confirm_save") {
    const ts = new Date().toISOString();

    let fileUrl = "";
    if (st.file_id) {
      try {
        const { bytes, mime, filename } = await downloadTelegramFile(st.file_id);
        const fname = `${ts.replace(/[-:TZ.]/g,"").slice(0,14)}_${st.asset}_${safe(st.unit)}_${filename}`;
        fileUrl = await driveUpload(bytes, fname, mime);
      } catch (e) { await logErr("drive/upload", String(e)); }
    }

    const row = [ts, st.asset, st.unit, st.repair, st.total, st.paidBy, st.comments||"", st.reporter, fileUrl, st.msg_key];
    try { await sheetsAppend(row); } catch (_) {}
    await clearState(uid);
    await edit(q.message.chat.id, q.message.message_id, "ok");
    return answerCb(q.id);
  }

  if (data === "confirm_cancel") {
    await clearState(uid);
    await edit(q.message.chat.id, q.message.message_id, "Canceled.");
    return answerCb(q.id);
  }
  return answerCb(q.id);
}

// ---------- webhook ----------
async function handleHook(req: Request) {
  const u = (await req.json()) as Tg;
  if (typeof u.update_id === "number") {
    const k = ["upd", u.update_id]; const seen = await kv.get(k);
    if (seen.value) return json({ ok: true });
    await kv.set(k, 1, { expireIn: 3600_000 });
  }
  if (u.message) await onMessage(u.message);
  if (u.callback_query) await onCallback(u.callback_query);
  return json({ ok: true });
}

// ---------- HTTP ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/") return new Response("ok");

  if (req.method === "GET" && url.pathname === "/debug") {
    const last = (await kv.get(["err","last"])).value;
    return json({ ok:true, env:{ sheet:!!SHEET_ID, drive:!!DRIVE_FOLDER, saEmail:!!SA_EMAIL, saKey:!!SA_KEY_RAW }, lastError:last??null });
  }

  if (req.method === "GET" && url.pathname === "/self-test") {
    try {
      const now = new Date().toISOString();
      await sheetsAppend([now,"Test","T-001","Self-test",1.23,"company","self","system","",`selftest:${now}`]);
      return json({ ok: true });
    } catch (e) { await logErr("self-test", String(e)); return json({ ok:false, error:String(e) }, 500); }
  }

  if (req.method === "POST" && url.pathname === "/hook") return handleHook(req);
  return new Response("404", { status: 404 });
});
