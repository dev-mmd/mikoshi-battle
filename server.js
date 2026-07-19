/* せーの！神輿バトル — オンライン対戦サーバー (server-authoritative)
 * Node >= 18 / deps: express, ws
 * 判定ロジック（100msスライディング窓・Bot正規分布・経済）はデモ検証済みコードを移植 */
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

/* ================= ゲーム定数（検証済みデモから移植） ================= */
const ROUNDS = 3, WINDOW_MS = 100;
const TAP_DURATION_MS = +process.env.TAP_MS || 5000;
const SKILL_STDDEV = { low: 130, mid: 60, high: 25 };
const JUDGEMENTS = [
  { key: 'MIRACLE', min: 1.00 }, { key: 'PERFECT', min: 0.80 },
  { key: 'GREAT', min: 0.60 }, { key: 'NICE', min: 0.40 }, { key: 'MISS', min: 0.00 }
];
const TEAM_NAME_POOL = ['雷神会','龍虎睦','疾風連','朱雀組','黄金衆','豪傑連','不知火睦','阿吽組','花火連','千年睦'];
const VARIANTS = ['classic', 'kuro', 'shiro'];
const CATALOG = [
  { key:'happiAo', rarity:'N' }, { key:'happiMidori', rarity:'N' }, { key:'happiMurasaki', rarity:'N' },
  { key:'happiShu', rarity:'N' }, { key:'shiroHachimaki', rarity:'N' }, { key:'festivalFan', rarity:'N' },
  { key:'goldObi', rarity:'R' }, { key:'lanternStaff', rarity:'R' }, { key:'sakuraAura', rarity:'R' }, { key:'flameHaori', rarity:'R' },
  { key:'kitsuneMask', rarity:'SR' }, { key:'rainbowHachimaki', rarity:'SR' }, { key:'ryuHaori', rarity:'SR' },
  { key:'shachiHelm', rarity:'SSR' }, { key:'phoenixAura', rarity:'SSR' }
];
const GACHA_COST = 10, WIN_COINS = 20, CONTRIB_COINS = 5;
const MIN_TEAM_FEEL = 8, MAX_TEAM = 16, TOUR_STAGES = 3;

/* タイムライン（ms） */
const CUE_LEAD = +process.env.CUE_LEAD || 3600;            // roundメッセージ→「せーの！」まで
const CLOSE_GRACE = +process.env.CLOSE_GRACE || 450;       // タップ窓終了後の受付猶予（遅延吸収）
const RESULT_VIEW = +process.env.RESULT_VIEW || 5600;      // ラウンド結果の表示時間
const BATTLE_VIEW = +process.env.BATTLE_VIEW || 7600;      // 3D対戦演出の時間
const BOT_MATCH_AFTER = +process.env.BOT_MATCH_AFTER || 5000; // 相手不在時Bot戦まで
const ARENA_WAIT_MAX = +process.env.ARENA_WAIT_MAX || 30000;  // 入場待ち上限
const CONTINUE_WAIT_MAX = +process.env.CONTINUE_WAIT_MAX || 20000; // 勝利後「次へ」待ち上限

/* ================= 検証済みロジック（移植） ================= */
function randomNormal(mean, stddev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clampReaction(rt) { return Math.max(60, rt); }
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
function getJudgementKey(pct) {
  for (const j of JUDGEMENTS) if (pct >= j.min) return j.key;
  return 'MISS';
}
function simulateTeam(teamSize, skill) {
  let total = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const events = [];
    for (let i = 0; i < teamSize; i++) {
      const rt = clampReaction(randomNormal(250, SKILL_STDDEV[skill]));
      if (rt <= TAP_DURATION_MS) events.push({ id: 'e' + i, time: rt });
    }
    total += computeBestWindow(events, WINDOW_MS).best;
  }
  return total;
}
function rollRarity() {
  const r = Math.random() * 100;
  if (r < 1) return 'SSR'; if (r < 10) return 'SR'; if (r < 40) return 'R'; return 'N';
}
function pickItem(rarity) {
  const pool = CATALOG.filter(a => a.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}
function botTapOffsets(count, skill) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const rt = clampReaction(randomNormal(250, SKILL_STDDEV[skill]));
    if (rt <= TAP_DURATION_MS) out.push(Math.round(rt));
    else out.push(-1); // このBotはタップし損ねた
  }
  return out;
}

