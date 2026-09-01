import './styles.css';

import { CalculatorPool } from './worker-client';
import { setDisplayNames } from './display-name';
import { mountCalculator } from './ui';
import type { CharacterMeta, RuntimeManifest, SettingsCatalog } from './types';

const rootCandidate = document.querySelector<HTMLElement>('#app');
if (!rootCandidate) throw new Error('アプリを表示する領域がありません。');
const root: HTMLElement = rootCandidate;

root.innerHTML = '<div class="boot-screen"><span></span><p>計算機のデータを読み込んでいます…</p></div>';

async function start(): Promise<void> {
  const [catalogResponse, manifestResponse, settingsResponse] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}catalog.json`),
    fetch(`${import.meta.env.BASE_URL}runtime/manifest.json`),
    fetch(`${import.meta.env.BASE_URL}settings.json`),
  ]);
  if (!catalogResponse.ok || !manifestResponse.ok || !settingsResponse.ok) {
    throw new Error('キャラクターデータを読み込めませんでした。');
  }
  const catalog = await catalogResponse.json() as CharacterMeta[];
  setDisplayNames(catalog);   // 画面表示は labelFor() 経由で日本語に (内部キーは韓国語のまま)
  const manifest = await manifestResponse.json() as RuntimeManifest;
  const settings = await settingsResponse.json() as SettingsCatalog;
  const client = new CalculatorPool();
  const cleanup = mountCalculator(root, {
    catalog,
    settings,
    version: manifest.version,
    client,
    storage: () => window.localStorage,
  });
  window.addEventListener('pagehide', cleanup, { once: true });
}

start().catch((error: unknown) => {
  root.replaceChildren();
  const box = document.createElement('section');
  box.className = 'fatal-error';
  const title = document.createElement('h1');
  title.textContent = '計算機を起動できませんでした。';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '再試行';
  retry.addEventListener('click', () => window.location.reload());
  box.append(title, message, retry);
  root.append(box);
});
