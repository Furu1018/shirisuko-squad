import { elementLabel, labelFor } from './display-name';
import { formatDamage } from './model';
import { statText } from './stat-names';
import { spanTargets } from './types';
import type { BattleTimeline, BuffSpan, BuffTrack, DeckResultEntry } from './types';

// 白地に描くので、線も文字も濃い側で揃える (元は暗い背景に乗せる淡い色だった)。
// 5人ぶんが隣り合っても見分けられるよう、色相を離してある。
const LINE_COLORS = ['#6C42F0', '#D9770E', '#0E9F6E', '#2E8BFF', '#D93E7A'];

/** 白地の canvas で使う色。CSS のトークンと役割を合わせてある。 */
const CANVAS = {
  ink: '#14161A',
  sub: '#6B7178',
  faint: '#6F747B',   /* 10px の軸ラベルに使うので、白地で読める濃さ */
  grid: 'rgba(20,22,26,0.10)',
  gridFaint: 'rgba(20,22,26,0.06)',
  fullBurst: 'rgba(245,158,11,0.14)',
  bandLabel: 'rgba(20,22,26,0.62)',
  immune: 'rgba(255,61,68,0.14)',
  element: 'rgba(46,139,255,0.14)',
  pinFace: '#FFFFFF',
  crosshair: 'rgba(20,22,26,0.28)',
};
const MIN_SPAN = 4; // 최대 확대: 화면에 4초까지

// バースト表記 — 時刻に**顔を挿す**。色を凡例と照合する必要がなく、誰が使ったかが
// すぐ読める。同じ時刻に複数人が使うとき (B1→B2→B3 は常にそうなる) は階段状にずらして
// 互いに隠れないようにする。
const PIN_R = 11;          // 초상화 원 반지름
const PIN_GAP = 4;         // 원과 원 사이 최소 여백
const PIN_STEPS = 3;       // 핀 행 수 — 이보다 동시에 많을 때만 가장 오래 빈 행을 재사용한다
const PIN_STEP = PIN_R * 2 + PIN_GAP;
const PIN_LANE = PIN_R * 2 * PIN_STEPS + PIN_GAP * (PIN_STEPS - 1) + 14;

// バフのバー — グラフの**上側**に積む。重なるバフは下の行へ押しやって互いに隠れないようにし、
// 行数が増えるとグラフが残らないので上限を置く (あふれた分は描かず、その数だけを書く)。
const BUFF_H = 15;          // 막대 높이
const BUFF_GAP = 3;         // 줄 간격
const BUFF_ROWS_MAX = 12;   // 최대 줄 수 — 넘으면 «+n줄 더»만 적는다
const BUFF_PAD = 8;         // 레인과 그래프 사이 여백
const BUFF_STACK_W = 20;    // 막대 오른쪽 «중첩 수» 자리 — 이름보다 이쪽이 우선이다
const BUFF_MIN_W = 6;       // 이보다 좁으면 글자를 넣지 않는다
const BASE_H = 424;         // 그래프만 있을 때 높이(CSS와 같은 값) — 레인은 이 위로 더 붙는다

export interface TimelineSeries {
  names: string[];
  colors: Record<string, string>;
  damage: Record<string, number[]>;
  totals: Record<string, number>;
  bursts: Record<string, { t: number; stage: string }[]>;
  fullBurst: [number, number][];
  /** 回避区間 — 通常攻撃が外れる区間。タイムラインに赤いバンドで敷く。 */
  immuneWindows: Array<{ from: number; to: number }>;
  /** 属性制限 — 有利コードだけを通す区間。青いバンドで敷く。 */
  elementWindows: Array<{ from: number; to: number; code: string }>;
  /** バフがかかっていた区間。「バフ表示」をオンにしたときだけ描く。 */
  buffs: BuffTrack[];
  peak: number;
  buckets: number;
  /**
   * バケット1マスの長さ (秒)。«何番目のマスが何秒か» はすべてこの値で換算する —
   * 1秒バケットで保存された昔の結果も同じ勘定で描かれる。
   */
  bucket: number;
  duration: number;
}

/** 画面上に置かれた1区間 — ピクセル位置とスタック数。 */
export interface BuffPart { x0: number; x1: number; stack: number; span: BuffSpan; }

/** 隣接する区間をひとつのバーにまとめたもの。内側の境界は目盛り線でだけ引く。 */
export interface BuffRun { x0: number; x1: number; parts: BuffPart[]; }

