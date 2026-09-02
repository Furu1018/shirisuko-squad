import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_KEYS, LEGACY_KEYS, OWNED_KEYS } from './storage-keys';

/** src/ の中で実際に書かれている `nikke-…` の鍵を全部拾う。 */
const usedInSource = (): Set<string> => {
  const dir = __dirname;
  const found = new Set<string>();
  for (const file of readdirSync(dir)) {
    // テストは «昔の鍵をわざと置く» ことがあるので実装だけを見る
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.startsWith('storage-keys')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    for (const hit of text.matchAll(/['"`](nikke-[a-z0-9-]+)['"`]/g)) found.add(hit[1]!);
  }
  return found;
};

describe('localStorage の鍵', () => {
  it('すべて nikke- で始まる (本家PADと同一オリジンなので接頭辞が衝突よけ)', () => {
    for (const key of ALL_KEYS) expect(key.startsWith('nikke-'), key).toBe(true);
  });

  it('重複が無い', () => {
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  it('**コードで使っている鍵はすべて一覧に載っている**', () => {
    // ここが落ちるのは «鍵を足したのに一覧に入れ忘れた» とき。
    // 入れ忘れると完全初期化で消えず、初期化したつもりで端末に残る。
    const missing = [...usedInSource()].filter((key) => !ALL_KEYS.includes(key));
    expect(missing, `storage-keys.ts に足してください: ${missing.join(', ')}`).toEqual([]);
  });

  it('もう無い機能の鍵は LEGACY に置く (消すためだけに残す)', () => {
    // LEGACY の鍵がコードで «使われて» いたら、それは現役なので OWNED が正しい
    const used = usedInSource();
    const stillUsed = LEGACY_KEYS.filter((key) => used.has(key));
    expect(stillUsed, `まだ使われています。OWNED_KEYS へ: ${stillUsed.join(', ')}`).toEqual([]);
  });

  it('OWNED と LEGACY は混ざらない', () => {
    const both = OWNED_KEYS.filter((key) => (LEGACY_KEYS as readonly string[]).includes(key));
    expect(both).toEqual([]);
  });
});
