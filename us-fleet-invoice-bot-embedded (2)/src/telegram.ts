import { Bot } from "https://deno.land/x/grammy@v1.25.1/mod.ts";

const token = Deno.env.get("TELEGRAM_TOKEN");
if (!token) throw new Error("Missing TELEGRAM_TOKEN");

export const bot = new Bot(token);
bot.command("start", (ctx) => ctx.reply("Bot ready"));
