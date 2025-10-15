// src/main.ts
import { webhookCallback } from "https://deno.land/x/grammy@v1.25.1/mod.ts";
import { bot } from "./telegram.ts";

const wh = webhookCallback(bot, "std/http");

export default async function (req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/health") return new Response("ok", { status: 200 });

  if (p === "/telegram") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    return await wh(req);
  }

  // корень отдаёт 200, чтобы не пугал “not found”
  if (p === "/") {
    return new Response(
      `US Fleet bot is up.\nWebhook: POST /telegram\nHealth: GET /health`,
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  return new Response("not found", { status: 404 });
}
