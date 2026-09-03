// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { createElementIcon, createText, el, element } from './dom';

describe('画面を組み立てる小道具', () => {
  it('element は無ければ止める (静かに null で進むと原因が遠くで出る)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-x>ある</p>';
    expect(element(root, '[data-x]').textContent).toBe('ある');
    expect(() => element(root, '[data-none]')).toThrow('画面要素が見つかりません');
  });

  it('createText は文字と class を載せる', () => {
    const node = createText('b', 'ラピ', 'who');
    expect(node.tagName).toBe('B');
    expect(node.textContent).toBe('ラピ');
    expect(node.className).toBe('who');
  });

  it('el は class も文字も省ける', () => {
    expect(el('div').className).toBe('');
    expect(el('div', 'box').className).toBe('box');
    expect(el('span', 'x', 'あ').textContent).toBe('あ');
    // 空文字は «文字を渡した» 扱い (undefined と区別する)
    expect(el('span', 'x', '').textContent).toBe('');
  });

  it('属性アイコンは 5属性ぶん出て、知らないコードは静かに省く', () => {
    for (const [code, slug] of [['작열', 'fire'], ['수냉', 'water'], ['풍압', 'wind'],
      ['전격', 'electronic'], ['철갑', 'iron']] as const) {
      const icon = createElementIcon(code, 'mark');
      expect(icon, code).not.toBeNull();
      expect(icon!.className).toBe(`mark element-icon is-${slug}`);
      // 読み上げにも属性が伝わること
      expect(icon!.getAttribute('aria-label')).toBeTruthy();
    }
    expect(createElementIcon('しらないコード', 'mark')).toBeNull();
  });
});
