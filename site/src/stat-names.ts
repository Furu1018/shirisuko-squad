/**
 * 効果キーの日本語名。
 *
 * 計算エンジンは効果を `atk_dmg_pct` のような英語キーで扱う — スキルテキストを
 * パースした結果なので名前は一つに固定される必要がある。ただし画面にそのまま出すと
 * 「意味の分からない文字列」になるため、ここで日本語に変換する。
 *
 * 知らないキーは**キーをそのまま返す**。新キャラで未知の効果が来ても、
 * 空欄になる代わりに英語で残る — 無いよりまし。
 *
 * (しりすこスクワッド: 上流の韓国語表を NIKKE 日本語版の公式用語に置き換えたもの。
 *  キーと構造は上流と同一に保つ — 上流同期時は値だけ突き合わせる)
 */

/** 値の後ろに付く単位。ほとんどはパーセントポイントで、いくつかだけ秒を使う。 */
const SECONDS = new Set([
  'burst_cooldown', 'burst_cooldown_reduce', 'fullburst_duration', 'charge_time_fixed',
  'charge_time_flat', 'reload_time_fixed', 'effect_interval', 'named_buff_duration_extend',
]);

/** `_pct` で終わらないがパーセントポイントのキー。 */
const PERCENT = new Set(['crit_rate', 'crit_dmg', 'normal_atk_crit_rate', 'received_dmg']);

