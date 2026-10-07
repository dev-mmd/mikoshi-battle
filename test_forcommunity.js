/* forcommunity でログイン（OIDC）のテスト — node:test
 *   1. 環境変数が欠けていれば無効（ボタン非表示・ルート 404）
 *   2. state が一致しなければ拒否（外部へ通信しない）
 *   3. 差し替えたクライアントで成功 → ログイン券（httpOnly cookie。URLには載せない）→ 1回限り
 *   4. 実サーバー（server.js）+ 同梱クライアント + 偽の forcommunity（RS256）で通しの成功と券の再利用拒否
 * 実行: node --test test_forcommunity.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const WebSocket = require('ws');
const { mountForcommunity, TX_COOKIE, TICKET_COOKIE } = require('./lib/forcommunity');

const FULL_ENV = {
  FORCOMMUNITY_ISSUER: 'https://idp.example',
  FORCOMMUNITY_CLIENT_ID: 'mikoshi-battle',
  FORCOMMUNITY_CLIENT_SECRET: 'test-secret-not-real',
  FORCOMMUNITY_REDIRECT_URI: 'http://127.0.0.1/auth/forcommunity/callback',
};

function listen(app) {
  return new Promise(res => { const s = http.createServer(app).listen(0, '127.0.0.1', () => res(s)); });
}
const base = s => 'http://127.0.0.1:' + s.address().port;
const get = (url, headers) => fetch(url, { redirect: 'manual', headers: headers || {} });
const cookieFrom = r => (r.headers.get('set-cookie') || '').split(';')[0];
/* callback の応答から券の cookie（mikoshi_fc_ticket=...）を取り出す */
const ticketCookieFrom = r => {
  const c = r.headers.getSetCookie().find(v => v.startsWith(TICKET_COOKIE + '='));
  assert.ok(c, '券の cookie が発行される');
  assert.match(c, /HttpOnly/); assert.match(c, /Path=\/ws/); assert.match(c, /Max-Age=300/);
  return c.split(';')[0];
};
const ticketOf = cookie => decodeURIComponent(cookie.slice(TICKET_COOKIE.length + 1));

/* authorizeUrl / callback を差し替えたクライアント。callback の呼び出し回数を数える */
function mockClient(claims) {
  const calls = { callback: 0 };
  const client = {
    async authorizeUrl() {
      const st = { state: 'STATE-' + crypto.randomBytes(6).toString('hex'), nonce: 'N', verifier: 'V' };
      return { url: 'https://idp.example/authorize?state=' + st.state, state: Buffer.from(JSON.stringify(st)).toString('base64url') };
    },
    async callback(params, saved) {
      calls.callback++;
      const st = JSON.parse(Buffer.from(saved, 'base64url').toString());
      if (params.get('state') !== st.state) throw new Error('state mismatch');
      return { claims, tokens: {} };
    },
  };
  return { client, calls };
}

test('環境変数が1つでも欠けていれば無効: ルートは404、券は通らない', async () => {
  for (const drop of Object.keys(FULL_ENV)) {
    const env = Object.assign({}, FULL_ENV); delete env[drop];
    const app = express();
    const fc = mountForcommunity(app, { env, makeClient: () => { throw new Error('must not be called'); } });
    assert.equal(fc.enabled, false, drop + ' 欠落で無効');
    assert.equal(fc.verifyTicket('x.y'), null);
    const s = await listen(app);
    try {
      assert.equal((await get(base(s) + '/auth/forcommunity/login')).status, 404);
      assert.equal((await get(base(s) + '/auth/forcommunity/callback?code=a&state=b')).status, 404);
    } finally { s.close(); }
  }
});

test('state が一致しない／途中情報の cookie が無いときは拒否し、トークン交換をしない', async () => {
  const { client, calls } = mockClient({ sub: 'u1', name: '太郎' });
  const app = express();
  mountForcommunity(app, { env: FULL_ENV, makeClient: () => client });
  const s = await listen(app);
  try {
    const login = await get(base(s) + '/auth/forcommunity/login');
    assert.equal(login.status, 302);
    assert.match(login.headers.get('location'), /^https:\/\/idp\.example\/authorize/);
    const sc = login.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Max-Age=600/);

    const bad = await get(base(s) + '/auth/forcommunity/callback?code=c&state=WRONG', { cookie: cookieFrom(login) });
    assert.equal(bad.status, 302);
    assert.equal(bad.headers.get('location'), '/#fcerr=state');

    const noCookie = await get(base(s) + '/auth/forcommunity/callback?code=c&state=whatever');
    assert.equal(noCookie.headers.get('location'), '/#fcerr=state');

    // 署名を改ざんした cookie も拒否
    const forged = cookieFrom(login).replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
    const f = await get(base(s) + '/auth/forcommunity/callback?code=c&state=x', { cookie: forged });
    assert.equal(f.headers.get('location'), '/#fcerr=state');

    assert.equal(calls.callback, 0, 'state 不一致では forcommunity へ問い合わせない');
  } finally { s.close(); }
});

