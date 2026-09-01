// 実機 (Pyodide 込みの本物の Chrome) で 3凸ボードの一連を通す: 案の保存 → ボス選択 → 計算 →
// 被りの解消 → 被りなし最大 → 空き枠の探索。各段の所要時間と、ページのエラーを出す。
//
//   cd site && npm run build && npx vite preview --port 4173 &   # 先にプレビューを立てる
//   npm i --no-save playwright-core                               # 初回だけ
//   node scripts/e2e-board.mjs [出力先ディレクトリ] [URL]
//
// Pyodide は CDN から落とすのでネット接続が要る。テスト (FakeClient) では見えない
// 「本物のエンジンで回る・並列が効く・時間はどれくらいか」を確かめるためのもの。
// 2026-09-01 自宅Mac の実測: 1計算 7.4秒 (180秒戦闘)、並列3レーンで被りの代案3件も 7.5秒。
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

const outDir = resolve(process.argv[2] ?? 'shots');
const url = process.argv[3] ?? 'http://localhost:4173/shirisuko-squad/';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const status = async () => (await page.locator('[data-board-status]').textContent().catch(() => '')) ?? '';
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  // Pyodide の準備 (計算機タブの状態行)
  await page.locator('[data-view-tab="calc"]').click();
  await page.waitForFunction(() => /準備完了/.test(document.querySelector('[data-status]')?.textContent ?? ''), null, { timeout: 180000 });
  console.log(`[${lap()}] Pyodide ready`);
  // 既定の編成 (5人) を 철갑・수냉 の案として保存 → 2枠で全員被る
  await page.locator('[data-view-tab="plans"]').click();
  await page.locator('[data-plans-save="철갑"]').click();
  await page.locator('[data-plans-save="수냉"]').click();
  // 1人外した編成を 풍압 の案に
  await page.locator('[data-view-tab="calc"]').click();
  await page.locator('[data-slot-card="4"] .slot-clear').click();
  await page.locator('[data-view-tab="plans"]').click();
  await page.locator('[data-plans-save="풍압"]').click();
  console.log(`[${lap()}] plans saved:`, await page.locator('[data-plans-row]').count());

  await page.locator('[data-view-tab="board"]').click();
  const waitIdle = async (label, timeout = 300000) => {
    const s = Date.now();
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-board-status]')?.textContent ?? '';
      return !/…$/.test(t) && t.length > 0;
    }, null, { timeout });
    console.log(`[${lap()}] ${label}: ${((Date.now() - s) / 1000).toFixed(1)}s → ${await status()}`);
  };
  await page.locator('[data-board-boss="0"]').selectOption('レイタンス');
  await waitIdle('slot0 レイタンス (1 sim)');
  console.log('  score0:', await page.locator('[data-board-score="0"] b').textContent());
  await page.locator('[data-board-boss="1"]').selectOption('トゥームストーン');
  await waitIdle('slot1 トゥームストーン (+clash alternatives)');
  console.log('  clash boxes:', await page.locator('[data-board-clash]').count(), '|', (await page.locator('[data-board-clash]').first().textContent())?.slice(0, 160));
  await page.locator('[data-board-clash] button').first().click();
  await waitIdle('resolve clash');
  console.log('  clash boxes after:', await page.locator('[data-board-clash]').count(), '| summary:', await page.locator('[data-board-summary]').textContent());
  await page.locator('[data-board-search-best]').click();
  await waitIdle('search best (all candidates)');
  console.log('  summary:', await page.locator('[data-board-summary]').textContent());
  console.log('  total:', await page.locator('.board-total-val').textContent());
  await page.locator('[data-board-search-open="2"]').click().catch(() => console.log('  (slot 2 not open)'));
  await waitIdle('search open slot');
  await page.screenshot({ path: `${outDir}/e2e-board.png`, fullPage: true });
} catch (e) {
  console.log(`[${lap()}] FAILED: ${e.message}`);
  await page.screenshot({ path: `${outDir}/e2e-fail.png`, fullPage: true }).catch(() => {});
} finally {
  console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
}
