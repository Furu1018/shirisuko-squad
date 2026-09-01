import { describe, expect, it } from 'vitest';

import { parseCollection, parseCsvLine, parseRosterCsv } from './csv-import';
import type { CharacterSettingsDefaults, SettingsCatalog } from './types';

const charDefaults = (over: Partial<CharacterSettingsDefaults> = {}): CharacterSettingsDefaults => ({
  weaponType: 'SR',
  recommendedControl: {},
  hasConditionalControl: false,
  growthStage: 3,
  rarity: 'SSR',
  maxGrowthStage: 10,
  growthOptions: [],
  skillLevels: { '1': 10, '2': 10, '3': 10 },
  skillLevelsLocked: false,
  overload: {},
  cube: { name: '재장', level: 15 },
  collection: { stage: 'SR15', favorite: 0 },
  ...over,
});

const settings = {
  characters: {
    앨리스: charDefaults(),
    프리바티: charDefaults({ maxGrowthStage: 0 }),
  },
} as unknown as SettingsCatalog;

const header = [
  '이름', '돌파', '코강', '스킬1', '스킬2', '버스트스킬',
  '우코(%)', '공증(%)', '방어(%)', '장탄(%)', '크확(%)', '크댐(%)', '차속(%)', '차댐(%)', '명중(%)',
  '머리_레벨', '몸통_레벨', '장갑_레벨', '다리_레벨',
].join(',');

describe('소장품 컬럼', () => {
  it('reads the collection stage actually owned instead of assuming the best', () => {
    // 이 컬럼을 안 읽으면 기본값(SR15 + 애장품 3단계)이 그대로 남아 과대평가된다.
    expect(parseCollection('애장품 ★★★')).toEqual({ stage: 'SR15', favorite: 3 });
    expect(parseCollection('애장품 ★★☆')).toEqual({ stage: 'SR15', favorite: 2 });
    expect(parseCollection('SR 15')).toEqual({ stage: 'SR15', favorite: 0 });
    expect(parseCollection('SR 5')).toEqual({ stage: 'SR5', favorite: 0 });
    expect(parseCollection('R 0')).toEqual({ stage: 'R0', favorite: 0 });
    // 빈 칸 = 미장착. 엔진이 아는 '없음'으로 옮긴다.
    expect(parseCollection('')).toEqual({ stage: '없음', favorite: 0 });
    expect(parseCollection(undefined)).toEqual({ stage: '없음', favorite: 0 });
  });

  it('leaves the default alone when the notation is unknown', () => {
    // 모르는 표기를 억지로 해석해 잘못 낮추느니 기본값을 그대로 둔다.
    expect(parseCollection('전설 소장품 XL')).toEqual({ stage: '', favorite: 0 });
  });
});

describe('parseCsvLine', () => {
  it('handles quoted fields with embedded commas and quotes', () => {
    expect(parseCsvLine('"a","b,c","d""e"')).toEqual(['a', 'b,c', 'd"e']);
  });
});

