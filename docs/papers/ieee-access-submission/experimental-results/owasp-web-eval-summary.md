# OWASP-Derived Evaluation Summary

Source report: `owasp-web-eval.json`

Dataset

- Total samples: 32
- Families: `sqli`, `xss`, `path_traversal`, `command_injection`
- Balance: 4 attack + 4 benign requests per family

Overall baselines

- `single_agent`: accuracy `0.8750`, precision `0.8000`, recall `1.0000`, F1 `0.8889`, FP `4`, FN `0`
- `multi_agent_no_debate`: accuracy `0.8750`, precision `0.8000`, recall `1.0000`, F1 `0.8889`, FP `4`, FN `0`
- `multi_agent_with_debate`: accuracy `1.0000`, precision `1.0000`, recall `1.0000`, F1 `1.0000`, FP `0`, FN `0`

Ablation highlight

- All 4 false positives in the non-debate baselines come from benign `command_injection` requests.
- `multi_agent_with_debate` removes all 4 of those false positives.
- Debate triggered on 12 of 32 requests (`37.5%`).
- Average debate rounds across the full corpus: `0.75`.

Latency notes

- Debate-enabled full-system averages: proxy `0.0484 ms`, role analysis `0.1250 ms`, debate `0.0938 ms`, end-to-end `0.5000 ms`
- Route-mode averages:
  - `cloud_only`: debate `0.2813 ms`, end-to-end `0.8438 ms`
  - `local_preferred`: debate `0.1875 ms`, end-to-end `0.7500 ms`
  - `hybrid_verify`: debate `0.0938 ms`, end-to-end `0.7813 ms`

Interpretation constraints

- These route-mode timings are orchestration measurements under heuristic fallback.
- They are not full LLM latency measurements.
- `ModSecurity + CRS` runner exists in code but was not executable in the current workspace.
