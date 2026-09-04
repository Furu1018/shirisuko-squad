import type { BattleSettings, DeckState, ElementWindow, PhaseWindow } from './types';

// 編成共有コード — **誰が編成されているか (キャラクター名) だけ**を1行のテキストで受け渡す。
// オーバーロード・攻撃力・突破・スキル・キューブ・お気に入り・コントロールといった個人スペックと
// 戦闘条件はあえて載せない: 他人のアカウントの数値が付いて出てはいけないし、受け取る側も
// 自分のスペックのまま編成だけを載せて試すのが目的だからだ。
//
// 形式 (NK2): 名前をそのまま載せるとハングル1文字が3バイトで、5デッキだとコードが700字を
// 超えて貼り付け先で切れる。そこで名前の代わりに**24ビットハッシュ**をバイナリで載せる。
//   [0] フラグ (bit0 = 5デッキモード)
//   [1] デッキ数
//   デッキごと: [埋まったスロットのビットマスク] + スロットあたりハッシュ3バイト
// ハッシュは名前だけから決まるので、キャラクターが追加されても昔のコードは壊れない
// (一覧の並び順に依存するインデックス方式との違い)。受け取る側は自分のキャラクター一覧を
// 同じハッシュで走査して名前を取り戻す。

const PREFIX = 'NK2-';
const LEGACY_PREFIX = 'NIKKE1-';
const SLOTS = 5;

export interface SharePayload {
  decks: Array<{ squad: string[] }>;
  fiveDeckMode: boolean;
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** 名前 → 24ビット FNV-1a ハッシュ。名前が同じなら常に同じ値になる。 */
export function nameHash(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 0xffffff;
}

const trimEmptyDecks = (decks: Array<{ squad: string[] }>): Array<{ squad: string[] }> => {
  const out = decks.map((deck) => ({ squad: deck.squad.map((name) => (name ?? '').trim()) }));
  while (out.length > 1 && !out[out.length - 1]!.squad.some((name) => name !== '')) out.pop();
  return out;
};

/** 編成を共有コード文字列に。名前だけを載せ、末尾の空デッキは切って短くする。 */
export function encodeShareCode(decks: DeckState[], fiveDeckMode: boolean): string {
  // 名前だけを載せる — deck.characters (個人スペック) は意図的に除く。
  const trimmed = trimEmptyDecks(decks.map((deck) => ({ squad: deck.squad })));
  const bytes: number[] = [fiveDeckMode ? 1 : 0, trimmed.length];
  for (const deck of trimmed) {
    let mask = 0;
    const filled: string[] = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const name = deck.squad[slot] ?? '';
      if (name !== '') { mask |= 1 << slot; filled.push(name); }
    }
    bytes.push(mask);
    for (const name of filled) {
      const hash = nameHash(name);
      bytes.push((hash >> 16) & 0xff, (hash >> 8) & 0xff, hash & 0xff);
    }
  }
  return PREFIX + toBase64Url(Uint8Array.from(bytes));
}

/**
 * 共有コードを解釈する。
 *
 * `catalogNames` はハッシュから名前を取り戻すのに使う (NK2 形式)。一覧に無いキャラクターは
 * 空スロットのまま残し、適用の段階で何人抜けたかを知らせる。
 * 旧形式 (NIKKE1-、名前を JSON で載せていたコード) も引き続き読むが、名前だけを取る。
 */
export function decodeShareCode(code: string, catalogNames: string[] = []): SharePayload {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('共有コードを入力してください。');

  if (trimmed.startsWith(LEGACY_PREFIX)) return decodeLegacy(trimmed.slice(LEGACY_PREFIX.length));

  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(body);
  } catch {
    throw new Error('共有コードを解釈できませんでした。コード全体をそのまま貼り付けたか確認してください。');
  }
  // 旧形式を接頭辞なしで貼り付けてくる場合があるので、base64 が JSON ならそちらに回す。
  if (bytes[0] === 0x7b) return decodeLegacy(body);
  if (bytes.length < 3) {
    throw new Error('共有コードが短すぎます。コード全体をそのまま貼り付けたか確認してください。');
  }

  const byHash = new Map<number, string>();
  for (const name of catalogNames) {
    const hash = nameHash(name);
    if (!byHash.has(hash)) byHash.set(hash, name);
  }

  const fiveDeckMode = (bytes[0]! & 1) === 1;
  const deckCount = bytes[1]!;
  if (deckCount < 1 || deckCount > 5) throw new Error('共有コードのデッキ数が正しくありません。');

  const decks: Array<{ squad: string[] }> = [];
  let cursor = 2;
  for (let d = 0; d < deckCount; d += 1) {
    if (cursor >= bytes.length) throw new Error('共有コードが途中で切れています。全体をもう一度コピーしてください。');
    const mask = bytes[cursor]!;
    cursor += 1;
    const squad: string[] = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      if ((mask & (1 << slot)) === 0) { squad.push(''); continue; }
      if (cursor + 2 >= bytes.length) {
        throw new Error('共有コードが途中で切れています。全体をもう一度コピーしてください。');
      }
      const hash = (bytes[cursor]! << 16) | (bytes[cursor + 1]! << 8) | bytes[cursor + 2]!;
      cursor += 3;
      squad.push(byHash.get(hash) ?? `\u0000${hash}`); // 知らないキャラクターは目印としてだけ残す
    }
    decks.push({ squad });
  }
  return { fiveDeckMode, decks };
}

