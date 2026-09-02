// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { TRANSFER_PREFIX, packTransfer, parseTransfer, type TransferBox } from './transfer';

const box: TransferBox = {
  schemaVersion: 1,
  at: '2026-09-03T00:00:00.000Z',
  roster: { 리타: { growthStage: 7, overload: { atk_pct: 22.2 } } },
  sync: { schemaVersion: 1, source: 'snippet', at: '2026-09-02T10:00:00.000Z', matched: 184 },
  favorites: ['리타', '크라운'],
  plans: { schemaVersion: 1, byElement: { 철갑: [{ id: 'a', squad: ['리타'], savedAt: 'x' }] } },
  board: { schemaVersion: 1, slots: [{ boss: 'レイタンス', squad: ['리타', '', '', '', ''] }] },
  account: { synchroLevel: 582, console: { atk: 1 } },
};

describe('端末間の持ち運び', () => {
  it('書き出して読み直すと同じ中身になる', async () => {
    const code = await packTransfer(box);
    expect(code.startsWith(TRANSFER_PREFIX)).toBe(true);
    const got = await parseTransfer(code);
    expect(got).toEqual(box);
  });

  it('**育成が大きくても貼れる大きさに収まる**', async () => {
    // 実データは 184名。1人あたり数百バイトあるので、圧縮が効かないと貼り付けで運べない。
    const many: TransferBox = {
      schemaVersion: 1,
      at: box.at,
      roster: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [
        `니케${i}`,
        { growthStage: 11, skillLevels: { 1: 10, 2: 10, 3: 10 }, overload: { atk_pct: 22.22, element_bonus: 88.6 } },
      ])),
    };
    const code = await packTransfer(many);
    expect(code.length).toBeLessThan(20_000);
  });

  it('前後の空白が付いていても読める (コピペで混ざる)', async () => {
    const code = await packTransfer(box);
    expect((await parseTransfer(`\n  ${code}  \n`)).roster).toEqual(box.roster);
  });

  it('圧縮していない生の JSON も受ける', async () => {
    expect((await parseTransfer(JSON.stringify(box))).favorites).toEqual(['리타', '크라운']);
  });

  it('取り込みデータ (NKP1-) を貼られたら、そのまま使えると言う', async () => {
    await expect(parseTransfer(JSON.stringify({ v: 1, profile: { openid: '1', areas: [] } })))
      .rejects.toThrow('そのまま「取り込む」で使えます');
  });

  it('空・壊れた入力・育成が空は、貼り直せる言い方で断る', async () => {
    await expect(parseTransfer('   ')).rejects.toThrow('空です');
    await expect(parseTransfer('これはJSONではない')).rejects.toThrow('認識できませんでした');
    await expect(parseTransfer(`${TRANSFER_PREFIX}zzzz`)).rejects.toThrow('展開に失敗');
    await expect(parseTransfer(JSON.stringify({ schemaVersion: 1, roster: {} })))
      .rejects.toThrow('育成データが入っていません');
    await expect(parseTransfer(JSON.stringify({ schemaVersion: 9, roster: { a: {} } })))
      .rejects.toThrow('認識できませんでした');
  });

  it('壊れた任意項目は落として通す (育成さえ読めれば運べる)', async () => {
    const got = await parseTransfer(JSON.stringify({
      schemaVersion: 1, at: 123, roster: { 리타: {} }, favorites: ['리타', 3, null, ''],
    }));
    expect(got.favorites).toEqual(['리타']);
    expect(typeof got.at).toBe('string');
  });
});
