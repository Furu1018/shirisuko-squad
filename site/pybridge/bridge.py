"""Serialize browser requests into the existing calculator API."""

from __future__ import annotations

import json
import math

from calculator.combat_power import combat_power
from calculator.customization import (
    BUFF_TARGET_WATCH,
    normalize_burst_regen,
    normalize_character_overrides,
    normalize_console,
    normalize_element_windows,
    normalize_immune_windows,
    normalize_normal_hit_coeff,
    normalize_burst_reaction,
    normalize_burst_sequence,
    normalize_optimal_range,
    normalize_synchro_level,
)
# `_is_normal` はヒットのタグで通常攻撃を見分けるエンジン側の正本である。フォークで
# 作り直すとタグが増えたときに静かにずれるので、そのまま借りて使う (名前が変われば
# ImportError で即座に発覚する)。
from calculator.sim_result import _is_normal
from calculator.timeline import simulate
from context import spec as char_spec


# タイムラインのバケット幅 (秒)。0.1秒まで刻んでみたが線が細かく震えてかえって読みにくかった —
# 1秒に戻す。この値は応答に載って出ていき、画面がそれで «何番目の枠が何秒か» を
# 換算するので、ここだけ変えれば絵・目盛り・ツールチップが全部ついてくる。
TIMELINE_BUCKET = 1

# 「精密分析」で使う枠の幅 (秒)。ダメージはもともとヒットごとに整数で正確に数えているので
# この値が **精度を変えることはない** — どれだけ細かく分けて見せるかだけを決める。
FINE_BUCKET = 0.1


def _build_timeline(result, names: list[str], bucket: float = TIMELINE_BUCKET) -> dict:
    """キャラクター別ダメージ・バースト時刻・フルバースト区間を `TIMELINE_BUCKET` 単位に要約する。

    ブラウザのタイムライン可視化用。ダメージは result.hits (常に埋まっている) から、
    バースト・フルバースト区間は verbose ログ (result.log) から作る。
    バケット幅は応答に一緒に載せて送る — 画面が «何番目の枠が何秒か» を
    その値で換算するので、1秒バケットで保存された昔の結果もそのまま描かれる。
    """
    buckets = int(math.ceil(result.duration / bucket)) if result.duration > 0 else 0
    damage = {name: [0] * buckets for name in names}
    for hit in result.hits:
        # 浮動小数の割り算が 0.3/0.1 = 2.9999… に落ちて前の枠に付くことがある — 補正する。
        index = int((hit.t + 1e-9) / bucket)
        # その補正のせいで最後の瞬間 (t = 29.999999999999577 のように duration に張り付いた値) の
        # ヒットが枠の外へ押し出される。捨てるとバケットの合計がキャラクターの総ダメージと食い違うので
        # 最後の枠に入れる — 実際にその枠で起きたヒットである。
        if index == buckets:
            index = buckets - 1
        if 0 <= index < buckets:
            row = damage.get(hit.caster)
            if row is not None:
                row[index] += int(hit.damage)

    bursts = {name: [] for name in names}
    full_burst: list[list[float]] = []
    if result.log is not None:
        pending_start: float | None = None
        for event in result.log.burst_log:
            if event.caster and event.caster in bursts and "사용" in event.event:
                stage = ""
                if ":" in event.event:
                    stage = event.event.split(":", 1)[1].split(" ", 1)[0]
                bursts[event.caster].append({"t": round(event.t, 2), "stage": stage})
            elif event.event == "full_burst 시작":
                pending_start = event.t
            elif event.event == "full_burst 종료" and pending_start is not None:
                full_burst.append([round(pending_start, 2), round(event.t, 2)])
                pending_start = None

    return {
        "bucket": bucket,
        "buckets": buckets,
        "damage": damage,
        "bursts": bursts,
        "fullBurst": full_burst,
        "buffs": _build_buff_spans(result, names),
    }


# 常時掛かっているもの — 소장품・큐브・장비 옵션 (コレクション・キューブ・装備オプション) は
# 戦闘中ずっとそのままで、タイムラインに描いても「いつ何が掛かったか」を語ってくれない。棒を占めるだけなので外す。
ALWAYS_ON_PREFIXES = ("소장품", "큐브", "장비 옵션")


