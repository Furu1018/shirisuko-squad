import { describe, expect, it } from 'vitest';

import type { StorageLike } from './cache';
import { addPlan, emptyPlans, type ElementPlans } from './element-plans';
import {
  BOARD_SLOTS, RAID_BOARD_KEY, bestTriple, boardBattle, candidatesFor, clashOptionsFor, clashesOf,
  bestForElements, bossForElement, clearSlot, emptyBoard, loadBoard, openSlotCandidates, saveBoard, totalOf, usageOf,
  usedCount, withSlot, withoutNames, type Candidate, type RaidBoard,
} from './raid-board';
import { UNION_SEASON, type UnionBoss } from './union-bosses';

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

const BOSSES = UNION_SEASON.bosses.map((boss) => boss.name);
const bossOf = (name: string): UnionBoss => UNION_SEASON.bosses.find((boss) => boss.name === name)!;

/** 1凸目 レイタンス (鉄甲で殴る)・2凸目 トゥームストーン (水冷) で、크라운 が被っている盤面。 */
const clashed = (): RaidBoard => {
  let board = emptyBoard();
  board = withSlot(board, 0, { boss: 'レイタンス', squad: squad('리타', '크라운', '라피 : 레드 후드', '앨리스', '나가') });
  board = withSlot(board, 1, { boss: 'トゥームストーン', squad: squad('앨리스', '크라운', '헬름', '노아', '블랑') });
  return board;
};

describe('3凸ボードの保存', () => {
  it('保存キーは nikke- 始まり (本家PADと同一オリジンで localStorage を共有するため)', () => {
    expect(RAID_BOARD_KEY.startsWith('nikke-')).toBe(true);
  });

  it('枠は3つ (ユニオンレイドは1日3凸)', () => {
    expect(BOARD_SLOTS).toBe(3);
    expect(emptyBoard().slots).toHaveLength(3);
  });

  it('保存して読み直せる', () => {
    const storage = memoryStorage();
    expect(saveBoard(storage, clashed())).toBe(true);
    expect(loadBoard(storage, BOSSES)).toEqual(clashed());
  });

  it('記録が無ければ空・壊れていても起動を止めない', () => {
    expect(loadBoard(memoryStorage(), BOSSES)).toEqual(emptyBoard());
    expect(loadBoard(null, BOSSES)).toEqual(emptyBoard());
    expect(loadBoard(memoryStorage({ [RAID_BOARD_KEY]: '{{{' }), BOSSES)).toEqual(emptyBoard());
    expect(loadBoard(memoryStorage({
      [RAID_BOARD_KEY]: JSON.stringify({ schemaVersion: 9, slots: [] }),
    }), BOSSES)).toEqual(emptyBoard());
  });

  it('知らないボス (シーズンが変わった) の枠は空に戻す', () => {
    const storage = memoryStorage();
    saveBoard(storage, withSlot(clashed(), 2, { boss: '前シーズンのボス', squad: squad('리타') }));
    const back = loadBoard(storage, BOSSES);
    expect(back.slots[0]!.boss).toBe('レイタンス');
    expect(back.slots[2]).toEqual({ boss: null, squad: squad() });
  });

  it('保存できなければ false (黙って飲まない)', () => {
    const broken = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(saveBoard(broken, clashed())).toBe(false);
    expect(saveBoard(null, clashed())).toBe(false);
  });

  it('withSlot は元を変えず、5枠に正規化する', () => {
    const before = emptyBoard();
    const after = withSlot(before, 1, { boss: 'モダニア', squad: ['리타', '크라운', '앨리스', '나가', '헬름', '余計'] });
    expect(before.slots[1]!.boss).toBeNull();
    expect(after.slots[1]!.squad).toEqual(['리타', '크라운', '앨리스', '나가', '헬름']);
    expect(clearSlot(after, 1).slots[1]).toEqual({ boss: null, squad: squad() });
  });
});

describe('被り', () => {
  it('2枠以上で使っている名前を、使った枠つきで出す', () => {
    const clashes = clashesOf(clashed());
    expect(clashes).toEqual([
      { name: '크라운', slots: [0, 1] },
      { name: '앨리스', slots: [0, 1] },
    ]);
    expect(usageOf(clashed()).get('리타')).toEqual([0]);
    // 被りは1人と数える: 5 + 5 − 2
    expect(usedCount(clashed())).toBe(8);
  });

  it('被りが無ければ空', () => {
    expect(clashesOf(emptyBoard())).toEqual([]);
    expect(usedCount(emptyBoard())).toBe(0);
  });

  it('名前を外しても位置は保つ (空き枠になる)', () => {
    expect(withoutNames(squad('리타', '크라운', '앨리스'), ['크라운'])).toEqual(['리타', '', '앨리스', '', '']);
  });

  it('代案は相手の枠ごとに「こちらから外す」「相手から譲る」の両方を作る', () => {
    const options = clashOptionsFor(clashed(), 1);
    expect(options).toHaveLength(1);
    expect(options[0]!.other).toBe(0);
    expect(options[0]!.names).toEqual(['앨리스', '크라운']);
    expect(options[0]!.here).toEqual(['', '', '헬름', '노아', '블랑']);
    expect(options[0]!.there).toEqual(['리타', '', '라피 : 레드 후드', '', '나가']);
    // 相手側から見ても同じ2人
    expect(clashOptionsFor(clashed(), 0)[0]!.names).toEqual(['크라운', '앨리스']);
    expect(clashOptionsFor(clashed(), 2)).toEqual([]);
  });
});

