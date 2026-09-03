// jsdom は要らない — 保存の読み書きと «壊れた保存でも画面が消えない» ことを見る。
import { describe, expect, it } from 'vitest';

import type { StorageLike } from './cache';
import {
  BOSSES_KEY, clearBosses, defaultBosses, isCustomised, loadBosses, saveBosses, withBoss,
} from './boss-setup';
import { UNION_SEASON } from './union-bosses';

const memoryStorage = (seed: Record<string, string> = {}): StorageLike => {
  const data = { ...seed };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  } as StorageLike;
};

const stored = (bosses: unknown) => ({ [BOSSES_KEY]: JSON.stringify({ schemaVersion: 1, bosses }) });

describe('今シーズンのボスの登録', () => {
  it('保存が無ければ出荷時の5体', () => {
    const bosses = loadBosses(memoryStorage());
    expect(bosses).toHaveLength(UNION_SEASON.bosses.length);
    expect(bosses.map((boss) => boss.name)).toEqual(UNION_SEASON.bosses.map((boss) => boss.name));
  });

  it('出荷時の値を返すたびに新しく作る (呼ぶ側が書き換えても元が汚れない)', () => {
    const first = defaultBosses();
    first[0]!.name = 'いじった';
    expect(defaultBosses()[0]!.name).not.toBe('いじった');
  });

  it('名前・防御力・コア・パーツを保存して読み戻せる', () => {
    const storage = memoryStorage();
    const next = withBoss(defaultBosses(), '전격', {
      name: '新ボス', enemyDef: 40_000, coreEnabled: true, corePx: 12, hasParts: true,
    });
    expect(saveBosses(storage, next)).toBe(true);

    const back = loadBosses(storage).find((boss) => boss.elementCode === '전격')!;
    expect(back.name).toBe('新ボス');
    expect(back.enemyDef).toBe(40_000);
    expect(back.coreEnabled).toBe(true);
    expect(back.corePx).toBe(12);
    expect(back.hasParts).toBe(true);
  });

  it('**属性で探して差し替える** — 並び順に頼らない', () => {
    const next = withBoss(defaultBosses(), '철갑', { name: 'かえた' });
    expect(next.find((boss) => boss.elementCode === '철갑')!.name).toBe('かえた');
    // 他は触らない
    expect(next.filter((boss) => boss.name === 'かえた')).toHaveLength(1);
  });

  it('壊れた保存でも出荷時の5体に戻す (画面が消えるほうが困る)', () => {
    for (const raw of ['{{{', 'null', '"文字列"', '{"bosses":"配列ではない"}', '{}']) {
      const bosses = loadBosses(memoryStorage({ [BOSSES_KEY]: raw }));
      expect(bosses, raw).toHaveLength(UNION_SEASON.bosses.length);
    }
  });

  it('知らない属性は捨て、足りない属性は出荷時の値で埋める', () => {
    const bosses = loadBosses(memoryStorage(stored([
      { name: 'のこる', elementCode: '전격', enemyDef: 1 },
      { name: 'しらない属性', elementCode: 'ありえない', enemyDef: 1 },
    ])));
    expect(bosses).toHaveLength(UNION_SEASON.bosses.length);
    expect(bosses.find((boss) => boss.elementCode === '전격')!.name).toBe('のこる');
    expect(bosses.some((boss) => boss.name === 'しらない属性')).toBe(false);
    // 保存に無かった属性は出荷時のまま
    const iron = UNION_SEASON.bosses.find((boss) => boss.elementCode === '철갑')!;
    expect(bosses.find((boss) => boss.elementCode === '철갑')!.name).toBe(iron.name);
  });

  it('名前が空なら出荷時の名前に戻す (名無しは枠として選べない)', () => {
    const bosses = loadBosses(memoryStorage(stored([
      { name: '   ', elementCode: '전격', enemyDef: 1 },
    ])));
    const lightning = UNION_SEASON.bosses.find((boss) => boss.elementCode === '전격')!;
    expect(bosses.find((boss) => boss.elementCode === '전격')!.name).toBe(lightning.name);
  });

  it('防御力が数として使えなければ出荷時の値に戻す', () => {
    for (const bad of [Number.NaN, Infinity, -1, 'あ', null]) {
      const bosses = loadBosses(memoryStorage(stored([
        { name: 'x', elementCode: '전격', enemyDef: bad },
      ])));
      const back = bosses.find((boss) => boss.elementCode === '전격')!;
      const original = UNION_SEASON.bosses.find((boss) => boss.elementCode === '전격')!;
      expect(back.enemyDef, String(bad)).toBe(original.enemyDef);
    }
  });

  it('コアとパーツは true と書いてあるときだけ入り', () => {
    const bosses = loadBosses(memoryStorage(stored([
      { name: 'x', elementCode: '전격', enemyDef: 1, coreEnabled: 'true', hasParts: 1 },
    ])));
    const back = bosses.find((boss) => boss.elementCode === '전격')!;
    expect(back.coreEnabled).toBe(false);
    expect(back.hasParts).toBe(false);
  });

  it('保存できない環境でも例外にしない', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    } as StorageLike;
    expect(loadBosses(broken)).toHaveLength(UNION_SEASON.bosses.length);
    expect(saveBosses(broken, defaultBosses())).toBe(false);
    expect(() => clearBosses(broken)).not.toThrow();
    expect(saveBosses(null, defaultBosses())).toBe(false);
  });

  it('出荷時に戻すと保存も消える', () => {
    const storage = memoryStorage();
    saveBosses(storage, withBoss(defaultBosses(), '전격', { name: 'かえた' }));
    expect(clearBosses(storage).find((boss) => boss.elementCode === '전격')!.name)
      .not.toBe('かえた');
    expect(storage.getItem(BOSSES_KEY)).toBeNull();
  });

  it('出荷時から変えてあるかを見分ける', () => {
    expect(isCustomised(defaultBosses())).toBe(false);
    expect(isCustomised(withBoss(defaultBosses(), '전격', { name: 'かえた' }))).toBe(true);
    expect(isCustomised(withBoss(defaultBosses(), '전격', { coreEnabled: true }))).toBe(true);
    expect(isCustomised(withBoss(defaultBosses(), '전격', { enemyDef: 999 }))).toBe(true);
  });
});
