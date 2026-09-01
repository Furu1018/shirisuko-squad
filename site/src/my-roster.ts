// マイロスター — 「自分の育成状況が一目で分かる」ための集計。しりすこスクワッド。
//
// 取込 (BlaBlaLINK / CSV) が入れたロスターを、属性ごと・育成の穴ごとに読み替える。
// 画面を持たない純ロジックにしてあるのは、属性別編成の候補づくり (v2) からも同じ判定を
// 使い回すため — 「何を持っていて、どこが伸びしろか」の定義を1箇所に閉じ込める。
//
// 判定の芯: **所持しているか** は「ロスターに行があるか」で決める。
// 取込は所持ニケだけを返すので、行の有無がそのまま所持の有無になる。
import { NO_CUBE } from './character-settings';
import type { CharacterMeta, CharacterOverrides } from './types';

/** 1人ぶんの育成の読み取り結果。 */
export interface RosterEntry {
  name: string;
  /** 属性コード (内部キー・韓国語)。表示は elementLabel を通す。 */
  elementCode: string;
  burstStage: string;
  /** 限界突破 + コア強化 の合計段階。取込に無ければ null。 */
  growthStage: number | null;
  /** スキル3種の合計。3つ揃っていなければ null。 */
  skillTotal: number | null;
  /** スキルの最低値。「どれか1つだけ低い」を拾う。 */
  skillMin: number | null;
  /** オーバーロードの主要3種 (優越コード・攻撃力・最大装弾)。 */
  overload: { element: number; atk: number; ammo: number };
  cubeName: string | null;
  /** コレクション段階 (SR15 等)。未装着は '없음'。 */
  collectionStage: string | null;
  /** お気に入りの星 (0〜3)。 */
  favorite: number;
  /** 戦闘力。読めていなければ null。並べ替えにだけ使う。 */
  power: number | null;
}

export interface RosterSummary {
  /** 取込で入った人数。 */
  owned: number;
  /** 属性ごとの所持数 (内部キー → 人数)。 */
  byElement: Record<string, number>;
  /** バースト段階ごとの所持数。 */
  byBurst: Record<string, number>;
  /** スキルが 10/10/10 に達している人数。 */
  maxedSkills: number;
  /** キューブを着けていない人数。 */
  noCube: number;
}


/** ロスターの1行を読みやすい形に。取込が持たない項目は null のままにして「不明」と「0」を混同しない。 */
export function readEntry(
  name: string,
  override: CharacterOverrides,
  meta: CharacterMeta | undefined,
  power?: number,
): RosterEntry {
  const skills = override.skillLevels;
  const levels = skills ? [skills['1'], skills['2'], skills['3']] : null;
  const overload = override.overload ?? {};
  return {
    name,
    elementCode: meta?.elementCode ?? '',
    burstStage: meta?.burstStage ?? '',
    growthStage: override.growthStage ?? null,
    skillTotal: levels ? levels.reduce((sum, level) => sum + level, 0) : null,
    skillMin: levels ? Math.min(...levels) : null,
    overload: {
      element: overload.element_bonus ?? 0,
      atk: overload.atk_pct ?? 0,
      ammo: overload.max_ammo_pct ?? 0,
    },
    cubeName: override.cube?.name ?? null,
    collectionStage: override.collection?.stage ?? null,
    favorite: override.collection?.favorite ?? 0,
    power: typeof power === 'number' ? power : null,
  };
}

/** ロスター全体を読む。カタログに無い名前 (自作ニケ等) も落とさず、属性は空で返す。 */
export function readRoster(
  roster: Record<string, CharacterOverrides>,
  catalog: readonly CharacterMeta[],
  power: Record<string, number> = {},
): RosterEntry[] {
  const metaByName = new Map(catalog.map((meta) => [meta.name, meta]));
  return Object.entries(roster).map(([name, override]) =>
    readEntry(name, override, metaByName.get(name), power[name]));
}

/** 所持の内訳。「電撃が薄い」「3バが足りない」を数字で見せるための集計。 */
export function summarize(entries: readonly RosterEntry[]): RosterSummary {
  const byElement: Record<string, number> = {};
  const byBurst: Record<string, number> = {};
  let maxedSkills = 0;
  let noCube = 0;
  for (const entry of entries) {
    if (entry.elementCode) byElement[entry.elementCode] = (byElement[entry.elementCode] ?? 0) + 1;
    if (entry.burstStage) byBurst[entry.burstStage] = (byBurst[entry.burstStage] ?? 0) + 1;
    if (entry.skillTotal === 30) maxedSkills += 1;
    if (entry.cubeName === NO_CUBE || entry.cubeName === null) noCube += 1;
  }
  return { owned: entries.length, byElement, byBurst, maxedSkills, noCube };
}

/** 並べ替えの軸。既定は戦闘力 — 「誰が主力か」が最初に知りたいこと。 */
export type SortKey = 'power' | 'growth' | 'skill' | 'element' | 'name';

/**
 * 並べ替える。値が無い (取込が持たない) 行は常に後ろへ回す —
 * 「不明」が上位に紛れると、伸びしろの一覧として読めなくなる。
 */
export function sortEntries(
  entries: readonly RosterEntry[],
  key: SortKey,
  labelOf: (name: string) => string = (name) => name,
): RosterEntry[] {
  const byName = (a: RosterEntry, b: RosterEntry) =>
    labelOf(a.name).localeCompare(labelOf(b.name), 'ja');
  const desc = (pick: (entry: RosterEntry) => number | null) =>
    (a: RosterEntry, b: RosterEntry) => {
      const left = pick(a);
      const right = pick(b);
      if (left === null && right === null) return byName(a, b);
      if (left === null) return 1;      // 不明は後ろ
      if (right === null) return -1;
      return right - left || byName(a, b);
    };
  const sorted = [...entries];
  switch (key) {
    case 'power': return sorted.sort(desc((entry) => entry.power));
    case 'growth': return sorted.sort(desc((entry) => entry.growthStage));
    case 'skill': return sorted.sort(desc((entry) => entry.skillTotal));
    case 'element': return sorted.sort((a, b) =>
      a.elementCode.localeCompare(b.elementCode) || byName(a, b));
    case 'name': return sorted.sort(byName);
    default: return sorted;
  }
}
