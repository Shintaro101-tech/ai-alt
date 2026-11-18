# AI-ALT — Your AI Assistant Language Teachers

英語の授業で使う AI の ALT（Emma / Oliver / Noah / Chloe）。PCのブラウザで開き、プロジェクターに映して使います。
アバター・声・会話のしくみは「洋書トーク」と共通で、中継サーバー（Cloudflare Worker）も洋書トークのものを使います。

## 画面

- **左：ALT** … 「▶ ○○ を呼ぶ」で会話開始。話すと口が動きます。
  - 🎙 マイクON/OFF（スペースキー）… 日本語で説明するときなどはOFFに
  - ALTへの指示 … 入力した内容は、声に出さずにALTだけに伝わります（例：Now answer the second question.）
  - ⏹ 終了 → 「▶ 再開する」で、それまでの会話を覚えたまま戻ってきます
- **右：ディスプレイ**
  - 📑 スライド … 教員が準備したスライド（文字・画像）。←/→ キーで移動。ALTは今のスライドを把握しています
  - ✍️ ALTボード … ALTが会話の中で重要表現・例文・質問を書き出します（「Can you write it on the board?」でも可）
  - 💬 スクリプト … 会話がリアルタイムで文字に
- F キーで全画面

## レッスンの作り方

レッスン一覧 →「＋ 新しいレッスン」→ 編集画面で
- 担当ALT、生徒のレベル
- **ALTへの指示**：授業の流れ・ALTの役割・台本（英語で書くと正確）
- **スライド**：本文は1行ずつ表示。`- ` で箇条書き、`**語句**` で黄色マーカー。画像・図も追加可。「ALTへのメモ」は生徒には見えません

レッスンはブラウザ内に保存されます。保管・別のPCへの移動は「📤 書き出す」→「📥 読み込む」。
サンプル「Second Conditional — My Home & Neighborhood」（模擬授業用）が最初から入っています。

## 動かし方

中継サーバーが受け付けるのは `http://localhost:8765` と `https://shintaro101-tech.github.io` からのアクセスだけです。

**このPCで使う**（「名桜大学公募」フォルダで）:

```bash
python3 -m http.server 8765 --directory AI-ALT
```

→ http://localhost:8765 を Chrome で開く（マイクの許可が必要）。合言葉は洋書トークと同じです。

**ウェブ公開する**：このフォルダを GitHub Pages（shintaro101-tech.github.io のリポジトリ）に置けば、どのPCからでも開けます。

## 構成

```
index.html
css/style.css
js/app.js        ルーター
js/home.js       レッスン一覧
js/editor.js     レッスン編集・スライドの表示
js/classroom.js  授業画面（ALT・ディスプレイ・ALTへの指示文）
js/live.js       GPT-Live の接続（洋書トークと共通）
js/api.js        中継サーバー・合言葉
js/avatars.js    ALT 4名（人物設定・声・画像）
js/store.js      レッスンの保存（IndexedDB）
js/sample.js     サンプルレッスン
assets/avatars/  アバター画像（洋書トークからコピー）
assets/lessons/  サンプルレッスンの画像
```
