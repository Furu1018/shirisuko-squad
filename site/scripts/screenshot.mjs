// しりすこスクワッドの各タブを撮る。ローカルの vite preview に対してだけ動く (本番には触れない)。
// 新しいタブ (マイロスター・属性別編成) の見た目を確認し、ライトテーマ化の前後を比べるのにも使う。
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';   // 日本語を含むパスでも壊れない解決
// playwright は依存に入れていない (このスクリプトだけのため)。使うときに:
//   npx playwright install chromium && npm i -D playwright
import { chromium } from 'playwright';

// 使い方: npm run build && npx vite preview --port 4173 を別で立ててから
//   node scripts/screenshot.mjs [URL] [出力先]
// 見た目を変えたときに、全タブ × 2画面幅で 横スクロール・JSエラー・配色を確かめる。
const BASE = process.argv[2] ?? 'http://localhost:4173/shirisuko-squad/';
// 出力先はリポジトリの外 (コミットしない)。第2引数で変えられる
const OUT = process.argv[3] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../.screenshots');
mkdirSync(OUT, { recursive: true });

// 取り込み済みの状態を作る (本番のデータは使わない・全部この場で作る架空の値)
const SEED_ROSTER = {
  '라피': { growthStage: 7, skillLevels: { 1: 10, 2: 10, 3: 10 }, overload: { element_bonus: 85.8, atk_pct: 43, max_ammo_pct: 109 }, cube: { name: '재장', level: 15 }, collection: { stage: 'SR15', favorite: 3 } },
  '크라운': { growthStage: 10, skillLevels: { 1: 10, 2: 10, 3: 10 }, overload: { element_bonus: 0, atk_pct: 62, max_ammo_pct: 30 }, cube: { name: '재장', level: 15 }, collection: { stage: 'SR15', favorite: 0 } },
  '리타': { growthStage: 3, skillLevels: { 1: 7, 2: 4, 3: 10 }, overload: { element_bonus: 12, atk_pct: 8, max_ammo_pct: 0 }, cube: { name: '없음', level: 0 }, collection: { stage: 'SR5', favorite: 0 } },
  '앨리스': { growthStage: 9, skillLevels: { 1: 10, 2: 10, 3: 10 }, overload: { element_bonus: 70, atk_pct: 55, max_ammo_pct: 88 }, cube: { name: '전탄', level: 15 }, collection: { stage: 'SR15', favorite: 2 } },
  '나가': { growthStage: 0, skillLevels: { 1: 4, 2: 4, 3: 4 }, overload: {}, cube: { name: '없음', level: 0 }, collection: { stage: '없음', favorite: 0 } },
};

const run = async (viewport) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'ja-JP' });
  await context.addInitScript(([roster, seedPlans]) => {
    try {
      localStorage.setItem('nikke-roster-v1', JSON.stringify(roster));
      localStorage.setItem('nikke-sync-v1', JSON.stringify({
        schemaVersion: 1, source: 'blablalink', at: new Date(Date.now() - 3 * 3600_000).toISOString(),
        matched: 5, profileUrl: 'https://www.blablalink.com/user?openid=demo',
      }));
      localStorage.setItem('nikke-plans-v1', JSON.stringify(seedPlans));
      localStorage.setItem('nikke-notice-seen', '2026-09-01-beta');   // お知らせの覆いで画面が暗くならないように
    } catch { /* 使えなくても表示は見られる */ }
  }, [SEED_ROSTER, {
    schemaVersion: 1,
    byElement: {
      전격: [
        { id: 'a', squad: ['리타', '크라운', '라피', '앨리스', '나가'], savedAt: new Date().toISOString() },
        { id: 'b', squad: ['크라운', '앨리스', '라피', '', ''], savedAt: new Date().toISOString() },
      ],
      작열: [{ id: 'c', squad: ['라피', '크라운', '', '', ''], savedAt: new Date().toISOString() }],
    },
  }]);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  const shoot = async (view, name) => {
    await page.evaluate((v) => {
      const tab = document.querySelector(`[data-view-tab="${v}"]`);
      if (tab instanceof HTMLElement) tab.click();
    }, view);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${viewport.width}-${name}.png`, fullPage: true });
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
    }));
    console.log(`  ${name}: 横スクロール ${overflow.doc <= overflow.win + 2 ? 'なし' : `あり (${overflow.doc}>${overflow.win})`}`);
  };

  console.log(`\n=== ${viewport.width}px ===`);
  await shoot('union', '1-union');
  await shoot('roster', '2-roster');
  await shoot('plans', '3-plans');
  await shoot('calc', '4-calc');
  if (errors.length) console.log('  JSエラー:', errors.slice(0, 2).join(' | '));
  else console.log('  JSエラー: なし');
  await browser.close();
};

const main = async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) await run(viewport);
  console.log(`\n出力: ${OUT}`);
};
main().catch((error) => { console.error(error); process.exit(1); });