describe('候補', () => {
  const plans = (): ElementPlans => {
    let out = emptyPlans();
    // レイタンス (電撃) には鉄甲、トゥームストーン (灼熱) には水冷
    out = addPlan(out, '철갑', squad('리타', '크라운', '라피 : 레드 후드', '앨리스', '나가')).plans;
    out = addPlan(out, '철갑', squad('리타', '모더니아')).plans;
    out = addPlan(out, '수냉', squad('앨리스', '크라운', '헬름', '노아', '블랑')).plans;
    return out;
  };

  it('ボスに有利なコードの案を引く (エンジンの有利コード表どおり)', () => {
    expect(candidatesFor(bossOf('レイタンス'), plans()).element).toBe('철갑');
    expect(candidatesFor(bossOf('レイタンス'), plans()).plans).toHaveLength(2);
    expect(candidatesFor(bossOf('トゥームストーン'), plans()).element).toBe('수냉');
    expect(candidatesFor(bossOf('モダニア'), plans()).plans).toEqual([]);
  });

  it('空き枠の候補は、他の枠で使った人を外して作る (全員外れた案は出さない)', () => {
    let board = emptyBoard();
    board = withSlot(board, 0, { boss: 'レイタンス', squad: squad('리타', '크라운', '라피 : 레드 후드', '앨리스', '나가') });
    const candidates = openSlotCandidates(board, 1, UNION_SEASON.bosses, plans());
    const byKey = new Map(candidates.map((c) => [`${c.boss.name}:${c.planIndex}`, c]));
    // 鉄甲の案1は全員1凸目で使っているので出ない
    expect(byKey.has('レイタンス:0')).toBe(false);
    // 鉄甲の案2は 리타 だけ外れて残る
    expect(byKey.get('レイタンス:1')!.squad).toEqual(['', '모더니아', '', '', '']);
    expect(byKey.get('レイタンス:1')!.removed).toEqual(['리타']);
    // 水冷の案は 앨리스・크라운 が外れる
    expect(byKey.get('トゥームストーン:0')!.removed).toEqual(['앨리스', '크라운']);
    // 自分の枠 (index=1) に入っているものは「使った」に数えない
    board = withSlot(board, 1, { boss: 'トゥームストーン', squad: squad('헬름') });
    expect(openSlotCandidates(board, 1, UNION_SEASON.bosses, plans())
      .find((c) => c.boss.name === 'トゥームストーン')!.removed).toEqual(['앨리스', '크라운']);
  });
});

