// src/main.ts
export default async function (req: Request): Promise<Response> {
  const p = new URL(req.url).pathname;

  if (p === "/health") return new Response("ok", { status: 200 });

  if (p === "/telegram" || p.startsWith("/telegram/")) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const { webhookCallback } = await import("https://deno.land/x/grammy@v1.25.4/mod.ts");
    const { bot } = await import("./telegram.ts");
    return await webhookCallback(bot, "std/http")(req);
  }

  return new Response("US Fleet bot is up\n/health • /telegram", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