def _is_always_on(name: str) -> bool:
    return any(name.startswith(prefix) for prefix in ALWAYS_ON_PREFIXES)


# 画面に載せて送るバフ行数の上限。5人180秒の実測で22行なので十分に足りる。
BUFF_TRACK_LIMIT = 60
# これより短いバフは棒に描いても1ピクセルなので外す (ほぼ即時発動のもの)。
BUFF_MIN_SPAN = 0.2


def _build_buff_spans(result, names: list[str]) -> list[dict]:
    """バフの発動/失効イベント → 画面に描く «バフごとの区間の束»。

    1つのバフ (名前・発動者・対象) が1行で、その中に掛かっていた区間が入る。同じ
    バフが200回掛け直されても名前・対象・stat は一度しか載せない — 区間ごとに全部載せると
    5人180秒で 140KB を超え、結果の保存が持たない (実測)。

    **重ね掛け数が変わったら区間を切る。** いつから何段だったかがタイムラインの核心で、
    1本の棒に最大値だけ書くとその情報が消える。

    失効イベントが無いバフ (戦闘が終わるまで生きていたもの) は戦闘の終わりで閉じる。
    """
    if result.log is None:
        return []
    duration = float(result.duration or 0.0)
    open_spans: dict[tuple, dict] = {}
    tracks: dict[tuple, dict] = {}

    def track_for(event) -> dict:
        # 1行は «誰が掛けた何のバフ» である。受ける側が複数なら1行にまとめて対象だけ
        # 増やす — 対象ごとに行を分けると同じバフが5行に散らばる。
        key = (event.name, event.caster)
        found = tracks.get(key)
        if found is None:
            found = tracks[key] = {
                "name": event.name, "caster": event.caster, "targets": [],
                "stat": event.stat, "value": event.value,
                "maxStack": int(event.max_stack) if event.max_stack else 1,
                # 区間 → その区間を受けた人たち。同じ区間が人数ぶん入ってくるので
                # 時刻でまとめる — リストではなく辞書なので重複が勝手に束ねられる。
                "_spans": {},
            }
        if event.target and event.target not in found["targets"]:
            found["targets"].append(event.target)
        return found

    def close(key: tuple, at: float) -> None:
        span = open_spans.pop(key, None)
        if span is None:
            return
        start = span["from"]
        if at - start < BUFF_MIN_SPAN:
            return
        row = (round(start, 2), round(at, 2), span["stack"])
        # **誰が受けたかは区間ごとに違い得る。** 리버렐리오 の `차분한 수심 4` は
        # 発動のたびに攻撃力の順位で対象が割れるので、1行に潰すと «両方が受ける» ように見える。
        who = span["track"]["_spans"].setdefault(row, [])
        if span["target"] and span["target"] not in who:
            who.append(span["target"])

    for event in result.log.buff_events:
        if event.target not in names and event.caster not in names:
            continue
        if _is_always_on(event.name):
            continue
        key = (event.name, event.caster, event.target)
        if event.kind == "activate":
            stack = int(event.stack) if event.stack else 1
            open_span = open_spans.get(key)
            if open_span is not None and open_span["stack"] != stack:
                close(key, event.t)
                open_span = None
            track = track_for(event)
            if event.value is not None:
                track["value"] = event.value
            if open_span is None:
                open_spans[key] = {"from": event.t, "stack": stack, "target": event.target,
                                   "track": track, "expires": event.expires_at}
            else:
                open_span["expires"] = event.expires_at
        else:
            close(key, event.t)

    for key, span in list(open_spans.items()):
        expires = span["expires"]
        end = duration if expires in (None, math.inf) or expires > duration else float(expires)
        close(key, end)

    kept = []
    for track in tracks.values():
        rows = sorted(track.pop("_spans").items())
        if not rows:
            continue
        # 区間ごとの対象が同じなら行に一度だけ書く。割れるときだけ区間に付ける —
        # 5人に掛かるバフまで区間ごとに名前を載せると結果が何倍にも重くなる。
        sets = [frozenset(who) for _, who in rows]
        varies = len(set(sets)) > 1
        spans = []
        for (start, end, stack), who in rows:
            if varies:
                spans.append([start, end, stack,
                              [track["targets"].index(name) for name in who]])
            else:
                spans.append([start, end, stack])
        track["spans"] = spans
        kept.append(track)
    # 最初に掛かった順に並べる — 画面は上から下へその順で読む。
    kept.sort(key=lambda track: (track["spans"][0][0], track["name"]))
    return kept[:BUFF_TRACK_LIMIT]


