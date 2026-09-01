# しりすこスクワッド (β)

NIKKE の育成状態から**理論ダメージ**を出すスカッドシミュレーターの日本語版です。
韓国製の計算機 [moris-kr/nikke-calc](https://github.com/moris-kr/nikke-calc) (原作エンジン: [Jgaram/nikke-calc](https://github.com/Jgaram/nikke-calc)、MIT) を
**エンジン・データ無改変**で日本語化し、しりすこ圏のユニオンレイド向けに仕立て直したものです。

公開先: <https://furu1018.github.io/shirisuko-squad/>

> **β 版です。** 今週末 (2026-09-04〜) の第44回ユニオンレイドに間に合わせるために最小構成で公開しています。
> 下の「暫定事項」を読んでから使ってください。

## できること

- 限界突破・スキルレベル・オーバーロード・ハーモニーキューブ・コレクション・コントロールを個別設定し、
  1/60 秒刻みの戦闘シミュレーションで 5 人スカッドの総ダメージ・秒間ダメージ・タイムラインを出す
- **第44回ユニオンレイドのボス 5 体をプリセット**で呼び出す (ユニオンタブのボス枠 / 計算タブの戦闘条件)
- **ユニオンタブ** (既定ビュー): ボス 5 枠 × デッキ 3 枠。「自分の 3 凸をどの属性に振るか」を比較する
- Blablalink の「マイニケ」公開プロフィール、または Letsdoro 形式 CSV から実際の育成状態を取り込む
- 編成 / 戦闘条件 / ユニオン盤面を共有コード (`NK2-` / `NK3-` / `NK4-`) でやり取りする — **原作サイトと互換**
- 結果を PNG レポート・CSV に書き出す

計算はすべてブラウザ内 (Pyodide 上の Python エンジン + Web Worker) で完結し、サーバーにデータを送りません。

## 原作との関係 / 上流との差分

| 項目 | 方針 |
|---|---|
| 計算エンジン (`calculator/*.py`)・データ (`data/parsed_*.json` 等) | **無改変**。精度・挙動は原作と同一。CI の `context.snapshot` (ゴールデン 29 件) で担保 |
| キャラ名・属性・クラス・企業などの内部キー | 上流と同じ**韓国語のまま**。共有コード・ロスター照合・保存値の互換を保つため |
| 表示 | `site/src/display-name.ts` の `labelFor()` / `elementLabel()` / `growthLabel()` などで**表示時だけ日本語化** |
| キャラ名の対訳 | `data/name-map-ja.json` (韓国語キー → 日本語) が正本。`site/scripts/sync-runtime.mjs` が catalog に `displayName` を焼き込み、欠落・余剰・重複・空白差はビルドで落ちる |
| UI 文言 | 直接日本語に置換 (i18n 基盤は作らない) |
| ソロレイド向け機能 (enikk ランキング取込・韓国コミュニティリンク・韓国語お知らせ) | 非表示 / 日本向けに差し替え |
| 共有サーバー (`worker-share/`) | 未導入 (`VITE_SHARE_API` 空で機能ごと非表示) |

### 上流を取り込む手順

1. `moris-kr/nikke-calc` の差分を確認し、`calculator/` `data/` `context/` `scraper/nikke_scraped.json` `image/` をそのまま上書き
2. `site/src/` は表示文字列を日本語化しているので、機械的に上書きせず差分を手で当てる
   (内部キー・共有コード・ロスター照合に触れていないか、上流の変更点を確認する)
3. 新キャラが増えたら `data/name-map-ja.json` に日本語名を追加 — 無いと `npm run build` が失敗する (仕様)
4. `cd site && npm test -- --run && npm run build`

## 暫定事項 (β)

- **敵防御力は暫定値** (上流既定 31,784)。実測後に `site/src/union-bosses.ts` を更新する。属性・編成の比較 (相対値) には影響しない
- 一部の**データ由来ラベルは韓国語のまま**: ハーモニーキューブ名 (`재장` など)、上級モードの数値名、バフ名、Blablalink 未対応の注記など
  (`site/public/settings.json` を生成する `export-settings.py` 由来。表示対訳を順次追加する)
- 自作ニケ用の LLM プロンプト (`custom-nikke.ts`) は韓国語のまま。出力 JSON の列挙値 (属性・クラス・企業・スキル種別) はエンジン契約で韓国語必須
- Blablalink 連携 (`worker/`) は運営者のセッション Cookie を Cloudflare Worker のシークレット `BLABLA_COOKIE` に入れる方式で、
  **Cookie が切れたら手動更新が必要** (`worker/README.md`)。未デプロイの間は `site/.env.production` の `VITE_BLABLA_PROXY` を空にしておく — ユニオンタブは表示されたまま、サーバースキャンと計算タブの Blablalink 連携ボタンだけが隠れ、直接取得 (コンソールスニペット) / CSV / 手入力で使える
- ソースコード中のコメントは大部分が上流の韓国語のまま (表示に出ないため後回し)

## 権利表記・削除ポリシー

- コード: MIT (原作 Jgaram / moris-kr の著作権表示を `LICENSE` に維持)
- 『勝利の女神：NIKKE』のキャラクター名・画像・ゲームデータの権利は SHIFT UP / Level Infinite に帰属します。
  本サイトは非公式のファンメイドツールで、収益化していません
- キャラクター画像 (`image/`) は上流由来のゲームアセットです。**権利者から削除要請があった場合は速やかに削除します**
  (しりすこPAD / GB と同じ方針)。連絡は GitHub Issues へ

## 構成

- `calculator/`, `context/`, `data/`: 計算エンジンと元データ (上流のまま)
- `data/name-map-ja.json`: キャラ名の日本語対訳 (このリポジトリ固有)
- `site/`: Vite + TypeScript の静的 Web アプリ
  - `src/display-name.ts`: 表示名・属性・クラス・企業・突破ラベルの対訳 (内部キーは翻訳しない)
  - `src/union-bosses.ts`: 今シーズンのボスプリセット (NK3 条件コードに変換)
  - `public/calculator.worker.js`: 計算を UI と分離する Web Worker (Pyodide)
  - `pybridge/bridge.py`: Web リクエストを Python エンジン呼び出しに変換するブリッジ
  - `scripts/sync-runtime.mjs`: エンジン・データ・catalog・画像を Web ランタイムに同期 (+ 対訳検証)
- `worker/`: Blablalink 取得プロキシ (Cloudflare Workers、サイトとは別デプロイ)
- `.github/workflows/pages.yml`: テスト・ビルド・GitHub Pages デプロイ (`main` push)

## ローカル実行

Node.js 22 以上と Python 3 が必要です。

```bash
cd site
npm install
npm run dev
```

Vite が表示したローカルアドレスの `/shirisuko-squad/` に接続します。初回計算時に Pyodide をダウンロードするためインターネット接続が必要です。

## 検証

```bash
cd site
npm test -- --run
python3 scripts/test-bridge.py
npm run build
```

エンジンを含む全体検証 (CI と同じ):

```bash
python3 -m unittest discover -s calculator -p 'test_*.py' -v
python3 calculator/damage.py
python3 -m context.doclint
python3 -m context.snapshot
```

## 今後 (レイド後)

- しりすこPAD との連携: 理論値をメンバーの模擬・実測に並記し、達成率と育成アドバイスに使う (別リポジトリの作業)
- データ由来ラベルの日本語化、敵防御力の実測反映、上流の継続取り込み
