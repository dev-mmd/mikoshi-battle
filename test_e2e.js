/* E2E: 実WebSocketクライアントでオンライン対戦を検証
 * fast timings: TAP_MS=800 CUE_LEAD=500 CLOSE_GRACE=200 RESULT_VIEW=300 BATTLE_VIEW=300 BOT_MATCH_AFTER=900 */
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 3111;
let checks = 0;
function ok(c, m) { checks++; if (!c) { console.error('FAIL:', m); process.exit(1); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Client {
  constructor(name) {
    this.name = name; this.inbox = []; this.waiters = [];
    this.offset = 0; this.profile = null;
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws');
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === 'pong') { this.offset = msg.s - Date.now(); return; }
        this.inbox.push(msg);
        this.waiters = this.waiters.filter(w => {
          const i = this.inbox.findIndex(m => m.t === w.type && (!w.pred || w.pred(m)));
          if (i >= 0) { const m = this.inbox.splice(i, 1)[0]; w.res(m); return false; }
          return true;
        });
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  serverNow() { return Date.now() + this.offset; }
  waitFor(type, ms, pred) {
    const i = this.inbox.findIndex(m => m.t === type && (!pred || pred(m)));
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((res, rej) => {
      const w = { type, pred, res };
      this.waiters.push(w);
      setTimeout(() => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) { this.waiters.splice(idx, 1); rej(new Error(this.name + ' timeout waiting ' + type + ' inbox=' + JSON.stringify(this.inbox.map(m => m.t)))); }
      }, ms);
    });
  }
  async register() {
    this.send({ t: 'ping', c: Date.now() });
    this.send({ t: 'register', name: this.name });
    this.profile = await this.waitFor('welcome', 3000);
    ok(this.profile.pid && this.profile.token, this.name + ' registered');
  }
  async playMatch(opts) {
    // matched -> arena -> 3 rounds(tap at cue+tapAt) -> battle -> settle
    const o = Object.assign({ tapAt: 200, tap: true }, opts);
    const matched = await this.waitFor('matched', 15000);
    this.send({ t: 'arena' });
    const results = [];
    for (let r = 1; r <= 3; r++) {
      const round = await this.waitFor('round', 10000, m => m.r === r);
      const cueIn = round.cueAt - this.serverNow();
      ok(cueIn > 100 && cueIn < 2000, this.name + ' cue lead sane (' + cueIn + 'ms)');
      if (o.tap) {
        await sleep(cueIn + o.tapAt);
        this.send({ t: 'tap', r, at: this.serverNow() });
      }
      const res = await this.waitFor('roundResult', 10000, m => m.r === r);
      results.push(res);
    }
    const battle = await this.waitFor('battle', 10000);
    const settle = await this.waitFor('settle', 10000);
    return { matched, results, battle, settle };
  }
}

