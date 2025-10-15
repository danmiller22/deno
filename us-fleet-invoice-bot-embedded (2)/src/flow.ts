// src/flow.ts
import { appendRow } from "./google/sheets.ts";
import { saveToDrive } from "./google/drive.ts";
import type { TgCtx } from "./telegram.ts";

type Kind = "TRK" | "TRL";
type Step =
  | "IDLE"
  | "ASK_KIND"
  | "ASK_TRK_NUM"
  | "ASK_TRL_NUM"
  | "ASK_TRL_TRK_NUM"
  | "ASK_REPAIR"
  | "ASK_TOTAL"
  | "ASK_COMMENTS"
  | "ASK_INVOICE";

type Draft = {
  step: Step;
  kind?: Kind;
  trk?: string;
  trl?: string;
  repair?: string;
  total?: number;
  comments?: string;
  invoiceLink?: string;
};

const SESS = new Map<number, Draft>();

function username(ctx: TgCtx) {
  const u = ctx.message?.from || ctx.callback_query?.from;
  const handle =
    u?.username || `${u?.first_name || ""} ${u?.last_name || ""}`.trim() || "unknown";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function ensure(chatId: number): Draft {
  let d = SESS.get(chatId);
  if (!d) {
    d = { step: "ASK_KIND" };
    SESS.set(chatId, d);
  }
  return d;
}

export async function startFlow(ctx: TgCtx) {
  const chatId = ctx.chat.id;
  SESS.set(chatId, { step: "ASK_KIND" });
  await ctx.reply("Choose asset:", {
    reply_markup: {
      keyboard: [[{ text: "TRK" }, { text: "TRL" }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

export async function onText(ctx: TgCtx) {
  const chatId = ctx.chat.id;
  const text = (ctx.message?.text || "").trim();
  const d = ensure(chatId);

  if (/^new entry$/i.test(text)) return startFlow(ctx);

  if (d.step === "ASK_KIND") {
    if (text === "TRK" || text === "TRL") {
      d.kind = text as Kind;
      if (d.kind === "TRK") {
        d.step = "ASK_TRK_NUM";
        return ctx.reply("Enter TRK unit number:");
      } else {
        d.step = "ASK_TRL_NUM";
        return ctx.reply("Enter TRL unit number:");
      }
    }
    return ctx.reply("Tap TRK or TRL.");
  }

  if (d.step === "ASK_TRK_NUM") {
    d.trk = text;
    d.step = "ASK_REPAIR";
    return ctx.reply("Describe the repair (short):");
  }

  if (d.step === "ASK_TRL_NUM") {
    d.trl = text;
    d.step = "ASK_TRL_TRK_NUM";
    return ctx.reply("Which TRK was the trailer with? Enter TRK unit number:");
  }

  if (d.step === "ASK_TRL_TRK_NUM") {
    d.trk = text;
    d.step = "ASK_REPAIR";
    return ctx.reply("Describe the repair (short):");
  }

  if (d.step === "ASK_REPAIR") {
    d.repair = text;
    d.step = "ASK_TOTAL";
    return ctx.reply("Total amount? Examples: 10, $10, 10.50");
  }

  if (d.step === "ASK_TOTAL") {
    const n = Number(text.replace(/[^0-9.\-]/g, ""));
    if (!isFinite(n)) return ctx.reply("Send a number like 10 or 10.50");
    d.total = n;
    d.step = "ASK_COMMENTS";
    return ctx.reply("Any comments? If none, send '-'");
  }

  if (d.step === "ASK_COMMENTS") {
    d.comments = text === "-" ? "" : text;
    d.step = "ASK_INVOICE";
    return ctx.reply("Send invoice photo or file.");
  }

  if (d.step === "IDLE") return startFlow(ctx);
}

export async function onFile(ctx: TgCtx) {
  const chatId = ctx.chat.id;
  const d = ensure(chatId);
  if (d.step !== "ASK_INVOICE") return;

  const fileId =
    ctx.message?.document?.file_id ||
    ctx.message?.photo?.at(-1)?.file_id ||
    ctx.message?.video?.file_id;

  if (!fileId) return ctx.reply("Attach a photo or file.");

  try {
    d.invoiceLink = await saveToDrive(ctx, fileId);
  } catch {
    d.invoiceLink = "";
  }

  const asset = d.kind === "TRK" ? `TRK ${d.trk}` : `TRL ${d.trl} — TRK ${d.trk}`;

  // Порядок колонок: A Date, B Asset, C Repair, D Total, E PaidBy, F ReportedBy, G InvoiceLink, H Comments
  const row = [
    new Date().toISOString(),   // Date
    asset,                      // Asset
    d.repair || "",             // Repair
    (d.total ?? 0).toString(),  // Total
    "",                         // PaidBy
    username(ctx),              // ReportedBy
    d.invoiceLink || "",        // InvoiceLink
    d.comments || "",           // Comments
  ];

  try {
    await appendRow(row);
    await ctx.reply("Saved ✅", { reply_markup: { remove_keyboard: true } });
  } catch {
    await ctx.reply("Failed to save. Check Drive/Sheet access and try again.");
  }

  SESS.set(chatId, { step: "IDLE" });
}
