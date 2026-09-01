import { describe, expect, it } from 'vitest';

import type { CharacterOverrides } from './types';
import {
  GROWTH_FIELDS, OPERATION_FIELDS, applyImportedRoster, mergeImportedOverride, mergeImportedRoster,
} from './roster-merge';

const imported = (over: Partial<CharacterOverrides> = {}): CharacterOverrides => ({
  growthStage: 7,
  skillLevels: { '1': 10, '2': 10, '3': 10 },
  overload: { atk_pct: 20 },
  cube: { name: '재장', level: 15 },
  collection: { stage: 'SR15', favorite: 3 },
  equipLevels: { 머리: 5, 몸통: 5, 팔: 5, 다리: 5 },
  ...over,
});

const manual = (over: Partial<CharacterOverrides> = {}): CharacterOverrides => ({
  growthStage: 3,
  skillLevels: { '1': 4, '2': 4, '3': 4 },
  control: { tap_fire: { rate: 4.4, release: 0.03 } },
  burst: { mode: 'endgame', seconds: 20 },
  manualStats: { crit_rate: 5 },
  weaponModeSwapAt: 6,
  ...over,
});

describe('取込マージの規則', () => {
  it('育成と操作の項目が重ならない', () => {
    const overlap = GROWTH_FIELDS.filter((f) => (OPERATION_FIELDS as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it('CharacterOverrides の全項目がどちらかに分類されている (未分類は取込が更新しない項目に落ちる)', () => {
    // 型でも Unclassified extends never で固定してあるが、実行時にも数えて二重に守る。
    // 新しいフィールドを足したときに GROWTH_FIELDS / OPERATION_FIELDS への追加を忘れないため。
    const sample: Required<CharacterOverrides> = {
      growthStage: 0, skillLevels: { '1': 1, '2': 1, '3': 1 }, overload: {},
      cube: { name: '없음', level: 0 }, collection: { stage: '없음', favorite: 0 }, equipLevels: {},
      control: {}, manualStats: {}, burst: { mode: 'skip' }, weaponModeSwapAt: 0,
    };
    const classified = new Set<string>([...GROWTH_FIELDS, ...OPERATION_FIELDS]);
    expect(Object.keys(sample).filter((key) => !classified.has(key))).toEqual([]);
  });

  it('入れ子まで複製する (デッキ間で内側のオブジェクトを共有しない)', () => {
    const source = manual();
    const merged = mergeImportedOverride(imported(), source);
    merged.control!.tap_fire!.rate = 1.0;
    expect(source.control!.tap_fire!.rate).toBe(4.4);
  });

  it('更新件数はキーの順序に左右されない (取込元でオーバーロードのキー順が違う)', () => {
    const a: CharacterOverrides = { overload: { atk_pct: 20, element_bonus: 50 } };
    const b: CharacterOverrides = { overload: { element_bonus: 50, atk_pct: 20 } };
    const deck = { squad: ['라피'], characters: { 라피: b } };
    expect(applyImportedRoster({ 라피: a }, [deck])).toEqual([]);
  });

  it('育成6項目は取込値で上書きし、操作4項目はそのまま残す', () => {
    const merged = mergeImportedOverride(imported(), manual());
    // 育成 = 取込
    expect(merged.growthStage).toBe(7);
    expect(merged.skillLevels).toEqual({ '1': 10, '2': 10, '3': 10 });
    expect(merged.overload).toEqual({ atk_pct: 20 });
    expect(merged.cube).toEqual({ name: '재장', level: 15 });
    // 操作 = 手動のまま
    expect(merged.control).toEqual({ tap_fire: { rate: 4.4, release: 0.03 } });
    expect(merged.burst).toEqual({ mode: 'endgame', seconds: 20 });
    expect(merged.manualStats).toEqual({ crit_rate: 5 });
    expect(merged.weaponModeSwapAt).toBe(6);
  });

  it('オーバーロードは来たキーだけ重ねる (列が一部だけの CSV で残りを消さない)', () => {
    // 9種のうち「優越」列しか無い CSV。項目ごと差し替えると残り8種が消える。
    const partial: CharacterOverrides = { overload: { element_bonus: 90 } };
    const existing = manual({ overload: { element_bonus: 10, atk_pct: 43, max_ammo_pct: 109 } });
    expect(mergeImportedOverride(partial, existing).overload)
      .toEqual({ element_bonus: 90, atk_pct: 43, max_ammo_pct: 109 });
  });

  it('装備も部位ごとに重ねる', () => {
    const partial: CharacterOverrides = { equipLevels: { 머리: 3 } };
    const existing = manual({ equipLevels: { 머리: 5, 몸통: 5, 팔: 5, 다리: 5 } });
    expect(mergeImportedOverride(partial, existing).equipLevels)
      .toEqual({ 머리: 3, 몸통: 5, 팔: 5, 다리: 5 });
  });

  it('キューブとコレクションは来たら丸ごと差し替える (半端に混ぜると壊れる)', () => {
    const next: CharacterOverrides = { cube: { name: '전탄', level: 7 } };
    const existing = manual({ cube: { name: '재장', level: 15 } });
    expect(mergeImportedOverride(next, existing).cube).toEqual({ name: '전탄', level: 7 });
  });

  it('取込が持たない育成項目は既存の値を残す (CSV はキューブを持たない)', () => {
    // CSV 取込 = キューブとコレクションが無い
    const csv: CharacterOverrides = { growthStage: 9, skillLevels: { '1': 7, '2': 7, '3': 7 } };
    const existing = manual({ cube: { name: '전탄', level: 15 }, collection: { stage: 'SR5', favorite: 0 } });
    const merged = mergeImportedOverride(csv, existing);
    expect(merged.growthStage).toBe(9);                              // 取込にある → 更新
    expect(merged.cube).toEqual({ name: '전탄', level: 15 });         // 取込に無い → 残す
    expect(merged.collection).toEqual({ stage: 'SR5', favorite: 0 }); // 同上
    expect(merged.control).toBeDefined();                            // 操作は当然残る
  });

  it('既存が無ければ取込値のコピーを返す (元を書き換えない)', () => {
    const source = imported();
    const merged = mergeImportedOverride(source);
    expect(merged).toEqual(source);
    merged.overload!.atk_pct = 99;
    expect(source.overload!.atk_pct).toBe(20);   // コピーなので元は無傷
  });

  it('手で試算した育成値も取込値に戻る (決定: 常に上書き)', () => {
    const tried = manual({ overload: { atk_pct: 80 } });   // 「もし盛ったら」を手で入れた状態
    const merged = mergeImportedOverride(imported(), tried);
    expect(merged.overload).toEqual({ atk_pct: 20 });
  });
});

describe('ロスター全体への重ね方', () => {
  it('取込に無いキャラの行は消さない (一部だけの CSV で他が既定に戻らない)', () => {
    const before = { 라피: imported(), 크라운: imported({ growthStage: 9 }) };
    const after = mergeImportedRoster(before, { 라피: { growthStage: 2 } });
    expect(after.크라운!.growthStage).toBe(9);      // CSV に無かった → そのまま
    expect(after.라피!.growthStage).toBe(2);        // 来た → 更新
    expect(after.라피!.cube).toEqual(imported().cube); // 来なかった項目は残る
  });

  it('新しく現れたキャラは足す', () => {
    const after = mergeImportedRoster({}, { 앨리스: imported() });
    expect(after.앨리스!.growthStage).toBe(7);
  });

  it('元のロスターを書き換えない', () => {
    const before = { 라피: imported() };
    mergeImportedRoster(before, { 라피: { growthStage: 1 } });
    expect(before.라피!.growthStage).toBe(7);
  });

  it('操作設定は取込後も残る', () => {
    const before = { 라피: manual() };
    const after = mergeImportedRoster(before, { 라피: imported() });
    expect(after.라피!.control).toBeDefined();
    expect(after.라피!.burst).toEqual({ mode: 'endgame', seconds: 20 });
  });
});

describe('取込をデッキへ配る', () => {
  const deckOf = (squad: string[], characters: Record<string, CharacterOverrides> = {}) =>
    ({ squad, characters });

  it('編成中のキャラの育成値を更新し、操作設定は残す', () => {
    const deck = deckOf(['라피', '크라운'], { 라피: manual() });
    const touched = applyImportedRoster({ 라피: imported() }, [deck]);
    expect(deck.characters.라피!.growthStage).toBe(7);
    expect(deck.characters.라피!.control).toBeDefined();
    expect(touched).toEqual(['라피']);
  });

  it('まだ設定を持たないキャラにも取込値を配る', () => {
    const deck = deckOf(['라피']);
    applyImportedRoster({ 라피: imported() }, [deck]);
    expect(deck.characters.라피!.growthStage).toBe(7);
  });

  it('取込に無いキャラ (未所持・自作ニケ) には触らない', () => {
    const custom = manual();
    const deck = deckOf(['커스텀'], { 커스텀: custom });
    const touched = applyImportedRoster({ 라피: imported() }, [deck]);
    expect(deck.characters.커스텀).toEqual(custom);
    expect(touched).toEqual([]);
  });

  it('編成に入っていないキャラの設定は配らない', () => {
    const deck = deckOf(['라피']);
    applyImportedRoster({ 라피: imported(), 크라운: imported() }, [deck]);
    expect(deck.characters.크라운).toBeUndefined();
  });

  it('空の枠を飛ばす', () => {
    const deck = deckOf(['', '라피', '']);
    expect(() => applyImportedRoster({ 라피: imported() }, [deck])).not.toThrow();
    expect(Object.keys(deck.characters)).toEqual(['라피']);
  });

  it('育成が変わっていなければ更新件数に数えない (操作だけ違う場合)', () => {
    const same = { ...imported(), control: { tap_fire: { rate: 4.4, release: 0.03 } } };
    const deck = deckOf(['라피'], { 라피: same });
    expect(applyImportedRoster({ 라피: imported() }, [deck])).toEqual([]);
    expect(deck.characters.라피!.control).toBeDefined();   // 操作は残ったまま
  });

  it('複数デッキの同じキャラをまとめて更新し、名前は重複しない', () => {
    const a = deckOf(['라피'], { 라피: manual() });
    const b = deckOf(['라피'], { 라피: manual() });
    const touched = applyImportedRoster({ 라피: imported() }, [a, b]);
    expect(touched).toEqual(['라피']);
    expect(a.characters.라피!.growthStage).toBe(7);
    expect(b.characters.라피!.growthStage).toBe(7);
  });

  it('デッキ間で設定を共有しない (片方を触ってももう片方は変わらない)', () => {
    const a = deckOf(['라피'], { 라피: manual() });
    const b = deckOf(['라피'], { 라피: manual() });
    applyImportedRoster({ 라피: imported() }, [a, b]);
    a.characters.라피!.growthStage = 1;
    expect(b.characters.라피!.growthStage).toBe(7);
  });
});
