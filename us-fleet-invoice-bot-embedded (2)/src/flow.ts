import { appendRow } from "./google/sheets.ts";
import { saveToDrive } from "./google/drive.ts";
import type { TgCtx } from "./telegram.ts";

type Kind = "TRK" | "TRL";
type Step = "IDLE" | "ASK_KIND" | "ASK_TRK" | "ASK_TRL" | "ASK_TRL_TRK" | "ASK_REPAIR" | "ASK_TOTAL" | "ASK_COMMENTS" | "ASK_INVOICE";
type Draft = { step: Step; kind?: Kind; trk?: string; trl?: string; repair?: string; total?: number; comments?: string; invoiceLink?: string; };

const SESS = new Map<number, Draft>();
const uname = (ctx: TgCtx) => {
  const u = ctx.message?.from || ctx.callback_query?.from;
  const h = u?.username || `${u?.first_name || ""} ${u?.last_name || ""}`.trim() || "unknown";
  return h.startsWith("@") ? h : `@${h}`;
};

export async function startFlow(ctx: TgCtx) {
  SESS.set(ctx.chat.id, { step: "ASK_KIND" });
  await ctx.reply("Choose asset:", {
    reply_markup: { keyboard: [[{ text: "TRK" }, { text: "TRL" }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

export async function onText(ctx: TgCtx) {
  const d = SESS.get(ctx.chat.id) || { step: "ASK_KIND" } as Draft;
  const t = (ctx.message?.text || "").trim();
  if (/^new entry$/i.test(t)) return startFlow(ctx);

  if (d.step === "ASK_KIND") {
    if (t === "TRK") { d.kind = "TRK"; d.step = "ASK_TRK"; SESS.set(ctx.chat.id, d); return ctx.reply("Enter TRK unit number:"); }
    if (t === "TRL") { d.kind = "TRL"; d.step = "ASK_TRL"; SESS.set(ctx.chat.id, d); return ctx.reply("Enter TRL unit number:"); }
    return ctx.reply("Tap TRK or TRL.");
  }
  if (d.step === "ASK_TRK") { d.trk = t; d.step = "ASK_REPAIR"; SESS.set(ctx.chat.id, d); return ctx.reply("Describe the repair:"); }
  if (d.step === "ASK_TRL") { d.trl = t; d.step = "ASK_TRL_TRK"; SESS.set(ctx.chat.id, d); return ctx.reply("Which TRK was the trailer with?"); }
  if (d.step === "ASK_TRL_TRK") { d.trk = t; d.step = "ASK_REPAIR"; SESS.set(ctx.chat.id, d); return ctx.reply("Describe the repair:"); }
  if (d.step === "ASK_REPAIR") { d.repair = t; d.step = "ASK_TOTAL"; SESS.set(ctx.chat.id, d); return ctx.reply("Total amount? 10, 10.50, $10"); }
  if (d.step === "ASK_TOTAL") {
    const n = Number(t.replace(/[^0-9.\-]/g, "")); if (!isFinite(n)) return ctx.reply("Send a number");
    d.total = n; d.step = "ASK_COMMENTS"; SESS.set(ctx.chat.id, d); return ctx.reply("Any comments? '-' for none");
  }
  if (d.step === "ASK_COMMENTS") { d.comments = t === "-" ? "" : t; d.step = "ASK_INVOICE"; SESS.set(ctx.chat.id, d); return ctx.reply("Send invoice photo or file."); }
}

export async function onFile(ctx: TgCtx) {
  const d = SESS.get(ctx.chat.id); if (!d || d.step !== "ASK_INVOICE") return;
  const fileId = ctx.message?.document?.file_id || ctx.message?.photo?.at(-1)?.file_id || ctx.message?.video?.file_id;
  if (!fileId) return ctx.reply("Attach a photo or file.");

  try { d.invoiceLink = await saveToDrive(ctx, fileId); } catch { d.invoiceLink = ""; }

  const asset = d.kind === "TRK" ? `TRK ${d.trk}` : `TRL ${d.trl} — TRK ${d.trk}`;

  // A–H: Date, Asset, Repair, Total, PaidBy, ReportedBy, InvoiceLink, Comments
  const row = [
    new Date().toISOString(),           // A Date
    asset,                              // B Asset
    d.repair || "",                     // C Repair
    (d.total ?? 0).toString(),          // D Total
    "",                                 // E PaidBy
    uname(ctx),                         // F ReportedBy
    d.invoiceLink || "",                // G InvoiceLink
    d.comments || "",                   // H Comments
  ];

  try { await appendRow(row); await ctx.reply("Saved ✅", { reply_markup: { remove_keyboard: true } }); }
  catch { await ctx.reply("Failed to save. Check Drive/Sheet access and try again."); }
  SESS.set(ctx.chat.id, { step: "IDLE" });
}
