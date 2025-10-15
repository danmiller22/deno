import { SA_JSON } from "../config.ts";

type SA = { client_email: string; private_key: string; token_uri?: string };

function isBase64(s: string) {
  return /^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0;
}

function loadSA(): SA {
  const raw = (SA_JSON || "").trim();

  // 1) Чистый JSON
  if (raw.startsWith("{")) {
    const obj = JSON.parse(raw) as SA;
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  }

  // 2) base64(JSON)
  if (isBase64(raw)) {
    const txt = new TextDecoder().decode(
      Uint8Array.from(atob(raw), c => c.charCodeAt(0)),
    );
    const obj = JSON.parse(txt) as SA;
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
    return obj;
  }

  // 3) Парами переменных
  const email = Deno.env.get("GOOGLE_CLIENT_EMAIL")?.trim();
  let pk = Deno.env.get("GOOGLE_PRIVATE_KEY") || "";
  if (email && pk) {
    pk = pk.replace(/\\n/g, "\n");
    return { client_email: email, private_key: pk, token_uri: "https://oauth2.googleapis.com/token" };
  }

  throw new Error(
    "Invalid GOOGLE_SERVICE_ACCOUNT_JSON. Provide raw JSON, base64(JSON), or set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY.",
  );
}

const sa = loadSA();

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
