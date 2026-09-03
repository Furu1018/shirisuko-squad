import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { StorageLike } from './cache';
import {
  BEATS, ELEMENT_PLANS_KEY, baselineBattle, bossConditionBattle, counterOf, MAX_PLANS_PER_ELEMENT, PLAN_ELEMENTS, addPlan, countPlans, emptyPlans,
  isEmptySquad, loadPlans, plansOf, registerScore, removePlan, samePlanSetup, sameSquad, savePlans, type ElementPlans,
} from './element-plans';

const memoryStorage = (seed: Record<string, string> = {}): StorageLike => {
  const data = { ...seed };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  } as StorageLike;
};

const squad = (...names: string[]) => {
  const out = [...names];
  while (out.length < 5) out.push('');
  return out;
};

describe('属性別編成の保存', () => {
  it('保存キーは nikke- 始まり (本家PADと同一オリジンで localStorage を共有するため)', () => {
    expect(ELEMENT_PLANS_KEY.startsWith('nikke-')).toBe(true);
  });

  it('属性は5つ、内部キー (韓国語) のまま持つ', () => {
    expect([...PLAN_ELEMENTS]).toEqual(['작열', '수냉', '풍압', '전격', '철갑']);
  });

  it('保存して読み直せる', () => {
    const storage = memoryStorage();
    const { plans } = addPlan(emptyPlans(), '작열', squad('라피', '크라운'));
    savePlans(storage, plans);
    const back = loadPlans(storage);
    expect(plansOf(back, '작열')).toHaveLength(1);
    expect(plansOf(back, '작열')[0]!.squad).toEqual(squad('라피', '크라운'));
  });

  it('記録が無ければ空', () => {
    expect(loadPlans(memoryStorage())).toEqual(emptyPlans());
    expect(loadPlans(null)).toEqual(emptyPlans());
  });

  it('壊れた記録・知らない版は捨てる (起動を止めない)', () => {
    expect(loadPlans(memoryStorage({ [ELEMENT_PLANS_KEY]: '{{{' }))).toEqual(emptyPlans());
    expect(loadPlans(memoryStorage({
      [ELEMENT_PLANS_KEY]: JSON.stringify({ schemaVersion: 9, byElement: {} }),
    }))).toEqual(emptyPlans());
  });

  it('知らない属性の記録は落とす', () => {
    const stored = JSON.stringify({
      schemaVersion: 1,
      byElement: { 무속성: [{ id: 'a', squad: squad('라피'), savedAt: '2026-09-01T00:00:00.000Z' }] },
    });
    expect(countPlans(loadPlans(memoryStorage({ [ELEMENT_PLANS_KEY]: stored })))).toBe(0);
  });

  it('読むときに5枠へ揃え、空の案は捨てる', () => {
    const stored = JSON.stringify({
      schemaVersion: 1,
      byElement: {
        작열: [
          { id: 'a', squad: ['라피'], savedAt: '2026-09-01T00:00:00.000Z' },        // 短い
          { id: 'b', squad: ['', '', '', '', '', ''], savedAt: '2026-09-01T00:00:00.000Z' }, // 空
        ],
      },
    });
    const plans = plansOf(loadPlans(memoryStorage({ [ELEMENT_PLANS_KEY]: stored })), '작열');
    expect(plans).toHaveLength(1);
    expect(plans[0]!.squad).toHaveLength(5);
  });

  it('上限を超えて保存されていても読み込みで切る', () => {
    // 上限より «多く» 入っている保存を作る。上限そのものを直に書かない —
    // 数を変えたときにテストが黙って意味を失う
    const many = Array.from({ length: MAX_PLANS_PER_ELEMENT + 2 }, (_, i) => ({
      id: `p${i}`, squad: squad(`니케${i}`), savedAt: '2026-09-01T00:00:00.000Z',
    }));
    const stored = JSON.stringify({ schemaVersion: 1, byElement: { 작열: many } });
    expect(plansOf(loadPlans(memoryStorage({ [ELEMENT_PLANS_KEY]: stored })), '작열'))
      .toHaveLength(MAX_PLANS_PER_ELEMENT);
  });

  it('保存できない環境でも例外にしない', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} } as StorageLike;
    expect(() => savePlans(broken, emptyPlans())).not.toThrow();
  });
});

