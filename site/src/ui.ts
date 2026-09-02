import { elementLabel, growthLabel, labelFor, labelForClass, labelForMaker } from './display-name';
import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { NO_CUBE, renderCharacterSettings, type CharPanelKind } from './character-settings';
import {
  BLABLA_SERVERS,
  areaToOverrides,
  blablaServerLabel,
  consoleFrom,
  looksLikeProfileUrl,
  pickArea,
  type RawArea,
  type RawProfile,
} from './blablalink';
import { parseRosterCsv } from './csv-import';
import { summarizeBattle } from './battle-summary';
import { PERSONAL_SNIPPET, parsePersonalScan } from './personal-scan';
import { buildIndex, filterByQuery } from './nikke-search';
import { UNION_SEASON, bossBattle } from './union-bosses';
import { applyImportedRoster, mergeImportedRoster } from './roster-merge';
import { readRoster, sortEntries, summarize, type SortKey as RosterSortKey } from './my-roster';
import {
  BEATS, ELEMENT_PLANS_KEY, MAX_PLANS_PER_ELEMENT, PLAN_ELEMENTS, addPlan, baselineBattle,
  bossConditionBattle, counterOf, loadPlans, plansOf, removePlan, sameSquad, savePlans,
  type ElementPlans, type PlanElement,
} from './element-plans';
import {
  SOURCE_LABELS, SYNC_META_KEY, canReSync, loadSyncMeta, saveSyncMeta, syncAgoText, syncSummary,
  type SyncMeta,
} from './sync-meta';
import {
  BOARD_SLOTS, RAID_BOARD_KEY, bestTriple, boardBattle, candidatesFor as boardCandidatesFor, clashOptionsFor, clashesOf, clearSlot,
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
  /** 목록 정렬용 전투력. 없는 구현(테스트 대역)도 있어 선택으로 둔다. */
  combatPower?(request: CombatPowerRequest): Promise<Record<string, number>>;
  /** 병렬 계산. 풀이 아닌 구현(테스트 대역·워커 하나)도 있어 전부 선택으로 둔다. */
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
  // 완전 초기화는 저장소를 비운 뒤 페이지를 다시 띄워 메모리 상태까지 확실히
  // 되돌린다. 테스트에서는 이 자리에 가짜 함수를 넣는다.
  reload?: () => void;
  /** 테스트·자체 호스팅에서 빌드 환경값 대신 쓸 BlablaLink 프록시 주소. */
  blablaProxy?: string;
}

const element = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`画面要素が見つかりません: ${selector}`);
  return found;
};

