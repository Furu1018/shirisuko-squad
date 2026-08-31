import { describe, expect, it } from 'vitest';
import { labelFor, setDisplayNames } from './display-name';
import type { CharacterMeta } from './types';

const meta = (name: string, displayName?: string): CharacterMeta => ({
  name,
  displayName,
  burstStage: '3',
  elementCode: '작열',
  weaponType: 'AR',
  className: '화력형',
  manufacturer: '엘리시온',
  preview: false,
  image: null,
  nameCode: null,
  resourceId: null,
  aliases: [],
});

describe('display-name', () => {
  it('catalog の displayName で韓国語キーを日本語表示名に変換する', () => {
    setDisplayNames([meta('라피', 'ラピ'), meta('라피 : 레드 후드', 'ラピ：レッドフード')]);
    expect(labelFor('라피')).toBe('ラピ');
    expect(labelFor('라피 : 레드 후드')).toBe('ラピ：レッドフード');
  });

  it('辞書に無い名前 (自作ニケ等) はそのまま返す', () => {
    setDisplayNames([meta('라피', 'ラピ')]);
    expect(labelFor('커스텀 니케')).toBe('커스텀 니케');
  });

  it('displayName が無いエントリは登録しない / 再設定で置き換わる', () => {
    setDisplayNames([meta('라피')]);
    expect(labelFor('라피')).toBe('라피');
    setDisplayNames([meta('라피', 'ラピ')]);
    expect(labelFor('라피')).toBe('ラピ');
  });
});
