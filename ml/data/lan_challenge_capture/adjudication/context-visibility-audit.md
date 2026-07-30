# VIguard Context-Visibility Audit

Audited all **413** model-visible inputs: 253 model-adjudication rows and 160 strict-consensus rows.

## Evidence boundary

- **Model-visible evidence** is limited to the matching row in `model-inputs.jsonl`: request method, path, headers, body, and the two `sourceContext` fields.
- **Adjudicator auxiliary context** includes environment files, endpoint inventories, role matrices, collection plans, and response-side observations. Those sources may explain collection, but they cannot make a reference label more certain than the evaluated model can be.
- A complete attack syntax remains an attack only when the model-visible field is itself a clear security-sensitive execution entry. Text in a note, filter, search, or record field is not assumed to execute, render, or reach an interpreter.

## Results

- Hidden-context issues corrected: **68**
- Labels retained after review: **345**
- Principal-role dependencies removed: **26**
- Missing object ownership / tenant scope corrected: **23**
- Missing server execution/rendering semantics corrected: **19**
- Response-side evidence or response outcomes used: **no**
- Collector ground truth, collector intent, or AetherArgus predictions used: **no**

The corrected labels use `verdict=unknown`, `contextSufficient=false`, `recommendedAction=challenge`, and `resolutionDecision=insufficient_context`. Role-dependent cases use the `authorization` family, object-scope cases use `idor_bola`, and stored-text cases retain their visible payload family.

## Corrected labels

| Sample | Previous | Final | Family | Missing model-visible context |
|---|---|---|---|---|
| viguard-lan-000115 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000116 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000117 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000118 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000119 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000120 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000121 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000122 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000128 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000129 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000130 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000131 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000132 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000163 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000164 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000165 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000168 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000169 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000170 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000171 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000172 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000173 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000174 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000175 | attack | unknown | xss | whether body.note is rendered into an executable HTML context |
| viguard-lan-000210 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000212 | attack | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000258 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000259 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000260 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000261 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000262 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000263 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000264 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000265 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000266 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000267 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000268 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000269 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000270 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000271 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000272 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000273 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000274 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000275 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000276 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000277 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000278 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000279 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000280 | safe | unknown | authorization | actual acting principal role; role-permission-matrix outcome for the collection account |
| viguard-lan-000286 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000287 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000288 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000289 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000290 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000291 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000292 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000293 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000304 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000305 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000306 | safe | unknown | idor_bola | ownership and tenant scope of the referenced alert object; whether the acting principal may modify that object |
| viguard-lan-000397 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000398 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000399 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000400 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000401 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000402 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000403 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |
| viguard-lan-000404 | attack | unknown | sqli | whether body.note, body.filter, or body.q is parsed or concatenated into a SQL interpreter |

## Fairness conclusion

Every final label is now bounded by the evidence available to AetherArgus in the corresponding `model-inputs.jsonl` row. Environment and response artifacts are provenance aids only. The audit does not claim exploit success, does not treat AI adjudication as human review, and does not make the challenge set eligible for training.
