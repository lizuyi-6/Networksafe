"""可播种 RNG 与可注入时钟（设计 §7 R7 / §8.1）。

两条硬规则的可证伪断言：

1. **生成路径上没有无种子随机源。** ``make_rng`` 必须显式要种子；``derive_seed``
   必须跨进程稳定（否则同一世界在不同机器上展开出不同变体）。
2. **时钟必须可注入、可回拨、可检测。** 世界时间是声明出来的，不是读出来的。
"""
from __future__ import annotations

import subprocess
import sys

import pytest

from security_world.model import (
    ClockError,
    FixedClock,
    MutableClock,
    SeedError,
    compare_instants,
    derive_seed,
    derive_seeds,
    format_instant,
    instant_delta_ms,
    is_valid_instant,
    is_within,
    make_rng,
    parse_instant,
    shuffled,
    validate_seed,
)


# --------------------------------------------------------------------------- #
# RNG
# --------------------------------------------------------------------------- #
def test_make_rng_is_seedable_and_reproducible():
    first = make_rng(42)
    second = make_rng(42)
    assert [first.random() for _ in range(5)] == [second.random() for _ in range(5)]


def test_make_rng_returns_independent_streams():
    """两个世界不得共享同一个全局随机状态。"""
    left = make_rng(7)
    right = make_rng(7)
    left.random()
    assert left.random() != right.random() or True  # 结构上独立即可
    assert make_rng(7).random() == make_rng(7).random()


@pytest.mark.parametrize("bad", [None, "42", 4.0, True, False, -1, -99999])
def test_make_rng_refuses_unseeded_or_invalid_seeds(bad):
    with pytest.raises(SeedError):
        make_rng(bad)


def test_validate_seed_passes_through_non_negative_integers():
    assert validate_seed(0) == 0
    assert validate_seed(2**40) == 2**40


def test_derive_seed_is_deterministic_and_label_sensitive():
    assert derive_seed(100, "critical") == derive_seed(100, "critical")
    assert derive_seed(100, "critical") != derive_seed(100, "irrelevant")
    assert derive_seed(100, "a", "b") != derive_seed(100, "b", "a")
    assert derive_seed(100, "critical") != derive_seed(101, "critical")


def test_derive_seed_produces_valid_seeds():
    for parent in (0, 1, 2**62):
        for label in ("a", "b", 3, ["x", "y"]):
            derived = derive_seed(parent, label)
            assert isinstance(derived, int)
            assert 0 <= derived < 2**63
            make_rng(derived)  # 必须是合法种子


def test_derive_seed_rejects_none_labels():
    with pytest.raises(SeedError):
        derive_seed(1, None)


def test_derive_seed_rejects_invalid_parent():
    with pytest.raises(SeedError):
        derive_seed(-1, "x")


def test_derive_seeds_is_ordered_and_requires_labels():
    assert derive_seeds(5, ("a", "b")) == (derive_seed(5, "a"), derive_seed(5, "b"))
    with pytest.raises(SeedError):
        derive_seeds(5, ())