describe('列そのものが無い CSV', () => {
  // 空欄 (列はあるが値が無い = 持っていない) と、列が無い (この CSV はその情報を運んでいない) は別。
  // 取り込み直しでは育成項目を上書きするので、列が無いのに値を作ると
  // Blablalink で入れた実際のコレクション・突破・オーバーロードを 0 や未装着で潰してしまう。
  const nameOnly = ['이름', '스킬1', '스킬2', '버스트스킬'].join(',');

  it('無い列の項目は作らない (既存の値を潰さない)', () => {
    const csv = [nameOnly, '"앨리스","10","10","10"'].join('\n');
    const alice = parseRosterCsv(csv, settings).overrides['앨리스']!;
    expect(alice.collection).toBeUndefined();    // 소장품 列なし → 未装着にしない
    expect(alice.growthStage).toBeUndefined();   // 돌파/코강 列なし → 명함(0) にしない
    expect(alice.overload).toBeUndefined();      // OL 列なし → 全部 0 にしない
    expect(alice.skillLevels).toEqual({ '1': 10, '2': 10, '3': 10 });   // ある列は読む
  });

  it('列があって空欄なら「持っていない」として読む', () => {
    const withCollection = ['이름', '돌파', '코강', '소장품'].join(',');
    const csv = [withCollection, '"앨리스","0","0",""'].join('\n');
    const alice = parseRosterCsv(csv, settings).overrides['앨리스']!;
    expect(alice.collection).toEqual({ stage: '없음', favorite: 0 });
    expect(alice.growthStage).toBe(0);
  });

  it('돌파 だけで 코강 が無い CSV は突破段階を作らない (合計を復元できないため)', () => {
    // 「3突破 + コア7 = 段階10」を Blablalink で入れたあと、돌파 列しか無い CSV を
    // 取り込むと、コアを 0 と見なして段階3に落ちてしまう。片方だけでは作らない。
    const csv = [['이름', '돌파'].join(','), '"앨리스","2"'].join('\n');
    expect(parseRosterCsv(csv, settings).overrides['앨리스']!.growthStage).toBeUndefined();
  });

  it('돌파 と 코강 が揃えば読む (空欄は 0 = 強化していない)', () => {
    const csv = [['이름', '돌파', '코강'].join(','), '"앨리스","2",""'].join('\n');
    expect(parseRosterCsv(csv, settings).overrides['앨리스']!.growthStage).toBe(2);
  });

  it('オーバーロードは列が一部だけなら、その列だけを読む (残りを 0 で埋めない)', () => {
    // 9列のうち1列しか無い CSV で残り8つを 0 にすると、取り込み直しで
    // オーバーロード一式が潰れる。カードの個別設定は無い項目を既定値で補うので、
    // 「読めた分だけ」を渡すのが正しい。
    const csv = [['이름', '우코(%)'].join(','), '"앨리스","85.8"'].join('\n');
    expect(parseRosterCsv(csv, settings).overrides['앨리스']!.overload).toEqual({ element_bonus: 85.8 });
  });

  it('行が見出しより短いときは、足りない列を「無かった」として扱う', () => {
    // 末尾の列が欠けた行。0 や未装着で作ると実際の育成値を潰す。
    const short = ['이름', '돌파', '코강', '소장품', '우코(%)'].join(',');
    const csv = [short, '"앨리스","3"'].join('\n');
    const alice = parseRosterCsv(csv, settings).overrides['앨리스']!;
    // 코강 のセルが来ていないので合計を復元できない → 突破段階は作らない
    expect(alice.growthStage).toBeUndefined();
    expect(alice.collection).toBeUndefined();
    expect(alice.overload).toBeUndefined();
  });

  it('行が揃っていれば読む (短い行と区別する)', () => {
    const header2 = ['이름', '돌파', '코강', '소장품', '우코(%)'].join(',');
    const csv = [header2, '"앨리스","3","2","SR 15","80"'].join('\n');
    const alice = parseRosterCsv(csv, settings).overrides['앨리스']!;
    expect(alice.growthStage).toBe(5);
    expect(alice.collection).toEqual({ stage: 'SR15', favorite: 0 });
    expect(alice.overload).toEqual({ element_bonus: 80 });
  });
});

describe('parseRosterCsv', () => {
  it('maps aggregate overload, growth, skills, and equip levels for known names', () => {
    const csv = [
      header,
      '"앨리스","3","7","10","5","10","85.80","43.03","0.00","109.10","0.00","0.00","9.00","0.00","0.00","5","5","5","2"',
      '"모르는캐릭","3","7","10","10","10","1","1","1","1","1","1","1","1","1","5","5","5","5"',
    ].join('\n');

    const { overrides, matched, unmatched } = parseRosterCsv(csv, settings);
    expect(matched).toEqual(['앨리스']);
    expect(unmatched).toEqual(['모르는캐릭']);

    const alice = overrides['앨리스']!;
    expect(alice.overload).toEqual({
      element_bonus: 85.8, atk_pct: 43.03, def_pct: 0, max_ammo_pct: 109.1,
      crit_rate: 0, crit_dmg: 0, charge_speed_pct: 9, charge_dmg_pct: 0, accuracy_pct: 0,
    });
    expect(alice.growthStage).toBe(10); // 돌파 3 + 코강 7
    expect(alice.skillLevels).toEqual({ '1': 10, '2': 5, '3': 10 });
    expect(alice.equipLevels).toEqual({ 머리: 5, 몸통: 5, 팔: 5, 다리: 2 });
  });

  it('handles a UTF-8 BOM at the start of the file', () => {
    const csv = `﻿${[
      header,
      '"앨리스","3","7","10","10","10","1","1","1","1","1","1","1","1","1","5","5","5","5"',
    ].join('\n')}`;
    const { matched } = parseRosterCsv(csv, settings);
    expect(matched).toEqual(['앨리스']);
  });

  it('clamps growth to the character maximum and skips locked skills', () => {
    const csv = [
      header,
      '"프리바티","3","7","10","10","7","0","0","0","0","0","0","0","0","0","0","0","0","0"',
    ].join('\n');
    const { overrides } = parseRosterCsv(csv, settings);
    // 프리바티 maxGrowthStage 0 → 돌파+코강이 0으로 클램프
    expect(overrides['프리바티']!.growthStage).toBe(0);
  });
});
