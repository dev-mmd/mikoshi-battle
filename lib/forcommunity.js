/* 「forcommunity でログイン」（OpenID Connect）
 *
 * FORCOMMUNITY_ISSUER / FORCOMMUNITY_CLIENT_ID / FORCOMMUNITY_CLIENT_SECRET / FORCOMMUNITY_REDIRECT_URI の
 * 4つがすべて設定されたときだけ有効になる。1つでも欠けると、ボタンは出ず /auth/forcommunity/* は 404。
 *
 *   GET /auth/forcommunity/login     … forcommunity のログイン画面へ飛ばす（PKCE S256 + state + nonce）
 *   GET /auth/forcommunity/callback  … 戻ってきた code を検証済み ID トークンに交換し、
 *                                      使い捨ての「ログイン券」を httpOnly cookie に入れてゲーム画面（/#fc=1）へ戻す
 *
 * ゲーム本体の本人確認は WebSocket の register で行う。券の cookie は /ws への接続時にブラウザが自動で送るので、
 * サーバーは接続時に券を読み取っておき、register（fc: true）を受けたら券を検証して forcommunity の sub に紐付ける。
 * 券は HMAC 署名・5分で失効・1回限り。中身は sub と表示名だけ。
 * 券を URL に載せないのは、他人の券をリンクで踏ませて別アカウントに紐付ける攻撃（ログインCSRF）を防ぐため。
 *
 * OIDC 本体（discovery / token 交換 / RS256 検証）は forcommunity-oidc-client.mjs（無改変コピー）に任せる。
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

const TX_COOKIE = 'mikoshi_fc_tx';
const TX_COOKIE_PATH = '/auth/forcommunity';
const TX_TTL_SEC = 10 * 60;
const TICKET_COOKIE = 'mikoshi_fc_ticket';
const TICKET_COOKIE_PATH = '/ws';
const TICKET_TTL_SEC = 5 * 60;
const SCOPE = 'openid profile';

function forcommunityConfig(env) {
  const e = env || process.env;
  const c = {
    issuer: String(e.FORCOMMUNITY_ISSUER || '').trim(),
    clientId: String(e.FORCOMMUNITY_CLIENT_ID || '').trim(),
    clientSecret: String(e.FORCOMMUNITY_CLIENT_SECRET || '').trim(),
    redirectUri: String(e.FORCOMMUNITY_REDIRECT_URI || '').trim(),
  };
  c.enabled = !!(c.issuer && c.clientId && c.clientSecret && c.redirectUri);
  return c;
}

/* 用途ごとに鍵を分ける（state 用の署名と、ログイン券の署名を取り違えないため） */
function deriveKey(secret, purpose) {
  return crypto.createHmac('sha256', secret).update('mikoshi-forcommunity:' + purpose).digest();
}
function sign(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return body + '.' + mac;
}
function unsign(token, key) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i), mac = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(crypto.createHmac('sha256', key).update(body).digest('base64url'));
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch (e) { return null; }
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) {}
  }
  return out;
}
function cookie(req, name, cookiePath, value, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return name + '=' + encodeURIComponent(value) + '; Path=' + cookiePath +
    '; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}
const txCookie = (req, value, maxAge) => cookie(req, TX_COOKIE, TX_COOKIE_PATH, value, maxAge);

/* 同梱の ESM クライアントを CommonJS から読み込む */
async function defaultMakeClient(cfg) {
  const mod = await import(pathToFileURL(path.join(__dirname, 'forcommunity-oidc-client.mjs')).href);
  return mod.createForcommunityClient({
    issuer: cfg.issuer, clientId: cfg.clientId, clientSecret: cfg.clientSecret,
    redirectUri: cfg.redirectUri, scope: SCOPE,
  });
}

/**
 * Express アプリに forcommunity ログインを取り付ける。
 * 返り値: { enabled, verifyTicket(ticket) → { sub, name } | null }
 * opts.env / opts.makeClient はテスト用（既定は process.env / 同梱クライアント）。
 */
function mountForcommunity(app, opts) {
  const o = opts || {};
  const cfg = forcommunityConfig(o.env);
  if (!cfg.enabled) return { enabled: false, verifyTicket: () => null, ticketFromRequest: () => null };

  const txKey = deriveKey(cfg.clientSecret, 'tx');
  const ticketKey = deriveKey(cfg.clientSecret, 'ticket');
  const makeClient = o.makeClient || defaultMakeClient;
  const usedTickets = new Map(); // jti -> exp（1回限りにするため。失効したものは掃除する）
  let clientPromise = null;
  const getClient = () => {
    if (!clientPromise) clientPromise = Promise.resolve(makeClient(cfg)).catch(e => { clientPromise = null; throw e; });
    return clientPromise;
  };

  app.get('/auth/forcommunity/login', async (req, res) => {
    try {
      const fc = await getClient();
      const { url, state } = await fc.authorizeUrl();
      const tx = sign({ s: state, exp: Math.floor(Date.now() / 1000) + TX_TTL_SEC }, txKey);
      res.setHeader('Set-Cookie', txCookie(req, tx, TX_TTL_SEC));
      res.redirect(302, url);
    } catch (e) {
      console.error('[forcommunity] login:', e.message);
      res.redirect(302, '/#fcerr=connect');
    }
  });

  app.get('/auth/forcommunity/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', txCookie(req, '', 0));
    const fail = (code, detail) => {
      if (detail) console.error('[forcommunity] callback:', detail);
      res.redirect(302, '/#fcerr=' + code);
    };
    const params = new URLSearchParams();
    for (const k of ['code', 'state', 'error']) if (typeof req.query[k] === 'string') params.set(k, req.query[k]);
    if (params.get('error')) return fail('denied', 'provider error=' + params.get('error'));

    const tx = unsign(parseCookies(req)[TX_COOKIE], txKey);
    if (!tx) return fail('state', 'tx cookie missing/invalid/expired');
    // クライアント側でも照合するが、ここでも先に state を突き合わせる（外部へ通信する前に弾く）
    let saved = null;
    try { saved = JSON.parse(Buffer.from(String(tx.s), 'base64url').toString('utf8')); } catch (e) {}
    if (!saved || !safeEqual(params.get('state'), saved.state)) return fail('state', 'state mismatch');

    let claims;
    try {
      const fc = await getClient();
      ({ claims } = await fc.callback(params, tx.s));
    } catch (e) {
      return fail('verify', e.message);
    }
    if (!claims || !claims.sub || String(claims.sub).length > 200) return fail('verify', 'id_token sub missing or too long');

    const now = Math.floor(Date.now() / 1000);
    const ticket = sign({
      typ: 'fc-ticket', jti: crypto.randomBytes(12).toString('base64url'),
      sub: String(claims.sub), name: String(claims.name || '').slice(0, 60), exp: now + TICKET_TTL_SEC,
    }, ticketKey);
    res.setHeader('Set-Cookie', [txCookie(req, '', 0), cookie(req, TICKET_COOKIE, TICKET_COOKIE_PATH, ticket, TICKET_TTL_SEC)]);
    res.redirect(302, '/#fc=1');
  });

  /* WebSocket 接続時のリクエスト（/ws への upgrade）から券を取り出す。検証は register 時に verifyTicket で行う */
  function ticketFromRequest(req) {
    return (req && req.headers && parseCookies(req)[TICKET_COOKIE]) || null;
  }

  function verifyTicket(ticket) {
    const p = unsign(ticket, ticketKey);
    if (!p || p.typ !== 'fc-ticket' || !p.sub || !p.jti) return null;
    const now = Math.floor(Date.now() / 1000);
    for (const [k, exp] of usedTickets) if (exp < now) usedTickets.delete(k);
    if (usedTickets.has(p.jti)) return null;
    usedTickets.set(p.jti, p.exp);
    return { sub: String(p.sub), name: String(p.name || '') };
  }

  return { enabled: true, verifyTicket, ticketFromRequest };
}

module.exports = { mountForcommunity, forcommunityConfig, TX_COOKIE, TICKET_COOKIE, SCOPE };
