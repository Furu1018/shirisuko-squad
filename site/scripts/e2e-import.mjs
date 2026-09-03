// 実機 (本物の Chrome) で「取り込み」の受け取り側を通す。
//
// スニペットを実際の Blablalink で走らせる検証はログインが要るのでできない。
// 代わりに **スニペットが出すのと同じ形** を実在の name_code で作って貼り、
// 貼り付け → 展開 → 育成値に変換 → ロスター反映 → 盤面へ、が通ることを確かめる。
//
//   cd site && npm run build && npx vite preview --port 4173 &   # 先にプレビューを立てる
//   npm i --no-save playwright-core                               # 初回だけ
//   node scripts/e2e-import.mjs [URL]
import { launchBrowser } from './launch-browser.mjs';

const url = process.argv[2] ?? 'http://localhost:4173/shirisuko-squad/';
const errors = [];
let failed = false;
const say = (...a) => console.log(...a);

// 実在の name_code (catalog.json より)。装備・スキル・オーバーロードも本物の形で入れる。
const NAMES = [
  [5094, '2B'], [5125, 'グレイブ'], [5031, 'ギロチン'], [5055, 'ギルティ'], [5099, 'ナガ'],
];
const detailOf = (code) => ({
  name_code: code,
  skill1_lv: 10, skill2_lv: 10, ulti_skill_lv: 10,
  harmony_cube_tid: 1, harmony_cube_lv: 15,
  head_equip_tier: 11, head_equip_lv: 5,
  torso_equip_tier: 11, torso_equip_lv: 5,
  arm_equip_tier: 11, arm_equip_lv: 5,
  leg_equip_tier: 11, leg_equip_lv: 5,
});
const payload = {
  v: 1,
  profile: {
    openid: '12244701007106264814',
    areas: [{
      area: 81,
      characters: NAMES.map(([code]) => ({ name_code: code, grade: 9, core: 2 })),
      details: NAMES.map(([code]) => detailOf(code)),
      stateEffects: [],
      outpost: { recycle_room_researches: [{ tid: 1, lv: 5 }], synchro_level: 300 },
    }],
  },
};

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });

  // STEP 1 が出ていること
  const start = page.locator('[data-board-start]');
  if (!(await start.isVisible())) throw new Error('STEP 1 が出ていない');
  say('STEP 1 が既定で出る … OK');

  // «自分のブラウザで取り込む» が開いていて、貼るコードが読める
  const code = await page.locator('[data-board-scan-code]').inputValue();
  if (!code.includes('api.blablalink.com')) throw new Error('スニペットが画面に出ていない');
  say(`スニペットが画面に出ている (${code.length} 文字) … OK`);

  // 圧縮せずに生 JSON でも受け取れる仕様なので、そのまま貼る
  await page.locator('[data-board-scan-paste]').fill(JSON.stringify(payload));
  await page.locator('[data-board-scan-import]').click();

  await page.waitForFunction(
    () => (document.querySelector('[data-board-scan-status]')?.textContent ?? '').trim() !== '取り込み中…'
      && (document.querySelector('[data-board-scan-status]')?.textContent ?? '').trim() !== '',
    { timeout: 60000 },
  );
  const status = (await page.locator('[data-board-scan-status]').textContent())?.trim();
  say(`取り込みの結果: ${status}`);
  if (!/名を読み込みました/.test(status ?? '')) { failed = true; say('!! 取り込めていない'); }

  // 盤面に進み、帯が «取込済み» になっていること
  if (await start.isVisible()) { failed = true; say('!! STEP 1 が閉じていない'); }
  else say('STEP 1 が閉じて盤面に進んだ … OK');
  const bar = (await page.locator('[data-board-sync-main]').textContent())?.trim();
  say(`帯の表示: ${bar}`);
  if (!/取込済み/.test(bar ?? '')) { failed = true; say('!! 帯が取込済みになっていない'); }

  // シンクロレベルが自動反映されること (既定 400 のままだと理論値が大幅に低く出る)
  const synchro = await page.locator('#synchro-level').inputValue();
  say(`シンクロ入力: ${synchro}`);
  if (synchro !== '300') { failed = true; say('!! 取り込んだシンクロ (300) が反映されていない'); }

  // 育成状況タブに実際に並ぶか
  // 育成状況は主タブから外した (パイプラインの段ではないため) — 取り込みの帯から開く
  await page.locator('[data-board-goto="roster"]').first().click();
  const rows = await page.locator('[data-myroster-rows] tr').count();
  say(`育成状況の行数: ${rows}`);
  if (rows < NAMES.length) { failed = true; say('!! 取り込んだ人数が並んでいない'); }

  // 日本語名で出ているか (内部キーの韓国語が漏れていないか)
  const text = (await page.locator('[data-myroster-rows]').textContent()) ?? '';
  for (const [, jp] of NAMES) {
    if (!text.includes(jp)) { failed = true; say(`!! 「${jp}」が出ていない`); }
  }
  if (!failed) say('日本語名で並んでいる … OK');
  if (/[가-힣]/.test(text)) { failed = true; say('!! ハングルが表示に漏れている'); }
} catch (error) {
  failed = true;
  say(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
say(`errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`);
if (errors.length > 0 || failed) process.exit(1);
say('\n取り込みの受け取り側は実機で通る。');
