/* せーの！神輿バトル v2 — オンライン対戦サーバー (server-authoritative)
 * Node >= 18 / deps: express, ws
 *
 * v2 の遊び: 1試合=3番。各番は「太鼓8拍の担ぎ（毎拍タップ）」→「せー・の・！（ぶつけ）」。
 * 拍ごとの揃い（0.1秒窓に入った人数）と正確さ（拍とのズレ）で点数が決まり、押し合いがリアルタイムに動く。
 * 点数・勝敗・コイン・ガチャはすべてこのファイルで計算する（画面側は表示だけ）。 docs/DESIGN_v2.md 参照 */
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

/* ================= ゲーム定数（public/js/mk-core.js の同名定数と必ず一致させる） ================= */
const ROUNDS = 3;
const SYNC_WINDOW_MS = 100;          // 「揃った」とみなす窓の幅（v1 の WINDOW_MS と同じ）
const HIT_WINDOW_MS = 250;           // 拍の前後この範囲のタップだけ受け付ける
const GRADES = [                     // 拍とのズレ → 正確さの重み
  { key: 'KIWAMI', max: 45, w: 1.0 },  // 極
  { key: 'YOI', max: 100, w: 0.7 },    // 良
  { key: 'KA', max: 170, w: 0.4 },     // 可
  { key: 'OSHII', max: 250, w: 0.15 }  // 惜
];
const JUDGEMENTS = [
  { key: 'MIRACLE', min: 1.00 }, { key: 'PERFECT', min: 0.80 },
  { key: 'GREAT', min: 0.60 }, { key: 'NICE', min: 0.40 }, { key: 'MISS', min: 0.00 }
];
const TEMPO_BPM = [96, 108, 120];    // 番ごとにテンポが上がる
const BEAT_PTS = 10;                 // 1拍の満点
const CLASH_PTS = 30;                // ぶつけの満点
const MOMENTUM_SYNC = 0.6;           // 勢いが続く揃いの割合
const MOMENTUM_MAX = 6;
const TEAM_NAME_POOL = ['雷神会','龍虎睦','疾風連','朱雀組','黄金衆','豪傑連','不知火睦','阿吽組','花火連','千年睦'];
/* 神輿の様式（public/js/mk-core.js の VARIANTS と必ず一致させる）
 * classic=江戸型黄金 / kuro=漆黒 / shiro=白鳳 / rokkaku=京・六角 / hakkaku=八角 / shinmei=神明白木
 * futon=布団太鼓 / chousa=ちょうさ(金糸太鼓台) / dashi=山車(車輪付き二層) */
const VARIANTS = ['classic', 'kuro', 'shiro', 'rokkaku', 'hakkaku', 'shinmei', 'futon', 'chousa', 'dashi'];
/* slot は public/js/mk-core.js の C.CATALOG と一致させる（同じ slot の装備は1つだけ） */
const CATALOG = [
  { key:'happiAo', rarity:'N', slot:'happi' }, { key:'happiMidori', rarity:'N', slot:'happi' }, { key:'happiMurasaki', rarity:'N', slot:'happi' },
  { key:'happiShu', rarity:'N', slot:'happi' }, { key:'shiroHachimaki', rarity:'N', slot:'band' }, { key:'festivalFan', rarity:'N', slot:'hand' },
  { key:'goldObi', rarity:'R', slot:'obi' }, { key:'lanternStaff', rarity:'R', slot:'hand' }, { key:'sakuraAura', rarity:'R', slot:'aura' }, { key:'flameHaori', rarity:'R', slot:'haori' },
  { key:'kitsuneMask', rarity:'SR', slot:'head' }, { key:'rainbowHachimaki', rarity:'SR', slot:'band' }, { key:'ryuHaori', rarity:'SR', slot:'haori' },
  { key:'shachiHelm', rarity:'SSR', slot:'head' }, { key:'phoenixAura', rarity:'SSR', slot:'aura' }
];
const GACHA_COST = 10, WIN_COINS = 20, CONTRIB_COINS = 5;
const MIN_TEAM_FEEL = 8, MAX_TEAM = 16, TOUR_STAGES = 3;
/* CPUの腕前: sd=拍とのズレのばらつき / bias=人ごとの癖(走る・もたる)のばらつき / miss=叩き損ね率 */
const SKILL = {
  low:  { sd: 88, bias: 38, miss: 0.12 },
  mid:  { sd: 56, bias: 24, miss: 0.05 },
  high: { sd: 32, bias: 12, miss: 0.02 }
};

/* タイムライン（ms）。テストでは環境変数で短くする */
const ROUND_INTRO = +process.env.ROUND_INTRO || 1400;      // round通知 → 前打ち1拍目
const COUNT_IN = process.env.COUNT_IN !== undefined ? +process.env.COUNT_IN : 4; // 太鼓の前打ち（採点なし）
const BEATS = +process.env.BEATS || 8;                     // 担ぎの拍数
const BEAT_MS_OVERRIDE = +process.env.BEAT_MS || 0;        // 指定時は全番このテンポ
const CLOSE_GRACE = +process.env.CLOSE_GRACE || 300;       // 拍の受付終了後の通信遅延吸収
const RESULT_VIEW = +process.env.RESULT_VIEW || 2600;      // ぶつけの結果を見せる時間
const BATTLE_VIEW = +process.env.BATTLE_VIEW || 6500;      // 決着演出の時間
const BOT_MATCH_AFTER = +process.env.BOT_MATCH_AFTER || 5000; // 相手不在時CPU戦まで
const ARENA_WAIT_MAX = +process.env.ARENA_WAIT_MAX || 30000;  // 入場待ち上限
const CONTINUE_WAIT_MAX = +process.env.CONTINUE_WAIT_MAX || 20000; // 勝利後「次へ」待ち上限

