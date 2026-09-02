// お気に入りのニケ。「いつも使う主要キャラ」を自分で決めて、選ぶときに上へ出す。
//
// 200名から毎回探すのは骨が折れる。かといって «人気順» は他人の話で、
// 手持ちの育成とも噛み合わない — 自分がよく使う顔ぶれはだいたい決まっているので、
// **自分で印を付ける**のが一番速い (2026-09-02 ユーザー決定)。
//
// 保存キーは `nikke-` で始める規約。GitHub Pages では本家しりすこPADと
// **同一オリジン**なので、接頭辞が衝突よけになっている。
import type { StorageLike } from './cache';

export const FAVORITES_KEY = 'nikke-favorites-v1';

/**
 * 読み込む。壊れていても空で返す — お気に入りが消えても編成は組めるので、
 * ここで入口を止める価値はない。
 */
export function loadFavorites(storage: StorageLike | null | undefined): Set<string> {
  try {
    const raw = storage?.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((name): name is string => typeof name === 'string' && name !== ''));
  } catch {
    return new Set();
  }
}

export function saveFavorites(storage: StorageLike | null | undefined, names: Set<string>): void {
  try {
    storage?.setItem(FAVORITES_KEY, JSON.stringify([...names]));
  } catch { /* 覚えられなくても選ぶことはできる */ }
}

/** 押すたびに入れ替える。戻り値は新しい集合 (呼び手が保存する)。 */
export function toggleFavorite(names: Set<string>, name: string): Set<string> {
  const next = new Set(names);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}
