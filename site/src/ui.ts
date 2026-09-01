import { elementLabel, growthLabel, labelFor, labelForClass, labelForMaker } from './display-name';
import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { renderCharacterSettings, type CharPanelKind } from './character-settings';
import {
  BLABLA_SERVERS,
  areaToOverrides,
  blablaServerLabel,
  consoleFrom,
  looksLikeProfileUrl,
  pickArea,
  type RawProfile,
} from './blablalink';
import { parseRosterCsv } from './csv-import';
import {
  formatEok,
  loadEnikkComps,
  WEAKNESS_KO,
  type EnikkImport,
  type EnikkPlayer,
} from './enikk';
import { buildIndex, filterByQuery } from './nikke-search';
import {
  buildAddPrompt,
  CUSTOM_KEY,
  customToMeta,
  customToSettings,
  loadCustom,
  parseCustomInput,
  unsupportedEffects,
} from './custom-nikke';
import {
  canvasToBlob,
  copyImage,
  downloadImage,
  loadPortraits,
  renderReport,
  reportFilename,
  type ReportMeta,
} from './report';
import { csvBlob, csvFileName, csvText, damageCsv } from './export-csv';
import {
  applyShareToDecks, decodeBattleCode, decodeShareCode, encodeBattleCode, encodeShareCode,
} from './share-code';
import { LATEST_NOTICE_ID, NOTICES, noticeFragment, noticeToShow } from './notices';
import { mountSharePanel, squadPreview, type SharePanel } from './share-panel';
import { startPresence } from './presence';
import { UNION_SEASON, bossBattle } from './union-bosses';
import { mountUnionRaid } from './union-raid';
import { EXTERNAL_LINKS, hostOf } from './external-links';
import {
  BURST_STAGES,
  candidatesFor, cycleLine, cyclesFromTimeline, estimateCycles, HOTKEYS, MAX_CYCLES,
  picksFrom, progressOf, sequenceForDeck, sequenceFrom, stepKey, stepsFor, trimSequence,
  type BurstStage, type BurstStep,
} from './burst-order';
import { ShareServer, summarizeBattle, summarizeSquad } from './share-server';
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
// 설정 공유 서버(`worker-share/`). 비어 있으면 공유 모달이 코드 주고받기만 그린다 —
// 서버 없이 부르면 반드시 실패하므로 탭을 만들어 두는 쪽이 더 헷갈린다.
const SHARE_API = (import.meta.env.VITE_SHARE_API ?? '').trim().replace(/\/+$/, '');

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

  // 임의 니케(커스텀). localStorage에만 저장되고 요청마다 엔진에 주입된다.
  const customChars = loadCustom((key) => resolveStorage()?.getItem(key) ?? null);
  const saveCustom = () => {
    try {
      resolveStorage()?.setItem(CUSTOM_KEY, JSON.stringify(customChars));
    } catch {
      /* 무시 */
    }
  };
  const registerCustom = (name: string) => {
    const custom = customChars[name];
    if (!custom) return;
    if (!catalogByName.has(name)) {
      const meta = customToMeta(custom);
      catalog.push(meta);
      catalogByName.set(name, meta);
    }
    settings.characters[name] = customToSettings(custom);
  };
  const customPayload = (): Record<string, { nikke: Record<string, unknown>; skills: unknown[] }> =>
    Object.fromEntries(Object.entries(customChars).map(([n, c]) => [n, { nikke: c.nikke, skills: c.skills }]));

  // 편성·설정·전투 조건을 localStorage에 저장해 새로고침해도 마지막 상태로 복원한다.
  const STATE_KEY = 'nikke-state-v1';
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
        if (!settings.cubes[cube.name]) delete overrides.cube;
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
      <p class="site-notice"><a href="https://gall.dcinside.com/mgallery/board/view/?id=gov&amp;no=6038781" target="_blank" rel="noreferrer">説明書の確認、お問い合わせ、フィードバック、あたたかい一言などはこちらへ →</a></p>
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">BROWSER SIM <span>·</span> 60 FPS TIMELINE</p>
          <h1><span>NIKKE</span> スカッド計算機</h1>
          <p class="hero-lede">キャラクターごとのオーバーロードとキューブ、戦闘条件を反映して、フレーム単位の予想ダメージを計算します。</p>
          <div class="trust-row" aria-label="サービスの特徴"><span>${catalog.length}名対応</span><span class="online-now" data-online hidden title="直近1~2分の間にこの計算機を開いた人数です。タブを非表示にすると数えません"><b class="online-dot" aria-hidden="true"></b><span data-online-text></span></span><button type="button" class="notice-open" data-notice-open title="これまでに何が変わったかを見ます">更新履歴</button><a class="credit-link" href="https://github.com/Jgaram/nikke-calc" target="_blank" rel="noreferrer noopener" title="この計算機の元のリポジトリ">元のアルゴリズム開発者に無限の感謝を</a></div>
        </div>
        <div class="hero-orbit" aria-hidden="true"><span>01</span><strong>LOCAL<br />SIM</strong></div>
      </header>

      <nav class="view-tabs" aria-label="画面切り替え">
        <button type="button" class="view-tab is-on" data-view-tab="calc" aria-pressed="true">計算機</button>
        <button type="button" class="view-tab" data-view-tab="union" aria-pressed="false">ユニオンレイド<b class="tab-beta">BETA</b></button>
        <button type="button" class="view-tab" data-view-tab="links" aria-pressed="false">外部リンク</button>
      </nav>

      <section class="panel links-panel" data-view="links" aria-labelledby="links-heading" hidden>
        <div class="section-heading">
          <div><p class="step">LINKS</p><h2 id="links-heading">外部リンク</h2></div>
        </div>
        <p class="links-lede">ニケを回すのに使う<b>他の方々のツール</b>です。新しいタブで開きます。</p>
        <p class="links-warn"><b>ここに載っている先は私たちが運営しているものではありません。</b>計算機に入れておいた値やアカウント情報が先方へ渡ることはなく、先方の内容やアドレスが変わっても私たちには分かりません。</p>
        <div class="links-grid" data-links-grid></div>
      </section>

      ${blablaProxy ? `
      <section class="panel union-panel" data-view="union" aria-labelledby="union-heading" hidden>
        <div class="section-heading">
          <div><p class="step">UNION</p><h2 id="union-heading">ユニオンレイド <b class="beta-tag">BETA</b></h2></div>
        </div>
        <div class="union-modes" role="group" aria-label="計算対象">
          <button type="button" class="union-mode is-on" data-union-mode="union" aria-pressed="true">ユニオン</button>
          <button type="button" class="union-mode" data-union-mode="personal" aria-pressed="false">個人用</button>
        </div>
        <p class="union-lede" data-union-lede-union>ユニオンメンバー<b>それぞれの実際のスペックとシンクロレベル</b>で同じボス・同じデッキを回し、誰がどれだけ貢献できるかを見比べます。ニケ一覧を公開している人だけ計算できます。</p>
        <p class="union-lede" data-union-lede-personal hidden><b>自分のスペックだけ</b>を使います。名簿を取り込む必要はなく、ボスごとに異なる戦闘条件をかけてデッキを3つまで回し、一目で見比べます — 計算機に設定してあるシンクロ・コンソール・ニケ育成をそのまま使います。</p>

        <div class="union-step" data-union-step="1">
          <h3>ユニオン名簿の取り込み</h3>
          <p class="field-note">ユニオンメンバーの名簿は<b>指揮官ご自身のログインでのみ</b>開けます(私たちのサーバーからは遮断されています)。そのため一度だけご自身で取り出していただきます — Cookie やパスワードには一切触れません。</p>
          <ol class="union-guide">
            <li>Blablalink にログインしたまま<b>ユニオンスクエア</b>を開きます。</li>
            <li><kbd>F12</kbd> → <b>Console</b> タブに下の内容を貼り付けて <kbd>Enter</kbd>。</li>
            <li>名簿がクリップボードに入ります。下の欄に貼り付けてください。</li>
            <li>クリップボードが使えない場合は<b>ページ上に欄が表示され、内容がすべて選択された状態になります</b> — <kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Ctrl</kbd>+<kbd>C</kbd> でコピーしたあと、<b>✕</b> か <kbd>Esc</kbd>、または欄の外を押して閉じてください。</li>
          </ol>
          <textarea class="union-snippet" data-union-snippet rows="3" readonly spellcheck="false"></textarea>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-copy>スニペットをコピー</button>
          </div>
          <textarea class="union-paste" data-union-paste rows="3" placeholder="ここに名簿を貼り付けてください" spellcheck="false"></textarea>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-read>名簿を読み込む</button>
            <span class="union-status" data-union-list-status></span>
          </div>
        </div>

        <div class="union-step" data-union-step="2" hidden>
          <h3>公開状況の確認</h3>
          <p class="field-note">一人ずつ実際に照会してみないと分かりません。3人ずつ同時に問い合わせ、公開している人はニケ詳細まで一緒に取得しておきます。</p>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-scan>公開状況をスキャン</button>
            <button type="button" class="roster-import" data-union-scan-stop hidden>中断</button>
            <span class="union-status" data-union-scan-status></span>
          </div>
          <div class="union-progress" data-union-scan-progress hidden><i></i></div>

          <details class="union-direct">
            <summary>自分のブラウザで直接取得する — 「ユニオンメンバーにのみ公開」まで見えます</summary>
            <p class="field-note">上のスキャンは私たちのサーバーを経由します。私たちのアカウントはこのユニオンに所属していないため、<b>「ユニオンメンバーにのみ公開」にしている人は永遠に非公開に見えます</b>。指揮官ご自身のブラウザで直接取得すればその方々まで見えます — サーバーを経由しないほうが安心な方にもこちらの方法が向いています。</p>
            <p class="field-note">ユニオンメンバーの人数分だけ照会するため<b>32名なら2~3分</b>かかり、進行状況がコンソールに1行ずつ表示されます。終わったら上と同じ方法でコピーして下に貼り付けてください。</p>
            <textarea class="union-snippet" data-union-direct-snippet rows="3" readonly spellcheck="false"></textarea>
            <div class="union-actions">
              <button type="button" class="roster-import" data-union-direct-copy>直接取得スニペットをコピー</button>
            </div>
            <textarea class="union-paste" data-union-direct-paste rows="3" placeholder="直接取得したデータをここに貼り付けてください (NKU1-…)" spellcheck="false"></textarea>
            <div class="union-actions">
              <button type="button" class="roster-import" data-union-direct-read>直接取得したデータを読み込む</button>
              <span class="union-status" data-union-direct-status></span>
            </div>
          </details>

          <div class="union-members" data-union-members></div>
          <div class="union-ask" data-union-ask hidden>
            <p data-union-ask-text></p>
            <button type="button" class="roster-import" data-union-pick-all>公開している人を全員選ぶ</button>
            <button type="button" class="roster-import" data-union-pick-none>全員解除</button>
          </div>
        </div>

        <div class="union-step" data-union-step="3" hidden>
          <h3>ボスとデッキ</h3>
          <p class="field-note">ボスは<b>戦闘条件コード</b>(NK3-)、デッキは<b>編成コード</b>(NK2-)で埋めます。計算機に設定してある内容を取り込むことも、<b>共有一覧から選んで</b>入れることもできます。チェックを外したボスは計算しません — 風圧には強いのに電撃には弱い人もいますから。</p>
          <div class="union-board-bar">
            <span class="union-board-label">盤面全体</span>
            <button type="button" class="roster-import" data-union-set-share>共有から盤面を選ぶ</button>
            <button type="button" class="roster-import" data-union-set-paste>盤面コードを貼り付け</button>
            <button type="button" class="roster-import" data-union-set-copy>この盤面コードをコピー</button>
            <span class="union-status" data-union-set-status></span>
          </div>
          <p class="field-note">ボス5体と各枠のデッキまで<b>1つのコード</b>(NK4-)に収まります — 前シーズンの盤面をまるごと移したりユニオンの部屋に配ったりするとき、20回も貼り付けずに済みます。<b>ユニオンメンバーの名簿は含まれません。</b></p>
          <div class="union-set-box" data-union-set-box hidden>
            <textarea class="custom-json" data-union-set-code rows="3" placeholder="盤面コード (NK4-…)"></textarea>
            <div class="deck-copy-actions">
              <button type="button" class="deck-copy-apply" data-union-set-apply>この盤面を適用</button>
              <button type="button" class="deck-copy-cancel" data-union-set-close>閉じる</button>
            </div>
          </div>
          <div class="union-bosses" data-union-bosses></div>

          <div class="custom-modal" data-union-share-modal hidden>
            <div class="custom-card share-card" role="dialog" aria-label="共有から選ぶ">
              <div class="custom-head"><h2 data-union-share-title>共有から選ぶ</h2><button type="button" class="custom-close" data-union-share-close aria-label="閉じる">✕</button></div>
              <p class="custom-desc" data-union-share-desc></p>
              <div data-union-share-body></div>
              <p class="custom-msg" data-union-share-msg hidden></p>
            </div>
          </div>
        </div>

        <div class="union-step" data-union-step="4" hidden>
          <h3>シミュレーション</h3>
          <p class="field-note">ユニオンメンバー × ボス × デッキを1つずつ回します。<b>時間がかかるのでウィンドウを開いたままお待ちください</b> — 結果は出た順に下へ積み上がります。</p>
          <div class="union-actions">
            <button type="button" class="roster-import union-run" data-union-run disabled>シミュレーション実行</button>
            <button type="button" class="roster-import" data-union-stop hidden>中断</button>
            <span class="union-status" data-union-run-status></span>
          </div>
          <div class="union-progress" data-union-run-progress hidden><i></i></div>
          <div class="union-report" data-union-report></div>
        </div>
      </section>` : ''}

      <section class="panel enikk-panel" data-view="enikk" aria-labelledby="enikk-heading" hidden>
        <div class="section-heading">
          <div><p class="step">ENIKK</p><h2 id="enikk-heading">ENIKK 조합 가져오기</h2></div>
        </div>
        <p class="enikk-lede">enikk.app 솔로레이드 랭킹에서 <b>그 사람이 실제로 쓴 5덱을 통째로</b> 가져옵니다. 최신 시즌 상위 <b>300명</b>(KR·JP·GLOBAL·NA·TW-HK·SEA 각 50명)이 대상이고, 누르면 우리 5덱에 그대로 깔립니다.</p>
        <p class="enikk-warn" data-enikk-warn>불러오는 데 <b>5~10초쯤</b> 걸립니다 — enikk에서 300명분을 한 번에 받아오기 때문입니다. 받아온 뒤에는 이 브라우저에 저장해 두고 다시 받지 않습니다.</p>
        <div class="enikk-actions">
          <button type="button" class="roster-import" data-enikk-load>조합 가져오기</button>
          <button type="button" class="roster-import" data-enikk-refresh hidden>다시 받기</button>
          <span class="enikk-status" data-enikk-status></span>
        </div>
        <div class="enikk-exclude">
          <label class="enikk-exclude-label" for="enikk-exclude">제외할 니케</label>
          <div class="enikk-exclude-row">
            <input id="enikk-exclude" type="search" list="enikk-exclude-list" placeholder="안 가진 니케 이름을 넣으세요" autocomplete="off" data-enikk-exclude-input />
            <datalist id="enikk-exclude-list" data-enikk-exclude-options></datalist>
            <button type="button" class="roster-import" data-enikk-exclude-add>추가</button>
          </div>
          <div class="enikk-exclude-chips" data-enikk-exclude-chips></div>
          <p class="field-note">넣은 니케가 낀 덱은 <b>가져오기에서 빠집니다</b>. 그 니케가 없어도 짤 수 있는 조합만 남기려는 것입니다.</p>
        </div>
        <div class="enikk-summary" data-enikk-summary hidden></div>
        <div class="enikk-compare" data-enikk-compare hidden></div>
        <div class="enikk-list" data-enikk-list hidden></div>
      </section>

      <form class="calculator-layout" data-view="calc" novalidate>
        <section class="panel squad-panel" aria-labelledby="squad-heading">
          <div class="section-heading">
            <div><h2 id="squad-heading">編成とキャラクター設定</h2></div>
            <div class="squad-tools">
              <span class="roster-import-group">
                <label class="roster-import" title="Letsdoro のニケ情報 CSV を読み込み、すべてのニケ設定に適用します">
                  <input id="roster-csv" type="file" accept=".csv,text/csv" hidden />
                  <span>Letsdoro CSV を読み込む</span>
                </label>
                <button type="button" class="roster-info" data-doro-open aria-label="Letsdoro CSV の入手方法" title="Letsdoro で CSV を入手する方法">i</button>
              </span>
              ${blablaProxy ? '<button type="button" class="roster-import" data-blabla-open title="Blablalink のプロフィール URL から所持ニケの育成状況を一括で読み込みます">Blablalink 連携</button>' : ''}
              <button type="button" class="roster-import" data-add-nikke title="未実装・未登録のニケを自分で追加します">新しいニケを追加</button>
              <button type="button" class="roster-import" data-share-open title="編成に名前を付けてこのブラウザに保存したり、コードやリンクでやり取りします。個人スペックと戦闘条件は含まれません">プリセット / 編成共有</button>
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
              <button type="button" class="reset-enemy" data-battle-share-open title="戦闘条件をコードにして共有したり、受け取ったコードを貼り付けて適用します">戦闘条件を共有</button>
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

      <div class="custom-modal" data-history-modal hidden>
        <div class="custom-card roster-card" role="dialog" aria-label="計算履歴">
          <div class="custom-head"><h2>計算履歴</h2><button type="button" class="custom-close" data-history-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">結果で«結果を保存»を押した時点の編成と数値がこのブラウザに残ります。編成を復元してそのときの編成に戻れます。<b>数値はそのときのスペック・戦闘条件で出した値</b>なので、今の設定と違う場合は計算し直す必要があります。</p>
          <div class="history-list" data-history-list></div>
        </div>
      </div>

      <div class="custom-modal" data-battle-share-modal hidden>
        <div class="custom-card share-card" role="dialog" aria-label="戦闘条件の共有">
          <div class="custom-head"><h2>戦闘条件の共有</h2><button type="button" class="custom-close" data-battle-share-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">戦闘時間・敵コード・コア・回避区間・属性制限・乱数処理といった<b>«どんな状況で測ったか»</b>をやり取りします。<b>コンソールとシンクロレベルは含まれません</b> — アカウントの育成状態なので、他人の値が付いてくると自分のスペックで測った結果ではなくなります。編成と個人スペックも含まれません(そちらは«編成共有»)。</p>
          ${SHARE_API ? '<div class="share-tabs" data-battle-share-tabs></div>' : ''}
          <div class="share-pane" data-battle-share-pane="upload" hidden></div>
          <div class="share-pane" data-battle-share-pane="list" hidden></div>
          <div class="share-pane" data-battle-share-pane="code">
            <div class="squad-code-block">
              <h4>自分の戦闘条件コード</h4>
              <textarea class="share-out" data-battle-share-out readonly rows="3"></textarea>
              <button type="button" class="share-copy" data-battle-share-copy>コードをコピー</button>
            </div>
            <div class="squad-code-block">
              <h4>受け取ったコードを適用</h4>
              <textarea class="share-in" data-battle-share-in rows="3" placeholder="NK3- で始まるコードを貼り付けてください"></textarea>
              <button type="button" class="share-apply" data-battle-share-apply>適用</button>
            </div>
          </div>
          <p class="share-msg" data-battle-share-msg hidden></p>
        </div>
      </div>

      <!-- 업데이트 공지. 새 내용이 있을 때 처음 들어오면 한 번 뜨고, 닫으면 그 판을
           본 것으로 적어 다시 뜨지 않는다. 「업데이트 내역」으로 언제든 다시 연다. -->
      <div class="custom-modal" data-notice-modal hidden>
        <div class="custom-card notice-card" role="dialog" aria-label="更新履歴">
          <div class="custom-head"><h2>更新履歴</h2><button type="button" class="custom-close" data-notice-close aria-label="閉じる">✕</button></div>
          <div class="notice-body" data-notice-body></div>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-notice-dismiss>確認 · 次回から表示しない</button>
          </div>
        </div>
      </div>

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

      <div class="custom-modal" data-share-modal hidden>
        <div class="custom-card share-card" role="dialog" aria-label="プリセット / 編成共有">
          <div class="custom-head"><h2>プリセット / 編成共有</h2><button type="button" class="custom-close" data-share-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">誰を編成したか(キャラクターの組み合わせ)だけをやり取りします。<b>オーバーロード・攻撃力・限界突破といった個人スペックと戦闘条件は含まれません</b> — 適用するとキャラクターだけが変わり、スペックは各自の設定(CSV ロスターを入れていればその値)がそのまま使われます。${SHARE_API ? '<b>サーバーへは«投稿»を押したときだけ送信されます。</b>' : 'サーバーへは送信されません。'}</p>
          <div class="share-scope" data-share-scope>
            <span class="share-scope-label">範囲</span>
            <button type="button" class="share-scope-pick is-on" data-share-scope-pick="one">このデッキのみ</button>
            <button type="button" class="share-scope-pick" data-share-scope-pick="all">5デッキすべて</button>
            <span class="share-scope-note" data-share-scope-note></span>
          </div>
          ${SHARE_API ? '<div class="share-tabs" data-share-tabs></div>' : ''}
          <div class="share-pane" data-share-pane="upload" hidden></div>
          <div class="share-pane" data-share-pane="list" hidden></div>
          <div class="share-pane" data-share-pane="code">
          <div class="squad-code-block">
            <h4>自分の編成コード</h4>
            <textarea class="custom-json" data-share-out rows="3" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-copy>コードをコピー</button></div>
          </div>
          <div class="squad-code-block">
            <h4>共有リンク</h4>
            <textarea class="custom-json" data-share-url rows="2" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-url-copy>リンクをコピー</button></div>
          </div>
          <div class="squad-code-block">
            <h4>受け取ったコードを適用</h4>
            <textarea class="custom-json" data-share-in rows="3" placeholder="受け取った編成コードか共有リンクを貼り付けてください"></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-apply>この編成を適用</button></div>
          </div>
          <div class="squad-code-block">
            <h4>このブラウザに保存</h4>
            <div class="preset-row">
              <input type="text" class="preset-name" data-preset-name placeholder="プリセット名 (例: 水冷ソロレイド 1デッキ)" maxlength="40" />
              <button type="button" class="deck-copy-apply" data-preset-save>保存</button>
            </div>
            <div class="preset-list" data-preset-list></div>
          </div>
          </div>
          <p class="custom-msg" data-share-msg hidden></p>
        </div>
      </div>

      <div class="custom-modal" data-report-modal hidden>
        <div class="custom-card report-card" role="dialog" aria-label="レポート画像">
          <div class="custom-head"><h2>レポート画像</h2><button type="button" class="custom-close" data-report-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">下の画像をコピーしてコミュニティにそのまま貼り付けられます。コピーが使えない場合は PNG で保存するか、画像を右クリックしてコピーしてください。このブラウザ内でのみ生成されます。</p>
          <div class="report-preview" data-report-preview></div>
          <p class="report-msg" data-report-msg hidden></p>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-report-copy>画像をコピー</button>
            <button type="button" class="deck-copy-cancel" data-report-save>PNG 保存</button>
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

      <div class="custom-modal" data-custom-modal hidden>
        <div class="custom-card" role="dialog" aria-label="新しいニケを追加">
          <div class="custom-head"><h2>新しいニケを追加</h2><button type="button" class="custom-close" data-custom-close aria-label="閉じる">✕</button></div>
          <p class="custom-desc">未実装・未登録のニケを自分で追加します。サーバーへは送信されず、このブラウザにのみ保存されます。</p>
          <ol class="custom-steps">
            <li>下の<b>プロンプトをコピー</b>を押して他の LLM(チャットボット)に貼り付け、その下にニケの名前・スキル説明を付けて結果の JSON を受け取ってください。</li>
            <li>受け取った JSON を下の欄に貼り付けて<b>追加</b>を押してください。または<b>手入力ヘルプ</b>を見て手で作成しても構いません。</li>
          </ol>
          <div class="custom-caution">
            <b>ご注意ください</b>
            <ul>
              <li>特殊または複雑なスキル(条件付き発動・ゲージ・モード切り替え・スタック条件など)は計算に<b>反映されません。</b>基本射撃・バフ・バーストを中心に近似されるだけです。そうしたスキルが主力ダメージのキャラクター(例: ゲージでダメージが伸びるキャラクター)は<b>結果が実際よりかなり低く</b>出るので参考程度にしてください。</li>
              <li>LLM の性能によっては<b>正確な変換が難しいことがあるので参考用</b>として使い、値をご自身で確認・補正することをおすすめします。</li>
              <li>可能であれば下の<b>手入力ヘルプ</b>を見て人が直接値を入れるほうが正確です。</li>
            </ul>
          </div>
          <details class="custom-help">
            <summary>手入力ヘルプ (スキーマ · 人が作成するとき)</summary>
            <div class="custom-help-body">
              <p><b>最上位</b>: <code>{ "name": "正式名称", "nikke": {…ステータス}, "skills": [ …効果 ] }</code></p>
              <p><b>nikke 共通</b>: rarity(SSR/SR/R) · element_code(전격/작열/수냉/풍압/철갑 ※韓国語の内部キーのまま) · class(화력형/방어형/지원형 ※同上) · manufacturer(엘리시온/미실리스/테트라/필그림/어브노멀 ※同上) · weapon_type(AR/SMG/MG/SR/RL/SG) · burst_stage(1~3) · burst_cooldown(秒) · max_ammo · reload_time(秒) · fire_rate(秒あたりの発射数) · pellets(SG のみ 2↑) · muzzles(通常 1) · damage_coeff(1発の係数 %)</p>
              <p><b>武器別の追加項目</b>: 連射型(AR·SMG·MG·SG)は <code>core_dmg_mult</code>(コア %、例 200)。チャージ型(SR·RL)は <code>charge_time</code>(フルチャージ秒、例 1.0~1.5)と <code>full_charge_mult</code>(フルチャージ %、例 250·350)。チャージ型で省略するとそれぞれ 1.0·250 が既定で適用されます。</p>
              <p><b>skills の各要素</b>: source(스킬1/스킬2/버스트스킬 ※韓国語のまま) · type(buff または damage) · name · trigger:{ timing:[…], condition:[…] } · target · stat · polarity(beneficial/harmful) · max_stack(通常 1) · values:{ "1":値, "10":値 } または fixed_value:値 · duration(持続秒。即時/永続は省略または -1)</p>
              <p><b>認識される timing</b>: battle_start · full_burst_start · full_burst_start_count:N · full_burst_end · burst_cast · burst_cast_count:N · last_bullet · last_bullet_fire · hit_count:N · full_charge_hit · passive</p>
              <p><b>認識される target</b>: self · all_allies · all_allies_excl_self · all_enemies · target · same_target · allies:N · allies_top_atk:N · allies_weapon:&lt;武器&gt; · allies_class:공격|방어|지원 · allies_code:&lt;属性&gt; · allies_code_weapon:&lt;属性&gt;:&lt;武器&gt; · enemies_top_atk:N</p>
              <p><b>認識される buff stat</b>: atk_pct · atk_flat · atk_dmg_pct · normal_atk_dmg_pct · crit_rate · crit_dmg · core_dmg_pct · element_bonus_pct · burst_dmg_pct · pierce_dmg_pct · charge_dmg_pct · charge_speed_pct · max_ammo_pct · max_ammo_flat · reload_speed_pct · attack_speed_pct · accuracy_pct · def_pct · def_ignore_pct · enemy_def_down_pct · received_dmg(敵の被ダメージ増加) · burst_cooldown(秒)</p>
              <p><b>damage stat</b>(type が damage): bonus_damage · burst_damage · damage (values がダメージ係数)</p>
              <p class="custom-help-note">一覧にない stat·timing·target は計算で無視されます。迷ったら最も近い標準値を使ってください。</p>
            </div>
          </details>
          <button type="button" class="custom-btn" data-copy-prompt>① プロンプトをコピー</button>
          <textarea class="custom-json" data-custom-json placeholder="② ここに結果の JSON を貼り付けるか、ヘルプを見て直接作成してください" rows="8"></textarea>
          <div class="custom-actions"><button type="button" class="custom-btn primary" data-custom-submit>追加</button></div>
          <p class="custom-msg" data-custom-msg hidden></p>
          <div class="custom-list" data-custom-list></div>
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
        const custom = customPayload();
        const request = requestForDeck(deck, readBattle(),
          Object.keys(custom).length > 0 ? custom : undefined);
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

  // ── 업데이트 공지 ───────────────────────────────────────────────────────
  // 본 적 있는 공지 id를 적어 둔다. 새 공지가 올라오면 id가 달라져 다시 뜬다.
  const NOTICE_KEY = 'nikke-notice-seen';
  const noticeModal = element<HTMLElement>(root, '[data-notice-modal]');
  const noticeBody = element<HTMLElement>(root, '[data-notice-body]');

  const renderNotices = () => {
    noticeBody.replaceChildren();
    for (const notice of NOTICES) {
      const block = document.createElement('section');
      block.className = 'notice-entry';
      block.dataset.notice = notice.id;
      const head = document.createElement('div');
      head.className = 'notice-head';
      head.append(createText('b', notice.date), createText('span', notice.title));
      block.append(head);
      const list = document.createElement('ul');
      for (const item of notice.items) {
        const row = document.createElement('li');
        const tag = createText('em', item.tag, 'notice-tag');
        tag.dataset.noticeTag = item.tag;
        const body = document.createElement('span');
        body.append(noticeFragment(item.text));
        row.append(tag, body);
        list.append(row);
      }
      block.append(list);
      noticeBody.append(block);
    }
  };

  const openNotice = () => {
    renderNotices();
    noticeModal.hidden = false;
  };
  /** 닫으면 최신 공지를 본 것으로 적는다 — 새 공지가 나오기 전까지 다시 뜨지 않는다. */
  const closeNotice = () => {
    noticeModal.hidden = true;
    try {
      resolveStorage()?.setItem(NOTICE_KEY, LATEST_NOTICE_ID);
    } catch {
      /* 저장 실패는 무시 — 다음에 한 번 더 뜰 뿐이다 */
    }
  };
  element<HTMLButtonElement>(root, '[data-notice-open]').addEventListener('click', openNotice);
  element<HTMLButtonElement>(root, '[data-notice-close]').addEventListener('click', closeNotice);
  element<HTMLButtonElement>(root, '[data-notice-dismiss]').addEventListener('click', closeNotice);
  noticeModal.addEventListener('click', (event) => {
    if (event.target === noticeModal) closeNotice();
  });
  {
    let seen: string | null = null;
    try {
      seen = resolveStorage()?.getItem(NOTICE_KEY) ?? null;
    } catch {
      /* 못 읽으면 처음 온 것으로 본다 */
    }
    if (noticeToShow(seen)) openNotice();
  }

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
      if (custom.cube && (!settings.cubes[custom.cube.name] || !Number.isInteger(custom.cube.level)
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

  // ── 설정 공유 서버 ──────────────────────────────────────────────────────
  // 전투 조건과 조합이 같은 서버·같은 판을 쓴다. 주소가 없으면 판을 아예 만들지
  // 않고 코드 주고받기만 남는다.
  const shareServer = SHARE_API ? new ShareServer(SHARE_API) : null;
  const sharePanelHosts = (prefix: 'share' | 'battle-share') => ({
    tabs: element<HTMLElement>(root, `[data-${prefix}-tabs]`),
    upload: element<HTMLElement>(root, `[data-${prefix}-pane="upload"]`),
    list: element<HTMLElement>(root, `[data-${prefix}-pane="list"]`),
    code: element<HTMLElement>(root, `[data-${prefix}-pane="code"]`),
  });

  // ── 조합 공유 코드 ──────────────────────────────────────────────────────
  const shareModal = element<HTMLElement>(root, '[data-share-modal]');
  const shareOut = element<HTMLTextAreaElement>(root, '[data-share-out]');
  const shareIn = element<HTMLTextAreaElement>(root, '[data-share-in]');
  const shareUrl = element<HTMLTextAreaElement>(root, '[data-share-url]');
  const shareMsg = element<HTMLElement>(root, '[data-share-msg]');
  const showShareMsg = (message: string, ok = false) => {
    shareMsg.hidden = message === '';
    shareMsg.textContent = message;
    shareMsg.classList.toggle('is-ok', ok);
  };
  // 편성 프리셋 — 자주 쓰는 조합을 이름 붙여 이 브라우저에 둔다. 담는 건 공유 코드
  // 하나뿐이라(=편성만) 스펙이 바뀌어도 그대로 쓸 수 있고, 저장 용량도 거의 안 든다.
  const PRESET_KEY = 'nikke-presets-v1';
  const PRESET_MAX = 50;
  interface Preset { name: string; code: string; at: string; }
  const presetName = element<HTMLInputElement>(root, '[data-preset-name]');
  const presetList = element<HTMLElement>(root, '[data-preset-list]');
  let presets: Preset[] = (() => {
    try {
      const raw = resolveStorage()?.getItem(PRESET_KEY);
      const parsed = raw ? (JSON.parse(raw) as Preset[]) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && p.name && p.code) : [];
    } catch {
      return [];
    }
  })();
  const savePresets = () => {
    try {
      resolveStorage()?.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  const renderPresets = () => {
    presetList.replaceChildren();
    if (presets.length === 0) {
      presetList.append(createText('p', '保存されたプリセットはありません。', 'preset-empty'));
      return;
    }
    for (const preset of presets) {
      const row = document.createElement('div');
      row.className = 'preset-item';
      row.dataset.preset = preset.name;
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'preset-load';
      load.textContent = preset.name;
      load.title = `${preset.at.slice(0, 10)} 保存 · 押して読み込む`;
      load.addEventListener('click', () => {
        applyShareText(preset.code);
        refreshShareFields();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-remove';
      remove.textContent = '削除';
      remove.setAttribute('aria-label', `${preset.name} を削除`);
      remove.addEventListener('click', () => {
        presets = presets.filter((item) => item.name !== preset.name);
        savePresets();
        renderPresets();
      });
      row.append(load, remove);
      presetList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-preset-save]').addEventListener('click', () => {
    const name = presetName.value.trim();
    if (!name) {
      showShareMsg('プリセット名を入力してください。');
      presetName.focus();
      return;
    }
    if (!decksInScope().some((deck) => deck.squad.some(Boolean))) {
      showShareMsg(shareScope === 'all'
        ? '編成が空なので保存するものがありません。'
        : `デッキ ${activeDeckId} が空です。他のデッキを含めるには上で«5デッキすべて»を選んでください。`);
      return;
    }
    if (presets.length >= PRESET_MAX && !presets.some((p) => p.name === name)) {
      showShareMsg(`プリセットは ${PRESET_MAX}件まで保存できます。使わないものを消してください。`);
      return;
    }
    const code = shareScopeCode();
    presets = [{ name, code, at: new Date().toISOString() },
      ...presets.filter((item) => item.name !== name)];
    savePresets();
    renderPresets();
    presetName.value = '';
    showShareMsg(`«${name}» として保存しました`
      + `(${shareScope === 'all' ? '5デッキすべて' : `デッキ ${activeDeckId} のみ`})。`
      + ' 編成だけを含むので、スペックが変わってもそのまま使えます。', true);
  });

  // 계산 기록 — 그때의 편성(공유 코드)과 수치·조건을 남긴다. 편성만 되살릴 수 있게
  // 코드로 담아, 스펙이 바뀌어도 조합은 그대로 복원된다.
  const HISTORY_KEY = 'nikke-history-v1';
  const HISTORY_MAX = 30;
  interface HistoryEntry {
    at: string; code: string; total: number; duration: number;
    decks: Array<{ id: number; total: number; squad: string[] }>;
    conditions: string;
  }
  const historyModal = element<HTMLElement>(root, '[data-history-modal]');
  const historyList = element<HTMLElement>(root, '[data-history-list]');
  let calcHistory: HistoryEntry[] = (() => {
    try {
      const raw = resolveStorage()?.getItem(HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.code) : [];
    } catch {
      return [];
    }
  })();
  const persistHistory = () => {
    try {
      resolveStorage()?.setItem(HISTORY_KEY, JSON.stringify(calcHistory));
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  const saveHistory = (batch: BatchResult) => {
    const battle = readBattle();
    const entry: HistoryEntry = {
      at: new Date().toISOString(),
      code: encodeShareCode(decks, fiveDeckMode),
      total: batch.total,
      duration: batch.decks[0]?.result.duration ?? 0,
      decks: batch.decks.map((deck) => ({
        id: deck.deckId,
        total: deck.result.squadTotal,
        squad: deck.request.squad.filter(Boolean),
      })),
      conditions: `${battle.duration}秒 · 防御力 ${battle.enemyDef.toLocaleString('en-US')}`
        + `${battle.enemyCode ? ` · ${elementLabel(battle.enemyCode)}` : ' · コードなし'}`
        + `${battle.coreEnabled ? ` · コア ${battle.corePx}px` : ''} · シード ${battle.seed}`,
    };
    calcHistory = [entry, ...calcHistory].slice(0, HISTORY_MAX);
    persistHistory();
    renderHistory();
    historyModal.hidden = false;
  };
  const renderHistory = () => {
    historyList.replaceChildren();
    if (calcHistory.length === 0) {
      historyList.append(createText('p', 'まだ保存された結果がありません。結果で«結果を保存»を押してください。', 'preset-empty'));
      return;
    }
    for (const entry of calcHistory) {
      const row = document.createElement('article');
      row.className = 'history-item';
      row.dataset.historyItem = entry.at;
      const head = document.createElement('div');
      head.className = 'history-head';
      head.append(
        createText('strong', formatDamage(entry.total)),
        createText('span', new Date(entry.at).toLocaleString('ja-JP')),
      );
      row.append(head, createText('p', entry.conditions, 'history-cond'));
      for (const deck of entry.decks) {
        row.append(createText(
          'p',
          `デッキ ${deck.id} · ${formatDamage(deck.total)} — ${deck.squad.map(labelFor).join(', ') || '空のデッキ'}`,
          'history-deck',
        ));
      }
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'preset-load';
      restore.textContent = 'この編成を復元';
      restore.addEventListener('click', () => {
        // 기록은 «그때 그 판»이다 — 범위 고르개와 무관하게 판 전체를 되살린다.
        applyShareText(entry.code, 'all');
        historyModal.hidden = true;
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-remove';
      remove.textContent = '削除';
      remove.addEventListener('click', () => {
        calcHistory = calcHistory.filter((item) => item.at !== entry.at);
        persistHistory();
        renderHistory();
      });
      actions.append(restore, remove);
      row.append(actions);
      historyList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-history-close]').addEventListener('click', () => {
    historyModal.hidden = true;
  });
  historyModal.addEventListener('click', (event) => {
    if (event.target === historyModal) historyModal.hidden = true;
  });

  /**
   * 주고받을 범위. 「이 덱만」이 기본이다 — 덱 하나를 옮기는 일이 판 전체를 옮기는
   * 일보다 훨씬 잦은데, 예전에는 그것도 5덱 코드로 나가고 받는 쪽에서는 판을 통째로
   * 덮었다(2~5덱이 조용히 지워졌다).
   *
   * 저장·복사·올리기와 **적용까지 같은 값을 본다** — 「이 덱만」으로 받으면 코드에 든
   * 첫 덱이 지금 보고 있는 덱에 들어가고 나머지 덱은 그대로 남는다.
   */
  type ShareScope = 'one' | 'all';
  let shareScope: ShareScope = 'one';
  const scopeBox = element<HTMLElement>(root, '[data-share-scope]');
  const scopeNote = element<HTMLElement>(root, '[data-share-scope-note]');

  /** 지금 보고 있는 덱의 자리(0부터). 덱 순서를 바꿔도 따라간다. */
  const activeDeckIndex = (): number => {
    const at = decks.findIndex((deck) => deck.id === activeDeckId);
    return at >= 0 ? at : 0;
  };

  /** 범위에 맞춰 담을 덱들. 「이 덱만」이면 지금 덱 하나다. */
  const decksInScope = (): DeckState[] =>
    (shareScope === 'all' ? decks : [decks[activeDeckIndex()]!]);

  const shareScopeCode = (): string =>
    (shareScope === 'all'
      ? encodeShareCode(decks, fiveDeckMode)
      : encodeShareCode([decks[activeDeckIndex()]!], false));

  const renderScope = () => {
    for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('[data-share-scope-pick]')) {
      button.classList.toggle('is-on', button.dataset.shareScopePick === shareScope);
    }
    scopeNote.textContent = shareScope === 'all'
      ? '5デッキを1つのコードに収め、受け取ると盤面全体が変わります。'
      : `デッキ ${activeDeckId} だけを収め、受け取るとデッキ ${activeDeckId} にのみ入ります。`;
  };

  for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('[data-share-scope-pick]')) {
    button.addEventListener('click', () => {
      shareScope = button.dataset.shareScopePick === 'all' ? 'all' : 'one';
      renderScope();
      refreshShareFields();
      showShareMsg('');
    });
  }

  const refreshShareFields = () => {
    const code = shareScopeCode();
    shareOut.value = code;
    // 코드가 짧아져 링크로도 무리가 없다 — 받는 쪽은 열기만 하면 적용된다.
    shareUrl.value = `${location.origin}${location.pathname}#deck=${encodeURIComponent(code)}`;
  };
  const openShareModal = (focusPreset = false) => {
    renderScope();
    refreshShareFields();
    renderPresets();
    shareIn.value = '';
    showShareMsg('');
    shareModal.hidden = false;
    squadSharePanel?.open();
    // 프리셋은 «코드» 탭 안에 있다 — 겨냥해 열었으면 그 탭으로 간다.
    if (focusPreset) {
      root.querySelector<HTMLButtonElement>('[data-share-tab="code"]')?.click();
      presetName.focus();
    }
  };
  element<HTMLButtonElement>(root, '[data-share-open]').addEventListener('click', () => {
    openShareModal();
  });
  element<HTMLButtonElement>(root, '[data-share-close]').addEventListener('click', () => {
    shareModal.hidden = true;
  });
  shareModal.addEventListener('click', (event) => {
    if (event.target === shareModal) shareModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-share-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareOut.value);
      showShareMsg('編成コードをコピーしました。このまま共有できます。', true);
    } catch {
      shareOut.select();
      showShareMsg('自動コピーが使えないためコードを選択しておきました。Ctrl+C でコピーしてください。');
    }
  });
  // 링크째 붙여넣어도 되게, #deck= 뒤의 코드만 뽑아 쓴다.
  const shareCodeFrom = (text: string): string => {
    const hit = text.match(/#deck=([^&\s]+)/);
    return hit ? decodeURIComponent(hit[1]!) : text;
  };
  /**
   * 받은 코드를 덱에 얹는다.
   *
   * `scope`를 안 주면 모달의 범위 고르개를 따른다. 공유 링크와 계산 기록은 «그때 그
   * 판을 통째로»라는 뜻이므로 `'all'`을 못 박아 넘긴다 — 링크를 연 사람이 덱 하나만
   * 받으면 판을 잃는다.
   */
  const applyShareText = (text: string, scope: ShareScope = shareScope) => {
    try {
      // 카탈로그 이름을 넘겨야 해시에서 캐릭터를 되찾는다(커스텀 니케도 카탈로그에 있다).
      const payload = decodeShareCode(shareCodeFrom(text), catalog.map((char) => char.name));
      const into = scope === 'all' ? 'all' : activeDeckIndex();
      const landed = scope === 'all' ? 1 : activeDeckId;
      // 스펙은 내 것을 쓴다 — CSV 로스터를 넣어 뒀으면 그대로 얹힌다.
      const { applied, skipped } = applyShareToDecks(
        payload, decks,
        (name) => catalogByName.has(name),
        (name) => (roster[name] ? cloneOverride(roster[name]!) : undefined),
        into,
      );
      if (scope === 'all') {
        fiveDeckMode = payload.fiveDeckMode || applied > 1;
        element<HTMLInputElement>(root, '#squad-mode').checked = fiveDeckMode;
        deckTabs.hidden = !fiveDeckMode;
        deckMoves.hidden = !fiveDeckMode;
        deckNote.hidden = !fiveDeckMode;
        activeDeckId = 1;
      }
      saveState();
      renderDeckTabs();
      renderSquad();
      showErrors([]);
      const missing = skipped.length > 0
        ? ` · 一覧にないニケ ${skipped.length}名を除外(${skipped.slice(0, 3).map(labelFor).join(', ')}${skipped.length > 3 ? '…' : ''})`
        : '';
      // 5덱짜리를 한 칸에 받았으면 나머지가 어디 갔는지 반드시 말해 준다.
      const carried = payload.decks.filter((deck) => deck.squad.some((n) => n.trim() !== '')).length;
      if (scope === 'all') {
        showShareMsg(`デッキ ${applied}件を適用しました${missing}。`, skipped.length === 0);
      } else if (carried > 1) {
        showShareMsg(`コードにデッキが ${carried}件入っていたため、最初のデッキだけをデッキ ${landed} に入れました`
          + `${missing}。盤面全体を受け取るには上で«5デッキすべて»を選んでください。`);
      } else {
        showShareMsg(`デッキ ${landed} に適用しました${missing}。他のデッキはそのままです。`,
          skipped.length === 0);
      }
    } catch (error) {
      showShareMsg(error instanceof Error ? error.message : String(error));
    }
  };
  element<HTMLButtonElement>(root, '[data-share-apply]').addEventListener('click', () => {
    applyShareText(shareIn.value);
  });
  const squadSharePanel: SharePanel | null = shareServer && mountSharePanel(
    sharePanelHosts('share'),
    {
      kind: 'squad',
      server: shareServer,
      current: () => ({
        code: shareScopeCode(),
        auto: summarizeSquad(decksInScope(), shareScope === 'all' && fiveDeckMode),
      }),
      // applyShareText가 제외된 니케까지 세어 자기 말로 알린다 — 그대로 쓴다.
      apply: (item) => {
        applyShareText(item.code);
        refreshShareFields();
      },
      notify: showShareMsg,
      // 조합은 이름을 늘어놓는 것보다 초상화가 빠르다. 코드를 그 자리에서 풀어
      // 덱마다 한 줄씩 세운다 — 못 풀면 설명 줄로 물러난다.
      preview: (item) => {
        try {
          const payload = decodeShareCode(item.code, catalog.map((char) => char.name));
          const decks = payload.decks
            .map((deck) => deck.squad.filter((name) => name.trim() !== ''))
            .filter((squad) => squad.length > 0);
          if (decks.length === 0) return null;
          return squadPreview(decks, (name) => {
            const image = catalogByName.get(name)?.image;
            return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
          });
        } catch {
          return null;
        }
      },
    },
  );
  element<HTMLButtonElement>(root, '[data-share-url-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      showShareMsg('リンクをコピーしました。受け取った人は開くだけで編成が入ります。', true);
    } catch {
      shareUrl.select();
      showShareMsg('自動コピーが使えないためリンクを選択しておきました。Ctrl+C でコピーしてください。');
    }
  });
  // ── 보고서 이미지 ────────────────────────────────────────────────────────
  let lastBatch: BatchResult | null = null;
  let reportBlob: Blob | null = null;
  const reportModal = element<HTMLElement>(root, '[data-report-modal]');
  const reportPreview = element<HTMLElement>(root, '[data-report-preview]');
  const reportMsg = element<HTMLElement>(root, '[data-report-msg]');

  const showReportMsg = (message: string, ok = false) => {
    reportMsg.hidden = message === '';
    reportMsg.textContent = message;
    reportMsg.classList.toggle('is-ok', ok);
  };

  /**
   * 정밀 수치 CSV. **같은 계산을 0.1초 칸으로 한 번 더 받아** 표로 만든다.
   *
   * 결과에 늘 실어 두지 않는 이유는 무게다 — 칸이 열 배가 되면 저장되는 결과도
   * 그만큼 무거워지는데, 정작 쓰는 사람은 드물다. 다시 받는 데 실패하면(옛 결과를
   * 불러온 경우 등) 손에 있는 1초 표로 내보낸다 — 수치 자체는 어느 쪽이든 정확하다.
   */
  const exportDamageCsv = async (batch: BatchResult, button: HTMLButtonElement) => {
    const label = button.textContent ?? '精密数値 CSV';
    button.disabled = true;
    button.textContent = '数値を集計中…';
    try {
      const parts: string[] = [];
      let coarseOnly = false;
      for (const entry of batch.decks) {
        let result = entry.result;
        try {
          result = await client.simulate({ ...entry.request, fineTimeline: true });
        } catch {
          coarseOnly = true;   // 다시 못 받았으면 손에 있는 것으로 낸다
        }
        const timeline = result.fineTimeline ?? result.timeline;
        if (!result.fineTimeline) coarseOnly = true;
        const names = entry.request.squad.filter(Boolean);
        const note = `${entry.request.duration}秒 · 敵防御力 ${entry.request.enemyDef}`;
        if (batch.decks.length > 1) parts.push(csvText([[`デッキ ${entry.deckId}`]]));
        parts.push(damageCsv({ ...result, timeline }, names, note));
      }
      downloadImage(csvBlob(parts.join('\r\n\r\n')),
        csvFileName(batch.decks.length > 1 ? '5デッキ' : `デッキ ${batch.decks[0]?.deckId ?? 1}`));
      status.textContent = coarseOnly
        ? '精密数値 CSV をダウンロードしました (1秒単位 — 0.1秒の表は計算し直すと出ます)。'
        : '精密数値 CSV をダウンロードしました (0.1秒単位)。';
    } catch (error) {
      status.textContent = `精密数値 CSV を作成できませんでした: ${(error as Error).message}`;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };

  const openReport = async () => {
    if (!lastBatch) return;
    const batch = lastBatch;
    showReportMsg('');
    reportPreview.replaceChildren(createText('p', 'レポートを描画中…', 'report-loading'));
    reportModal.hidden = false;
    try {
      const names = batch.decks.flatMap((entry) => entry.request.squad);
      const portraits = await loadPortraits(names, catalogByName, import.meta.env.BASE_URL);
      const battle = readBattle();
      const meta: ReportMeta = {
        enemyDef: battle.enemyDef,
        enemyCode: battle.enemyCode,
        corePx: battle.coreEnabled ? battle.corePx : 0,
        hasParts: battle.hasParts,
        siteUrl: 'furu1018.github.io/shirisuko-squad',
      };
      const canvas = renderReport(batch, meta, portraits);
      reportBlob = await canvasToBlob(canvas);
      const image = document.createElement('img');
      image.src = URL.createObjectURL(reportBlob);
      image.alt = '戦闘結果レポート';
      image.dataset.reportImage = '';
      reportPreview.replaceChildren(image);
    } catch (error) {
      reportBlob = null;
      reportPreview.replaceChildren();
      showReportMsg(error instanceof Error ? error.message : 'レポートを作成できませんでした。');
    }
  };

  const closeReport = () => { reportModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-report-close]').addEventListener('click', closeReport);
  reportModal.addEventListener('click', (event) => {
    if (event.target === reportModal) closeReport();
  });
  element<HTMLButtonElement>(root, '[data-report-copy]').addEventListener('click', () => {
    void (async () => {
      if (!reportBlob) return;
      // 이미지 클립보드 쓰기를 막는 브라우저가 있어 실패하면 저장으로 안내한다.
      const outcome = await copyImage(reportBlob);
      const message = {
        copied: '画像をコピーしました。コミュニティの投稿に貼り付けてください。',
        unsupported: 'このブラウザは画像のコピーに対応していません。PNG 保存を使ってください。',
        blocked: 'コピーがブロックされました。このウィンドウを一度クリックしてからもう一度押してみてください。それでも駄目なら PNG 保存を使ってください。',
      }[outcome];
      showReportMsg(message, outcome === 'copied');
    })();
  });
  element<HTMLButtonElement>(root, '[data-report-save]').addEventListener('click', () => {
    if (!reportBlob || !lastBatch) return;
    downloadImage(reportBlob, reportFilename(lastBatch));
    showReportMsg('PNG で保存しました。', true);
  });

  // ── 자세히 보기 ─────────────────────────────────────────────────────────
  // 켠 상태는 이 브라우저에 남는다 — 한 번 켜 둔 사람은 늘 그 눈으로 본다.
  const DETAIL_KEY = 'nikke-detail-damage-v1';
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

    // 보고서는 마지막으로 그려진 결과를 그대로 쓴다.
    lastBatch = batch;
    const reportTools = document.createElement('div');
    reportTools.className = 'report-tools';
    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'report-open';
    reportButton.dataset.reportOpen = '';
    reportButton.textContent = 'レポート画像を作成';
    reportButton.title = '結果を1枚の PNG にしてコピーまたは保存します';
    reportButton.addEventListener('click', () => { void openReport(); });
    const historySave = document.createElement('button');
    historySave.type = 'button';
    historySave.className = 'report-open';
    historySave.dataset.historySave = '';
    historySave.textContent = '結果を保存';
    historySave.title = 'このときの編成と数値をこのブラウザに残します';
    historySave.addEventListener('click', () => saveHistory(batch));
    const historyOpen = document.createElement('button');
    historyOpen.type = 'button';
    historyOpen.className = 'report-open';
    historyOpen.dataset.historyOpen = '';
    historyOpen.textContent = '結果を読み込む';
    historyOpen.addEventListener('click', () => { renderHistory(); historyModal.hidden = false; });
    // 정밀 수치 — 화면은 「1.24억」으로 줄여 적지만 엔진은 처음부터 정수로 정확히 센다.
    // 1의 자리까지 놓고 따지려는 사람에게 그 정수를 표로 내준다.
    const csvButton = document.createElement('button');
    csvButton.type = 'button';
    csvButton.className = 'report-open';
    csvButton.dataset.csvExport = '';
    csvButton.textContent = '精密数値 CSV';
    csvButton.title = '区間ごと・最終ダメージを1の位まで収めた表をダウンロードします (0.1秒単位)';
    csvButton.addEventListener('click', () => { void exportDamageCsv(batch, csvButton); });
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
    reportTools.append(historySave, historyOpen, reportButton, csvButton, detailLabel);
    resultPanel.append(reportTools);

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
  // ── 전투 조건 공유 ──────────────────────────────────────────────────────
  const battleShareModal = element<HTMLElement>(root, '[data-battle-share-modal]');
  const battleShareOut = element<HTMLTextAreaElement>(root, '[data-battle-share-out]');
  const battleShareIn = element<HTMLTextAreaElement>(root, '[data-battle-share-in]');
  const battleShareMsg = element<HTMLElement>(root, '[data-battle-share-msg]');
  const showBattleShareMsg = (message: string, ok = false) => {
    battleShareMsg.hidden = message === '';
    battleShareMsg.textContent = message;
    battleShareMsg.classList.toggle('is-ok', ok);
  };

  /** 받은 전투 조건을 얹는다. 콘솔과 싱크로 레벨은 코드에 없으므로 내 값을 그대로 둔다. */
  const applyBattleCode = (code: string): void => {
    const applied = decodeBattleCode(code);
    const mine = readBattle();
    writeBattle({ ...applied, console: mine.console, synchroLevel: mine.synchroLevel });
    corePxInput.disabled = !applied.coreEnabled;
    saveState();
    showErrors([]);
  };
  const battleSharePanel: SharePanel | null = shareServer && mountSharePanel(
    sharePanelHosts('battle-share'),
    {
      kind: 'boss',
      server: shareServer,
      current: () => ({
        code: encodeBattleCode(readBattle(), settings.normalHitCoeff ?? {}),
        auto: summarizeBattle(readBattle()),
      }),
      apply: (item) => {
        applyBattleCode(item.code);
        showBattleShareMsg(`«${item.name}» を適用しました。コンソールは自分の値のままです。`, true);
      },
      notify: showBattleShareMsg,
    },
  );

  element<HTMLButtonElement>(root, '[data-battle-share-open]').addEventListener('click', () => {
    battleShareOut.value = encodeBattleCode(readBattle(), settings.normalHitCoeff ?? {});
    battleShareIn.value = '';
    showBattleShareMsg('');
    battleShareModal.hidden = false;
    battleSharePanel?.open();
  });
  element<HTMLButtonElement>(root, '[data-battle-share-close]').addEventListener('click', () => {
    battleShareModal.hidden = true;
  });
  battleShareModal.addEventListener('click', (event) => {
    if (event.target === battleShareModal) battleShareModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-battle-share-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(battleShareOut.value);
      showBattleShareMsg('コードをコピーしました。', true);
    } catch {
      battleShareOut.select();
      showBattleShareMsg('自動コピーが使えないためコードを選択しておきました。Ctrl+C でコピーしてください。');
    }
  });
  element<HTMLButtonElement>(root, '[data-battle-share-apply]').addEventListener('click', () => {
    try {
      applyBattleCode(battleShareIn.value);
      showBattleShareMsg('戦闘条件を適用しました。コンソールは自分の値のままです。', true);
    } catch (error) {
      showBattleShareMsg(error instanceof Error ? error.message : String(error));
    }
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

  const loadCombatPower = async () => {
    if (!client.combatPower) return;
    const sig = JSON.stringify(roster);
    if (powerLoading || powerSig === sig) return;
    powerLoading = true;
    try {
      await prepared;
      const custom = customPayload();
      const got = await client.combatPower({
        names: catalog.map((meta) => meta.name),
        characters: roster,
        ...(Object.keys(custom).length > 0 ? { customCharacters: custom } : {}),
      });
      combatPower = got;
      powerSig = sig;
      renderFilterState();
      renderRosterGrid();
    } catch {
      /* 전투력은 정렬 편의 기능이다 — 실패해도 목록은 그대로 쓴다 */
    } finally {
      powerLoading = false;
    }
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
    for (const key of [STATE_KEY, ROSTER_KEY, CUSTOM_KEY]) {
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
  const applyRosterToDecks = () => {
    for (const deck of decks) {
      for (const member of deck.squad) {
        if (member && roster[member] && !deck.characters[member]) {
          deck.characters[member] = cloneOverride(roster[member]!);
        }
      }
    }
  };
  const updateRosterNote = (message?: string) => {
    const count = Object.keys(roster).length;
    if (message) rosterNote.textContent = message;
    else if (count > 0) rosterNote.textContent = `CSV ロスター ${count}名を適用中`;
    rosterNote.hidden = !message && count === 0;
  };
  rosterInput.addEventListener('change', async () => {
    const file = rosterInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { overrides, matched, unmatched } = parseRosterCsv(text, settings);
      if (matched.length === 0) {
        updateRosterNote('CSV に対応キャラクターが見つかりませんでした。正式名称が一致しているか確認してください。');
        return;
      }
      roster = overrides;
      saveRoster();
      void loadCombatPower();
      applyRosterToDecks();
      saveState();
      renderDeckTabs();
      renderSquad();
      const skipped = unmatched.length > 0 ? ` · 未対応 ${unmatched.length}名を除外` : '';
      updateRosterNote(`CSV ロスター ${matched.length}名を適用${skipped}`
        + ' · キューブと好感度は CSV にないため既定値で計算します(カードの個別設定で修正可)');
    } catch (error) {
      updateRosterNote(`CSV の読み込みに失敗: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      rosterInput.value = '';
    }
  });

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

    const runSync = async () => {
      const url = blablaUrl.value.trim();
      if (!looksLikeProfileUrl(url)) {
        setStatus('Blablalink のプロフィールのアドレスを貼り付けてください。');
        return;
      }
      const selectedArea = blablaServer.value === '' ? undefined : Number(blablaServer.value);
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
        const { overrides, matched, unmatched, notes } = areaToOverrides(area, settings, catalog);
        if (matched.length === 0) {
          setStatus('計算機が扱えるニケが見つかりませんでした。プロフィールが公開になっているか確認してください。');
          return;
        }

        roster = overrides;
        saveRoster();
        void loadCombatPower();
        applyRosterToDecks();

        // 콘솔은 계정 단위라 전투 설정 쪽에 있다. 전초기지가 비공개면 안 오고, 그때는
        // 손대지 않는 게 맞다 — 0으로 덮으면 멀쩡하던 값이 사라진다.
        const consoleLevels = consoleFrom(area);
        if (consoleLevels) writeBattle({ ...readBattle(), console: consoleLevels });

        saveState();
        renderDeckTabs();
        renderSquad();

        const parts = [`Blablalink ${serverLabel} ${matched.length}名を適用`];
        if (unmatched.length > 0) parts.push(`未対応 ${unmatched.length}名を除外`);
        if (consoleLevels) parts.push('コンソールレベルも適用');
        updateRosterNote(parts.join(' · '));
        setStatus([`${serverLabel}サーバーから ${matched.length}名を読み込みました。`, ...notes].join(' '));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
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
    blablaSync.addEventListener('click', () => { void runSync(); });
    blablaUrl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void runSync(); }
    });
  }

  // ── ENIKK 조합 가져오기 ─────────────────────────────────────────────────
  // enikk.app 솔로레이드 랭킹 상위 300명(서버당 50명 × 6서버)의 1~5덱을 받아
  // 같은 편성끼리 묶는다. 페이지를 넘길 필요가 없다 — GraphQL이 한 번에 다 준다.
  // v1은 조합으로 묶어 저장했다(`players`가 숫자였다). 사람 단위로 바꾸면서 모양이
  // 달라졌으므로 키를 올린다 — 안 올리면 예전 캐시를 새 코드가 읽다 터진다.
  const ENIKK_KEY = 'nikke-enikk-v2';
  const enikkStatus = element<HTMLElement>(root, '[data-enikk-status]');
  const enikkSummary = element<HTMLElement>(root, '[data-enikk-summary]');
  const enikkList = element<HTMLElement>(root, '[data-enikk-list]');
  const enikkCompare = element<HTMLElement>(root, '[data-enikk-compare]');
  const enikkLoad = element<HTMLButtonElement>(root, '[data-enikk-load]');
  const enikkRefresh = element<HTMLButtonElement>(root, '[data-enikk-refresh]');
  let enikkData: EnikkImport | null = null;
  // 300명을 한 줄로 늘어놓으면 스크롤이 끝없다 — 열 명씩 끊어 쪽으로 넘긴다.
  const ENIKK_PER_PAGE = 10;
  let enikkPage = 0;
  let currentView: 'calc' | 'union' | 'enikk' | 'links' = 'calc';

  const readEnikkCache = (): EnikkImport | null => {
    try {
      const raw = resolveStorage()?.getItem(ENIKK_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as EnikkImport;
      // 키를 올려도 남의 브라우저에는 무엇이 들어 있을지 모른다. 쓰기 전에 모양을 본다.
      if (!Array.isArray(data?.players) || !data.season) return null;
      return data;
    } catch { return null; }
  };
  const writeEnikkCache = (data: EnikkImport) => {
    try { resolveStorage()?.setItem(ENIKK_KEY, JSON.stringify(data)); } catch { /* 용량 초과면 그냥 안 남긴다 */ }
  };

  /** 초상화 다섯 장. 이름을 모르는 사람도 눈으로 알아보게. */
  const enikkPortraits = (squad: string[]): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'enikk-faces';
    for (const name of squad) {
      const char = catalogByName.get(name);
      const cell = document.createElement('span');
      cell.className = 'enikk-face';
      cell.title = name;
      if (char?.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${char.image}`;
        img.alt = name;
        img.loading = 'lazy';
        cell.append(img);
      }
      cell.append(createText('em', name));
      box.append(cell);
    }
    return box;
  };

  /** 한 플레이어의 다섯 덱을 우리 5덱에 그대로 깐다. */
  const applyPlayerToDecks = (player: EnikkPlayer) => {
    const usable = player.decks.filter(enikkDeckUsable);
    if (usable.length === 0) return;
    for (const deck of decks) { deck.squad = ['', '', '', '', '']; deck.characters = {}; }
    usable.slice(0, 5).forEach((source, index) => {
      const deck = decks[index]!;
      deck.squad = [...source.squad];
      for (const name of source.squad) {
        if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
      }
    });
    // 다섯 덱을 한 번에 받았으니 5덱 모드가 아니면 볼 수가 없다.
    if (usable.length > 1 && !fiveDeckMode) {
      const toggle = element<HTMLInputElement>(root, '#squad-mode');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
    }
    activeDeckId = 1;
    activeSlot = 0;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    switchView('calc');
    scrollTo(squadGrid);
  };

  // ── 제외 니케 ───────────────────────────────────────────────────────────
  // 안 가진 니케가 낀 덱은 가져와도 못 쓴다. enikk 데이터 자체가 아니라 «내 사정»이라
  // 계산 결과가 아닌 **화면 층**에서 거른다.
  const EXCLUDE_KEY = 'nikke-enikk-excluded-v1';
  let enikkExcluded: string[] = [];
  try {
    const raw = resolveStorage()?.getItem(EXCLUDE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (Array.isArray(parsed)) {
      enikkExcluded = parsed.filter((n): n is string =>
        typeof n === 'string' && catalogByName.has(n));
    }
  } catch { /* 못 읽으면 빈 목록으로 시작한다 */ }

  const saveExcluded = () => {
    try {
      resolveStorage()?.setItem(EXCLUDE_KEY, JSON.stringify(enikkExcluded));
    } catch { /* 저장 실패 무시 */ }
  };

  /** 이 덱을 쓸 수 있나 — 계산기가 다룰 수 있고, 제외 니케가 안 껴 있어야 한다. */
  const enikkDeckUsable = (deck: { squad: string[]; usable: boolean }): boolean =>
    deck.usable && !deck.squad.some((name) => enikkExcluded.includes(name));

  const renderExcludeChips = () => {
    const box = element<HTMLElement>(root, '[data-enikk-exclude-chips]');
    box.replaceChildren();
    for (const name of enikkExcluded) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'enikk-exclude-chip';
      chip.dataset.enikkExcludeChip = name;
      chip.title = `${name} 제외 해제`;
      chip.append(createText('span', name));
      chip.append(createText('b', '✕'));
      chip.addEventListener('click', () => {
        enikkExcluded = enikkExcluded.filter((n) => n !== name);
        saveExcluded();
        renderExcludeChips();
        if (enikkData) renderEnikk(enikkData);
      });
      box.append(chip);
    }
  };

  const addExcluded = () => {
    const input = element<HTMLInputElement>(root, '[data-enikk-exclude-input]');
    const name = input.value.trim();
    if (!name) return;
    if (!catalogByName.has(name)) {
      setEnikkStatus(`«${name}»은(는) 목록에 없는 이름입니다.`);
      return;
    }
    if (!enikkExcluded.includes(name)) {
      enikkExcluded.push(name);
      enikkExcluded.sort((a, b) => a.localeCompare(b, 'ko'));
      saveExcluded();
      renderExcludeChips();
      if (enikkData) renderEnikk(enikkData);
    }
    input.value = '';
  };

  // 이름 자동완성 — 오타로 «목록에 없는 이름»을 만나는 일을 줄인다.
  {
    const options = element<HTMLElement>(root, '[data-enikk-exclude-options]');
    for (const meta of catalog) {
      const option = document.createElement('option');
      option.value = meta.name;
      options.append(option);
    }
    renderExcludeChips();
  }

  element<HTMLButtonElement>(root, '[data-enikk-exclude-add]').addEventListener('click', addExcluded);
  element<HTMLInputElement>(root, '[data-enikk-exclude-input]').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addExcluded(); }
  });

  const renderEnikk = (data: EnikkImport) => {
    enikkData = data;
    enikkPage = 0;
    const weakness = WEAKNESS_KO[data.season.weakness] ?? data.season.weakness;
    enikkSummary.hidden = false;
    enikkSummary.replaceChildren();
    enikkSummary.append(createText('strong', `시즌 ${data.season.raid} · ${data.season.boss}`));
    enikkSummary.append(createText('span',
      `약점 ${weakness} · 플레이어 ${data.players.length}명 · 덱 ${data.decks.toLocaleString('ko-KR')}개`));
    if (data.unknownNames.length > 0) {
      enikkSummary.append(createText('span',
        `계산기가 모르는 니케 ${data.unknownNames.length}종이 낀 덱은 가져올 수 없습니다 — ${data.unknownNames.slice(0, 5).join(', ')}`,
        'enikk-note'));
    }

    enikkList.hidden = false;
    enikkList.replaceChildren();
    const head = document.createElement('div');
    head.className = 'enikk-list-head';
    head.append(createText('h3', `플레이어 ${data.players.length}명 · 총딜 순`));
    const compareBtn = document.createElement('button');
    compareBtn.type = 'button';
    compareBtn.className = 'roster-import';
    compareBtn.textContent = `상위 ${COMPARE_TOP}명 대조판 만들기`;
    compareBtn.title = '상위 10명의 덱을 우리 계산기로 돌려 enikk 실측과 나란히 놓습니다 — 덱 50개라 몇 분 걸립니다';
    compareBtn.addEventListener('click', () => {
      compareBtn.disabled = true;
      void renderCompare().finally(() => { compareBtn.disabled = false; });
    });
    head.append(compareBtn);
    enikkList.append(head);

    const pagerTop = document.createElement('div');
    pagerTop.className = 'enikk-pager';
    const cards = document.createElement('div');
    const pagerBottom = document.createElement('div');
    pagerBottom.className = 'enikk-pager';
    enikkList.append(pagerTop, cards, pagerBottom);

    const pages = Math.max(1, Math.ceil(data.players.length / ENIKK_PER_PAGE));
    if (enikkPage >= pages) enikkPage = 0;

    const drawCards = () => {
      cards.replaceChildren();
      const from = enikkPage * ENIKK_PER_PAGE;
      for (const [offset, player] of data.players.slice(from, from + ENIKK_PER_PAGE).entries()) {
        const index = from + offset;
      const card = document.createElement('article');
      card.className = 'enikk-player';

      const top = document.createElement('div');
      top.className = 'enikk-player-head';
      top.append(createText('span', `${index + 1}`, 'enikk-rank'));
      top.append(createText('b', player.server, 'enikk-server'));
      top.append(createText('span', `총 ${formatEok(player.damage)}`, 'enikk-total'));
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'enikk-use';
      const usable = player.decks.filter(enikkDeckUsable).length;
      take.textContent = `${usable}덱 가져오기`;
      take.disabled = usable === 0;
      take.title = usable < player.decks.length
        ? '계산기가 못 다루거나 제외한 니케가 낀 덱은 빼고 가져옵니다'
        : '이 사람의 덱을 우리 5덱에 그대로 깝니다';
      take.addEventListener('click', () => applyPlayerToDecks(player));
      top.append(take);
      card.append(top);

      for (const [n, deck] of player.decks.entries()) {
        const row = document.createElement('div');
        const blocked = !enikkDeckUsable(deck);
        row.className = 'enikk-deck' + (blocked ? ' is-blocked' : '');
        if (blocked && deck.usable) {
          row.title = `제외한 니케가 껴 있습니다 — ${deck.squad.filter((n) => enikkExcluded.includes(n)).join(', ')}`;
        }
        row.append(createText('span', `${n + 1}`, 'enikk-deckno'));
        row.append(enikkPortraits(deck.squad));
        row.append(createText('span', formatEok(deck.damage), 'enikk-deckdmg'));
        card.append(row);
      }
      cards.append(card);
      }
    };

    /** 페이지 이동 줄. 위·아래 양쪽에 둔다 — 열 명을 훑고 나면 아래가 가깝다. */
    const drawPager = (box: HTMLElement) => {
      box.replaceChildren();
      const jump = (page: number) => {
        enikkPage = Math.max(0, Math.min(pages - 1, page));
        drawCards();
        drawPager(pagerTop);
        drawPager(pagerBottom);
        scrollTo(enikkList);
      };
      const step = (label: string, page: number, disabled: boolean) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'enikk-page-step';
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener('click', () => jump(page));
        box.append(b);
      };
      step('‹ 이전', enikkPage - 1, enikkPage === 0);

      // 번호는 현재 쪽 둘레만 편다. 서른 개를 다 늘어놓으면 폰에서 줄이 넘친다.
      const window_ = new Set<number>([0, pages - 1]);
      for (let i = enikkPage - 1; i <= enikkPage + 1; i += 1) {
        if (i >= 0 && i < pages) window_.add(i);
      }
      let previous = -1;
      for (const page of [...window_].sort((a, b) => a - b)) {
        if (previous >= 0 && page - previous > 1) box.append(createText('span', '…', 'enikk-page-gap'));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'enikk-page' + (page === enikkPage ? ' is-on' : '');
        b.textContent = String(page + 1);
        b.setAttribute('aria-current', page === enikkPage ? 'page' : 'false');
        b.addEventListener('click', () => jump(page));
        box.append(b);
        previous = page;
      }
      step('다음 ›', enikkPage + 1, enikkPage === pages - 1);
      box.append(createText('span', `${pages}쪽 중 ${enikkPage + 1}쪽`, 'enikk-page-info'));
    };

    drawCards();
    drawPager(pagerTop);
    drawPager(pagerBottom);
  };

  const setEnikkStatus = (message: string) => { enikkStatus.textContent = message; };

  // ── 상위 10 대조판 ──────────────────────────────────────────────────────
  // 실사용 조합을 우리 시뮬로 돌려 enikk 실측 평균과 나란히 놓는다. 계산기가 어느
  // 조합에서 얼마나 어긋나는지가 표본 열 개로 한눈에 보인다.
  //
  // **같은 잣대가 아니다.** enikk 평균은 사람마다 다른 육성·조작이 섞인 값이고 우리
  // 시뮬은 지금 화면의 전투 조건과 스펙으로 돈다. 배율은 «얼마나 다른가»를 보는
  // 눈금이지 정답과의 오차가 아니다 — 그 사실을 표에 적어 둔다.
  const COMPARE_TOP = 10;

  const renderCompare = async () => {
    if (!enikkData) return;
    const targets = enikkData.players.slice(0, COMPARE_TOP);
    if (targets.length === 0) return;
    const total = targets.reduce((sum, p) => sum + p.decks.filter((d) => d.usable).length, 0);

    enikkCompare.hidden = false;
    enikkCompare.replaceChildren();
    enikkCompare.append(createText('h3', `상위 ${targets.length}명 대조판`));
    enikkCompare.append(createText('p',
      `덱 ${total}개를 지금 전투 조건과 내 스펙으로 돌려 그 사람의 실제 딜과 나란히 놓습니다. `
      + '스펙이 다른 사람의 기록이므로 배율은 «얼마나 다른가»를 보는 눈금입니다. '
      + '같은 편성은 저장된 결과를 다시 쓰므로 뒤로 갈수록 빨라집니다.',
      'enikk-note'));

    const table = document.createElement('div');
    table.className = 'enikk-table';
    enikkCompare.append(table);

    const battle = readBattle();
    const custom = customPayload();
    await prepared;
    let done = 0;
    for (const [index, player] of targets.entries()) {
      let simTotal = 0;
      let realTotal = 0;
      for (const source of player.decks) {
        if (!enikkDeckUsable(source)) continue;
        done += 1;
        setEnikkStatus(`대조 계산 중 · 덱 ${done}/${total}`);
        const deck: DeckState = { id: 1, squad: [...source.squad], characters: {} };
        for (const name of source.squad) {
          if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
        }
        const request = requestForDeck(deck, battle, Object.keys(custom).length > 0 ? custom : undefined);
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        simTotal += result.squadTotal;
        realTotal += source.damage;
      }
      const ratio = realTotal > 0 ? simTotal / realTotal : 0;

      const row = document.createElement('div');
      row.className = 'enikk-trow';
      row.append(createText('span', `${index + 1}`, 'enikk-rank'));
      const who = document.createElement('div');
      who.className = 'enikk-who';
      who.append(createText('b', player.server, 'enikk-server'));
      who.append(createText('span', `${player.decks.filter((d) => d.usable).length}덱`));
      row.append(who);
      const nums = document.createElement('div');
      nums.className = 'enikk-nums';
      nums.append(createText('span', `실제 ${formatEok(realTotal)}`));
      nums.append(createText('span', `시뮬 ${formatEok(simTotal)}`, 'enikk-sim'));
      if (ratio > 0) {
        const tag = createText('b', `${ratio.toFixed(2)}배`, 'enikk-ratio');
        tag.classList.add(ratio > 1.15 || ratio < 0.85 ? 'is-off' : 'is-near');
        nums.append(tag);
      }
      row.append(nums);
      table.append(row);
    }
    setEnikkStatus(`상위 ${targets.length}명 대조 완료.`);
  };

  const loadEnikk = async (force: boolean) => {
    if (!force) {
      const cached = readEnikkCache();
      if (cached) {
        renderEnikk(cached);
        setEnikkStatus('저장해 둔 결과입니다. 새로 받으려면 «다시 받기»를 누르세요.');
        enikkLoad.hidden = true;
        enikkRefresh.hidden = false;
        return;
      }
    }
    enikkLoad.disabled = true;
    enikkRefresh.disabled = true;
    try {
      const supported = new Set(catalog.map((char) => char.name));
      const data = await loadEnikkComps(catalog, supported, setEnikkStatus);
      writeEnikkCache(data);
      renderEnikk(data);
      setEnikkStatus(`플레이어 ${data.players.length}명 · 덱 ${data.decks}개를 읽었습니다.`);
      enikkLoad.hidden = true;
      enikkRefresh.hidden = false;
    } catch (error) {
      setEnikkStatus(error instanceof Error ? error.message : String(error));
    } finally {
      enikkLoad.disabled = false;
      enikkRefresh.disabled = false;
    }
  };

  enikkLoad.addEventListener('click', () => { void loadEnikk(false); });
  enikkRefresh.addEventListener('click', () => { void loadEnikk(true); });

  // ── 지금 보는 사람 수 ───────────────────────────────────────────────────
  // 공유 서버가 세 준다. 주소가 없으면 아예 띄우지 않는다 — 0명이라고 적어 두면
  // «아무도 없다»로 읽히는데 사실은 «셀 곳이 없다»이기 때문이다.
  if (SHARE_API) {
    const onlineBox = element<HTMLElement>(root, '[data-online]');
    const onlineText = element<HTMLElement>(root, '[data-online-text]');
    startPresence(SHARE_API, (online) => {
      onlineText.textContent = `現在 ${online.toLocaleString('ja-JP')}名`;
      onlineBox.hidden = false;
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

  // ── 유니온 레이드 (BETA) ────────────────────────────────────────────────
  // 프록시가 있어야 유니온원 스펙을 받아 올 수 있다 — 없으면 탭 자체를 안 그렸다.
  const unionPanel = root.querySelector<HTMLElement>('[data-view="union"]');
  if (unionPanel) {
    mountUnionRaid({ panel: unionPanel }, {
      proxy: blablaProxy || '',
      shareServer,
      settings,
      catalog: [...catalogByName.values()],
      simulate: (request) => client.simulate(request),
      imageOf: (name) => {
        const image = catalogByName.get(name)?.image;
        return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
      },
      currentBattleCode: () => encodeBattleCode(readBattle(), settings.normalHitCoeff),
      currentDeckCode: (index) => {
        const deck = decks[index];
        return deck ? encodeShareCode([deck], false) : '';
      },
      catalogNames: () => [...catalogByName.keys()],
      concurrency: () => (parallelOn ? parallelCount : 1),
      me: () => {
        const battle = readBattle();
        return {
          name: '自分の設定',
          synchro: battle.synchroLevel,
          console: battle.console,
          // 가져온 로스터(CSV·블라블라링크)가 내 스펙이다. 없으면 기본 스펙으로 돈다.
          roster: Object.fromEntries(Object.entries(roster)
            .filter(([name]) => catalogByName.has(name))),
          owned: Object.keys(roster).length,
        };
      },
    });
  }

  // ── 화면 전환 ───────────────────────────────────────────────────────────
  /** 위쪽 탭이 고를 수 있는 화면. 「외부고리」는 우리 것이 아닌 곳으로 나가는 판이다. */
  type ViewName = 'calc' | 'union' | 'enikk' | 'links';

  function switchView(view: ViewName) {
    currentView = view;
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
    if (view === 'enikk' && !enikkData) {
      const cached = readEnikkCache();
      if (cached) {
        renderEnikk(cached);
        setEnikkStatus('저장해 둔 결과입니다. 새로 받으려면 «다시 받기»를 누르세요.');
        enikkLoad.hidden = true;
        enikkRefresh.hidden = false;
      }
    }
  }
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
    tab.addEventListener('click', () => switchView(tab.dataset.viewTab as ViewName));
  }
  // β の主役はユニオンレイド (3属性比較) なので最初に開く。計算機は「計算機」タブから
  switchView('union');

  // ── 외부고리 ────────────────────────────────────────────────────────────
  // 표(`external-links.ts`)를 그대로 편다. 주소를 HTML에 박지 않는 이유는 고칠 곳을
  // 한 군데로 두기 위해서다 — 새 고리는 그 배열에 한 줄만 더하면 여기 나온다.
  const linksGrid = element<HTMLElement>(root, '[data-links-grid]');
  for (const link of EXTERNAL_LINKS) {
    const card = document.createElement('a');
    card.className = 'link-card';
    card.href = link.url;
    card.target = '_blank';
    // 남의 페이지에 우리 창을 넘기지 않는다.
    card.rel = 'noopener noreferrer';

    const head = document.createElement('div');
    head.className = 'link-head';
    const name = document.createElement('h3');
    name.className = 'link-name';
    name.textContent = link.label;
    const host = document.createElement('span');
    host.className = 'link-host';
    host.textContent = hostOf(link.url);
    head.append(name, host);

    const note = document.createElement('p');
    note.className = 'link-note';
    note.textContent = link.note;

    const go = document.createElement('span');
    go.className = 'link-go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '新しいタブで開く ↗';

    card.append(head, note, go);
    linksGrid.append(card);
  }

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

  const customModal = element<HTMLElement>(root, '[data-custom-modal]');
  const customJson = element<HTMLTextAreaElement>(root, '[data-custom-json]');
  const customMsg = element<HTMLElement>(root, '[data-custom-msg]');
  const customList = element<HTMLElement>(root, '[data-custom-list]');
  const showCustomMsg = (text: string, ok = false) => {
    customMsg.textContent = text;
    customMsg.hidden = !text;
    customMsg.classList.toggle('is-ok', ok);
  };
  const renderCustomList = () => {
    customList.replaceChildren();
    const names = Object.keys(customChars);
    if (names.length === 0) return;
    customList.append(createText('p', '追加したニケ', 'custom-list-title'));
    for (const name of names) {
      const meta = customToMeta(customChars[name]!);
      const row = document.createElement('div');
      row.className = 'custom-list-row';
      row.append(createText('span', `${name} · B${meta.burstStage} · ${elementLabel(meta.elementCode)} · ${meta.weaponType}`, 'custom-list-name'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'custom-remove';
      remove.textContent = '削除';
      remove.addEventListener('click', () => {
        delete customChars[name];
        saveCustom();
        const index = catalog.findIndex((char) => char.name === name);
        if (index >= 0) catalog.splice(index, 1);
        catalogByName.delete(name);
        delete settings.characters[name];
        for (const deck of decks) {
          deck.squad = deck.squad.map((member) => (member === name ? '' : member));
          delete deck.characters[name];
        }
        saveState();
        renderCustomList();
        renderDeckTabs();
        renderSquad();
      });
      row.append(remove);
      customList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-add-nikke]').addEventListener('click', () => {
    customModal.hidden = false;
    showCustomMsg('');
    renderCustomList();
  });
  element<HTMLButtonElement>(root, '[data-custom-close]').addEventListener('click', () => {
    customModal.hidden = true;
  });
  customModal.addEventListener('click', (event) => {
    if (event.target === customModal) customModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-copy-prompt]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildAddPrompt());
      showCustomMsg('プロンプトをコピーしました。他の LLM に貼り付け、続けてニケの説明を付けてください。', true);
    } catch {
      showCustomMsg('自動コピーに失敗しました。ブラウザの権限を確認するか、手動でコピーしてください。');
    }
  });
  element<HTMLButtonElement>(root, '[data-custom-submit]').addEventListener('click', () => {
    try {
      const custom = parseCustomInput(customJson.value);
      customChars[custom.name] = custom;
      saveCustom();
      registerCustom(custom.name);
      renderCustomList();
      renderDeckTabs();
      renderSquad();
      customJson.value = '';
      const ignored = unsupportedEffects(custom.skills);
      if (ignored.length > 0) {
        showCustomMsg(
          `'${custom.name}' を追加しました。ただし認識されない効果があり、反映されません: `
          + `${ignored.join(', ')}。この効果がキャラクターの主力ダメージなら結果は実際よりかなり低く出ます`
          + `(ゲージ・モード切り替え・条件付きスタック型のスキルはこの方式では再現しにくいです)。`
          + `ヘルプの語彙と照らし合わせて stat·timing·target を直せば一部は反映されます。`,
        );
      } else {
        showCustomMsg(`'${custom.name}' を追加しました · スカッドの枠から選べます。`, true);
      }
    } catch (error) {
      showCustomMsg(error instanceof Error ? error.message : String(error));
    }
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

  for (const name of Object.keys(customChars)) registerCustom(name);
  applySavedState();
  applyRosterToDecks();
  updateRosterNote();
  renderDeckTabs();
  renderSquad();
  // 판은 창이 아니라 늘 펼쳐져 있으므로 처음부터 그려 둔다.
  const firstEmpty = activeDeck().squad.findIndex((member) => !member);
  activeSlot = firstEmpty < 0 ? 0 : firstEmpty;
  renderSquad();
  renderRosterGrid();

  // 공유 링크로 들어왔으면 저장 상태 위에 그 편성을 얹는다 — 순서가 반대면
  // applySavedState가 링크로 넣은 편성을 도로 덮어쓴다. 주소는 정리해 두어
  // 새로고침할 때마다 다시 덮어쓰지 않게 한다.
  if (location.hash.startsWith('#deck=')) {
    const linked = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    applyShareText(linked, 'all');
    refreshShareFields();
    renderPresets();
    shareIn.value = linked;
    shareModal.hidden = false;
  }

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
    const custom = customPayload();
    const requests = selectedDecks.map((deck) => ({
      deck,
      request: requestForDeck(deck, battle, Object.keys(custom).length > 0 ? custom : undefined),
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
