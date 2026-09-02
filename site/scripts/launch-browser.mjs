// 実機確認スクリプト共通のブラウザ起動。**どの PC でも動く**ことが目的:
// - 既定はインストール済み Chrome (channel: 'chrome')
// - 無ければ Edge (Windows なら必ずある) を試す
// - 環境変数 BROWSER_CHANNEL で明示もできる (例: BROWSER_CHANNEL=msedge)
// Playwright のブラウザ配布はダウンロードしない方針 (npm i --no-save playwright-core だけで動かす)。
import { chromium } from 'playwright-core';

export async function launchBrowser() {
  const wanted = process.env.BROWSER_CHANNEL;
  const channels = wanted ? [wanted] : ['chrome', 'msedge'];
  const errors = [];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      errors.push(`${channel}: ${String(error.message ?? error).split('\n')[0]}`);
    }
  }
  throw new Error('ブラウザを起動できませんでした。Chrome か Edge を入れるか、'
    + `BROWSER_CHANNEL で指定してください。\n  ${errors.join('\n  ')}`);
}