/**
 * 隣接する区間をひとつのバーにまとめる。
 *
 * スタックが細かく上下するバフ (例: 릴렉스は231区間) を区間ごとに角丸の矩形で描くと
 * 行全体がバーコードになる。**途切れた場所でだけ**バーを分け、スタックが変わった場所は
 * バーの内側の目盛り線で示す — 拡大すればマスが広がって数字がまた現れる。
 */
export function buffRuns(parts: BuffPart[]): BuffRun[] {
  const runs: BuffRun[] = [];
  for (const part of parts) {
    const last = runs[runs.length - 1];
    if (last && part.x0 - last.x1 <= 1) {
      last.x1 = Math.max(last.x1, part.x1);
      last.parts.push(part);
    } else {
      runs.push({ x0: part.x0, x1: part.x1, parts: [part] });
    }
  }
  return runs;
}

/**
 * バー1本に何を書くか。**スタック数が名前より優先だ** — 狭くなれば名前から削られ、
 * それでも足りなければ名前は書かない。スタック数は右端に別枠の席をもらう。
 */
export function buffTextPlan(width: number, stacked: boolean):
  { stack: boolean; nameRoom: number } {
  const stack = stacked && width >= BUFF_MIN_W;
  const right = width - 4 - (stack ? BUFF_STACK_W : 0);
  return { stack, nameRoom: right - 5 };
}