/* ================= 採点ロジック（純粋関数・テストから直接呼べる） ================= */
function randomNormal(mean, stddev, rnd) {
  const R = rnd || Math.random;
  let u = 0, v = 0;
  while (u === 0) u = R();
  while (v === 0) v = R();
  return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/* 0.1秒の窓に最も多く入った人たち（v1 から移植・検証済み） */
function computeBestWindow(events, windowMs) {
  if (events.length === 0) return { best: 0, winners: [] };
  const sorted = events.slice().sort((a, b) => a.time - b.time);
  let best = 0, bestJ = 0, bestI = -1, j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (sorted[i].time - sorted[j].time > windowMs) j++;
    const count = i - j + 1;
    if (count > best) { best = count; bestJ = j; bestI = i; }
  }
  return { best, winners: sorted.slice(bestJ, bestI + 1) };
}
function gradeOf(d) {
  const a = Math.abs(d);
  for (const g of GRADES) if (a <= g.max) return g;
  return null;
}
function getJudgementKey(pct) {
  for (const j of JUDGEMENTS) if (pct >= j.min) return j.key;
  return 'MISS';
}
function momentumMult(combo) { return 1 + Math.min(combo, MOMENTUM_MAX) * 0.08; }
/* 1拍の採点。taps=[{id, d(拍とのズレms)}] */
function scoreBeat(taps, teamSize, comboBefore) {
  const { winners } = computeBestWindow(taps.map(t => ({ id: t.id, time: t.d })), SYNC_WINDOW_MS);
  let wsum = 0;
  for (const w of winners) { const g = gradeOf(w.time); if (g) wsum += g.w; }
  const size = Math.max(1, teamSize);
  const sync = winners.length / size;
  const combo = sync >= MOMENTUM_SYNC ? comboBefore + 1 : 0;
  const pts = (wsum / size) * BEAT_PTS * momentumMult(combo);
  return { pts, sync, combo, synced: winners.map(w => w.id) };
}
/* ぶつけ（せーの！）の採点。勢いが溜まっているほど重い一撃になる */
function scoreClash(taps, teamSize, combo) {
  const { best, winners } = computeBestWindow(taps.map(t => ({ id: t.id, time: t.d })), SYNC_WINDOW_MS);
  const size = Math.max(1, teamSize);
  const pct = best / size;
  let wsum = 0;
  for (const w of winners) { const g = gradeOf(w.time); if (g) wsum += g.w; }
  const acc = winners.length ? wsum / winners.length : 0;
  const pts = pct * acc * CLASH_PTS * (1 + Math.min(combo, MOMENTUM_MAX) * 0.05);
  return { pts, pct, best, judgement: getJudgementKey(pct), synced: winners.map(w => w.id) };
}
/* CPUの叩き方（1人ぶん）: 拍ごとのズレ配列＋ぶつけのズレ。null=叩き損ね */
function botMemberPlan(skill, beats) {
  const s = SKILL[skill] || SKILL.mid;
  const bias = randomNormal(0, s.bias);
  const out = [];
  for (let i = 0; i < beats; i++) {
    if (Math.random() < s.miss) { out.push(null); continue; }
    const d = Math.round(randomNormal(bias, s.sd));
    out.push(Math.abs(d) <= HIT_WINDOW_MS ? d : null);
  }
  const c = Math.round(randomNormal(bias * 0.6, s.sd * 1.25));
  out.push(Math.random() < s.miss * 1.5 || Math.abs(c) > HIT_WINDOW_MS ? null : c);
  return out;
}
function botTeamPlan(n, skill, beats) {
  const plan = [];
  for (let i = 0; i < n; i++) plan.push(botMemberPlan(skill, beats));
  return plan;
}
/* 人間の連の助っ人CPUの叩き方（その拍1回ぶん）。助っ人は人間の担ぎ手に合わせて動く:
 *  - その拍で人間が叩いた → 人間のズレの平均 μ に寄せて叩く（d = μ×0.8 ＋ ばらつき22ms、叩き損ね3%）
 *  - 人間が誰も叩かなかった → リズムを見失う（元の予定 planCol ＋ ばらつき60ms、叩き損ね35%）
 * これで「1人でも上手く叩くほど連が揃う」。humanDs=人間のズレの配列 / planCol=助っ人ごとの予定（d|null）
 * 戻り値は助っ人ごとの d|null（null=叩き損ね）。rnd を渡すと乱数を固定できる（テスト用） */
const HELPER = { follow: 0.8, sd: 22, miss: 0.03, lostSd: 60, lostMiss: 0.35 };
function helperTaps(humanDs, planCol, rnd) {
  const R = rnd || Math.random;
  const ds = (humanDs || []).filter(d => typeof d === 'number' && isFinite(d));
  const mu = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
  return (planCol || []).map(base => {
    let d;
    if (ds.length) {
      if (R() < HELPER.miss) return null;
      d = Math.round(randomNormal(mu * HELPER.follow, HELPER.sd, R));
    } else {
      if (base === null || base === undefined || R() < HELPER.lostMiss) return null;
      d = Math.round(randomNormal(base, HELPER.lostSd, R));
    }
    return Math.abs(d) <= HIT_WINDOW_MS ? d : null;
  });
}
function beatMsForRound(r) {
  if (BEAT_MS_OVERRIDE) return BEAT_MS_OVERRIDE;
  return Math.round(60000 / TEMPO_BPM[Math.min(r - 1, TEMPO_BPM.length - 1)]);
}
function rollRarity() {
  const r = Math.random() * 100;
  if (r < 1) return 'SSR'; if (r < 10) return 'SR'; if (r < 40) return 'R'; return 'N';
}
function pickItem(rarity) {
  const pool = CATALOG.filter(a => a.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}
const r1 = x => Math.round(x * 10) / 10;
/* 時間差で動く処理の例外を記録して、サーバー全体が止まらないようにする（止まると全ての試合とまだ保存していないデータが消える） */
function safe(fn) {
  return function () { try { return fn.apply(this, arguments); } catch (e) { console.error('timer error', e && e.stack || e); } };
}

/* ================= Googleログイン =================
 * GOOGLE_CLIENT_ID を環境変数に設定すると有効になる（未設定ならニックネーム参加のみ）。
 * IDトークンの検証はサーバー側で Google の tokeninfo エンドポイントに問い合わせて行う。 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID || typeof idToken !== 'string' || idToken.length > 4000) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    if (!res.ok) return null;
    const info = await res.json();
    if (info.aud !== GOOGLE_CLIENT_ID) return null;
    if (!info.sub) return null;
    return { sub: String(info.sub), name: info.name || info.given_name || '' };
  } catch (e) { return null; }
}

/* ================= 永続化 ================= */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');
const players = new Map(); // pid -> profile
function loadPlayers() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const p of raw) {
      if (!p || typeof p.id !== 'string') continue;
      /* 古い形式や欠けた項目があってもガチャ・着せ替えで止まらないように補う */
      if (!Number.isFinite(p.coins)) p.coins = 0;
      if (!Number.isFinite(p.wins)) p.wins = 0;
      if (!Array.isArray(p.owned)) p.owned = [];
      if (!Array.isArray(p.equipped)) p.equipped = [];
      players.set(p.id, p);
    }
    console.log('loaded', players.size, 'players');
  } catch (e) {
    if (e.code === 'ENOENT') return; // 初回起動
    /* 読めないファイルは上書きで消さずに控えを残す */
    console.error('players.json を読めませんでした（控えを残して空から始めます）:', e.message);
    try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken-' + Date.now()); } catch (e2) {}
  }
}
let saveTimer = null;
/* いったん別名で書いてから置き換える（書き込み途中で止まってもデータが壊れて全員分消えないように） */
function savePlayersNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...players.values()]));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('save failed', e.message); }
}
function savePlayersSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(savePlayersNow, 1500);
}
function sanitizeName(s) {
  return String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 10);
}
function profileMsg(p) {
  return { t: 'welcome', pid: p.id, token: p.token, name: p.name,
    coins: p.coins, owned: p.owned, equipped: p.equipped, wins: p.wins, google: !!p.googleSub };
}

