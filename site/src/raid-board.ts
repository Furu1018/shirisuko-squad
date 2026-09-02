// 3凸ボード — ユニオンレイドの3枠を「被りを含めて」まとめて決める盤面。しりすこスクワッド。
//
// ユニオンレイドは **3凸・同じニケは1度だけ**。属性ごとに最大値を出しても、3凸では分け合うので
// その合計には届かない。ここは「どの凸にどのボスを当て、誰を持っていくか」を1枚で決めるための
// 純ロジック。画面は持たない (ui.ts が描く) — 被りの判定・代案の作り方・被りなし最大の探索を
// 1箇所に閉じ込め、テストで固定する。
//
// 候補の土台は属性別編成 (`element-plans.ts`) の案。ボスを選ぶと `counterOf` で有利コードを引き、
// そのコードの案が枠に入る。計算そのものは既存の経路 (requestForDeck → simulate → cache) を
// 画面側が回し、ここには**点数だけ**が渡ってくる。
//
// 保存キーは `nikke-` で始める規約 (本家しりすこPADと同一オリジンで localStorage を共有するため)。
import type { StorageLike } from './cache';
import {
  BEATS, counterOf, plansOf, type ElementPlan, type ElementPlans, type PlanElement,
} from './element-plans';
import type { CharacterOverrides } from './types';
import type { UnionBoss } from './union-bosses';

export const RAID_BOARD_KEY = 'nikke-raid-board-v1';

/** 1日の凸数。ユニオンレイドは3回。 */
export const BOARD_SLOTS = 3;

export interface BoardSlot {
  /** ボス名 (`UNION_SEASON.bosses[].name`)。null = 未設定。 */
  boss: string | null;
  /** 5人ぶんの内部キー (韓国語)。空文字は空き枠。 */
  squad: string[];
  /**
   * 個別設定のスナップショット (案から枠に入れたときのキューブ等)。
   * 入っているニケはこの値で計算し、無いニケはロスターに任せる。
   * 枠のピッカーで手で組んだだけの枠には無い。
   */
  characters?: Record<string, CharacterOverrides>;
}

export interface RaidBoard {
  schemaVersion: 1;
  /** 常に BOARD_SLOTS 個。 */
  slots: BoardSlot[];
}

const emptySlot = (): BoardSlot => ({ boss: null, squad: ['', '', '', '', ''] });

/** スナップショットの形だけ確かめる (中身は validateRequest が見る)。 */
const keepCharacters = (value: unknown): Record<string, CharacterOverrides> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, CharacterOverrides> : undefined;

export const emptyBoard = (): RaidBoard => ({
  schemaVersion: 1,
  slots: Array.from({ length: BOARD_SLOTS }, emptySlot),
});

/** 5枠に正規化する。長すぎれば切り、短ければ空き枠で埋める。 */
export const normalizeSquad = (squad: unknown): string[] => {
  const list = Array.isArray(squad) ? squad : [];
  const out = list.slice(0, 5).map((name) => (typeof name === 'string' ? name : ''));
  while (out.length < 5) out.push('');
  return out;
};

export const isEmptySquad = (squad: readonly string[]): boolean => squad.every((name) => !name);

/**
 * 読む。**知らないボス名の枠は空に戻す** — シーズンが変わって旧盤面が残っていても、
 * 存在しないボスを「選んだまま」表示はしない。
 */
