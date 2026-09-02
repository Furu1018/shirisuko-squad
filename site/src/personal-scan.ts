// 自分の育成状況を「自分のブラウザで」取ってくる道。
//
// Blablalink の照会 API は (1) CORS を返さないのでブラウザから直接読めず、
// (2) ログイン済みのセッションを要求する (Cookie 無しは `300001 game not login`)。
// そのため静的サイトからは呼べず、本家は Cloudflare Worker に運営者の Cookie を
// 持たせて代理照会させている。
//
// こちらはその代わりに、**指揮官自身のブラウザ**で1回だけ取ってもらう。
//
// - Worker もデプロイも要らない (Cookie の入れ直しという運用負債が消える)
// - **プロフィールを公開にしなくてよい** — 自分のセッションなので自分のデータは読める
//   (Worker 方式は «他人のセッション» なので公開プロフィールしか見えない)
// - 照会は本人名義で飛ぶので、運営者アカウントが凍結される心配も無い
//
// 代償は「コンソールにコードを貼る」手順そのもの。これは詐欺の常套手口と同じ形なので、
// 画面には**貼るコードを全文出して**「自分で読んでから貼る」「他所で配られた似たコードは
// 貼らない」と添える。CSV の道も残す (読まずに貼らせないための逃げ道)。
import type { RawArea, RawProfile } from './blablalink';

/** 直接取得したデータの目印。`NKU1-` (ユニオン名簿) と混ざらないよう別にする。 */
export const PERSONAL_PREFIX = 'NKP1-';

/** 公式サーバー。所持ニケが最も多いところを自動で選ぶ (Worker と同じ考え方)。 */
const AREAS = [83, 81, 84, 82, 85];

/**
 * コンソールに貼るスニペット。**blablalink.com を開いた状態で**実行する。
 *
 * 自分の openid は `User/GetUserInfoNew` が返すので、プロフィールのアドレスを
 * 貼ってもらう必要すら無い。サーバーは所持ニケが最多のところを選ぶ。
 */
