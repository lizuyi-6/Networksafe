# AetherArgus dataset v0.2 gap analysis

The current tracked release contains **1200 samples** and its
manifest explicitly marks the source corpus as synthetic.

## Attack-family counts and minimum targets

| attackFamily | Current | v0.2 minimum | Gap |
| --- | ---: | ---: | ---: |
| `benign` | 660 | 5000 | 4340 |
| `sqli` | 48 | 450 | 402 |
| `xss` | 48 | 450 | 402 |
| `command_injection` | 49 | 450 | 401 |
| `path_traversal` | 48 | 450 | 402 |
| `ssrf` | 22 | 450 | 428 |
| `authentication` | 46 | 450 | 404 |
| `automation` | 19 | 400 | 381 |
| `api_abuse` | 29 | 400 | 371 |
| `deserialization` | 38 | 400 | 362 |
| `file_upload` | 7 | 400 | 393 |
| `protocol_attack` | 48 | 400 | 352 |
| `business_logic` | 6 | 400 | 394 |
| `other` | 132 | 1300 | 1168 |

## Missing or weak coverage

- Normal business gaps: registration, password_change, payment_status_query, oauth_callback, file_download, bulk_import, security_report_upload, websocket_message, waf_rule_edit, repository_commit, ticket_system, markdown_editor.
- Hard-negative gaps: waf_rule_editor_with_attack_regex, ticket_discussing_ssrf, administrator_reviewed_deployment_script, security_report_with_request_evidence, database_tool_legitimate_sql, log_poisoning_literal_as_read_only_data.
- Unknown gaps: missing_identity_and_permission, body_vs_execution_argument_ambiguity, multiple_weak_attack_families, partially_decoded_input.
- Explicit prompt-injection samples: `0`.
- Explicitly engineered contextual-attack samples: `0`.
- Statistically thin families (<25 total records): `{"automation":19,"business_logic":6,"file_upload":7,"ssrf":22}`.

## Evidence boundary

The existing 120-record test split is suitable for pipeline verification only. It cannot
support production-grade detection, family-level recall, or false-positive claims.
No real traffic is claimed.
