import { } from "../config.ts";

const RAW_SA_JSON = "{\n  \"type\": \"service_account\",\n  \"project_id\": \"stable-vista-332605\",\n  \"private_key_id\": \"d8cd22f177126b001384b74e54b3cb4af1bbde87\",\n  \"private_key\": \"-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCzHVQbBGdaq+I4\\nu10RAWWmpNrnCkZ8hpvbsgZ2qgJCm8mV/NqLKtpWRcPIHUbubRrNQMayPTW2/Ma2\\nRZbNLcXRNDTwLkT/neZlHNTkUfwk18Y77Fk3YRh8WC6agTNLBstFTUPcveI9RHxA\\n11hjHuYa9mypAcBBlSgcHElslwuRJPpvQdI8xYkDq2FWX2sp3wk0lDn12OHyG9V5\\nFkvbuUc3YOpt+VW3osurb+5A21BC3wGDFVw5FKRFlfwz6o6j8xbGNG2qqEyu7QUD\\nXParsDiDZqKjwnN86PEELco9/AHAnd+2dsPRs4WChZl+/I3fY1dVRr2OsjoPgZ39\\nd7KEhmwDAgMBAAECggEAAO7Q1qiEi/RZOUfAiat4MWX/vd76fwDfJEXJGCp1LeOh\\n09DSp+bmkYx2Iz9ZHzoc6Z9svtY9cWE0/RNftbHcqzpFDFCGtiNxumpsBsRmi8qT\\n6GaoEExxKYn2tCyiwmvxTcBumg0Ny0PlYcZoBMbPFqox5q9w+5EgpFosB7oW///Z\\nuy9mCi9CmbQSlZ88xcLn8U9Ukw8s9o8Ms+SisAWuXq+9lvTx1k3zT5mxYMEvp9HC\\n+vfxqsaVM4noOowIf3Ad176k8wPeEboGr0jSGp9sba7uCBjlwWXZmq9i6tXlvLZ8\\n+Dphn3TkNKFfHUpoaqyj7m0tomNxHM1p8Xm7QP1gAQKBgQDrOAT3SCqGR3e+cdj4\\nUq6pVkxWj6kS5QkTura+7fZu1Wi6mbDTK/MLpEEpQrGLWBo6CntZeL3Nn2DGgibd\\nzMkBd6VDs9RDH79L+aSsK2fBpOUQ6vYzTG40mUVSH0OUoumuzgvUz85McJO9vrSE\\nLE5r+FLY2JI6T12dU9E+gKcdXwKBgQDC8GPvxKFsAzJrnyinF24YtNN5m1/KwBBP\\niV6db3wNG2L6zmHqG9iJ3W4JKD12KbSt7GiItibbDuBiWpFoPLQfaTGkuDc5XRtq\\nDhc/6yMtCfzIc5ncd8Z8BCpEdBv/KIjt3ueLoQJ57cMMwSPB40n3EB7ZCVFfkT7x\\nfuTn+WaP3QKBgCCzRgV2s+q9DsmcHDTRkdSa2bwC9tdYnf1vLK64eFUKOCgQ68M/\\nzecla6WnzvT3R5YgFOvoXEK00IhoWazmJl+c2Y3i9zRpund+ekUxN5h1Kx9B+v5A\\ntuV7FWcIT6XfTCtwG7b3OM/pqrBrTb8+RZy/Bg19dj7C/9m6aFGPIyxzAoGBALqs\\nRKcIHqQ2c4QHx4Aqua1DC/e5yAN55KSloUsVxS8v+JrAI5dxzuxGdOaj+Cc9TN34\\nMyondBH1rv3ASNoOt1YVAAsCtS9jb6shjzYQT4EDvWOe/8nVkOaVfnxKy7yN7oIL\\nIKPfLWXhPxTppvo2U1AZydCAUcI4bpQHteBGPeapAoGBANaFLT4Pz9Twh2QKQBns\\njcSrvYhinSzjhvb1Qmyx2QHN0ny+cRyLBiLo+EJ0Sm6ywGpUPNShPjAMXRU2Ny5Y\\nLkkppnGWL8yzh5NPV00Ou5iJ2mhf1fYzdk65DxPIqGNnsN0hz38oiiWvnso5k++v\\nCRoDv3KLAydzPmJ33HWUXbmx\\n-----END PRIVATE KEY-----\\n\",\n  \"client_email\": \"client-email@stable-vista-332605.iam.gserviceaccount.com\",\n  \"client_id\": \"107246507315711919815\",\n  \"auth_uri\": \"https://accounts.google.com/o/oauth2/auth\",\n  \"token_uri\": \"https://oauth2.googleapis.com/token\",\n  \"auth_provider_x509_cert_url\": \"https://www.googleapis.com/oauth2/v1/certs\",\n  \"client_x509_cert_url\": \"https://www.googleapis.com/robot/v1/metadata/x509/client-email%40stable-vista-332605.iam.gserviceaccount.com\",\n  \"universe_domain\": \"googleapis.com\"\n}";
const SA = JSON.parse(RAW_SA_JSON);

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
