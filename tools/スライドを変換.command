#!/bin/bash
# PowerPoint を AI-ALT 用のスライドファイル（.aialt-slides.json）に変換します。
# ダブルクリック → PowerPoint ファイルを選ぶ → 同じフォルダに変換したファイルができます。
cd "$(dirname "$0")"

FILE="$1"
if [ -z "$FILE" ]; then
  FILE=$(osascript -e 'POSIX path of (choose file with prompt "AI-ALT に読み込む PowerPoint ファイルを選んでください" of type {"pptx", "org.openxmlformats.presentationml.presentation"})' 2>/dev/null)
fi
if [ -z "$FILE" ]; then
  echo "キャンセルしました。"
  exit 0
fi

PY=python3
if ! $PY -c "import pptx" 2>/dev/null; then
  echo "python-pptx をインストールします…"
  $PY -m pip install --user python-pptx || { echo "python-pptx をインストールできませんでした。"; read -n 1 -p "何かキーを押すと閉じます"; exit 1; }
fi
if ! command -v pdftoppm >/dev/null; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v pdftoppm >/dev/null; then
  echo "pdftoppm がありません。ターミナルで  brew install poppler  を実行してください。"
  read -n 1 -p "何かキーを押すと閉じます"; exit 1
fi

OUT=$($PY pptx2aialt.py "$FILE")
if [ $? -eq 0 ] && [ -f "$OUT" ]; then
  echo ""
  echo "AI-ALT の編集画面で「📥 PowerPoint を読み込む」からこのファイルを選んでください："
  echo "$OUT"
  open -R "$OUT"
else
  echo "変換できませんでした。"
fi
echo ""
read -n 1 -p "何かキーを押すと閉じます"
