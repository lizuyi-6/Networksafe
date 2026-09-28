"""L4 展开层（``security_world.expansion``）的异常体系。

与 L1 的 ``CompileError`` 同款形态：``ValueError`` 子类 + 机器可判定的
``reason_code``（Gate 与 release 的 ``rejection_reasons`` 直接统计它，
**不是**自然语言）。展开层的四类操作各有自己的子类，调用方可以分别捕获：

* :class:`InterventionError` —— 关键变量干预（``critical_intervention``）；
* :class:`PerturbationError` —— 无关扰动（``irrelevant_perturbation``）；
* :class:`MaskingError` —— 证据掩蔽（``mask_evidence``）；
* :class:`RenderError` —— 观测渲染（``render`` / 投影白名单）；
* :class:`EpisodeAssemblyError` —— episode 组装（``assemble_episode``）。

共同基类 :class:`ExpansionError` 派生自 ``security_world.model.errors.ModelError``：
展开层的错误同样是"确定性的、可预期的"错误，``except ValueError`` 的既有写法
必须继续工作。
"""
from __future__ import annotations

from ..model.errors import ModelError


class ExpansionError(ModelError):
    """L4 全部确定性错误的基类。"""

    def __init__(self, reason_code: str, detail: str = "") -> None:
        self.reason_code = reason_code
        self.detail = detail
        message = f"expansion 拒绝（reason_code={reason_code}）"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


class InterventionError(ExpansionError):
    """单变量反事实干预被拒绝。

    ``reason_code`` 取值：

    * ``path_not_id_view`` —— ``intervention_variable`` 不是 ID 视图路径；
    * ``path_unresolvable`` —— 路径在本世界解析不了（悬空引用/未知字段）；
    * ``no_op_intervention`` —— ``after`` 与现值相同，干预不改变任何状态；
    * ``axis_not_in_whitelist`` —— 提供了白名单但该轴不在其中（§9.5）；
    * ``not_single_variable`` —— 干预后 ``diff_worlds`` 发现不止一个路径变化
      （机械断言失败，绝不静默接受——D4）。
    """


class PerturbationError(ExpansionError):
    """无关扰动被拒绝。

    ``reason_code`` 取值：

    * ``axis_not_observation_path`` —— 轴不是 ``observation.(request|rendering).*``
      表面路径（§9.2 / B9：扰动世界状态即使 Gate 6 永假）；
    * ``unsupported_axis`` —— 轴语法正确但本引擎不实现该轴（不静默 no-op——
      一个什么都不改的"扰动"会让不变性测试变成假通过）；
    * ``observation_without_surface`` —— 观测缺少渲染表面，无法保质地重渲染。
    """


class MaskingError(ExpansionError):
    """证据掩蔽被拒绝：世界目录支撑不了请求的 level（§9.4）。

    ``reason_code`` 取值：

    * ``unknown_level`` —— level 不在 7 类词表里；
    * ``invalid_consulted_facts`` —— ``consulted_facts`` 含非字符串/空串；
    * ``no_non_consulted_evidence`` —— 世界里没有"非 consulted"证据可藏
      （``partially_missing`` / 诱饵变体不可构造）；
    * ``consulted_fact_without_establishing_evidence`` —— 某 consulted 事实
      没有任何 establishing 可见证据（``minimally_sufficient`` 不可构造）；
    * ``world_declares_no_stale_evidence`` —— 没有陈旧 establishing 证据
      （``stale`` 不可构造）；
    * ``no_requires_fresh_policy`` —— 没有 in-scope 策略 ``requires_fresh=true``
      （§9.4 的 stale 判定不可满足）；
    * ``world_declares_no_attacker_controllable_evidence`` —— 没有攻击者可控
      证据（``attacker_controlled`` 不可构造）；
    * ``level_rule_not_achieved`` —— 构造后复核未达到该 level 的判定规则。
    """


class RenderError(ExpansionError):
    """观测渲染被拒绝。

    ``reason_code`` 取值：

    * ``unknown_renderer`` / ``unknown_style`` —— 不在词表里；
    * ``projection_forbidden`` —— 渲染结果触发了 ``configs.rendering
      .projection_allowlist`` 的禁止项（B12：越界投影即抛，不静默裁剪）；
    * ``visible_evidence_missing_timestamp`` —— 可见证据缺 ``timestamp``，
      而 ``episode.schema.json`` 的 ``evidence_observation`` 七键投影要求它
      （缺了就只能二选一：伪造一个时间戳，或产出一个过不了 schema 的 episode——
      两者都不可接受，因此硬失败）；
    * ``invalid_timeline`` —— 时间线为空或不是事件序列。
    """


class EpisodeAssemblyError(ExpansionError):
    """episode 组装被拒绝。

    ``reason_code`` 取值：

    * ``unknown_variant_type``；
    * ``intervention_required`` —— ``critical_intervention`` /
      ``irrelevant_perturbation`` 变体没有 intervention 记录（schema 的
      allOf/if-then，内存层同样强制）；
    * ``oracle_output_mismatch`` —— 调用方给的 ``oracle_output`` 与
      ``(world, action, evidence_view)`` 的重算结果不一致（G4 性质的组装期强制）；
    * ``observation_projection_mismatch`` —— 观测携带的证据投影与世界/视图的
      权威可见性不一致（S7：三处可见性表示必须一致）；
    * ``empty_timeline`` —— ``timeline`` 为空（schema minItems: 1）；
    * ``bad_generator_provenance`` —— ``generator_provenance`` 出现闭键白名单
      之外的键（B7）。
    """


__all__ = [
    "EpisodeAssemblyError",
    "ExpansionError",
    "InterventionError",
    "MaskingError",
    "PerturbationError",
    "RenderError",
]