def _build_breakdown(result, names: list[str]) -> dict:
    """キャラクター別の通常攻撃/スキルのダメージ分解とスキルごとの内訳。

    `SimResult.dmg_breakdown()` がコンソール向けに行う集計と同じ基準で、ブラウザが
    比率を描けるように数値だけを構造化して渡す。
    """
    breakdown = {}
    for name in names:
        hits = [hit for hit in result.hits if hit.caster == name]
        normal_damage = skill_damage = 0
        normal_hits = skill_hits = 0
        per_skill: dict[str, dict[str, int]] = {}
        for hit in hits:
            if _is_normal(hit):
                normal_damage += hit.damage
                normal_hits += 1
                continue
            skill_damage += hit.damage
            skill_hits += 1
            entry = per_skill.setdefault(hit.skill_name, {"damage": 0, "hits": 0})
            entry["damage"] += hit.damage
            entry["hits"] += 1
        breakdown[name] = {
            "normal": int(normal_damage),
            "normalHits": normal_hits,
            "skill": int(skill_damage),
            "skillHits": skill_hits,
            "skills": sorted(
                (
                    {"name": skill, "damage": int(v["damage"]), "hits": v["hits"]}
                    for skill, v in per_skill.items()
                ),
                key=lambda item: -item["damage"],
            ),
        }
    return breakdown


_REQUIRED_NIKKE_FIELDS = (
    "rarity", "element_code", "class", "weapon_type", "burst_stage",
    "burst_cooldown", "max_ammo", "reload_time", "fire_rate", "damage_coeff",
)


def _inject_custom_characters(custom: dict) -> None:
    """ブラウザから渡ってきたカスタムニケをエンジンのグローバルへ併合する。

    サーバー・正本データには触れない — Pyodide ワーカープロセスのインメモリな
    グローバル (parsed_nikke・parsed_skills の写し) にだけ載せ、リロードすれば消える。
    """
    if not custom:
        return
    import calculator.timeline as _tl
    import calculator.base_stat as _bs
    import calculator.buff_manager as _bm
    from context import growth as _growth

    char_spec._nikke()  # spec の遅延キャッシュを先にロードする
    # parsed_nikke・parsed_skills の写しは複数のモジュールがそれぞれ持っている。全部に載せる。
    nikke_stores = (_tl._NIKKE, _bs._NIKKE, _bm._NIKKE, _growth._NIKKE, char_spec._NIKKE_CACHE)
    skill_stores = (_tl._PARSED_SKILLS, _bm._PARSED_SKILLS)
    for name, data in custom.items():
        if not isinstance(data, dict) or "nikke" not in data or "skills" not in data:
            raise ValueError(f"커스텀 니케 '{name}': nikke와 skills가 필요합니다")
        nikke = data["nikke"]
        skills = data["skills"]
        missing = [f for f in _REQUIRED_NIKKE_FIELDS if f not in nikke]
        if missing:
            raise ValueError(f"커스텀 니케 '{name}': 누락된 스탯 {missing}")
        if not isinstance(skills, list):
            raise ValueError(f"커스텀 니케 '{name}': skills는 배열이어야 합니다")
        for store in nikke_stores:
            store[name] = nikke
        for store in skill_stores:
            store[name] = skills


def _build_buff_targets(result, names: list[str]) -> dict:
    """編成したキャラクターのうち、監視対象バフの実際の受け手。

    `{発動者: [{"label": ..., "buff": ..., "targets": [名前...], "count": N}]}` を返す。
    受け手が戦闘中に割れれば複数人が入る — そのまま見せるのが正しい。
    """
    log = getattr(result, "log", None)
    if log is None:
        return {}
    out: dict[str, list[dict]] = {}
    for caster in names:
        watches = BUFF_TARGET_WATCH.get(caster)
        if not watches:
            continue
        rows = []
        for buff_name, label in watches:
            sequence: list[dict] = []
            for ev in log.buff_events:
                if ev.kind != "activate" or ev.caster != caster:
                    continue
                # 同じスキルの別版 (애장품 など) が名前の後ろに付いて来ることがある。
                if ev.name != buff_name and not ev.name.startswith(f"{buff_name} ("):
                    continue
                if ev.target in names:
                    sequence.append({"t": round(ev.t, 2), "target": ev.target})
            # 最初に受けた順で重複を除く。2人以上いるなら対象が戦闘中に割れた
            # **特異ケース**で、そのときは順序そのものが情報なのでそのまま渡す。
            order: list[str] = []
            for item in sequence:
                if item["target"] not in order:
                    order.append(item["target"])
            rows.append({
                "label": label,
                "buff": buff_name,
                "targets": order,
                "sequence": sequence,
                "count": len(sequence),
            })
        if rows:
            out[caster] = rows
    return out


