import { describe, expect, it } from 'vitest';

import type { StorageLike } from './cache';
import {
  SYNC_META_KEY, canReSync, loadSyncMeta, saveSyncMeta, syncAgoText, syncSummary, type SyncMeta,
} from './sync-meta';

const memoryStorage = (seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...seed };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
  } as StorageLike & { data: Record<string, string> };
};

const meta = (over: Partial<SyncMeta> = {}): SyncMeta => ({
  schemaVersion: 1,
  source: 'blablalink',
  at: '2026-09-01T12:00:00.000Z',
  matched: 187,
  profileUrl: 'https://www.blablalink.com/user?openid=abc',
  ...over,
});

describe('取込の記録', () => {
  it('保存して読み直せる', () => {
    const storage = memoryStorage();
    saveSyncMeta(storage, meta());
    expect(loadSyncMeta(storage)).toEqual(meta());
  });

  it('保存キーは nikke- 始まり (本家PADと同一オリジンで localStorage を共有するため)', () => {
    expect(SYNC_META_KEY.startsWith('nikke-')).toBe(true);
  });

  it('記録が無ければ null', () => {
    expect(loadSyncMeta(memoryStorage())).toBeNull();
    expect(loadSyncMeta(null)).toBeNull();
  });

  it('壊れた記録・知らない版・不正な日付は捨てて null にする (起動を止めない)', () => {
    expect(loadSyncMeta(memoryStorage({ [SYNC_META_KEY]: '{{{' }))).toBeNull();
    expect(loadSyncMeta(memoryStorage({ [SYNC_META_KEY]: JSON.stringify({ ...meta(), schemaVersion: 2 }) }))).toBeNull();
    expect(loadSyncMeta(memoryStorage({ [SYNC_META_KEY]: JSON.stringify({ ...meta(), source: 'nazo' }) }))).toBeNull();
    expect(loadSyncMeta(memoryStorage({ [SYNC_META_KEY]: JSON.stringify({ ...meta(), at: 'いつか' }) }))).toBeNull();
  });

  it('壊れた件数は 0 に倒す', () => {
    const storage = memoryStorage({ [SYNC_META_KEY]: JSON.stringify({ ...meta(), matched: -5 }) });
    expect(loadSyncMeta(storage)!.matched).toBe(0);
  });

  it('保存できない環境でも例外にしない', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} } as StorageLike;
    expect(() => saveSyncMeta(broken, meta())).not.toThrow();
  });
});

describe('ワンボタン更新の可否', () => {
  it('Blablalink でアドレスが残っていれば取り直せる', () => {
    expect(canReSync(meta())).toBe(true);
  });

  it('CSV はファイルを選び直す必要があるので取り直せない', () => {
    expect(canReSync(meta({ source: 'csv', profileUrl: undefined }))).toBe(false);
  });

  it('アドレスを覚えていなければ取り直せない', () => {
    expect(canReSync(meta({ profileUrl: undefined }))).toBe(false);
    expect(canReSync(null)).toBe(false);
  });
});

describe('経過時間の文言', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  const ago = (iso: string) => syncAgoText(iso, now);

  it('分・時間・日で読ませる', () => {
    expect(ago('2026-09-01T11:59:30.000Z')).toBe('たった今');
    expect(ago('2026-09-01T11:30:00.000Z')).toBe('30分前');
    expect(ago('2026-09-01T09:00:00.000Z')).toBe('3時間前');
    expect(ago('2026-08-27T12:00:00.000Z')).toBe('5日前');
  });

  it('30日以上前は日付にする', () => {
    expect(ago('2026-06-01T12:00:00.000Z')).toMatch(/2026/);
  });

  it('端末の時計がずれて未来になっていても壊れない', () => {
    expect(ago('2026-09-01T13:00:00.000Z')).toBe('たった今');
  });

  it('日付として読めなければ空文字', () => {
    expect(ago('いつか')).toBe('');
  });
});

describe('要約の一行', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z');

  it('取込元・経過・件数を並べる', () => {
    expect(syncSummary(meta({ at: '2026-09-01T09:00:00.000Z' }), now)).toBe('Blablalink · 3時間前 · 187名');
  });

  it('CSV も同じ形で出す', () => {
    expect(syncSummary(meta({ source: 'csv', at: '2026-09-01T11:00:00.000Z', matched: 42 }), now))
      .toBe('CSV · 1時間前 · 42名');
  });

  it('記録が無ければ空文字', () => {
    expect(syncSummary(null, now)).toBe('');
  });
});
