import { GOOGLE_SA_JSON } from "../config.ts";

function parseSA(raw: string): any {
  const s = raw.trim();
  try { return JSON.parse(s); } catch {}
  const unquoted = s.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  try { return JSON.parse(unquoted); } catch {}
  const unescaped = unquoted.replace(/\\n/g, "\n").replace(/\"/g, '"');
  return JSON.parse(unescaped);
}

const SA = parseSA(GOOGLE_SA_JSON);
const ISS = SA.client_email;
const SCOPE = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");
const AUD = "https://oauth2.googleapis.com/token";

async function importKey(pem: string) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
function b64url(data: Uint8Array) {
  const s = btoa(String.fromCharCode(...data));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signRS256(key: CryptoKey, data: Uint8Array) {
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data));
  return b64url(sig);
}

const keyPromise = importKey(SA.private_key);

export async function getAccessToken() {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(JSON.stringify({ iss: ISS, scope: SCOPE, aud: AUD, iat, exp }));
  const data = new TextEncoder().encode(`${header}.${claim}`);
  const sig = await signRS256(await keyPromise, data);
  const jwt = `${header}.${claim}.${sig}`;
  const res = await fetch(AUD, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  const json = await res.json();
  if (!json.access_token) throw new Error("google token error: " + JSON.stringify(json));
  return json.access_token as string;
}