describe('被りなしで最大の3凸', () => {
  const c = (boss: string, score: number, ...names: string[]): Candidate => ({ boss, squad: squad(...names), score });

  it('合計が最大で、同じニケを2度使わない組み合わせを点数順に返す', () => {
    const picked = bestTriple([
      c('レイタンス', 4.1, '리타', '크라운'),       // 最強だが 크라운 が水冷案と被る
      c('トゥームストーン', 3.5, '앨리스', '크라운'),
      c('トゥームストーン', 2.9, '앨리스', '헬름'),   // 被らない代わりの案
      c('モダニア', 3.0, '라피 : 레드 후드', '나가'),
    ]);
    expect(picked.map((p) => [p.boss, p.score])).toEqual([
      ['レイタンス', 4.1], ['モダニア', 3.0], ['トゥームストーン', 2.9],
    ]);
  });

  it('3つ被りなしで選べなければ、2つ・1つと落とす', () => {
    const picked = bestTriple([
      c('レイタンス', 4.1, '리타'),
      c('トゥームストーン', 3.5, '리타'),
      c('モダニア', 1.0, '리타'),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.boss).toBe('レイタンス');
  });

  it('同じボスを2枠で殴るのは構わない (制約は同じニケを使わないことだけ)', () => {
    const picked = bestTriple([
      c('レイタンス', 4.0, '리타'),
      c('レイタンス', 3.0, '크라운'),
      c('レイタンス', 2.0, '앨리스'),
      c('モダニア', 1.0, '나가'),
    ]);
    expect(picked.map((p) => p.score)).toEqual([4.0, 3.0, 2.0]);
  });

  it('空の編成と候補なしは扱わない', () => {
    expect(bestTriple([])).toEqual([]);
    expect(bestTriple([c('レイタンス', 9)])).toEqual([]);
  });

  it('合計は未計算の枠を 0 として足す', () => {
    expect(totalOf([1, null, 2])).toBe(3);
  });
});

describe('盤面の戦闘条件', () => {
  const base = {
    duration: 180, enemyCode: '', enemyDef: 100, coreEnabled: true, hasParts: true,
    immuneWindows: [{ from: 1, to: 2 }], elementWindows: [{ from: 1, to: 2, code: '풍압' }],
  };

  it('ボスのコードと防御力だけ重ね、癖 (コア・パーツ・区間) は外す', () => {
    const battle = boardBattle(base, bossOf('レイタンス'));
    expect(battle.enemyCode).toBe('전격');
    expect(battle.enemyDef).toBe(bossOf('レイタンス').enemyDef);
    expect(battle.coreEnabled).toBe(false);
    expect(battle.hasParts).toBe(false);
    expect(battle.immuneWindows).toEqual([]);
    expect(battle.elementWindows).toEqual([]);
    expect(battle.duration).toBe(180);   // 戦闘時間は今の設定のまま
  });

  it('ボスが防御力を持たなければ今の値を使う', () => {
    expect(boardBattle(base, { name: 'x', elementCode: '풍압', enemyDef: null }).enemyDef).toBe(100);
  });
});

describe('属性を3つ選んで組む', () => {
  const c = (boss: string, score: number, ...names: string[]): Candidate => ({ boss, squad: squad(...names), score });

  it('属性ごとの候補から、同じニケを使わずに合計最大の組を返す (枠の属性は固定)', () => {
    const water1 = c('トゥームストーン', 3.5, '앨리스', '크라운');
    const water2 = c('トゥームストーン', 2.9, '헬름', '노아');
    const fire = c('モダニア', 3.0, '라피 : 레드 후드', '크라운');   // water1 と 크라운 が被る
    const picked = bestForElements([[water1, water2], [water1, water2], [fire]]);
    // 水冷×2 は別の案で埋まり、灼熱は 크라운 が空いた側と組む
    expect(picked.map((p) => p && [p.boss, p.score])).toEqual([
      ['トゥームストーン', 3.5], ['トゥームストーン', 2.9], null,
    ]);
    // fire は water1 (크라운) と被る → 3枠目は null。ただし合計最大なら被らない組み合わせを選ぶ
    const picked2 = bestForElements([[water2], [water1], [fire]]);
    expect(picked2.map((p) => p && p.boss)).toEqual(['トゥームストーン', 'トゥームストーン', null]);
  });

  it('どの枠も埋められる組み合わせがあれば、合計が下がってもそちらを選ぶ (埋まった枠数が最優先)', () => {
    const strong = c('レイタンス', 9.0, '리타');
    const alt = c('レイタンス', 1.0, '크라운');
    const needsRita = c('モダニア', 2.0, '리타');
    // [strong+null=9.0 (1枠空き)] より [alt+needsRita=3.0 (全部埋まる)] を取る
    expect(bestForElements([[strong, alt], [needsRita]]).map((p) => p?.score)).toEqual([1.0, 2.0]);
  });

  it('候補が無い枠は null、他の枠はそのまま組める', () => {
    const water = c('トゥームストーン', 3.5, '앨리스');
    expect(bestForElements([[], [water], []])).toEqual([null, water, null]);
    expect(bestForElements([])).toEqual([]);
  });

  it('属性から殴る相手のボスを引ける (有利コードの逆引き)', () => {
    expect(bossForElement('철갑', UNION_SEASON.bosses)!.name).toBe('レイタンス');
    expect(bossForElement('수냉', UNION_SEASON.bosses)!.name).toBe('トゥームストーン');
    expect(bossForElement('철갑', [])).toBeNull();
  });

  it('枠の個別設定スナップショットは保存・読み直しで保たれ、withSlot でも運ばれる', () => {
    const storage = memoryStorage();
    const cubed = { 리타: { cube: { name: '렐릭 베어 큐브', level: 15 } } } as never;
    let board = emptyBoard();
    board = withSlot(board, 0, { boss: 'レイタンス', squad: squad('리타'), characters: cubed });
    expect(board.slots[0]!.characters).toBe(cubed);
    saveBoard(storage, board);
    expect(loadBoard(storage, BOSSES).slots[0]!.characters).toEqual(cubed);
    // 形がおかしいスナップショットは捨てる (枠は残す)
    const raw = JSON.parse(JSON.stringify(board)) as { slots: Array<Record<string, unknown>> };
    raw.slots[0]!.characters = ['配列はだめ'];
    saveBoard(storage, raw as never);
    expect(loadBoard(storage, BOSSES).slots[0]!.characters).toBeUndefined();
    expect(loadBoard(storage, BOSSES).slots[0]!.boss).toBe('レイタンス');
  });

  it('空き枠の候補も案のスナップショットを運ぶ', () => {
    const cubed = { 앨리스: { cube: { name: '렐릭 베어 큐브', level: 15 } } } as never;
    let plans = emptyPlans();
    plans = addPlan(plans, '수냉', squad('앨리스', '헬름'), { characters: cubed }).plans;
    const board = emptyBoard();
    const found = openSlotCandidates(board, 0, UNION_SEASON.bosses, plans)
      .find((cand) => cand.boss.name === 'トゥームストーン')!;
    expect(found.characters).toEqual(cubed);
  });
});