export function loadBoard(
  storage: StorageLike | null | undefined,
  bossNames: readonly string[],
): RaidBoard {
  try {
    const raw = storage?.getItem(RAID_BOARD_KEY);
    if (!raw) return emptyBoard();
    const data = JSON.parse(raw) as Partial<RaidBoard>;
    if (data?.schemaVersion !== 1 || !Array.isArray(data.slots)) return emptyBoard();
    const board = emptyBoard();
    data.slots.slice(0, BOARD_SLOTS).forEach((slot, index) => {
      if (!slot || typeof slot !== 'object') return;
      const boss = typeof slot.boss === 'string' && bossNames.includes(slot.boss) ? slot.boss : null;
      const characters = keepCharacters(slot.characters);
      // ボスが無い枠に顔ぶれだけ残っても意味が無い (ボスを選ぶと案が入り直す)
      board.slots[index] = boss
        ? { boss, squad: normalizeSquad(slot.squad), ...(characters ? { characters } : {}) }
        : emptySlot();
    });
    return board;
  } catch {
    return emptyBoard();   // 壊れていても起動は止めない
  }
}

/** 保存する。**成否を返す** (element-plans と同じ理由 — 失敗を黙って飲むと再読込で消える)。 */
export function saveBoard(storage: StorageLike | null | undefined, board: RaidBoard): boolean {
  try {
    storage?.setItem(RAID_BOARD_KEY, JSON.stringify(board));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/** 枠を差し替えた新しい盤面。元は変えない。 */
export function withSlot(board: RaidBoard, index: number, slot: BoardSlot): RaidBoard {
  return {
    schemaVersion: 1,
    slots: board.slots.map((current, i) => (i === index
      ? {
        boss: slot.boss,
        squad: normalizeSquad(slot.squad),
        ...(keepCharacters(slot.characters) ? { characters: slot.characters } : {}),
      } : current)),
  };
}

export const clearSlot = (board: RaidBoard, index: number): RaidBoard =>
  withSlot(board, index, emptySlot());

// ── 被り ─────────────────────────────────────────────────────────────────

/** 名前 → 使っている枠 (0始まり・昇順)。空き枠は数えない。 */
export function usageOf(board: RaidBoard): Map<string, number[]> {
  const usage = new Map<string, number[]>();
  board.slots.forEach((slot, index) => {
    for (const name of new Set(slot.squad.filter(Boolean))) {
      usage.set(name, [...(usage.get(name) ?? []), index]);
    }
  });
  return usage;
}

export interface Clash {
  name: string;
  /** 使っている枠 (0始まり・昇順)。2つ以上。 */
  slots: number[];
}

/** 2枠以上で使われているニケ。ユニオンレイドでは出せない組み合わせ。 */
export function clashesOf(board: RaidBoard): Clash[] {
  return [...usageOf(board)]
    .filter(([, slots]) => slots.length > 1)
    .map(([name, slots]) => ({ name, slots }));
}

/** 使っている人数 (被りは1人と数える)。 */
export const usedCount = (board: RaidBoard): number => usageOf(board).size;

/** 編成から名前を外す (空き枠にする)。順番は保つ。 */
export function withoutNames(squad: readonly string[], names: Iterable<string>): string[] {
  const drop = new Set(names);
  return normalizeSquad(squad.map((name) => (drop.has(name) ? '' : name)));
}

/**
 * ある枠の被りの代案。相手の枠ごとにまとめる。
 *
 * - `here`  … この枠から被った人を外した編成
 * - `there` … 相手の枠から被った人を外した編成 (= こちらに譲る)
 *
 * どちらが得かは点数を見ないと決まらないので、ここでは編成だけ作る。
 * 画面側が両方を計算して「−0.37億 / −0.68億」を並べる。
 */
export interface ClashOption {
  other: number;
  names: string[];
  here: string[];
  there: string[];
}

export function clashOptionsFor(board: RaidBoard, index: number): ClashOption[] {
  const mine = board.slots[index];
  if (!mine) return [];
  const options: ClashOption[] = [];
  board.slots.forEach((slot, other) => {
    if (other === index) return;
    const theirs = new Set(slot.squad.filter(Boolean));
    const names = [...new Set(mine.squad.filter((name) => name && theirs.has(name)))];
    if (names.length === 0) return;
    options.push({
      other,
      names,
      here: withoutNames(mine.squad, names),
      there: withoutNames(slot.squad, names),
    });
  });
  return options;
}

// ── 候補 ─────────────────────────────────────────────────────────────────

/** そのボスに有利なコードと、そのコードの案。コードが引けなければ案は空。 */
export function candidatesFor(
  boss: UnionBoss, plans: ElementPlans,
): { element: PlanElement | null; plans: ElementPlan[] } {
  const element = counterOf(boss.elementCode);
  return { element, plans: element ? plansOf(plans, element) : [] };
}

export interface Candidate {
  boss: string;
  squad: string[];
  score: number;
  /** 案の個別設定スナップショット。枠に入れるとき一緒に運ぶ。 */
  characters?: Record<string, CharacterOverrides>;
}

/**
 * 空き枠に入れる候補: 全ボス × そのコードの案から、**もう使った人を外した**編成。
 * 外した人がいれば `removed` に残す (画面で「被りを外しました」と言うため)。
 * 全員外れて空になった案は候補にしない。
 */
export interface OpenCandidate {
  boss: UnionBoss;
  planIndex: number;
  squad: string[];
  removed: string[];
  /** 案の個別設定スナップショット。枠に入れるとき一緒に運ぶ。 */
  characters?: Record<string, CharacterOverrides>;
}

export function openSlotCandidates(
  board: RaidBoard, index: number, bosses: readonly UnionBoss[], plans: ElementPlans,
): OpenCandidate[] {
  const used = new Set<string>();
  board.slots.forEach((slot, i) => {
    if (i === index) return;
    for (const name of slot.squad) if (name) used.add(name);
  });
  const out: OpenCandidate[] = [];
  for (const boss of bosses) {
    candidatesFor(boss, plans).plans.forEach((plan, planIndex) => {
      const removed = plan.squad.filter((name) => name && used.has(name));
      const squad = withoutNames(plan.squad, removed);
      if (isEmptySquad(squad)) return;
      out.push({ boss, planIndex, squad, removed, ...(plan.characters ? { characters: plan.characters } : {}) });
    });
  }
  return out;
}

/**
 * 被りなしで合計が最大になる組み合わせ。
 *
 * 候補は「ボス × 案」で高々 5×3 = 15。3つ選ぶ組み合わせは 455 通りなので**総当たり**で足りる
 * (本家PADのソルバーは「メンバー×ボス」の割当で規模が違う)。念のため候補が多すぎるときは
 * 点数の上位だけに絞ってから回す。
 *
 * 3つ被りなしで選べなければ 2つ、1つと落とす。同じボスを2枠で殴るのは構わない —
 * 制約は**同じニケを2度使わない**ことだけ。返す並びは点数の高い順。候補が無ければ空。
 */
export function bestTriple(candidates: readonly Candidate[], slots = BOARD_SLOTS): Candidate[] {
  const LIMIT = 40;
  const pool = candidates
    .filter((candidate) => !isEmptySquad(candidate.squad))
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);
  const members = pool.map((candidate) => new Set(candidate.squad.filter(Boolean)));
  const disjoint = (a: number, b: number): boolean => {
    for (const name of members[a]!) if (members[b]!.has(name)) return false;
    return true;
  };

  for (let size = Math.min(slots, pool.length); size >= 1; size -= 1) {
    let best: number[] | null = null;
    let bestScore = -Infinity;
    const chosen: number[] = [];
    const walk = (start: number, total: number) => {
      if (chosen.length === size) {
        if (total > bestScore) { bestScore = total; best = [...chosen]; }
        return;
      }
      for (let i = start; i < pool.length; i += 1) {
        if (!chosen.every((j) => disjoint(i, j))) continue;
        chosen.push(i);
        walk(i + 1, total + pool[i]!.score);
        chosen.pop();
      }
    };
    walk(0, 0);
    if (best) return (best as number[]).map((i) => pool[i]!);
  }
  return [];
}

/** その属性 (有利コード) で殴る相手のボス。今シーズンはコード1つにボス1体。 */
export function bossForElement(
  element: PlanElement, bosses: readonly UnionBoss[],
): UnionBoss | null {
  return bosses.find((boss) => boss.elementCode === BEATS[element]) ?? null;
}

/**
 * 「属性を3つ選ぶ」(同じ属性を2回以上でもよい — ユニオンレイドは同じボスに複数回凸できる) に対する、
 * **同じニケを2度使わない**割り当て。
 *
 * 枠 i には選んだ属性 i の案しか入れない (bestTriple と違い、属性の組は固定)。
 * 案は属性ごとに高々3つなので総当たりでも 3^3 = 27 通り。点数の合計が最大の組を返す。
 * ある枠にどの案も入れられない (全部他の枠と被る・案が無い) 場合、その枠は null —
 * **他の枠は諦めない** (2枠ぶんだけでも組めた方が役に立つ)。
 */
export function bestForElements(
  candidatesBySlot: ReadonlyArray<readonly Candidate[]>,
): Array<Candidate | null> {
  const slots = candidatesBySlot.length;
  const members = candidatesBySlot.map((list) =>
    list.map((candidate) => new Set(candidate.squad.filter(Boolean))));
  let best: Array<number | null> = Array.from({ length: slots }, () => null);
  let bestScore = -Infinity;
  let bestFilled = 0;
  const chosen: Array<number | null> = [];
  const walk = (slot: number, total: number, filled: number) => {
    if (slot === slots) {
      // 埋まった枠が多い方を優先し、同数なら合計で選ぶ (0点の案でも空きよりよい)
      if (filled > bestFilled || (filled === bestFilled && total > bestScore)) {
        bestFilled = filled;
        bestScore = total;
        best = [...chosen];
      }
      return;
    }
    const list = candidatesBySlot[slot]!;
    for (let i = 0; i < list.length; i += 1) {
      const mine = members[slot]![i]!;
      let clash = false;
      for (let prev = 0; prev < slot && !clash; prev += 1) {
        const at = chosen[prev];
        if (at === null || at === undefined) continue;
        for (const name of members[prev]![at]!) {
          if (mine.has(name)) { clash = true; break; }
        }
      }
      if (clash) continue;
      chosen.push(i);
      walk(slot + 1, total + list[i]!.score, filled + 1);
      chosen.pop();
    }
    // この枠を諦める道も試す (どの案も被るとき、後ろの枠まで道連れにしない)
    chosen.push(null);
    walk(slot + 1, total, filled);
    chosen.pop();
  };
  walk(0, 0, 0);
  return best.map((index, slot) => (index === null ? null : candidatesBySlot[slot]![index]!));
}

/** 合計。未設定・未計算 (null) の枠は 0 として足す。 */
export const totalOf = (scores: ReadonlyArray<number | null>): number =>
  scores.reduce<number>((sum, score) => sum + (score ?? 0), 0);

/**
 * 盤面用の戦闘条件。基準 (癖なし) にボスのコードと防御力だけ重ねる。
 *
 * 計算機の条件パネルに入っている**コア・パーツ・回避区間**は「いま見ているボス」向けの設定なので、
 * 5体を横並びで比べる盤面には持ち込まない (1体だけ有利になる)。戦闘時間・敵防御力の既定・
 * シンクロ・コンソールはそのまま — 自分の環境での相対比較として読めるようにするため。
 */
export function boardBattle<T extends {
  enemyCode: string;
  enemyDef: number;
  coreEnabled: boolean;
  hasParts: boolean;
  immuneWindows: unknown[];
  elementWindows: unknown[];
}>(base: T, boss: UnionBoss): T {
  return {
    ...base,
    enemyCode: boss.elementCode,
    enemyDef: boss.enemyDef ?? base.enemyDef,
    coreEnabled: false,
    hasParts: false,
    immuneWindows: [],
    elementWindows: [],
  };
}
