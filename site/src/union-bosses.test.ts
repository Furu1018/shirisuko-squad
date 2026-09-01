import { describe, expect, it } from 'vitest';

import { decodeBattleCode } from './share-code';
import type { BattleSettings } from './types';
import { PROVISIONAL_ENEMY_DEF, UNION_SEASON, bossBattle, bossBattleCode } from './union-bosses';

const base: BattleSettings = {
  duration: 180, synchroLevel: 400, enemyDef: 12_345, enemyCode: '', coreEnabled: true,
  corePx: 60, hasParts: true, seed: 42, optimalRangeWeapons: ['AR'], normalHitCoeff: {},
  immuneWindows: [{ from: 10, to: 20 }], elementWindows: [], rngMode: 'expected', immuneBlocksBurst: true,
  console: { common_level: 0, class_level: {}, company_level: {} }, burstRegenTime: 2,
  burstReaction: 0.05,
};

describe('ユニオンレイド ボスプリセット', () => {
  it('今シーズンは5体で、属性は内部キー (韓国語) の5種が重複なく揃う', () => {
    const codes = UNION_SEASON.bosses.map((boss) => boss.elementCode);
    expect(codes).toHaveLength(5);
    expect(new Set(codes)).toEqual(new Set(['풍압', '수냉', '작열', '전격', '철갑']));
  });

  it('bossBattle は敵コードと敵防御力だけ差し替え、他の条件は土台のまま残す', () => {
    const boss = UNION_SEASON.bosses[0]!;
    const battle = bossBattle(boss, base);
    expect(battle.enemyCode).toBe(boss.elementCode);
    expect(battle.enemyDef).toBe(PROVISIONAL_ENEMY_DEF);
    expect(battle.coreEnabled).toBe(true);
    expect(battle.corePx).toBe(60);
    expect(battle.immuneWindows).toEqual([{ from: 10, to: 20 }]);
  });

  it('enemyDef が null のボスは条件パネルの敵防御力を引き継ぐ', () => {
    const battle = bossBattle({ name: 'x', elementCode: '수냉', enemyDef: null }, base);
    expect(battle.enemyDef).toBe(12_345);
  });

  it('NK3 コードに encode → decode で往復しても属性・防御力・土台の条件が保たれる', () => {
    for (const boss of UNION_SEASON.bosses) {
      const code = bossBattleCode(boss, base);
      expect(code.startsWith('NK3-')).toBe(true);
      const back = decodeBattleCode(code);
      expect(back.enemyCode).toBe(boss.elementCode);
      expect(back.enemyDef).toBe(PROVISIONAL_ENEMY_DEF);
      expect(back.coreEnabled).toBe(true);
      expect(back.corePx).toBe(60);
      expect(back.hasParts).toBe(true);
      expect(back.immuneWindows).toEqual([{ from: 10, to: 20 }]);
    }
  });
});
