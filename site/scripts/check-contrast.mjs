// 配色の検算。**styles.css を実際に読んで**、文字色と背景の組み合わせを総当たりで確かめる。
//
// 手書きの組み合わせ表で確かめていた頃は、書き忘れた組み合わせ (--danger や --cyan を
// 同系色の淡い塗りに載せている箇所) をまるごと見落とした。値も二重管理になって古びる。
// なのでトークンも規則もソースから読む。
//
//   node scripts/check-contrast.mjs        基準割れがあれば終了コード 1
//   node scripts/check-contrast.mjs --all  通った組み合わせも全部出す
//
// 判定は WCAG の相対輝度。小さい文字 (9〜13px) は 4.5:1、大きい/太い文字は 3:1 を目安にする。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../src/styles.css'), 'utf8');
const SHOW_ALL = process.argv.includes('--all');

/**
 * 文字が乗りうる下地。背景の指定が無い規則はこの3面すべてで試し、
 * 1つでも基準を割れば失敗にする (濃い文字にとっては一番暗い #f1f2f4 が最も不利)。
 * 通った件数は面ごとに数えず、規則ごとに1件として数える。
 */
const SURFACES = ['#ffffff', '#f7f8f9', '#f1f2f4'];
const WORST_SURFACE = '#f1f2f4';

/** 無効化された操作部品の擬似クラス。WCAG は押せない部品に基準を求めない。 */
const DISABLED = ':disabled';

// ── 色の計算 ───────────────────────────────────────────────────────────────
const hex3 = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const toHex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = hex3(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** 半透明を下地に重ねた実効色 */
const over = (fg, alpha, bg) => {
  const a = hex3(fg); const b = hex3(bg);
  return toHex(a.map((v, i) => v * alpha + b[i] * (1 - alpha)));
};

// ── :root のトークンを読む ────────────────────────────────────────────────
const rootBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {')));
const TOKENS = {};
for (const line of rootBlock.split('\n')) {
  const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
  if (m) TOKENS[m[1]] = m[2].trim();
}

/**
 * 色の式を実効的な hex にする。解決できない形は null (判定から外す)。
 * `rgb(var(--x-rgb) / .18)` は下地に重ねて実効色にする。
 */
function resolve色(value, bg, depth = 0) {
  if (!value || depth > 6) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.length > 7 ? v.slice(0, 7) : v;
  const varOnly = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varOnly) return resolve色(TOKENS[varOnly[1]], bg, depth + 1);
  // rgb(var(--x) / a) / rgb(var(--x))
  const rgbVar = v.match(/^rgba?\(\s*var\((--[a-z0-9-]+)\)\s*(?:\/\s*([0-9.]+)\s*)?\)$/i);
  if (rgbVar) {
    const triple = TOKENS[rgbVar[1]];
    if (!triple) return null;
    const nums = triple.trim().split(/[\s,]+/).map(Number);
    if (nums.length < 3 || nums.some(Number.isNaN)) return null;
    const solid = toHex(nums);
    const alpha = rgbVar[2] === undefined ? 1 : Number(rgbVar[2]);
    return alpha >= 1 ? solid : over(solid, alpha, bg);
  }
  const rgbLit = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([0-9.]+)\s*)?\)$/i);
  if (rgbLit) {
    const solid = toHex([+rgbLit[1], +rgbLit[2], +rgbLit[3]]);
    const alpha = rgbLit[4] === undefined ? 1 : Number(rgbLit[4]);
    return alpha >= 1 ? solid : over(solid, alpha, bg);
  }
  return null;   // グラデーション・color-mix・transparent などは対象外
}

/**
 * その規則の opacity。要素ごと薄めると文字も薄まるので、下地に対して合成して効かせる。
 * (押せる要素を opacity で薄めて基準を割っていたのを見落とした)
 */
function opacityOf(body) {
  const m = body.match(/(?:^|;)\s*opacity:\s*([0-9.]+)/);
  const v = m ? Number(m[1]) : 1;
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
}

/** その規則の文字の大きさ。小さいものだけ 4.5:1 を求める。 */
function fontPx(body) {
  const size = body.match(/font-size:\s*([0-9.]+)px/);
  if (size) return Number(size[1]);
  const shorthand = body.match(/font:\s*[^;]*?([0-9.]+)px/);
  if (shorthand) return Number(shorthand[1]);
  return null;   // 不明なら小さい側として扱う
}

