// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  controlRuleNotes, recommendedControlText, renderCharacterSettings, withParticle,
} from './character-settings';
import type { BuffTargetRow, CharacterOverrides, SettingsCatalog } from './types';

const settings: SettingsCatalog = {
  characters: {
    리타: {
      weaponType: 'SMG',
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
    },
    라피: {
      weaponType: 'RL',
      recommendedControl: { tap_fire: { rate: 3.6, release: 0.03 } },
      hasConditionalControl: true,
      favoriteItem: { name: '기념 열쇠고리', stage: 3 },
      growthStage: 2,
      rarity: 'SR',
      maxGrowthStage: 2,
      growthOptions: [
        { value: 0, label: '명함', affinity: 10 },
        { value: 1, label: '1돌', affinity: 20 },
        { value: 2, label: '2돌', affinity: 30 },
      ],
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
      collection: { stage: 'SR15', favorite: 3 },
    },
    '아마기 유키코': {
      weaponType: 'AR',
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
      skillLevelsLocked: true,
      overload: {
        element_bonus: 88.6,
        atk_pct: 22.22,
        max_ammo_pct: 129.64,
        crit_rate: 0,
        crit_dmg: 0,
      },
      cube: { name: '재장', level: 15 },
      collection: { stage: 'SR15', favorite: 0 },
    },
    '신데렐라 : 크리스탈 웨이브': {
      weaponType: 'MG',
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
    },
  },
  collectionStages: ['없음', 'SR0', 'SR5', 'SR15'],
  normalHitCoeff: { AR: 1, SMG: 1, SG: 0.9, MG: 1, SR: 1, RL: 1 },
  weaponTypes: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'],
  buffTargetWatch: { 미란다: [{ buff: '웨이크업! 4', label: '크확 대상' }] },
  consoleClasses: ['화력형', '방어형', '지원형'],
  consoleCompanies: ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'],
  cubes: {
    재장: { id: 0, label: '재장', stat: 'reload_speed_pct', template: '재장전 속도 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 29.69, commonElement: 19.09 } } },
    탄충: { id: 0, label: '탄충', stat: 'ammo_charge_flat', template: '10발 사격 시 탄환 충전 {0}발 ▲', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 3, commonElement: 19.09 } } },
    체력: { id: 0, label: '체력', stat: 'max_hp_pct', template: '최대 체력 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 9.69, commonElement: 19.09 } } },
    차속: { id: 0, label: '차속', stat: 'charge_speed_pct', template: '차지 속도 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 2.12, commonElement: 19.09 } } },
    파츠: { id: 0, label: '파츠', stat: 'part_dmg_pct', template: '파츠 대미지 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 31.9, commonElement: 19.09 } } },
    분배: { id: 0, label: '분배', stat: 'split_dmg_pct', template: '분배 대미지 {0} ▲%', levels: { '15': { atk: 2780, def: 552, hp: 83400, effect: 17.69, commonElement: 19.09 } } },
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
    attack_speed_pct: { label: '공격 속도', unit: '%', min: -1000, max: 10000 },
  },
  favoriteItems: {},
};

describe('character settings editor', () => {
  let root: HTMLElement;
  let value: CharacterOverrides | undefined;
  let characterName: '리타' | '라피' | '아마기 유키코' | '신데렐라 : 크리스탈 웨이브';

  const render = () => renderCharacterSettings(root, characterName, settings, value, (next) => {
    value = next;
  });

  const setToggle = (selector: string, checked: boolean) => {
    const input = root.querySelector<HTMLInputElement>(selector)!;
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
  };

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    value = undefined;
    characterName = '리타';
    render();
  });

  afterEach(() => root.remove());

  it('shows resolved defaults and opens final-value inputs on demand', () => {
    expect(root.textContent).toContain('スキル 10 / 10 / 10');
    expect(root.textContent).toContain('3凸 · 好感度 30');
    expect(root.textContent).toContain('優コ 88.60');
    expect(root.textContent).toContain('攻増 22.22');
    expect(root.textContent).toContain('装弾 129.64');
    expect(root.querySelector('[data-character-settings-body]')).toBeNull();

    setToggle('[data-custom-toggle]', true);

    expect(value?.skillLevels).toEqual({ '1': 10, '2': 10, '3': 10 });
    expect(value?.growthStage).toBe(3);
    expect(value?.overload).toEqual(settings.characters.리타!.overload);
    expect(root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')?.value).toBe('22.22');
  });

  it('assigns priority-every-n burst usage and reveals the n input', () => {
    setToggle('[data-custom-toggle]', true);

    const burst = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    expect([...burst.options].map((option) => option.value))
      .toEqual(['auto', 'priority', 'endgame', 'skip']);
    expect(burst.value).toBe('auto');
    expect(root.querySelector<HTMLElement>('.burst-every')?.hidden).toBe(true);

    burst.value = 'priority';
    burst.dispatchEvent(new Event('change'));
    expect(value?.burst).toEqual({ mode: 'priority', every: 1 });
    expect(root.querySelector<HTMLElement>('.burst-every')?.hidden).toBe(false);

    const every = root.querySelector<HTMLInputElement>('[data-burst-every]')!;
    every.value = '3';
    every.dispatchEvent(new Event('input'));
    expect(value?.burst).toEqual({ mode: 'priority', every: 3 });

    const burstAgain = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    burstAgain.value = 'auto';
    burstAgain.dispatchEvent(new Event('change'));
    expect(value?.burst).toBeUndefined();
  });

  it('sets equipment level per part (head, body, arm, leg)', () => {
    setToggle('[data-custom-toggle]', true);

    const head = root.querySelector<HTMLSelectElement>('[data-equip-level="머리"]')!;
    const arm = root.querySelector<HTMLSelectElement>('[data-equip-level="팔"]')!;
    // 실전에서 쓰는 것만 남긴다 — 미장착 / 오버로드 0~5강.
    // 강화 레벨은 스킬 레벨과 같은 방향(오름차순)으로 통일했다.
    expect([...head.options].map((option) => option.value)).toEqual(
      ['없음', '0', '1', '2', '3', '4', '5'],
    );
    expect([...head.options].map((option) => option.textContent)).toEqual(
      ['未装着', 'オーバーロード強化0', 'オーバーロード強化1', 'オーバーロード強化2',
        'オーバーロード強化3', 'オーバーロード強化4', 'オーバーロード強化5'],
    );
    expect(head.value).toBe('5');
    expect(root.querySelectorAll('[data-equip-level]').length).toBe(4);

    arm.value = '2';
    arm.dispatchEvent(new Event('change'));
    expect(value?.equipLevels).toEqual({ 머리: 5, 몸통: 5, 팔: 2, 다리: 5 });

    // 등급을 고르면 숫자가 아니라 등급 그대로 실린다 — 미장착을 강화0으로
    // 적으면 안 낀 부위가 플랫 스탯을 얻는다.
    arm.value = '없음';
    arm.dispatchEvent(new Event('change'));
    expect(value?.equipLevels?.팔).toBe('없음');

    // 고를 수 있는 건 미장착과 오버로드 0~5강뿐이다 — 일반 T1~T9는 뺐고,
    // 강화 0단계는 계산 그대로 「오버로드 0강」이라 적는다.
    expect([...arm.options].map((option) => option.textContent)).toEqual([
      '未装着', 'オーバーロード強化0', 'オーバーロード強化1', 'オーバーロード強化2',
      'オーバーロード強化3', 'オーバーロード強化4', 'オーバーロード強化5',
    ]);
  });

  it('offers Crystal Wave sniper mode with a six-second default delay', () => {
    characterName = '신데렐라 : 크리스탈 웨이브';
    render();
    setToggle('[data-custom-toggle]', true);

    const checkbox = root.querySelector<HTMLInputElement>('[data-weapon-mode-swap]')!;
    const delay = root.querySelector<HTMLInputElement>('[data-weapon-mode-swap-at]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    expect(delay.value).toBe('6');
    expect(delay.disabled).toBe(true);
    expect(delay.parentElement?.querySelector('em')?.textContent).toBe('秒');
    expect(delay.closest('.weapon-mode-swap')?.textContent).toContain('後から切替を試行');

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(value?.weaponModeSwapAt).toBe(6);

    const enabledDelay = root.querySelector<HTMLInputElement>('[data-weapon-mode-swap-at]')!;
    expect(enabledDelay.disabled).toBe(false);
    enabledDelay.focus();
    enabledDelay.value = '8';
    enabledDelay.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(enabledDelay);
    enabledDelay.value = '8.5';
    enabledDelay.dispatchEvent(new Event('input'));
    expect(value?.weaponModeSwapAt).toBe(8.5);

    setToggle('[data-weapon-mode-swap]', false);
    expect(value?.weaponModeSwapAt).toBeUndefined();
  });

  it('does not show the sniper mode control for other characters', () => {
    setToggle('[data-custom-toggle]', true);
    expect(root.querySelector('[data-weapon-mode-swap]')).toBeNull();
  });

  it('selects a legal growth stage and applies its maximum bond rank', () => {
    setToggle('[data-custom-toggle]', true);

    const growth = root.querySelector<HTMLSelectElement>('[data-growth-stage]')!;
    expect([...growth.options].map((option) => option.text)).toEqual([
      '無凸', '1凸', '2凸', '3凸', 'コア1', 'コア2', 'コア3', 'コア4',
      'コア5', 'コア6', 'コア7',
    ]);
    expect(root.textContent).toContain('好感度は限界突破ごとの最大値で適用します。');

    growth.value = '0';
    growth.dispatchEvent(new Event('change'));

    expect(value?.growthStage).toBe(0);
    expect(root.textContent).toContain('無凸 · 好感度 10');
  });

  it('constrains an SR character to card through limit break two', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    const growth = root.querySelector<HTMLSelectElement>('[data-growth-stage]')!;
    expect([...growth.options].map((option) => option.text)).toEqual(['無凸', '1凸', '2凸']);
    expect(value?.growthStage).toBe(2);
  });

  it('changes skill 1, skill 2, and burst levels independently', () => {
    setToggle('[data-custom-toggle]', true);

    const skillOne = root.querySelector<HTMLSelectElement>('[data-skill-level="1"]')!;
    skillOne.value = '4';
    skillOne.dispatchEvent(new Event('change'));
    const skillTwo = root.querySelector<HTMLSelectElement>('[data-skill-level="2"]')!;
    skillTwo.value = '6';
    skillTwo.dispatchEvent(new Event('change'));
    const burst = root.querySelector<HTMLSelectElement>('[data-skill-level="3"]')!;
    burst.value = '8';
    burst.dispatchEvent(new Event('change'));

    expect(value?.skillLevels).toEqual({ '1': 4, '2': 6, '3': 8 });
    expect(root.textContent).toContain('スキル 4 / 6 / 8');
  });

  it('lets a favorite-item character pick the stage actually owned', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    expect(root.textContent).toContain('기념 열쇠고리');
    const select = root.querySelector<HTMLSelectElement>('[data-collection]')!;
    // 애장품 단계가 먼저 오고, 그 뒤로 소장품 단계가 이어진다.
    expect([...select.options].slice(0, 3).map((option) => option.textContent))
      .toEqual(['お気に入り ★★★', 'お気に入り ★★☆', 'お気に入り ★☆☆']);
    expect(select.value).toBe('favorite:3');

    // 실제로는 애장품이 없고 소장품 SR5만 낀 경우.
    select.value = 'stage:SR5';
    select.dispatchEvent(new Event('change'));
    expect(value?.collection).toEqual({ stage: 'SR5', favorite: 0 });

    expect(root.querySelectorAll('[data-overload-key]')).toHaveLength(9);
    expect(root.textContent).toContain('チャージ武器でなければチャージ系オプションは効果がありません。');
  });

  it('offers only collection stages when the character has no favorite item', () => {
    characterName = '리타';
    render();
    setToggle('[data-custom-toggle]', true);

    const select = root.querySelector<HTMLSelectElement>('[data-collection]')!;
    expect([...select.options].every((option) => !option.value.startsWith('favorite:'))).toBe(true);

    select.value = 'stage:없음';
    select.dispatchEvent(new Event('change'));
    expect(value?.collection).toEqual({ stage: '없음', favorite: 0 });
  });

  it('keeps 컨트롤 beside the stat settings, both closed, not one inside the other', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    const stats = root.querySelector<HTMLElement>('[data-char-panel-open="settings"]')!;
    const control = root.querySelector<HTMLElement>('[data-control-open]')!;

    // 둘 다 닫힌 채로 시작한다 — 개별 설정을 켜는 것과 여는 것은 별개다.
    expect(stats.getAttribute('aria-expanded')).toBe('false');
    expect(control.getAttribute('aria-expanded')).toBe('false');

    // 컨트롤은 수치 뭉치 **안**에 있으면 안 된다. 만지는 이유가 다른 두 뭉치다.
    const statsPanel = stats.nextElementSibling!;
    expect(statsPanel.contains(control)).toBe(false);
    // 그리고 그 아래에 온다.
    expect(statsPanel.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 컨트롤은 창으로 가지 않고 그 자리에서 펴진다 — 수치 설정은 그대로 닫혀 있다.
    control.click();
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector<HTMLElement>('[data-control-panel]')!.hidden).toBe(false);
    expect(stats.getAttribute('aria-expanded')).toBe('false');
  });

  it('추천 컨트롤을 영어 키가 아니라 한글로 적는다', () => {
    // 「tap_fire」라고 적어 두면 아래 체크박스의 「톡톡이」와 같은 것인 줄 모른다.
    expect(recommendedControlText(
      { recommendedControl: { tap_fire: { rate: 3.6, release: 0.03 } }, hasConditionalControl: false },
    )).toBe('現在の基本推奨: タップ撃ち');
    expect(recommendedControlText({ recommendedControl: {}, hasConditionalControl: false }))
      .toBe('現在の基本推奨: 自動射撃');
  });

  it('조합으로 붙는 컨트롤을 누구 때문인지까지 적는다', () => {
    // 아인은 에이다와 함께일 때 홀드가 붙는다. 예전에는 그 사실이 화면에 없어서
    // 「홀드를 켰는데 결과가 그대로」로 보였다 — 이미 걸려 있었기 때문이다.
    const defaults = {
      recommendedControl: { tap_fire: { rate: 3.6, release: 0.03 } },
      hasConditionalControl: true,
      conditionalControl: [{ withMembers: ['에이다'], control: { hold: { policy: 'own_full_burst' as const, lead: 0.5 } } }],
    };
    expect(recommendedControlText(defaults, ['아인', '에이다', '미란다']))
      .toBe('現在の基本推奨: タップ撃ち · ホールドコントロール(에이다と一緒のため)');
    // 그 사람이 빠지면 다시 조건 없는 것만 남는다 — 얼버무리는 말도 붙지 않는다.
    expect(recommendedControlText(defaults, ['아인', '홍련']))
      .toBe('現在の基本推奨: タップ撃ち');
  });

  it('화면이 판정할 수 없는 조건은 예전처럼 알리기만 한다', () => {
    // 같은 단계·자리 번호를 보는 규칙은 내려오지 않는다. 흉내 내면 틀린 값을 적게 된다.
    expect(recommendedControlText(
      { recommendedControl: {}, hasConditionalControl: true }, ['아인'],
    )).toBe('現在の基本推奨: 自動射撃 · スカッド編成によって推奨コントロールが追加されます。');
  });

  it('조합으로 붙는 컨트롤은 왜 붙는지까지 적는다', () => {
    // 아무도 켠 적이 없는데 걸리는 컨트롤이라, 걸린 사실만으로는 오해가 남는다.
    const defaults = {
      conditionalControl: [{
        withMembers: ['에이다'],
        control: { hold: { policy: 'own_full_burst' as const, lead: 0.5 } },
        help: '에이다와 같은 운용을 함께 씁니다.',
      }],
    };
    const [on] = controlRuleNotes(defaults, ['아인', '에이다']);
    expect(on!.active).toBe(true);
    expect(on!.headline).toBe('에이다と一緒なのでホールドコントロールが適用されています。');
    expect(on!.help).toBe('에이다와 같은 운용을 함께 씁니다.');

    // 아직 아니면 «무엇과 함께 두면 걸리는지»를 알려 준다.
    const [off] = controlRuleNotes(defaults, ['아인', '홍련']);
    expect(off!.active).toBe(false);
    expect(off!.headline).toBe('에이다と一緒に編成するとホールドコントロールが自動で付きます。');
  });

  it('조사를 받침에 맞춰 고른다', () => {
    expect(withParticle('홀드 컨트롤', '이', '가')).toBe('홀드 컨트롤이');
    expect(withParticle('톡톡이', '이', '가')).toBe('톡톡이가');
    expect(withParticle('홍련', '과', '와')).toBe('홍련과');
    expect(withParticle('에이다', '과', '와')).toBe('에이다와');
    // 한글이 아닌 끝글자는 받침이 있는 쪽으로 본다.
    expect(withParticle('MG', '이', '가')).toBe('MG이');
  });

  it('설명이 없는 규칙은 한 줄만 적는다', () => {
    // 설명은 데이터가 들고 온다 — 화면이 지어내지 않는다.
    const [note] = controlRuleNotes(
      { conditionalControl: [{ withMembers: ['미란다'], control: { cover: { policy: 'own_full_burst' as const } } }] },
      ['미하라 : 본딩 체인', '미란다'],
    );
    expect(note!.help).toBe('');
    expect(note!.headline).toContain('バースト遮蔽コントロール');
  });

  it('규칙이 없으면 안내도 없다', () => {
    expect(controlRuleNotes({}, ['리타'])).toEqual([]);
  });

  it('컨트롤 칩은 열지 않아도 지금 상태를 적어 둔다', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);
    const chipText = () => root.querySelector('.control-chip-text')!.textContent;
    expect(chipText()).toBe('推奨自動 · バースト自動');

    setToggle('[data-control-mode="manual"]', true);
    expect(chipText()).toBe('手動設定 · バースト自動');   // 0개라고 세어 보이지 않는다
    setToggle('[data-control="reload"]', true);
    expect(chipText()).toBe('手動1件 · バースト自動');

    const burst = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    burst.value = 'priority';
    burst.dispatchEvent(new Event('change'));
    expect(chipText()).toBe('手動1件 · バースト 1の倍数');

    burst.value = 'skip';
    burst.dispatchEvent(new Event('change'));
    expect(chipText()).toBe('手動1件 · バースト使わない');
  });

  it('컨트롤 판 안의 긴 설명도 펴 둔 채로 남는다', () => {
    // 접이판 상태를 카드가 비워진 뒤에 찾으면 늘 «접힘»만 나온다.
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);
    root.querySelector<HTMLButtonElement>('[data-control-open]')!.click();
    const note = () => root.querySelector<HTMLDetailsElement>('[data-note-fold="burst"]')!;
    expect(note().open).toBe(false);
    note().open = true;
    setToggle('[data-control-mode="manual"]', true);
    expect(note().open).toBe(true);
    // 다른 접이판까지 덩달아 펴지지는 않는다.
    expect(root.querySelector<HTMLDetailsElement>('[data-note-fold="control-warning"]')!.open).toBe(false);
  });

  it('컨트롤을 펴 둔 채로 값을 바꿔도 접히지 않는다', () => {
    // 체크 하나 누를 때마다 카드가 다시 그려진다 — 그때 접히면 둘째 항목을 못 켠다.
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);
    root.querySelector<HTMLButtonElement>('[data-control-open]')!.click();
    setToggle('[data-control-mode="manual"]', true);
    expect(root.querySelector<HTMLElement>('[data-control-open]')!.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector<HTMLElement>('[data-control-panel]')!.hidden).toBe(false);
  });

  it('switches from recommended controls to exact per-character controls', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);

    expect(root.querySelector<HTMLInputElement>('[data-control-mode="auto"]')?.checked).toBe(true);
    expect(root.querySelector('[data-control="tap_fire"]')).not.toBeNull();
    expect(root.querySelector('[data-control="hold"]')).not.toBeNull();
    expect(root.querySelector('[data-control="reload"]')).not.toBeNull();
    expect(root.querySelector('[data-control="cover"]')).not.toBeNull();

    setToggle('[data-control-mode="manual"]', true);
    expect(value?.control).toEqual({});
    setToggle('[data-control="tap_fire"]', true);
    // 직접 켤 때 채워지는 출발값. 엔진의 «추천 자동»(3.6)과는 별개다.
    expect(value?.control?.tap_fire).toEqual({ rate: 4.4, release: 0.03 });

    setToggle('[data-control-mode="auto"]', true);
    expect(value).not.toHaveProperty('control');
  });

  it('lets the tap-fire rate be typed in and shows the 톡톡이 equivalent', () => {
    characterName = '라피';
    render();
    setToggle('[data-custom-toggle]', true);
    setToggle('[data-control-mode="manual"]', true);

    // 켜기 전에는 속도를 만질 수 없다.
    expect(root.querySelector<HTMLInputElement>('[data-tap-rate]')?.disabled).toBe(true);
    setToggle('[data-control="tap_fire"]', true);

    const rate = root.querySelector<HTMLInputElement>('[data-tap-rate]')!;
    expect(rate.disabled).toBe(false);
    expect(rate.value).toBe('4.4');
    expect(root.querySelector('[data-tap-hint]')?.textContent).toContain('10秒44発');

    rate.value = '4';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.control?.tap_fire).toEqual({ rate: 4, release: 0.03 });
    expect(root.querySelector('[data-tap-hint]')?.textContent).toContain('10秒40発');

    // 게임이 강제하는 하한(220ms ≈ 4.5발/초)을 넘으면 그 사실을 알린다.
    rate.value = '6';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.control?.tap_fire?.rate).toBe(6);
    expect(root.querySelector('[data-tap-hint]')?.textContent).toContain('ゲーム下限');
  });

  it('does not show charge-only controls for a non-charge weapon', () => {
    setToggle('[data-custom-toggle]', true);
    expect(root.querySelector('[data-control="tap_fire"]')).toBeNull();
    expect(root.querySelector('[data-control="hold"]')).toBeNull();
    expect(root.querySelector('[data-control="reload"]')).not.toBeNull();
    expect(root.querySelector('[data-control="cover"]')).not.toBeNull();
  });

  it('shows preview characters as level-ten-only without editable selects', () => {
    characterName = '아마기 유키코';
    render();

    expect(root.textContent).toContain('数値未公開 · Lv10固定');
    setToggle('[data-custom-toggle]', true);

    expect(value?.skillLevels).toEqual({ '1': 10, '2': 10, '3': 10 });
    expect(root.querySelectorAll('[data-skill-level]')).toHaveLength(0);
    expect(root.querySelector('[data-skill-levels-locked]')?.textContent)
      .toContain('数値未公開 · Lv10固定');
    expect(root.textContent).toContain('Lv1〜9の係数が公開されていない');
  });

  it('updates cube type and renders its selected-level stats and effects', () => {
    setToggle('[data-custom-toggle]', true);
    const cube = root.querySelector<HTMLSelectElement>('[data-cube-name]')!;
    cube.value = '탄충';
    cube.dispatchEvent(new Event('change'));

    expect(value?.cube).toEqual({ name: '탄충', level: 15 });
    expect(root.textContent).toContain('攻撃 2,780');
    // 効果文はゲーム公式の日本語表記に置き換わる (data/cube-name-ja.json)
    expect(root.textContent).toContain('10発射撃した時 「弾丸チャージ3発▲」');
    expect(root.textContent).toContain('有利コード 19.09%');
  });

  it('searches, adds, edits, deduplicates, and removes advanced stats', () => {
    setToggle('[data-custom-toggle]', true);
    setToggle('[data-advanced-toggle]', true);
    const search = root.querySelector<HTMLInputElement>('[data-manual-search]')!;
    search.value = '분배';
    search.dispatchEvent(new Event('input'));
    const select = root.querySelector<HTMLSelectElement>('[data-manual-select]')!;
    // 選択肢は日本語で出す (韓国語で打っても引ける — 検索は両方を見る)
    expect([...select.options].map((option) => option.text)).toContain('分裂ダメージ増加');

    select.value = 'split_dmg_pct';
    root.querySelector<HTMLButtonElement>('[data-add-stat]')!.click();
    expect(root.querySelectorAll('[data-manual-row]')).toHaveLength(1);
    const input = root.querySelector<HTMLInputElement>('[data-manual-stat="split_dmg_pct"]')!;
    input.value = '20';
    input.dispatchEvent(new Event('input'));
    expect(value?.manualStats).toEqual({ split_dmg_pct: 20 });

    expect([...root.querySelectorAll<HTMLOptionElement>('[data-manual-select] option')]
      .some((option) => option.value === 'split_dmg_pct')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-remove-stat="split_dmg_pct"]')!.click();
    expect(value?.manualStats).toEqual({});
  });

  it('disabling custom settings returns to canonical defaults', () => {
    setToggle('[data-custom-toggle]', true);
    root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')!.value = '40';
    root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')!
      .dispatchEvent(new Event('input'));
    setToggle('[data-custom-toggle]', false);

    expect(value).toBeUndefined();
    expect(root.textContent).toContain('既定値');
  });

  it('shows who receives a watched buff, outside the collapsed 개별값 fold', () => {
    // 대상이 공격력 순위로 갈려 편성만 보고는 알 수 없다 — 계산 전에는 빈 괄호로
    // 자리만 잡고, 결과가 오면 실제 수령자가 채워진다.
    renderCharacterSettings(root, characterName, settings, value, (next) => { value = next; },
      [{ label: '크확 대상', buff: '웨이크업! 4', targets: [], count: 0 }]);
    let row = root.querySelector<HTMLElement>('[data-buff-target]')!;
    expect(row.textContent).toBe('크확 대상 : []');
    // 접이 **밖**에 선다 — 펴 보지 않아도 보여야 하는 정보다.
    expect(row.closest('[data-loadout-fold]')).toBeNull();
    const fold = root.querySelector<HTMLElement>('[data-loadout-fold]')!;
    expect(fold.hidden).toBe(true);                    // 접힌 채로도
    expect(row.getClientRects).toBeDefined();
    expect(fold.contains(row)).toBe(false);
    // 접이 바로 다음 자리다 — 요약과 개별 설정 사이.
    expect(fold.nextElementSibling!.contains(row)).toBe(true);

    renderCharacterSettings(root, characterName, settings, value, (next) => { value = next; },
      [{ label: '크확 대상', buff: '웨이크업! 4', targets: ['리버렐리오'], count: 3 }]);
    row = root.querySelector<HTMLElement>('[data-buff-target]')!;
    expect(row.textContent).toBe('크확 대상 : [리버렐리오]');
    expect(row.title).toContain('3回発動');
  });

  it('folds a switching target into 특이케이스 and offers the order', () => {
    // 대상이 갈리면 이름을 나열해도 읽히지 않는다 — 접고 순서는 버튼으로 넘긴다.
    let opened: BuffTargetRow | undefined;
    const row: BuffTargetRow = {
      label: '차분한 수심 대상', buff: '차분한 수심 4', count: 4,
      targets: ['앨리스', '홍련 : 흑영'],
      sequence: [
        { t: 3.25, target: '앨리스' }, { t: 23.25, target: '홍련 : 흑영' },
        { t: 43.25, target: '앨리스' }, { t: 63.25, target: '홍련 : 흑영' },
      ],
    };
    renderCharacterSettings(root, characterName, settings, value, (next) => { value = next; },
      [row], (r) => { opened = r; });

    const box = root.querySelector<HTMLElement>('[data-buff-target]')!;
    expect(box.textContent).toContain('[特殊ケース]');
    expect(box.title).toContain('2人の間で分かれます');

    const button = root.querySelector<HTMLButtonElement>('[data-buff-order-open]')!;
    expect(button.textContent).toBe('順序を見る');
    button.click();
    expect(opened?.sequence?.map((s) => s.target))
      .toEqual(['앨리스', '홍련 : 흑영', '앨리스', '홍련 : 흑영']);
  });

  it('shows just the name when the target never changes, with no order button', () => {
    // 대상이 고정이면 이름 하나로 충분하다 — 「순서보기」는 갈릴 때만 붙인다.
    renderCharacterSettings(root, characterName, settings, value, (next) => { value = next; },
      [{ label: '크확 대상', buff: '웨이크업! 4', targets: ['리버렐리오'], count: 3,
         sequence: [{ t: 3.25, target: '리버렐리오' }] }], () => {});
    const box = root.querySelector<HTMLElement>('[data-buff-target]')!;
    expect(box.textContent).toBe('크확 대상 : [리버렐리오]');
    expect(root.querySelector('[data-buff-order-open]')).toBeNull();
  });

  it('says 계산중 while the background run is in flight', () => {
    // 빈 괄호만 보이면 기능이 꺼진 것처럼 보인다 — 도는 동안은 그렇다고 적는다.
    renderCharacterSettings(root, characterName, settings, value, (next) => { value = next; },
      [{ label: '크확 대상', buff: '웨이크업! 4', targets: [], count: 0, pending: true }]);
    const box = root.querySelector<HTMLElement>('[data-buff-target]')!;
    expect(box.textContent).toBe('크확 대상 : [計算中]');
    expect(box.classList.contains('is-pending')).toBe(true);
    expect(box.title).toContain('計算中');
  });

  it('hands the panel to whoever can show it in a window', () => {
    // 창을 열 수 있는 자리(계산기 화면)에서는 그 자리에서 펼치지 않고 넘긴다.
    const opened: Array<{ kind: string; label: string; hasBurst: boolean }> = [];
    renderCharacterSettings(
      root, characterName, settings, value, (next) => { value = next; }, undefined, undefined,
      (kind, panel, label) => opened.push({
        kind, label, hasBurst: panel.querySelector('.burst-editor') !== null,
      }),
    );
    setToggle('[data-custom-toggle]', true);
    root.querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.click();
    expect(opened).toEqual([{ kind: 'settings', label: '限界突破 · スキル · オーバーロード · キューブ', hasBurst: false }]);
    // 넘겼으면 제자리에서 펼치지는 않는다 — 같은 것이 두 곳에 보이면 안 된다.
    expect(root.querySelector<HTMLElement>('[data-char-panel="settings"]')!.hidden).toBe(true);
    // 컨트롤은 애초에 창으로 넘기지 않는다 — 카드에서 그 자리에 펴진다.
    root.querySelector<HTMLButtonElement>('[data-control-open]')!.click();
    expect(opened).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('[data-control-panel]')!.hidden).toBe(false);
  });

  it('keeps advanced mode on while the panel lives in a window', () => {
    // 창(모달)으로 띄우면 뭉치가 카드 밖으로 나간다. 그 상태로 «수치 추가»를 누르면
    // 카드만 뒤져 펼침 상태를 찾던 탓에 고급 모드가 저 혼자 꺼졌다.
    const window = document.createElement('div');
    document.body.append(window);
    const show = (_kind: string, panel: HTMLElement) => {
      panel.hidden = false;
      window.replaceChildren(panel);
    };
    const draw = () => renderCharacterSettings(
      root, characterName, settings, value, (next) => {
        value = next;
        queueMicrotask(() => {
          const fresh = root.querySelector<HTMLElement>('[data-char-panel="settings"]');
          if (fresh) show('settings', fresh);
        });
      }, undefined, undefined, show,
    );
    draw();
    setToggle('[data-custom-toggle]', true);
    root.querySelector<HTMLButtonElement>('[data-char-panel-open="settings"]')!.click();

    const toggle = window.querySelector<HTMLInputElement>('[data-advanced-toggle]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    const search = window.querySelector<HTMLInputElement>('[data-manual-search]')!;
    search.value = '분배';
    search.dispatchEvent(new Event('input'));
    window.querySelector<HTMLSelectElement>('[data-manual-select]')!.value = 'split_dmg_pct';
    window.querySelector<HTMLButtonElement>('[data-add-stat]')!.click();

    const drawn = root.querySelector<HTMLElement>('[data-char-panel="settings"]')!;
    expect(drawn.querySelector<HTMLInputElement>('[data-advanced-toggle]')!.checked).toBe(true);
    expect(drawn.querySelector<HTMLElement>('.advanced-editor')!.hidden).toBe(false);
    expect(drawn.querySelectorAll('[data-manual-row]')).toHaveLength(1);
    // 검색어도 남는다 — 둘째 줄부터 매번 다시 치게 만들지 않는다.
    expect(drawn.querySelector<HTMLInputElement>('[data-manual-search]')!.value).toBe('분배');
    window.remove();
  });

  it('folds the loadout summary away until it is asked for', () => {
    render();
    const fold = root.querySelector<HTMLElement>('[data-loadout-fold]')!;
    const open = root.querySelector<HTMLButtonElement>('[data-loadout-open]')!;
    expect(fold.hidden).toBe(true);
    expect(root.querySelector('[data-loadout-summary]')!.textContent).toContain('スキル');

    open.click();
    expect(fold.hidden).toBe(false);
    // 다시 그려도 펼친 채로 남는다 — 값 하나 바꿀 때마다 접히면 못 쓴다.
    setToggle('[data-custom-toggle]', true);
    expect(root.querySelector<HTMLElement>('[data-loadout-fold]')!.hidden).toBe(false);
  });

  it('names the skip option «안 씀» — it drops the burst, not just delays it', () => {
    setToggle('[data-custom-toggle]', true);
    const select = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    expect([...select.options].map((option) => option.textContent))
      .toEqual(['自動', 'nの倍数で優先使用', '終盤最優先', '使わない']);

    select.value = 'skip';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(value?.burst).toEqual({ mode: 'skip' });
    // 설명도 «가급적»이 아니라 아예 안 쓴다고 적는다.
    expect(root.querySelector('.burst-editor .field-note')!.textContent)
      .toContain('バーストを一切使いません');
  });

  it('carries an overload-0 setting through to the engine request', () => {
    // «0강이 인식 안 된다»는 제보가 있었다 — 0은 흔히 falsy로 걸러지는 값이라
    // 화면→저장→요청 어느 칸에서 새도 조용하다. 그 경로를 못 박는다.
    value = { equipLevels: { 머리: 0, 몸통: 0, 팔: 0, 다리: 0 } };
    render();
    const head = root.querySelector<HTMLSelectElement>('[data-equip-level="머리"]')!;
    expect(head.value).toBe('0');
    // 계산기가 0강 아래를 구분하지 못한다는 사실을 화면에 적어 둔다.
    expect(root.querySelector('.equip-editor .field-note')!.textContent)
      .toContain('強化0以下(T9企業含む)はすべてオーバーロード強化0として計算します');

    const arm = root.querySelector<HTMLSelectElement>('[data-equip-level="팔"]')!;
    arm.value = '0';
    arm.dispatchEvent(new Event('change'));
    expect(value?.equipLevels).toEqual({ 머리: 0, 몸통: 0, 팔: 0, 다리: 0 });
  });

  it('keeps an older plain-tier setting selectable instead of silently moving it', () => {
    // 목록에서 뺀 일반 등급이라도, 이미 그렇게 적혀 있거나 계정 가져오기가 넣었으면
    // 그대로 남겨 둔다 — 조용히 오버로드로 바뀌면 없던 스탯이 생긴다.
    value = { equipLevels: { 머리: 'T3', 몸통: 'T9', 팔: 5, 다리: 5 } };
    render();
    const head = root.querySelector<HTMLSelectElement>('[data-equip-level="머리"]')!;
    expect(head.value).toBe('T3');
    expect([...head.options].map((option) => option.textContent)).toContain('T3 (旧設定)');
    const body = root.querySelector<HTMLSelectElement>('[data-equip-level="몸통"]')!;
    expect(body.value).toBe('T9');
    expect([...body.options].map((option) => option.textContent)).toContain('T9 (旧設定)');
  });

  it('lets a character wear no cube at all', () => {
    setToggle('[data-custom-toggle]', true);
    const cube = root.querySelector<HTMLSelectElement>('[data-cube-name]')!;
    expect([...cube.options][0]!.value).toBe('없음');

    cube.value = '없음';
    cube.dispatchEvent(new Event('change'));
    // 레벨은 뜻이 없으므로 0으로 못 박고, 레벨 칸도 잠근다.
    expect(value?.cube).toEqual({ name: '없음', level: 0 });
    expect(root.querySelector<HTMLSelectElement>('[data-cube-level]')!.disabled).toBe(true);
    expect(root.querySelector('.cube-summary')!.textContent).toContain('キューブを装着しません');
    expect(root.querySelector('[data-loadout-summary]')!.textContent).toContain('キューブなし');

    // 다시 큐브를 고르면 레벨이 되살아난다.
    const first = root.querySelector<HTMLSelectElement>('[data-cube-name]')!.options[1]!.value;
    const back = root.querySelector<HTMLSelectElement>('[data-cube-name]')!;
    back.value = first;
    back.dispatchEvent(new Event('change'));
    expect(value?.cube).toEqual({ name: first, level: 15 });
  });

  it('offers an endgame-first burst window and sends it as seconds', () => {
    setToggle('[data-custom-toggle]', true);
    const select = root.querySelector<HTMLSelectElement>('[data-burst-assignment]')!;
    expect([...select.options].map((option) => option.value))
      .toEqual(['auto', 'priority', 'endgame', 'skip']);

    const window = () => root.querySelector<HTMLInputElement>('[data-burst-last]')!;
    // 고르기 전에는 칸이 숨어 있다.
    expect(window().closest('label')!.hidden).toBe(true);

    select.value = 'endgame';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector<HTMLInputElement>('[data-burst-last]')!.closest('label')!.hidden)
      .toBe(false);
    expect(value?.burst).toEqual({ mode: 'endgame', seconds: 20 });

    const input = root.querySelector<HTMLInputElement>('[data-burst-last]')!;
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.burst).toEqual({ mode: 'endgame', seconds: 12 });

    // 비우거나 0을 넣으면 기본값으로 돌아가고, 상한을 넘으면 잘라 담는다 —
    // 엔진이 거절하는 값을 보내지 않는다.
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.burst).toEqual({ mode: 'endgame', seconds: 20 });
    input.value = '500';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(value?.burst).toEqual({ mode: 'endgame', seconds: 180 });
  });

  it('omits the buff-target row for characters without a watched buff', () => {
    render();
    expect(root.querySelector('[data-buff-target]')).toBeNull();
  });

  it('keeps 버스트 운용 inside the 컨트롤 · 버스트 fold', () => {
    setToggle('[data-custom-toggle]', true);
    const fold = root.querySelector<HTMLElement>('[data-control-open]')!;
    // 접이판 안에 있고, 본문(돌파·스킬·오버로드·큐브)에는 남아 있지 않다.
    expect(fold.nextElementSibling!.querySelector('.burst-editor')).not.toBeNull();
    expect(root.querySelector('.character-settings-body .burst-editor')).toBeNull();
    expect(root.querySelector('[data-burst-assignment]')).not.toBeNull();
  });

  it('keeps numeric input focused while consecutive digits are entered', () => {
    setToggle('[data-custom-toggle]', true);
    const input = root.querySelector<HTMLInputElement>('[data-overload-key="atk_pct"]')!;
    input.focus();
    input.value = '4';
    input.dispatchEvent(new Event('input'));

    expect(root.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
    input.value = '40';
    input.dispatchEvent(new Event('input'));
    expect(value?.overload?.atk_pct).toBe(40);
  });
});
