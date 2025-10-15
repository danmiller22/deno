// src/main.ts
export default async function (req: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url);

  if (pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  if (pathname === "/telegram") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    // ленивый импорт, чтобы изолят не падал при старте
    const { webhookCallback } = await import("https://deno.land/x/grammy@v1.25.4/mod.ts");
    const { bot } = await import("./telegram.ts");
    const wh = webhookCallback(bot, "std/http");
    return await wh(req);
  }

  return new Response("US Fleet bot is up\n/health • /telegram", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
