// Deno Deploy: Telegram bot + Deno KV + Supabase rows + Supabase Storage files + Debug
// ENV:
// BOT_TOKEN, DASHBOARD_URL, TIMEZONE=America/Chicago
// REPORT_CHAT_ID (opt), REPORT_THREAD_ID (opt)
// SUPABASE_URL=https://XXXX.supabase.co, SUPABASE_KEY=<service_role>, SUPABASE_BUCKET=invoices

type Tg = { update_id?: number; message?: any; callback_query?: any };

const BOT = Deno.env.get("BOT_TOKEN")!;
const API = `https://api.telegram.org/bot${BOT}`;
const DASH = Deno.env.get("DASHBOARD_URL") ?? "";
const TZ = Deno.env.get("TIMEZONE") ?? "UTC";
const REPORT_CHAT = Deno.env.get("REPORT_CHAT_ID") ?? "";
const REPORT_THREAD = Deno.env.get("REPORT_THREAD_ID") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_KEY") ?? "";
const SUPABASE_BUCKET = Deno.env.get("SUPABASE_BUCKET") ?? "invoices";

const kv = await Deno.openKv();

// ---------- utils ----------
const j = (x: unknown) => JSON.stringify(x);
const json = (x: unknown, s = 200) =>
  new Response(j(x), { status: s, headers: { "content-type": "application/json" } });

const firstLine = (t = "") =>
  t.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] ?? "";

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
  await kv.set(["err","last"], rec, { expireIn: 6*3600_000 });
  await kv.set(["err", Date.now()], rec, { expireIn: 6*3600_000 });
}

// ---------- Telegram ----------
async function tg(method: string, payload: unknown) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: j(payload)
  });
  if (!r.ok) throw new Error(`${method} ${r.status} ${await r.text()}`);
  return r.json();
}
const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
const edit = (chat_id: number, message_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...extra });
const answerCb = (id: string) => tg("answerCallbackQuery", { callback_query_id: id });

async function tgFilePath(file_id: string) {
  const { result } = await tg("getFile", { file_id }) as any;
  return result.file_path as string;
}
async function downloadTelegramFile(file_id: string): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
  const path = await tgFilePath(file_id);
  const url = `https://api.telegram.org/file/bot${BOT}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("telegram download failed");
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const name = path.split("/").pop() || "file";
  return { bytes, mime, filename: name };
}

// ---------- Supabase Storage (public bucket) ----------
async function uploadToSupabase(bytes: Uint8Array, mime: string, destPath: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) { await logErr("storage/env-missing", { SUPABASE_URL: !!SUPABASE_URL, SUPABASE_KEY: !!SUPABASE_KEY }); return ""; }
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(destPath)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": mime,
      "x-upsert": "true"
    },
    body: bytes
  });
  if (!r.ok) {
    await logErr("storage/upload-failed", { status: r.status, text: await r.text(), url });
    return "";
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURIComponent(destPath)}`;
}

// ---------- KV models ----------
type State = {
  step: "asset"|"unit"|"repair"|"total"|"paid"|"comments"|"file"|"confirm";
  asset: string; unit: string; repair: string; total: number;
  paidBy: string; comments?: string;
  file_id?: string; file_kind?: "photo"|"document";
  reporter: string; msg_key: string;
};
type Entry = {
  ts: string; asset: string; unit: string; repair: string; total: number;
  paid_by: string; comments?: string; reporter: string; file_id?: string; file_url?: string; msg_key: string;
};

const kState = (uid: number) => ["state", uid];
const getState = async (uid: number) => (await kv.get<State>(kState(uid))).value ?? null;
const setState = (uid: number, st: State) => kv.set(kState(uid), st, { expireIn: 6 * 3600_000 });
const clearState = (uid: number) => kv.delete(kState(uid));

const kEntry = (tsIso: string, msgKey: string) => ["entry", tsIso.slice(0,7), tsIso.slice(0,19), msgKey];
async function addEntry(e: Entry) { await kv.set(kEntry(e.ts, e.msg_key), e); }

async function statsWeekMonth() {
  const now = new Date(); const ym = now.toISOString().slice(0,7);
  let month = 0, week = 0; const weekAgo = new Date(now.getTime() - 7*86400_000);
  for await (const it of kv.list<Entry>({ prefix: ["entry", ym] })) {
    const d = new Date(it.value.ts);
    month += it.value.total || 0;
    if (d >= weekAgo) week += it.value.total || 0;
  }
  return { week, month };
}

// ---------- Supabase rows (без file_url в body) ----------
async function saveSupabase(e: Entry) {
  if (!SUPABASE_URL || !SUPABASE_KEY) { await logErr("db/env-missing", { SUPABASE_URL: !!SUPABASE_URL, SUPABASE_KEY: !!SUPABASE_KEY }); return; }
  const url = `${SUPABASE_URL}/rest/v1/entries`;
  const body: Record<string, unknown> = {
    ts: e.ts, asset: e.asset, unit: e.unit, repair: e.repair,
    total: e.total, paid_by: e.paid_by, comments: e.comments ?? null,
    reporter: e.reporter ?? null, file_id: e.file_id ?? null,
    msg_key: e.msg_key
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) await logErr("db/insert-failed", { status: r.status, text: await r.text(), url, body });
}

