// ユニオンレイド ボスプリセット — しりすこスクワッド (日本語版) の追加モジュール。
//
// 今シーズンのボス5体を「戦闘条件コード (NK3-…)」として一発で呼び出すための表。
// エンジンには一切手を入れない — 既存の encodeBattleCode() に敵コード・敵防御力を
// 流し込むだけなので、上流の条件コードと完全互換 (ユニオン盤面の NK4 にもそのまま載る)。
//
// 属性は内部キー (韓国語) のまま持つ。画面表示は elementLabel() を通す。
// 敵防御力はまだ実測がないため上流の既定値 31,784 を暫定使用 — 比較用途 (相対値) には
// 影響しないが、絶対値は実測後に差し替える (README「暫定事項」参照)。
import { decodeBattleCode, encodeBattleCode } from './share-code';
import type { BattleSettings } from './types';

export interface UnionBoss {
  /** 画面に出す名前 (日本語)。NK4 盤面コードのボス名にもそのまま入る */
  name: string;
  /** 敵コード = ボスの属性。内部キー (韓国語) — エンジン契約・共有コードの索引 */
  elementCode: BattleSettings['enemyCode'];
  /** 敵防御力。null なら現在の条件パネルの値を使う */
  enemyDef: number | null;
}

export interface UnionSeason {
  label: string;
  /** 開始日 (JST)。表示用 */
  start: string;
  note: string;
  bosses: UnionBoss[];
}

/** 暫定の敵防御力。上流 BATTLE_DEFAULTS.enemyDef と同じ値 */
export const PROVISIONAL_ENEMY_DEF = 31_784;

export const UNION_SEASON: UnionSeason = {
  label: '第44回ユニオンレイド',
  start: '2026-09-04',
  note: '敵防御力は暫定値 (上流既定 31,784)。実測後に更新予定 — 属性・編成の比較には影響しません。',
  bosses: [
    { name: 'レイタンス', elementCode: '전격', enemyDef: PROVISIONAL_ENEMY_DEF },
    { name: 'トゥームストーン', elementCode: '작열', enemyDef: PROVISIONAL_ENEMY_DEF },
    { name: 'モダニア', elementCode: '풍압', enemyDef: PROVISIONAL_ENEMY_DEF },
    { name: 'リビルドビッグトルソー', elementCode: '수냉', enemyDef: PROVISIONAL_ENEMY_DEF },
    { name: 'アニヒリオ', elementCode: '철갑', enemyDef: PROVISIONAL_ENEMY_DEF },
  ],
};

/**
 * ボスの戦闘条件。今の条件パネル (`base`) を土台に、敵コードと敵防御力だけ差し替える —
 * 戦闘時間・コア・回避区間などユーザーが調整した値は残す。
 */
export function bossBattle(boss: UnionBoss, base: BattleSettings): BattleSettings {
  return {
    ...base,
    enemyCode: boss.elementCode,
    enemyDef: boss.enemyDef ?? base.enemyDef,
  };
}

/** ボスの NK3 条件コード。ユニオン盤面のボス枠にそのまま貼れる */
export function bossBattleCode(boss: UnionBoss, base: BattleSettings): string {
  return encodeBattleCode(bossBattle(boss, base));
}

/**
 * 土台が NK3 コードで渡ってくる場所 (ユニオン盤面) 用。コードを解釈して敵コード・敵防御力だけ
 * 差し替え、また NK3 に戻す。コンソール・シンクロは NK3 に載らないので、エンコードが読まない
 * ダミーで型だけ満たす。壊れたコードは既定条件として扱う (decodeBattleCode と同じ寛容さ)。
 */
export function bossBattleCodeFrom(boss: UnionBoss, baseCode: string): string {
  const dummy = { synchroLevel: 1, console: { common_level: 0, class_level: {}, company_level: {} } };
  let padded: BattleSettings;
  try {
    padded = { ...decodeBattleCode(baseCode), ...dummy };
  } catch {
    // 既定条件 = 上流 BATTLE_DEFAULTS と同値。「既定と同じ項目は載せない」規則により、
    // これをエンコードすると最短コードになり、デコード側が全項目を既定で埋める
    padded = { ...FALLBACK_SHARE, ...dummy };
  }
  return bossBattleCode(boss, padded);
}

/** decodeBattleCode が失敗したときの土台。share-code.ts の BATTLE_DEFAULTS と同じ値 */
const FALLBACK_SHARE: Omit<BattleSettings, 'console' | 'synchroLevel'> = {
  duration: 180,
  enemyDef: PROVISIONAL_ENEMY_DEF,
  enemyCode: '',
  coreEnabled: false,
  corePx: 52,
  hasParts: false,
  seed: 42,
  optimalRangeWeapons: [],
  normalHitCoeff: {},
  immuneWindows: [],
  elementWindows: [],
  rngMode: 'expected',
  immuneBlocksBurst: true,
  burstRegenTime: 2,
  burstReaction: 0.05,
};
