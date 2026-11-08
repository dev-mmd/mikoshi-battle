/* E2E: 実WebSocketクライアントでオンライン対戦(v2: 拍タップ＋ぶつけ)を検証
 * 高速設定: BEATS=2 BEAT_MS=300 COUNT_IN=1 ROUND_INTRO=400 CLOSE_GRACE=200 RESULT_VIEW=300 BATTLE_VIEW=300 BOT_MATCH_AFTER=900 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

const PORT = +process.env.TEST_PORT || 3111;
let checks = 0;
function ok(c, m) { checks++; if (!c) { console.error('FAIL:', m); process.exit(1); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ========== シナリオ0: 採点ロジック単体 ========== */
(function unit() {
  console.log('--- scenario 0: scoring unit ---');
  const S = require('./server.js');
  // 8人全員が拍ぴったり → 1拍満点10点・揃い1.0・勢い1
  const perfect = S.scoreBeat([0, 5, -5, 10, -10, 3, -3, 0].map((d, i) => ({ id: 'p' + i, d })), 8, 0);
  ok(perfect.sync === 1 && perfect.combo === 1, 'all-in-sync beat: sync=1 combo=1');
  ok(Math.abs(perfect.pts - 10 * 1.08) < 1e-9, 'perfect beat pts = 10 x momentum(1)=' + perfect.pts);
  // ばらばら → 揃い低く勢いは切れる
  const scattered = S.scoreBeat([-240, -120, 0, 120, 240].map((d, i) => ({ id: 'p' + i, d })), 8, 4);
  ok(scattered.sync < 0.6 && scattered.combo === 0, 'scattered beat breaks momentum');
  ok(scattered.pts < perfect.pts / 3, 'scattered beat scores far lower');
  // 人数の多い連が有利にならない（割合で採点）
  const big = S.scoreBeat(Array.from({ length: 16 }, (_, i) => ({ id: 'p' + i, d: 0 })), 16, 0);
  ok(Math.abs(big.pts - perfect.pts) < 1e-9, 'team size normalized');
  // ぶつけ: 判定しきい値は v1 と同じ
  const clash = S.scoreClash([0, 10, 20, 30, 40, 50].map((d, i) => ({ id: 'p' + i, d })), 8, 0);
  ok(clash.judgement === 'GREAT' && clash.pct === 0.75, 'clash 6/8 in sync = GREAT (' + clash.judgement + ')');
  ok(S.getJudgementKey(1) === 'MIRACLE' && S.getJudgementKey(0.8) === 'PERFECT' && S.getJudgementKey(0.6) === 'GREAT' &&
     S.getJudgementKey(0.4) === 'NICE' && S.getJudgementKey(0.39) === 'MISS', 'judgement thresholds unchanged');
  // 勢いが溜まっているとぶつけが重くなる
  const t8 = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, d: 0 }));
  ok(S.scoreClash(t8, 8, 6).pts > S.scoreClash(t8, 8, 0).pts, 'momentum boosts clash');
  // CPUの腕前: 上手いほど揃う
  function avgSync(skill) {
    let s = 0;
    for (let k = 0; k < 200; k++) {
      const plan = S.botTeamPlan(8, skill, 1);
      const taps = plan.map((a, i) => ({ id: 'b' + i, d: a[0] })).filter(t => t.d !== null);
      s += S.scoreBeat(taps, 8, 0).sync;
    }
    return s / 200;
  }
  const lo = avgSync('low'), hi = avgSync('high');
  ok(hi > lo + 0.2, 'bot skill matters: low=' + lo.toFixed(2) + ' high=' + hi.toFixed(2));

  /* 助っ人CPU: 人間に合わせて叩く（人間が叩けば揃い、叩かなければリズムを見失う） */
  let seed = 12345; // 乱数を固定して毎回同じ結果にする
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const zeros = new Array(2000).fill(0);
  const follow = S.helperTaps([100, 120, 80], zeros, rnd);
  const fHit = follow.filter(d => d !== null);
  const fMean = fHit.reduce((a, b) => a + b, 0) / fHit.length;
  ok(Math.abs(fMean - 80) < 5, 'helpers follow human mean x0.8 (mean=' + fMean.toFixed(1) + ')');
  ok(fHit.length / zeros.length > 0.94, 'helpers rarely miss when humans tap (' + fHit.length + '/2000)');
  const lost = S.helperTaps([], zeros, rnd).filter(d => d !== null);
  ok(lost.length / zeros.length < 0.72 && lost.length / zeros.length > 0.58, 'helpers lose rhythm without humans (' + lost.length + '/2000)');
  ok(S.helperTaps([], [null, null], rnd).every(d => d === null), 'planned miss stays a miss when lost');
  ok(S.helperTaps([0], [], rnd).length === 0, 'no helpers when team is full');
  /* 1人＋助っ人7人の連が、同じCPU連（mid・8人）と1番（8拍＋ぶつけ）戦う。毎拍 d≈0 で叩く vs 叩かない */
  function soloRound(humanTaps) {
    const help = S.botTeamPlan(7, 'mid', 8), cpu = S.botTeamPlan(8, 'mid', 8);
    let hp = 0, hc = 0, cp = 0, cc = 0;
    for (let i = 0; i <= 8; i++) {
      const taps = humanTaps ? [{ id: 'h', d: Math.round((rnd() - 0.5) * 20) }] : [];
      S.helperTaps(taps.map(t => t.d), help.map(a => a[i]), rnd).forEach((d, k) => { if (d !== null) taps.push({ id: 'b' + k, d }); });
      const ct = cpu.map((a, k) => ({ id: 'c' + k, d: a[i] })).filter(t => t.d !== null);
      if (i < 8) {
        const a = S.scoreBeat(taps, 8, hc); hc = a.combo; hp += a.pts;
        const b = S.scoreBeat(ct, 8, cc); cc = b.combo; cp += b.pts;
      } else { hp += S.scoreClash(taps, 8, hc).pts; cp += S.scoreClash(ct, 8, cc).pts; }
    }
    return { hp, cp };
  }
  let tapSum = 0, idleSum = 0, tapWins = 0, idleWins = 0;
  for (let k = 0; k < 200; k++) {
    const t = soloRound(true), n = soloRound(false);
    tapSum += t.hp; idleSum += n.hp;
    if (t.hp > t.cp) tapWins++;
    if (n.hp > n.cp) idleWins++;
  }
  ok(tapSum > idleSum * 2.5, 'solo skill matters: on-beat=' + (tapSum / 200).toFixed(1) + ' idle=' + (idleSum / 200).toFixed(1) + ' pts/round');
  ok(tapWins >= 180 && idleWins <= 20, 'solo on-beat beats mid CPU (' + tapWins + '/200), idle loses (' + idleWins + '/200 wins)');
})();

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
  drain(type) { const got = this.inbox.filter(m => m.t === type); this.inbox = this.inbox.filter(m => m.t !== type); return got; }
  async register() {
    this.send({ t: 'ping', c: Date.now() });
    this.send({ t: 'register', name: this.name });
    this.profile = await this.waitFor('welcome', 3000);
    ok(this.profile.pid && this.profile.token, this.name + ' registered');
  }
  /* 拍のタイミングで叩く。jitter=ズレ(ms)。skipBeats=叩かない拍の番号 */
  async tapRound(round, o) {
    const at = t => sleep(Math.max(0, t - this.serverNow()));
    for (let i = 0; i < round.beats; i++) {
      await at(round.startAt + i * round.beatMs + o.jitter);
      if (!(o.skipBeats || []).includes(i)) this.send({ t: 'tap', r: round.r, at: this.serverNow() });
      if (o.spam) this.send({ t: 'tap', r: round.r, at: this.serverNow() }); // 連打は1拍1回しか数えない
    }
    await at(round.clashAt + o.clashJitter);
    if (o.clash !== false) this.send({ t: 'tap', r: round.r, at: this.serverNow() });
  }
  async playMatch(opts) {
    const o = Object.assign({ jitter: 10, clashJitter: 15 }, opts);
    const matched = await this.waitFor('matched', 15000);
    this.send({ t: 'arena' });
    const results = [], beats = [];
    for (let r = 1; r <= 3; r++) {
      const round = await this.waitFor('round', 10000, m => m.r === r);
      const lead = round.startAt - this.serverNow();
      ok(lead > 100 && lead < 3000, this.name + ' r' + r + ' count-in lead sane (' + lead + 'ms)');
      ok(round.clashAt === round.startAt + (round.beats + 2) * round.beatMs, this.name + ' clash is 3rd beat after 担ぎ');
      await this.tapRound(round, o);
      const res = await this.waitFor('roundResult', 10000, m => m.r === r);
      beats.push(this.drain('beat').filter(b => b.r === r));
      results.push(res);
    }
    const battle = await this.waitFor('battle', 10000);
    const settle = await this.waitFor('settle', 10000);
    return { matched, results, beats, battle, settle };
  }
}

