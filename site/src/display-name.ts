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

// 属性コードの内部キーも韓国語のまま (エンジン契約・共有コードの索引)。表示だけここで変換する。
const ELEMENT_LABELS: Record<string, string> = {
  풍압: '風圧', 수냉: '水冷', 작열: '灼熱', 전격: '電撃', 철갑: '鉄甲',
};

/** 属性コード (内部キー) → 日本語表示。知らないコードはそのまま返す。 */
export function elementLabel(code: string): string {
  return ELEMENT_LABELS[code] ?? code;
}

/**
 * データ由来の限界突破ラベル (settings.json の growthOptions: 명함 / N돌 / 코강 N) → 日本語。
 * データ側は上流と同じ韓国語のまま — 表示時だけここでパターン変換し、パターン外はそのまま返す。
 */
export function growthLabel(label: string): string {
  if (label === '명함') return '無凸';
  const limitBreak = label.match(/^(\d+)돌$/);
  if (limitBreak) return `${limitBreak[1]}凸`;
  const core = label.match(/^코강 (\d+)$/);
  if (core) return `コア${core[1]}`;
  return label;
}

// クラスの内部キーも韓国語のまま (catalog の値・フィルタ照合)。表示だけここで変換する。
const CLASS_LABELS: Record<string, string> = {
  화력형: '火力型', 방어형: '防御型', 지원형: '支援型',
};

/** クラス (内部キー) → 日本語表示。知らないキーはそのまま返す。 */
export function labelForClass(code: string): string {
  return CLASS_LABELS[code] ?? code;
}

// 企業の内部キーも韓国語のまま (catalog の値・フィルタ照合)。表示だけここで変換する。
// 「어브노말」は catalog、「어브노멀」は一部データの表記ゆれ — どちらも同じ表示にする。
const MAKER_LABELS: Record<string, string> = {
  엘리시온: 'エリシオン', 미실리스: 'ミシリス', 테트라: 'テトラ',
  필그림: 'ピルグリム', 어브노말: 'アブノーマル', 어브노멀: 'アブノーマル',
};

/** 企業 (内部キー) → 日本語表示。知らないキーはそのまま返す。 */
export function labelForMaker(code: string): string {
  return MAKER_LABELS[code] ?? code;
}