/** 旧形式 (NIKKE1-): 名前だけを取る — 他人の数値が入っていても決して適用しない。 */
function decodeLegacy(body: string): SharePayload {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    throw new Error('共有コードを解釈できませんでした。コード全体をそのまま貼り付けたか確認してください。');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('共有コードの内容が正しくありません。');
  }
  const decks = (payload as SharePayload).decks;
  if (!Array.isArray(decks) || decks.length === 0) {
    throw new Error('共有コードに編成情報がありません。');
  }
  return {
    fiveDeckMode: Boolean((payload as SharePayload).fiveDeckMode),
    decks: decks.slice(0, 5).map((deck) => ({
      squad: Array.isArray(deck?.squad)
        ? deck.squad.slice(0, SLOTS).map((name) => (typeof name === 'string' ? name : ''))
        : [],
    })),
  };
}

/**
 * デコードした編成を現在のデッキに適用する。
 *
 * キャラクタースペックは**受け取る人のものを使う** — CSV ロスターを入れてあればその設定が
 * そのまま載り、無ければ計算機の既定値で回る。共有コードには名前しか入っていない。
 * カタログに無い名前 (未登録・相手のカスタムニケ) は外して知らせる。
 */
/**
 * どこに適用するか。
 *
 * `'all'` は盤面全体をコードの通りに入れ替える — コードに無いデッキは空にする。共有リンクや
 * 計算記録のように «あのときの盤面を丸ごと蘇らせる» という意味のときに使う。
 *
 * 数字を渡すと**そのデッキ1枠だけ**を変え、残りには触れない (0始まり)。デッキ1つを
 * やり取りすることのほうが実際には多いのに、以前はそれでも盤面を丸ごと覆って2〜5デッキが
 * 静かに消えていた。
 */
export type ApplyTarget = 'all' | number;

export function applyShareToDecks(
  payload: SharePayload,
  decks: DeckState[],
  isKnown: (name: string) => boolean,
  myOverrides?: (name: string) => DeckState['characters'][string] | undefined,
  target: ApplyTarget = 'all',
): { applied: number; skipped: string[] } {
  const skipped: string[] = [];
  let applied = 0;

  const fill = (deck: DeckState, shared: { squad: string[] } | undefined): void => {
    if (!shared) {
      deck.squad = ['', '', '', '', ''];
      deck.characters = {};
      return;
    }
    const squad = Array.from({ length: SLOTS }, (_, slot) => {
      const name = (shared.squad[slot] ?? '').trim();
      if (!name) return '';
      // ハッシュが引けなかった枠には \u0000 で目印を付けておいた — 名前が分からないので «不明なニケ» として数える。
      if (name.startsWith('\u0000')) { skipped.push('不明なニケ'); return ''; }
      if (!isKnown(name)) { skipped.push(name); return ''; }
      return name;
    });
    deck.squad = squad;
    deck.characters = {};
    for (const name of squad) {
      if (!name) continue;
      const mine = myOverrides?.(name);
      if (mine) deck.characters[name] = mine;
    }
    if (squad.some((name) => name !== '')) applied += 1;
  };

  if (target === 'all') {
    decks.forEach((deck, index) => fill(deck, payload.decks[index]));
  } else {
    // 1枠だけ受け取るときはコードの**先頭デッキ**をその場所に入れる。5デッキ分のコードを
    // 1枠に落としても、残りのデッキは消えない。
    const deck = decks[target];
    if (deck) fill(deck, payload.decks[0]);
  }
  return { applied, skipped: [...new Set(skipped)] };
}


