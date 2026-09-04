import { cubeTemplate, growthLabel, labelFor, labelForCube } from './display-name';
import { statName } from './stat-names';
import type {
  BuffTargetRow,
  CharacterControl,
  CharacterOverrides,
  CubeName,
  EquipPart,
  EquipSetting,
  SettingsCatalog,
  SkillLevels,
} from './types';

// タップ撃ちを手動でオンにしたとき入る発射速度 (発/秒) — «44톡톡이»。ユーザー指定値である。
// 220ms (≈4.5発/秒) はゲームが強制する下限で、それより上は人間には出せない
// (`context/CONTROL.md` §톡톡이)。
//
// 参考: エンジンのキャラ別 «推奨自動» コントロールは `data/char_defaults.json` で 3.6 を使い、
// CONTROL.md は実質範囲を 3.0〜4.2 と書く。ここは手動でオンにするときの出発値なので別物だ。
const TAP_FIRE_DEFAULT = 4.4;
const TAP_FIRE_HARD_LIMIT = 4.5;
const WEAPON_MODE_SWAP_DEFAULT = 6;

const EQUIP_PARTS: EquipPart[] = ['머리', '몸통', '팔', '다리'];
// 内部の部位キーは '팔' だが、CSV の表記は '장갑' (UI では「腕」) である。
const EQUIP_PART_LABELS: Record<EquipPart, string> = {
  머리: '頭', 몸통: '胴', 팔: '腕', 다리: '脚',
};

const skillLabels: Array<[keyof SkillLevels, string]> = [
  ['1', 'スキル1'],
  ['2', 'スキル2'],
  ['3', 'バースト'],
];

const numberText = (value: number, digits = 2): string => value.toFixed(digits);

const cloneOverrides = (value: CharacterOverrides): CharacterOverrides => ({
  ...(value.growthStage !== undefined ? { growthStage: value.growthStage } : {}),
  ...(value.skillLevels ? { skillLevels: { ...value.skillLevels } } : {}),
  ...(value.overload ? { overload: { ...value.overload } } : {}),
  ...(value.cube ? { cube: { ...value.cube } } : {}),
  ...(value.collection ? { collection: { ...value.collection } } : {}),
  ...(value.control !== undefined ? {
    control: Object.fromEntries(
      Object.entries(value.control).map(([key, entry]) => [key, { ...entry }]),
    ) as CharacterControl,
  } : {}),
  ...(value.manualStats ? { manualStats: { ...value.manualStats } } : {}),
  ...(value.burst ? { burst: value.burst } : {}),
  ...(value.equipLevels ? { equipLevels: { ...value.equipLevels } } : {}),
  ...(value.weaponModeSwapAt !== undefined ? { weaponModeSwapAt: value.weaponModeSwapAt } : {}),
});

export function defaultCharacterOverrides(
  name: string,
  catalog: SettingsCatalog,
): CharacterOverrides {
  const defaults = catalog.characters[name];
  if (!defaults) throw new Error(`${labelFor(name)}: 基本装備設定が見つかりません。`);
  return {
    growthStage: defaults.growthStage,
    skillLevels: { ...defaults.skillLevels },
    overload: { ...defaults.overload },
    cube: { ...defaults.cube },
    collection: { ...defaults.collection },
    manualStats: {},
  };
}

function makeInputUnit(input: HTMLInputElement, unit: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'input-unit';
  wrap.append(input);
  if (unit) {
    const suffix = document.createElement('em');
    suffix.textContent = unit;
    wrap.append(suffix);
  }
  return wrap;
}

function summaryText(name: string, catalog: SettingsCatalog, value?: CharacterOverrides): string {
  const defaults = catalog.characters[name];
  if (!defaults) return '設定情報なし';
  const skillLevels = value?.skillLevels ?? defaults.skillLevels;
  const overload = value?.overload ?? defaults.overload;
  const cube = value?.cube ?? defaults.cube;
  const growthStage = value?.growthStage ?? defaults.growthStage;
  const controlSummary = value?.control === undefined
    ? 'コントロール推奨自動'
    : `コントロール手動${Object.keys(value.control).length}件`;
  const growth = defaults.growthOptions.find((option) => option.value === growthStage)
    ?? { value: growthStage, label: `段階${growthStage}`, affinity: 0 };
  const skillSummary = defaults.skillLevelsLocked
    ? '数値未公開 · Lv10固定'
    : `スキル ${skillLevels['1']} / ${skillLevels['2']} / ${skillLevels['3']}`;
  return `${value ? '個別値' : '既定値'} · ${growthLabel(growth.label)} · 好感度 ${growth.affinity} · ${skillSummary} · `
    + `優コ ${numberText(overload.element_bonus ?? 0)} · `
    + `攻増 ${numberText(overload.atk_pct ?? 0)} · 装弾 ${numberText(overload.max_ammo_pct ?? 0)} · `
    + `${cube.name === NO_CUBE ? 'キューブなし' : `${labelForCube(cube.name)} Lv${cube.level}`} · ${controlSummary}`;
}

/**
 * コントロールキーの表示名。盤のチェックボックスに書かれる言葉と**同じ言葉**を使う —
 * 推奨行で「tap_fire」と読み、下で「タップ撃ち」を探し当てても同じものだとは分からない。
 */
export const CONTROL_NAMES: Record<string, string> = {
  tap_fire: 'タップ撃ち',
  hold: 'ホールドコントロール',
  reload: 'リロードコントロール',
  cover: 'バースト遮蔽コントロール',
};

/** コントロールキー → 表示名。知らないキーはそのまま返す (新しいコントロールが増えても空欄にならない)。 */
export const controlName = (key: string): string => CONTROL_NAMES[key] ?? key;

/**
 * 「いまこの編成で実際に掛かるコントロール」の文言。
 *
 * キャラ別の基本コントロールには**編成条件付き**がある (아인は에이다と一緒のときホールドが
 * 付く)。以前は条件なしのものだけ書いて「編成によって追加されます」と濁していたため、
 * 実際に掛かっているホールドを誰も見られなかった — それで «ホールドをオンにしたのに
 * 結果がそのまま» という声が出た。すでに掛かっていたからである。
 *
 * `squad` を渡さないとき (このモジュールだけ単体で描く場所) は条件なしのものだけ書く。
 */
