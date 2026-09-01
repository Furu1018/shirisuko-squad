// 更新のお知らせ。新しい内容ができたら**先頭に項目を足すだけ**でよい —
// 画面は「先頭項目の id」を見たことがあるかで表示するか決める。
//
// コミットメッセージをそのまま写さない。ここに書くのは「画面で何が変わったか」で、
// なぜそう直したかはコミットに残す。
//
// (しりすこスクワッド: 上流 nikke-calc の韓国語お知らせは引き継がず、日本語版として書き直した)

export type NoticeTag = '新機能' | '改善' | '修正';

export interface NoticeItem {
  tag: NoticeTag;
  text: string;
}

export interface Notice {
  /** 保存キーにそのまま使う。内容を直したらこの値も変えないと再表示されない。 */
  id: string;
  date: string;
  title: string;
  items: NoticeItem[];
}

/** 最新が先頭。 */
export const NOTICES: Notice[] = [
  {
    id: '2026-09-01-beta',
    date: '2026-09-01',
    title: 'しりすこスクワッド β を公開しました',
    items: [
      { tag: '新機能', text: '韓国製の NIKKE ダメージ計算機 <b>nikke-calc</b> (moris-kr 版・MIT) を日本語化した β 版です。育成状態 (限界突破・スキル・オーバーロード・キューブ・コレクション) を入れると、1/60秒刻みの戦闘シミュレーションで<b>理論ダメージ</b>を出します。計算エンジンとデータは上流のまま — 精度は原作と同じです。' },
      { tag: '新機能', text: '<b>第44回ユニオンレイド (9/4〜)</b> のボス5体をプリセットにしました。ユニオンタブのボス枠と、計算タブの戦闘条件からワンタップで呼び出せます。敵防御力は<b>暫定値</b> (上流既定 31,784) — 実測後に更新します。属性・編成の比較には影響しません。' },
      { tag: '改善', text: 'ユニオンタブを既定のビューにしました。ボス5枠 × デッキ3枠で、<b>自分の3凸をどの属性に振るか</b>を比較する使い方を想定しています。' },
      { tag: '改善', text: 'キャラ名は日本語で表示・検索できます (内部では上流と同じ韓国語キーを使うので、共有コード <b>NK2-/NK3-/NK4-</b> は原作サイトと互換です)。' },
      { tag: '修正', text: 'β の既知の制限: 一部のデータ由来ラベル (ハーモニーキューブ名・上級モードの数値名・バフ名) はまだ韓国語のままです。自作ニケ用の LLM プロンプトも韓国語です。順次日本語化します。' },
    ],
  },
];

/**
 * お知らせ本文を DOM に。許可するのは `<b>` と `<code>` だけ — それ以外のタグは文字のまま残す。
 * innerHTML に流し込まない (お知らせは自分たちが書くものだが、経路として塞いでおく)。
 */
export function noticeFragment(text: string, doc: Document = document): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  // 開きタグと閉じタグを境に切る。対応が取れない断片は文字として残る。
  const parts = text.split(/(<\/?(?:b|code)>)/);
  let open: HTMLElement | null = null;
  for (const part of parts) {
    const opening = /^<(b|code)>$/.exec(part);
    const closing = /^<\/(b|code)>$/.exec(part);
    if (opening && !open) { open = doc.createElement(opening[1]!); fragment.append(open); continue; }
    if (closing && open?.tagName.toLowerCase() === closing[1]) { open = null; continue; }
    if (!part) continue;
    (open ?? fragment).append(doc.createTextNode(part));
  }
  return fragment;
}

export const LATEST_NOTICE_ID = NOTICES[0]?.id ?? '';

/**
 * 表示するお知らせ。見たことのない最新のお知らせがあればそれを、なければ null。
 * 初めて来た人 (`seen === null`) にも出す — 何をする場所かを先に知らせる。
 */
export function noticeToShow(seen: string | null): Notice | null {
  if (NOTICES.length === 0) return null;
  return seen === LATEST_NOTICE_ID ? null : NOTICES[0]!;
}
