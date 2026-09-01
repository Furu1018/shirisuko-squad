# しりすこスクワッド ロードマップ / 引き継ぎメモ

最終更新: 2026-09-01 (職場PC・Codex併用)。**次にやること = 3凸ボードの実装** (下の「📌 直近」)。

新しいPCで始めるときは **README.md → AGENTS.md → このファイル** の順に読むこと。

---

## 📌 直近: 入口を「3凸ボード」に作り替える (モック承認済み・未着手)

**承認済みモック**: https://claude.ai/code/artifact/eed3879e-a1c9-4c44-bae4-c09eebb67a84

### なぜ作り替えるか
いまの入口は原作 nikke-calc の「計算機」タブそのままで、いきなり5枠の編成組みと戦闘条件が並ぶ。
これは「手で編成をいじる人」向けで、「自分の育成を取り込んで、どの凸に何を持っていくか決めたい」には遠い。

さらに **ユニオンレイドは3凸・同じニケは1度だけ**。属性ごとに最大値を出しても、
3凸では分け合うのでその合計には届かない。**被りを含めて3枠まとめて決める盤面**が要る。

### 作るもの (モックのとおり)
1. **取込の帯** (最上部・常設) — 同期状態 + 「今の育成を取り込む」。実装済みの機能をここに移す
2. **3凸の盤面** (主役・横3枠)
   - 枠ごとに**ボスを選ぶ** → そのボスに有利なコードの編成が入る (`element-plans.ts` の `counterOf`)
   - **被りをその場で示す** — 単に警告するのではなく**代案の損得まで出す**
     (「外して組み直すと −0.37億 / 1凸目から譲ると1凸目が −0.68億 → 今のままが最大」)
   - 空き枠には「残りで一番出るボスを探す」
3. **合計バー** — 3凸の合計・使用人数・被り件数・「被りなしで最大の3凸を探す」
4. **もう使ったニケ** — どの凸で使ったかの一覧 (他の枠では選べない)
5. **属性別の手持ち** (参考・下段) — 被りを考えない場合の属性ごとの最大値。
   「3凸に組むと分け合うのでこれより下がります」と明記する
6. 下段に導線 — 詳細計算 (いまの計算機) / マイロスター / ユニオン運営

### 実装の勘どころ
- **今できることを減らさない。** いまの「計算機」タブは「詳細計算」として残す
- 被りなしの最大化は**組合せ最適化**になる。総当たりは無理なので、
  本家PADの `js/optimal-plan.js` (決定的ソルバー・貪欲＋限定分岐) の考え方が参考になる。
  ただし本家は「メンバー×ボス」の割当、こちらは「1人の3凸」なので規模はずっと小さい
  (ボス5 × 属性別の案3 の組合せに、キャラ被りの制約を掛けるだけ)
- 計算は既存の経路をそのまま使う (`requestForDeck` → `client.simulate` → `cache`)。
  1編成あたりブラウザで **180秒戦闘 8.3秒 / 90秒戦闘 3.9秒** (実測)。
  3凸の候補を数十通り試すなら 90秒の粗探索で絞る (順位相関 0.988 を実測済み)
- デザインは **ClaudeDesign** (本家PADの設計system)。既にライトテーマ化済みなので、
  新しい画面もそのトークン (`--ink` `--sub` `--accent` `--amber-text` `--scrim` など) を使う

---

## ✅ ここまでに入れたもの (すべて main に push 済・Codex レビュー済)

### 公開
- https://furu1018.github.io/shirisuko-squad/ (GitHub Pages・`main` push で自動デプロイ)
- リポジトリ: https://github.com/Furu1018/shirisuko-squad (public・MIT)

### v1 の①〜⑤
| # | 内容 | 主なファイル |
|---|---|---|
| ① | 取込のワンボタン更新 + マージ規則 | `sync-meta.ts` / `roster-merge.ts` |
| ② | マイロスター (育成状況) | `my-roster.ts` |
| ③ | 属性別編成 (5属性 × 最大3案・比較) | `element-plans.ts` |
| ④ | ボス条件での再評価 (基準と並記・順位の入れ替わりを明示) | `element-plans.ts` / `union-bosses.ts` |
| ⑤ | ライトテーマ (PAD の ClaudeDesign) | `styles.css` / `timeline.ts` |

