import type { BurstSequence } from './burst-order';

export type ElementCode = '' | '풍압' | '수냉' | '작열' | '전격' | '철갑';
// キューブ種別の正本は `data/base_stat_tables/cube.json` で、ゲームの更新で増え
// 続ける。一覧をここに焼き込むとデータが先行したとき静かにずれるので、名前は
// 文字列のままにし、実際の選択肢は `SettingsCatalog.cubes` のキーから得る。
export type CubeName = string;

export interface CubeSelection {
  name: CubeName;
  level: number;
}

export interface SkillLevels {
  '1': number;
  '2': number;
  '3': number;
}

export interface CharacterControl {
  tap_fire?: { rate: number; release?: number; full_charge_interval?: number };
  reload?: {
    policy: 'before_fb_end' | 'into_fb';
    lead?: number;
    margin?: number;
    if_dry?: boolean;
    duration?: number;
  };
  cover?: { policy: 'own_full_burst'; extend?: number };
  hold?: {
    policy: 'own_full_burst' | 'charge_hold_after_fb';
    lead?: number;
  };
}

// バースト運用の割り当て。auto はこのフィールド自体を置かない (エンジン既定の順序)。
// priority = n の倍数サイクルごとに優先使用 (every=n)、skip = なるべく使わない。
export type BurstAssignment =
  | { mode: 'priority'; every: number }
  /** 残り時間が `seconds`秒未満なら誰よりも先に使う。それまでは平常の順序。 */
  | { mode: 'endgame'; seconds: number }
  | { mode: 'skip' };
export type EquipPart = '머리' | '몸통' | '팔' | '다리';
export type EquipTier = '없음' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9';
export type EquipSetting = number | EquipTier;

// コレクションとお気に入りは同じスロットだ。favorite が 1~3 ならお気に入りを装着していて、
// そのとき stage は SR15 に固定される (ステータスが SR15 と同じ)。
export interface CollectionSelection {
  stage: string;
  favorite: number;
}

export interface CharacterOverrides {
  growthStage?: number;
  skillLevels?: SkillLevels;
  overload?: Record<string, number>;
  cube?: CubeSelection;
  collection?: CollectionSelection;
  control?: CharacterControl;
  manualStats?: Record<string, number>;
  burst?: BurstAssignment;
  /** 部位別の装備。数字 0~5 = 企業・オーバーロード強化段階、文字列 = 等級 ('없음' · 'T1'~'T9')。 */
  equipLevels?: Partial<Record<EquipPart, EquipSetting>>;
  /** 戦闘開始後、この時刻から手動リロードによる武器モード切り替えを試みる。 */
  weaponModeSwapAt?: number;
}

export interface GrowthOption {
  value: number;
  label: string;
  affinity: number;
}

export interface CustomCharacter {
  name: string;
  nikke: Record<string, unknown>;
  skills: unknown[];
}

// アカウントのコンソール (前哨基地リサイクルルーム)。キャラクターではなくアカウント属性なので
// リクエストの最上位に置き、スクワッド全員にまとめて適用される。
// 「共通」は全体で一つ、「クラス」・「企業」は所属ごとに別々に育つ — インゲームのリサイクル
// ルームがそういう作りで、エンジンも欠けた所属をエラーで弾く。
export interface ConsoleLevels {
  common_level: number;
  class_level: Record<string, number>;
  company_level: Record<string, number>;
}

