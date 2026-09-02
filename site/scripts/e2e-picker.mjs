// 実機 (本物の Chrome) で「お気に入り」と「候補の比較」を通す。
//
//   cd site && npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   node scripts/e2e-picker.mjs [URL]
//
// 単体テストでは «画面で本当に押せるか» が分からない (jsdom は hidden も disabled も
// 素通りする)。ここは実際に押して並び替えと絞り込みを確かめる。
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/shirisuko-squad/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-board-skip]').click();
  await page.locator('[data-board-boss="0"]').selectOption({ index: 1 });
  await page.waitForTimeout(400);
  await page.locator('[data-board-pick-open="0"]').click();
  await page.waitForTimeout(400);

  // ★ を付けると先頭に来る
  const before = await page.locator('[data-board-pick]').first().getAttribute('data-board-pick');
  const stars = page.locator('.board-pick-star');
  const target = await stars.nth(12).getAttribute('data-board-fav');
  await stars.nth(12).click();
  await page.waitForTimeout(300);
  const after = await page.locator('[data-board-pick]').first().getAttribute('data-board-pick');
  console.log(`★ を付ける前の先頭: ${before} → 付けた後: ${after} (印: ${target})`);
  if (after !== target) { failed = true; console.log('!! ★ が先頭に来ていない'); }

  // お気に入りだけに絞る
  await page.locator('[data-board-picker-fav-only]').click();
  await page.waitForTimeout(300);
  const only = await page.locator('[data-board-pick]').count();
  console.log('お気に入りだけ:', only, '名');
  if (only !== 1) { failed = true; console.log('!! 絞り込みが効いていない'); }
  await page.locator('[data-board-picker-fav-only]').click();
  await page.waitForTimeout(200);

  // B3 で絞る
  await page.locator('[data-board-picker-burst-filter="3"]').click();
  await page.waitForTimeout(300);
  console.log('B3 だけ:', await page.locator('[data-board-pick]').count(), '名');
  await page.locator('[data-board-picker-burst-filter="3"]').click();
  await page.waitForTimeout(200);

  // 5人組んで候補に加える
  // 同じタイルを押すと入れ替わってしまうので、別々のタイルを押す
  for (let i = 0; i < 5; i += 1) {
    await page.locator('[data-board-pick]:not([disabled])').nth(i).click();
    await page.waitForTimeout(150);
  }
  await page.locator('[data-board-change="0"]').click();
  await page.waitForTimeout(300);
  const addBtn = page.locator('[data-board-compare-add="0"]');
  if (await addBtn.count() === 0) { failed = true; console.log('!! «候補に加える» が出ていない'); }
  else {
    await addBtn.click();
    await page.waitForTimeout(300);
    console.log('候補の欄:', (await page.locator('[data-board-chooser="0"]').textContent())?.trim().slice(0, 80));
  }
  await page.locator('[data-board-slot="0"]').screenshot({
    path: 'C:/Users/gijyutsu/AppData/Local/Temp/claude/C--Users-gijyutsu/4c1de6f8-0aa3-4794-94d5-28eba1e79da9/scratchpad/fav.png',
  });
} catch (error) {
  failed = true;
  console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}
console.log('errors:', errors.length === 0 ? 'none' : errors.join(' | '));
if (failed || errors.length > 0) process.exit(1);
console.log('お気に入りと候補の比較は実機で通る。');
