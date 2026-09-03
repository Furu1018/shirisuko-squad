// 今シーズンのボスを**この端末で登録し直せる**ようにする。
//
// `union-bosses.ts` の UNION_SEASON はソースに焼いた «出荷時の値» で、シーズンが変われば
// コードを直す必要があった。実際の使い方は «レイドが始まったら今回のボスを入れて計算する» なので、
// 名前・防御力・コアの有無を画面から入れられないと、毎シーズン私に頼むことになる。
//
// **属性は編集させない**。ユニオンレイドは1属性につきボス1体で、この対応は盤面・候補・
// 有利コードの索引そのものだから、ここが崩れると «鉄甲の候補をどのボスに当てるか» が決まらない。
// 編集できるのは «その属性の枠に、今回はどのボスが座っているか» の中身だけ。
import type { StorageLike } from './cache';
import { UNION_SEASON, type UnionBoss } from './union-bosses';

export const BOSSES_KEY = 'nikke-bosses-v1';

interface BossEnvelope {
  schemaVersion: 1;
  bosses: UnionBoss[];
}

/** 出荷時の値 (UNION_SEASON) の写し。呼ぶ側が書き換えても元が汚れないように毎回作る。 */
export const defaultBosses = (): UnionBoss[] => UNION_SEASON.bosses.map((boss) => ({ ...boss }));

/**
 * 数として使えるか。使えなければ null。
 *
 * `Number(null)` も `Number('')` も **0 を返す**ので、素直に Number へ通すと
 * «保存が壊れていた» を «0» として受け入れてしまう (JSON は NaN を null にする)。
 * 型と空文字をここで弾く。
 */
const numberAtLeast = (value: unknown, min: number): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= min ? num : null;
};

/**
 * 保存されたボスを読む。
 *
 * **属性を鍵にして出荷時の値へ重ねる**。保存が壊れていても・古くても・属性が増減していても、
 * 必ず «出荷時と同じ5体・1属性1体» が返る。壊れた保存で画面が消えるほうが困る。
 */
export function loadBosses(storage: StorageLike | null | undefined): UnionBoss[] {
  const base = defaultBosses();
  let raw: string | null = null;
  try {
    raw = storage?.getItem(BOSSES_KEY) ?? null;
  } catch {
    return base;   // 読めない環境 (プライベートウィンドウ等) では出荷時の値で動く
  }
  if (!raw) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  const stored = (parsed as BossEnvelope | null)?.bosses;
  if (!Array.isArray(stored)) return base;

  const byElement = new Map<string, Partial<UnionBoss>>();
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const code = (entry as UnionBoss).elementCode;
    if (typeof code === 'string') byElement.set(code, entry as Partial<UnionBoss>);
  }
  return base.map((boss) => {
    const saved = byElement.get(boss.elementCode);
    if (!saved) return boss;
    const name = typeof saved.name === 'string' ? saved.name.trim() : '';
    return {
      ...boss,
      // 名前が空なら出荷時の名前に戻す — 名無しのボスは枠として選べなくなる
      name: name || boss.name,
      enemyDef: numberAtLeast(saved.enemyDef, 1) ?? boss.enemyDef,
      coreEnabled: saved.coreEnabled === true,
      corePx: numberAtLeast(saved.corePx, 0) ?? boss.corePx ?? 0,
      hasParts: saved.hasParts === true,
    };
  });
}

/** 保存する。容量やプライベートモードで失敗しても例外にしない (画面はそのまま使える)。 */
export function saveBosses(
  storage: StorageLike | null | undefined, bosses: readonly UnionBoss[],
): boolean {
  if (!storage) return false;
  const envelope: BossEnvelope = { schemaVersion: 1, bosses: [...bosses] };
  try {
    storage.setItem(BOSSES_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** 出荷時の値に戻す。保存も消すので、次に開いたときも戻ったまま。 */
export function clearBosses(storage: StorageLike | null | undefined): UnionBoss[] {
  try {
    storage?.removeItem(BOSSES_KEY);
  } catch {
    /* 消せなくても、返す値は出荷時のもの */
  }
  return defaultBosses();
}

/**
 * 1体だけ差し替えた新しい配列。**属性で探す** — 並び順に依存すると、
 * 出荷時の並びを変えたときに黙って別のボスを書き換える。
 */
export function withBoss(
  bosses: readonly UnionBoss[], elementCode: string, patch: Partial<UnionBoss>,
): UnionBoss[] {
  return bosses.map((boss) => (boss.elementCode === elementCode ? { ...boss, ...patch } : boss));
}

/** 出荷時の値から変えてあるか。画面に «変更あり» と出して、戻す道を示すために使う。 */
export function isCustomised(bosses: readonly UnionBoss[]): boolean {
  const base = defaultBosses();
  return bosses.some((boss) => {
    const original = base.find((one) => one.elementCode === boss.elementCode);
    if (!original) return true;
    return boss.name !== original.name
      || boss.enemyDef !== original.enemyDef
      || Boolean(boss.coreEnabled) !== Boolean(original.coreEnabled)
      || (boss.corePx ?? 0) !== (original.corePx ?? 0)
      || Boolean(boss.hasParts) !== Boolean(original.hasParts);
  });
}
