// 見た目の確認: 各タブを幅3種で撮り、横にはみ出している要素があれば報告する。
//
//   cd site && npm run build && npx vite preview --port 4173 &     # 先にプレビューを立てる
//   npm i --no-save playwright-core                                 # 初回だけ (ブラウザは落とさない)
//   node scripts/shots.mjs [出力先ディレクトリ] [URL]
//
// インストール済みの Chrome (channel: 'chrome') を使うので、Playwright のブラウザ配布は要らない。
// `google-chrome --headless --screenshot` は 420px 幅で正しくレイアウトしないことがある
// (右がはみ出して見える) ので、必ずこちらで撮る — 実際の viewport で測るのが目的。
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

const outDir = resolve(process.argv[2] ?? 'shots');
const url = process.argv[3] ?? 'http://localhost:4173/shirisuko-squad/';
const WIDTHS = [390, 820, 1280];
const TABS = ['board', 'calc', 'roster', 'plans', 'union', 'links'];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let problems = 0;
for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  for (const tab of TABS) {
    const button = page.locator(`[data-view-tab="${tab}"]`);
    if (await button.count() === 0) continue;
    await button.click();
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1) {
          const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
          out.push(`${el.tagName.toLowerCase()}${cls} (right ${Math.round(r.right)} > ${vw})`);
        }
      }
      return { scrollWidth: document.documentElement.scrollWidth, vw, out: out.slice(0, 8) };
    });
    const file = resolve(outDir, `${tab}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const flag = over.scrollWidth > over.vw ? '  ← はみ出し' : '';
    console.log(`${tab} @${width}: scrollWidth ${over.scrollWidth}${flag}`);
    if (flag) { problems += 1; for (const line of over.out) console.log(`    ${line}`); }
  }
  await page.close();
}
await browser.close();
console.log(problems > 0 ? `横にはみ出す画面が ${problems} 件` : '横のはみ出しなし');
process.exit(problems > 0 ? 1 : 0);