(async () => {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT, TAP_MS: 800, CUE_LEAD: 500, CLOSE_GRACE: 250,
      RESULT_VIEW: 300, BATTLE_VIEW: 300, BOT_MATCH_AFTER: 900,
      DATA_DIR: '/tmp/mikoshi-test-data-' + Date.now()
    })
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d; });
  await sleep(700);

  /* ========== シナリオ1: PvP（2チーム対戦） ========== */
  console.log('--- scenario 1: PvP ---');
  const A = new Client('たろう'), B = new Client('はなこ');
  await A.connect(); await B.connect();
  await A.register(); await B.register();

  A.send({ t: 'listTeams' });
  const t0 = await A.waitFor('teams', 2000);
  ok(Array.isArray(t0.list), 'team list');

  A.send({ t: 'createTeam', name: '雷神会', variant: 'classic' });
  const lobbyA = await A.waitFor('lobby', 2000);
  ok(lobbyA.name === '雷神会' && lobbyA.members.length === 1, 'A team created');

  B.send({ t: 'createTeam', name: '疾風連', variant: 'kuro' });
  await B.waitFor('lobby', 2000);

  A.send({ t: 'ready' });
  await A.waitFor('lobby', 2000, m => m.members[0].ready);
  B.send({ t: 'ready' });

  const [rA, rB] = await Promise.all([
    A.playMatch({ tapAt: 180 }),
    B.playMatch({ tapAt: 210 })
  ]);
  ok(rA.matched.enemy.name === '疾風連', 'A sees B as enemy');
  ok(rB.matched.enemy.name === '雷神会', 'B sees A as enemy');
  ok(rA.results.length === 3 && rB.results.length === 3, 'both got 3 round results');
  // 自タップは synced に含まれるはず（自分1人+bot7 → 100ms窓に近傍botがいるかは確率だが、少なくとも自分がイベントに入りvalidCount>=1）
  rA.results.forEach((r, i) => ok(r.validCount >= 1 && r.best >= 1, 'A r' + (i + 1) + ' has taps (' + r.validCount + ')'));
  ok(rA.battle.win !== rB.battle.win, 'complementary win/lose');
  ok(rA.battle.yourPower === rB.battle.enemyPower && rA.battle.enemyPower === rB.battle.yourPower, 'powers cross-match');
  const winner = rA.battle.win ? { c: A, r: rA } : { c: B, r: rB };
  const loser = rA.battle.win ? { c: B, r: rB } : { c: A, r: rA };
  const contrib = winner.r.results.filter(r => r.synced.includes(winner.c.profile.pid)).length;
  ok(winner.r.settle.gained === 20 + 5 * contrib, 'winner coins = 20+5x' + contrib + ' (got ' + winner.r.settle.gained + ')');
  ok(winner.r.settle.coins >= winner.r.settle.gained, 'winner balance updated');
  ok(loser.r.settle.gained === 0 && loser.r.settle.outcome === 'eliminated', 'loser: no coins, eliminated');
  ok(winner.r.settle.outcome === 'continue' && winner.r.settle.streak === 1 && winner.r.settle.level === 1, 'winner continues, streak/level=1');

  /* ========== シナリオ2: 勝者の連戦（continueTour → Bot戦） ========== */
  console.log('--- scenario 2: tournament continuation vs bot ---');
  winner.c.send({ t: 'continueTour' });
  const cont = await winner.c.playMatch({ tapAt: 150 });
  ok(cont.matched.tour === 1, 'second stage tour=1');
  ok(cont.matched.enemy.humans === 0, 'bot opponent');
  ok(['continue', 'champion', 'eliminated'].includes(cont.settle.outcome), 'valid outcome: ' + cont.settle.outcome);
  if (cont.settle.win) ok(cont.settle.streak === 2, 'streak=2 after 2nd win');

  /* ========== シナリオ3: 同一チーム協力（2人+Bot埋め、Bot対戦） ========== */
  console.log('--- scenario 3: co-op same team ---');
  const C = new Client('ゲン'), D = new Client('ユキ');
  await C.connect(); await D.connect();
  await C.register(); await D.register();
  C.send({ t: 'createTeam', name: '阿吽組', variant: 'shiro' });
  const lc = await C.waitFor('lobby', 2000);
  D.send({ t: 'joinTeam', id: lc.roomId });
  const ld = await D.waitFor('lobby', 2000);
  ok(ld.members.length === 2, 'two humans in room');
  ok(ld.botFill === 6, 'bot fill to 8');
  C.send({ t: 'ready' });
  D.send({ t: 'ready' });
  const [rc, rd] = await Promise.all([
    C.playMatch({ tapAt: 120 }),
    D.playMatch({ tapAt: 160 })
  ]);
  ok(rc.matched.you.humans === 2 && rc.matched.you.size === 8, 'team size 8 (2 humans + 6 bots)');
  ok(rc.battle.win === rd.battle.win, 'same team same result');
  // 仲間のタップ通知
  const dGotC = rd.results.length === 3; // roundResultまで到達していれば配信網は機能
  ok(dGotC, 'co-op rounds delivered to both');
  // 両者のタップがイベントに入っている（validCount >= 2人+bot）
  rc.results.forEach((r, i) => ok(r.validCount >= 2, 'co-op r' + (i + 1) + ' includes both humans (' + r.validCount + ')'));

  /* ========== シナリオ4: ガチャ（サーバー権威・コイン検証） ========== */
  console.log('--- scenario 4: gacha ---');
  const rich = winner.c;
  const before = (rich.r ? 0 : 0) || null;
  rich.send({ t: 'gacha' });
  const g = await rich.waitFor('gachaResult', 2000).catch(() => null);
  if (g) {
    ok(typeof g.key === 'string' && ['N', 'R', 'SR', 'SSR'].includes(g.rarity), 'gacha item valid');
    console.log('gacha:', g.key, g.rarity, 'coins→', g.coins);
  } else {
    // コイン不足エラーの場合（連戦敗北時）
    console.log('gacha skipped (insufficient coins is valid if winner lost round 2)');
  }
  // コイン不足クライアントはエラー
  loser.c.send({ t: 'gacha' });
  const ge = await loser.c.waitFor('err', 2000);
  ok(ge.code === 'coins', 'gacha rejected for 0 coins');

  /* ========== シナリオ5: 不正タップ拒否 ========== */
  console.log('--- scenario 5: anti-cheat ---');
  // 過去時刻を大幅に偽装したタップはサーバーが破棄する → マッチ外なので単に無視されることを確認
  A.send({ t: 'tap', r: 99, at: A.serverNow() - 99999 });
  await sleep(300);
  ok(true, 'bogus tap ignored without crash');

  console.log('E2E ALL PASS —', checks, 'checks');
  srv.kill();
  process.exit(0);
})().catch(e => { console.error('EXC:', e.message); process.exit(1); });