export const PERSONAL_SNIPPET = `await (async () => {
  const call = async (route, body, base) => (await fetch('https://api.blablalink.com/api/' + (base || 'game/proxy/') + route, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ja',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ja', env: 'prod' }) },
    body: JSON.stringify(body),
  })).json();
  const gap = (ms) => new Promise((done) => setTimeout(done, ms));

  // 自分の openid を突き止める。
  // **GetUserInfoNew の値を当てにしない** — 実機で試したら InvalidUid で全滅した
  // (あの応答が返すのはサイト側の識別子で、ゲームの照会には使えない)。
  // 候補を集めて、**実際に照会が通ったものを採用する**。当て推量を残さない。
  const digitsOf = (raw) => {
    if (!raw) return '';
    let text = String(raw);
    try {
      const guess = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
      if (/^[\\x20-\\x7e]+$/.test(guess)) text = guess;   // アドレスの openid は base64 で包まれている
    } catch (e) { /* base64 でなければそのまま */ }
    const hit = text.match(/(\\d{6,})\\s*$/);
    return hit ? hit[1] : '';
  };

  const candidates = [];
  const add = (value, where) => {
    const id = digitsOf(value);
    if (id && !candidates.some((c) => c.id === id)) candidates.push({ id: id, where: where });
  };
  // ① いま開いているページのアドレス (自分のプロフィールを開いていればこれが確実)
  try { add(new URL(location.href).searchParams.get('openid'), 'アドレスバー'); } catch (e) {}
  // ② 応答の中の «識別子らしきもの» を片っ端から
  const me = await call('User/GetUserInfoNew', {}, 'ugc/proxy/standalonesite/');
  const info = (me.data || {}).info || me.data || {};
  for (const key of Object.keys(info)) {
    if (/(openid|open_id|uid|role_id|game_id)$/i.test(key)) add(info[key], 'GetUserInfoNew.' + key);
  }
  if (candidates.length === 0) {
    console.error('自分の識別子が分かりませんでした。**自分のプロフィールページ**'
      + ' (blablalink.com/user?openid=... ) を開いた状態で、そのタブで実行してください。');
    return;
  }

  // 実際に照会して、通ったものだけを採る
  let openid = '';
  for (const cand of candidates) {
    await gap(200);
    const probe = await call('Game/GetUserCharacters', { intl_open_id: cand.id, nikke_area_id: 81 });
    console.log('識別子の候補 ' + cand.id + ' (' + cand.where + ') → ' + (probe.code === 0 ? '使える' : (probe.msg || probe.code)));
    if (probe.code === 0) { openid = cand.id; break; }
  }
  if (!openid) {
    console.error('どの識別子でも照会できませんでした。**自分のプロフィールページ**'
      + ' (blablalink.com/user?openid=... ) を開いた状態で実行してください。'
      + ' 見つかった候補: ' + candidates.map((c) => c.id + '(' + c.where + ')').join(', '));
    return;
  }
  console.log('自分の識別子: ' + openid);

  const PARTS = ['head', 'torso', 'arm', 'leg'];
  const KEEP = ['name_code', 'skill1_lv', 'skill2_lv', 'ulti_skill_lv', 'favorite_item_tid',
    'favorite_item_lv', 'harmony_cube_tid', 'harmony_cube_lv'];
  for (const part of PARTS) {
    KEEP.push(part + '_equip_tier', part + '_equip_lv',
      part + '_equip_option1_id', part + '_equip_option2_id', part + '_equip_option3_id');
  }
  const slim = (detail) => { const out = {}; for (const key of KEEP) if (detail[key]) out[key] = detail[key]; return out; };

  // どのサーバーに居るかは分からないので、所持ニケが最も多いところを選ぶ
  let best = null;
  for (const area of ${JSON.stringify(AREAS)}) {
    await gap(300);
    const got = await call('Game/GetUserCharacters', { intl_open_id: openid, nikke_area_id: area });
    const list = got.code === 0 ? ((got.data || {}).characters || []) : [];
    console.log('サーバー ' + area + ': ' + (got.code === 0 ? list.length + '名' : (got.msg || got.code)));
    if (!best || list.length > best.characters.length) best = { area: area, characters: list };
  }
  if (!best || best.characters.length === 0) { console.error('所持ニケを取得できませんでした。ログインし直してからもう一度お試しください。'); return; }

  const codes = best.characters.map((c) => c.name_code);
  const details = [], effects = [];
  for (let at = 0; at < codes.length; at += 60) {
    await gap(300);
    const chunk = await call('Game/GetUserCharacterDetails',
      { intl_open_id: openid, nikke_area_id: best.area, name_codes: codes.slice(at, at + 60) });
    const data = chunk.data || {};
    for (const d of data.character_details || []) details.push(slim(d));
    for (const e of data.state_effects || []) {
      const first = (e.function_details || [])[0] || {};
      effects.push({ id: e.id, function_details: [{ function_type: first.function_type, function_value: first.function_value }] });
    }
    console.log('育成データ ' + details.length + '/' + codes.length);
  }

  let outpost = null;
  try {
    await gap(300);
    const info = await call('Game/GetUserProfileOutpostInfo', { intl_open_id: openid, nikke_area_id: best.area });
    const got = (info.data || {}).outpost_info;
    if (got) outpost = { recycle_room_researches: (got.recycle_room_researches || []).map((r) => ({ tid: r.tid, lv: r.lv })), synchro_level: got.synchro_level };
  } catch (e) {}

  const packed = JSON.stringify({ v: 1, profile: { openid: openid, areas: [{ area: best.area,
    characters: best.characters.map((c) => ({ name_code: c.name_code, grade: c.grade, core: c.core })),
    details: details, stateEffects: effects, outpost: outpost }] } });
  let text = packed;
  if (typeof CompressionStream === 'function') {
    const gz = new Blob([packed]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    text = '${PERSONAL_PREFIX}' + btoa(binary);
  }
  const done = (how) => console.log('ニケ ' + best.characters.length + '名 (サーバー ' + best.area + ')' + how);
  try { copy(text); done('をクリップボードにコピーしました。計算機に貼り付けてください。'); return; } catch (e) {}
  try { await navigator.clipboard.writeText(text); done('をクリップボードにコピーしました。計算機に貼り付けてください。'); return; } catch (e) {}
  // クリップボードが両方塞がれている (コンソールにフォーカスがあるとそうなる) ときは、
  // ページに箱を出して中身を選択しておく — ブラウザごとに違う右クリックメニューを探させない。
  const wrap = document.createElement('div');
  wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(2,7,13,.72);display:flex;align-items:center;justify-content:center');
  const card = document.createElement('div');
  card.setAttribute('style', 'width:90%;max-width:900px;background:#0b1420;border:2px solid #45d6d0;padding:12px');
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('style', 'width:100%;height:52vh;padding:10px;font:12px ui-monospace,monospace;background:#03090f;color:#e8f6f5');
  const close = document.createElement('button');
  close.textContent = '閉じる';
  close.setAttribute('style', 'margin-top:8px;padding:6px 12px;cursor:pointer');
  close.addEventListener('click', () => wrap.remove());
  card.appendChild(holder); card.appendChild(close); wrap.appendChild(card);
  document.body.appendChild(wrap);
  holder.focus(); holder.select();
  try { document.execCommand('copy'); } catch (e) {}
  done('をページ上のボックスに表示しました。Ctrl+A → Ctrl+C でコピーして計算機に貼り付けてください。');
})();`;

