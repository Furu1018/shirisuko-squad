// 実機 (本物の Chrome) で「別の端末へ移す」を通す。
//
//   cd site && npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   node scripts/e2e-transfer.mjs [URL]
//
// PC で取り込む → 書き出す → **別のブラウザ文脈 (= 別端末に相当)** で貼る、まで通す。
// localStorage は文脈ごとに独立なので、新しい context を作れば «スマホで開いた» と同じ状態になる。
import { launchBrowser } from './launch-browser.mjs';

const url = process.argv[2] ?? 'http://localhost:4173/shirisuko-squad/';
const NAMES = [[5094, '2B'], [5125, 'グレイブ'], [5031, 'ギロチン'], [5055, 'ギルティ'], [5099, 'ナガ']];
const detail = (code) => ({
  name_code: code, skill1_lv: 10, skill2_lv: 10, ulti_skill_lv: 10,
  harmony_cube_tid: 1, harmony_cube_lv: 15,
  head_equip_tier: 11, head_equip_lv: 5, torso_equip_tier: 11, torso_equip_lv: 5,
  arm_equip_tier: 11, arm_equip_lv: 5, leg_equip_tier: 11, leg_equip_lv: 5,
});
const payload = {
  v: 1,
  profile: {
    openid: '12244701007106264814',
    areas: [{
      area: 81,
      characters: NAMES.map(([c]) => ({ name_code: c, grade: 9, core: 2 })),
      details: NAMES.map(([c]) => detail(c)),
      stateEffects: [],
      outpost: { recycle_room_researches: [{ tid: 1, lv: 5 }], synchro_level: 300 },
    }],
  },
};

const browser = await launchBrowser();
const errors = [];
let failed = false;
const say = (...a) => console.log(...a);
try {
  // ── PC 側: 取り込んで、★を付けて、書き出す ──
  const pc = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const a = await pc.newPage();
  a.on('pageerror', (e) => errors.push(`PC: ${e}`));
  await a.goto(url, { waitUntil: 'networkidle' });
  await a.locator('[data-board-scan-paste]').fill(JSON.stringify(payload));
  await a.locator('[data-board-scan-import]').click();
  await a.waitForFunction(() => /名を読み込みました/.test(
    document.querySelector('[data-board-scan-status]')?.textContent ?? ''), { timeout: 60000 });
  say('PC: 取り込み OK');

  await a.locator('[data-board-sync-import]').click();      // STEP 1 に戻る
  await a.locator('[data-board-move]').evaluate((el) => { el.open = true; });
  await a.locator('[data-board-move-make]').click();
  await a.waitForFunction(() => (document.querySelector('[data-board-move-out]')?.value ?? '').startsWith('NKX1-'),
    { timeout: 30000 });
  const code = await a.locator('[data-board-move-out]').inputValue();
  say(`PC: 書き出し OK (${Math.round(code.length / 1024)}KB) — ${(await a.locator('[data-board-move-status]').textContent())?.trim()}`);

  // ── スマホ側: まっさらな文脈に貼る ──
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  });
  const b = await phone.newPage();
  b.on('pageerror', (e) => errors.push(`スマホ: ${e}`));
  await b.goto(url, { waitUntil: 'networkidle' });
  const before = await b.evaluate(() => localStorage.getItem('nikke-roster-v1'));
  say(`スマホ: 貼る前の育成 = ${before ? '有り' : '無し (まっさら)'}`);
  if (before) { failed = true; say('!! まっさらでないので検証にならない'); }

  await b.locator('[data-board-scan-paste]').fill(code);
  await b.locator('[data-board-scan-import]').click();
  await b.waitForFunction(() => /受け取りました/.test(
    document.querySelector('[data-board-scan-status]')?.textContent ?? ''), { timeout: 60000 });
  say(`スマホ: ${(await b.locator('[data-board-scan-status]').textContent())?.trim()}`);

  // 中身が本当に入ったか
  await b.locator('[data-view-tab="roster"]').click();
  await b.waitForTimeout(400);
  const rows = await b.locator('[data-myroster-rows] tr').count();
  say(`スマホ: 育成状況の行数 = ${rows}`);
  if (rows < NAMES.length) { failed = true; say('!! 育成が並んでいない'); }
  const text = (await b.locator('[data-myroster-rows]').textContent()) ?? '';
  for (const [, jp] of NAMES) if (!text.includes(jp)) { failed = true; say(`!! ${jp} が無い`); }
} catch (error) {
  failed = true;
  say(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
say(`errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`);
if (failed || errors.length > 0) process.exit(1);
say('\nPC で書き出してスマホで貼る、が実機で通る。');
