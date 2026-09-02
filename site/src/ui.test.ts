// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StorageLike } from './cache';
import { mountCalculator, type CalculatorClientLike } from './ui';
import './styles.css';
import type {
  CharacterMeta,
  CombatPowerRequest,
  SettingsCatalog,
  SimulationRequest,
  SimulationResult,
} from './types';

const names = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가', '프리바티'];
const catalog: CharacterMeta[] = [
  { name: '리타', burstStage: '1', elementCode: '철갑', weaponType: 'SMG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/1.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '크라운', burstStage: '2', elementCode: '철갑', weaponType: 'MG', className: '방어형', manufacturer: '필그림', preview: false, image: 'characters/2.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '라피 : 레드 후드', burstStage: '3', elementCode: '작열', weaponType: 'MG', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/3.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '앨리스', burstStage: '3', elementCode: '수냉', weaponType: 'SR', className: '화력형', manufacturer: '테트라', preview: false, image: 'characters/4.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '나가', burstStage: '2', elementCode: '전격', weaponType: 'SG', className: '지원형', manufacturer: '미실리스', preview: false, image: 'characters/5.webp', nameCode: null, resourceId: null, aliases: [] },
  { name: '프리바티', burstStage: '3', elementCode: '수냉', weaponType: 'AR', className: '화력형', manufacturer: '엘리시온', preview: false, image: 'characters/6.webp', nameCode: null, resourceId: null, aliases: [] },
];

const cubeLevels = { '15': { atk: 2780, def: 552, hp: 83400, effect: 10, commonElement: 19.09 } };
const settings: SettingsCatalog = {
  characters: Object.fromEntries(names.map((name) => [name, {
    weaponType: catalog.find((character) => character.name === name)?.weaponType ?? 'AR',
    recommendedControl: {},
    hasConditionalControl: false,
    growthStage: 3,
    rarity: 'SSR',
    maxGrowthStage: 10,
    growthOptions: Array.from({ length: 11 }, (_, value) => ({
      value,
      label: value === 0 ? '명함' : value <= 3 ? `${value}돌` : `코강 ${value - 3}`,
      affinity: value === 0 ? 10 : value === 1 ? 20 : 30,
    })),
    skillLevels: { '1': 10, '2': 10, '3': 10 },
    skillLevelsLocked: false,
    overload: {
      element_bonus: 88.6,
      atk_pct: 22.22,
      max_ammo_pct: 129.64,
      crit_rate: 0,
      crit_dmg: 0,
    },
    cube: { name: '재장', level: 15 },
    collection: { stage: 'SR15', favorite: 0 },
  }])),
  collectionStages: ['없음', 'SR0', 'SR5', 'SR15'],
  normalHitCoeff: { AR: 1, SMG: 1, SG: 0.9, MG: 1, SR: 1, RL: 1 },
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  optimalRangeWeapons: ['AR', 'SMG', 'SG', 'MG', 'SR'],
  buffTargetWatch: { 리타: [{ buff: '웨이크업! 4', label: '크확 대상' }] },
  consoleClasses: ['화력형', '방어형', '지원형'],
  consoleCompanies: ['엘리시온', '테트라', '미실리스', '필그림', '어브노말'],
  cubes: {
    재장: { id: 0, label: '재장', stat: 'reload_speed_pct', template: '재장전 {0}%', levels: cubeLevels },
    탄충: { id: 0, label: '탄충', stat: 'ammo_charge_flat', template: '10발마다 {0}발', levels: cubeLevels },
    체력: { id: 0, label: '체력', stat: 'max_hp_pct', template: '체력 {0}%', levels: cubeLevels },
    차속: { id: 0, label: '차속', stat: 'charge_speed_pct', template: '차속 {0}%', levels: cubeLevels },
    파츠: { id: 0, label: '파츠', stat: 'part_dmg_pct', template: '파츠 {0}%', levels: cubeLevels },
    분배: { id: 0, label: '분배', stat: 'split_dmg_pct', template: '분배 {0}%', levels: cubeLevels },
  },
  overloadFields: {
    element_bonus: { label: '우월 코드 대미지', unit: '%', min: 0, max: 1000 },
    atk_pct: { label: '공격력', unit: '%', min: 0, max: 1000 },
    max_ammo_pct: { label: '최대 장탄수', unit: '%', min: 0, max: 10000 },
    crit_rate: { label: '크리티컬 확률', unit: '%', min: 0, max: 100 },
    crit_dmg: { label: '크리티컬 대미지', unit: '%', min: 0, max: 1000 },
    def_pct: { label: '방어력', unit: '%', min: 0, max: 1000 },
    charge_speed_pct: { label: '차지 속도', unit: '%', min: 0, max: 1000 },
    charge_dmg_pct: { label: '차지 대미지', unit: '%', min: 0, max: 1000 },
    accuracy_pct: { label: '명중률', unit: '%', min: 0, max: 1000 },
  },
  manualStats: {
    split_dmg_pct: { label: '분배 대미지', unit: '%', min: -1000, max: 10000 },
  },
  favoriteItems: {},
};

const calculated: SimulationResult = {
  squadTotal: 123_456,
  duration: 10,
  hitCount: 87,
  charTotals: {
    리타: 60_000,
    크라운: 30_000,
    '라피 : 레드 후드': 20_000,
    앨리스: 10_000,
    나가: 3_456,
  },
  previewNote: '',
  deviations: '기본 스펙(1층) 그대로',
};

class FakeClient implements CalculatorClientLike {
  prepareCalls = 0;
  simulateCalls = 0;
  lastRequest: SimulationRequest | null = null;
  requests: SimulationRequest[] = [];

  async prepare(): Promise<void> {
    this.prepareCalls += 1;
  }

  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    this.simulateCalls += 1;
    this.lastRequest = request;
    this.requests.push(request);
    return calculated;
  }

  dispose(): void {}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 판의 검색칸에 친다. 슬롯마다 있던 검색은 없어지고 덱에 하나만 남았다. */
function searchRoster(root: HTMLElement, query: string): void {
  const search = root.querySelector<HTMLInputElement>('[data-roster-search]')!;
  search.value = query;
  search.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 판에 지금 보이는 니케 이름을 순서대로. */
function rosterNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>('[data-roster-cell]')]
    .map((cell) => cell.dataset.rosterCell!);
}

function focusSlot(root: HTMLElement, index: number): void {
  root.querySelector<HTMLButtonElement>(`[data-slot-choose="${index}"]`)!.click();
}

/** 칸을 겨냥하고 판에서 골라 넣는다 — 실제 사용 흐름 그대로다. */
function chooseCharacter(root: HTMLElement, index: number, name: string): void {
  focusSlot(root, index);
  searchRoster(root, name);
  const cell = root.querySelector<HTMLButtonElement>(`[data-roster-cell="${name}"]`)!;
  expect(cell.disabled).toBe(false);
  cell.click();
  searchRoster(root, '');
}

function clearCharacterSlot(root: HTMLElement, index: number): void {
  const card = root.querySelectorAll<HTMLElement>('[data-slot-card]')[index]!;
  card.querySelector<HTMLButtonElement>('.slot-clear')!.click();
}