// ---------- UI ----------
const kbMain = {
  keyboard: [
    [{text:"➕ New entry"},{text:"📊 Dashboard"}],
    [{text:"🧾 Status"},{text:"❌ Cancel"}]
  ],
  resize_keyboard:true
};
const ikAsset = { inline_keyboard: [[{text:"Truck",callback_data:"asset:Truck"},{text:"Trailer",callback_data:"asset:Trailer"}]] };
const ikPaid  = { inline_keyboard: [[{text:"Company",callback_data:"paid:company"},{text:"Driver",callback_data:"paid:driver"}]] };
const ikSkip  = { inline_keyboard: [[{text:"Skip",callback_data:"skip_comments"}]] };
const ikConfirm = { inline_keyboard: [[{text:"✅ Save",callback_data:"confirm_save"},{text:"✖️ Cancel",callback_data:"confirm_cancel"}]] };

const preview = (s: State) =>
  ["<b>Preview</b>",
   `Asset: ${s.asset}`, `Unit: ${s.unit}`, `Repair: ${s.repair}`,
   `Total: $${s.total.toFixed(2)}`, `Paid by: ${s.paidBy.toUpperCase()}`,
   `Comments: ${s.comments || "-"}`, `Reporter: ${s.reporter}`, "", "Save this entry?`"].join("\n");

// ---------- handlers ----------
async function onMessage(m: any) {
  if (!m.chat || m.chat.type !== "private") return;
  const uid = m.from.id as number;
  const t = (m.text ?? "").trim();

  if (t === "/ping") return send(m.chat.id, "pong");
  if (t === "/start") return send(m.chat.id, "Welcome. Use buttons below.", { reply_markup: kbMain });
  if (t === "📊 Dashboard" || t === "/dashboard")
    return send(m.chat.id, "Dashboard:", { reply_markup: { inline_keyboard: [[{ text: "Open Dashboard", url: DASH }]] } });

  let st = await getState(uid);

  if (t === "🧾 Status" || t === "/status") {
    if (!st) return send(m.chat.id, 'No active entry. Tap "New entry".', { reply_markup: kbMain });
    const lines = [
      "Current entry", `Step: ${st.step}`, `Asset: ${st.asset||""}`, `Unit: ${st.unit||""}`,
      `Repair: ${st.repair||""}`, `Total: $${(st.total||0).toFixed(2)}`,
      `Paid by: ${st.paidBy||""}`, `Comments: ${st.comments||"-"}`,
      `File: ${st.file_id ? "attached ✅" : "missing ❗"}`
    ];
    return send(m.chat.id, lines.join("\n"), { reply_markup: kbMain });
  }

  if (t === "❌ Cancel" || t === "/cancel") {
    await clearState(uid);
    return send(m.chat.id, "Canceled.", { reply_markup: kbMain });
  }

  if (t === "➕ New entry" || t === "/new" || !st) {
    st = {
      step: "asset", asset:"", unit:"", repair:"", total:0, paidBy:"", comments:"",
      file_id:"", file_kind: undefined,
      reporter: [m.from.first_name, m.from.last_name, m.from.username ? `@${m.from.username}` : ""].filter(Boolean).join(" "),
      msg_key: `${m.chat.id}:${m.message_id}`
    };
    await setState(uid, st);
    return send(m.chat.id, "Select asset type:", { reply_markup: ikAsset });
  }

  if (st.step === "unit" && m.text) {
    const u = t; if (!u) return send(m.chat.id, "Unit number is required.");
    st.unit = u; st.step = "repair"; await setState(uid, st);
    return send(m.chat.id, "Describe the repair (first meaningful line):");
  }
  if (st.step === "repair" && m.text) {
    const line = firstLine(t); if (!line) return send(m.chat.id, "Please enter a short repair description.");
    st.repair = line; st.step = "total"; await setState(uid, st);
    return send(m.chat.id, "Total amount? Examples: 10, $10, 10,50");
  }
  if (st.step === "total" && m.text) {
    const val = parseAmount(t); if (val === null) return send(m.chat.id, "Enter a valid amount. Examples: 10 or $10 or 10,50");
    st.total = val; st.step = "paid"; await setState(uid, st);
    return send(m.chat.id, "Who paid?", { reply_markup: ikPaid });
  }
  if (st.step === "comments" && m.text) {
    st.comments = t; st.step = "file"; await setState(uid, st);
    return send(m.chat.id, "Send invoice photo or file.");
  }
  if (st.step === "file" && (m.photo || m.document)) {
    if (m.photo?.length) { st.file_id = m.photo.at(-1).file_id; st.file_kind = "photo"; }
    else if (m.document) { st.file_id = m.document.file_id; st.file_kind = "document"; }
    st.step = "confirm"; await setState(uid, st);
    return send(m.chat.id, preview(st), { reply_markup: ikConfirm });
  }

  return send(m.chat.id, "Use buttons below.", { reply_markup: kbMain });
}