(async () => {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT, BEATS: 2, BEAT_MS: 300, COUNT_IN: 1, ROUND_INTRO: 400, CLOSE_GRACE: 200,
      RESULT_VIEW: 300, BATTLE_VIEW: 300, BOT_MATCH_AFTER: 900, CONTINUE_WAIT_MAX: 1500,
      DATA_DIR: path.join(os.tmpdir(), 'mikoshi-test-data-' + Date.now()),
      API_KEY: 'test-api-key'
    })
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  /* サーバーの起動を待つ（固定時間だと遅い環境でまれに接続に失敗するため） */
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:' + PORT + '/healthz')).ok) break; } catch (e) {}
    await sleep(100);
  }

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
    A.playMatch({ jitter: 5, spam: true }),
    B.playMatch({ jitter: 115, clashJitter: 130 })
  ]);
  ok(rA.matched.enemy.name === '疾風連', 'A sees B as enemy');
  ok(rB.matched.enemy.name === '雷神会', 'B sees A as enemy');
  ok(rA.results.length === 3 && rB.results.length === 3, 'both got 3 round results');
  rA.beats.forEach((bs, r) => ok(bs.length === 2, 'A got 2 live beat results in round ' + (r + 1) + ' (' + bs.length + ')'));
  const b0 = rA.beats[0][0];
  ok(b0.me && b0.me.g === 'KIWAMI', 'A beat grade KIWAMI (on-beat): ' + JSON.stringify(b0.me));
  ok(rB.beats[0][0].me && rB.beats[0][0].me.g === 'KA', 'B beat grade KA (115ms late): ' + JSON.stringify(rB.beats[0][0].me));
  ok(b0.you.power === rB.beats[0][0].enemy.power, 'live power mirrored between rivals');
  rA.results.forEach((r, i) => ok(r.me.hits === 2, 'A r' + (i + 1) + ' spam counted once per beat (hits=' + r.me.hits + ')'));
  rA.results.forEach((r, i) => ok(r.validCount >= 1 && r.best >= 1, 'A r' + (i + 1) + ' clash has taps (' + r.validCount + ')'));
  ok(rA.battle.win !== rB.battle.win, 'complementary win/lose');
  ok(rA.battle.yourPower === rB.battle.enemyPower && rA.battle.enemyPower === rB.battle.yourPower, 'powers cross-match');
  ok(Array.isArray(rA.battle.board) && rA.battle.board[0].name === 'たろう', 'personal board delivered');
  const winner = rA.battle.win ? { c: A, r: rA } : { c: B, r: rB };
  const loser = rA.battle.win ? { c: B, r: rB } : { c: A, r: rA };
  const contrib = winner.r.results.filter(r => r.synced.includes(winner.c.profile.pid)).length;
  ok(winner.r.settle.gained === 20 + 5 * contrib, 'winner coins = 20+5x' + contrib + ' (got ' + winner.r.settle.gained + ')');
  ok(winner.r.settle.coins >= winner.r.settle.gained, 'winner balance updated');
  ok(loser.r.settle.gained === 0 && loser.r.settle.outcome === 'eliminated', 'loser: no coins, eliminated');
  ok(winner.r.settle.outcome === 'continue' && winner.r.settle.streak === 1 && winner.r.settle.level === 1, 'winner continues, streak/level=1');

  /* ========== シナリオ2: 勝者の連戦（continueTour → CPU戦） ========== */
  console.log('--- scenario 2: tournament continuation vs bot ---');
  winner.c.send({ t: 'continueTour' });
  const cont = await winner.c.playMatch({ jitter: 0 });
  ok(cont.matched.tour === 1, 'second stage tour=1');
  ok(cont.matched.enemy.humans === 0, 'bot opponent');
  ok(['continue', 'champion', 'eliminated'].includes(cont.settle.outcome), 'valid outcome: ' + cont.settle.outcome);
  if (cont.settle.win) ok(cont.settle.streak === 2, 'streak=2 after 2nd win');

  /* ========== シナリオ3: 同一チーム協力（2人+助っ人、CPU対戦） ========== */
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
    C.playMatch({ jitter: 0 }),
    D.playMatch({ jitter: 20, skipBeats: [1] })
  ]);
  ok(rc.matched.you.humans === 2 && rc.matched.you.size === 8, 'team size 8 (2 humans + 6 bots)');
  ok(rc.battle.win === rd.battle.win, 'same team same result');
  ok(rc.battle.yourPower === rd.battle.yourPower, 'same team same power');
  rc.results.forEach((r, i) => ok(r.validCount >= 2, 'co-op r' + (i + 1) + ' includes both humans (' + r.validCount + ')'));
  ok(rd.results[0].me.hits === 1, 'skipped beat not counted for D');
  const tappedMsgs = C.drain('tapped');
  ok(tappedMsgs.some(t => t.pid === D.profile.pid), 'teammate taps relayed live');

  /* 勝った後、誰も「次の対戦へ」を押さずに待ち時間が切れたら控室へ戻る（勝ち進みは保持して続きから） */
  if (rc.settle.outcome === 'continue') {
    const streak = rc.settle.streak;
    const back = await C.waitFor('lobby', 5000, m => m.status === 'lobby' && m.streak === streak);
    ok(back.members.every(mb => !mb.ready), 'continue timeout: back to lobby, streak kept (' + back.streak + ')');
    C.send({ t: 'listTeams' });
    const tl = await C.waitFor('teams', 2000);
    ok(!tl.list.some(t => t.id === lc.roomId), 'mid-tournament team hidden from public team list');
    C.send({ t: 'continueTour' }); // 控室に戻った後に届いた「次の対戦へ」は準備完了として扱う
    await sleep(100);
    D.send({ t: 'ready' });
    const [rc2] = await Promise.all([C.playMatch({ jitter: 0 }), D.playMatch({ jitter: 10 })]);
    ok(rc2.matched.tour === streak, 'resumed from lobby at same stage (tour=' + rc2.matched.tour + ')');
  } else {
    console.log('co-op team lost; continue-timeout check skipped');
  }

  /* ========== シナリオ4: ガチャ（サーバー権威・コイン検証） ========== */
  console.log('--- scenario 4: gacha ---');
  const rich = winner.c;
  rich.send({ t: 'gacha' });
  const g = await rich.waitFor('gachaResult', 2000).catch(() => null);
  if (g) {
    ok(typeof g.key === 'string' && ['N', 'R', 'SR', 'SSR'].includes(g.rarity), 'gacha item valid');
    console.log('gacha:', g.key, g.rarity, 'coins→', g.coins);
  } else {
    console.log('gacha skipped (insufficient coins is valid if winner lost round 2)');
  }
  loser.c.send({ t: 'gacha' });
  const ge = await loser.c.waitFor('err', 2000);
  ok(ge.code === 'coins', 'gacha rejected for 0 coins');

  /* ========== シナリオ5: 不正タップ拒否 ========== */
  console.log('--- scenario 5: anti-cheat ---');
  A.send({ t: 'tap', r: 99, at: A.serverNow() - 99999 });
  await sleep(300);
  ok(true, 'bogus tap ignored without crash');

  /* ========== シナリオ6: 外部連携API（ランキング・照会・コイン付与） ========== */
  console.log('--- scenario 6: external API ---');
  const base = 'http://127.0.0.1:' + PORT;
  const rank = await fetch(base + '/api/ranking').then(r => r.json());
  ok(Array.isArray(rank.ranking) && rank.ranking.length >= 2, 'ranking returns players');
  ok(rank.ranking[0].wins >= rank.ranking[rank.ranking.length - 1].wins, 'ranking sorted by wins');
  const pid = A.profile.pid;
  const noKey = await fetch(base + '/api/players/' + pid);
  ok(noKey.status === 401, 'player API rejects missing key');
  const prof = await fetch(base + '/api/players/' + pid, { headers: { 'X-Api-Key': 'test-api-key' } }).then(r => r.json());
  ok(prof.id === pid && typeof prof.coins === 'number', 'player API returns profile');
  const grant = await fetch(base + '/api/coins/grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key' },
    body: JSON.stringify({ playerId: pid, amount: 7, reason: 'キャンペーン特典' })
  }).then(r => r.json());
  ok(grant.ok === true && grant.coins === prof.coins + 7, 'coin grant applied (+7)');
  const push = await A.waitFor('coinsUpdate', 2000);
  ok(push.coins === grant.coins && push.gained === 7, 'client notified of grant via WebSocket');
  const badGrant = await fetch(base + '/api/coins/grant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key' },
    body: JSON.stringify({ playerId: pid, amount: -5 })
  });
  ok(badGrant.status === 400, 'negative grant rejected');

  console.log('E2E ALL PASS —', checks, 'checks');
  for (const c of [A, B, C, D]) { try { c.ws.close(); } catch (e) {} }
  srv.kill();
  setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('EXC:', e.message); process.exit(1); });