// ── 戦闘条件の共有 (NK3) ──────────────────────────────────────────────────
// 編成コード (NK2) が «誰が編成されたか» を運ぶなら、こちらは «どんな状況で測ったか» を運ぶ。
// 回避・属性制限の区間まで手で書き写すのは面倒で、間違えやすいからだ。
//
// **コンソールはあえて外す** — アカウントの育成状態なので、他人の値が付いてくると自分の
// スペックで測った結果ではなくなる。編成コードが個人スペックを外すのと同じ理由だ。
//
// コードを短く保つ規則は三つ:
//   1. **既定値と同じ項目はそもそも載せない** — 大抵1〜2個しか変えないのでこれが一番効く
//   2. キーは2文字に縮める
//   3. 属性・時刻は数字に押し込む (コードは索引、時刻は0.1秒単位の整数)
// 既定設定なら `NK3-fQ` (8字) まで縮み、条件をいくつか変えても50〜80字に収まる。
// 項目が増えても昔のコードはそのまま読める — 無いキーは既定値で埋まるからだ。
const BATTLE_PREFIX = 'NK3-';

/**
 * 戦闘条件のうち共有する部分。**コンソールとシンクロレベルは入らない** — どちらも
 * アカウントの育成状態なので、他人の値が付いてくると自分のスペックで測った結果ではなくなる。
 */
export type BattleShare = Omit<BattleSettings, 'console' | 'synchroLevel'>;

// 属性リテラルは内部キー (共有コードの索引・エンジン契約)。翻訳厳禁 — 表示は element 対訳側で行う
const CODES: BattleSettings['enemyCode'][] = ['', '풍압', '수냉', '작열', '전격', '철갑'];

/** 載っていなければこの値と見なす。エンコードとデコードが同じ表を見る。 */
const BATTLE_DEFAULTS: BattleShare = {
  duration: 180,
  enemyDef: 31_784,
  enemyCode: '',
  coreEnabled: false,
  corePx: 52,
  hasParts: false,
  seed: 42,
  optimalRangeWeapons: [],
  normalHitCoeff: {},
  immuneWindows: [],
  elementWindows: [],
  rngMode: 'expected',
  immuneBlocksBurst: true,
  burstRegenTime: 2,
  burstReaction: 0.05,
};

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// 時刻は0.1秒単位の整数で載せる — 小数をそのまま載せると桁数が伸びるうえ、
// 浮動小数の残りかす (10.000000000000002) まで付いてくる。
const toTenth = (v: number): number => Math.round(v * 10);
const fromTenth = (v: number): number => Math.round(v) / 10;
const toHundredth = (v: number): number => Math.round(v * 100);
const fromHundredth = (v: number): number => Math.round(v) / 100;

/** 戦闘条件をコード1行に。コンソールは載せず、既定値と同じ項目は省く。 */
export function encodeBattleCode(
  battle: BattleSettings,
  coeffDefaults: Record<string, number> = {},
): string {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown, fallback: unknown) => {
    if (JSON.stringify(value) !== JSON.stringify(fallback)) out[key] = value;
  };
  const d = BATTLE_DEFAULTS;
  put('d', Math.trunc(battle.duration), d.duration);
  put('ed', Math.trunc(battle.enemyDef), d.enemyDef);
  put('ec', Math.max(0, CODES.indexOf(battle.enemyCode)), 0);
  put('ce', battle.coreEnabled ? 1 : 0, 0);
  put('cp', Math.trunc(battle.corePx), d.corePx);
  put('hp', battle.hasParts ? 1 : 0, 0);
  put('s', Math.trunc(battle.seed), d.seed);
  put('or', [...(battle.optimalRangeWeapons ?? [])].sort(), []);
  put('rm', battle.rngMode === 'random' ? 1 : 0, 0);
  put('ib', battle.immuneBlocksBurst ? 1 : 0, 1);
  put('br', toTenth(battle.burstRegenTime), toTenth(d.burstRegenTime));
  // 反応速度は0.05秒単位なので10分の1では収まらない — 100分の1で載せる。
  put('rt', toHundredth(battle.burstReaction), toHundredth(d.burstReaction));

  // 通常攻撃係数は**既定値と違う武器種だけ**載せる。6つ全部載せるとそれだけで
  // コードが60字以上長くなるのに、触る人はほとんどいない。
  const coeff: Record<string, number> = {};
  for (const [weapon, value] of Object.entries(battle.normalHitCoeff ?? {})) {
    const base = coeffDefaults[weapon] ?? 1;
    if (Math.abs(value - base) > 1e-9) coeff[weapon] = value;
  }
  put('hc', coeff, {});

  put('iw', (battle.immuneWindows ?? []).map((w) => [toTenth(w.from), toTenth(w.to)]), []);
  put('ew', (battle.elementWindows ?? []).map(
    (w) => [toTenth(w.from), toTenth(w.to), Math.max(1, CODES.indexOf(w.code))]), []);

  return BATTLE_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(out)));
}