test('成功: claims.sub と claims.name がログイン券に入り、券は1回だけ使える', async () => {
  const { client, calls } = mockClient({ sub: 'fc-user-123', name: '花子' });
  const app = express();
  const fc = mountForcommunity(app, { env: FULL_ENV, makeClient: () => client });
  const s = await listen(app);
  try {
    const login = await get(base(s) + '/auth/forcommunity/login');
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    const cb = await get(base(s) + '/auth/forcommunity/callback?code=c&state=' + state, { cookie: cookieFrom(login) });
    assert.equal(cb.status, 302);
    assert.ok(cb.headers.getSetCookie().some(v => new RegExp('^' + TX_COOKIE + '=; .*Max-Age=0').test(v)), '途中情報の cookie は消す');
    assert.equal(cb.headers.get('cache-control'), 'no-store');
    const loc = cb.headers.get('location');
    assert.equal(loc, '/#fc=1', '券は URL に載せない');
    assert.equal(calls.callback, 1);
    const ticket = ticketOf(ticketCookieFrom(cb));
    assert.deepEqual(fc.verifyTicket(ticket), { sub: 'fc-user-123', name: '花子' });
    assert.equal(fc.verifyTicket(ticket), null, '2回目は拒否');
    assert.equal(fc.verifyTicket(ticket.slice(0, -2) + 'xx'), null, '改ざんは拒否');
  } finally { s.close(); }
});

/* ---------- 偽の forcommunity（discovery / token / jwks、RS256 署名） ---------- */
function fakeIdp() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
  const codes = new Map(); // code -> { nonce, challenge, sub, name }
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const idp = { codes };
  app.get('/.well-known/openid-configuration', (req, res) => res.json({
    issuer: idp.issuer, authorization_endpoint: idp.issuer + '/api/oauth/authorize',
    token_endpoint: idp.issuer + '/api/oauth/token', jwks_uri: idp.issuer + '/api/oauth/jwks',
  }));
  app.get('/api/oauth/jwks', (req, res) => res.json({ keys: [jwk] }));
  app.post('/api/oauth/token', (req, res) => {
    const c = codes.get(req.body.code);
    codes.delete(req.body.code);
    if (!c || req.body.client_secret !== FULL_ENV.FORCOMMUNITY_CLIENT_SECRET) return res.status(400).json({ error: 'invalid_grant' });
    const chal = crypto.createHash('sha256').update(String(req.body.code_verifier)).digest('base64url');
    if (chal !== c.challenge) return res.status(400).json({ error: 'invalid_grant' });
    const now = Math.floor(Date.now() / 1000);
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const p = enc({ iss: idp.issuer, aud: req.body.client_id, sub: c.sub, name: c.name, nonce: c.nonce, iat: now, exp: now + 3600 });
    const sig = crypto.createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
    res.json({ id_token: h + '.' + p + '.' + sig, access_token: 'at', token_type: 'Bearer' });
  });
  idp.app = app;
  return idp;
}

function waitForServer(url, ms) {
  const until = Date.now() + ms;
  return new Promise((res, rej) => {
    (function poll() {
      fetch(url).then(r => (r.ok ? res() : retry())).catch(retry);
      function retry() { if (Date.now() > until) rej(new Error('server not up')); else setTimeout(poll, 150); }
    })();
  });
}
/* サーバーを止め、終了を待つ（次のテストとポートが重ならないように） */
function stopServer(srv) {
  if (srv.exitCode !== null) return Promise.resolve();
  return new Promise(r => { srv.once('exit', r); srv.kill(); });
}
function wsRegister(port, msg, cookie) {
  return new Promise((res, rej) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws', cookie ? { headers: { cookie } } : {});
    const timer = setTimeout(() => { ws.close(); rej(new Error('ws timeout')); }, 4000);
    ws.on('open', () => ws.send(JSON.stringify(msg)));
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome' || m.t === 'err') { clearTimeout(timer); ws.close(); res(m); }
    });
    ws.on('error', rej);
  });
}

