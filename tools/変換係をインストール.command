#!/bin/bash
# AI-ALT の「変換係」をこのMacに登録します（1回だけ）。
# 登録すると、ログインするたびに裏で自動的に起動し、AI-ALT で .pptx を選ぶだけで変換・読み込みできます。
cd "$(dirname "$0")"
HERE="$(pwd)"
LABEL="jp.ai-alt.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/AI-ALT-helper.log"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

pause() { echo ""; read -n 1 -p "何かキーを押すと閉じます"; echo ""; }

echo "AI-ALT の変換係をインストールします。"
echo ""

PY="$(command -v python3)"
if [ -z "$PY" ]; then
  echo "python3 が見つかりません。"; pause; exit 1
fi
if ! "$PY" -c "import pptx, lxml" 2>/dev/null; then
  echo "python-pptx をインストールします…"
  "$PY" -m pip install --user python-pptx || { echo "python-pptx をインストールできませんでした。"; pause; exit 1; }
fi
if ! command -v pdftoppm >/dev/null; then
  echo "pdftoppm がありません。ターミナルで  brew install poppler  を実行してから、もう一度ダブルクリックしてください。"
  pause; exit 1
fi
if [ ! -d "/Applications/Microsoft PowerPoint.app" ]; then
  echo "注意：Microsoft PowerPoint が見つかりません。変換には PowerPoint が必要です。"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HERE/_work"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$HERE/aialt_helper.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST"

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s http://127.0.0.1:8766/ping | grep -q '"ok": true'; then
    echo "✅ インストールしました。変換係が動いています。"
    echo ""
    echo "AI-ALT の編集画面で「📥 PowerPoint を読み込む」から .pptx を選ぶ（またはドラッグする）だけで読み込めます。"
    echo "初めての変換のときに、Mac から「PowerPoint を操作する」「書類フォルダへのアクセス」などの許可を"
    echo "求められたら「OK／許可」を選んでください。"
    pause; exit 0
  fi
  sleep 1
done
echo "変換係を起動できませんでした。記録： $LOG"
tail -n 20 "$LOG" 2>/dev/null
pause; exit 1
