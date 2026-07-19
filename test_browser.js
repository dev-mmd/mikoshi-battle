/* ブラウザ級E2E: public/index.html を jsdom で実サーバーに接続し、UI操作でフルフロー検証 */
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = 3122;
let checks = 0;
function ok(c, m) { checks++; if (!c) { console.error('FAIL:', m); process.exit(1); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT, TAP_MS: 1000, CUE_LEAD: 1500, CLOSE_GRACE: 300,
      RESULT_VIEW: 800, BATTLE_VIEW: 1200, BOT_MATCH_AFTER: 1000,
      DATA_DIR: '/tmp/mikoshi-btest-' + Date.now()
    })
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await sleep(700);

  let html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const three = fs.readFileSync(require.resolve('three/build/three.min.js'), 'utf8');
  html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
    '<script>' + three + '</script>');

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:' + PORT + '/',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.WebSocket = WebSocket;
      window.HTMLCanvasElement.prototype.getContext = function (kind) {
        if (kind !== '2d') return null; // WebGL不可 → 3Dフォールバック経路
        return new Proxy({}, {
          get(t, p) {
            if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
            if (p === 'measureText') return () => ({ width: 10 });
            return () => {};
          },
          set() { return true; }
        });
      };
    }
  });
  const { window } = dom;
  const { document } = window;
  function active() { const el = document.querySelector('.screen.active'); return el ? el.id : null; }
  window.addEventListener('error', e => { console.error('PAGE ERROR:', e.message); console.error(e.error && e.error.stack ? e.error.stack.split('\n').slice(0,10).join('\n') : '(no stack)'); console.error('active screen:', active()); process.exit(1); });

  function click(id) { document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true })); }
  async function until(cond, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return; await sleep(60); }
    console.error('TIMEOUT:', label, '| active=', active()); process.exit(1);
  }

  await sleep(400);
  ok(active() === 'screen-title', 'starts on title');

  // 全神輿様式の3D組み立てスモークテスト（WebGL無しでもジオメトリ構築は実行できる）
  const smoke = window.__mikoshiTest.buildAllVariants();
  ok(smoke.length === 9, '3D smoke: all 9 variants assemble: ' + smoke.join(' '));

  click('titleStartBtn');
  await until(() => active() === 'screen-login', 3000, 'login');

  document.getElementById('nickInput').value = 'みこし太郎';
  click('joinBtn');
  await until(() => active() === 'screen-qr', 6000, 'welcome→QR');
  ok(true, 'registered via UI');

  await until(() => active() === 'screen-teamselect', 6000, 'teamselect');
  // 新しい連を作る: 新様式「八角」を選択（サーバー側の様式受理も検証）
  const chip = document.querySelector('.variant-chip[data-v="hakkaku"]');
  ok(chip !== null, 'new variant chip rendered');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(100);
  const input = document.getElementById('customTeamInput');
  input.value = '花火連';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  click('teamConfirmBtn');
  await until(() => active() === 'screen-lobby', 4000, 'lobby');
  ok(document.getElementById('lobbyTeamName').textContent === '花火連', 'team name shown');
  ok(document.getElementById('lobbyJoinFeed').textContent.includes('みこし太郎'), 'own name in member feed');

  click('lobbyReadyBtn');
  // Bot戦マッチ → 試合前広告
  await until(() => active() === 'screen-ad', 8000, 'pre-match ad');
  await until(() => !document.getElementById('adSkipBtn').classList.contains('hidden'), 8000, 'ad skip unlock');
  click('adSkipBtn');
  await until(() => active() === 'screen-match', 4000, 'arena');
  ok(document.querySelectorAll('.avatar-dot').length >= 8, 'avatar grid = team size');
  ok(document.querySelector('.avatar-dot.is-player') !== null, 'own dot marked');

  let matchesPlayed = 0, outcome = null;
  while (matchesPlayed < 3 && !outcome) {
    matchesPlayed++;
    for (let r = 1; r <= 3; r++) {
      await until(() => document.getElementById('cueText').classList.contains('show'), 12000, 'cue m' + matchesPlayed + ' r' + r);
      await sleep(180);
      document.getElementById('tapZone').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      await until(() => document.getElementById('roundResultOverlay').classList.contains('show'), 8000, 'result m' + matchesPlayed + ' r' + r);
      const lbl = document.getElementById('judgeLabel').textContent;
      ok(lbl.length > 0, 'judgement m' + matchesPlayed + ' r' + r + ': ' + lbl);
    }
    // battle → settle → 分岐（勝利:次戦探索 / 敗北:広告 / 優勝:結果）
    await until(() => ['screen-battle'].includes(active()), 10000, 'battle screen');
    await until(() => {
      const a = active();
      if (a === 'screen-ad') { outcome = 'eliminated'; return true; }
      if (a === 'screen-result') { outcome = 'champion'; return true; }
      if (a === 'screen-match' && document.getElementById('mikoshiLiveLabel').textContent.includes('進出')) return true;
      return false;
    }, 15000, 'post-battle routing m' + matchesPlayed);
    if (!outcome) console.log('  advanced:', document.getElementById('mikoshiLiveLabel').textContent);
  }
  console.log('outcome after', matchesPlayed, 'match(es):', outcome || 'still winning (cap reached)');

  if (outcome === 'eliminated') {
    await until(() => !document.getElementById('adSkipBtn').classList.contains('hidden'), 8000, 'loss ad skip');
    click('adSkipBtn');
    await until(() => active() === 'screen-prediction', 4000, 'prediction');
    click('predictionBtnA');
    await until(() => !document.getElementById('predictionContinueBtn').classList.contains('hidden'), 4000, 'prediction resolved');
    click('predictionContinueBtn');
    await until(() => active() === 'screen-result', 3000, 'result');
    click('resultToGachaBtn');
    await until(() => active() === 'screen-mypage', 3000, 'mypage');
  } else if (outcome === 'champion') {
    click('resultToGachaBtn');
    await until(() => active() === 'screen-mypage', 3000, 'mypage');
  }

  if (active() === 'screen-mypage') {
    const coins = document.getElementById('mypageCoins').textContent;
    console.log('  mypage coins:', coins);
    // サーバー残高照合
    const res = await fetch('http://127.0.0.1:' + PORT + '/healthz').then(r => r.json());
    ok(res.ok, 'server healthy');
    click('mypageGachaBtn');
    await until(() => active() === 'screen-gacha', 3000, 'gacha screen');
    const badge = document.getElementById('gachaMedalBadge').textContent;
    ok(badge.includes(coins), 'gacha badge matches balance: ' + badge);
    if (parseInt(coins, 10) >= 10) {
      click('gachaDrawBtn');
      await until(() => !document.getElementById('gachaResultCard').classList.contains('hidden'), 6000, 'gacha reveal');
      console.log('  gacha item:', document.getElementById('gachaAvatarName').textContent,
        document.getElementById('gachaAvatarRarity').textContent);
      // 装備画面へ
      click('gachaToEquipBtn');
      await until(() => active() === 'screen-equip', 3000, 'equip screen');
      const equipBtn = document.querySelector('.equip-btn');
      ok(equipBtn !== null, 'equip row rendered');
    } else {
      click('gachaBackBtn');
      await until(() => active() === 'screen-mypage', 3000, 'gacha back button');
    }
  }

  console.log('BROWSER E2E PASS —', checks, 'checks');
  srv.kill();
  process.exit(0);
})().catch(e => { console.error('EXC:', e); process.exit(1); });
