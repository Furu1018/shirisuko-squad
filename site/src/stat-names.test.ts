import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STAT_NAMES, statName, statText } from './stat-names';

describe('効果名', () => {
  it('スキルデータに使われる効果キーをすべて日本語で持っている', () => {
    // 新キャラが未知の効果を持ってきたらここで捕まる — 画面に英語が漏れるのを防ぐ。
    const raw = readFileSync(
      join(import.meta.dirname, '..', '..', 'data', 'parsed_skills.json'), 'utf8',
    );
    const used = new Set(
      [...raw.matchAll(/"stat":\s*"([a-z_]+)"/g)].map((match) => match[1]!),
    );
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((stat) => !(stat in STAT_NAMES)).sort();
    expect(missing).toEqual([]);
  });

  it('知らないキーは消さずにそのまま残す', () => {
    expect(statName('made_up_stat')).toBe('made_up_stat');
    expect(statText('made_up_stat', 3)).toBe('made_up_stat +3');
  });

  it('パーセントと秒を使い分けて付ける', () => {
    expect(statText('atk_dmg_pct', 20.994)).toBe('与ダメージ増加 +20.99%');
    expect(statText('crit_rate', 11.85)).toBe('クリティカル率 +11.85%');    // `_pct` でなくても % のキー
    expect(statText('burst_cooldown_reduce', 5.34)).toBe('バーストクールタイム減少 +5.34秒');
    expect(statText('buff_stack_add', 1)).toBe('バフスタック追加 +1');
  });

  it('値が無ければ名前だけ書く', () => {
    expect(statText('invincible')).toBe('無敵');
    expect(statText('atk_pct', Number.NaN)).toBe('攻撃力増加');
  });

  it('下がる値は符号をそのまま残す', () => {
    expect(statText('def_pct', -12.5)).toBe('防御力増加 -12.5%');
  });
});