describe('有利コードの対応', () => {
  it('エンジン (calculator/damage.py の _CODE_ADVANTAGE) と同じ表になっている', () => {
    // 画面の「電撃編成 → 水冷ボス向け」という案内は、エンジンが有利補正を掛ける条件と
    // 一致していないと嘘になる。エンジンは無改変なので、こちらを合わせて固定する。
    const engine = readFileSync(
      join(import.meta.dirname, '..', '..', 'calculator', 'damage.py'), 'utf8',
    );
    const block = engine.match(/_CODE_ADVANTAGE:\s*dict\[str,\s*str\]\s*=\s*\{([\s\S]*?)\}/);
    expect(block, '_CODE_ADVANTAGE がエンジンに見つからない').toBeTruthy();
    const fromEngine: Record<string, string> = {};
    for (const line of block![1]!.split('\n')) {
      const pair = line.match(/"([^"]+)":\s*"([^"]+)"/);
      if (pair) fromEngine[pair[1]!] = pair[2]!;
    }
    expect(fromEngine).toEqual(BEATS);
  });

  it('5属性が輪になっている (どのコードも1つだけ倒し、1つだけに倒される)', () => {
    const beaten = PLAN_ELEMENTS.map((element) => BEATS[element]);
    expect(new Set(beaten).size).toBe(5);
    for (const element of PLAN_ELEMENTS) expect(BEATS[element]).not.toBe(element);
  });
});

describe('基準戦闘', () => {
  const base = {
    duration: 180, enemyDef: 31_784, enemyCode: '', coreEnabled: true, corePx: 60,
    hasParts: true, seed: 42, immuneWindows: [{ from: 10, to: 20 }], elementWindows: [{ from: 5, to: 9 }],
    synchroLevel: 400,
  };

  it('その編成が想定するボスのコードを敵に設定する', () => {
    // 電撃編成は水冷ボス向け — 敵を水冷にしないと有利コードの補正が乗らず、比較にならない
    expect(baselineBattle(base, '전격').enemyCode).toBe('수냉');
    expect(baselineBattle(base, '작열').enemyCode).toBe('풍압');
  });

  it('ボス固有の条件を外す (コア・パーツ・区間)', () => {
    const battle = baselineBattle(base, '전격');
    expect(battle.coreEnabled).toBe(false);
    expect(battle.hasParts).toBe(false);
    expect(battle.immuneWindows).toEqual([]);
    expect(battle.elementWindows).toEqual([]);
  });

  it('それ以外は今の設定のまま (自分の環境での相対比較として読めるように)', () => {
    const battle = baselineBattle(base, '전격');
    expect(battle.duration).toBe(180);
    expect(battle.enemyDef).toBe(31_784);
    expect(battle.synchroLevel).toBe(400);
    expect(battle.seed).toBe(42);
    expect(battle.corePx).toBe(60);   // コアを切っているので値は効かないが、勝手に変えない
  });

  it('元のオブジェクトを書き換えない', () => {
    baselineBattle(base, '전격');
    expect(base.coreEnabled).toBe(true);
    expect(base.immuneWindows).toHaveLength(1);
  });
});

describe('ボス条件', () => {
  const base = {
    duration: 180, enemyDef: 31_784, enemyCode: '', coreEnabled: false, corePx: 60,
    hasParts: false, immuneWindows: [{ from: 10, to: 20 }], elementWindows: [],
  };

  it('ボスのコードに有利な編成を引ける (BEATS の逆引き)', () => {
    expect(counterOf('수냉')).toBe('전격');   // 水冷ボスには電撃編成
    expect(counterOf('풍압')).toBe('작열');
    expect(counterOf('무속성')).toBeNull();
  });

  it('5属性すべてに対抗コードがある', () => {
    for (const element of PLAN_ELEMENTS) {
      expect(counterOf(BEATS[element])).toBe(element);
    }
  });

  it('ボスのコードと防御力を載せ、コア・パーツは指定どおりにする', () => {
    const battle = bossConditionBattle(base,
      { elementCode: '전격', enemyDef: 50_000 },
      { coreEnabled: true, hasParts: true });
    expect(battle.enemyCode).toBe('전격');
    expect(battle.enemyDef).toBe(50_000);
    expect(battle.coreEnabled).toBe(true);
    expect(battle.hasParts).toBe(true);
  });

  it('ボスが防御力を持たなければ今の設定を使う', () => {
    const battle = bossConditionBattle(base,
      { elementCode: '전격', enemyDef: null },
      { coreEnabled: false, hasParts: false });
    expect(battle.enemyDef).toBe(31_784);
  });

  it('回避区間などの手入力は引き継ぐ (毎回入れ直させない)', () => {
    const battle = bossConditionBattle(base,
      { elementCode: '전격', enemyDef: null }, { coreEnabled: false, hasParts: false });
    expect(battle.immuneWindows).toEqual([{ from: 10, to: 20 }]);
    expect(battle.duration).toBe(180);
  });

  it('元のオブジェクトを書き換えない', () => {
    bossConditionBattle(base, { elementCode: '전격', enemyDef: 1 }, { coreEnabled: true, hasParts: true });
    expect(base.coreEnabled).toBe(false);
    expect(base.enemyDef).toBe(31_784);
  });
});