/* ================= ルーム / マッチ ================= */
const rooms = new Map();   // roomId -> room
const sockets = new Map(); // pid -> ws
const queue = [];          // { roomId, since }
let roomSeq = 1;

function newRoom(name, variant, leaderPid) {
  const room = {
    id: 'r' + (roomSeq++), name, variant: VARIANTS.includes(variant) ? variant : 'classic',
    players: new Set([leaderPid]), ready: new Set(),
    status: 'lobby', streak: 0, level: 0, match: null
  };
  rooms.set(room.id, room);
  return room;
}
function roomOf(pid) {
  for (const r of rooms.values()) if (r.players.has(pid)) return r;
  return null;
}
function memberList(room) {
  return [...room.players].map(pid => {
    const p = players.get(pid);
    return { pid, name: p ? p.name : '?', equipped: p ? p.equipped : [] };
  });
}
function roomSnapshot(room) {
  const members = [...room.players].map(pid => {
    const p = players.get(pid);
    return { pid, name: p ? p.name : '?', ready: room.ready.has(pid) };
  });
  return { t: 'lobby', roomId: room.id, name: room.name, variant: room.variant,
    level: room.level, streak: room.streak, status: room.status,
    members, botFill: Math.max(0, MIN_TEAM_FEEL - members.length) };
}
function sendTo(pid, msg) {
  const ws = sockets.get(pid);
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); } catch (e) {} }
}
function broadcastRoom(room, msg) { for (const pid of room.players) sendTo(pid, msg); }
function teamListMsg() {
  const list = [];
  for (const r of rooms.values()) {
    /* 勝ち進み中（streak>0）で控室に戻った連は一覧に出さない（知らない人が準決勝・決勝から入れないように。招待QRからは入れる） */
    if (r.status === 'lobby' && r.streak === 0 && r.players.size < MAX_TEAM) {
      list.push({ id: r.id, name: r.name, variant: r.variant, humans: r.players.size, level: r.level });
    }
  }
  return { t: 'teams', list };
}
function leaveRoom(pid, opts) {
  const room = roomOf(pid);
  if (!room) return;
  room.players.delete(pid); room.ready.delete(pid);
  if (room.match) {
    if (room.match.arena) room.match.arena.delete(pid);
    if (room.match.continued) room.match.continued.delete(pid);
    checkArena(room.match); checkContinue(room.match);
  }
  if (room.players.size === 0) {
    const qi = queue.findIndex(q => q.roomId === room.id);
    if (qi >= 0) queue.splice(qi, 1);
    if (!room.match) rooms.delete(room.id);
    else room.abandoned = true;
  } else {
    /* silent でも残った人には知らせる（抜けた本人はもう players に居ないので送られない） */
    broadcastRoom(room, roomSnapshot(room));
    maybeQueueRoom(room);
  }
}

/* --- マッチメイキング --- */
function maybeQueueRoom(room) {
  if (room.status !== 'lobby') return;
  if (room.players.size === 0) return;
  for (const pid of room.players) if (!room.ready.has(pid)) return;
  room.status = 'queued';
  queue.push({ roomId: room.id, since: Date.now() });
  broadcastRoom(room, { t: 'searching' });
  pairQueue();
}
function requeueRoom(room) {
  room.status = 'queued';
  queue.push({ roomId: room.id, since: Date.now() });
  broadcastRoom(room, { t: 'searching' });
  pairQueue();
}
function pairQueue() {
  while (queue.length >= 2) {
    const qa = queue.shift(), qb = queue.shift();
    const a = rooms.get(qa.roomId), b = rooms.get(qb.roomId);
    /* 相手が居なくなっていたら、残った側は待ち始めた時刻のまま列の先頭に戻す（CPU戦までの待ちが延びないように） */
    if (!a || a.status !== 'queued' || a.players.size === 0) { if (b) queue.unshift(qb); continue; }
    if (!b || b.status !== 'queued' || b.players.size === 0) { queue.unshift(qa); continue; }
    startMatch(a, b, null);
  }
}
/* CPU連の腕前: 勝ち進むほど強くなる（準々決勝=低〜中 / 準決勝=中 / 決勝=中〜高） */
function botSkillForStage(streak) {
  const pools = [['low', 'mid', 'mid'], ['mid', 'mid', 'high'], ['mid', 'high', 'high']];
  const pool = pools[Math.min(streak, pools.length - 1)];
  return pool[Math.floor(Math.random() * pool.length)];
}
setInterval(safe(() => {
  // CPU戦フォールバック
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    const room = rooms.get(q.roomId);
    if (!room || room.status !== 'queued' || room.players.size === 0) { queue.splice(i, 1); continue; }
    if (Date.now() - q.since >= BOT_MATCH_AFTER) {
      queue.splice(i, 1);
      const names = TEAM_NAME_POOL.filter(n => n !== room.name);
      const bot = {
        name: names[Math.floor(Math.random() * names.length)] || '豪傑連',
        size: 8 + Math.floor(Math.random() * 5),
        skill: botSkillForStage(room.streak),
        variant: VARIANTS[Math.floor(Math.random() * VARIANTS.length)],
        level: Math.min(4, room.streak + Math.floor(Math.random() * 2))
      };
      startMatch(room, null, bot);
    }
  }
  pairQueue();
}), 1000);

