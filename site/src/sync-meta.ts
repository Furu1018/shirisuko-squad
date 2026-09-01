// 取込の履歴 (いつ・どこから・何名) — しりすこスクワッド。
//
// 「初回は取り込む、次からは飛ばす。ゲーム内で育てたらワンボタンで取り直す」を成り立たせるための最小の記録。
// プロフィールのアドレスを覚えておくのは、更新のたびに貼り直させないため — このブラウザにしか残らない。
//
// 保存キーは `nikke-` で始める規約。GitHub Pages では本家しりすこPADと**同一オリジン**
// (furu1018.github.io) で localStorage を共有するため、接頭辞が衝突よけになっている。
import type { StorageLike } from './cache';

export const SYNC_META_KEY = 'nikke-sync-v1';

/**
 * どこから取り込んだか。
 * - blablalink: プロキシ経由。アドレスを覚えられるのでワンボタン更新ができる
 * - snippet: 自分のブラウザでスニペットを実行して貼り付けた。取り直すには実行し直しが要る
 * - csv: Letsdoro の CSV。ファイルを選び直す必要がある
 */
export type SyncSource = 'blablalink' | 'snippet' | 'csv';

export interface SyncMeta {
  /** 形が変わったら上げる。読めない版は捨てて「未取込」に倒す。 */
  schemaVersion: 1;
  source: SyncSource;
  /** 取り込んだ時刻 (ISO)。 */
  at: string;
  /** 計算機が扱えたニケの数。 */
  matched: number;
  /** Blablalink のプロフィールアドレス。ワンボタン更新はこれを使う。 */
  profileUrl?: string;
  /** 選んだサーバー (area)。未指定 = 自動。 */
  area?: number;
}

/** 記録が「ワンボタンで取り直せる」形か。CSV はファイルを選び直す必要があるので false。 */
export function canReSync(meta: SyncMeta | null): meta is SyncMeta & { profileUrl: string } {
  return Boolean(meta && meta.source === 'blablalink' && meta.profileUrl);
}

export function loadSyncMeta(storage: StorageLike | null | undefined): SyncMeta | null {
  try {
    const raw = storage?.getItem(SYNC_META_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SyncMeta>;
    // 他人のブラウザに何が入っているか分からない。形を見てから使う。
    if (data?.schemaVersion !== 1) return null;
    if (data.source !== 'blablalink' && data.source !== 'snippet' && data.source !== 'csv') return null;
    if (typeof data.at !== 'string' || Number.isNaN(Date.parse(data.at))) return null;
    return {
      schemaVersion: 1,
      source: data.source,
      at: data.at,
      matched: typeof data.matched === 'number' && data.matched >= 0 ? data.matched : 0,
      ...(typeof data.profileUrl === 'string' && data.profileUrl ? { profileUrl: data.profileUrl } : {}),
      // サーバー番号は整数のときだけ引き継ぐ。小数や NaN をそのまま再取得に渡すと
      // どのサーバーにも一致せず「ニケ一覧が空です」で失敗する — 落とせば自動選択に戻る
      ...(typeof data.area === 'number' && Number.isInteger(data.area) && data.area > 0
        ? { area: data.area } : {}),
    };
  } catch {
    return null;   // 壊れていても起動は止めない — 「まだ取り込んでいない」として扱う
  }
}

export function saveSyncMeta(storage: StorageLike | null | undefined, meta: SyncMeta): void {
  try {
    storage?.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch { /* 保存できなくても取込結果そのものは使える */ }
}

/**
 * 「いつ取り込んだか」の一行。時計のずれや古い記録で不自然な値 (未来・巨大な日数) が
 * 出ないよう、幅を持たせて丸める。
 */
export function syncAgoText(at: string, now: number = Date.now()): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 0) return 'たった今';        // 端末の時計がずれている
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}日前`;
  return new Date(then).toLocaleDateString('ja-JP');
}

/** 取込元の呼び名。画面にそのまま出す。 */
export const SOURCE_LABELS: Record<SyncSource, string> = {
  blablalink: 'Blablalink',
  snippet: 'Blablalink (自分で取得)',
  csv: 'CSV',
};

/** 「Blablalink · 3時間前 · 187名」。記録が無ければ空文字。 */
export function syncSummary(meta: SyncMeta | null, now: number = Date.now()): string {
  if (!meta) return '';
  const ago = syncAgoText(meta.at, now);
  return [SOURCE_LABELS[meta.source], ago, `${meta.matched}名`].filter(Boolean).join(' · ');
}