export interface SimulationRequest {
  squad: string[];
  characters?: Record<string, CharacterOverrides>;
  customCharacters?: Record<string, { nikke: Record<string, unknown>; skills: unknown[] }>;
  duration: number;
  enemyDef: number;
  enemyCode: ElementCode;
  corePx: number;
  hasParts: boolean;
  seed: number;
  // 適正距離に置く武器種。その武器種の**通常攻撃**にだけ ③ ボーナス +30%。
  optimalRangeWeapons?: string[];
  // ボスフェーズ — 回避区間 (通常攻撃が外れる) と属性制限 (有利コードだけ通過)。
  immuneWindows?: PhaseWindow[];
  elementWindows?: ElementWindow[];
  rngMode?: RngMode;
  /** 手で決めたバースト順序。渡さなければ計算機が平常の順序で選ぶ。 */
  burstSequence?: BurstSequence;
  /**
   * 「精密分析」の表 (0.1秒刻み) を一緒に受け取るか。ダメージは元からヒットごとに整数で
   * 正確に数えているので、**数値が精密になるのではなく**見える刻みが細かくなる。
   * 常に受け取ると保存される結果が十倍重くなるため、書き出すときだけオンにする。
   */
  fineTimeline?: boolean;
  /** 回避区間の間はバーストゲージも溜まらないと見なすか。 */
  immuneBlocksBurst?: boolean;
  // 武器種別の通常攻撃係数。実戦で弾のばらつきにより外れる弾を補正する — 通常攻撃にだけ掛かり、
  // スキル・バーストと変身モード射撃には掛からない。渡さなければデータの既定値を使う。
  normalHitCoeff?: Record<string, number>;
  console?: ConsoleLevels;
  /** シンクロレベル。渡さなければエンジン既定のスペックレベル (400) を使う。 */
  synchroLevel?: number;
  // バーストゲージ充填時間 (秒)。ゲージ蓄積の代わりに使う固定時間だ。
  burstRegenTime?: number;
  /** バースト反応速度 (秒)。渡さなければエンジン既定値 (0.05) を使う。 */
  burstReaction?: number;
}

/** ボスフェーズの区間。`[from, to)` の半開区間だ。 */
export interface PhaseWindow { from: number; to: number }
/** 属性制限 — その区間の間、このコードに**有利な**キャラクターのダメージだけが入る。 */
export interface ElementWindow extends PhaseWindow { code: ElementCode }
/** 乱数処理。random = インゲームと同じ分散、expected = 期待値 (決定論的)。 */
export type RngMode = 'random' | 'expected';

export interface BattleSettings {
  duration: number;
  /**
   * シンクロデバイスのレベル。部隊に入れたニケは全員このレベルになるので、キャラクター設定では
   * なく戦闘条件に置く。アカウントの育成状態なので**共有コードには載らない** (コンソールと同じ)。
   */
  synchroLevel: number;
  enemyDef: number;
  enemyCode: ElementCode;
  coreEnabled: boolean;
  corePx: number;
  hasParts: boolean;
  seed: number;
  optimalRangeWeapons: string[];
  normalHitCoeff: Record<string, number>;
  /** 回避区間 — その区間の間、通常攻撃が命中しない。 */
  immuneWindows: PhaseWindow[];
  /** 属性制限 — その区間の間、有利コードだけが通る。 */
  elementWindows: ElementWindow[];
  rngMode: RngMode;
  immuneBlocksBurst: boolean;
  console: ConsoleLevels;
  burstRegenTime: number;
  /**
   * デッキごとに違うバーストゲージ充填時間 (秒)。デッキ番号 → 秒。
   * 空ならすべてのデッキが `burstRegenTime` 一つを共用する — バーストクールが遅れるデッキだけ
   * 個別に合わせるために置く値だ。
   */
  burstRegenPerDeck?: Record<number, number>;
  /**
   * バースト反応速度 (秒)。条件が揃ってから実際に押すまでにかかる時間で、
   * **バースト1つごとに**加算される — 3段階まで使うとその3倍だけ遅れる。
   */
  burstReaction: number;
}

export interface DeckState {
  id: number;
  squad: string[];
  characters: Record<string, CharacterOverrides>;
  /**
   * 手で決めたバースト順序。サイクルごとに段階別で誰を使うかを書く。
   * **デッキごとに別々だ** — 編成が違えば使える人も違う。
   */
  burstSequence?: BurstSequence;
}

