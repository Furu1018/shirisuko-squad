// 画面を組み立てるときの小道具。**どの画面にも属さない**ものだけを置く。
//
// `ui.ts` の中にあると、盤面などを別モジュールへ切り出すたびに一緒に連れて行く
// 必要が出る (実際、盤面の切り出しで «注入が要るもの» に数えられていた)。
import { elementLabel } from './display-name';

/** 必ずあるはずの要素を取る。無ければ止める — 静かに null で進むと原因が遠くで出る。 */
export const element = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`画面要素が見つかりません: ${selector}`);
  return found;
};

/** 文字だけの要素。 */
export const createText = (
  tag: keyof HTMLElementTagNameMap,
  value: string,
  className?: string,
): HTMLElement => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

/** 中身を後から足す要素。文字を渡せば `createText` と同じ。 */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// 属性 (コード) アイコン — 絵は `image/icon/icon-code-*.png` が正本。
// 自分で追加したニケが一覧に無いコードを使っていたら、静かにアイコンを省く。
const ELEMENT_ICON: Record<string, string> = {
  작열: 'fire', 수냉: 'water', 풍압: 'wind', 전격: 'electronic', 철갑: 'iron',
};

export const createElementIcon = (elementCode: string, className: string): HTMLElement | null => {
  const slug = ELEMENT_ICON[elementCode];
  if (!slug) return null;
  const icon = document.createElement('span');
  icon.className = `${className} element-icon is-${slug}`;
  icon.title = elementLabel(elementCode);
  icon.ariaLabel = elementLabel(elementCode);
  return icon;
};
