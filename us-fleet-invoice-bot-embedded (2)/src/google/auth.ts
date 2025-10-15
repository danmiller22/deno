// Чистый вариант: только GOOGLE_CLIENT_EMAIL и GOOGLE_PRIVATE_KEY
const CLIENT_EMAIL = (Deno.env.get("GOOGLE_CLIENT_EMAIL") || "").trim();
let PRIVATE_KEY = Deno.env.get("GOOGLE_PRIVATE_KEY") || "";

if (!CLIENT_EMAIL || !PRIVATE_KEY) {
  throw new Error("Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY");
}

// поддержка \n в одном строковом значении
PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, "\n");

const TOKEN_URI = "https://oauth2.googleapis.com/token";
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
    iss: CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URI,
    exp: now + 3600,
    iat: now,
  }));

  const data = new TextEncoder().encode(`${header}.${claim}`);

  // импорт PKCS8 из PEM
  const pemBody = PRIVATE_KEY.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const pkcs8 = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0)).buffer;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data));
  const jwt = `${header}.${claim}.${b64u(sig)}`;

  const r = await fetch(TOKEN_URI, {
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