def run_combat_power(raw: str) -> str:
    """キャラクター別のゲーム内戦闘力。一覧の並べ替えにだけ使い、ダメージ計算とは無関係である。

    `{"characters": {名前: オーバーライド}}` を受けて `{名前: 戦闘力}` を返す。
    オーバーライドが無いキャラクターは既定スペックで測る — 持っていないニケも一覧には
    要るし、そのときは «カンストならこのくらい» が最も外れの少ない値である。
    """
    payload = json.loads(raw)
    _inject_custom_characters(payload.get("customCharacters") or {})
    raw_characters = payload.get("characters") or {}
    names = [str(n) for n in (payload.get("names") or raw_characters)]

    overrides = {
        name: normalize_character_overrides(raw_characters.get(name), character_name=name)
        for name in names
        if name in raw_characters
    }
    out: dict[str, float] = {}
    for name in names:
        try:
            char = char_spec.build_squad([name], overrides)[0]
            out[name] = round(combat_power(char), 2)
        except Exception:
            # 1人が引っかかっても一覧全体が死んではいけない — そのキャラクターだけ外す。
            continue
    return json.dumps(out, ensure_ascii=False, separators=(",", ":"))


def run_request(raw: str) -> str:
    payload = json.loads(raw)
    _inject_custom_characters(payload.get("customCharacters") or {})
    names = [str(name).strip() for name in payload["squad"]]
    raw_characters = payload.get("characters") or {}
    if not isinstance(raw_characters, dict):
        raise ValueError("캐릭터 설정은 객체여야 합니다.")
    outside = sorted(set(raw_characters) - set(names))
    if outside:
        raise ValueError(f"스쿼드에 없는 캐릭터 설정: {outside}")
    characters = {
        name: normalize_character_overrides(
            raw_characters.get(name), character_name=name
        )
        for name in names
        if name in raw_characters
    }
    # コンソールはアカウント属性なのでリクエストの最上位で来る — 編成の全員に同じものを載せる。
    # 既定スペックにすでにコンソールがあるので、与えられた項目だけ上書きする。
    console = normalize_console(payload.get("console"))
    if console:
        for name in names:
            overrides = characters.setdefault(name, {})
            overrides["console"] = {
                **char_spec.DEFAULT_CHAR["console"], **console,
            }
    # シンクロレベルもアカウント属性である — 部隊に入れたニケは全員が同じレベルになる。
    # 共有コードには載せないので、他人の条件を受け取っても自分のレベルのまま計算する。
    synchro = normalize_synchro_level(payload.get("synchroLevel"))
    if synchro is not None:
        for name in names:
            characters.setdefault(name, {})["level"] = synchro
    # バーストゲージの充填時間もアカウント/戦闘の単位である — 全員に同じ値を載せる。
    burst_regen = normalize_burst_regen(payload.get("burstRegenTime"))
    if burst_regen is not None:
        for name in names:
            characters.setdefault(name, {})["burst_regen_time"] = burst_regen
    squad = char_spec.build_squad(names, characters)
    config_in: dict = {"duration": int(payload["duration"])}
    # バースト運用の割り当て → config["burst_pattern"]。solo は毎サイクル優先 (専任)、
    # skip は極力使わない。build_config はここで与えた値をそのまま生かす (caller 優先)。
    burst_pattern: dict = {}
    no_burst: list[str] = []
    for name, overrides in characters.items():
        assignment = overrides.get("_burst_assignment")
        if not isinstance(assignment, dict):
            continue
        if assignment.get("mode") == "priority":
            burst_pattern[name] = f"every:{int(assignment.get('every', 1))}"
        elif assignment.get("mode") == "endgame":
            # 残り時間が N 秒を切ったら最優先。それまでは普段の順序である。
            burst_pattern[name] = f"last:{float(assignment.get('seconds', 20.0))}"
        elif assignment.get("mode") == "skip":
            # 「使わない」は後ろへ回すのではなく候補から外すことである — 前の全員が
            # クールタイム中でも撃たない。
            no_burst.append(name)
    if burst_pattern:
        config_in["burst_pattern"] = burst_pattern
    if no_burst:
        config_in["no_burst_chars"] = no_burst
    # 手で決めたバースト順 → config["burst_sequence"]。書いてあるサイクルまでだけ従い、
    # 戦闘がそれより長ければその先は普段の順序に戻る。
    sequence = normalize_burst_sequence(payload.get("burstSequence"), names)
    if sequence is not None:
        config_in["burst_sequence"] = sequence
    # バースト反応速度 — 条件が揃ってから押すまで。戦闘の条件なので config に置く。
    reaction = normalize_burst_reaction(payload.get("burstReaction"))
    if reaction is not None:
        config_in["burst_reaction"] = reaction
    # 乱数の扱い: "random" (ゲーム内と同じ分散) / "expected" (期待値・決定論的)。
    #
    # 与えられなければ **期待値** である — このブリッジが仕える画面の既定値だ。エンジンライブラリの
    # 既定値 (`timeline.DEFAULT_CONFIG`) は乱数だが、それをここまで引きずって来てはいけない:
    # 画面では期待値の意味なのにここでは乱数と読まれ、期待値にした人たちがずっと乱数で
    # 計算し、シードを変えるたびに結果が揺れていた。
    rng_mode = str(payload.get("rngMode") or "expected")
    if rng_mode not in ("random", "expected"):
        raise ValueError('난수 모드는 random 또는 expected여야 합니다')
    config_in["rng_mode"] = rng_mode
    # 回避区間中にバーストゲージを止めるかどうか。与えられなければオンと見なす (ゲーム内基準)。
    blocks = payload.get("immuneBlocksBurst")
    config_in["immune_blocks_burst"] = True if blocks is None else bool(blocks)
    config = char_spec.build_config(squad, config_in)
    # 通常攻撃係数は敵ではなく **こちら側の命中** の問題なので config に置く。
    hit_coeff = normalize_normal_hit_coeff(payload.get("normalHitCoeff"))
    if hit_coeff:
        config["normal_hit_coeff"] = hit_coeff

    enemy = {
        "def": int(payload["enemyDef"]),
        "code": str(payload.get("enemyCode") or ""),
        "core_px": float(payload.get("corePx") or 0),
        "has_parts": bool(payload.get("hasParts")),
        # 適正距離は武器種の単位でオンになる — その武器種の通常攻撃にだけ ③ +30%。
        "optimal_range_weapons": normalize_optimal_range(
            payload.get("optimalRangeWeapons")
        ),
        # ボスのフェーズ — 回避区間 (족자: ダメージ遮断) と属性制限 (속저: 優越コードだけ通す)。
        "immune_windows": normalize_immune_windows(payload.get("immuneWindows")),
        "element_windows": normalize_element_windows(payload.get("elementWindows")),
    }
    result = simulate(
        squad,
        config=config,
        enemy=enemy,
        seed=int(payload["seed"]),
        verbose=True,
    )
    response = {
        "squadTotal": result.squad_total,
        "duration": result.duration,
        "hitCount": len(result.hits),
        "charTotals": result.char_total,
        "charBreakdown": _build_breakdown(result, names),
        "previewNote": char_spec.preview_note(names),
        "deviations": char_spec.format_deviations(squad),
        "timeline": _build_timeline(result, names),
        "buffTargets": _build_buff_targets(result, names),
    }
    # 「精密分析」 — 同じ結果をより細かく刻んだ表をもう1つ載せる。ダメージはもともと
    # ヒットごとに整数で正確に数えているので **数値が精密になるのではなく** 見える枠が細かくなるだけだ。
    # 絵は1秒の枠のまま使う (細かく震えると読みにくい) — こちらは書き出し用である。
    if bool(payload.get("fineTimeline")):
        response["fineTimeline"] = _build_timeline(result, names, FINE_BUCKET)
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