export const STAT_NAMES: Record<string, string> = {
  accumulate_max_scale_pct: '累積上限倍率',
  accuracy_pct: '命中率',
  ammo_charge_flat: '装弾チャージ',
  ammo_charge_pct: '装弾チャージ',
  armor_break_damage: 'アーマーブレイクダメージ',
  armor_break_dmg_pct: 'アーマーブレイクダメージ増加',
  armor_break_enabled: 'アーマーブレイク付与',
  atk_buff_mag_pct: '攻撃力バフ増幅',
  atk_caster_based_pct: '攻撃力増加(かけた側基準)',
  atk_copy: '攻撃力コピー',
  atk_dmg_pct: '与ダメージ増加',
  atk_flat: '攻撃力増加(固定値)',
  atk_from_hp_pct: '最大HP比例攻撃力',
  atk_pct: '攻撃力増加',
  attack_speed_pct: '攻撃速度',
  auto_damage: '自動ダメージ',
  bonus_damage: '追加ダメージ',
  buff_max_stack_add: 'バフ最大スタック増加',
  buff_stack_add: 'バフスタック追加',
  buff_stack_init: 'バフスタック初期化',
  buff_stack_remove: 'バフスタック解除',
  burst_charge_pct: 'バーストゲージチャージ',
  burst_charge_speed_pct: 'バーストゲージチャージ速度',
  burst_cooldown: 'バーストクールタイム',
  burst_cooldown_reduce: 'バーストクールタイム減少',
  burst_damage: 'バーストダメージ',
  burst_dmg_aoe_pct: 'バースト範囲ダメージ増加',
  burst_dmg_pct: 'バーストダメージ増加',
  burst_reentry: 'バースト再突入',
  charge_dmg_mag_pct: 'チャージダメージ倍率増幅',
  charge_dmg_pct: 'チャージダメージ増加',
  charge_dmg_per_max_ammo_pct: '最大装弾ごとのチャージダメージ',
  charge_speed_buff_immune: 'チャージ速度バフ免疫',
  charge_speed_caster_based_pct: 'チャージ速度(かけた側基準)',
  charge_speed_debuff_immune: 'チャージ速度デバフ免疫',
  charge_speed_overflow_conversion_pct: '超過チャージ速度変換',
  charge_speed_pct: 'チャージ速度',
  charge_time_fixed: 'チャージ時間固定',
  charge_time_flat: 'チャージ時間増減',
  core_damage: 'コアダメージ',
  core_dmg_pct: 'コアダメージ増加',
  cover_def_pct: '遮蔽物防御力',
  cover_disabled: '遮蔽不可',
  cover_heal_from_caster_max_hp_pct: '遮蔽物回復(かけた側最大HP比例)',
  cover_heal_pct: '遮蔽物回復',
  cover_hp_caster_based_pct: '遮蔽物HP(かけた側基準)',
  cover_max_hp_caster_based_pct: '遮蔽物最大HP(かけた側基準)',
  cover_received_dmg_split: '遮蔽物被ダメージ分散',
  cover_revive: '遮蔽物再生成',
  crit_dmg: 'クリティカルダメージ',
  crit_rate: 'クリティカル率',
  current_hp_reduce: '現在HP減少',
  damage: 'ダメージ',
  damage_accumulate: 'ダメージ累積',
  damage_accumulate_ratio_pct: 'ダメージ累積比率',
  debuff_cleanse: 'デバフ解除',
  debuff_immune: 'デバフ免疫',
  debuff_stack_add: 'デバフスタック追加',
  debuff_stack_remove: 'デバフスタック解除',
  decoy: 'デコイ',
  decoy_from_max_hp_pct: 'デコイHP(最大HP比例)',
  decoy_heal_from_caster_max_hp_pct: 'デコイ回復(かけた側最大HP比例)',
  def_caster_based_pct: '防御力増加(かけた側基準)',
  def_ignore_pct: '防御力無視',
  def_pct: '防御力増加',
  dmg_scale_mag_pct: 'ダメージ倍率増幅',
  dot_damage: '持続ダメージ',
  dot_dmg_pct: '持続ダメージ増加',
  effect_interval: '効果間隔',
  effect_range_pct: '効果範囲',
  effect_target_count_add: '効果対象数増加',
  element_bonus_pct: '優越コードダメージ',
  element_code_override: 'コード変更',
  element_received_dmg_pct: 'コード被ダメージ増加',
  enemy_buff_cleanse: '敵バフ解除',
  enemy_def_down_pct: '敵防御力減少',
  enemy_movement_disable: '敵移動不可',
  explosion_range: '爆発範囲',
  feather_refresh: 'フェザー再チャージ',
  fixed_damage_from_dealt_pct: '与ダメージ比例固定ダメージ',
  focus_fire: '集中射撃',
  force_move: '強制移動',
  force_reload: '強制リロード',
  force_skill_use: '強制スキル使用',
  fullburst_duration: 'フルバースト時間',
  gauge_charge: 'ゲージチャージ',
  gauge_charge_enabled: 'ゲージチャージ可能',
  gauge_consume: 'ゲージ消費',
  gauge_consume_as_ammo: 'ゲージを弾として消費',
  gauge_max_add: 'ゲージ最大値増加',
  harmful_immune_count: '有害効果免疫回数',
  heal_equal_split: '回復均等分配',
  heal_given_pct: '与回復量',
  heal_hp_pct: 'HP回復',
  heal_overcharge_discharge: '過剰回復放出',
  heal_overcharge_store: '過剰回復貯蔵',
  heal_overcharge_store_atk_pct: '過剰回復貯蔵(攻撃力比例)',
  heal_received_pct: '被回復量',
  heal_split: '回復分配',
  hp_caster_based_pct: 'HP回復(かけた側基準)',
  hp_copy: 'HPコピー',
  hp_only_caster_based_pct: 'HP増加(かけた側基準)',
  indomitable: '不屈',
  infinite_ammo: '弾薬無限',
  intercept_dmg_pct: '迎撃ダメージ増加',
  invincible: '無敵',
  lifesteal_pct: 'ダメージ吸収',
  lock_on: 'ロックオン',
  max_ammo_flat: '最大装弾数増加',
  max_ammo_infinite: '最大装弾無限',
  max_ammo_pct: '最大装弾数',
  max_hp_only_pct: '最大HP増加',
  max_hp_pct: '最大HP',
  mg_warmup_speed_pct: 'MG予熱速度',
  named_buff_duration_extend: '指定バフ持続延長',
  next_shield_hp_pct: '次の保護膜HP',
  normal_atk_crit_rate: '通常攻撃クリティカル率',
  normal_atk_dmg_pct: '通常攻撃ダメージ増加',
  optimal_range_max_pct: '適正距離上限',
  optimal_range_min: '適正距離下限',
  outgoing_heal_pct: '与回復量',
  part_dmg_pct: 'パーツダメージ増加',
  pellet_count: 'ペレット数',
  pellet_count_fixed: 'ペレット数固定',
  persona_state: 'ペルソナ状態',
  pierce_dmg_pct: '貫通ダメージ増加',
  pierce_enabled: '貫通付与',
  pierce_range: '貫通範囲',
  possessed: '憑依',
  projectile_attachment_damage: '付着弾ダメージ',
  projectile_attachment_dmg_pct: '付着弾ダメージ増加',
  projectile_dmg_pct: '投射物ダメージ増加',
  projectile_explosion_damage: '投射物爆発ダメージ',
  projectile_explosion_dmg_pct: '投射物爆発ダメージ増加',
  received_dmg: '敵の被ダメージ増加',
  received_dmg_pct: '被ダメージ増加',
  received_dmg_split: '被ダメージ分散',
  reload_speed_pct: 'リロード速度',
  reload_time_fixed: 'リロード時間固定',
  remove_named_buff: '指定バフ解除',
  revive: '復活',
  sequential_dmg_pct: '連続ダメージ増加',
  shared_shield_from_max_hp_pct: '共有保護膜(最大HP比例)',
  shield_dmg_pct: '保護膜ダメージ増加',
  shield_from_max_hp_pct: '保護膜(最大HP比例)',
  shield_heal_from_caster_max_hp_pct: '保護膜回復(かけた側最大HP比例)',
  shield_invincible: '保護膜無敵',
  skill_cooldown_pct: 'スキルクールタイム',
  skill_cooldown_reduce_pct: 'スキルクールタイム減少',
  split_damage: '分裂ダメージ',
  split_dmg_pct: '分裂ダメージ増加',
  squad_ammo_consume_as: '味方弾薬消費の代替',
  stealth: 'ステルス',
  stun: 'スタン',
  stun_immune: 'スタン免疫',
  targeting_exclude: 'ターゲット除外',
  taunt: '挑発',
  trigger_count_reduce: '発動回数減少',
  undying: '不死',
};

/** 効果キーの日本語名。知らないキーはそのまま返す。 */
export function statName(stat: string): string {
  return STAT_NAMES[stat] ?? stat;
}

/**
 * 「名前 +値単位」の1行。値が無ければ名前だけ返す。
 *
 * ほとんどの数値はパーセントなので `_pct` で終われば % を付け、クールタイム・持続の
 * ように時間を持ついくつかだけ秒を付ける。残りは単位なしで数字のみ。
 */
export function statText(stat: string, value?: number | null): string {
  const name = statName(stat);
  if (typeof value !== 'number' || !Number.isFinite(value)) return name;
  const unit = SECONDS.has(stat) ? '秒' : (stat.endsWith('_pct') || PERCENT.has(stat) ? '%' : '');
  const rounded = Math.round(value * 100) / 100;
  return `${name} ${rounded > 0 ? '+' : ''}${rounded}${unit}`;
}