export interface CharacterMeta {
  name: string;
  burstStage: string;
  elementCode: string;
  weaponType: string;
  className: string;
  manufacturer: string;
  preview: boolean;
  image: string | null;
  // Blablalink API がこのキャラクターを呼ぶ番号。辞書に無ければ null で、その場合
  // プロフィール同期はこのキャラクターを見分けられない (`data/name_codes.json`)。
  nameCode: number | null;
  // enikk がキャラクターを呼ぶ番号 (`resource_id`)。自前のスクレイプデータの `id` と同じだ。
  resourceId: number | null;
  // 日本語表示名 (しりすこスクワッド)。正本は data/name-map-ja.json。内部キーは name (韓国語) のまま、
  // 画面に出すときは display-name.ts の labelFor() を通す
  displayName?: string;
  // ユーザーが呼ぶ別名 (`수니스`·`세이렌`)。正本は `context/ALIASES.md` の別名表だ。
  // **探すときだけ使う** — 画面に出る名前はいつも正式名称だ。
  aliases: string[];
}

export interface BurstCast {
  t: number;
  stage: string;
}

export interface BattleTimeline {
  bucket: number;
  buckets: number;
  damage: Record<string, number[]>;
  bursts: Record<string, BurstCast[]>;
  fullBurst: [number, number][];
  /** バフが掛かっていた区間。旧版のキャッシュには無い。 */
  buffs?: BuffTrack[];
}

/**
 * バフ1行 — «誰が掛けた何のバフ» が一つ。受け手が複数なら1行にまとめる。
 * 同じバフが何度も掛かると `spans` にその分積み上がり、**スタックが変わるたびに切れる**
 * (いつから何重だったかがタイムラインの核心だ)。
 */
/**
 * 一区間 — `[開始(秒), 終了(秒), スタック]`、そして**対象が区間ごとに分かれるときだけ**4番目に
 * その区間を受けた人たち (`targets` 内の位置番号)。
 *
 * 리버렐리오 「차분한 수심 4」のように、発動ごとに攻撃力順位で対象が分かれるバフがある。
 * 1行にまとめると «両方受ける» と読めてしまうので、そういう行だけ区間に対象を付ける —
 * 常に付けると5人向けのバフで結果が何倍にも重くなる。
 */
export type BuffSpan = [number, number, number] | [number, number, number, number[]];

/** この区間を実際に受けた人たち。区間に書かれていなければ、行全体の対象がそのまま答えだ。 */
export const spanTargets = (track: BuffTrack, span: BuffSpan): string[] => {
  const picked = span[3];
  return picked ? picked.map((index) => track.targets[index] ?? '').filter(Boolean) : track.targets;
};

export interface BuffTrack {
  name: string;
  /** 掛けた人 — バーの色はこの人の色だ。 */
  caster: string;
  /** 受け手たち。 */
  targets: string[];
  stat?: string | null;
  value?: number | null;
  /** そのバフが積める最大スタック。1ならスタック型ではない。 */
  maxStack: number;
  /** `[開始, 終了, その区間のスタック]`。 */
  spans: BuffSpan[];
}

// キャラクター1人のダメージを通常攻撃とスキルに分けた内訳。
export interface CharacterDamageBreakdown {
  normal: number;
  normalHits: number;
  skill: number;
  skillHits: number;
  skills: Array<{ name: string; damage: number; hits: number }>;
}

export interface SimulationResult {
  squadTotal: number;
  duration: number;
  hitCount: number;
  charTotals: Record<string, number>;
  // 旧版のキャッシュに保存された結果には無いことがある。
  charBreakdown?: Record<string, CharacterDamageBreakdown>;
  previewNote: string;
  deviations: string;
  timeline?: BattleTimeline;
  /** 監視対象バフの実際の受け手 — `{掛けた人: [...]}`。旧版のキャッシュには無い。 */
  buffTargets?: Record<string, BuffTargetRow[]>;
  /** 0.1秒刻みに分けた同じ結果。`fineTimeline` をオンにしたリクエストにだけ載ってくる。 */
  fineTimeline?: BattleTimeline;
}

/** 「誰がこのバフを受けたか」の1行。対象が攻撃力順位で分かれ、編成だけでは分からない。 */
export interface BuffTargetRow {
  label: string;
  buff: string;
  /** 初めて受けた順で重複なし。2人以上なら戦闘中に対象が分かれた特異ケースだ。 */
  targets: string[];
  /** 発動ごとに誰が受けたかを時間順で。「順序を見る」がこれを描く。 */
  sequence?: Array<{ t: number; target: string }>;
  count: number;
  /** 背景で対象を計算している最中 — 画面には `[計算中]` と出る。 */
  pending?: boolean;
}

