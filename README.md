# せーの！神輿バトル — オンライン対戦版

複数の実プレイヤーが **登録 → 連（チーム）に参加 → 太鼓の拍に合わせた同期タップ（押し合い）と「せー・の・！」の一撃 → チーム対抗トーナメント** で遊べる、サーバー権威型のマルチプレイヤーゲームです。遊びの設計は [docs/DESIGN_v2.md](./docs/DESIGN_v2.md) を参照してください。

- **サーバー**: Node.js（Express + ws）。判定・パワー計算・コイン経済・ガチャ・マッチングはすべてサーバー側で実行（クライアント改ざん耐性）
- **クライアント**: `public/index.html` ＋ `public/js/`（役割別7ファイル。Three.js r128 / 3D神輿・境内演出込み）。同一オリジンのWebSocketに自動接続。ログイン不要の稽古モードあり
- **マッチング**: 準備完了した連同士を自動ペアリング。相手がいない場合は約5秒でライバル連（CPU）が登場するため、**1人でも常に遊べます**
- **協力プレイ**: 同じ連に最大16人。8人未満はサポーターBotが自動加勢
- **時刻同期**: ping往復でクロックオフセットを推定し、全員の太鼓の拍を±数十msで同期

> 📘 **自分のパソコンで開発を続ける方は [HANDOFF.md](./HANDOFF.md) をご覧ください。**
> コードの取り寄せ方、動作確認、これまでの実装履歴、次にやる改善案（そのまま使えるプロンプト付き）をまとめています。

## 起動（ローカル / VPS）

**Windows ならフォルダの中の `起動する.bat` をダブルクリックするだけ**で起動します（初回だけ必要な部品を自動で入れ、ブラウザが開きます）。
画面に出る `http://192.168.…:3000` を同じWi-Fiのスマホで開けば、スマホでも遊べます。止めるときは黒いウィンドウを閉じます。

コマンドで起動する場合:

```bash
npm install
npm start          # http://localhost:3000
```

Node.js 18以上。動作確認は `curl http://localhost:3000/healthz`。

## デプロイ（いずれか数分で完了）

### 1. Render（無料枠あり・一番かんたん）
1. このフォルダをGitHubリポジトリにpush
2. Render → **New Web Service** → リポジトリを選択
3. 設定は自動検出（`render.yaml` 同梱）。Build: `npm install` / Start: `node server.js`
4. 発行されたURLをそのままスマホで開けばプレイ可能（HTTPSなのでWebSocketは自動的にwss）

### 2. Railway
```bash
railway init && railway up
```

### 3. Fly.io（Dockerfile同梱）
```bash
fly launch --now
```

### 4. 自前サーバー（Docker）
```bash
docker build -t mikoshi .
docker run -p 3000:3000 -v $(pwd)/data:/app/data mikoshi
```

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` | 3000 | 待受ポート |
| `DATA_DIR` | ./data | プレイヤーデータ(JSON)の保存先。**永続ディスクを推奨** |
| `BOT_MATCH_AFTER` | 5000 | 対戦相手不在時にCPU戦へ切替えるまで(ms) |
| `ROUND_INTRO` | 1400 | 番の通知→太鼓の前打ちまで(ms) |
| `BEATS` / `COUNT_IN` / `BEAT_MS` | 8 / 4 / （番ごとのテンポ） | 担ぎの拍数・前打ちの拍数・拍の長さ(ms。指定すると全番このテンポ。主にテスト用) |
| `RESULT_VIEW` / `BATTLE_VIEW` | 2600 / 6500 | ぶつけの結果・決着演出の表示時間(ms) |
| `REG_IP_HOURLY` | 200 | 同じ接続元からの新規登録の上限（1時間あたり）。会場の同じWi-Fiから大勢が登録する場合は増やす |
| `GOOGLE_CLIENT_ID` | （なし） | 設定するとログイン画面に「Googleでログイン」が表示される（下記手順） |

## Googleログインを有効にする手順

未設定でも従来どおりニックネームで遊べます。有効にすると、同じGoogleアカウントなら**別の端末でも同じコイン・衣装データ**で遊べるようになります。

1. [Google Cloud Console](https://console.cloud.google.com/) にログインし、新しいプロジェクトを作成（無料）
2. 「APIとサービス」→「OAuth同意画面」→ User Type は **外部** を選択し、アプリ名などを入力して保存
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」→ アプリの種類は **ウェブアプリケーション**
4. 「承認済みのJavaScript生成元」に以下を追加：
   - 本番: `https://＜あなたのRenderのURL＞`（例 `https://mikoshi-battle.onrender.com`）
   - 開発用（任意）: `http://localhost:3000`