/* --- マッチ進行 --- */
const matches = new Set();
function fillerBots(room) { return Math.max(0, MIN_TEAM_FEEL - room.players.size); }
function sideInfo(room) {
  const humans = room.players.size;
  return { name: room.name, size: Math.max(humans, MIN_TEAM_FEEL), humans,
    variant: room.variant, level: room.level, streak: room.streak, members: memberList(room) };
}
/* 1試合の中で「側（side）」を統一的に扱う: 人間の連 or CPU連 */
function makeSide(room, bot) {
  if (room) return { room, id: room.id, bot: null, power: 0, clashSum: 0, combo: 0, rounds: [] };
  return { room: null, id: 'bot', bot, power: 0, clashSum: 0, combo: 0, rounds: [] };
}
function sideSize(side) { return side.room ? side.room.players.size + fillerBots(side.room) : side.bot.size; }
function sideInfoOf(side) {
  if (side.room) return sideInfo(side.room);
  const bot = side.bot;
  return { name: bot.name, size: bot.size, humans: 0, variant: bot.variant, level: bot.level, members: [] };
}
function startMatch(roomA, roomB, bot) {
  const m = {
    sides: [makeSide(roomA), roomB ? makeSide(roomB) : makeSide(null, bot)],
    rooms: roomB ? [roomA, roomB] : [roomA],
    bot, round: 0, plan: null, arena: new Set(), continued: new Set(),
    contrib: new Map(), personal: new Map(), timers: [], done: false, phase: 'arena'
  };
  matches.add(m);
  for (const r of m.rooms) { r.status = 'playing'; r.match = m; }
  const infoA = sideInfoOf(m.sides[0]);
  const infoB = sideInfoOf(m.sides[1]);
  broadcastRoom(roomA, { t: 'matched', you: infoA, enemy: infoB, tour: roomA.streak });
  if (roomB) broadcastRoom(roomB, { t: 'matched', you: infoB, enemy: infoA, tour: roomB.streak });
  m.timers.push(setTimeout(safe(() => { if (m.phase === 'arena') beginRounds(m); }), ARENA_WAIT_MAX));
}
function checkArena(m) {
  if (!m || m.isContinueGate || m.phase !== 'arena') return;
  for (const r of m.rooms) for (const pid of r.players) if (!m.arena.has(pid)) return;
  beginRounds(m);
}
function beginRounds(m) {
  if (m.done || m.phase !== 'arena') return;
  m.phase = 'rounds';
  scheduleRound(m, 1);
}
function otherSide(m, side) { return m.sides[0] === side ? m.sides[1] : m.sides[0]; }
function scheduleRound(m, r) {
  if (m.done) return;
  const beatMs = beatMsForRound(r);
  const now = Date.now();
  const startAt = now + ROUND_INTRO + COUNT_IN * beatMs;
  const clashIdx = BEATS + 2;
  const plan = {
    r, beatMs, beats: BEATS, countIn: COUNT_IN, startAt,
    clashAt: startAt + clashIdx * beatMs, clashIdx,
    taps: new Map(),     // sideId -> Map(id -> Array(BEATS+1) of d|undefined)
    botPlans: new Map(), // sideId -> [[d...]]  （人間の連の助っ人CPU / CPU連の全員）
    beatDone: 0, clashDone: false,
    size: new Map()      // sideId -> 番の開始時の人数（途中で抜けても採点の分母は変えない）
  };
  m.round = r; m.plan = plan;
  m.lastRound = new Map(); // sideId -> 送った round メッセージ（試合中の再接続で送り直す）
  for (const side of m.sides) {
    plan.taps.set(side.id, new Map());
    plan.size.set(side.id, sideSize(side));
    const n = side.room ? fillerBots(side.room) : side.bot.size;
    const skill = side.room ? 'mid' : side.bot.skill;
    plan.botPlans.set(side.id, botTeamPlan(n, skill, BEATS));
  }
  for (const side of m.sides) {
    if (!side.room) continue;
    const enemy = otherSide(m, side);
    const roundMsg = {
      t: 'round', r, beatMs, beats: BEATS, countIn: COUNT_IN, startAt,
      clashAt: plan.clashAt, cueAt: plan.clashAt, hitWindow: HIT_WINDOW_MS,
      teamSize: plan.size.get(side.id), enemySize: plan.size.get(enemy.id),
      botTaps: plan.botPlans.get(side.id),
      /* 相手側の助っ人/CPUの叩き方（相手の担ぎ手を動かす見た目用。点数はサーバーで計算） */
      enemyTaps: plan.botPlans.get(enemy.id)
    };
    m.lastRound.set(side.id, roundMsg);
    broadcastRoom(side.room, roundMsg);
  }
  for (let i = 0; i < BEATS; i++) {
    const closeAt = plan.startAt + i * beatMs + HIT_WINDOW_MS + CLOSE_GRACE;
    m.timers.push(setTimeout(safe(() => closeBeat(m, r, i)), closeAt - now));
  }
  m.timers.push(setTimeout(safe(() => closeClash(m, r)), plan.clashAt + HIT_WINDOW_MS + CLOSE_GRACE - now));
}
/* その拍（i=BEATS はぶつけ）の全員のズレを集める */
function collectTaps(m, side, i) {
  const plan = m.plan, out = [];
  for (const [id, arr] of plan.taps.get(side.id)) if (arr[i] !== undefined) out.push({ id, d: arr[i] });
  const planCol = plan.botPlans.get(side.id).map(arr => arr[i]);
  /* 人間の連の助っ人は人間に合わせて叩く（採点はここで決まる。round の botTaps は見た目用の予定）。
   * CPU連はこれまでどおり腕前ごとの予定で叩く */
  const botDs = side.room ? helperTaps(out.map(t => t.d), planCol) : planCol;
  botDs.forEach((d, k) => { if (d !== null && d !== undefined) out.push({ id: 'b' + k, d }); });
  return out;
}
function addPersonal(m, pid, pts) { m.personal.set(pid, (m.personal.get(pid) || 0) + pts); }
function closeBeat(m, r, i) {
  if (m.done || m.round !== r || !m.plan) return;
  const plan = m.plan;
  const res = new Map();
  for (const side of m.sides) {
    const taps = collectTaps(m, side, i);
    const s = scoreBeat(taps, plan.size.get(side.id), side.combo);
    side.combo = s.combo;
    side.power += s.pts;
    for (const t of taps) {
      if (t.id[0] === 'b') continue;
      const g = gradeOf(t.d);
      if (g) addPersonal(m, t.id, g.w * (s.synced.includes(t.id) ? 1 : 0.5));
    }
    res.set(side.id, { s, taps });
  }
  plan.beatDone = i + 1;
  for (const side of m.sides) {
    if (!side.room) continue;
    const mine = res.get(side.id), enemy = otherSide(m, side), theirs = res.get(enemy.id);
    const base = { t: 'beat', r, i,
      you: { pts: r1(mine.s.pts), sync: r1(mine.s.sync), combo: mine.s.combo, power: r1(side.power) },
      enemy: { pts: r1(theirs.s.pts), sync: r1(theirs.s.sync), combo: theirs.s.combo, power: r1(enemy.power) } };
    for (const pid of side.room.players) {
      const arr = plan.taps.get(side.id).get(pid);
      const d = arr ? arr[i] : undefined;
      const g = d !== undefined ? gradeOf(d) : null;
      sendTo(pid, Object.assign({}, base, {
        me: d !== undefined ? { d: Math.round(d), g: g ? g.key : 'OSHII', synced: mine.s.synced.includes(pid) } : null
      }));
    }
  }
}
function closeClash(m, r) {
  if (m.done || m.round !== r || !m.plan || m.plan.clashDone) return;
  const plan = m.plan;
  plan.clashDone = true;
  const res = new Map();
  for (const side of m.sides) {
    const taps = collectTaps(m, side, BEATS);
    const c = scoreClash(taps, plan.size.get(side.id), side.combo);
    side.power += c.pts; side.clashSum += c.pts;
    side.rounds.push({ clash: r1(c.pts), judgement: c.judgement });
    for (const id of c.synced) {
      if (id[0] === 'b') continue;
      m.contrib.set(id, (m.contrib.get(id) || 0) + 1);
      addPersonal(m, id, 3);
    }
    res.set(side.id, { c, taps });
  }
  for (const side of m.sides) {
    if (!side.room) continue;
    const mine = res.get(side.id), enemy = otherSide(m, side), theirs = res.get(enemy.id);
    for (const pid of side.room.players) {
      const arr = plan.taps.get(side.id).get(pid) || [];
      let hits = 0, goods = 0;
      for (let i = 0; i < BEATS; i++) {
        if (arr[i] === undefined) continue;
        hits++;
        const g = gradeOf(arr[i]); if (g && g.w >= 0.7) goods++;
      }
      sendTo(pid, { t: 'roundResult', r,
        best: mine.c.best, validCount: mine.taps.length, teamSize: plan.size.get(side.id),
        pct: Math.round(mine.c.pct * 100) / 100, judgement: mine.c.judgement, synced: mine.c.synced,
        clashPts: r1(mine.c.pts), power: r1(side.power), combo: side.combo,
        enemyPower: r1(enemy.power), enemyJudgement: theirs.c.judgement,
        enemyPct: Math.round(theirs.c.pct * 100) / 100, enemyClashPts: r1(theirs.c.pts),
        me: { hits, goods, beats: BEATS, clashD: arr[BEATS] !== undefined ? Math.round(arr[BEATS]) : null,
          clashSynced: mine.c.synced.includes(pid) } });
    }
  }
  if (r < ROUNDS) m.timers.push(setTimeout(safe(() => scheduleRound(m, r + 1)), RESULT_VIEW));
  else m.timers.push(setTimeout(safe(() => resolveBattle(m)), RESULT_VIEW));
}
function boardFor(m, side) {
  if (!side.room) return [];
  return [...side.room.players].map(pid => {
    const p = players.get(pid);
    return { pid, name: p ? p.name : '?', score: r1((m.personal.get(pid) || 0) * 10) };
  }).sort((a, b) => b.score - a.score);
}
function resolveBattle(m) {
  if (m.done) return;
  m.phase = 'battle';
  const [A, B] = m.sides;
  /* 勝敗: 合計点 → 同点ならぶつけの合計 → それも同じなら先に並んだ側 */
  const aWins = A.power > B.power || (A.power === B.power && A.clashSum >= B.clashSum);
  m.aWins = aWins;
  for (const side of m.sides) {
    if (!side.room) continue;
    const enemy = otherSide(m, side);
    const win = side === A ? aWins : !aWins;
    const board = boardFor(m, side);
    broadcastRoom(side.room, { t: 'battle', win, yourPower: r1(side.power), enemyPower: r1(enemy.power),
      rounds: side.rounds, enemyRounds: enemy.rounds, board, mvp: board.length ? board[0].name : null });
  }
  m.timers.push(setTimeout(safe(() => settle(m)), BATTLE_VIEW));
}
function settle(m) {
  if (m.done) return;
  m.phase = 'settle';
  const aWins = m.aWins;
  const sides = m.sides.map((s, i) => ({ room: s.room, win: i === 0 ? aWins : !aWins, power: r1(s.power) }));
  for (const { room, win } of sides) {
    if (!room) continue;
    if (win) { room.streak += 1; room.level = Math.min(4, room.level + 1); }
    const outcome = !win ? 'eliminated' : (room.streak >= TOUR_STAGES ? 'champion' : 'continue');
    for (const pid of room.players) {
      const p = players.get(pid);
      let gained = 0;
      if (win && p) {
        gained = WIN_COINS + CONTRIB_COINS * (m.contrib.get(pid) || 0);
        p.coins += gained; p.wins += 1;
      }
      sendTo(pid, { t: 'settle', win, gained, coins: p ? p.coins : 0,
        level: room.level, streak: room.streak, outcome, contrib: m.contrib.get(pid) || 0 });
    }
    if (outcome === 'continue') {
      room.pendingContinue = true;
    } else {
      room.streak = 0;
      backToLobby(room);
    }
  }
  savePlayersSoon();
  postMatchWebhook({
    event: 'matchSettled',
    at: new Date().toISOString(),
    teams: sides.filter(s => s.room).map(({ room, win, power }) => ({
      name: room.name, win, power, streak: room.streak,
      players: [...room.players].map(pid => {
        const p = players.get(pid);
        return p ? { id: p.id, name: p.name, coins: p.coins, wins: p.wins } : null;
      }).filter(Boolean)
    })),
    bot: m.bot ? { name: m.bot.name } : null
  });
  const contRooms = m.rooms.filter(r => r.pendingContinue);
  finishMatch(m);
  for (const room of contRooms) {
    room.match = { arena: new Set(), continued: new Set(), isContinueGate: true, room,
      timer: setTimeout(safe(() => continueTimeout(room)), CONTINUE_WAIT_MAX) };
  }
}
/* 勝利後の「次の対戦へ」待ちが時間切れになったとき:
 * 1人でも押していれば続行、誰も押していなければ控室へ戻す（勝ち進みは保持。控室で準備完了すれば続きから） */