describe('案の追加', () => {
  it('足せる', () => {
    const { plans, added } = addPlan(emptyPlans(), '수냉', squad('앨리스'));
    expect(added).toBe(true);
    expect(plansOf(plans, '수냉')).toHaveLength(1);
  });

  it('空の編成は足さない', () => {
    const result = addPlan(emptyPlans(), '수냉', squad());
    expect(result.added).toBe(false);
    expect(result.reason).toBe('empty');
  });

  it('顔ぶれが同じなら並び順が違っても足さない', () => {
    const first = addPlan(emptyPlans(), '수냉', squad('앨리스', '라피')).plans;
    const result = addPlan(first, '수냉', squad('라피', '앨리스'));
    expect(result.added).toBe(false);
    expect(result.reason).toBe('duplicate');
  });

  it('上限を超えて足さない', () => {
    let plans: ElementPlans = emptyPlans();
    for (let i = 0; i < MAX_PLANS_PER_ELEMENT; i += 1) {
      plans = addPlan(plans, '전격', squad(`니케${i}`)).plans;
    }
    expect(plansOf(plans, '전격')).toHaveLength(MAX_PLANS_PER_ELEMENT);
    const result = addPlan(plans, '전격', squad('あふれる'));
    expect(result.added).toBe(false);
    expect(result.reason).toBe('full');
    expect(plansOf(result.plans, '전격')).toHaveLength(MAX_PLANS_PER_ELEMENT);
  });

  it('属性ごとに独立して数える', () => {
    let plans: ElementPlans = emptyPlans();
    for (let i = 0; i < MAX_PLANS_PER_ELEMENT; i += 1) {
      plans = addPlan(plans, '전격', squad(`니케${i}`)).plans;
    }
    expect(addPlan(plans, '철갑', squad('D')).added).toBe(true);
  });

  it('元のオブジェクトを書き換えない', () => {
    const before = emptyPlans();
    addPlan(before, '작열', squad('라피'));
    expect(countPlans(before)).toBe(0);
  });
});

describe('案の削除', () => {
  it('消せる', () => {
    const { plans } = addPlan(emptyPlans(), '작열', squad('라피'));
    const id = plansOf(plans, '작열')[0]!.id;
    expect(countPlans(removePlan(plans, '작열', id))).toBe(0);
  });

  it('無い id を渡しても壊れない', () => {
    const { plans } = addPlan(emptyPlans(), '작열', squad('라피'));
    expect(removePlan(plans, '작열', 'nope')).toBe(plans);
  });

  it('最後の1件を消したら属性ごと消える', () => {
    const { plans } = addPlan(emptyPlans(), '작열', squad('라피'));
    const id = plansOf(plans, '작열')[0]!.id;
    expect(removePlan(plans, '작열', id).byElement.작열).toBeUndefined();
  });
});

