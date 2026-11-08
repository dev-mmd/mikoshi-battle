@echo off
rem せーの！神輿バトル ： ローカル起動（ダブルクリックで実行）
rem 1) Node.js の確認  2) 初回だけ部品をダウンロード  3) サーバー起動  4) ブラウザを開く
cd /d "%~dp0"
title せーの！神輿バトル（このウィンドウを閉じるとゲームが止まります）

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js が入っていません。
  echo  https://nodejs.org/ja から「LTS」版を入れてから、もう一度このファイルをダブルクリックしてください。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo  初回の準備をしています（1分ほどかかります）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  準備に失敗しました。インターネットにつながっているか確かめて、もう一度お試しください。
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3000

echo.
echo  ============================================================
echo   せーの！神輿バトル を起動します
echo.
echo   このパソコンで遊ぶ:  http://localhost:%PORT%
echo.
echo   同じWi-Fiのスマホで遊ぶ（下のどれかをスマホのブラウザで開く）:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo     http://%%b:%PORT%
)
echo   ※初回は Windows の「アクセスを許可しますか」が出たら「許可」を押してください
echo.
echo   止めるとき: このウィンドウを閉じる（または Ctrl+C）
echo  ============================================================
echo.

rem 2秒後にブラウザを開く（サーバーの起動を待つ）。NO_BROWSER=1 のときは開かない（動作確認用）
if not "%NO_BROWSER%"=="1" start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

node server.js
echo.
echo  サーバーが止まりました。すでに別のウィンドウで起動している場合は、そちらを使ってください。
pause