/* ================= 永続化 ================= */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');
const players = new Map(); // pid -> profile
function loadPlayers() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const p of raw) players.set(p.id, p);
    console.log('loaded', players.size, 'players');
  } catch (e) { /* first boot */ }
}
let saveTimer = null;
function savePlayersSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify([...players.values()]));
    } catch (e) { console.error('save failed', e.message); }
  }, 1500);
}
function sanitizeName(s) {
  return String(s || '').replace(/[<>&"']/g, '').trim().slice(0, 10);
}
function profileMsg(p) {
  return { t: 'welcome', pid: p.id, token: p.token, name: p.name,
    coins: p.coins, owned: p.owned, equipped: p.equipped, wins: p.wins };
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
    if (r.status === 'lobby' && r.players.size < MAX_TEAM) {
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
    room.match.arena.delete(pid); room.match.continued && room.match.continued.delete(pid);
    checkArena(room.match); checkContinue(room.match);
  }
  if (room.players.size === 0) {
    const qi = queue.findIndex(q => q.roomId === room.id);
    if (qi >= 0) queue.splice(qi, 1);
    if (!room.match) rooms.delete(room.id);
    else room.abandoned = true;
  } else if (!opts || !opts.silent) {
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
  pairQueue();
}
function pairQueue() {
  while (queue.length >= 2) {
    const a = rooms.get(queue.shift().roomId);
    const b = rooms.get(queue.shift().roomId);
    if (!a || a.status !== 'queued' || a.players.size === 0) { if (b) queue.unshift({ roomId: b.id, since: Date.now() }); continue; }
    if (!b || b.status !== 'queued' || b.players.size === 0) { queue.unshift({ roomId: a.id, since: Date.now() }); continue; }
    startMatch(a, b, null);
  }
}
setInterval(() => {
  // Bot戦フォールバック
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    const room = rooms.get(q.roomId);
    if (!room || room.status !== 'queued' || room.players.size === 0) { queue.splice(i, 1); continue; }
    if (Date.now() - q.since >= BOT_MATCH_AFTER) {
      queue.splice(i, 1);
      const skillPool = ['low', 'low', 'mid', 'mid', 'high'];
      const bot = {
        name: TEAM_NAME_POOL.filter(n => n !== room.name)[Math.floor(Math.random() * (TEAM_NAME_POOL.length - 1))] || '豪傑連',
        size: 6 + Math.floor(Math.random() * 11),
        skill: skillPool[Math.floor(Math.random() * skillPool.length)],
        variant: VARIANTS[Math.floor(Math.random() * VARIANTS.length)],
        level: Math.min(4, room.streak + Math.floor(Math.random() * 2))
      };
      startMatch(room, null, bot);
    }
  }
  pairQueue();
}, 1000);

/* --- マッチ進行 --- */
const matches = new Set();
function sideInfo(room) {
  const humans = room.players.size;
  return { name: room.name, size: Math.max(humans, MIN_TEAM_FEEL), humans,
    variant: room.variant, level: room.level, streak: room.streak };
}
function startMatch(roomA, roomB, bot) {
  const m = {
    rooms: roomB ? [roomA, roomB] : [roomA],
    bot, round: 0, taps: new Map(), botTaps: new Map(), power: new Map(),
    contrib: new Map(), cueAt: 0, arena: new Set(), continued: new Set(),
    timers: [], done: false, phase: 'arena'
  };
  matches.add(m);
  for (const r of m.rooms) { r.status = 'playing'; r.match = m; m.power.set(r.id, 0); }
  const infoA = sideInfo(roomA);
  const infoB = roomB ? sideInfo(roomB) : { name: bot.name, size: bot.size, humans: 0, variant: bot.variant, level: bot.level };
  broadcastRoom(roomA, { t: 'matched', you: infoA, enemy: infoB, tour: roomA.streak });
  if (roomB) broadcastRoom(roomB, { t: 'matched', you: infoB, enemy: infoA, tour: roomB.streak });
  m.timers.push(setTimeout(() => { if (m.phase === 'arena') beginRounds(m); }, ARENA_WAIT_MAX));
}
function checkArena(m) {
  if (m.phase !== 'arena') return;
  for (const r of m.rooms) for (const pid of r.players) if (!m.arena.has(pid)) return;
  beginRounds(m);
}
function beginRounds(m) {
  if (m.done || m.phase !== 'arena') return;
  m.phase = 'rounds';
  scheduleRound(m, 1);
}
function fillerBots(room) { return Math.max(0, MIN_TEAM_FEEL - room.players.size); }
function scheduleRound(m, r) {
  if (m.done) return;
  m.round = r;
  m.cueAt = Date.now() + CUE_LEAD;
  m.taps.set(r, new Map());   // pid -> offsetMs
  const perRoomBots = new Map();
  for (const room of m.rooms) {
    const bt = botTapOffsets(fillerBots(room), 'mid');
    perRoomBots.set(room.id, bt);
    broadcastRoom(room, { t: 'round', r, cueAt: m.cueAt, botTaps: bt, teamSize: room.players.size + bt.length });
  }
  m.botTaps.set(r, perRoomBots);
  m.timers.push(setTimeout(() => closeRound(m, r), CUE_LEAD + TAP_DURATION_MS + CLOSE_GRACE));
}
function closeRound(m, r) {
  if (m.done || m.round !== r) return;
  for (const room of m.rooms) {
    const events = [];
    const roundTaps = m.taps.get(r);
    for (const pid of room.players) {
      const t = roundTaps.get(pid);
      if (t !== undefined) events.push({ id: pid, time: t });
    }
    (m.botTaps.get(r).get(room.id) || []).forEach((t, i) => {
      if (t >= 0) events.push({ id: 'b' + i, time: t });
    });
    const teamSize = room.players.size + fillerBots(room);
    const { best, winners } = computeBestWindow(events, WINDOW_MS);
    const validCount = events.length;
    const pct = validCount > 0 ? best / validCount : 0;
    const judgement = getJudgementKey(pct);
    m.power.set(room.id, m.power.get(room.id) + best);
    const synced = winners.map(w => w.id);
    for (const id of synced) {
      if (room.players.has(id)) m.contrib.set(id, (m.contrib.get(id) || 0) + 1);
    }
    broadcastRoom(room, { t: 'roundResult', r, best, validCount, teamSize,
      pct: Math.round(pct * 100) / 100, judgement, synced, power: m.power.get(room.id) });
  }
  if (r < ROUNDS) {
    m.timers.push(setTimeout(() => scheduleRound(m, r + 1), RESULT_VIEW));
  } else {
    m.timers.push(setTimeout(() => resolveBattle(m), RESULT_VIEW));
  }
}
function resolveBattle(m) {
  if (m.done) return;
  m.phase = 'battle';
  const roomA = m.rooms[0];
  const powerA = m.power.get(roomA.id);
  let powerB, roomB = null;
  if (m.rooms[1]) { roomB = m.rooms[1]; powerB = m.power.get(roomB.id); }
  else powerB = simulateTeam(m.bot.size, m.bot.skill);
  const aWins = powerA >= powerB;
  broadcastRoom(roomA, { t: 'battle', win: aWins, yourPower: powerA, enemyPower: powerB });
  if (roomB) broadcastRoom(roomB, { t: 'battle', win: !aWins, yourPower: powerB, enemyPower: powerA });
  m.timers.push(setTimeout(() => settle(m, aWins, powerA, powerB), BATTLE_VIEW));
}
function settle(m, aWins, powerA, powerB) {
  if (m.done) return;
  m.phase = 'settle';
  const sides = m.rooms.map((room, i) => ({ room, win: i === 0 ? aWins : !aWins, power: i === 0 ? powerA : powerB }));
  for (const { room, win } of sides) {
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
        level: room.level, streak: room.streak, outcome });
    }
    if (outcome === 'continue') {
      room.pendingContinue = true;
      // 続行の意思確認（全員 or タイムアウトで再キュー）
    } else {
      room.streak = 0;
      backToLobby(room);
    }
  }
  savePlayersSoon();
  const contRooms = m.rooms.filter(r => r.pendingContinue);
  finishMatch(m);
  for (const room of contRooms) {
    room.match = { arena: new Set(), continued: new Set(), isContinueGate: true, room,
      timer: setTimeout(() => forceContinue(room), CONTINUE_WAIT_MAX) };
  }
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
  if (room.abandoned || room.players.size === 0) rooms.delete(room.id);
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