const createText = (tag: keyof HTMLElementTagNameMap, value: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

// 속성(코드) 아이콘 — 그림은 `image/icon/icon-code-*.png`가 정본이다.
// 직접 추가한 니케가 목록에 없는 코드를 쓰면 조용히 아이콘을 생략한다.
const ELEMENT_ICON: Record<string, string> = {
  작열: 'fire', 수냉: 'water', 풍압: 'wind', 전격: 'electronic', 철갑: 'iron',
};

const createElementIcon = (elementCode: string, className: string): HTMLElement | null => {
  const slug = ELEMENT_ICON[elementCode];
  if (!slug) return null;
  const icon = document.createElement('span');
  icon.className = `${className} element-icon is-${slug}`;
  icon.title = elementLabel(elementCode);
  icon.ariaLabel = elementLabel(elementCode);
  return icon;
};

// Pyodide 오류는 긴 파이썬 트레이스백으로 온다. 마지막 줄(실제 오류 메시지)만 보여준다.
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

/** 딜 1·2위 이름. 순서는 그대로 두고 «표시»만 얹기 위해 이름만 뽑는다. */
function topScorers(entry: DeckResultEntry): Map<string, number> {
  const ranked = [...new Set(entry.request.squad)]
    .map((name) => [name, entry.result.charTotals[name] ?? 0] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return new Map(ranked.slice(0, 2).map(([name], index) => [name, index + 1]));
}

/**
 * 캐릭터별 결과 줄. 초상화 오른쪽에 막대와 총딜이 선다 — 덱을 갈아 가며 볼 때는
 * 카드보다 이쪽이 짧고, 막대 길이로 «누가 캐리했나»가 곧바로 읽힌다.
 * 여기서도 **편성 순서 그대로**이고, 딜 1·2위는 뱃지와 테두리로만 표시한다.
 */
/** 대미지를 어떻게 적을지. 「자세히 보기」로 갈린다 — 값이 아니라 표기만 바뀐다. */
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
 * 캐릭터별 결과 카드. **편성 순서 그대로** 왼쪽에서 오른쪽으로 선다 — 위 편성 카드와
 * 자리가 맞아야 «누가 얼마나»를 눈으로 그대로 잇는다. 딜 1·2위는 자리를 옮기지 않고
 * 뱃지와 테두리로만 표시한다.
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
    // 막대는 «1위 대비»로 그린다 — 기여%로 그리면 다섯이 다 짧아 차이가 안 보인다.
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    card.append(track);

    // 평타/스킬 분해와 스킬별 내역. 카드가 좁으니 접어 둔다.
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

// 블라블라링크 조회 프록시. 빌드 때 `VITE_BLABLA_PROXY`로 박히고, 비어 있으면 연동 UI를
// 그리지 않는다 — 프록시 없이 브라우저에서 직접 부르면 CORS와 로그인 세션 두 가지가 동시에
// 막아 반드시 실패한다(`worker/README.md`).
const BLABLA_PROXY = (import.meta.env.VITE_BLABLA_PROXY ?? '').trim().replace(/\/+$/, '');

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, settings, version, client, storage, reload } = deps;
  const blablaProxy = (deps.blablaProxy ?? BLABLA_PROXY).trim().replace(/\/+$/, '');
  const cache = new ResultCache(storage, version, 30);
  const catalogByName = new Map(catalog.map((char) => [char.name, char]));
  const decks = Array.from({ length: 5 }, (_, index) => emptyDeck(index + 1));
  decks[0]!.squad = initialSquad(catalog);
  let activeDeckId = 1;
  let activeSlot = 0;
  // 겨냥한 칸을 화면으로 끌어오는 것은 **사용자가 칸을 바꿨을 때만** 한다.
  // 결과가 도착해도 편성은 다시 그려지는데, 그때마다 끌어오면 결과를 보던 사람이
  // 편성 쪽으로 튕겨 올라간다.
  let pullActiveSlot = false;
  // 다른 덱에 만들어 둔 개별 설정을 편성할 때 따라오게 할지. 기본은 켬이다.
  let carryOverSettings = true;
  let fiveDeckMode = false;
  let activity: 'preparing' | 'ready' | 'running' | 'complete' | 'cached' | 'error' = 'preparing';

  const ROSTER_KEY = 'nikke-roster-v1';
  const resolveStorage = (): StorageLike | null => {
    const source = typeof storage === 'function' ? storage() : storage;
    return source ?? null;
  };
  // jsdom에는 scrollIntoView가 없다. 화면을 끌어오는 건 편의라, 없는 환경에서는
  // 건너뛰어도 렌더가 깨지지 않는다 — 직접 부르면 테스트가 처리되지 않은 오류로 끊긴다.
  const scrollTo = (el: HTMLElement) => {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  const cloneOverride = (value: object): CharacterOverrides =>
    JSON.parse(JSON.stringify(value)) as CharacterOverrides;
  // 예전 판(육성 프로필 불러오기)이 저장한 오버로드는 값이 **줄별 배열**일 수 있다.
  // 지금은 스칼라만 다루므로 합계로 옮긴다 — 두면 요약을 그릴 때 toFixed에서 끊긴다.
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
      /* 저장 실패는 무시 (용량·프라이빗 모드 등) */
    }
  };
  let roster = loadRoster();

  // 편성·설정·전투 조건을 localStorage에 저장해 새로고침해도 마지막 상태로 복원한다.
  const STATE_KEY = 'nikke-state-v1';
  // 3凸ボードの «取り込まずに試す» を覚える鍵。PAD と同一オリジンなので nikke- を必ず付ける
  const BOARD_SKIP_KEY = 'nikke-board-skip-import-v1';
  interface SavedState {
    decks: DeckState[];
    fiveDeckMode: boolean;
    activeDeckId: number;
    /** 다른 덱의 개별 설정을 편성할 때 이어받을지. 옛 저장본에는 없다. */
    carryOverSettings: boolean;
    battle: BattleSettings;
    buffTargets: Array<{ id: number; sig: string; rows: Record<string, BuffTargetRow[]> }>;
  }
  // 큐브 이름이 짧은 통칭에서 인게임 정식 명칭으로 바뀌었다. 이전 버전에서 저장된
  // 편성에는 옛 이름이 남아 있어 그대로 두면 엔진이 요청을 거부한다. 불러올 때 한 번
  // 옮겨주고, 카탈로그에 없는 이름은 캐릭터 기본값으로 되돌아가도록 지운다.
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
  // 실제 구현은 refs·readBattle이 준비된 뒤 할당한다. 그전 호출은 no-op.
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

      <nav class="view-tabs" aria-label="画面切り替え">
        <button type="button" class="view-tab is-on" data-view-tab="board" aria-pressed="true">3凸ボード<b class="tab-beta">NEW</b></button>
        <button type="button" class="view-tab" data-view-tab="calc" aria-pressed="false">計算機</button>
        <button type="button" class="view-tab" data-view-tab="roster" aria-pressed="false">マイロスター</button>
        <button type="button" class="view-tab" data-view-tab="plans" aria-pressed="false">属性別編成</button>
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
              <li><a href="https://www.blablalink.com/user" target="_blank" rel="noreferrer noopener">blablalink.com</a> をログインした状態で開く</li>
              <li>そのタブで <b>F12</b> → <b>Console</b> を開く</li>
              <li>下のコードをコピーして貼り、Enter (数十秒かかります)</li>
              <li>コピーされた文字列を、いちばん下の欄に貼って「取り込む」</li>
            </ol>
            <p class="board-scan-warn"><b>貼る前に必ず中身を確認してください。</b>ログイン中のサイトでコンソールにコードを貼る操作は、乗っ取り詐欺が使う手口と同じ形です。ここのコードは<b>読み取ってコピーするだけ</b>で、外部への送信はありません。<b>他所で配られた似たコードは絶対に貼らないでください。</b></p>
            <textarea class="board-scan-code" data-board-scan-code rows="4" readonly spellcheck="false"></textarea>
            <div class="board-scan-row">
              <button type="button" class="roster-import" data-board-scan-copy>コードをコピー</button>
            </div>
            <textarea class="board-scan-paste" data-board-scan-paste rows="3" placeholder="コンソールが出した文字列 (NKP1-… ) をここに貼り付け" spellcheck="false"></textarea>
            <div class="board-scan-row">
              <button type="button" class="roster-import board-start-go" data-board-scan-import>取り込む</button>
              <span class="board-scan-status" data-board-scan-status></span>
            </div>
          </details>

          <div class="board-start-alt">
            <input id="board-csv" type="file" accept=".csv,text/csv" hidden />
            <button type="button" class="roster-import" data-board-csv-open title="Letsdoro のニケ情報 CSV を読み込みます">Letsdoro CSV を読み込む</button>
            <button type="button" class="roster-info" data-board-doro aria-label="Letsdoro CSV の入手方法" title="Letsdoro で CSV を入手する方法">i</button>
            <button type="button" class="board-start-skip" data-board-skip>取り込まずに試す</button>
          </div>
        </section>

        <div class="board-main" data-board-main>
        <h2 id="board-heading" class="board-sec">3凸を組む · ${UNION_SEASON.label}</h2>
        <p class="links-lede">枠ごとに<b>ボスを選ぶ</b>と、そのボスに有利なコードの編成 (属性別編成タブの案) が入ります。<b>同じニケは3凸のうち1度だけ</b>使えるので、他の枠と被った人は赤く出て、外す・譲るどちらが得かを計算します。</p>
        <p class="board-status" data-board-status hidden></p>
        <div class="board-slots" data-board-slots></div>
        <div class="board-total" data-board-total></div>
        <div class="board-used" data-board-used></div>
        <h3 class="board-sub">属性別の手持ち · 参考</h3>
        <p class="links-lede">被りを考えない場合の、属性ごとの最大値 (計算済みの案の中で)。<b>3凸に組むと分け合うので、これより下がります</b>。</p>
        <div class="board-stock" data-board-stocks></div>
        <h3 class="board-sub">詳しく見る</h3>
        <div class="board-more">
          <button type="button" data-board-goto="calc"><b>詳細計算</b><span>編成を手で組んで、戦闘条件・バースト順・タイムラインまで詰める (いまの計算機)</span></button>
          <button type="button" data-board-goto="roster"><b>マイロスター</b><span>取り込んだ育成状況。どこが伸びしろかを属性別・スキル別に見る</span></button>
          <button type="button" data-board-goto="union"><b>ユニオン運営</b><span>メンバー全員ぶんを一括で計算し、盤面をコードで配る (運営者向け)</span></button>
        </div>
        </div>
      </section>

      <section class="panel plans-panel" data-view="plans" aria-labelledby="plans-heading" hidden>
        <div class="section-heading">
          <div><p class="step">PLANS</p><h2 id="plans-heading">属性別編成</h2></div>
        </div>
        <p class="links-lede">コードごとに<b>本命の編成を3つまで</b>置いておく場所です。ここではボスの癖 (コア・パーツ・区間) を考えず、<b>有利コードだけ</b>を見ます。ボスに合わせた調整は計算機側で重ねてください。</p>
        <div class="plans-boss" data-plans-boss>
          <h3>ボス条件で確かめる</h3>
          <p class="plans-boss-lede">上の比較は<b>ボスの癖なし</b>です。実際のボスではコアやパーツで順位が入れ替わることがあるので、ここで並べて確かめます。</p>
          <div class="plans-boss-row">
            <select data-plans-boss-pick aria-label="ボス"></select>
            <label class="toggle-field mode-toggle"><input type="checkbox" data-plans-boss-core /><span class="toggle"></span><span>コアあり</span></label>
            <label class="toggle-field mode-toggle"><input type="checkbox" data-plans-boss-parts /><span class="toggle"></span><span>破壊可能パーツあり</span></label>
            <button type="button" class="roster-import" data-plans-boss-run>このボスで比べる</button>
          </div>
          <p class="plans-note" data-plans-boss-note hidden></p>
          <div class="plans-boss-result" data-plans-boss-result></div>
        </div>
        <div class="plans-groups" data-plans-groups></div>
      </section>

      <section class="panel roster-panel" data-view="roster" aria-labelledby="roster-heading" hidden>
        <div class="section-heading">
          <div><p class="step">ROSTER</p><h2 id="roster-heading">マイロスター</h2></div>
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
                  <th>優越</th><th>攻撃</th><th>装弾</th><th>キューブ</th><th>コレクション</th><th>戦闘力</th>
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
            <input type="search" class="roster-search" data-roster-search placeholder="名前で検索 (ラピ / 라피 / ㄹㅍ)" autocomplete="off" aria-label="ニケ名検索" />
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
              <p class="field-note"><b>回避区間</b>は通常攻撃だけが外れます。持続ダメージ・スキルダメージと、通常攻撃で発動した追加攻撃は入り続けます。<b>属性制限</b>は選んだ属性に<b>優越する</b>キャラクターのダメージだけを通します — 風圧にすると灼熱のキャラクターだけが入ります。ゲーム内と同様に<b>優越コードバフ</b>で優越になったキャラクターも通ります(ラピ:レッドフードの «付着型榴弾» など)。</p>
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
  // 타임라인은 «계산 결과가 있는가»와 «지금 계산기 화면인가» 둘 다 만족할 때만 보인다.
  let timelineHasContent = false;
  const timelineBody = element<HTMLElement>(root, '[data-timeline-body]');
  const coreToggle = element<HTMLInputElement>(root, '#has-core');
  const corePxInput = element<HTMLInputElement>(root, '#core-px');
  const rosterInput = element<HTMLInputElement>(root, '#roster-csv');
  const rosterNote = element<HTMLElement>(root, '[data-roster-note]');

  const activeDeck = () => decks[activeDeckId - 1]!;

  /**
   * 編成 (ニケ名の並び) を、いま見ているデッキに入れる。
   * 育成値はロスターを正本にする — 取り込み直せばここも新しい値になる。
   */
  const applySquadToDeck = (squad: readonly string[]) => {
    const deck = activeDeck();
    deck.squad = Array.from({ length: 5 }, (_, i) => squad[i] ?? '');
    for (const name of deck.squad) {
      if (name && !deck.characters[name] && roster[name]) {
        deck.characters[name] = cloneOverride(roster[name]!);
      }
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
        // 덱을 옮기면 판이 겨냥하는 칸도 그 덱 기준으로 다시 잡는다.
        const empty = deck.squad.findIndex((member) => !member);
        activeSlot = empty < 0 ? 0 : empty;
        // 패널은 '현재 덱' 기준이라 덱을 옮기면 닫는다 (열린 채로 두면 대상이 헷갈린다).
        closeDeckCopy();
        saveState();
        renderDeckTabs();
        renderSquad();
      });
      deckTabs.append(button);
    }

    const moves = element<HTMLElement>(root, '[data-deck-moves]');
    moves.replaceChildren();

    // 덱 순서 바꾸기. 덱 «번호»는 자리 이름이라 그대로 두고 **내용만** 맞바꾼다 —
    // 번호까지 따라 움직이면 지금 보던 덱이 어디로 갔는지 알 수 없다.
    const swapDeck = (delta: number) => {
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= decks.length) return;
      const a = decks[index]!;
      const b = decks[target]!;
      [a.squad, b.squad] = [b.squad, a.squad];
      [a.characters, b.characters] = [b.characters, a.characters];
      // 방금 옮긴 편성을 따라간다.
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

  // 덱 복사 — 같은 편성을 여러 덱에 깔아두고 딜러 한 자리만 바꿔 비교하는 용도다.
  // 편성(squad)과 캐릭터별 설정(characters)을 함께 복사해야 비교가 공정하다.
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
      // 비어 있는 덱은 잃을 게 없으므로 기본 선택. 이미 짜둔 덱은 사용자가 직접 고른다.
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
    // 슬롯별 캐릭터 필터는 화면 상태일 뿐이라 같이 옮겨 검색어가 남지 않게 한다.

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

  // 최근 계산에서 나온 「누가 이 버프를 받았나」. 덱 단위로 들고 있다가 카드에 얹는다.
  // 계산 전에는 비어 있고, 그때는 빈 괄호로 자리만 잡는다.
  // 값과 함께 **무엇을 계산한 결과인가**(편성 + 개별 설정)를 적어 둔다. 편성이나
  // 스펙을 바꾸면 대상이 달라질 수 있으므로, 서명이 어긋나면 지난 값을 쓰지 않는다.
  const buffTargetsByDeck = new Map<number, { sig: string; rows: Record<string, BuffTargetRow[]> }>();

  const deckSignature = (deck: DeckState): string =>
    JSON.stringify([deck.squad, deck.characters]);

  // ── 버프 대상 미리 계산 ──────────────────────────────────────────────────
  // 수령자는 실제 발동 로그에서만 나온다(대상이 최종 공격력으로 갈리고 전투 중
  // 바뀌기도 한다). 그래서 계산 버튼을 누르기 전에 **배경으로 한 번 돌려** 미리
  // 채운다. 결과는 정식 계산과 같은 캐시를 쓰므로 이어서 «실행»을 눌러도 덤이 없다.
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let prefetching = false;
  // 배경 계산이 도는 덱. 그 사이 화면에는 `[계산중]`으로 나온다.
  let prefetchingDeckId: number | undefined;

  const needsPrefetch = (deck: DeckState): boolean => {
    if (!deck.squad.some((name) => name && settings.buffTargetWatch?.[name])) return false;
    return buffTargetsByDeck.get(deck.id)?.sig !== deckSignature(deck);
  };

  const prefetchBuffTargets = () => {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(async () => {
      // 정식 계산이 도는 중이면 워커를 뺏지 않는다 — 끝나면 어차피 채워진다.
      if (prefetching || submit.disabled) return;
      const deck = activeDeck();
      if (!needsPrefetch(deck)) return;
      prefetching = true;
      prefetchingDeckId = deck.id;
      renderSquad();
      try {
        await prepared;
        const request = requestForDeck(deck, readBattle());
        if (validateRequest(request).length > 0) return;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        // 기다리는 사이 편성이 바뀌었을 수 있다 — 서명이 맞을 때만 반영한다.
        const now = activeDeck();
        if (now.id !== deck.id || deckSignature(now) !== deckSignature(deck)) return;
        if (result.buffTargets) {
          buffTargetsByDeck.set(deck.id, { sig: deckSignature(deck), rows: result.buffTargets });
          saveState();
          renderSquad();
        }
      } catch {
        /* 미리 계산은 편의 기능이다 — 실패해도 조용히 넘어간다 */
      } finally {
        prefetching = false;
        prefetchingDeckId = undefined;
        renderSquad();
      }
    }, 700);
  };


  /** 이 덱에서 감시 대상 버프를 가진 캐릭터의 표시 줄. 아직 안 돌렸으면 빈 대상. */
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

  // 「순서보기」 — 버프가 발동할 때마다 누가 받았는지 초상화로 죽 편다.
  // 대상이 갈리는 편성에서는 이 순서 자체가 정보다(앨리스-홍련-앨리스-홍련…).
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

  // ── 캐릭터 설정 창 ──────────────────────────────────────────────────────
  // 어떤 캐릭터의 어느 뭉치를 보고 있는지 기억한다. 값을 바꾸면 카드가 다시 그려지고
  // 뭉치도 새로 만들어지므로, 그때마다 새 뭉치를 창에 다시 넣어 준다.
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

  // ── 끌어다 놓기 ─────────────────────────────────────────────────────────
  // 누르는 길(칸을 고르고 카드를 누른다)은 그대로 두고 «끌어다 놓기»를 더한다.
  // 손가락에서는 HTML 끌기가 동작하지 않으므로, 누르는 길이 없어지면 안 된다.
  const DRAG_NAME = 'application/x-nikke-name';   // 니케 고르기 → 칸
  const DRAG_SLOT = 'application/x-nikke-slot';   // 칸 → 칸 (자리 맞바꾸기)

  /** 이 끌기가 우리 것인가. `dragover`에서는 값이 아니라 종류만 볼 수 있다. */
  const dragKind = (event: DragEvent): 'name' | 'slot' | null => {
    const types = event.dataTransfer?.types;
    if (!types) return null;
    const has = (type: string) => Array.prototype.includes.call(types, type);
    if (has(DRAG_NAME)) return 'name';
    if (has(DRAG_SLOT)) return 'slot';
    return null;
  };

  /** 칸 하나를 받는 자리로 만든다. */
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
        // 자리만 맞바꾼다. 개별 설정은 이름에 걸려 있어 슬롯과 무관하다.
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
      // 한 덱에 같은 니케를 두 번 넣을 수 없다 — 누르는 길에서 막는 것과 같은 규칙이다.
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
    // 버스트 순서는 편성에 매여 있다 — 편성이 바뀌면 배지도 따라간다.
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
        // 채워진 칸은 집어서 다른 칸에 놓을 수 있다 — ‹ › 단추와 같은 «자리 맞바꾸기»다.
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
      // 슬롯 번호와 속성 아이콘은 좌상단에 나란히 선다. 번호 폭이 자릿수에 따라
      // 달라져도 아이콘이 겹치지 않도록 절대배치 대신 한 줄로 묶는다.
      const tags = document.createElement('div');
      tags.className = 'slot-tags';
      tags.append(createText('span', `0${index + 1}`, 'slot-number'));
      if (char) {
        const codeIcon = createElementIcon(char.elementCode, 'slot-code');
        if (codeIcon) tags.append(codeIcon);
      }
      portrait.append(tags, createText('div', '', 'portrait-fallback'));

      // 자리 이동. 니케는 배치 순서가 전투에 영향을 주므로 캐릭터를 다시 고르지 않고
      // 자리만 맞바꿀 수 있어야 한다. 이름으로 걸린 설정(deck.characters)은 슬롯과
      // 무관하니 그대로 두고, 슬롯에 매인 편성과 검색어만 맞바꾼다.
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

      // 이름 검색과 드롭다운, 교체 버튼을 걷어냈다. 카드는 «지금 채울 칸»을 정하는
      // 역할만 하고, 고르는 일은 아래 상시 판이 맡는다. 검색 결과가 어디에도 숨지
      // 않게 하는 것이 이 화면의 요점이다.
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
      // 좁은 화면에서는 슬롯 줄이 옆으로 밀린다. 겨냥한 칸이 화면 밖에 있으면
      // 판이 어디를 채우는지 알 수 없으므로 끌어다 보여 준다.
      // jsdom에는 scrollIntoView가 없다. 없다고 렌더가 깨질 일은 아니므로 건너뛴다.
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
         * 창 안의 뭉치를 카드가 방금 그린 새 것으로 바꾼다. 값 하나를 바꾸면
         * `renderCharacterSettings`가 스스로 카드를 다시 그리는데, 그때 창에는 **옛
         * 뭉치**가 남아 있어 «직접 설정»으로 켠 체크박스가 여전히 잠겨 보였다.
         */
        const syncOpenPanel = () => {
          if (openCharPanel?.name !== cname || charPanelModal.hidden) return;
          const kind = openCharPanel.kind;
          // 그 뭉치를 여는 단추가 사라졌으면(개별 설정을 껐다) 창도 닫는다.
          const opener = editor.querySelector<HTMLElement>(`[data-char-panel-open="${kind}"]`);
          if (!opener) { closeCharPanel(); return; }
          // 없으면 이미 창에 있는 것이 최신이다 — 두 번 불려도 닫지 않는다.
          const fresh = editor.querySelector<HTMLElement>(`[data-char-panel="${kind}"]`);
          if (!fresh) return;
          placeCharPanel(fresh, cname, opener.querySelector('.disclosure-label')?.getAttribute('title') ?? '');
        };
        const renderEditor = () => {
          renderCharacterSettings(editor, cname, settings, deck.characters[cname], (next) => {
            if (next) deck.characters[cname] = next;
            else delete deck.characters[cname];
            saveState();
            // 개별 설정 안 드롭다운으로 돌파를 바꿔도 초상화의 별이 따라가게 한다.
            renderGrowthStepper();
            // 이 콜백은 카드가 다시 그려지기 **직전**에 불린다 — 다 그린 뒤에 창을 맞춘다.
            queueMicrotask(syncOpenPanel);
          }, buffTargetRowsFor(deck.id, cname), (row) => showBuffOrder(cname, row),
          (kind, panel, label) => {
            openCharPanel = { name: cname, kind };
            placeCharPanel(panel, cname, label);
          },
          // 조합 조건부 컨트롤(아인 + 에이다 = 홀드)을 카드가 스스로 판정하게 한다.
          deck.squad.filter((slot): slot is string => Boolean(slot)));
          syncOpenPanel();
        };

        // 초상화 우측하단의 돌파·코어 강화 스테퍼. blablalink 도감처럼 별 + 진화 숫자로
        // 명함~풀코를 한눈에 보이고, 좌우 −/+로 바로 조절한다. 개별 설정을 펼치지 않아도
        // 손이 닿는 자리다. R(성장 없음)은 조절할 게 없으니 아예 그리지 않는다.
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
            // 별 그림은 blablalink 도감의 스프라이트(25프레임)를 그대로 쓴다 — CSS에서
            // 채워진 별/빈 별 프레임을 background-position으로 고른다.
            const star = document.createElement('span');
            star.className = i < Math.min(stage, 3) ? 'growth-star is-on' : 'growth-star';
            stars.append(star);
          }
          // 진화 뱃지는 도감처럼 0일 때도 자리를 지킨다 — 켜졌다 꺼졌다 하면
          // 별 줄의 폭이 흔들려 카드가 들썩인다.
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
    // 편성·개별 설정·덱 전환이 모두 이 함수를 지난다 — 미리 계산 예약은 여기 한 곳.
    prefetchBuffTargets();
  };

  // ── 콘솔 ────────────────────────────────────────────────────────────────
  // 클래스·기업은 소속별로 따로 큰다. 목록은 카탈로그가 정본이라(로스터에서 뽑는다)
  // 신규 기업·클래스가 생겨도 코드는 그대로다.
  //
  // 만든 입력을 Map으로 들고 읽고 쓴다 — 소속명이 그대로 들어가는 선택자를 쓰면
  // 이스케이프에 기대게 되고(`CSS.escape`), 그 API가 없는 환경에서 통째로 깨진다.
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
      // 인게임·블라블라링크와 같은 순서 — 공통 → 기업 → 클래스.
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

  // ── 적정거리 ────────────────────────────────────────────────────────────
  // 무기군마다 적과의 적정 사거리가 달라, 같은 전투에서도 어떤 무기군은 적정거리에
  // 들고 어떤 무기군은 못 든다 → 여럿을 함께 켤 수 있어야 한다.
  // 목록 정본은 `data/weapon_mechanics.json`(설정으로 내려온다). 콘솔과 같은 이유로
  // 선택자 대신 Map으로 들고 읽고 쓴다.
  const rangeInputs = new Map<string, HTMLInputElement>();

  const renderOptimalRange = () => {
    const box = element<HTMLElement>(root, '[data-optimal-range]');
    box.replaceChildren();
    rangeInputs.clear();
    // 적정거리가 없는 무기군(런처)은 아예 그리지 않는다 — 켤 수 있게 두면
    // 인게임에 없는 보정을 켜게 된다. 목록의 정본은 무기 데이터다.
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

  // ── 평타 계수 ───────────────────────────────────────────────────────────
  // 시뮬은 쏜 탄이 전부 맞는다고 보지만 인게임은 탄퍼짐으로 빗나간다. 무기군마다
  // 퍼짐이 다르므로 무기군 단위로 받고, 기본값은 설정(데이터)에서 내려온다.
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

  // ── 보스 페이즈 (족자 · 속저) ───────────────────────────────────────────
  // 구간은 개수가 정해지지 않아 입력을 미리 만들어 둘 수 없다 — 배열을 정본으로
  // 들고 그릴 때마다 새로 만든다. 입력값이 잘못돼도(시작>끝) 지우지 않고 그대로
  // 두고, 실행할 때 검증 메시지로 알린다.
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
      // 마지막 구간 뒤를 기본값으로 잡아, 겹치지 않는 구간을 이어 붙이기 쉽게 한다.
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

  // ── 덱마다 다른 버스트 게이지 충전 ──────────────────────────────────────
  // 버스트 쿨이 밀리는 덱이 있어 하나로 묶으면 그 덱만 계속 틀린다. 기본은 일괄이고,
  // 켤 때만 다섯 칸이 나온다 — 켜는 순간 지금 값으로 다섯을 채워 두므로 «켰더니 값이
  // 사라졌다»가 없다.
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
    // 배열은 화면이 아니라 이 변수가 정본이다 — 입력이 잘못돼도 지우지 않고
    // 그대로 실어 실행 시 검증 메시지로 알린다.
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
    // 싱크로 레벨이 없던 시절에 저장된 설정을 되살릴 때가 있다 — 기본값으로 채운다.
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
    // 이 항목이 생기기 전에 저장된 설정에는 없다 — 기본값으로 채운다.
    element<HTMLInputElement>(root, '#burst-reaction').value =
      String(battle.burstReaction ?? DEFAULT_BURST_REACTION);
    writeDeckRegen(battle.burstRegenPerDeck, battle.burstRegenTime);
    if (battle.console) {
      consoleCommon.value = String(battle.console.common_level);
      writeConsoleBuckets('class', battle.console.class_level);
      writeConsoleBuckets('company', battle.console.company_level);
    }
    // 조건이 창으로 들어간 뒤로 화면에 남는 표시는 요약 한 줄뿐이다. 프로그램이 값을
    // 써넣을 때는 change가 나지 않아 그 줄이 갱신되지 않았고, 「적 수치 초기화」와
    // 「받은 코드 적용」이 아무 일도 안 한 것처럼 보였다. 쓰는 자리에서 함께 끌고 간다.
    refreshBattleSummary();
  };

  // ── 전투 조건 접이판 ────────────────────────────────────────────────────
  // 조건은 한 번 정해 두면 계속 쓰는 값이라 접어 두고, 접힌 채로도 «무엇으로 재는지»를
  // 한 줄로 남긴다. 요약 문구는 공유 목록에 쓰는 것과 같은 함수를 쓴다.
  const battleOpen = element<HTMLButtonElement>(root, '[data-battle-open]');
  const battleModal = element<HTMLElement>(root, '[data-battle-modal]');
  const battleSummary = element<HTMLElement>(root, '[data-battle-summary]');
  const battleFirstNote = element<HTMLElement>(root, '[data-battle-first-note]');
  const refreshBattleSummary = () => {
    battleSummary.textContent = summarizeBattle(readBattle());
  };
  /** 첫 계산 전 강조. 한 번이라도 열어 봤거나 계산을 돌렸으면 더 붙잡지 않는다. */
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

  // ── 자세히 보기 ─────────────────────────────────────────────────────────
  // 켠 상태는 이 브라우저에 남는다 — 한 번 켜 둔 사람은 늘 그 눈으로 본다.
  const DETAIL_KEY = 'nikke-detail-damage-v1';
  /** 直前に描いた結果。バースト順序の «実際の周回数» を読むのに使う。 */
  let lastBatch: BatchResult | null = null;
  let detailDamage = false;
  try {
    detailDamage = resolveStorage()?.getItem(DETAIL_KEY) === '1';
  } catch { /* 저장된 값을 못 읽으면 줄여 쓰기(기본)로 간다 */ }

  /**
   * 「자세히 보기」 — 결과의 대미지를 줄이지 않고 1의 자리까지 적는다.
   *
   * 두 덱이 「1.24억」으로 똑같이 보이는데 실제로는 수십만이 갈리는 일이 있다.
   * 켠 상태는 이 브라우저에 남는다. 타임라인 눈금과 보고서 이미지는 자리가 좁아
   * 늘 줄여 적는다 — 여기서 바뀌는 것은 결과 패널뿐이다.
   */
  const dmg = (value: number): string =>
    (detailDamage ? formatExactDamage(value) : formatDamage(value));
  const dps = (value: number): string =>
    (detailDamage ? formatExactDps(value) : formatDps(value));

  const renderBatchResult = (batch: BatchResult) => {
    // 한 번이라도 돌렸으면 «조건부터 보라»는 강조는 물러난다.
    settleBattleNote();
    // 수령자는 실제 발동 로그에서 온다 — 결과가 들어와야 카드에 채울 수 있다.
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

    // 자세히 보기 — 「1.24억」 대신 1의 자리까지. 내려받지 않고 그 자리에서 본다.
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

    // 덱 순위 — 딜 내림차순으로 «등수»만 구한다. 세우는 순서는 끝까지 덱 번호 그대로다.
    const ordered = [...batch.decks].sort((a, b) => b.result.squadTotal - a.result.squadTotal);
    const ranking = new Map(ordered.map((entry, index) => [entry.deckId, index + 1]));
    const best = ordered[0]?.result.squadTotal ?? 0;
    const portraitOf = (name: string): string | undefined => {
      const image = catalogByName.get(name)?.image;
      return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
    };

    /** 덱 하나의 속. 캐릭터 카드와 사실 줄, 이탈 목록. */
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
      // 덱을 갈아 가며 볼 때는 줄이 짧고 비교가 쉽다. 한 덱만 볼 때는 카드가 편성과
      // 자리가 맞아 낫다 — 화면의 목적이 달라서 모양도 다르다.
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
      // 덱마다 탭 하나. **덱 번호 순서 그대로** 왼쪽에서 오른쪽으로 세우고, 딜 1·2위는
      // 자리를 옮기지 않고 뱃지로만 표시한다. 고른 덱만 아래에 자세히 편다.
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
        // 순위는 다섯 덱 모두에 적고, 1·2위만 색으로 강조한다. 자리는 덱 번호 순 그대로다.
        tab.className = 'deck-result-tab'
          + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
        tab.dataset.deckResultTab = String(entry.deckId);
        tab.dataset.deckRank = String(rank);
        const head = document.createElement('b');
        head.append(document.createTextNode(`デッキ ${entry.deckId}`));
        head.append(createText('em', `${rank}位`, 'deck-tab-rank'));
        // 덱끼리 견주는 자리라 줄이지 않고 온전한 숫자를 적는다 — «1.14억»으로는
        // 2위와의 차이가 읽히지 않는다.
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

    // 타임라인도 한 번에 하나만 본다 — 다섯을 세로로 쌓으면 어느 덱을 보고 있는지
    // 스크롤 중에 놓친다. 탭은 결과와 같이 **덱 번호 순서 그대로** 선다.
    timelineBody.replaceChildren();
    const blocks = new Map<number, HTMLElement>();
    for (const entry of batch.decks) {
      // 버스트 핀에 쓸 초상화. 캔버스가 직접 그리므로 URL만 넘긴다.
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

  // ── 버스트 순서 ─────────────────────────────────────────────────────────
  /** 이 판에서만 쓰는 요소 만들기. union-raid의 같은 이름 도우미와 짝이다. */
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K, className?: string, text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // 사이클마다 단계별로 누구를 쓸지 손으로 정한다. 창을 쓰는 이유는 **키보드를
  // 통째로 가져가기 때문**이다 — 탭 안에 두면 A·S·D·F·G가 검색칸과 부딪친다.
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

  /** 창이 열려 있는 동안의 작업본. 「이 순서로 두기」를 눌러야 덱에 남는다. */
  let burstPicks: Record<string, string> = {};
  let burstCycles = 1;
  let burstAt = 0;          // 지금 서 있는 걸음
  let burstSteps: BurstStep[] = [];

  const showBurstMsg = (message: string, ok = false) => {
    burstMsg.hidden = message === '';
    burstMsg.textContent = message;
    burstMsg.classList.toggle('is-ok', ok);
  };

  /** 「버스트 안 씀」으로 잡아 둔 사람. 후보에서 뺀다. */
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

  /** 덱 도구 줄의 단추에 「9사이클」처럼 적어 둔다 — 열지 않아도 걸려 있는지 보인다. */
  function renderBurstBadge(): void {
    const kept = sequenceForDeck(activeDeck());
    burstBadge.hidden = kept === null;
    burstBadge.textContent = kept ? `${kept.length}` : '';
    // 순서를 걸어 두면 단추 자체가 색을 바꾼다 — 열어 보지 않아도 걸린 게 보인다.
    burstOpenButton.classList.toggle('is-on', kept !== null);
  }

  /** 아직 안 고른 첫 칸으로 옮긴다. 창을 다시 열면 하던 자리에서 이어진다. */
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

    // ── 지금 걸음 ──
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
      // 「이 단계는 자동으로」 — 고른 것을 무르는 자리다.
      const auto = el('button', 'burst-pick is-auto' + (picked ? '' : ' is-on'));
      (auto as HTMLButtonElement).type = 'button';
      auto.append(el('span', 'burst-pick-name', '自動'));
      auto.append(el('b', 'burst-pick-key', '0'));
      auto.addEventListener('click', () => pickBurst(null));
      burstPicksBox.append(auto);
    }

    // ── 적어 둔 것 ──
    // 사이클마다 **빈 칸 셋**이고, 고를 때마다 초상화가 채워진다. 글줄로 적으면
    // 스물일곱 칸 중 어디까지 왔는지가 안 읽힌다 — 빈 칸이 남아 있는 게 보여야 한다.
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

  /** 한 칸 고르고 다음으로. `null`이면 그 칸을 자동으로 되돌린다. */
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
    // 사이클 수: 적어 둔 게 있으면 그만큼, 아니면 지난 계산의 **실제 횟수**,
    // 그것도 없으면 전투 시간으로 어림한다.
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

  // 키보드는 창이 열려 있을 때만 가져간다. 조합키가 눌린 입력은 브라우저 것이다.
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
    // 5덱을 끄면 «지금 보고 있던 덱»이 1덱 자리로 온다 — 2~5덱 중 하나만 계산하려고
    // 끄는 경우가 많은데, 그때마다 편성을 손으로 옮기는 건 번거롭다(유저 피드백).
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
  // 전투 조건 입력이 바뀌면 저장한다.
  form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.settings-panel')) { saveState(); refreshBattleSummary(); }
  });
  element<HTMLButtonElement>(root, '[data-reset-enemy]').addEventListener('click', () => {
    writeBattle(resetEnemy(readBattle()));
    saveState();
    showErrors([]);
  });
  // 니케 고르기 판. 창이 아니라 편성 바로 아래 늘 펼쳐져 있고, 검색은 이 판을 거른다.
  const rosterGrid = element<HTMLElement>(root, '[data-roster-grid]');
  const rosterSearch = element<HTMLInputElement>(root, '[data-roster-search]');
  const rosterEmpty = element<HTMLElement>(root, '[data-roster-empty]');
  const rosterCount = element<HTMLElement>(root, '[data-roster-count]');
  const rosterDesc = element<HTMLElement>(root, '[data-roster-desc]');
  // 필터는 **그룹 안에서는 OR, 그룹 사이에서는 AND**다. 무기 SG·SMG를 함께 켜면
  // 둘 중 하나면 통과하고, 거기에 클래스 화력형을 더하면 «화력형이면서 SG나 SMG»가 된다.
  // 인게임 도감이 이 방식이라 익숙하고, 하나만 고르는 것보다 훨씬 빨리 좁혀진다.
  type FilterKey = 'burst' | 'rarity' | 'class' | 'code' | 'weapon' | 'corp';
  const picked: Record<FilterKey, Set<string>> = {
    burst: new Set(), rarity: new Set(), class: new Set(),
    code: new Set(), weapon: new Set(), corp: new Set(),
  };
  type SortKey = 'power' | 'name' | 'element' | 'elementAtk';
  // 처음 보이는 순서는 전투력 높은 순이다 — 목록에서 먼저 찾는 것이 «내가 키운
  // 니케»라, 가나다순으로 세워 두면 매번 스크롤해서 찾아야 한다.
  const DEFAULT_SORT: SortKey = 'power';
  let sortKey: SortKey = DEFAULT_SORT;
  // 같은 항목을 다시 누르면 뒤집는다. 항목마다 «자연스러운» 방향이 달라서
  // (이름은 가나다순, 수치는 높은 순) 처음 고를 때는 그 방향으로 잡는다.
  let sortDesc = true;

  // ── 정렬 · 필터 판 ──────────────────────────────────────────────────────
  // 정렬은 «내 로스터에서 이 캐릭터가 얼마나 굴려졌나»를 본다. 오버로드 수치가
  // 그 척도라, CSV·프로필로 불러온 내 값이 있으면 그걸 쓰고 없으면 기본 스펙을 쓴다.
  const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
    { key: 'power', label: '戦闘力', hint: 'ゲーム内の戦闘力 — もう一度押すと逆順になります' },
    { key: 'name', label: '名前', hint: '五十音順 — もう一度押すと逆順になります' },
    { key: 'element', label: '優越コード', hint: 'オーバーロードの優越コードダメージ — もう一度押すと逆順になります' },
    { key: 'elementAtk', label: '優越+攻撃', hint: '優越コード + 攻撃力増加の合計 — もう一度押すと逆順になります' },
  ];

  /** 처음 고를 때의 방향. 이름은 오름차순, 수치는 높은 순이 자연스럽다. */
  const defaultDesc = (key: SortKey): boolean => key !== 'name';

  /** 이 캐릭터에게 실제로 적용될 오버로드 — 내 로스터 값이 우선이다. */
  const overloadOf = (name: string): Record<string, number> =>
    roster[name]?.overload ?? settings.characters[name]?.overload ?? {};

  // 전투력은 엔진이 기본 스탯까지 계산해야 나온다 — 워커를 한 번 돌려 받아 둔다.
  // 로스터를 바꾸면 값이 달라지므로 서명이 어긋나면 다시 받는다.
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
      /* 전투력은 정렬 편의 기능이다 — 실패해도 목록은 그대로 쓴다 */
    } finally {
      powerLoading = false;
    }
    if (powerAgain) { powerAgain = false; await loadCombatPower(); }
  };

  /** 버스트만 판 밖에 있다 — 값은 여기 두고 그리는 자리만 다르다. */
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

  /** 고른 필터 개수. 0이면 뱃지를 감춘다. */
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
    // 같은 값 안에서는 늘 이름순 — 정렬 방향을 바꿔도 동점끼리 요동치지 않는다.
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
    // 판을 접어도 무엇이 걸려 있는지 알 수 있게 요약을 남긴다.
    // 정렬은 늘 적혀 있다 — 기본이 전투력순이라, 안 적어 두면 «왜 가나다순이
    // 아닌가»를 판을 펼쳐야만 알 수 있다.
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

  /** 필터 칩 하나. 같은 칩을 다시 누르면 꺼진다 — 「전체」 칩을 따로 두지 않아도 된다. */
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
      // 삼각형으로 방향을 알린다 — 켜진 항목에만 붙는다.
      if (active) chip.append(createText('b', sortDesc ? '▼' : '▲', 'sort-caret'));
      chip.title = option.hint;
      chip.addEventListener('click', () => {
        // 같은 항목을 다시 누르면 뒤집고, 다른 항목이면 그 항목의 기본 방향으로 간다.
        if (active) sortDesc = !sortDesc;
        else { sortKey = option.key; sortDesc = defaultDesc(option.key); }
        // 전투력은 무거우니 고를 때 받는다. 오는 동안은 이름순으로 서 있는다.
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
  // 목록 위에 얹히는 판이라 드롭다운과 같은 규칙을 따른다 — 바깥을 누르거나
  // Esc면 닫힌다. 판 안과 판을 여는 줄(«필터 지우기» 포함)은 바깥이 아니다.
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
    // 직접 추가한 니케까지 포함해 지금 고를 수 있는 전체를 보여준다.
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
    // 칩으로 먼저 좁히고 검색어로 세운다. 검색은 초성과 구분자까지 받아
    // 「ㅋㄹㅇ」·「라피레드」가 걸리고, 친 이름이 맨 앞에 온다.
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
      // 이미 이 덱에 있으면 중복 편성이 안 되므로 눌리지 않게 둔다.
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
      // 버스트 단계 맞은편(우상단)에 속성 아이콘.
      const codeIcon = createElementIcon(char.elementCode, 'roster-code');
      if (codeIcon) portrait.append(codeIcon);
      if (char.preview) {
        // (임시) — 스킬 미공개라 창작한 값으로 도는 캐릭터. 고르기 전에 보여야 한다.
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
      // 끌어다 칸에 놓을 수도 있다. 이미 이 덱에 있는 니케는 누를 수 없으니 끌 수도 없다.
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
   * 다른 덱에 남아 있는 그 캐릭터의 개별 설정. 지금 보고 있는 덱은 빼고, 가장
   * 가까운 덱부터 찾는다 — 방금 만진 덱의 값이 가장 그럴듯하기 때문이다.
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
      // 다른 덱에서 이미 만져 둔 설정이 있으면 그것을 가져온다. 없으면 CSV·프로필로
      // 불러온 내 로스터 값을 쓴다. 덱을 옮길 때마다 같은 수치를 다시 넣는 일이
      // 가장 잦은 불편이었다 — 끄면 예전처럼 덱마다 따로 논다.
      const borrowed = carryOverSettings ? settingsFromOtherDeck(name) : undefined;
      if (borrowed) deck.characters[name] = borrowed;
      else if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
    }
    // 연달아 채울 수 있게 다음 빈 칸으로 옮겨 간다. 다 찼으면 방금 넣은 칸에 머문다.
    const next = deck.squad.findIndex((member) => !member);
    activeSlot = next < 0 ? slot : next;
    pullActiveSlot = true;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    // (임시) 캐릭터는 넣는 순간 바로 알린다 — 결과까지 가서야 알면 이미 늦다.
    if (catalogByName.get(name)?.preview) {
      status.textContent = `${labelFor(name)} はまだ(仮)登録です — スキルが公開されていないため、`
        + '仮に作成した値で計算します。実際の性能とは無関係なので参考程度にご覧ください。';
    }
  };

  /** 판이 어느 칸을 겨냥하는지 알려 준다. 창이 없으니 이 한 줄이 유일한 안내다. */
  const updatePickerTarget = () => {
    const deck = activeDeck();
    const filled = deck.squad.filter(Boolean).length;
    const current = deck.squad[activeSlot];
    rosterDesc.textContent = current
      ? `枠 ${activeSlot + 1} を ${labelFor(current)} の代わりに埋めます · ${filled}/5名`
      : `空き枠 ${activeSlot + 1} を埋めます · ${filled}/5名`;
  };

  // 접힌 채로 시작한다 — 무엇으로 재는지 한 줄은 처음부터 적혀 있어야 한다.
  refreshBattleSummary();
  renderFilterPanel();
  renderFilterState();
  rosterSearch.addEventListener('input', renderRosterGrid);

  // 완전 초기화 — 이 브라우저에 쌓인 저장 상태를 전부 버린다. 메모리 변수까지
  // 하나씩 되돌리는 대신 저장소를 비우고 페이지를 다시 띄워, 새로 방문한 것과
  // 같은 상태임을 보장한다.
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
    for (const key of [STATE_KEY, ROSTER_KEY, SYNC_META_KEY, ELEMENT_PLANS_KEY, BOARD_SKIP_KEY, RAID_BOARD_KEY]) {
      try {
        store?.removeItem(key);
      } catch {
        // 저장소를 못 쓰는 브라우저에서도 나머지 초기화는 계속한다.
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
  // マイロスターの描き直し。取込のたびに呼ぶ (中身は下で差し込む)。
  let renderMyRoster: () => void = () => undefined;
  let renderPlans: () => void = () => undefined;
  let renderBoard: () => void = () => undefined;
  let renderBoardSync: () => void = () => undefined;
  // 盤面の STEP 1 (取り込み) を開く。マイロスターの空状態からも呼ぶ。
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
    if (consoleLevels) writeBattle({ ...readBattle(), console: consoleLevels });

    saveState();
    renderDeckTabs();
    renderSquad();
    rememberSync({ schemaVersion: 1, at: new Date().toISOString(), matched: matched.length, ...meta });

    const carried = Object.keys(roster).length - matched.length;
    return { matched, unmatched, notes, refreshed, carried, console: Boolean(consoleLevels) };
  };
  element<HTMLButtonElement>(root, '[data-roster-csv-open]').addEventListener('click', () => rosterInput.click());

  // 블라블라링크 연동. 프록시가 설정된 빌드에서만 마크업이 있으므로 없으면 통째로 건너뛴다.
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

  // ── 병렬 계산 ───────────────────────────────────────────────────────────
  // 계산은 이 기기에서 돈다. 워커를 여럿 띄우면 덱을 나눠 돌려 빨라지지만, 워커마다
  // 계산 런타임이 하나씩 떠서 메모리를 먹는다 — 그래서 끌 수 있고 개수도 고를 수 있다.
  // 결과는 몇 개로 나누든 같다(판마다 독립·결정론적).
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
  // 권장값은 칸을 넓히지 않게 설명 쪽에만 적는다 — 토글 줄이 길어지면 줄이 접힌다.
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
  // 保存されるのは**顔ぶれだけ**。各キャラの育成値はロスター側を見るので、
  // 取り込み直せばここの案も自動で新しい育成値で計算される。
  // 案は3凸ボードも読むので、両方の外に置く
  let plans: ElementPlans = loadPlans(resolveStorage());
  {
    const groupsBox = element<HTMLElement>(root, '[data-plans-groups]');
    // 計算中かどうかはボタンではなくここに持つ。保存・削除で renderPlans() が
    // ボタンごと作り直すため、disabled だけに頼ると二重に走らせられる。
    let comparing = false;
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

    renderPlans = () => {
      groupsBox.replaceChildren();
      for (const code of PLAN_ELEMENTS) {
        const group = el('div', 'plans-group');
        group.dataset.plansGroup = code;

        const head = el('div', 'plans-group-head');
        const title = createText('h3', `${elementLabel(code)} 編成`);
        const against = createText('span', `${elementLabel(BEATS[code])}ボス向け`, 'plans-against');
        const save = el('button', 'roster-import', '今の編成を保存');
        (save as HTMLButtonElement).type = 'button';
        save.dataset.plansSave = code;
        save.title = '計算機で今開いているデッキの顔ぶれを、この属性の案として保存します';
        save.addEventListener('click', () => {
          const result = addPlan(plans, code, activeDeck().squad);
          if (result.added) {
            const saved = commit(result.plans);
            say(code, saved ? '保存しました。'
              : 'この画面では使えますが、ブラウザに保存できませんでした (次に開くと消えます)。', saved);
            return;
          }
          say(code, result.reason === 'full'
            ? `この属性は既に ${MAX_PLANS_PER_ELEMENT} 案あります。どれかを消してから保存してください。`
            : result.reason === 'duplicate' ? '同じ顔ぶれの案が既にあります。'
              : '計算機の編成が空です。先にニケを入れてください。');
        });
        const compare = el('button', 'roster-import', '3案を比較');
        (compare as HTMLButtonElement).type = 'button';
        compare.dataset.plansCompare = code;
        compare.title = 'ボスの癖を外した同じ条件で、この属性の案を順に計算します';
        compare.addEventListener('click', () => { void comparePlans(code, compare as HTMLButtonElement); });
        head.append(title, against, save, compare);
        group.append(head);

        const note = el('p', 'plans-note');
        note.dataset.plansNote = code;
        note.hidden = true;
        group.append(note);

        const list = el('div', 'plans-list');
        const saved = plansOf(plans, code);
        if (saved.length === 0) {
          list.append(createText('p', 'まだ案がありません。計算機で編成を組んで「今の編成を保存」を押してください。', 'plans-empty'));
        }
        saved.forEach((plan, index) => {
          const row = el('div', 'plans-row');
          row.dataset.plansRow = plan.id;
          row.append(createText('b', `案 ${index + 1}`, 'plans-index'));
          const members = el('span', 'plans-members');
          for (const name of plan.squad.filter(Boolean)) {
            members.append(createText('span', labelFor(name), 'plans-chip'));
          }
          row.append(members);
          const score = el('span', 'plans-score');
          score.dataset.plansScore = plan.id;
          row.append(score);
          const apply = el('button', 'roster-import', '計算機に入れる');
          (apply as HTMLButtonElement).type = 'button';
          apply.dataset.plansApply = plan.id;
          apply.addEventListener('click', () => {
            applySquadToDeck(plan.squad);
            say(code, `案 ${index + 1} を計算機のデッキ ${activeDeckId} に入れました。`, true);
          });
          const drop = el('button', 'roster-import danger', '削除');
          (drop as HTMLButtonElement).type = 'button';
          drop.dataset.plansRemove = plan.id;
          drop.addEventListener('click', () => {
            const saved = commit(removePlan(plans, code, plan.id));
            if (!saved) say(code, 'この画面では消えましたが、ブラウザに保存できませんでした (次に開くと戻ります)。');
          });
          row.append(apply, drop);
          list.append(row);
        });
        group.append(list);
        groupsBox.append(group);
      }
    };

    // ── ボス条件で確かめる ──
    // 基準 (癖なし) とボス条件の両方を計算して並べる。片方だけ見せると、
    // なぜ順位が入れ替わったのか読めなくなる。
    const bossPick = element<HTMLSelectElement>(root, '[data-plans-boss-pick]');
    const bossCore = element<HTMLInputElement>(root, '[data-plans-boss-core]');
    const bossParts = element<HTMLInputElement>(root, '[data-plans-boss-parts]');
    const bossRun = element<HTMLButtonElement>(root, '[data-plans-boss-run]');
    const bossNote = element<HTMLElement>(root, '[data-plans-boss-note]');
    const bossResult = element<HTMLElement>(root, '[data-plans-boss-result]');

    for (const [index, boss] of UNION_SEASON.bosses.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${boss.name} (${elementLabel(boss.elementCode)})`;
      bossPick.append(option);
    }

    const sayBoss = (message: string, ok = false) => {
      bossNote.textContent = message;
      bossNote.hidden = !message;
      bossNote.classList.toggle('is-ok', ok);
    };

    const runOne = async (deckSquad: readonly string[], battle: BattleSettings) => {
      const deck: DeckState = {
        id: 1,
        squad: [...deckSquad],
        characters: Object.fromEntries(deckSquad.filter(Boolean)
          .filter((name) => roster[name])
          .map((name) => [name, cloneOverride(roster[name]!)])),
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
      const boss = UNION_SEASON.bosses[Number(bossPick.value)];
      if (!boss) return;
      const code = counterOf(boss.elementCode);
      if (!code) { sayBoss('このボスのコードに対応する編成がありません。'); return; }
      const saved = plansOf(plans, code);
      if (saved.length === 0) {
        sayBoss(`${elementLabel(code)} の案がまだありません。先に「今の編成を保存」で登録してください。`);
        bossResult.replaceChildren();
        return;
      }
      const base = readBattle();
      const plain = baselineBattle(base, code);
      const withBoss = bossConditionBattle(base, boss, {
        coreEnabled: bossCore.checked, hasParts: bossParts.checked,
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
          const plainTotal = await runOne(plan.squad, plain);
          done += 1;
          sayBoss(`計算中… ${done}/${saved.length * 2}`);
          const bossTotal = await runOne(plan.squad, withBoss);
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
        for (const label of ['案', '編成', '基準 (癖なし)', `${boss.name}`, '順位']) {
          head.append(createText('th', label));
        }
        table.append(head);
        for (const row of rows) {
          const tr = document.createElement('tr');
          tr.dataset.plansBossRow = String(row.index);
          tr.append(createText('td', `案 ${row.index}`));
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
    bossRun.addEventListener('click', () => { void runBossCheck(); });

    // 同じ土俵 (ボスの癖なし) で順に計算し、最大値を 100% として並べる。
    const comparePlans = async (code: PlanElement, button: HTMLButtonElement) => {
      if (comparing) { say(code, '別の比較が走っています。終わるまで待ってください。'); return; }
      const saved = plansOf(plans, code);
      if (saved.length === 0) { say(code, '比較する案がありません。'); return; }
      const battle = baselineBattle(readBattle(), code);
      comparing = true;
      button.disabled = true;
      say(code, `計算中… 0/${saved.length}`);
      const totals = new Map<string, number>();
      try {
        await prepared;
        let done = 0;
        for (const plan of saved) {
          const deck: DeckState = {
            id: 1,
            squad: [...plan.squad],
            // 育成値はロスターを正本にする — 取り込み直せばこの案も自動で新しい値になる
            characters: Object.fromEntries(plan.squad.filter(Boolean)
              .filter((name) => roster[name])
              .map((name) => [name, cloneOverride(roster[name]!)])),
          };
          const request = requestForDeck(deck, battle);
          const problems = [...validateRequest(request), ...validateCharacterValues(deck)];
          if (problems.length > 0) { say(code, `計算できません — ${problems[0]}`); return; }
          const key = cacheKey(request, version);
          let result = cache.get(key);
          if (!result) { result = await client.simulate(request); cache.set(key, result); }
          totals.set(plan.id, result.squadTotal);
          done += 1;
          say(code, `計算中… ${done}/${saved.length}`);
        }
        const best = Math.max(...totals.values());
        for (const [id, total] of totals) {
          const cell = groupsBox.querySelector<HTMLElement>(`[data-plans-score="${id}"]`);
          if (!cell) continue;
          const share = best > 0 ? Math.round((total / best) * 1000) / 10 : 0;
          cell.textContent = `${formatDamage(total)} (${share}%)`;
          cell.classList.toggle('is-best', total === best);
        }
        say(code, `${elementLabel(BEATS[code])}ボス相当 · 戦闘 ${battle.duration}秒 · コアとパーツ無しで比較しました。`, true);
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
    const bossNames = UNION_SEASON.bosses.map((boss) => boss.name);
    const bossByName = new Map(UNION_SEASON.bosses.map((boss) => [boss.name, boss]));
    const ELEMENT_CLASS: Record<string, string> = {
      작열: 'is-fire', 수냉: 'is-water', 풍압: 'is-wind', 전격: 'is-electric', 철갑: 'is-iron',
    };
    let board: RaidBoard = loadBoard(resolveStorage(), bossNames);
    // 計算中はボタンごと作り直されるので、disabled ではなくここで二重起動を止める
    let busy = false;
    /** 「編成を変える」を開いている枠。 */
    let chooserOpen: number | null = null;
    /**
     * この画面で出した点数。保存された結果 (cache) は容量で押し出されるので、別に持つ。
     * 鍵は**リクエストの cacheKey そのもの** — ロスターの育成値・戦闘条件・シンクロが変われば鍵も変わるので、
     * 古い条件の点数を新しい条件の数字として見せることがない (ボス+顔ぶれだけを鍵にすると起きる)。
     */
    const scores = new Map<string, number>();
    const SCORE_MEMORY = 120;

    const say = (message: string, ok = false) => {
      statusBox.textContent = message;
      statusBox.hidden = !message;
      statusBox.classList.toggle('is-ok', ok);
    };

    const commit = (next: RaidBoard) => {
      board = next;
      if (!saveBoard(resolveStorage(), board)) {
        say('この画面では使えますが、ブラウザに保存できませんでした (次に開くと消えます)。');
      }
      renderBoard();
    };

    /** 1枠ぶんのリクエスト。育成値はロスターが正本 — 取り込み直せば盤面も新しい値で計算される。 */
    const requestFor = (boss: UnionBoss, squad: readonly string[]) => {
      const deck: DeckState = {
        id: 1,
        squad: [...squad],
        characters: Object.fromEntries(squad.filter(Boolean)
          .filter((name) => roster[name])
          .map((name) => [name, cloneOverride(roster[name]!)])),
      };
      const request = requestForDeck(deck, boardBattle(readBattle(), boss));
      return { deck, request, key: cacheKey(request, version) };
    };

    /** 分かっている点数。計算はしない — 保存された結果があればそれを読む。 */
    const knownScore = (boss: UnionBoss, squad: readonly string[]): number | null => {
      if (isEmptySquad(squad)) return null;
      try {
        const { key } = requestFor(boss, squad);
        return scores.get(key) ?? cache.get(key)?.squadTotal ?? null;
      } catch {
        return null;
      }
    };

    const computeScore = async (boss: UnionBoss, squad: readonly string[]): Promise<number> => {
      const { deck, request, key } = requestFor(boss, squad);
      // 「計算」と同じ検証を通す (属性別編成と同じ理由)
      const problems = [...validateRequest(request), ...validateCharacterValues(deck)];
      if (problems.length > 0) throw new Error(problems[0]!);
      let result = cache.get(key);
      if (!result) {
        result = await client.simulate(request);
        cache.set(key, result);
      }
      scores.set(key, result.squadTotal);
      // 鍵はリクエスト全体の JSON なので、取込・条件変更を繰り返すと溜まる。古い順に落とす
      // (Map は挿入順を保つ)。上限は「全ボス×全案 (15) + 被りの代案」を余裕で超える程度
      while (scores.size > SCORE_MEMORY) scores.delete(scores.keys().next().value as string);
      return result.squadTotal;
    };

    interface Job { key: string; run: () => Promise<void> }
    const jobFor = (boss: UnionBoss | undefined, squad: readonly string[]): Job | null => {
      if (!boss || isEmptySquad(squad)) return null;
      let key: string;
      try {
        key = requestFor(boss, squad).key;
      } catch {
        // 組み立てられない編成は computeScore が同じ理由で失敗して伝える
        key = `${boss.name}/${squad.join('/')}`;
      }
      return { key, run: async () => { await computeScore(boss, squad); } };
    };
    /** 同じ候補を2度回さない。 */
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
    /** 計算機の並列設定に従って回す。進み具合は状態行に出す。 */
    const runJobs = async (jobs: Job[], what: string) => {
      if (jobs.length === 0) return;
      let done = 0;
      let next = 0;
      say(`${what} 0/${jobs.length}…`);
      const lane = async () => {
        while (next < jobs.length) {
          const job = jobs[next]!;
          next += 1;
          await job.run();
          done += 1;
          say(`${what} ${done}/${jobs.length}…`);
        }
      };
      const lanes = Math.max(1, Math.min(jobs.length, parallelOn ? parallelCount : 1));
      await Promise.all(Array.from({ length: lanes }, lane));
    };
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
    const battleNote = () => `戦闘 ${readBattle().duration}秒 · コアとパーツ無し`;
    const bossOf = (index: number): UnionBoss | undefined => {
      const name = board.slots[index]?.boss;
      return name ? bossByName.get(name) : undefined;
    };

    /** 枠の点数と、その枠の被りの代案 (外す / 譲る) の点数をそろえる。 */
    const slotJobs = (index: number): Array<Job | null> => {
      const slot = board.slots[index]!;
      const boss = bossOf(index);
      if (!boss) return [];
      const jobs: Array<Job | null> = [jobFor(boss, slot.squad)];
      for (const option of clashOptionsFor(board, index)) {
        const otherBoss = bossOf(option.other);
        jobs.push(jobFor(boss, option.here));
        jobs.push(jobFor(otherBoss, board.slots[option.other]!.squad));
        jobs.push(jobFor(otherBoss, option.there));
      }
      return jobs;
    };

    const computeSlots = (indexes: number[]) => withBusy(async () => {
      const jobs = dedupe(indexes.flatMap(slotJobs));
      if (jobs.length === 0) { say('計算する枠がありません。ボスを選んでください。'); return; }
      await runJobs(jobs, '計算中');
      say(`${battleNote()} で計算しました。`, true);
    });

    /** ボスを選ぶ → そのコードの案を入れる (点数が分かっている案があれば一番高いもの、無ければ案1)。 */
    const chooseBoss = async (index: number, name: string) => {
      chooserOpen = null;
      if (!name) { commit(clearSlot(board, index)); return; }
      const boss = bossByName.get(name);
      if (!boss) return;
      const { element: code, plans: options } = boardCandidatesFor(boss, plans);
      let squad = options[0]?.squad ?? ['', '', '', '', ''];
      let bestKnown = -Infinity;
      for (const plan of options) {
        const known = knownScore(boss, plan.squad);
        if (known !== null && known > bestKnown) { bestKnown = known; squad = plan.squad; }
      }
      commit(withSlot(board, index, { boss: name, squad }));
      if (options.length === 0) {
        say(code
          ? `${name} に有利な ${elementLabel(code)} 編成の案がまだありません。属性別編成タブで「今の編成を保存」してください。`
          : 'このボスのコードに対応する編成がありません。');
        return;
      }
      await computeSlots([index]);
    };

    /** 空き枠: 残りの人で一番出るボスを探す。 */
    const searchOpen = (index: number) => withBusy(async () => {
      const candidates = openSlotCandidates(board, index, UNION_SEASON.bosses, plans);
      if (candidates.length === 0) {
        say('入れられる案がありません。属性別編成タブで案を保存してください (他の枠と全員被る案は除きます)。');
        return;
      }
      await runJobs(dedupe(candidates.map((c) => jobFor(c.boss, c.squad))), '残りで探索中');
      let best: OpenCandidate | null = null;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        const score = knownScore(candidate.boss, candidate.squad);
        if (score !== null && score > bestScore) { bestScore = score; best = candidate; }
      }
      if (!best) { say('計算できる案がありませんでした。'); return; }
      commit(withSlot(board, index, { boss: best.boss.name, squad: best.squad }));
      say(best.removed.length > 0
        ? `${best.boss.name} (案 ${best.planIndex + 1}) が最大でした。他の枠と被る ${best.removed.map(labelFor).join('・')} は外してあります。`
        : `${best.boss.name} (案 ${best.planIndex + 1}) が最大でした。`, true);
    });

    /** 全候補 (ボス × 案) を計算し、被りなしで合計最大の3つを枠に入れる。 */
    const searchBest = () => withBusy(async () => {
      const all: Array<{ boss: UnionBoss; squad: string[] }> = [];
      for (const boss of UNION_SEASON.bosses) {
        for (const plan of boardCandidatesFor(boss, plans).plans) all.push({ boss, squad: plan.squad });
      }
      if (all.length === 0) { say('案がまだありません。属性別編成タブで「今の編成を保存」してください。'); return; }
      await runJobs(dedupe(all.map((c) => jobFor(c.boss, c.squad))), '全候補を計算中');
      const scored: Candidate[] = all.flatMap(({ boss, squad }) => {
        const score = knownScore(boss, squad);
        return score === null ? [] : [{ boss: boss.name, squad, score }];
      });
      const picked = bestTriple(scored);
      if (picked.length === 0) { say('計算できる案がありませんでした。'); return; }
      let next = emptyBoard();
      picked.forEach((candidate, index) => {
        next = withSlot(next, index, { boss: candidate.boss, squad: candidate.squad });
      });
      chooserOpen = null;
      commit(next);
      const total = formatDamage(picked.reduce((sum, candidate) => sum + candidate.score, 0));
      say(picked.length < BOARD_SLOTS
        ? `被りなしで組めたのは ${picked.length} 凸ぶんでした (合計 ${total})。属性別編成の案を増やすと3凸まで埋まります。`
        : `被りなしで最大の3凸を入れました (合計 ${total} · ${battleNote()})。`, true);
    });

    /** 被りを解く: 「こちらから外す」「相手から譲る」の両方を計算し、合計が大きい側にする。 */
    const resolveClash = (index: number, option: ClashOption) => withBusy(async () => {
      const slot = board.slots[index]!;
      const other = board.slots[option.other]!;
      const boss = bossOf(index);
      const otherBoss = bossOf(option.other);
      if (!boss || !otherBoss) return;
      await runJobs(dedupe([
        jobFor(boss, slot.squad), jobFor(boss, option.here),
        jobFor(otherBoss, other.squad), jobFor(otherBoss, option.there),
      ]), '代案を計算中');
      const hereTotal = (knownScore(boss, option.here) ?? 0) + (knownScore(otherBoss, other.squad) ?? 0);
      const thereTotal = (knownScore(boss, slot.squad) ?? 0) + (knownScore(otherBoss, option.there) ?? 0);
      const names = option.names.map(labelFor).join('・');
      // 外した結果だれも残らない枠は、ボスごと空に戻す — 「残りで一番出るボスを探す」が使える状態にする
      if (hereTotal >= thereTotal) {
        commit(isEmptySquad(option.here) ? clearSlot(board, index)
          : withSlot(board, index, { boss: slot.boss, squad: option.here }));
        say(`${names} を ${index + 1}凸目から外しました (合計 ${formatDamage(hereTotal)} ≥ 譲る場合の ${formatDamage(thereTotal)})。`
          + (isEmptySquad(option.here) ? ` ${index + 1}凸目は空になったので、残りで探し直せます。` : ''), true);
      } else {
        commit(isEmptySquad(option.there) ? clearSlot(board, option.other)
          : withSlot(board, option.other, { boss: other.boss, squad: option.there }));
        say(`${names} を ${option.other + 1}凸目から譲りました (合計 ${formatDamage(thereTotal)} > 外す場合の ${formatDamage(hereTotal)})。`
          + (isEmptySquad(option.there) ? ` ${option.other + 1}凸目は空になったので、残りで探し直せます。` : ''), true);
      }
    });

    /** 枠の編成とボス条件を計算機に載せて、詳細計算へ。 */
    const openInCalc = (index: number) => {
      const slot = board.slots[index]!;
      const boss = bossOf(index);
      if (!boss) return;
      applySquadToDeck(slot.squad);
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
        const mine = knownScore(boss, board.slots[index]!.squad);
        const hereScore = isEmptySquad(option.here) ? 0 : knownScore(boss, option.here);
        const theirs = knownScore(otherBoss, other.squad);
        const thereScore = isEmptySquad(option.there) ? 0 : knownScore(otherBoss, option.there);
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
      box.append(button('被りを解いて組み直す', 'board-btn lead', () => { void resolveClash(index, option); }));
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
      box.append(createText('p', `${elementLabel(code)} 編成の案 (属性別編成タブで保存したもの)`, 'board-chooser-head'));
      if (options.length === 0) box.append(createText('p', 'まだ案がありません。', 'board-chooser-empty'));
      options.forEach((plan, planIndex) => {
        const row = el('div', 'board-chooser-row');
        const current = sameSquad(plan.squad, board.slots[index]!.squad);
        const pick = button(`案 ${planIndex + 1}`, `board-btn${current ? ' is-on' : ''}`, () => {
          chooserOpen = null;
          commit(withSlot(board, index, { boss: boss.name, squad: plan.squad }));
          void computeSlots([index]);
        });
        pick.dataset.boardPick = `${index}:${plan.id}`;
        row.append(pick);
        const members = el('span', 'board-chooser-members');
        for (const name of plan.squad.filter(Boolean)) members.append(createText('span', labelFor(name), 'board-who'));
        row.append(members);
        const known = knownScore(boss, plan.squad);
        row.append(createText('span', known === null ? '' : formatDamage(known), 'board-chooser-score'));
        box.append(row);
      });
      box.append(button('属性別編成で案を作る', 'board-btn', () => switchView('plans')));
      return box;
    };

    const renderTotal = (slotScores: Array<number | null>) => {
      totalBox.replaceChildren();
      const clashes = clashesOf(board);
      const set = board.slots.filter((slot) => slot.boss).length;
      const left = el('div');
      left.append(createText('div', '3凸の合計 (見込み)', 'board-total-label'));
      left.append(createText('div', formatDamage(totalOf(slotScores)), 'board-total-val'));
      const used = el('div', 'board-total-used');
      used.dataset.boardSummary = '';
      used.append(document.createTextNode(`使用 ${usedCount(board)}名 / 被り `));
      used.append(createText('b', `${clashes.length}件`, clashes.length > 0 ? 'is-bad' : undefined));
      const notes: string[] = [];
      if (set < BOARD_SLOTS) notes.push(`${BOARD_SLOTS - set}枠が未設定です`);
      if (slotScores.some((score, index) => score === null && board.slots[index]!.boss
        && !isEmptySquad(board.slots[index]!.squad))) notes.push('未計算の枠があります');
      if (clashes.length > 0) notes.push('被りがあるとこの合計は出せません');
      for (const note of notes) used.append(el('br'), document.createTextNode(note));
      const actions = el('div', 'board-total-actions');
      const search = button('被りなしで最大の3凸を探す', 'board-btn lead', () => { void searchBest(); });
      search.dataset.boardSearchBest = '';
      search.title = '全ボス × 全案を計算し、同じニケを2度使わない組み合わせで合計が最大のものを入れます';
      const run = button('この3凸で計算する', 'board-btn main', () => { void computeSlots([0, 1, 2]); });
      run.dataset.boardRun = '';
      actions.append(search, run);
      totalBox.append(left, used, actions);
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
      for (const boss of UNION_SEASON.bosses) {
        const code = counterOf(boss.elementCode);
        if (!code) continue;
        const saved = plansOf(plans, code);
        let best: number | null = null;
        for (const plan of saved) {
          const known = knownScore(boss, plan.squad);
          if (known !== null && (best === null || known > best)) best = known;
        }
        const card = el('div', `board-el ${ELEMENT_CLASS[code] ?? ''}`);
        card.dataset.boardStock = code;
        card.append(createText('div', elementLabel(code), 'board-el-name'));
        card.append(createText('div', `${boss.name}戦`, 'board-el-vs'));
        const num = el('div', 'board-el-num');
        num.append(best !== null ? createText('b', formatDamage(best)) : createText('b', '—', 'is-blank'));
        card.append(num);
        card.append(createText('div',
          `案 ${saved.length}/${MAX_PLANS_PER_ELEMENT}${saved.length > 0 && best === null ? ' · 未計算' : ''}`,
          'board-el-plans'));
        stockBox.append(card);
      }
    };

    renderBoard = () => {
      const usage = usageOf(board);
      const slotScores = board.slots.map((slot, index) => {
        const boss = bossOf(index);
        return boss ? knownScore(boss, slot.squad) : null;
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
        for (const candidate of UNION_SEASON.bosses) {
          const option = el('option', undefined, `${candidate.name} (${elementLabel(candidate.elementCode)})`);
          option.value = candidate.name;
          select.append(option);
        }
        select.value = slot.boss ?? '';
        select.disabled = busy;
        select.addEventListener('change', () => { void chooseBoss(index, select.value); });
        head.append(select);
        head.append(createText('span',
          boss ? (code ? `${elementLabel(code)}で殴る` : '対応する案なし') : '未設定',
          `board-pill${boss && code ? '' : ' is-plain'}`));
        card.append(head);

        const dmg = el('div', 'board-dmg');
        dmg.dataset.boardScore = String(index);
        const score = slotScores[index] ?? null;
        if (score !== null) dmg.append(createText('b', formatDamage(score)));
        else {
          dmg.append(createText('b', '—', 'is-blank'));
          dmg.append(createText('span',
            !boss ? 'ボスを選ぶと候補が入ります' : isEmptySquad(slot.squad) ? '案がありません' : '未計算',
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
            boss ? '属性別編成に案がありません' : `残り ${Math.max(0, owned - usage.size)}名から選べます`,
            'board-who is-empty'));
        }
        for (const name of members) {
          const chip = createText('span', labelFor(name), 'board-who');
          if ((usage.get(name)?.length ?? 0) > 1) chip.classList.add('is-clash');
          team.append(chip);
        }
        card.append(team);

        for (const option of clashOptionsFor(board, index)) card.append(renderClash(index, option));

        const foot = el('div', 'board-slot-foot');
        if (!boss) {
          const find = button('残りで一番出るボスを探す', 'board-btn lead', () => { void searchOpen(index); });
          find.dataset.boardSearchOpen = String(index);
          foot.append(find);
        } else {
          const change = button(chooserOpen === index ? '閉じる' : '編成を変える', 'board-btn', () => {
            chooserOpen = chooserOpen === index ? null : index;
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
        if (chooserOpen === index && boss) card.append(renderChooser(index, boss));
        slotsBox.append(card);
      });
      renderTotal(slotScores);
      renderUsed(usage);
      renderStock();
    };

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
      boardReimport.hidden = !imported;
      if (syncMeta) {
        syncDot.classList.add('is-on');
        syncMain.textContent = `${SOURCE_LABELS[syncMeta.source]} から取込済み · ${syncMeta.matched}名`;
        syncSub.textContent = `最終取込 ${syncAgoText(syncMeta.at)} · シンクロ ${readBattle().synchroLevel}`;
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

  // ── マイロスター (育成状況) ──
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
      for (const boss of UNION_SEASON.bosses) {
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
    }
  }

  // ── 화면 전환 ───────────────────────────────────────────────────────────
  /** 위쪽 탭이 고를 수 있는 화면. 「외부고리」는 우리 것이 아닌 곳으로 나가는 판이다. */
  type ViewName = 'board' | 'calc' | 'roster' | 'plans';

  const shell = element<HTMLElement>(root, '.site-shell');
  let currentView: ViewName = 'board';
  function switchView(view: ViewName) {
    currentView = view;
    currentView = view;
    // 盤面はモックどおり 1000px 中央寄せ。計算機など他の画面は横に広い方が読みやすいので上流の幅のまま
    shell.classList.toggle('is-board', view === 'board');
    for (const section of root.querySelectorAll<HTMLElement>('[data-view]')) {
      const mine = section.dataset.view === view;
      // 타임라인은 계산 결과가 있을 때만 보이므로 여기서 켜지 않는다.
      if (section === timelinePanel) { section.hidden = !mine || !timelineHasContent; continue; }
      section.hidden = !mine;
    }
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
      const on = tab.dataset.viewTab === view;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-pressed', String(on));
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

  // 렛츠도로 CSV 받는 법 안내. 스크린샷이 아직 없으면 이미지만 숨긴다 — 링크·설명은 남는다.
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
        // 새로고침해도 「누가 이 버프를 받았나」가 남게 한다 — 다시 계산하기 전까지
        // 빈 괄호만 보이면 기능이 꺼진 것처럼 보인다.
        buffTargets: [...buffTargetsByDeck].map(([id, v]) => ({ id, ...v })),
      }));
    } catch {
      /* 저장 실패 무시 */
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
    // 「누가 이 버프를 받았나」는 서명이 지금 편성·설정과 맞을 때만 되살린다.
    // 어긋나면 지난 계산의 값이라 그대로 믿을 수 없다.
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
  // 판은 창이 아니라 늘 펼쳐져 있으므로 처음부터 그려 둔다.
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

  // 기본 정렬이 전투력이라 목록을 열기 전에 미리 받아 둔다. 오는 동안은 이름순으로
  // 서 있고, 도착하면 그 자리에서 다시 세운다.
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
      // 덱 하나하나는 서로 독립이라 나눠 돌려도 결과가 같다. 도착 순서만 뒤섞이므로
      // 화면에 세울 때 **덱 번호 순으로 다시 정렬**한다 — 좌→우가 곧 1→5덱이어야 한다.
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
      // 병렬을 꺼 뒀으면 한 판씩. 켜져 있으면 풀이 알아서 워커에 나눠 준다.
      const guarded = async (index: number) => {
        try {
          await runOne(index);
        } catch (error) {
          // 어느 덱이 깨졌는지 아래 catch가 알아야 한다 — 병렬에서는 «몇 개 끝났나»로
          // 짚을 수 없다(끝난 순서와 덱 번호가 다르다).
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

  return () => client.dispose();
}
