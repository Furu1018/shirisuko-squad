import { SYNCHRO_MAX } from './model';
import { NO_CUBE } from './character-settings';
import type {
  CharacterMeta,
  CharacterOverrides,
  EquipPart,
  EquipSetting,
  SettingsCatalog,
} from './types';

export const BLABLA_SERVERS = [
  { area: 83, label: '韓国' },
  { area: 81, label: '日本' },
  { area: 84, label: 'グローバル' },
  { area: 82, label: '北米' },
  { area: 85, label: '東南アジア' },
] as const;

export function blablaServerLabel(area: number): string {
  return BLABLA_SERVERS.find((server) => server.area === area)?.label ?? `サーバー ${area}`;
}

// Blablalink プロフィール応答 → キャラクター別 override。
//
// 応答はプロキシ (`worker/`) がそのまま渡してきた生の JSON である。ここでこちらの用語に移し替えるが、
// 規則はレッツドロ CSV 取り込み (`csv-import.ts`) と同じ場所に落ちるように合わせる — 二つの
// 経路が同じアカウントに別々のスペックを作ると、どちらが正しいのか分からなくなる。
//
// CSV と違うのは、こちらが**キューブとコレクションの実物**までくれることである。ただし好感度は
// 計算機が突破段階から引き出すので (`context/growth.growth_options`)、応答の
// `attractive_lv` は使わない — その軸を新しく作ると CSV 側と食い違う。

/** プロキシが返してくるサーバー1つ分の生応答。必要なフィールドだけ狭く書く。 */
export interface RawArea {
  area: number;
  characters: Array<{ name_code: number; grade?: number; core?: number; lv?: number }>;
  details: Array<Record<string, number>>;
  stateEffects: Array<{
    // オプション id はここでは**文字列**で来て、装備スロットでは数値で来る (実測 2026-08-23)。
    // そのまま突き合わせると一つも一致せず、オーバーロードが丸ごと 0 になる。
    id: number | string;
    function_details?: Array<{ function_type?: string; function_value?: number }>;
  }>;
  // リサイクルルームのレベルのフィールドは `lv` である (`level` ではない — 実測 2026-08-23)。
  // synchro_level はアカウントのシンクロレベル (前哨基地が非公開なら outpost ごと null)
  outpost: {
    recycle_room_researches?: Array<{ tid: number; lv: number }>;
    synchro_level?: number;
  } | null;
}

export interface RawProfile {
  openid: string;
  areas: RawArea[];
}

export interface ProfileImport {
  overrides: Record<string, CharacterOverrides>;
  matched: string[];
  /** 辞書に無い name_code — 計算機がまだ扱っていないニケである。 */
  unmatched: number[];
  /** 人に見せる注意書き。 */
  notes: string[];
}

// ゲーム内部のオプション名 → こちらのオーバーロードキー。`scraper/profile_fetch.py` FUNC_TO_EQUIP と
// 同じ表である。あちらが正本なので、変わったら一緒に直す。
const FUNCTION_TO_OVERLOAD: Record<string, string> = {
  StatAtk: 'atk_pct',
  IncElementDmg: 'element_bonus',
  StatAmmoLoad: 'max_ammo_pct',
  StatCritical: 'crit_rate',
  StatCriticalDamage: 'crit_dmg',
  StatChargeTime: 'charge_speed_pct',
  StatChargeDamage: 'charge_dmg_pct',
  StatAccuracyCircle: 'accuracy_pct',
  IncHurtDef: 'def_pct',
  StatDef: 'def_pct',
};

// 応答の部位接頭辞 → こちらの部位名。胴体が `torso`、手袋が `arm` である。
const PARTS: Array<[string, EquipPart]> = [
  ['head', '머리'],
  ['torso', '몸통'],
  ['arm', '팔'],
  ['leg', '다리'],
];

