"""G12：可疑判决线索词审计（表层/标签泄漏防护，任务书 A1 / 设计 §10 R3 的补强）。

G11 度量的是**统计**泄漏（表层特征与 verdict 的互信息）；G12 堵的是**词法**泄漏：
渲染表面里出现一个可直接解题的判决线索词（``malicious`` / ``attack`` /
``invalid`` / ``blocked`` …），模型不需要任何安全推理，做一次字符串匹配就能拿到
标签。这类泄漏是生成器把答案写进了观测，不是采样噪声——因此它是**硬门**，逐
episode 判定，没有最小样本量（一个泄漏样本就足以让 benchmark 失去意义）。

规则（任务书 A1 逐条落地）：

* **decision_metadata 侧允许出现**——``attack_family`` / ``hypothesized_verdict``
  之类的词本来就属于 oracle 与门禁侧，G12 只审模型可见侧；
* **model_visible / rendered_text 侧出现即失败**——包括 ``request.rendered_text``
  与七键证据投影的每个字符串（键与值都审：一个叫 ``X-Attack-Flag`` 的头同样是
  线索）。

REVISION 3（21-world 深审 P0-2）：匹配单元从"紧邻粘合字符豁免的词"改成
**标识符段**。

* **旧规则**：marker 紧邻 ``.`` / ``@`` / ``_`` / 字母数字时不算命中。于是
  ``SES-L2-ATTACK.valid``（session id 里带 ``.valid``）、``ACT-L2-ATTACKER``、
  事件 summary 的 "Compromised CI service session starts." 全部过关——真实
  provider run 的 104 个 episode 实跑 0 命中，而这三个字符串都把答案写在了脸上。
* **新规则**：按 ``[-._/@]`` 切片后**逐段精确匹配**词表（大小写不敏感）。
  ``SES-L2-ATTACK`` 切出 ``ATTACK`` ⇒ 命中；``X-Actor-Display-Name`` 切出的
  每段都不是判决词 ⇒ 不误伤；``attacker`` / ``attacks`` / ``compromised``
  进入词表（``ACT-L2-ATTACKER``、``compromised`` summary 都是标签泄漏，
  "谁在做"与"判决是什么"的区分在**实体 id 与事件摘要**上不成立——id 叫
  ``ACT-L2-ATTACKER`` 就是在声明这个 actor 就是攻击方）。

**保留域名豁免**（为什么不能把分段规则做成无脑切片）：合成语料全员使用 RFC 2606
保留域名 ``*.example.invalid``（Host 头 slug、邮箱地址），无脑切片会把其中的
``invalid`` 当成判决词，让整个数据集假失败。豁免是**显式且有界**的：

1. marker 本身是保留后缀（``invalid`` 等）且紧跟在一个 ``.`` 后 ⇒ 它是域名的
   TLD，不是 ``status: invalid`` 里的判决词（``(?<![.])`` 固定宽后视）；
2. marker 后面的同一 token 内出现 ``.<reserved>`` 结尾（如
   ``…-attacker-controlled-….example.invalid``）⇒ 整个 token 是域名/邮箱，
   按 DNS 名处理，不按散文处理（``domain_tail`` 前瞻；``/`` 不在前瞻字符类里，
   因此豁免不会跨路径段蔓延到 ``/api/attack`` 这种真正的线索）。

两条豁免都只认 RFC 2606 的四个保留后缀（``invalid`` / ``test`` / ``localhost``
/ ``example``），不认 ``.com`` 之类真实 TLD——豁免面越窄越好，审阅者能自己复核。
``aetherguard-synthetic-client`` 这类正常 UA 不依赖豁免：切片后没有任何一段
是判决词。规则如实写在这里，取舍可复核。

**第三条豁免**（schema 词汇复合词）：``attacker`` 紧跟 ``[-_]controlled`` /
``[-_]controllable`` 时是 schema 自己的词汇（``evidence.attacker_controllable``
字段名、``actor_type: attacker_controlled_account`` 枚举值），手写语料合法地让它们
进入模型可见侧。豁免只认这两个段：``ACT-L2-ATTACKER``（末段）与 "Attacker replays
the consumed code"（后跟普通词）照常命中。
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .errors import ValidationError

#: 默认可疑线索词表（``configs/default.json`` 的 ``quality_gates.G12`` 可增补）。
#: 前 13 个是任务书点名必须的；``exploitation`` / ``malware`` 是同一语义族的常见
#: 变形（"等"的部分）。
#:
#: REVISION 3（P0-2）增补 ``attacker`` / ``attacks`` / ``compromised``：真实
#: provider run 的 W-L2-001 / W-L4-001 把答案写进实体 id（``ACT-L2-ATTACKER``）、
#: session id（``SES-L2-ATTACK.valid``）与事件 summary（"Compromised CI service
#: session starts."），旧词表 + 旧粘合规则对它们 0 命中。此前把这两个词如实排除
#: 的理由是"人工语料合法地把 attacker 用作角色描述"——那条残留现在由**保留域名
#: 豁免**收口（HC-023 的 ``application.name`` 以 Host slug 形式进入模型可见侧，
#: 是域名不是散文），不再需要靠把词表改窄换绿灯。词表在 config 里可增补，不需要
#: 改代码。
SUSPICIOUS_MARKERS: tuple[str, ...] = (
    "malicious",
    "unauthorized",
    "attack",
    "attacker",
    "attacks",
    "suspicious",
    "invalid",
    "violation",
    "exploit",
    "exploitation",
    "forbidden",
    "blocked",
    "denied",
    "benign",
    "idor",
    "injection",
    "malware",
    "compromised",
)

#: RFC 2606 保留域名后缀。``*.example.invalid`` 是合成语料的保留主机名，其中的
#: ``invalid`` / ``example`` 是 DNS 保留后缀，不是判决词。只认这四个——真实 TLD
#: （``.com`` 等）不在豁免里，豁免面越窄越好。
_RESERVED_DOMAIN_SUFFIXES: tuple[str, ...] = ("invalid", "test", "localhost", "example")

#: **schema 词汇复合词豁免**（REVISION 3，P0-2 的第二条豁免）。``attacker`` 紧跟
#: ``[-_]controlled`` / ``[-_]controllable`` 时是 world-spec schema 自己的词汇——
#: ``evidence.attacker_controllable`` 是证据目录的字段名，``attacker_controlled_account``
#: 是 ``actor_type`` 的枚举值。手写语料合法地让它们进入模型可见侧（HC-006 的
#: ``actor_type`` 被 structured_state 投影、HC-023 的 summary "the only ownership
#: evidence is attacker-controllable"），它们是**属性名**不是判决。
#:
#: 豁免故意极窄：只认这两个段、只认 ``attacker`` 这个 marker、段后还必须紧跟非
#: 字母数字。``ACT-L2-ATTACKER``（attacker 是末段）与 "Attacker replays the
#: consumed code"（attacker 后跟普通词）照常命中——真实泄漏一个不放。
_SCHEMA_COMPOUND_SEGMENTS: Mapping[str, tuple[str, ...]] = {
    "attacker": ("controlled", "controllable"),
}

#: 单个命中片段的上下文字符数（写进 detail，便于人工复核）。
_EXCERPT_CONTEXT = 24

#: 标识符/路径分段字符（``[-._/@]`` 再加字母数字）：marker 必须是**完整一段**。
#: 与字母数字相邻 ⇒ 嵌在更长的词里（``attackers`` / ``preattack``），不算命中；
#: 与 ``-._/@`` 相邻 ⇒ 恰好是分段边界，正是要抓的标识符段泄漏。
_WORD_CHARS = "A-Za-z0-9"

#: 域名尾部的前瞻模式：同一 token 里 marker 之后出现 ``.<reserved suffix>`` 且其后
#: 是 **token 边界**（非 ``[-._/@]``、非字母数字）⇒ 这个 token 是保留域名/邮箱
#: （Host slug、``act-001@example.invalid``），整体按 DNS 名豁免。``/`` 故意不在
#: 字符类里：豁免不得跨路径段（``/api/attack`` 后面的 ``.example.invalid`` 不能把
#: 路径里的 ``attack`` 一起豁免掉）；保留后缀后也必须是 token 边界，否则
#: ``attack-api.example.com`` 里的 ``.example`` 只是标签不是 TLD，照常命中。
_DOMAIN_TAIL = (
    rf"(?![{_WORD_CHARS}_.@-]*\.(?:{'|'.join(_RESERVED_DOMAIN_SUFFIXES)})"
    rf"(?![{_WORD_CHARS}_.@/-]))"
)


def marker_pattern(markers: Sequence[str] | None = None) -> re.Pattern[str]:
    """编译 marker 匹配模式（大小写不敏感、标识符段精确、保留域名豁免）。

    ``markers=None`` 用内置表；显式传空序列是**错误**（空表会让门永真）。

    每条 marker 编译成::

        (?<![A-Za-z0-9])            # 段边界：不与字母数字相邻
        [(?<![.])]                  # 仅保留后缀：不紧跟 '.'（那是 TLD，不是词）
        <marker>
        (?![A-Za-z0-9])             # 段边界
        (?!<domain_tail>)           # 不在保留域名 token 里

    后视是固定宽的（Python ``re`` 不支持变宽后视），域名豁免因此拆成"后缀 marker
    的 ``(?<![.])``" + "任意 marker 的域名尾前瞻"两半，语义与文档一致。
    """
    resolved = SUSPICIOUS_MARKERS if markers is None else tuple(markers)
    if not resolved:
        raise ValidationError("empty_marker_list", "G12 的 marker 表不能为空（空表会让门永真）")
    for marker in resolved:
        if not marker or not marker.isalnum():
            raise ValidationError(
                "bad_marker", f"G12 marker 必须是非空字母数字词，得到 {marker!r}"
            )
    alternatives: list[str] = []
    for marker in sorted(set(resolved)):
        suffix_guard = "(?<![.])" if marker in _RESERVED_DOMAIN_SUFFIXES else ""
        compound_guard = ""
        segments = _SCHEMA_COMPOUND_SEGMENTS.get(marker)
        if segments:
            compound_guard = rf"(?![-_](?:{'|'.join(segments)})(?![{_WORD_CHARS}]))"
        alternatives.append(
            rf"(?<![{_WORD_CHARS}]){suffix_guard}{re.escape(marker)}(?![{_WORD_CHARS}])"
            f"{compound_guard}{_DOMAIN_TAIL}"
        )
    return re.compile("|".join(f"(?:{alternative})" for alternative in alternatives), re.IGNORECASE)


def markers_in_text(text: str, *, markers: Sequence[str] | None = None) -> tuple[str, ...]:
    """一段文本里出现的全部线索词（去重、排序、统一小写）。"""
    if not isinstance(text, str) or not text:
        return ()
    pattern = marker_pattern(markers)
    found = {match.group(0).lower() for match in pattern.finditer(text)}
    return tuple(sorted(found))


@dataclass(frozen=True)
class MarkerHit:
    """一处泄漏：哪个词、在 model_visible 的哪个 JSON 路径、原文摘录。"""

    marker: str
    path: str
    excerpt: str

    def to_document(self) -> dict[str, Any]:
        return {"marker": self.marker, "path": self.path, "excerpt": self.excerpt}


def _excerpt(text: str, start: int, end: int) -> str:
    left = max(0, start - _EXCERPT_CONTEXT)
    right = min(len(text), end + _EXCERPT_CONTEXT)
    prefix = "…" if left > 0 else ""
    suffix = "…" if right < len(text) else ""
    return f"{prefix}{text[left:right]}{suffix}"


def scan_model_visible(
    model_visible: Any, *, markers: Sequence[str] | None = None
) -> tuple[MarkerHit, ...]:
    """递归扫描 ``observation.model_visible`` 的键与字符串值。

    键也审：一个名为 ``X-Attack-Flag`` 的 header 与一个值为 ``attack`` 的字段
    同样是线索。数字/布尔/None 不审（它们不可能携带词法线索）。
    """
    pattern = marker_pattern(markers)
    hits: list[MarkerHit] = []

    def walk(node: Any, path: str) -> None:
        if isinstance(node, Mapping):
            for key, value in node.items():
                key_text = str(key)
                for match in pattern.finditer(key_text):
                    hits.append(MarkerHit(match.group(0).lower(), f"{path}/{key_text}", key_text))
                walk(value, f"{path}/{key_text}")
        elif isinstance(node, (list, tuple)):
            for index, value in enumerate(node):
                walk(value, f"{path}/{index}")
        elif isinstance(node, str):
            for match in pattern.finditer(node):
                hits.append(
                    MarkerHit(
                        match.group(0).lower(),
                        path,
                        _excerpt(node, match.start(), match.end()),
                    )
                )

    walk(model_visible, "model_visible")
    return tuple(hits)


@dataclass(frozen=True)
class LexicalLeakageReport:
    """G12 的结论。"""

    samples: int
    markers: tuple[str, ...]
    hits: tuple[MarkerHit, ...] = ()

    @property
    def passed(self) -> bool:
        return not self.hits

    def to_document(self) -> dict[str, Any]:
        return {
            "samples": self.samples,
            "markers": list(self.markers),
            "passed": self.passed,
            "hits": [hit.to_document() for hit in self.hits[:16]],
            "hit_count": len(self.hits),
        }


def lexical_label_leakage(
    episode: Any, *, markers: Sequence[str] | None = None
) -> LexicalLeakageReport:
    """对一个 episode 跑 G12（设计 §13.5：每个 Gate 一正一反两个可证伪断言）。"""
    resolved_markers = tuple(markers) if markers else SUSPICIOUS_MARKERS
    observation = getattr(episode, "observation", None)
    if observation is None and isinstance(episode, Mapping):
        observation = episode.get("observation")
    if not isinstance(observation, Mapping):
        return LexicalLeakageReport(
            samples=1, markers=resolved_markers, hits=(MarkerHit("", "observation", "episode 没有 observation"),)
        )
    model_visible = observation.get("model_visible")
    if not model_visible:
        return LexicalLeakageReport(
            samples=1,
            markers=resolved_markers,
            hits=(MarkerHit("", "model_visible", "episode 没有 model_visible 可审"),),
        )
    return LexicalLeakageReport(
        samples=1,
        markers=resolved_markers,
        hits=scan_model_visible(model_visible, markers=resolved_markers),
    )


def markers_from_config(config: Mapping[str, Any] | None) -> tuple[str, ...]:
    """从 ``quality_gates.G12_lexical_label_leakage.markers`` 读词表（缺省用内置表）。"""
    if not isinstance(config, Mapping):
        return SUSPICIOUS_MARKERS
    gates = config.get("quality_gates")
    if not isinstance(gates, Mapping):
        return SUSPICIOUS_MARKERS
    section = gates.get("G12_lexical_label_leakage")
    if not isinstance(section, Mapping):
        return SUSPICIOUS_MARKERS
    markers = section.get("markers")
    if markers is None:
        return SUSPICIOUS_MARKERS
    if not isinstance(markers, Sequence) or isinstance(markers, (str, bytes)):
        raise ValidationError(
            "bad_marker_list", "quality_gates.G12.markers 必须是字符串数组"
        )
    resolved = tuple(str(item) for item in markers)
    return resolved if resolved else SUSPICIOUS_MARKERS


def iter_marker_hits(
    episodes: Iterable[Any], *, markers: Sequence[str] | None = None
) -> tuple[MarkerHit, ...]:
    """对一批 episode 汇总全部命中（数据集级报告用）。"""
    hits: list[MarkerHit] = []
    for episode in episodes:
        hits.extend(lexical_label_leakage(episode, markers=markers).hits)
    return tuple(hits)


__all__ = [
    "SUSPICIOUS_MARKERS",
    "LexicalLeakageReport",
    "MarkerHit",
    "iter_marker_hits",
    "lexical_label_leakage",
    "marker_pattern",
    "markers_from_config",
    "markers_in_text",
    "scan_model_visible",
]