### 日本語化
UI 全ファイル。**内部キー (韓国語のキャラ名・属性・保存値・共有コード・CSVヘッダ) は翻訳しない**。
表示だけ `display-name.ts` の `labelFor()` / `elementLabel()` / `growthLabel()` などを通す。
対訳の正本は `data/name-map-ja.json` (200件)。新キャラの日本語名が無いと **build が落ちる** (仕様)。

---

## ⚠ 触るときに気をつけること

- **エンジン (`calculator/*.py`) とデータ (`data/parsed_*.json`) は無改変**。
  精度と上流同期の生命線。CI の `context.snapshot` (ゴールデン29件) が守っている
- **localStorage のキーは `nikke-` 接頭辞を必ず維持**。
  GitHub Pages では本家しりすこPAD (`/shirisu-pad/`) と**同一オリジン**なので localStorage を共有する。
  現在の衝突はゼロ (PAD=`shirisuPad.*`/`shirisuko_*`、こちら=`nikke-*`)
- **`data-*` 属性の衝突に注意**。`data-roster-empty` を足したらキャラ検索の既存要素と衝突し、
  検索側の処理がマイロスターのパネルを操作する事故があった (→ `data-myroster-*` に改名)
- **取込のマージ規則を壊さない** (`roster-merge.ts`)。
  育成6項目は取込値で上書き / 操作4項目 (速射・バースト運用など) は維持。
  オーバーロード・装備・スキルは**来たキーだけ重ねる** (列が一部だけの CSV で残りを消さないため)。
  分類漏れは型エラーになるよう固定してある
- 優越コードの対応表 `BEATS` の**正本は `calculator/damage.py` の `_CODE_ADVANTAGE`**。
  テストがエンジンのソースを読んで一致を確認する

---

## 🔜 残っている宿題

- [ ] **BlaBlaLINK プロキシのデプロイ** — ワンボタン更新の実動作にはこれが要る。
      `worker/README.md` の手順で Cookie を取り、`wrangler secret put BLABLA_COOKIE` → `wrangler deploy` →
      `site/.env.production` の `VITE_BLABLA_PROXY` を書き換える。
      **Cookie は期限切れで手動更新が必要 = 運用負債**。未デプロイでもサーバースキャン以外は動く
- [ ] **敵防御力が暫定値** (上流既定 31,784)。実測後に `site/src/union-bosses.ts` を更新
- [ ] **レポート画像 (`report.ts`) が暗色のまま**。共有用の PNG なので単体では成立するが、
      ライトテーマと揃えるなら canvas 用のライト配色が要る (タイムラインは対応済み)
- [ ] データ由来ラベルの日本語化 — ハーモニーキューブ名・上級モードの数値名・バフ名。
      `site/public/settings.json` を作る `export-settings.py` 由来
- [ ] 自作ニケの LLM プロンプトが韓国語 (`custom-nikke.ts`)。出力 JSON の列挙値はエンジン契約で韓国語必須
- [ ] enikk (ソロ順位取込) はタブ非表示のまま。関連テスト2件が `it.skip`
- [ ] 「ドレイク：グレートヴィラン」の訳が未確認 (公式日本語名を見ていない)

---

## 🖥 PC ごとの注意

- **職場PC (Windows)**: 全ファイル CRLF (autocrlf)。スクリプトで一括置換するときは
  **CRLF を LF に正規化してから照合**する。生の NUL を書くと git がバイナリ扱いして差分が読めなくなる
  (`element-plans.ts` で一度やった)
- **自宅PC (Mac)**: フォルダ名に日本語が入る場合、テストのパス解決に注意
  (本家PADで `fileURLToPath` に直した前例あり)
- **Codex 併用フラグは PC ごと**。このリポジトリでは明示レビュー方式
  (実装 → commit → codex:codex-rescue へ依頼 → 指摘対応 → push)。
  **監査を通さない push は禁止**

## 🚀 始め方

```bash
git clone https://github.com/Furu1018/shirisuko-squad.git   # 初回
cd shirisuko-squad/site && npm ci

npm run dev        # 開発サーバ (/shirisuko-squad/ を開く)
npm test -- --run  # vitest (513件)
npm run build      # tsc --noEmit + vite build (prebuild で Python が要る)
```

見た目を確認したいときは `npm run build && npx vite preview --port 4173` を立てて、
Playwright で各タブを撮ると早い (職場PCでは `scratchpad/squad-shots.mjs` を使った)。