describe('calculator UI', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('main');
    document.body.append(root);
    localStorage.clear();
  });

  /** jsdom에는 DragEvent가 없다 — 필요한 부분(dataTransfer)만 흉내 낸다. */
  const dragEvent = (type: string, data: Record<string, string>) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const store = new Map(Object.entries(data));
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        types: [...store.keys()],
        getData: (key: string) => store.get(key) ?? '',
        setData: (key: string, value: string) => { store.set(key, value); },
        dropEffect: 'none',
        effectAllowed: 'none',
      },
    });
    return event;
  };

  /** 저장된 편성. 시험 카탈로그는 처음부터 다섯 칸이 차 있다. */
  const savedSquad = () => (JSON.parse(localStorage.getItem('nikke-state-v1')!) as
    { decks: Array<{ squad: string[] }> }).decks[0]!.squad;

  it('니케를 끌어다 칸에 놓는다', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const cell = root.querySelector<HTMLButtonElement>('[data-roster-cell="프리바티"]')!;
    expect(cell.draggable).toBe(true);

    // 4번 칸에 놓는다 — 고른 칸(activeSlot)이 아니라 **놓은 칸**에 들어가야 한다.
    const slot = root.querySelector<HTMLElement>('[data-slot-card="3"]')!;
    cell.dispatchEvent(dragEvent('dragstart', {}));
    slot.dispatchEvent(dragEvent('dragover', { 'application/x-nikke-name': '프리바티' }));
    expect(slot.classList.contains('is-drop')).toBe(true);
    slot.dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': '프리바티' }));

    expect(savedSquad()[3]).toBe('프리바티');
    // 다시 그린 칸에는 끌던 표시가 남지 않는다.
    expect(root.querySelector<HTMLElement>('[data-slot-card="3"]')!.classList.contains('is-drop'))
      .toBe(false);
  });

  it('이미 그 덱에 있는 니케는 놓아도 안 들어가고 이유를 말한다', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLElement>('[data-slot-card="4"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': '프리바티' }));
    const taken = savedSquad()[1]!;          // 2번 칸의 니케

    root.querySelector<HTMLElement>('[data-slot-card="4"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': taken }));

    expect(savedSquad()[4]).toBe('프리바티');   // 그대로다
    expect(root.querySelector('[data-errors]')!.textContent).toContain('すでに枠 2 にいます');
  });

  it('칸끼리 끌면 자리가 맞바뀐다', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLElement>('[data-slot-card="4"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-name': '프리바티' }));
    const before = savedSquad().slice(0, 3);

    // 1번을 3번 칸으로 끌어다 놓는다 — 이름에 걸린 설정은 그대로 두고 자리만 바뀐다.
    root.querySelector<HTMLElement>('[data-slot-card="2"]')!
      .dispatchEvent(dragEvent('drop', { 'application/x-nikke-slot': '0' }));

    expect(savedSquad().slice(0, 3)).toEqual([before[2], before[1], before[0]]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    root.remove();
  });

  it('버스트 순서를 단축키로 걸어 덱에 남긴다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    const modal = root.querySelector<HTMLElement>('[data-burst-order-modal]')!;
    expect(modal.hidden).toBe(false);

    // 첫 걸음은 1번째 풀버스트의 1버다.
    const now = root.querySelector<HTMLElement>('[data-burst-now]')!;
    expect(now.textContent).toContain('1回目のフルバースト');
    expect(now.textContent).toContain('1バ');

    // 1버는 리타 하나뿐이라 A와 「자동」(0)만 붙는다.
    const keysOf = () => [...root.querySelectorAll<HTMLElement>('[data-burst-picks] .burst-pick-key')]
      .map((node) => node.textContent);
    expect(keysOf()).toEqual(['A', '0']);

    const firstName = root.querySelector<HTMLElement>('[data-burst-picks] .burst-pick-name')!
      .textContent!;
    expect(firstName).toBe('리타');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    // 한 칸 골랐으니 다음 걸음(2버)으로 넘어간다.
    expect(now.textContent).toContain('2バ');
    // 2버는 둘이라 A·S가 편성 순서대로 붙는다.
    expect(keysOf()).toEqual(['A', 'S', '0']);
    expect([...root.querySelectorAll<HTMLElement>('[data-burst-picks] .burst-pick-name')]
      .map((node) => node.textContent).slice(0, 2)).toEqual(['크라운', '나가']);
    expect(root.querySelector('[data-burst-progress]')?.textContent).toContain('1 /');

    root.querySelector<HTMLButtonElement>('[data-burst-order-save]')!.click();
    expect(modal.hidden).toBe(true);

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ burstSequence?: Array<Record<string, string[]>> }> };
    expect(saved.decks[0]!.burstSequence![0]!['1']).toEqual([firstName]);
    // 덱 도구 줄의 배지가 걸려 있음을 알린다.
    expect(root.querySelector<HTMLElement>('[data-burst-order-badge]')!.hidden).toBe(false);
  });

  it('목록은 사이클마다 빈 칸 셋이고 고를 때마다 초상화가 채워진다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();

    const firstRow = () => root.querySelector<HTMLElement>('[data-burst-list] .burst-row')!;
    const slots = () => [...firstRow().querySelectorAll<HTMLElement>('.burst-slot')];

    // 아무것도 안 골라도 칸은 셋이다 — 몇 칸이 남았는지가 보여야 한다.
    expect(slots()).toHaveLength(3);
    expect(slots().map((slot) => slot.querySelector('.burst-slot-stage')?.textContent))
      .toEqual(['1バ', '2バ', '3バ']);
    expect(slots().every((slot) => !slot.classList.contains('is-filled'))).toBe(true);
    expect(firstRow().querySelectorAll('img')).toHaveLength(0);

    // 첫 칸을 고르면 그 칸만 채워지고 초상화가 들어간다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(slots()[0]!.classList.contains('is-filled')).toBe(true);
    expect(slots()[1]!.classList.contains('is-filled')).toBe(false);
    expect(slots()[0]!.querySelector('img')?.getAttribute('alt')).toBe('리타');
  });

  it('목록의 칸을 누르면 그 걸음으로 바로 간다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    const now = root.querySelector<HTMLElement>('[data-burst-now]')!;

    const rows = [...root.querySelectorAll<HTMLElement>('[data-burst-list] .burst-row')];
    // 3번째 사이클의 3버 칸.
    rows[2]!.querySelectorAll<HTMLButtonElement>('.burst-slot')[2]!.click();

    expect(now.textContent).toContain('3回目のフルバースト');
    expect(now.textContent).toContain('3バ');
    // 지금 서 있는 칸에 표시가 붙는다.
    const here = root.querySelectorAll('[data-burst-list] .burst-slot.is-here');
    expect(here).toHaveLength(1);
  });

  it('버스트 순서 단추는 덱 비우기와 다른 옷을 입고, 걸어 두면 색이 바뀐다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    const open = root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!;
    // 파괴 단추(덱 비우기)와 같은 옷을 입고 있어 눈에 안 띄던 것을 뗐다.
    expect(open.classList.contains('deck-clear')).toBe(false);
    expect(open.classList.contains('burst-order-open')).toBe(true);
    expect(open.classList.contains('is-on')).toBe(false);

    open.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-burst-order-save]')!.click();
    expect(open.classList.contains('is-on')).toBe(true);
  });

  it('← 로 한 칸 되돌리고 0으로 자동으로 되돌린다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    const now = root.querySelector<HTMLElement>('[data-burst-now]')!;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(now.textContent).toContain('2バ');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(now.textContent).toContain('1バ');
    expect(now.textContent).not.toContain('→ 自動');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(now.textContent).toContain('→ 自動');
  });

  it('순서를 지우면 덱에서 사라지고 배지도 내려간다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-burst-order-save]')!.click();

    root.querySelector<HTMLButtonElement>('[data-burst-order-open]')!.click();
    root.querySelector<HTMLButtonElement>('[data-burst-order-clear]')!.click();

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ burstSequence?: unknown }> };
    expect(saved.decks[0]!.burstSequence).toBeUndefined();
    expect(root.querySelector<HTMLElement>('[data-burst-order-badge]')!.hidden).toBe(true);
  });

  it('창이 닫혀 있으면 단축키를 가져가지 않는다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });
    // 창을 열지 않은 채 A를 눌러도 아무 일이 없어야 한다 — 검색칸과 부딪치면 안 된다.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1') ?? '{"decks":[{}]}') as
      { decks: Array<{ burstSequence?: unknown }> };
    expect(saved.decks[0]!.burstSequence).toBeUndefined();
  });

  it('적 수치를 초기화하면 조건 한 줄도 함께 바뀐다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    });

    const summary = root.querySelector<HTMLElement>('[data-battle-summary]')!;
    const def = root.querySelector<HTMLInputElement>('#enemy-def')!;
    const code = root.querySelector<HTMLSelectElement>('#enemy-code')!;
    const parts = root.querySelector<HTMLInputElement>('#has-parts')!;

    def.value = '99999'; def.dispatchEvent(new Event('change', { bubbles: true }));
    code.value = '작열'; code.dispatchEvent(new Event('change', { bubbles: true }));
    parts.checked = true; parts.dispatchEvent(new Event('change', { bubbles: true }));
    expect(summary.textContent).toContain('灼熱');
    expect(summary.textContent).toContain('パーツ');

    root.querySelector<HTMLButtonElement>('[data-reset-enemy]')!.click();

    expect(def.value).toBe('31784');
    expect(code.value).toBe('');
    expect(parts.checked).toBe(false);
    // 전투 조건이 창으로 들어간 뒤로 이 한 줄이 화면에 남는 유일한 표시다 —
    // 값만 되돌리고 줄을 그대로 두면 «초기화가 안 된다»로 보인다.
    expect(summary.textContent).not.toContain('灼熱');
    expect(summary.textContent).not.toContain('パーツ');
    expect(summary.textContent).toContain('無属性');
  });

  it('CSV を取り込み直すと編成中のキャラの育成値が更新され、操作設定は残る', async () => {
    // 以前は「まだ設定を持たないキャラだけ」を埋めていたので、一度編成に入れたキャラは
    // 取り込み直しても古い育成値のままだった。かといって丸ごと上書きすると手で決めた
    // 速射・バースト運用が毎回消える。項目単位で混ぜる規則 (roster-merge.ts) の配線を固定する。
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // 枠に置いてから、そのキャラの操作 (バースト運用) を手で決める
    chooseCharacter(root, 0, '리타');
    root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!.click();
    const burst = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    burst.value = 'skip';
    burst.dispatchEvent(new Event('change'));
    expect(root.querySelector('.control-chip-text')!.textContent).toContain('バースト使わない');

    const header = [
      '이름', '돌파', '코강', '스킬1', '스킬2', '버스트스킬',
      '우코(%)', '공증(%)', '방어(%)', '장탄(%)', '크확(%)', '크댐(%)', '차속(%)', '차댐(%)', '명중(%)',
      '머리_레벨', '몸통_레벨', '장갑_레벨', '다리_레벨',
    ].join(',');
    const row = ['리타', '3', '4', '10', '10', '10',
      '50', '30', '0', '0', '0', '0', '0', '0', '0', '5', '5', '5', '5'].join(',');

    const input = root.querySelector<HTMLInputElement>('#roster-csv')!;
    Object.defineProperty(input, 'files', {
      value: [new File([`${header}\n${row}`], 'roster.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(root.querySelector('[data-roster-note]')!.textContent).toContain('育成値を更新');
    });

    // 育成は取込値に (돌파3 + 코강4 = 7)
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ characters: Record<string, { growthStage?: number; burst?: { mode: string } }> }> };
    const mine = saved.decks[0]!.characters['리타']!;
    expect(mine.growthStage).toBe(7);
    // 操作は手で決めたまま
    expect(mine.burst).toEqual({ mode: 'skip' });
    expect(root.querySelector('.control-chip-text')!.textContent).toContain('バースト使わない');
  });

  it('取込前は最終取込の表示を出さない', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    expect(root.querySelector<HTMLElement>('[data-sync-box]')!.hidden).toBe(true);
  });

  it('CSV 取込のあとは最終取込を出すが、取り込み直すボタンは出さない (ファイルを選び直す必要がある)', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    const header = [
      '이름', '돌파', '코강', '스킬1', '스킬2', '버스트스킬',
      '우코(%)', '공증(%)', '방어(%)', '장탄(%)', '크확(%)', '크댐(%)', '차속(%)', '차댐(%)', '명중(%)',
      '머리_레벨', '몸통_레벨', '장갑_레벨', '다리_레벨',
    ].join(',');
    const row = ['리타', '3', '4', '10', '10', '10',
      '0', '0', '0', '0', '0', '0', '0', '0', '0', '5', '5', '5', '5'].join(',');
    const input = root.querySelector<HTMLInputElement>('#roster-csv')!;
    Object.defineProperty(input, 'files', {
      value: [new File([`${header}\n${row}`], 'roster.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(root.querySelector<HTMLElement>('[data-sync-box]')!.hidden).toBe(false);
    });
    expect(root.querySelector('[data-sync-when]')!.textContent).toContain('最終取込 CSV');
    expect(root.querySelector('[data-sync-when]')!.textContent).toContain('1名');
    // CSV はアドレスを持たないので取り直せない
    expect(root.querySelector<HTMLElement>('[data-sync-again]')!.hidden).toBe(true);

    // 記録はこのブラウザに残り、次回の起動でも読み出せる
    const saved = JSON.parse(localStorage.getItem('nikke-sync-v1')!) as { source: string; matched: number };
    expect(saved.source).toBe('csv');
    expect(saved.matched).toBe(1);
  });

  it('保存された取込記録を起動時に読み、Blablalink なら取り込み直すボタンを出す', () => {
    localStorage.setItem('nikke-sync-v1', JSON.stringify({
      schemaVersion: 1, source: 'blablalink', at: new Date().toISOString(),
      matched: 187, profileUrl: 'https://www.blablalink.com/user?openid=abc',
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: 'https://proxy.example',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    expect(root.querySelector<HTMLElement>('[data-sync-box]')!.hidden).toBe(false);
    expect(root.querySelector('[data-sync-when]')!.textContent).toContain('Blablalink');
    expect(root.querySelector('[data-sync-when]')!.textContent).toContain('187名');
    expect(root.querySelector<HTMLElement>('[data-sync-again]')!.hidden).toBe(false);
  });

  it('プロキシが無ければ記録があっても取り込み直すボタンは出さない', () => {
    localStorage.setItem('nikke-sync-v1', JSON.stringify({
      schemaVersion: 1, source: 'blablalink', at: new Date().toISOString(),
      matched: 187, profileUrl: 'https://www.blablalink.com/user?openid=abc',
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: '',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    expect(root.querySelector<HTMLElement>('[data-sync-box]')!.hidden).toBe(false);   // 記録は出す
    expect(root.querySelector<HTMLElement>('[data-sync-again]')!.hidden).toBe(true);  // 取り直しはできない
  });

  it('取り込み直しの失敗は画面に出る (連携の窓を開かずに押すので、窓の中だけでは見えない)', async () => {
    localStorage.setItem('nikke-sync-v1', JSON.stringify({
      schemaVersion: 1, source: 'blablalink', at: new Date().toISOString(),
      matched: 187, profileUrl: 'https://www.blablalink.com/user?openid=abc',
    }));
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: 'ログインの有効期限が切れています' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      mountCalculator(root, {
        catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
        blablaProxy: 'https://proxy.example',
      } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

      root.querySelector<HTMLButtonElement>('[data-sync-again]')!.click();
      await vi.waitFor(() => {
        expect(root.querySelector('[data-roster-note]')!.textContent).toContain('取り込みに失敗しました');
      });
      expect(root.querySelector('[data-roster-note]')!.textContent).toContain('有効期限');
      // 失敗しても押せる状態に戻る
      expect(root.querySelector<HTMLButtonElement>('[data-sync-again]')!.disabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('取り込み直しの連打で取得が二重に走らない', async () => {
    localStorage.setItem('nikke-sync-v1', JSON.stringify({
      schemaVersion: 1, source: 'blablalink', at: new Date().toISOString(),
      matched: 187, profileUrl: 'https://www.blablalink.com/user?openid=abc',
    }));
    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ error: 'もう終わり' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      mountCalculator(root, {
        catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
        blablaProxy: 'https://proxy.example',
      } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

      const again = root.querySelector<HTMLButtonElement>('[data-sync-again]')!;
      again.click();
      again.click();
      again.click();
      expect(again.disabled).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      release!();
      await vi.waitFor(() => { expect(again.disabled).toBe(false); });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('連携の窓から同期している最中は、画面の取り込み直しも受け付けない', async () => {
    // 入口が2つあるので、片方だけを止めても両方が同時に走る経路が残る。
    localStorage.setItem('nikke-sync-v1', JSON.stringify({
      schemaVersion: 1, source: 'blablalink', at: new Date().toISOString(),
      matched: 187, profileUrl: 'https://www.blablalink.com/user?openid=abc',
    }));
    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify({ error: '終わり' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      mountCalculator(root, {
        catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
        blablaProxy: 'https://proxy.example',
      } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

      // 窓の側から同期を始める
      root.querySelector<HTMLInputElement>('[data-blabla-url]')!.value = 'https://www.blablalink.com/user?openid=abc';
      root.querySelector<HTMLButtonElement>('[data-blabla-sync]')!.click();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 走っている間は画面の取り込み直しも止まっている
      const again = root.querySelector<HTMLButtonElement>('[data-sync-again]')!;
      expect(again.disabled).toBe(true);
      again.click();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      release!();
      await vi.waitFor(() => { expect(again.disabled).toBe(false); });
      expect(again.textContent).toBe('今の育成を取り込む');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('育成状況は取込前は案内を出し、取り込むと一覧と内訳が出る', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // 取込前
    expect(root.querySelector<HTMLElement>('[data-myroster-empty]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-myroster-body]')!.hidden).toBe(true);

    const header = [
      '이름', '돌파', '코강', '스킬1', '스킬2', '버스트스킬',
      '우코(%)', '공증(%)', '방어(%)', '장탄(%)', '크확(%)', '크댐(%)', '차속(%)', '차댐(%)', '명중(%)',
      '머리_레벨', '몸통_레벨', '장갑_레벨', '다리_레벨',
    ].join(',');
    const rows = [
      '"리타","3","4","10","10","10","85.8","43","0","109","0","0","0","0","0","5","5","5","5"',
      '"앨리스","1","0","10","4","10","0","0","0","0","0","0","0","0","0","5","5","5","5"',
    ];
    const input = root.querySelector<HTMLInputElement>('#roster-csv')!;
    Object.defineProperty(input, 'files', {
      value: [new File([[header, ...rows].join('\n')], 'roster.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(root.querySelector<HTMLElement>('[data-myroster-body]')!.hidden).toBe(false);
    });
    expect(root.querySelector<HTMLElement>('[data-myroster-empty]')!.hidden).toBe(true);

    // 内訳: 所持2体・スキル満は 리타 だけ
    const stats = root.querySelector('[data-myroster-stats]')!.textContent!;
    expect(stats).toContain('2体');
    expect(stats).toContain('所持');

    // 一覧: 日本語表示名・コード・突破・スキル (合計と最低)
    const cells = [...root.querySelectorAll('[data-myroster-rows] tr')]
      .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(cells).toHaveLength(2);
    const rita = cells.find((row) => row[0] === '리타')!;   // 表示名辞書が無い環境では内部キーのまま
    expect(rita[3]).toBe('7');                              // 돌파3 + 코강4
    expect(rita[4]).toBe('30 (最低 10)');
    const alice = cells.find((row) => row[0] === '앨리스')!;
    expect(alice[4]).toBe('24 (最低 4)');                   // 1つだけ低いのが見える
  });

  it('育成状況の並べ替えを切り替えられる', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    const header = ['이름', '돌파', '코강'].join(',');
    const input = root.querySelector<HTMLInputElement>('#roster-csv')!;
    Object.defineProperty(input, 'files', {
      value: [new File([[header, '"리타","0","0"', '"앨리스","3","5"'].join('\n')], 'r.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(root.querySelectorAll('[data-myroster-rows] tr')).toHaveLength(2);
    });

    const names = () => [...root.querySelectorAll('[data-myroster-rows] tr td:first-child')]
      .map((td) => td.textContent);
    const sort = root.querySelector<HTMLSelectElement>('[data-myroster-sort]')!;
    sort.value = 'growth';
    sort.dispatchEvent(new Event('change'));
    expect(names()).toEqual(['앨리스', '리타']);   // 突破 8 → 0
  });

  it('属性別編成は5属性ぶん出て、向き先のボスコードを添える', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    const groups = [...root.querySelectorAll<HTMLElement>('[data-plans-group]')];
    expect(groups.map((g) => g.dataset.plansGroup)).toEqual(['작열', '수냉', '풍압', '전격', '철갑']);
    // 電撃編成は水冷ボス向け (エンジンの有利コード表どおり)
    const denki = groups.find((g) => g.dataset.plansGroup === '전격')!;
    expect(denki.querySelector('.plans-against')!.textContent).toBe('水冷ボス向け');
    expect(denki.querySelector('.plans-empty')).not.toBeNull();
  });

  it('今の編成を保存し、3案までで打ち止め、消せる', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    const groupOf = (code: string) =>
      root.querySelector<HTMLElement>(`[data-plans-group="${code}"]`)!;
    const saveIn = (code: string) =>
      groupOf(code).querySelector<HTMLButtonElement>(`[data-plans-save="${code}"]`)!.click();

    // 空の編成は保存しない (既定の編成が入っているので、まず全部外す)
    for (let slot = 0; slot < 5; slot += 1) clearCharacterSlot(root, slot);
    saveIn('전격');
    expect(groupOf('전격').querySelector('[data-plans-note]')!.textContent).toContain('空です');

    chooseCharacter(root, 0, '리타');
    saveIn('전격');
    expect(groupOf('전격').querySelectorAll('[data-plans-row]')).toHaveLength(1);

    // 同じ顔ぶれは足さない
    saveIn('전격');
    expect(groupOf('전격').querySelector('[data-plans-note]')!.textContent).toContain('同じ顔ぶれ');
    expect(groupOf('전격').querySelectorAll('[data-plans-row]')).toHaveLength(1);

    // 3案で打ち止め
    chooseCharacter(root, 1, '크라운');
    saveIn('전격');
    chooseCharacter(root, 2, '앨리스');
    saveIn('전격');
    expect(groupOf('전격').querySelectorAll('[data-plans-row]')).toHaveLength(3);
    chooseCharacter(root, 3, '나가');
    saveIn('전격');
    expect(groupOf('전격').querySelector('[data-plans-note]')!.textContent).toContain('3 候補あります');
    expect(groupOf('전격').querySelectorAll('[data-plans-row]')).toHaveLength(3);

    // 保存はこのブラウザに残る
    const stored = JSON.parse(localStorage.getItem('nikke-plans-v1')!) as
      { byElement: Record<string, unknown[]> };
    expect(stored.byElement['전격']).toHaveLength(3);

    // 消せる
    groupOf('전격').querySelector<HTMLButtonElement>('[data-plans-remove]')!.click();
    expect(groupOf('전격').querySelectorAll('[data-plans-row]')).toHaveLength(2);
  });

  it('保存した案を計算機のデッキに戻せる', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // 既定の編成が入っているので、まず空にしてから狙った2人を置く
    for (let slot = 0; slot < 5; slot += 1) clearCharacterSlot(root, slot);
    chooseCharacter(root, 0, '리타');
    chooseCharacter(root, 1, '크라운');
    root.querySelector<HTMLButtonElement>('[data-plans-save="철갑"]')!.click();

    // 計算機側を別の編成にしてから戻す
    for (let slot = 0; slot < 5; slot += 1) clearCharacterSlot(root, slot);
    chooseCharacter(root, 0, '앨리스');
    root.querySelector<HTMLButtonElement>('[data-plans-apply]')!.click();

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ squad: string[] }> };
    expect(saved.decks[0]!.squad.filter(Boolean).sort()).toEqual(['리타', '크라운'].sort());
  });

  // ── 3凸ボード ──
  const boardSlot = (index: number) => root.querySelector<HTMLElement>(`[data-board-slot="${index}"]`)!;
  const pickBoss = (index: number, boss: string) => {
    const select = root.querySelector<HTMLSelectElement>(`[data-board-boss="${index}"]`)!;
    select.value = boss;
    select.dispatchEvent(new Event('change'));
  };
  /** 属性別編成に案を置く: 計算機で編成してから「今の編成を保存」。 */
  const savePlan = (code: string, names: string[]) => {
    for (let slot = 0; slot < 5; slot += 1) clearCharacterSlot(root, slot);
    names.forEach((name, index) => chooseCharacter(root, index, name));
    root.querySelector<HTMLButtonElement>(`[data-plans-save="${code}"]`)!.click();
  };
  const boardSummary = () => root.querySelector('[data-board-summary]')!.textContent ?? '';
  const storedBoard = () => JSON.parse(localStorage.getItem('nikke-raid-board-v1')!) as
    { slots: Array<{ boss: string | null; squad: string[] }> };
  const settle = async () => { await flush(); await flush(); await flush(); };
  /**
   * 盤面が出した計算の数。計算機には**バフ対象を先読みする背景計算** (setTimeout) があり、
   * 遅い環境ではテストの途中で発火して `simulateCalls` を 1 つ増やす。盤面の計算は必ず
   * ボスのコードを持つので、それで見分ける (先読みは条件パネルの敵コード = 空)。
   */
  const boardCalls = (client: FakeClient, code = '전격') =>
    client.requests.filter((request) => request.enemyCode === code).length;

  // ── 取り込みの導線 (STEP 1 → 3凸) ──
  const boardStart = () => root.querySelector<HTMLElement>('[data-board-start]')!;
  const boardMain = () => root.querySelector<HTMLElement>('[data-board-main]')!;
  const boardSync = () => root.querySelector<HTMLElement>('[data-board-sync]')!;
  const CSV_HEADER = [
    '이름', '돌파', '코강', '스킬1', '스킬2', '버스트스킬',
    '우코(%)', '공증(%)', '방어(%)', '장탄(%)', '크확(%)', '크댐(%)', '차속(%)', '차댐(%)', '명중(%)',
    '머리_레벨', '몸통_레벨', '장갑_레벨', '다리_레벨',
  ].join(',');
  const CSV_ROW = ['리타', '3', '4', '10', '10', '10',
    '50', '30', '0', '0', '0', '0', '0', '0', '0', '5', '5', '5', '5'].join(',');
  const dropCsv = (selector: string) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    Object.defineProperty(input, 'files', {
      value: [new File([`${CSV_HEADER}\n${CSV_ROW}`], 'roster.csv', { type: 'text/csv' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
  };

  it('取り込む前は STEP 1 だけを見せ、盤面は出さない', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    expect(boardStart().hidden).toBe(false);
    expect(boardMain().hidden).toBe(true);
  });

  it('「取り込まずに試す」で盤面が出て、次に開いたときも出たまま', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();

    expect(boardStart().hidden).toBe(true);
    expect(boardMain().hidden).toBe(false);

    // 覚えているので、開き直しても STEP 1 は出てこない
    root.innerHTML = '';
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    expect(boardStart().hidden).toBe(true);
  });

  it('STEP 1 の CSV から取り込むと盤面に進み、取り込み直せる', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    dropCsv('#board-csv');
    await vi.waitFor(() => {
      expect(root.querySelector('[data-board-sync-main]')!.textContent).toContain('取込済み');
    });
    expect(boardStart().hidden).toBe(true);
    expect(boardMain().hidden).toBe(false);

    // 入れ直したくなったら STEP 1 に戻れる (別タブへ飛ばさない)
    const reimport = root.querySelector<HTMLButtonElement>('[data-board-sync-import]')!;
    expect(reimport.hidden).toBe(false);
    reimport.click();
    expect(boardStart().hidden).toBe(false);
    // STEP 1 を出している間は帯を出さない — 同じことを二度言わせない
    expect(boardSync().hidden).toBe(true);
    expect(boardMain().hidden).toBe(true);

    // 取り込み直すと STEP 1 が閉じ、帯が戻る
    dropCsv('#board-csv');
    await vi.waitFor(() => { expect(boardStart().hidden).toBe(true); });
    expect(boardSync().hidden).toBe(false);
    expect(boardMain().hidden).toBe(false);
  });

  it('「取り込み直す」で開いた STEP 1 からも「取り込まずに試す」で出られる', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    dropCsv('#board-csv');
    await vi.waitFor(() => { expect(boardStart().hidden).toBe(true); });
    root.querySelector<HTMLButtonElement>('[data-board-sync-import]')!.click();
    expect(boardStart().hidden).toBe(false);

    // ここで «やっぱりやめる» ができないと STEP 1 から出られなくなる
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    expect(boardStart().hidden).toBe(true);
    expect(boardMain().hidden).toBe(false);
  });

  it('プロキシが無くても「自分のブラウザで取り込む」道が STEP 1 に出ている', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: '',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    const scan = root.querySelector<HTMLDetailsElement>('[data-board-scan]')!;
    expect(scan).not.toBeNull();
    // プロキシが無いときは畳まずに開いておく (これが唯一の Blablalink 経路になるため)
    expect(scan.open).toBe(true);
    // 貼らせるコードは画面に出す — 読ませずに貼らせない
    expect(root.querySelector<HTMLTextAreaElement>('[data-board-scan-code]')!.value)
      .toContain('api.blablalink.com');
    expect(scan.textContent).toContain('他所で配られた似たコードは絶対に貼らないでください');
  });

  it('貼り付けが正しくないときは、貼り直せる言い方で断る', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    const paste = root.querySelector<HTMLTextAreaElement>('[data-board-scan-paste]')!;
    const status = root.querySelector<HTMLElement>('[data-board-scan-status]')!;
    const run = root.querySelector<HTMLButtonElement>('[data-board-scan-import]')!;

    run.click();
    await vi.waitFor(() => { expect(status.textContent).toContain('空です'); });

    // ユニオン名簿を貼ったときは «何が違うか» を言う
    paste.value = JSON.stringify({ v: 1, members: [{ name: 'a' }] });
    run.click();
    await vi.waitFor(() => { expect(status.textContent).toContain('ユニオン名簿'); });

    // 形は正しいが計算機が扱えるニケが居ない → 取込処理まで届いていることの証明
    paste.value = JSON.stringify({
      profile: { openid: '123456', areas: [{ area: 81, characters: [{ name_code: 999999 }], details: [] }] },
    });
    run.click();
    await vi.waitFor(() => { expect(status.textContent).toContain('見つかりませんでした'); });
    // 失敗しても STEP 1 に留まる (盤面へ進めない)
    expect(boardStart().hidden).toBe(false);
  });

  it('STEP 1 と帯は同時に出ない', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    expect(boardStart().hidden).toBe(false);
    expect(boardSync().hidden).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    expect(boardStart().hidden).toBe(true);
    expect(boardSync().hidden).toBe(false);
  });

  it('CSV の取り込みはキーボードで押せるボタンから開く', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // label + hidden な input はキーボードで到達できないので、押せるボタンから開く
    const opensPicker = (open: HTMLButtonElement, input: HTMLInputElement) => {
      expect(open.tagName).toBe('BUTTON');
      let opened = 0;
      input.click = () => { opened += 1; };
      open.click();
      return opened;
    };

    expect(opensPicker(
      root.querySelector<HTMLButtonElement>('[data-board-csv-open]')!,
      root.querySelector<HTMLInputElement>('#board-csv')!,
    )).toBe(1);
    expect(opensPicker(
      root.querySelector<HTMLButtonElement>('[data-roster-csv-open]')!,
      root.querySelector<HTMLInputElement>('#roster-csv')!,
    )).toBe(1);
  });

  it('プロキシが無いビルドでは、存在しないボタンを案内しない', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: '',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    expect(boardStart().textContent).toContain('まだ使えません');
    expect(root.querySelector('[data-board-blabla]')).toBeNull();
    // 育成状況の空状態も «Blablalink 連携» を名指ししない
    expect(root.querySelector('[data-myroster-empty]')!.textContent).not.toContain('Blablalink 連携');
  });

  it('プロキシがあるビルドでは、リンク → 貼り付けの順で案内する', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: 'https://proxy.example',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    const link = boardStart().querySelector<HTMLAnchorElement>('a[href*="blablalink.com/user"]')!;
    expect(link).not.toBeNull();
    expect(link.target).toBe('_blank');

    // 「アドレスを貼って取り込む」で既存のモーダルが開く (処理を二重に持たない)
    root.querySelector<HTMLButtonElement>('[data-board-blabla]')!.click();
    expect(root.querySelector<HTMLElement>('[data-blabla-modal]')!.hidden).toBe(false);
  });

  it('育成状況の空状態から取り込みに進める', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    root.querySelector<HTMLButtonElement>('[data-view-tab="roster"]')!.click();

    root.querySelector<HTMLButtonElement>('[data-myroster-goto-board]')!.click();

    expect(root.querySelector<HTMLElement>('[data-view="board"]')!.hidden).toBe(false);
    expect(boardStart().hidden).toBe(false);
  });

  it('枠の中で編成を組める (他のタブへ行かなくてよい)', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    pickBoss(0, 'レイタンス');

    // 一度開けば、選んでも開いたまま — 5人を続けて選べる
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-pick="리타"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-pick="크라운"]')!.click();

    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual(['리타', '크라운']);
    // 表示名はテスト用カタログに displayName が無いので内部キーのまま出る (本番は日本語)
    expect(boardSlot(0).textContent).toContain('리타');
  });

  it('他の凸で使っているニケは、選ぶ時点で押せない', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    pickBoss(0, 'レイタンス');
    pickBoss(1, 'トゥームストーン');

    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-pick="리타"]')!.click();

    // 2凸目を開くと、1凸目で使ったリターは選べない
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="1"]')!.click();
    const taken = root.querySelector<HTMLButtonElement>('[data-board-pick="리타"]')!;
    expect(taken.disabled).toBe(true);
    expect(taken.title).toContain('1凸目');
    // 使っていない人は選べる
    expect(root.querySelector<HTMLButtonElement>('[data-board-pick="크라운"]')!.disabled).toBe(false);
  });

  it('ボスに有利なコードのニケが先に並ぶ', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    // レイタンス = 電撃 → 有利なのは 철갑 (鉄甲)
    pickBoss(0, 'レイタンス');
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();

    const names = [...root.querySelectorAll<HTMLElement>('[data-board-pick]')]
      .map((cell) => cell.dataset.boardPick!);
    const ironAt = names.findIndex((n) => n === '리타' || n === '크라운');   // 철갑
    const otherAt = names.findIndex((n) => n === '앨리스');                   // 수냉
    expect(ironAt).toBeGreaterThanOrEqual(0);
    expect(ironAt).toBeLessThan(otherAt);
    // 有利なものには印が付く
    expect(root.querySelector('[data-board-pick="리타"]')!.classList.contains('is-counter')).toBe(true);
    expect(root.querySelector('[data-board-pick="앨리스"]')!.classList.contains('is-counter')).toBe(false);
  });

  it('バーストが欠けていると、選んでいる最中に分かる', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    pickBoss(0, 'レイタンス');
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();

    root.querySelector<HTMLButtonElement>('[data-board-pick="리타"]')!.click();   // B1
    const note = () => root.querySelector('[data-board-picker-burst="0"]')!.textContent ?? '';
    expect(note()).toContain('B1 1');
    expect(note()).toContain('B2・B3 がいません');

    root.querySelector<HTMLButtonElement>('[data-board-pick="크라운"]')!.click();  // B2
    root.querySelector<HTMLButtonElement>('[data-board-pick="앨리스"]')!.click();  // B3
    expect(note()).not.toContain('がいません');
  });

  it('★ を付けたニケが先に並び、お気に入りだけに絞れる', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    pickBoss(0, 'レイタンス');
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();

    // 有利コードではない (= 本来なら後ろの) ニケに印を付ける
    root.querySelector<HTMLElement>('[data-board-fav="앨리스"]')!.click();
    const first = root.querySelector<HTMLElement>('[data-board-pick]')!.dataset.boardPick;
    expect(first).toBe('앨리스');
    expect(JSON.parse(localStorage.getItem('nikke-favorites-v1')!)).toEqual(['앨리스']);

    // 絞り込むと印を付けた人だけになる
    root.querySelector<HTMLButtonElement>('[data-board-picker-fav-only]')!.click();
    const shown = [...root.querySelectorAll<HTMLElement>('[data-board-pick]')]
      .map((cell) => cell.dataset.boardPick);
    expect(shown).toEqual(['앨리스']);
  });

  it('候補を加えて、まとめて計算して比べられる', async () => {
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    pickBoss(0, 'レイタンス');

    // 1つ目の候補を組んで加える
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();
    for (const name of ['리타', '크라운', '앨리스', '나가', '프리바티']) {
      root.querySelector<HTMLButtonElement>(`[data-board-pick="${name}"]`)!.click();
    }
    root.querySelector<HTMLButtonElement>('[data-board-change="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-compare-add="0"]')!.click();

    expect(root.querySelector('[data-board-chooser="0"]')!.textContent).toContain('候補を比べる');
    // 候補が1件だけなら «ぜんぶ計算» は出さない (比べる相手がいない)
    expect(root.querySelector('[data-board-compare-run="0"]')).toBeNull();
  });

  it('盤面で候補を比べると結果が登録され、弱い候補はその場で消せる', async () => {
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);
    savePlan('철갑', ['앨리스', '나가']);
    pickBoss(0, 'レイタンス');
    await settle();
    root.querySelector<HTMLButtonElement>('[data-board-change="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-compare-run="0"]')!.click();
    await settle();
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('結果を登録しました');
    const stored = () => (JSON.parse(localStorage.getItem('nikke-plans-v1')!) as {
      byElement: Record<string, Array<{ id: string; registered?: { damage: number } }>>;
    }).byElement['철갑']!;
    expect(stored().every((plan) => plan.registered?.damage === 123_456)).toBe(true);

    // 候補をその場で消せる (枠の編成はそのまま)
    const drop = root.querySelectorAll<HTMLButtonElement>('[data-board-candidate-drop]');
    expect(drop).toHaveLength(2);
    drop[1]!.click();
    expect(stored()).toHaveLength(1);
    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual(['리타', '크라운']);
  });

  it('候補の比較中に戦闘条件を変えても、登録は最初の条件で一貫する', async () => {
    // 止めたいときだけ計算を止められる計算機 — 「比較の計算中にユーザーが条件パネルを触る」状況を作る
    class GatedClient extends FakeClient {
      hold = false;
      pending: Array<() => void> = [];
      release() { for (const resolve of this.pending.splice(0)) resolve(); }
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        if (this.hold) await new Promise<void>((resolve) => { this.pending.push(resolve); });
        return super.simulate(request);
      }
    }
    const client = new GatedClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);
    savePlan('철갑', ['앨리스', '나가']);
    pickBoss(0, 'レイタンス');   // ここは普通に計算させる (busy を解いて盤面を操作可能に)
    await settle();
    client.hold = true;          // ここから先の計算を止める
    root.querySelector<HTMLButtonElement>('[data-board-change="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-compare-run="0"]')!.click();
    await flush();
    // 計算中に戦闘時間を 180 → 90 に変える
    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    duration.value = '90';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    client.release();
    await settle();

    expect(root.querySelector('[data-board-status]')!.textContent).toContain('結果を登録しました');
    const stored = (JSON.parse(localStorage.getItem('nikke-plans-v1')!) as {
      byElement: Record<string, Array<{ registered?: { damage: number; duration: number } }>>;
    }).byElement['철갑']!;
    // 両候補とも登録され、登録の条件は**開始時の 180秒** (途中の変更が混ざらない)
    expect(stored.every((plan) => plan.registered?.damage === 123_456)).toBe(true);
    expect(stored.map((plan) => plan.registered!.duration)).toEqual([180, 180]);
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('戦闘 180秒');
  });

  it('入れたニケは枠から外せる', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    root.querySelector<HTMLButtonElement>('[data-board-skip]')!.click();
    pickBoss(0, 'レイタンス');
    root.querySelector<HTMLButtonElement>('[data-board-pick-open="0"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-board-pick="리타"]')!.click();

    root.querySelector<HTMLButtonElement>('[data-board-picker-drop="0:0"]')!.click();
    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual([]);
  });

  it('3凸ボードが入口で、3枠・合計・属性別の手持ちが出る', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    expect(root.querySelectorAll('[data-board-slot]')).toHaveLength(3);
    expect(root.querySelectorAll('[data-board-stock]')).toHaveLength(5);
    expect(boardSlot(0).querySelector('.board-dmg-note')!.textContent).toContain('ボスを選ぶと');
    expect(boardSummary()).toContain('使用 0名');
    // 取込前の帯
    expect(root.querySelector('[data-board-sync-main]')!.textContent).toContain('まだ');
    // 空き枠には「残りで探す」だけ
    expect(boardSlot(2).querySelector('[data-board-search-open]')).not.toBeNull();
  });

  it('ボスを選ぶと有利コードの案が入り、その枠が計算されて保存される', async () => {
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // レイタンス (電撃) には鉄甲の案 (エンジンの有利コード表どおり)
    savePlan('철갑', ['리타', '크라운']);
    pickBoss(0, 'レイタンス');
    await settle();

    const slot = boardSlot(0);
    expect(slot.classList.contains('is-iron')).toBe(true);
    expect([...slot.querySelectorAll('.board-team .board-who')].map((chip) => chip.textContent))
      .toEqual(['리타', '크라운']);
    expect(boardCalls(client)).toBe(1);
    expect(slot.querySelector('[data-board-score]')!.textContent).toContain('123,456');
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('計算しました');
    expect(boardSummary()).toContain('使用 2名');
    expect(storedBoard().slots[0]!.boss).toBe('レイタンス');
    // 属性別の手持ちにも同じ点数が載る
    expect(root.querySelector('[data-board-stock="철갑"]')!.textContent).toContain('123,456');

    // 案が無いボスは入れられないことを伝える
    pickBoss(1, 'モダニア');
    await settle();
    // 案が無くても «この枠の編成を組む» で直接選べるので、そちらへ案内する
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('この枠の編成を組む');
    expect(boardCalls(client)).toBe(1);
    expect(boardCalls(client, '풍압')).toBe(0);
  });

  it('同じニケを2枠で使うと被りとして出て、解くと損の少ない側から外れる', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);     // レイタンス向け
    savePlan('수냉', ['앨리스', '크라운']);   // トゥームストーン (灼熱) 向け
    pickBoss(0, 'レイタンス');
    await settle();
    pickBoss(1, 'トゥームストーン');
    await settle();

    const clash = root.querySelector<HTMLElement>('[data-board-clash="1:0"]')!;
    expect(clash.textContent).toContain('크라운');
    expect(clash.textContent).toContain('1凸目でも使っています');
    expect(root.querySelectorAll('.board-team .board-who.is-clash')).toHaveLength(2);
    expect(boardSummary()).toContain('被り 1件');
    expect(root.querySelector('[data-board-used] .board-who.is-clash')!.textContent).toContain('1凸 / 2凸');

    clash.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(root.querySelector('[data-board-clash]')).toBeNull();
    expect(boardSummary()).toContain('被り 0件');
    // 点数が同じ (試験の計算機は常に同じ値) なので「こちら (2凸目) から外す」が選ばれる
    expect(storedBoard().slots[1]!.squad.filter(Boolean)).toEqual(['앨리스']);
    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual(['리타', '크라운']);
  });

  it('全員が被る枠を解くと、空になった枠はボスごと空に戻る', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // 同じ顔ぶれを鉄甲 (レイタンス向け) と水冷 (トゥームストーン向け) の両方に保存 → 2枠で全員被る
    savePlan('철갑', ['리타', '크라운']);
    savePlan('수냉', ['리타', '크라운']);
    pickBoss(0, 'レイタンス');
    await settle();
    pickBoss(1, 'トゥームストーン');
    await settle();
    const clash = root.querySelector<HTMLElement>('[data-board-clash="1:0"]')!;
    expect(clash.textContent).toContain('誰も残りません');
    expect(clash.textContent).toContain('1凸目が空になります');

    clash.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    // 点数が同じなら「こちら (2凸目) から外す」→ 2凸目は空になり、ボスも外れる
    expect(storedBoard().slots[1]).toEqual({ boss: null, squad: ['', '', '', '', ''] });
    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual(['리타', '크라운']);
    expect(root.querySelector('[data-board-search-open="1"]')).not.toBeNull();
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('空になったので');
  });

  it('全員が被り、相手の枠のほうが弱ければ「譲る」— 相手の枠がボスごと空に戻る', async () => {
    // ボスのコードで点数が変わる計算機: 灼熱ボス (トゥームストーン) 向けの 2凸目のほうが強い
    class ByBossClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return { ...calculated, squadTotal: request.enemyCode === '작열' ? 200_000 : 100_000 };
      }
    }
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new ByBossClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);
    savePlan('수냉', ['리타', '크라운']);
    pickBoss(0, 'レイタンス');        // 100,000
    await settle();
    pickBoss(1, 'トゥームストーン');   // 200,000
    await settle();
    const clash = root.querySelector<HTMLElement>('[data-board-clash="1:0"]')!;
    expect(clash.textContent).toContain('合計は「1凸目から譲る」が上です');

    clash.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(storedBoard().slots[0]).toEqual({ boss: null, squad: ['', '', '', '', ''] });
    expect(storedBoard().slots[1]!.boss).toBe('トゥームストーン');
    expect(storedBoard().slots[1]!.squad.filter(Boolean)).toEqual(['리타', '크라운']);
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('1凸目から譲りました');
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('1凸目は空になったので');
    expect(root.querySelector('[data-board-search-open="0"]')).not.toBeNull();
  });

  it('被りなしで最大の3凸を探すと、同じニケを使わない組み合わせが枠に入る', async () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);
    savePlan('수냉', ['앨리스', '크라운']);   // 鉄甲案と 크라운 が被る
    savePlan('수냉', ['앨리스', '나가']);     // 被らない案
    root.querySelector<HTMLButtonElement>('[data-board-search-best]')!.click();
    await settle();

    const slots = storedBoard().slots;
    expect(slots.filter((slot) => slot.boss)).toHaveLength(2);   // 3つ目は被りなしで組めない
    expect(slots[0]!.boss).toBe('レイタンス');
    expect(slots[1]!.boss).toBe('トゥームストーン');
    expect(slots[1]!.squad.filter(Boolean)).toEqual(['앨리스', '나가']);
    expect(root.querySelector('[data-board-clash]')).toBeNull();
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('2 凸ぶん');

    // 空き枠に「残りで探す」: 全員使用済みなら入れる案が無いと伝える
    root.querySelector<HTMLButtonElement>('[data-board-search-open="2"]')!.click();
    await settle();
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('入れられる候補がありません');
    expect(storedBoard().slots[2]!.boss).toBeNull();

    // 風圧の案 (アニヒリオ向け) を足すと、使用済みの 나가 を外して残りで組む
    savePlan('풍압', ['프리바티', '나가']);
    root.querySelector<HTMLButtonElement>('[data-board-search-open="2"]')!.click();
    await settle();
    expect(storedBoard().slots[2]!.boss).toBe('アニヒリオ');
    expect(storedBoard().slots[2]!.squad.filter(Boolean)).toEqual(['프리바티']);
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('나가 は外してあります');
    expect(root.querySelector('[data-board-clash]')).toBeNull();
  });

  it('「今の編成を保存」は個別設定 (スキル等) ごと案に入り、「3案を比較」のダメージが登録として残る', async () => {
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // デッキに 리타 だけ入れ、個別設定 (スキル1 = 4) を付けてから保存
    for (let slot = 0; slot < 5; slot += 1) clearCharacterSlot(root, slot);
    chooseCharacter(root, 0, '리타');
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-plans-save="철갑"]')!.click();

    const stored = () => (JSON.parse(localStorage.getItem('nikke-plans-v1')!) as {
      byElement: Record<string, Array<{ id: string; characters?: Record<string, { skillLevels?: Record<string, number> }>;
        registered?: { damage: number; duration: number } }>>;
    }).byElement['철갑']![0]!;
    expect(stored().characters!['리타']!.skillLevels!['1']).toBe(4);
    expect(root.querySelector('.plans-chip.is-snapshot')).not.toBeNull();

    // 比較 → スナップショットで計算し、結果が登録される
    root.querySelector<HTMLButtonElement>('[data-plans-compare="철갑"]')!.click();
    await settle();
    expect(client.lastRequest!.characters!['리타']!.skillLevels!['1']).toBe(4);
    expect(stored().registered!.damage).toBe(123_456);
    expect(stored().registered!.duration).toBe(180);

    // 再読込 (再マウント) しても登録値が出る。結果キャッシュを消し、登録値でしか出せない状態にする
    localStorage.removeItem('nikke-calc-results');
    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);
    const cell = root.querySelector<HTMLElement>('[data-plans-score]')!;
    expect(cell.textContent).toContain('123,456');
    expect(cell.textContent).toContain('登録');
    // 盤面の在庫にも出るが、今の条件の値ではないので「登録値」の印つき
    const stock = root.querySelector<HTMLElement>('[data-board-stock="철갑"]')!;
    expect(stock.textContent).toContain('123,456');
    expect(stock.textContent).toContain('登録値');
  });

  it('枠に入れた案のスナップショット (キューブ) が盤面の計算リクエストに届く', async () => {
    localStorage.setItem('nikke-plans-v1', JSON.stringify({
      schemaVersion: 1,
      byElement: {
        철갑: [{
          id: 'p1', squad: ['리타', '', '', '', ''], savedAt: '2026-09-02T00:00:00.000Z',
          characters: { 리타: { cube: { name: '재장', level: 15 } } },
        }],
      },
    }));
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    pickBoss(0, 'レイタンス');
    await settle();
    expect(boardCalls(client)).toBe(1);
    expect(client.lastRequest!.characters!['리타']!.cube!.name).toBe('재장');
    // 枠にもスナップショットが残る (保存 → 読み直しでも運ばれる)
    expect((JSON.parse(localStorage.getItem('nikke-raid-board-v1')!) as {
      slots: Array<{ characters?: Record<string, unknown> }>;
    }).slots[0]!.characters!['리타']).toBeTruthy();

    // 「詳細計算へ」でデッキにもキューブが載る — 盤面と計算機で同じ設定から数字が出る
    root.querySelector<HTMLButtonElement>('[data-board-open-calc="0"]')!.click();
    const deckState = JSON.parse(localStorage.getItem('nikke-state-v1')!) as {
      decks: Array<{ squad: string[]; characters: Record<string, { cube?: { name: string } }> }>;
    };
    expect(deckState.decks[0]!.squad.filter(Boolean)).toEqual(['리타']);
    expect(deckState.decks[0]!.characters['리타']!.cube!.name).toBe('재장');
  });

  it('「計算機に入れる」はスナップショット外のメンバーの古い手直しを引き継がない', async () => {
    // 案: 리타 (キューブのスナップショットあり) + 크라운 (スナップショットなし)
    localStorage.setItem('nikke-plans-v1', JSON.stringify({
      schemaVersion: 1,
      byElement: {
        철갑: [{
          id: 'p1', squad: ['리타', '크라운', '', '', ''], savedAt: '2026-09-02T00:00:00.000Z',
          characters: { 리타: { cube: { name: '재장', level: 15 } } },
        }],
      },
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // デッキ側で 크라운 に手直し (スキル1 = 4) を付けておく
    const card = root.querySelectorAll<HTMLElement>('[data-slot-card]')[1]!;
    expect(card.textContent).toContain('크라운');
    const toggle = card.querySelector<HTMLInputElement>('[data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const skillOne = card.querySelector<HTMLSelectElement>('[data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-plans-apply="p1"]')!.click();
    const state = JSON.parse(localStorage.getItem('nikke-state-v1')!) as {
      decks: Array<{ characters: Record<string, { cube?: { name: string }; skillLevels?: Record<string, number> }> }>;
    };
    // 리타 はスナップショットのキューブ、크라운 は古い手直しが残らない (ロスターも無いので個別設定なし)
    expect(state.decks[0]!.characters['리타']!.cube!.name).toBe('재장');
    expect(state.decks[0]!.characters['크라운']).toBeUndefined();
  });

  it('属性を3つ選ぶ (同属性2回可) と、被りなしで理論値合計が最大の3凸が入る', async () => {
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    // 水冷に2案 (顔ぶれは別)、灼熱に1案
    savePlan('수냉', ['앨리스', '크라운']);
    savePlan('수냉', ['프리바티', '나가']);
    savePlan('작열', ['라피 : 레드 후드']);

    const pick = (at: number, code: string) => {
      const select = root.querySelector<HTMLSelectElement>(`[data-board-element="${at}"]`)!;
      select.value = code;
    };
    pick(0, '수냉');
    pick(1, '수냉');
    pick(2, '작열');
    root.querySelector<HTMLButtonElement>('[data-board-elements-run]')!.click();
    await settle();

    const slots = storedBoard().slots;
    // 水冷×2 は別の案で埋まり (トゥームストーン)、灼熱はモダニア
    expect(slots.map((slot) => slot.boss)).toEqual(['トゥームストーン', 'トゥームストーン', 'モダニア']);
    const all = slots.flatMap((slot) => slot.squad.filter(Boolean));
    expect(new Set(all).size).toBe(all.length);   // 被りなし
    expect(root.querySelector('[data-board-clash]')).toBeNull();
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('理論値の合計');
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('370,368');   // 123,456 × 3

    // 同属性3回で候補が2つしか無ければ、3枠目は属性だけ入って空き — 他の枠は組む
    pick(2, '수냉');
    root.querySelector<HTMLButtonElement>('[data-board-elements-run]')!.click();
    await settle();
    const again = storedBoard().slots;
    expect(again[2]!.boss).toBe('トゥームストーン');
    expect(again[2]!.squad.filter(Boolean)).toEqual([]);
    expect(root.querySelector('[data-board-status]')!.textContent).toContain('3凸目には被りなしで入れられる候補がありませんでした');
  });

  it('「編成を変える」で同じコードの別の案に差し替えられ、「詳細計算へ」で計算機に載る', async () => {
    const client = new FakeClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);
    savePlan('철갑', ['앨리스', '나가']);
    pickBoss(0, 'レイタンス');
    await settle();
    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual(['리타', '크라운']);   // 案1

    root.querySelector<HTMLButtonElement>('[data-board-change="0"]')!.click();
    const chooser = root.querySelector<HTMLElement>('[data-board-chooser="0"]')!;
    const picks = [...chooser.querySelectorAll<HTMLButtonElement>('[data-board-pick]')];
    expect(picks).toHaveLength(2);
    expect(picks[0]!.classList.contains('is-on')).toBe(true);   // いま入っている案
    picks[1]!.click();
    await settle();
    expect(storedBoard().slots[0]!.squad.filter(Boolean)).toEqual(['앨리스', '나가']);
    expect(boardCalls(client)).toBe(2);
    expect(root.querySelector('[data-board-chooser="0"]')).toBeNull();   // 選んだら閉じる

    // 詳細計算へ: 枠の編成が計算機のデッキに、ボスの条件が条件パネルに載る
    root.querySelector<HTMLButtonElement>('[data-board-open-calc="0"]')!.click();
    expect(root.querySelector<HTMLButtonElement>('[data-view-tab="calc"]')!.classList.contains('is-on')).toBe(true);
    expect(savedSquad().filter(Boolean)).toEqual(['앨리스', '나가']);
    expect(root.querySelector<HTMLSelectElement>('#enemy-code')!.value).toBe('전격');
  });

  it('戦闘条件を変えると古い点数は「未計算」に戻り、計算し直すと新しい条件の値になる', async () => {
    // 条件によって値が変わる計算機 — 古い点数を使い回していれば見分けがつく
    class DurationClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return { ...calculated, squadTotal: request.duration * 1000 };
      }
    }
    const client = new DurationClient();
    mountCalculator(root, {
      catalog, settings, version: 'v1', client, storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    savePlan('철갑', ['리타', '크라운']);
    pickBoss(0, 'レイタンス');
    await settle();
    expect(boardSlot(0).querySelector('[data-board-score]')!.textContent).toContain('180,000');

    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    duration.value = '90';
    duration.dispatchEvent(new Event('input', { bubbles: true }));
    duration.dispatchEvent(new Event('change', { bubbles: true }));
    // 盤面を開き直すと、今の条件に合わない点数は出さない
    root.querySelector<HTMLButtonElement>('[data-view-tab="calc"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-view-tab="board"]')!.click();
    expect(boardSlot(0).querySelector('[data-board-score]')!.textContent).toContain('未計算');
    expect(boardSummary()).toContain('未計算の枠があります');

    root.querySelector<HTMLButtonElement>('[data-board-run]')!.click();
    await settle();
    expect(boardSlot(0).querySelector('[data-board-score]')!.textContent).toContain('90,000');
    expect(boardCalls(client)).toBe(2);
  });

  it('「キューブを着けていない」は保存され、再読込しても既定キューブに戻らない', () => {
    // Blablalink はキューブ未装着を明示的に出す。これを「知らないキューブ」として
    // 消すと、外したはずのキューブが取り込み直しのたびに戻る。
    localStorage.setItem('nikke-state-v1', JSON.stringify({
      decks: [{ id: 1, squad: ['리타', '', '', '', ''],
        characters: { 리타: { cube: { name: '없음', level: 0 } } } }],
      fiveDeckMode: false, activeDeckId: 1,
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!) as
      { decks: Array<{ characters: Record<string, { cube?: { name: string } }> }> };
    expect(saved.decks[0]!.characters['리타']?.cube).toEqual({ name: '없음', level: 0 });
  });

  it('「キューブを着けていない」で計算をはじかない', async () => {
    localStorage.setItem('nikke-state-v1', JSON.stringify({
      decks: [{ id: 1, squad: ['리타', '', '', '', ''],
        characters: { 리타: { cube: { name: '없음', level: 0 } } } }],
      fiveDeckMode: false, activeDeckId: 1,
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
    } as Parameters<typeof mountCalculator>[1]);

    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await flush();
    expect(root.querySelector('[data-errors]')!.textContent).not.toContain('キューブ設定');
  });

  it('블라블라링크 연동 창은 자동을 기본값으로 공식 서버 다섯 곳을 보여 준다', () => {
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      blablaProxy: 'https://proxy.example',
    } as Parameters<typeof mountCalculator>[1] & { blablaProxy: string });

    root.querySelector<HTMLButtonElement>('[data-blabla-open]')!.click();
    const server = root.querySelector<HTMLSelectElement>('[data-blabla-server]');

    expect(server).not.toBeNull();
    expect(server!.value).toBe('');
    expect([...server!.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', '自動 (所持ニケが最も多いサーバー)'],
      ['83', '韓国'],
      ['81', '日本'],
      ['84', 'グローバル'],
      ['82', '北米'],
      ['85', '東南アジア'],
    ]);
  });

  it('선택한 서버를 Worker 요청과 완료 안내에 사용한다', async () => {
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return Response.json({
        openid: '15361668407129878426',
        areas: [{
          area: 84,
          characters: [{ name_code: 5001, grade: 0, core: 0 }],
          details: [{ name_code: 5001 }],
          stateEffects: [],
          outpost: null,
        }],
      });
    });
    const blablaCatalog = catalog.map((entry) => ({
      ...entry,
      nameCode: entry.name === '리타' ? 5001 : null,
    }));
    mountCalculator(root, {
      catalog: blablaCatalog,
      settings,
      version: 'v1',
      client: new FakeClient(),
      storage: localStorage,
      blablaProxy: 'https://proxy.example',
    });

    root.querySelector<HTMLButtonElement>('[data-blabla-open]')!.click();
    const server = root.querySelector<HTMLSelectElement>('[data-blabla-server]')!;
    const url = root.querySelector<HTMLInputElement>('[data-blabla-url]')!;
    server.value = '84';
    url.value = 'https://www.blablalink.com/user?openid=15361668407129878426';
    root.querySelector<HTMLButtonElement>('[data-blabla-sync]')!.click();
    await flush();
    await flush();

    expect(sentBody).toEqual({ profileUrl: url.value, area: 84 });
    expect(root.querySelector<HTMLElement>('[data-blabla-status]')!.textContent)
      .toContain('グローバルサーバーから 1名を読み込みました。');
  });

  it('sets breakthrough from the portrait star stepper and keeps the dropdown in sync', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const stepper = root.querySelector<HTMLElement>('[data-slot-card="0"] [data-growth-stepper]')!;
    const minus = stepper.querySelector<HTMLButtonElement>('[data-growth-step="minus"]')!;
    const plus = stepper.querySelector<HTMLButtonElement>('[data-growth-step="plus"]')!;
    const filled = () => stepper.querySelectorAll('.growth-star.is-on').length;
    const core = () => stepper.querySelector('.growth-core')?.textContent ?? null;

    // 기본값 3돌: 별 3개, 진화 0. 아직 오버라이드가 없어 드롭다운도 없다.
    expect(filled()).toBe(3);
    expect(core()).toBe('0');
    expect(root.querySelector('[data-slot-card="0"] [data-growth-stage]')).toBeNull();

    // + 한 번 → 코강 1. 별 3개 + 동그라미 "1", 개별 설정 드롭다운이 생겨 값이 맞는다.
    plus.click();
    expect(filled()).toBe(3);
    expect(core()).toBe('1');
    expect(root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-growth-stage]')!.value).toBe('4');

    // 바닥까지 내리면 명함(0): 채워진 별 0개, − 비활성.
    // 진화 뱃지는 0으로 남는다 — 사라지면 별 줄 폭이 흔들린다.
    for (let i = 0; i < 6; i += 1) minus.click();
    expect(filled()).toBe(0);
    expect(core()).toBe('0');
    expect(minus.disabled).toBe(true);

    // 기본값(3돌)으로 되돌리면 오버라이드가 사라져 드롭다운도 없어진다.
    for (let i = 0; i < 3; i += 1) plus.click();
    expect(filled()).toBe(3);
    expect(root.querySelector('[data-slot-card="0"] [data-growth-stage]')).toBeNull();
  });

  it('keeps the star art from swallowing clicks on the stepper buttons', () => {
    // 별·진화 그림은 칸보다 크게 그려 −/+ 위로 넘친다. pointer-events를 놓치면
    // 버튼 한가운데가 안 눌린다 (유저 제보).
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const stepper = root.querySelector<HTMLElement>('[data-slot-card="0"] [data-growth-stepper]')!;
    for (const decoration of ['.growth-stars', '.growth-star', '.growth-core']) {
      expect(stepper.querySelector(decoration), decoration).not.toBeNull();
    }
    // jsdom은 pointer-events 캐스케이드를 계산하지 않는다 — 규칙 자체를 확인한다.
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    expect(css).toMatch(
      /\.growth-stars,\s*\.growth-star,\s*\.growth-core\s*\{\s*pointer-events:\s*none;/,
    );
  });

  it('shows the element code icon on squad cards and roster cells', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    // 편성 카드는 좌상단 — 슬롯 번호와 한 줄에 선다.
    const tags = root.querySelector<HTMLElement>('[data-slot-card="0"] .slot-tags')!;
    expect(tags.querySelector('.slot-number')!.textContent).toBe('01');
    // 리타는 철갑.
    expect(tags.querySelector('.slot-code')!.className).toContain('is-iron');

    // 고르기 판은 우상단. 전원에게 붙고 속성별로 갈린다.
    const cells = [...root.querySelectorAll<HTMLElement>('[data-roster-cell]')];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.querySelector('.roster-code'))).toBe(true);
    const iconOf = (name: string) => root
      .querySelector(`[data-roster-cell="${name}"] .roster-code`)!.className;
    expect(iconOf('라피 : 레드 후드')).toContain('is-fire');     // 작열
    expect(iconOf('앨리스')).toContain('is-water');              // 수냉
    expect(iconOf('나가')).toContain('is-electronic');           // 전격
  });

  it('sends the optimal-range weapon types and restores them on reload', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });

    // 기본은 아무 무기군도 적정거리가 아니다 — 요청에서 아예 빠진다.
    // 런처는 인게임에 적정 사거리가 없어 칸 자체가 없다.
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-optimal-range-weapon]')];
    expect(boxes.map((box) => box.dataset.optimalRangeWeapon))
      .toEqual(['AR', 'SMG', 'SG', 'MG', 'SR']);
    expect(boxes.every((box) => !box.checked)).toBe(true);

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.optimalRangeWeapons).toBeUndefined();

    // 여러 개를 함께 켤 수 있다.
    const check = (weapon: string) => {
      const box = root.querySelector<HTMLInputElement>(`[data-optimal-range-weapon="${weapon}"]`)!;
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    };
    check('SG');
    check('AR');
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    // 고른 순서와 무관하게 정렬돼 실린다 — 같은 설정이 다른 캐시 키를 만들지 않게.
    expect(client.lastRequest?.optimalRangeWeapons).toEqual(['AR', 'SG']);

    // 새로고침해도 남는다.
    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const restored = [...root.querySelectorAll<HTMLInputElement>('[data-optimal-range-weapon]')]
      .filter((box) => box.checked)
      .map((box) => box.dataset.optimalRangeWeapon);
    expect(restored).toEqual(['AR', 'SG']);
  });

  it('keeps buff targets across a reload, and drops them when the squad changes', async () => {
    // 수령자는 실제 발동 로그에서 오므로 계산 전에는 알 수 없다. 새로고침할 때마다
    // 빈 괄호로 돌아가면 기능이 꺼진 것처럼 보이므로 저장했다가 되살린다.
    const withTargets: SimulationResult = {
      ...calculated,
      buffTargets: { 리타: [{ label: '크확 대상', buff: '웨이크업! 4', targets: ['크라운'], count: 3 }] },
    };
    class TargetClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return withTargets;
      }
    }
    // 리타는 기본 편성 1번 칸에 있다 — 감시 대상으로 잡아 둔 캐릭터다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new TargetClient(), storage: localStorage });
    const shown = () => root.querySelector<HTMLElement>('[data-buff-target]')?.textContent;
    expect(shown()).toBe('크확 대상 : []');

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    await flush();
    expect(shown()).toBe('크확 대상 : [크라운]');

    // 새로 마운트해도(=새로고침) 남는다.
    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(shown()).toBe('크확 대상 : [크라운]');

    // 편성을 바꾸면 지난 계산의 값이라 그대로 믿을 수 없다 — 비운다.
    chooseCharacter(root, 1, '프리바티');
    expect(shown()).toBe('크확 대상 : []');
  });

  const chip = (root: HTMLElement, key: string, value: string) =>
    root.querySelector<HTMLButtonElement>(`[data-filter-chip="${key}:${value}"]`)!;

  it('filters the picker down to SSR only', () => {
    // SR·R은 실전에서 거의 안 쓴다 — 목록에서 걷어낸다(유저 피드백).
    const withSR: SettingsCatalog = {
      ...settings,
      characters: { ...settings.characters, 나가: { ...settings.characters.나가!, rarity: 'SR' } },
    };
    mountCalculator(root, { catalog, settings: withSR, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(rosterNames(root)).toContain('나가');
    chip(root, 'rarity', 'SSR').click();
    expect(rosterNames(root)).not.toContain('나가');
    // 같은 칩을 다시 누르면 꺼진다 — 「전체」 칩이 따로 없다.
    chip(root, 'rarity', 'SSR').click();
    expect(rosterNames(root)).toContain('나가');
  });

  it('ORs within a filter group and ANDs across groups', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    // 무기 둘을 켜면 둘 중 하나면 통과한다(그룹 안 OR).
    chip(root, 'weapon', 'SR').click();
    chip(root, 'weapon', 'AR').click();
    expect(rosterNames(root).sort()).toEqual(['앨리스', '프리바티']);

    // 거기에 속성을 더하면 둘 다 만족해야 한다(그룹 사이 AND).
    chip(root, 'code', '수냉').click();
    expect(rosterNames(root).sort()).toEqual(['앨리스', '프리바티']);
    chip(root, 'code', '수냉').click();
    chip(root, 'code', '작열').click();
    expect(rosterNames(root)).toEqual([]);
  });

  it('counts the active filters and clears them all at once', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const badge = root.querySelector<HTMLElement>('[data-filter-badge]')!;
    const reset = root.querySelector<HTMLButtonElement>('[data-filter-reset]')!;
    expect(badge.hidden).toBe(true);
    expect(reset.hidden).toBe(true);

    chip(root, 'weapon', 'SR').click();
    chip(root, 'class', '화력형').click();
    expect(badge.textContent).toBe('2');
    expect(reset.hidden).toBe(false);

    reset.click();
    expect(badge.hidden).toBe(true);
    expect(rosterNames(root).length).toBe(catalog.length);
  });

  it('sorts by overload value, breaking ties by name', () => {
    // 우월코드·우공합은 «내 로스터에서 얼마나 굴려졌나»를 보는 척도다.
    const over = (element: number, atk: number) => ({
      element_bonus: element, atk_pct: atk, max_ammo_pct: 0, crit_rate: 0, crit_dmg: 0,
    });
    const tuned: SettingsCatalog = {
      ...settings,
      characters: {
        ...settings.characters,
        리타: { ...settings.characters.리타!, overload: over(10, 90) },
        앨리스: { ...settings.characters.앨리스!, overload: over(50, 0) },
        나가: { ...settings.characters.나가!, overload: over(30, 5) },
      },
    };
    mountCalculator(root, { catalog, settings: tuned, version: 'v1', client: new FakeClient(), storage: localStorage });

    // 기본은 이름순.
    expect(rosterNames(root)).toEqual([...rosterNames(root)].sort((a, b) => a.localeCompare(b, 'ko')));

    root.querySelector<HTMLButtonElement>('[data-sort="element"]')!.click();
    const byElement = rosterNames(root);
    expect(byElement.indexOf('앨리스')).toBeLessThan(byElement.indexOf('나가'));
    expect(byElement.indexOf('나가')).toBeLessThan(byElement.indexOf('리타'));

    // 우공합은 공증까지 더하므로 리타(10+90=100)가 앨리스(50)를 앞선다.
    root.querySelector<HTMLButtonElement>('[data-sort="elementAtk"]')!.click();
    const bySum = rosterNames(root);
    expect(bySum.indexOf('리타')).toBeLessThan(bySum.indexOf('앨리스'));
  });

  it('flips the sort when the same option is clicked again, and shows which way', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const sortChip = (key: string) =>
      root.querySelector<HTMLButtonElement>(`[data-sort="${key}"]`)!;

    // 이름은 오름차순으로 시작한다.
    sortChip('name').click();
    expect(sortChip('name').dataset.sortDir).toBe('asc');
    expect(sortChip('name').textContent).toContain('▲');
    const asc = rosterNames(root);

    // 같은 항목을 다시 누르면 뒤집힌다.
    sortChip('name').click();
    expect(sortChip('name').dataset.sortDir).toBe('desc');
    expect(sortChip('name').textContent).toContain('▼');
    expect(rosterNames(root)).toEqual([...asc].reverse());

    // 수치 항목은 «높은 순»으로 시작한다 — 항목마다 자연스러운 방향이 다르다.
    sortChip('element').click();
    expect(sortChip('element').dataset.sortDir).toBe('desc');
    // 켜지지 않은 항목에는 삼각형이 없다.
    expect(sortChip('name').textContent).not.toContain('▲');
    expect(sortChip('name').textContent).not.toContain('▼');
  });

  it('opens on combat power, standing by name until the engine answers', async () => {
    // 전투력은 엔진이 계산해 온다. 그 사이에도 목록은 쓸 수 있어야 한다.
    let answer!: (power: Record<string, number>) => void;
    class PowerClient extends FakeClient {
      names: string[] = [];
      async combatPower(request: CombatPowerRequest): Promise<Record<string, number>> {
        this.names = request.names;
        return new Promise((resolve) => { answer = resolve; });
      }
    }
    const client = new PowerClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const summary = () => root.querySelector<HTMLElement>('[data-filter-summary]')!.textContent;

    expect(root.querySelector<HTMLButtonElement>('[data-sort="power"]')!.dataset.sortDir).toBe('desc');
    // 오는 동안은 이름순으로 서 있고, 요약이 기다리는 중임을 알린다.
    expect(summary()).toContain('戦闘力 計算中');
    expect(rosterNames(root)).toEqual([...rosterNames(root)].sort((a, b) => a.localeCompare(b, 'ko')));

    await flush();
    expect(client.names).toEqual(catalog.map((meta) => meta.name));
    answer({ 나가: 30, 리타: 10, 앨리스: 50 });
    await flush();

    expect(summary()).toContain('戦闘力 ▼');
    const byPower = rosterNames(root);
    expect(byPower.indexOf('앨리스')).toBeLessThan(byPower.indexOf('나가'));
    expect(byPower.indexOf('나가')).toBeLessThan(byPower.indexOf('리타'));
  });

  it('lays the filter panel over the list and closes it like a dropdown', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const open = root.querySelector<HTMLButtonElement>('[data-filter-open]')!;
    const panel = root.querySelector<HTMLElement>('[data-filter-panel]')!;
    const scroll = root.querySelector<HTMLElement>('.picker-scroll')!;

    // 판과 목록이 같은 자리 컨테이너에 나란히 있어야 판을 목록 «위에» 얹을 수 있다.
    expect(panel.parentElement).toBe(scroll.parentElement);
    expect(panel.parentElement!.classList.contains('picker-body')).toBe(true);

    expect(panel.hidden).toBe(true);
    open.click();
    expect(panel.hidden).toBe(false);

    // 판 안과 판을 여는 줄은 «바깥»이 아니다 — 눌러도 닫히지 않는다.
    panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    root.querySelector<HTMLElement>('.picker-bar')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(false);

    // 바깥을 누르면 닫힌다.
    scroll.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(open.getAttribute('aria-expanded')).toBe('false');

    // Esc로도 닫힌다.
    open.click();
    expect(panel.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('keeps burst chips outside the panel, next to the button that opens it', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const bar = root.querySelector<HTMLElement>('.picker-bar')!;
    const burst = [...bar.querySelectorAll<HTMLButtonElement>('[data-burst-group] .filter-chip')];
    expect(burst.map((chipEl) => chipEl.textContent)).toEqual(['B1', 'B2', 'B3', 'BA']);
    // 판 안에는 더 이상 버스트가 없다.
    expect(root.querySelector('[data-filter-groups] [data-filter-chip^="burst"]')).toBeNull();

    // 판을 펼치지 않고 바로 걸린다.
    expect(root.querySelector<HTMLElement>('[data-filter-panel]')!.hidden).toBe(true);
    const b3 = catalog.filter((meta) => meta.burstStage === '3').map((meta) => meta.name);
    chip(root, 'burst', '3').click();
    expect(rosterNames(root).sort()).toEqual([...b3].sort());
    expect(root.querySelector('[data-filter-badge]')!.textContent).toBe('1');
    expect(root.querySelector('[data-filter-summary]')!.textContent).toContain('B3');

    chip(root, 'burst', '3').click();
    expect(rosterNames(root).length).toBe(catalog.length);
  });

  it('drops the favorite-item filter', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelector('[data-filter-chip^="favorite"]')).toBeNull();
    const titles = [...root.querySelectorAll('[data-filter-groups] .filter-title')]
      .map((title) => title.textContent);
    expect(titles).toEqual(['レアリティ', 'クラス', 'コード', '武器', '企業']);
  });

  it('sends the synchro level from the battle panel', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const level = root.querySelector<HTMLInputElement>('#synchro-level')!;
    // 기본은 엔진 기본 스펙과 같은 400이다.
    expect(level.value).toBe('400');

    level.value = '250';
    level.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(client.lastRequest?.synchroLevel).toBe(250);

  });

  it('자세히 보기를 켜면 대미지를 1의 자리까지 적는다', async () => {
    // 「1.24억」은 견주기에 좋지만 두 덱이 같은 글자로 보이는 일이 있다.
    // 줄여 쓰기는 백만이 넘어야 시작되므로, 그 위의 수치를 내는 대역으로 잰다.
    const big: SimulationResult = {
      ...calculated,
      squadTotal: 124_381_927,
      charTotals: {
        리타: 60_000_000, 크라운: 30_000_000, '라피 : 레드 후드': 20_000_000,
        앨리스: 10_000_000, 나가: 4_381_927,
      },
    };
    class BigClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return big;
      }
    }
    mountCalculator(root, { catalog, settings, version: 'v1', client: new BigClient(), storage: localStorage });
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    await flush();

    // 이 대역의 총딜(123,456)은 줄여 쓰는 문턱 아래라 두 표기가 같다. 자세히 보기가
    // 실제로 갈리는 자리는 억 단위가 넘는 캐릭터별 수치이므로 그쪽을 본다.
    const rowTotal = () => root.querySelector<HTMLElement>('.result-row-total, .result-cards strong')?.textContent ?? '';
    const box = root.querySelector<HTMLInputElement>('[data-detail-damage]')!;
    expect(box.checked).toBe(false);
    const short = rowTotal();
    expect(short).toMatch(/億$/);                  // 켜기 전에는 줄여 쓴다
    box.click();
    const exact = rowTotal();
    expect(exact).not.toBe(short);
    expect(exact).toMatch(/^[\d,]+$/);            // 쉼표만 든 정수 — 「億」이 붙지 않는다
    expect(Number(exact.replace(/,/g, ''))).toBeGreaterThan(0);

    // 켠 상태는 남는다 — 다시 열어도 그 눈으로 본다.
    expect(localStorage.getItem('nikke-detail-damage-v1')).toBe('1');
    root.querySelector<HTMLInputElement>('[data-detail-damage]')!.click();
    expect(rowTotal()).toBe(short);
    expect(localStorage.getItem('nikke-detail-damage-v1')).toBe('0');
  });

  it('keeps the control fold open and live inside the card', async () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const card = root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    card.querySelector<HTMLInputElement>('[data-custom-toggle]')!.click();
    card.querySelector<HTMLButtonElement>('[data-control-open]')!.click();

    // 컨트롤은 창으로 나가지 않는다 — 카드 안에서 펴진다.
    expect(root.querySelector('[data-char-panel-body] [data-control-mode]')).toBeNull();
    const inCard = (selector: string) =>
      root.querySelector<HTMLInputElement>(`[data-slot-card="0"] ${selector}`);
    expect(inCard('[data-control-panel]')!.hidden).toBe(false);
    // 처음엔 «추천 자동 적용»이라 체크박스가 잠겨 있다.
    expect(inCard('[data-control="reload"]')!.disabled).toBe(true);

    // «직접 설정»을 고르면 카드가 다시 그려진다 — 펴 둔 판은 그대로 살아 있어야 한다.
    inCard('[data-control-mode="manual"]')!.click();
    await Promise.resolve();
    expect(inCard('[data-control-panel]')!.hidden).toBe(false);
    expect(inCard('[data-control="reload"]')!.disabled).toBe(false);
    // 그리고 그 체크박스가 실제로 먹는다.
    inCard('[data-control="reload"]')!.click();
    await Promise.resolve();
    expect(inCard('[data-control="reload"]')!.checked).toBe(true);
  });

  it('does not yank the page back to the squad when results arrive', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    // jsdom에는 scrollIntoView가 없다 — 누가 불렀는지 보려고 심는다.
    const pulled: string[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
    proto.scrollIntoView = function record(this: HTMLElement) {
      if (this.dataset.slotChoose) pulled.push(this.dataset.slotChoose);
    };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    try {
      // 칸을 직접 누르면 끌어온다 — 좁은 화면에서 겨냥한 칸이 밖에 있을 수 있다.
      root.querySelector<HTMLButtonElement>('[data-slot-choose="2"]')!.click();
      await frame();
      expect(pulled).toContain('2');

      // 결과가 도착해 편성이 다시 그려질 때는 끌어오지 않는다.
      pulled.length = 0;
      root.querySelector<HTMLFormElement>('form')!.requestSubmit();
      await flush();
      await frame();
      expect(root.querySelectorAll('[data-character-result]').length).toBeGreaterThan(0);
      expect(pulled).toEqual([]);
    } finally {
      delete proto.scrollIntoView;
    }
  });

  it('empties just the deck being viewed', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelectorAll('[data-slot-choose] strong')[0]!.textContent).toBe('리타');
    root.querySelector<HTMLButtonElement>('[data-deck-clear]')!.click();
    expect([...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent))
      .toEqual(['空き枠', '空き枠', '空き枠', '空き枠', '空き枠']);
  });

  it('brings the deck you were viewing to deck 1 when five-deck mode is turned off', () => {
    // 2~5덱 중 하나만 계산하려고 끄는 경우가 많다 — 그때마다 손으로 옮기지 않게 한다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-deck-tab="3"]')!.click();
    chooseCharacter(root, 0, '프리바티');
    const viewing = [...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent);

    mode.checked = false;
    mode.dispatchEvent(new Event('change'));
    expect([...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent))
      .toEqual(viewing);
  });

  it('swaps deck contents in place, keeping the numbers as fixed slots', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    const shown = () => [...root.querySelectorAll('[data-slot-choose] strong')].map((e) => e.textContent);
    const deck1 = shown();

    // 1덱에서는 «앞으로»가 막혀 있다.
    expect(root.querySelector<HTMLButtonElement>('[data-deck-move="-1"]')!.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    const deck2 = shown();
    root.querySelector<HTMLButtonElement>('[data-deck-move="-1"]')!.click();
    // 내용만 맞바뀌고, 보던 편성을 따라간다.
    expect(shown()).toEqual(deck2);
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    expect(shown()).toEqual(deck1);
  });

  it('gives each slot a target button instead of a dropdown, and one shared picker', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const choosers = [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')];

    expect(choosers).toHaveLength(5);
    expect(choosers.map((c) => c.querySelector('strong')!.textContent)).toEqual(names.slice(0, 5));
    // 슬롯마다 있던 검색·드롭다운·교체 버튼은 판으로 옮겨 갔다.
    expect(root.querySelectorAll('[data-character-filter]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-squad-slot]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-slot-pick]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-roster-search]')).toHaveLength(1);
    expect(root.querySelector<HTMLAnchorElement>('footer a')?.href).toBe('https://github.com/Furu1018/shirisuko-squad');
  });

  it('marks the slot the picker is aiming at, and moves on after a pick', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const aimed = () => [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')]
      .findIndex((c) => c.getAttribute('aria-pressed') === 'true');

    clearCharacterSlot(root, 2);
    expect(aimed()).toBe(2);

    // 프리바티만 초기 편성 밖이라 눌린다 — 나머지는 중복이라 막혀 있다.
    searchRoster(root, '프리바티');
    root.querySelector<HTMLButtonElement>('[data-roster-cell="프리바티"]')!.click();

    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!);
    expect(saved.decks[0].squad[2]).toBe('프리바티');
    // 다 찼으므로 방금 넣은 칸에 머문다.
    expect(aimed()).toBe(2);
  });

  it('blocks a nikke already in this deck, except in the slot being replaced', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    focusSlot(root, 1);

    expect(root.querySelector<HTMLButtonElement>('[data-roster-cell="리타"]')!.disabled).toBe(true);

    // 리타가 앉아 있는 칸을 겨냥하면 그 칸에 한해 다시 고를 수 있다.
    focusSlot(root, 0);
    expect(root.querySelector<HTMLButtonElement>('[data-roster-cell="리타"]')!.disabled).toBe(false);
  });

  // 곁가지(속성·무기·클래스·기업)로 걸린 것끼리는 짧은 이름이 앞이다.
  it.each([
    ['B2', ['나가', '크라운']],
    ['수냉', ['앨리스', '프리바티']],
    ['mg', ['리타', '크라운', '라피 : 레드 후드']],
    ['화력형', ['앨리스', '프리바티', '라피 : 레드 후드']],
    ['엘리시온', ['프리바티', '라피 : 레드 후드']],
    ['sR', ['앨리스']],
  ])('narrows the picker by character metadata query %s case-insensitively', (query, expected) => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    searchRoster(root, query);
    expect(rosterNames(root)).toEqual(expected);
  });

  it('puts the typed name first, and reads 초성 and names without separators', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    searchRoster(root, 'ㄹㅍ');
    // 「라피 : 레드 후드」와 「리타」가 함께 걸려도 이름 첫머리가 앞선다.
    expect(rosterNames(root)[0]).toBe('라피 : 레드 후드');

    searchRoster(root, '라피레드');
    expect(rosterNames(root)).toEqual(['라피 : 레드 후드']);
  });

  it('keeps the aimed slot when the deck changes, and aims at that deck first empty', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    const aimed = [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')]
      .findIndex((c) => c.getAttribute('aria-pressed') === 'true');
    expect(aimed).toBe(0);   // 빈 덱이니 첫 칸
  });

  it('swaps a nikke with the neighbouring slot', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const slots = () => [...root.querySelectorAll<HTMLButtonElement>('[data-slot-choose]')]
      .map((c) => c.querySelector('strong')!.textContent);
    const before = slots();

    root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.click();

    const after = slots();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(after.slice(2)).toEqual(before.slice(2));

    root.querySelector<HTMLButtonElement>('[data-slot-move="1:-1"]')!.click();
    expect(slots()).toEqual(before);
  });

  it('disables the move that would run past either end', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="0:-1"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="4:1"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-slot-move="4:-1"]')!.disabled).toBe(false);
  });

  it('keeps per-character settings with the nikke, not with the slot', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const moved = root.querySelector<HTMLButtonElement>('[data-slot-choose="0"]')!
      .querySelector('strong')!.textContent!;
    // 0번 캐릭터에 개별 설정을 준다.
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    root.querySelector<HTMLButtonElement>('[data-slot-move="0:1"]')!.click();

    // 설정은 이름에 매여 있으므로 자리를 옮겨도 그 캐릭터를 따라간다.
    const saved = JSON.parse(localStorage.getItem('nikke-state-v1')!);
    expect(saved.decks[0].squad[1]).toBe(moved);
    expect(saved.decks[0].characters[moved]).toBeDefined();
  });

  it('copies the active deck squad and settings into the chosen decks', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));

    // 덱 2는 미리 채워 둔다 — 덮어쓰기 대상은 기본 선택되지 않아야 한다.
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    chooseCharacter(root, 0, '앨리스');
    root.querySelector<HTMLButtonElement>('[data-deck-tab="1"]')!.click();

    root.querySelector<HTMLButtonElement>('[data-deck-copy-open]')!.click();
    const targets = [...root.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]')];
    expect(targets.map((box) => box.dataset.deckCopyTarget)).toEqual(['2', '3', '4', '5']);
    expect(targets[0]!.checked).toBe(false);
    expect(targets.slice(1).every((box) => box.checked)).toBe(true);

    // 이미 짜둔 덱 2까지 명시적으로 골라 덮어쓴다.
    targets[0]!.checked = true;
    const deckOne = [...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')].map((slot) => slot.value);
    root.querySelector<HTMLButtonElement>('[data-deck-copy-apply]')!.click();

    for (const id of ['2', '3', '4', '5']) {
      root.querySelector<HTMLButtonElement>(`[data-deck-tab="${id}"]`)!.click();
      expect([...root.querySelectorAll<HTMLSelectElement>('[data-squad-slot]')].map((slot) => slot.value))
        .toEqual(deckOne);
    }
    expect(root.querySelector<HTMLElement>('[data-deck-copy-panel]')!.hidden).toBe(true);
  });

  it('refuses to copy a deck when no target is selected', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-deck-copy-open]')!.click();
    for (const box of root.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]')) box.checked = false;
    root.querySelector<HTMLButtonElement>('[data-deck-copy-apply]')!.click();

    expect(root.querySelector<HTMLElement>('[data-errors]')!.textContent)
      .toContain('コピー先のデッキを1つ以上選んでください');
    expect(root.querySelector<HTMLElement>('[data-deck-copy-panel]')!.hidden).toBe(false);
  });

  // しりすこスクワッド β: enikk (ソロレイド順位取込) はタブを出していないので保留 — 上流同期時に復活させるなら it に戻す
  it.skip('breaks the enikk player list into pages of ten', () => {
    const players = Array.from({ length: 25 }, (_, i) => ({
      rank: i + 1, playerid: `p${i}`, server: 'KR', damage: 1000 - i, cp: 0,
      decks: [{ squad: names.slice(0, 5), damage: 100, cp: 0, usable: true }],
    }));
    localStorage.setItem('nikke-enikk-v2', JSON.stringify({
      season: { raid: 40, boss: 'Test', weakness: 'Fire' },
      players, decks: 25, unknownNames: [], unsupported: 0,
    }));

    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-view-tab="enikk"]')!.click();

    // 25명이면 3쪽, 첫 쪽은 열 명.
    expect(root.querySelectorAll('.enikk-player')).toHaveLength(10);
    expect(root.querySelector('.enikk-page-info')!.textContent).toBe('3쪽 중 1쪽');

    // 마지막 쪽은 다섯 명만 남는다.
    const last = [...root.querySelectorAll<HTMLButtonElement>('.enikk-page')]
      .find((b) => b.textContent === '3')!;
    last.click();
    expect(root.querySelectorAll('.enikk-player')).toHaveLength(5);
    expect(root.querySelector('.enikk-page-info')!.textContent).toBe('3쪽 중 3쪽');
  });

  it.skip('ignores an enikk cache left by an older shape instead of crashing', () => {
    // v1은 `players`가 숫자였다. 그 값을 새 코드가 배열로 읽으면 터진다.
    localStorage.setItem('nikke-enikk-v1', JSON.stringify({ players: 300, comps: [] }));
    localStorage.setItem('nikke-enikk-v2', JSON.stringify({ players: 300, comps: [] }));

    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    root.querySelector<HTMLButtonElement>('[data-view-tab="enikk"]')!.click();

    // 낡은 캐시를 무시하고 «가져오기» 버튼이 그대로 남는다.
    expect(root.querySelector<HTMLButtonElement>('[data-enikk-load]')!.hidden).toBe(false);
    expect(root.querySelectorAll('.enikk-player')).toHaveLength(0);
  });

  it('drops the AI/no-server badges and states the supported count plainly', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const trust = root.querySelector<HTMLElement>('.trust-row')!;

    expect(trust.textContent).not.toContain('AI 없음');
    expect(trust.textContent).not.toContain('서버 전송 없음');
    expect(trust.textContent).toContain(`${catalog.length}名対応`);
    // 판이 늘 펼쳐져 있으니 열 버튼이 없다.
    expect(root.querySelector('[data-roster-open]')).toBeNull();
  });

  it('credits the upstream algorithm next to the supported count', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const credit = root.querySelector<HTMLAnchorElement>('.trust-row .credit-link')!;

    expect(credit.textContent).toBe('原作 nikke-calc に感謝');
    expect(credit.href).toBe('https://github.com/Jgaram/nikke-calc');
    // 새 탭으로 열되 opener를 넘기지 않는다.
    expect(credit.target).toBe('_blank');
    expect(credit.rel).toContain('noopener');
  });

  it('keeps the picker grid open under the squad, with no modal to dismiss', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });

    expect(root.querySelector('[data-roster-modal]')).toBeNull();
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(catalog.length);
    expect(root.querySelector('[data-roster-count]')!.textContent).toBe(`${catalog.length}名`);

    searchRoster(root, '라피');
    expect(rosterNames(root)).toEqual(['라피 : 레드 후드']);
    expect(root.querySelector('[data-roster-count]')!.textContent).toBe(`1 / ${catalog.length}名`);

    searchRoster(root, '없는이름');
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-myroster-empty]')!.hidden).toBe(false);

    searchRoster(root, '');
    expect(root.querySelectorAll('[data-roster-cell]')).toHaveLength(catalog.length);
  });

  it('wipes every stored key and reloads only after the reset is confirmed', () => {
    let reloads = 0;
    localStorage.setItem('nikke-roster-v1', '{"리타":{}}');
    localStorage.setItem('nikke-custom-v1', JSON.stringify({
      테스트니케: {
        name: '테스트니케',
        nikke: {
          rarity: 'SSR', element_code: '철갑', class: '화력형', weapon_type: 'AR',
          burst_stage: '3', burst_cooldown: 40, max_ammo: 60, reload_time: 1,
          fire_rate: 10, damage_coeff: 13.65, core_dmg_mult: 200,
        },
        skills: [],
      },
    }));
    mountCalculator(root, {
      catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage,
      reload: () => { reloads += 1; },
    });
    // 편성 상태를 남겨 초기화 대상이 실제로 존재하게 한다.
    chooseCharacter(root, 0, '프리바티');
    expect(localStorage.getItem('nikke-state-v1')).not.toBeNull();

    const modal = root.querySelector<HTMLElement>('[data-reset-modal]')!;
    root.querySelector<HTMLButtonElement>('[data-reset-all]')!.click();
    expect(modal.hidden).toBe(false);

    // 취소하면 아무것도 지우지 않는다.
    root.querySelector<HTMLButtonElement>('[data-reset-cancel]')!.click();
    expect(modal.hidden).toBe(true);
    expect(reloads).toBe(0);
    expect(localStorage.getItem('nikke-state-v1')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-reset-all]')!.click();
    root.querySelector<HTMLButtonElement>('[data-reset-confirm]')!.click();

    expect(localStorage.getItem('nikke-state-v1')).toBeNull();
    expect(localStorage.getItem('nikke-roster-v1')).toBeNull();
    expect(localStorage.getItem('nikke-sync-v1')).toBeNull();
    expect(localStorage.getItem('nikke-raid-board-v1')).toBeNull();
    expect(reloads).toBe(1);
    expect(modal.hidden).toBe(true);
  });

  it('keeps five-deck tabs visually hidden until the mode is enabled', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const tabs = root.querySelector<HTMLElement>('[data-deck-tabs]')!;
    expect(tabs.hidden).toBe(true);
    expect(getComputedStyle(tabs).display).toBe('none');
    const css = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  });

  it('sends the burst gauge charge time and restores it on reload', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });

    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.burstRegenTime).toBe(2);

    const regen = root.querySelector<HTMLInputElement>('#burst-regen')!;
    regen.value = '2.8';
    regen.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.burstRegenTime).toBe(2.8);

    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(root.querySelector<HTMLInputElement>('#burst-regen')!.value).toBe('2.8');
  });

  it('lays the console out in the in-game order', () => {
    // 인게임·블라블라링크가 «공통 → 기업 → 클래스» 순으로 보여준다. 화면을 그대로
    // 훑으며 옮겨 적을 수 있어야 하므로 순서 자체가 뜻을 갖는다.
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const order = [...root.querySelectorAll<HTMLInputElement>('[data-console-bucket]')]
      .map((input) => input.dataset.consoleBucket);

    expect(order).toEqual([
      'company:엘리시온', 'company:테트라', 'company:미실리스', 'company:필그림', 'company:어브노말',
      'class:화력형', 'class:방어형', 'class:지원형',
    ]);
    // 공통은 맨 앞이다.
    const groups = [...root.querySelectorAll('.console-group h4')].map((h) => h.textContent);
    expect(groups).toEqual(['共通', '企業', 'クラス']);
  });

  it('sends per-affiliation console levels and restores them on reload', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });

    // 클래스 3개 · 기업 5개가 각각 칸을 갖는다 — 엔진이 빠진 소속을 에러로 끊는다.
    const bucketInput = (axis: 'class' | 'company', bucket: string) =>
      root.querySelector<HTMLInputElement>(`[data-console-bucket="${axis}:${bucket}"]`)!;
    expect(root.querySelectorAll('[data-console-bucket^="class:"]')).toHaveLength(3);
    expect(root.querySelectorAll('[data-console-bucket^="company:"]')).toHaveLength(5);

    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.console?.common_level).toBe(180);
    expect(client.lastRequest?.console?.company_level).toEqual({
      엘리시온: 100, 미실리스: 100, 테트라: 100, 필그림: 100, 어브노말: 100,
    });

    // 한 소속만 올려도 그 소속만 바뀐다.
    const tetra = bucketInput('company', '테트라');
    tetra.value = '250';
    tetra.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(client.lastRequest?.console?.company_level).toEqual({
      엘리시온: 100, 미실리스: 100, 테트라: 250, 필그림: 100, 어브노말: 100,
    });

    root.remove();
    root = document.createElement('main');
    document.body.append(root);
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    expect(bucketInput('company', '테트라').value).toBe('250');
    expect(bucketInput('company', '엘리시온').value).toBe('100');
  });

  it('shows validation errors without running the calculator', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    duration.value = '181';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent).toContain('戦闘時間は10〜180秒である必要があります。');
    expect(client.simulateCalls).toBe(0);
  });

  it('renders totals and contribution rows after a successful calculation', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-result-total]')?.textContent).toContain('123,456');
    expect(root.querySelectorAll('[data-character-result]')).toHaveLength(5);
    expect(root.querySelector('[data-status]')?.textContent).toContain('計算完了');
    expect(client.lastRequest?.duration).toBe(10);
  });

  it('renders the normal-attack vs skill damage split per character', async () => {
    class BreakdownClient extends FakeClient {
      override async simulate(request: SimulationRequest): Promise<SimulationResult> {
        await super.simulate(request);
        return {
          ...calculated,
          charBreakdown: {
            리타: {
              normal: 45_000,
              normalHits: 300,
              skill: 15_000,
              skillHits: 12,
              skills: [{ name: '버스트', damage: 15_000, hits: 12 }],
            },
          },
        };
      }
    }
    const client = new BreakdownClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    const splits = [...root.querySelectorAll<HTMLElement>('[data-dmg-split]')];
    // 분해 정보를 준 캐릭터에만 붙는다.
    expect(splits).toHaveLength(1);
    // 접힌 줄에는 비율, 펼치면 실제 대미지가 보인다 — 카드가 좁아 둘을 나눠 담는다.
    expect(splits[0]!.querySelector<HTMLElement>('summary')!.textContent).toContain('通常攻撃 75%');
    expect(splits[0]!.querySelector<HTMLElement>('summary')!.textContent).toContain('スキル 25%');
    const legend = splits[0]!.querySelector<HTMLElement>('.split-legend')!.textContent!;
    expect(legend).toContain('45,000');
    expect(legend).toContain('15,000');
    expect(splits[0]!.querySelector<HTMLElement>('.split-normal')!.style.width).toBe('75%');
    expect(splits[0]!.querySelector<HTMLElement>('.split-skill')!.style.width).toBe('25%');
    expect(splits[0]!.querySelector('.skill-breakdown li')!.textContent).toContain('버스트');
  });

  it('omits the damage split when the result has no breakdown (older cached results)', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelectorAll('[data-character-result]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('[data-dmg-split]')).toHaveLength(0);
  });

  it('reuses a cached result instead of recalculating', async () => {
    const firstClient = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client: firstClient, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();
    expect(firstClient.simulateCalls).toBe(1);

    root.replaceChildren();
    const secondClient = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client: secondClient, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(secondClient.simulateCalls).toBe(0);
    expect(root.querySelector('[data-status]')?.textContent).toContain('保存された結果');
  });

  it('renders a successful result when persistent storage rejects writes', async () => {
    const client = new FakeClient();
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
      removeItem: () => undefined,
    };
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-result-total]')?.textContent).toContain('123,456');
    expect(root.querySelector('[data-status]')?.textContent).toContain('計算完了');
  });

  it('removes the preview badge when a preview slot is cleared', () => {
    const previewCatalog = catalog.map((char, index) => ({ ...char, preview: index === 0 }));
    mountCalculator(root, {
      catalog: previewCatalog,
      settings,
      version: 'v1',
      client: new FakeClient(),
      storage: localStorage,
    });
    const firstCard = root.querySelector<HTMLElement>('[data-slot-card="0"]')!;
    expect(firstCard.classList.contains('is-preview')).toBe(true);

    clearCharacterSlot(root, 0);

    expect(root.querySelector<HTMLElement>('[data-slot-card="0"]')!
      .classList.contains('is-preview')).toBe(false);
  });

  it('uses a 52px editable core only while core is enabled and resets enemy fields only', () => {
    mountCalculator(root, { catalog, settings, version: 'v1', client: new FakeClient(), storage: localStorage });
    const duration = root.querySelector<HTMLInputElement>('#duration')!;
    const seed = root.querySelector<HTMLInputElement>('#seed')!;
    const coreToggle = root.querySelector<HTMLInputElement>('#has-core')!;
    const corePx = root.querySelector<HTMLInputElement>('#core-px')!;
    duration.value = '60';
    seed.value = '99';
    expect(corePx.disabled).toBe(true);
    expect(corePx.value).toBe('52');

    coreToggle.checked = true;
    coreToggle.dispatchEvent(new Event('change'));
    corePx.value = '77';
    root.querySelector<HTMLInputElement>('#enemy-def')!.value = '1';
    root.querySelector<HTMLSelectElement>('#enemy-code')!.value = '작열';
    root.querySelector<HTMLInputElement>('#has-parts')!.checked = true;
    root.querySelector<HTMLButtonElement>('[data-reset-enemy]')!.click();

    expect(duration.value).toBe('60');
    expect(seed.value).toBe('99');
    expect(root.querySelector<HTMLInputElement>('#enemy-def')!.value).toBe('31784');
    expect(coreToggle.checked).toBe(false);
    expect(corePx.value).toBe('52');
    expect(corePx.disabled).toBe(true);
  });

  it('forwards enabled per-character settings in the request', async () => {
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const attack = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-overload-key="atk_pct"]')!;
    attack.value = '40';
    attack.dispatchEvent(new Event('input'));
    const skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(client.lastRequest?.characters?.리타?.overload?.atk_pct).toBe(40);
    expect(client.lastRequest?.characters?.리타?.growthStage).toBe(3);
    expect(client.lastRequest?.characters?.리타?.skillLevels).toEqual({ '1': 4, '2': 10, '3': 10 });
  });

  it.each([-1, 1.5, 11])('blocks a forged growth stage %s outside the character rarity range', async (growthStage) => {
    const client = new FakeClient();
    const invalidSettings: SettingsCatalog = {
      ...settings,
      characters: {
        ...settings.characters,
        리타: { ...settings.characters.리타!, growthStage },
      },
    };
    mountCalculator(root, { catalog, settings: invalidSettings, version: 'v1', client, storage: localStorage });
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    // 1ティック待つだけだと全テスト同時実行の負荷で取りこぼすことがあった (3回に1回ほど)。
    // 条件が満たされるまで待つ形にする — 検証している中身 (この文言が出て、計算は走らない) は同じ。
    await vi.waitFor(() => {
      expect(root.querySelector('[data-errors]')?.textContent)
        .toContain('デッキ 1 · 리타: 限界突破段階は 0~10 の整数である必要があります。');
    });
    expect(client.simulateCalls).toBe(0);
  });

  it('blocks released skill levels outside the integer 1-to-10 range', async () => {
    // バフ対象の先読み (700ms の setTimeout) が遅い環境ではテスト中に発火して
    // simulateCalls を汚す。先読みの時計だけ止め、待ち合わせは setImmediate で行う (afterEach が実時計に戻す)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tick = () => new Promise<void>((resolve) => { setImmediate(resolve); });
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '0';
    skillOne.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick();

    expect(root.querySelector('[data-errors]')?.textContent)
      .toContain('デッキ 1 · 리타: スキルレベルは 1~10 の整数である必要があります。');
    expect(client.simulateCalls).toBe(0);
  });

  it('blocks forged non-ten levels for a locked preview character', async () => {
    const client = new FakeClient();
    const previewName = '아마기 유키코';
    const previewCatalog: CharacterMeta[] = [...catalog, {
      name: previewName,
      burstStage: '3',
      elementCode: '작열',
      weaponType: 'MG',
      className: '화력형',
      manufacturer: '미상',
      preview: true,
      image: null,
      nameCode: null, resourceId: null, aliases: [],
    }];
    const previewSettings: SettingsCatalog = {
      ...settings,
      characters: {
        ...settings.characters,
        [previewName]: {
          ...settings.characters.리타!,
          skillLevels: { '1': 9, '2': 10, '3': 10 },
          skillLevelsLocked: true,
        },
      },
    };
    mountCalculator(root, {
      catalog: previewCatalog,
      settings: previewSettings,
      version: 'v1',
      client,
      storage: localStorage,
    });
    chooseCharacter(root, 0, previewName);
    const toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await flush();

    expect(root.querySelector('[data-errors]')?.textContent)
      .toContain(`デッキ 1 · ${previewName}: 数値未公開のキャラクターはスキル Lv10 のみ使用できます。`);
    expect(client.simulateCalls).toBe(0);
  });

  it('runs non-empty decks sequentially and allows cross-deck duplicates', async () => {
    // 計算機のバフ対象の先読み (700ms の setTimeout) がこのテストの途中で発火すると、
    // 遅い環境では要求が 1 件増えて数が合わなくなる。先読みの時計だけ止め、
    // 待ち合わせは setImmediate で行う (afterEach が実時計に戻す)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tick = () => new Promise<void>((resolve) => { setImmediate(resolve); });
    const client = new FakeClient();
    mountCalculator(root, { catalog, settings, version: 'v1', client, storage: localStorage });
    root.querySelector<HTMLInputElement>('#duration')!.value = '10';
    let toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    let skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));
    let growth = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-growth-stage]')!;
    growth.value = '1';
    growth.dispatchEvent(new Event('change'));
    const mode = root.querySelector<HTMLInputElement>('#squad-mode')!;
    mode.checked = true;
    mode.dispatchEvent(new Event('change'));
    root.querySelector<HTMLButtonElement>('[data-deck-tab="2"]')!.click();
    chooseCharacter(root, 0, '리타');
    toggle = root.querySelector<HTMLInputElement>('[data-slot-card="0"] [data-custom-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    skillOne = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-skill-level="1"]')!;
    skillOne.value = '7';
    skillOne.dispatchEvent(new Event('change'));
    growth = root.querySelector<HTMLSelectElement>('[data-slot-card="0"] [data-growth-stage]')!;
    growth.value = '7';
    growth.dispatchEvent(new Event('change'));

    root.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick();
    await tick();

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]?.squad).toContain('리타');
    expect(client.requests[1]?.squad).toEqual(['리타']);
    expect(client.requests[0]?.characters?.리타?.skillLevels?.['1']).toBe(4);
    expect(client.requests[1]?.characters?.리타?.skillLevels?.['1']).toBe(7);
    expect(client.requests[0]?.characters?.리타?.growthStage).toBe(1);
    expect(client.requests[1]?.characters?.리타?.growthStage).toBe(7);
    // 덱이 둘 이상이면 탭으로 갈라 한 번에 하나만 편다. 탭은 **덱 번호 순서 그대로**다.
    const deckTabs = [...root.querySelectorAll<HTMLButtonElement>('[data-deck-result-tab]')];
    expect(deckTabs.map((tab) => tab.dataset.deckResultTab)).toEqual(['1', '2']);
    expect(root.querySelectorAll('[data-deck-result]')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('[data-deck-result]')!.dataset.deckResult).toBe('1');
    // 딜 순위는 자리를 옮기지 않고 표시로만 붙는다.
    expect(deckTabs.map((tab) => tab.dataset.deckRank)).toEqual(['1', '2']);

    deckTabs[1]!.click();
    expect(root.querySelector<HTMLElement>('[data-deck-result]')!.dataset.deckResult).toBe('2');
    expect(root.querySelector('[data-batch-total]')?.textContent).toContain('246,912');
    expect(root.querySelector('[data-status]')?.textContent).toContain('2件のデッキ計算完了');
  });
});
