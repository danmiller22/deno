import { Bot, webhookCallback } from "https://deno.land/x/grammy@v1.19.1/mod.ts";
import { TELEGRAM_TOKEN } from "./config.ts";
import { startFlow, onText, onFile } from "./flow.ts";

export type TgCtx = Parameters<Bot["on"]>[1] extends (h: (ctx: infer C)=>any)=>any ? C : any;

export const bot = new Bot<TgCtx>(TELEGRAM_TOKEN);
bot.command("start", startFlow);
bot.hears(/^new entry$/i, startFlow);
bot.on("message:text", onText);
bot.on(["message:photo","message:document","message:video"], onFile);

// webhook handler for Deno.serve
export const answer = webhookCallback(bot, "std/http");
