// jsdom を使わない。DOM を知らないことが、この分離の目的そのもの。
import { describe, expect, it, vi } from 'vitest';

import { dedupeJobs, runScores, type ScoreJob } from './score-runner';
import type { SimulationRequest, SimulationResult } from './types';

const request = (squad: string[]): SimulationRequest => ({
  squad, duration: 180, enemyDef: 31_784, enemyCode: '전격', corePx: 0, hasParts: false, seed: 1,
});
const job = (key: string, squad: string[] = ['a']): ScoreJob => ({ key, request: request(squad) });
const result = (total: number): SimulationResult => ({ squadTotal: total } as SimulationResult);

describe('計算をまとめて回す', () => {
  it('鍵ごとの点数を返す', async () => {
    const simulate = vi.fn(async (r: SimulationRequest) => result(r.squad.length * 100));
    const { scores, failures } = await runScores([job('a', ['x']), job('b', ['x', 'y'])], { simulate });
    expect([...scores]).toEqual([['a', 100], ['b', 200]]);
    expect(failures.size).toBe(0);
  });

  it('**同じ計算は1度しか回さない**', async () => {
    const simulate = vi.fn(async () => result(1));
    await runScores([job('same'), job('same'), null, job('other')], { simulate });
    expect(simulate).toHaveBeenCalledTimes(2);
  });

  it('キャッシュにあれば simulate を呼ばない', async () => {
    const simulate = vi.fn(async () => result(9));
    const store = new Map([['hit', result(42)]]);
    const { scores } = await runScores([job('hit'), job('miss')], {
      simulate,
      cache: { get: (k) => store.get(k), set: (k, v) => { store.set(k, v); } },
    });
    expect(scores.get('hit')).toBe(42);
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(store.has('miss')).toBe(true);   // 計算したものは残る
  });

  it('**1件失敗しても残りは回る** (3つ試して1つだけ組めない、は普通に起きる)', async () => {
    const simulate = vi.fn(async (r: SimulationRequest) => {
      if (r.squad[0] === 'bad') throw new Error('編成が組めません');
      return result(5);
    });
    const { scores, failures } = await runScores(
      [job('ok1', ['x']), job('ng', ['bad']), job('ok2', ['y'])], { simulate });
    expect([...scores.keys()]).toEqual(['ok1', 'ok2']);
    expect(failures.get('ng')).toBe('編成が組めません');
  });

  it('組み立ての時点で不備が分かっていれば回さない', async () => {
    const simulate = vi.fn(async () => result(1));
    const { scores, failures } = await runScores(
      [{ ...job('bad'), problems: ['スキルレベルが範囲外です'] }], { simulate });
    expect(simulate).not.toHaveBeenCalled();
    expect(scores.size).toBe(0);
    expect(failures.get('bad')).toBe('スキルレベルが範囲外です');
  });

  it('進み具合を 0 から件数まで知らせる', async () => {
    const seen: string[] = [];
    await runScores([job('a'), job('b')], {
      simulate: async () => result(1),
      onProgress: (done, total) => seen.push(`${done}/${total}`),
    });
    expect(seen).toEqual(['0/2', '1/2', '2/2']);
  });

  it('並列でも全件回る', async () => {
    let running = 0;
    let peak = 0;
    const simulate = async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((done) => { setTimeout(done, 5); });
      running -= 1;
      return result(1);
    };
    const jobs = Array.from({ length: 6 }, (_, i) => job(`j${i}`, [`c${i}`]));
    const { scores } = await runScores(jobs, { simulate, lanes: 3 });
    expect(scores.size).toBe(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('空でも落ちない', async () => {
    const { scores } = await runScores([null, null], { simulate: async () => result(1) });
    expect(scores.size).toBe(0);
  });

  it('dedupeJobs は最初に現れた順を保つ', () => {
    expect(dedupeJobs([job('b'), job('a'), job('b'), null]).map((j) => j.key)).toEqual(['b', 'a']);
  });
});