function continueTimeout(room) {
  if (!room.pendingContinue) return;
  const gate = room.match && room.match.isContinueGate ? room.match : null;
  if (gate && gate.continued.size > 0) return void forceContinue(room);
  backToLobby(room);
}
function forceContinue(room) {
  if (!room.pendingContinue) return;
  room.pendingContinue = false;
  if (room.match && room.match.isContinueGate) { clearTimeout(room.match.timer); room.match = null; }
  if (room.players.size === 0) { rooms.delete(room.id); return; }
  room.ready = new Set(room.players);
  requeueRoom(room);
}
function checkContinue(mLike) {
  if (!mLike || !mLike.isContinueGate) return;
  const room = mLike.room;
  for (const pid of room.players) if (!mLike.continued.has(pid)) return;
  forceContinue(room);
}
function backToLobby(room) {
  room.status = 'lobby'; room.ready.clear(); room.match = null; room.pendingContinue = false;
  if (room.abandoned || room.players.size === 0) { rooms.delete(room.id); return; }
  broadcastRoom(room, roomSnapshot(room)); // 控室に戻ったことを知らせる（準備ボタンを押せる状態に戻す）
}
function finishMatch(m) {
  m.done = true;
  m.timers.forEach(clearTimeout);
  matches.delete(m);
  for (const room of m.rooms) {
    room.match = null;
    if (!room.pendingContinue && room.status === 'playing') backToLobby(room);
  }
}
/* タップの受付: 申告時刻から、どの拍（またはぶつけ）へのタップかを決める */
function acceptTap(m, room, pid, at, ws) {
  const plan = m.plan;
  if (!plan || plan.clashDone) return null;
  const now = Date.now();
  /* クライアント申告時刻の妥当性: 到着より1.2秒以上前・0.25秒以上先の申告は捨てる */
  if (now - at > 1200 || at - now > 250) return null;
  /* 往復時間が測れている接続は、押した推定時刻（到着 − 片道）から ±(120 + 片道) に絞る。
   * 上の範囲チェックは外枠として残す（返信をわざと遅らせて往復時間を水増ししても緩まない） */
  if (ws && ws.rtt !== undefined) {
    const est = now - ws.rtt / 2;
    if (Math.abs(at - est) > 120 + ws.rtt / 2) return null;
  }
  const rel = at - plan.startAt;
  const idx = Math.round(rel / plan.beatMs);
  let slot;
  if (idx >= 0 && idx < plan.beats) slot = idx;
  else if (idx === plan.clashIdx) slot = plan.beats; // ぶつけ
  else return null;                                  // 前打ち・「せー」「の」は採点しない
  if (slot < plan.beats && slot < plan.beatDone) return null; // もう締め切った拍
  const d = rel - idx * plan.beatMs;
  if (Math.abs(d) > HIT_WINDOW_MS) return null;
  const sideTaps = plan.taps.get(room.id);
  let arr = sideTaps.get(pid);
  if (!arr) { arr = new Array(plan.beats + 1); sideTaps.set(pid, arr); }
  if (arr[slot] !== undefined) return null;         // 1拍1タップ（連打は最初の1回だけ）
  arr[slot] = Math.round(d);
  return { slot, d: arr[slot] };
}

