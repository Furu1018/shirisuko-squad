// ROADMAP に書いたことが実際と合っているかを確かめる。
// 引き継ぎ文書は「読んだ人が信じる」ので、古い記述が残っていると害になる。
//
//   node scripts/check-roadmap.mjs
//
// 実際、消した機能への言及が1件残っているのをこれで見つけた。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(resolve(ROOT, 'ROADMAP.md'), 'utf8');
let bad = 0;
const say = (ok, text) => { if (!ok) bad += 1; console.log(`${ok ? 'OK  ' : '!!  '}${text}`); };

// ① 文書が名指しするファイルは実在するか
const files = [...new Set([...doc.matchAll(/`((?:site\/|scripts\/|data\/|worker\/)[\w./-]+)`/g)].map((m) => m[1]))];
for (const rel of files) {
  const candidates = [resolve(ROOT, rel), resolve(ROOT, 'site', rel)];
  say(candidates.some((p) => existsSync(p)), `名指しされたファイル: ${rel}`);
}

// ② 消した機能の名前が残っていないか (削除済みなのに «ある» ように読める記述)
for (const gone of ['union-raid.ts', 'enikk.ts', 'custom-nikke.ts', 'report.ts', 'share-panel.ts']) {
  say(!doc.includes(gone), `消した機能に触れていない: ${gone}`);
}

// ③ 件数の主張が本当か
// shell も .cmd も Windows で素直に動かない (EINVAL)。vitest の入口を node で直接叩く。
const tests = execFileSync(process.execPath,
  [resolve(ROOT, 'site/node_modules/vitest/vitest.mjs'), '--run'],
  { cwd: resolve(ROOT, 'site'), encoding: 'utf8' });
const passed = tests.match(/Tests\s+(\d+) passed/)?.[1];
say(doc.includes(`vitest (${passed}件)`), `テスト件数の主張が実際と合う (実際 ${passed}件)`);

const contrast = execFileSync('node', ['scripts/check-contrast.mjs'], { cwd: resolve(ROOT, 'site'), encoding: 'utf8' });
const rules = contrast.match(/検算した規則 (\d+)件 \/ 試した組み合わせ (\d+)通り/);
say(doc.includes(`現在 ${rules[1]}規則 / ${rules[2]}通り`), `検算の規模が合う (実際 ${rules[1]}規則 / ${rules[2]}通り)`);

console.log(bad === 0 ? '\n引き継ぎ文書は実際と合っている。' : `\n${bad}件ずれている。`);
if (bad > 0) process.exit(1);
