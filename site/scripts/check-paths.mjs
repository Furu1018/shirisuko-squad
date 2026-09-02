// スクリプトに **絶対パスが埋まっていないか** を確かめる。
//
//   node scripts/check-paths.mjs
//
// 一度これで痛い目を見た: `e2e-picker.mjs` に Windows の絶対パス (`C:/Users/…`) を
// 残したまま commit したところ、Mac ではそれが**相対パス**として扱われ、
// リポジトリの中に `site/C:/Users/…/fav.png` が作られて commit された。
// Windows は `:` を含むパスを取り出せないので、**職場PCで git pull が毎回失敗する**
// 状態になった。人の注意ではなく仕組みで止める。
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 実際のパスだけを見つけたい。説明のためにコメントへ書いた例 (`C:/Users/…`) は通す。
const ABSOLUTE = [
  { name: 'Windows の絶対パス', re: /['"`][A-Za-z]:[\/]/ },
  { name: 'Unix のホーム直書き', re: /['"`]\/(?:Users|home)\// },
];

const bad = [];
for (const file of readdirSync(HERE)) {
  if (!file.endsWith('.mjs') || file === 'check-paths.mjs') continue;
  const lines = readFileSync(join(HERE, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trim().startsWith('//')) return;   // 説明のコメントは対象外
    for (const { name, re } of ABSOLUTE) {
      if (re.test(line)) bad.push(`${file}:${i + 1}  ${name}\n    ${line.trim().slice(0, 90)}`);
    }
  });
}

if (bad.length > 0) {
  console.log(`--- 絶対パスが埋まっている (${bad.length}件) ---`);
  for (const one of bad) console.log(one);
  console.log('\n出力先は引数か既定の相対パスにしてください'
    + ' (Mac では絶対パスが相対扱いになり、リポジトリの中にディレクトリが作られます)。');
  process.exit(1);
}
console.log(`スクリプト ${readdirSync(HERE).filter((f) => f.endsWith('.mjs')).length}本 — 絶対パスなし。`);