/** 数値として読めるものだけ通す。壊れた JSON を計算機の奥まで運ばない。 */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * スニペットの出力を `RawProfile` に戻す。`NKP1-` は gzip+base64、それ以外は生の JSON。
 *
 * 貼り付けは人が手でやるので、途中で切れた・別のものを貼った、が普通に起きる。
 * 形を見て弾き、**何を貼り直せばよいか**が分かる文言で投げる。
 */
export async function parsePersonalScan(text: string): Promise<RawProfile> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('貼り付けた内容が空です。');

  let json = trimmed;
  if (trimmed.startsWith(PERSONAL_PREFIX)) {
    try {
      const binary = atob(trimmed.slice(PERSONAL_PREFIX.length));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      // Blob.stream() は jsdom に無い。Response の body なら実ブラウザでもテストでも通る。
      const body = new Response(bytes).body;
      if (!body) throw new Error('stream unavailable');
      json = await new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
    } catch {
      throw new Error('データの展開に失敗しました。コピーが途中で切れていないか確認してください。');
    }
  }

  let box: { profile?: unknown };
  try {
    box = JSON.parse(json) as { profile?: unknown };
  } catch {
    throw new Error('内容を認識できませんでした。スニペットが出力したものを丸ごと貼り付けてください。');
  }

  // ユニオン名簿 (`NKU1-` / members) を貼られたときは、何が違うのかを言う
  if (!box.profile && Array.isArray((box as { members?: unknown }).members)) {
    throw new Error('ユニオン名簿のデータのようです。個人用のスニペットで取り直してください。');
  }

  const profile = box.profile as { openid?: unknown; areas?: unknown } | undefined;
  const openid = String(profile?.openid ?? '').trim();
  if (!/^\d+$/.test(openid)) {
    throw new Error('内容を認識できませんでした。スニペットが出力したものを丸ごと貼り付けてください。');
  }

  const areas: RawArea[] = [];
  for (const raw of Array.isArray(profile?.areas) ? profile.areas : []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const characters = Array.isArray(row.characters) ? row.characters : [];
    if (characters.length === 0) continue;   // 空のサーバーは持ち込まない
    areas.push({
      area: num(row.area) ?? 0,
      characters: characters as RawArea['characters'],
      details: (Array.isArray(row.details) ? row.details : []) as RawArea['details'],
      stateEffects: (Array.isArray(row.stateEffects) ? row.stateEffects : []) as RawArea['stateEffects'],
      outpost: (row.outpost ?? null) as RawArea['outpost'],
    });
  }
  if (areas.length === 0) throw new Error('所持ニケが入っていません。スニペットの実行結果を確認してください。');

  return { openid, areas };
}