// ── 規則を集める ─────────────────────────────────────────────────────────
const RULES = [];
{
  const RULE = /([^{}]+)\{([^{}]*)\}/g;
  let r;
  while ((r = RULE.exec(CSS)) !== null) {
    const raw = r[1];
    // 除外の印はコメントに書くので、コメントを落とす前に見る
    if (raw.includes('contrast-ignore')) continue;
    // 直前のコメントがセレクタに混ざると、土台の規則と前方一致しなくなる
    // (これで状態クラスの色の受け継ぎが効かず、薄めた文字を取りこぼしていた)
    const selector = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@') || selector.includes(':root')) continue;
    // 無効化された操作部品は WCAG の対象外 (押せないものは基準を求めない)
    if (selector.includes(DISABLED)) continue;
    RULES.push({ selector, body: r[2] });
  }
}

const colorOf = (body) => body.match(/(?:^|;|\{)\s*color:\s*([^;]+)/)?.[1];
const bgOf = (body) => body.match(/(?:^|;)\s*background(?:-color)?:\s*([^;]+)/)?.[1];

/**
 * 状態クラス (`.is-off` など) だけを足した規則は、色を土台の規則から受け継ぐ。
 * `opacity` と `color` が別の規則に分かれていると、規則を1つずつ見るだけでは
 * 「薄めた押せる要素の文字」を取りこぼす (実際に取りこぼした)。
 */
function inherited(selector, pick) {
  let found;
  for (const rule of RULES) {
    if (rule.selector === selector || rule.selector.includes(',')) continue;
    if (!selector.startsWith(rule.selector)) continue;
    // 文字列の前方一致だけだと `.timeline-legend` が `.timeline-legend-item` に当たってしまう。
    // 続きが状態の付け足し (`.` `:` `[`) のときだけ「同じ要素の別の状態」とみなす。
    const rest = selector.slice(rule.selector.length);
    if (rest && !/^[.:[]/.test(rest)) continue;
    const value = pick(rule.body);
    if (value) found = value;   // 後に書かれた方が勝つ
  }
  return found;
}

// ── 規則を1つずつ見る ─────────────────────────────────────────────────────
const failures = [];
const passes = [];
for (const { selector, body } of RULES) {
  const ownColor = colorOf(body);
  const alphaHere = opacityOf(body);
  // 色を持たない規則でも、薄めているなら土台の色に効いてしまう
  const colorValue = ownColor ?? (alphaHere < 1 ? inherited(selector, colorOf) : undefined);
  if (!colorValue) continue;
  const colorDecl = [null, colorValue];
  const bgValue = bgOf(body) ?? (ownColor ? undefined : inherited(selector, bgOf));
  const bgDecl = bgValue ? [null, bgValue] : null;

  // 大きさも土台から受け継ぐ (状態クラスの規則は font-size を持たないことが多い)
  const px = fontPx(body) ?? (ownColor ? null : (inherited(selector, (b) => String(fontPx(b) ?? '')) || null));
  const weight = Number((body.match(/font-weight:\s*(\d+)/) ?? body.match(/font:\s*(\d{3})/) ?? [])[1] ?? 400);
  // 大きい文字 (18.66px 以上の太字 / 24px 以上) は 3:1 でよい
  const large = px !== null && Number(px) > 0 && (Number(px) >= 24 || (Number(px) >= 18.66 && weight >= 700));
  const need = large ? 3 : 4.5;

  for (const parent of bgDecl ? ['#ffffff'] : SURFACES) {
    const bg = bgDecl ? resolve色(bgDecl[1], parent) : parent;
    if (!bg) continue;
    const solid = resolve色(colorDecl[1], bg);
    if (!solid) continue;
    // 要素ごと薄めているなら、文字も下地に溶ける
    const alpha = opacityOf(body);
    const fg = alpha >= 1 ? solid : over(solid, alpha, bg);
    const r = ratio(fg, bg);
    const row = { selector, fg, bg, r, need, px };
    if (r < need) { failures.push(row); break; }
    if (!bgDecl && parent !== WORST_SURFACE) continue;   // 背景指定なしは最悪面だけ記録
    passes.push(row);
  }
}

const fmt = (row) =>
  `${row.r.toFixed(2).padStart(5)}:1 (要 ${row.need})  ${row.fg} / ${row.bg}  ${row.px ?? '?'}px  ${row.selector.slice(0, 68)}`;

if (SHOW_ALL) {
  console.log(`--- 通った組み合わせ (${passes.length}件) ---`);
  for (const row of passes) console.log(`OK  ${fmt(row)}`);
  console.log('');
}
if (failures.length > 0) {
  console.log(`--- 基準割れ (${failures.length}件) ---`);
  for (const row of failures) console.log(`NG  ${fmt(row)}`);
  console.log(`\n${failures.length}件が基準を下回っています。`);
  process.exit(1);
}
console.log(`検算した規則 ${passes.length}件 — 基準割れなし。`);
