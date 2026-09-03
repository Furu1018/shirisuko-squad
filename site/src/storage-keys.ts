// この道具が localStorage に置く鍵の**一覧**。
//
// GitHub Pages では本家しりすこPAD と**同一オリジン** (furu1018.github.io) なので
// localStorage を共有する。だから鍵は必ず `nikke-` で始める — これが衝突よけになっている
// (PAD 側は `shirisuPad.*` / `shirisuko_*`)。
//
// **「完全初期化」は OWNED と LEGACY の両方を消す。** 機能を消したときに、
// 利用者の端末に残る古い鍵を消し忘れると、初期化したつもりで残り続ける
// (実際、削除した機能の鍵が3種類残っていた — Codex 指摘)。

/** いま使っている鍵。増やしたらここにも足す。 */
export const OWNED_KEYS = [
  'nikke-state-v1',            // 編成・戦闘条件・デッキ
  'nikke-roster-v1',           // 取り込んだ育成 (ロスター)
  'nikke-sync-v1',             // 取込の記録 (いつ・どこから・何名)
  'nikke-plans-v1',            // 保存した候補 (属性ごと)
  'nikke-raid-board-v1', 'nikke-bosses-v1', 'nikke-templates-v1',       // 3凸ボードの盤面
  'nikke-favorites-v1',        // よく使うニケの印
  'nikke-board-skip-import-v1', // 「取り込まずに試す」を押したか
  'nikke-parallel-v1',         // 並列計算の台数
  'nikke-detail-damage-v1',    // ダメージを1の位まで出すか
  'nikke-calc-results',        // 計算結果のキャッシュ (ResultCache)
] as const;

/**
 * もう無い機能が残していく鍵。**消す以外に使わない。**
 * 機能を削除するときは、その鍵をここへ移すこと。
 */
export const LEGACY_KEYS = [
  'nikke-enikk-v1',            // enikk (ソロ順位取込) — 2026-09-02 削除
  'nikke-enikk-v2',
  'nikke-enikk-excluded-v1',
  'nikke-custom-v1',           // 自作ニケ — 2026-09-02 削除
  'nikke-notice-seen',         // 更新履歴 — 2026-09-02 削除
] as const;

/** 完全初期化で消す鍵。 */
export const ALL_KEYS: readonly string[] = [...OWNED_KEYS, ...LEGACY_KEYS];