export function recommendedControlText(
  defaults: { recommendedControl: CharacterControl; hasConditionalControl: boolean;
    conditionalControl?: Array<{ withMembers: string[]; control: CharacterControl }> },
  squad?: string[],
): string {
  const names = Object.keys(defaults.recommendedControl).map(controlName);
  const rules = defaults.conditionalControl ?? [];
  const roster = new Set((squad ?? []).filter(Boolean));
  let unresolved = !defaults.hasConditionalControl ? false : rules.length === 0;
  for (const rule of rules) {
    const who = rule.withMembers.find((member) => roster.has(member));
    if (!who) { unresolved = unresolved || squad === undefined; continue; }
    for (const key of Object.keys(rule.control)) {
      names.push(`${controlName(key)}(${labelFor(who)}と一緒のため)`);
    }
  }
  const head = names.length ? `現在の基本推奨: ${names.join(' · ')}` : '現在の基本推奨: 自動射撃';
  return unresolved ? `${head} · スカッド編成によって推奨コントロールが追加されます。` : head;
}

/** 編成条件付きコントロールの1行 — いま掛かっているかと、なぜ掛かるのか。 */
export interface ControlRuleNote {
  /** いまこのスカッドで実際に掛かっているか。 */
  active: boolean;
  /** 「에이다と一緒なのでホールドコントロールが適用されています」のような1行。 */
  headline: string;
  /** なぜそうするのか。データに説明が書かれていなければ空。 */
  help: string;
}

/**
 * 編成で付くコントロールを、**なぜ付くのかまで**書き下す。
 *
 * これらのコントロールは誰もオンにしていないのに掛かる — だから「ホールドをオンにしたのに結果がそのまま」
 * 「推奨に無いものがなぜ回るのか」といった誤解が出る。掛かっているものは掛かっていると、まだのものは
 * 何と一緒に置けば掛かるのかを書いておく。
 *
 * 説明はデータが持ってくる (`data/char_defaults.json` の `_help`) — 画面がでっち上げない。
 */
/**
 * パッチム (終声) に合わせて助詞を選ぶ — 「홀드 컨트롤이」と「톡톡이가」。
 *
 * 「이(가)」で潰すほうが短いが、カードの中で毎回読まれる文なので、そのままだと
 * 目に引っかかる。ハングル以外の文字で終わる場合 (数字・英字) はパッチムあり側とみなす。
 */
export function withParticle(word: string, withFinal: string, without: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  const hasFinal = hangul ? (code - 0xac00) % 28 !== 0 : true;
  return `${word}${hasFinal ? withFinal : without}`;
}

export function controlRuleNotes(
  defaults: { conditionalControl?: Array<{ withMembers: string[]; control: CharacterControl; help?: string }> },
  squad?: string[],
): ControlRuleNote[] {
  const roster = new Set((squad ?? []).filter(Boolean));
  return (defaults.conditionalControl ?? []).map((rule) => {
    const names = Object.keys(rule.control).map(controlName).join(' · ');
    const here = rule.withMembers.find((member) => roster.has(member));
    const who = here ? labelFor(here) : rule.withMembers.map(labelFor).join(' または ');
    return {
      active: Boolean(here),
      headline: here
        ? `${who}と一緒なので${names}が適用されています。`
        : `${who}と一緒に編成すると${names}が自動で付きます。`,
      help: rule.help ?? '',
    };
  });
}

/** キューブを着けていない状態。データではなく画面が作る選択肢である。 */
export const NO_CUBE = '없음';

/** 終盤最優先の既定区間 (秒)。エンジン既定値 (`calculator/customization.py`) と同じ。 */
const ENDGAME_DEFAULT = 20;

/** 窓で開く設定の束の種類。コントロールはカードのその場で広げる。 */
export type CharPanelKind = 'settings';

/**
 * コントロールチップに書かれる1行。**開かなくてもいまの状態が読めて**こそチップの値打ちがある —
 * ほとんどは «推奨自動 · バースト自動» なので、開いて見ることがない。
 */
export function controlChipText(value?: CharacterOverrides): string {
  const picked = value?.control === undefined ? -1 : Object.keys(value.control).length;
  // 一つも選んでいない «手動» は «手動0件» ではなくただの手動設定 — 0を数えて見せる理由がない。
  const control = picked < 0 ? '推奨自動' : picked === 0 ? '手動設定' : `手動${picked}件`;
  const burst = value?.burst;
  const burstText = burst === undefined ? 'バースト自動'
    : burst.mode === 'priority' ? `バースト ${burst.every}の倍数`
    : burst.mode === 'endgame' ? `バースト終盤${burst.seconds}秒`
    : 'バースト使わない';
  return `${control} · ${burstText}`;
}

/**
 * 前回描いた «窓で開く» 束たち。窓に出すとその束はカードの外 (モーダル) へ
 * 移るので、描き直すときにカードだけ探しても開閉状態が見つからない — 上級モードを
 * オンにしたまま «数値を追加» を押すと上級モードが切れて見えたのは、それが原因だ。
 */
const lastPanels = new WeakMap<HTMLElement, HTMLElement[]>();

