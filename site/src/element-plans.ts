// 属性別ベスト編成 — 5属性それぞれに「これで行く」編成を最大3案まで置く。しりすこスクワッド。
//
// ここで扱うのは**ボスの特性を考えない、有利コードだけの編成**。
// コアやパーツ、回避区間といったボス固有の条件は後の段階 (ボス条件) で重ねる。
// 先に属性ごとの土台を決めておけば、ボスが変わるたびに編成から作り直さずに済む。
//
// 保存キーは `nikke-` で始める規約 (本家しりすこPADと同一オリジンで localStorage を共有するため)。
import type { StorageLike } from './cache';
import type { CharacterOverrides } from './types';

export const ELEMENT_PLANS_KEY = 'nikke-plans-v1';

/** 属性は内部キー (韓国語) のまま持つ。表示は elementLabel を通す。 */
export const PLAN_ELEMENTS = ['작열', '수냉', '풍압', '전격', '철갑'] as const;
export type PlanElement = (typeof PLAN_ELEMENTS)[number];

/**
 * 1属性あたりの上限。
 *
 * 以前は 3 だった (「3凸ぶん = 3案」) が、**それは凸の数であって候補の数ではない**。
 * 使い方は «属性ごとに編成をいくつも貯めて、その中から最良の3凸を機械に探させる» なので、
 * 貯める側を絞ると «可能性を広く見る» ことができない。
 *
 * 5属性 × 10 = 最大50候補。`bestTriple` の候補プール上限もこれに合わせてある。
 */
export const MAX_PLANS_PER_ELEMENT = 10;

/**
 * 「このコードのニケは、どのコードの敵に有利するか」。
 *
 * **正本は `calculator/damage.py` の `_CODE_ADVANTAGE`** — エンジンはこの表で有利コード補正を
 * 判定する。ここはその写しで、画面に「電撃編成 → 水冷ボス向け」と出すためだけに使う。
 * エンジンを無改変で保つ以上、値がずれたら画面の案内だけが嘘になるので、テストで対応を固定してある。
 */
export const BEATS: Record<PlanElement, PlanElement> = {
  전격: '수냉',
  수냉: '작열',
  작열: '풍압',
  풍압: '철갑',
  철갑: '전격',
};

/**
 * 案に登録した理論値。**どの条件で出した値か**を一緒に残す —
 * 数字だけ覚えると、戦闘時間を変えた後で古い値を新しい値と見比べてしまう。
 */
export interface RegisteredScore {
  /** squadTotal (理論ダメージ)。 */
  damage: number;
  /** 計算したときの戦闘時間 (秒)。 */
  duration: number;
  /** 計算した時刻 (ISO)。 */
  at: string;
  /**
   * どの条件で出した値か (ボス名・防御力・コア・パーツ・戦闘時間の署名)。
   *
   * 数字だけ覚えると、ボスの登録を変えた後で**古い値を今の値と見比べてしまう**。
   * 無い場合は «ボスの癖なし» で出した古い登録値 (この項目ができる前のもの)。
   */
  cond?: string;
}

export interface ElementPlan {
  /** 並べ替え・削除の目印。中身が同じでも別案なら別 id。 */
  id: string;
  /** 5人ぶんの内部キー (韓国語)。空文字は空き枠。 */
  squad: string[];
  /** 保存した時刻 (ISO)。 */
  savedAt: string;
  /** 任意のメモ。「バースト回し重視」など。 */
  note?: string;
  /**
   * 個別設定のスナップショット (キューブ・オーバーロード・スキル等)。
   * **編成はキューブ込みで1つの案** — 同じ顔ぶれでもキューブが違えば別の結果になる。
   * 入っているニケはこの値で計算し、入っていないニケはロスター (取込値) に任せる。
   */
  characters?: Record<string, CharacterOverrides>;
  /** 登録した理論値。計算するたびに上書きされる。 */
  registered?: RegisteredScore;
}

export interface ElementPlans {
  schemaVersion: 1;
  byElement: Partial<Record<PlanElement, ElementPlan[]>>;
}

export const emptyPlans = (): ElementPlans => ({ schemaVersion: 1, byElement: {} });

