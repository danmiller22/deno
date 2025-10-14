// Tiny wrapper over Deno KV for state and dedup
export const kv = await Deno.openKv();
export async function seen(updateId: number) {
  const key = ["upd", updateId];
  const r = await kv.get(key);
  if (r.value) return true;
  await kv.set(key, 1, { expireIn: 3 * 24 * 3600 * 1000 });
  return false;
}
export async function setnx(key: string, ttlMs = 3 * 24 * 3600 * 1000) {
  const k = ["lock", key];
  const r = await kv.get(k);
  if (r.value) return false;
  await kv.set(k, 1, { expireIn: ttlMs });
  return true;
}
export async function getState(chatId: number) {
  return (await kv.get(["state", chatId])).value as any ?? null;
}
export async function setState(chatId: number, state: any | null) {
  if (!state) return kv.delete(["state", chatId]);
  return kv.set(["state", chatId], state, { expireIn: 14 * 24 * 3600 * 1000 });
}