export function renderCharacterSettings(
  container: HTMLElement,
  name: string,
  catalog: SettingsCatalog,
  value: CharacterOverrides | undefined,
  onChange: (next: CharacterOverrides | undefined) => void,
  buffTargets?: BuffTargetRow[],
  onShowOrder?: (row: BuffTargetRow) => void,
  /**
   * 設定の束を**窓で**開く先。渡さなければその場で広げる —
   * このモジュールだけ単体で描く場所 (テスト・プレビュー) でも使えないといけない。
   */
  onOpenPanel?: (kind: CharPanelKind, panel: HTMLElement, label: string) => void,
  /**
   * いま編成されているスカッド全員。**編成条件付きコントロールの判定にだけ**使う —
   * 渡さなければ条件なしの推奨だけ書き、以前のように «編成によって追加されます» と知らせる。
   */
  squad?: string[],
): void {
  // 前回の画面を探す。カードの中が先で、無ければ窓へ移った束まで探す。
  const previous = <T extends Element>(selector: string): T | null => {
    const inCard = container.querySelector<T>(selector);
    if (inCard) return inCard;
    for (const panel of lastPanels.get(container) ?? []) {
      const hit = panel.querySelector<T>(selector);
      if (hit) return hit;
    }
    return null;
  };
  const advancedWasOpen = previous<HTMLInputElement>('[data-advanced-toggle]')?.checked ?? false;
  const searchWas = previous<HTMLInputElement>('[data-manual-search]')?.value ?? '';
  // 開閉状態は描き直しても保つ。値を一つ変えるたびに畳まれては使いものにならない。
  // 既定は**畳んだ状態**である — カード5枚が1画面に並ぶので、オンにしただけの設定まで
  // いつも開いていると、編成そのものが見えない。
  const wasOpen = (flag: string): boolean =>
    previous<HTMLElement>(`[${flag}]`)?.getAttribute('aria-expanded') === 'true';
  const summaryWasOpen = wasOpen('data-loadout-open');
  const controlWasOpen = wasOpen('data-control-open');
  // 折りたたみの状態は**カードを空にする前に**読んでおく。下で描き直す時点では旧画面が
  // すでに消えていて、そこで探してもいつも «畳まれている» としか出ない。
  const openNotes = new Set(
    [...container.querySelectorAll<HTMLDetailsElement>('[data-note-fold]')]
      .filter((fold) => fold.open)
      .map((fold) => fold.dataset.noteFold!),
  );

  /**
   * 押して開く設定の束。カードが狭く、その場で広げると5枚が互いを押しのける —
   * フィルター盤のように窓に出す。窓を開けない場所ではその場開きに退く。
   */
  const panelOpener = (label: string, kind: CharPanelKind, short = label) => {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'char-panel-open';
    head.dataset.charPanelOpen = kind;
    head.setAttribute('aria-expanded', 'false');
    // カードには短い名前を、窓のタイトルには完全な名前を使う — 狭い枠でラベルが
    // 何行にも折れて崩れると、何を開くボタンなのかから読めなくなる。
    const title = document.createElement('span');
    title.className = 'disclosure-label';
    title.textContent = short;
    title.title = label;
    const hint = document.createElement('span');
    hint.className = 'disclosure-hint';
    hint.textContent = '›';
    head.append(title, hint);
    const panel = document.createElement('div');
    panel.className = 'disclosure-panel char-panel';
    panel.dataset.charPanel = kind;
    panel.hidden = true;
    head.addEventListener('click', () => {
      if (onOpenPanel) { onOpenPanel(kind, panel, label); return; }
      const next = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(next));
      panel.hidden = !next;
      hint.textContent = next ? '折りたたむ' : '開く';
    });
    return { head, panel };
  };

  container.replaceChildren();
  container.className = 'character-settings';

  const commit = (next: CharacterOverrides | undefined) => {
    onChange(next);
    renderCharacterSettings(
      container, name, catalog, next, onChange, buffTargets, onShowOrder, onOpenPanel, squad);
  };

  // カードが狭くなった — 要約 («1凸 · 好感度 20 · スキル 10…») とバフ受領者は畳んでおき、
  // 必要な人だけ開く。編成画面でいつも読む行ではない。
  const summaryFold = document.createElement('button');
  summaryFold.type = 'button';
  summaryFold.className = 'loadout-open';
  summaryFold.dataset.loadoutOpen = '';
  summaryFold.setAttribute('aria-expanded', String(summaryWasOpen));
  summaryFold.append(document.createTextNode('個別値'));
  const summaryCaret = document.createElement('b');
  summaryCaret.className = 'loadout-caret';
  summaryCaret.textContent = summaryWasOpen ? '▴' : '▾';
  summaryFold.append(summaryCaret);
  const summaryBox = document.createElement('div');
  summaryBox.className = 'loadout-fold';
  summaryBox.dataset.loadoutFold = '';
  summaryBox.hidden = !summaryWasOpen;
  summaryFold.addEventListener('click', () => {
    const next = summaryFold.getAttribute('aria-expanded') !== 'true';
    summaryFold.setAttribute('aria-expanded', String(next));
    summaryBox.hidden = !next;
    summaryCaret.textContent = next ? '▴' : '▾';
  });
  const settingsRow = document.createElement('div');
  settingsRow.className = 'settings-row';
  settingsRow.append(summaryFold);
  container.append(settingsRow, summaryBox);

  const summary = document.createElement('p');
  summary.className = 'loadout-summary';
  summary.dataset.loadoutSummary = '';
  summary.textContent = summaryText(name, catalog, value);
  summaryBox.append(summary);

  // 「誰がこのバフを受けたか」。対象は攻撃力の順位で分かれ、編成を見ただけでは分からず、
  // 戦闘中に入れ替わりもするので、推定せずに**実際の発動ログ**の受領者を載せる。
  // 計算を回す前はまだ分からないので、空の括弧で場所だけ取っておく。
  //
  // 折りたたみ (個別値) の**外**に立てる。리버렐리오·미란다のように対象が分かれるバフは
  // 結果を読むのに要る情報であって、自分の育成値ではない — 開かないと見えない
  // 場所に置くと、あることにも気づかれない。
  const buffTargetList = document.createElement('div');
  buffTargetList.className = 'buff-target-list';
  for (const row of buffTargets ?? []) {
    const box = document.createElement('p');
    box.className = 'buff-target';
    box.dataset.buffTarget = row.buff;
    const label = document.createElement('span');
    label.textContent = `${row.label} : `;
    box.append(label);
    const who = document.createElement('b');
    // 対象が戦闘中に分かれると、名前を並べても読めない — 特殊ケースとして畳んで
    // 実際の順序は「順序を見る」に回す。
    const special = row.targets.length > 1;
    // 先読み計算は背景で回る。空の括弧だけ見えると機能が切れているように見えるので、
    // 回っている間はそうと書く。
    who.textContent = row.pending ? '[計算中]'
      : special ? '[特殊ケース]'
        : `[${row.targets.map(labelFor).join(', ')}]`;
    if (row.pending) box.classList.add('is-pending');
    box.append(who);
    box.title = row.pending
      ? `${row.buff} — 対象を計算中です`
      : row.targets.length === 0
        ? `${row.buff} — まだ計算していないか、発動条件を満たしていません`
        : special
          ? `${row.buff} — ${row.count}回発動 · 対象が${row.targets.length}人の間で分かれます`
          : `${row.buff} — ${row.count}回発動`;

    // 「順序を見る」は対象が分かれるときだけ — 固定対象なら名前だけで十分だ。
    if (onShowOrder && special && (row.sequence?.length ?? 0) > 0) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'buff-order-open';
      open.dataset.buffOrderOpen = row.buff;
      open.textContent = '順序を見る';
      open.addEventListener('click', () => onShowOrder(row));
      box.append(open);
    }
    buffTargetList.append(box);
  }
  if (buffTargetList.childElementCount > 0) container.append(buffTargetList);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'inline-check';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = Boolean(value);
  toggle.dataset.customToggle = '';
  const toggleText = document.createElement('span');
  toggleText.textContent = '個別設定';
  toggleLabel.append(toggle, toggleText);
  settingsRow.append(toggleLabel);
  toggle.addEventListener('change', () => {
    commit(toggle.checked ? defaultCharacterOverrides(name, catalog) : undefined);
  });

  if (!value) return;
  let current = cloneOverrides(value);
  const defaults = catalog.characters[name];
  if (!defaults) return;
  current.growthStage ??= defaults.growthStage;
  current.skillLevels ??= { ...defaults.skillLevels };
  current.overload ??= { ...defaults.overload };
  current.cube ??= { ...defaults.cube };
  current.collection ??= { ...defaults.collection };
  current.manualStats ??= {};
  /** コントロールチップの文をいまの値に書き直す。チップが作られた後に埋められる。 */
  let paintControlChip: () => void = () => undefined;

  /**
   * 長い案内文を畳んでおく。カード幅 (約130px) では4文が10行を超え、
   * 肝心の触りに来たチェックボックスが画面の外へ押し出される。読みたいときだけ開く —
   * 開閉状態は描き直しても残る。
   */
  const foldedNote = (label: string, note: HTMLElement, key: string): HTMLElement => {
    const fold = document.createElement('details');
    fold.className = 'note-fold';
    fold.dataset.noteFold = key;
    fold.open = openNotes.has(key);
    const head = document.createElement('summary');
    head.textContent = label;
    fold.append(head, note);
    return fold;
  };

  const emitNumericChange = (next: CharacterOverrides) => {
    current = cloneOverrides(next);
    onChange(current);
    summary.textContent = summaryText(name, catalog, current);
    // バーストを変えてもカードは描き直さない — チップに書かれた文はここで追随する。
    paintControlChip();
  };

  const body = document.createElement('div');
  body.className = 'character-settings-body';
  body.dataset.characterSettingsBody = '';

  const growthEditor = document.createElement('section');
  growthEditor.className = 'growth-editor';
  const growthHeading = document.createElement('h4');
  growthHeading.textContent = `限界突破 · コア強化 (${defaults.rarity})`;
  const growthSelect = document.createElement('select');
  growthSelect.dataset.growthStage = '';
  for (const growth of defaults.growthOptions) {
    const option = document.createElement('option');
    option.value = String(growth.value);
    option.textContent = growthLabel(growth.label);
    growthSelect.append(option);
  }
  growthSelect.value = String(current.growthStage);
  growthSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    next.growthStage = Number(growthSelect.value);
    commit(next);
  });
  const growthNote = document.createElement('p');
  growthNote.textContent = '好感度は限界突破ごとの最大値で適用します。';
  growthEditor.append(growthHeading, growthSelect, growthNote);
  body.append(growthEditor);

  const skillEditor = document.createElement('section');
  skillEditor.className = 'skill-level-editor';
  const skillHeading = document.createElement('h4');
  skillHeading.textContent = 'スキルレベル';
  skillEditor.append(skillHeading);
  if (defaults.skillLevelsLocked) {
    skillEditor.classList.add('is-locked');
    skillEditor.dataset.skillLevelsLocked = '';
    const locked = document.createElement('strong');
    locked.textContent = '数値未公開 · Lv10固定';
    const explanation = document.createElement('p');
    explanation.textContent = 'Lv1〜9の係数が公開されていないため、Lv10基準でのみ計算します。';
    skillEditor.append(locked, explanation);
  } else {
    const skillControls = document.createElement('div');
    skillControls.className = 'skill-level-controls';
    for (const [key, labelText] of skillLabels) {
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = labelText;
      const select = document.createElement('select');
      select.dataset.skillLevel = key;
      for (let level = 1; level <= 10; level += 1) {
        const option = document.createElement('option');
        option.value = String(level);
        option.textContent = `Lv${level}`;
        select.append(option);
      }
      select.value = String(current.skillLevels[key]);
      select.addEventListener('change', () => {
        const next = cloneOverrides(current);
        next.skillLevels![key] = Number(select.value);
        emitNumericChange(next);
      });
      label.append(text, select);
      skillControls.append(label);
    }
    skillEditor.append(skillControls);
  }
  body.append(skillEditor);

  const burstEditor = document.createElement('section');
  burstEditor.className = 'burst-editor';
  const burstHeading = document.createElement('h4');
  burstHeading.textContent = 'バースト運用';
  const burstMode = current.burst?.mode ?? 'auto';
  const burstEvery = current.burst?.mode === 'priority' ? current.burst.every : 1;
  const burstLast = current.burst?.mode === 'endgame' ? current.burst.seconds : ENDGAME_DEFAULT;

  const burstRow = document.createElement('div');
  burstRow.className = 'burst-row';
  const burstSelect = document.createElement('select');
  burstSelect.dataset.burstAssignment = '';
  for (const [optionValue, optionLabel] of [
    ['auto', '自動'], ['priority', 'nの倍数で優先使用'],
    ['endgame', '終盤最優先'], ['skip', '使わない'],
  ] as Array<[string, string]>) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    burstSelect.append(option);
  }
  burstSelect.value = burstMode;

  const everyWrap = document.createElement('label');
  everyWrap.className = 'burst-every';
  everyWrap.hidden = burstMode !== 'priority';
  const everyInput = document.createElement('input');
  everyInput.type = 'number';
  everyInput.min = '1';
  everyInput.step = '1';
  everyInput.value = String(burstEvery);
  everyInput.dataset.burstEvery = '';
  const everyText = document.createElement('span');
  everyText.textContent = 'の倍数サイクルごと';
  everyWrap.append(everyInput, everyText);

  // 終盤最優先 — 大きな一発を戦闘の終わりに合わせるための運用である。
  const lastWrap = document.createElement('label');
  lastWrap.className = 'burst-every';
  lastWrap.hidden = burstMode !== 'endgame';
  const lastText = document.createElement('span');
  lastText.textContent = '残り時間';
  const lastInput = document.createElement('input');
  lastInput.type = 'number';
  lastInput.min = '1';
  lastInput.max = '180';
  lastInput.step = '1';
  lastInput.value = String(burstLast);
  lastInput.dataset.burstLast = '';
  const lastUnit = document.createElement('span');
  lastUnit.textContent = '秒未満のとき';
  lastWrap.append(lastText, lastInput, lastUnit);

  burstRow.append(burstSelect, everyWrap, lastWrap);

  const applyBurst = () => {
    const next = cloneOverrides(current);
    const mode = burstSelect.value;
    if (mode === 'priority') {
      const n = Math.max(1, Math.trunc(Number(everyInput.value) || 1));
      next.burst = { mode: 'priority', every: n };
    } else if (mode === 'endgame') {
      const seconds = Math.min(180, Math.max(1, Math.trunc(Number(lastInput.value) || ENDGAME_DEFAULT)));
      next.burst = { mode: 'endgame', seconds };
    } else if (mode === 'skip') {
      next.burst = { mode: 'skip' };
    } else {
      delete next.burst;
    }
    emitNumericChange(next);
  };
  burstSelect.addEventListener('change', () => {
    everyWrap.hidden = burstSelect.value !== 'priority';
    lastWrap.hidden = burstSelect.value !== 'endgame';
    applyBurst();
  });
  everyInput.addEventListener('input', applyBurst);
  lastInput.addEventListener('input', applyBurst);

  const burstNote = document.createElement('p');
  burstNote.className = 'field-note';
  burstNote.textContent =
    '同じバースト段階の候補が複数いるとき、誰が先に使うかを決めます(クールタイム範囲内)。'
    + '「nの倍数」はそのサイクルごとに優先使用し(n=1なら毎サイクル)、'
    + '「終盤最優先」は戦闘の残りがその秒数を切ってから誰よりも先に使います — それまでは通常順です。'
    + '「使わない」はこのキャラがバーストを一切使いません — 同段階の仲間が全員クールでも撃たないため、'
    + 'その段階を担う仲間がいないとバーストサイクル自体が止まります。';
  burstEditor.append(burstHeading, burstRow, foldedNote('バースト運用の説明', burstNote, 'burst'));
  // `body` ではなく下の «コントロール · バースト» 折りたたみに入れる — バースト運用も結局は
  // 操作方式なので、コントロールと同じ場所にあるほうが見つけやすい。

  const equipEditor = document.createElement('section');
  equipEditor.className = 'equip-editor';
  const equipHeading = document.createElement('h4');
  equipHeading.textContent = '装備レベル';
  const equipGrid = document.createElement('div');
  equipGrid.className = 'equip-grid';
  for (const part of EQUIP_PARTS) {
    const partLabel = document.createElement('label');
    const partText = document.createElement('span');
    partText.textContent = EQUIP_PART_LABELS[part];
    const partSelect = document.createElement('select');
    partSelect.dataset.equipLevel = part;
    // 装備は三通り — 未装着 / 一般 T1〜T9 (強化なし) / オーバーロード強化0〜5。
    // 選べるのは未装着とオーバーロード0〜5強だけで、一般等級は旧設定・アカウント
    // 取り込みで入ってきた値のときだけ一覧に残る。
    // 未装着を «強化0» と書くと、着けていない部位がフラットステータスを得てダメージが膨らむ。
    // スキルレベルと同じ方向 (低い値が上) に並べる — 一つのパネルの中で並び順が
    // 食い違うと、選ぶたびに方向を読み直すはめになる。
    const addOption = (value: string, label: string) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      partSelect.append(option);
    };
    // 実戦で使うものだけ残す — 一般 T1〜T9 は選べたところで使い道がなく、丸ごと外した。
    // 強化0段階は「T9企業」ではなくゲーム内表記どおり「オーバーロード強化0」と書く:
    // 計算も元からそちら (オーバーロード強化0) で行っていたので、名前が計算に従った形である。
    addOption('없음', '未装着');
    addOption('0', 'オーバーロード強化0');
    for (let lv = 1; lv <= 5; lv += 1) addOption(String(lv), `オーバーロード強化${lv}`);
    const currentEquip = String(current.equipLevels?.[part] ?? 5);
    // 旧設定やアカウント取り込みが一般 T1〜T9 を指すなら、その値も一覧に残しておく —
    // 黙って変わってはいけない。計算はそのまま一般装備の表で行う。
    if (![...partSelect.options].some((option) => option.value === currentEquip)) {
      addOption(currentEquip, `${currentEquip} (旧設定)`);
    }
    partSelect.value = currentEquip;
    partSelect.addEventListener('change', () => {
      const next = cloneOverrides(current);
      const levels = { ...(next.equipLevels ?? {}) };
      for (const p of EQUIP_PARTS) levels[p] ??= current.equipLevels?.[p] ?? 5;
      const picked = partSelect.value;
      levels[part] = /^\d+$/.test(picked) ? Number(picked) : (picked as EquipSetting);
      next.equipLevels = levels;
      emitNumericChange(next);
    });
    partLabel.append(partText, partSelect);
    equipGrid.append(partLabel);
  }
  const equipNote = document.createElement('p');
  equipNote.className = 'field-note';
  equipNote.textContent = '部位別装備 · 未装着 / オーバーロード強化0〜5。'
    + 'オーバーロード「オプション」(有利・攻撃増加など)とは別の、装備の基本ステータスです。'
    + '強化0以下(T9企業含む)はすべてオーバーロード強化0として計算します。';
  equipEditor.append(equipHeading, equipGrid, equipNote);
  body.append(equipEditor);

  // コレクション / お気に入り — 同じスロットなので一つの一覧から選ぶ。お気に入りがある
  // キャラだけ、お気に入りの段階が選択肢に出る。
  const collectionEditor = document.createElement('section');
  collectionEditor.className = 'collection-editor';
  const collectionHeading = document.createElement('h4');
  collectionHeading.textContent = defaults.favoriteItem ? 'コレクション · お気に入り' : 'コレクション';
  const collectionSelect = document.createElement('select');
  collectionSelect.dataset.collection = '';
  const collectionOptions: Array<{ value: string; label: string }> = [
    ...(defaults.favoriteItem
      ? [3, 2, 1].map((stage) => ({
        value: `favorite:${stage}`,
        label: `お気に入り ${'★'.repeat(stage)}${'☆'.repeat(3 - stage)}`,
      }))
      : []),
    ...catalog.collectionStages.map((stage) => ({ value: `stage:${stage}`, label: stage === '없음' ? 'なし' : stage })),
  ];
  for (const option of collectionOptions) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    collectionSelect.append(node);
  }
  collectionSelect.value = current.collection!.favorite > 0
    ? `favorite:${current.collection!.favorite}`
    : `stage:${current.collection!.stage}`;
  collectionSelect.addEventListener('change', () => {
    const [kind, raw] = collectionSelect.value.split(':');
    const next = cloneOverrides(current);
    next.collection = kind === 'favorite'
      ? { stage: 'SR15', favorite: Number(raw) }
      : { stage: raw!, favorite: 0 };
    commit(next);
  });
  const collectionNote = document.createElement('p');
  collectionNote.className = 'field-note';
  collectionNote.textContent = defaults.favoriteItem
    ? `${defaults.favoriteItem.name} 所持時はお気に入りを、なければ実際に装着しているコレクション段階を選んでください。お気に入りはコレクションのスロットを使います。`
    : '実際に装着しているコレクションの等級・レベルです。未装着なら「なし」を選んでください。';
  collectionEditor.append(collectionHeading, collectionSelect, collectionNote);
  body.append(collectionEditor);

  const overloadGrid = document.createElement('div');
  overloadGrid.className = 'overload-grid';
  for (const [key, meta] of Object.entries(catalog.overloadFields)) {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = statName(key);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.value = String(current.overload[key] ?? defaults.overload[key] ?? 0);
    input.dataset.overloadKey = key;
    input.addEventListener('input', () => {
      const next = cloneOverrides(current);
      next.overload![key] = Number(input.value);
      emitNumericChange(next);
    });
    label.append(text, makeInputUnit(input, meta.unit));
    overloadGrid.append(label);
  }
  body.append(overloadGrid);
  const chargeOptionNote = document.createElement('p');
  chargeOptionNote.className = 'field-note';
  chargeOptionNote.textContent = 'チャージ武器でなければチャージ系オプションは効果がありません。';
  body.append(chargeOptionNote);

  const cubeBox = document.createElement('section');
  cubeBox.className = 'cube-editor';
  const cubeHeading = document.createElement('h4');
  cubeHeading.textContent = 'ハーモニーキューブ';
  const cubeControls = document.createElement('div');
  cubeControls.className = 'cube-controls';
  const cubeSelect = document.createElement('select');
  cubeSelect.dataset.cubeName = '';
  // 選択肢はカタログ (=cube.json) からそのまま来る。新しいキューブが追加されてもコードはそのままだ。
  // 先頭の «없음» だけはデータではなく画面が作る — キューブ効果がかえって損になる編成
  // (미란다バフなど) を測るには、着けていない状態も選べないといけない。
  const noneOption = document.createElement('option');
  noneOption.value = NO_CUBE;
  noneOption.textContent = 'なし (キューブ未装着)';
  cubeSelect.append(noneOption);
  for (const cubeName of Object.keys(catalog.cubes)) {
    const option = document.createElement('option');
    option.value = cubeName;
    option.textContent = labelForCube(cubeName);
    cubeSelect.append(option);
  }
  // 保存された編成が、いまのカタログに無いキューブを指していることがある (データ更新・旧版の状態)。
  // そのときは一覧の先頭のキューブへ戻し、UI が丸ごと死なないようにする。
  const cubeNames = Object.keys(catalog.cubes);
  const noCube = current.cube.name === NO_CUBE;
  const cubeName = noCube ? NO_CUBE
    : (catalog.cubes[current.cube.name] ? current.cube.name : cubeNames[0]!);
  const cubeMeta = catalog.cubes[cubeName] ?? catalog.cubes[cubeNames[0]!]!;
  cubeSelect.value = cubeName;
  const levelSelect = document.createElement('select');
  levelSelect.dataset.cubeLevel = '';
  const availableLevels = Object.keys(cubeMeta.levels)
    .map(Number).sort((left, right) => left - right);
  for (const level of availableLevels) {
    const option = document.createElement('option');
    option.value = String(level);
    option.textContent = `Lv${level}`;
    levelSelect.append(option);
  }
  levelSelect.value = String(noCube ? 15 : current.cube.level);
  levelSelect.disabled = noCube;
  cubeSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    if (cubeSelect.value === NO_CUBE) {
      // 着けていない状態にレベルは無い — 0 に固定して、エンジンと同じ意味で送る。
      next.cube = { name: NO_CUBE, level: 0 };
      commit(next);
      return;
    }
    next.cube = { name: cubeSelect.value as CubeName, level: current.cube!.level || 15 };
    if (!catalog.cubes[next.cube.name]?.levels[String(next.cube.level)]) {
      next.cube.level = 15;
    }
    commit(next);
  });
  levelSelect.addEventListener('change', () => {
    const next = cloneOverrides(current);
    next.cube = { name: current.cube!.name, level: Number(levelSelect.value) };
    commit(next);
  });
  cubeControls.append(cubeSelect, levelSelect);
  const level = noCube ? undefined : cubeMeta.levels[String(current.cube.level)];
  const cubeSummary = document.createElement('p');
  cubeSummary.className = 'cube-summary';
  if (noCube) {
    cubeSummary.textContent = 'キューブを装着しません — キューブのステータスも有利コード効果も付きません。';
  } else if (level) {
    // settings.json の効果文は韓国語 (エンジン由来)。表示は公式の日本語表記に置き換える。
    const effect = cubeTemplate(cubeMeta.template).replace('{0}', String(level.effect));
    cubeSummary.textContent = `攻撃 ${level.atk.toLocaleString('en-US')} · 防御 ${level.def.toLocaleString('en-US')} · `
      + `HP ${level.hp.toLocaleString('en-US')} · ${effect} · 有利コード ${level.commonElement}%`;
  }
  cubeBox.append(cubeHeading, cubeControls, cubeSummary);
  // 固有スキルが計算に入らないキューブは、その事実を隠さない。ステータスは付くので
  // 選ぶこと自体に意味はあり、表示された効果数値だけが結果に反映されない。
  if (!noCube && cubeMeta.unsupported) {
    const note = document.createElement('p');
    note.className = 'cube-unsupported-note';
    note.dataset.cubeUnsupported = '';
    note.textContent = `このキューブの固有効果はまだ計算に反映されません — `
      + `攻撃力・防御力・HPと有利コード効果のみ適用されます。(${cubeMeta.unsupported})`;
    cubeBox.append(note);
  }
  body.append(cubeBox);

  const controlEditor = document.createElement('section');
  controlEditor.className = 'control-editor';
  const controlMode = document.createElement('div');
  controlMode.className = 'control-mode';
  const isAutomatic = current.control === undefined;
  for (const [mode, labelText] of [
    ['auto', '推奨を自動適用'],
    ['manual', '手動設定'],
  ] as const) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `control-mode-${name}`;
    radio.dataset.controlMode = mode;
    radio.checked = mode === 'auto' ? isAutomatic : !isAutomatic;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const next = cloneOverrides(current);
      if (mode === 'auto') delete next.control;
      else next.control = {};
      commit(next);
    });
    label.append(radio, document.createTextNode(labelText));
    controlMode.append(label);
  }
  const recommendation = document.createElement('p');
  recommendation.className = 'field-note';
  recommendation.textContent = recommendedControlText(defaults, squad);

  // 編成で付くコントロールは誰もオンにしていないのに掛かる — なぜ掛かるのかをすぐ下に書く。
  const ruleNotes = document.createElement('div');
  ruleNotes.className = 'control-rules';
  for (const note of controlRuleNotes(defaults, squad)) {
    const row = document.createElement('p');
    row.className = note.active ? 'control-rule is-on' : 'control-rule';
    row.dataset.controlRule = note.active ? 'on' : 'off';
    const head = document.createElement('b');
    head.textContent = note.headline;
    row.append(head);
    if (note.help) {
      const why = document.createElement('span');
      why.textContent = note.help;
      row.append(why);
    }
    ruleNotes.append(row);
  }

  const controlGrid = document.createElement('div');
  controlGrid.className = 'control-grid';
  const displayedControl = isAutomatic ? defaults.recommendedControl : current.control!;
  const updateControl = (key: keyof CharacterControl, entry: CharacterControl[typeof key] | undefined) => {
    const next = cloneOverrides(current);
    const nextControl: CharacterControl = { ...(next.control ?? {}) };
    if (entry === undefined) delete nextControl[key];
    else Object.assign(nextControl, { [key]: entry });
    next.control = nextControl;
    commit(next);
  };
  const addControlToggle = (
    key: keyof CharacterControl,
    labelText: string,
    enabledValue: CharacterControl[typeof key],
  ): HTMLLabelElement => {
    const label = document.createElement('label');
    label.className = 'inline-check control-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.control = key;
    checkbox.checked = displayedControl[key] !== undefined;
    checkbox.disabled = isAutomatic;
    checkbox.addEventListener('change', () => {
      updateControl(key, checkbox.checked ? enabledValue : undefined);
    });
    label.append(checkbox, document.createTextNode(labelText));
    controlGrid.append(label);
    return label;
  };

  if (defaults.weaponType === 'SR' || defaults.weaponType === 'RL') {
    const tapLabel = addControlToggle('tap_fire', 'タップ撃ち', { rate: TAP_FIRE_DEFAULT, release: 0.03 });
    // 発射速度は人によって違う。コミュニティは10秒あたりの発数 («N톡톡이») で呼ぶので、
    // 入力は発/秒で受けつつ、換算値を並べて見せる。
    const tapRate = document.createElement('input');
    tapRate.type = 'number';
    tapRate.dataset.tapRate = '';
    tapRate.step = '0.1';
    tapRate.min = '0.1';
    tapRate.max = '20';
    tapRate.value = String(displayedControl.tap_fire?.rate ?? TAP_FIRE_DEFAULT);
    tapRate.disabled = isAutomatic || displayedControl.tap_fire === undefined;
    const tapHint = document.createElement('small');
    tapHint.className = 'tap-rate-hint';
    tapHint.dataset.tapHint = '';
    const paintHint = (rate: number) => {
      if (!Number.isFinite(rate) || rate <= 0) { tapHint.textContent = ''; return; }
      // 10秒にN発ならサイクルは 10/(N-1) 秒 (CONTROL.md §톡톡이)。
      tapHint.textContent = `≈ 10秒${Math.round(rate * 10)}発`
        + (rate > TAP_FIRE_HARD_LIMIT ? ' · ゲーム下限(220ms)を超える値です' : '');
      tapHint.classList.toggle('is-warning', rate > TAP_FIRE_HARD_LIMIT);
    };
    paintHint(Number(tapRate.value));
    tapRate.addEventListener('input', () => {
      const rate = Number(tapRate.value);
      paintHint(rate);
      if (!Number.isFinite(rate) || rate <= 0) return;
      const next = cloneOverrides(current);
      next.control = { ...(next.control ?? {}), tap_fire: { rate, release: 0.03 } };
      emitNumericChange(next);
    });
    tapLabel.append(makeInputUnit(tapRate, '発/秒'), tapHint);
    const holdLabel = addControlToggle('hold', 'ホールドコントロール', {
      policy: 'own_full_burst', lead: 0.5,
    });
    const holdPolicy = document.createElement('select');
    holdPolicy.dataset.controlPolicy = 'hold';
    for (const [policy, text] of [
      ['own_full_burst', '自分のフルバースト中ホールド'],
      ['charge_hold_after_fb', 'フルバースト後ホールド'],
    ] as const) {
      const option = document.createElement('option');
      option.value = policy;
      option.textContent = text;
      holdPolicy.append(option);
    }
    holdPolicy.value = displayedControl.hold?.policy ?? 'own_full_burst';
    holdPolicy.disabled = isAutomatic || displayedControl.hold === undefined;
    holdPolicy.addEventListener('change', () => {
      updateControl('hold', {
        policy: holdPolicy.value as 'own_full_burst' | 'charge_hold_after_fb',
        lead: holdPolicy.value === 'own_full_burst' ? 0.5 : 0.1,
      });
    });
    holdLabel.append(holdPolicy);
  }

  const reloadLabel = addControlToggle('reload', 'リロードコントロール', {
    policy: 'before_fb_end', lead: 0.3,
  });
  const reloadPolicy = document.createElement('select');
  reloadPolicy.dataset.controlPolicy = 'reload';
  for (const [policy, text] of [
    ['before_fb_end', 'フルバースト終了前'],
    ['into_fb', 'フルバースト進入に合わせる'],
  ] as const) {
    const option = document.createElement('option');
    option.value = policy;
    option.textContent = text;
    reloadPolicy.append(option);
  }
  reloadPolicy.value = displayedControl.reload?.policy ?? 'before_fb_end';
  reloadPolicy.disabled = isAutomatic || displayedControl.reload === undefined;
  reloadPolicy.addEventListener('change', () => {
    updateControl('reload', reloadPolicy.value === 'before_fb_end'
      ? { policy: 'before_fb_end', lead: 0.3 }
      : { policy: 'into_fb', margin: 0.1 });
  });
  reloadLabel.append(reloadPolicy);
  addControlToggle('cover', 'バースト遮蔽コントロール', { policy: 'own_full_burst' });

  if (name === '신데렐라 : 크리스탈 웨이브') {
    const modeLabel = document.createElement('label');
    modeLabel.className = 'inline-check control-toggle weapon-mode-swap';
    const modeCheckbox = document.createElement('input');
    modeCheckbox.type = 'checkbox';
    modeCheckbox.dataset.weaponModeSwap = '';
    modeCheckbox.checked = current.weaponModeSwapAt !== undefined;
    const modeDelay = document.createElement('input');
    modeDelay.type = 'number';
    modeDelay.dataset.weaponModeSwapAt = '';
    modeDelay.min = '0';
    modeDelay.max = '180';
    modeDelay.step = '0.1';
    modeDelay.value = String(current.weaponModeSwapAt ?? WEAPON_MODE_SWAP_DEFAULT);
    modeDelay.disabled = current.weaponModeSwapAt === undefined;
    modeCheckbox.addEventListener('change', () => {
      const next = cloneOverrides(current);
      if (modeCheckbox.checked) next.weaponModeSwapAt = WEAPON_MODE_SWAP_DEFAULT;
      else delete next.weaponModeSwapAt;
      commit(next);
    });
    modeDelay.addEventListener('input', () => {
      const at = Number(modeDelay.value);
      if (!Number.isFinite(at) || at < 0 || at > 180) return;
      const next = cloneOverrides(current);
      next.weaponModeSwapAt = at;
      emitNumericChange(next);
    });
    modeLabel.append(
      modeCheckbox,
      document.createTextNode('狙撃モードへ変更 · 戦闘開始 '),
      makeInputUnit(modeDelay, '秒'),
      document.createTextNode('後から切替を試行'),
    );
    controlGrid.append(modeLabel);
  }

  const controlWarning = document.createElement('p');
  controlWarning.className = 'field-note warning';
  controlWarning.textContent = '複数キャラの同時コントロールは、実際に1人を操作するより有利な上限になり得ます。';
  // コントロールは窓に出さず、**カードのその場で広げる**。窓を開くと編成が
  // 隠れるが、コントロールは隣の人のものを見ながら決める設定なので、その代償が大きい。
  // 代わりに畳んだチップにいまの状態を書いておき、開かなくても読めるようにする。
  const controlChip = document.createElement('button');
  controlChip.type = 'button';
  controlChip.className = 'control-chip';
  controlChip.dataset.controlOpen = '';
  controlChip.setAttribute('aria-expanded', String(controlWasOpen));
  const chipGear = document.createElement('span');
  chipGear.className = 'control-chip-gear';
  chipGear.setAttribute('aria-hidden', 'true');
  chipGear.textContent = '⚙';
  const chipText = document.createElement('span');
  chipText.className = 'control-chip-text';
  paintControlChip = () => {
    chipText.textContent = controlChipText(current);
    chipText.title = `コントロール · バースト — ${chipText.textContent}`;
  };
  paintControlChip();
  const chipCaret = document.createElement('span');
  chipCaret.className = 'control-chip-caret';
  chipCaret.textContent = controlWasOpen ? '▴' : '▾';
  controlChip.append(chipGear, chipText, chipCaret);

  const controlPanel = document.createElement('div');
  controlPanel.className = 'control-panel';
  controlPanel.dataset.controlPanel = '';
  controlPanel.hidden = !controlWasOpen;
  controlPanel.append(controlMode, recommendation, ruleNotes, controlGrid,
    foldedNote('同時コントロール注意', controlWarning, 'control-warning'), burstEditor);
  controlChip.addEventListener('click', () => {
    const next = controlChip.getAttribute('aria-expanded') !== 'true';
    controlChip.setAttribute('aria-expanded', String(next));
    controlPanel.hidden = !next;
    chipCaret.textContent = next ? '▴' : '▾';
  });
  controlEditor.append(controlChip, controlPanel);
  // コントロールは限界突破・スキル・オーバーロード・キューブと**兄弟**に置く。その中に入れると
  // コントロールだけ見たくても設定の束を先に開くことになる — 二つの束は触る理由が違う。

  const advancedLabel = document.createElement('label');
  advancedLabel.className = 'inline-check advanced-toggle';
  const advancedToggle = document.createElement('input');
  advancedToggle.type = 'checkbox';
  advancedToggle.checked = advancedWasOpen;
  advancedToggle.dataset.advancedToggle = '';
  const advancedText = document.createElement('span');
  advancedText.textContent = '上級モード';
  advancedLabel.append(advancedToggle, advancedText);
  body.append(advancedLabel);

  const advanced = document.createElement('div');
  advanced.className = 'advanced-editor';
  advanced.hidden = !advancedToggle.checked;
  const picker = document.createElement('div');
  picker.className = 'advanced-picker';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '追加数値を検索';
  search.dataset.manualSearch = '';
  // 一つ追加したからといって検索語まで消すと、2行目からは毎回打ち直しになる。
  search.value = searchWas;
  const manualSelect = document.createElement('select');
  manualSelect.dataset.manualSelect = '';
  const add = document.createElement('button');
  add.type = 'button';
  add.dataset.addStat = '';
  add.textContent = '数値を追加';
  const renderManualOptions = () => {
    const query = search.value.trim().toLocaleLowerCase('ko');
    manualSelect.replaceChildren();
    for (const [key, meta] of Object.entries(catalog.manualStats)) {
      if (key in current.manualStats!) continue;
      // 韓国語の label でも日本語の対訳でも引けるようにする (どちらで打つ人も居る)
      const ja = statName(key);
      if (query && !meta.label.toLocaleLowerCase('ko').includes(query)
        && !ja.toLocaleLowerCase('ja').includes(query) && !key.includes(query)) continue;
      const option = document.createElement('option');
      option.value = key;
      option.textContent = ja;
      manualSelect.append(option);
    }
    add.disabled = manualSelect.options.length === 0;
  };
  search.addEventListener('input', renderManualOptions);
  add.addEventListener('click', () => {
    const key = manualSelect.value;
    if (!key || key in current.manualStats!) return;
    const next = cloneOverrides(current);
    next.manualStats![key] = 0;
    commit(next);
  });
  renderManualOptions();
  picker.append(search, manualSelect, add);
  advanced.append(picker);

  const rows = document.createElement('div');
  rows.className = 'manual-rows';
  for (const [key, manualValue] of Object.entries(current.manualStats)) {
    const meta = catalog.manualStats[key];
    if (!meta) continue;
    const row = document.createElement('label');
    row.className = 'manual-row';
    row.dataset.manualRow = key;
    const text = document.createElement('span');
    text.textContent = statName(key);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = String(meta.min);
    input.max = String(meta.max);
    input.value = String(manualValue);
    input.dataset.manualStat = key;
    input.addEventListener('input', () => {
      const next = cloneOverrides(current);
      next.manualStats![key] = Number(input.value);
      emitNumericChange(next);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeStat = key;
    remove.textContent = '削除';
    remove.addEventListener('click', () => {
      const next = cloneOverrides(current);
      delete next.manualStats![key];
      commit(next);
    });
    row.append(text, makeInputUnit(input, meta.unit), remove);
    rows.append(row);
  }
  advanced.append(rows);
  advancedToggle.addEventListener('change', () => {
    advanced.hidden = !advancedToggle.checked;
  });
  body.append(advanced);
  const bodyFold = panelOpener('限界突破 · スキル · オーバーロード · キューブ', 'settings', '数値設定');
  bodyFold.panel.append(body);
  container.append(bodyFold.head, bodyFold.panel, controlEditor);
  lastPanels.set(container, [bodyFold.panel]);
}
