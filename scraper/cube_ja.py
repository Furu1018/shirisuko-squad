"""하모니 큐브의 **일본어 표기**(이름 + 효과 문구)를 CDN에서 받아 대조표를 만든다.

엔진과 세이브는 한국어를 키로 쓴다(무개변). 화면에만 일본어를 얹기 위한 표다 —
`data/cube-name-ja.json`.

효과 문구는 추측하지 않는다. 같은 CDN을 `ko`/`ja`로 한 번씩 받아 **게임이 쓰는 공식 문구**를
그대로 짝지어 둔다. `cdn_tables.build_cube_table`을 그대로 쓰지 않는 이유는 그쪽이
공통 스킬 이름 같은 **한국어 전제**로 검사를 하기 때문이다 — 여기서는 이름과 문구만 있으면 된다.

    python scraper/cube_ja.py

새 큐브가 추가되면 다시 돌린다. 계산기가 아는 큐브에 대조가 없으면
`sync-runtime`이 빌드를 세운다(캐릭터 이름과 같은 규칙).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import cdn_fetch
import cdn_tables

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cube-name-ja.json"


def cubes_of(locale: str) -> list[dict]:
    """그 언어로 큐브 원본을 받는다. CDN 순서는 언어와 무관하게 같다."""
    cdn_fetch.LOCALE = locale
    cdn_tables.LOCALE = locale
    return asyncio.run(cdn_tables.collect(["cube"]))["cube"]


def own_skill(cube: dict, others: set[str]) -> dict | None:
    """그 큐브만의 스킬. 모든 큐브에 붙는 공통 스킬은 이름이 겹치므로 그걸로 가른다."""
    skills = [s for s in (cube.get("harmonycube_skill_group") or []) if s]
    mine = [s for s in skills if s["name_localkey"] not in others]
    return mine[0] if len(mine) == 1 else None


def common_names(cubes: list[dict]) -> set[str]:
    """모든 큐브에 공통으로 붙는 스킬 이름 (= 고유 스킬이 아닌 것)."""
    counts: dict[str, int] = {}
    for cube in cubes:
        for skill in (cube.get("harmonycube_skill_group") or []):
            if skill:
                counts[skill["name_localkey"]] = counts.get(skill["name_localkey"], 0) + 1
    return {name for name, n in counts.items() if n == len(cubes)}


def main() -> None:
    ko_cubes = cubes_of("ko")
    ja_cubes = cubes_of("ja")
    if len(ko_cubes) != len(ja_cubes):
        raise SystemExit(f"큐브 수가 다르다: ko={len(ko_cubes)} ja={len(ja_cubes)}")

    ko_common = common_names(ko_cubes)
    ja_common = common_names(ja_cubes)

    names: dict[str, str] = {}
    templates: dict[str, str] = {}
    for ko, ja in zip(ko_cubes, ja_cubes, strict=True):
        if ko["id"] != ja["id"]:
            raise SystemExit(f"큐브 순서가 어긋났다: ko={ko['id']} ja={ja['id']}")
        names[ko["name_localkey"]] = ja["name_localkey"]

        ko_skill = own_skill(ko, ko_common)
        ja_skill = own_skill(ja, ja_common)
        if not ko_skill or not ja_skill:
            continue
        ko_template, _ = cdn_tables.single_value_template(ko_skill, ko["name_localkey"])
        ja_template, _ = cdn_tables.single_value_template(ja_skill, ja["name_localkey"])
        if ko_template and ja_template:
            templates[ko_template] = ja_template

    OUT.write_text(
        json.dumps(
            {
                "_comment": "하모니 큐브의 한국어 → 일본어 (이름과 효과 문구). "
                            "scraper/cube_ja.py의 생성물 (손으로 고치지 않는다)",
                "_source": "blablalink CDN 을 LOCALE=ko / ja 로 각각 한 번씩 — 게임 공식 표기",
                "names": names,
                "templates": templates,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{OUT.relative_to(ROOT)} 에 이름 {len(names)}건 · 문구 {len(templates)}건 기록")


if __name__ == "__main__":
    main()
