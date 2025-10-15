import { SA_JSON } from "../config.ts";

function loadSA() {
  const raw = SA_JSON.trim();
  let txt = raw;
  if (!raw.startsWith("{")) {
    try {
      txt = new TextDecoder().decode(
        Uint8Array.from(atob(raw), c => c.charCodeAt(0)),
      );
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be raw JSON or base64(JSON).");
    }
  }
  return JSON.parse(txt);
}

type SA = { client_email: string; private_key: string; token_uri?: string };
const sa: SA = loadSA();

const SCOPE = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");

function b64u(s: string | Uint8Array) {
  return btoa(typeof s === "string" ? s : String.fromCharCode(...s))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
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
      return Uint8Array.from(atob(pem), c => c.charCodeAt(0)).buffer;
    })(),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc));
  const jwt = `${header}.${claim}.${b64u(sig)}`;

  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j.access_token as string;
}