const windowsOf = (raw: unknown, withCode: boolean): Array<PhaseWindow | ElementWindow> => {
  if (!Array.isArray(raw)) return [];
  const out: Array<PhaseWindow | ElementWindow> = [];
  for (const item of raw.slice(0, 20)) {
    if (!Array.isArray(item)) continue;
    const from = fromTenth(num(item[0], 0, 1800, -1));
    const to = fromTenth(num(item[1], 0, 1800, -1));
    if (from < 0 || to < 0 || from >= to) continue;   // 使えない区間は黙って捨てる
    if (!withCode) { out.push({ from, to }); continue; }
    const code = CODES[num(item[2], 1, 5, 0)];
    if (!code) continue;
    out.push({ from, to, code });
  }
  return out;
};

/**
 * 戦闘条件コードを解釈する。無いキーは既定値で埋め、範囲を外れた値も
 * 既定値に戻す — 他人が作ったコードが計算を壊してはいけない。
 */
export function decodeBattleCode(code: string): BattleShare {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('戦闘条件コードを入力してください。');
  const body = trimmed.startsWith(BATTLE_PREFIX)
    ? trimmed.slice(BATTLE_PREFIX.length) : trimmed;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Record<string, unknown>;
  } catch {
    throw new Error('戦闘条件コードを解釈できませんでした。コード全体をそのまま貼り付けたか確認してください。');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('戦闘条件コードの内容が正しくありません。');
  }

  const d = BATTLE_DEFAULTS;
  const coeff: Record<string, number> = {};
  if (raw.hc && typeof raw.hc === 'object') {
    for (const [key, value] of Object.entries(raw.hc as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 2) coeff[key] = n;
    }
  }

  return {
    duration: Math.trunc(num(raw.d, 10, 180, d.duration)),
    enemyDef: Math.trunc(num(raw.ed, 0, 999_999, d.enemyDef)),
    enemyCode: CODES[Math.trunc(num(raw.ec, 0, 5, 0))] ?? '',
    coreEnabled: Boolean(raw.ce),
    corePx: Math.trunc(num(raw.cp, 0, 1_000, d.corePx)),
    hasParts: Boolean(raw.hp),
    seed: Math.trunc(num(raw.s, 0, 2_147_483_647, d.seed)),
    optimalRangeWeapons: Array.isArray(raw.or)
      ? (raw.or as unknown[]).filter((w): w is string => typeof w === 'string')
      : [],
    normalHitCoeff: coeff,
    immuneWindows: windowsOf(raw.iw, false) as PhaseWindow[],
    elementWindows: windowsOf(raw.ew, true) as ElementWindow[],
    rngMode: raw.rm ? 'random' : 'expected',
    immuneBlocksBurst: raw.ib === undefined ? d.immuneBlocksBurst : Boolean(raw.ib),
    burstRegenTime: fromTenth(num(raw.br, 0, 200, toTenth(d.burstRegenTime))),
    // 無いキーは既定値になる — この項目ができる前に作られたコードは0.05秒として読まれる。
    burstReaction: fromHundredth(num(raw.rt, 0, 300, toHundredth(d.burstReaction))),
  };
}


// ── ユニオンレイド盤面の共有 (NK4) ───────────────────────────────────────────
// ユニオンレイドはボスが5体いて、そのたびに条件もデッキも違う。これまでは枠ごとに
// NK3 を1つと NK2 を3つ手で貼り付ける必要があり、盤面1つを移すのに20回貼り付けていた。
// このコードはその20個を**1つに束ねる**。
//
// 載せるのは «コード文字列» だけだ — NK3・NK2 を展開せず、本文のバイトをそのまま載せる。
// だから戦闘条件に項目が増えてもこのファイルには手を入れずに済み、昔の NK4 もそのまま読める。
//
// **ユニオンメンバーの名簿は載せない。** ニックネーム・openid は他人のアカウント情報だ。
// 共有されるのはボスの名前と条件、そしてどんな編成を回したかまでだ。
//
// 形式:
//   [0] 予備フラグ (今は0)
//   [1] ボス数
//   ボスごと: [フラグ (bit0=オン)] [名前の長さ] 名前 UTF-8
//             [NK3 本文の長さ] NK3 本文
//             [デッキ数] (デッキごとに [NK2 本文の長さ] NK2 本文)
const UNION_PREFIX = 'NK4-';

