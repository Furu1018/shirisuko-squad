// 実機で「編成を組む → 候補に加える → 計算 → 入れ替え → 候補に加える → まとめて比較 → 再読込で登録値」
// のループを通す (盤面だけで完結するかの確認)。使い方は e2e-board.mjs と同じ:
//
//   cd site && npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core   # 初回だけ
//   OUT=出力先 node scripts/e2e-loop.mjs
//
// Pyodide を CDN から落とすのでネット接続が要る。失敗・ページエラーは終了コード 1。
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:4173/shirisuko-squad/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (e) => { failed = true; console.log('pageerror:', e.message); });
  const t0 = Date.now();
  const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const status = async () => (await page.locator('[data-board-status]').textContent().catch(() => '')) ?? '';
  const waitIdle = async (label) => {
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-board-status]')?.textContent ?? '';
      return t.length > 0 && !/…$/.test(t);
    }, null, { timeout: 300000 });
    console.log(`[${lap()}] ${label} → ${await status()}`);
  };
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-board-skip]').click();
  // 計算機の準備 (Pyodide)
  await page.locator('[data-view-tab="calc"]').click();
  await page.waitForFunction(() => /準備完了/.test(document.querySelector('[data-status]')?.textContent ?? ''), null, { timeout: 180000 });
  await page.locator('[data-view-tab="board"]').click();
  console.log(`[${lap()}] ready`);

  // 1. ボスを選ぶ → 枠で編成を組む (5人)
  await page.locator('[data-board-boss="0"]').selectOption('レイタンス');
  await page.locator('[data-board-pick-open="0"]').click();
  const picked1 = [];
  for (let i = 0; i < 5; i += 1) {
    const cell = page.locator('.board-picker-cell:not(.is-on):not(:disabled)').first();
    picked1.push(await cell.getAttribute('data-board-pick'));
    await cell.click();
  }
  console.log(`[${lap()}] squad1:`, picked1.join(','));
  await page.locator('[data-board-pick-open="0"]').click();   // 選び終わり
  // 2. 候補に加える → この枠を計算
  await page.locator('[data-board-change="0"]').click();
  await page.locator('[data-board-compare-add="0"]').click();
  await page.locator('[data-board-run]').click();
  await waitIdle('計算 (案1)');
  const score1 = await page.locator('[data-board-score="0"] b').textContent();
  console.log(`  score1: ${score1}`);
  // 3. 入れ替え (1人外して別の人に)
  await page.locator('[data-board-pick-open="0"]').click();
  const dropped = picked1[4];
  await page.locator('[data-board-picker-drop="0:4"]').click();
  // 外した本人を選び直すと同じ顔ぶれになってしまう — 別のニケを選ぶ
  const cell = page.locator(`.board-picker-cell:not(.is-on):not(:disabled):not([data-board-pick="${dropped}"])`).first();
  const swapped = await cell.getAttribute('data-board-pick');
  await cell.click();
  console.log(`[${lap()}] swapped in: ${swapped}`);
  await page.locator('[data-board-pick-open="0"]').click();
  // 4. もう一度候補に加えて、まとめて比較
  await page.locator('[data-board-change="0"]').click();
  await page.locator('[data-board-compare-add="0"]').click();
  await page.locator('[data-board-compare-run="0"]').click();
  await waitIdle('候補をぜんぶ計算して比べる');
  const rows = page.locator('.board-chooser-row');
  const n = await rows.count();
  for (let i = 0; i < n; i += 1) {
    const label = await rows.nth(i).locator('.board-btn').first().textContent();
    const score = await rows.nth(i).locator('.board-chooser-score').textContent();
    const top = await rows.nth(i).locator('.board-chooser-score.is-top').count();
    console.log(`  候補${i + 1}: ${label} | ${score}${top ? ' ★一番' : ''}`);
  }
  // 5. 再読込して候補と点数がどう見えるか (登録の永続性の確認)
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-board-change="0"]').click();
  const rows2 = page.locator('.board-chooser-row');
  const n2 = await rows2.count();
  console.log(`[${lap()}] after reload: candidates=${n2}`);
  for (let i = 0; i < n2; i += 1) {
    console.log(`  候補${i + 1}: ${await rows2.nth(i).locator('.board-chooser-score').textContent()}`);
  }
  await page.screenshot({ path: `${process.env.OUT ?? '.'}/loop.png`, fullPage: true });
} catch (e) {
  failed = true;
  console.log('FAILED:', e.message.split('\n')[0]);
} finally {
  await browser.close().catch(() => {});
}
process.exit(failed ? 1 : 0);