5. 作成すると表示される「クライアントID」（`xxxx.apps.googleusercontent.com` 形式）をコピー
6. Renderのダッシュボード → 対象サービス → **Environment** → 環境変数 `GOOGLE_CLIENT_ID` にそのIDを設定 → 自動で再デプロイ
7. ゲームのログイン画面に「Googleでログイン」ボタンが出れば完了

※ 注意: Render無料プランではデプロイのたびにプレイヤーデータがリセットされます（Googleログインでも同様）。データを恒久保存するには有料の永続ディスクか外部データベースが必要です。

## 仕様（デモから継承・サーバーで強制）

- 拍ごとに100ms窓の揃い×拍とのズレ（極・良・可・惜）で採点。ぶつけは判定 NICE〜MIRACLE
- コインは**勝利時のみ**（勝利+20、シンクロ貢献 +5×ぶつけで揃いに入れた番の数）
- ガチャ 10コイン（SSR1% / SR9% / R30% / N60%）— 抽選・残高はサーバー管理
- 神輿は連（チーム）単位で勝利ごとに自動Lv+1（最大Lv4）
- タップ不正対策: 申告時刻と到着時刻（サーバーが測った往復時間で補正）の乖離が大きいタップは破棄。1拍1タップ
- 登録の乱用対策: 1接続あたりの登録回数と、同じ接続元からの新規登録数に上限

## テスト（同梱）

```bash
node test_e2e.js      # 採点の単体確認＋実WebSocket×4クライアント: PvP/協力/連戦/ガチャ/不正/外部API (約90チェック)
node test_browser.js  # 実クライアントHTML(jsdom)を実サーバーに接続した通しテスト
```

## 外部連携API（課金・ランキング・報酬システム接続用）

外部サービスからゲームのデータを読み書きするためのAPIです。書き込み系は環境変数 `API_KEY` を設定した上で、リクエストヘッダー `X-Api-Key` に同じ値を付けたものだけが通ります。

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/api/ranking` | 不要 | 勝利数順の上位20人（rank / id / name / wins / coins） |
| GET | `/api/players/:id` | `X-Api-Key` | プレイヤーの残高・戦績・所持衣装の照会 |
| POST | `/api/coins/grant` | `X-Api-Key` | コイン付与。`{"playerId":"p〜","amount":100,"reason":"購入特典"}`。付与されると本人の画面に即時通知される |

```bash
# 例: ランキング取得
curl https://あなたのURL/api/ranking

# 例: コイン付与（課金システムの決済完了後などに呼ぶ）
curl -X POST https://あなたのURL/api/coins/grant \
  -H "Content-Type: application/json" -H "X-Api-Key: あなたのAPI_KEY" \
  -d '{"playerId":"p1a2b3c4d5e6","amount":100,"reason":"購入特典"}'
```

さらに、環境変数 `WEBHOOK_URL` を設定すると、**試合が確定するたびに**その URL へ結果がPOSTされます（報酬集計・外部ランキング反映向け）。ヘッダー `X-Webhook-Secret` に環境変数 `WEBHOOK_SECRET` の値が入るので、受信側で照合してください。

```json
{ "event": "matchSettled", "at": "…", "teams": [ { "name": "雷神会", "win": true, "power": 55,
    "players": [ { "id": "p…", "name": "たろう", "coins": 45, "wins": 3 } ] } ] }
```

関連の環境変数: `API_KEY`（外部API認証）/ `WEBHOOK_URL`・`WEBHOOK_SECRET`（試合結果の外部通知）

## 制約・今後の拡張

- 単一インスタンス前提（ルーム状態はメモリ）。水平スケールにはRedis等の共有ストアが必要
- 認証はニックネーム＋端末トークン（localStorage）。本格運用ではOAuth等を推奨
- 永続化はJSONファイル。規模拡大時はSQLite/Postgresへ
