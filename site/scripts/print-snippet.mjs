// コンソールに貼るコードを、そのまま貼れる形で書き出す。
//
// `personal-scan.ts` の中ではテンプレートリテラルなので `\\d` のように
// **エスケープが一段多い**。ソースを切り出して貼ると `\\d` のまま渡ってしまい、
// 正規表現が壊れる (実際にやらかした)。ここでは実際に import して、
// **サイトが使うのと同じ文字列**を出す。
//
//   node scripts/print-snippet.mjs [出力先]
import { writeFileSync } from 'node:fs';

import { PERSONAL_SNIPPET } from '../src/personal-scan.ts';

const out = process.argv[2];
if (out) {
  writeFileSync(out, PERSONAL_SNIPPET, 'utf8');
  console.log(`${out} に書き出した (${PERSONAL_SNIPPET.split('\n').length} 行)`);
} else {
  process.stdout.write(PERSONAL_SNIPPET);
}
