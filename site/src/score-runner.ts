// 「計算 → キャッシュ → 記憶」をまとめて回すところ。**DOM を知らない。**
//
// 同じ流れが盤面と保存候補タブの2箇所に別々に書かれていた
// (組み立て → 検証 → キャッシュを見る → simulate → 覚える)。
// 片方だけ直すと «同じ編成なのに画面で数字が違う» が起きるので、ここに寄せる。
//
// 依存 (simulate・キャッシュ・進捗の出し先) はすべて注入する。jsdom なしで試せる。
import type { SimulationRequest, SimulationResult } from './types';

/** 1件ぶんの仕事。`key` が同じものは同じ計算なので1度しか回さない。 */
export interface ScoreJob {
  key: string;
  request: SimulationRequest;
  /** 組み立ての時点で分かっている不備 (空欄・範囲外)。あれば回さずに失敗させる。 */
  problems?: readonly string[];
}

export interface ScoreDeps {
  simulate: (request: SimulationRequest) => Promise<SimulationResult>;
  /** 計算結果の保管。無ければ毎回 simulate する。 */
  cache?: {
    get: (key: string) => SimulationResult | null | undefined;
    set: (key: string, result: SimulationResult) => void;
  };
  /** 何レーンで回すか。1 なら順番に。 */
  lanes?: number;
  /** 進み具合。押したボタンや状態行に出す。 */
  onProgress?: (done: number, total: number) => void;
}

/** 同じ計算を2度回さない。順番は最初に現れた順のまま。 */
export function dedupeJobs(jobs: ReadonlyArray<ScoreJob | null>): ScoreJob[] {
  const seen = new Set<string>();
  const out: ScoreJob[] = [];
  for (const job of jobs) {
    if (!job || seen.has(job.key)) continue;
    seen.add(job.key);
    out.push(job);
  }
  return out;
}

/**
 * まとめて回して、鍵ごとの点数を返す。
 *
 * **1件の失敗で全体を止めない** — 3つ試して1つだけ組めない、はふつうに起きる。
 * 失敗は `failures` に集めて返し、呼び手が言い方を決める。
 */
export async function runScores(
  jobs: ReadonlyArray<ScoreJob | null>,
  deps: ScoreDeps,
): Promise<{ scores: Map<string, number>; failures: Map<string, string> }> {
  const queue = dedupeJobs(jobs);
  const scores = new Map<string, number>();
  const failures = new Map<string, string>();
  if (queue.length === 0) return { scores, failures };

  let done = 0;
  let next = 0;
  deps.onProgress?.(0, queue.length);

  const lane = async () => {
    while (next < queue.length) {
      const job = queue[next]!;
      next += 1;
      try {
        if (job.problems && job.problems.length > 0) throw new Error(job.problems[0]);
        const cached = deps.cache?.get(job.key);
        const result = cached ?? await deps.simulate(job.request);
        if (!cached) deps.cache?.set(job.key, result);
        scores.set(job.key, result.squadTotal);
      } catch (error) {
        failures.set(job.key, error instanceof Error ? error.message : String(error));
      }
      done += 1;
      deps.onProgress?.(done, queue.length);
    }
  };

  const lanes = Math.max(1, Math.min(queue.length, deps.lanes ?? 1));
  await Promise.all(Array.from({ length: lanes }, lane));
  return { scores, failures };
}
