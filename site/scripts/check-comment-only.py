# -*- coding: utf-8 -*-
"""「この変更はコメントだけを変えた」ことを機械で証明する。

韓国語コメントの日本語化 (ROADMAP ⑦) の後工程。git HEAD の版と作業ツリーの版から
コメントを剥ぎ、骨格が1バイトも違わないことを見る。// が文字列の中にある等で
剥ぎ方が雑でも、両方の版で同じに雑なので差分としては相殺される。

    python site/scripts/check-comment-only.py          # 作業ツリーの変更ぶんを全部見る

対象: .ts .tsx .css .mjs .js .py .html。Python は docstring もコメント扱い
(翻訳対象に含めている)。raise の中の文字列などは三連引用符ではないので残る。
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def strip_comments(text: str, suffix: str) -> str:
    if suffix == '.py':
        text = re.sub(r'"""[\s\S]*?"""', '""', text)
        text = re.sub(r"'''[\s\S]*?'''", "''", text)
        text = re.sub(r'#[^\n]*', '', text)
    else:
        text = re.sub(r'/\*[\s\S]*?\*/', '', text)
        text = re.sub(r'//[^\n]*', '', text)
        text = re.sub(r'<!--[\s\S]*?-->', '', text)
    return '\n'.join(line.rstrip() for line in text.split('\n'))


def head_version(path: str) -> str:
    out = subprocess.run(['git', 'show', f'HEAD:{path}'], cwd=ROOT, capture_output=True)
    return out.stdout.decode('utf-8') if out.returncode == 0 else ''


def main() -> int:
    changed = subprocess.run(['git', 'diff', '--name-only'], cwd=ROOT,
                             capture_output=True, text=True, encoding='utf-8').stdout.split()
    bad = []
    ok = 0
    for path in changed:
        suffix = Path(path).suffix
        if suffix not in ('.ts', '.tsx', '.css', '.mjs', '.js', '.py', '.html'):
            continue
        old = strip_comments(head_version(path), suffix)
        new = strip_comments((ROOT / path).read_text(encoding='utf-8'), suffix)
        if old == new:
            ok += 1
            continue
        old_l, new_l = old.split('\n'), new.split('\n')
        where = '(行数が違う)' if len(old_l) != len(new_l) else ''
        for i, (a, b) in enumerate(zip(old_l, new_l)):
            if a != b:
                where = f'{i + 1}行目: {a[:60]!r} -> {b[:60]!r}'
                break
        bad.append((path, where))
    print(f'骨格一致 {ok}件 / 不一致 {len(bad)}件')
    for path, where in bad:
        print(f'  NG {path}  {where}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
