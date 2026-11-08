/* ブラウザ級E2E: public/index.html を jsdom で実サーバーに接続し、UI操作でフルフロー検証（v2）
 * タイトル → 遊び方（初回）→ 稽古モードの開始確認 → 設定（音のタイミング・動きを減らす）→ 参加登録 → 店舗QR → 連の旗揚げ → 控室
 * → 試合前広告 → 対戦（拍タップ。音のタイミング調整を入れたままでも判定が変わらないこと）→ 結果（拍の振り返り）→ マイページ → ガチャ → 着せ替え */
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = +process.env.TEST_PORT || 3122;
let checks = 0;
function ok(c, m) { checks++; if (!c) { console.error('FAIL:', m); process.exit(1); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      PORT, BEATS: 2, BEAT_MS: 400, COUNT_IN: 1, ROUND_INTRO: 600, CLOSE_GRACE: 250,
      RESULT_VIEW: 600, BATTLE_VIEW: 800, BOT_MATCH_AFTER: 800,
      DATA_DIR: path.join(os.tmpdir(), 'mikoshi-btest-' + Date.now())
    })
  });
  srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  /* サーバーの起動を待つ（固定時間だと遅い環境でまれに接続に失敗するため） */
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:' + PORT + '/healthz')).ok) break; } catch (e) {}
    await sleep(100);
  }

  /* 画面ファイルを読み、外部スクリプトを中身に差し替えて jsdom で動かす */
  let html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const three = fs.readFileSync(require.resolve('three/build/three.min.js'), 'utf8');
  html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', () => '<script>' + three + '</script>');
  html = html.replace(/<script src="https:\/\/cdnjs[^"]*qrcode[^"]*"><\/script>/, '');
  html = html.replace(/<script src="(js\/[^"?]+)(\?[^"]*)?"><\/script>/g, (all, src) => '<script>' + fs.readFileSync(path.join(__dirname, 'public', src), 'utf8') + '</script>');

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:' + PORT + '/',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.WebSocket = WebSocket;
      window.HTMLCanvasElement.prototype.getContext = function (kind) {
        if (kind !== '2d') return null; // WebGL不可 → 3Dなしで画面だけ動く経路
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
  const T = () => window.__mikoshiTest;
  function active() { const el = document.querySelector('.screen.active'); return el ? el.id : null; }
  window.addEventListener('error', e => { console.error('PAGE ERROR:', e.message); console.error(e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 10).join('\n') : '(no stack)'); console.error('active screen:', active()); process.exit(1); });
  function click(id) { document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true })); }
  async function until(cond, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (cond()) return; await sleep(50); }
    console.error('TIMEOUT:', label, '| active=', active()); process.exit(1);
  }
  /* 画面の試合で、拍とぶつけのタイミングに合わせてタップする */
  async function playRounds(label) {
    for (let r = 1; r <= 3; r++) {
      await until(() => { const R = T().round(); return R && R.r === r; }, 15000, label + ' round ' + r);
      const R = T().round();
      for (let i = 0; i < R.beats; i++) {
        await sleep(Math.max(0, R.startPerf + i * R.beatMs + 5 - window.performance.now()));
        T().tap();
      }
      await sleep(Math.max(0, R.clashPerf + 10 - window.performance.now()));
      T().tap();
      ok(R.tapped[0] && R.tapped.c, label + ' r' + r + ': beat & clash taps registered locally');
      await until(() => !document.getElementById('clashCard').classList.contains('hidden'), 6000, label + ' clash card r' + r);
      ok(document.getElementById('clashJudge').textContent.length > 0, label + ' r' + r + ' clash judgement: ' + document.getElementById('clashJudge').textContent);
    }
  }

  await sleep(500);
  ok(active() === 'screen-title', 'starts on title');

  /* 3Dの組み立てスモークテスト（WebGL無しでもジオメトリ・骨格・衣装は作れる） */
  const smoke = T().selfTest();
  ok(smoke.length === 10, '3D smoke: 9 variants + avatar assemble: ' + smoke.join(' '));

  /* 稽古モード: 初回は遊び方を1枚見せてから、サーバーを使わず試合が始まる */
  const isShown = id => !document.getElementById(id).classList.contains('hidden');
  click('titlePracticeBtn');
  await until(() => isShown('howtoModal'), 2000, 'howto before first practice');
  ok(document.getElementById('howtoModal').textContent.includes('せー・の・！'), 'howto explains the clash');
  ok(active() === 'screen-title', 'practice waits for howto');
  click('howtoStartBtn');
  ok(!isShown('howtoModal'), 'howto closed');
  ok(window.localStorage.getItem('mikoshiHowtoSeen') === '1', 'howto marked as seen');
  await until(() => active() === 'screen-match', 4000, 'practice → match');
  await until(() => { const R = T().round(); return R && R.r === 1; }, 6000, 'practice round 1');
  ok(document.getElementById('youName').textContent === '稽古連', 'practice teams shown');
  ok(isShown('matchQuitBtn'), 'practice quit button shown');
  /* 自分が叩いた拍では、助っ人は自分に寄せて動く（予定どおりではなく自分の一打に合わせる） */
  {
    const R = T().round();
    await sleep(Math.max(0, R.startPerf + 5 - window.performance.now()));
    T().tap();
    ok(R.tapped[0], 'practice beat 0 tapped');
    const followed = Object.keys(R.helperDone).filter(k => k.startsWith('0:')).length;
    ok(R.helpers === 7 && followed === R.helpers, 'helpers follow my tap on beat 0: ' + followed + '/' + R.helpers);
  }
  click('matchQuitBtn');
  await until(() => active() === 'screen-title', 3000, 'practice quit → title');
  ok(T().round() === null || T().round() === undefined, 'practice match cleared');
  /* 2回目は遊び方を出さずにすぐ始まる */
  click('titlePracticeBtn');
  ok(!isShown('howtoModal'), 'howto not shown again');
  await until(() => active() === 'screen-match', 4000, 'practice again → match');
  T().stopPractice();
  await until(() => active() === 'screen-title', 3000, 'practice stopped → title');

  /* 設定: 音のタイミング調整（±150ms・10ms刻み・保存）と、動きを減らすの手動切り替え */
  click('titleSettingsBtn');
  ok(isShown('settingsModal'), 'settings opened from title');
  for (let i = 0; i < 10; i++) click('setOffsetPlus');
  ok(T().settings().offset === 100, 'audio offset +100ms: ' + T().settings().offset);
  ok(JSON.parse(window.localStorage.getItem('mikoshiSettings')).offset === 100, 'offset saved');
  for (let i = 0; i < 10; i++) click('setOffsetPlus');
  ok(T().settings().offset === 150, 'offset clamps at +150');
  for (let i = 0; i < 5; i++) click('setOffsetMinus');
  ok(T().settings().offset === 100, 'offset back to +100');
  const rm0 = T().settings().reduceMotion;
  click('setMotionBtn');
  ok(T().settings().reduceMotion === !rm0 && window.MK.reduceMotion === !rm0, 'reduce motion overridden manually');
  click('setMotionAutoBtn');
  ok(T().settings().motion === 'auto' && T().settings().reduceMotion === rm0, 'reduce motion back to device setting');
  click('calibOpenBtn');
  ok(isShown('calibPanel') && document.getElementById('calibStatus').textContent.length > 0, 'calibration panel opens');
  click('calibBackBtn');
  ok(isShown('settingsMain'), 'calibration back to settings');
  click('settingsCloseBtn');
  ok(!isShown('settingsModal'), 'settings closed');

  /* 参加登録 */
  click('titleStartBtn');
  await until(() => active() === 'screen-login', 3000, 'login');
  document.getElementById('nickInput').value = 'みこし太郎';
  click('joinBtn');
  await until(() => active() === 'screen-qr', 6000, 'welcome→QR');
  ok(true, 'registered via UI');
  await until(() => active() === 'screen-teamselect', 8000, 'teamselect');

  /* 連の旗揚げ: 八角の神輿を選ぶ */
  const chip = document.querySelector('.variant-chip[data-v="hakkaku"]');
  ok(chip !== null, 'variant chip rendered');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(100);
  const input = document.getElementById('customTeamInput');
  input.value = '花火連';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  click('teamConfirmBtn');
  await until(() => active() === 'screen-lobby', 4000, 'lobby');
  ok(document.getElementById('lobbyTeamName').textContent === '花火連', 'team name shown');
  ok(document.getElementById('lobbyMembers').textContent.includes('みこし太郎'), 'own name in member list');
  ok(document.getElementById('lobbyMembers').textContent.includes('助っ人 7人'), 'helpers shown');

  /* 準備完了 → CPU連とマッチ → 試合前広告 → 入場 */
  click('lobbyReadyBtn');
  await until(() => active() === 'screen-ad', 8000, 'pre-match ad');
  await until(() => !document.getElementById('adSkipBtn').classList.contains('hidden'), 8000, 'ad skip unlock');
  click('adSkipBtn');
  await until(() => active() === 'screen-match', 4000, 'arena');
  ok(document.querySelectorAll('#teamDots .dot').length >= 8, 'team dots = team size');
  ok(document.querySelector('#teamDots .dot.me') !== null, 'own dot marked');
  ok(document.getElementById('youName').textContent === '花火連', 'own team name in HUD');

  await playRounds('m1');
  const youScore = +document.getElementById('youScore').textContent;
  ok(youScore > 0, 'live score increased: ' + youScore);
  /* 音のタイミング調整（+100ms）を入れていても、拍の判定はサーバーの基準のまま（叩いた拍が数えられる） */
  const myMarks = T().match().rounds.map(r => r.marks || []);
  ok(myMarks.length === 3 && myMarks.every(mk => mk.length === 3 && mk[0] && Math.abs(mk[0].d) < 100), 'beats judged on time with audio offset: ' + JSON.stringify(myMarks.map(mk => mk[0] && mk[0].d)));
  await until(() => active() === 'screen-result', 15000, 'result screen');
  const head = document.getElementById('resultHeadline').textContent;
  ok(['勝利！', '優勝！！', '敗退…'].includes(head), 'result headline: ' + head);
  ok(document.querySelectorAll('#scoreTable tr').length === 5, 'score table has 3 rounds + header + total');
  ok(document.getElementById('myStats').textContent.includes('叩いた拍'), 'personal stats shown');
  ok(document.querySelector('#review svg') !== null && document.getElementById('reviewSum').textContent.startsWith('9打中'), 'beat review chart: ' + document.getElementById('reviewSum').textContent);
  if (head === '勝利！') ok(/あと\d+秒/.test(document.getElementById('resultNextBtn').textContent), 'continue button shows countdown: ' + document.getElementById('resultNextBtn').textContent);
  console.log('  result:', head, '|', document.getElementById('resultCoins').textContent);

  /* マイページ → ガチャ → 着せ替え */
  click('resultMypageBtn');
  await until(() => active() === 'screen-mypage', 3000, 'mypage');
  const retryText = document.getElementById('mypageRetryBtn').textContent;
  ok(head === '勝利！' ? retryText.startsWith('次の対戦へ') : retryText.startsWith('控室へ'), 'mypage main button follows tour state: ' + retryText);
  const coins = parseInt(document.getElementById('mypageCoins').textContent, 10);
  const res = await fetch('http://127.0.0.1:' + PORT + '/healthz').then(r => r.json());
  ok(res.ok, 'server healthy');
  click('mypageGachaBtn');
  await until(() => active() === 'screen-gacha', 3000, 'gacha screen');
  ok(document.getElementById('gachaMedalBadge').textContent.includes(String(coins)), 'gacha badge matches balance');
  if (coins >= 10) {
    click('gachaDrawBtn');
    await until(() => !document.getElementById('gachaResultCard').classList.contains('hidden'), 6000, 'gacha reveal');
    console.log('  gacha item:', document.getElementById('gachaAvatarName').textContent, document.getElementById('gachaAvatarRarity').textContent);
    click('gachaToEquipBtn');
    await until(() => active() === 'screen-equip', 3000, 'equip screen');
    const equipBtn = document.querySelector('.equip-btn');
    ok(equipBtn !== null, 'equip row rendered');
    equipBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(100);
    ok(document.querySelector('.equip-btn').textContent === '装備中', 'item equipped');
  } else {
    ok(document.getElementById('gachaDrawBtn').disabled, 'gacha disabled without coins');
    click('gachaBackBtn');
    await until(() => active() === 'screen-mypage', 3000, 'gacha back button');
  }

  console.log('BROWSER E2E PASS —', checks, 'checks');
  srv.kill();
  setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('EXC:', e); process.exit(1); });