test('通し: server.js + 同梱クライアント + 偽 forcommunity でログインし、WebSocket で forcommunity 本人として参加', async () => {
  const idp = fakeIdp();
  const idpServer = await listen(idp.app);
  idp.issuer = base(idpServer);
  const PORT = 3113;
  const app = 'http://127.0.0.1:' + PORT;
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname, stdio: ['ignore', 'ignore', 'inherit'],
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATA_DIR: '/tmp/mikoshi-fctest-' + Date.now(), GOOGLE_CLIENT_ID: '',
      FORCOMMUNITY_ISSUER: idp.issuer, FORCOMMUNITY_CLIENT_ID: FULL_ENV.FORCOMMUNITY_CLIENT_ID,
      FORCOMMUNITY_CLIENT_SECRET: FULL_ENV.FORCOMMUNITY_CLIENT_SECRET,
      FORCOMMUNITY_REDIRECT_URI: app + '/auth/forcommunity/callback',
    }),
  });
  try {
    await waitForServer(app + '/healthz', 20000);
    const cfg = await (await fetch(app + '/auth-config')).json();
    assert.equal(cfg.forcommunity, true);

    // 既存のニックネームアカウント（紐付けで戦績を引き継ぐ確認用）
    const nick = await wsRegister(PORT, { t: 'register', name: 'まつり' });
    assert.equal(nick.t, 'welcome'); assert.equal(nick.forcommunity, false);

    const login = await get(app + '/auth/forcommunity/login');
    assert.equal(login.status, 302);
    const authz = new URL(login.headers.get('location'));
    assert.equal(authz.origin + authz.pathname, idp.issuer + '/api/oauth/authorize');
    assert.equal(authz.searchParams.get('scope'), 'openid profile');
    assert.equal(authz.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authz.searchParams.get('redirect_uri'), app + '/auth/forcommunity/callback');

    // 偽 forcommunity がユーザーを認証して code を返したことにする
    idp.codes.set('code-1', { nonce: authz.searchParams.get('nonce'), challenge: authz.searchParams.get('code_challenge'), sub: 'fc-sub-777', name: '山田' });
    const cb = await get(app + '/auth/forcommunity/callback?code=code-1&state=' + encodeURIComponent(authz.searchParams.get('state')), { cookie: cookieFrom(login) });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/#fc=1');
    const tc = ticketCookieFrom(cb);

    // 券の cookie を持たない接続（＝他人のリンクを踏まされた等）では forcommunity 参加にならない
    const noTicket = await wsRegister(PORT, { t: 'register', fc: true, token: nick.token });
    assert.equal(noTicket.t, 'err'); assert.equal(noTicket.code, 'forcommunity');

    const w = await wsRegister(PORT, { t: 'register', fc: true, token: nick.token }, tc);
    assert.equal(w.t, 'welcome');
    assert.equal(w.forcommunity, true);
    assert.equal(w.pid, nick.pid, '既存ニックネームアカウントに紐付く');

    const again = await wsRegister(PORT, { t: 'register', fc: true }, tc);
    assert.equal(again.t, 'err'); assert.equal(again.code, 'forcommunity', '券の再利用は拒否');

    // 別端末（token なし）で2回目のログイン → 同じ sub なので同じプレイヤー
    const login2 = await get(app + '/auth/forcommunity/login');
    const a2 = new URL(login2.headers.get('location'));
    idp.codes.set('code-2', { nonce: a2.searchParams.get('nonce'), challenge: a2.searchParams.get('code_challenge'), sub: 'fc-sub-777', name: '山田' });
    const cb2 = await get(app + '/auth/forcommunity/callback?code=code-2&state=' + encodeURIComponent(a2.searchParams.get('state')), { cookie: cookieFrom(login2) });
    const w2 = await wsRegister(PORT, { t: 'register', fc: true }, ticketCookieFrom(cb2));
    assert.equal(w2.pid, nick.pid, '別端末でも同じデータ');

    // 使い済みの code（偽 forcommunity が拒否）→ 検証失敗としてゲームへ戻す
    const cb3 = await get(app + '/auth/forcommunity/callback?code=code-1&state=' + encodeURIComponent(a2.searchParams.get('state')), { cookie: cookieFrom(login2) });
    assert.equal(cb3.headers.get('location'), '/#fcerr=verify');
  } finally {
    await stopServer(srv); idpServer.close();
  }
});

test('server.js: FORCOMMUNITY_* 未設定なら /auth-config は forcommunity:false、ルートは404', async () => {
  const PORT = 3114;
  const app = 'http://127.0.0.1:' + PORT;
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: '/tmp/mikoshi-fctest-off-' + Date.now() });
  for (const k of Object.keys(FULL_ENV)) delete env[k];
  const srv = spawn('node', ['server.js'], { cwd: __dirname, stdio: ['ignore', 'ignore', 'inherit'], env });
  try {
    await waitForServer(app + '/healthz', 20000);
    assert.equal((await (await fetch(app + '/auth-config')).json()).forcommunity, false);
    assert.equal((await get(app + '/auth/forcommunity/login')).status, 404);
    assert.equal((await get(app + '/auth/forcommunity/callback')).status, 404);
    const m = await wsRegister(PORT, { t: 'register', fc: true }, TICKET_COOKIE + '=a.b');
    assert.equal(m.t, 'err'); assert.equal(m.code, 'forcommunity');
  } finally { await stopServer(srv); }
});
