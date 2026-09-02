import { describe, expect, it } from 'vitest';

import { FAVORITES_KEY, loadFavorites, saveFavorites, toggleFavorite } from './favorites';

/** localStorage の代わり。壊れた値も入れられるようにしておく。 */
const fakeStore = (initial: Record<string, string> = {}) => {
  const box = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => box.get(key) ?? null,
    setItem: (key: string, value: string) => { box.set(key, value); },
    removeItem: (key: string) => { box.delete(key); },
    raw: box,
  };
};

describe('お気に入りのニケ', () => {
  it('保存して読み直せる', () => {
    const store = fakeStore();
    saveFavorites(store, new Set(['리타', '크라운']));
    expect([...loadFavorites(store)].sort()).toEqual(['리타', '크라운'].sort());
    expect(store.raw.get(FAVORITES_KEY)).toContain('리타');
  });

  it('押すたびに入れ替わる (元の集合は変えない)', () => {
    const before = new Set(['리타']);
    const added = toggleFavorite(before, '크라운');
    expect([...added].sort()).toEqual(['리타', '크라운'].sort());
    expect([...before]).toEqual(['리타']);   // 元は据え置き

    const removed = toggleFavorite(added, '리타');
    expect([...removed]).toEqual(['크라운']);
  });

  it('壊れていても空で返す — お気に入りが読めなくても編成は組める', () => {
    expect(loadFavorites(fakeStore({ [FAVORITES_KEY]: 'これはJSONではない' })).size).toBe(0);
    expect(loadFavorites(fakeStore({ [FAVORITES_KEY]: '{"a":1}' })).size).toBe(0);
    expect(loadFavorites(fakeStore()).size).toBe(0);
    expect(loadFavorites(null).size).toBe(0);
    // 文字列でないものは落とす
    expect([...loadFavorites(fakeStore({ [FAVORITES_KEY]: '["리타",3,null,""]' }))]).toEqual(['리타']);
  });

  it('保存できない環境でも落ちない', () => {
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error('保存できません'); },
      removeItem: () => undefined,
    };
    expect(() => saveFavorites(broken, new Set(['리타']))).not.toThrow();
  });
});
