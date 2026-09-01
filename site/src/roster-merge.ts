// 取込 (BlaBlaLINK / CSV) とキャラ設定のマージ規則 — しりすこスクワッド。
//
// キャラ設定 (`CharacterOverrides`) には性格の違う2種類が同居している。
//
//   育成の実態  … 突破・スキルLv・オーバーロード・キューブ・コレクション・装備
//                 → ゲーム側の状態。**取込が正本**なので、更新のたびに上書きする
//   操作の方針  … 速射/ホールド/リロード/遮蔽・バースト運用・上級モードの追加数値・武器モード切替
//                 → 人がこの計算機で決めたこと。取込には含まれないので**必ず残す**
//
// この2つは重ならないので、規則は「育成は取込で置き換え、操作はそのまま」で足りる。
//
// なぜ要るか: ロスター (`nikke-roster-v1`) は取込専用の層で、手動編集は入らない。
// 一方デッキ側のキャラ設定には、枠に置いた時点のロスターのコピーと手動の操作設定が同居する。
// 従来の `applyRosterToDecks()` は「まだ設定を持たないキャラだけ」を埋めていたので、
// **再取込しても編成に入れているキャラの育成値が古いまま**だった。かといって丸ごと
// 上書きすると操作設定が消える。だから項目単位で混ぜる。
import type { CharacterOverrides } from './types';

/** 取込 (BlaBlaLINK / CSV) が値を持っている項目。更新時は取込側で置き換える。 */
export const GROWTH_FIELDS = [
  'growthStage', 'skillLevels', 'overload', 'cube', 'collection', 'equipLevels',
] as const satisfies readonly (keyof CharacterOverrides)[];

/** 取込には含まれず、人がこの計算機で決める項目。更新時も残す。 */
export const OPERATION_FIELDS = [
  'control', 'burst', 'manualStats', 'weaponModeSwapAt',
] as const satisfies readonly (keyof CharacterOverrides)[];

const clone = <T>(value: T): T =>
  (Array.isArray(value) ? [...value] : (value && typeof value === 'object' ? { ...value } : value)) as T;

/**
 * 取込値と既存設定を項目単位で混ぜる。
 *
 * - 育成6項目: `imported` にある項目だけ置き換える。取込が持たない項目 (CSV はキューブを持たない等) は
 *   既存の値を残す — 「取込に無い = 既定に戻す」にすると、CSV 更新のたびにキューブが消える
 * - 操作4項目: 常に `existing` を残す
 *
 * `existing` が無ければ取込値のコピーをそのまま返す。
 */
export function mergeImportedOverride(
  imported: CharacterOverrides,
  existing?: CharacterOverrides,
): CharacterOverrides {
  const out: CharacterOverrides = {};
  // 既存を土台にする (育成・操作とも。育成はこのあと取込値で上書きされる)
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (value !== undefined) Object.assign(out, { [key]: clone(value) });
  }
  for (const field of GROWTH_FIELDS) {
    const value = imported[field];
    if (value !== undefined) Object.assign(out, { [field]: clone(value) });
  }
  return out;
}

/** 1デッキぶんのキャラ設定。`decks` の形に依存しないよう最小限だけ受け取る。 */
export interface MergeableDeck {
  squad: string[];
  characters: Record<string, CharacterOverrides>;
}

/**
 * 取込直後に、各デッキの編成メンバーへ新しい育成値を配る。
 *
 * - 編成に入っているキャラだけが対象 (枠に無いキャラの設定は触らない)
 * - 取込に無いキャラ (未所持・自作ニケ・計算機が知らないキャラ) はそのまま
 * - 操作設定は残る
 *
 * @returns 育成値が実際に変わったキャラ名 (重複なし)。更新件数の表示に使う
 */
export function applyImportedRoster(
  roster: Record<string, CharacterOverrides>,
  decks: readonly MergeableDeck[],
): string[] {
  const touched = new Set<string>();
  for (const deck of decks) {
    for (const name of deck.squad) {
      if (!name) continue;
      const imported = roster[name];
      if (!imported) continue;                       // 取込に無い = 触らない
      const before = deck.characters[name];
      const merged = mergeImportedOverride(imported, before);
      if (!before || !sameGrowth(before, merged)) touched.add(name);
      deck.characters[name] = merged;
    }
  }
  return [...touched];
}

/** 育成6項目が同じか (操作設定の違いは見ない)。更新件数を数えるために使う。 */
function sameGrowth(left: CharacterOverrides, right: CharacterOverrides): boolean {
  return GROWTH_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}