async function onCallback(q: any) {
  const uid = q.from.id as number;
  const st = (await getState(uid))!;
  const data = q.data as string;

  if (data.startsWith("asset:")) {
    st.asset = data.split(":")[1];
    st.step = "unit"; await setState(uid, st);
    await edit(q.message.chat.id, q.message.message_id, "Enter unit number:");
    return answerCb(q.id);
  }
  if (data.startsWith("paid:")) {
    st.paidBy = data.split(":")[1];
    st.step = "comments"; await setState(uid, st);
    await edit(q.message.chat.id, q.message.message_id, "Any comments? Tap Skip if none.", {
      reply_markup: { inline_keyboard: [[{ text:"Skip", callback_data:"skip_comments"}]] }
    });
    return answerCb(q.id);
  }
  if (data === "skip_comments") {
    st.comments = ""; st.step = "file"; await setState(uid, st);
    await edit(q.message.chat.id, q.message.message_id, "Send invoice photo or file.");
    return answerCb(q.id);
  }
  if (data === "confirm_save") {
    const tsStr = new Date().toISOString();

    let publicUrl = "";
    if (st.file_id) {
      try {
        const { bytes, mime, filename } = await downloadTelegramFile(st.file_id);
        const fname = `${tsStr.replace(/[-:TZ.]/g,"").slice(0,14)}_${st.asset}_${safe(st.unit)}_${filename}`;
        const path = `${st.asset}/${safe(st.unit)}/${fname}`;
        publicUrl = await uploadToSupabase(bytes, mime, path);
      } catch (e) {
        await logErr("storage/download-or-upload", String(e));
      }
    }

    const entry: Entry = {
      ts: tsStr, asset: st.asset, unit: st.unit, repair: st.repair,
      total: st.total, paid_by: st.paidBy, comments: st.comments,
      reporter: st.reporter, file_id: st.file_id || "", file_url: publicUrl || "", msg_key: st.msg_key
    };

    await addEntry(entry);
    await saveSupabase(entry);
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

// ---------- webhook/cron ----------
async function handleHook(req: Request) {
  const u = (await req.json()) as Tg;
  if (typeof u.update_id === "number") {
    const k = ["upd", u.update_id];
    const seen = await kv.get(k);
    if (seen.value) return json({ ok: true });
    await kv.set(k, 1, { expireIn: 3600_000 });
  }
  if (u.message) await onMessage(u.message);
  if (u.callback_query) await onCallback(u.callback_query);
  return json({ ok: true });
}

async function sendReport(title: "Weekly report" | "Monthly report") {
  if (!REPORT_CHAT) return json({ ok: true });
  const { week, month } = await statsWeekMonth();
  const txt = title === "Weekly report"
    ? `Weekly report\nTotal last 7 days: $${week.toFixed(2)}`
    : `Monthly report\nMonth-to-date: $${month.toFixed(2)}`;
  const kb = { inline_keyboard: [[{ text: "Open Dashboard", url: DASH }]] };
  const extra: any = { reply_markup: kb };
  if (REPORT_THREAD) extra.message_thread_id = Number(REPORT_THREAD);
  await send(Number(REPORT_CHAT), txt, extra);
  return json({ ok: true });
}

// ---------- HTTP debug ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/") return new Response("ok");
  if (req.method === "GET" && url.pathname === "/health") return json({ ok: true });

  if (req.method === "GET" && url.pathname === "/debug") {
    const last = (await kv.get(["err","last"])).value;
    const env = {
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_KEY: !!SUPABASE_KEY,
      SUPABASE_BUCKET
    };
    const probe = SUPABASE_URL
      ? `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/__probe__.txt`
      : "";
    let probeStatus = "n/a";
    if (probe) {
      try { const r = await fetch(probe, { method: "HEAD" }); probeStatus = String(r.status); } catch { probeStatus = "error"; }
    }
    return json({ ok: true, env, probe: { url: probe, status: probeStatus }, lastError: last ?? null });
  }

  if (req.method === "GET" && url.pathname === "/self-test") {
    const now = new Date().toISOString();
    const bytes = new TextEncoder().encode(`self-test at ${now}\n`);
    const path = `__selftest__/test_${now.replace(/[-:TZ.]/g,"").slice(0,14)}.txt`;
    const publicUrl = await uploadToSupabase(bytes, "text/plain", path);
    const entry: Entry = {
      ts: now, asset: "TestAsset", unit: "T-001", repair: "Self-test write",
      total: 1.23, paid_by: "company", comments: "self-test", reporter: "system",
      file_id: "", file_url: publicUrl, msg_key: "selftest"
    };
    await saveSupabase(entry);
    return json({ ok: true, file_url: publicUrl });
  }

  if (req.method === "POST" && url.pathname === "/hook") return handleHook(req);
  if (req.method === "POST" && url.pathname === "/cron-weekly") return sendReport("Weekly report");
  if (req.method === "POST" && url.pathname === "/cron-monthly") return sendReport("Monthly report");
  return new Response("404", { status: 404 });
});
