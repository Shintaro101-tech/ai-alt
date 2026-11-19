#!/bin/bash
# AI-ALT の「変換係」の登録を解除します。
LABEL="jp.ai-alt.helper"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "変換係の登録を解除しました。（スライドを変換.command は引き続き使えます）"
echo ""
read -n 1 -p "何かキーを押すと閉じます"; echo ""
