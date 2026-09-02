// 戦闘条件の一行まとめ。「180秒 · 敵 電撃 · コア 24px · 期待値」のように畳んで見せる。
//
// もとは共有サーバのクライアント (`share-server.ts`) に同居していたが、
// あれは «サーバーに送る一覧の説明文» を作るためにここに置かれていただけで、
// 中身はただの整形処理だった。共有をやめても畳んだ見出しには要るので切り出す。
import { elementLabel } from './display-name';
import type { BattleShare } from './share-code';

export function summarizeBattle(battle: BattleShare): string {
  const parts = [`${battle.duration}秒`];
  parts.push(battle.enemyCode ? `敵 ${elementLabel(battle.enemyCode)}` : '無属性');
  parts.push(battle.coreEnabled ? `コア ${battle.corePx}px` : 'コアなし');
  if (battle.hasParts) parts.push('パーツ');
  if (battle.optimalRangeWeapons.length > 0) {
    parts.push(`適正 ${battle.optimalRangeWeapons.join('·')}`);
  }
  if (battle.immuneWindows.length > 0) parts.push(`回避 ${battle.immuneWindows.length}`);
  if (battle.elementWindows.length > 0) parts.push(`属性制限 ${battle.elementWindows.length}`);
  parts.push(battle.rngMode === 'expected' ? '期待値' : '乱数');
  return parts.join(' · ');
}