// equip_tier 10 = 企業装備 (強化 0〜5)。1〜9 は一般 T1〜T9 で強化自体が無く、0 は未装着である。
// こちらの設定は部位ごとに強化レベルを一つしか受け取らないので、その二つは 0 に畳まれる。
const CORP_TIER = 10;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** 貼り付けた値が Blablalink プロフィール URL に見えるか。最終判断はプロキシがする。 */
export function looksLikeProfileUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (/^\d{6,}$/.test(trimmed)) return true;
  if (/^\d+-\d{6,}$/.test(trimmed)) return true;
  try {
    return /(^|\.)blablalink\.com$/i.test(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

/** state_effects → {オプション id: [オーバーロードキー, パーセント]}。 */
function buildOptionMap(effects: RawArea['stateEffects']): Map<number, [string, number]> {
  const map = new Map<number, [string, number]>();
  for (const effect of effects) {
    const id = Number(effect.id);
    if (!Number.isFinite(id)) continue;
    // 詳細をバッチに分けて受け取るので、同じオプションが何度も来る。先に来たものだけ使えばよい。
    if (map.has(id)) continue;
    const detail = effect.function_details?.[0];
    const key = detail?.function_type ? FUNCTION_TO_OVERLOAD[detail.function_type] : undefined;
    if (!key) continue;
    // チャージ時間の短縮だけ負で来て、残りは正。こちらの表は全部正のパーセントで揃えている。
    map.set(id, [key, Math.abs(Number(detail?.function_value ?? 0)) / 100]);
  }
  return map;
}

/** オーバーロード12スロットの合算。state_effects は重複除去されて来るので、スロットの側を直接辿る。 */
function overloadOf(
  detail: Record<string, number>,
  options: Map<number, [string, number]>,
  fields: string[],
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const field of fields) total[field] = 0;
  for (const [prefix] of PARTS) {
    for (const slot of [1, 2, 3]) {
      const id = Number(detail[`${prefix}_equip_option${slot}_id`] ?? 0);
      const hit = id ? options.get(id) : undefined;
      if (!hit) continue;
      const [key, value] = hit;
      if (key in total) total[key] = Number((total[key]! + value).toFixed(4));
    }
  }
  return total;
}

function equipLevelsOf(detail: Record<string, number>): Partial<Record<EquipPart, EquipSetting>> {
  const levels: Partial<Record<EquipPart, EquipSetting>> = {};
  for (const [prefix, part] of PARTS) {
    const tier = detail[`${prefix}_equip_tier`] ?? 0;
    // 三つを区別して渡す。かつては企業でなければ全部 «強化 0» と書いていたが、
    // 強化 0 にもフラットステータスが付いていて、未装着・一般装備がそのまま攻撃力を得ていた
    // (4部位未装着で約1万)。`scraper/profile_fetch.py` がしている区別と同じである。
    levels[part] = tier >= CORP_TIER
      ? clamp(detail[`${prefix}_equip_lv`] ?? 0, 0, 5)
      : tier >= 1 ? (`T${tier}` as EquipSetting) : '없음';
  }
  return levels;
}

/**
 * コレクションスロット → こちらの設定。一つのスロットをコレクション (R・SR) とお気に入り (SSR) が分け合う。
 *
 * お気に入りはステータスが SR15 と同じなので、等級は SR15 と書いて段階だけ別に渡す — 段階が
 * 変えるのはステータスではなくスキルの版である。
 */
function collectionOf(
  detail: Record<string, number>,
  grades: Record<string, string>,
): { stage: string; favorite: number } | null {
  const tid = detail.favorite_item_tid ?? 0;
  if (!tid) return { stage: '없음', favorite: 0 };
  const grade = grades[String(tid)];
  if (!grade) return null;            // 모르는 소장품은 기본값을 남기는 편이 낫다
  const level = detail.favorite_item_lv ?? 0;
  if (grade === 'SSR') return { stage: 'SR15', favorite: clamp(level + 1, 1, 3) };
  return { stage: `${grade}${clamp(level, 0, 15)}`, favorite: 0 };
}

function cubeOf(
  detail: Record<string, number>,
  cubes: SettingsCatalog['cubes'],
): { name: string; level: number } | null {
  const tid = detail.harmony_cube_tid ?? 0;
  if (!tid) return null;              // 큐브를 안 낀 상태 — 기본값을 그대로 둔다
  for (const [name, meta] of Object.entries(cubes)) {
    if (meta.id === tid) return { name, level: clamp(detail.harmony_cube_lv ?? 0, 1, 15) };
  }
  return null;
}

/**
 * サーバー1つ分の生応答をキャラクター別 override に移し替える。
 *
 * `characters` (所持一覧) と `details` (育成詳細) は互いに別のものをくれる。突破・コア強化は
 * シンクロが反映された所持一覧の側が正しく、スキル・装備・コレクションは詳細の側にしか無い。
 */
export function areaToOverrides(
  area: RawArea,
  settings: SettingsCatalog,
  catalog: CharacterMeta[],
): ProfileImport {
  const nameByCode = new Map<number, string>();
  for (const entry of catalog) {
    if (entry.nameCode !== null) nameByCode.set(entry.nameCode, entry.name);
  }

  const options = buildOptionMap(area.stateEffects ?? []);
  const overloadFields = Object.keys(settings.overloadFields);
  const rosterByCode = new Map(area.characters.map((entry) => [entry.name_code, entry]));

  const overrides: Record<string, CharacterOverrides> = {};
  const matched: string[] = [];
  const unmatched: number[] = [];
  const notes: string[] = [];
  // 注意文の «N種» も人単位で数える。matched だけ一意化すると、同じニケが2度来たときに
  // ここだけ実人数を超える。
  const unknownCollectionNames = new Set<string>();
  const noCubeNames = new Set<string>();

  for (const detail of area.details ?? []) {
    const code = Number(detail.name_code);
    const name = nameByCode.get(code);
    if (!name) { unmatched.push(code); continue; }
    const defaults = settings.characters[name];
    if (!defaults) { unmatched.push(code); continue; }

    const override: CharacterOverrides = {};
    override.overload = overloadOf(detail, options, overloadFields);

    const roster = rosterByCode.get(code);
    const breakthrough = Number(roster?.grade ?? 0);
    const core = Number(roster?.core ?? 0);
    override.growthStage = clamp(breakthrough + core, 0, defaults.maxGrowthStage);

    if (!defaults.skillLevelsLocked) {
      const s1 = Number(detail.skill1_lv ?? 0);
      const s2 = Number(detail.skill2_lv ?? 0);
      const s3 = Number(detail.ulti_skill_lv ?? 0);
      if (s1 && s2 && s3) {
        override.skillLevels = {
          '1': clamp(s1, 1, 10), '2': clamp(s2, 1, 10), '3': clamp(s3, 1, 10),
        };
      }
    }

    const collection = collectionOf(detail, settings.favoriteItems);
    if (collection) override.collection = collection;
    else unknownCollectionNames.add(name);

    const cube = cubeOf(detail, settings.cubes);
    if (cube) override.cube = cube;
    else if (!detail.harmony_cube_tid) {
      // 「取込が持っていない」ではなく「着けていない」— 区別しないと、外したキューブが
      // マージで前回の値のまま残る
      override.cube = { name: NO_CUBE, level: 0 };
      noCubeNames.add(name);
    }

    override.equipLevels = equipLevelsOf(detail);

    overrides[name] = override;
    // 同じニケが2度来ても1件として数える。`matched.length` は取込件数の表示と
    // 「今回に無かった N名」の計算に使うので、重複すると数字がずれる。
    if (!matched.includes(name)) matched.push(name);
  }

  if (unknownCollectionNames.size > 0) {
    notes.push(`소장품을 알아보지 못한 니케 ${unknownCollectionNames.size}종 — 그 니케만 기본 소장품으로 계산합니다.`);
  }
  if (noCubeNames.size > 0) {
    notes.push(`큐브를 끼지 않은 니케 ${noCubeNames.size}종 — 그 니케만 기본 큐브로 계산합니다.`);
  }
  if (unmatched.length > 0) {
    notes.push(`계산기가 아직 다루지 않는 니케 ${unmatched.length}종은 건너뛰었습니다.`);
  }

  return { overrides, matched, unmatched, notes };
}

/**
 * サーバーが複数あれば、ニケを一番多く持つサーバーを使う。
 *
 * 一つのアカウントに韓国サーバーと日本サーバーが同時にぶら下がることもあるが、二つを合わせると同じニケの
 * 育成状態が混ざってしまう。主に使うアカウントの方がニケが多い、というのが一番外れにくい推定である。
 */
export function pickArea(profile: RawProfile, preferredArea?: number): RawArea | null {
  if (preferredArea !== undefined) {
    return profile.areas?.find((area) => area.area === preferredArea) ?? null;
  }
  let best: RawArea | null = null;
  for (const area of profile.areas ?? []) {
    if (!best || (area.characters?.length ?? 0) > (best.characters?.length ?? 0)) best = area;
  }
  return best;
}

/** コンソール (リサイクルルーム) tid → 計算機のコンソール設定の置き場。`profile_fetch.py` CONSOLE_TIDS と同じ。 */
const CONSOLE_TIDS: Record<number, ['common' | 'class' | 'company', string]> = {
  1001: ['common', ''],
  1101: ['class', '화력형'], 1102: ['class', '방어형'], 1103: ['class', '지원형'],
  1201: ['company', '엘리시온'], 1202: ['company', '미실리스'], 1203: ['company', '테트라'],
  1204: ['company', '필그림'], 1205: ['company', '어브노말'],
};

export interface ConsoleImport {
  common_level: number;
  class_level: Record<string, number>;
  company_level: Record<string, number>;
}

/**
 * 何も上げていないコンソール。**枠は全部あって値だけ 0** である — エンジンは欠けた所属を拒むので、
 * «分からない» を «0 とみなす» に書き換えて初めて計算が回る (前哨基地が非公開のときに使う)。
 */
export function emptyConsole(): ConsoleImport {
  const out: ConsoleImport = { common_level: 0, class_level: {}, company_level: {} };
  for (const [kind, bucket] of Object.values(CONSOLE_TIDS)) {
    if (kind === 'class') out.class_level[bucket] = 0;
    else if (kind === 'company') out.company_level[bucket] = 0;
  }
  return out;
}

/**
 * 取り込んだプロフィールからシンクロレベルを読む。**取れないときは null** —
 * 前哨基地が非公開だと outpost ごと来ないので、そのときは今の設定を触らない
 * (コンソールと同じ原則。0 や既定で覆うと手で入れた値が消える)。
 *
 * 元のシステムはソロレイド用でシンクロ 400 固定だったが、このサイトは
 * 「自分のシンクロで理論値を出す」のが役目 — 取れた値は必ず反映する。
 */
export function synchroFrom(area: RawArea): number | null {
  const raw = area.outpost?.synchro_level;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 1 || raw > SYNCHRO_MAX) return null;   // 壊れた値で戦闘条件を汚さない
  return raw;
}

/**
 * 前哨基地の応答 → コンソールレベル。前哨基地が非公開だと来ないので、null が正常である。
 *
 * 上げていない研究は応答にそもそも**無い**。その枠を空のまま渡すとエンジンが
 * «クラスコンソールに欠けた所属がある» と拒む (欠けた所属が黙って 0 になるのを
 * 防ぐ仕掛けである)。ここで 0 で埋め、«上げていない» という意味をはっきり書いて送る。
 */
export function consoleFrom(area: RawArea): ConsoleImport | null {
  const researches = area.outpost?.recycle_room_researches;
  if (!researches || researches.length === 0) return null;
  const result = emptyConsole();
  let seen = false;
  for (const entry of researches) {
    const slot = CONSOLE_TIDS[Number(entry.tid)];
    if (!slot) continue;
    seen = true;
    const level = Math.max(0, Math.trunc(Number(entry.lv) || 0));
    if (slot[0] === 'common') result.common_level = level;
    else if (slot[0] === 'class') result.class_level[slot[1]] = level;
    else result.company_level[slot[1]] = level;
  }
  return seen ? result : null;
}
