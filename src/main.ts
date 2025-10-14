import { ALLOWED_CHAT_IDS, DASHBOARD_MONTHLY_URL, DASHBOARD_WEEKLY_URL } from "./config.ts";
import { answer, sendMessage } from "./telegram.ts";
import { seen } from "./kv.ts";
import { onPhoto, onText, start } from "./flow.ts";

function allowed(chatId: number, threadId?: number) {
  if (ALLOWED_CHAT_IDS.length === 0) return true; // open for testing
  const id = threadId ? `${chatId}:${threadId}` : String(chatId);
  return ALLOWED_CHAT_IDS.includes(id);
}

async function handleTelegram(req: Request) {
  let upd: any = null;
  try { upd = await req.json(); } catch { return new Response("ok", { status: 200 }); }
  try {
    if (await seen(upd.update_id)) return await answer("ok");
    const msg = upd.message;
    const chatId = msg?.chat?.id as number;
    const threadId = msg?.is_topic_message ? msg?.message_thread_id as number : undefined;
    if (!allowed(chatId, threadId)) return answer("ignored");

    if (msg?.text) {
      const t: string = msg.text.trim();
      if (t === "/start") { await sendMessage(chatId, "Use /new to submit an invoice. English only."); return start(chatId); }
      if (t === "/new") { return start(chatId); }
      if (t === "/cancel") { return sendMessage(chatId, "Cancelled"); }
      if (t === "/help") { return sendMessage(chatId, "Steps: Asset type → Number → Location → Repair → Total → Comments → Reporter → Photo."); }
      return onText(chatId, t);
    }
    if (msg?.photo) {
      return onPhoto(chatId, msg.message_id, msg.photo, msg.date);
    }
    return answer("ok");
  } catch (e) {
    console.error("webhook error", e);
    return new Response("ok", { status: 200 });
  }
}

async function weeklyBroadcast() {
  for (const id of ALLOWED_CHAT_IDS) {
    const [chat] = id.split(":");
    await sendMessage(Number(chat), `Weekly dashboard: ${DASHBOARD_WEEKLY_URL}`);
  }
  return new Response("weekly ok");
}
async function monthEndBroadcast() {
  const d = new Date();
  const isLast = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
  if (isLast) {
    for (const id of ALLOWED_CHAT_IDS) {
      const [chat] = id.split(":");
      await sendMessage(Number(chat), `Monthly dashboard: ${DASHBOARD_MONTHLY_URL}`);
    }
  }
  return new Response("monthly ok");
}

Deno.serve((req) => {
  const { pathname } = new URL(req.url);
  if (req.method === "POST" && pathname === "/telegram") return handleTelegram(req);
  if (pathname === "/cron/weekly") return weeklyBroadcast();
  if (pathname === "/cron/monthly") return monthEndBroadcast();
  return new Response("OK");
});