export interface RuntimeManifest {
  version: string;
  files: string[];
}

export interface NumericFieldMeta {
  label: string;
  unit: string;
  min: number;
  max: number;
}

export interface CubeLevelMeta {
  atk: number;
  def: number;
  hp: number;
  effect: number;
  commonElement: number;
}

export interface CubeMeta {
  label: string;
  // ゲーム内部の id — Blablalink 応答の `harmony_cube_tid` に合わせる。
  id: number;
  stat: string;
  template: string;
  levels: Record<string, CubeLevelMeta>;
  // 計算機がこのキューブの固有スキルをまだ処理できないときの理由。攻撃力・防御力・
  // 体力と共通の有利コード効果はそのまま付き、固有スキルだけが抜ける。
  unsupported?: string;
}

export interface CharacterSettingsDefaults {
  weaponType: string;
  recommendedControl: CharacterControl;
  hasConditionalControl: boolean;
  /**
   * 組み合わせ条件付きコントロールのうち «誰が一緒にいるか» だけを見る規則。スクワッドさえあれば
   * 画面が自力で判定できるので、計算前でもいま掛かるコントロールを書ける。
   * 別の条件を使う規則は下りてこない — `hasConditionalControl` でだけ知らせる。
   */
  conditionalControl?: Array<{
    withMembers: string[];
    control: CharacterControl;
    /** なぜこのコントロールが付くのか — 画面にそのまま見える。 */
    help?: string;
  }>;
  favoriteItem?: { name: string; stage: 3 };
  collection: CollectionSelection;
  growthStage: number;
  rarity: string;
  maxGrowthStage: number;
  growthOptions: GrowthOption[];
  skillLevels: SkillLevels;
  skillLevelsLocked: boolean;
  overload: Record<string, number>;
  cube: CubeSelection;
}

export interface SettingsCatalog {
  characters: Record<string, CharacterSettingsDefaults>;
  cubes: Record<CubeName, CubeMeta>;
  collectionStages: string[];
  weaponTypes: string[];
  /**
   * 適正距離を持つ武器種。ランチャーはインゲームに適正射程が無いため外れる —
   * 正本は `data/weapon_mechanics.json` の `optimal_range` だ。古い設定には無いことが
   * あり、無ければ武器種すべてと見なす (以前の画面と同じに)。
   */
  optimalRangeWeapons?: string[];
  /** 「誰がこのバフを受けたか」をカードに出すバフ — 正本は `calculator.customization`。 */
  buffTargetWatch: Record<string, Array<{ buff: string; label: string }>>;
  // 武器種別の通常攻撃係数の既定値 (`data/weapon_mechanics.json`)。
  normalHitCoeff: Record<string, number>;
  consoleClasses: string[];
  consoleCompanies: string[];
  overloadFields: Record<string, NumericFieldMeta>;
  manualStats: Record<string, NumericFieldMeta>;
  // コレクション id → 等級 ('R'|'SR'|'SSR')。SSR ならお気に入りなので、レベルを段階として読む。
  favoriteItems: Record<string, string>;
}

export interface DeckResultEntry {
  deckId: number;
  request: SimulationRequest;
  result: SimulationResult;
}

export interface BatchResult {
  total: number;
  decks: DeckResultEntry[];
}

/** 戦闘力は一覧の並べ替え用なので、ダメージ計算とは別に回る — ずっと軽い。 */
export interface CombatPowerRequest {
  names: string[];
  characters?: Record<string, CharacterOverrides>;
  customCharacters?: SimulationRequest['customCharacters'];
}

export interface WorkerRequest {
  id: number;
  type: 'prepare' | 'simulate' | 'combatPower';
  payload?: SimulationRequest | CombatPowerRequest;
}

export interface WorkerResponse {
  id: number;
  type: 'ready' | 'progress' | 'result' | 'error';
  payload?: SimulationResult | string;
}