/* ================= HTTP / WS ================= */
const app = express();
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.get('/healthz', (req, res) => res.json({ ok: true, players: players.size, rooms: rooms.size, matches: matches.size }));
app.get('/auth-config', (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID || null }));

/* ================= 外部連携API =================
 * 課金・ランキング・報酬システムなど外部サービスとの接続用。
 * 書き込み系・個人データ系は環境変数 API_KEY を設定した上で、
 * リクエストヘッダー X-Api-Key に同じ値を付けたものだけ受け付ける。 */
const API_KEY = process.env.API_KEY || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
app.use(express.json({ limit: '16kb' }));
function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(503).json({ error: 'API_KEY not configured' });
  if (req.get('X-Api-Key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}
/* ランキング（公開・読み取り専用）: 勝利数→コインの順で上位20人 */
app.get('/api/ranking', (req, res) => {
  const list = [...players.values()]
    .sort((a, b) => (b.wins - a.wins) || (b.coins - a.coins))
    .slice(0, 20)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, wins: p.wins, coins: p.coins }));
  res.json({ ranking: list });
});
/* プレイヤー情報（要APIキー）: 外部システムがIDで残高・戦績を照会 */
app.get('/api/players/:id', requireApiKey, (req, res) => {
  const p = players.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'player not found' });
  res.json({ id: p.id, name: p.name, coins: p.coins, wins: p.wins,
    owned: p.owned, equipped: p.equipped, google: !!p.googleSub });
});
/* コイン付与（要APIキー）: 外部の課金・特典システムからの付与入口。
 * ゲーム内ロジックからは呼ばれない（コインは勝利時のみ、のルールはゲーム内では不変） */
