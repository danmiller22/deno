import { SA_JSON } from "../config.ts";

type SA = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};
const sa: SA = JSON.parse(SA_JSON);

const SCOPE = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");

function base64url(input: string | Uint8Array) {
  return btoa(typeof input === "string" ? input : String.fromCharCode(...input))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const enc = new TextEncoder().encode(`${header}.${claim}`);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    (() => {
      const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      const bin = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
      return bin.buffer;
    })(),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc));
  const jwt = `${header}.${claim}.${base64url(sig)}`;

  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j.access_token as string;
}
