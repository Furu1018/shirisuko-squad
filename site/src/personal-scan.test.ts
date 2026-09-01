// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { PERSONAL_PREFIX, PERSONAL_SNIPPET, parsePersonalScan } from './personal-scan';

/** スニペットが吐く形。中身は最小限で、形だけ本物に合わせる。 */
const profile = {
  v: 1,
  profile: {
    openid: '12244701007106264814',
    areas: [{
      area: 81,
      characters: [{ name_code: 191, grade: 9, core: 2 }],
      details: [{ name_code: 191, skill1_lv: 10 }],
      stateEffects: [{ id: '1', function_details: [{ function_type: 'StatAtk', function_value: 1234 }] }],
      outpost: { recycle_room_researches: [{ tid: 1, lv: 5 }] },
    }],
  },
};

/** スニペットと同じ手順で詰める (gzip → base64 → 接頭辞)。 */
const pack = async (value: unknown): Promise<string> => {
  const json = JSON.stringify(value);
  const gz = new Response(json).body!.pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return PERSONAL_PREFIX + btoa(binary);
};

describe('個人用スキャンの読み取り', () => {
  it('gzip+base64 を解いて所持ニケを取り出す', async () => {
    const got = await parsePersonalScan(await pack(profile));
    expect(got.openid).toBe('12244701007106264814');
    expect(got.areas).toHaveLength(1);
    expect(got.areas[0]!.area).toBe(81);
    expect(got.areas[0]!.characters[0]!.name_code).toBe(191);
    expect(got.areas[0]!.outpost?.recycle_room_researches?.[0]?.lv).toBe(5);
  });

  it('圧縮していない生の JSON もそのまま読める', async () => {
    const got = await parsePersonalScan(JSON.stringify(profile));
    expect(got.areas[0]!.characters).toHaveLength(1);
  });

  it('前後の空白が付いていても読める (コピペで混ざる)', async () => {
    const got = await parsePersonalScan(`\n  ${await pack(profile)}  \n`);
    expect(got.openid).toBe('12244701007106264814');
  });

  it('所持ニケが空のサーバーは持ち込まない', async () => {
    await expect(parsePersonalScan(JSON.stringify({
      profile: { openid: '123456', areas: [{ area: 81, characters: [] }] },
    }))).rejects.toThrow('所持ニケが入っていません');
  });

  it('ユニオン名簿を貼られたら、何が違うのかを言う', async () => {
    await expect(parsePersonalScan(JSON.stringify({ v: 1, members: [{ name: 'a' }] })))
      .rejects.toThrow('ユニオン名簿');
  });

  it('空・壊れた入力・途中で切れた圧縮は、貼り直せる言い方で断る', async () => {
    await expect(parsePersonalScan('   ')).rejects.toThrow('空です');
    await expect(parsePersonalScan('これはJSONではない')).rejects.toThrow('認識できませんでした');
    await expect(parsePersonalScan(`${PERSONAL_PREFIX}zzzz`)).rejects.toThrow('展開に失敗');
    // openid が数字でない = 別のものを貼っている
    await expect(parsePersonalScan(JSON.stringify({ profile: { openid: 'abc', areas: [] } })))
      .rejects.toThrow('認識できませんでした');
  });

  it('スニペットは読み取りとクリップボードだけで、外部へ送らない', () => {
    // 貼らせるコードなので «通信先» をテストで固定する。増えたら気づけるようにする。
    const urls = PERSONAL_SNIPPET.match(/https?:\/\/[^'"` ]+/g) ?? [];
    for (const url of urls) {
      expect(url.startsWith('https://api.blablalink.com/')).toBe(true);
    }
    expect(PERSONAL_SNIPPET).toContain('api.blablalink.com');
    // データを外に出す手段が紛れていないこと
    expect(PERSONAL_SNIPPET).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|new Image|document\.cookie/);
  });
});
