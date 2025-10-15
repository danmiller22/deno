// src/telegram.ts
// Обработчик апдейтов Telegram. Клавиатуры и роутинг.
import { Bot } from "https://deno.land/x/grammy@v1.26.1/mod.ts";
import { startFlow, onText, onFile } from "./flow.ts";
import { TELEGRAM_TOKEN } from "./config.ts";

export type TgCtx = Parameters<Bot["on"]>[1] extends (h: (ctx: infer C)=>any)=>any ? C : any;

export const bot = new Bot<TgCtx>(TELEGRAM_TOKEN);

bot.command("start", startFlow);
bot.hears(/^new entry$/i, startFlow);

bot.on("message:text", onText);
bot.on(["message:photo","message:document","message:video"], onFile);

export default bot;
