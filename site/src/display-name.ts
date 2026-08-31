// 表示名 (日本語) の一元管理 — しりすこスクワッド (日本語版) の追加モジュール。
//
// 内部キー (catalog の `name`・エンジンへのリクエスト・共有コード・localStorage・ロスター照合) は
// 上流と同じ**韓国語の正式名のまま**。画面に出すときだけ labelFor() を通して日本語にする。
// 対訳の正本は `data/name-map-ja.json` (韓国語キー → 日本語表示名)。sync-runtime.mjs が
// catalog.json の `displayName` に焼き込み、欠落・余剰・重複はビルド時に落とす。
import type { CharacterMeta } from './types';

const map = new Map<string, string>();

/** 起動時に catalog から表示名辞書を作る (main.ts が一度だけ呼ぶ) */
export function setDisplayNames(catalog: readonly CharacterMeta[]): void {
  map.clear();
  for (const meta of catalog) {
    if (meta.displayName) map.set(meta.name, meta.displayName);
  }
}

/** 内部キー (韓国語正式名) → 日本語表示名。辞書に無ければそのまま返す (自作ニケ等) */
export function labelFor(name: string): string {
  return map.get(name) ?? name;
}
