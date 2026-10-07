/**
 * forcommunity でログイン — 依存ゼロの OIDC クライアント（Node 18+ / Bun / Deno）。
 * このファイル 1 つを各プロダクトにコピーして使う。Auth.js / NextAuth のあるアプリは
 * そちらの OIDC provider 設定を使うこと（README 参照）。
 *
 *   const fc = createForcommunityClient({ issuer, clientId, clientSecret, redirectUri });
 *   // /login:    const { url, state } = await fc.authorizeUrl(); state を httpOnly cookie に保存 → url へ 302
 *   // /callback: const { claims } = await fc.callback(new URL(req.url).searchParams, state);
 *   //            claims.sub が forcommunity のユーザーID。claims.email / email_verified / name / picture
 */
import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const rand = () => b64u(randomBytes(32));

export function createForcommunityClient({ issuer, clientId, clientSecret, redirectUri, scope = "openid profile email" }) {
  if (!issuer || !clientId || !redirectUri) throw new Error("issuer, clientId, redirectUri are required");
  const iss = issuer.replace(/\/+$/, "");
  let discovery;
  let jwks = { at: 0, keys: [] };

  async function meta() {
    if (!discovery) {
      const r = await fetch(`${iss}/.well-known/openid-configuration`);
      if (!r.ok) throw new Error(`discovery failed: ${r.status}`);
      discovery = await r.json();
      if (discovery.issuer !== iss) throw new Error("issuer mismatch in discovery");
    }
    return discovery;
  }

  async function keyFor(kid) {
    const find = () => jwks.keys.find((k) => k.kid === kid);
    if (!find() || Date.now() - jwks.at > 10 * 60 * 1000) {
      const r = await fetch((await meta()).jwks_uri);
      jwks = { at: Date.now(), keys: (await r.json()).keys || [] };
    }
    const jwk = find();
    if (!jwk) throw new Error("unknown signing key");
    return createPublicKey({ key: jwk, format: "jwk" });
  }

  async function verifyIdToken(idToken, nonce) {
    const [h, p, s] = String(idToken).split(".");
    const header = JSON.parse(Buffer.from(h, "base64url"));
    if (header.alg !== "RS256") throw new Error("unexpected alg");
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(await keyFor(header.kid), Buffer.from(s, "base64url"));
    if (!ok) throw new Error("bad id_token signature");
    const c = JSON.parse(Buffer.from(p, "base64url"));
    const now = Math.floor(Date.now() / 1000);
    if (c.iss !== iss) throw new Error("iss mismatch");
    if (c.aud !== clientId && !(Array.isArray(c.aud) && c.aud.includes(clientId))) throw new Error("aud mismatch");
    if (typeof c.exp !== "number" || c.exp < now - 60) throw new Error("id_token expired");
    if (c.nonce !== nonce) throw new Error("nonce mismatch");
    return c;
  }

  return {
    /** 返り値の state（=保存用トークン）を httpOnly cookie 等に保存し、url へリダイレクトする。 */
    async authorizeUrl({ prompt } = {}) {
      const m = await meta();
      const st = { state: rand(), nonce: rand(), verifier: rand() };
      const u = new URL(m.authorization_endpoint);
      u.search = new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope,
        state: st.state, nonce: st.nonce,
        code_challenge: b64u(createHash("sha256").update(st.verifier).digest()), code_challenge_method: "S256",
        ...(prompt ? { prompt } : {}),
      }).toString();
      return { url: u.toString(), state: Buffer.from(JSON.stringify(st)).toString("base64url") };
    },

    /** callback の query と、authorizeUrl で保存した state を渡す。検証済み claims を返す。 */
    async callback(searchParams, savedState) {
      const st = JSON.parse(Buffer.from(String(savedState || ""), "base64url").toString() || "{}");
      if (searchParams.get("error")) throw new Error(`forcommunity: ${searchParams.get("error")}`);
      if (!st.state || searchParams.get("state") !== st.state) throw new Error("state mismatch");
      const m = await meta();
      const body = new URLSearchParams({
        grant_type: "authorization_code", code: searchParams.get("code") || "",
        redirect_uri: redirectUri, client_id: clientId, code_verifier: st.verifier,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      });
      const r = await fetch(m.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
      const tokens = await r.json();
      if (!r.ok) throw new Error(`token exchange failed: ${tokens.error || r.status}`);
      const claims = await verifyIdToken(tokens.id_token, st.nonce);
      return { claims, tokens };
    },
  };
}