/* ================= HTTP / WS ================= */
const app = express();
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.get('/healthz', (req, res) => res.json({ ok: true, players: players.size, rooms: rooms.size, matches: matches.size }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error('handle error', msg.t, e.message); }
  });
  ws.on('close', () => {
    if (ws.pid) {
      if (sockets.get(ws.pid) === ws) sockets.delete(ws.pid);
      // 猶予をもって退室（リロード対応: 8秒以内に再接続すれば席は残る）
      const pid = ws.pid;
      setTimeout(() => { if (!sockets.has(pid)) leaveRoom(pid); }, 8000);
    }
  });
});
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);

function handle(ws, msg) {
  switch (msg.t) {
    case 'ping': return void ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: Date.now() }));

    case 'register': {
      let p = null;
      if (msg.token) { for (const q of players.values()) if (q.token === msg.token) { p = q; break; } }
      if (!p) {
        const name = sanitizeName(msg.name);
        if (!name) return void ws.send(JSON.stringify({ t: 'err', code: 'name', msg: 'ニックネームを入力してください' }));
        p = { id: 'p' + crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
          name, coins: 0, owned: [], equipped: [], wins: 0 };
        players.set(p.id, p);
      } else if (msg.name && sanitizeName(msg.name)) {
        p.name = sanitizeName(msg.name);
      }
      const old = sockets.get(p.id);
      if (old && old !== ws) { try { old.close(); } catch (e) {} }
      ws.pid = p.id; sockets.set(p.id, ws);
      savePlayersSoon();
      ws.send(JSON.stringify(profileMsg(p)));
      const room = roomOf(p.id);
      if (room) ws.send(JSON.stringify(roomSnapshot(room)));
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
      const roundTaps = m.taps.get(m.round);
      if (roundTaps.has(pid)) return; // 1ラウンド1タップ
      const at = Number(msg.at);
      if (!isFinite(at)) return;
      const offset = at - m.cueAt;
      const arrivalOffset = Date.now() - m.cueAt;
      // クライアント申告時刻の妥当性: 到着時刻より最大1.2秒までしか過去申告できない
      if (offset < 0 || offset > TAP_DURATION_MS) return;
      if (arrivalOffset - offset > 1200 || offset - arrivalOffset > 250) return;
      roundTaps.set(pid, Math.round(offset));
      broadcastRoom(room, { t: 'tapped', r: m.round, pid });
      return;
    }
    case 'continueTour': {
      const room = roomOf(pid);
      if (room && room.pendingContinue && room.match && room.match.isContinueGate) {
        room.match.continued.add(pid);
        checkContinue(room.match);
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
      if (p.owned.includes(msg.key) && !p.equipped.includes(msg.key)) {
        p.equipped.push(msg.key);
        savePlayersSoon();
      }
      return void ws.send(JSON.stringify({ t: 'equipped', equipped: p.equipped }));
    }
  }
}

loadPlayers();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('せーの！神輿バトル server on :' + PORT));
module.exports = { server, computeBestWindow, simulateTeam }; // テスト用