const isPlanElement = (value: unknown): value is PlanElement =>
  typeof value === 'string' && (PLAN_ELEMENTS as readonly string[]).includes(value);

/** 5枠に正規化する。長すぎれば切り、短ければ空き枠で埋める。 */
const normalizeSquad = (squad: unknown): string[] => {
  const list = Array.isArray(squad) ? squad : [];
  const out = list.slice(0, 5).map((name) => (typeof name === 'string' ? name : ''));
  while (out.length < 5) out.push('');
  return out;
};

/** 同じ編成か (順番は問わない — 並べ替えただけの案を別案として数えない)。 */
export function sameSquad(left: readonly string[], right: readonly string[]): boolean {
  const key = (squad: readonly string[]) => squad.filter(Boolean).slice().sort().join('\u0000');
  return key(left) === key(right);
}

/** 深いキー順を揃えた JSON。オブジェクトのキー順だけが違うスナップショットを同じとみなすため。 */
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) =>
  (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
    : v));

/**
 * 同じ案か = 同じ顔ぶれ **かつ** 同じ個別設定。
 * 「同じ顔ぶれでもキューブが違えば別の結果になる」ので、顔ぶれだけでは重複と言えない。
 * スナップショット無し (ロスター任せ) とスナップショット有りも別の案として扱う。
 */
