import { cubeTemplate, elementLabel, growthLabel, labelFor, labelForClass, labelForCube, labelForMaker } from './display-name';
import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { NO_CUBE, defaultCharacterOverrides, renderCharacterSettings, type CharPanelKind } from './character-settings';
import {
  BLABLA_SERVERS,
  areaToOverrides,
  blablaServerLabel,
  consoleFrom,
  synchroFrom,
  looksLikeProfileUrl,
  pickArea,
  type RawArea,
  type RawProfile,
} from './blablalink';
import { parseRosterCsv } from './csv-import';
import { summarizeBattle } from './battle-summary';
import { loadFavorites, saveFavorites, toggleFavorite } from './favorites';
import { ALL_KEYS } from './storage-keys';
import { TRANSFER_PREFIX, packTransfer, parseTransfer, type TransferBox } from './transfer';
import { runScores } from './score-runner';
import { ELEMENT_SLUG, createElementIcon, createText, el, element } from './dom';
import { PERSONAL_SNIPPET, parsePersonalScan } from './personal-scan';
import { buildIndex, filterByQuery } from './nikke-search';
import { UNION_SEASON, bossBattle } from './union-bosses';
import { clearBosses, isCustomised, loadBosses, saveBosses, withBoss } from './boss-setup';
import {
  MAX_TEMPLATES, addTemplate, applyTemplate, loadTemplates, removeTemplate, saveTemplates,
} from './squad-templates';
import { applyImportedRoster, mergeImportedRoster } from './roster-merge';
import { readRoster, sortEntries, summarize, type SortKey as RosterSortKey } from './my-roster';
import {
  BEATS, MAX_PLANS_PER_ELEMENT, PLAN_ELEMENTS, addPlan, baselineBattle, registerScore,
  bossConditionBattle, counterOf, loadPlans, plansOf, removePlan, sameSquad, savePlans, updatePlan,
  type ElementPlan, type ElementPlans, type PlanElement,
} from './element-plans';
import {
  SOURCE_LABELS, canReSync, loadSyncMeta, saveSyncMeta, syncAgoText, syncAtText, syncSummary,
  type SyncMeta,
} from './sync-meta';
import {
  BOARD_SLOTS, bestForElements, bestTriple, bossForElement, boardBattle, candidatesFor as boardCandidatesFor, clashOptionsFor, clashesOf, clearSlot,
  emptyBoard, isEmptySquad, loadBoard, openSlotCandidates, saveBoard, totalOf, usageOf,
  usedCount, withSlot, type Candidate, type ClashOption, type OpenCandidate, type RaidBoard,
} from './raid-board';
import type { UnionBoss } from './union-bosses';
import {
  BURST_STAGES,
  candidatesFor, cycleLine, cyclesFromTimeline, estimateCycles, HOTKEYS, MAX_CYCLES,
  picksFrom, progressOf, sequenceForDeck, sequenceFrom, stepKey, stepsFor, trimSequence,
  type BurstStage, type BurstStep,
} from './burst-order';
import { createTimelineBlock } from './timeline';
import {
  aggregateDeckResults,
  cacheKey,
  DEFAULT_BURST_REACTION,
  DEFAULT_SYNCHRO_LEVEL,
  SYNCHRO_MAX,
  SYNCHRO_MEASURED_MAX,
  formatDamage,
  formatDps,
  formatExactDamage,
  formatExactDps,
  requestForDeck,
  resetEnemy,
  validateDecks,
  validateRequest,
} from './model';
import type {
  BatchResult,
  BattleSettings,
  BuffTargetRow,
  CombatPowerRequest,
  ElementWindow,
  PhaseWindow,
  RngMode,
  CharacterMeta,
  CharacterOverrides,
  DeckResultEntry,
  DeckState,
  SettingsCatalog,
  SimulationRequest,
  SimulationResult,
} from './types';

const DEFAULT_SQUAD = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'];

export interface CalculatorClientLike {
  prepare(): Promise<void>;
  simulate(request: SimulationRequest): Promise<SimulationResult>;
  /** 一覧を並べるための戦闘力。持たない実装 (テスト用の代役) もあるので任意。 */
  combatPower?(request: CombatPowerRequest): Promise<Record<string, number>>;
  /** 並列計算。プールを持たない実装 (テスト用の代役・ワーカー1つ) もあるので全部任意。 */
  setPoolSize?(size: number): void;
  defaultPoolSize?(): number;
  maxPoolSize?: number;
  dispose(): void;
}

interface CalculatorDependencies {
  catalog: CharacterMeta[];
  settings: SettingsCatalog;
  version: string;
  client: CalculatorClientLike;
  storage: StorageSource;
  // 完全初期化は保存を空にしてからページを開き直し、メモリ上の状態まで確実に戻す。
  // テストではここに偽物を入れる。
  reload?: () => void;
  /** テスト・自前ホスティングで、ビルド時の値の代わりに使う Blablalink プロキシの住所。 */
  blablaProxy?: string;
  /**
   * «あとで一度だけ» を頼む時計。既定は setTimeout。
   * バフ対象の先読み (700ms) がテストの途中で発火して計算回数を汚すので、
   * テストは何もしない時計を渡して先読みごと止める
   * (fake timer をテストごとに張るのをやめるため)。戻り値は取り消し。
   */
  defer?: (run: () => void, ms: number) => () => void;
}


// Pyodide のエラーは長い Python のトレースバックで来る。最後の行 (本当のエラー文) だけ見せる。
const cleanEngineError = (raw: string): string => {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? raw;
  return last.length <= 300 ? last : `${last.slice(0, 300)}…`;
};

function initialSquad(catalog: CharacterMeta[]): string[] {
  const available = new Set(catalog.map((char) => char.name));
  const defaults = DEFAULT_SQUAD.filter((name) => available.has(name));
  const fallback = catalog.map((char) => char.name).filter((name) => !defaults.includes(name));
  return [...defaults, ...fallback].slice(0, 5);
}

const emptyDeck = (id: number): DeckState => ({
  id,
  squad: ['', '', '', '', ''],
  characters: {},
});

/** ダメージ1・2位の名前。順番は変えず «印» だけを載せるために名前だけ抜く。 */
function topScorers(entry: DeckResultEntry): Map<string, number> {
  const ranked = [...new Set(entry.request.squad)]
    .map((name) => [name, entry.result.charTotals[name] ?? 0] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return new Map(ranked.slice(0, 2).map(([name], index) => [name, index + 1]));
}

/**
 * キャラごとの結果の行。立ち絵の右に棒と合計ダメージが並ぶ — デッキを切り替えながら見るときは
 * カードよりこちらが短く、棒の長さで «誰が運んだか» がそのまま読める。
 * ここでも**編成の順そのまま**で、ダメージ1・2位はバッジと枠線だけで示す。
 */
/** ダメージをどう書くか。「詳しく見る」で切り替わる — 値ではなく書き方だけが変わる。 */
interface DamageFormat {
  dmg(value: number): string;
  dps(value: number): string;
}

function renderCharacterRows(
  container: HTMLElement,
  entry: DeckResultEntry,
  imageOf: (name: string) => string | undefined,
  fmt: DamageFormat,
): void {
  const rows = document.createElement('div');
  rows.className = 'result-rows';
  const tops = topScorers(entry);
  const best = Math.max(...entry.request.squad.map((name) => entry.result.charTotals[name] ?? 0), 0);

  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const rank = tops.get(name);
    const row = document.createElement('article');
    row.className = 'character-result result-row'
      + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
    row.dataset.characterResult = name;
    if (rank) row.dataset.dmgRank = String(rank);

    const portrait = document.createElement('div');
    portrait.className = 'result-row-face';
    const source = imageOf(name);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    }
    if (rank) portrait.append(createText('b', String(rank), 'result-rank-badge'));
    row.append(portrait);

    const body = document.createElement('div');
    body.className = 'result-row-body';
    const head = document.createElement('p');
    head.className = 'result-row-name';
    head.append(
      createText('b', labelFor(name)),
      createText('span', `${share.toFixed(1)}% · ${fmt.dps(value / entry.result.duration)}`),
    );
    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    body.append(head, track);
    row.append(body);

    row.append(createText('strong', Math.round(value).toLocaleString('ja-JP'), 'result-row-total'));
    rows.append(row);
  }
  container.append(rows);
}

/**
 * キャラごとの結果カード。**編成の順そのまま**に左から右へ並ぶ — 上の編成カードと
 * 位置が揃っていないと «誰がどれだけ» を目で繋げない。ダメージ1・2位は位置を動かさず、
 * バッジと枠線だけで示す。
 */
function renderCharacterCards(
  container: HTMLElement,
  entry: DeckResultEntry,
  imageOf: (name: string) => string | undefined,
  fmt: DamageFormat,
): void {
  const grid = document.createElement('div');
  grid.className = 'result-cards';
  const tops = topScorers(entry);
  const best = Math.max(...entry.request.squad.map((name) => entry.result.charTotals[name] ?? 0), 0);

  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const rank = tops.get(name);
    const card = document.createElement('article');
    card.className = 'character-result result-card'
      + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
    card.dataset.characterResult = name;
    if (rank) card.dataset.dmgRank = String(rank);

    const portrait = document.createElement('div');
    portrait.className = 'result-card-face';
    const source = imageOf(name);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    }
    if (rank) portrait.append(createText('b', `${rank}位`, 'result-rank-badge'));
    card.append(portrait);

    card.append(createText('h3', labelFor(name)));
    card.append(createText('span', `${share.toFixed(1)}% 貢献`, 'result-card-share'));
    card.append(createText('strong', fmt.dmg(value)));
    card.append(createText('small', fmt.dps(value / entry.result.duration)));

    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    // 棒は «1位に対して» 描く。寄与%で描くと5人とも短くなって差が見えない。
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    card.append(track);

    // 通常攻撃/スキルの内訳と、スキルごとの明細。カードが狭いので畳んでおく。
    const breakdown = entry.result.charBreakdown?.[name];
    if (breakdown && value > 0) {
      const details = document.createElement('details');
      details.className = 'dmg-split';
      details.dataset.dmgSplit = '';
      const normalPct = breakdown.normal / value * 100;
      const skillPct = breakdown.skill / value * 100;
      const summary = document.createElement('summary');
      summary.append(createText('span', `通常攻撃 ${normalPct.toFixed(0)}%`, 'legend-normal'));
      summary.append(createText('span', `スキル ${skillPct.toFixed(0)}%`, 'legend-skill'));
      details.append(summary);

      const splitTrack = document.createElement('div');
      splitTrack.className = 'split-track';
      const normalBar = document.createElement('i');
      normalBar.className = 'split-normal';
      normalBar.style.width = `${normalPct}%`;
      const skillBar = document.createElement('i');
      skillBar.className = 'split-skill';
      skillBar.style.width = `${skillPct}%`;
      splitTrack.append(normalBar, skillBar);
      details.append(splitTrack);

      const legend = document.createElement('p');
      legend.className = 'split-legend';
      legend.append(
        createText('span', `通常攻撃 ${fmt.dmg(breakdown.normal)}`, 'legend-normal'),
        createText('span', `スキル ${fmt.dmg(breakdown.skill)}`, 'legend-skill'),
      );
      details.append(legend);

      if (breakdown.skills.length > 0) {
        const list = document.createElement('ul');
        list.className = 'skill-breakdown';
        for (const skill of breakdown.skills) {
          const item = document.createElement('li');
          item.append(
            createText('span', skill.name),
            createText('span', `${fmt.dmg(skill.damage)} · ${(skill.damage / value * 100).toFixed(1)}% · ${skill.hits}ヒット`),
          );
          list.append(item);
        }
        details.append(list);
      }
      card.append(details);
    }
    grid.append(card);
  }
  container.append(grid);
}

// Blablalink 照会のプロキシ。ビルド時に `VITE_BLABLA_PROXY` が焼き込まれ、空なら連携の UI を
// 描かない — プロキシ無しでブラウザから直接呼ぶと CORS とログインセッションの両方が
// 同時に塞ぐので必ず失敗する (`worker/README.md`)。
const BLABLA_PROXY = (import.meta.env.VITE_BLABLA_PROXY ?? '').trim().replace(/\/+$/, '');

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, settings, version, client, storage, reload } = deps;
  const blablaProxy = (deps.blablaProxy ?? BLABLA_PROXY).trim().replace(/\/+$/, '');
  const defer = deps.defer ?? ((run: () => void, ms: number) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  });
  const cache = new ResultCache(storage, version, 30);
  const catalogByName = new Map(catalog.map((char) => [char.name, char]));
  const decks = Array.from({ length: 5 }, (_, index) => emptyDeck(index + 1));
  decks[0]!.squad = initialSquad(catalog);
  let activeDeckId = 1;
  let activeSlot = 0;
  // 狙った枠を画面に引き寄せるのは**人が枠を変えたときだけ**にする。
  // 結果が届いても編成は描き直されるが、そのたびに引き寄せると、結果を見ていた人が
  // 編成のほうへ弾き上げられる。
  let pullActiveSlot = false;
  // 他のデッキで作った個別設定を、編成するときに連れてくるか。既定は入り。
  let carryOverSettings = true;
  let fiveDeckMode = false;
  let activity: 'preparing' | 'ready' | 'running' | 'complete' | 'cached' | 'error' = 'preparing';

  const ROSTER_KEY = 'nikke-roster-v1';
  const resolveStorage = (): StorageLike | null => {
    const source = typeof storage === 'function' ? storage() : storage;
    return source ?? null;
  };
  // jsdom には scrollIntoView が無い。画面を引き寄せるのは «あると便利» なだけなので、
  // 無い環境では飛ばしても描画は壊れない — 直接呼ぶとテストが未処理のエラーで切れる。
  const scrollTo = (el: HTMLElement) => {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  const cloneOverride = (value: object): CharacterOverrides =>
    JSON.parse(JSON.stringify(value)) as CharacterOverrides;
  // 昔の版 (育成プロフィールの読み込み) が保存したオーバーロードは、値が**行ごとの配列**のことがある。
  // 今はスカラーしか扱わないので合計に移す — 残すと要約を描くときの toFixed で落ちる。
  const migrateOverloadLines = (overrides: CharacterOverrides | undefined) => {
    const overload = overrides?.overload as Record<string, unknown> | undefined;
    if (!overload) return;
    for (const [key, value] of Object.entries(overload)) {
      if (Array.isArray(value)) {
        overload[key] = value.reduce((sum: number, v) => sum + (Number(v) || 0), 0);
      }
    }
  };

  const loadRoster = (): Record<string, CharacterOverrides> => {
    try {
      const raw = resolveStorage()?.getItem(ROSTER_KEY);
      const stored = raw ? (JSON.parse(raw) as Record<string, CharacterOverrides>) : {};
      for (const overrides of Object.values(stored)) migrateOverloadLines(overrides);
      return stored;
    } catch {
      return {};
    }
  };
  const saveRoster = () => {
    try {
      resolveStorage()?.setItem(ROSTER_KEY, JSON.stringify(roster));
    } catch {
      /* 保存に失敗しても無視 (容量・プライベートモードなど) */
    }
  };
  let roster = loadRoster();
  /** よく使うニケの印。200名から毎回探さずに済ませるための、自分で決める並び。 */
  let favorites = loadFavorites(resolveStorage());
  /**
   * 今シーズンのボス5体。**焼き込みではなく、この端末に登録されたもの**。
   * 保存が無ければ union-bosses.ts の出荷時の値。属性は編集させない (1属性1体が索引)。
   */
  let bosses = loadBosses(resolveStorage());
  /**
   * バッファーのテンプレート。B3 のアタッカーは属性ごとに変わるが、B1/B2 の
   * サポーターは強いキャラで固定されがち — その定番を型として貯めておく。
   */
  let squadTemplates = loadTemplates(resolveStorage());

  // 編成・設定・戦闘条件を localStorage に保存し、開き直しても最後の状態に戻す。
  const STATE_KEY = 'nikke-state-v1';
  // 3凸ボードの «取り込まずに試す» を覚える鍵。PAD と同一オリジンなので nikke- を必ず付ける
  const BOARD_SKIP_KEY = 'nikke-board-skip-import-v1';
  interface SavedState {
    decks: DeckState[];
    fiveDeckMode: boolean;
    activeDeckId: number;
    /** 他のデッキの個別設定を編成するときに引き継ぐか。古い保存には無い。 */
    carryOverSettings: boolean;
    battle: BattleSettings;
    buffTargets: Array<{ id: number; sig: string; rows: Record<string, BuffTargetRow[]> }>;
  }
  // キューブ名が短い通称からゲーム内の正式名称に変わった。以前の版で保存された
  // 編成には古い名前が残っていて、そのままだとエンジンが要求を拒む。読み込むときに一度
  // 移し替え、カタログに無い名前はキャラの既定値に戻るよう消す。
  const LEGACY_CUBE_NAMES: Record<string, string> = {
    재장: '렐릭 베어 큐브',
    탄충: '택티컬 베어 큐브',
    체력: '렐릭 비고르 큐브',
    차속: '렐릭 부스트 큐브',
    파츠: '렐릭 디스트로이 큐브',
    분배: '렐릭 디바이드 큐브',
  };
  const migrateSavedCubes = (state: Partial<SavedState>): Partial<SavedState> => {
    for (const deck of state.decks ?? []) {
      for (const overrides of Object.values(deck.characters ?? {})) {
        const cube = overrides.cube;
        if (!cube) continue;
        const renamed = LEGACY_CUBE_NAMES[cube.name];
        if (renamed) cube.name = renamed;
        // NO_CUBE は「知らないキューブ」ではなく「着けていない」— 消すと既定キューブに戻る
        if (cube.name !== NO_CUBE && !settings.cubes[cube.name]) delete overrides.cube;
      }
      for (const overrides of Object.values(deck.characters ?? {})) migrateOverloadLines(overrides);
    }
    return state;
  };
  const loadSavedState = (): Partial<SavedState> | null => {
    try {
      const raw = resolveStorage()?.getItem(STATE_KEY);
      return raw ? migrateSavedCubes(JSON.parse(raw) as Partial<SavedState>) : null;
    } catch {
      return null;
    }
  };
  const savedState = loadSavedState();
  // 実装は refs・readBattle が揃ってから入れる。それまでの呼び出しは何もしない。
  let saveState: () => void = () => undefined;

  root.innerHTML = `
    <div class="site-shell">
      <header class="brand">
        <div class="brand-title">
          <h1>しりすこスクワッド</h1>
          <span class="brand-beta">BETA</span>
          <span class="brand-lede">NIKKE ユニオンレイドの3凸を、自分の育成で決める</span>
        </div>
        <div class="trust-row brand-tools" aria-label="サービスの情報"><span>${catalog.length}名対応</span><a class="credit-link" href="https://github.com/Jgaram/nikke-calc" target="_blank" rel="noreferrer noopener" title="この計算機の元のリポジトリ (エンジン・データは無改変)">原作 nikke-calc に感謝</a></div>
      </header>

      <nav class="view-tabs" role="tablist" aria-label="画面切り替え">
        <button type="button" class="view-tab is-on" data-view-tab="plans" aria-pressed="true">レイド準備</button>
        <button type="button" class="view-tab" data-view-tab="board" aria-pressed="false">最適3凸</button>
        <button type="button" class="view-tab" data-view-tab="calc" aria-pressed="false">編成を作る・詳細計算</button>
      </nav>

      <section class="panel board-panel" data-view="board" aria-labelledby="board-heading" hidden>
        <div class="board-sync" data-board-sync>
          <span class="board-sync-dot" data-board-sync-dot aria-hidden="true"></span>
          <div class="board-sync-text">
            <span class="board-sync-main" data-board-sync-main></span>
            <span class="board-sync-sub" data-board-sync-sub></span>
          </div>
          <div class="board-sync-actions">
            <button type="button" class="roster-import" data-board-sync-again hidden>今の育成を取り込む</button>
            <button type="button" class="roster-import" data-board-sync-import hidden>取り込み直す</button>
            <button type="button" class="roster-import" data-board-goto="roster">育成状況を見る</button>
            <button type="button" class="roster-import lead" data-board-goto="plans">レイド準備で候補を作る</button>
          </div>
        </div>

        <!-- 取り込む前はここだけを見せる。«読み込み → 3凸» の順に進む画面にするため、
             盤面 (data-board-main) は取り込むか «取り込まずに試す» を押すまで出さない。 -->
        <section class="board-start" data-board-start hidden aria-labelledby="board-start-heading">
          <p class="board-start-step">STEP 1</p>
          <h2 id="board-start-heading">まず自分の育成を取り込む</h2>
          <p class="board-start-lede">取り込むと<b>あなたの育成での3凸の見込み</b>が出ます。取り込まなくても試せますが、その場合は<b>既定の育成 (最大)</b> の数字になります。</p>
          ${blablaProxy ? `
          <ol class="board-start-steps">
            <li>
              <span class="board-start-no" aria-hidden="true">1</span>
              <div class="board-start-body">
                <b>Blablalink で自分のページを開く</b>
                <p>開いたときに<b>アドレスバーに出るアドレス</b>が、あなたのプロフィールです。Blablalink 側で<b>プロフィールとニケ一覧を公開</b>にしていないと照会できません。</p>
                <a class="roster-import" href="https://www.blablalink.com/user" target="_blank" rel="noreferrer noopener">blablalink.com/user を開く</a>
              </div>
            </li>
            <li>
              <span class="board-start-no" aria-hidden="true">2</span>
              <div class="board-start-body">
                <b>そのアドレスを貼って取り込む</b>
                <p>限界突破・コア強化・スキル・オーバーロード・装備に加えて、CSV には無い<b>キューブとコレクション</b>まで入ります。</p>
                <button type="button" class="roster-import board-start-go" data-board-blabla>アドレスを貼って取り込む</button>
              </div>
            </li>
          </ol>` : `
          <ol class="board-start-steps">
            <li>
              <span class="board-start-no is-warn" aria-hidden="true">!</span>
              <div class="board-start-body">
                <b>アドレスを貼る方式はまだ使えません</b>
                <p>照会を代行するサーバーの準備が終わっていないため、いまは使えません。代わりに<b>下の方法</b>で、Blablalink と同じ育成データを取り込めます。</p>
              </div>
            </li>
          </ol>`}

          <!-- プロキシの有無に関わらず使える道。自分のセッションで取るので
               プロフィールを公開にする必要が無く、Cookie の入れ直しも要らない。 -->
          <details class="board-scan" data-board-scan${blablaProxy ? '' : ' open'}>
            <summary><b>自分のブラウザで取り込む</b><span>サーバー不要 · 公開設定も不要</span></summary>
            <ol class="board-scan-steps">
              <li><a href="https://www.blablalink.com/user" target="_blank" rel="noreferrer noopener">自分のプロフィールページ</a>を、ログインした状態で開く<br><small>アドレスに <code>?openid=…</code> が付いているページです。ここから自分の識別子を読み取ります。</small></li>
              <li>そのタブで <b>F12</b> → <b>Console</b> を開く</li>
              <li>下のコードをコピーして貼り、Enter (数十秒かかります)</li>
              <li>コピーされた文字列を、いちばん下の欄に貼って「取り込む」</li>
            </ol>
            <p class="board-scan-warn"><b>貼る前に必ず中身を確認してください。</b>ログイン中のサイトでコンソールにコードを貼る操作は、乗っ取り詐欺が使う手口と同じ形です。ここのコードは<b>読み取ってコピーするだけ</b>で、外部への送信はありません。<b>他所で配られた似たコードは絶対に貼らないでください。</b></p>
            <textarea class="board-scan-code" data-board-scan-code rows="4" readonly spellcheck="false"></textarea>
            <div class="board-scan-row">
              <button type="button" class="roster-import" data-board-scan-copy>コードをコピー</button>
            </div>
            <textarea class="board-scan-paste" data-board-scan-paste rows="3" placeholder="コンソールが出した文字列 (NKP1-…)、または別の端末で書き出した文字列 (NKX1-…) をここに貼り付け" spellcheck="false"></textarea>
            <div class="board-scan-row">
              <button type="button" class="roster-import board-start-go" data-board-scan-import>取り込む</button>
              <span class="board-scan-status" data-board-scan-status></span>
            </div>
          </details>

          <details class="board-move" data-board-move>
            <summary><b>別の端末へ移す</b><span>スマホでも同じ育成で見る</span></summary>
            <p class="board-move-lede">育成データは<b>この端末のこのブラウザにだけ</b>あります。
              下の文字列をメモ等でスマホに送り、スマホでは上の<b>「自分のブラウザで取り込む」の貼り付け欄</b>
              (スニペットの結果を貼るのと同じ欄) に貼ってください。スマホ側は F12 もコンソールも要りません —
              <b>コンソールを使う取り込みは PC で一度だけ</b>で済みます。</p>
            <div class="board-move-row">
              <button type="button" class="roster-import" data-board-move-make>この端末のデータを書き出す</button>
              <span class="board-move-status" data-board-move-status></span>
            </div>
            <textarea class="board-move-out" data-board-move-out rows="3" readonly hidden spellcheck="false"></textarea>
          </details>

          <div class="board-start-alt">
            <input id="board-csv" type="file" accept=".csv,text/csv" hidden />
            <button type="button" class="roster-import" data-board-csv-open title="Letsdoro のニケ情報 CSV を読み込みます">Letsdoro CSV を読み込む</button>
            <button type="button" class="roster-info" data-board-doro aria-label="Letsdoro CSV の入手方法" title="Letsdoro で CSV を入手する方法">i</button>
            <button type="button" class="board-start-skip" data-board-skip>取り込まずに試す</button>
          </div>
        </section>

        <div class="board-main" data-board-main>
        <h2 id="board-heading" class="board-sec">最適3凸 · ${UNION_SEASON.label}</h2>
        <p class="links-lede">枠ごとに<b>ボスを選ぶ</b>→<b>この枠の編成を組む</b>でニケを選びます。<b>同じニケは3凸のうち1度だけ</b>使えるので、他の枠で使った人は選べません。保存した候補があればそこから入れることもできます。</p>
        <p class="board-status" data-board-status role="status" aria-live="polite" hidden></p>
        <button type="button" class="board-btn" data-board-undo hidden>探す前の盤面に戻す</button>
        <div class="board-slots" data-board-slots></div>
        <div class="board-elements" data-board-elements>
          <b class="board-elements-label">属性を決めて最適化</b>
          <select data-board-element="0" aria-label="1凸目の属性"></select>
          <select data-board-element="1" aria-label="2凸目の属性"></select>
          <select data-board-element="2" aria-label="3凸目の属性"></select>
          <button type="button" class="board-btn lead" data-board-elements-run>この3属性で最適化</button>
          <p class="board-run-note">探すのは<b>選んだ属性の保存候補だけ</b> (各属性 最大${MAX_PLANS_PER_ELEMENT}件)。
            同じニケを2度使わない組み合わせのうち、理論値の合計が最大のものを選びます。
            <b>3枠すべてを入れ替えます</b> — 同じ属性を2回選べます (例: 水冷・水冷・灼熱)。</p>
        </div>
        <div class="board-total" data-board-total></div>
        <div class="board-used" data-board-used></div>
        <h3 class="board-sub">属性別の手持ち · 参考</h3>
        <p class="links-lede">被りを考えない場合の、属性ごとの最大値 (計算済みの候補の中で)。<b>3凸に組むと分け合うので、これより下がります</b>。</p>
        <div class="board-stock" data-board-stocks></div>
        <h3 class="board-sub">詳しく見る</h3>
        <div class="board-more">
          <button type="button" data-board-goto="calc"><b>詳細計算</b><span>編成を手で組んで、戦闘条件・バースト順・タイムラインまで詰める (いまの計算機)</span></button>
          <button type="button" data-board-goto="roster"><b>育成状況</b><span>取り込んだ自分の育成を一覧で見る。どこが伸びしろかを確かめる</span></button>
        </div>
        </div>
      </section>

      <section class="panel plans-panel" data-view="plans" aria-labelledby="plans-heading" hidden>
        <div class="section-heading">
          <div><p class="step">STEP 2</p><h2 id="plans-heading">レイド準備</h2></div>
        </div>
        <div class="prep-sync" data-prep-sync>
          <span class="board-sync-dot" data-prep-sync-dot aria-hidden="true"></span>
          <span class="prep-sync-text">
            <b data-prep-sync-main></b>
            <span data-prep-sync-sub></span>
          </span>
          <button type="button" class="roster-import" data-prep-sync-go>取り込む</button>
          <button type="button" class="roster-import" data-board-goto="roster">育成状況を見る</button>
        </div>
        <p class="links-lede">1行が<b>1凸ぶんの選択肢</b>です。左が<b>今回のボス</b>、右が<b>そのボスに有利な編成の候補</b>。<b>同じニケは3凸のうち1度だけ</b>使えるので、5行から3つを選ぶことになります。</p>

        <div class="plans-batch" data-plans-batch>
          <div class="prep-head">
            <div><h3>理論値をぜんぶ出す</h3></div>
            <button type="button" class="roster-import lead" data-plans-batch-run>ぜんぶ出す</button>
          </div>
          <p class="plans-boss-lede">貯めた編成の<b>理論ダメージ</b>を、今回のボス条件でまとめて出します。ここまで済ませておくと、下の<b>「最適3凸を探す」</b>はその値を使うので<b>すぐ答えが出ます</b>。<b>1件あたり7秒ほど</b>かかります。</p>
          <div class="prep-tally" data-prep-tally></div>
          <div class="plans-batch-bar" data-plans-batch-bar hidden>
            <div class="plans-batch-fill" data-plans-batch-fill></div>
          </div>
          <p class="plans-note" data-plans-batch-note hidden></p>
        </div>

        <div class="prep" data-prep>
          <div class="prep-head">
            <div>
              <h3>今回のボスと、当てる編成</h3>
              <p class="plans-boss-lede">ボスの<b>属性は変えられません</b> — 1属性につきボス1体という対応が、どの候補をどのボスに当てるかの索引そのものだからです。</p>
            </div>
            <button type="button" class="roster-import" data-boss-reset hidden>ボスを出荷時の値に戻す</button>
          </div>
          <div class="prep-rows" data-plans-groups></div>
          <p class="plans-note" data-boss-setup-note hidden></p>
          <div class="prep-legend" data-prep-legend></div>
        </div>

        <div class="prep-next" data-prep-next>
          <div class="prep-next-text">
            <b>最適3凸を探す</b>
            <span data-prep-next-note></span>
          </div>
          <button type="button" class="roster-import lead" data-prep-go>全ボスから自動で探す →</button>
          <button type="button" class="roster-import" data-prep-go-elements title="凸する属性を自分で決めて (同じ属性を2回でも可)、その中で被りなし・合計最大の3つ組を選びます">属性を決めて最適化 →</button>
        </div>

        <details class="plans-advanced">
          <summary><b>詳しく確かめる</b><span>順位が入れ替わる理由を調べたいときだけ</span></summary>
          <div class="plans-boss" data-plans-boss>
            <h3>ボス条件で確かめる</h3>
            <p class="plans-boss-lede"><b>ボスの癖なし</b>の値と<b>登録したボス条件</b>の値を並べ、コアやパーツで順位が入れ替わるかを見ます。通常は上の「理論値をぜんぶ出す」だけで足ります。</p>
            <div class="plans-boss-row">
              <select data-plans-boss-pick aria-label="ボス"></select>
              <span class="plans-boss-cond" data-plans-boss-cond></span>
              <button type="button" class="roster-import" data-plans-boss-run>このボスで比べる</button>
            </div>
            <p class="plans-note" data-plans-boss-note hidden></p>
            <div class="plans-boss-result" data-plans-boss-result></div>
          </div>
          <div class="plans-baseline">
            <h3>基準条件で比べる</h3>
            <p class="plans-boss-lede">ボス固有の癖を外した同じ条件で、その属性の候補だけを並べ直します。<b>ここで出した値は鮮度が付きません</b> (今回のボス条件ではないため)。</p>
            <div class="plans-baseline-row" data-plans-baseline-row></div>
          </div>
        </details>
      </section>

      <section class="panel roster-panel" data-view="roster" aria-labelledby="roster-heading" hidden>
        <div class="section-heading">
          <div><p class="step">ROSTER</p><h2 id="roster-heading">自分の育成状況</h2></div>
        </div>
        <p class="links-lede">取り込んだ<b>自分の育成状況</b>です。どこが伸びしろかを見るための一覧で、ここでは値を変えません (変更は計算機のカードから)。</p>
        <div class="roster-empty" data-myroster-empty hidden>
          <p>まだ取り込んでいません。<b>3凸ボード</b>の STEP 1 から取り込むと、ここに育成状況が並びます。</p>
          <p><button type="button" class="roster-import" data-myroster-goto-board>取り込みに進む</button></p>
        </div>
        <div class="roster-body" data-myroster-body hidden>
          <div class="roster-stats" data-myroster-stats></div>
          <div class="roster-sort">
            <span class="roster-sort-label">並べ替え</span>
            <select data-myroster-sort aria-label="並べ替え">
              <option value="power">戦闘力の高い順</option>
              <option value="growth">突破の高い順</option>
              <option value="skill">スキル合計の高い順</option>
              <option value="element">コード順</option>
              <option value="name">名前順</option>
            </select>
          </div>
          <div class="roster-table-wrap">
            <table class="roster-table">
              <thead>
                <tr>
                  <th>ニケ</th><th>コード</th><th>バースト</th><th>突破</th><th>スキル</th>
                  <th>有利</th><th>攻撃</th><th>装弾</th><th>キューブ</th><th>コレクション</th><th>戦闘力</th>
                </tr>
              </thead>
              <tbody data-myroster-rows></tbody>
            </table>
          </div>
        </div>
      </section>




      <form class="calculator-layout" data-view="calc" novalidate>
        <section class="panel squad-panel" aria-labelledby="squad-heading">
          <div class="section-heading">
            <div><h2 id="squad-heading">編成とキャラクター設定</h2></div>
            <div class="squad-tools">
              <span class="roster-import-group">
                <input id="roster-csv" type="file" accept=".csv,text/csv" hidden />
                <button type="button" class="roster-import" data-roster-csv-open title="Letsdoro のニケ情報 CSV を読み込み、すべてのニケ設定に適用します">Letsdoro CSV を読み込む</button>
                <button type="button" class="roster-info" data-doro-open aria-label="Letsdoro CSV の入手方法" title="Letsdoro で CSV を入手する方法">i</button>
              </span>
              ${blablaProxy ? '<button type="button" class="roster-import" data-blabla-open title="Blablalink のプロフィール URL から所持ニケの育成状況を一括で読み込みます">Blablalink 連携</button>' : ''}
              <span class="roster-sync" data-sync-box hidden><span class="roster-sync-when" data-sync-when></span><button type="button" class="roster-import" data-sync-again title="覚えているプロフィールから育成状況を取り込み直します">今の育成を取り込む</button></span>
              <button type="button" class="roster-import danger" data-reset-all title="編成・設定・CSV ロスター・追加したニケ・保存された結果をすべて消して初期状態に戻します">完全初期化</button>
              <label class="toggle-field mode-toggle" title="他のデッキで既に設定済みの個別設定を、編成時にそのまま引き継ぎます"><input id="carry-settings" type="checkbox" checked /><span class="toggle"></span><span>設定を引き継ぐ</span></label>
              <label class="toggle-field mode-toggle"><input id="squad-mode" type="checkbox" /><span class="toggle"></span><span>5デッキモード</span></label>
            </div>
            <p class="roster-note" data-roster-note hidden></p>
          </div>
          <div class="deck-tabs" data-deck-tabs hidden></div>
          <div class="deck-controls">
            <button type="button" class="burst-order-open" data-burst-order-open title="サイクルごとに1バ・2バ・3バを誰が使うかを自分で決めます。決めた分だけ従い、その後は通常の順序に戻ります"><span class="burst-order-mark" aria-hidden="true">1·2·3</span><span>バースト順序</span><b class="burst-order-badge" data-burst-order-badge hidden></b></button>
            <span class="deck-moves" data-deck-moves hidden></span>
            <button type="button" class="deck-clear" data-deck-clear title="今見ているデッキの編成と個別設定を空にします">デッキを空にする</button>
          <div class="deck-copy" data-deck-copy hidden>
            <button type="button" class="deck-copy-open" data-deck-copy-open>現在のデッキをコピー</button>
            <div class="deck-copy-panel" data-deck-copy-panel hidden>
              <p class="deck-copy-title" data-deck-copy-title></p>
              <div class="deck-copy-targets" data-deck-copy-targets></div>
              <div class="deck-copy-actions">
                <button type="button" class="deck-copy-apply" data-deck-copy-apply>コピー</button>
                <button type="button" class="deck-copy-cancel" data-deck-copy-cancel>キャンセル</button>
              </div>
            </div>
          </div>
          </div>
          <p class="deck-note" data-deck-note hidden>デッキ間では同じキャラクターを重ねて編成できます。</p>
          <div class="squad-grid" data-squad-grid></div>

          <!-- 니케 고르기. 창을 띄우지 않고 늘 펼쳐 두고, 검색은 이 판을 거른다.
               「이름을 쳤는데 아무 일도 안 일어난다」가 지적된 지점이라, 결과를
               감추는 자리를 없앴다. -->
          <section class="picker" aria-label="ニケを選ぶ">
            <div class="picker-head">
              <h3>ニケを選ぶ <span data-roster-count></span></h3>
              <p class="picker-target" data-roster-desc></p>
            </div>
            <input type="search" class="roster-search" data-roster-search placeholder="名前で検索" autocomplete="off" aria-label="ニケ名検索" />
            <!-- 정렬·필터는 판을 눌러 펼친다. 칩을 늘 깔아 두면 목록이 화면 밖으로
                 밀리고, 필터가 몇 개 걸렸는지도 한눈에 안 들어온다. -->
            <div class="picker-bar">
              <button type="button" class="filter-open" data-filter-open aria-expanded="false">
                <span>並べ替えとフィルター</span>
                <b class="filter-badge" data-filter-badge hidden></b>
                <span class="filter-caret" aria-hidden="true">▾</span>
              </button>
              <!-- 버스트는 가장 자주 거르는 축이라 판 안에 넣지 않는다 — 판을 펼치지
                   않고 바로 누를 수 있어야 한다. -->
              <div class="filter-chips burst-chips" data-burst-group></div>
              <button type="button" class="filter-reset" data-filter-reset hidden>フィルターを解除</button>
              <span class="filter-summary" data-filter-summary></span>
            </div>
            <!-- 판은 목록을 밀어내지 않고 그 «위에» 얹힌다. 밀어내면 펼칠 때마다
                 목록이 화면 밖으로 내려가 무엇을 고르는 중이었는지 놓친다. -->
            <div class="picker-body">
              <div class="filter-panel" data-filter-panel hidden>
                <div class="filter-section">
                  <p class="filter-title">並べ替え</p>
                  <div class="filter-chips" data-sort-group></div>
                </div>
                <div class="filter-rule"></div>
                <p class="filter-title">フィルター</p>
                <div class="filter-groups" data-filter-groups></div>
              </div>
              <div class="picker-scroll"><div class="roster-grid" data-roster-grid></div></div>
            </div>
            <p class="roster-empty" data-roster-empty hidden>検索に一致するニケがいません。</p>
          </section>
        </section>

        <section class="panel settings-panel" aria-labelledby="settings-heading">
          <div class="section-heading compact target-heading">
            <div><h2 id="settings-heading">戦闘条件</h2></div>
            <div class="target-actions">
              <button type="button" class="reset-enemy" data-reset-enemy>敵の数値を初期化</button>
              <button type="button" class="reset-enemy" data-clear-cache title="同じ条件で保存された結果を消し、次の実行から計算し直します">保存された結果を消す</button>
            </div>
          </div>
          <!-- 조건은 한 번 정해 두면 계속 쓰는 값이다. 그 자리에서 펼치면 편성이 화면
               밖으로 밀리므로 창으로 띄우고, 이 줄에는 무엇으로 재는지만 한 줄로 남긴다. -->
          <!-- 조건과 실행을 한 막대로 붙인다. 패널 사이에 단추만 덩그러니 뜨는 자리를
               없애고, «이 조건으로 → 실행»이 한 줄로 읽히게 하려는 것이다. -->
          <div class="cond-bar">
            <button type="button" class="battle-open" data-battle-open aria-expanded="false">
              <span class="battle-open-label">戦闘条件</span>
              <span class="battle-summary" data-battle-summary></span>
              <span class="disclosure-hint" aria-hidden="true">開く ›</span>
            </button>
            <button class="calculate-button run-inline" type="submit"><span>シミュレーション実行</span><b aria-hidden="true">→</b></button>
          </div>
          <!-- 계산이 얼마나 빨리 끝나는지를 정하는 설정이라 실행 단추 바로 아래에 둔다. -->
          <div class="parallel-row">
            <label class="toggle-field mode-toggle parallel-pick" title="計算を複数のワーカースレッドに分けて回します。この端末のコアを多く使う代わりに、5デッキ計算が数倍速くなります — 計算はこの端末上で走るのでサーバー費用とは無関係です">
              <input type="checkbox" data-parallel-toggle checked /><span class="toggle"></span><span>並列計算</span>
              <select data-parallel-size></select>
            </label>
          </div>
          <p class="status" data-status aria-live="polite">計算エンジンを準備中…</p>
          <p class="battle-first-note" data-battle-first-note>計算する前に<b>戦闘条件を一度確認してください</b> — 何秒の戦闘か、敵コードが何かによって結果がまったく変わります。</p>
          <!-- 막힌 이유는 누른 단추 바로 아래에서 읽혀야 한다. -->
          <div class="error-box" data-errors hidden role="alert"></div>

          <!-- 창은 조건 패널 «안»에 둔다 — 설정 입력을 지켜보는 리스너가 이 패널을
               기준으로 걸려 있어, 밖으로 빼면 값을 바꿔도 저장되지 않는다. -->
          <div class="custom-modal" data-battle-modal hidden>
          <div class="custom-card battle-card" role="dialog" aria-label="戦闘条件">
          <div class="custom-head"><h2>戦闘条件</h2><button type="button" class="custom-close" data-battle-modal-close aria-label="閉じる">✕</button></div>
          <div class="battle-body" data-battle-body>
          <div class="field-grid">
            <label><span>戦闘時間</span><div class="input-unit"><input id="duration" type="number" min="10" max="180" step="1" value="180" /><em>秒</em></div></label>
            <label><span>敵コード</span><select id="enemy-code"><option value="">なし</option><option value="풍압">風圧(灼熱に弱い)</option><option value="수냉">水冷(電撃に弱い)</option><option value="작열">灼熱(水冷に弱い)</option><option value="전격">電撃(鉄甲に弱い)</option><option value="철갑">鉄甲(風圧に弱い)</option></select></label>
            <label><span>シンクロレベル</span><div class="input-unit"><input id="synchro-level" type="number" min="1" max="${SYNCHRO_MAX}" step="1" value="${DEFAULT_SYNCHRO_LEVEL}" title="シンクロデバイスの部隊に入れたニケは全員このレベルになります。アカウントの育成状態なので戦闘条件の共有コードには含まれません。${SYNCHRO_MEASURED_MAX}レベルまでは実測値で、それ以上は同じ成長曲線を延長して計算します" /><em>Lv</em></div></label>
            <label class="toggle-field"><input id="has-core" type="checkbox" /><span class="toggle"></span><span>コアあり</span></label>
            <label data-core-size><span>コア直径</span><div class="input-unit"><input id="core-px" type="number" min="0" max="1000" step="1" value="52" disabled /><em>px</em></div></label>
            <label class="toggle-field"><input id="has-parts" type="checkbox" /><span class="toggle"></span><span>破壊可能パーツ</span></label>
          </div>
          <fieldset class="range-field">
            <legend>適正距離</legend>
            <div class="range-options" data-optimal-range></div>
            <p class="field-note">選んだ武器種の<b>通常攻撃</b>にだけダメージボーナス +30% が付きます — スキルダメージには付きません。敵との距離に依存する条件なので武器種単位でオンにします。</p>
          </fieldset>

          <!-- 고급 설정 — 자주 손대지 않는 값과 보스 페이즈를 한자리에 접어 둔다. -->
          <button type="button" class="disclosure" data-advanced-battle aria-expanded="false">
            <span class="disclosure-label">詳細設定</span><span class="disclosure-hint">展開</span>
          </button>
          <div class="disclosure-panel" data-advanced-battle-panel hidden>
            <div class="field-grid">
              <label><span>敵防御力</span><input id="enemy-def" type="number" min="0" max="999999" step="1" value="31784" /></label>
              <div class="calc-boss-presets" data-boss-presets><span class="calc-boss-presets-label">${UNION_SEASON.label}</span></div>
              <label><span>乱数シード</span><input id="seed" type="number" min="0" max="2147483647" step="1" value="42" /></label>
              <label title="ゲージチャージだけの時間です。これに段階切り替えの0.3秒とバーストクールの余裕が加わるため、実際の空白はもっと長くなります。"><span>バーストゲージチャージ</span><div class="input-unit"><input id="burst-regen" type="number" min="0" max="20" step="0.1" value="2" /><em>秒</em></div></label>
              <label class="toggle-field deck-regen-toggle" title="バーストクールがずれるデッキだけ別の値で測りたいときにオンにします"><input id="burst-regen-per-deck" type="checkbox" /><span class="toggle"></span><span>バーストチャージをデッキごとに分ける</span></label>
              <label title="条件が揃ってから実際にバーストを押すまでにかかる時間です。バースト1つごとに加算されるため、3段階まで使うとその3倍だけ遅れます。"><span>バースト反応速度</span><div class="input-unit"><input id="burst-reaction" type="number" min="0" max="3" step="0.01" value="${DEFAULT_BURST_REACTION}" /><em>秒</em></div></label>
              <label><span>乱数処理</span><select id="rng-mode"><option value="expected">期待値 (推奨)</option><option value="random">乱数</option></select></label>
              <label class="toggle-field" title="回避区間では通常攻撃が外れるため、ゲージも溜まらないものとして計算します。オンにするとその分バーストが遅れます。"><input id="immune-blocks-burst" type="checkbox" checked /><span class="toggle"></span><span>回避区間中はバーストチャージ停止</span></label>
            </div>
            <div class="deck-regen-grid" data-deck-regen hidden></div>
            <p class="field-note">期待値は確率の代わりに期待値を使うため、<b>同じ設定なら常に同じ値</b>になります。乱数はゲーム内と同じ分散を再現し、シードによって結果が揺れます。</p>

            <fieldset class="range-field">
              <legend>通常攻撃係数</legend>
              <div class="coeff-options" data-hit-coeff></div>
              <p class="field-note">実戦で弾のばらつきにより外れる弾を補正します。<b>通常攻撃にだけ</b>掛け、スキル・バーストと変身モードの射撃は照準判定なので触りません。既定値は実測との照合で得た値で(SG 0.90)、1.00なら補正なしです。</p>
            </fieldset>

            <fieldset class="range-field phase-field">
              <legend>ボスフェーズ</legend>
              <div class="phase-head">
                <button type="button" class="phase-add" data-phase-add="immune">回避区間を追加 <b>+</b></button>
                <button type="button" class="phase-add" data-phase-add="element">属性制限を追加 <b>+</b></button>
              </div>
              <div class="phase-list" data-phase-list></div>
              <p class="field-note"><b>回避区間</b>は通常攻撃だけが外れます。持続ダメージ・スキルダメージと、通常攻撃で発動した追加攻撃は入り続けます。<b>属性制限</b>は選んだ属性に<b>有利する</b>キャラクターのダメージだけを通します — 風圧にすると灼熱のキャラクターだけが入ります。ゲーム内と同様に<b>有利コードバフ</b>で有利になったキャラクターも通ります(ラピ:レッドフードの «付着型榴弾» など)。</p>
            </fieldset>
          </div>
          <section class="console-editor">
            <h3>コンソール <span>前哨基地 リサイクルルーム</span></h3>
            <div class="console-grid" data-console-grid></div>
            <p class="field-note">アカウント設定なのでスカッド全員に同じく適用されます。クラス・企業はゲーム内で所属ごとに別々に成長するため、それぞれ入力します。企業は攻撃力、共通・クラスはHPを上げます — HP係数を使うキャラクター(シンデレラなど)は共通・クラスもダメージに反映されます。</p>
          </section>
          </div>
          </div>
          </div>
        </section>

        <section class="panel result-panel" aria-labelledby="result-heading" data-result-panel>
          <div class="result-empty"><h2 id="result-heading">戦闘結果</h2><div class="radar-mark" aria-hidden="true"><i></i><i></i><i></i></div><p>編成と条件を確認してから<br />シミュレーションを実行してください。</p></div>
        </section>
      </form>

      <section class="panel timeline-panel" data-view="calc" aria-labelledby="timeline-heading" data-timeline-panel hidden>
        <div class="section-heading compact"><div><h2 id="timeline-heading">戦闘タイムライン</h2></div></div>
        <div data-timeline-body></div>
      </section>
      <footer><p>非公式ファン制作ツール · 実際の戦闘環境とは差がある場合があります。</p><a href="https://github.com/Furu1018/shirisuko-squad" target="_blank" rel="noreferrer">SOURCE / GITHUB ↗</a></footer>



      <!-- 업데이트 공지. 새 내용이 있을 때 처음 들어오면 한 번 뜨고, 닫으면 그 판을
           본 것으로 적어 다시 뜨지 않는다. 「업데이트 내역」으로 언제든 다시 연다. -->

      <!-- 캐릭터 설정 뭉치를 띄우는 창. 카드가 좁아 그 자리에서 펼치면 다섯 장이
           서로를 밀어낸다 — 필터 판과 같은 방식으로 창을 띄운다. -->
      <div class="custom-modal" data-char-panel-modal hidden>
        <div class="custom-card char-panel-card" role="dialog" aria-label="キャラクター設定">
          <div class="custom-head"><h2 data-char-panel-title>キャラクター設定</h2><button type="button" class="custom-close" data-char-panel-close aria-label="閉じる">✕</button></div>
          <div class="char-panel-body" data-char-panel-body></div>
        </div>
      </div>

      <div class="custom-modal" data-squad-modal hidden>
        <div class="custom-card squad-card" role="dialog" aria-modal="true" aria-labelledby="squad-modal-title">
          <div class="custom-head">
            <h2 id="squad-modal-title" data-squad-modal-title>編成を組む</h2>
            <button type="button" class="custom-close" data-squad-modal-close aria-label="閉じる">✕</button>
          </div>
          <p class="custom-desc" data-squad-modal-desc></p>
          <div class="squad-body">
            <div class="squad-pick" data-squad-modal-pick></div>
            <div class="squad-tune" data-squad-modal-tune></div>
          </div>
          <p class="plans-note" data-squad-modal-note hidden></p>
          <div class="squad-foot">
            <span class="squad-foot-side">
              <button type="button" class="roster-import" data-squad-modal-load>詳細計算のデッキを読み込む</button>
              <button type="button" class="roster-import" data-plans-apply>詳細計算で開く</button>
            </span>
            <span class="squad-foot-main">
              <button type="button" class="roster-import" data-squad-modal-cancel>やめる</button>
              <button type="button" class="roster-import lead" data-squad-modal-save>この編成を保存</button>
            </span>
          </div>
        </div>
      </div>

      <div class="custom-modal" data-buff-order-modal hidden>
        <div class="custom-card buff-order-card" role="dialog" aria-label="バフ対象の順序">
          <div class="custom-head"><h2 data-buff-order-title>バフ対象の順序</h2><button type="button" class="custom-close" data-buff-order-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc" data-buff-order-desc></p>
          <div class="buff-order-list" data-buff-order-list></div>
        </div>
      </div>

      <div class="custom-modal" data-burst-order-modal hidden>
        <div class="custom-card burst-order-card" role="dialog" aria-label="バースト順序">
          <div class="custom-head"><h2>バースト順序</h2><button type="button" class="custom-close" data-burst-order-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">サイクルごとに<b>1バ → 2バ → 3バ</b>を誰が使うかを自分で決めます。<b>決めたサイクルまでだけ従います</b> — 戦闘がそれより長ければ、その後は計算機が通常の順序で選びます。ポートレートを押すか <b>A·S·D·F·G</b> キーで選び、<b>←</b> で1つ戻します。</p>
          <div class="burst-order-bar">
            <label class="burst-cycles">フルバースト回数
              <button type="button" class="burst-step-btn" data-burst-cycles-down aria-label="1サイクル減らす">−</button>
              <output data-burst-cycles>0</output>
              <button type="button" class="burst-step-btn" data-burst-cycles-up aria-label="1サイクル増やす">+</button>
            </label>
            <span class="burst-order-progress" data-burst-progress></span>
            <button type="button" class="roster-import" data-burst-order-reset>最初から</button>
          </div>
          <p class="burst-order-hint" data-burst-cycles-note></p>
          <div class="burst-now" data-burst-now></div>
          <div class="burst-picks" data-burst-picks></div>
          <div class="burst-order-list" data-burst-list></div>
          <p class="custom-msg" data-burst-order-msg hidden></p>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-burst-order-save>この順序にする</button>
            <button type="button" class="deck-copy-cancel" data-burst-order-clear>順序を消す(自動)</button>
          </div>
        </div>
      </div>



      <div class="custom-modal" data-reset-modal hidden>
        <div class="custom-card reset-card" role="dialog" aria-label="完全初期化の確認">
          <div class="custom-head"><h2>完全初期化</h2><button type="button" class="custom-close" data-reset-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">以下の項目をすべて消して初期状態に戻します。元に戻せません。</p>
          <ul class="reset-list">
            <li>すべてのデッキの編成とキャラクターごとの設定</li>
            <li>CSV から読み込んだロスター</li>
            <li>自分で追加したニケ</li>
            <li>保存された計算結果</li>
            <li>戦闘条件</li>
          </ul>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply danger" data-reset-confirm>初期化</button>
            <button type="button" class="deck-copy-cancel" data-reset-cancel>キャンセル</button>
          </div>
        </div>
      </div>

      ${blablaProxy ? `
      <div class="custom-modal" data-blabla-modal hidden>
        <div class="custom-card doro-card" role="dialog" aria-label="Blablalink 連携">
          <div class="custom-head"><h2>Blablalink 連携</h2><button type="button" class="custom-close" data-blabla-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">Blablalink で<b>自分のプロフィールのアドレス</b>をコピーして入れると、所持ニケの育成状態を一括で取り込みます。限界突破・コア強化・スキル・オーバーロード・装備強化に加え、CSV にはない<b>キューブとコレクション</b>まで入ります。</p>
          <p class="custom-desc"><a href="https://www.blablalink.com/user" target="_blank" rel="noreferrer noopener">blablalink.com/user</a> を開いたときにアドレスバーに出るアドレスがそれです。Blablalink で<b>プロフィールとニケ一覧を公開</b>に変えないと照会できません — どちらか一方でも非公開だと遮断されます。前哨基地まで公開すると、コンソール(リサイクルルーム)のレベルも一緒に入ります。</p>
          <div class="blabla-row">
            <select class="blabla-server" data-blabla-server aria-label="Blablalink サーバー">
              <option value="">自動 (所持ニケが最も多いサーバー)</option>
              ${BLABLA_SERVERS.map(({ area, label }) => `<option value="${area}">${label}</option>`).join('')}
            </select>
            <input type="url" class="blabla-url" data-blabla-url placeholder="https://www.blablalink.com/user?openid=..." spellcheck="false" />
            <button type="button" class="roster-import" data-blabla-sync>同期</button>
          </div>
          <p class="custom-desc blabla-status" data-blabla-status hidden></p>
          <p class="custom-desc">取得した値はこのブラウザにのみ保存されます。好感度は計算機が限界突破段階から導くため、別途反映しません。</p>
        </div>
      </div>` : ''}
      <div class="custom-modal" data-doro-modal hidden>
        <div class="custom-card doro-card" role="dialog" aria-label="Letsdoro CSV の入手方法">
          <div class="custom-head"><h2>Letsdoro CSV の入手方法</h2><button type="button" class="custom-close" data-doro-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">Letsdoro の<b>ニケ情報</b>ページで、一覧の右下にある<b>ダウンロードアイコン</b>を押すと CSV が保存されます。そのファイルを<b>Letsdoro CSV を読み込む</b>で入れると、所持ニケの設定が一括で適用されます。</p>
          <p class="doro-link"><a href="https://letsdoro.com/mypage?tab=nikke" target="_blank" rel="noreferrer">letsdoro.com のニケ情報を開く ↗</a></p>
          <p class="field-note">CSV には<b>キューブと好感度</b>が含まれていません — この2つは既定値(既定のキューブ · 限界突破ごとの最大好感度)で計算し、カードの<b>個別設定</b>で実際の値に直せます。</p>
          <img class="doro-shot" src="${import.meta.env.BASE_URL}letsdoro-csv.png" alt="Letsdoro のニケ情報ページでの CSV ダウンロード位置" loading="lazy" />
        </div>
      </div>

    </div>
  `;

  const form = element<HTMLFormElement>(root, 'form');
  const squadGrid = element<HTMLElement>(root, '[data-squad-grid]');
  const deckTabs = element<HTMLElement>(root, '[data-deck-tabs]');
  const deckNote = element<HTMLElement>(root, '[data-deck-note]');
  const deckCopy = element<HTMLElement>(root, '[data-deck-copy]');
  const deckMoves = element<HTMLElement>(root, '[data-deck-moves]');
  const deckCopyOpen = element<HTMLButtonElement>(root, '[data-deck-copy-open]');
  const deckCopyPanel = element<HTMLElement>(root, '[data-deck-copy-panel]');
  const deckCopyTitle = element<HTMLElement>(root, '[data-deck-copy-title]');
  const deckCopyTargets = element<HTMLElement>(root, '[data-deck-copy-targets]');
  const deckCopyApply = element<HTMLButtonElement>(root, '[data-deck-copy-apply]');
  const deckCopyCancel = element<HTMLButtonElement>(root, '[data-deck-copy-cancel]');
  const status = element<HTMLElement>(root, '[data-status]');
  const errors = element<HTMLElement>(root, '[data-errors]');
  const submit = element<HTMLButtonElement>(root, 'button[type="submit"]');
  const resultPanel = element<HTMLElement>(root, '[data-result-panel]');
  const timelinePanel = element<HTMLElement>(root, '[data-timeline-panel]');
  // タイムラインは «計算結果があるか» と «いま計算機の画面か» の両方を満たすときだけ見せる。
  let timelineHasContent = false;
  const timelineBody = element<HTMLElement>(root, '[data-timeline-body]');
  const coreToggle = element<HTMLInputElement>(root, '#has-core');
  const corePxInput = element<HTMLInputElement>(root, '#core-px');
  const rosterInput = element<HTMLInputElement>(root, '#roster-csv');
  const rosterNote = element<HTMLElement>(root, '[data-roster-note]');

  const activeDeck = () => decks[activeDeckId - 1]!;

  /**
   * 編成 (ニケ名の並び) を、いま見ているデッキに入れる。
   * スナップショット (案に登録したキューブ等) があればそのニケの個別設定を**差し替える** —
   * 盤面が出した数字と「詳細計算」の数字が同じ設定から出るようにするため。
   * スナップショットに無いニケの育成値はロスターを正本にする — 取り込み直せばここも新しい値になる。
   */
  const applySquadToDeck = (
    squad: readonly string[], snapshot?: Record<string, CharacterOverrides>,
  ) => {
    const deck = activeDeck();
    deck.squad = Array.from({ length: 5 }, (_, i) => squad[i] ?? '');
    for (const name of deck.squad) {
      if (!name) continue;
      // 盤面の計算 (charactersWith) と同じ優先順位で**作り直す** — スナップショット ?? ロスター ?? なし。
      // デッキに残っていた古い手直しを引き継ぐと、盤面の数字と詳細計算の数字がずれる
      const base = snapshot?.[name] ?? roster[name];
      if (base) deck.characters[name] = cloneOverride(base);
      else delete deck.characters[name];
    }
    saveState();
    renderDeckTabs();
    renderSquad();
    showErrors([]);
  };

  const showErrors = (messages: string[]) => {
    errors.replaceChildren();
    errors.hidden = messages.length === 0;
    for (const message of messages) errors.append(createText('p', message));
  };

  const renderDeckTabs = () => {
    deckTabs.replaceChildren();
    for (const deck of decks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.deckTab = String(deck.id);
      button.className = deck.id === activeDeckId ? 'is-active' : '';
      const count = deck.squad.filter(Boolean).length;
      button.textContent = `デッキ ${deck.id}${count ? ` · ${count}` : ''}`;
      button.addEventListener('click', () => {
        activeDeckId = deck.id;
        // デッキを移すと、盤が狙っている枠もそのデッキ基準で取り直す。
        const empty = deck.squad.findIndex((member) => !member);
        activeSlot = empty < 0 ? 0 : empty;
        // パネルは «いまのデッキ» 基準なので、デッキを移したら閉じる (開いたままだと対象が紛れる)。
        closeDeckCopy();
        saveState();
        renderDeckTabs();
        renderSquad();
      });
      deckTabs.append(button);
    }

    const moves = element<HTMLElement>(root, '[data-deck-moves]');
    moves.replaceChildren();

    // デッキの並べ替え。デッキの «番号» は場所の名前なので動かさず、**中身だけ**入れ替える —
    // 番号まで一緒に動くと、いま見ていたデッキがどこへ行ったか分からなくなる。
    const swapDeck = (delta: number) => {
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= decks.length) return;
      const a = decks[index]!;
      const b = decks[target]!;
      [a.squad, b.squad] = [b.squad, a.squad];
      [a.characters, b.characters] = [b.characters, a.characters];
      // いま移した編成についていく。
      activeDeckId = b.id;
      closeDeckCopy();
      saveState();
      renderDeckTabs();
      renderSquad();
    };
    for (const [delta, label, title] of [
      [-1, '‹', '前へ'], [1, '›', '後ろへ'],
    ] as const) {
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'deck-move';
      move.dataset.deckMove = String(delta);
      move.textContent = label;
      move.title = `現在のデッキを${title}移動`;
      move.ariaLabel = `デッキ ${activeDeckId} を${title}移動`;
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      move.disabled = index + delta < 0 || index + delta >= decks.length;
      move.addEventListener('click', () => swapDeck(delta));
      moves.append(move);
    }
  };

  // デッキの複製 — 同じ編成を複数のデッキに敷いて、アタッカー1枠だけ変えて比べるためのもの。
  // 編成 (squad) とキャラごとの設定 (characters) を一緒に複製しないと比較が公平にならない。
  const closeDeckCopy = () => {
    deckCopyPanel.hidden = true;
    deckCopyOpen.setAttribute('aria-expanded', 'false');
  };

  const renderDeckCopy = () => {
    const source = activeDeck();
    deckCopyTitle.textContent = `デッキ ${source.id} の編成とキャラクター設定のコピー先`;
    deckCopyTargets.replaceChildren();
    for (const deck of decks) {
      if (deck.id === source.id) continue;
      const count = deck.squad.filter(Boolean).length;
      const label = document.createElement('label');
      label.className = 'deck-copy-target';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.deckCopyTarget = String(deck.id);
      // 空のデッキは失うものが無いので既定で選ぶ。組んであるデッキは人が自分で選ぶ。
      box.checked = count === 0;
      label.append(
        box,
        createText('span', count === 0 ? `デッキ ${deck.id} · 空き` : `デッキ ${deck.id} · ${count}名 (上書き)`,
          count === 0 ? undefined : 'deck-copy-warn'),
      );
      deckCopyTargets.append(label);
    }
  };

  const applyDeckCopy = () => {
    const source = activeDeck();
    const targets = Array.from(
      deckCopyTargets.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]'),
    ).filter((box) => box.checked).map((box) => Number(box.dataset.deckCopyTarget));
    if (targets.length === 0) {
      showErrors(['コピー先のデッキを1つ以上選んでください。']);
      return;
    }
    for (const id of targets) {
      const target = decks[id - 1];
      if (!target) continue;
      target.squad = [...source.squad];
      target.characters = Object.fromEntries(
        Object.entries(source.characters).map(([name, value]) => [name, cloneOverride(value)]),
      );
    }
    // 枠ごとのキャラ絞り込みは画面の状態でしかないので、一緒に移して検索語を残さない。

    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    status.textContent = `デッキ ${source.id} を ${targets.map((id) => `デッキ ${id}`).join(' · ')} にコピーしました。`;
  };

  deckCopyOpen.addEventListener('click', () => {
    if (deckCopyPanel.hidden) {
      renderDeckCopy();
      deckCopyPanel.hidden = false;
      deckCopyOpen.setAttribute('aria-expanded', 'true');
    } else {
      closeDeckCopy();
    }
  });
  deckCopyCancel.addEventListener('click', closeDeckCopy);
  deckCopyApply.addEventListener('click', applyDeckCopy);

  // 直近の計算で出た「誰がこのバフを受けたか」。デッキ単位で持っておき、カードに載せる。
  // 計算前は空で、そのときは空の括弧で場所だけ取る。
  // 値と一緒に**何を計算した結果か** (編成 + 個別設定) を書いておく。編成やスペックを
  // 変えると対象が変わりうるので、署名が食い違えば前の値は使わない。
  const buffTargetsByDeck = new Map<number, { sig: string; rows: Record<string, BuffTargetRow[]> }>();

  const deckSignature = (deck: DeckState): string =>
    JSON.stringify([deck.squad, deck.characters]);

  // ── バフ対象の先読み ──────────────────────────────────────────────────
  // 誰が受けるかは実際の発動ログにしか出ない (対象は最終攻撃力で決まり、戦闘中に
  // 入れ替わることもある)。なので「計算」を押す前に**背景で一度だけ回して**埋めておく。
  // 結果は正式な計算と同じキャッシュに入るので、続けて «計算» を押しても余計に回らない。
  let cancelPrefetch: (() => void) | undefined;
  // 画面を外したか。**予約の取り消しだけでは足りない** — 700ms が過ぎて中に入ってしまうと、
  // clearTimeout では止まらず、await の後で もう無い画面に描きにいく (Codex の指摘)。
  let disposed = false;
  let prefetching = false;
  // 背景計算が回っているデッキ。その間、画面には `[計算中]` と出る。
  let prefetchingDeckId: number | undefined;

  const needsPrefetch = (deck: DeckState): boolean => {
    if (!deck.squad.some((name) => name && settings.buffTargetWatch?.[name])) return false;
    return buffTargetsByDeck.get(deck.id)?.sig !== deckSignature(deck);
  };

  const prefetchBuffTargets = () => {
    cancelPrefetch?.();
    cancelPrefetch = defer(() => { void (async () => {
      // 正式な計算が回っている最中はワーカーを奪わない — 終わればどのみち埋まる。
      if (prefetching || submit.disabled) return;
      const deck = activeDeck();
      if (!needsPrefetch(deck)) return;
      prefetching = true;
      prefetchingDeckId = deck.id;
      renderSquad();
      try {
        await prepared;
        if (disposed) return;
        const request = requestForDeck(deck, readBattle());
        if (validateRequest(request).length > 0) return;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          if (disposed) return;   // 計算の間に外されたら、保存も描画もしない
          cache.set(key, result);
        }
        // 待っている間に編成が変わっているかもしれない — 署名が合うときだけ反映する。
        const now = activeDeck();
        if (now.id !== deck.id || deckSignature(now) !== deckSignature(deck)) return;
        if (result.buffTargets) {
          buffTargetsByDeck.set(deck.id, { sig: deckSignature(deck), rows: result.buffTargets });
          saveState();
          renderSquad();
        }
      } catch {
        /* 先読みは «あると便利» なだけ — 失敗しても黙って通す */
      } finally {
        prefetching = false;
        prefetchingDeckId = undefined;
        // 外したあとに描くと、もう画面に無い要素を触る
        if (!disposed) renderSquad();
      }
    })(); }, 700);
  };


  /** このデッキで監視対象のバフを持つキャラの表示行。まだ回していなければ対象は空。 */
  const buffTargetRowsFor = (deckId: number, name: string): BuffTargetRow[] | undefined => {
    const deck = decks.find((d) => d.id === deckId);
    const saved = buffTargetsByDeck.get(deckId);
    const known = deck && saved && saved.sig === deckSignature(deck)
      ? saved.rows[name] : undefined;
    if (known) return known;
    const watched = settings.buffTargetWatch?.[name];
    if (!watched) return undefined;
    const pending = prefetchingDeckId === deckId;
    return watched.map((w) => ({ ...w, targets: [] as string[], count: 0, pending }));
  };

  // 「順番を見る」 — バフが発動するたびに誰が受けたかを立ち絵で横に並べる。
  // 対象が分かれる編成では、この順番そのものが情報になる (アリス-紅蓮-アリス-紅蓮…)。
  const buffOrderModal = element<HTMLElement>(root, '[data-buff-order-modal]');
  const showBuffOrder = (caster: string, row: BuffTargetRow) => {
    element<HTMLElement>(root, '[data-buff-order-title]').textContent =
      `${labelFor(caster)} · ${row.label}`;
    element<HTMLElement>(root, '[data-buff-order-desc]').textContent =
      row.targets.length > 1
        ? `${row.buff} — ${row.count}回発動。対象が ${row.targets.length}名の間で分かれます。`
        : `${row.buff} — ${row.count}回発動。戦闘中ずっと同じ対象です。`;
    const list = element<HTMLElement>(root, '[data-buff-order-list]');
    list.replaceChildren();
    for (const [index, step] of (row.sequence ?? []).entries()) {
      const item = document.createElement('div');
      item.className = 'buff-order-step';
      item.dataset.buffOrderStep = String(index);
      const meta = catalogByName.get(step.target);
      const shot = document.createElement('div');
      shot.className = 'buff-order-portrait';
      if (meta?.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${meta.image}`;
        img.alt = '';
        img.loading = 'lazy';
        shot.append(img);
      }
      item.append(shot);
      item.append(createText('strong', labelFor(step.target)));
      item.append(createText('span', `${step.t.toFixed(2)}秒`));
      list.append(item);
    }
    buffOrderModal.hidden = false;
  };
  element<HTMLButtonElement>(root, '[data-buff-order-close]').addEventListener('click', () => {
    buffOrderModal.hidden = true;
  });
  buffOrderModal.addEventListener('click', (event) => {
    if (event.target === buffOrderModal) buffOrderModal.hidden = true;
  });

  // ── キャラ設定の窓 ──────────────────────────────────────────────────────
  // どのキャラのどの塊を見ているかを覚える。値を変えるとカードが描き直され、
  // 塊も作り直されるので、そのたびに新しい塊を窓へ入れ直す。
  const charPanelModal = element<HTMLElement>(root, '[data-char-panel-modal]');
  const charPanelBody = element<HTMLElement>(root, '[data-char-panel-body]');
  const charPanelTitle = element<HTMLElement>(root, '[data-char-panel-title]');
  let openCharPanel: { name: string; kind: CharPanelKind } | null = null;

  const placeCharPanel = (panel: HTMLElement, name: string, label: string) => {
    panel.hidden = false;
    charPanelBody.replaceChildren(panel);
    charPanelTitle.textContent = `${labelFor(name)} · ${label}`;
    charPanelModal.hidden = false;
  };
  const closeCharPanel = () => {
    openCharPanel = null;
    charPanelBody.replaceChildren();
    charPanelModal.hidden = true;
  };
  element<HTMLButtonElement>(root, '[data-char-panel-close]').addEventListener('click', closeCharPanel);
  charPanelModal.addEventListener('click', (event) => {
    if (event.target === charPanelModal) closeCharPanel();
  });

  // ── 掴んで置く ─────────────────────────────────────────────────────────
  // 押す道 (枠を選んでカードを押す) はそのまま残し、«掴んで置く» を足す。
  // 指では HTML の掴みが効かないので、押す道が無くなってはいけない。
  const DRAG_NAME = 'application/x-nikke-name';   // 니케 고르기 → 칸
  const DRAG_SLOT = 'application/x-nikke-slot';   // 칸 → 칸 (자리 맞바꾸기)

  /** この掴みが自分たちのものか。`dragover` では値ではなく種類しか見られない。 */
  const dragKind = (event: DragEvent): 'name' | 'slot' | null => {
    const types = event.dataTransfer?.types;
    if (!types) return null;
    const has = (type: string) => Array.prototype.includes.call(types, type);
    if (has(DRAG_NAME)) return 'name';
    if (has(DRAG_SLOT)) return 'slot';
    return null;
  };

  /** 枠ひとつを «受け取れる場所» にする。 */
  const makeDropTarget = (card: HTMLElement, index: number) => {
    const lit = (on: boolean) => card.classList.toggle('is-drop', on);
    card.addEventListener('dragover', (event) => {
      const kind = dragKind(event as DragEvent);
      if (!kind) return;
      event.preventDefault();                  // 이걸 해야 놓을 수 있다
      (event as DragEvent).dataTransfer!.dropEffect = kind === 'slot' ? 'move' : 'copy';
      lit(true);
    });
    card.addEventListener('dragleave', () => lit(false));
    card.addEventListener('drop', (event) => {
      const drag = event as DragEvent;
      const kind = dragKind(drag);
      if (!kind) return;
      event.preventDefault();
      lit(false);
      const deck = activeDeck();
      if (kind === 'slot') {
        const from = Number(drag.dataTransfer!.getData(DRAG_SLOT));
        if (!Number.isInteger(from) || from < 0 || from > 4 || from === index) return;
        // 場所だけ入れ替える。個別設定は名前に紐づいているので枠とは無関係。
        [deck.squad[index], deck.squad[from]] = [deck.squad[from] ?? '', deck.squad[index] ?? ''];
        showErrors([]);
        saveState();
        renderDeckTabs();
        renderSquad();
        renderRosterGrid();
        return;
      }
      const name = drag.dataTransfer!.getData(DRAG_NAME);
      if (!name || !catalogByName.has(name)) return;
      // 1つのデッキに同じニケを二度は入れられない — 押す道で止めているのと同じ規則。
      const already = deck.squad.indexOf(name);
      if (already >= 0 && already !== index) {
        showErrors([`${labelFor(name)} はすでに枠 ${already + 1} にいます。`]);
        return;
      }
      pickCharacter(name, index);
    });
  };

  const renderSquad = () => {
    const deck = activeDeck();
      // バースト順は編成に紐づく — 編成が変わればバッジもついていく。
    renderBurstBadge();
    squadGrid.replaceChildren();
    for (let index = 0; index < 5; index += 1) {
      const name = deck.squad[index] ?? '';
      const char = catalogByName.get(name);
      const card = document.createElement('article');
      card.className = 'squad-slot';
      card.dataset.slotCard = String(index);
      card.classList.toggle('is-preview', Boolean(char?.preview));
      makeDropTarget(card, index);
      if (name) {
        // 埋まった枠は掴んで他の枠に置ける — ‹ › ボタンと同じ «場所の入れ替え» になる。
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          const drag = event as DragEvent;
          drag.dataTransfer?.setData(DRAG_SLOT, String(index));
          drag.dataTransfer?.setData('text/plain', name);
          if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'move';
          card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      }

      const top = document.createElement('div');
      top.className = 'slot-top';
      const portrait = document.createElement('div');
      portrait.className = 'portrait-wrap';
      // 枠番号と属性アイコンは左上に並ぶ。番号の幅が桁数で変わってもアイコンが重ならないよう、
      // 絶対配置ではなく1行にまとめる。
      const tags = document.createElement('div');
      tags.className = 'slot-tags';
      tags.append(createText('span', `0${index + 1}`, 'slot-number'));
      if (char) {
        const codeIcon = createElementIcon(char.elementCode, 'slot-code');
        if (codeIcon) tags.append(codeIcon);
      }
      portrait.append(tags, createText('div', '', 'portrait-fallback'));

      // 場所の移動。ニケは並び順が戦闘に影響するので、キャラを選び直さずに
      // 場所だけ入れ替えられる必要がある。名前に紐づく設定 (deck.characters) は枠と
      // 無関係なのでそのまま置き、枠に紐づく編成と検索語だけを入れ替える。
      const moves = document.createElement('div');
      moves.className = 'slot-moves';
      for (const [delta, label, title] of [
        [-1, '‹', '左へ'], [1, '›', '右へ'],
      ] as const) {
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'slot-move';
        move.dataset.slotMove = `${index}:${delta}`;
        move.textContent = label;
        move.title = `${title}移動`;
        move.ariaLabel = `枠 ${index + 1} を${title}移動`;
        const target = index + delta;
        move.disabled = target < 0 || target > 4;
        move.addEventListener('click', () => {
          [deck.squad[index], deck.squad[target]] = [deck.squad[target] ?? '', deck.squad[index] ?? ''];
          showErrors([]);
          saveState();
          renderDeckTabs();
          renderSquad();
        });
        moves.append(move);
      }
      portrait.append(moves);
      if (char?.image) {
        const image = document.createElement('img');
        image.src = `${import.meta.env.BASE_URL}${char.image}`;
        image.alt = `${labelFor(char.name)} のポートレート`;
        image.loading = 'lazy';
        portrait.append(image);
      }
      const identity = document.createElement('div');
      identity.className = 'slot-identity';

      // 名前検索とドロップダウン、入れ替えボタンを取り払った。カードは «いま埋める枠» を
      // 決める役だけを持ち、選ぶ仕事は下の常設の盤が持つ。検索結果がどこにも隠れないように
      // するのが、この画面の要点。
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'slot-choose';
      choose.dataset.slotChoose = String(index);
      choose.setAttribute('aria-pressed', String(activeSlot === index));
      choose.append(createText('strong', char ? labelFor(char.name) : '空き枠'));
      choose.append(createText(
        'span',
        char ? `B${char.burstStage} · ${elementLabel(char.elementCode)} · ${char.weaponType}` : '押してこの枠に入れる',
      ));
      choose.addEventListener('click', () => {
        activeSlot = index;
        pullActiveSlot = true;
        renderSquad();
        renderRosterGrid();
      });
      // 狭い画面では枠の行が横に押し出される。狙った枠が画面の外にあると
      // 盤がどこを埋めるのか分からないので、引き寄せて見せる。
      // jsdom には scrollIntoView が無い。無いからといって描画が壊れることではないので飛ばす。
      if (pullActiveSlot && activeSlot === index && typeof choose.scrollIntoView === 'function') {
        requestAnimationFrame(() => choose.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'slot-clear';
      clear.textContent = '✕';
      clear.title = `枠 ${index + 1} を空にする`;
      clear.ariaLabel = `枠 ${index + 1} を空にする`;
      clear.hidden = !name;
      clear.addEventListener('click', () => {
        if (name) delete deck.characters[name];
        deck.squad[index] = '';
        activeSlot = index;
        showErrors([]);
        saveState();
        renderDeckTabs();
        renderSquad();
        renderRosterGrid();
      });

      identity.append(choose, clear);
      top.append(portrait, identity);
      card.append(top);
      if (char) {
        const editor = document.createElement('div');
        const cname = char.name;
        /**
         * 窓の中の塊を、カードがいま描いた新しいものに差し替える。値を1つ変えると
         * `renderCharacterSettings` が自分でカードを描き直すが、そのとき窓には**古い塊**が
         * 残っていて、«個別設定» で入れたチェックが未だに掛かって見えていた。
         */
        const syncOpenPanel = () => {
          if (openCharPanel?.name !== cname || charPanelModal.hidden) return;
          const kind = openCharPanel.kind;
          // その塊を開くボタンが消えていたら (個別設定を切った) 窓も閉じる。
          const opener = editor.querySelector<HTMLElement>(`[data-char-panel-open="${kind}"]`);
          if (!opener) { closeCharPanel(); return; }
          // 無ければ、すでに窓にあるものが最新 — 二度呼ばれても閉じない。
          const fresh = editor.querySelector<HTMLElement>(`[data-char-panel="${kind}"]`);
          if (!fresh) return;
          placeCharPanel(fresh, cname, opener.querySelector('.disclosure-label')?.getAttribute('title') ?? '');
        };
        const renderEditor = () => {
          renderCharacterSettings(editor, cname, settings, deck.characters[cname], (next) => {
            if (next) deck.characters[cname] = next;
            else delete deck.characters[cname];
            saveState();
            // 個別設定の中のドロップダウンで突破を変えても、立ち絵の星がついていくようにする。
            renderGrowthStepper();
            // このコールバックはカードが描き直される**直前**に呼ばれる — 描き終えてから窓を合わせる。
            queueMicrotask(syncOpenPanel);
          }, buffTargetRowsFor(deck.id, cname), (row) => showBuffOrder(cname, row),
          (kind, panel, label) => {
            openCharPanel = { name: cname, kind };
            placeCharPanel(panel, cname, label);
          },
          // 組み合わせで決まる操作 (アイン + エイダ = ホールド) はカードが自分で判定する。
          deck.squad.filter((slot): slot is string => Boolean(slot)));
          syncOpenPanel();
        };

        // 立ち絵の右下にある突破・コア強化のステッパー。Blablalink の図鑑と同じく星 + 進化の数字で
        // 名刺〜フルコアを一目で見せ、左右の −/+ でそのまま動かす。個別設定を開かなくても
        // 手が届く場所。R (成長なし) は動かすものが無いので、そもそも描かない。
        const growthDefaults = settings.characters[cname];
        const maxStage = growthDefaults?.maxGrowthStage ?? 0;
        const defStage = growthDefaults?.growthStage ?? 0;
        const stepper = document.createElement('div');
        stepper.className = 'growth-stepper';
        stepper.dataset.growthStepper = String(index);
        const stars = document.createElement('div');
        stars.className = 'growth-stars';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'growth-step';
        minus.dataset.growthStep = 'minus';
        minus.textContent = '−';
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'growth-step';
        plus.dataset.growthStep = 'plus';
        plus.textContent = '+';
        const stageOf = (): number => deck.characters[cname]?.growthStage ?? defStage;
        const labelOf = (stage: number): string => {
          const found = growthDefaults?.growthOptions.find((option) => option.value === stage)?.label;
          return found ? growthLabel(found) : `段階 ${stage}`;
        };
        function renderGrowthStepper(): void {
          const stage = stageOf();
          const slots = Math.min(maxStage, 3);
          const core = Math.max(0, stage - 3);
          stars.replaceChildren();
          for (let i = 0; i < slots; i += 1) {
            // 星の絵は Blablalink の図鑑のスプライト (25コマ) をそのまま使う — CSS で
            // 埋まった星/空の星のコマを background-position で選ぶ。
            const star = document.createElement('span');
            star.className = i < Math.min(stage, 3) ? 'growth-star is-on' : 'growth-star';
            stars.append(star);
          }
          // 進化バッジは図鑑と同じく 0 のときも場所を取る — 出たり消えたりすると
          // 星の行の幅が揺れてカードが跳ねる。
          const badge = document.createElement('span');
          badge.className = 'growth-core';
          badge.append(createText('span', String(core)));
          stars.append(badge);
          minus.disabled = stage <= 0;
          plus.disabled = stage >= maxStage;
          const text = labelOf(stage);
          minus.ariaLabel = `${labelFor(cname)} の限界突破を1段階下げる (現在 ${text})`;
          plus.ariaLabel = `${labelFor(cname)} の限界突破を1段階上げる (現在 ${text})`;
          stepper.title = `限界突破・コア強化 · ${text}`;
        }
        const setStage = (next: number) => {
          const clamped = Math.max(0, Math.min(maxStage, next));
          if (clamped === stageOf()) return;
          const base = deck.characters[cname];
          const override = base ? cloneOverride(base) : {};
          if (clamped === defStage) delete override.growthStage;
          else override.growthStage = clamped;
          if (Object.keys(override).length === 0) delete deck.characters[cname];
          else deck.characters[cname] = override;
          saveState();
          renderGrowthStepper();
          renderEditor();
        };
        minus.addEventListener('click', () => setStage(stageOf() - 1));
        plus.addEventListener('click', () => setStage(stageOf() + 1));
        if (maxStage > 0) {
          stepper.append(minus, stars, plus);
          renderGrowthStepper();
          portrait.append(stepper);
        }

        renderEditor();
        card.append(editor);
      }
      squadGrid.append(card);
    }
    pullActiveSlot = false;
    // 編成・個別設定・デッキの切り替えは全部この関数を通る — 先読みの予約はここ1箇所。
    prefetchBuffTargets();
  };

  // ── コンソール ────────────────────────────────────────────────────────────
  // クラス・企業は所属ごとに別に育つ。一覧はカタログが正本なので (ロスターから抜く)
  // 新しい企業やクラスが増えてもコードはそのまま。
  //
  // 作った入力は Map で持って読み書きする — 所属名がそのまま入るセレクタを使うと
  // エスケープ (`CSS.escape`) に頼ることになり、その API が無い環境で丸ごと壊れる。
  const CONSOLE_DEFAULTS = { common: 180, class: 100, company: 100 } as const;
  const consoleInputs: Record<'class' | 'company', Map<string, HTMLInputElement>> = {
    class: new Map(),
    company: new Map(),
  };
  let consoleCommon!: HTMLInputElement;

  const consoleBuckets = (axis: 'class' | 'company'): string[] =>
    axis === 'class' ? settings.consoleClasses : settings.consoleCompanies;

  const renderConsole = () => {
    const grid = element<HTMLElement>(root, '[data-console-grid]');
    grid.replaceChildren();
    consoleInputs.class.clear();
    consoleInputs.company.clear();

    const field = (label: string, value: number): [HTMLLabelElement, HTMLInputElement] => {
      const wrap = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '1000';
      input.step = '1';
      input.value = String(value);
      wrap.append(text, input);
      return [wrap, input];
    };
    const group = (title: string, nodes: HTMLElement[]) => {
      const box = document.createElement('div');
      box.className = 'console-group';
      box.append(createText('h4', title), ...nodes);
      return box;
    };

    const [commonWrap, commonInput] = field('全体', CONSOLE_DEFAULTS.common);
    commonInput.id = 'console-common';
    consoleCommon = commonInput;

    const axisGroup = (axis: 'class' | 'company', title: string) => group(
      title,
      consoleBuckets(axis).map((bucket) => {
        // 表示は日本語、dataset と読み書きのキーは韓国語の内部キーのまま。
        const shown = axis === 'class' ? labelForClass(bucket) : labelForMaker(bucket);
        const [wrap, input] = field(shown, CONSOLE_DEFAULTS[axis]);
        input.dataset.consoleBucket = `${axis}:${bucket}`;
        consoleInputs[axis].set(bucket, input);
        return wrap;
      }),
    );

    grid.append(
      // ゲーム内・Blablalink と同じ順 — 共通 → 企業 → クラス。
      group('共通', [commonWrap]),
      axisGroup('company', '企業'),
      axisGroup('class', 'クラス'),
    );
  };
  renderConsole();

  const readConsoleBuckets = (axis: 'class' | 'company'): Record<string, number> =>
    Object.fromEntries([...consoleInputs[axis]].map(([bucket, input]) => [bucket, Number(input.value)]));

  const writeConsoleBuckets = (axis: 'class' | 'company', levels: Record<string, number>) => {
    for (const [bucket, input] of consoleInputs[axis]) {
      const level = levels[bucket];
      if (level !== undefined) input.value = String(level);
    }
  };

  // ── 適正距離 ────────────────────────────────────────────────────────────
  // 武器種ごとに敵との適正な射程が違うので、同じ戦闘でもある武器種は適正距離に
  // 入り、ある武器種は入れない → 複数を同時に入れられる必要がある。
  // 一覧の正本は `data/weapon_mechanics.json` (設定として降りてくる)。コンソールと同じ理由で
  // セレクタではなく Map で持って読み書きする。
  const rangeInputs = new Map<string, HTMLInputElement>();

  const renderOptimalRange = () => {
    const box = element<HTMLElement>(root, '[data-optimal-range]');
    box.replaceChildren();
    rangeInputs.clear();
    // 適正距離を持たない武器種 (ランチャー) はそもそも描かない — 入れられる状態にすると
    // ゲーム内に無い補正を入れることになる。一覧の正本は武器データ。
    for (const weapon of settings.optimalRangeWeapons ?? settings.weaponTypes) {
      const label = document.createElement('label');
      label.className = 'range-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.optimalRangeWeapon = weapon;
      label.append(input, createText('span', weapon));
      box.append(label);
      rangeInputs.set(weapon, input);
    }
  };
  renderOptimalRange();

  // ── 通常攻撃の係数 ───────────────────────────────────────────────────────
  // シミュレータは撃った弾が全部当たる前提だが、ゲーム内では弾のばらつきで外れる。武器種ごとに
  // ばらつきが違うので武器種単位で受け取り、既定値は設定 (データ) から降りてくる。
  const coeffInputs = new Map<string, HTMLInputElement>();

  const renderHitCoeff = () => {
    const box = element<HTMLElement>(root, '[data-hit-coeff]');
    box.replaceChildren();
    coeffInputs.clear();
    for (const weapon of settings.weaponTypes) {
      const label = document.createElement('label');
      label.className = 'coeff-option';
      label.append(createText('span', weapon));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '2';
      input.step = '0.01';
      input.dataset.hitCoeffWeapon = weapon;
      input.value = String(settings.normalHitCoeff?.[weapon] ?? 1);
      label.append(input);
      box.append(label);
      coeffInputs.set(weapon, input);
    }
  };
  renderHitCoeff();

  const readHitCoeff = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [weapon, input] of coeffInputs) out[weapon] = Number(input.value);
    return out;
  };

  const writeHitCoeff = (values: Record<string, number> | undefined) => {
    for (const [weapon, input] of coeffInputs) {
      const v = values?.[weapon] ?? settings.normalHitCoeff?.[weapon] ?? 1;
      input.value = String(v);
    }
  };

  // ── ボスのフェーズ (足止め・速攻) ───────────────────────────────────────
  // 区間は数が決まっていないので入力を先に作っておけない — 配列を正本として
  // 持ち、描くたびに作り直す。入力が間違っていても (開始>終了) 消さずにそのまま
  // 置き、実行するときに検証の文言で伝える。
  let immuneWindows: PhaseWindow[] = [];
  let elementWindows: ElementWindow[] = [];

  const renderPhases = () => {
    const list = element<HTMLElement>(root, '[data-phase-list]');
    list.replaceChildren();

    const numberField = (value: number, onInput: (v: number) => void) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '180';
      input.step = '0.1';
      input.value = String(value);
      input.addEventListener('input', () => onInput(Number(input.value)));
      return input;
    };

    const row = (kind: 'immune' | 'element', index: number, from: number, to: number) => {
      const box = document.createElement('div');
      box.className = `phase-row is-${kind}`;
      box.dataset.phaseRow = `${kind}:${index}`;
      box.append(createText('span', kind === 'immune' ? '回避区間' : '属性制限', 'phase-tag'));
      box.append(numberField(from, (v) => {
        if (kind === 'immune') immuneWindows[index]!.from = v;
        else elementWindows[index]!.from = v;
        saveState();
      }));
      box.append(createText('span', '~', 'phase-sep'));
      box.append(numberField(to, (v) => {
        if (kind === 'immune') immuneWindows[index]!.to = v;
        else elementWindows[index]!.to = v;
        saveState();
      }));
      box.append(createText('span', '秒', 'phase-sep'));
      return box;
    };

    immuneWindows.forEach((w, index) => {
      const box = row('immune', index, w.from, w.to);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'phase-drop';
      drop.dataset.phaseDrop = `immune:${index}`;
      drop.textContent = '✕';
      drop.ariaLabel = `回避区間 ${index + 1} を削除`;
      drop.addEventListener('click', () => {
        immuneWindows.splice(index, 1);
        saveState();
        renderPhases();
      });
      box.append(drop);
      list.append(box);
    });

    elementWindows.forEach((w, index) => {
      const box = row('element', index, w.from, w.to);
      const code = document.createElement('select');
      code.dataset.phaseCode = String(index);
      for (const value of ['풍압', '수냉', '작열', '전격', '철갑']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = elementLabel(value);
        code.append(option);
      }
      code.value = w.code || '풍압';
      code.addEventListener('change', () => {
        elementWindows[index]!.code = code.value as ElementWindow['code'];
        saveState();
      });
      box.append(code);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'phase-drop';
      drop.dataset.phaseDrop = `element:${index}`;
      drop.textContent = '✕';
      drop.ariaLabel = `属性制限 ${index + 1} を削除`;
      drop.addEventListener('click', () => {
        elementWindows.splice(index, 1);
        saveState();
        renderPhases();
      });
      box.append(drop);
      list.append(box);
    });
  };

  for (const kind of ['immune', 'element'] as const) {
    element<HTMLButtonElement>(root, `[data-phase-add="${kind}"]`).addEventListener('click', () => {
      // 最後の区間の後ろを既定値にして、重ならない区間を継ぎ足しやすくする。
      const all = [...immuneWindows, ...elementWindows];
      const start = all.length > 0 ? Math.max(...all.map((w) => w.to)) : 0;
      const from = Math.min(start, 178);
      if (kind === 'immune') immuneWindows.push({ from, to: Math.min(from + 2, 180) });
      else elementWindows.push({ from, to: Math.min(from + 2, 180), code: '풍압' });
      saveState();
      renderPhases();
    });
  }

  const advancedBattle = element<HTMLButtonElement>(root, '[data-advanced-battle]');
  const advancedBattlePanel = element<HTMLElement>(root, '[data-advanced-battle-panel]');
  advancedBattle.addEventListener('click', () => {
    const next = advancedBattle.getAttribute('aria-expanded') !== 'true';
    advancedBattle.setAttribute('aria-expanded', String(next));
    advancedBattlePanel.hidden = !next;
    const hint = advancedBattle.querySelector('.disclosure-hint');
    if (hint) hint.textContent = next ? '折りたたむ' : '展開';
  });

  const readOptimalRange = (): string[] =>
    [...rangeInputs].filter(([, input]) => input.checked).map(([weapon]) => weapon);

  const writeOptimalRange = (weapons: string[]) => {
    const on = new Set(weapons);
    for (const [weapon, input] of rangeInputs) input.checked = on.has(weapon);
  };

  // ── デッキごとに違うバーストゲージの充填 ──────────────────────────────────
  // バーストのクールが遅れるデッキがあり、1つにまとめるとそのデッキだけずっと外れる。既定は一括で、
  // 入れたときだけ5枠が出る — 入れた瞬間に今の値で5つを埋めるので «入れたら値が
  // 消えた» が起きない。
  const deckRegenBox = element<HTMLElement>(root, '[data-deck-regen]');
  const deckRegenToggle = element<HTMLInputElement>(root, '#burst-regen-per-deck');
  const readDeckRegen = (): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const input of deckRegenBox.querySelectorAll<HTMLInputElement>('[data-deck-regen-input]')) {
      out[Number(input.dataset.deckRegenInput)] = Number(input.value);
    }
    return out;
  };
  const renderDeckRegen = (values: Record<number, number>) => {
    deckRegenBox.replaceChildren();
    for (let id = 1; id <= 5; id += 1) {
      const label = document.createElement('label');
      label.append(createText('span', `デッキ ${id}`));
      const wrap = document.createElement('div');
      wrap.className = 'input-unit';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '20';
      input.step = '0.1';
      input.value = String(values[id] ?? 2);
      input.dataset.deckRegenInput = String(id);
      wrap.append(input, createText('em', '秒'));
      label.append(wrap);
      deckRegenBox.append(label);
    }
  };
  const writeDeckRegen = (values: Record<number, number> | undefined, fallback: number) => {
    const on = values !== undefined && Object.keys(values).length > 0;
    deckRegenToggle.checked = on;
    deckRegenBox.hidden = !on;
    renderDeckRegen(values ?? { 1: fallback, 2: fallback, 3: fallback, 4: fallback, 5: fallback });
  };
  deckRegenToggle.addEventListener('change', () => {
    if (deckRegenToggle.checked) {
      const now = Number(element<HTMLInputElement>(root, '#burst-regen').value);
      renderDeckRegen({ 1: now, 2: now, 3: now, 4: now, 5: now });
    }
    deckRegenBox.hidden = !deckRegenToggle.checked;
    saveState();
    refreshBattleSummary();
  });

  const readBattle = (): BattleSettings => ({
    duration: Number(element<HTMLInputElement>(root, '#duration').value),
    synchroLevel: Number(element<HTMLInputElement>(root, '#synchro-level').value),
    enemyDef: Number(element<HTMLInputElement>(root, '#enemy-def').value),
    enemyCode: element<HTMLSelectElement>(root, '#enemy-code').value as BattleSettings['enemyCode'],
    coreEnabled: coreToggle.checked,
    corePx: Number(corePxInput.value),
    hasParts: element<HTMLInputElement>(root, '#has-parts').checked,
    seed: Number(element<HTMLInputElement>(root, '#seed').value),
    optimalRangeWeapons: readOptimalRange(),
    // 配列は画面ではなくこの変数が正本 — 入力が間違っていても消さずに
    // そのまま載せ、実行時に検証の文言で伝える。
    immuneWindows: immuneWindows.map((w) => ({ ...w })),
    elementWindows: elementWindows.map((w) => ({ ...w })),
    rngMode: element<HTMLSelectElement>(root, '#rng-mode').value as RngMode,
    immuneBlocksBurst: element<HTMLInputElement>(root, '#immune-blocks-burst').checked,
    normalHitCoeff: readHitCoeff(),
    burstRegenTime: Number(element<HTMLInputElement>(root, '#burst-regen').value),
    ...(element<HTMLInputElement>(root, '#burst-regen-per-deck').checked
      ? { burstRegenPerDeck: readDeckRegen() } : {}),
    burstReaction: Number(element<HTMLInputElement>(root, '#burst-reaction').value),
    console: {
      common_level: Number(consoleCommon.value),
      class_level: readConsoleBuckets('class'),
      company_level: readConsoleBuckets('company'),
    },
  });

  const writeBattle = (battle: BattleSettings) => {
    element<HTMLInputElement>(root, '#duration').value = String(battle.duration);
    // シンクロレベルが無かった頃に保存された設定を戻すことがある — 既定値で埋める。
    element<HTMLInputElement>(root, '#synchro-level').value =
      String(battle.synchroLevel ?? DEFAULT_SYNCHRO_LEVEL);
    element<HTMLInputElement>(root, '#enemy-def').value = String(battle.enemyDef);
    element<HTMLSelectElement>(root, '#enemy-code').value = battle.enemyCode;
    coreToggle.checked = battle.coreEnabled;
    corePxInput.value = String(battle.corePx);
    corePxInput.disabled = !battle.coreEnabled;
    element<HTMLInputElement>(root, '#has-parts').checked = battle.hasParts;
    element<HTMLInputElement>(root, '#seed').value = String(battle.seed);
    writeOptimalRange(battle.optimalRangeWeapons ?? []);
    immuneWindows = (battle.immuneWindows ?? []).map((w) => ({ ...w }));
    elementWindows = (battle.elementWindows ?? []).map((w) => ({ ...w }));
    renderPhases();
    element<HTMLSelectElement>(root, '#rng-mode').value = battle.rngMode ?? 'expected';
    element<HTMLInputElement>(root, '#immune-blocks-burst').checked = Boolean(battle.immuneBlocksBurst);
    writeHitCoeff(battle.normalHitCoeff);
    if (battle.burstRegenTime !== undefined) {
      element<HTMLInputElement>(root, '#burst-regen').value = String(battle.burstRegenTime);
    }
    // この項目ができる前に保存された設定には無い — 既定値で埋める。
    element<HTMLInputElement>(root, '#burst-reaction').value =
      String(battle.burstReaction ?? DEFAULT_BURST_REACTION);
    writeDeckRegen(battle.burstRegenPerDeck, battle.burstRegenTime);
    if (battle.console) {
      consoleCommon.value = String(battle.console.common_level);
      writeConsoleBuckets('class', battle.console.class_level);
      writeConsoleBuckets('company', battle.console.company_level);
    }
    // 条件が窓に入って以降、画面に残る表示は要約の1行だけになった。プログラムが値を
    // 書き込むときは change が出ないのでその行が更新されず、「敵の数値を初期化」と
    // 「受け取ったコードを適用」が何もしていないように見えていた。書く場所で一緒に連れて行く。
    refreshBattleSummary();
  };

  // ── 戦闘条件の折りたたみ ────────────────────────────────────────────────
  // 条件は一度決めたらずっと使う値なので畳んでおき、畳んだままでも «何で測っているか» を
  // 1行残す。要約の文言は共有の一覧に使うのと同じ関数を使う。
  const battleOpen = element<HTMLButtonElement>(root, '[data-battle-open]');
  const battleModal = element<HTMLElement>(root, '[data-battle-modal]');
  const battleSummary = element<HTMLElement>(root, '[data-battle-summary]');
  const battleFirstNote = element<HTMLElement>(root, '[data-battle-first-note]');
  const refreshBattleSummary = () => {
    battleSummary.textContent = summarizeBattle(readBattle());
  };
  /** 初回計算の前の強調。一度でも開いたか計算を回したなら、もう引き止めない。 */
  const settleBattleNote = () => { battleFirstNote.hidden = true; };
  const setBattleOpen = (open: boolean) => {
    battleOpen.setAttribute('aria-expanded', String(open));
    battleModal.hidden = !open;
    refreshBattleSummary();
    if (open) settleBattleNote();
  };
  battleOpen.addEventListener('click', () => { setBattleOpen(true); });
  element<HTMLButtonElement>(root, '[data-battle-modal-close]')
    .addEventListener('click', () => setBattleOpen(false));
  battleModal.addEventListener('click', (event) => {
    if (event.target === battleModal) setBattleOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !battleModal.hidden) setBattleOpen(false);
  });

  const validateCharacterValues = (deck: DeckState): string[] => {
    const messages: string[] = [];
    for (const [name, custom] of Object.entries(deck.characters)) {
      const characterDefaults = settings.characters[name];
      if (custom.growthStage !== undefined && (
        !Number.isInteger(custom.growthStage)
        || custom.growthStage < 0
        || custom.growthStage > (characterDefaults?.maxGrowthStage ?? -1)
      )) {
        messages.push(
          `デッキ ${deck.id} · ${labelFor(name)}: 限界突破段階は 0~${characterDefaults?.maxGrowthStage ?? 0} の整数である必要があります。`,
        );
      }
      if (custom.skillLevels) {
        const keys = Object.keys(custom.skillLevels);
        const hasExactKeys = keys.length === 3
          && keys.every((key) => key === '1' || key === '2' || key === '3');
        const values = Object.values(custom.skillLevels);
        if (!hasExactKeys || values.some((value) => !Number.isInteger(value) || value < 1 || value > 10)) {
          messages.push(`デッキ ${deck.id} · ${labelFor(name)}: スキルレベルは 1~10 の整数である必要があります。`);
        } else if (characterDefaults?.skillLevelsLocked
          && values.some((value) => value !== 10)) {
          messages.push(`デッキ ${deck.id} · ${labelFor(name)}: 数値未公開のキャラクターはスキル Lv10 のみ使用できます。`);
        }
      }
      for (const [key, value] of Object.entries(custom.overload ?? {})) {
        const meta = settings.overloadFields[key];
        if (!meta || !Number.isFinite(value) || value < meta.min || value > meta.max) {
          messages.push(`デッキ ${deck.id} · ${labelFor(name)}: ${meta?.label ?? key} の値が許容範囲を外れています。`);
        }
      }
      // 「着けていない」(NO_CUBE・レベル0) は正当な状態。カタログに無いキューブとして弾かない
      const noCube = custom.cube?.name === NO_CUBE;
      if (custom.cube && !noCube && (!settings.cubes[custom.cube.name] || !Number.isInteger(custom.cube.level)
        || custom.cube.level < 1 || custom.cube.level > 15)) {
        messages.push(`デッキ ${deck.id} · ${labelFor(name)}: キューブ設定を確認してください。`);
      }
      if (custom.weaponModeSwapAt !== undefined && (
        !Number.isFinite(custom.weaponModeSwapAt)
        || custom.weaponModeSwapAt < 0
        || custom.weaponModeSwapAt > 180
      )) {
        messages.push(`デッキ ${deck.id} · ${labelFor(name)}: 狙撃モード切り替え時点は 0~180秒である必要があります。`);
      }
      for (const [key, value] of Object.entries(custom.manualStats ?? {})) {
        const meta = settings.manualStats[key];
        if (!meta || !Number.isFinite(value) || value < meta.min || value > meta.max) {
          messages.push(`デッキ ${deck.id} · ${labelFor(name)}: ${meta?.label ?? key} の値が許容範囲を外れています。`);
        }
      }
    }
    return messages;
  };

  // ── 詳しく見る ─────────────────────────────────────────────────────────
  // 入れた状態はこのブラウザに残る — 一度入れた人はいつもその目で見る。
  const DETAIL_KEY = 'nikke-detail-damage-v1';
  /** 直前に描いた結果。バースト順序の «実際の周回数» を読むのに使う。 */
  let lastBatch: BatchResult | null = null;
  let detailDamage = false;
  try {
    detailDamage = resolveStorage()?.getItem(DETAIL_KEY) === '1';
  } catch { /* 저장된 값을 못 읽으면 줄여 쓰기(기본)로 간다 */ }

  /**
   * 「詳しく見る」 — 結果のダメージを丸めずに1の位まで書く。
   *
   * 2つのデッキが「1.24億」と同じに見えて、実際には数十万の差があることがある。
   * 入れた状態はこのブラウザに残る。タイムラインの目盛りと報告画像は場所が狭いので
   * いつも丸めて書く — ここで変わるのは結果パネルだけ。
   */
  const dmg = (value: number): string =>
    (detailDamage ? formatExactDamage(value) : formatDamage(value));
  const dps = (value: number): string =>
    (detailDamage ? formatExactDps(value) : formatDps(value));

  const renderBatchResult = (batch: BatchResult) => {
    // 一度でも回したなら «まず条件を見て» の強調は下がる。
    settleBattleNote();
    // 受け手は実際の発動ログから来る — 結果が入ってこないとカードに埋められない。
    let touchedActiveDeck = false;
    for (const entry of batch.decks) {
      const targets = entry.result.buffTargets;
      const deck = decks.find((d) => d.id === entry.deckId);
      if (!targets || !deck) continue;
      buffTargetsByDeck.set(entry.deckId, { sig: deckSignature(deck), rows: targets });
      if (entry.deckId === activeDeckId) touchedActiveDeck = true;
    }
    if (touchedActiveDeck) { saveState(); renderSquad(); }

    resultPanel.replaceChildren();
    const duration = batch.decks[0]?.result.duration ?? 1;
    const header = document.createElement('div');
    header.className = 'result-header';
    const copy = document.createElement('div');
    copy.append(createText('h2', batch.decks.length > 1 ? '5デッキ戦闘結果' : '戦闘結果'));
    const summary = document.createElement('div');
    summary.className = 'total-block';
    const total = createText('strong', dmg(batch.total));
    total.dataset.resultTotal = '';
    total.dataset.batchTotal = '';
    summary.append(createText('span', batch.decks.length > 1 ? '全デッキ総ダメージ' : 'スカッド総ダメージ'), total, createText('small', dps(batch.total / duration)));
    header.append(copy, summary);
    resultPanel.append(header);

    // 詳しく見る — 「1.24億」ではなく1の位まで。ダウンロードせずにその場で見る。
    const detailLabel = document.createElement('label');
    detailLabel.className = 'inline-check detail-toggle';
    const detailBox = document.createElement('input');
    detailBox.type = 'checkbox';
    detailBox.dataset.detailDamage = '';
    detailBox.checked = detailDamage;
    detailLabel.title = 'ダメージを省略せず1の位まで表示します';
    detailBox.addEventListener('change', () => {
      detailDamage = detailBox.checked;
      try {
        resolveStorage()?.setItem(DETAIL_KEY, detailDamage ? '1' : '0');
      } catch { /* 저장 실패는 무시한다 — 이번 판만 못 기억할 뿐이다 */ }
      renderBatchResult(batch);
    });
    detailLabel.append(detailBox, createText('span', '詳細表示'));
    const resultTools = document.createElement('div');
    resultTools.className = 'report-tools';
    resultTools.append(detailLabel);
    resultPanel.append(resultTools);

    // デッキの順位 — ダメージの降順で «何位か» だけを出す。並べる順は最後までデッキ番号のまま。
    const ordered = [...batch.decks].sort((a, b) => b.result.squadTotal - a.result.squadTotal);
    const ranking = new Map(ordered.map((entry, index) => [entry.deckId, index + 1]));
    const best = ordered[0]?.result.squadTotal ?? 0;
    const portraitOf = (name: string): string | undefined => {
      const image = catalogByName.get(name)?.image;
      return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
    };

    /** デッキ1つの中身。キャラカードと事実の行、離脱の一覧。 */
    const renderDeckDetail = (host: HTMLElement, entry: DeckResultEntry) => {
      host.replaceChildren();
      const section = document.createElement('section');
      section.className = 'deck-result';
      section.dataset.deckResult = String(entry.deckId);
      const deckHeader = document.createElement('div');
      deckHeader.className = 'deck-result-header';
      deckHeader.append(
        createText('h3', `デッキ ${entry.deckId}`),
        createText('strong', dmg(entry.result.squadTotal)),
        createText('small', dps(entry.result.squadTotal / entry.result.duration)),
      );
      section.append(deckHeader);
      if (ranking.size > 1) {
        const rank = ranking.get(entry.deckId)!;
        const gap = best > 0 ? (entry.result.squadTotal / best - 1) * 100 : 0;
        const badge = createText(
          'p',
          rank === 1
            ? '1位 · 基準'
            : `${rank}位 · 1位比 ${gap.toFixed(1)}% (${dmg(entry.result.squadTotal - best)})`,
          'deck-rank',
        );
        badge.dataset.deckRank = String(rank);
        if (rank === 1) badge.classList.add('is-best');
        section.append(badge);
      }
      if (entry.result.previewNote) section.append(createText('p', entry.result.previewNote, 'preview-warning'));
      // デッキを切り替えながら見るときは行が短くて比べやすい。1デッキだけ見るときはカードが編成と
      // 位置が揃って良い — 画面の目的が違うので形も違う。
      const fmt: DamageFormat = { dmg, dps };
      if (batch.decks.length > 1) renderCharacterRows(section, entry, portraitOf, fmt);
      else renderCharacterCards(section, entry, portraitOf, fmt);
      const facts = document.createElement('div');
      facts.className = 'result-facts';
      facts.append(
        createText('span', `${entry.result.duration}秒の戦闘`),
        createText('span', `${entry.result.hitCount.toLocaleString('ja-JP')} ヒット`),
        createText('span', `シード ${entry.request.seed}`),
      );
      section.append(facts, createText('pre', entry.result.deviations, 'deviations'));
      host.append(section);
    };

    const detail = document.createElement('div');
    detail.className = 'deck-detail';
    if (batch.decks.length > 1) {
      // デッキごとにタブ1つ。**デッキ番号の順そのまま**に左から右へ並べ、ダメージ1・2位は
      // 位置を動かさずバッジだけで示す。選んだデッキだけを下に詳しく開く。
      const tabs = document.createElement('div');
      tabs.className = 'deck-result-tabs';
      tabs.dataset.deckResultTabs = '';
      const buttons = new Map<number, HTMLButtonElement>();
      const show = (entry: DeckResultEntry) => {
        for (const [id, button] of buttons) {
          button.classList.toggle('is-on', id === entry.deckId);
          button.setAttribute('aria-pressed', String(id === entry.deckId));
        }
        renderDeckDetail(detail, entry);
      };
      for (const entry of batch.decks) {
        const rank = ranking.get(entry.deckId)!;
        const tab = document.createElement('button');
        tab.type = 'button';
        // 順位は5デッキ全部に書き、1・2位だけ色で強調する。位置はデッキ番号順のまま。
        tab.className = 'deck-result-tab'
          + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
        tab.dataset.deckResultTab = String(entry.deckId);
        tab.dataset.deckRank = String(rank);
        const head = document.createElement('b');
        head.append(document.createTextNode(`デッキ ${entry.deckId}`));
        head.append(createText('em', `${rank}位`, 'deck-tab-rank'));
        // デッキ同士を見比べる場所なので、丸めずに完全な数字を書く — «1.14億» では
        // 2位との差が読めない。
        tab.append(head, createText('span', Math.round(entry.result.squadTotal).toLocaleString('ja-JP')));
        tab.addEventListener('click', () => show(entry));
        buttons.set(entry.deckId, tab);
        tabs.append(tab);
      }
      resultPanel.append(tabs);
      show(batch.decks[0]!);
    } else if (batch.decks[0]) {
      renderDeckDetail(detail, batch.decks[0]);
    }
    resultPanel.append(detail);

    // タイムラインも一度に1つだけ見る — 5つを縦に積むと、どのデッキを見ているのか
    // スクロール中に見失う。タブは結果と同じく**デッキ番号の順そのまま**に並ぶ。
    timelineBody.replaceChildren();
    const blocks = new Map<number, HTMLElement>();
    for (const entry of batch.decks) {
      // バーストのピンに使う立ち絵。キャンバスが直接描くので URL だけ渡す。
      const portraitUrls: Record<string, string> = {};
      for (const name of entry.request.squad) {
        const image = catalogByName.get(name)?.image;
        if (image) portraitUrls[name] = `${import.meta.env.BASE_URL}${image}`;
      }
      const timelineBlock = createTimelineBlock(entry, portraitUrls);
      if (timelineBlock) blocks.set(entry.deckId, timelineBlock);
    }
    if (blocks.size > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'deck-result-tabs timeline-tabs';
      tabs.dataset.timelineTabs = '';
      const stage = document.createElement('div');
      stage.dataset.timelineStage = '';
      const buttons = new Map<number, HTMLButtonElement>();
      const show = (deckId: number) => {
        for (const [id, button] of buttons) {
          button.classList.toggle('is-on', id === deckId);
          button.setAttribute('aria-pressed', String(id === deckId));
        }
        stage.replaceChildren(blocks.get(deckId)!);
      };
      for (const deckId of blocks.keys()) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'deck-result-tab';
        tab.dataset.timelineTab = String(deckId);
        tab.append(createText('b', `デッキ ${deckId}`));
        tab.addEventListener('click', () => show(deckId));
        buttons.set(deckId, tab);
        tabs.append(tab);
      }
      timelineBody.append(tabs, stage);
      show([...blocks.keys()][0]!);
    } else {
      for (const block of blocks.values()) timelineBody.append(block);
    }
    timelineHasContent = blocks.size > 0;
    timelinePanel.hidden = !timelineHasContent || currentView !== 'calc';
  };

  // ── バースト順 ─────────────────────────────────────────────────────────
  /** この画面だけで使う要素づくり。union-raid の同名の助けと対になっている。 */

  // サイクルごとに段階別で誰を使うかを手で決める。窓を使う理由は**キーボードを
  // 丸ごと持っていくから** — タブの中に置くと A・S・D・F・G が検索欄とぶつかる。
  const burstModal = element<HTMLElement>(root, '[data-burst-order-modal]');
  const burstOpenButton = element<HTMLButtonElement>(root, '[data-burst-order-open]');
  const burstBadge = element<HTMLElement>(root, '[data-burst-order-badge]');
  const burstNow = element<HTMLElement>(root, '[data-burst-now]');
  const burstPicksBox = element<HTMLElement>(root, '[data-burst-picks]');
  const burstList = element<HTMLElement>(root, '[data-burst-list]');
  const burstProgress = element<HTMLElement>(root, '[data-burst-progress]');
  const burstCyclesOut = element<HTMLOutputElement>(root, '[data-burst-cycles]');
  const burstCyclesNote = element<HTMLElement>(root, '[data-burst-cycles-note]');
  const burstMsg = element<HTMLElement>(root, '[data-burst-order-msg]');

  /** 窓が開いている間の作業用の写し。「この順で置く」を押さないとデッキに残らない。 */
  let burstPicks: Record<string, string> = {};
  let burstCycles = 1;
  let burstAt = 0;          // 지금 서 있는 걸음
  let burstSteps: BurstStep[] = [];

  const showBurstMsg = (message: string, ok = false) => {
    burstMsg.hidden = message === '';
    burstMsg.textContent = message;
    burstMsg.classList.toggle('is-ok', ok);
  };

  /** 「バーストを使わない」と決めた人。候補から外す。 */
  const burstSkipped = (deck: DeckState): Set<string> => new Set(
    Object.entries(deck.characters)
      .filter(([, value]) => value.burst?.mode === 'skip')
      .map(([name]) => name),
  );

  const burstCandidates = (stage: BurstStage): string[] => {
    const deck = activeDeck();
    return candidatesFor(stage, {
      squad: deck.squad,
      metaOf: (name) => catalogByName.get(name),
      skipped: burstSkipped(deck),
    });
  };

  /** デッキの道具の行のボタンに「9サイクル」のように書いておく — 開かなくても掛かっているか見える。 */
  function renderBurstBadge(): void {
    const kept = sequenceForDeck(activeDeck());
    burstBadge.hidden = kept === null;
    burstBadge.textContent = kept ? `${kept.length}` : '';
    // 順を掛けておくとボタン自体が色を変える — 開いてみなくても掛かっているのが見える。
    burstOpenButton.classList.toggle('is-on', kept !== null);
  }

  /** まだ選んでいない最初の枠へ移る。窓を開き直すと、やっていた場所から続く。 */
  const firstUnpicked = (): number => {
    const at = burstSteps.findIndex((step) => !burstPicks[stepKey(step)]);
    return at >= 0 ? at : Math.max(0, burstSteps.length - 1);
  };

  function renderBurstOrder(): void {
    burstSteps = stepsFor(burstCycles);
    burstAt = Math.min(Math.max(0, burstAt), Math.max(0, burstSteps.length - 1));
    burstCyclesOut.textContent = String(burstCycles);

    const { done, total } = progressOf(burstPicks, burstSteps);
    burstProgress.textContent = `${done} / ${total}枠`;

    // ── いまの歩み ──
    burstNow.replaceChildren();
    burstPicksBox.replaceChildren();
    const step = burstSteps[burstAt];
    if (!step) {
      burstNow.append(el('p', 'burst-empty', 'サイクルを1つ以上置いてください。'));
    } else {
      const head = el('div', 'burst-now-head');
      head.append(
        el('span', 'burst-now-cycle', `${step.cycle}回目のフルバースト`),
        el('span', `burst-now-stage stage-${step.stage}`, `${step.stage}バ`),
      );
      const picked = burstPicks[stepKey(step)];
      head.append(el('span', 'burst-now-pick', picked ? `→ ${labelFor(picked)}` : '→ 自動'));
      burstNow.append(head);

      const candidates = burstCandidates(step.stage);
      if (candidates.length === 0) {
        burstPicksBox.append(el('p', 'burst-empty',
          `編成に ${step.stage}バがいません。この段階はスキップします。`));
      }
      candidates.forEach((name, index) => {
        const button = el('button', 'burst-pick' + (picked === name ? ' is-on' : ''));
        (button as HTMLButtonElement).type = 'button';
        const key = HOTKEYS[index];
        const face = document.createElement('div');
        face.className = 'burst-pick-face';
        const image = catalogByName.get(name)?.image;
        if (image) {
          const img = document.createElement('img');
          img.src = `${import.meta.env.BASE_URL}${image}`;
          img.alt = '';
          img.loading = 'lazy';
          face.append(img);
        } else {
          face.textContent = labelFor(name).slice(0, 2);
        }
        button.append(face, el('span', 'burst-pick-name', labelFor(name)));
        if (key) button.append(el('b', 'burst-pick-key', key));
        button.addEventListener('click', () => pickBurst(name));
        burstPicksBox.append(button);
      });
      // 「この段階は自動で」 — 選んだものを取り消す場所。
      const auto = el('button', 'burst-pick is-auto' + (picked ? '' : ' is-on'));
      (auto as HTMLButtonElement).type = 'button';
      auto.append(el('span', 'burst-pick-name', '自動'));
      auto.append(el('b', 'burst-pick-key', '0'));
      auto.addEventListener('click', () => pickBurst(null));
      burstPicksBox.append(auto);
    }

    // ── 書いておいたもの ──
    // サイクルごとに**空の枠が3つ**あり、選ぶたびに立ち絵が埋まる。文字列で書くと
    // 27ある枠のどこまで来たのかが読めない — 空の枠が残っているのが見えないといけない。
    burstList.replaceChildren();
    const sequence = sequenceFrom(burstPicks, burstCycles);
    sequence.forEach((cycle, index) => {
      const cycleNo = index + 1;
      const row = el('div', 'burst-row' + (burstSteps[burstAt]?.cycle === cycleNo ? ' is-now' : ''));
      row.title = cycleLine(cycle);
      row.append(el('span', 'burst-row-no', `${cycleNo}`));

      const slots = el('div', 'burst-row-slots');
      for (const stage of BURST_STAGES) {
        const name = (cycle[stage] ?? [])[0];
        const here = burstSteps[burstAt]?.cycle === cycleNo && burstSteps[burstAt]?.stage === stage;
        const slot = el('button', 'burst-slot'
          + (name ? ' is-filled' : '') + (here ? ' is-here' : ''));
        (slot as HTMLButtonElement).type = 'button';
        slot.append(el('span', `burst-slot-stage stage-${stage}`, `${stage}バ`));

        const face = el('span', 'burst-slot-face');
        if (name) {
          const image = catalogByName.get(name)?.image;
          if (image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${image}`;
            img.alt = labelFor(name);
            img.loading = 'lazy';
            face.append(img);
          } else {
            face.textContent = labelFor(name).slice(0, 2);
          }
          slot.title = `${cycleNo}回目 ${stage}バ — ${labelFor(name)}`;
        } else {
          slot.title = `${cycleNo}回目 ${stage}バ — 未設定(自動)`;
        }
        slot.append(face);
        slot.addEventListener('click', () => {
          const at = burstSteps.findIndex((s) => s.cycle === cycleNo && s.stage === stage);
          if (at >= 0) burstAt = at;
          renderBurstOrder();
        });
        slots.append(slot);
      }
      row.append(slots);
      burstList.append(row);
    });
  }

  /** 1枠選んで次へ。`null` ならその枠を自動に戻す。 */
  function pickBurst(name: string | null): void {
    const step = burstSteps[burstAt];
    if (!step) return;
    if (name === null) delete burstPicks[stepKey(step)];
    else burstPicks[stepKey(step)] = name;
    if (burstAt < burstSteps.length - 1) burstAt += 1;
    showBurstMsg('');
    renderBurstOrder();
  }

  function openBurstOrder(): void {
    const deck = activeDeck();
    if (!deck.squad.some((name) => name.trim())) {
      showErrors(['バースト順序を決めるには先に編成を埋めてください。']);
      return;
    }
    const kept = sequenceForDeck(deck);
    burstPicks = picksFrom(kept ?? undefined);
    // サイクル数: 書いておいたものがあればその数、無ければ前回の計算の**実際の回数**、
    // それも無ければ戦闘時間から見積もる。
    const measured = cyclesFromTimeline(
      lastBatch?.decks.find((entry) => entry.deckId === deck.id)?.result.timeline);
    burstCycles = kept?.length ?? measured ?? estimateCycles(readBattle().duration);
    burstCyclesNote.textContent = kept
      ? '保存してあった順序を読み込みました。'
      : (measured !== null
        ? `前回の計算ではフルバーストが ${measured}回回りました。`
        : `戦闘 ${readBattle().duration}秒から概算した値です。一度計算すると実際の回数に合わせられます。`);
    burstSteps = stepsFor(burstCycles);
    burstAt = firstUnpicked();
    showBurstMsg('');
    renderBurstOrder();
    burstModal.hidden = false;
  }

  const closeBurstOrder = () => { burstModal.hidden = true; };

  burstOpenButton.addEventListener('click', openBurstOrder);
  element<HTMLButtonElement>(root, '[data-burst-order-close]').addEventListener('click', closeBurstOrder);
  burstModal.addEventListener('click', (event) => {
    if (event.target === burstModal) closeBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-cycles-up]').addEventListener('click', () => {
    burstCycles = Math.min(MAX_CYCLES, burstCycles + 1);
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-cycles-down]').addEventListener('click', () => {
    burstCycles = Math.max(1, burstCycles - 1);
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-order-reset]').addEventListener('click', () => {
    burstPicks = {};
    burstAt = 0;
    showBurstMsg('');
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-order-save]').addEventListener('click', () => {
    const deck = activeDeck();
    const sequence = trimSequence(sequenceFrom(burstPicks, burstCycles));
    if (sequence) deck.burstSequence = sequence;
    else delete deck.burstSequence;
    saveState();
    renderBurstBadge();
    closeBurstOrder();
    showErrors([]);
  });
  element<HTMLButtonElement>(root, '[data-burst-order-clear]').addEventListener('click', () => {
    delete activeDeck().burstSequence;
    burstPicks = {};
    burstAt = 0;
    saveState();
    renderBurstBadge();
    renderBurstOrder();
    showBurstMsg('順序を消しました。計算機が通常の順序で選びます。', true);
  });

  // キーボードは窓が開いているときだけ持っていく。修飾キーが押された入力はブラウザのもの。
  document.addEventListener('keydown', (event) => {
    if (burstModal.hidden) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { closeBurstOrder(); return; }
    if (event.key === 'ArrowLeft') {
      burstAt = Math.max(0, burstAt - 1);
      renderBurstOrder();
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight') {
      burstAt = Math.min(Math.max(0, burstSteps.length - 1), burstAt + 1);
      renderBurstOrder();
      event.preventDefault();
      return;
    }
    if (event.key === '0') { pickBurst(null); event.preventDefault(); return; }
    const at = HOTKEYS.indexOf(event.key.toUpperCase() as typeof HOTKEYS[number]);
    if (at < 0) return;
    const step = burstSteps[burstAt];
    if (!step) return;
    const name = burstCandidates(step.stage)[at];
    if (!name) return;
    pickBurst(name);
    event.preventDefault();
  });

  element<HTMLButtonElement>(root, '[data-deck-clear]').addEventListener('click', () => {
    const deck = activeDeck();
    deck.squad = ['', '', '', '', ''];
    deck.characters = {};
    activeSlot = 0;
    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
  });

  element<HTMLInputElement>(root, '#squad-mode').addEventListener('change', (event) => {
    fiveDeckMode = (event.currentTarget as HTMLInputElement).checked;
    // 5デッキを切ると «いま見ていたデッキ» が1デッキの場所に来る — 2〜5デッキのどれか1つだけを計算しようとして
    // 切ることが多いのに、そのたびに編成を手で移すのは面倒 (利用者の声)。
    if (!fiveDeckMode && activeDeckId !== 1) {
      const picked = decks.find((deck) => deck.id === activeDeckId);
      const first = decks[0]!;
      if (picked) {
        [first.squad, picked.squad] = [picked.squad, first.squad];
        [first.characters, picked.characters] = [picked.characters, first.characters];
      }
    }
    activeDeckId = 1;
    deckTabs.hidden = !fiveDeckMode;
    deckMoves.hidden = !fiveDeckMode;
    deckNote.hidden = !fiveDeckMode;
    deckCopy.hidden = !fiveDeckMode;
    closeDeckCopy();
    saveState();
    renderDeckTabs();
    renderSquad();
    showErrors([]);
  });
  coreToggle.addEventListener('change', () => {
    corePxInput.disabled = !coreToggle.checked;
  });
  // 戦闘条件の入力が変わったら保存する。
  form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.settings-panel')) { saveState(); refreshBattleSummary(); }
  });
  element<HTMLButtonElement>(root, '[data-reset-enemy]').addEventListener('click', () => {
    writeBattle(resetEnemy(readBattle()));
    saveState();
    showErrors([]);
  });
  // ニケを選ぶ盤。窓ではなく編成のすぐ下にいつも開いていて、検索はこの盤を絞る。
  const rosterGrid = element<HTMLElement>(root, '[data-roster-grid]');
  const rosterSearch = element<HTMLInputElement>(root, '[data-roster-search]');
  const rosterEmpty = element<HTMLElement>(root, '[data-roster-empty]');
  const rosterCount = element<HTMLElement>(root, '[data-roster-count]');
  const rosterDesc = element<HTMLElement>(root, '[data-roster-desc]');
  // 絞り込みは**同じ組の中では OR、組と組の間では AND**。武器の SG・SMG を両方入れると
  // どちらかなら通り、そこにクラスの火力型を足すと «火力型でありながら SG か SMG» になる。
  // ゲーム内の図鑑がこの方式なので馴染みがあり、1つだけ選ぶよりずっと速く絞れる。
  type FilterKey = 'burst' | 'rarity' | 'class' | 'code' | 'weapon' | 'corp';
  const picked: Record<FilterKey, Set<string>> = {
    burst: new Set(), rarity: new Set(), class: new Set(),
    code: new Set(), weapon: new Set(), corp: new Set(),
  };
  type SortKey = 'power' | 'name' | 'element' | 'elementAtk';
  // 最初に見える順は戦闘力の高い順 — 一覧で先に探すのは «自分が育てたニケ» なので、
  // 五十音順に並べると毎回スクロールして探すことになる。
  const DEFAULT_SORT: SortKey = 'power';
  let sortKey: SortKey = DEFAULT_SORT;
  // 同じ項目をもう一度押すと逆になる。項目ごとに «自然な» 向きが違うので
  // (名前は五十音順、数値は高い順)、最初に選ぶときはその向きにする。
  let sortDesc = true;

  // ── 並べ替え・絞り込みの盤 ──────────────────────────────────────────────
  // 並べ替えは «自分のロスターでこのキャラがどれだけ回されたか» を見る。オーバーロードの数値が
  // その物差しなので、CSV・プロフィールで読み込んだ自分の値があればそれを使い、無ければ既定スペックを使う。
  const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
    { key: 'power', label: '戦闘力', hint: 'ゲーム内の戦闘力 — もう一度押すと逆順になります' },
    { key: 'name', label: '名前', hint: '五十音順 — もう一度押すと逆順になります' },
    { key: 'element', label: '有利コード', hint: 'オーバーロードの有利コードダメージ — もう一度押すと逆順になります' },
    { key: 'elementAtk', label: '有利+攻撃', hint: '有利コード + 攻撃力増加の合計 — もう一度押すと逆順になります' },
  ];

  /** 最初に選ぶときの向き。名前は昇順、数値は高い順が自然。 */
  const defaultDesc = (key: SortKey): boolean => key !== 'name';

  /** このキャラに実際に効くオーバーロード — 自分のロスターの値が優先。 */
  const overloadOf = (name: string): Record<string, number> =>
    roster[name]?.overload ?? settings.characters[name]?.overload ?? {};

  // 戦闘力はエンジンが基本ステータスまで計算しないと出ない — ワーカーを一度回して受け取っておく。
  // ロスターを変えると値が変わるので、署名が食い違えば取り直す。
  let combatPower: Record<string, number> = {};
  let powerSig = '';
  let powerLoading = false;

  // 取込の直後にもう一度呼ばれることがある。走っている間に来た依頼を捨てると、
  // 古いロスターで測った戦闘力が残り続けるので、終わってから追いかけて測り直す。
  let powerAgain = false;
  const loadCombatPower = async () => {
    if (!client.combatPower) return;
    if (powerLoading) { powerAgain = true; return; }
    const sig = JSON.stringify(roster);
    if (powerLoading || powerSig === sig) return;
    powerLoading = true;
    try {
      await prepared;
      const got = await client.combatPower({
        names: catalog.map((meta) => meta.name),
        characters: roster,
      });
      combatPower = got;
      renderMyRoster();   // 戦闘力は後から届く — 届いたら一覧と並べ替えに反映する
      powerSig = sig;
      renderFilterState();
      renderRosterGrid();
    } catch {
      /* 戦闘力は並べ替えの «あると便利» なだけ — 失敗しても一覧はそのまま使う */
    } finally {
      powerLoading = false;
    }
    if (powerAgain) { powerAgain = false; await loadCombatPower(); }
  };

  /** バーストだけが盤の外にある — 値はここに置き、描く場所だけが違う。 */
  const BURST_VALUES = ['1', '2', '3', 'A'];
  const FILTER_GROUPS: Array<{ key: FilterKey; title: string; values: string[] }> = [
    { key: 'rarity', title: 'レアリティ', values: ['SSR', 'SR', 'R'] },
    { key: 'class', title: 'クラス', values: ['화력형', '방어형', '지원형'] },
    { key: 'code', title: 'コード', values: ['작열', '수냉', '풍압', '전격', '철갑'] },
    { key: 'weapon', title: '武器', values: ['AR', 'SMG', 'SG', 'SR', 'RL', 'MG'] },
    { key: 'corp', title: '企業', values: ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'] },
  ];

  // 値 (dataset・照合キー) は韓国語の内部キーのまま。チップに出す文字だけ日本語にする。
  const labelOf = (key: FilterKey, value: string) => {
    if (key === 'burst') return `B${value}`;
    if (key === 'class') return labelForClass(value);
    if (key === 'code') return elementLabel(value);
    if (key === 'corp') return labelForMaker(value);
    return value;
  };

  /** 選んだ絞り込みの数。0 ならバッジを隠す。 */
  const pickedCount = (): number =>
    Object.values(picked).reduce((sum, set) => sum + set.size, 0);

  function sortRoster(list: CharacterMeta[]): void {
    const byName = (a: CharacterMeta, b: CharacterMeta) => labelFor(a.name).localeCompare(labelFor(b.name), 'ja');
    const flip = sortDesc ? -1 : 1;
    if (sortKey === 'name') { list.sort((a, b) => flip * byName(a, b)); return; }
    const scoreOf = (char: CharacterMeta): number => {
      if (sortKey === 'power') return combatPower[char.name] ?? 0;
      const over = overloadOf(char.name);
      const element = over.element_bonus ?? 0;
      return sortKey === 'element' ? element : element + (over.atk_pct ?? 0);
    };
    // 同じ値の中ではいつも名前順 — 並べ替えの向きを変えても、同点同士が揺れない。
    list.sort((a, b) => flip * (scoreOf(a) - scoreOf(b)) || byName(a, b));
  }

  const filterPanel = element<HTMLElement>(root, '[data-filter-panel]');
  const filterOpen = element<HTMLButtonElement>(root, '[data-filter-open]');
  const filterBadge = element<HTMLElement>(root, '[data-filter-badge]');
  const filterReset = element<HTMLButtonElement>(root, '[data-filter-reset]');
  const filterSummary = element<HTMLElement>(root, '[data-filter-summary]');

  const renderFilterState = () => {
    const count = pickedCount();
    filterBadge.hidden = count === 0;
    filterBadge.textContent = String(count);
    filterReset.hidden = count === 0;
    // 盤を畳んでも何が掛かっているか分かるように要約を残す。
    // 並べ替えはいつも書いてある — 既定が戦闘力順なので、書いておかないと «なぜ五十音順
    // ではないのか» を盤を開かないと分からない。
    const parts: string[] = [];
    const label = SORTS.find((s) => s.key === sortKey)?.label;
    const pending = sortKey === 'power' && Object.keys(combatPower).length === 0;
    parts.push(`${label}${pending ? ' 計算中' : sortDesc ? ' ▼' : ' ▲'}`);
    for (const key of ['burst', ...FILTER_GROUPS.map((group) => group.key)] as FilterKey[]) {
      const set = picked[key];
      if (set.size > 0) {
        parts.push([...set].map((value) => labelOf(key, value)).join('·'));
      }
    }
    filterSummary.textContent = parts.join(' · ');
  };

  /** 絞り込みのチップ1つ。同じチップをもう一度押すと切れる — 「全体」チップを別に置かなくて済む。 */
  const filterChip = (key: FilterKey, value: string): HTMLButtonElement => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const on = picked[key].has(value);
    chip.className = 'filter-chip' + (on ? ' is-on' : '');
    chip.dataset.filterChip = `${key}:${value}`;
    chip.setAttribute('aria-pressed', String(on));
    chip.textContent = labelOf(key, value);
    chip.addEventListener('click', () => {
      if (on) picked[key].delete(value);
      else picked[key].add(value);
      renderFilterPanel();
      renderFilterState();
      renderRosterGrid();
    });
    return chip;
  };

  const renderFilterPanel = () => {
    const burstBox = element<HTMLElement>(root, '[data-burst-group]');
    burstBox.replaceChildren(...BURST_VALUES.map((value) => filterChip('burst', value)));

    const sortBox = element<HTMLElement>(root, '[data-sort-group]');
    sortBox.replaceChildren();
    for (const option of SORTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = sortKey === option.key;
      chip.className = 'filter-chip' + (active ? ' is-on' : '');
      chip.dataset.sort = option.key;
      chip.dataset.sortDir = active ? (sortDesc ? 'desc' : 'asc') : '';
      chip.append(createText('span', option.label));
      // 三角で向きを知らせる — 入っている項目にだけ付く。
      if (active) chip.append(createText('b', sortDesc ? '▼' : '▲', 'sort-caret'));
      chip.title = option.hint;
      chip.addEventListener('click', () => {
        // 同じ項目をもう一度押すと逆になり、違う項目ならその項目の既定の向きになる。
        if (active) sortDesc = !sortDesc;
        else { sortKey = option.key; sortDesc = defaultDesc(option.key); }
        // 戦闘力は重いので選んだときに受け取る。届くまでは名前順で並んでいる。
        if (sortKey === 'power') void loadCombatPower();
        renderFilterPanel();
        renderFilterState();
        renderRosterGrid();
      });
      sortBox.append(chip);
    }

    const box = element<HTMLElement>(root, '[data-filter-groups]');
    box.replaceChildren();
    for (const group of FILTER_GROUPS) {
      const section = document.createElement('div');
      section.className = 'filter-section';
      section.append(createText('p', group.title, 'filter-title'));
      const chips = document.createElement('div');
      chips.className = 'filter-chips';
      chips.append(...group.values.map((value) => filterChip(group.key, value)));
      section.append(chips);
      box.append(section);
    }
  };

  const setFilterPanel = (open: boolean) => {
    filterOpen.setAttribute('aria-expanded', String(open));
    filterPanel.hidden = !open;
  };
  filterOpen.addEventListener('click', () => {
    setFilterPanel(filterOpen.getAttribute('aria-expanded') !== 'true');
  });
  // 一覧の上に載る盤なのでドロップダウンと同じ規則に従う — 外を押すか
  // Esc で閉じる。盤の中と、盤を開く行 («絞り込みを消す» を含む) は «外» ではない。
  const pickerBar = element<HTMLElement>(root, '.picker-bar');
  document.addEventListener('pointerdown', (event) => {
    if (filterPanel.hidden) return;
    const target = event.target as Node | null;
    if (target && (filterPanel.contains(target) || pickerBar.contains(target))) return;
    setFilterPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !filterPanel.hidden) setFilterPanel(false);
  });
  filterReset.addEventListener('click', () => {
    for (const set of Object.values(picked)) set.clear();
    sortKey = DEFAULT_SORT;
    sortDesc = defaultDesc(DEFAULT_SORT);
    renderFilterPanel();
    renderFilterState();
    renderRosterGrid();
  });

  const renderRosterGrid = () => {
    // 自分で足したニケまで含め、いま選べる全部を見せる。
    const all = [...catalogByName.values()].sort((a, b) => labelFor(a.name).localeCompare(labelFor(b.name), 'ja'));
    const narrowed = all.filter((char) => {
      const meta = settings.characters[char.name];
      const hit = (key: FilterKey, value: string | undefined) =>
        picked[key].size === 0 || (value !== undefined && picked[key].has(value));
      return hit('burst', char.burstStage)
        && hit('rarity', meta?.rarity)
        && hit('class', char.className)
        && hit('code', char.elementCode)
        && hit('weapon', char.weaponType)
        && hit('corp', char.manufacturer);
    });
    sortRoster(narrowed);
    // チップで先に絞り、検索語で並べる。検索は頭文字と区切りまで受けるので
    // 「ｸﾗｳﾝ」・「ラピレド」が引っかかり、打った名前が先頭に来る。
    const shown = filterByQuery(narrowed, rosterSearch.value, buildIndex);
    rosterCount.textContent = shown.length === all.length
      ? `${all.length}名` : `${shown.length} / ${all.length}名`;
    const deck = activeDeck();
    rosterGrid.replaceChildren();
    for (const char of shown) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'roster-cell';
      cell.dataset.rosterCell = char.name;
      // 既にこのデッキに居るなら重ねて編成できないので、押せないままにする。
      const takenAt = deck.squad.indexOf(char.name);
      if (takenAt >= 0 && takenAt !== activeSlot) {
        cell.disabled = true;
        cell.classList.add('is-taken');
        cell.title = `すでにデッキ ${deck.id} の枠 ${takenAt + 1} にいます`;
      }
      const portrait = document.createElement('div');
      portrait.className = 'roster-portrait';
      if (char.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${char.image}`;
        img.alt = '';
        img.loading = 'lazy';
        portrait.append(img);
      }
      const badge = document.createElement('span');
      badge.className = 'roster-burst';
      badge.textContent = `B${char.burstStage}`;
      portrait.append(badge);
      // バースト段階の向かい (右上) に属性アイコン。
      const codeIcon = createElementIcon(char.elementCode, 'roster-code');
      if (codeIcon) portrait.append(codeIcon);
      if (char.preview) {
        // (暫定) — スキルが未公開で、こちらで作った値で回るキャラ。選ぶ前に見えないといけない。
        const temp = createText('i', '仮', 'roster-temp');
        temp.title = 'スキルが公開されていないため、仮に作成した値で計算します';
        portrait.append(temp);
      }
      cell.append(
        portrait,
        createText('strong', char.preview ? `${labelFor(char.name)} (仮)` : labelFor(char.name)),
        createText('span', [elementLabel(char.elementCode), char.weaponType, labelForClass(char.className)].filter(Boolean).join(' · ')),
      );
      cell.addEventListener('click', () => pickCharacter(char.name));
      // 掴んで枠に置くこともできる。既にこのデッキに居るニケは押せないので掴めもしない。
      if (!cell.disabled) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (event) => {
          const drag = event as DragEvent;
          drag.dataTransfer?.setData(DRAG_NAME, char.name);
          drag.dataTransfer?.setData('text/plain', char.name);
          if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'copy';
          cell.classList.add('is-dragging');
        });
        cell.addEventListener('dragend', () => cell.classList.remove('is-dragging'));
      }
      rosterGrid.append(cell);
    }
    rosterEmpty.hidden = shown.length > 0;
    updatePickerTarget();
  };

  /**
   * 他のデッキに残っているそのキャラの個別設定。いま見ているデッキは除き、
   * 一番近いデッキから探す — さっき触ったデッキの値が一番それらしいから。
   */
  const settingsFromOtherDeck = (name: string): CharacterOverrides | undefined => {
    const others = [...decks].sort((a, b) =>
      Math.abs(a.id - activeDeckId) - Math.abs(b.id - activeDeckId));
    for (const other of others) {
      if (other.id === activeDeckId) continue;
      const found = other.characters[name];
      if (found) return cloneOverride(found);
    }
    return undefined;
  };

  const carryToggle = element<HTMLInputElement>(root, '#carry-settings');
  carryToggle.addEventListener('change', () => {
    carryOverSettings = carryToggle.checked;
    saveState();
  });

  const pickCharacter = (name: string, targetSlot = activeSlot) => {
    const deck = activeDeck();
    const slot = Math.max(0, Math.min(4, targetSlot));
    const previous = deck.squad[slot] ?? '';
    deck.squad[slot] = name;
    if (previous && previous !== name) delete deck.characters[previous];
    if (!deck.characters[name]) {
      // 他のデッキで既に触った設定があればそれを持ってくる。無ければ CSV・プロフィールで
      // 読み込んだ自分のロスターの値を使う。デッキを移すたびに同じ数値を入れ直すのが
      // 一番多かった不便 — 切れば昔どおりデッキごとに独立する。
      const borrowed = carryOverSettings ? settingsFromOtherDeck(name) : undefined;
      if (borrowed) deck.characters[name] = borrowed;
      else if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
    }
    // 続けて埋められるように次の空き枠へ移る。全部埋まっていれば、いま入れた枠に留まる。
    const next = deck.squad.findIndex((member) => !member);
    activeSlot = next < 0 ? slot : next;
    pullActiveSlot = true;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    // (暫定) のキャラは入れた瞬間に伝える — 結果まで行ってから分かるのでは遅い。
    if (catalogByName.get(name)?.preview) {
      status.textContent = `${labelFor(name)} はまだ(仮)登録です — スキルが公開されていないため、`
        + '仮に作成した値で計算します。実際の性能とは無関係なので参考程度にご覧ください。';
    }
  };

  /** 盤がどの枠を狙っているかを知らせる。窓が無いので、この1行が唯一の案内。 */
  const updatePickerTarget = () => {
    const deck = activeDeck();
    const filled = deck.squad.filter(Boolean).length;
    const current = deck.squad[activeSlot];
    rosterDesc.textContent = current
      ? `枠 ${activeSlot + 1} を ${labelFor(current)} の代わりに埋めます · ${filled}/5名`
      : `空き枠 ${activeSlot + 1} を埋めます · ${filled}/5名`;
  };

  // 畳んだ状態で始める — 何で測るのかの1行は最初から書いてある必要がある。
  refreshBattleSummary();
  renderFilterPanel();
  renderFilterState();
  rosterSearch.addEventListener('input', renderRosterGrid);

  // 完全初期化 — このブラウザに溜まった保存状態を全部捨てる。メモリ上の変数まで
  // 1つずつ戻す代わりに、保存を空にしてページを開き直し、初めて訪れたのと
  // 同じ状態であることを保証する。
  const resetModal = element<HTMLElement>(root, '[data-reset-modal]');
  const closeResetModal = () => { resetModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-reset-all]').addEventListener('click', () => {
    resetModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-reset-close]').addEventListener('click', closeResetModal);
  element<HTMLButtonElement>(root, '[data-reset-cancel]').addEventListener('click', closeResetModal);
  resetModal.addEventListener('click', (event) => {
    if (event.target === resetModal) closeResetModal();
  });
  element<HTMLButtonElement>(root, '[data-reset-confirm]').addEventListener('click', () => {
    cache.clear();
    const store = resolveStorage();
    // 消す範囲は storage-keys.ts が正本。**もう無い機能の鍵も消す** —
    // 機能を消したときに残ると、初期化したつもりで端末に残り続ける。
    for (const key of ALL_KEYS) {
      try {
        store?.removeItem(key);
      } catch {
        // 保存が使えないブラウザでも、残りの初期化は続ける。
      }
    }
    closeResetModal();
    (reload ?? (() => window.location.reload()))();
  });

  element<HTMLButtonElement>(root, '[data-clear-cache]').addEventListener('click', () => {
    cache.clear();
    showErrors([]);
    status.textContent = '保存された結果を消しました。再実行すると計算し直します。';
  });
  // 起動時: まだ設定を持たないキャラだけロスターの値で埋める。
  // 保存済みのデッキ設定は「その人がこの計算機で決めたこと」なので上書きしない。
  // 育成状況の描き直し。取込のたびに呼ぶ (中身は下で差し込む)。
  let renderMyRoster: () => void = () => undefined;
  let renderPlans: () => void = () => undefined;
  let renderBoard: () => void = () => undefined;
  let renderBoardSync: () => void = () => undefined;
  // 今回のボスの登録は準備表 (renderPlans) が描くが、計算機タブのプリセット釦にも効く。
  // 名前を変えたら両方を描き直す。
  let renderBossPresets: () => void = () => undefined;
  let renderPrepSync: () => void = () => undefined;
  /**
   * ニケを選ぶ盤。盤面ブロックが中身を入れる。
   * レイド準備の編成モーダルも**同じものを使う** — 選び方が2つあると、
   * «使用中» の出方や並び順が画面ごとに違うことになる。
   */
  /** ピッカーの検索語・絞り込みを白紙にする。状態は盤面ブロックが持つので前方宣言。 */
  let resetPickerFilters: () => void = () => undefined;
  let renderPicker: (opts: {
    squad: readonly string[];
    onChange: (squad: string[]) => void;
    blocked?: (name: string) => string | null;
    wanted: string | null;
    redraw: () => void;
    mark: string;
  }) => HTMLElement = () => document.createElement('div');
  // 盤面はボードのブロックの中で持っている。端末間の持ち運びで読み書きするための窓口。
  let readBoard: () => unknown = () => null;
  let writeBoardFrom: (raw: unknown) => void = () => undefined;
  let readPlans: () => unknown = () => null;
  let writePlansFrom: (raw: unknown) => void = () => undefined;
  // 盤面の STEP 1 (取り込み) を開く。育成状況の空状態からも呼ぶ。
  let openBoardImport: () => void = () => undefined;

  const applyRosterToDecks = () => {
    for (const deck of decks) {
      for (const member of deck.squad) {
        if (member && roster[member] && !deck.characters[member]) {
          deck.characters[member] = cloneOverride(roster[member]!);
        }
      }
    }
  };

  // 取込 (CSV / Blablalink) 直後: 編成中のキャラへ**新しい育成値だけ**配る。
  // 速射・バースト運用などの操作設定は残す (規則は roster-merge.ts)。
  // 起動時の applyRosterToDecks と分けてあるのは、リロードのたびに手で直した値が
  // 巻き戻ると困るため — 上書きしてよいのは「取り込み直した」その瞬間だけ。
  const refreshDecksFromRoster = (names: readonly string[]): number =>
    applyImportedRoster(roster, decks, names).length;
  // 取込の記録 (いつ・どこから・何名)。ワンボタン更新はここに残したアドレスを使う。
  const syncBox = element<HTMLElement>(root, '[data-sync-box]');
  const syncWhen = element<HTMLElement>(root, '[data-sync-when]');
  const syncAgain = element<HTMLButtonElement>(root, '[data-sync-again]');
  let syncMeta: SyncMeta | null = loadSyncMeta(resolveStorage());
  // 覚えているアドレスで取り込み直す関数。プロキシが無い版では差し込まれないので null のまま。
  let reSync: ((preset: { url: string; area?: number }) => Promise<void>) | null = null;

  const renderSyncBox = () => {
    const summary = syncSummary(syncMeta);
    syncBox.hidden = !summary;
    syncWhen.textContent = summary ? `最終取込 ${summary}` : '';
    // CSV はファイルを選び直す必要があるので、ボタンは出さない
    syncAgain.hidden = !(canReSync(syncMeta) && reSync);
    renderBoardSync();
    // レイド準備の帯も同じ情報を出している — 片方だけ更新すると食い違う
    renderPrepSync();
  };

  const rememberSync = (meta: SyncMeta) => {
    syncMeta = meta;
    saveSyncMeta(resolveStorage(), meta);
    renderSyncBox();
    renderMyRoster();
    renderBoard();   // 育成値が変わったので、盤面の点数も読み直す
  };

  // 取得は一度にひとつ。モーダルの「同期」と画面の「今の育成を取り込む」は別の入口だが、
  // 並行して走らせるとロスターと記録を遅い方が上書きしてしまうので、フラグを共有する。
  const SYNC_AGAIN_LABEL = '今の育成を取り込む';
  let syncInFlight = false;
  const setSyncBusy = (busy: boolean) => {
    syncInFlight = busy;
    syncAgain.disabled = busy;
    syncAgain.textContent = busy ? '取り込み中…' : SYNC_AGAIN_LABEL;
    renderBoardSync();
  };

  syncAgain.addEventListener('click', () => {
    if (syncInFlight || !canReSync(syncMeta) || !reSync) return;
    updateRosterNote('Blablalink から取り込み中…');
    void reSync({ url: syncMeta.profileUrl, ...(syncMeta.area === undefined ? {} : { area: syncMeta.area }) });
  });

  const updateRosterNote = (message?: string) => {
    const count = Object.keys(roster).length;
    if (message) rosterNote.textContent = message;
    else if (count > 0) rosterNote.textContent = `CSV ロスター ${count}名を適用中`;
    rosterNote.hidden = !message && count === 0;
  };
  // 取込の入口は2つある (計算機タブと3凸ボードの STEP 1)。処理は1つに保つ —
  // 片方だけ直して挙動がずれるのを避けたい。
  const importRosterCsv = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { overrides, matched, unmatched } = parseRosterCsv(text, settings);
      if (matched.length === 0) {
        updateRosterNote('CSV に対応キャラクターが見つかりませんでした。正式名称が一致しているか確認してください。');
        return;
      }
      // 取込に無いキャラの行は残す — 一部だけの CSV で他のキャラが既定に戻ると、
      // 属性別編成の比較まで静かに劣化する
      roster = mergeImportedRoster(roster, overrides);
      saveRoster();
      void loadCombatPower();
      const refreshed = refreshDecksFromRoster(matched);
      saveState();
      renderDeckTabs();
      renderSquad();
      const skipped = unmatched.length > 0 ? ` · 未対応 ${unmatched.length}名を除外` : '';
      const kept = Object.keys(roster).length - matched.length;
      rememberSync({ schemaVersion: 1, source: 'csv', at: new Date().toISOString(), matched: matched.length });
      const updated = refreshed > 0 ? ` · 編成中 ${refreshed}名の育成値を更新` : '';
      // 取込に無かったキャラは消さずに残す。黙って残すと「持っていないのに所持扱い」に気づけない
      const carried = kept > 0 ? ` · この CSV に無かった ${kept}名は前回の値のまま` : '';
      updateRosterNote(`CSV ロスター ${matched.length}名を適用${skipped}${updated}${carried}`
        + ' · キューブと好感度は CSV にないため既定値で計算します(カードの個別設定で修正可)');
    } catch (error) {
      updateRosterNote(`CSV の読み込みに失敗: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.value = '';
    }
  };
  rosterInput.addEventListener('change', () => { void importRosterCsv(rosterInput); });

  /**
   * この端末の持ち物を1本の文字列にする。**別の端末へ運ぶため**の書き出し。
   *
   * 育成は localStorage にしかないので、PC で取り込んでもスマホには来ない。
   * スマホは F12 が使えずスニペットを実行できないので、貼るだけで移せる道が要る。
   */
  const buildTransfer = (): TransferBox => {
    const battle = readBattle();
    return {
      schemaVersion: 1,
      at: new Date().toISOString(),
      roster,
      ...(syncMeta ? { sync: syncMeta } : {}),
      favorites: [...favorites],
      plans: readPlans(),
      board: readBoard(),
      account: {
        synchroLevel: battle.synchroLevel,
        ...(battle.console ? { console: battle.console } : {}),
      },
    };
  };

  /**
   * 運んできたものをこの端末に載せる。**上書きする** — 移す側が新しい前提。
   * 何をどれだけ受け取ったかを一行で返す (黙って書き換えない)。
   */
  const applyTransfer = (moved: TransferBox): string => {
    roster = moved.roster as Record<string, CharacterOverrides>;
    saveRoster();
    void loadCombatPower();
    const refreshed = refreshDecksFromRoster(Object.keys(roster));

    if (moved.account) {
      const battle = readBattle();
      writeBattle({
        ...battle,
        ...(typeof moved.account.synchroLevel === 'number'
          ? { synchroLevel: moved.account.synchroLevel } : {}),
        ...(moved.account.console ? { console: moved.account.console as typeof battle.console } : {}),
      });
    }
    if (moved.favorites) {
      favorites = new Set(moved.favorites);
      saveFavorites(resolveStorage(), favorites);
    }
    if (moved.plans) writePlansFrom(moved.plans);
    if (moved.board) writeBoardFrom(moved.board);
    if (moved.sync) rememberSync(moved.sync as SyncMeta);

    saveState();
    renderDeckTabs();
    renderSquad();
    renderMyRoster();
    renderPlans();
    renderBoard();

    const parts = [`育成 ${Object.keys(roster).length}名を受け取りました`];
    if (refreshed > 0) parts.push(`編成中 ${refreshed}名を更新`);
    if (moved.favorites?.length) parts.push(`お気に入り ${moved.favorites.length}名`);
    parts.push(`書き出し ${syncAgoText(moved.at)}`);
    return parts.join(' · ');
  };

  /**
   * 取り込んだ1サーバー分を、ロスター・編成・戦闘条件に流し込む。
   *
   * 入口は2つある — プロキシ経由 (アドレスを貼る) と、自分のブラウザで取ったものの
   * 貼り付け。**どちらも同じ形の生データ**なので、ここから先は必ず同じ道を通す。
   * 片方だけ直して «同じ育成なのに経路で結果が違う» が起きると原因を追えない。
   *
   * 扱えるニケが1人も居なければ null を返す (呼び手が言い方を決める)。
   */
  const applyProfileArea = (area: RawArea, meta: Omit<SyncMeta, 'schemaVersion' | 'at' | 'matched'>) => {
    const { overrides, matched, unmatched, notes } = areaToOverrides(area, settings, catalog);
    if (matched.length === 0) return null;

    roster = mergeImportedRoster(roster, overrides);
    saveRoster();
    void loadCombatPower();
    const refreshed = refreshDecksFromRoster(matched);

    // コンソールはアカウント単位なので戦闘条件の側にある。前哨基地が非公開だと来ないが、
    // そのときは触らないのが正しい — 0 で覆うと元の値が消える。
    const consoleLevels = consoleFrom(area);
    // シンクロもアカウント単位で、火力に直結する (既定 400 のままだと理論値が大幅に低く出る)。
    // 取れたら必ず反映し、取れないとき (前哨基地が非公開) は今の設定を触らない
    const synchro = synchroFrom(area);
    if (consoleLevels || synchro !== null) {
      const battle = readBattle();
      writeBattle({
        ...battle,
        ...(consoleLevels ? { console: consoleLevels } : {}),
        ...(synchro !== null ? { synchroLevel: synchro } : {}),
      });
    }

    saveState();
    renderDeckTabs();
    renderSquad();
    rememberSync({ schemaVersion: 1, at: new Date().toISOString(), matched: matched.length, ...meta });

    const carried = Object.keys(roster).length - matched.length;
    return { matched, unmatched, notes, refreshed, carried, console: Boolean(consoleLevels), synchro };
  };
  element<HTMLButtonElement>(root, '[data-roster-csv-open]').addEventListener('click', () => rosterInput.click());

  // Blablalink 連携。プロキシが設定されたビルドにしかマークアップが無いので、無ければ丸ごと飛ばす。
  if (blablaProxy) {
    const blablaModal = element<HTMLElement>(root, '[data-blabla-modal]');
    const blablaServer = element<HTMLSelectElement>(root, '[data-blabla-server]');
    const blablaUrl = element<HTMLInputElement>(root, '[data-blabla-url]');
    const blablaSync = element<HTMLButtonElement>(root, '[data-blabla-sync]');
    const blablaStatus = element<HTMLElement>(root, '[data-blabla-status]');

    const setStatus = (message: string) => {
      blablaStatus.textContent = message;
      blablaStatus.hidden = message === '';
    };

    const runSync = async (preset?: { url: string; area?: number }) => {
      if (syncInFlight) return;   // 別の入口で取得中 — 二重に走らせない
      const url = preset ? preset.url : blablaUrl.value.trim();
      if (!looksLikeProfileUrl(url)) {
        const message = preset
          ? '覚えているアドレスが読めませんでした。Blablalink 連携から入れ直してください。'
          : 'Blablalink のプロフィールのアドレスを貼り付けてください。';
        setStatus(message);
        if (preset) updateRosterNote(message);
        return;
      }
      const selectedArea = preset
        ? preset.area
        : (blablaServer.value === '' ? undefined : Number(blablaServer.value));
      setSyncBusy(true);
      blablaSync.disabled = true;
      blablaServer.disabled = true;
      setStatus('Blablalink から取得中… ニケが多いと数秒かかります。');
      try {
        const response = await fetch(`${blablaProxy}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileUrl: url,
            ...(selectedArea === undefined ? {} : { area: selectedArea }),
          }),
        });
        const payload = await response.json() as RawProfile & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `同期に失敗しました (${response.status})。`);

        const area = pickArea(payload, selectedArea);
        if (!area) throw new Error('ニケ一覧が空です。');
        const serverLabel = blablaServerLabel(area.area);
        const applied = applyProfileArea(area, {
          source: 'blablalink', profileUrl: url,
          ...(selectedArea === undefined ? {} : { area: selectedArea }),
        });
        if (!applied) {
          const message = '計算機が扱えるニケが見つかりませんでした。プロフィールが公開になっているか確認してください。';
          setStatus(message);
          if (preset) updateRosterNote(message);   // 窓を開かずに押したときは画面側にも出す
          return;
        }

        const parts = [`Blablalink ${serverLabel} ${applied.matched.length}名を適用`];
        if (applied.refreshed > 0) parts.push(`編成中 ${applied.refreshed}名の育成値を更新`);
        if (applied.carried > 0) parts.push(`今回に無かった ${applied.carried}名は前回の値のまま`);
        if (applied.unmatched.length > 0) parts.push(`未対応 ${applied.unmatched.length}名を除外`);
        if (applied.synchro !== null) parts.push(`シンクロ ${applied.synchro} を反映`);
        if (applied.console) parts.push('コンソールレベルも適用');
        updateRosterNote(parts.join(' · '));
        setStatus([`${serverLabel}サーバーから ${applied.matched.length}名を読み込みました。`, ...applied.notes].join(' '));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message);
        // モーダルを開かずに再取込したときは、その窓が隠れたままなので画面側にも出す
        if (preset) updateRosterNote(`取り込みに失敗しました — ${message}`);
      } finally {
        setSyncBusy(false);
        blablaSync.disabled = false;
        blablaServer.disabled = false;
      }
    };

    element<HTMLButtonElement>(root, '[data-blabla-open]').addEventListener('click', () => {
      blablaModal.hidden = false;
      blablaUrl.focus();
    });
    element<HTMLButtonElement>(root, '[data-blabla-close]').addEventListener('click', () => {
      blablaModal.hidden = true;
    });
    blablaModal.addEventListener('click', (event) => {
      if (event.target === blablaModal) blablaModal.hidden = true;
    });
    reSync = (preset) => runSync(preset);
    renderSyncBox();   // ボタンを出せるようになったので描き直す
    blablaSync.addEventListener('click', () => { void runSync(); });
    blablaUrl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void runSync(); }
    });
  }

  // ── 並列計算 ───────────────────────────────────────────────────────────
  // 計算はこの端末で回る。ワーカーを複数立てるとデッキを分けて回せて速くなるが、ワーカーごとに
  // 計算ランタイムが1つずつ立ってメモリを食う — なので切ることも、数を選ぶこともできる。
  // 結果はいくつに分けても同じ (盤ごとに独立・決定論的)。
  const PARALLEL_KEY = 'nikke-parallel-v1';
  const parallelToggle = element<HTMLInputElement>(root, '[data-parallel-toggle]');
  const parallelSize = element<HTMLSelectElement>(root, '[data-parallel-size]');
  const poolDefault = client.defaultPoolSize ? client.defaultPoolSize() : 1;
  const poolMax = client.maxPoolSize ?? 1;
  let parallelOn = true;
  let parallelCount = poolDefault;
  try {
    const saved = JSON.parse(resolveStorage()?.getItem(PARALLEL_KEY) ?? 'null') as
      { on?: boolean; count?: number } | null;
    if (saved) {
      if (typeof saved.on === 'boolean') parallelOn = saved.on;
      if (typeof saved.count === 'number') parallelCount = saved.count;
    }
  } catch { /* 저장된 값이 깨졌으면 기본값으로 간다 */ }
  parallelCount = Math.max(1, Math.min(poolMax, Math.trunc(parallelCount) || 1));

  for (let n = 1; n <= poolMax; n += 1) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = `${n}個`;
    parallelSize.append(option);
  }
  // 推奨値は枠を広げないよう説明のほうにだけ書く — トグルの行が長くなると行が折れる。
  parallelSize.title = `起動するワーカースレッド数。この端末の推奨は ${poolDefault}個。`
    + '1つごとに計算ランタイムが立ち上がり、メモリを 50~80MB ずつ使います。';
  const applyParallel = (save: boolean) => {
    parallelToggle.checked = parallelOn;
    parallelSize.value = String(parallelCount);
    parallelSize.disabled = !parallelOn;
    client.setPoolSize?.(parallelOn ? parallelCount : 1);
    if (!save) return;
    try {
      resolveStorage()?.setItem(PARALLEL_KEY, JSON.stringify({ on: parallelOn, count: parallelCount }));
    } catch { /* 저장 실패는 무시한다 — 이번 판만 못 기억할 뿐이다 */ }
  };
  parallelToggle.addEventListener('change', () => {
    parallelOn = parallelToggle.checked;
    applyParallel(true);
  });
  parallelSize.addEventListener('change', () => {
    parallelCount = Number(parallelSize.value) || 1;
    applyParallel(true);
  });
  applyParallel(false);

  // ── 属性別編成 (5属性 × 最大3案) ──
  // 保存されるのは**顔ぶれ + 個別設定のスナップショット (キューブ等)**。
  // スナップショットに無いニケの育成値はロスター側を見るので、取り込み直せば自動で新しくなる。
  // 「3案を比較」で出したダメージは案に**登録**され、再読込しても残る。
  // 案は3凸ボードも読むので、両方の外に置く
  let plans: ElementPlans = loadPlans(resolveStorage());
  readPlans = () => plans;
  writePlansFrom = (raw) => {
    // 運んできたものは «その端末で保存されていた形» なので、読み手を通して形を検める
    plans = loadPlans({ getItem: () => JSON.stringify(raw), setItem: () => undefined, removeItem: () => undefined });
    savePlans(resolveStorage(), plans);
  };
  /**
   * 編成の個別設定。**案 (キューブ込みで登録したスナップショット) が最優先**、
   * 無いニケはロスター (取込値)。「編成はキューブ込みで1つの案」を計算に反映する入口。
   */
  const charactersWith = (
    squad: readonly string[], snapshot?: Record<string, CharacterOverrides>,
  ): Record<string, CharacterOverrides> =>
    Object.fromEntries(squad.filter(Boolean).flatMap((name) => {
      const base = snapshot?.[name] ?? roster[name];
      return base ? [[name, cloneOverride(base)]] : [];
    }));
  /** デッキの個別設定のスナップショット (登録用に切り離す)。 */
  /**
   * キューブの略称 (リロ速・弾チャ・貫通…)。
   *
   * 公式名 (レリックベアーキューブ等) では**どれが何のキューブか読めない**し、
   * 顔タイルの下に入る幅もない。効果の言葉から、実際に呼ばれている略称に落とす。
   * 知らない効果 (新キューブ) は効果の先頭4文字 — 名前よりは中身が伝わる。
   */
  const CUBE_NICKNAMES: ReadonlyArray<readonly [string, string]> = [
    ['リロード速度', 'リロ速'],
    ['弾丸チャージ', '弾チャ'],
    ['チャージダメージ', 'チャダメ'],
    ['チャージ速度', 'チャ速'],
    ['バーストゲージ', 'バゲ速'],
    ['最大装弾数', '装弾数'],
    ['パーツダメージ', 'パーツ'],
    ['貫通ダメージ', '貫通'],
    ['防御力無視', '防無視'],
    ['分配ダメージ', '分配'],
    ['命中率', '命中'],
    ['受けるダメージ', '被ダメ'],
    ['与えるHP回復量', '回復'],
    ['遮蔽物', '遮蔽'],
    ['最大HP', 'HP'],
    ['防御力', '防御'],
  ];
  /**
   * このニケが**実際に計算されるときのキューブ**と、その出どころ。
   *
   * cube キーが無いと、エンジンは既定キューブ (多くは最良 Lv15) で計算する —
   * これを画面が黙っていたせいで、«リロ速を付けても数値が動かない» (元から同じものが
   * 効いていた) が「キューブが壊れている」に見えた (実機監査 → エンジン直叩きで実証)。
   * 優先順位は計算側 (charactersWith → エンジン既定) と同じでなければならない。
   * 既定が本当にエンジンと一致することは scripts/test-bridge.py が見張っている。
   */
  const effectiveCube = (
    name: string, snapshot?: Record<string, CharacterOverrides>,
  ): { cube: { name: string; level: number } | null; source: 'plan' | 'roster' | 'default' } => {
    const fromPlan = snapshot?.[name]?.cube;
    if (fromPlan) return { cube: fromPlan.name === NO_CUBE ? null : fromPlan, source: 'plan' };
    const fromRoster = roster[name]?.cube;
    if (fromRoster) return { cube: fromRoster.name === NO_CUBE ? null : fromRoster, source: 'roster' };
    const fallback = settings.characters[name]?.cube;
    return { cube: fallback && fallback.name !== NO_CUBE ? fallback : null, source: 'default' };
  };
  const CUBE_SOURCE_LABELS = { plan: 'この編成の設定', roster: '取り込んだ装着', default: '既定 (未指定のときエンジンが使う値)' } as const;

  const cubeNickname = (cubeName: string | undefined): string => {
    if (!cubeName || cubeName === NO_CUBE) return '';
    const meta = settings.cubes[cubeName];
    if (!meta) return '';
    const effect = cubeTemplate(meta.template);
    for (const [keyword, nick] of CUBE_NICKNAMES) {
      if (effect.includes(keyword)) return nick;
    }
    return effect.replace(/^[^\s「]*時\s*/, '').replace(/[「」▲▼{}\d％%]/g, '').trim().slice(0, 4);
  };

  const snapshotOf = (deck: DeckState): Record<string, CharacterOverrides> =>
    Object.fromEntries(Object.entries(deck.characters).map(([name, value]) => [name, cloneOverride(value)]));
  {
    const groupsBox = element<HTMLElement>(root, '[data-plans-groups]');
    // 計算中かどうかはボタンではなくここに持つ。保存・削除で renderPlans() が
    // ボタンごと作り直すため、disabled だけに頼ると二重に走らせられる。
    let comparing = false;
    /** 消した候補の1世代 undo。次の削除で入れ替わる。 */
    let planUndo: { code: PlanElement; plan: ElementPlan; index: number } | null = null;
    const say = (element_: PlanElement, message: string, ok = false) => {
      const note = groupsBox.querySelector<HTMLElement>(`[data-plans-note="${element_}"]`);
      if (!note) return;
      note.textContent = message;
      note.hidden = !message;
      note.classList.toggle('is-ok', ok);
    };

    const commit = (next: ElementPlans): boolean => {
      plans = next;
      const saved = savePlans(resolveStorage(), plans);
      renderPlans();
      renderBoard();   // 候補が変わった
      return saved;
    };

    /**
     * 1行 = 1凸ぶんの選択肢。**左に今回のボス、右にそのボスへ有利な編成の候補**。
     *
     * 以前はボスの登録 (電撃→灼熱→風圧→水冷→鉄甲) と候補一覧 (灼熱→水冷→風圧→電撃→鉄甲) が
     * 別々の節にあり、**順序も «属性» の意味も食い違っていた** (ボスの属性か編成の属性か)。
     * 「レイタンスに使うのは鉄甲編成」を毎回頭で変換してから、別の順に並んだ5番目を探すことになる。
     * ボスを軸に1行へまとめて、その変換を画面が肩代わりする。
     */
    renderPlans = () => {
      groupsBox.replaceChildren();
      bossReset.hidden = !isCustomised(bosses);
      // 5行で画面5枚ぶんになる (スマホ実測 4,600px)。行頭へ飛べるチップを置く
      const jump = el('div', 'prep-jump');
      for (const boss of bosses) {
        const chip = el('button', `prep-chip is-${ELEMENT_SLUG[boss.elementCode] ?? 'iron'}`);
        (chip as HTMLButtonElement).type = 'button';
        chip.textContent = elementLabel(boss.elementCode);
        chip.dataset.prepJump = boss.elementCode;
        chip.title = `${boss.name} の行へ`;
        chip.addEventListener('click', () => {
          const row = groupsBox.querySelector<HTMLElement>(`[data-prep-row="${boss.elementCode}"]`);
          row?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        });
        jump.append(chip);
      }
      groupsBox.append(jump);
      const base = readBattle();
      let total = 0;
      let fresh = 0;
      let stale = 0;

      // **ボスの順**に並べる (候補の属性順ではない)。1行が1体のボスに対応する
      for (const [index, boss] of bosses.entries()) {
        const code = counterOf(boss.elementCode);
        const nowCond = condSignature(boss, boardBattle(base, boss));
        const saved = code ? plansOf(plans, code) : [];
        const freshness = (plan: ElementPlan): 'fresh' | 'stale' | 'old' => (
          plan.registered?.cond === undefined ? 'old'
            : plan.registered.cond === nowCond ? 'fresh' : 'stale');
        total += saved.length;
        fresh += saved.filter((plan) => freshness(plan) === 'fresh').length;
        stale += saved.filter((plan) => freshness(plan) === 'stale').length;

        const row = el('div', 'prep-row');
        row.dataset.prepRow = boss.elementCode;

        // ── 左: 今回のボス ──
        const side = el('div', 'prep-side');
        const sideTop = el('div', 'prep-side-top');
        const chip = createText('span', `${elementLabel(boss.elementCode)}ボス`,
          `prep-chip is-${ELEMENT_SLUG[boss.elementCode] ?? 'iron'}`);
        sideTop.append(chip, createText('span', `${index + 1}体目`, 'prep-nth'));
        side.append(sideTop);

        const name = el('input', 'prep-name') as HTMLInputElement;
        name.type = 'text';
        name.value = boss.name;
        name.dataset.bossName = boss.elementCode;
        name.setAttribute('aria-label', `${elementLabel(boss.elementCode)}ボスの名前`);
        // change (確定時) で拾う。input ごとに保存すると1文字ごとに全部描き直す
        name.addEventListener('change', () => editBoss(boss.elementCode, { name: name.value }));
        side.append(name);

        const fields = el('div', 'prep-fields');
        // 数値には**見える見出し**を付ける。読み上げの aria-label だけだと、
        // 目で見ている人には 31784 が何の数字か分からない
        const defWrap = el('span', 'prep-field');
        defWrap.append(createText('span', '防御', 'prep-label'));
        const def = el('input', 'prep-num') as HTMLInputElement;
        def.type = 'number';
        def.min = '1';
        def.value = String(boss.enemyDef ?? '');
        def.dataset.bossDef = boss.elementCode;
        def.setAttribute('aria-label', `${boss.name} の防御力`);
        def.addEventListener('change', () => editBoss(boss.elementCode, { enemyDef: Number(def.value) }));
        defWrap.append(def);
        fields.append(defWrap);

        const coreWrap = el('label', 'prep-toggle');
        const core = el('input') as HTMLInputElement;
        core.type = 'checkbox';
        core.checked = boss.coreEnabled === true;
        core.dataset.bossCore = boss.elementCode;
        core.addEventListener('change', () => {
          editBoss(boss.elementCode, { coreEnabled: core.checked });
          // 入れた直後は大きさを入れたいはず — 描き直し後の欄へ焦点を移す
          if (core.checked) {
            groupsBox.querySelector<HTMLInputElement>(`[data-boss-px="${boss.elementCode}"]`)?.focus();
          }
        });
        coreWrap.append(core, createText('span', 'コア'));
        fields.append(coreWrap);

        const pxWrap = el('span', 'prep-field');
        const px = el('input', 'prep-num is-short') as HTMLInputElement;
        px.type = 'number';
        px.min = '0';
        px.value = String(boss.corePx ?? 0);
        px.dataset.bossPx = boss.elementCode;
        px.setAttribute('aria-label', `${boss.name} のコアの大きさ (px)`);
        px.title = 'コアの大きさ (上流計算機と同じ指標)。ゲーム内で狙えるコアの当たり判定の大きさです';
        // コア無しのボスに大きさを入れさせない — 入れても計算に効かず «効いている» と誤解する
        px.disabled = boss.coreEnabled !== true;
        px.addEventListener('change', () => editBoss(boss.elementCode, { corePx: Number(px.value) }));
        pxWrap.append(px, createText('span', 'px', 'prep-label'));
        fields.append(pxWrap);

        const partsWrap = el('label', 'prep-toggle');
        const parts = el('input') as HTMLInputElement;
        parts.type = 'checkbox';
        parts.checked = boss.hasParts === true;
        parts.dataset.bossParts = boss.elementCode;
        parts.addEventListener('change', () => editBoss(boss.elementCode, { hasParts: parts.checked }));
        partsWrap.append(parts, createText('span', 'パーツ'));
        fields.append(partsWrap);
        side.append(fields);
        row.append(side);

        // ── 右: そのボスに有利な編成の候補 ──
        const main = el('div', 'prep-main');
        if (code) main.dataset.plansGroup = code;

        const top = el('div', 'prep-main-top');
        const vs = el('span', 'prep-vs');
        vs.append(createText('span', '↳', 'prep-arrow'), document.createTextNode(' 有利なのは '));
        vs.append(createText('b', code ? `${elementLabel(code)}編成` : '—', 'plans-against'));
        vs.append(createText('span', `候補 ${saved.length}/${MAX_PLANS_PER_ELEMENT}`, 'prep-count'));
        top.append(vs);

        // 行の状態。**どの行に手を入れれば前に進むか**が一目で分かるようにする
        // この行の最大 (今回のボス条件で出した値の中で)。比べられるのは同じ条件の値だけ
        const freshOnes = saved.filter((plan) => freshness(plan) === 'fresh');
        const bestHere = freshOnes.length > 1
          ? freshOnes.reduce((top, plan) =>
            (plan.registered!.damage > top.registered!.damage ? plan : top)).id
          : null;
        const staleHere = saved.some((plan) => freshness(plan) === 'stale');
        const noneHere = saved.some((plan) => !plan.registered);
        const [stateText, stateKind] = saved.length === 0 ? ['候補なし', 'todo']
          : staleHere ? ['条件が変わりました', 'warn']
            : noneHere ? ['理論値まだ', 'todo'] : ['最新', 'ok'];
        const state = createText('span', stateText, `prep-state is-${stateKind}`);
        state.dataset.prepState = boss.elementCode;
        top.append(state);
        main.append(top);

        if (code) {
          const note = el('p', 'plans-note');
          note.dataset.plansNote = code;
          note.hidden = true;
          main.append(note);
          if (planUndo && planUndo.code === code) {
            const undo = el('button', 'roster-import', '消した候補を元に戻す');
            (undo as HTMLButtonElement).type = 'button';
            undo.dataset.plansUndo = code;
            undo.addEventListener('click', () => {
              const back = planUndo;
              planUndo = null;
              if (!back) return;
              // id も理論値もそのまま、元の位置へ戻す
              const current = plansOf(plans, back.code);
              const at = Math.min(back.index, current.length);
              commit({
                schemaVersion: 1,
                byElement: {
                  ...plans.byElement,
                  [back.code]: [...current.slice(0, at), back.plan, ...current.slice(at)],
                },
              });
              say(back.code, '元に戻しました。', true);
            });
            main.append(undo);
          }
        }

        const list = el('div', 'plans-list');
        if (saved.length === 0) {
          const empty = el('p', 'plans-empty');
          empty.append(document.createTextNode('この行に候補がありません。'));
          empty.append(createText('b', `${code ? elementLabel(code) : ''}の編成`));
          empty.append(document.createTextNode('を「＋ 編成を追加」で組むと、このボスも3凸の選択肢に入ります。'));
          list.append(empty);
        }
        saved.forEach((plan, planIndex) => {
          const planRow = el('div', 'plans-row');
          planRow.dataset.plansRow = plan.id;
          planRow.append(createText('b', `${planIndex + 1}`, 'plans-index'));
          // 顔ぶれは**立ち絵**で並べる。文字だけだと5人の編成が «ぱっと見» で読めない
          // (計算機のニケ一覧・枠のピッカーと同じ作り)。名前も下に残す —
          // 立ち絵だけだと、似た絵のニケや持っていないニケが見分けられない。
          const members = el('span', 'plans-members');
          for (const who of plan.squad.filter(Boolean)) {
            const meta = catalogByName.get(who);
            const face = el('span', 'plans-face');
            const shot = el('span', 'plans-face-shot');
            if (meta?.image) {
              const img = document.createElement('img');
              img.src = `${import.meta.env.BASE_URL}${meta.image}`;
              img.alt = '';
              img.loading = 'lazy';
              shot.append(img);
            }
            const icon = meta ? createElementIcon(meta.elementCode, 'plans-face-code') : null;
            if (icon) shot.append(icon);
            face.append(shot, createText('span', labelFor(who), 'plans-face-name'));
            // どのキューブを付けた候補かは、開かないと分からなかった (実運用の指摘)。
            // 候補のスナップショットが持つキューブだけを出す — ロスター任せのニケは
            // 計算時にロスターの値になるので、ここで断定して出すと嘘になりうる
            // **実効**キューブを出す。明示された分だけ出すと、既定キューブで計算して
            // いるのに «未装着» の顔をする — 表示と計算の食い違いが「キューブが壊れて
            // いる」に見えた (実機監査 → エンジン直叩きで実証)
            const worn = effectiveCube(who, plan.characters);
            if (worn.cube) {
              const nick = cubeNickname(worn.cube.name);
              // スマホにホバーは無い — 押せば正式名と Lv と出どころが行のノートに出る
              const badge = el('button', 'plans-face-cube');
              (badge as HTMLButtonElement).type = 'button';
              badge.textContent = worn.source === 'plan' ? nick : `${nick}◦`;
              if (worn.source !== 'plan') badge.classList.add('is-implied');
              const full = `${labelForCube(worn.cube.name)} Lv${worn.cube.level}`
                + (worn.source === 'plan' ? '' : ` — ${CUBE_SOURCE_LABELS[worn.source]}`);
              badge.title = full;
              badge.setAttribute('aria-label', `${labelFor(who)} のキューブ: ${full}`);
              badge.addEventListener('click', () => { if (code) say(code, `${labelFor(who)}: ${full}`, true); });
              face.append(badge);
            }
            face.title = labelFor(who);
            members.append(face);
          }
          planRow.append(members);

          const score = el('span', 'plans-score');
          score.dataset.plansScore = plan.id;
          // 行の中の最大に印を付ける — 5行×数件を毎回目で読み比べるのは疲れる (実機監査)
          if (bestHere !== null && plan.id === bestHere) {
            score.classList.add('is-best');
            score.append(createText('b', '一番', 'plans-top'));
          }
          // 数値は**どの状態か**を必ず出す。空欄だと «計算していない» のか
          // «計算したが0» なのか読めない。
          if (plan.registered) {
            score.textContent = `${formatDamage(plan.registered.damage)}`;
            const how = freshness(plan);
            score.append(createText('small',
              how === 'fresh' ? `今回のボス条件 · ${plan.registered.duration}秒`
                : how === 'stale' ? '条件が変わりました' : `前に出した値 · ${plan.registered.duration}秒`,
              `plans-score-state${how === 'stale' ? ' is-stale' : ''}`));
            score.title = how === 'stale'
              ? `${plan.registered.cond} で出した値です。今は ${nowCond} — 「理論値をぜんぶ出す」で出し直してください`
              : `出して覚えた理論値です (${new Date(plan.registered.at).toLocaleString('ja-JP')})`;
          } else {
            score.append(createText('small', '理論値まだ', 'plans-score-state is-none'));
            score.title = '「理論値をぜんぶ出す」を押すと、今回のボス条件で出して覚えます';
          }
          planRow.append(score);

          // 「ちょっとだけ変えた別の候補」を作る入口。写しをモーダルで開き、
          // どこか変えて保存すると別候補になる (そのまま保存すると重複で弾かれる —
          // それが «どこか変えてから» の合図になる)。
          const rowFull = saved.length >= MAX_PLANS_PER_ELEMENT;
          const copy = el('button', 'roster-import', 'コピー');
          (copy as HTMLButtonElement).type = 'button';
          copy.dataset.plansCopy = plan.id;
          copy.disabled = rowFull;
          copy.title = rowFull
            ? `この行は既に ${MAX_PLANS_PER_ELEMENT}件あります。どれかを消してからコピーしてください`
            : 'この候補を写して、少し変えた別の候補を作ります';
          copy.addEventListener('click', () => { if (code) openSquadModal(code, boss, plan, { copy: true }); });

          const edit = el('button', 'roster-import', '直す');
          (edit as HTMLButtonElement).type = 'button';
          edit.dataset.plansEdit = plan.id;
          edit.title = '顔ぶれ・育成・ハーモニーキューブを直します';
          edit.addEventListener('click', () => { if (code) openSquadModal(code, boss, plan); });
          const drop = el('button', 'roster-import danger', '削除');
          (drop as HTMLButtonElement).type = 'button';
          drop.dataset.plansRemove = plan.id;
          drop.addEventListener('click', () => {
            if (!code) return;
            // «直す» と隣同士で誤爆が痛い。確認で止めるより、消してから戻れる方が軽い
            planUndo = { code, plan, index: planIndex };
            const kept = commit(removePlan(plans, code, plan.id));
            say(code, kept ? `候補 ${planIndex + 1} を消しました。`
              : 'この画面では消えましたが、ブラウザに保存できませんでした (次に開くと戻ります)。', kept);
          });
          planRow.append(copy, edit, drop);
          list.append(planRow);
        });
        main.append(list);

        const add = el('div', 'prep-add');
        if (code) {
          // 主釦はこれ1つ。「編成を組む」「足す」「保存」と動詞が散っていて、
          // どれが入口か読めなかった (利用者の指摘)。
          const make = el('button', 'roster-import lead', '＋ 編成を追加');
          (make as HTMLButtonElement).type = 'button';
          make.dataset.prepMake = code;
          make.addEventListener('click', () => openSquadModal(code, boss));
          add.append(make);

          // 1行足しただけで全部を回し直すのは無駄。この行だけ回せるようにする
          const runRow = el('button', 'roster-import', 'この行の理論値を出す');
          (runRow as HTMLButtonElement).type = 'button';
          runRow.dataset.prepRowRun = boss.elementCode;
          runRow.disabled = saved.length === 0;
          runRow.addEventListener('click', () => { void runBatch([boss.elementCode], { rowMark: boss.elementCode }); });
          add.append(runRow);
        }
        main.append(add);
        row.append(main);
        groupsBox.append(row);
      }

      renderTally(total, fresh, stale);
    };

    /** 上の «ぜんぶ計算» に、いま何件がどの状態かを出す。次に何をすべきかが読める。 */
    const renderTally = (total: number, fresh: number, stale: number) => {
      const left = total - fresh - stale;
      tallyBox.replaceChildren();
      const cell = (value: number, label: string, warn = false) => {
        const box = el('div', warn && value > 0 ? 'is-warn' : undefined);
        box.append(createText('b', String(value)), createText('span', label));
        tallyBox.append(box);
      };
      cell(total, '編成');
      cell(fresh, '理論値あり');
      cell(stale, '条件が変わった', true);
      cell(left, 'まだ出していない');
      nextNote.textContent = total === 0
        ? '編成がまだありません。上の行の「＋ 編成を追加」から作ってください。'
        : fresh === 0
          ? `${total}件の編成はまだ理論値を出していません。先に「理論値をぜんぶ出す」を押してください。`
          : `計算済みの${fresh}件から、同じニケを二度使わない合計最大の3つ組を選びます。`
            + (total - fresh > 0 ? ` 残り${total - fresh}件は理論値が出ていません。` : '');
      prepGo.disabled = fresh === 0;
    };

    // ── ボス条件で確かめる ──
    // 基準 (癖なし) とボス条件の両方を計算して並べる。片方だけ見せると、
    // なぜ順位が入れ替わったのか読めなくなる。
    const bossPick = element<HTMLSelectElement>(root, '[data-plans-boss-pick]');
    const bossCond = element<HTMLElement>(root, '[data-plans-boss-cond]');
    const bossRun = element<HTMLButtonElement>(root, '[data-plans-boss-run]');
    const bossNote = element<HTMLElement>(root, '[data-plans-boss-note]');
    const bossResult = element<HTMLElement>(root, '[data-plans-boss-result]');

    // 名前を変えられるので**作り直せる形**にする。選んでいたボスは属性で覚えておいて戻す
    // (番号で覚えると、並びを変えたときに黙って別のボスが選ばれる)。
    const renderBossPick = () => {
      const wasCode = bosses[Number(bossPick.value)]?.elementCode;
      bossPick.replaceChildren();
      for (const [index, boss] of bosses.entries()) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${boss.name} (${elementLabel(boss.elementCode)})`;
        bossPick.append(option);
      }
      const back = bosses.findIndex((boss) => boss.elementCode === wasCode);
      if (back >= 0) bossPick.value = String(back);
      renderBossCond();
    };

    /** 選んだボスに登録されている癖を1行で出す。以前はここにチェックボックスがあった。 */
    const renderBossCond = () => {
      const boss = bosses[Number(bossPick.value)];
      if (!boss) { bossCond.textContent = ''; return; }
      const parts = [`防御 ${(boss.enemyDef ?? 0).toLocaleString('en-US')}`];
      parts.push(boss.coreEnabled ? `コア ${boss.corePx ?? 0}px` : 'コア無し');
      parts.push(boss.hasParts ? 'パーツあり' : 'パーツ無し');
      bossCond.textContent = parts.join(' · ');
    };
    bossPick.addEventListener('change', renderBossCond);

    // ── 今回のボスを登録する ──────────────────────────────────────────────
    // 属性の欄は**読むだけ**。1属性1体という対応が «どの候補をどのボスに当てるか» の
    // 索引なので、ここを触らせると盤面も候補も行き先を失う。
    const bossReset = element<HTMLButtonElement>(root, '[data-boss-reset]');
    const tallyBox = element<HTMLElement>(root, '[data-prep-tally]');
    const nextNote = element<HTMLElement>(root, '[data-prep-next-note]');
    const prepGo = element<HTMLButtonElement>(root, '[data-prep-go]');

    // ── 編成モーダル ──────────────────────────────────────────────────────
    // 行の «編成を組む» / 候補の «編集» から開く。ニケ選び・育成とキューブの設定・
    // 保存までをここで終える。
    //
    // これが無かったころは «詳細計算タブで組む → レイド準備に戻る → «詳細計算の編成を
    // ここに足す»» という順で、**どこで編成を作るのかが画面から読めなかった**。
    const squadModal = element<HTMLElement>(root, '[data-squad-modal]');
    const squadModalTitle = element<HTMLElement>(root, '[data-squad-modal-title]');
    const squadModalDesc = element<HTMLElement>(root, '[data-squad-modal-desc]');
    const squadModalPick = element<HTMLElement>(root, '[data-squad-modal-pick]');
    const squadModalTune = element<HTMLElement>(root, '[data-squad-modal-tune]');
    const squadModalNote = element<HTMLElement>(root, '[data-squad-modal-note]');
    const squadModalSave = element<HTMLButtonElement>(root, '[data-squad-modal-save]');

    /**
     * 開いている間の作業用の写し。**保存を押すまで候補には入らない**。
     * `id` があれば差し替え、無ければ新規。
     */
    let draft: {
      code: PlanElement;
      boss: UnionBoss;
      id: string | null;
      squad: string[];
      characters: Record<string, CharacterOverrides>;
      tuning: string | null;   // いま育成・キューブを見ているニケ
      tuneOpen: boolean;       // 育成・キューブの面を開いているか (登録だけなら閉じたまま)
      fromCopy: boolean;       // コピーとして開いたか (見出しに出す)
      /** まとめて付けたキューブ。開いている間だけ覚えて、選び直しの手間を省く */
      bulkCube?: string;
      bulkCubeLevel?: number;
    } | null = null;

    /** 押せるだけの小さなボタン。盤面の `button` は «計算中は押せない» を持つので借りない。 */
    const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
      const node = el('button', className, label);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    };

    /**
     * 選んだニケに**取り込んだ育成値を敷く**。
     *
     * 敷かないと、モーダルで «個別設定» を入れた瞬間にカタログの既定値 (最大) から
     * 始まってしまい、取り込んだスキルレベルや突破が消える。計算機で枠に入れたときと
     * 同じ扱いにする (pickCharacter と同じ考え方)。
     */
    const seedFromRoster = (squad: readonly string[], into: Record<string, CharacterOverrides>) => {
      for (const name of squad) {
        if (!name || into[name]) continue;
        if (roster[name]) into[name] = cloneOverride(roster[name]!);
      }
      return into;
    };

    const sayModal = (message: string, ok = false) => {
      squadModalNote.textContent = message;
      squadModalNote.hidden = !message;
      squadModalNote.classList.toggle('is-ok', ok);
    };

    const closeSquadModal = () => {
      draft = null;
      squadModal.hidden = true;
      squadModalPick.replaceChildren();
      squadModalTune.replaceChildren();
      sayModal('');
    };

    /** 育成とキューブ。**取り込んだ値を土台にする** — 何も入れずに保存すると既定値で計算される。 */
    const renderTune = () => {
      squadModalTune.replaceChildren();
      if (!draft) return;
      const members = draft.squad.filter(Boolean);
      if (members.length === 0) {
        squadModalTune.append(createText('p',
          'ニケを選ぶと、ここで育成とハーモニーキューブを決められます。',
          'squad-tune-empty'));
        return;
      }
      // どのニケの設定を見ているか。選んでいなければ先頭
      if (!draft.tuning || !members.includes(draft.tuning)) draft.tuning = members[0]!;

      // ── キューブをまとめて付ける ──
      // ふだんは全員リロ速/弾チャで、ボスによって数人をパーツ/貫通/分配に付け替える運用。
      // 1人ずつ «個別設定 → キューブ» を開くと5回の往復になるので、まず全員に敷いてから
      // 変えたい人だけ下で直せるようにする。畳んでいても使えるようにこの位置に置く。
      {
        const bulk = el('div', 'squad-cube-bulk');
        bulk.append(createText('span', 'キューブをまとめて付ける', 'squad-cube-label'));
        const cubePick = el('select') as HTMLSelectElement;
        cubePick.dataset.squadCubeName = '';
        cubePick.setAttribute('aria-label', '全員に付けるキューブ');
        {
          // «無し» も選べるようにする — 明示できないと、既定キューブを外して
          // 素の値を確かめる手段がない
          const option = document.createElement('option');
          option.value = NO_CUBE;
          option.textContent = 'キューブなし';
          cubePick.append(option);
        }
        for (const [cubeName, meta] of Object.entries(settings.cubes)) {
          const option = document.createElement('option');
          option.value = cubeName;
          // 名前だけだと «どれがリロ速か» が分からない。効果の中身を添える
          // (「戦闘開始時 リロード速度…」の主要部だけ。数値はレベルで変わるので出さない)
          const effect = cubeTemplate(meta.template)
            .replace(/\{\d\}/g, '')           // 数値はレベルで変わるので出さない (複数あるものもある)
            .replace(/[「」▲▼]/g, '')
            .replace(/^[^\s「]*時\s*/, '')     // 「戦闘開始時」「10発射撃した時」などの前置き
            .replace(/％(?=\d)/g, ' ')         // 数値を抜いた後、次の数字と癒着した単位
            .replace(/[％%発、]\s*$/, '')      // 末尾に残る単位・読点
            .replace(/^[、\s]+/, '')
            .trim();
          option.textContent = effect ? `${labelForCube(cubeName)} — ${effect}` : labelForCube(cubeName);
          cubePick.append(option);
        }
        // 既定の選択は**実キューブの先頭** — «なし» を既定にすると、押した人の
        // 大半 (リロ速を敷きたい人) が一手損する。«なし» は選べれば足りる
        const firstCube = Object.keys(settings.cubes)[0];
        if (draft.bulkCube && (draft.bulkCube === NO_CUBE || settings.cubes[draft.bulkCube])) {
          cubePick.value = draft.bulkCube;
        } else if (firstCube) {
          cubePick.value = firstCube;
        }
        const levelPick = el('select') as HTMLSelectElement;
        levelPick.dataset.squadCubeLevel = '';
        levelPick.setAttribute('aria-label', '付けるキューブのレベル');
        const fillLevels = () => {
          levelPick.replaceChildren();
          levelPick.disabled = cubePick.value === NO_CUBE;
          if (levelPick.disabled) return;
          const meta = settings.cubes[cubePick.value];
          const levels = Object.keys(meta?.levels ?? {}).map(Number).sort((a, b) => a - b);
          for (const level of levels) {
            const option = document.createElement('option');
            option.value = String(level);
            option.textContent = `Lv${level}`;
            levelPick.append(option);
          }
          // 手持ちのキューブは上げてあることが多いので、既定は最大
          const wanted = draft?.bulkCubeLevel;
          levelPick.value = wanted && levels.includes(wanted) ? String(wanted) : String(levels[levels.length - 1] ?? 15);
        };
        fillLevels();
        cubePick.addEventListener('change', () => {
          if (draft) draft.bulkCube = cubePick.value;
          fillLevels();
        });
        levelPick.addEventListener('change', () => {
          if (draft) draft.bulkCubeLevel = Number(levelPick.value);
        });
        const applyAll = el('button', 'roster-import', '全員に付ける');
        (applyAll as HTMLButtonElement).type = 'button';
        applyAll.dataset.squadCubeApply = '';
        applyAll.addEventListener('click', () => {
          if (!draft) return;
          const cubeName = cubePick.value;
          const isNone = cubeName === NO_CUBE;
          const level = isNone ? 0 : Number(levelPick.value);
          draft.bulkCube = cubeName;
          draft.bulkCubeLevel = level;
          // 付ける前の実効と比べる。既定で同じものが効いていたなら «数値は変わらない» と
          // 言っておく — これを黙っていたせいで «キューブが壊れている» に見えた
          const members = draft.squad.filter(Boolean);
          const snapshotNow = draft.characters;
          const unchanged = members.every((name) => {
            const worn = effectiveCube(name, snapshotNow);
            return isNone ? worn.cube === null
              : worn.cube?.name === cubeName && worn.cube.level === level;
          });
          for (const name of members) {
            // 設定が無いニケは既定 (取り込んだ値が敷いてあればそれ) から起こす。
            // キューブだけの部分的な設定は作れない — 個別設定は1塊で持つ約束
            const base = draft.characters[name] ?? defaultCharacterOverrides(name, settings);
            base.cube = { name: cubeName as never, level };
            draft.characters[name] = base;
          }
          renderTune();
          const what = isNone ? 'キューブなし' : `${labelForCube(cubeName)} Lv${level}`;
          sayModal(`${members.length}人全員に ${what} を付けました。`
            + (unchanged ? ' すでに全員この設定で計算されていたので、理論値は変わりません。'
              : ' 個別に変えたい人は下で直せます。'), true);
        });
        bulk.append(cubePick, levelPick, applyAll);
        squadModalTune.append(bulk);
      }

      if (!draft.tuneOpen) {
        // «選んで保存» を最短にする。詰めたい人だけ開く (Codex と検討した案2)。
        // 押さなくても、**いまの育成値がこの候補に固定保存される**ことは言っておく —
        // 後からロスターを取り込み直しても、この候補は保存時の値のまま
        const openTune = el('button', 'roster-import', '育成・キューブを詰める (任意)');
        (openTune as HTMLButtonElement).type = 'button';
        openTune.dataset.squadTuneOpen = '';
        openTune.addEventListener('click', () => {
          if (!draft) return;
          draft.tuneOpen = true;
          renderTune();
        });
        squadModalTune.append(openTune);
        squadModalTune.append(createText('p',
          'そのまま保存すると、いまの育成値でこの候補が固定されます。',
          'squad-tune-lede'));
        return;
      }

      const imported = Object.keys(roster).length > 0;
      squadModalTune.append(createText('p',
        imported
          ? '取り込んだ育成の値が入っています。この編成だけ変えたいときは「個別設定」を入れて直してください。'
          : 'まだ育成を取り込んでいないので、既定の育成 (最大) で計算します。「個別設定」を入れると手で決められます。',
        'squad-tune-lede'));

      const tabs = el('div', 'squad-tune-tabs');
      for (const name of members) {
        const on = name === draft.tuning;
        const tab = button('', `squad-tune-tab${on ? ' is-on' : ''}`, () => {
          if (!draft) return;
          draft.tuning = name;
          renderTune();
        });
        tab.dataset.squadTune = name;
        tab.setAttribute('aria-pressed', String(on));
        const meta = catalogByName.get(name);
        if (meta?.image) {
          const img = document.createElement('img');
          img.src = `${import.meta.env.BASE_URL}${meta.image}`;
          img.alt = '';
          img.loading = 'lazy';
          tab.append(img);
        }
        tab.append(createText('span', labelFor(name), 'squad-tune-name'));
        // どのキューブで**計算されるか**をタブで見せる (実効 = この編成 ?? 取込 ?? 既定)
        const worn = effectiveCube(name, draft.characters);
        if (worn.cube) {
          const nick = cubeNickname(worn.cube.name);
          const mark = createText('b', worn.source === 'plan' ? nick : `${nick}◦`, 'squad-tune-mark');
          mark.title = `${labelForCube(worn.cube.name)} Lv${worn.cube.level}`
            + (worn.source === 'plan' ? '' : ` — ${CUBE_SOURCE_LABELS[worn.source]}`);
          tab.append(mark);
        } else if (draft.characters[name]) {
          tab.append(createText('b', '設定あり', 'squad-tune-mark'));
        }
        tabs.append(tab);
      }
      squadModalTune.append(tabs);

      const panel = el('div', 'squad-tune-panel');
      panel.dataset.squadTunePanel = draft.tuning;
      squadModalTune.append(panel);
      renderCharacterSettings(
        panel,
        draft.tuning,
        settings,
        draft.characters[draft.tuning],
        (next) => {
          if (!draft) return;
          if (next) draft.characters[draft.tuning!] = next;
          else delete draft.characters[draft.tuning!];
          renderTune();
        },
        undefined,
        undefined,
        undefined,
        draft.squad.filter(Boolean),
      );
    };

    /**
     * バッファーのテンプレートの棚。
     *
     * 型を当てるときは**空き枠にだけ**入れる (選んだアタッカーを潰さない)。
     * 既に居るニケは二重に入れない。個別設定 (キューブ) は下書きに居ないニケの
     * ぶんだけ型から運ぶ — 既に触った設定を型で上書きしない。
     */
    const renderTemplateShelf = (): HTMLElement => {
      const shelf = el('div', 'squad-tpl');
      const head = el('div', 'squad-tpl-head');
      head.append(createText('b', 'バッファーのテンプレート', 'squad-tpl-title'));
      const save = el('button', 'roster-import', 'いまの編成を型として保存');
      (save as HTMLButtonElement).type = 'button';
      save.dataset.squadTplSave = '';
      save.disabled = !draft || draft.squad.every((name) => !name);
      save.title = 'B1/B2 の定番など、よく使う組を型にしておくと、次からは型から始めてアタッカーを足すだけで済みます';
      save.addEventListener('click', () => {
        if (!draft) return;
        const result = addTemplate(squadTemplates, draft.squad, draft.characters);
        if (!result.added) {
          sayModal(result.reason === 'duplicate' ? '同じ顔ぶれの型が既にあります。'
            : result.reason === 'full' ? `型は ${MAX_TEMPLATES}件までです。使っていないものを ✕ で消してください。`
              : 'ニケを1人も選んでいません。');
          return;
        }
        squadTemplates = result.items;
        const kept = saveTemplates(resolveStorage(), squadTemplates);
        sayModal(kept ? `${draft.squad.filter(Boolean).length}人の型を保存しました。どの属性のモーダルからも使えます。`
          : 'この画面では使えますが、ブラウザに保存できませんでした (次に開くと消えます)。', kept);
        renderSquadModal();
      });
      head.append(save);
      shelf.append(head);

      if (squadTemplates.length === 0) {
        shelf.append(createText('p',
          'まだ型がありません。定番の B1/B2 を選んで「いまの編成を型として保存」すると、ここに並びます。',
          'squad-tpl-empty'));
        return shelf;
      }

      const rowBox = el('div', 'squad-tpl-rows');
      for (const template of squadTemplates) {
        const row = el('div', 'squad-tpl-row');
        row.dataset.squadTpl = template.id;

        const use = el('button', 'squad-tpl-use');
        (use as HTMLButtonElement).type = 'button';
        use.dataset.squadTplUse = template.id;
        use.title = '空き枠にこの型を入れます (選んだニケは潰しません)';
        for (const name of template.squad.filter(Boolean)) {
          const face = el('span', 'squad-tpl-face');
          const meta = catalogByName.get(name);
          if (meta?.image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${meta.image}`;
            img.alt = '';
            img.loading = 'lazy';
            face.append(img);
          }
          face.title = labelFor(name);
          use.append(face);
        }
        use.append(createText('span', 'この型から', 'squad-tpl-go'));
        use.setAttribute('aria-label',
          `${template.squad.filter(Boolean).map((name) => labelFor(name)).join('・')} の型を空き枠に入れる`);
        use.addEventListener('click', () => {
          if (!draft) return;
          const result = applyTemplate(draft.squad, template);
          draft.squad = result.squad;
          // 型の個別設定は «まだ触っていないニケ» にだけ敷く。触った設定を型で潰さない
          for (const [name, value] of Object.entries(template.characters ?? {})) {
            if (result.applied.includes(name) && !draft.characters[name]) {
              draft.characters[name] = cloneOverride(value);
            }
          }
          seedFromRoster(draft.squad, draft.characters);
          renderSquadModal();
          const parts: string[] = [];
          if (result.applied.length > 0) parts.push(`${result.applied.map(labelFor).join('・')} を入れました。`);
          else parts.push('型のニケは全員もう入っています。');
          if (result.overflow.length > 0) {
            parts.push(`${result.overflow.map(labelFor).join('・')} は枠が足りず入りませんでした。`);
          }
          sayModal(parts.join(' '), result.applied.length > 0);
        });
        row.append(use);

        const drop = el('button', 'squad-tpl-drop', '✕');
        (drop as HTMLButtonElement).type = 'button';
        drop.dataset.squadTplDrop = template.id;
        drop.setAttribute('aria-label', 'この型を消す');
        drop.title = 'この型を消す (候補には影響しません)';
        drop.addEventListener('click', () => {
          squadTemplates = removeTemplate(squadTemplates, template.id);
          saveTemplates(resolveStorage(), squadTemplates);
          renderSquadModal();
        });
        row.append(drop);
        rowBox.append(row);
      }
      shelf.append(rowBox);
      return shelf;
    };

    const renderSquadModal = () => {
      if (!draft) return;
      squadModalTitle.textContent = draft.id ? '編成を直す'
        : draft.fromCopy ? 'コピーして直す' : '編成を追加';
      squadModalDesc.textContent = `${elementLabel(draft.code)}編成 — ${draft.boss.name} (${elementLabel(draft.boss.elementCode)}ボス) に当てます。`;
      squadModalPick.replaceChildren(renderTemplateShelf(), renderPicker({
        squad: draft.squad,
        wanted: draft.code,
        mark: 'modal',
        redraw: renderSquadModal,
        onChange: (next) => {
          if (!draft) return;
          draft.squad = next;
          // 外したニケの個別設定は連れて行かない (保存時にも落とすが、画面からも消す)
          for (const name of Object.keys(draft.characters)) {
            if (!next.includes(name)) delete draft.characters[name];
          }
          seedFromRoster(next, draft.characters);
          renderSquadModal();
        },
      }));
      renderTune();
      squadModalSave.disabled = draft.squad.every((name) => !name);
    };

    /**
     * モーダルを開く。`plan` を渡すとその候補を直す。`copy: true` なら**写しを新規として**開く —
     * 中身は同じでも id を持たないので、保存すると別の候補になる。
     */
    const openSquadModal = (
      code: PlanElement, boss: UnionBoss, plan?: ElementPlan, opts?: { copy?: boolean },
    ) => {
      // 個別設定は**深く写す**。浅い写しだと、コピー側でキューブを変えたときに
      // 元の候補のスナップショットまで書き換わることがある
      const cloned = Object.fromEntries(Object.entries(plan?.characters ?? {})
        .map(([name, value]) => [name, cloneOverride(value)]));
      draft = {
        code,
        boss,
        id: opts?.copy ? null : plan?.id ?? null,
        squad: plan ? [...plan.squad] : ['', '', '', '', ''],
        // 取り込んだロスターを土台にする。何も入れずに保存すると既定値 (最大) で計算され、
        // «自分の育成の数字» のつもりで見てしまう
        characters: seedFromRoster(plan?.squad ?? [], cloned),
        tuning: null,
        // «選ぶ → 保存» を最短にする。育成・キューブは畳んでおき、押した人にだけ出す。
        // 「直す」で開いたときは**詰めるのが目的**なので開いておく
        tuneOpen: Boolean(plan) && !opts?.copy,
        fromCopy: opts?.copy === true,
      };
      // 前回の検索語・絞り込みが残っていると「一覧に1人しか居ない?」になる (実機監査)。
      // 開くたびに白紙から
      resetPickerFilters();
      sayModal('');
      squadModal.hidden = false;
      renderSquadModal();
    };

    // 「編成を作る・詳細計算」タブで組んであるデッキを下書きへ写す。
    // 以前は行に «即保存» の釦があり、どこから登録するのかが二筋になっていた —
    // モーダルの中の副操作に格下げして、保存は必ず利用者が押す形にする
    element<HTMLButtonElement>(root, '[data-squad-modal-load]').addEventListener('click', () => {
      if (!draft) return;
      const deck = activeDeck();
      if (deck.squad.every((name) => !name)) {
        sayModal('詳細計算タブの編成が空です。先にあちらでニケを入れてあると、ここに写せます。');
        return;
      }
      draft.squad = [...deck.squad];
      draft.characters = seedFromRoster(draft.squad, Object.fromEntries(
        Object.entries(snapshotOf(deck)).map(([name, value]) => [name, cloneOverride(value)])));
      draft.tuning = null;
      renderSquadModal();
      sayModal('詳細計算のデッキを写しました。保存を押すまで候補には入りません。', true);
    });

    // バースト順やタイムラインまで詰めたいときの出口。モーダルは閉じる
    element<HTMLButtonElement>(root, '[data-plans-apply]').addEventListener('click', () => {
      if (!draft) return;
      if (draft.squad.every((name) => !name)) { sayModal('ニケを1人も選んでいません。'); return; }
      const { code, squad, characters } = draft;
      applySquadToDeck(squad, characters);
      closeSquadModal();
      say(code, `この編成を詳細計算のデッキ ${activeDeckId} に入れました。`, true);
      // 「開く」と言っているのだから**実際に詳細計算へ移る** — デッキだけ差し替えて
      // 同じ画面に留まると、押しても何も起きていないように見える (実際そう報告された)
      switchView('calc');
      scrollTo(squadGrid);
    });

    // タイルと★が全部 Tab 経路にあり、保存まで約45押しかかる (実機監査) —
    // キーボードには近道を用意する
    squadModal.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !squadModalSave.disabled) {
        squadModalSave.click();
      }
    });
    squadModalSave.title = 'Ctrl+Enter でも保存できます';

    squadModalSave.addEventListener('click', () => {
      if (!draft) return;
      const { code, id, squad, characters } = draft;
      const result = id
        ? updatePlan(plans, code, id, squad, { characters })
        : addPlan(plans, code, squad, { characters });
      const ok = 'added' in result ? result.added : result.updated;
      if (!ok) {
        sayModal(result.reason === 'full'
          ? `この行は既に ${MAX_PLANS_PER_ELEMENT} 候補あります。どれかを消してから足してください。`
          : result.reason === 'duplicate' ? '同じ顔ぶれ・同じ設定の候補が既にあります。'
            : result.reason === 'missing' ? 'この候補は見つかりませんでした (別の画面で消された可能性があります)。'
              : 'ニケを1人も選んでいません。');
        return;
      }
      const kept = commit(result.plans);
      closeSquadModal();
      if (!kept) say(code, 'この画面では使えますが、ブラウザに保存できませんでした (次に開くと消えます)。');
      else {
        const count = squad.filter(Boolean).length;
        // 4人編成は意図的なこともある — 止めずに、人数だけ言っておく
        const fewNote = count < 5 ? ` (${count}人編成 — 5人まで入ります)` : '';
        say(code, id ? `編成を直しました${fewNote}。理論値は出し直してください。`
          : `編成を足しました${fewNote}。`, true);
      }
    });
    element<HTMLButtonElement>(root, '[data-squad-modal-close]').addEventListener('click', closeSquadModal);
    element<HTMLButtonElement>(root, '[data-squad-modal-cancel]').addEventListener('click', closeSquadModal);
    // 覆いを押しても閉じる。中を押したときは閉じない
    squadModal.addEventListener('click', (event) => {
      if (event.target === squadModal) closeSquadModal();
    });

    // ── レイド準備の先頭に出す «取り込みの状態» ──
    // 最終取込は3凸ボードの帯にしか無く、ここで作業している間は見えなかった。
    // 相対時刻だけだと «前のシーズンの取込» と区別できないので絶対日時も添える。
    const prepSyncDot = element<HTMLElement>(root, '[data-prep-sync-dot]');
    const prepSyncMain = element<HTMLElement>(root, '[data-prep-sync-main]');
    const prepSyncSub = element<HTMLElement>(root, '[data-prep-sync-sub]');
    const prepSyncGo = element<HTMLButtonElement>(root, '[data-prep-sync-go]');
    renderPrepSync = () => {
      const count = Object.keys(roster).length;
      prepSyncDot.classList.toggle('is-on', Boolean(syncMeta));
      if (syncMeta) {
        prepSyncMain.textContent = `${SOURCE_LABELS[syncMeta.source]} から取込済み · ${syncMeta.matched}名`;
        // 12日以上経っていたら «新しいレイドの始め方» を促す。前回の盤面と «最新» バッジが
        // 残ったままなので、正しい入口 (ボスを直す → 出し直す) が画面から読めない (実機監査)
        const days = Math.floor((Date.now() - Date.parse(syncMeta.at)) / 86_400_000);
        prepSyncSub.textContent = `最終取込 ${syncAgoText(syncMeta.at)} · ${syncAtText(syncMeta.at)}`
          + (days >= 12 ? ' — 新しいレイドなら、まずボスの登録を直して「ぜんぶ出す」から' : '');
        prepSyncGo.textContent = '取り込み直す';
      } else {
        prepSyncMain.textContent = count > 0
          ? `ロスター ${count}名を適用中` : 'まだ育成状況を取り込んでいません';
        // 取り込まないと «既定の育成 (最大)» の数字になる — それを黙っていると、
        // 出た理論値を自分の育成の値だと思い込む
        prepSyncSub.textContent = count > 0 ? ''
          : '取り込むまでは既定の育成 (最大) で計算します';
        prepSyncGo.textContent = '取り込む';
      }
    };
    prepSyncGo.addEventListener('click', () => {
      switchView('board');
      openBoardImport();
    });
    renderPrepSync();
    const bossSetupNote = element<HTMLElement>(root, '[data-boss-setup-note]');

    const sayBossSetup = (message: string, ok = false) => {
      bossSetupNote.textContent = message;
      bossSetupNote.hidden = !message;
      bossSetupNote.classList.toggle('is-ok', ok);
    };

    /**
     * ボスを1体書き換える。
     *
     * 名前を変えたら**盤面の枠も連れて行く** — 枠はボスを名前で覚えているので、
     * migrate しないと «そんなボスは居ない» ことになって枠が空になる。
     */
    const editBoss = (code: string, patch: Partial<UnionBoss>) => {
      const before = bosses.find((boss) => boss.elementCode === code);
      bosses = withBoss(bosses, code, patch);
      const after = bosses.find((boss) => boss.elementCode === code);
      if (before && after && before.name !== after.name) {
        // 盤面はこのブロックからは触れないので、前方宣言した読み書きを通す
        const raw = readBoard() as RaidBoard | null;
        if (raw && Array.isArray(raw.slots) && raw.slots.some((slot) => slot.boss === before.name)) {
          writeBoardFrom({
            ...raw,
            slots: raw.slots.map((slot) => (slot.boss === before.name
              ? { ...slot, boss: after.name } : slot)),
          });
        }
      }
      const saved = saveBosses(resolveStorage(), bosses);
      sayBossSetup(saved ? '' : 'この画面では使えますが、ブラウザに保存できませんでした (次に開くと戻ります)。');
      renderBossPick();
      renderBossPresets();
      // 準備表はボスの値も候補の鮮度も両方を描く。片方だけ描き直すと、
      // 条件を変えたのに «今回のボス条件» と出たままになる (テストで捕まえた)
      renderPlans();
      renderBoard();
    };


    bossReset.addEventListener('click', () => {
      bosses = clearBosses(resolveStorage());
      sayBossSetup('出荷時の値に戻しました。', true);
      renderBossPick();
      renderBossPresets();
      renderPlans();
      renderBoard();
    });

    renderBossPick();

    // ── ぜんぶ計算する ────────────────────────────────────────────────────
    // 使い方は «候補を貯める → 今回のボスを入れる → まとめて計算 → 結果を見る →
    // 最良の3凸を探す»。探すボタンの中で暗黙に計算していたので、何十秒も «押しても
    // 無反応» に見えていた。段として切り出し、進み具合をバーで出す。
    //
    // **盤面の探索とまったく同じ条件で計算する** (boardBattle)。条件がずれると、
    // ここで出した値を «全ボスから自動で探す» が使えず、また全部計算し直しになる。
    const batchRun = element<HTMLButtonElement>(root, '[data-plans-batch-run]');
    const batchBar = element<HTMLElement>(root, '[data-plans-batch-bar]');
    const batchFill = element<HTMLElement>(root, '[data-plans-batch-fill]');
    const batchNote = element<HTMLElement>(root, '[data-plans-batch-note]');

    /**
     * «どの条件で出した値か» の署名。
     *
     * 理論値を数字だけ覚えると、ボスの登録 (防御力・コア) や戦闘時間を変えたあとに
     * **古い値を今の値と見比べてしまう**。登録と一緒に持たせて、画面で見分ける。
     */
    const condSignature = (boss: UnionBoss, battle: BattleSettings) => [
      boss.name,
      boss.enemyDef ?? battle.enemyDef,
      boss.coreEnabled ? `core${boss.corePx ?? 0}` : 'core-',
      boss.hasParts ? 'parts' : 'parts-',
      `${battle.duration}s`,
    ].join('/');

    const sayBatch = (message: string, ok = false) => {
      batchNote.textContent = message;
      batchNote.hidden = !message;
      batchNote.classList.toggle('is-ok', ok);
    };
    const showBar = (done: number, total: number) => {
      batchBar.hidden = total === 0;
      const share = total > 0 ? Math.round((done / total) * 100) : 0;
      batchFill.style.width = `${share}%`;
      batchBar.setAttribute('aria-valuenow', String(share));
    };
    batchBar.setAttribute('role', 'progressbar');
    batchBar.setAttribute('aria-valuemin', '0');
    batchBar.setAttribute('aria-valuemax', '100');
    batchBar.setAttribute('aria-label', '計算の進み具合');

    /**
     * 貯めた候補を、今回のボス条件で計算して登録する。
     *
     * `only` にボスの属性コードを渡すとその行だけ回す — 1行足しただけで
     * 全部を回し直すのは、1件7秒台では待たせすぎる。
     */
    const runBatch = async (only?: readonly string[], opts?: { rowMark?: string }) => {
      if (comparing) { sayBatch('別の計算が走っています。終わるまで待ってください。'); return; }
      const base = readBattle();
      // 何を回すか。候補は «その属性のボス» にだけ当てる (有利属性でしか凸らないため)
      const jobs: Array<{ key: string; request: SimulationRequest; problems: string[] }> = [];
      const owner = new Map<string, { code: PlanElement; id: string; cond: string }>();
      let skipped = 0;
      for (const code of PLAN_ELEMENTS) {
        const boss = bossForElement(code, bosses);
        if (!boss) continue;
        if (only && !only.includes(boss.elementCode)) continue;
        const battle = boardBattle(base, boss);
        const cond = condSignature(boss, battle);
        for (const plan of plansOf(plans, code)) {
          // **今回の条件の値が既にある候補は飛ばす**。キューブを1件だけ変えて押し直したとき、
          // 残り49件を回し直すと7秒 × 49 待つことになる — 変えた1件だけが回ればよい
          // (値は条件と編成で決まるので、同じ条件で出し直しても同じ数字になる)
          if (plan.registered?.cond === cond) {
            skipped += 1;
            continue;
          }
          const deck: DeckState = {
            id: 1,
            squad: [...plan.squad],
            characters: charactersWith(plan.squad, plan.characters),
          };
          const request = requestForDeck(deck, battle);
          const key = cacheKey(request, version);
          if (!owner.has(key)) {
            owner.set(key, { code, id: plan.id, cond });
            jobs.push({
              key,
              request,
              problems: [...validateRequest(request), ...validateCharacterValues(deck)],
            });
          }
        }
      }
      if (jobs.length === 0) {
        if (skipped > 0) {
          // 全部出してあるなら、それは失敗ではない
          sayBatch(`${skipped}件すべて、今回のボス条件の理論値が出ています。`, true);
        } else {
          sayBatch('編成がまだありません。下の行の「＋ 編成を追加」から作ってください。');
        }
        return;
      }
      comparing = true;
      batchRun.disabled = true;
      const label = batchRun.textContent;
      showBar(0, jobs.length);
      sayBatch(`${jobs.length}件の理論値を出します… 0/${jobs.length}`);
      try {
        await prepared;
        const run = await runScores(jobs, {
          simulate: (request) => client.simulate(request),
          cache: { get: (key) => cache.get(key), set: (key, result) => { cache.set(key, result); } },
          lanes: parallelOn ? parallelCount : 1,
          onProgress: (done, total) => {
            showBar(done, total);
            batchRun.textContent = `${done}/${total} 計算中`;
            sayBatch(`${total}件の理論値を出しています… ${done}/${total}`);
            // 行のボタンから押したなら、その行にも進捗を出す — 上のパネルは
            // 5体目の行やスマホでは視界の外 (実測 y=-3,100px)
            if (opts?.rowMark) {
              const rowButton = groupsBox.querySelector<HTMLButtonElement>(
                `[data-prep-row-run="${opts.rowMark}"]`);
              if (rowButton) rowButton.textContent = `${done}/${total} 計算中`;
              const badge = groupsBox.querySelector<HTMLElement>(
                `[data-prep-state="${opts.rowMark}"]`);
              if (badge) badge.textContent = '計算中';
            }
          },
        });
        // 出た値は候補に**登録する**。ここが «編成とダメージを登録» の実体で、
        // 開き直しても残る (計算結果のキャッシュは30件しか持てず、50候補では溢れる)。
        const at = new Date().toISOString();
        for (const [key, damage] of run.scores) {
          const who = owner.get(key);
          if (!who) continue;
          plans = registerScore(plans, who.code, who.id, {
            damage, duration: base.duration, at, cond: who.cond,
          });
        }
        const persisted = savePlans(resolveStorage(), plans);
        renderPlans();
        renderBoard();
        showBar(jobs.length, jobs.length);
        const failed = run.failures.size;
        const done = run.scores.size;
        const parts = [`${jobs.length}件中 ${done}件の理論値を出しました。`];
        if (skipped > 0) parts.push(`出してあった${skipped}件は飛ばしました。`);
        if (failed > 0) parts.push(`${failed}件は計算できませんでした (${[...run.failures.values()][0]})。`);
        if (!persisted) parts.push('ブラウザに保存できなかったので、開き直すと消えます。');
        else parts.push('下の「最適3凸を探す」がこの値を使います。');
        sayBatch(parts.join(' '), failed === 0 && persisted);
        // 行から押したなら、結果はその行の下にも出す (renderPlans の描き直し後)
        if (opts?.rowMark) {
          const code = counterOf(opts.rowMark);
          if (code) say(code, parts.join(' '), failed === 0 && persisted);
        }
      } catch (error) {
        sayBatch(`計算に失敗しました — ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        comparing = false;
        batchRun.disabled = false;
        batchRun.textContent = label;
      }
    };
    batchRun.addEventListener('click', () => { void runBatch(); });

    // 「最適3凸を探す」— ここまでの段の**次の一手**を明示する。
    // 以前は «3凸ボードの「全ボスから自動で探す」がこの値を使います» と文章で言うだけで、
    // 行き先のボタンが無かった (Codex の指摘)。
    prepGo.addEventListener('click', () => {
      switchView('board');
      // 盤面が描かれてから押す。同じフレームで押すと、まだ古い盤面のボタンを掴む
      requestAnimationFrame(() => {
        root.querySelector<HTMLButtonElement>('[data-board-search-best]')?.click();
      });
    });
    // 凸する属性を自分で決めたい人の道。最適3凸タブの「属性を決めて最適化」へ連れて行き、
    // どこを触ればよいかが分かるように一瞬だけ光らせる (自動では回さない — 属性を選ぶのは本人)
    element<HTMLButtonElement>(root, '[data-prep-go-elements]').addEventListener('click', () => {
      switchView('board');
      requestAnimationFrame(() => {
        const row = root.querySelector<HTMLElement>('[data-board-elements]');
        if (!row) return;
        scrollTo(row);
        row.classList.remove('is-spotlit');
        void row.offsetWidth;   // クラスを付け直してアニメーションを確実に再生する
        row.classList.add('is-spotlit');
        // キーボードの人はタブ切替でフォーカスが行き場を失う — 最初の属性選択へ移し、
        // 読み上げにも行き先を伝える (光るだけでは目の合図にしかならない)
        row.querySelector<HTMLSelectElement>('select')?.focus();
        const status = root.querySelector<HTMLElement>('[data-board-status]');
        if (status) {
          status.textContent = '「属性を決めて最適化」に移動しました。3つの属性を選んで「この3属性で最適化」を押してください。';
          status.hidden = false;
          status.classList.remove('is-ok');
        }
      });
    });

    const sayBoss = (message: string, ok = false) => {
      bossNote.textContent = message;
      bossNote.hidden = !message;
      bossNote.classList.toggle('is-ok', ok);
    };

    const runOne = async (plan: ElementPlan, battle: BattleSettings) => {
      const deck: DeckState = {
        id: 1,
        squad: [...plan.squad],
        characters: charactersWith(plan.squad, plan.characters),
      };
      const request = requestForDeck(deck, battle);
      // 「計算」と同じ検証を通す — 通常計算が弾く値 (範囲外のオーバーロード等) を
      // 比較だけが素通りさせると、そこだけ違う結果が出て理由が分からなくなる
      const problems = [...validateRequest(request), ...validateCharacterValues(deck)];
      if (problems.length > 0) throw new Error(problems[0]!);
      const key = cacheKey(request, version);
      const hit = cache.get(key);
      if (hit) return hit.squadTotal;
      const result = await client.simulate(request);
      cache.set(key, result);
      return result.squadTotal;
    };

    const runBossCheck = async () => {
      if (comparing) { sayBoss('別の比較が走っています。終わるまで待ってください。'); return; }
      const boss = bosses[Number(bossPick.value)];
      if (!boss) return;
      const code = counterOf(boss.elementCode);
      if (!code) { sayBoss('このボスのコードに対応する編成がありません。'); return; }
      const saved = plansOf(plans, code);
      if (saved.length === 0) {
        sayBoss(`${elementLabel(code)} の候補がまだありません。先に「今の編成を保存」で登録してください。`);
        bossResult.replaceChildren();
        return;
      }
      const base = readBattle();
      const plain = baselineBattle(base, code);
      // コアとパーツは**ボスに登録された値**。以前はここのチェックボックスで、
      // 盤面の計算 (全ボス一律 «無し») と食い違っていた。
      const withBossCond = bossConditionBattle(base, boss, {
        coreEnabled: boss.coreEnabled === true, hasParts: boss.hasParts === true,
      });
      comparing = true;
      bossRun.disabled = true;
      bossResult.replaceChildren();
      try {
        await prepared;
        const rows: Array<{ index: number; squad: string[]; plain: number; boss: number }> = [];
        let done = 0;
        for (const [index, plan] of saved.entries()) {
          sayBoss(`計算中… ${done}/${saved.length * 2}`);
          const plainTotal = await runOne(plan, plain);
          done += 1;
          sayBoss(`計算中… ${done}/${saved.length * 2}`);
          const bossTotal = await runOne(plan, withBossCond);
          done += 1;
          rows.push({ index: index + 1, squad: plan.squad, plain: plainTotal, boss: bossTotal });
        }
        const bestPlain = Math.max(...rows.map((row) => row.plain));
        const bestBoss = Math.max(...rows.map((row) => row.boss));
        const rankOf = (value: number, all: number[]) =>
          all.filter((other) => other > value).length + 1;
        const plainAll = rows.map((row) => row.plain);
        const bossAll = rows.map((row) => row.boss);

        const table = el('table', 'plans-boss-table');
        const head = document.createElement('tr');
        for (const label of ['候補', '編成', '基準 (癖なし)', `${boss.name}`, '順位']) {
          head.append(createText('th', label));
        }
        table.append(head);
        for (const row of rows) {
          const tr = document.createElement('tr');
          tr.dataset.plansBossRow = String(row.index);
          tr.append(createText('td', `候補 ${row.index}`));
          tr.append(createText('td', row.squad.filter(Boolean).map(labelFor).join(' / '), 'plans-boss-members'));
          const plainRank = rankOf(row.plain, plainAll);
          const bossRank = rankOf(row.boss, bossAll);
          tr.append(createText('td',
            `${formatDamage(row.plain)} (${bestPlain > 0 ? Math.round((row.plain / bestPlain) * 1000) / 10 : 0}%)`));
          tr.append(createText('td',
            `${formatDamage(row.boss)} (${bestBoss > 0 ? Math.round((row.boss / bestBoss) * 1000) / 10 : 0}%)`));
          // 順位が動いたかどうかが、この画面で一番読みたいこと
          const moved = plainRank !== bossRank;
          tr.append(createText('td',
            moved ? `${plainRank}位 → ${bossRank}位` : `${bossRank}位 (変わらず)`,
            moved ? 'plans-boss-moved' : undefined));
          table.append(tr);
        }
        bossResult.append(table);
        const changed = rows.some((row) =>
          rankOf(row.plain, plainAll) !== rankOf(row.boss, bossAll));
        sayBoss(changed
          ? 'このボスの条件では順位が入れ替わります — 右端を見てください。'
          : 'このボスの条件でも順位は変わりませんでした。', !changed);
      } catch (error) {
        sayBoss(`計算に失敗しました — ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        comparing = false;
        bossRun.disabled = false;
      }
    };
    // ── 基準条件で比べる (詳細) ──
    // «ぜんぶ計算» が今回のボス条件で回すのに対し、こちらはボス固有の癖を外した
    // 同じ土台で並べ直す。主導線からは外してある — 通常は上の «ぜんぶ計算» で足りる。
    {
      const baselineRow = element<HTMLElement>(root, '[data-plans-baseline-row]');
      for (const code of PLAN_ELEMENTS) {
        const button = el('button', 'roster-import', `${elementLabel(code)}編成を比べる`);
        (button as HTMLButtonElement).type = 'button';
        button.dataset.plansCompare = code;
        button.title = `${elementLabel(BEATS[code])}ボスの癖を外した同じ条件で、${elementLabel(code)}の候補を順に計算します`;
        button.addEventListener('click', () => { void comparePlans(code, button as HTMLButtonElement); });
        baselineRow.append(button);
      }
    }

    bossRun.addEventListener('click', () => { void runBossCheck(); });

    // 同じ土俵 (ボスの癖なし) で順に計算し、最大値を 100% として並べる。
    const comparePlans = async (code: PlanElement, button: HTMLButtonElement) => {
      if (comparing) { say(code, '別の比較が走っています。終わるまで待ってください。'); return; }
      const saved = plansOf(plans, code);
      if (saved.length === 0) { say(code, '比較する候補がありません。'); return; }
      const battle = baselineBattle(readBattle(), code);
      comparing = true;
      button.disabled = true;
      say(code, `計算中… 0/${saved.length}`);
      const totals = new Map<string, number>();
      try {
        await prepared;
        // 回すのは score-runner (盤面と同じ仕組み)。ここは «何を回すか» だけを決める。
        const byKey = new Map<string, string>();   // 計算の鍵 → 候補の id
        const jobs = saved.map((plan) => {
          const deck: DeckState = {
            id: 1,
            squad: [...plan.squad],
            // 候補のスナップショット (キューブ等) が最優先。無いニケはロスターの取込値
            characters: charactersWith(plan.squad, plan.characters),
          };
          const request = requestForDeck(deck, battle);
          const key = cacheKey(request, version);
          byKey.set(key, plan.id);
          return {
            key,
            request,
            problems: [...validateRequest(request), ...validateCharacterValues(deck)],
          };
        });
        const run = await runScores(jobs, {
          simulate: (request) => client.simulate(request),
          cache: { get: (key) => cache.get(key), set: (key, result) => { cache.set(key, result); } },
          lanes: parallelOn ? parallelCount : 1,
          onProgress: (done, total) => say(code, `計算中… ${done}/${total}`),
        });
        if (run.failures.size > 0) { say(code, `計算できません — ${[...run.failures.values()][0]}`); return; }
        for (const [key, total] of run.scores) totals.set(byKey.get(key)!, total);
        const best = Math.max(...totals.values());
        // 出した理論値は案に**登録**する — 「編成とダメージを登録」。再読込しても残る。
        // 保存の成否を確かめる — 失敗を握って「登録しました」と言うと、再読込で消えて嘘になる
        const registeredAt = new Date().toISOString();
        for (const [id, total] of totals) {
          plans = registerScore(plans, code, id, { damage: total, duration: battle.duration, at: registeredAt });
        }
        const persisted = savePlans(resolveStorage(), plans);
        for (const [id, total] of totals) {
          const cell = groupsBox.querySelector<HTMLElement>(`[data-plans-score="${id}"]`);
          if (!cell) continue;
          const share = best > 0 ? Math.round((total / best) * 1000) / 10 : 0;
          cell.textContent = `${formatDamage(total)} (${share}%${persisted ? ' · 登録しました' : ''})`;
          cell.classList.toggle('is-best', total === best);
        }
        renderBoard();   // 盤面の在庫表示にも登録値が効く
        // 保存に失敗したなら成功と言わない — 「登録しました」と出た直後に再読込で消えるのが一番まずい
        if (persisted) {
          say(code, `${elementLabel(BEATS[code])}ボス相当 · 戦闘 ${battle.duration}秒 · コアとパーツ無しで比較し、結果を登録しました。`, true);
        } else {
          say(code, 'この画面では比べられますが、登録をブラウザに保存できませんでした (次に開くと消えます)。');
        }
      } catch (error) {
        say(code, `計算に失敗しました — ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        comparing = false;
        button.disabled = false;
      }
    };
  }

  // ── 3凸ボード (ユニオンレイドの入口) ──
  // 3枠 × ボス。候補は属性別編成の案、点数は既存の経路 (requestForDeck → cache → simulate)。
  // 被り・代案・被りなし最大の判定は raid-board.ts。ここは描画と計算の呼び出しだけ。
  {
    const slotsBox = element<HTMLElement>(root, '[data-board-slots]');
    const totalBox = element<HTMLElement>(root, '[data-board-total]');
    const usedBox = element<HTMLElement>(root, '[data-board-used]');
    const stockBox = element<HTMLElement>(root, '[data-board-stocks]');
    const statusBox = element<HTMLElement>(root, '[data-board-status]');
    const undoButton = element<HTMLButtonElement>(root, '[data-board-undo]');
    undoButton.addEventListener('click', () => {
      const back = boardUndo;
      boardUndo = null;
      if (!back) return;
      commit(back);
      say('探す前の盤面に戻しました。', true);
    });
    // ボスは画面から登録し直せるので、**その場で引く**。マウント時に Map を作って持つと、
    // 名前を変えた瞬間に «そんなボスは居ない» ことになって枠が空になる。
    const bossNames = () => bosses.map((boss) => boss.name);
    const bossByName = (name: string) => bosses.find((boss) => boss.name === name);
    const ELEMENT_CLASS: Record<string, string> = {
      작열: 'is-fire', 수냉: 'is-water', 풍압: 'is-wind', 전격: 'is-electric', 철갑: 'is-iron',
    };
    let board: RaidBoard = loadBoard(resolveStorage(), bossNames());
    readBoard = () => board;
    writeBoardFrom = (raw) => {
      board = loadBoard({ getItem: () => JSON.stringify(raw), setItem: () => undefined, removeItem: () => undefined }, bossNames());
      saveBoard(resolveStorage(), board);
    };
    // 計算中はボタンごと作り直されるので、disabled ではなくここで二重起動を止める
    let busy = false;
    /** 「編成を変える」を開いている枠。 */
    let chooserOpen: number | null = null;
    /** 枠の中で編成を組んでいる最中の枠。null = 閉じている。 */
    let pickerOpen: number | null = null;
    let pickerQuery = '';
    /** お気に入りだけに絞るか。 */
    let pickerFavOnly = false;
    /** バースト段階の絞り込み。null = 全部。 */
    let pickerBurst: '1' | '2' | '3' | null = null;
    resetPickerFilters = () => {
      pickerQuery = '';
      pickerFavOnly = false;
      pickerBurst = null;
    };
    /** 選べるニケ。取り込んでいれば手持ちだけ、まだなら全員から選ばせる。 */
    const pickableNikke = (): CharacterMeta[] => {
      const owned = Object.keys(roster);
      return owned.length > 0 ? catalog.filter((c) => roster[c.name]) : catalog;
    };
    /**
     * この画面で出した点数。保存された結果 (cache) は容量で押し出されるので、別に持つ。
     * 鍵は**リクエストの cacheKey そのもの** — ロスターの育成値・戦闘条件・シンクロが変われば鍵も変わるので、
     * 古い条件の点数を新しい条件の数字として見せることがない (ボス+顔ぶれだけを鍵にすると起きる)。
     */
    const scores = new Map<string, number>();
    const SCORE_MEMORY = 120;

    /**
     * 自動探索で上書きする**直前**の盤面。1世代だけ。
     *
     * 「全ボスから自動で探す」「この3属性で最適化」は手作りの盤面を確認なしで丸ごと
     * 差し替える。説明には書いてあるが、2週間に1度の利用では忘れた頃に踏む (実機監査)。
     * 確認ダイアログより、押した後に戻れるほうが操作が軽い。
     */
    let boardUndo: RaidBoard | null = null;

    const say = (message: string, ok = false) => {
      statusBox.textContent = message;
      statusBox.hidden = !message;
      statusBox.classList.toggle('is-ok', ok);
      undoButton.hidden = boardUndo === null;
      lastSaid = message ? { message, ok } : null;
      // 押したボタンにも同じ進捗を出す。上部の1行だけだと、押した場所から目を離すことになる
      // (計算は1件7秒台。3件なら20秒以上、押しっぱなしで待つことになる)。
      if (runningMark) {
        const step = /(\d+)\/(\d+)/.exec(message);
        runningText = step ? `計算中 ${step[1]}/${step[2]}` : '計算中…';
        paintProgress();
      }
    };

    /**
     * いま進捗を出しているボタンの目印と、その進捗。
     *
     * **要素そのものを覚えてはいけない** — 計算中は `withBusy` が `renderBoard()` を呼ぶので
     * ボタンは作り直され、覚えていた要素は画面から外れる (最初そう書いて進捗が出なかった)。
     * 目印 (data 属性) で覚え、描き直すたびに文言を貼り直す。
     */
    let runningMark: string | null = null;
    let runningText = '';
    /**
     * 直前に say() で言ったこと。押し終わったあとに**押したボタンの隣**へ出すために持つ。
     *
     * 状態表示は盤面のいちばん上に1つしかない。幅390pxの画面で属性の行まで下ろして
     * ボタンを押すと、その1行は**594px 上** (実測) にいて見えない — 押しても何も
     * 起きないように見えていた。進捗 (計算中 n/m) はボタンに出していたが、
     * 「属性を3つ選んでください」のような**即座に弾かれる案内**と、
     * 「被りなしで組めたのは1凸ぶん…」のような**次の行動を含む結果**は届いていなかった。
     */
    let lastSaid: { message: string; ok: boolean } | null = null;

    /**
     * 押したボタンの直後に、結果の一言を出す。
     *
     * 読み上げは**しない** — 上の状態表示が role="status" で読み上げるので、
     * ここも live にすると同じことを二度言う。
     */
    const sayNear = (mark: string, said: { message: string; ok: boolean } | null) => {
      for (const old of root.querySelectorAll('.board-said')) old.remove();
      if (!said) return;
      const target = root.querySelector<HTMLElement>(`[${mark}]`);
      if (!target) return;
      const note = createText('p', said.message, said.ok ? 'board-said is-ok' : 'board-said');
      target.insertAdjacentElement('afterend', note);
    };

    /** 描き直した直後に、走っているボタンへ進捗を貼り直す。 */
    const paintProgress = () => {
      if (!runningMark) return;
      const target = root.querySelector<HTMLButtonElement>(`[${runningMark}]`);
      if (!target) return;
      target.textContent = runningText;
      target.disabled = true;
    };

    /**
     * 押している間だけ、そのボタンに進捗を出す。
     *
     * 終わったら**自分で戻す**。描き直しで戻ると思ってはいけない —
     * 盤面の中のボタンは作り直されるが、属性側のように**静的なマークアップの
     * ボタンは作り直されない**ので、無効のまま固まる (テストで捕まえた)。
     */
    const withProgress = async (mark: string, work: () => Promise<void>) => {
      const target = root.querySelector<HTMLButtonElement>(`[${mark}]`);
      const label = target?.textContent ?? '';
      runningMark = mark;
      runningText = '計算中…';
      // 前回の結果は消す。残すと «今押した結果» と見分けがつかない
      sayNear(mark, null);
      lastSaid = null;
      paintProgress();
      try {
        await work();
      } finally {
        runningMark = null;
        runningText = '';
        renderBoard();
        // 描き直されない (静的な) ボタンはここで戻す
        const still = root.querySelector<HTMLButtonElement>(`[${mark}]`);
        if (still && still === target) {
          still.textContent = label;
          still.disabled = false;
        }
        // 描き直した**あと**に出す — 先に出すと renderBoard() に消される
        sayNear(mark, lastSaid);
      }
    };

    const commit = (next: RaidBoard) => {
      board = next;
      if (!saveBoard(resolveStorage(), board)) {
        say('この画面では使えますが、ブラウザに保存できませんでした (次に開くと消えます)。');
      }
      renderBoard();
    };

    /** スナップショットの型。長いので別名。 */
    type Snapshot = Record<string, CharacterOverrides> | undefined;
    /**
     * 1枠ぶんのリクエスト。案のスナップショット (キューブ等) が最優先、
     * 無いニケはロスターが正本 — 取り込み直せば盤面も新しい値で計算される。
     */
    /**
     * base = 戦闘条件。**1回の計算のまとまり (比較・探索) では最初に読んだ条件を貫く** —
     * 計算中に計算機タブで条件を変えられると、途中から別条件の鍵になり、
     * 「計算したのに知らない値」や別条件の混ざった登録が生まれる。
     */
    const requestFor = (boss: UnionBoss, squad: readonly string[], snapshot?: Snapshot, base?: BattleSettings) => {
      const deck: DeckState = {
        id: 1,
        squad: [...squad],
        characters: charactersWith(squad, snapshot),
      };
      const request = requestForDeck(deck, boardBattle(base ?? readBattle(), boss));
      return { deck, request, key: cacheKey(request, version) };
    };

    /** 分かっている点数。計算はしない — 保存された結果があればそれを読む。 */
    const knownScore = (boss: UnionBoss, squad: readonly string[], snapshot?: Snapshot, base?: BattleSettings): number | null => {
      if (isEmptySquad(squad)) return null;
      try {
        const { key } = requestFor(boss, squad, snapshot, base);
        return scores.get(key) ?? cache.get(key)?.squadTotal ?? null;
      } catch {
        return null;
      }
    };

    /** 1件ぶんの仕事。回すのは score-runner (DOM を知らない側)。 */
    interface Job { key: string; request: SimulationRequest; problems: string[] }
    const jobFor = (boss: UnionBoss | undefined, squad: readonly string[], snapshot?: Snapshot, base?: BattleSettings): Job | null => {
      if (!boss || isEmptySquad(squad)) return null;
      try {
        const { deck, request, key } = requestFor(boss, squad, snapshot, base);
        // 「計算」と同じ検証を通す (画面ごとに通る値が変わらないように)
        return { key, request, problems: [...validateRequest(request), ...validateCharacterValues(deck)] };
      } catch (error) {
        // 組み立てられない編成も «失敗として» 数える。黙って落とすと件数が合わない
        return {
          key: `${boss.name}/${squad.join('/')}`,
          request: { squad: [...squad] } as SimulationRequest,
          problems: [error instanceof Error ? error.message : String(error)],
        };
      }
    };
    /** 同じ候補を2度回さない (中身は score-runner と同じ規則)。 */
    const dedupe = (jobs: Array<Job | null>): Job[] => {
      const seen = new Set<string>();
      const out: Job[] = [];
      for (const job of jobs) {
        if (!job || seen.has(job.key)) continue;
        seen.add(job.key);
        out.push(job);
      }
      return out;
    };
    /**
     * 計算機の並列設定に従って回す。進み具合は状態行に出す。
     * 回す仕組みそのものは `score-runner.ts` — DOM を知らない側に置いてある。
     */
    const runJobs = async (jobs: Job[], what: string): Promise<Map<string, string>> => {
      if (jobs.length === 0) return new Map();
      const { scores: scoresFromRun, failures } = await runScores(
        jobs.map((job) => ({ key: job.key, request: job.request, problems: job.problems })),
        {
          simulate: async (request) => {
            const result = await client.simulate(request);
            return result;
          },
          cache: { get: (key) => cache.get(key), set: (key, result) => { cache.set(key, result); } },
          lanes: parallelOn ? parallelCount : 1,
          onProgress: (done, total) => say(`${what} ${done}/${total}…`),
        },
      );
      // 覚えた点数を盤面の記憶へ。鍵はリクエスト全体の JSON なので、
      // 取込や条件変更を繰り返すと溜まる — 古い順に捨てる (Map は挿入順を保つ)。
      for (const [key, total] of scoresFromRun) {
        scores.set(key, total);
        while (scores.size > SCORE_MEMORY) scores.delete(scores.keys().next().value as string);
      }
      // 失敗は**投げない**。20件中1件が組めないだけで «全候補を計算» が丸ごと止まり、
      // 計算できた19件も盤面に入らなかった。呼び出し側が «何件だめだったか» を添えて進める。
      return failures;
    };
    // 計算できなかったぶんを一言で添える。**総数を必ず添える** — 「1件だめでした」だけだと
    // 2件中1件なのか20件中1件なのか分からず、«残りは計算できた» の価値が伝わらない
    // (Codex の指摘)。理由は先頭の1件だけ — 原因はたいてい同じで、全部並べても読まれない。
    const failNote = (failures: Map<string, string>, total: number) => (failures.size === 0 ? ''
      : ` ${total}件中 ${failures.size}件は計算できませんでした (${[...failures.values()][0]})。`);
    // 空の編成は «0点» が正しい。計算できなかったのは «不明» — これを 0点として比べると、
    // 失敗した側が黙って負ける。両者を区別して返す。
    const scoreOrZero = (boss: UnionBoss, squad: readonly string[], snapshot?: Snapshot): number | null =>
      (isEmptySquad(squad) ? 0 : knownScore(boss, squad, snapshot));
    const withBusy = async (work: () => Promise<void>) => {
      if (busy) { say('別の計算が走っています。終わるまで待ってください。'); return; }
      busy = true;
      renderBoard();
      try {
        await prepared;
        await work();
      } catch (error) {
        say(`計算に失敗しました — ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        busy = false;
        renderBoard();
      }
    };
    /**
     * 何の条件で計算したかの一言。
     *
     * 以前は「コアとパーツ無し」の固定文字列で、**ボスにコアを登録できるようになった後も
     * 嘘をつき続けていた** (実機監査の筆頭指摘)。計算は登録どおりコア込みなのに表示だけが
     * 違うと、数字全体が信じられなくなる。登録から組み立てる。
     */
    const battleNote = () => {
      const quirks = bosses.filter((boss) => boss.coreEnabled || boss.hasParts)
        .map((boss) => boss.name);
      return `戦闘 ${readBattle().duration}秒 · 登録したボス条件`
        + (quirks.length > 0 ? ` (コア/パーツ: ${quirks.join('・')})` : ' (コア・パーツ無し)');
    };
    const bossOf = (index: number): UnionBoss | undefined => {
      const name = board.slots[index]?.boss;
      return name ? bossByName(name) : undefined;
    };

    /** 枠の点数と、その枠の被りの代案 (外す / 譲る) の点数をそろえる。 */
    const slotJobs = (index: number): Array<Job | null> => {
      const slot = board.slots[index]!;
      const boss = bossOf(index);
      if (!boss) return [];
      const jobs: Array<Job | null> = [jobFor(boss, slot.squad, slot.characters)];
      for (const option of clashOptionsFor(board, index)) {
        const otherBoss = bossOf(option.other);
        const other = board.slots[option.other]!;
        jobs.push(jobFor(boss, option.here, slot.characters));
        jobs.push(jobFor(otherBoss, other.squad, other.characters));
        jobs.push(jobFor(otherBoss, option.there, other.characters));
      }
      return jobs;
    };

    const computeSlots = (indexes: number[]) => withBusy(async () => {
      const jobs = dedupe(indexes.flatMap(slotJobs));
      if (jobs.length === 0) { say('計算する枠がありません。ボスを選んでください。'); return; }
      const failures = await runJobs(jobs, '計算中');
      if (failures.size >= jobs.length) { say(`計算できませんでした — ${[...failures.values()][0]}`); return; }
      say(`${battleNote()} で計算しました。${failNote(failures, jobs.length)}`, failures.size === 0);
    });

    /** ボスを選ぶ → そのコードの候補を入れる (点数が分かっている候補があれば一番高いもの、無ければ候補1)。 */
    const chooseBoss = async (index: number, name: string) => {
      chooserOpen = null;
      if (!name) { commit(clearSlot(board, index)); return; }
      const boss = bossByName(name);
      if (!boss) return;
      const { element: code, plans: options } = boardCandidatesFor(boss, plans);
      let picked: ElementPlan | undefined = options[0];
      let bestKnown = -Infinity;
      for (const plan of options) {
        const known = knownScore(boss, plan.squad, plan.characters)
          ?? plan.registered?.damage ?? null;
        if (known !== null && known > bestKnown) { bestKnown = known; picked = plan; }
      }
      commit(withSlot(board, index, {
        boss: name,
        squad: picked?.squad ?? ['', '', '', '', ''],
        characters: picked?.characters,
      }));
      if (options.length === 0) {
        say(code
          ? `${name} は ${elementLabel(code)} が有利です。「この枠の編成を組む」から選んでください。`
          : 'このボスのコードに対応する編成がありません。');
        return;
      }
      await computeSlots([index]);
    };

    /** 空き枠: 残りの人で一番出るボスを探す。 */
    const searchOpen = (index: number) => withBusy(async () => {
      const candidates = openSlotCandidates(board, index, bosses, plans);
      if (candidates.length === 0) {
        say('入れられる候補がありません。枠の「この枠の編成を組む」で組むか、「保存候補・比較」タブで保存してください (他の枠と全員被る候補は除きます)。');
        return;
      }
      const jobs = dedupe(candidates.map((c) => jobFor(c.boss, c.squad, c.characters)));
      const failures = await runJobs(jobs, '残りで探索中');
      let best: OpenCandidate | null = null;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        const score = knownScore(candidate.boss, candidate.squad, candidate.characters);
        if (score !== null && score > bestScore) { bestScore = score; best = candidate; }
      }
      if (!best) { say(`計算できる候補がありませんでした。${failNote(failures, jobs.length)}`); return; }
      commit(withSlot(board, index, { boss: best.boss.name, squad: best.squad, characters: best.characters }));
      say(best.removed.length > 0
        ? `${best.boss.name} (候補 ${best.planIndex + 1}) が最大でした。他の枠と被る ${best.removed.map(labelFor).join('・')} は外してあります。${failNote(failures, jobs.length)}`
        : `${best.boss.name} (候補 ${best.planIndex + 1}) が最大でした。${failNote(failures, jobs.length)}`, failures.size === 0);
    });

    /** 全候補 (ボス × 候補) を計算し、被りなしで合計最大の3つを枠に入れる。 */
    /**
     * すべての候補に入っているニケ。3凸が埋まらないときの**本当の理由**を言うために数える。
     * バッファーの型を全行に敷くと起きる — 「候補を増やして」と言っても、同じ型から
     * 増やす限り永遠に直らない (実機監査の指摘)。
     */
    const commonToAll = (cands: readonly Candidate[]): string[] => {
      if (cands.length < 2) return [];
      const counts = new Map<string, number>();
      for (const cand of cands) {
        for (const name of new Set(cand.squad.filter(Boolean))) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      return [...counts].filter(([, seen]) => seen === cands.length).map(([name]) => name);
    };

    const searchBest = () => withBusy(async () => {
      const all: Array<{ boss: UnionBoss; plan: ElementPlan }> = [];
      for (const boss of bosses) {
        for (const plan of boardCandidatesFor(boss, plans).plans) all.push({ boss, plan });
      }
      if (all.length === 0) { say('保存した候補がありません。各枠の「この枠の編成を組む」から直接選べます。'); return; }
      const jobs = dedupe(all.map((c) => jobFor(c.boss, c.plan.squad, c.plan.characters)));
      const failures = await runJobs(jobs, '全候補を計算中');
      const scored: Candidate[] = all.flatMap(({ boss, plan }) => {
        const score = knownScore(boss, plan.squad, plan.characters);
        return score === null ? [] : [{
          boss: boss.name, squad: plan.squad, score,
          ...(plan.characters ? { characters: plan.characters } : {}),
        }];
      });
      const picked = bestTriple(scored);
      if (picked.length === 0) { say(`計算できる候補がありませんでした。${failNote(failures, jobs.length)}`); return; }
      const before = board;
      let next = emptyBoard();
      picked.forEach((candidate, index) => {
        next = withSlot(next, index, {
          boss: candidate.boss, squad: candidate.squad, characters: candidate.characters,
        });
      });
      chooserOpen = null;
      commit(next);
      boardUndo = before;
      const total = formatDamage(picked.reduce((sum, candidate) => sum + candidate.score, 0));
      // 埋まらない理由が «全候補に同じ人が入っている» なら、そう名指しする。
      // 「候補を増やして」だけでは、同じ型から増やして徒労になる
      const stuck = picked.length < BOARD_SLOTS ? commonToAll(scored) : [];
      say(picked.length < BOARD_SLOTS
        ? (stuck.length > 0
          ? `被りなしで組めたのは ${picked.length} 凸ぶんでした (合計 ${total})。${stuck.map(labelFor).join('・')} がすべての候補に入っています — 別のバッファーで組んだ候補を足すと3凸まで埋まります。${failNote(failures, jobs.length)}`
          : `被りなしで組めたのは ${picked.length} 凸ぶんでした (合計 ${total})。保存候補を増やすと3凸まで埋まります。${failNote(failures, jobs.length)}`)
        : `被りなしで最大の3凸を入れました (合計 ${total} · ${battleNote()})。${failNote(failures, jobs.length)}`, failures.size === 0);
    });

    /** 被りを解く: 「こちらから外す」「相手から譲る」の両方を計算し、合計が大きい側にする。 */
    const resolveClash = (index: number, option: ClashOption) => withBusy(async () => {
      const slot = board.slots[index]!;
      const other = board.slots[option.other]!;
      const boss = bossOf(index);
      const otherBoss = bossOf(option.other);
      if (!boss || !otherBoss) return;
      const failures = await runJobs(dedupe([
        jobFor(boss, slot.squad, slot.characters), jobFor(boss, option.here, slot.characters),
        jobFor(otherBoss, other.squad, other.characters), jobFor(otherBoss, option.there, other.characters),
      ]), '代案を計算中');
      // 4つの値が揃わないと «どちらが得か» は決められない。1つでも計算できていないまま
      // 0点として足すと、失敗した側が黙って負ける。揃わなければ何もせずに止める。
      const four = [
        scoreOrZero(boss, option.here, slot.characters),
        scoreOrZero(otherBoss, other.squad, other.characters),
        scoreOrZero(boss, slot.squad, slot.characters),
        scoreOrZero(otherBoss, option.there, other.characters),
      ];
      if (four.some((score) => score === null)) {
        // 原因を**決めつけない**。以前は «育成値を確かめてください» と言い切っていたが、
        // 失敗の理由は Pyodide の初期化やエンジンの例外のこともあり、育成値を直しても
        // 直らない相手に育成値を直させることになっていた (Codex の指摘)。
        const why = failures.size > 0 ? ` (${[...failures.values()][0]})` : '';
        say(`代案を計算できなかったので、どちらが得かを決められませんでした${why}。`);
        return;
      }
      const [hereA, hereB, thereA, thereB] = four as number[];
      const hereTotal = hereA! + hereB!;
      const thereTotal = thereA! + thereB!;
      const names = option.names.map(labelFor).join('・');
      // 外した結果だれも残らない枠は、ボスごと空に戻す — 「残りで一番出るボスを探す」が使える状態にする
      if (hereTotal >= thereTotal) {
        commit(isEmptySquad(option.here) ? clearSlot(board, index)
          : withSlot(board, index, { boss: slot.boss, squad: option.here, characters: slot.characters }));
        say(`${names} を ${index + 1}凸目から外しました (合計 ${formatDamage(hereTotal)} ≥ 譲る場合の ${formatDamage(thereTotal)})。`
          + (isEmptySquad(option.here) ? ` ${index + 1}凸目は空になったので、残りで探し直せます。` : ''), true);
      } else {
        commit(isEmptySquad(option.there) ? clearSlot(board, option.other)
          : withSlot(board, option.other, { boss: other.boss, squad: option.there, characters: other.characters }));
        say(`${names} を ${option.other + 1}凸目から譲りました (合計 ${formatDamage(thereTotal)} > 外す場合の ${formatDamage(hereTotal)})。`
          + (isEmptySquad(option.there) ? ` ${option.other + 1}凸目は空になったので、残りで探し直せます。` : ''), true);
      }
    });

    /** 枠の編成とボス条件を計算機に載せて、詳細計算へ。 */
    const openInCalc = (index: number) => {
      const slot = board.slots[index]!;
      const boss = bossOf(index);
      if (!boss) return;
      applySquadToDeck(slot.squad, slot.characters);
      writeBattle(bossBattle(boss, readBattle()));
      element<HTMLSelectElement>(root, '#enemy-code').dispatchEvent(new Event('change', { bubbles: true }));
      element<HTMLInputElement>(root, '#enemy-def').dispatchEvent(new Event('input', { bubbles: true }));
      switchView('calc');
      scrollTo(squadGrid);
    };

    const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
      const node = el('button', className, label);
      node.type = 'button';
      node.disabled = busy;
      node.addEventListener('click', onClick);
      return node;
    };
    const delta = (value: number) => `${value >= 0 ? '+' : '−'}${formatDamage(Math.abs(value))}`;

    const renderClash = (index: number, option: ClashOption): HTMLElement => {
      const box = el('div', 'board-clash');
      box.dataset.boardClash = `${index}:${option.other}`;
      const names = option.names.map(labelFor).join('・');
      const boss = bossOf(index);
      const otherBoss = bossOf(option.other);
      const other = board.slots[option.other]!;
      const text = el('span', 'board-clash-text');
      text.append(createText('b', names), document.createTextNode(` は ${option.other + 1}凸目でも使っています。`));
      if (boss && otherBoss) {
        const mineSlot = board.slots[index]!;
        const mine = knownScore(boss, mineSlot.squad, mineSlot.characters);
        const hereScore = isEmptySquad(option.here) ? 0 : knownScore(boss, option.here, mineSlot.characters);
        const theirs = knownScore(otherBoss, other.squad, other.characters);
        const thereScore = isEmptySquad(option.there) ? 0 : knownScore(otherBoss, option.there, other.characters);
        if (mine !== null && hereScore !== null && theirs !== null && thereScore !== null) {
          const hereTotal = hereScore + theirs;
          const thereTotal = mine + thereScore;
          const hereText = isEmptySquad(option.here)
            ? 'こちらから外すと誰も残りません'
            : `こちらから外すと ${formatDamage(hereScore)} (${delta(hereScore - mine)})`;
          const thereText = isEmptySquad(option.there)
            ? `${option.other + 1}凸目から譲ると ${option.other + 1}凸目が空になります`
            : `${option.other + 1}凸目から譲ると ${option.other + 1}凸目が ${formatDamage(thereScore)} (${delta(thereScore - theirs)})`;
          text.append(document.createTextNode(` ${hereText}、${thereText}。`));
          text.append(createText('b', hereTotal >= thereTotal
            ? `合計は「${index + 1}凸目から外す」が上です。`
            : `合計は「${option.other + 1}凸目から譲る」が上です。`));
        } else {
          text.append(document.createTextNode(' 「被りを解いて組み直す」で両方の損得を計算し、合計が大きい側に決めます。'));
        }
      }
      box.append(createText('span', '⚠', 'board-clash-mark'), text);
      const fix = button('被りを解いて組み直す', 'board-btn lead', () => {
        void withProgress(`data-board-clash-fix="${index}"`, () => resolveClash(index, option));
      });
      fix.setAttribute('data-board-clash-fix', String(index));
      box.append(fix);
      return box;
    };

    const renderChooser = (index: number, boss: UnionBoss): HTMLElement => {
      const box = el('div', 'board-chooser');
      box.dataset.boardChooser = String(index);
      const { element: code, plans: options } = boardCandidatesFor(boss, plans);
      if (!code) {
        box.append(createText('p', 'このボスのコードに対応する編成がありません。', 'board-chooser-empty'));
        return box;
      }
      const head = el('div', 'board-compare-head');
      head.append(createText('b', `候補を比べる (${elementLabel(code)} 編成)`));
      // いまの編成を候補に足す。組む → 足す → 組み替える → 比べる、が1画面で回る。
      const slotNow = board.slots[index]!;
      if (!isEmptySquad(slotNow.squad) && options.length < MAX_PLANS_PER_ELEMENT
        && !options.some((plan) => sameSquad(plan.squad, slotNow.squad))) {
        const add = button('いまの編成を候補に加える', 'board-btn', () => {
          const result = addPlan(plans, code, [...slotNow.squad], { characters: slotNow.characters });
          if (!result.added) {
            say(result.reason === 'full'
              ? `候補は ${MAX_PLANS_PER_ELEMENT}件までです。どれかを消してから加えてください。`
              : '同じ編成がすでに候補にあります。');
            return;
          }
          plans = result.plans;
          savePlans(resolveStorage(), plans);
          renderBoard();
        });
        add.dataset.boardCompareAdd = String(index);
        head.append(add);
      }
      if (options.length > 1) {
        const runAll = button('候補をぜんぶ計算して比べる', 'board-btn lead', () => {
          void withBusy(async () => {
            // 条件は**最初に1回だけ読む** — 計算中に条件パネルを変えられても、
            // この比較のまとまりは同じ条件で計算・照会・登録される
            const base = readBattle();
            await runJobs(dedupe(options.map((plan) => jobFor(boss, plan.squad, plan.characters, base))), '候補を計算中');
            // 出た値は案に**登録**する — 入れ替えながら比べるのは盤面が主戦場なので、
            // ここで比べた結果も (属性別編成タブと同じく) 再読込後に残す
            const registeredAt = new Date().toISOString();
            let registered = 0;
            for (const plan of options) {
              const score = knownScore(boss, plan.squad, plan.characters, base);
              if (score === null || !code) continue;
              plans = registerScore(plans, code, plan.id, {
                damage: score, duration: base.duration, at: registeredAt,
              });
              registered += 1;
            }
            const persisted = registered === 0 || savePlans(resolveStorage(), plans);
            say(!persisted
              ? `${options.length}件の候補を比べましたが、登録をブラウザに保存できませんでした (次に開くと消えます)。`
              : registered === options.length
                ? `${options.length}件の候補を 戦闘 ${base.duration}秒 · コアとパーツ無し で比べ、結果を登録しました。`
                : `${registered}/${options.length}件だけ登録できました。計算できなかった候補は編成を確かめてください。`,
              persisted && registered === options.length);
            renderPlans();
          });
        });
        runAll.dataset.boardCompareRun = String(index);
        head.append(runAll);
      }
      box.append(head);
      if (options.length === 0) {
        box.append(createText('p', 'まだ候補がありません。「この枠の編成を組む」で組んでから、ここに加えられます。', 'board-chooser-empty'));
      }
      // 一番出た候補に印を付ける — 数字が並んでいても、どれが上かは一目で分かる方がよい
      const scoresOf = options.map((plan) => knownScore(boss, plan.squad, plan.characters));
      const topScore = Math.max(...scoresOf.filter((v): v is number => v !== null), -Infinity);
      options.forEach((plan, planIndex) => {
        const row = el('div', 'board-chooser-row');
        const current = sameSquad(plan.squad, board.slots[index]!.squad);
        const pick = button(current ? `候補 ${planIndex + 1} (いま)` : `候補 ${planIndex + 1} にする`, `board-btn${current ? ' is-on' : ''}`, () => {
          chooserOpen = null;
          commit(withSlot(board, index, { boss: boss.name, squad: plan.squad, characters: plan.characters }));
          void computeSlots([index]);
        });
        pick.dataset.boardPick = `${index}:${plan.id}`;
        row.append(pick);
        const members = el('span', 'board-chooser-members');
        for (const name of plan.squad.filter(Boolean)) members.append(createText('span', labelFor(name), 'board-who'));
        row.append(members);
        const known = scoresOf[planIndex] ?? null;
        // 今の条件での値が無ければ、案に登録した理論値を出す (どちらか分かる印つき)
        const registered = plan.registered;
        const score = createText('span',
          known !== null ? formatDamage(known)
            : registered ? `${formatDamage(registered.damage)} (登録値)` : '未計算',
          'board-chooser-score');
        if (known === null && registered) {
          score.title = `「比べる」で計算して登録した理論値です (${registered.duration}秒戦闘)。今の条件で計算し直すと変わることがあります`;
        }
        if (known !== null && known === topScore && options.length > 1) {
          score.classList.add('is-top');
          score.title = 'この候補が一番出ています';
        }
        row.append(score);
        // 入れ替えながら比べると3件の上限にすぐ当たる — 弱かった候補はその場で消せるようにする
        const dropCandidate = button('✕', 'board-btn board-chooser-drop', () => {
          if (!code) return;
          plans = removePlan(plans, code, plan.id);
          if (!savePlans(resolveStorage(), plans)) {
            say('この画面では消えましたが、ブラウザに保存できませんでした (次に開くと戻ります)。');
          }
          renderPlans();
          renderBoard();
        });
        dropCandidate.title = 'この候補を消す (枠に入れている編成はそのまま残ります)';
        dropCandidate.dataset.boardCandidateDrop = plan.id;
        row.append(dropCandidate);
        box.append(row);
      });
      return box;
    };

    /**
     * 枠の中で直接メンバーを組む。
     *
     * これが無かったころは «計算機で組む → 属性別編成で案として保存 → 盤面で選ぶ» と
     * 3つのタブを行き来する必要があり、「編成の設定方法が不明瞭」と言われた。
     * 3凸を決める画面なのだから、その場で組めるのが素直。
     *
     * **同じニケは3凸のうち1度だけ**なので、他の枠で使っている人はここで «使用中» と
     * 出して選べなくする — 組んだ後に赤く怒られるより、選ぶ時点で分かる方がよい。
     */
    /**
     * @param opts.squad    いま組んでいる5人 (空文字は空き枠)
     * @param opts.onChange 選び直したときに呼ぶ。次の5人を渡す
     * @param opts.blocked  選ばせない相手と、その理由。3凸の «同じニケは1度だけ» を伝える
     * @param opts.wanted   このボスに有利なコード。そのニケを上に出す
     * @param opts.redraw   絞り込みを変えたときの描き直し
     * @param opts.mark     data 属性に付ける目印 (盤面は枠番号、モーダルは 'modal')
     */
    renderPicker = (opts: {
      squad: readonly string[];
      onChange: (squad: string[]) => void;
      blocked?: (name: string) => string | null;
      wanted: string | null;
      redraw: () => void;
      mark: string;
    }) => {
      const { squad, onChange, wanted, redraw, mark } = opts;
      const blocked = opts.blocked ?? (() => null);
      const box = el('div', 'board-picker');
      const pickable = pickableNikke();

      // バーストは1→2→3で繋ぐので、どれかが欠けていると回らない。
      // 5人そろってから «なぜ低いのか» を探すより、選んでいる最中に見える方がよい。
      const stages = squad.filter(Boolean)
        .map((name) => catalogByName.get(name)?.burstStage ?? '');
      const need = ['1', '2', '3'].filter((stage) => !stages.includes(stage));
      const burstNote = el('p', 'board-picker-burst');
      burstNote.dataset.boardPickerBurst = mark;
      burstNote.append(createText('span', `B1 ${stages.filter((s) => s === '1').length}`
        + ` · B2 ${stages.filter((s) => s === '2').length}`
        + ` · B3 ${stages.filter((s) => s === '3').length}`));
      if (need.length > 0 && stages.length > 0) {
        burstNote.append(createText('b', ` — B${need.join('・B')} がいません`, 'is-warn'));
      }

      // 並び順は**計算結果に影響する** (バーストの回し方や攻撃対象の決まり方が変わる —
      // 同じ5人でも並びだけで2割以上変わる実測あり)。だから外す✕だけでなく、
      // その場で隣と入れ替えられる◀▶を置く (ドラッグでなくボタン = キーボードでも押せる)
      burstNote.append(createText('span', ' · 並び順も結果に影響します', 'board-picker-order-hint'));
      const line = el('div', 'board-picker-line');
      const swap = (a: number, b: number) => {
        const next = [...squad];
        [next[a], next[b]] = [next[b] ?? '', next[a] ?? ''];
        onChange(next);
      };
      // «いまの5人» も顔タイルで出す。棚も一覧も絵なのに、肝心のここだけ文字だと
      // 編成が «ぱっと見» で読めない (利用者の指摘)。並び順は計算結果に影響するので
      // ◀▶ はタイルの下に置いたまま残す。
      for (let at = 0; at < 5; at += 1) {
        const name = squad[at] ?? '';
        const cell = el('span', `board-picker-here${name ? '' : ' is-empty'}`);
        const face = el('span', 'board-picker-here-face');
        if (name) {
          const meta = catalogByName.get(name);
          if (meta?.image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${meta.image}`;
            img.alt = '';
            img.loading = 'lazy';
            face.append(img);
          }
          if (meta?.burstStage) face.append(createText('span', `B${meta.burstStage}`, 'board-pick-burst'));
          const off = button('✕', 'board-picker-off', () => {
            const next = [...squad];
            next[at] = '';
            onChange(next);
          });
          off.title = '外す';
          off.setAttribute('aria-label', `${labelFor(name)} を外す`);
          off.dataset.boardPickerDrop = `${mark}:${at}`;
          face.append(off);
        }
        cell.append(face);
        cell.append(createText('span', name ? labelFor(name) : '空き', 'board-picker-here-name'));
        if (name) {
          const moves = el('span', 'board-picker-moves');
          const left = button('◀', 'board-picker-move', () => swap(at, at - 1));
          left.title = '左と入れ替える (並び順は計算結果に影響します)';
          left.setAttribute('aria-label', `${labelFor(name)} を左へ`);
          left.dataset.boardPickerMove = `${mark}:${at}:left`;
          // 端の外へは押せない。ボタンごと消すと ◀▶ の位置が揺れるので、押せなくして残す
          if (at === 0) left.disabled = true;
          moves.append(left);
          const right = button('▶', 'board-picker-move', () => swap(at, at + 1));
          right.title = '右と入れ替える (並び順は計算結果に影響します)';
          right.setAttribute('aria-label', `${labelFor(name)} を右へ`);
          right.dataset.boardPickerMove = `${mark}:${at}:right`;
          if (at === 4) right.disabled = true;
          moves.append(right);
          cell.append(moves);
        }
        line.append(cell);
      }
      box.append(burstNote, line);

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'board-picker-search';
      search.placeholder = ' 名前で探す';
      search.value = pickerQuery;
      search.dataset.boardPickerSearch = mark;
      box.append(search);

      /**
       * 並び順: **有利コード → 自分の戦闘力の高い順 → 名前**。
       *
       * 文字だけの一覧は見つけにくい (GB が «文字タイル化で視認性が下がった» と
       * 記録している)。こちらは画像を200名ぶん持っているのでタイルで出し、
       * 並びは «このボスに効いて、自分が育てている» 順にする。
       */
      const counterRank = (char: CharacterMeta) => (wanted && char.elementCode === wanted ? 0 : 1);
      const powerOf = (char: CharacterMeta) => combatPower[char.name] ?? 0;
      // お気に入りを最優先。«いつも使う顔ぶれ» は自分で決めた方が速い。
      // 有利コードより前に置く — 印を付けた人が埋もれては意味がない。
      const favRank = (char: CharacterMeta) => (favorites.has(char.name) ? 0 : 1);
      const ordered = [...pickable].sort((a, b) => favRank(a) - favRank(b)
        || counterRank(a) - counterRank(b)
        || powerOf(b) - powerOf(a)
        || labelFor(a.name).localeCompare(labelFor(b.name), 'ja'));

      // ── 絞り込み (バースト段階) と 並び順 ──
      const tools = el('div', 'board-picker-tools');
      for (const stage of ['1', '2', '3'] as const) {
        const on = pickerBurst === stage;
        const chip = button(`B${stage}`, `board-picker-tool${on ? ' is-on' : ''}`, () => {
          pickerBurst = on ? null : stage;
          redraw();
        });
        chip.dataset.boardPickerBurstFilter = stage;
        tools.append(chip);
      }
      const onlyFav = pickerFavOnly;
      const favChip = button('★ お気に入りだけ', `board-picker-tool is-sort${onlyFav ? ' is-on' : ''}`, () => {
        pickerFavOnly = !onlyFav;
        redraw();
      });
      favChip.dataset.boardPickerFavOnly = '';
      favChip.title = favorites.size === 0
        ? 'タイルの ★ を押すと «よく使う» 印が付きます'
        : `印を付けた ${favorites.size}名だけを出します`;
      tools.append(favChip);
      box.append(tools);

      const grid = el('div', 'board-picker-grid');
      const draw = () => {
        grid.replaceChildren();
        const full = squad.filter(Boolean).length >= 5;
        let pool = ordered;
        if (pickerFavOnly) pool = pool.filter((c) => favorites.has(c.name));
        if (pickerBurst) pool = pool.filter((c) => c.burstStage === pickerBurst);
        const hits = filterByQuery(pool, pickerQuery, buildIndex);
        for (const char of hits.slice(0, 60)) {
          const here = squad.includes(char.name);
          const why = blocked(char.name);
          const cell = button('', 'board-picker-cell', () => {
            const next = [...squad];
            if (here) next[next.indexOf(char.name)] = '';
            else {
              const free = next.indexOf('');
              if (free < 0) return;
              next[free] = char.name;
            }
            onChange(next);
          });
          // 見た目は計算機のニケ一覧と同じ (画像 + バースト帯 + 属性アイコン)
          const portrait = el('div', 'board-pick-face');
          if (char.image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${char.image}`;
            img.alt = '';
            img.loading = 'lazy';
            portrait.append(img);
          }
          portrait.append(createText('span', `B${char.burstStage}`, 'board-pick-burst'));
          const icon = createElementIcon(char.elementCode, 'board-pick-code');
          if (icon) portrait.append(icon);
          cell.append(portrait, createText('span', labelFor(char.name), 'board-pick-name'));
          if (wanted && char.elementCode === wanted) cell.classList.add('is-counter');
          cell.dataset.boardPick = char.name;
          if (here) cell.classList.add('is-on');
          if (why && !here) {
            cell.disabled = true;
            cell.classList.add('is-taken');
            cell.title = why;
          } else if (full && !here) {
            cell.disabled = true;
            cell.title = '5人そろっています。誰かを外してから選んでください';
          }
          // ★ は**タイルの外に出す**。ボタンの入れ子は不正な HTML で、
          // span + click だと**キーボードから押せない** (Codex 指摘)。
          const on = favorites.has(char.name);
          const star = button('★', `board-pick-star${on ? ' is-on' : ''}`, () => {
            favorites = toggleFavorite(favorites, char.name);
            saveFavorites(resolveStorage(), favorites);
            redraw();
          });
          star.dataset.boardFav = char.name;
          star.setAttribute('aria-pressed', String(on));
          star.setAttribute('aria-label', `${labelFor(char.name)} を${on ? 'よく使う印から外す' : 'よく使う印に入れる'}`);
          star.title = on ? 'よく使う印を外す' : 'よく使う印を付ける';

          const wrap = el('div', 'board-picker-slot');
          wrap.append(cell, star);
          grid.append(wrap);
        }
        if (hits.length === 0) grid.append(createText('p', '一致するニケがいません。', 'board-picker-none'));
        // 60件で切っていることを黙っていると、上の «残り 200名から組めます» と数が合わない
        else if (hits.length > 60) {
          grid.append(createText('p',
            `${hits.length}名のうち 60名を出しています。名前で検索するか、上の絞り込みで狭めてください。`,
            'board-picker-none'));
        }
      };
      draw();
      search.addEventListener('input', () => { pickerQuery = search.value; draw(); });
      box.append(grid);
      return box;
    };

    /**
     * ボス未設定の枠に出す一行。**残り人数だけを言わない** —
     * 0名のとき «残り 0名から選べます» では «次に何をすればいいか» が無く、
     * 壊れているように見える (実機で確認)。
     */
    const emptySlotHint = (left: number): string => {
      if (left > 0) return `ボスを選ぶと、残り ${left}名から組めます`;
      if (Object.keys(roster).length === 0) {
        return '育成を取り込むと、自分の手持ちから組めます (取り込まないと既定の育成で計算します)';
      }
      return '手持ちは他の凸で使い切っています。どこかの枠を空けるか、育成を取り込み直してください';
    };

    const renderTotal = (slotScores: Array<number | null>) => {
      totalBox.replaceChildren();
      const clashes = clashesOf(board);
      const set = board.slots.filter((slot) => slot.boss).length;
      const left = el('div');
      left.append(createText('div', '3凸の合計 (見込み)', 'board-total-label'));
      // **全部そろうまで数字を出さない。** 途中で 0 と出すと «計算していない» のか
      // «計算して 0» なのか読めない (候補の数値は «未計算» と出しているのに、
      // ここだけ 0 のままだった)。
      const ready = board.slots.every((slot, index) => !slot.boss
        || isEmptySquad(slot.squad) || slotScores[index] !== null);
      const anyScore = slotScores.some((score) => score !== null);
      const total = el('div', 'board-total-val');
      if (ready && anyScore) {
        total.textContent = formatDamage(totalOf(slotScores));
      } else {
        total.textContent = '—';
        total.classList.add('is-blank');
        total.title = anyScore
          ? '未計算の枠があるので合計は出せません'
          : 'まだ計算していません';
      }
      left.append(total);
      const used = el('div', 'board-total-used');
      used.dataset.boardSummary = '';
      used.append(document.createTextNode(`使用 ${usedCount(board)}名 / 被り `));
      used.append(createText('b', `${clashes.length}件`, clashes.length > 0 ? 'is-bad' : undefined));
      const notes: string[] = [];
      if (set < BOARD_SLOTS) notes.push(`${BOARD_SLOTS - set}枠が未設定です`);
      if (slotScores.some((score, index) => score === null && board.slots[index]!.boss
        && !isEmptySquad(board.slots[index]!.squad))) {
        // «未計算» と言うだけでは、どこを押せば計算されるのかが分からない (Fable の指摘)。
        // 枠の中に計算ボタンは無く、押す先はこの合計欄の「この3凸で計算する」。
        notes.push('未計算の枠があります — 下の「この3凸で計算する」で出ます');
      }
      if (clashes.length > 0) notes.push('被りがあるとこの合計は出せません');
      for (const note of notes) used.append(el('br'), document.createTextNode(note));
      const actions = el('div', 'board-total-actions');
      const search = button('全ボスから自動で探す', 'board-btn lead', () => {
        void withProgress('data-board-search-best', searchBest);
      });
      search.dataset.boardSearchBest = '';
      search.title = '全ボス × 保存候補すべてを計算します';
      const run = button('この3凸で計算する', 'board-btn main', () => {
        void withProgress('data-board-run', () => computeSlots([0, 1, 2]));
      });
      run.dataset.boardRun = '';
      actions.append(search, run);
      totalBox.append(left, used, actions);
      // 探索範囲と «何が入れ替わるか» は title ではなく画面に出す。
      // 押す前に分からないと、組んだ盤面が消えて驚くことになる。
      totalBox.append(createText('p',
        '「全ボスから自動で探す」= 全5ボス × 保存候補すべてを計算し、'
        + '同じニケを2度使わない組み合わせで合計が最大のものを選びます。3枠すべてを入れ替えます。',
        'board-run-note'));
    };

    const renderUsed = (usage: Map<string, number[]>) => {
      usedBox.replaceChildren();
      usedBox.append(createText('div', 'もう使ったニケ (他の枠では選べません)', 'board-used-head'));
      const list = el('div', 'board-used-list');
      list.dataset.boardUsed = '';
      if (usage.size === 0) list.append(createText('span', 'まだ誰も使っていません', 'board-who is-empty'));
      for (const [name, slots] of usage) {
        const chip = createText('span', labelFor(name), `board-who${slots.length > 1 ? ' is-clash' : ''}`);
        chip.append(createText('small', slots.map((slot) => `${slot + 1}凸`).join(' / ')));
        list.append(chip);
      }
      usedBox.append(list);
    };

    const renderStock = () => {
      stockBox.replaceChildren();
      for (const boss of bosses) {
        const code = counterOf(boss.elementCode);
        if (!code) continue;
        const saved = plansOf(plans, code);
        // 今の条件での値が最優先。無ければ登録値だが、**登録値だと分かる印を付ける** —
        // 登録は癖なしの基準戦闘で出した値で、今の条件の値と混ぜて見せると読み違える
        let best: number | null = null;
        let bestIsRegistered = false;
        let registeredDuration: number | null = null;
        for (const plan of saved) {
          const live = knownScore(boss, plan.squad, plan.characters);
          const value = live ?? plan.registered?.damage ?? null;
          if (value === null) continue;
          // 同点なら live (今の条件の値) が勝つ — 印の付いた登録値を出すのは live が無いときだけ
          const wins = best === null || value > best
            || (value === best && bestIsRegistered && live !== null);
          if (wins) {
            best = value;
            bestIsRegistered = live === null;
            registeredDuration = live === null ? plan.registered?.duration ?? null : null;
          }
        }
        const card = el('div', `board-el ${ELEMENT_CLASS[code] ?? ''}`);
        card.dataset.boardStock = code;
        card.append(createText('div', elementLabel(code), 'board-el-name'));
        card.append(createText('div', `${boss.name}戦`, 'board-el-vs'));
        const num = el('div', 'board-el-num');
        num.append(best !== null ? createText('b', formatDamage(best)) : createText('b', '—', 'is-blank'));
        if (best !== null && bestIsRegistered) {
          const mark = createText('span', ' 登録値', 'board-el-reg');
          mark.title = `「比べる」で計算して登録した理論値です${registeredDuration !== null ? ` (${registeredDuration}秒戦闘)` : ''}。今の条件で計算し直すと変わることがあります`;
          num.append(mark);
        }
        card.append(num);
        card.append(createText('div',
          `候補 ${saved.length}/${MAX_PLANS_PER_ELEMENT}${saved.length > 0 && best === null ? ' · 未計算' : ''}`,
          'board-el-plans'));
        stockBox.append(card);
      }
    };

    renderBoard = () => {
      const usage = usageOf(board);
      const slotScores = board.slots.map((slot, index) => {
        const boss = bossOf(index);
        return boss ? knownScore(boss, slot.squad, slot.characters) : null;
      });
      const best = Math.max(0, ...slotScores.map((score) => score ?? 0));
      const owned = Object.keys(roster).length || catalog.length;

      slotsBox.replaceChildren();
      board.slots.forEach((slot, index) => {
        const boss = bossOf(index);
        const code = boss ? counterOf(boss.elementCode) : null;
        const card = el('div', `board-slot${boss ? '' : ' is-empty'}${code ? ` ${ELEMENT_CLASS[code] ?? ''}` : ''}`);
        card.dataset.boardSlot = String(index);
        card.append(createText('div', `${index + 1}凸目`, 'board-slot-no'));

        const head = el('div', 'board-slot-boss');
        const select = el('select');
        select.setAttribute('aria-label', `${index + 1}凸目のボス`);
        select.dataset.boardBoss = String(index);
        const none = el('option', undefined, '— ボスを選ぶ —');
        none.value = '';
        select.append(none);
        for (const candidate of bosses) {
          const option = el('option', undefined, `${candidate.name} (${elementLabel(candidate.elementCode)})`);
          option.value = candidate.name;
          select.append(option);
        }
        select.value = slot.boss ?? '';
        select.disabled = busy;
        select.addEventListener('change', () => { void chooseBoss(index, select.value); });
        head.append(select);
        head.append(createText('span',
          boss ? (code ? `${elementLabel(code)}で殴る` : '対応する候補なし') : '未設定',
          `board-pill${boss && code ? '' : ' is-plain'}`));
        card.append(head);

        const dmg = el('div', 'board-dmg');
        dmg.dataset.boardScore = String(index);
        const score = slotScores[index] ?? null;
        if (score !== null) dmg.append(createText('b', formatDamage(score)));
        else {
          dmg.append(createText('b', '—', 'is-blank'));
          dmg.append(createText('span',
            !boss ? 'ボスを選ぶと候補が入ります' : isEmptySquad(slot.squad) ? 'ニケを選ぶと計算できます' : '未計算',
            'board-dmg-note'));
        }
        card.append(dmg);
        const bar = el('div', 'board-bar');
        const fill = el('i');
        fill.style.width = score !== null && best > 0 ? `${Math.round((score / best) * 100)}%` : '0';
        bar.append(fill);
        card.append(bar);

        const team = el('div', 'board-team');
        const members = slot.squad.filter(Boolean);
        if (members.length === 0) {
          team.append(createText('span',
            boss ? 'まだ誰も入っていません — 下の «この枠の編成を組む» から選べます' : emptySlotHint(owned - usage.size),
            'board-who is-empty'));
        }
        // 枠のメンバーも顔タイルで。文字だけ残っていた最後の場所 (実機監査)
        for (const name of members) {
          const meta = catalogByName.get(name);
          const face = el('span', 'plans-face');
          const shot = el('span', 'plans-face-shot');
          if (meta?.image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${meta.image}`;
            img.alt = '';
            img.loading = 'lazy';
            shot.append(img);
          }
          const icon = meta ? createElementIcon(meta.elementCode, 'plans-face-code') : null;
          if (icon) shot.append(icon);
          face.append(shot, createText('span', labelFor(name), 'plans-face-name'));
          face.title = labelFor(name);
          if ((usage.get(name)?.length ?? 0) > 1) face.classList.add('is-clash');
          face.dataset.boardWho = name;
          team.append(face);
        }
        // 自動で人を外した後、枠が2〜4人のまま気づかず終わる (実機監査) —
        // 空きがあることと、その埋め方を一言
        if (boss && members.length > 0 && members.length < 5) {
          team.append(createText('span',
            `5人中${members.length}人 — 「この枠の編成を組む」で足すと上がります`,
            'board-who is-vacancy'));
        }
        card.append(team);

        for (const option of clashOptionsFor(board, index)) card.append(renderClash(index, option));

        const foot = el('div', 'board-slot-foot');
        if (!boss) {
          const find = button('残りで一番出るボスを探す', 'board-btn lead', () => {
            void withProgress(`data-board-search-open="${index}"`, () => searchOpen(index));
          });
          find.dataset.boardSearchOpen = String(index);
          foot.append(find);
        } else {
          const pick = button(pickerOpen === index ? '選び終わり' : 'この枠の編成を組む', 'board-btn lead', () => {
            pickerOpen = pickerOpen === index ? null : index;
            if (pickerOpen !== null) chooserOpen = null;
            pickerQuery = '';
            renderBoard();
          });
          pick.dataset.boardPickOpen = String(index);
          foot.append(pick);
          const change = button(chooserOpen === index ? '閉じる' : '保存した候補から選ぶ', 'board-btn', () => {
            chooserOpen = chooserOpen === index ? null : index;
            if (chooserOpen !== null) pickerOpen = null;
            renderBoard();
          });
          change.dataset.boardChange = String(index);
          foot.append(change);
          if (!isEmptySquad(slot.squad)) {
            const open = button('詳細計算へ', 'board-btn', () => openInCalc(index));
            open.dataset.boardOpenCalc = String(index);
            foot.append(open);
          }
          foot.append(button('空にする', 'board-btn', () => { chooserOpen = null; commit(clearSlot(board, index)); }));
        }
        card.append(foot);
        if (pickerOpen === index && boss) {
          const used = usageOf(board);
          card.append(renderPicker({
            squad: slot.squad,
            wanted: counterOf(boss.elementCode),
            mark: String(index),
            redraw: renderBoard,
            // **同じニケは3凸のうち1度だけ**。他の枠で使っている人はここで理由を出して
            // 選べなくする — 組んだ後に赤く怒られるより、選ぶ時点で分かる方がよい
            blocked: (name) => {
              const at = (used.get(name) ?? []).filter((where) => where !== index);
              return at.length > 0 ? `${at.map((where) => `${where + 1}凸目`).join('・')}で使っています` : null;
            },
            onChange: (next) => commit(withSlot(board, index, {
              boss: slot.boss, squad: next, characters: slot.characters,
            })),
          }));
        }
        if (chooserOpen === index && boss) card.append(renderChooser(index, boss));
        slotsBox.append(card);
      });
      renderTotal(slotScores);
      renderUsed(usage);
      renderStock();
      paintProgress();   // 描き直しで消えた進捗を貼り直す
    };

    // ── 属性で組む (同じ属性を2回以上でもよい — 同じボスに複数回凸できる) ──
    const elementSelects = [...root.querySelectorAll<HTMLSelectElement>('[data-board-element]')];
    for (const select of elementSelects) {
      const none = el('option', undefined, '— 属性 —');
      none.value = '';
      select.append(none);
      for (const code of PLAN_ELEMENTS) {
        const target = bossForElement(code, bosses);
        const option = el('option', undefined, `${elementLabel(code)}${target ? ` (${target.name})` : ''}`);
        option.value = code;
        select.append(option);
      }
      // いまの盤面から初期値を写す (枠 i のボス → その有利コード)
      const index = Number(select.dataset.boardElement);
      const boss = bossOf(index);
      const current = boss ? counterOf(boss.elementCode) : null;
      if (current) select.value = current;
    }
    const runElements = () => withBusy(async () => {
      const picks = elementSelects.map((select) => select.value as PlanElement | '');
      if (picks.some((pick) => !pick)) {
        say('属性を3つ選んでください (同じ属性を2回選んでも構いません — 同じボスに複数回凸できます)。');
        return;
      }
      const chosen = picks as PlanElement[];
      const missing = [...new Set(chosen)].filter((code) => plansOf(plans, code).length === 0);
      if (missing.length > 0) {
        say(`${missing.map((code) => elementLabel(code)).join('・')} の候補がまだありません。枠で編成を組んで「いまの編成を候補に加える」か、「保存候補・比較」タブで保存してください。`);
        return;
      }
      // 選んだ属性の候補を全部 (重複は1回) 計算してから、被りなしの割り当てを解く
      const jobs = dedupe(chosen.flatMap((code) => {
        const boss = bossForElement(code, bosses) ?? undefined;
        return plansOf(plans, code).map((plan) => jobFor(boss, plan.squad, plan.characters));
      }));
      const failures = await runJobs(jobs, '候補を計算中');
      const lists: Candidate[][] = chosen.map((code) => {
        const boss = bossForElement(code, bosses);
        if (!boss) return [];
        return plansOf(plans, code).flatMap((plan) => {
          const score = knownScore(boss, plan.squad, plan.characters);
          return score === null ? [] : [{
            boss: boss.name, squad: plan.squad, score,
            ...(plan.characters ? { characters: plan.characters } : {}),
          }];
        });
      });
      const picked = bestForElements(lists);
      const before = board;
      let next = emptyBoard();
      picked.forEach((candidate, index) => {
        const code = chosen[index]!;
        const boss = bossForElement(code, bosses);
        next = withSlot(next, index, candidate
          ? { boss: candidate.boss, squad: candidate.squad, characters: candidate.characters }
          : { boss: boss?.name ?? null, squad: ['', '', '', '', ''] });
      });
      chooserOpen = null;
      pickerOpen = null;
      commit(next);
      boardUndo = before;
      const total = picked.reduce((sum, candidate) => sum + (candidate?.score ?? 0), 0);
      const holes = picked.map((candidate, index) => (candidate ? null : index + 1))
        .filter((value): value is number => value !== null);
      say(holes.length === 0
        ? `${chosen.map((code) => elementLabel(code)).join('・')} で被りなしの3凸を組みました — 理論値の合計 ${formatDamage(total)} (${battleNote()})。${failNote(failures, jobs.length)}`
        : `${holes.join('・')}凸目には被りなしで入れられる候補がありませんでした (合計 ${formatDamage(total)})。候補を増やすか、枠で直接組んでください。${failNote(failures, jobs.length)}`,
        holes.length === 0 && failures.size === 0);
    });
    const elementsRun = element<HTMLButtonElement>(root, '[data-board-elements-run]');
    elementsRun.addEventListener('click', () => { void withProgress('data-board-elements-run', runElements); });

  }

  // ── 取り込み (STEP 1) と取込の帯 ──
  // 盤面と同じ画面に出るが、関心事は別 — «自分の育成をこの端末に入れる» 側。
  // 盤面ブロックの中に置いていたせいで、盤面だけを切り出せなくなっていた。
  {
      // ── 取込の帯 (最上部・常設)。計算機タブの取込を、入口からも押せるようにする ──
      const syncMain = element<HTMLElement>(root, '[data-board-sync-main]');
      const syncSub = element<HTMLElement>(root, '[data-board-sync-sub]');
      const syncDot = element<HTMLElement>(root, '[data-board-sync-dot]');
      const boardSyncAgain = element<HTMLButtonElement>(root, '[data-board-sync-again]');
      const boardSync = element<HTMLElement>(root, '[data-board-sync]');
      const boardStart = element<HTMLElement>(root, '[data-board-start]');
      const boardMain = element<HTMLElement>(root, '[data-board-main]');
      const boardReimport = element<HTMLButtonElement>(root, '[data-board-sync-import]');
      // 「取り込まずに試す」を押したかどうか。押した人に毎回 STEP 1 を出すと邪魔なので覚える。
      // 保存できない環境 (プライベートウィンドウ等) でも動くよう、失敗は握って既定 (出す) に倒す。
      const readSkip = () => {
        try { return resolveStorage()?.getItem(BOARD_SKIP_KEY) === '1'; } catch { return false; }
      };
      const writeSkip = (on: boolean) => {
        try {
          if (on) resolveStorage()?.setItem(BOARD_SKIP_KEY, '1');
          else resolveStorage()?.removeItem(BOARD_SKIP_KEY);
        } catch { /* 覚えられなくても導線は動く */ }
      };
      let skippedImport = readSkip();
      // «取り込み直す» を押して STEP 1 を開いている最中か。出し分けは renderBoardSync に一本化し、
      // ここ以外で hidden を直接いじらない (帯を隠し忘れて STEP 1 と二重に出ていた)。
      let forceStart = false;

      // «取り込み直す» で開いた STEP 1 は、新しい取込が着くまで開けておく。
      // 描画のたびに閉じると、同期中の再描画で勝手に消える。
      let lastSyncAt = syncMeta?.at ?? null;
      renderBoardSync = () => {
        const count = Object.keys(roster).length;
        if ((syncMeta?.at ?? null) !== lastSyncAt) {
          lastSyncAt = syncMeta?.at ?? null;
          forceStart = false;
        }
        // 取り込む前は STEP 1 だけを見せ、盤面は出さない。«読み込み → 3凸» の順に進ませる。
        const imported = Boolean(syncMeta) || count > 0;
        boardStart.hidden = !forceStart && (imported || skippedImport);
        boardMain.hidden = !boardStart.hidden;
        // STEP 1 が出ている間は帯を出さない — 同じことを二度言うと «次に何をするか» がぼやける
        boardSync.hidden = !boardStart.hidden;
        // 取り込む前でも押せるようにする。«取り込むと自分の育成で見込みが出ます» と
        // 勧めておきながら、置いてあるのが «育成状況を見る» だけだった (Fable の指摘)。
        boardReimport.hidden = false;
        boardReimport.textContent = imported ? '取り込み直す' : '取り込む';
        if (syncMeta) {
          syncDot.classList.add('is-on');
          syncMain.textContent = `${SOURCE_LABELS[syncMeta.source]} から取込済み · ${syncMeta.matched}名`;
          // 相対だけだと «前のシーズンの取込» と区別できない (レイドは2週間に1度)
          syncSub.textContent = `最終取込 ${syncAgoText(syncMeta.at)} · ${syncAtText(syncMeta.at)}`
            + ` · シンクロ ${readBattle().synchroLevel}`;
        } else {
          syncDot.classList.remove('is-on');
          syncMain.textContent = count > 0 ? `ロスター ${count}名を適用中` : 'まだ育成状況を取り込んでいません';
          syncSub.textContent = count > 0 ? ''
            : '取り込むと自分の育成で3凸の見込みが出ます。取り込まないうちは既定の育成 (最大) で計算します。';
        }
        boardSyncAgain.hidden = !(canReSync(syncMeta) && reSync);
        boardSyncAgain.disabled = syncInFlight;
        boardSyncAgain.textContent = syncInFlight ? '取り込み中…' : SYNC_AGAIN_LABEL;
      };
      boardSyncAgain.addEventListener('click', () => syncAgain.click());
      // 取り込み済みでも入れ直せるように、STEP 1 を出し直すだけ (別タブへ飛ばさない)
      openBoardImport = () => {
        skippedImport = false;
        writeSkip(false);
        forceStart = true;
        renderBoardSync();
        scrollTo(boardStart);
      };
      boardReimport.addEventListener('click', () => openBoardImport());
      element<HTMLButtonElement>(root, '[data-board-skip]').addEventListener('click', () => {
        skippedImport = true;
        writeSkip(true);
        // 「取り込み直す」で開いた状態も畳む。畳まないと STEP 1 から出られなくなる
        // (forceStart が立ったままだと skippedImport を見る前に «出す» が勝つ)。
        forceStart = false;
        renderBoardSync();
        scrollTo(boardMain);
      });
      // ── 自分のブラウザで取り込む (プロキシ不要) ──
      {
        const codeBox = element<HTMLTextAreaElement>(root, '[data-board-scan-code]');
        const pasteBox = element<HTMLTextAreaElement>(root, '[data-board-scan-paste]');
        const status = element<HTMLElement>(root, '[data-board-scan-status]');
        const runButton = element<HTMLButtonElement>(root, '[data-board-scan-import]');
        // 貼るコードは読めるところに出す。読ませずに貼らせないための一手。
        codeBox.value = PERSONAL_SNIPPET;

        // 別の端末へ移す。書き出した文字列はそのまま貼り付け欄で受けられる。
        {
          const makeButton = element<HTMLButtonElement>(root, '[data-board-move-make]');
          const outBox = element<HTMLTextAreaElement>(root, '[data-board-move-out]');
          const moveStatus = element<HTMLElement>(root, '[data-board-move-status]');
          makeButton.addEventListener('click', () => {
            void (async () => {
              makeButton.disabled = true;
              try {
                if (Object.keys(roster).length === 0) {
                  moveStatus.textContent = 'まだ育成を取り込んでいません。先に取り込んでください。';
                  return;
                }
                const code = await packTransfer(buildTransfer());
                outBox.hidden = false;
                outBox.value = code;
                outBox.focus();
                outBox.select();
                // クリップボードが塞がれていても、選択済みなら手で Ctrl+C できる
                void navigator.clipboard?.writeText(code).catch(() => undefined);
                moveStatus.textContent = `育成 ${Object.keys(roster).length}名ぶんを書き出しました`
                  + ` (${Math.round(code.length / 1024)}KB)。コピーしてスマホに送ってください。`;
              } catch (error) {
                moveStatus.textContent = error instanceof Error ? error.message : String(error);
              } finally {
                makeButton.disabled = false;
              }
            })();
          });
        }

        element<HTMLButtonElement>(root, '[data-board-scan-copy]').addEventListener('click', () => {
          codeBox.focus();
          codeBox.select();
          // クリップボード API が塞がれている環境でも、選択済みなら手で Ctrl+C できる
          void navigator.clipboard?.writeText(PERSONAL_SNIPPET).catch(() => undefined);
          status.textContent = 'コードを選択しました。コピーして Blablalink のコンソールに貼ってください。';
        });

        runButton.addEventListener('click', () => {
          void (async () => {
            runButton.disabled = true;
            status.textContent = '取り込み中…';
            try {
              // 他の端末から «書き出したもの» を貼られたら、そちらとして受ける。
              // 人はどちらの文字列かを気にしないので、こちらで見分ける。
              if (pasteBox.value.trim().startsWith(TRANSFER_PREFIX)) {
                const moved = await parseTransfer(pasteBox.value);
                const summary = applyTransfer(moved);
                pasteBox.value = '';
                status.textContent = summary;
                return;
              }
              const profile = await parsePersonalScan(pasteBox.value);
              const area = pickArea(profile);
              if (!area) throw new Error('所持ニケが入っていません。スニペットの実行結果を確認してください。');
              const applied = applyProfileArea(area, { source: 'snippet' });
              if (!applied) throw new Error('計算機が扱えるニケが見つかりませんでした。');

              pasteBox.value = '';   // 個人データを画面に残さない
              const parts = [`${blablaServerLabel(area.area)} ${applied.matched.length}名を適用`];
              if (applied.refreshed > 0) parts.push(`編成中 ${applied.refreshed}名の育成値を更新`);
              if (applied.carried > 0) parts.push(`今回に無かった ${applied.carried}名は前回の値のまま`);
              if (applied.unmatched.length > 0) parts.push(`未対応 ${applied.unmatched.length}名を除外`);
              if (applied.synchro !== null) parts.push(`シンクロ ${applied.synchro} を反映`);
              if (applied.console) parts.push('コンソールレベルも適用');
              updateRosterNote(parts.join(' · '));
              status.textContent = [`${applied.matched.length}名を読み込みました。`, ...applied.notes].join(' ');
            } catch (error) {
              status.textContent = error instanceof Error ? error.message : String(error);
            } finally {
              runButton.disabled = false;
            }
          })();
        });
      }

      const boardCsv = element<HTMLInputElement>(root, '#board-csv');
      boardCsv.addEventListener('change', () => { void importRosterCsv(boardCsv); });
      // label + hidden な input はキーボードで到達できないので、押せるボタンから開く
      element<HTMLButtonElement>(root, '[data-board-csv-open]').addEventListener('click', () => boardCsv.click());
      element<HTMLButtonElement>(root, '[data-board-doro]').addEventListener('click', () => {
        element<HTMLElement>(root, '[data-doro-modal]').hidden = false;
      });
      if (blablaProxy) {
        // 既存のモーダルをそのまま開く。取込の処理も注意書きも1箇所に保つ。
        element<HTMLButtonElement>(root, '[data-board-blabla]').addEventListener('click', () => {
          element<HTMLButtonElement>(root, '[data-blabla-open]').click();
        });
      }
      for (const go of root.querySelectorAll<HTMLButtonElement>('[data-board-goto]')) {
        go.addEventListener('click', () => switchView(go.dataset.boardGoto as ViewName));
      }
      renderBoardSync();
  }

  // ── 育成状況 (育成状況) ──
  // 取り込んだロスターを読むだけの画面。値は変えない — 変更は計算機のカード側に一本化する。
  {
    const emptyBox = element<HTMLElement>(root, '[data-myroster-empty]');
    element<HTMLButtonElement>(root, '[data-myroster-goto-board]').addEventListener('click', () => {
      switchView('board');
      openBoardImport();
    });
    const bodyBox = element<HTMLElement>(root, '[data-myroster-body]');
    const statsBox = element<HTMLElement>(root, '[data-myroster-stats]');
    const rowsBox = element<HTMLElement>(root, '[data-myroster-rows]');
    const sortPick = element<HTMLSelectElement>(root, '[data-myroster-sort]');

    const num = (value: number) => (Math.round(value * 100) / 100).toString();

    renderMyRoster = () => {
      const entries = readRoster(roster, [...catalogByName.values()], combatPower);
      const has = entries.length > 0;
      emptyBox.hidden = has;
      bodyBox.hidden = !has;
      if (!has) { rowsBox.replaceChildren(); statsBox.replaceChildren(); return; }

      const summary = summarize(entries);
      statsBox.replaceChildren();
      const stat = (label: string, value: string) => {
        const box = el('div', 'roster-stat');
        box.append(createText('b', value), createText('span', label));
        statsBox.append(box);
      };
      stat('所持', `${summary.owned}体`);
      stat('スキル 10/10/10', `${summary.maxedSkills}体`);
      stat('キューブ未装着', `${summary.noCube}体`);
      for (const code of ['작열', '수냉', '풍압', '전격', '철갑']) {
        stat(elementLabel(code), `${summary.byElement[code] ?? 0}体`);
      }

      rowsBox.replaceChildren();
      for (const entry of sortEntries(entries, sortPick.value as RosterSortKey, labelFor)) {
        const row = document.createElement('tr');
        const cell = (text: string, className?: string) => {
          const td = document.createElement('td');
          td.textContent = text;
          if (className) td.className = className;
          row.append(td);
        };
        cell(labelFor(entry.name), 'roster-name');
        cell(entry.elementCode ? elementLabel(entry.elementCode) : '—');
        cell(entry.burstStage ? `${entry.burstStage}バ` : '—');
        cell(entry.growthStage === null ? '—' : String(entry.growthStage));
        // 「合計 (最低)」— どれか1つだけ低いのが伸びしろとして見えるように
        cell(entry.skillTotal === null ? '—' : `${entry.skillTotal} (最低 ${entry.skillMin})`);
        cell(num(entry.overload.element));
        cell(num(entry.overload.atk));
        cell(num(entry.overload.ammo));
        cell(!entry.cubeName || entry.cubeName === NO_CUBE ? '—' : entry.cubeName);
        cell(entry.favorite > 0
          ? `お気に入り ${'★'.repeat(entry.favorite)}`
          : (entry.collectionStage && entry.collectionStage !== '없음' ? entry.collectionStage : '—'));
        cell(entry.power === null ? '—' : entry.power.toLocaleString('en-US'), 'roster-power');
        rowsBox.append(row);
      }
    };
    sortPick.addEventListener('change', () => { renderMyRoster(); });
  }

  // ── 今シーズンのボスをワンタップで敵条件に (しりすこスクワッド) ──
  // 敵コード・敵防御力だけ差し替え、他の条件 (戦闘時間・コア・回避区間) は今の値を残す。
  // 値は writeBattle で入れ、通常の入力と同じ経路 (change) を流して要約・保存を追随させる。
  {
    const host = root.querySelector<HTMLElement>('[data-boss-presets]');
    if (host) {
      renderBossPresets = () => {
      host.replaceChildren();
      for (const boss of bosses) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'roster-import calc-boss-preset';
        button.dataset.bossPreset = boss.elementCode;
        button.textContent = `${boss.name} · ${elementLabel(boss.elementCode)}`;
        button.title = UNION_SEASON.note;
        button.addEventListener('click', () => {
          writeBattle(bossBattle(boss, readBattle()));
          element<HTMLSelectElement>(root, '#enemy-code').dispatchEvent(new Event('change', { bubbles: true }));
          element<HTMLInputElement>(root, '#enemy-def').dispatchEvent(new Event('input', { bubbles: true }));
        });
        host.append(button);
      }
      };
      renderBossPresets();
    }
  }

  // ── 画面の切り替え ───────────────────────────────────────────────────────
  /** 上のタブが選べる画面。「外部リンク」は自分たちのものでない場所へ出ていく盤。 */
  type ViewName = 'board' | 'calc' | 'roster' | 'plans';

  const shell = element<HTMLElement>(root, '.site-shell');
  // 取り込みが済んでいれば «レイド準備» から始める。まだなら «最適3凸» タブの
  // STEP 1 (取り込みを促す画面) を出す — 取り込む前に準備表を見せても、
  // 既定の育成 (最大) の数字しか出ない。
  let currentView: ViewName = (syncMeta || Object.keys(roster).length > 0) ? 'plans' : 'board';
  /** 育成状況はタブを持たない — 開いた元のタブを点けたままにする (現在地が消えると迷子)。 */
  let litTab: ViewName = 'plans';

  function switchView(view: ViewName) {
    currentView = view;
    if (view !== 'roster') litTab = view;
    // 盤面はモックどおり 1000px 中央寄せ。計算機など他の画面は横に広い方が読みやすいので上流の幅のまま
    shell.classList.toggle('is-board', view === 'board');
    for (const section of root.querySelectorAll<HTMLElement>('[data-view]')) {
      const mine = section.dataset.view === view;
      // タイムラインは計算結果があるときだけ見えるので、ここでは入れない。
      if (section === timelinePanel) { section.hidden = !mine || !timelineHasContent; continue; }
      section.hidden = !mine;
    }
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
      const on = tab.dataset.viewTab === litTab;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-pressed', String(on));
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(on));
    }
    // 盤面の点数は戦闘条件・育成値に依るので、開くたびに今の条件で読み直す
    // (条件を変えた直後に古い数字を見せない — 合わない結果は「未計算」に戻る)
    if (view === 'board') renderBoard();
  }
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
    tab.addEventListener('click', () => switchView(tab.dataset.viewTab as ViewName));
  }
  // 入口は3凸ボード (自分の育成でどの凸に何を持っていくか)。計算機は「計算機」タブから
  switchView('board');

  // レッツドロ CSV の受け取り方の案内。スクリーンショットがまだ無ければ画像だけ隠す — リンクと説明は残る。
  const doroModal = element<HTMLElement>(root, '[data-doro-modal]');
  const doroShot = element<HTMLImageElement>(root, '.doro-shot');
  doroShot.addEventListener('error', () => { doroShot.hidden = true; });
  element<HTMLButtonElement>(root, '[data-doro-open]').addEventListener('click', () => {
    doroModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-doro-close]').addEventListener('click', () => {
    doroModal.hidden = true;
  });
  doroModal.addEventListener('click', (event) => {
    if (event.target === doroModal) doroModal.hidden = true;
  });

  saveState = () => {
    try {
      resolveStorage()?.setItem(STATE_KEY, JSON.stringify({
        decks, fiveDeckMode, activeDeckId, carryOverSettings, battle: readBattle(),
        // 開き直しても「誰がこのバフを受けたか」が残るようにする — 計算し直すまで
        // 空の括弧しか見えないと、機能が切れているように見える。
        buffTargets: [...buffTargetsByDeck].map(([id, v]) => ({ id, ...v })),
      }));
    } catch {
      /* 保存の失敗は無視 */
    }
  };
  const applySavedState = () => {
    if (!savedState) return;
    if (typeof savedState.carryOverSettings === 'boolean') {
      carryOverSettings = savedState.carryOverSettings;
      carryToggle.checked = carryOverSettings;
    }
    if (Array.isArray(savedState.decks)) {
      savedState.decks.forEach((saved, index) => {
        const deck = decks[index];
        if (!deck || !saved) return;
        deck.squad = (saved.squad ?? ['', '', '', '', ''])
          .map((name) => (name && catalogByName.has(name) ? name : ''));
        deck.characters = {};
        for (const [name, override] of Object.entries(saved.characters ?? {})) {
          if (deck.squad.includes(name)) deck.characters[name] = override;
        }
      });
    }
    // 「誰がこのバフを受けたか」は、署名がいまの編成・設定と合うときだけ戻す。
    // 食い違えば前の計算の値なので、そのまま信じられない。
    for (const saved of savedState.buffTargets ?? []) {
      const deck = decks.find((d) => d.id === saved.id);
      if (deck && saved.sig === deckSignature(deck)) {
        buffTargetsByDeck.set(saved.id, { sig: saved.sig, rows: saved.rows });
      }
    }

    const savedActive = savedState.activeDeckId;
    if (typeof savedActive === 'number' && savedActive >= 1 && savedActive <= 5) {
      activeDeckId = savedActive;
    }
    if (savedState.fiveDeckMode) {
      fiveDeckMode = true;
      element<HTMLInputElement>(root, '#squad-mode').checked = true;
      deckTabs.hidden = false;
      deckMoves.hidden = false;
      deckNote.hidden = false;
      deckCopy.hidden = false;
    }
    if (savedState.battle) writeBattle(savedState.battle);
  };

  applySavedState();
  applyRosterToDecks();
  updateRosterNote();
  renderSyncBox();
  renderMyRoster();
  renderPlans();
  renderBoard();
  renderDeckTabs();
  renderSquad();
  // 盤は窓ではなくいつも開いているので、最初から描いておく。
  const firstEmpty = activeDeck().squad.findIndex((member) => !member);
  activeSlot = firstEmpty < 0 ? 0 : firstEmpty;
  renderSquad();
  renderRosterGrid();

  const prepared = client.prepare()
    .then(() => {
      if (activity !== 'preparing') return;
      activity = 'ready';
      status.textContent = '計算の準備完了 · すべての演算はこの端末上で実行されます。';
    })
    .catch((error: unknown) => {
      if (activity !== 'preparing') return;
      activity = 'error';
      status.textContent = `初期化に失敗 · ${error instanceof Error ? error.message : String(error)}`;
    });

  // 既定の並べ替えが戦闘力なので、一覧を開く前に先に受け取っておく。届くまでは名前順で
  // 並んでいて、届いたらその場で並べ直す。
  void loadCombatPower();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const battle = readBattle();
    const selectedDecks = (fiveDeckMode ? decks : [decks[0]!])
      .filter((deck) => deck.squad.some((name) => name.trim()));
    const validation = [
      ...validateDecks(selectedDecks),
      ...selectedDecks.flatMap((deck) => validateCharacterValues(deck)),
    ];
    const requests = selectedDecks.map((deck) => ({
      deck,
      request: requestForDeck(deck, battle),
    }));
    for (const { deck, request } of requests) {
      validation.push(...validateRequest(request).map((message) => `デッキ ${deck.id}: ${message}`));
    }
    showErrors([...new Set(validation)]);
    if (validation.length > 0) return;

    submit.disabled = true;
    submit.classList.add('is-running');
    activity = 'running';
    const completed: DeckResultEntry[] = [];
    let cachedCount = 0;
    let failedIndex = -1;
    try {
      await prepared;
      // デッキ1つ1つは互いに独立なので、分けて回しても結果は同じ。届く順だけが入れ替わるので
      // 画面に並べるときに**デッキ番号順に並べ直す** — 左→右がそのまま1→5デッキであるべき。
      let done = 0;
      const runOne = async (index: number) => {
        const { deck, request } = requests[index]!;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (result) {
          cachedCount += 1;
        } else {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        done += 1;
        status.textContent = `計算中 · ${done}/${requests.length}デッキ`;
        completed.push({ deckId: deck.id, request, result });
        completed.sort((a, b) => a.deckId - b.deckId);
        renderBatchResult(aggregateDeckResults(completed));
      };
      // 並列を切ってあれば1つずつ。入れてあればプールが自分でワーカーに振り分ける。
      const guarded = async (index: number) => {
        try {
          await runOne(index);
        } catch (error) {
          // どのデッキが壊れたかを下の catch が知る必要がある — 並列では «何個終わったか» で
          // 突き止められない (終わった順とデッキ番号が違う)。
          if (failedIndex < 0) failedIndex = index;
          throw error;
        }
      };
      if (parallelOn && requests.length > 1) {
        const settled = await Promise.allSettled(requests.map((_, index) => guarded(index)));
        const broke = settled.find((outcome) => outcome.status === 'rejected');
        if (broke && broke.status === 'rejected') throw broke.reason;
      } else {
        for (let index = 0; index < requests.length; index += 1) await guarded(index);
      }
      activity = cachedCount === requests.length ? 'cached' : 'complete';
      status.textContent = cachedCount === requests.length
        ? '保存された結果を読み込みました。'
        : `${requests.length}件のデッキ計算完了 · 同じ条件はこの端末に保存されます。`;
    } catch (error) {
      if (completed.length > 0) renderBatchResult(aggregateDeckResults(completed));
      const failedEntry = requests[failedIndex >= 0 ? failedIndex : completed.length];
      const failed = failedEntry?.deck.id;
      const detail = cleanEngineError(error instanceof Error ? error.message : String(error));
      const messages = [`デッキ ${failed ?? '?'} の計算に失敗: ${detail}`];
      const hasBurstOverride = failedEntry
        ? Object.values(failedEntry.deck.characters).some((custom) => custom.burst)
        : false;
      if (hasBurstOverride) {
        messages.push('この編成はバースト運用の指定に対応していない可能性があります。該当キャラクターのバースト運用を「自動」に戻して再実行してください。');
      }
      showErrors(messages);
      activity = 'error';
      status.textContent = '計算に失敗しました。入力値を確認して再実行してください。';
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-running');
    }
  });

  // ── モーダルの焦点管理 (全モーダル共通) ─────────────────────────────────
  // role="dialog" はあっても、開いた直後の焦点・Tab の閉じ込め・Escape・閉じた後に
  // 開いた場所へ戻る、がどれも無かった (Codex の指摘)。開閉は各所が hidden を直接
  // いじる作りなので、hidden 属性の変化を観察して1箇所で面倒を見る —
  // 呼び出し側を書き換えないので、新しいモーダルを足しても勝手に効く。
  const modalCleanups: Array<() => void> = [];
  {
    const openStack: HTMLElement[] = [];
    const restoreTo = new WeakMap<HTMLElement, HTMLElement | null>();

    const focusablesIn = (modal: HTMLElement): HTMLElement[] =>
      [...modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !(node as HTMLButtonElement).disabled && !node.closest('[hidden]'));

    const onShow = (modal: HTMLElement) => {
      restoreTo.set(modal, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      openStack.push(modal);
      const card = modal.querySelector<HTMLElement>('.custom-card');
      if (card) {
        card.setAttribute('aria-modal', 'true');
        // 中身の最初の入力ではなくカードへ。入力に飛ばすと、読み上げが見出しを
        // 読む前に欄の説明から始まってしまう
        card.setAttribute('tabindex', '-1');
        card.focus();
      }
    };
    const onHide = (modal: HTMLElement) => {
      const at = openStack.indexOf(modal);
      if (at >= 0) openStack.splice(at, 1);
      const back = restoreTo.get(modal);
      // 開いた場所がもう無ければ (描き直しで消えた) 動かさない — 変な場所に飛ぶより良い
      if (back && back.isConnected) back.focus();
    };

    const observer = new MutationObserver((entries) => {
      for (const entry of entries) {
        const modal = entry.target as HTMLElement;
        const isOpen = openStack.includes(modal);
        // hidden = true を二度入れても属性の変化として届く — 状態が変わったときだけ動く
        if (modal.hidden && isOpen) onHide(modal);
        else if (!modal.hidden && !isOpen) onShow(modal);
      }
    });
    for (const modal of root.querySelectorAll<HTMLElement>('.custom-modal')) {
      observer.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
    }

    const onKeydown = (event: KeyboardEvent) => {
      const modal = openStack[openStack.length - 1];
      if (!modal) return;
      if (event.key === 'Escape') {
        // 閉じ方は各モーダルの ✕ に任せる (後片付けがそれぞれ違う)。
        // 自前で Escape を持つモーダル (戦闘条件・バースト順) と二重に閉じても、
        // hidden を重ねて入れるだけで壊れない
        modal.querySelector<HTMLButtonElement>('.custom-close')?.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusablesIn(modal);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      const inside = current instanceof HTMLElement && modal.contains(current);
      if (!inside) {
        // 外に出てしまっていたら中へ連れ戻す — 背面は見えないのに操作できてしまう
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (current === first || !items.includes(current as HTMLElement))) {
        // カード自身 (tabindex=-1) に居るときの逆 Tab は、素通しすると背面へ抜ける
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeydown);
    modalCleanups.push(() => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeydown);
    });
  }

  return () => {
    // 先読みは 700ms 後に renderSquad() を呼ぶ。外した後に発火すると、
    // 既に無い画面を描きにいく — 予約を取り消し、**走り出した分にも印を付ける**。
    disposed = true;
    cancelPrefetch?.();
    for (const cleanup of modalCleanups) cleanup();
    client.dispose();
  };
}