/** 名前はこの長さ (UTF-8 バイト) で切る。長さを1バイトで載せるからだ。 */
const UNION_NAME_MAX = 60;

/** ユニオンレイドのボス1枠。コードだけを持つ — 中身の意味は NK3・NK2 が知っている。 */
export interface UnionBossShare {
  name: string;
  enabled: boolean;
  /** 戦闘条件コード (`NK3-…`)。空なら条件を決めていない枠だ。 */
  battleCode: string;
  /** デッキコード (`NK2-…`)。空文字列が空の枠だ — 位置は守る。 */
  deckCodes: string[];
}

export interface UnionShare {
  bosses: UnionBossShare[];
}

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

/** `NK3-`・`NK2-` を外して本文のバイトだけに。接頭辞が違えば空のバイト列と見なす。 */
function bodyBytes(code: string, prefix: string): Uint8Array {
  const trimmed = code.trim();
  if (!trimmed.startsWith(prefix)) return new Uint8Array(0);
  try {
    return fromBase64Url(trimmed.slice(prefix.length));
  } catch {
    return new Uint8Array(0);
  }
}

/** 末尾の空きを切り落とす。5枠のうち2つしか使わなければコードもその分短くなる。 */
function trimTail<T>(list: T[], isEmpty: (item: T) => boolean): T[] {
  const out = [...list];
  while (out.length > 0 && isEmpty(out[out.length - 1]!)) out.pop();
  return out;
}

/** ユニオンレイド盤面1つをコード1行に。空の枠は切って短くする。 */
export function encodeUnionCode(share: UnionShare): string {
  const bosses = trimTail(share.bosses, (boss) =>
    boss.name.trim() === ''
    && boss.battleCode.trim() === ''
    && boss.deckCodes.every((code) => code.trim() === ''));

  const bytes: number[] = [0, bosses.length];
  for (const boss of bosses) {
    bytes.push(boss.enabled ? 1 : 0);

    let name = utf8.encode(boss.name.trim());
    if (name.length > UNION_NAME_MAX) name = name.slice(0, UNION_NAME_MAX);
    bytes.push(name.length, ...name);

    const battle = bodyBytes(boss.battleCode, BATTLE_PREFIX);
    bytes.push(battle.length, ...battle);

    const decks = trimTail(boss.deckCodes, (code) => code.trim() === '');
    bytes.push(decks.length);
    for (const code of decks) {
      const deck = bodyBytes(code, PREFIX);
      bytes.push(deck.length, ...deck);
    }
  }
  return UNION_PREFIX + toBase64Url(Uint8Array.from(bytes));
}

/** ユニオン盤面コードを読む。切れたコードは «どこで途切れたか» ではなく1行で知らせる。 */
export function decodeUnionCode(code: string): UnionShare {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('ユニオン盤面コードを入力してください。');
  if (!trimmed.startsWith(UNION_PREFIX)) {
    throw new Error('ユニオン盤面コードは「NK4-」で始まります。条件コード(NK3-)や編成コード(NK2-)は各枠に個別に貼り付けてください。');
  }

  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(trimmed.slice(UNION_PREFIX.length));
  } catch {
    throw new Error('ユニオン盤面コードを解釈できませんでした。コード全体をそのまま貼り付けたか確認してください。');
  }

  let cursor = 0;
  const need = (count: number): void => {
    if (cursor + count > bytes.length) {
      throw new Error('ユニオン盤面コードが途中で切れています。コード全体をそのまま貼り付けたか確認してください。');
    }
  };
  const take = (count: number): Uint8Array => {
    need(count);
    const out = bytes.slice(cursor, cursor + count);
    cursor += count;
    return out;
  };
  const byte = (): number => {
    need(1);
    return bytes[cursor++]!;
  };

  need(2);
  cursor += 1;                     // 予備フラグ — 今は読まない
  const count = byte();
  const bosses: UnionBossShare[] = [];
  for (let i = 0; i < count; i += 1) {
    const flags = byte();
    const name = utf8Decode.decode(take(byte()));
    const battle = take(byte());
    const deckCount = byte();
    const deckCodes: string[] = [];
    for (let d = 0; d < deckCount; d += 1) {
      const deck = take(byte());
      deckCodes.push(deck.length > 0 ? PREFIX + toBase64Url(deck) : '');
    }
    bosses.push({
      name,
      enabled: (flags & 1) === 1,
      battleCode: battle.length > 0 ? BATTLE_PREFIX + toBase64Url(battle) : '',
      deckCodes,
    });
  }
  return { bosses };
}
