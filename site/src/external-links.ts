// 他の人が作った NIKKE ツールへのリンク。
//
// **ここに書かれた先は私たちが運営していない。** アドレスも内容も先方の都合でいつでも変わるので、
// リンクを計算機の画面のあちこちに散らさず、この表ひとつにまとめる — 直す場所が一箇所になる。
//
// 新しいリンクを入れるときはこの配列に一行足すだけでよい。`label` は人が実際に呼ぶ名前を
// そのまま使う。
//
// (しりすこスクワッド: 上流の韓国コミュニティ向けリンク集は引き継がず、日本のしりすこ圏向けに差し替えた)

export interface ExternalLink {
  /** 人が呼ぶ名前。画面にそのまま出る。 */
  label: string;
  /** 何をする場所か一行。開く前に判断できるように。 */
  note: string;
  url: string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    label: 'しりすこPAD',
    note: 'ユニオンレイドの提出・戦況管理 (ユニオンメンバー向け)',
    url: 'https://furu1018.github.io/shirisu-pad/',
  },
  {
    label: 'しりすこPAD GB',
    note: 'ふるり値チェッカー — 提出前のセルフチェック',
    url: 'https://shirisuko-pad-gb.github.io/',
  },
  {
    label: 'nikke-calc (原作)',
    note: 'このサイトの元になった韓国語版の計算機 (moris-kr 版)',
    url: 'https://moris-kr.github.io/nikke-calc/',
  },
  {
    label: 'Blablalink',
    note: 'NIKKE 公式コミュニティ — 「マイニケ」を公開すると育成状態を取り込める',
    url: 'https://www.blablalink.com/',
  },
];

/** アドレスから人が読み取れる部分だけ。カードに「letsdoro.com」のように書いて行き先が見えるようにする。 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
