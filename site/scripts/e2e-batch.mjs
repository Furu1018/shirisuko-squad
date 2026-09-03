// 実機 (Pyodide 込みの本物の Chrome) で「今回のボスを登録 → ぜんぶ計算 → 全ボスから自動で探す」を通す。
//
//   cd site && npm run build && npx vite preview --port 4173 &   # 先にプレビューを立てる
//   node scripts/e2e-batch.mjs [URL]
//
// ここで見たいのは、単体テスト (jsdom) では分からない次の3つ:
//   1. 進捗バーが本当に伸びるか (hidden も style も jsdom は素通りさせる)
//   2. «ぜんぶ計算» が済んだあと、盤面の «全ボスから自動で探す» が**計算し直さない**か
//      — 条件がずれていると全部計算し直しになり、この段を作った意味が消える
//   3. ボスの登録を変えたら、登録値が «条件が変わりました» に落ちるか
import { launchBrowser } from './launch-browser.mjs';

const url = process.argv[2] ?? 'http://localhost:4173/shirisuko-squad/';
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const errors = [];
let failed = false;
const check = (ok, what) => {
  if (ok) return;
  errors.push(what);
  failed = true;
};

let browser;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-view-tab="calc"]').click();
  await page.waitForFunction(
    () => /準備完了/.test(document.querySelector('[data-status]')?.textContent ?? ''),
    null, { timeout: 180_000 },
  );
  console.log(`[${lap()}] Pyodide ready`);

  // 既定の編成をそのまま2属性の候補にする (顔ぶれは同じでよい — 見たいのは計算の段)
  await page.locator('[data-view-tab="plans"]').click();
  await page.locator('[data-plans-save="철갑"]').click();
  await page.locator('[data-plans-save="수냉"]').click();
  const saved = await page.locator('[data-plans-row]').count();
  console.log(`[${lap()}] 候補 ${saved}件`);
  check(saved === 2, `候補が2件にならない (${saved}件)`);

  // ① 今回のボスを登録する
  await page.locator('[data-boss-name="전격"]').fill('テストボス');
  await page.locator('[data-boss-name="전격"]').blur();
  await page.locator('[data-boss-core="전격"]').check();
  await page.locator('[data-boss-px="전격"]').fill('9');
  await page.locator('[data-boss-px="전격"]').blur();
  await page.waitForTimeout(300);
  const coreOn = await page.locator('[data-boss-px="전격"]').isEnabled();
  console.log(`[${lap()}] ボス登録: 名前=テストボス · コアの大きさ欄 ${coreOn ? '入力可' : '入力不可'}`);
  check(coreOn, 'コアありにしたのに大きさを入れられない');

  // ② ぜんぶ計算 — バーが伸びること
  const fill = page.locator('[data-plans-batch-fill]');
  check(await page.locator('[data-plans-batch-bar]').isHidden(), '押す前からバーが出ている');
  await page.locator('[data-plans-batch-run]').click();
  await page.waitForFunction(
    () => !/計算中/.test(document.querySelector('[data-plans-batch-run]')?.textContent ?? ''),
    null, { timeout: 300_000 },
  );
  await page.waitForTimeout(400);
  const width = await fill.evaluate((node) => node.style.width);
  const note = (await page.locator('[data-plans-batch-note]').textContent()) ?? '';
  console.log(`[${lap()}] ぜんぶ計算おわり — バー ${width} · ${note.slice(0, 90)}`);
  check(width === '100%', `計算後にバーが満ちていない (${width})`);
  check(note.includes('2件中 2件'), `件数の報告がおかしい: ${note.slice(0, 60)}`);

  const state = await page.locator('[data-plans-group="철갑"] .plans-score-state').first().textContent();
  console.log(`  候補の状態: ${state}`);
  check((state ?? '').includes('今回のボス条件'), `登録値が «今回のボス条件» にならない: ${state}`);

  // ③ 盤面の探索が**計算し直さない** — これがこの段を作った理由
  await page.locator('[data-view-tab="board"]').click();
  await page.locator('[data-board-skip]').click({ timeout: 5000 }).catch(() => {});
  const before = Date.now();
  await page.locator('[data-board-search-best]').click();
  await page.waitForFunction(
    () => !/計算中/.test(document.querySelector('[data-board-search-best]')?.textContent ?? ''),
    null, { timeout: 300_000 },
  );
  const took = (Date.now() - before) / 1000;
  const boardStatus = (await page.locator('[data-board-status]').textContent()) ?? '';
  console.log(`[${lap()}] 全ボスから自動で探す: ${took.toFixed(1)}s — ${boardStatus.slice(0, 90)}`);
  // 1計算7秒台。計算済みの値を使えていれば数秒では終わらないはずがない
  check(took < 5, `計算済みのはずなのに ${took.toFixed(1)}s かかった (条件がずれている疑い)`);

  // ④ ボスの条件を変えたら «条件が変わりました» に落ちる
  await page.locator('[data-view-tab="plans"]').click();
  await page.locator('[data-boss-def="전격"]').fill('50000');
  await page.locator('[data-boss-def="전격"]').blur();
  await page.waitForTimeout(300);
  const after = await page.locator('[data-plans-group="철갑"] .plans-score-state').first().textContent();
  console.log(`[${lap()}] 防御力を変えた後: ${after}`);
  check((after ?? '').includes('条件が変わりました'), `古い値が «今の値» のまま: ${after}`);
} catch (error) {
  failed = true;
  console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
}

console.log('errors:', errors.length > 0 ? errors.join(' / ') : 'none');
if (errors.length > 0) failed = true;
console.log(failed ? '実機で通っていない。' : '登録 → ぜんぶ計算 → 探索 が実機で通る。');
process.exit(failed ? 1 : 0);
