// この端末のデータを**別の端末へ運ぶ**ための包み。
//
// 育成データは localStorage にしか無いので、PC で取り込んでもスマホには来ない。
// スマホは F12 が使えずスニペットを実行できないので、**PC で書き出して貼る**道が要る
// (実使用で「データ列を控えていない」「スマホでも見たい」が出た)。
//
// 運ぶのは**自分の持ち物のうち durable なもの**だけ:
//   育成 (roster) · 取込の記録 · お気に入り · 保存候補 · 盤面 · シンクロ/コンソール
// 運ばないもの: 計算結果のキャッシュ (端末で作り直せる)、並列台数や詳細表示 (端末ごとの好み)。
//
// 形は取り込みと同じ gzip+base64。接頭辞だけ変えて取り違えを防ぐ。
// **Blob.stream() は jsdom に無い**ので Response の body を使う (実装ごと動かなくなった前例あり)。

export const TRANSFER_PREFIX = 'NKX1-';

export interface TransferBox {
  schemaVersion: 1;
  /** 書き出した時刻 (ISO)。貼る側で「いつの端末のものか」を出す。 */
  at: string;
  /** 育成 (キャラ名 → 個別設定)。中身は端末側の型に任せる。 */
  roster: Record<string, unknown>;
  /** 取込の記録 (sync-meta)。無ければ省く。 */
  sync?: unknown;
  /** よく使うニケの印。 */
  favorites?: string[];
  /** 保存候補 (属性ごと)。 */
  plans?: unknown;
  /** 3凸の盤面。 */
  board?: unknown;
  /** シンクロレベルとコンソール (アカウント単位の育成)。 */
  account?: { synchroLevel?: number; console?: unknown };
}

const gzip = async (text: string): Promise<Uint8Array> => {
  const body = new Response(text).body;
  if (!body) throw new Error('この環境では書き出せません。');
  const stream = body.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const gunzip = async (bytes: Uint8Array): Promise<string> => {
  // Uint8Array をそのまま渡すと型が通らない環境がある。中身の ArrayBuffer を渡す。
  const body = new Response(bytes.buffer as ArrayBuffer).body;
  if (!body) throw new Error('この環境では読み込めません。');
  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
};

/** 書き出す。圧縮できない環境では生の JSON を返す (貼る側は両方受ける)。 */
export async function packTransfer(box: TransferBox): Promise<string> {
  const json = JSON.stringify(box);
  if (typeof CompressionStream !== 'function') return json;
  const bytes = await gzip(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return TRANSFER_PREFIX + btoa(binary);
}

/**
 * 読み込む。貼り付けは人がやるので、途中で切れた・別のものを貼った、が普通に起きる。
 * **何を貼り直せばよいか**が分かる文言で投げる。
 */
export async function parseTransfer(text: string): Promise<TransferBox> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('貼り付けた内容が空です。');

  let json = trimmed;
  if (trimmed.startsWith(TRANSFER_PREFIX)) {
    try {
      const binary = atob(trimmed.slice(TRANSFER_PREFIX.length));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      json = await gunzip(bytes);
    } catch {
      throw new Error('データの展開に失敗しました。コピーが途中で切れていないか確認してください。');
    }
  }

  let box: Partial<TransferBox> & { profile?: unknown };
  try {
    box = JSON.parse(json) as Partial<TransferBox>;
  } catch {
    throw new Error('内容を認識できませんでした。書き出したものを丸ごと貼り付けてください。');
  }

  // Blablalink から取ったものを貼られたときは、何が違うのかを言う
  if (box.profile) {
    throw new Error('Blablalink から取り込んだデータのようです。そのまま「取り込む」で使えます。');
  }
  if (box.schemaVersion !== 1 || !box.roster || typeof box.roster !== 'object') {
    throw new Error('内容を認識できませんでした。書き出したものを丸ごと貼り付けてください。');
  }
  const names = Object.keys(box.roster);
  if (names.length === 0) throw new Error('育成データが入っていません。');

  return {
    schemaVersion: 1,
    at: typeof box.at === 'string' ? box.at : new Date().toISOString(),
    roster: box.roster as Record<string, unknown>,
    ...(box.sync ? { sync: box.sync } : {}),
    ...(Array.isArray(box.favorites)
      ? { favorites: box.favorites.filter((n): n is string => typeof n === 'string' && n !== '') }
      : {}),
    ...(box.plans ? { plans: box.plans } : {}),
    ...(box.board ? { board: box.board } : {}),
    ...(box.account && typeof box.account === 'object' ? { account: box.account } : {}),
  };
}
