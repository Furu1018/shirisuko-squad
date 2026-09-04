import json
import sys
import unittest
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SITE_DIR.parent
sys.path.insert(0, str(SITE_DIR))
sys.path.insert(0, str(REPO_ROOT))

from pybridge.bridge import run_request
from context.spec import is_preview
from context.spec import _nikke as parsed_nikke


class BrowserBridgeTest(unittest.TestCase):
    def test_growth_stage_changes_the_engine_result(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        card = json.loads(run_request(json.dumps({
            **payload,
            "characters": {"리타": {"growthStage": 0}},
        }, ensure_ascii=False)))
        core_seven = json.loads(run_request(json.dumps({
            **payload,
            "characters": {"리타": {"growthStage": 10}},
        }, ensure_ascii=False)))

        self.assertGreater(core_seven["squadTotal"], card["squadTotal"])

    def test_rejects_forged_growth_stage_for_character_rarity(self):
        payload = {
            "squad": ["라피"],
            "characters": {"라피": {"growthStage": 3}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "라피: 돌파 단계는 0~2"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_rejects_null_growth_stage_in_forged_json(self):
        payload = {
            "squad": ["리타"],
            "characters": {"리타": {"growthStage": None}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "돌파 단계는 정수"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_released_skill_levels_change_the_engine_result(self):
        payload = {
            "squad": ["라피 : 레드 후드"],
            "characters": {
                "라피 : 레드 후드": {
                    "skillLevels": {"1": 10, "2": 1, "3": 10},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        level_ten = json.loads(run_request(json.dumps({
            **payload,
            "characters": {
                "라피 : 레드 후드": {
                    "skillLevels": {"1": 10, "2": 10, "3": 10},
                },
            },
        }, ensure_ascii=False)))
        level_one = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))

        self.assertGreater(level_ten["squadTotal"], level_one["squadTotal"])

    def test_preview_skill_levels_cannot_be_forged_below_ten(self):
        # プレビュー (リリース前カード) のキャラクター名簿はリリースのたびに空になるので、名前は決め打ちしない。
        # 空なら、偽装を試みる対象そのものが無い正常な状態だ。
        previews = [name for name in parsed_nikke() if is_preview(name)]
        if not previews:
            self.skipTest("등록된 프리뷰 캐릭터가 없다 (전원 정식 출시)")
        preview = previews[0]

        payload = {
            "squad": [preview],
            "characters": {
                preview: {
                    "skillLevels": {"1": 9, "2": 10, "3": 10},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "프리뷰 캐릭터는 스킬 레벨 10"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def _totals_by_seed(self, seeds, **extra):
        """同じ設定でシードだけを変えた結果の一覧。"""
        out = []
        for seed in seeds:
            payload = {
                "squad": ["리타", "크라운", "홍련"],
                "duration": 20,
                "enemyDef": 31_784,
                "enemyCode": "",
                "corePx": 0,
                "hasParts": False,
                "seed": seed,
                **extra,
            }
            out.append(json.loads(run_request(json.dumps(payload, ensure_ascii=False)))["squadTotal"])
        return out

    def test_expected_mode_ignores_the_seed(self):
        """期待値は決定論的だ — シードを変えてもびた一文変わってはならない。"""
        totals = self._totals_by_seed([42, 7, 12345], rngMode="expected")
        self.assertEqual(len(set(totals)), 1, f"기대값인데 시드마다 다르다: {totals}")

    def test_random_mode_actually_uses_the_seed(self):
        """乱数モードは逆にシードに反応しなければならない — 上の試験が «どちらも動かないせいで» 通るのを防ぐ。"""
        totals = self._totals_by_seed([42, 7, 12345], rngMode="random")
        self.assertGreater(len(set(totals)), 1, f"난수인데 시드를 안 탄다: {totals}")

    def test_missing_rng_mode_is_the_site_default_expected(self):
        """`rngMode` が来なければ**画面の既定値 (期待値)**とみなす。

        この既定値がブリッジと画面で食い違っていたのが実際にあった欠陥だ — `model.ts` が
        「既定値だから省いてよい」と `expected` を載せず、ブリッジは欠けると `random` と
        読むため、期待値のつもりで使っていた人がずっと乱数モードで計算していた。
        """
        totals = self._totals_by_seed([42, 7, 12345])
        self.assertEqual(len(set(totals)), 1, f"안 주면 난수로 돈다: {totals}")

    def _burst_casts(self, sequence=None):
        """バーストを時間順に、誰が何段階を使ったか。"""
        payload = {
            "squad": ["리타", "크라운", "홍련", "앨리스", "나가"],
            "duration": 60,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "rngMode": "expected",
            "timeline": True,
        }
        if sequence is not None:
            payload["burstSequence"] = sequence
        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        casts = []
        for name, entries in (result.get("timeline", {}).get("bursts") or {}).items():
            for entry in entries:
                casts.append((entry["t"], entry["stage"], name))
        casts.sort()
        return casts

    def test_burst_sequence_decides_who_bursts(self):
        """書き留めたサイクルでは、その人がその段階を使う。"""
        auto = self._burst_casts()
        self.assertTrue(auto, "버스트가 하나도 안 나갔다 — 시험 전제가 깨졌다")

        # 3バは 앨리스・나가 のどちらも可能だ。最初のサイクルだけ 나가 に固定する。
        forced = self._burst_casts([{"1": ["리타"], "2": ["크라운"], "3": ["나가"]}])
        first_third = next((name for _, stage, name in forced if stage == "3"), None)
        self.assertEqual(first_third, "나가")

    def test_burst_sequence_only_binds_the_cycles_it_names(self):
        """書き留めたサイクルを過ぎれば普段の順序に戻る — 優先指定であって絶対の規則ではない。"""
        forced = self._burst_casts([{"1": ["리타"], "2": ["크라운"], "3": ["나가"]}])
        thirds = [name for _, stage, name in forced if stage == "3"]
        self.assertGreater(len(thirds), 1, "60초면 3버가 여러 번 나가야 한다")
        self.assertEqual(thirds[0], "나가")
        # 2回目からは計算機が自分で選ぶ — 나가 に固定されてはいない。
        self.assertTrue(any(name != "나가" for name in thirds[1:]),
                        f"적어 두지 않은 사이클까지 묶였다: {thirds}")

    def test_burst_sequence_rejects_a_name_outside_the_squad(self):
        """編成にいない名前は黙って捨てずに拒否する。"""
        with self.assertRaisesRegex(ValueError, "편성에 없는 니케"):
            self._burst_casts([{"1": ["도로시"], "2": [], "3": []}])

    def test_empty_burst_sequence_is_the_same_as_not_giving_one(self):
        """空のサイクルだけ並べたら、渡していないのと同じだ — バーストが止まってはいけない。"""
        empty = self._burst_casts([{"1": [], "2": [], "3": []}, {"1": [], "2": [], "3": []}])
        self.assertEqual(empty, self._burst_casts())

    def test_seeded_request_returns_compact_positive_result(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))

        self.assertEqual(result["duration"], 10)
        self.assertGreater(result["squadTotal"], 0)
        self.assertGreater(result["hitCount"], 0)
        self.assertEqual(list(result["charTotals"]), ["리타"])

    def test_synchro_level_applies_to_everyone_and_changes_the_result(self):
        """シンクロレベルはアカウント属性なので、スクワッド全員に同じ値で乗る。"""
        payload = {
            "squad": ["리타", "크라운"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        default = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        # 既定のスペックレベルが400なので、400を明示しても結果は同じでなければならない。
        same = json.loads(run_request(json.dumps(
            {**payload, "synchroLevel": 400}, ensure_ascii=False)))
        lower = json.loads(run_request(json.dumps(
            {**payload, "synchroLevel": 200}, ensure_ascii=False)))

        self.assertEqual(same["squadTotal"], default["squadTotal"])
        self.assertLess(lower["squadTotal"], default["squadTotal"])
        # 1人だけでなく全員が下がる。
        for name in ("리타", "크라운"):
            self.assertLess(lower["charTotals"][name], default["charTotals"][name])

    def test_endgame_burst_waits_for_the_last_seconds(self):
        """終盤最優先 — 残り時間がN秒未満になったとき、そのキャラクターが先に撃つ。"""
        base = {
            "squad": ["리타", "크라운", "라피 : 레드 후드", "앨리스", "나가"],
            "duration": 60,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        auto = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        endgame = json.loads(run_request(json.dumps({
            **base,
            # 나가 と 크라운 が同じ2段階の候補だ — 順序が分かれる余地があってこそ
            # この設定が意味を持つ。
            "characters": {"나가": {"burst": {"mode": "endgame", "seconds": 20}}},
        }, ensure_ascii=False)))

        # 順序が実際に変わらなければならない — 変わらなければ設定が素通りしたということだ。
        self.assertNotEqual(endgame["squadTotal"], auto["squadTotal"])

    def test_burst_reaction_delays_every_burst(self):
        """反応速度はバースト1つごとに加算される — 遅めに取れば結果が変わる。"""
        base = {
            "squad": ["리타", "크라운", "라피 : 레드 후드", "앨리스", "나가"],
            "duration": 60,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        default = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        same = json.loads(run_request(json.dumps(
            {**base, "burstReaction": 0.05}, ensure_ascii=False)))
        slow = json.loads(run_request(json.dumps(
            {**base, "burstReaction": 0.5}, ensure_ascii=False)))
        instant = json.loads(run_request(json.dumps(
            {**base, "burstReaction": 0}, ensure_ascii=False)))

        # 既定値は0.05秒だ — 明示しても結果は同じでなければならない。
        self.assertEqual(same["squadTotal"], default["squadTotal"])
        # 押すのが遅いほどバーストがずれ込み、総ダメージが減る。
        self.assertLess(slow["squadTotal"], default["squadTotal"])
        self.assertGreater(instant["squadTotal"], slow["squadTotal"])

    def test_skip_means_never_bursting_at_all(self):
        """「使わない」は後回しにすることではなく、候補から外すことだ。"""
        base = {
            "squad": ["리타", "크라운", "라피 : 레드 후드", "앨리스", "나가"],
            "duration": 90,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        auto = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        # 크라운 と 나가 が同じ2段階の候補だ — 크라운 を外しても 나가 がその段階を受け持つ。
        skipped = json.loads(run_request(json.dumps({
            **base, "characters": {"크라운": {"burst": {"mode": "skip"}}},
        }, ensure_ascii=False)))

        self.assertNotEqual(skipped["squadTotal"], auto["squadTotal"])
        # バーストを一切使っていないので、크라운 のバースト時刻は1つも無いはずだ。
        self.assertTrue(auto["timeline"]["bursts"]["크라운"])
        self.assertEqual(skipped["timeline"]["bursts"]["크라운"], [])
        # それでも戦闘は回る — 他のキャラクターはバーストを使い続ける。
        self.assertTrue(skipped["timeline"]["bursts"]["나가"])

    def test_no_cube_drops_both_its_stats_and_its_effect(self):
        """«없음» はキューブを着けていない (未装着の) 状態だ — ステータスも有利コードの効果も付かない。"""
        base = {
            "squad": ["리타"],
            "duration": 20,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }
        withCube = json.loads(run_request(json.dumps(base, ensure_ascii=False)))
        without = json.loads(run_request(json.dumps({
            **base, "characters": {"리타": {"cube": {"name": "없음", "level": 0}}},
        }, ensure_ascii=False)))

        self.assertLess(without["squadTotal"], withCube["squadTotal"])

    def test_rejects_an_unknown_cube_name(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "characters": {"리타": {"cube": {"name": "없는큐브", "level": 5}}},
        }

        with self.assertRaisesRegex(ValueError, "큐브는"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_overload_zero_is_its_own_equipment_state(self):
        """オーバーロード強化0は未装着でもT9でもない — 3つが互いに違う値を出さなければならない。"""
        base = {
            "squad": ["리타"],
            "duration": 20,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        def run(level):
            payload = {**base, "characters": {"리타": {"equipLevels": {
                "머리": level, "몸통": level, "팔": level, "다리": level,
            }}}}
            return json.loads(run_request(json.dumps(payload, ensure_ascii=False)))["squadTotal"]

        none_, tier9, over0, over1 = run("없음"), run("T9"), run(0), run(1)
        # 0は falsy として弾かれがちだ — 弾かれると未装着や既定値と同じになり、静かに間違う。
        self.assertLess(none_, tier9)
        self.assertLess(tier9, over0)
        self.assertLess(over0, over1)

    def test_rejects_a_bad_burst_reaction(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "burstReaction": 9,
        }

        with self.assertRaisesRegex(ValueError, "버스트 반응속도"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_rejects_a_bad_endgame_burst_window(self):
        payload = {
            "squad": ["리타"],
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
            "characters": {"리타": {"burst": {"mode": "endgame", "seconds": 0}}},
        }

        with self.assertRaisesRegex(ValueError, "막바지 최우선"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_rejects_synchro_level_outside_the_ingame_cap(self):
        """上限は表ではなくゲーム内のレベル上限 (1400) だ。

        表は1000までだが、その上はエンジンが延長して繋ぐ — ユニオンレイドでシンクロ1131の
        ユニオン員に実際に出会うし、1000に丸めてしまうとその人の攻撃力が15%以上削られる。
        """
        def payload(level):
            return {
                "squad": ["리타"],
                "duration": 10,
                "enemyDef": 31_784,
                "enemyCode": "",
                "corePx": 0,
                "hasParts": False,
                "seed": 42,
                "synchroLevel": level,
            }

        # 表の外でもゲーム内上限の内なら計算する。
        run_request(json.dumps(payload(1_131), ensure_ascii=False))

        with self.assertRaisesRegex(ValueError, "싱크로 레벨"):
            run_request(json.dumps(payload(1_401), ensure_ascii=False))

    def test_character_overrides_are_forwarded_to_the_engine(self):
        payload = {
            "squad": ["리타"],
            "characters": {
                "리타": {
                    "overload": {"atk_pct": 100},
                    "cube": {"name": "렐릭 디스트로이 큐브", "level": 1},
                    "manualStats": {"normal_atk_dmg_pct": 20},
                },
            },
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": True,
            "seed": 42,
        }
        base = dict(payload)
        base.pop("characters")

        customized = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        baseline = json.loads(run_request(json.dumps(base, ensure_ascii=False)))

        self.assertGreater(customized["squadTotal"], baseline["squadTotal"])

    def test_timeline_is_bucketed_and_matches_char_totals(self):
        payload = {
            "squad": [
                "목단",
                "에이드 : 에이전트 바니",
                "아니스 : 스파클링 서머",
                "메이든 : 아이스 로즈",
                "프리바티",
            ],
            "duration": 30,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        timeline = result["timeline"]

        self.assertEqual(timeline["bucket"], 1)
        self.assertEqual(timeline["buckets"], 30)
        for name in payload["squad"]:
            row = timeline["damage"][name]
            self.assertEqual(len(row), 30)
            # バケットの合計は全区間のダメージと一致しなければならない — 細かく刻んでもヒットは漏れない
            # (浮動小数の割り算が前のマスにこぼしやすい場所だ)。
            self.assertEqual(sum(row), result["charTotals"][name])
        # 戦闘最後の瞬間 (t が duration に張り付いた値) のヒットも最後のマスに入る —
        # 細かく刻むほどこの境界で漏れやすく、漏れれば上の合計が即座に狂う。
        self.assertGreater(sum(timeline["damage"][name][-1] for name in payload["squad"]), 0)
        # フルバースト区間とバースト使用時点はログから埋められる。
        self.assertTrue(timeline["fullBurst"])
        self.assertTrue(any(timeline["bursts"][name] for name in payload["squad"]))

    def test_burst_assignment_shifts_which_member_bursts(self):
        base = {
            "squad": ["라피 : 레드 후드", "앨리스", "목단", "크라운", "마스트 : 로망틱 메이드"],
            "duration": 90,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        def mast_bursts(payload):
            result = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
            return len(result["timeline"]["bursts"]["마스트 : 로망틱 메이드"])

        every1 = mast_bursts({**base, "characters": {
            "마스트 : 로망틱 메이드": {"burst": {"mode": "priority", "every": 1}},
        }})
        every3 = mast_bursts({**base, "characters": {
            "마스트 : 로망틱 메이드": {"burst": {"mode": "priority", "every": 3}},
        }})
        skip = mast_bursts({**base, "characters": {
            "마스트 : 로망틱 메이드": {"burst": {"mode": "skip"}},
        }})

        # 毎サイクル優先 (every=1) は3の倍数優先より多いか等しく、skip は0になる。
        self.assertGreaterEqual(every1, every3)
        self.assertGreater(every1, skip)
        self.assertEqual(skip, 0)

    def test_custom_character_injection_simulates_like_the_real_one(self):
        import json as _json
        from pathlib import Path as _Path
        data = _Path(__file__).resolve().parent.parent.parent / "data"
        nikke = _json.loads((data / "parsed_nikke.json").read_text(encoding="utf-8"))
        skills = _json.loads((data / "parsed_skills.json").read_text(encoding="utf-8"))
        # 크라운 には char_defaults レイヤーが無いので、複製したカスタムと実物が正確に一致するはずだ。
        custom = {"커스텀크라운": {"nikke": nikke["크라운"], "skills": skills["크라운"]}}
        base = {
            "duration": 40, "enemyDef": 31_784, "enemyCode": "",
            "corePx": 0, "hasParts": False, "seed": 42,
        }
        custom_run = json.loads(run_request(json.dumps({
            **base,
            "squad": ["커스텀크라운", "목단", "라피 : 레드 후드", "앨리스", "나가"],
            "customCharacters": custom,
        }, ensure_ascii=False)))
        real_run = json.loads(run_request(json.dumps({
            **base,
            "squad": ["크라운", "목단", "라피 : 레드 후드", "앨리스", "나가"],
        }, ensure_ascii=False)))

        self.assertGreater(custom_run["charTotals"]["커스텀크라운"], 0)
        self.assertEqual(
            custom_run["charTotals"]["커스텀크라운"],
            real_run["charTotals"]["크라운"],
        )

    def test_custom_character_missing_stats_is_rejected(self):
        payload = {
            "squad": ["엉터리"],
            "customCharacters": {"엉터리": {"nikke": {"class": "화력형"}, "skills": []}},
            "duration": 10, "enemyDef": 31_784, "enemyCode": "",
            "corePx": 0, "hasParts": False, "seed": 42,
        }
        with self.assertRaisesRegex(ValueError, "누락된 스탯"):
            run_request(json.dumps(payload, ensure_ascii=False))

    def test_buff_targets_report_who_actually_received_the_buff(self):
        """「誰がこのバフを受けたか」は推定ではなく、実際の発動ログから来る。

        対象は攻撃力の順位で分かれ、編成を見ただけでは分からない。미란다 はお気に入り
        2段階以上で初めて発動する — 条件が合わなければ空の一覧でなければならない。
        """
        squad = ["아니스 : 스타", "나유타", "미란다", "리버렐리오", "홍련 : 흑영"]

        def run(favorite: int) -> dict:
            payload = {
                "squad": squad,
                "characters": {"미란다": {"collection": {"stage": "SR15",
                                                       "favorite": favorite}}},
                "duration": 60, "enemyDef": 31784, "enemyCode": "",
                "corePx": 52, "hasParts": False, "seed": 42,
            }
            return json.loads(run_request(json.dumps(payload,
                                                     ensure_ascii=False)))["buffTargets"]

        got = run(3)
        miranda = got["미란다"][0]
        self.assertEqual(miranda["label"], "크확 대상")
        self.assertGreater(miranda["count"], 0)
        # 自分を除く攻撃力1位に飛ぶ — スクワッド内の別のキャラクターのはずだ。
        self.assertTrue(miranda["targets"])
        self.assertNotIn("미란다", miranda["targets"])
        for name in miranda["targets"]:
            self.assertIn(name, squad)

        rebellio = got["리버렐리오"][0]
        self.assertEqual(rebellio["label"], "차분한 수심 대상")
        self.assertTrue(rebellio["targets"])
        for name in rebellio["targets"]:
            self.assertIn(name, squad)

        # 順序は発動時刻順に収められ、`targets` はその順序から重複だけを除いたものだ。
        for row in (miranda, rebellio):
            self.assertEqual(len(row["sequence"]), row["count"])
            self.assertEqual(
                list(dict.fromkeys(step["target"] for step in row["sequence"])),
                row["targets"],
            )
            times = [step["t"] for step in row["sequence"]]
            self.assertEqual(times, sorted(times))

        # お気に入り1段階は発動条件 (2段階) に届かない → 空の一覧。
        self.assertEqual(run(1)["미란다"][0]["targets"], [])
        self.assertEqual(run(1)["미란다"][0]["count"], 0)

    def test_buff_targets_left_out_for_squads_without_watched_casters(self):
        """監視対象のいない編成なら、何も収められない。"""
        payload = {
            "squad": ["라피", "앨리스"], "duration": 20, "enemyDef": 31784,
            "enemyCode": "", "corePx": 0, "hasParts": False, "seed": 42,
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        self.assertEqual(got["buffTargets"], {})

    def test_fine_timeline_splits_the_same_damage_into_smaller_slots(self):
        """精密分析の表は «より正確な» 値ではなく «より細かく分けた» 値だ。

        エンジンはヒットごとに整数で正確に数える — マスを細かくしても総合計は1桁も
        変わってはならない。変わったなら、マスの割り方でヒットをこぼしたということだ。
        """
        payload = {
            "squad": ["리타", "크라운"], "duration": 20, "enemyDef": 31_784,
            "enemyCode": "", "corePx": 0, "hasParts": False, "seed": 42,
            "rngMode": "expected", "fineTimeline": True,
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        coarse, fine = got["timeline"], got["fineTimeline"]
        self.assertEqual(coarse["bucket"], 1)
        self.assertEqual(fine["bucket"], 0.1)
        self.assertEqual(fine["buckets"], coarse["buckets"] * 10)
        for name in ("리타", "크라운"):
            self.assertEqual(sum(fine["damage"][name]), sum(coarse["damage"][name]))
            self.assertEqual(sum(fine["damage"][name]), int(got["charTotals"][name]))

    def test_fine_timeline_is_left_out_unless_asked(self):
        # 常に載せて送ると保存される結果が10倍重くなる — 書き出すときだけ作る。
        payload = {
            "squad": ["리타"], "duration": 10, "enemyDef": 31_784, "enemyCode": "",
            "corePx": 0, "hasParts": False, "seed": 42,
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        self.assertNotIn("fineTimeline", got)

    def test_buff_span_carries_who_actually_got_it_when_the_target_shifts(self):
        """対象が発動ごとに分かれるバフは、**区間ごとに**誰が受けたかを記す。

        리버렐리오 の `차분한 수심 4` は攻撃力の順位で対象が分かれ、発動のたびに人が
        変わる。1行にまとめてしまうと «両方が受ける» と読めてしまう。
        """
        payload = {
            "squad": ["리틀 머메이드", "나유타", "에이다", "아인", "리버렐리오"],
            "duration": 60, "enemyDef": 31_784, "enemyCode": "", "corePx": 0,
            "hasParts": False, "seed": 42, "rngMode": "expected",
        }
        got = json.loads(run_request(json.dumps(payload, ensure_ascii=False)))
        tracks = got["timeline"]["buffs"]
        shifting = next(t for t in tracks if t["name"] == "차분한 수심 4")
        self.assertEqual(sorted(shifting["targets"]), ["아인", "에이다"])

        # 区間ごとに対象が1人ずつ付き、隣り合う2区間は互いに別の人だ。
        picked = [
            [shifting["targets"][i] for i in span[3]]
            for span in shifting["spans"] if len(span) > 3
        ]
        self.assertEqual(len(picked), len(shifting["spans"]))
        self.assertTrue(all(len(who) == 1 for who in picked), picked)
        self.assertNotEqual(picked[0], picked[1])

        # 対象が常に同じ行では区間に付けない — そちらまで載せると結果が重くなる。
        steady = [t for t in tracks if all(len(s) == 3 for s in t["spans"])]
        self.assertTrue(steady, "대상이 고정인 줄이 하나도 없다")

    def test_rejects_character_settings_outside_the_squad(self):
        payload = {
            "squad": ["리타"],
            "characters": {"라피": {"cube": {"name": "렐릭 베어 큐브", "level": 15}}},
            "duration": 10,
            "enemyDef": 31_784,
            "enemyCode": "",
            "corePx": 0,
            "hasParts": False,
            "seed": 42,
        }

        with self.assertRaisesRegex(ValueError, "스쿼드에 없는 캐릭터"):
            run_request(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()


class CubeReachesTheEngineTest(unittest.TestCase):
    """キューブが計算に効くことを、橋を通した実リクエストで固定する。

    実機監査で「リロ速 Lv15 を付けても理論値が動かない」と観測された。真相は
    **個別設定に cube キーが無いと、エンジンがそのキャラの既定キューブ (最良 Lv15 相当) で
    計算する**ため、既定と同じキューブを付けても数値が変わらなかった — エンジンは無罪。
    この試験は (1) キューブそのものが効くこと (2) «無指定 = 既定キューブ» という
    暗黙の約束、の両方を見張る。どちらかが崩れたら、画面の出どころ表示 ((既定) の印) が
    嘘になるので、このテストで気づく。
    """

    BASE = {
        "squad": ["리타"],
        "duration": 10,
        "enemyDef": 31_784,
        "enemyCode": "",
        "corePx": 0,
        "hasParts": False,
        "seed": 42,
    }

    def _total(self, overrides):
        raw = run_request(json.dumps({
            **self.BASE,
            "characters": {"리타": overrides},
        }, ensure_ascii=False))
        return json.loads(raw)["squadTotal"]

    def test_cube_changes_the_result(self):
        none = self._total({"cube": {"name": "없음", "level": 0}})
        lv15 = self._total({"cube": {"name": "렐릭 베어 큐브", "level": 15}})
        lv7 = self._total({"cube": {"name": "렐릭 베어 큐브", "level": 7}})
        self.assertGreater(lv15, none)
        self.assertGreater(lv15, lv7)
        self.assertGreater(lv7, none)

    def test_omitted_cube_means_the_character_default_cube(self):
        # 無指定はキューブ無しでは**ない** — 既定キューブで計算される。
        # 画面はこれを «(既定)» と表示して約束している
        omitted = self._total({})
        none = self._total({"cube": {"name": "없음", "level": 0}})
        self.assertGreater(omitted, none)

    def test_site_default_cube_matches_the_engine_default(self):
        # 画面の «(既定)» の中身は settings.json の characters[name].cube。
        # これがエンジンの既定と食い違うと、表示だけ正しくて数値が別物になる
        settings = json.loads(
            (SITE_DIR / "public" / "settings.json").read_text(encoding="utf-8"))
        site_default = settings["characters"]["리타"]["cube"]
        omitted = self._total({})
        explicit = self._total({"cube": {
            "name": site_default["name"], "level": int(site_default["level"]),
        }})
        self.assertEqual(omitted, explicit)
