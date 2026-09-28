# `generation/` — Step-5-pre world seed generation (L7)

Phase 1 builds the **capability** and proves it offline. There is no live provider here,
no API key, no network call, and no 500-world run (design §11.5, §14-3/4).

| Path | What it is |
| --- | --- |
| `prompts/v0.1.md` | the world seed generator prompt (batch strict-JSON output; no HTTP enumeration; logic structure only) |
| `prompts/registry.py` | `prompt_version` → (text, output frame, `prompt_hash`). The output frame is pinned by the version, never guessed |
| `step5/client.py` | `WorldSeedClient` protocol, `RawGeneration`, and `Step5Client` — **NOT IMPLEMENTED**, refuses construction |
| `step5/replay.py` | `ReplayClient`: replays a recorded response from disk. The Phase 1 default, zero network |
| `parser/strict.py` | strict RFC 8259 JSON / JSONL frame decoding (duplicate keys, `NaN`, trailing content, truncation all rejected) |
| `parser/world_specs.py` | `parse_world_specs`: frame → validated world-spec documents + rejections |
| `provenance/record.py` | harness-owned provenance stamping (closed key set) |
| `stats/efficiency.py` | `GenerationStats`, `generation_efficiency` (GE) |
| `stats/probe.py` | `probe_batch_stability`: batch-size stability probe over recorded fixtures |
| `schema_registry.py` | loads `schemas/*.schema.json` into one registry for the parser |
| `fixtures/recorded/` | real recordings — **gitignored** (design §11.5) |
| `fixtures/synthetic/` | tracked, hand-authored probe fixtures + `build_fixtures.py` that generates them |

## What a run looks like

```python
from generation import ReplayClient, parse_world_specs, SYNTHETIC_FIXTURES_DIR
from generation.prompts import load_prompt

client = ReplayClient(SYNTHETIC_FIXTURES_DIR)          # or the default recorded/ dir
raw = client.generate(load_prompt("0.1").text, batch_size=8, max_output_tokens=8192)
result = parse_world_specs(raw, generation_timestamp="<VirtualClock value>")

result.stats.output_tokens                # what the call cost
result.stats.valid_worlds                 # accepted, unique world ids
result.stats.rejected_worlds              # element-level rejections
result.stats.valid_worlds_per_1k_tokens   # GE = valid_worlds / output_tokens * 1000
result.specs                              # validated world-spec documents
result.rejections                         # one record per rejected batch/element, with a reason code
```

`parse_world_specs` also unpacks as the §15.3 contract pair `specs, rejections`.

## The two-tier rejection rule

1. **The frame must decode perfectly.** Truncation, illegal JSON, a duplicated object key,
   a non-array top level, an empty batch, an unregistered `prompt_version`: the **whole
   batch is rejected**, `specs` is empty, and one rejection record carries the reason.
   No partial salvage — a frame we cannot fully decode is a frame we cannot trust.
2. **Elements are judged one by one.** A schema violation, a repeated `world_id`, or a
   non-object element inside a decodable frame rejects *that element* (with its index,
   `world_id` and the sorted schema error paths); the rest of the batch survives
   (design §11.2).

Nothing is ever repaired: no value coercion, no key dropping, no re-ordering, no
re-serialisation, no invented timestamp.

## Provenance

Every accepted spec gets a harness-owned `provenance` block (`origin: step5_seed`,
`generator_model`, `generator_model_version`, `prompt_version`, `prompt_hash`,
`generation_timestamp`, `raw_generation_id`, `decoding_parameters`,
`validation_outcome`). A model-emitted provenance block is discarded and the replacement
is reported in `ParseResult.warnings` — a generator cannot self-certify.

`generation_timestamp` is a VirtualClock-derived value passed in by the caller
(design §8.1); this package never reads the wall clock.

## Token accounting

`output_tokens` is what the provider charged, or what a replay fixture recorded — never
estimated. `GenerationStats.generator_model_entry()` emits a
`release.schema.json` `generator_models[]` row (`provider: replay|live`), so a frozen
release can tell recorded throughput from real throughput.

## Batch-size stability probe

```python
from generation import probe_batch_stability, SYNTHETIC_FIXTURES_DIR, default_sizes

rows = probe_batch_stability(SYNTHETIC_FIXTURES_DIR, default_sizes())
# one row per recorded fixture: elements_decoded, valid_worlds, rejected_worlds,
# duplicate_world_ids, batch_rejected, rejection_reasons, valid_worlds_per_1k_tokens
```

Brief §7: the batch size is chosen by this measurement (JSON corruption / duplicates /
schema violations as a function of how much the model was asked to emit), not by taste.

## NOT IMPLEMENTED (and why)

* **`Step5Client`** (live provider) — Phase 2, requires explicit opt-in plus an audit
  record (design §11.5). It exists as an interface and refuses to be constructed.
* **`scripts/probe_batch_size.py`** (CLI wrapper around `probe_batch_stability`) — not
  written here; `probe_batch_stability()` is the library entry point it would call.
* **Conversion of parsed documents into `security_world.model.WorldSpec`** — owned by
  Agent A (`security_world/model`, NOT IMPLEMENTED at the time of writing). The parser
  therefore returns the *document* form of a world spec, which is exactly what the
  schema validates.
* **Any label.** Ground truth belongs to `security_world/oracle` (design I-1). This layer
  validates structure and stamps provenance; it never decides safe/attack.

## Tests

`tests/unit/test_generation_*.py` (134 tests) cover the prompt registry, the replay
client (including a sockets-disabled run and a no-hardcoded-credentials scan), the strict
parser (normal / truncated / illegal-JSON / schema-invalid / duplicate-key / JSONL),
provenance stamping, the GE arithmetic, and the batch-size stability probe over the
recorded fixtures at sizes 1, 2, 4 and 8.

```bash
cd aether-security-world
py -3 -m pytest tests/unit -q
py -3 -m generation.fixtures.synthetic.build_fixtures   # regenerate the probe fixtures
```
