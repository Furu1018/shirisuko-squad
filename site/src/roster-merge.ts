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

// `CharacterOverrides` にフィールドを足したら、育成・操作のどちらかに必ず入れる。
// 入れ忘れると「取込が更新しない項目」に静かに落ちるので、**ここで型エラーにして気づかせる**。
// (`satisfies` は各要素がキーであることしか見ないので、網羅性は別に固定する)
type Classified = (typeof GROWTH_FIELDS)[number] | (typeof OPERATION_FIELDS)[number];
type Unclassified = Exclude<keyof CharacterOverrides, Classified>;
// 未分類が残っていると `never` でなくなり、この行がコンパイルエラーになる
const _allFieldsClassified: Unclassified extends never ? true : never = true;
void _allFieldsClassified;

// 深いコピー。`control.tap_fire` のように入れ子があるので、浅いコピーだと
// 取込元やデッキ同士で内側のオブジェクトを共有してしまう
// (片方のデッキで速射の数値を触るともう片方も動く)。
const clone = <T>(value: T): T =>
  (value && typeof value === 'object' ? structuredClone(value) : value);

/**
 * 育成項目のうち**中身がキーの集まり**のもの。項目ごと差し替えるのではなく、
 * 来たキーだけを重ねる。
 *
 * 理由: CSV は列単位で欠ける。オーバーロード9種のうち「有利」列しか無い CSV を
 * 取り込んだとき、項目ごと差し替えると残り8種が消える。装備も部位ごとに欠けうる。
 * 「来た分だけ更新して、来なかった分は残す」が取り込み直しの正しい意味になる。
 */
const MERGE_BY_KEY = ['overload', 'equipLevels', 'skillLevels'] as const;

/** 中身が一体で意味を持つ育成項目。半端に混ぜると壊れるので、来たら丸ごと差し替える。 */
const REPLACE_WHOLE = ['growthStage', 'cube', 'collection'] as const;

// 育成6項目は「キーごとに重ねる」か「丸ごと差し替える」のどちらかに必ず属する。
// 分け忘れると静かに更新されない項目ができるので、型で気づかせる。
type GrowthField = (typeof GROWTH_FIELDS)[number];
type Handled = (typeof MERGE_BY_KEY)[number] | (typeof REPLACE_WHOLE)[number];
const _allGrowthHandled: Exclude<GrowthField, Handled> extends never ? true : never = true;
void _allGrowthHandled;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * 取込値と既存設定を項目単位で混ぜる。
 *
 * - 育成6項目のうちキーの集まり (オーバーロード・装備・スキル) は**来たキーだけ**を重ねる
 * - 残りの育成項目 (突破・キューブ・コレクション) は来たら丸ごと差し替える
 * - 取込が持たない項目は既存の値を残す — 「取込に無い = 既定に戻す」にすると、
 *   CSV 更新のたびにキューブや装備が消える
 * - 操作4項目 (速射・バースト運用など) は常に `existing` を残す
 *
 * `existing` が無ければ取込値のコピーをそのまま返す。
 */
export function mergeImportedOverride(
  imported: CharacterOverrides,
  existing?: CharacterOverrides,
): CharacterOverrides {
  const out: CharacterOverrides = {};
  // 既存を土台にする (育成・操作とも。育成はこのあと取込値で重ねられる)
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (value !== undefined) Object.assign(out, { [key]: clone(value) });
  }
  for (const field of REPLACE_WHOLE) {
    const value = imported[field];
    if (value !== undefined) Object.assign(out, { [field]: clone(value) });
  }
  for (const field of MERGE_BY_KEY) {
    const value = imported[field];
    if (value === undefined) continue;
    const before = out[field];
    Object.assign(out, {
      [field]: isRecord(value) && isRecord(before)
        ? { ...before, ...clone(value) }   // 来たキーだけ重ねる
        : clone(value),
    });
  }
  return out;
}

/**
 * 取込結果をロスター全体へ重ねる。
 *
 * **取込に無いキャラの行は消さない。** CSV は一部のキャラしか含まないことがあり、
 * 丸ごと差し替えると、その CSV に載っていないキャラの育成値が既定に戻る
 * (属性別編成の比較はロスターを見るので、保存した案の中身まで静かに劣化する)。
 * NIKKE ではニケを失わないので、残しておいて困ることもない。
 */
export function mergeImportedRoster(
  existing: Record<string, CharacterOverrides>,
  imported: Record<string, CharacterOverrides>,
): Record<string, CharacterOverrides> {
  const out: Record<string, CharacterOverrides> = {};
  for (const [name, override] of Object.entries(existing)) out[name] = clone(override);
  for (const [name, override] of Object.entries(imported)) {
    out[name] = mergeImportedOverride(override, existing[name]);
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
  /**
   * 今回の取込に**実際に含まれていた**キャラ名。渡すとこの範囲だけを配る。
   *
   * ロスターは取込に無いキャラの行も残すようになったので、ロスター全体を配ると
   * 「今回来ていないキャラ」のデッキ側の値まで古いロスター値で塗り替えてしまう
   * (手で直した育成値が、関係ない CSV を取り込んだだけで戻る)。
   */
  onlyNames?: Iterable<string>,
): string[] {
  const allowed = onlyNames ? new Set(onlyNames) : null;
  const touched = new Set<string>();
  for (const deck of decks) {
    for (const name of deck.squad) {
      if (!name) continue;
      if (allowed && !allowed.has(name)) continue;   // 今回の取込に無い = 触らない
      const imported = roster[name];
      if (!imported) continue;
      const before = deck.characters[name];
      const merged = mergeImportedOverride(imported, before);
      if (!before || !sameGrowth(before, merged)) touched.add(name);
      deck.characters[name] = merged;
    }
  }
  return [...touched];
}

/**
 * 育成6項目が同じか (操作設定の違いは見ない)。更新件数を数えるために使う。
 *
 * キーの挿入順で差が出ないよう、比較の前に並べ替える — 取込元 (CSV / Blablalink) で
 * オーバーロードのキー順が違うため、素の JSON 文字列比較だと中身が同じでも「更新」と数えてしまう。
 */
function sameGrowth(left: CharacterOverrides, right: CharacterOverrides): boolean {
  return GROWTH_FIELDS.every((field) => stableJson(left[field]) === stableJson(right[field]));
}

/** キー順に依存しない JSON 文字列。値の比較にだけ使う。 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return val;
    return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    ));
  });
}
