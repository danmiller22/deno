import { answer } from "./telegram.ts";

Deno.serve((req) => {
  const { pathname } = new URL(req.url);
  if (req.method === "POST" && pathname === "/telegram") return answer(req);
  if (pathname === "/health") return new Response("ok");
  return new Response("Not Found", { status: 404 });
});