app.post('/api/coins/grant', requireApiKey, (req, res) => {
  const { playerId, amount, reason } = req.body || {};
  const p = players.get(String(playerId || ''));
  const n = Number(amount);
  if (!p) return res.status(404).json({ error: 'player not found' });
  if (!Number.isInteger(n) || n < 1 || n > 100000) return res.status(400).json({ error: 'amount must be integer 1..100000' });
  p.coins += n;
  savePlayersSoon();
  sendTo(p.id, { t: 'coinsUpdate', coins: p.coins, gained: n, reason: String(reason || '').slice(0, 60) });
  res.json({ ok: true, id: p.id, coins: p.coins });
});
/* 試合結果Webhook: WEBHOOK_URL を設定すると、試合確定のたびに外部へPOSTする（報酬集計など向け） */
function postMatchWebhook(payload) {
  if (!WEBHOOK_URL) return;
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
    body: JSON.stringify(payload)
  }).catch(e => console.error('webhook failed:', e.message));
}
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  /* Render などの中継サーバー越しでは接続元が全員同じに見えるため、中継が末尾に付けた本当の接続元を使う
   * （先頭側は利用者が書き換えられるので信用しない） */
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  const fwd = typeof xff === 'string' ? xff.split(',').map(s => s.trim()).filter(Boolean).pop() : '';
  ws.ip = fwd || (req && req.socket && req.socket.remoteAddress) || 'unknown';
  ws.rtts = []; ws.regCount = 0;
  /* 往復時間の計測: 5秒ごとに sping を送り、返ってきた spong で測る（返さない相手でも動く） */
  const sping = () => { if (ws.readyState === 1) { try { ws.send(JSON.stringify({ t: 'sping', s: Date.now() })); } catch (e) {} } };
  sping();
  const spingTimer = setInterval(sping, 5000);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error('handle error', msg.t, e.message); }
  });
  ws.on('close', () => {
    clearInterval(spingTimer);
    if (ws.pid) {
      if (sockets.get(ws.pid) === ws) sockets.delete(ws.pid);
      // 猶予をもって退室（リロード対応: 8秒以内に再接続すれば席は残る）
      const pid = ws.pid;
      setTimeout(safe(() => { if (!sockets.has(pid)) leaveRoom(pid); }), 8000);
    }
  });
});
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);

function finishRegister(ws, p) {
  const old = sockets.get(p.id);
  if (old && old !== ws) { try { old.close(); } catch (e) {} }
  ws.pid = p.id; sockets.set(p.id, ws);
  savePlayersSoon();
  ws.send(JSON.stringify(profileMsg(p)));
  const room = roomOf(p.id);
  if (room) ws.send(JSON.stringify(roomSnapshot(room)));
  /* 試合中に戻ってきた人には、対戦相手と進行中の番を送り直す（入場は通常どおり 'arena' で行う） */
  const m = room && room.match;
  if (m && !m.isContinueGate && (m.phase === 'arena' || m.phase === 'rounds')) {
    const side = m.sides.find(s => s.room === room);
    if (!side) return;
    ws.send(JSON.stringify({ t: 'matched', you: sideInfoOf(side), enemy: sideInfoOf(otherSide(m, side)), tour: room.streak }));
    const rmsg = m.phase === 'rounds' && m.plan && !m.plan.clashDone && m.lastRound && m.lastRound.get(side.id);
    if (rmsg) ws.send(JSON.stringify(rmsg));
  }
}
/* 新しいプレイヤーの作成は同じ接続元あたり1時間に20人まで */
/* 同じ接続元からの新規登録の上限（1時間あたり）。店舗や会場の同じWi-Fiから大勢が一斉に登録するため多めにしてある */
const NEW_PLAYER_LIMIT = +process.env.REG_IP_HOURLY || 200, NEW_PLAYER_WINDOW_MS = 3600000;
const newPlayersByIp = new Map(); // ip -> [作成時刻...]
function allowNewPlayer(ip) {
  const now = Date.now();
  const list = (newPlayersByIp.get(ip) || []).filter(t => now - t < NEW_PLAYER_WINDOW_MS);
  if (list.length >= NEW_PLAYER_LIMIT) { newPlayersByIp.set(ip, list); return false; }
  list.push(now);
  newPlayersByIp.set(ip, list);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of newPlayersByIp) {
    const keep = list.filter(t => now - t < NEW_PLAYER_WINDOW_MS);
    if (keep.length) newPlayersByIp.set(ip, keep); else newPlayersByIp.delete(ip);
  }
}, 600000);
const RATE_ERR = { t: 'err', code: 'rate', msg: 'しばらくしてからもう一度お試しください' };

