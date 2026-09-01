import { describe, expect, it } from 'vitest';

import type { CharacterMeta, CharacterOverrides } from './types';
import { readEntry, readRoster, sortEntries, summarize } from './my-roster';

const meta = (name: string, elementCode: string, burstStage: string): CharacterMeta => ({
  name, elementCode, burstStage,
  weaponType: 'AR', className: '화력형', manufacturer: '엘리시온',
  preview: false, image: null, nameCode: null, resourceId: null, aliases: [],
});

const catalog = [
  meta('라피', '작열', '3'),
  meta('크라운', '철갑', '2'),
  meta('앨리스', '수냉', '3'),
];

const full: CharacterOverrides = {
  growthStage: 7,
  skillLevels: { '1': 10, '2': 10, '3': 10 },
  overload: { element_bonus: 85.8, atk_pct: 43, max_ammo_pct: 109 },
  cube: { name: '재장', level: 15 },
  collection: { stage: 'SR15', favorite: 3 },
};

describe('ロスターの読み取り', () => {
  it('育成の値をそのまま読む', () => {
    const entry = readEntry('라피', full, catalog[0], 92000);
    expect(entry.growthStage).toBe(7);
    expect(entry.skillTotal).toBe(30);
    expect(entry.skillMin).toBe(10);
    expect(entry.overload).toEqual({ element: 85.8, atk: 43, ammo: 109 });
    expect(entry.cubeName).toBe('재장');
    expect(entry.collectionStage).toBe('SR15');
    expect(entry.favorite).toBe(3);
    expect(entry.power).toBe(92000);
    expect(entry.elementCode).toBe('작열');
  });

  it('取込が持たない項目は null にする (0 と混同しない)', () => {
    // 「突破が 0」と「突破が分からない」は別物。0 にすると伸びしろの一覧が嘘になる。
    const entry = readEntry('라피', {}, catalog[0]);
    expect(entry.growthStage).toBeNull();
    expect(entry.skillTotal).toBeNull();
    expect(entry.skillMin).toBeNull();
    expect(entry.cubeName).toBeNull();
    expect(entry.power).toBeNull();
    expect(entry.overload).toEqual({ element: 0, atk: 0, ammo: 0 });   // OL は「無い = 0」でよい
  });

  it('スキルの最低値を拾う (どれか1つだけ低いのを見つけるため)', () => {
    const entry = readEntry('라피', { skillLevels: { '1': 10, '2': 4, '3': 10 } }, catalog[0]);
    expect(entry.skillTotal).toBe(24);
    expect(entry.skillMin).toBe(4);
  });

  it('カタログに無い名前 (自作ニケ) も落とさない', () => {
    const entry = readEntry('커스텀', full, undefined);
    expect(entry.name).toBe('커스텀');
    expect(entry.elementCode).toBe('');
    expect(entry.burstStage).toBe('');
  });

  it('ロスター全体を読む', () => {
    const entries = readRoster({ 라피: full, 크라운: {} }, catalog, { 라피: 92000 });
    expect(entries.map((e) => e.name)).toEqual(['라피', '크라운']);
    expect(entries[0]!.power).toBe(92000);
    expect(entries[1]!.power).toBeNull();
  });
});

describe('所持の内訳', () => {
  it('属性・バーストごとに数え、スキル満・キューブ無しを拾う', () => {
    const entries = readRoster({
      라피: full,
      크라운: { skillLevels: { '1': 4, '2': 4, '3': 4 }, cube: { name: '없음', level: 0 } },
      앨리스: { skillLevels: { '1': 10, '2': 10, '3': 10 }, cube: { name: '재장', level: 15 } },
    }, catalog);
    const summary = summarize(entries);
    expect(summary.owned).toBe(3);
    expect(summary.byElement).toEqual({ 작열: 1, 철갑: 1, 수냉: 1 });
    expect(summary.byBurst).toEqual({ '3': 2, '2': 1 });
    expect(summary.maxedSkills).toBe(2);
    expect(summary.noCube).toBe(1);
  });

  it('キューブが不明な行もキューブ無しとして数える (取込に無い = 着けていない扱い)', () => {
    expect(summarize(readRoster({ 라피: {} }, catalog)).noCube).toBe(1);
  });

  it('空のロスターでも壊れない', () => {
    expect(summarize([])).toEqual({ owned: 0, byElement: {}, byBurst: {}, maxedSkills: 0, noCube: 0 });
  });
});

describe('並べ替え', () => {
  const entries = readRoster({
    라피: { growthStage: 3, skillLevels: { '1': 10, '2': 10, '3': 10 } },
    크라운: { growthStage: 9, skillLevels: { '1': 4, '2': 4, '3': 4 } },
    앨리스: {},
  }, catalog, { 라피: 90000, 크라운: 120000 });

  it('戦闘力の高い順。読めていない行は後ろへ', () => {
    expect(sortEntries(entries, 'power').map((e) => e.name)).toEqual(['크라운', '라피', '앨리스']);
  });

  it('突破の高い順。不明は後ろへ', () => {
    expect(sortEntries(entries, 'growth').map((e) => e.name)).toEqual(['크라운', '라피', '앨리스']);
  });

  it('スキル合計の高い順。不明は後ろへ', () => {
    expect(sortEntries(entries, 'skill').map((e) => e.name)).toEqual(['라피', '크라운', '앨리스']);
  });

  it('名前は表示名 (日本語) で並べる — 内部キーの韓国語順ではない', () => {
    const labels: Record<string, string> = { 라피: 'ラピ', 크라운: 'クラウン', 앨리스: 'アリス' };
    expect(sortEntries(entries, 'name', (name) => labels[name]!).map((e) => e.name))
      .toEqual(['앨리스', '크라운', '라피']);   // アリス → クラウン → ラピ
  });

  it('元の配列を書き換えない', () => {
    const before = entries.map((e) => e.name);
    sortEntries(entries, 'power');
    expect(entries.map((e) => e.name)).toEqual(before);
  });
});