export function samePlanSetup(
  plan: Pick<ElementPlan, 'squad' | 'characters'>,
  squad: readonly string[],
  characters?: Record<string, CharacterOverrides>,
): boolean {
  if (!sameSquad(plan.squad, squad)) return false;
  const filtered = (snapshot: Record<string, CharacterOverrides> | undefined, members: readonly string[]) => {
    const kept = Object.entries(snapshot ?? {}).filter(([name]) => members.includes(name));
    return kept.length === 0 ? undefined : Object.fromEntries(kept.sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  return canonical(filtered(plan.characters, plan.squad)) === canonical(filtered(characters, squad));
}

/** 誰も入っていない編成は保存しない。 */
export const isEmptySquad = (squad: readonly string[]): boolean => squad.every((name) => !name);

export function loadPlans(storage: StorageLike | null | undefined): ElementPlans {
  try {
    const raw = storage?.getItem(ELEMENT_PLANS_KEY);
    if (!raw) return emptyPlans();
    const data = JSON.parse(raw) as Partial<ElementPlans>;
    if (data?.schemaVersion !== 1 || !data.byElement || typeof data.byElement !== 'object') {
      return emptyPlans();
    }
    const byElement: ElementPlans['byElement'] = {};
    for (const [element, plans] of Object.entries(data.byElement)) {
      if (!isPlanElement(element) || !Array.isArray(plans)) continue;
      const kept: ElementPlan[] = [];
      for (const plan of plans) {
        if (!plan || typeof plan !== 'object') continue;
        const squad = normalizeSquad((plan as ElementPlan).squad);
        if (isEmptySquad(squad)) continue;      // 空の案は残さない
        const characters = (plan as ElementPlan).characters;
        const registered = (plan as ElementPlan).registered;
        kept.push({
          id: typeof (plan as ElementPlan).id === 'string' && (plan as ElementPlan).id
            ? (plan as ElementPlan).id : makeId(),
          squad,
          savedAt: typeof (plan as ElementPlan).savedAt === 'string'
            ? (plan as ElementPlan).savedAt : new Date(0).toISOString(),
          ...(typeof (plan as ElementPlan).note === 'string' && (plan as ElementPlan).note
            ? { note: (plan as ElementPlan).note } : {}),
          // 個別設定は中身までは検査しない (エンジンへ渡る前に validateRequest が見る)。
          // 編成にいないニケのぶんは持っていても使われないだけなので、そのまま残す
          ...(characters && typeof characters === 'object' && !Array.isArray(characters)
            ? { characters } : {}),
          ...(registered && typeof registered === 'object'
            && typeof registered.damage === 'number' && Number.isFinite(registered.damage)
            && typeof registered.duration === 'number'
            && typeof registered.at === 'string'
            ? { registered } : {}),
        });
        if (kept.length >= MAX_PLANS_PER_ELEMENT) break;
      }
      if (kept.length > 0) byElement[element] = kept;
    }
    return { schemaVersion: 1, byElement };
  } catch {
    return emptyPlans();   // 壊れていても起動は止めない
  }
}

/**
 * 保存する。**成否を返す** — 失敗を黙って飲み込むと、画面が「保存しました」と言った直後に
 * 再読込で消える。容量超過やプライベートモードで実際に起きる。
 */
export function savePlans(storage: StorageLike | null | undefined, plans: ElementPlans): boolean {
  try {
    storage?.setItem(ELEMENT_PLANS_KEY, JSON.stringify(plans));
    return Boolean(storage);
  } catch {
    return false;   // この回は使えるが、次に開いたときは残っていない
  }
}

let idCounter = 0;
/** 衝突しなければ何でもよい。時刻 + 連番で、同じミリ秒に2件足しても分かれる。 */
export function makeId(): string {
  idCounter += 1;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export const plansOf = (plans: ElementPlans, element: PlanElement): ElementPlan[] =>
  plans.byElement[element] ?? [];

/**
 * 案を足す。
 * - 空の編成は足さない
 * - 同じ顔ぶれの案が既にあれば足さない (並べ替えただけの重複を防ぐ)
 * - 上限 (3案) に達していたら足さない
 *
 * @returns 追加後の全体と、足せたかどうか。足せない理由は呼ぶ側が文言にする。
 */
export function addPlan(
  plans: ElementPlans,
  element: PlanElement,
  squad: readonly string[],
  extras?: { note?: string; characters?: Record<string, CharacterOverrides> },
): { plans: ElementPlans; added: boolean; reason?: 'empty' | 'duplicate' | 'full' } {
  const normalized = normalizeSquad(squad);
  if (isEmptySquad(normalized)) return { plans, added: false, reason: 'empty' };
  const current = plansOf(plans, element);
  if (current.some((plan) => samePlanSetup(plan, normalized, extras?.characters))) {
    return { plans, added: false, reason: 'duplicate' };
  }
  if (current.length >= MAX_PLANS_PER_ELEMENT) return { plans, added: false, reason: 'full' };
  // スナップショットは編成にいるニケのぶんだけ残す (デッキには外した人の設定も残っている)
  const kept = Object.fromEntries(Object.entries(extras?.characters ?? {})
    .filter(([name]) => normalized.includes(name)));
  const next: ElementPlan = {
    id: makeId(),
    squad: normalized,
    savedAt: new Date().toISOString(),
    ...(extras?.note ? { note: extras.note } : {}),
    ...(Object.keys(kept).length > 0 ? { characters: kept } : {}),
  };
  return {
    plans: { schemaVersion: 1, byElement: { ...plans.byElement, [element]: [...current, next] } },
    added: true,
  };
}

/**
 * 計算した理論値を案に登録する。無い id なら何もしない。
 * 「編成とダメージを登録」— 数字は次に計算するまで残り、再読込しても消えない。
 */
export function registerScore(
  plans: ElementPlans, element: PlanElement, id: string, registered: RegisteredScore,
): ElementPlans {
  const current = plansOf(plans, element);
  if (!current.some((plan) => plan.id === id)) return plans;
  return {
    schemaVersion: 1,
    byElement: {
      ...plans.byElement,
      [element]: current.map((plan) => (plan.id === id ? { ...plan, registered } : plan)),
    },
  };
}

/**
 * 候補の中身を差し替える。**登録した理論値は必ず捨てる** —
 * 顔ぶれや個別設定が変われば、前に出した数字はもうその編成の値ではない。
 * 残しておくと «編集したのに前の数字のまま» になり、それで3凸を決めてしまう。
 *
 * id と保存時刻は保つ (並び順が変わらない)。無い id を渡しても壊れない。
 */
export function updatePlan(
  plans: ElementPlans,
  element: PlanElement,
  id: string,
  squad: readonly string[],
  extras?: { note?: string; characters?: Record<string, CharacterOverrides> },
): { plans: ElementPlans; updated: boolean; reason?: 'empty' | 'duplicate' | 'missing' } {
  const normalized = normalizeSquad(squad);
  if (isEmptySquad(normalized)) return { plans, updated: false, reason: 'empty' };
  const current = plansOf(plans, element);
  if (!current.some((plan) => plan.id === id)) return { plans, updated: false, reason: 'missing' };
  // 自分以外に同じ顔ぶれ・同じ個別設定があるなら、それは重複になる
  if (current.some((plan) => plan.id !== id && samePlanSetup(plan, normalized, extras?.characters))) {
    return { plans, updated: false, reason: 'duplicate' };
  }
  const kept = Object.fromEntries(Object.entries(extras?.characters ?? {})
    .filter(([name]) => normalized.includes(name)));
  return {
    plans: {
      schemaVersion: 1,
      byElement: {
        ...plans.byElement,
        [element]: current.map((plan) => (plan.id === id ? {
          id: plan.id,
          squad: normalized,
          savedAt: plan.savedAt,
          ...(extras?.note ?? plan.note ? { note: extras?.note ?? plan.note } : {}),
          ...(Object.keys(kept).length > 0 ? { characters: kept } : {}),
          // registered は**引き継がない**
        } : plan)),
      },
    },
    updated: true,
  };
}

/** 案を消す。無い id を渡しても壊れない。 */
export function removePlan(plans: ElementPlans, element: PlanElement, id: string): ElementPlans {
  const current = plansOf(plans, element);
  const kept = current.filter((plan) => plan.id !== id);
  if (kept.length === current.length) return plans;
  const byElement = { ...plans.byElement };
  if (kept.length > 0) byElement[element] = kept;
  else delete byElement[element];
  return { schemaVersion: 1, byElement };
}

/** 案の総数。「まだ1件も無い」の判定に使う。 */
export const countPlans = (plans: ElementPlans): number =>
  PLAN_ELEMENTS.reduce((sum, element) => sum + plansOf(plans, element).length, 0);

/**
 * そのコードのボスに有利なのはどのコードか (`BEATS` の逆引き)。
 * 「水冷ボスには電撃編成」を引くのに使う。知らないコードなら null。
 */
export function counterOf(bossElement: string): PlanElement | null {
  for (const element of PLAN_ELEMENTS) {
    if (BEATS[element] === bossElement) return element;
  }
  return null;
}

/**
 * ボス条件を重ねた戦闘。基準戦闘に対して、そのボス固有の癖だけを足す。
 *
 * 敵コードと防御力はボスが持つ。コア・パーツは**ボスごとに違い、まだデータが無い**ので
 * 呼ぶ側 (画面のトグル) から受け取る。回避区間・属性制限区間は今の設定を引き継ぐ —
 * ここを空にすると、条件を入れて確かめたい人が毎回入れ直すことになる。
 */
export function bossConditionBattle<T extends {
  enemyCode: string;
  enemyDef: number;
  coreEnabled: boolean;
  hasParts: boolean;
}>(base: T, boss: { elementCode: string; enemyDef: number | null }, options: {
  coreEnabled: boolean;
  hasParts: boolean;
}): T {
  return {
    ...base,
    enemyCode: boss.elementCode,
    enemyDef: boss.enemyDef ?? base.enemyDef,
    coreEnabled: options.coreEnabled,
    hasParts: options.hasParts,
  };
}

/**
 * 案を比べるときの**基準戦闘**。
 *
 * ボス固有の条件 (コア・破壊可能パーツ・回避区間・属性制限区間) を全部外し、
 * 「そのコードのボスに有利コードで殴る」だけの土俵に揃える — ここで決めるのは属性ごとの土台で、
 * ボスの癖は後の段階で重ねるため。戦闘時間・敵防御力・シンクロなど**それ以外は今の設定のまま**
 * にするのは、自分の環境での相対比較として読めるようにするため。
 */
export function baselineBattle<T extends {
  enemyCode: string;
  coreEnabled: boolean;
  hasParts: boolean;
  immuneWindows: unknown[];
  elementWindows: unknown[];
}>(base: T, element: PlanElement): T {
  return {
    ...base,
    enemyCode: BEATS[element],   // この編成が想定するボスのコード
    coreEnabled: false,
    hasParts: false,
    immuneWindows: [],
    elementWindows: [],
  };
}
