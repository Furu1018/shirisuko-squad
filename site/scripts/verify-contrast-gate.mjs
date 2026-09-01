// 配色の検算そのものが「歯止め」として効くかを確かめる。
//
// 検算は書いたら終わりではない。実際この検算には穴が3度見つかっている
// (セレクタにコメントが混ざる / 前方一致が甘い / 親の opacity を追えない)。
// 「通っている」ことは「守れている」ことを意味しないので、**わざと壊して
// 落ちるか**をここで確かめる。styles.css は必ず元に戻す。
//
//   node scripts/verify-contrast-gate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const CSS = resolve(SITE, 'src/styles.css');

const run = () => {
  try {
    return { code: 0, out: execFileSync('node', ['scripts/check-contrast.mjs'], { cwd: SITE, encoding: 'utf8' }) };
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? '') };
  }
};
const notable = (out) => out.trim().split('\n').filter((l) => l.startsWith('NG') || l.includes('件')).slice(0, 3);

/**
 * 壊し方は2種類。どちらも実際に見落として直したもの。
 * 置換元が見つからなければ「検証できていない」ので、黙って通さず落とす。
 */
const CASES = [
  {
    name: '① 文字を薄い色にする',
    from: '.roster-sort-label { font-size: 12px; color: var(--ink-2); }',
    to: '.roster-sort-label { font-size: 12px; color: #9a9ea3; }',
  },
  {
    name: '② opacity で薄める (親の opacity は CSS だけでは追えない)',
    from: '.timeline-legend-item.is-off { text-decoration: line-through; color: var(--ink-2); }',
    to: '.timeline-legend-item.is-off { opacity: .72; text-decoration: line-through; }',
  },
];

const good = readFileSync(CSS, 'utf8');
const before = run();
console.log(`--- いまの状態 ---\n終了コード ${before.code} / ${before.out.trim().split('\n').pop()}`);

let missed = [];
try {
  for (const { name, from, to } of CASES) {
    if (!good.includes(from)) throw new Error(`置換元が見つからない — 検証になっていない: ${name}`);
    writeFileSync(CSS, good.split(from).join(to), 'utf8');
    const broken = run();
    console.log(`\n--- ${name} ---\n終了コード ${broken.code}`);
    for (const line of notable(broken.out)) console.log(`  ${line}`);
    if (broken.code === 0) { missed.push(name); console.log('  !! 見逃した'); }
  }
} finally {
  writeFileSync(CSS, good, 'utf8');   // 何があっても元に戻す
}

const after = run();
console.log(`\n--- 元に戻した ---\n終了コード ${after.code} / ${after.out.trim().split('\n').pop()}`);
if (before.code !== 0) throw new Error('検証を始める前から基準割れしている');
if (after.code !== 0) throw new Error('元に戻せていない — styles.css を確認すること');
if (missed.length > 0) {
  console.error(`\n見逃し: ${missed.join(' / ')}`);
  process.exit(1);
}
console.log(`\n${CASES.length}種類とも捕まえた — 歯止めとして機能している。`);