/** 角丸の矩形。古い Safari にもある道で描く (`roundRect` が無い版がある)。 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 与えられた幅に収まるよう切り詰める。入り切らなければ «…» を付ける。 */
function fitText(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (ctx.measureText(text).width <= room) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** 秒間ダメージのシリーズを、1つのグラフに重ねて描きやすい形に整える (純関数)。 */
export function buildSeries(
  timeline: BattleTimeline,
  squad: string[],
  duration: number,
  phases: {
    immuneWindows?: Array<{ from: number; to: number }>;
    elementWindows?: Array<{ from: number; to: number; code: string }>;
  } = {},
): TimelineSeries | null {
  const names = squad.filter((name) => timeline.damage[name]);
  if (names.length === 0 || timeline.buckets <= 0 || duration <= 0) return null;

  const colors: Record<string, string> = {};
  const totals: Record<string, number> = {};
  let peak = 0;
  names.forEach((name, index) => {
    colors[name] = LINE_COLORS[index % LINE_COLORS.length]!;
    const row = timeline.damage[name] ?? [];
    totals[name] = row.reduce((sum, value) => sum + value, 0);
    for (const value of row) if (value > peak) peak = value;
  });

  return {
    names,
    colors,
    damage: timeline.damage,
    totals,
    bursts: timeline.bursts,
    fullBurst: timeline.fullBurst,
    immuneWindows: phases.immuneWindows ?? [],
    elementWindows: phases.elementWindows ?? [],
    // このデッキにいない人がかけたバフは色を与えられないので除く (昔の結果には一覧自体が無い)。
    buffs: (timeline.buffs ?? []).filter((track) => names.includes(track.caster)),
    peak,
    buckets: timeline.buckets,
    // 昔の結果にはこの値が無いことがある — その頃は1秒バケットだった。
    bucket: timeline.bucket > 0 ? timeline.bucket : 1,
    duration,
  };
}

/**
 * ツールチップに書く区間。バケットが1秒なら «12–13秒»、0.1秒なら «12.3–12.4秒» と書く —
 * 小数桁はバケットの大きさから取るので、マスがさらに細かく割れてもそのまま合う。
 */
export function formatSpan(index: number, bucket: number): string {
  // 小数桁はバケット値からそのまま数える — 0.1 なら1桁、0.25 なら2桁だ。
  const digits = Number.isInteger(bucket)
    ? 0 : Math.min(3, (String(bucket).split('.')[1] ?? '').length);
  const from = index * bucket;
  return `${from.toFixed(digits)}–${(from + bucket).toFixed(digits)}秒`;
}

/** peak 以上で、軸目盛りとしてきれいな上限値。 */
export function niceMax(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (peak <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

const X_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120];

function xTickStep(span: number): number {
  for (const step of X_STEPS) {
    if (span / step <= 8) return step;
  }
  return X_STEPS[X_STEPS.length - 1]!;
}

interface Rect { left: number; top: number; width: number; height: number; }

class TimelineChart {
  private ctx: CanvasRenderingContext2D | null;
  private view0: number;
  private view1: number;
  private hidden = new Set<string>();
  private hoverIndex: number | null = null;
  /** 「バフ表示」がオンか。オフのときはレーン自体を作らない (グラフがその分広くなる)。 */
  private showBuffs = false;
  /** 画面に描いたバーとその位置 — マウスがどのバフの上にあるかをこれで探す。 */
  private buffHits: Array<{
    track: BuffTrack; span: BuffSpan; x0: number; x1: number; y: number;
  }> = [];
  private hoverSpan: BuffSpan | null = null;
  /** 描く行。1行がバフ1つだ — オンにしたときと凡例が変わったときに選び直す。 */
  private buffRows: BuffTrack[] = [];
  private buffHidden = 0;
  /** 「+n行を表示」を押して全部広げた状態か。広げるとレーンが伸び、グラフがその分低くなる。 */
  private buffExpanded = false;
  /** 「+n行を表示」の文字の位置 — ここを押すと広がる。 */
  private buffMoreHit: { x0: number; x1: number; y0: number; y1: number } | null = null;
  private plot: Rect = { left: 0, top: 0, width: 0, height: 0 };
  private dragging = false;
  /** 押した後に実際にドラッグしたか。ドラッグしていなければ «押した» とみなす。 */
  private dragMoved = false;
  private lastX = 0;

  private portraits = new Map<string, HTMLImageElement>();

  constructor(
    private canvas: HTMLCanvasElement,
    private tooltip: HTMLElement,
    private series: TimelineSeries,
    portraitUrls: Record<string, string> = {},
  ) {
    this.ctx = canvas.getContext('2d');
    this.view0 = 0;
    this.view1 = series.duration;
    // キャンバスは画像が用意できてこそ描ける — 届くたびに描き直す。
    // 受け取れなくても (オフライン・404) 名前の頭文字で代わりに描くので、画面は空にならない。
    for (const [name, url] of Object.entries(portraitUrls)) {
      const img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', () => this.draw());
      img.src = url;
      this.portraits.set(name, img);
    }
    this.bindEvents();
  }

  setHidden(name: string, hidden: boolean): void {
    if (hidden) this.hidden.add(name); else this.hidden.delete(name);
    // バフ行は «見えているキャラ» だけを載せる — 凡例で1人だけ残せばその人のバフが全部見える。
    if (this.showBuffs) this.packBuffs();
    this.draw();
  }

  zoomBy(factor: number, centerT?: number): void {
    const span = this.view1 - this.view0;
    const center = centerT ?? (this.view0 + span / 2);
    let newSpan = Math.min(this.series.duration, Math.max(MIN_SPAN, span * factor));
    const ratio = (center - this.view0) / span;
    let v0 = center - ratio * newSpan;
    this.setView(v0, v0 + newSpan);
  }

  reset(): void {
    this.setView(0, this.series.duration);
  }

  private setView(v0: number, v1: number): void {
    let span = Math.min(this.series.duration, Math.max(MIN_SPAN, v1 - v0));
    let start = Math.max(0, Math.min(v0, this.series.duration - span));
    this.view0 = start;
    this.view1 = start + span;
    this.draw();
  }

  /** バフレーンが占める高さ。オフのとき、または描くものが無ければ 0 だ。 */
  private buffLaneHeight(): number {
    if (!this.showBuffs || this.buffRows.length === 0) return 0;
    return this.buffRows.length * (BUFF_H + BUFF_GAP) + BUFF_PAD;
  }

  private layout(): Rect {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.width;
    const height = rect.height || this.canvas.height;
    // 上側にバフレーン、下側に軸 (34) + ピンレーンの分を空けておく。
    const lane = this.buffLaneHeight();
    return { left: 58, top: 12 + lane, width: Math.max(1, width - 58 - 14),
             height: Math.max(1, height - 12 - lane - 34 - PIN_LANE) };
  }

  /**
   * バフを行に分ける。**1行は «バフ1つ» だ** — 同じバフが20回かけ直されても
   * 1行に並んで横たわる。時間の重なりだけ見て空いた行に載せると、同じバフが行ごとに
   * 散らばって、何が何回かかったのかが読めない (実測: 5人180秒で400マス/47バフ)。
   *
   * 凡例でオフにしたキャラのバフはそもそも除くので、1人だけ残せば7〜14行まで落ちる。
   * それでも上限を超えるならそれ以上は載せず、何行描けなかったかだけを書く。
   */
  private packBuffs(): void {
    const order = new Map(this.series.names.map((name, index) => [name, index]));
    const rows = this.series.buffs
      .filter((track) => !this.hidden.has(track.caster) && track.spans.length > 0)
      .sort((a, b) => {
        const byCaster = (order.get(a.caster) ?? 99) - (order.get(b.caster) ?? 99);
        return byCaster !== 0 ? byCaster : a.spans[0]![0] - b.spans[0]![0];
      });
    const cap = this.buffExpanded ? rows.length : BUFF_ROWS_MAX;
    this.buffRows = rows.slice(0, cap);
    this.buffHidden = Math.max(0, rows.length - cap);
  }

  /** 「バフ表示」のオン・オフ。 */
  setShowBuffs(on: boolean): void {
    this.showBuffs = on && this.series.buffs.length > 0;
    if (this.showBuffs) this.packBuffs();
    this.hoverSpan = null;
    this.draw();
  }

  get hasBuffs(): boolean {
    return this.series.buffs.length > 0;
  }

  private xFor(t: number): number {
    return this.plot.left + ((t - this.view0) / (this.view1 - this.view0)) * this.plot.width;
  }

  private tFor(px: number): number {
    return this.view0 + ((px - this.plot.left) / this.plot.width) * (this.view1 - this.view0);
  }

  resize(): void {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /**
   * バフレーンが付いた分だけ盤面を大きくする。
   *
   * レーンをグラフの中で分け合うと、行が増えるほどグラフが平たくなる — だから盤面が
   * 下へ伸びる。「+n行を表示」で全部広げればその分さらに長くなる。
   * 高さを変えたら `true` を返す (その盤面に合わせて描き直しが要る)。
   */
  private syncHeight(): boolean {
    const wrap = this.canvas.parentElement;
    if (!wrap) return false;
    const want = `${BASE_H + this.buffLaneHeight()}px`;
    if (wrap.style.height === want) return false;
    wrap.style.height = want;
    return true;
  }

  draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.syncHeight()) { this.resize(); return; }
    this.plot = this.layout();
    const { left, top, width, height } = this.plot;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);

    const yMax = niceMax(this.series.peak);
    const yFor = (v: number) => top + height - (v / yMax) * height;

    // フルバーストのバンド
    for (const [s, e] of this.series.fullBurst) {
      if (e < this.view0 || s > this.view1) continue;
      const x0 = Math.max(left, this.xFor(s));
      const x1 = Math.min(left + width, this.xFor(e));
      ctx.fillStyle = CANVAS.fullBurst;
      ctx.fillRect(x0, top, Math.max(0, x1 - x0), height);
    }

    // ボスフェーズのバンド — 回避区間は赤く (通常攻撃が外れる)、属性制限は青く
    // (有利コードだけ通る)。フルバーストのバンドと同じ描き方なので一緒に読める。
    const band = (from: number, to: number, fill: string, label: string) => {
      if (to < this.view0 || from > this.view1) return;
      const x0 = Math.max(left, this.xFor(from));
      const x1 = Math.min(left + width, this.xFor(to));
      const w = Math.max(0, x1 - x0);
      if (w <= 0) return;
      ctx.fillStyle = fill;
      ctx.fillRect(x0, top, w, height);
      // 狭い区間に文字を押し込むとかえって読めない。
      if (w >= 26) {
        ctx.fillStyle = CANVAS.bandLabel;
        ctx.font = '700 9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, x0 + w / 2, top + 3);
      }
    };
    for (const w of this.series.immuneWindows) {
      band(w.from, w.to, CANVAS.immune, '回避区間');
    }
    for (const w of this.series.elementWindows) {
      band(w.from, w.to, CANVAS.element, `属性制限 ${elementLabel(w.code)}`);
    }
    ctx.textAlign = 'left';

    // y グリッド + ラベル
    ctx.font = '10px Pretendard, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const value = (yMax / 4) * i;
      const y = yFor(value);
      ctx.strokeStyle = CANVAS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.fillStyle = CANVAS.sub;
      ctx.textAlign = 'right';
      ctx.fillText(formatDamage(value), left - 6, y);
    }

    // x 目盛り + ラベル
    const span = this.view1 - this.view0;
    const step = xTickStep(span);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const first = Math.ceil(this.view0 / step) * step;
    for (let t = first; t <= this.view1 + 1e-6; t += step) {
      const x = this.xFor(t);
      ctx.strokeStyle = CANVAS.gridFaint;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      ctx.fillStyle = CANVAS.faint;
      ctx.fillText(`${Math.round(t)}s`, x, top + height + 8);
    }

    // バフのバー — グラフ上側のレーン。色は «かけた人» の色だ。
    this.buffHits = [];
    if (this.showBuffs && this.buffRows.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 12, width, this.buffLaneHeight());
      ctx.clip();
      ctx.textBaseline = 'middle';
      this.buffRows.forEach((track, rowIndex) => {
        const y = 12 + rowIndex * (BUFF_H + BUFF_GAP);
        const color = this.series.colors[track.caster] ?? CANVAS.faint;
        const parts: BuffPart[] = [];
        for (const span of track.spans) {
          const [from, to, stack] = span;
          if (to < this.view0 || from > this.view1) continue;
          const x0 = Math.max(left, this.xFor(from));
          const x1 = Math.max(x0 + 2, Math.min(left + width, this.xFor(to)));
          parts.push({ x0, x1, stack, span });
        }
        for (const run of buffRuns(parts)) {
          const runW = run.x1 - run.x0;
          const hot = run.parts.some((part) => this.hoverSpan === part.span);
          ctx.fillStyle = hot ? `${color}66` : `${color}33`;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          roundRect(ctx, run.x0, y, runW, BUFF_H, 4);
          ctx.fill();
          ctx.stroke();

          // スタックが変わった場所は目盛り線だけを引く — マスごとに矩形を描くとバーコードになる。
          // 数字を書けないほど狭いマスは目盛り線も畳む (拡大すればまた現れる)。
          for (const part of run.parts) {
            this.buffHits.push({ track, span: part.span, x0: part.x0, x1: part.x1, y });
            if (part === run.parts[0] || part.x1 - part.x0 < BUFF_MIN_W) continue;
            ctx.strokeStyle = `${color}88`;
            ctx.beginPath();
            ctx.moveTo(part.x0, y + 2);
            ctx.lineTo(part.x0, y + BUFF_H - 2);
            ctx.stroke();
          }

          // 名前はバー1本に1回だけ書く — 細かく分かれたマスごとに書くと読めない。
          const stacked = track.maxStack > 1;
          const nameRoom = buffTextPlan(runW, stacked).nameRoom;
          let nameEnd = run.x0;
          if (nameRoom >= BUFF_MIN_W) {
            // 帯は系列色の淡い塗り。文字は濃い方に寄せないと 10px では読めない
            ctx.fillStyle = CANVAS.ink;
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            const label = fitText(ctx, track.name, nameRoom);
            ctx.fillText(label, run.x0 + 5, y + BUFF_H / 2);
            nameEnd = run.x0 + 5 + ctx.measureText(label).width + 4;
          }
          // スタック数が名前より優先だ — ただし名前の文字には上書きしない。
          if (stacked) {
            ctx.font = '700 10px ui-monospace, monospace';
            ctx.textAlign = 'right';
            for (const part of run.parts) {
              if (!buffTextPlan(part.x1 - part.x0, true).stack) continue;
              if (part.x1 - 4 < nameEnd) continue;
              // 帯は系列色の淡い塗り。数字も濃い側に固定しないと 10px では読めない
              ctx.fillStyle = CANVAS.ink;
              ctx.fillText(String(part.stack), part.x1 - 4, y + BUFF_H / 2);
            }
          }
        }
      });
      ctx.restore();
      this.buffMoreHit = null;
      if (this.buffHidden > 0 || this.buffExpanded) {
        const label = this.buffExpanded ? '折りたたむ' : `+${this.buffHidden}行を表示`;
        ctx.fillStyle = CANVAS.sub;
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const ty = 12 + this.buffLaneHeight() - BUFF_PAD;
        ctx.fillText(label, left + width, ty);
        const tw = ctx.measureText(label).width;
        this.buffMoreHit = { x0: left + width - tw - 6, x1: left + width + 4, y0: ty - 3, y1: ty + 13 };
      }
    }

    // 各キャラクターのライン
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    for (const name of this.series.names) {
      if (this.hidden.has(name)) continue;
      const row = this.series.damage[name] ?? [];
      ctx.strokeStyle = this.series.colors[name]!;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < row.length; i += 1) {
        const t = (i + 0.5) * this.series.bucket;
        if (t < this.view0 - step || t > this.view1 + step) continue;
        const x = this.xFor(t);
        const y = yFor(row[i]!);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // バーストのピン — プロット下のレーンに**顔**を挿す。
    // 時刻順に集めておき、互いに近ければ階段状にずらして重ならないようにする。
    const pins: Array<{ t: number; name: string; stage: string }> = [];
    for (const name of this.series.names) {
      if (this.hidden.has(name)) continue;
      for (const cast of this.series.bursts[name] ?? []) {
        if (cast.t < this.view0 || cast.t > this.view1) continue;
        pins.push({ t: cast.t, name, stage: cast.stage });
      }
    }
    pins.sort((a, b) => a.t - b.t);

    const laneTop = top + height + 8;
    const tierLastX = Array<number>(PIN_STEPS).fill(-Infinity);
    for (const pin of pins) {
      const x = this.xFor(pin.t);
      // 同じ行の前のピンと直径+余白ぶん離れる最初の行を選ぶ。3行とも
      // 埋まっていたら、いちばん長く空いていた行を再利用して重なりを最小にする。
      let tier = tierLastX.findIndex((lastX) => x - lastX >= PIN_STEP);
      if (tier < 0) tier = tierLastX.indexOf(Math.min(...tierLastX));
      tierLastX[tier] = x;
      const cy = laneTop + PIN_R + tier * PIN_STEP;
      const color = this.series.colors[pin.name]!;

      // グラフから降りてくる線 — どの時刻かを目で繋げる。
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, top + height);
      ctx.lineTo(x, cy - PIN_R);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 顔 (円形に切り抜いて入れる)。まだ届いていなければ名前の頭文字で代用する。
      const img = this.portraits.get(pin.name);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, cy, PIN_R, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (img?.complete && img.naturalWidth > 0) {
        const side = PIN_R * 2;
        ctx.drawImage(img, x - PIN_R, cy - PIN_R - PIN_R * 0.25, side, side * 1.25);
      } else {
        ctx.fillStyle = CANVAS.pinFace;
        ctx.fillRect(x - PIN_R, cy - PIN_R, PIN_R * 2, PIN_R * 2);
        // 白い顔の上に系列色の文字だと 3.2:1 ほどしか出ない。誰の印かは外周の色線で分かる
        ctx.fillStyle = CANVAS.ink;
        ctx.font = '700 10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelFor(pin.name).slice(0, 1), x, cy);
      }
      ctx.restore();

      // キャラ色の縁取り — グラフの線と同じ色なので、どの線の主かも繋がる。
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(x, cy, PIN_R, 0, Math.PI * 2);
      ctx.stroke();

      // バースト段階 — 右下の小さなバッジ。
      if (pin.stage) {
        const bx = x + PIN_R * 0.72;
        const by = cy + PIN_R * 0.72;
        // 8px の数字なので、地は濃く固定して白抜きにする (系列色の地だと 3.2:1 ほど)
        ctx.fillStyle = CANVAS.ink;
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CANVAS.pinFace;
        ctx.font = '900 8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pin.stage, bx, by);
      }
    }

    // ホバーのクロスヘア + ポイント
    if (this.hoverIndex !== null) {
      const t = (this.hoverIndex + 0.5) * this.series.bucket;
      if (t >= this.view0 && t <= this.view1) {
        const x = this.xFor(t);
        ctx.strokeStyle = CANVAS.crosshair;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + height);
        ctx.stroke();
        for (const name of this.series.names) {
          if (this.hidden.has(name)) continue;
          const value = this.series.damage[name]?.[this.hoverIndex] ?? 0;
          ctx.fillStyle = this.series.colors[name]!;
          ctx.beginPath();
          ctx.arc(x, yFor(value), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private showTooltip(clientX: number, clientY: number): void {
    if (this.hoverIndex === null) { this.tooltip.style.display = 'none'; return; }
    const index = this.hoverIndex;
    const rows = this.series.names
      .filter((name) => !this.hidden.has(name))
      .map((name) => ({ name, value: this.series.damage[name]?.[index] ?? 0, color: this.series.colors[name]! }))
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const lines = rows.map((row) =>
      `<div class="tl-tip-row"><span class="tl-dot" style="background:${row.color}"></span>` +
      `<span class="tl-name">${labelFor(row.name)}</span><span class="tl-val">${formatDamage(row.value)}</span></div>`,
    ).join('');
    this.tooltip.innerHTML =
      `<div class="tl-tip-time">${formatSpan(index, this.series.bucket)}</div>${lines}` +
      `<div class="tl-tip-total"><span>合計</span><span>${formatDamage(total)}</span></div>`;
    const host = this.canvas.parentElement!.getBoundingClientRect();
    let px = clientX - host.left + 14;
    if (px + 180 > host.width) px = clientX - host.left - 194;
    this.tooltip.style.left = `${Math.max(4, px)}px`;
    this.tooltip.style.top = `${Math.max(4, clientY - host.top + 12)}px`;
    this.tooltip.style.display = 'block';
  }

  /** バフのバー1本の詳細。「何を・誰が・誰に・いつからいつまで・何重か」を書く。 */
  private showBuffTip(track: BuffTrack, span: BuffSpan,
    clientX: number, clientY: number): void {
    const seconds = (value: number) => `${value.toFixed(1)}秒`;
    const [from, to, stack] = span;
    // 対象が発動ごとに変わるバフがある — この区間を実際に受けた人だけを見せる。
    const faces = spanTargets(track, span).map((name) => {
      const url = this.portraits.get(name)?.src;
      const dot = `<span class="tl-dot" style="background:${this.series.colors[name] ?? CANVAS.faint}"></span>`;
      return url
        ? `<img class="tl-face" src="${url}" alt="${labelFor(name)}" title="${labelFor(name)}" />`
        : `<span class="tl-face tl-face-none" title="${labelFor(name)}">${dot}</span>`;
    }).join('');
    const rows: string[] = [
      `<div class="tl-tip-row"><span class="tl-name">持続</span>` +
      `<span class="tl-val">${seconds(from)} → ${seconds(to)} (${seconds(to - from)})</span></div>`,
      `<div class="tl-tip-row"><span class="tl-name">発動者</span><span class="tl-val">${labelFor(track.caster)}</span></div>`,
    ];
    if (track.stat) {
      // エンジンのキーは英語だ — 画面には日本語で書き、元のキーはマウスを乗せると出る。
      rows.push(`<div class="tl-tip-row"><span class="tl-name">効果</span>`
        + `<span class="tl-val" title="${track.stat}">${statText(track.stat, track.value)}</span></div>`);
    }
    if (track.maxStack > 1) {
      rows.push(`<div class="tl-tip-row"><span class="tl-name">スタック</span>` +
        `<span class="tl-val">${stack} / ${track.maxStack}</span></div>`);
    }
    // 受ける人は顔で見せる — 5人にかかるバフを名前で並べると長いだけになる。
    const targets = faces
      ? `<div class="tl-tip-faces"><span class="tl-name">対象</span><span>${faces}</span></div>`
      : '';
    this.tooltip.innerHTML =
      `<div class="tl-tip-time">${track.name}</div>${rows.join('')}${targets}`;
    const host = this.canvas.parentElement!.getBoundingClientRect();
    let px = clientX - host.left + 14;
    if (px + 220 > host.width) px = clientX - host.left - 234;
    this.tooltip.style.left = `${Math.max(4, px)}px`;
    this.tooltip.style.top = `${Math.max(4, clientY - host.top + 12)}px`;
    this.tooltip.style.display = 'block';
  }

  private bindEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      if (this.dragging) {
        const dx = event.clientX - this.lastX;
        this.lastX = event.clientX;
        if (Math.abs(dx) > 2) this.dragMoved = true;
        const dt = (dx / this.plot.width) * (this.view1 - this.view0);
        this.setView(this.view0 - dt, this.view1 - dt);
        return;
      }
      // バフレーンの上ではそのバーを掴む — グラフのホバーと混ざるとどちらも読めない。
      const y = event.clientY - rect.top;
      const overBuff = this.buffHits.find((hit) =>
        y >= hit.y && y <= hit.y + BUFF_H
        && event.clientX - rect.left >= hit.x0 && event.clientX - rect.left <= hit.x1);
      if (this.showBuffs && overBuff) {
        this.hoverSpan = overBuff.span;
        this.hoverIndex = null;
        this.draw();
        this.showBuffTip(overBuff.track, overBuff.span, event.clientX, event.clientY);
        return;
      }
      this.hoverSpan = null;
      const more = this.buffMoreHit;
      canvas.style.cursor = this.showBuffs && more
        && event.clientX - rect.left >= more.x0 && event.clientX - rect.left <= more.x1
        && y >= more.y0 && y <= more.y1 ? 'pointer' : 'crosshair';
      const t = this.tFor(event.clientX - rect.left);
      const index = Math.floor(t / this.series.bucket);
      this.hoverIndex = index >= 0 && index < this.series.buckets ? index : null;
      this.draw();
      this.showTooltip(event.clientX, event.clientY);
    });
    const end = (event: PointerEvent) => {
      // ドラッグしたなら図を動かしたのであり、そのまま離したなら押したのだ —
      // 二つを分けないと «+n行を表示» は永遠に押せない。
      const wasDrag = this.dragging && this.dragMoved;
      this.dragging = false;
      this.dragMoved = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      if (wasDrag || !this.showBuffs || !this.buffMoreHit) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = this.buffMoreHit;
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) {
        this.buffExpanded = !this.buffExpanded;
        this.packBuffs();
        this.draw();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      this.hoverIndex = null;
      this.hoverSpan = null;
      this.tooltip.style.display = 'none';
      this.draw();
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const centerT = this.tFor(event.clientX - rect.left);
      this.zoomBy(event.deltaY > 0 ? 1.2 : 0.8, centerT);
    }, { passive: false });
  }
}

