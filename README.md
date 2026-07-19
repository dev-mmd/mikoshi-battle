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

## 制約・今後の拡張

- 単一インスタンス前提（ルーム状態はメモリ）。水平スケールにはRedis等の共有ストアが必要
- 認証はニックネーム＋端末トークン（localStorage）。本格運用ではOAuth等を推奨
- 永続化はJSONファイル。規模拡大時はSQLite/Postgresへ
