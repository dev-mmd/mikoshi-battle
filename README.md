# せーの！神輿バトル — オンライン対戦版

複数の実プレイヤーが **登録 → 連（チーム）に参加 → リアルタイム同期タップ → チーム対抗トーナメント** で遊べる、サーバー権威型のマルチプレイヤーゲームです。

- **サーバー**: Node.js（Express + ws）。判定・パワー計算・コイン経済・ガチャ・マッチングはすべてサーバー側で実行（クライアント改ざん耐性）
- **クライアント**: 単一HTML（Three.js r128 / 3D神輿・境内演出込み）。同一オリジンのWebSocketに自動接続
- **マッチング**: 準備完了した連同士を自動ペアリング。相手がいない場合は約5秒でライバル連（CPU）が登場するため、**1人でも常に遊べます**
- **協力プレイ**: 同じ連に最大16人。8人未満はサポーターBotが自動加勢
- **時刻同期**: ping往復でクロックオフセットを推定し、全員の「せーの！」を±数十msで同期

## 起動（ローカル / VPS）

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
| `CUE_LEAD` | 3600 | ラウンド開始→「せーの！」まで(ms) |
| `RESULT_VIEW` / `BATTLE_VIEW` | 5600 / 7600 | 結果・対戦演出の表示時間(ms) |
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

- 100msスライディング窓のシンクロ判定 / 判定 NICE〜MIRACLE
- コインは**勝利時のみ**（勝利+20、シンクロ貢献 +5×成功ラウンド数）
- ガチャ 10コイン（SSR1% / SR9% / R30% / N60%）— 抽選・残高はサーバー管理
- 神輿は連（チーム）単位で勝利ごとに自動Lv+1（最大Lv4）
- タップ不正対策: 申告時刻と到着時刻の乖離が大きいタップは破棄

## テスト（同梱）

```bash
node test_e2e.js      # 実WebSocket×4クライアント: PvP/協力/連戦/ガチャ/不正 (約48チェック)
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