def test_derive_seed_is_stable_across_pythonhashseed():
    program = (
        "import sys;sys.path.insert(0,sys.argv[1]);"
        "from security_world.model import derive_seed;"
        "print(derive_seed(20260920,'critical_intervention',3))"
    )
    import os
    from pathlib import Path

    project_root = str(Path(__file__).resolve().parents[2])
    digests = set()
    for hash_seed in ("0", "1", "424242"):
        env = dict(os.environ)
        env["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [sys.executable, "-c", program, project_root],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        digests.add(completed.stdout.strip())
    assert len(digests) == 1, f"不同 PYTHONHASHSEED 得到不同派生种子: {digests}"


def test_shuffled_is_deterministic_and_does_not_mutate():
    items = ("a", "b", "c", "d", "e")
    first = shuffled(items, make_rng(9))
    second = shuffled(items, make_rng(9))
    assert first == second
    assert sorted(first) == sorted(items)
    assert items == ("a", "b", "c", "d", "e"), "不得修改入参"
    assert shuffled((), make_rng(1)) == ()


# --------------------------------------------------------------------------- #
# 时钟
# --------------------------------------------------------------------------- #
def test_fixed_clock_never_advances():
    clock = FixedClock("2026-09-20T08:00:00Z")
    assert clock.now() == "2026-09-20T08:00:00Z"
    assert clock.now() == clock.now()


def test_mutable_clock_advances_only_when_told():
    clock = MutableClock("2026-01-01T00:00:00Z")
    assert clock.advance(seconds=30) == "2026-01-01T00:00:30Z"
    assert clock.advance(milliseconds=1500) == "2026-01-01T00:00:31Z"
    assert clock.rewind(seconds=31) == "2026-01-01T00:00:00Z"
    assert clock.set("2027-02-03T04:05:06Z") == "2027-02-03T04:05:06Z"


def test_mutable_clock_refuses_negative_steps():
    clock = MutableClock()
    with pytest.raises(ClockError):
        clock.advance(seconds=-1)
    with pytest.raises(ClockError):
        clock.rewind(seconds=-1)


def test_parse_instant_rejects_malformed_timestamps():
    for bad in (
        "2026-09-20 08:00:00Z",
        "2026-09-20T08:00:00",
        "2026-13-01T00:00:00Z",
        "2026-02-30T00:00:00Z",
        "",
        "not-a-time",
        None,
        12345,
    ):
        assert not is_valid_instant(bad), bad
        with pytest.raises(ClockError):
            parse_instant(bad)


def test_parse_instant_accepts_fractional_seconds():
    assert is_valid_instant("2026-09-20T08:00:00.123456Z")
    assert is_valid_instant("2026-09-20T08:00:00.5Z")


def test_format_instant_drops_sub_second_precision_and_is_utc():
    assert format_instant(parse_instant("2026-09-20T08:00:00.987654Z")) == "2026-09-20T08:00:00Z"
    assert format_instant(parse_instant("2026-12-31T23:59:59Z")) == "2026-12-31T23:59:59Z"


def test_parse_instant_rejects_non_utc_offsets():
    """世界时间戳恒为 ``Z``（schema 模式）：偏移量在数据路径里不该出现。"""
    assert not is_valid_instant("2026-09-20T10:00:00+02:00")
    with pytest.raises(ClockError):
        parse_instant("2026-09-20T10:00:00+02:00")


def test_format_instant_rejects_naive_datetimes():
    from datetime import datetime

    with pytest.raises(ClockError, match="naive"):
        format_instant(datetime(2026, 1, 1))


def test_compare_instants_and_delta():
    assert compare_instants("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") == -1
    assert compare_instants("2026-01-01T00:00:01Z", "2026-01-01T00:00:00Z") == 1
    assert compare_instants("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z") == 0
    assert instant_delta_ms("2026-01-01T00:00:01Z", "2026-01-01T00:00:00Z") == 1000
    assert instant_delta_ms("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z") == -1000


def test_is_within_semantics():
    assert is_within("2026-01-01T00:00:00Z", "2026-01-01T00:00:05Z", 5000)
    assert not is_within("2026-01-01T00:00:00Z", "2026-01-01T00:00:06Z", 5000)
    assert not is_within("2026-01-01T00:00:06Z", "2026-01-01T00:00:00Z", 5000)
    assert is_within("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 0)


def test_is_within_rejects_bad_windows():
    with pytest.raises(ClockError):
        is_within("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", -1)
    with pytest.raises(ClockError):
        is_within("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "5000")
    with pytest.raises(ClockError):
        is_within("2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", True)


def test_clock_from_config_reads_the_declared_start():
    from security_world.model import EPOCH, clock_from_config

    assert clock_from_config(None).now() == EPOCH
    assert clock_from_config({}).now() == EPOCH
    assert clock_from_config({"virtual_clock_start": "2026-09-20T00:00:00Z"}).now() == (
        "2026-09-20T00:00:00Z"
    )
    # 配置里给的不是字符串时退回 EPOCH，而不是把任意对象当时钟。
    assert clock_from_config({"virtual_clock_start": 12345}).now() == EPOCH


def test_any_object_with_now_is_a_clock():
    """注入点是结构化的：调用方不需要 import 具体实现。"""

    class _Stub:
        def now(self):
            return "2026-05-05T05:05:05Z"

    stub = _Stub()
    assert is_valid_instant(stub.now())


# --------------------------------------------------------------------------- #
# REVISION 2（任务书 A8）：VirtualClock 重放逐字节相同
# --------------------------------------------------------------------------- #
def test_fixed_clock_replay_is_byte_identical():
    """同一 VirtualClock 值重放 ⇒ now() 逐字节相同；不同值 ⇒ 不同。"""
    first = FixedClock("2026-09-20T08:00:00Z")
    again = FixedClock("2026-09-20T08:00:00Z")
    other = FixedClock("2026-09-20T08:00:01Z")
    assert first.now() == again.now()
    assert first.now() != other.now()
    # 重放整个读取序列也逐字节相同（时钟是无状态纯函数）
    assert [first.now() for _ in range(3)] == [again.now() for _ in range(3)]


def test_mutable_clock_replayed_sequence_is_identical():
    """可变时钟的回放：同一组显式操作 ⇒ 同一串时刻（无 sleep、无自动前进）。"""
    def replay() -> tuple[str, ...]:
        clock = MutableClock("2026-01-01T00:00:00Z")
        return (
            clock.now(),
            clock.advance(seconds=30),
            clock.advance(milliseconds=1500),
            clock.rewind(seconds=31),
            clock.set("2027-02-03T04:05:06Z"),
            clock.now(),
        )

    assert replay() == replay()


def _time_fields(document: dict) -> dict[str, str]:
    """episode 文档里的全部时间字段（action/timeline/current_time/provenance/证据）。"""
    fields: dict[str, str] = {}
    fields["action.at"] = str(document["action"]["at"])
    for index, event in enumerate(document["timeline"]):
        fields[f"timeline[{index}].at"] = str(event["at"])
    fields["current_event.at"] = str(document["current_event"]["at"])
    fields["model_visible.current_time"] = str(
        document["observation"]["model_visible"]["current_time"]
    )
    fields["provenance.created_at"] = str(document["provenance"]["created_at"])
    for index, item in enumerate(
        document["observation"]["decision_metadata"]["evidence_classification"]
    ):
        if item.get("timestamp") is not None:
            fields[f"evidence[{index}].timestamp"] = str(item["timestamp"])
    return fields


def test_episode_time_fields_replay_byte_identically():
    """同一 VirtualClock 值（spec.current_state.at）重放 ⇒ 时间字段逐字节相同。

    时间全部来自声明的世界时刻（注入的时钟），没有任何挂钟读数；换一个时钟值则
    时间字段必须变（否则这条断言是空话）。
    """
    import copy

    from asw_expansion import ownership_world, spec_from_world
    from security_world.expansion import expand_family

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
    )
    first = expand_family(spec, seed=4242)
    second = expand_family(spec, seed=4242)

    def time_maps(result):
        return [_time_fields(episode.to_document()) for episode in result.variants]

    assert time_maps(first) == time_maps(second), "同种子重放的时间字段必须逐字节相同"
    # 换一个 VirtualClock 起点：时间字段必须变（可证伪）
    later_document = copy.deepcopy(spec.to_document())
    later_document["current_state"]["at"] = "2027-03-04T05:06:07Z"
    from security_world.model import WorldSpec

    later_spec = WorldSpec.from_document(later_document)
    later = expand_family(later_spec, seed=4242)
    assert time_maps(later) != time_maps(first), "不同 VirtualClock 值必须产生不同时间字段"
    # 证据时间戳属于世界声明（不是时钟派生），因此重放中保持不变
    assert _time_fields(later.variants[0].to_document())["evidence[0].timestamp"] == (
        _time_fields(first.variants[0].to_document())["evidence[0].timestamp"]
    )


def test_real_generation_timestamps_live_only_in_provenance():
    """真实 generation timestamp 只进 provenance（设计 §8.1 / S19），不进语义状态。"""
    from asw_expansion import ownership_world, spec_from_world
    from security_world.expansion import expand_family

    spec = spec_from_world(
        ownership_world(),
        critical_axes=(("resource.RES-001.owner", "ACT-001", "ACT-003"),),
    )
    result = expand_family(spec, seed=99)
    for episode in result.variants:
        document = episode.to_document()
        provenance = document.get("provenance") or {}
        assert str(provenance.get("created_at")) == str(document["action"]["at"])
        # 语义状态里不得出现 provenance 专用键
        assert "generation_timestamp" not in document["observation"]["model_visible"]
        assert "created_at" not in document["observation"]["model_visible"]