function handle(ws, msg) {
  switch (msg.t) {
    case 'ping': return void ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() }));

    case 'spong': {
      const now = Date.now();
      if (typeof msg.s !== 'number' || !Number.isFinite(msg.s) || msg.s > now) return; // 数値でない・未来は無視
      ws.rtts.push(now - msg.s);
      if (ws.rtts.length > 5) ws.rtts.shift();
      ws.rtt = Math.min(...ws.rtts); // 直近5件の最小値
      return;
    }

    case 'register': {
      if (++ws.regCount > 5) return void ws.send(JSON.stringify(RATE_ERR)); // 1接続あたり5回まで
      // Googleログイン（gtoken付き）は検証が非同期になるため分岐
      if (msg.gtoken) {
        verifyGoogleToken(msg.gtoken).then(g => {
          if (ws.readyState !== 1) return;
          if (!g) return void ws.send(JSON.stringify({ t: 'err', code: 'google', msg: 'Googleログインを確認できませんでした' }));
          let p = null;
          for (const q of players.values()) if (q.googleSub === g.sub) { p = q; break; }
          if (!p && msg.token) {
            // 既存のニックネームアカウントにGoogleを紐付け（戦績・コインを引き継ぐ）
            for (const q of players.values()) if (q.token === msg.token && !q.googleSub) { p = q; p.googleSub = g.sub; break; }
          }
          if (!p) {
            if (!allowNewPlayer(ws.ip)) return void ws.send(JSON.stringify(RATE_ERR));
            const name = sanitizeName(msg.name) || sanitizeName(g.name) || 'プレイヤー';
            p = { id: 'p' + crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
              name, coins: 0, owned: [], equipped: [], wins: 0, googleSub: g.sub };
            players.set(p.id, p);
          } else if (msg.name && sanitizeName(msg.name)) {
            p.name = sanitizeName(msg.name);
          }
          finishRegister(ws, p);
        }).catch(e => console.error('google register error', e.message)); // 例外でサーバーごと止まらないように
        return;
      }
      let p = null;
      if (msg.token) { for (const q of players.values()) if (q.token === msg.token) { p = q; break; } }
      if (!p) {
        const name = sanitizeName(msg.name);
        if (!name) return void ws.send(JSON.stringify({ t: 'err', code: 'name', msg: 'ニックネームを入力してください' }));
        if (!allowNewPlayer(ws.ip)) return void ws.send(JSON.stringify(RATE_ERR));
        p = { id: 'p' + crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
          name, coins: 0, owned: [], equipped: [], wins: 0 };
        players.set(p.id, p);
      } else if (msg.name && sanitizeName(msg.name)) {
        p.name = sanitizeName(msg.name);
      }
      finishRegister(ws, p);
      return;
    }
  }

  const pid = ws.pid;
  if (!pid || !players.get(pid)) return void ws.send(JSON.stringify({ t: 'err', code: 'auth', msg: '先に参加登録してください' }));
  const p = players.get(pid);

  switch (msg.t) {
    case 'listTeams': return void ws.send(JSON.stringify(teamListMsg()));

    case 'createTeam': {
      if (roomOf(pid)) leaveRoom(pid, { silent: true });
      const name = sanitizeName(msg.name) || (p.name + 'の連');
      const room = newRoom(name, msg.variant, pid);
      broadcastRoom(room, roomSnapshot(room));
      return;
    }
    case 'joinTeam': {
      const room = rooms.get(msg.id);
      /* すでにその連に居る（自分の連の招待QRを読んだ等）: 抜けて入り直すと1人の連が消えてしまうので、今の様子を返すだけ */
      if (room && room.players.has(pid)) return void ws.send(JSON.stringify(roomSnapshot(room)));
      if (!room || room.status !== 'lobby' || room.players.size >= MAX_TEAM) {
        return void ws.send(JSON.stringify({ t: 'err', code: 'join', msg: 'この連には今は参加できません' }));
      }
      if (roomOf(pid)) leaveRoom(pid, { silent: true });
      room.players.add(pid);
      broadcastRoom(room, roomSnapshot(room));
      return;
    }
    case 'leaveTeam': return void leaveRoom(pid);

    case 'ready': {
      const room = roomOf(pid);
      if (!room || room.status !== 'lobby') return;
      room.ready.add(pid);
      broadcastRoom(room, roomSnapshot(room));
      maybeQueueRoom(room);
      return;
    }
    case 'arena': {
      const room = roomOf(pid);
      if (room && room.match && !room.match.isContinueGate) {
        room.match.arena.add(pid);
        checkArena(room.match);
      }
      return;
    }
    case 'tap': {
      const room = roomOf(pid);
      const m = room && room.match;
      if (!m || m.isContinueGate || m.phase !== 'rounds' || msg.r !== m.round) return;
      const at = Number(msg.at);
      if (!isFinite(at)) return;
      const acc = acceptTap(m, room, pid, at, ws);
      if (!acc) return;
      /* 仲間には「誰が・どの拍で」叩いたか、相手には「相手の何番目の担ぎ手が」叩いたかを伝える（見た目用） */
      broadcastRoom(room, { t: 'tapped', r: m.round, pid, k: acc.slot, d: acc.d });
      const enemy = m.rooms.find(x => x !== room);
      if (enemy) {
        const ei = [...room.players].indexOf(pid);
        broadcastRoom(enemy, { t: 'tapped', r: m.round, side: 'enemy', ei, k: acc.slot, d: acc.d });
      }
      return;
    }
    case 'continueTour': {
      const room = roomOf(pid);
      if (room && room.pendingContinue && room.match && room.match.isContinueGate) {
        room.match.continued.add(pid);
        checkContinue(room.match);
      } else if (room && room.status === 'lobby') {
        /* 待ち時間切れで控室へ戻った後に「次の対戦へ」が届いたら、準備完了として扱う */
        room.ready.add(pid);
        broadcastRoom(room, roomSnapshot(room));
        maybeQueueRoom(room);
      }
      return;
    }
    case 'gacha': {
      if (p.coins < GACHA_COST) return void ws.send(JSON.stringify({ t: 'err', code: 'coins', msg: 'コインが足りません' }));
      p.coins -= GACHA_COST;
      const rarity = rollRarity();
      const item = pickItem(rarity);
      p.owned.push(item.key);
      savePlayersSoon();
      return void ws.send(JSON.stringify({ t: 'gachaResult', key: item.key, rarity, coins: p.coins }));
    }
    case 'equip': {
      const item = CATALOG.find(a => a.key === msg.key);
      if (item && p.owned.includes(item.key) && !p.equipped.includes(item.key)) {
        /* 同じ場所（slot）の装備は外してから付ける */
        p.equipped = p.equipped.filter(k => { const o = CATALOG.find(a => a.key === k); return !o || o.slot !== item.slot; });
        p.equipped.push(item.key);
        savePlayersSoon();
      }
      return void ws.send(JSON.stringify({ t: 'equipped', equipped: p.equipped }));
    }
  }
}

if (require.main === module) {
  loadPlayers();
  const PORT = process.env.PORT || 3000;
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('ポート ' + PORT + ' は使用中です。前に起動したサーバーを止めるか、PORT=3001 のように別の番号を指定してください');
    else console.error('server error', e.message);
    process.exit(1);
  });
  wss.on('error', () => {}); // ws が同じエラーを転送してくる。上で案内して終わるのでここでは何もしない
  server.listen(PORT, () => console.log('せーの！神輿バトル server on :' + PORT + '  →  http://localhost:' + PORT + '/'));
  /* 止めるとき（Ctrl+C・再デプロイ）は、まだ書いていないプレイヤーデータを書いてから終わる */
  const shutdown = () => { if (saveTimer) savePlayersNow(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
module.exports = { server, computeBestWindow, scoreBeat, scoreClash, gradeOf, botTeamPlan, getJudgementKey,
  helperTaps, botSkillForStage, SKILL, HELPER }; // テスト用
