// 主要な文字色 × 背景の組み合わせを機械で検算する。
// 小文字 (9〜12px) は 4.5:1、大きい文字は 3:1 が目安。
const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** 半透明を下地の上に重ねた実効色 */
const over = (fg, alpha, bg) => {
  const [r1, g1, b1] = hex(fg); const [r2, g2, b2] = hex(bg);
  const mix = (a, b) => Math.round(a * alpha + b * (1 - alpha));
  return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const WHITE = '#ffffff';
const GROUND = '#f7f8f9';
const SURF2 = '#f1f2f4';
const AMBER = '#f59e0b';
const DANGER = '#d92c33';   // --danger の実値 (--danger-rgb #ff3d44 は塗り分け用)

const INK = '#14161a', INK2 = '#63686f', INK3 = '#676d74';
const AMBER_TEXT = '#92400e', SUCCESS = '#0f7a44', DANGER_TEXT = '#d92c33', ACCENT = '#6c42f0';

const rows = [
  ['本文 ink / 白', INK, WHITE],
  ['副 ink-2 / 白', INK2, WHITE],
  ['副 ink-2 / 淡い面', INK2, SURF2],
  ['補助 ink-3 / 白', INK3, WHITE],
  ['補助 ink-3 / 淡い面', INK3, SURF2],
  ['補助 ink-3 / 地', INK3, GROUND],
  ['琥珀の文字 / 白', AMBER_TEXT, WHITE],
  ['琥珀の文字 / 琥珀16%の塗り(淡い面の上)', AMBER_TEXT, over(AMBER, 0.16, SURF2)],
  ['琥珀の文字 / 琥珀10%の塗り(白の上)', AMBER_TEXT, over(AMBER, 0.10, WHITE)],
  ['成功 / 白', SUCCESS, WHITE],
  ['危険 / 白', DANGER_TEXT, WHITE],
  ['アクセント / 白', ACCENT, WHITE],
  ['白抜き / 危険の地', WHITE, DANGER],
  ['白抜き / 濃い地(ink)', WHITE, INK],
];

let ng = 0;
for (const [label, fg, bg] of rows) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) ng += 1;
  console.log(`${ok ? 'OK  ' : 'NG  '} ${r.toFixed(2).padStart(5)}:1  ${label}`);
}

// canvas のバフ帯 — 系列色 20% の塗りの上に濃い文字
console.log('\n[タイムライン] バフ帯 (系列色20%の塗り) の上の文字');
for (const c of ['#6C42F0', '#D9770E', '#0E9F6E', '#2E8BFF', '#D93E7A']) {
  const bg = over(c, 0.20, WHITE);
  const r = ratio(INK, bg);
  const ok = r >= 4.5;
  if (!ok) ng += 1;
  console.log(`${ok ? 'OK  ' : 'NG  '} ${r.toFixed(2).padStart(5)}:1  ${c} の帯`);
}
// 系列色そのもの (線として 3:1)
console.log('\n[タイムライン] 系列色の線 (白地・3:1 が目安)');
for (const c of ['#6C42F0', '#D9770E', '#0E9F6E', '#2E8BFF', '#D93E7A']) {
  const r = ratio(c, WHITE);
  console.log(`${r >= 3 ? 'OK  ' : 'NG  '} ${r.toFixed(2).padStart(5)}:1  ${c}`);
}
console.log(`\n小文字基準を下回る組み合わせ: ${ng}件`);
