// jsdom は要らない — 型の読み書きと «編成への写し方» の規則を見る。
import { describe, expect, it } from 'vitest';

import type { StorageLike } from './cache';
import {
  MAX_TEMPLATES, TEMPLATES_KEY, addTemplate, applyTemplate, loadTemplates,
  removeTemplate, saveTemplates, type SquadTemplate,
} from './squad-templates';

const memoryStorage = (seed: Record<string, string> = {}): StorageLike => {
  const data = { ...seed };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  } as StorageLike;
};

const squad = (...names: string[]): string[] => {
  const out = [...names];
  while (out.length < 5) out.push('');
  return out;
};

describe('バッファーのテンプレート', () => {
  it('保存して読み戻せる — 個別設定 (キューブ) も一緒に', () => {
    const storage = memoryStorage();
    const { items } = addTemplate([], squad('크라운', '리타'), {
      크라운: { cube: { name: '렐릭 베어 큐브', level: 15 } } as never,
      나가: { cube: { name: '関係ない人', level: 1 } } as never,   // 型に居ないので落ちる
    });
    expect(saveTemplates(storage, items)).toBe(true);

    const back = loadTemplates(storage);
    expect(back).toHaveLength(1);
    expect(back[0]!.squad.filter(Boolean)).toEqual(['크라운', '리타']);
    expect(Object.keys(back[0]!.characters ?? {})).toEqual(['크라운']);
  });

  it('空・同じ顔ぶれ・上限は断る', () => {
    let items: SquadTemplate[] = [];
    expect(addTemplate(items, squad()).reason).toBe('empty');
    items = addTemplate(items, squad('크라운', '리타')).items;
    // 並びが違っても同じ顔ぶれは同じ型
    expect(addTemplate(items, squad('리타', '크라운')).reason).toBe('duplicate');
    for (let index = 0; items.length < MAX_TEMPLATES; index += 1) {
      items = addTemplate(items, squad(`니케${index}`)).items;
    }
    expect(addTemplate(items, squad('あふれる')).reason).toBe('full');
  });

  it('**空き枠にだけ写す** — 選んであるアタッカーを型で潰さない', () => {
    const { items } = addTemplate([], squad('크라운', '리타', '나가'));
    // 1枠目にアタッカーを置いてから型を当てる
    const result = applyTemplate(['앨리스', '', '', '', ''], items[0]!);
    expect(result.squad).toEqual(['앨리스', '크라운', '리타', '나가', '']);
    expect(result.applied).toEqual(['크라운', '리타', '나가']);
    expect(result.overflow).toEqual([]);
  });

  it('既に編成に居るニケは二重に入れず、入り切らない人は知らせる', () => {
    const { items } = addTemplate([], squad('크라운', '리타', '나가'));
    const result = applyTemplate(['크라운', '앨리스', '헬름', '노아', ''], items[0]!);
    expect(result.squad[4]).toBe('리타');          // 空き1枠に最初の1人
    expect(result.applied).toEqual(['리타']);
    expect(result.overflow).toEqual(['나가']);     // 入り切らなかった
  });

  it('消せる。壊れた保存は空として読む', () => {
    const { items } = addTemplate([], squad('크라운'));
    expect(removeTemplate(items, items[0]!.id)).toHaveLength(0);
    expect(removeTemplate(items, 'しらないid')).toHaveLength(1);
    for (const raw of ['{{{', 'null', '"x"', '{"items":"配列ではない"}',
      JSON.stringify({ schemaVersion: 1, items: [{ id: 'a', squad: ['', '', '', '', ''] }] })]) {
      expect(loadTemplates(memoryStorage({ [TEMPLATES_KEY]: raw })), raw).toHaveLength(0);
    }
  });

  it('保存できない環境でも例外にしない', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    } as StorageLike;
    expect(loadTemplates(broken)).toHaveLength(0);
    expect(saveTemplates(broken, [])).toBe(false);
  });
});