/** デッキ結果に付けるインタラクティブなタイムラインブロックを作る。タイムラインが無ければ null。 */
export function createTimelineBlock(
  entry: DeckResultEntry,
  portraitUrls: Record<string, string> = {},
): HTMLElement | null {
  const timeline = entry.result.timeline;
  if (!timeline) return null;
  const squad = entry.request.squad.filter(Boolean);
  const series = buildSeries(timeline, squad, entry.result.duration, {
    immuneWindows: entry.request.immuneWindows,
    elementWindows: entry.request.elementWindows,
  });
  if (!series) return null;

  const block = document.createElement('div');
  block.className = 'timeline-block';
  block.dataset.timeline = String(entry.deckId);

  const head = document.createElement('div');
  head.className = 'timeline-head';
  const heading = document.createElement('p');
  heading.className = 'timeline-heading';
  heading.textContent = '戦闘タイムライン · 秒間ダメージ';
  const controls = document.createElement('div');
  controls.className = 'timeline-controls';
  const zoomOut = button('−', '縮小');
  const zoomIn = button('+', '拡大');
  const reset = button('全体', '全体表示');
  controls.append(zoomOut, zoomIn, reset);
  head.append(heading, controls);
  block.append(head);

  const legend = document.createElement('div');
  legend.className = 'timeline-legend-row';
  block.append(legend);

  const figure = document.createElement('div');
  figure.className = 'timeline-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'timeline-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'キャラ別の秒間ダメージを1つのグラフに重ねて描くインタラクティブなタイムライン。ドラッグで移動、ホイール・ボタンで拡大縮小。');
  const tooltip = document.createElement('div');
  tooltip.className = 'timeline-tip';
  tooltip.style.display = 'none';
  figure.append(canvas, tooltip);
  block.append(figure);

  const note = document.createElement('p');
  note.className = 'timeline-legend';
  note.textContent = 'ドラッグ移動 · ホイール/ボタンで拡大縮小 · 黄バンド = フルバースト · 赤バンド = 回避区間 · 青バンド = 属性制限 · 下の顔アイコン = バースト使用(バッジは段階)';
  block.append(note);

  const chart = new TimelineChart(canvas, tooltip, series, portraitUrls);
  // バフ表示 — オンにするとグラフの上にバーが積まれ、その分グラフが低くなる。既定はオフだ
  // (バーが数十本あるので、最初からオンにしておくと何を見る画面なのかがぼやける)。
  if (chart.hasBuffs) {
    // 拡大・縮小ボタンと同じ見た目の «オン・オフするボタン» だ。素のチェックボックスのままだと
    // 隣のボタンと大きさ・揃えがずれて画面が乱れる。
    const buffToggle = document.createElement('button');
    buffToggle.type = 'button';
    buffToggle.className = 'timeline-buff-toggle';
    buffToggle.dataset.timelineBuffs = '';
    buffToggle.setAttribute('aria-pressed', 'false');
    buffToggle.title = 'バフがかかっていた区間をグラフ上にバーで表示します。バーにカーソルを乗せると詳細が出ます';
    const mark = textSpan('', 'tl-buff-mark');
    mark.setAttribute('aria-hidden', 'true');
    buffToggle.append(mark, textSpan('バフ表示', ''));
    buffToggle.addEventListener('click', () => {
      const on = buffToggle.getAttribute('aria-pressed') !== 'true';
      buffToggle.setAttribute('aria-pressed', String(on));
      buffToggle.classList.toggle('is-on', on);
      chart.setShowBuffs(on);
    });
    controls.prepend(buffToggle);
  }
  zoomIn.addEventListener('click', () => chart.zoomBy(0.6));
  zoomOut.addEventListener('click', () => chart.zoomBy(1.8));
  reset.addEventListener('click', () => chart.reset());

  for (const name of series.names) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'timeline-legend-item';
    item.dataset.series = name;
    const dot = document.createElement('span');
    dot.className = 'tl-dot';
    dot.style.background = series.colors[name]!;
    item.append(dot, textSpan(labelFor(name), 'tl-name'), textSpan(formatDamage(series.totals[name] ?? 0), 'tl-total'));
    item.addEventListener('click', () => {
      const off = item.classList.toggle('is-off');
      chart.setHidden(name, off);
    });
    legend.append(item);
  }

  // レイアウトが決まってから大きさを測って描く。setTimeout は rAF と違って隠れたタブでも
  // 実行されるので、バックグラウンドで結果が届いても初回の描画が保証される。jsdom (ctx 無し) では
  // resize が黙って無視される。
  setTimeout(() => chart.resize(), 0);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => chart.resize()).observe(figure);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => chart.resize());
  }

  return block;
}

function button(text: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'timeline-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.textContent = text;
  return btn;
}

function textSpan(text: string, className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