describe('補助', () => {
  it('顔ぶれ比較は空き枠と順番を無視する', () => {
    expect(sameSquad(squad('A', 'B'), squad('B', 'A'))).toBe(true);
    expect(sameSquad(squad('A', 'B'), squad('A', 'C'))).toBe(false);
  });

  it('空の編成を見分ける', () => {
    expect(isEmptySquad(squad())).toBe(true);
    expect(isEmptySquad(squad('A'))).toBe(false);
  });

  it('同じミリ秒に足しても id が分かれる', () => {
    let plans: ElementPlans = emptyPlans();
    plans = addPlan(plans, '작열', squad('A')).plans;
    plans = addPlan(plans, '작열', squad('B')).plans;
    const [a, b] = plansOf(plans, '작열');
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('キューブ込みの登録', () => {
  const cubed = { cube: { name: '렐릭 베어 큐브', level: 15 } } as never;

  it('保存時の個別設定は編成にいるニケのぶんだけ残り、読み直しても保たれる', () => {
    const storage = memoryStorage();
    const { plans, added } = addPlan(emptyPlans(), '철갑', squad('리타', '크라운'), {
      characters: { 리타: cubed, 나가: cubed },   // 나가 は編成にいない → 落ちる
    });
    expect(added).toBe(true);
    expect(Object.keys(plansOf(plans, '철갑')[0]!.characters!)).toEqual(['리타']);
    savePlans(storage, plans);
    expect(plansOf(loadPlans(storage), '철갑')[0]!.characters).toEqual({ 리타: cubed });
  });

  it('個別設定なしで保存すれば characters は持たない (ロスター任せ)', () => {
    const { plans } = addPlan(emptyPlans(), '철갑', squad('리타'));
    expect(plansOf(plans, '철갑')[0]!.characters).toBeUndefined();
  });

  it('計算した理論値を案に登録でき、読み直しても残る', () => {
    const storage = memoryStorage();
    let { plans } = addPlan(emptyPlans(), '수냉', squad('앨리스'));
    const id = plansOf(plans, '수냉')[0]!.id;
    plans = registerScore(plans, '수냉', id, { damage: 3_690_000_000, duration: 180, at: '2026-09-02T00:00:00.000Z' });
    expect(plansOf(plans, '수냉')[0]!.registered!.damage).toBe(3_690_000_000);
    savePlans(storage, plans);
    expect(plansOf(loadPlans(storage), '수냉')[0]!.registered!.duration).toBe(180);
    // 無い id なら何も変えない
    expect(registerScore(plans, '수냉', 'no-such-id', { damage: 1, duration: 90, at: 'x' })).toBe(plans);
  });

  it('壊れた登録値は捨てる (編成は残す)', () => {
    const storage = memoryStorage();
    const { plans } = addPlan(emptyPlans(), '전격', squad('나가'));
    const raw = JSON.parse(JSON.stringify(plans)) as { byElement: Record<string, Array<Record<string, unknown>>> };
    raw.byElement['전격']![0]!.registered = { damage: 'とても大きい', duration: 180, at: 'x' };
    savePlans(storage, raw as never);
    const back = loadPlans(storage);
    expect(plansOf(back, '전격')).toHaveLength(1);
    expect(plansOf(back, '전격')[0]!.registered).toBeUndefined();
  });
});

describe('重複判定は顔ぶれ + 個別設定で見る', () => {
  const cubeA = { cube: { name: '렐릭 베어 큐브', level: 15 } } as never;
  const cubeB = { cube: { name: '택티컬 베어 큐브', level: 15 } } as never;

  it('同じ顔ぶれでもキューブが違えば別の案として保存できる', () => {
    let { plans } = addPlan(emptyPlans(), '철갑', squad('리타'), { characters: { 리타: cubeA } });
    const second = addPlan(plans, '철갑', squad('리타'), { characters: { 리타: cubeB } });
    expect(second.added).toBe(true);
    plans = second.plans;
    // スナップショット無し (ロスター任せ) も、有りとは別の案
    expect(addPlan(plans, '철갑', squad('리타')).added).toBe(true);
  });

  it('顔ぶれも個別設定も同じなら重複 (並び順・キー順は問わない)', () => {
    const { plans } = addPlan(emptyPlans(), '철갑', squad('리타', '크라운'), { characters: { 리타: cubeA } });
    const again = addPlan(plans, '철갑', squad('크라운', '리타'), { characters: { 리타: cubeA } });
    expect(again.added).toBe(false);
    expect(again.reason).toBe('duplicate');
    expect(samePlanSetup(plansOf(plans, '철갑')[0]!, squad('크라운', '리타'), { 리타: cubeA })).toBe(true);
    // 編成にいないニケのスナップショットは重複判定に効かない
    expect(samePlanSetup(plansOf(plans, '철갑')[0]!, squad('크라운', '리타'),
      { 리타: cubeA, 나가: cubeB })).toBe(true);
  });
});
