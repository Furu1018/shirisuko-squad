// バッファーのテンプレート — «B1/B2 の定番» を型として貯めておく。
//
// ユニオンレイドは全所持から3部隊しか出せない。属性ごとに B3 のアタッカーは変わるが、
// サポーター寄りの B1/B2 は強いキャラで固定されがち (実運用の指摘)。
// なので «定番の2〜3人 + そのキューブ» を型として保存し、編成を作るときは
// 型から始めてアタッカーだけ足せるようにする。
//
// 型は**属性を持たない** — 同じサポーターを全属性で使うのが前提だから。
// どの行のモーダルからでも同じ型が見える。
import type { StorageLike } from './cache';
import type { CharacterOverrides } from './types';

export const TEMPLATES_KEY = 'nikke-templates-v1';

/** 貯めすぎ防止。定番の組は数える程しかない (多すぎると選ぶ手間が戻ってくる)。 */
export const MAX_TEMPLATES = 6;

export interface SquadTemplate {
  id: string;
  /** 5枠ぶん。空文字は空き枠 (アタッカーを入れる場所)。 */
  squad: string[];
  /** 型に入っているニケの個別設定 (キューブ等)。編成に写すとき一緒に運ぶ。 */
  characters?: Record<string, CharacterOverrides>;
  savedAt: string;
}

interface TemplateEnvelope {
  schemaVersion: 1;
  items: SquadTemplate[];
}

let idCounter = 0;
const makeId = (): string => {
  idCounter += 1;
  return `t${Date.now().toString(36)}${idCounter.toString(36)}`;
};

const normalize = (squad: readonly unknown[]): string[] => {
  const out = Array.from({ length: 5 }, (_, index) => {
    const value = squad[index];
    return typeof value === 'string' ? value : '';
  });
  return out;
};

/** 読み込む。壊れた保存は捨てて空にする (画面が消えるほうが困る)。 */
export function loadTemplates(storage: StorageLike | null | undefined): SquadTemplate[] {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(TEMPLATES_KEY) ?? null;
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = (parsed as TemplateEnvelope | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: SquadTemplate[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as SquadTemplate;
    if (typeof entry.id !== 'string' || !Array.isArray(entry.squad)) continue;
    const squad = normalize(entry.squad);
    if (squad.every((name) => !name)) continue;   // 空の型は意味を持たない
    out.push({
      id: entry.id,
      squad,
      ...(entry.characters && typeof entry.characters === 'object'
        ? { characters: entry.characters } : {}),
      savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date(0).toISOString(),
    });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

export function saveTemplates(
  storage: StorageLike | null | undefined, items: readonly SquadTemplate[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TEMPLATES_KEY, JSON.stringify({ schemaVersion: 1, items: [...items] } satisfies TemplateEnvelope));
    return true;
  } catch {
    return false;
  }
}

/** 顔ぶれが同じか (順序は見ない)。同じ型を2つ持っても選ぶ手間が増えるだけ。 */
const sameMembers = (left: readonly string[], right: readonly string[]): boolean => {
  const a = left.filter(Boolean).slice().sort();
  const b = right.filter(Boolean).slice().sort();
  return a.length === b.length && a.every((name, index) => name === b[index]);
};

/**
 * 型を足す。空・同じ顔ぶれ・上限は断る (理由は呼ぶ側が文言にする)。
 * 個別設定は**型に入っているニケのぶんだけ**残す。
 */
export function addTemplate(
  items: readonly SquadTemplate[],
  squad: readonly string[],
  characters?: Record<string, CharacterOverrides>,
): { items: SquadTemplate[]; added: boolean; reason?: 'empty' | 'duplicate' | 'full' } {
  const normalized = normalize(squad);
  if (normalized.every((name) => !name)) return { items: [...items], added: false, reason: 'empty' };
  if (items.some((item) => sameMembers(item.squad, normalized))) {
    return { items: [...items], added: false, reason: 'duplicate' };
  }
  if (items.length >= MAX_TEMPLATES) return { items: [...items], added: false, reason: 'full' };
  const kept = Object.fromEntries(Object.entries(characters ?? {})
    .filter(([name]) => normalized.includes(name)));
  return {
    items: [...items, {
      id: makeId(),
      squad: normalized,
      ...(Object.keys(kept).length > 0 ? { characters: kept } : {}),
      savedAt: new Date().toISOString(),
    }],
    added: true,
  };
}

/** 型を消す。無い id でも壊れない。 */
export const removeTemplate = (items: readonly SquadTemplate[], id: string): SquadTemplate[] =>
  items.filter((item) => item.id !== id);

/**
 * 型を編成に写す。
 *
 * **空き枠にだけ入れる** — 既に選んだアタッカーを型で潰さない。
 * 既に編成に居るニケは飛ばす (二重には入れない)。
 * @returns 次の5人と、写せた人・入り切らなかった人 (呼ぶ側が文言にする)
 */
export function applyTemplate(
  squad: readonly string[], template: SquadTemplate,
): { squad: string[]; applied: string[]; overflow: string[] } {
  const next = normalize(squad);
  const applied: string[] = [];
  const overflow: string[] = [];
  for (const name of template.squad.filter(Boolean)) {
    if (next.includes(name)) continue;
    const free = next.indexOf('');
    if (free < 0) {
      overflow.push(name);
      continue;
    }
    next[free] = name;
    applied.push(name);
  }
  return { squad: next, applied, overflow };
}
