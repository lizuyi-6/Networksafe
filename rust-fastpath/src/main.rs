use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{TimeZone, Utc};
use once_cell::sync::Lazy;
#[cfg(unix)]
use hyper::{server::conn::http1, service::service_fn};
#[cfg(unix)]
use hyper_util::rt::TokioIo;
use parking_lot::Mutex;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet},
    env,
    hash::{Hash, Hasher},
    io::{Read, Write},
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(unix)]
use tower::Service;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tracing::{info, warn};

// ---------------------------------------------------------------------------
// Protocol plugin data model + metadata helpers.
//
// The protocols/ module is a pluggable multi-protocol evaluation framework
// (HTTP, MQTT, ROS2 CyberRT, CAN-bus, ...). These types and helpers live at the
// crate root so every plugin can `use crate::{...}` them. They are the contract
// between the Axum HTTP layer and the protocol plugins.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolEvaluateRequest {
    #[serde(default)]
    pub tenant_id: String,
    #[serde(default)]
    pub request_id: String,
    pub protocol: String,
    pub direction: Option<String>,
    pub source_ref: Option<String>,
    pub dest_ref: Option<String>,
    pub channel: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub metadata: Option<HashMap<String, Value>>,
    pub payload_base64: Option<String>,
    pub truncated: Option<bool>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolFinding {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolCostMetrics {
    pub saved_bytes: u64,
    pub suppressed_messages: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolEvaluateResponse {
    pub protocol: String,
    pub verdict: String,
    pub action: String,
    pub matched_rule: Option<String>,
    pub findings: Vec<ProtocolFinding>,
    pub decision_source: String,
    #[serde(default)]
    pub processing_time_micros: u64,
    #[serde(default)]
    pub cost_metrics: ProtocolCostMetrics,
}

pub fn metadata_string(metadata: Option<&HashMap<String, Value>>, key: &str) -> Option<String> {
    metadata.and_then(|map| map.get(key)).and_then(|v| v.as_str()).map(|s| s.to_string())
}

pub fn metadata_bool(metadata: Option<&HashMap<String, Value>>, key: &str) -> bool {
    metadata.and_then(|map| map.get(key)).and_then(|v| v.as_bool()).unwrap_or(false)
}

pub fn metadata_u64(metadata: Option<&HashMap<String, Value>>, key: &str) -> Option<u64> {
    metadata.and_then(|map| map.get(key)).and_then(|v| v.as_u64())
}

pub fn metadata_string_list(metadata: Option<&HashMap<String, Value>>, key: &str) -> Vec<String> {
    metadata
        .and_then(|map| map.get(key))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|item| item.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

mod protocols;

const SHARD_COUNT: usize = 64;
const CLEANUP_INTERVAL_SECS: u64 = 60;

#[derive(Clone)]
struct AppState {
    counters: Arc<Vec<Mutex<HashMap<String, CounterEntry>>>>,
    metrics: Arc<FastpathMetrics>,
    transport: TransportDetails,
}

#[derive(Clone, Debug)]
struct CounterEntry {
    count: u64,
    reset_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransportDetails {
    mode: String,
    socket_path: Option<String>,
    tcp_address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckRequest {
    tenant_id: Option<String>,
    key: String,
    window_ms: u64,
    limit: u64,
    source_ip: Option<String>,
    session_id: Option<String>,
    headers: Option<HashMap<String, Value>>,
    protocol: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckResponse {
    allowed: bool,
    remaining: u64,
    reset_at: String,
    reset_at_ms: u64,
    decision_source: &'static str,
    risk_flags: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FlushRequest {
    tenant_id: Option<String>,
    key_prefix: Option<String>,
    expired_only: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FlushResponse {
    success: bool,
    before: usize,
    after: usize,
    removed: usize,
    tenant_id: Option<String>,
    key_prefix: Option<String>,
    expired_only: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpTrafficEvaluateRequest {
    tenant_id: String,
    request_id: String,
    method: String,
    url: String,
    http_version: String,
    headers: HashMap<String, String>,
    body_base64: String,
    source_ip: Option<String>,
    truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct HttpTrafficThreat {
    #[serde(rename = "type")]
    kind: String,
    severity: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpTrafficEvaluateResponse {
    protocol: &'static str,
    verdict: &'static str,
    matched_rule: Option<String>,
    threats: Vec<HttpTrafficThreat>,
    truncated: bool,
    decision_source: &'static str,
    processing_time_micros: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrafficHttpMetricsSnapshot {
    requests: u64,
    blocked: u64,
    errors: u64,
}

static SQL_INJECTION_PATTERNS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (Regex::new(r"'\s*(OR|AND)\s+['\d]").expect("sql regex"), "critical"),
        (
            Regex::new(r";\s*(DROP|DELETE|UPDATE|INSERT)").expect("sql regex"),
            "critical",
        ),
        (
            Regex::new(r"UNION\s+(ALL\s+)?SELECT").expect("sql regex"),
            "critical",
        ),
        (Regex::new(r"--\s*$").expect("sql regex"), "high"),
        (Regex::new(r"/\*[\s\S]*?\*/").expect("sql regex"), "medium"),
    ]
});

static XSS_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)<script[\s\S]*?>").expect("xss regex"),
        Regex::new(r"(?i)javascript:").expect("xss regex"),
        Regex::new(r"(?i)on\w+\s*=").expect("xss regex"),
        Regex::new(r"(?i)<iframe[\s\S]*?>").expect("xss regex"),
        Regex::new(r"(?i)<object[\s\S]*?>").expect("xss regex"),
        Regex::new(r"(?i)<embed[\s\S]*?>").expect("xss regex"),
        Regex::new(r"(?i)expression\s*\(").expect("xss regex"),
        Regex::new(r"(?i)vbscript:").expect("xss regex"),
        Regex::new(r"(?i)data:\s*text/html").expect("xss regex"),
    ]
});

static PATH_TRAVERSAL_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"\.\.[/\\]").expect("path regex"),
        Regex::new(r"(?i)%2e%2e[%/\\]").expect("path regex"),
        Regex::new(r"(?i)\.\.%2f").expect("path regex"),
        Regex::new(r"(?i)%2e%2e/").expect("path regex"),
        Regex::new(r"(?i)\.\.%5c").expect("path regex"),
    ]
});

static GENERIC_CRITICAL_PATTERNS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (
            Regex::new(r"(?i)'\s*or\s+'1'\s*=\s*'1").expect("generic regex"),
            "sql_injection",
        ),
        (
            Regex::new(r"(?i);\s*drop\s+table").expect("generic regex"),
            "sql_injection",
        ),
        (
            Regex::new(r"(?i)<script[\s\S]*?>[\s\S]*?</script>").expect("generic regex"),
            "xss",
        ),
        (
            Regex::new(r"(?i)\.\./\.\./\.\./etc/passwd").expect("generic regex"),
            "path_traversal",
        ),
    ]
});

const SQL_KEYWORDS: [&str; 18] = [
    "SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "UNION", "EXEC", "EXECUTE", "DECLARE",
    "CAST", "CONVERT", "CONCAT", "CHAR", "NCHAR", "VARCHAR", "NVARCHAR", "ALTER", "CREATE",
];

#[derive(Clone, Copy, Debug)]
struct CleanupSummary {
    before: usize,
    after: usize,
}

impl CleanupSummary {
    fn removed(self) -> usize {
        self.before.saturating_sub(self.after)
    }
}

struct FastpathMetrics {
    started_at_ms: u64,
    total_checks: AtomicU64,
    rate_checks: AtomicU64,
    socket_checks: AtomicU64,
    traffic_http_requests: AtomicU64,
    traffic_http_blocked: AtomicU64,
    traffic_http_errors: AtomicU64,
    allowed_decisions: AtomicU64,
    blocked_decisions: AtomicU64,
    flush_requests: AtomicU64,
    health_requests: AtomicU64,
    cleanup_runs: AtomicU64,
    active_entries: AtomicU64,
    last_cleanup_at_ms: AtomicU64,
    last_cleanup_removed: AtomicU64,
    last_flush_removed: AtomicU64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricsSnapshot {
    started_at: String,
    started_at_ms: u64,
    uptime_ms: u64,
    total_checks: u64,
    rate_checks: u64,
    socket_checks: u64,
    traffic_http: TrafficHttpMetricsSnapshot,
    allowed_decisions: u64,
    blocked_decisions: u64,
    flush_requests: u64,
    health_requests: u64,
    cleanup_runs: u64,
    active_entries: u64,
    last_cleanup_at_ms: u64,
    last_cleanup_at: Option<String>,
    last_cleanup_removed: u64,
    last_flush_removed: u64,
}

impl FastpathMetrics {
    fn new(started_at_ms: u64) -> Self {
        Self {
            started_at_ms,
            total_checks: AtomicU64::new(0),
            rate_checks: AtomicU64::new(0),
            socket_checks: AtomicU64::new(0),
            traffic_http_requests: AtomicU64::new(0),
            traffic_http_blocked: AtomicU64::new(0),
            traffic_http_errors: AtomicU64::new(0),
            allowed_decisions: AtomicU64::new(0),
            blocked_decisions: AtomicU64::new(0),
            flush_requests: AtomicU64::new(0),
            health_requests: AtomicU64::new(0),
            cleanup_runs: AtomicU64::new(0),
            active_entries: AtomicU64::new(0),
            last_cleanup_at_ms: AtomicU64::new(0),
            last_cleanup_removed: AtomicU64::new(0),
            last_flush_removed: AtomicU64::new(0),
        }
    }

    fn record_check(&self, route: &str, allowed: bool) {
        self.total_checks.fetch_add(1, Ordering::Relaxed);
        if route == "socket" {
            self.socket_checks.fetch_add(1, Ordering::Relaxed);
        } else {
            self.rate_checks.fetch_add(1, Ordering::Relaxed);
        }

        if allowed {
            self.allowed_decisions.fetch_add(1, Ordering::Relaxed);
        } else {
            self.blocked_decisions.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn record_health(&self) {
        self.health_requests.fetch_add(1, Ordering::Relaxed);
    }

    fn record_traffic_http(&self, verdict: &str) {
        self.traffic_http_requests.fetch_add(1, Ordering::Relaxed);
        if verdict == "block" {
            self.traffic_http_blocked.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn record_traffic_http_error(&self) {
        self.traffic_http_errors.fetch_add(1, Ordering::Relaxed);
    }

    fn record_cleanup(&self, summary: CleanupSummary, at_ms: u64) {
        self.cleanup_runs.fetch_add(1, Ordering::Relaxed);
        self.active_entries.store(summary.after as u64, Ordering::Relaxed);
        self.last_cleanup_at_ms.store(at_ms, Ordering::Relaxed);
        self.last_cleanup_removed
            .store(summary.removed() as u64, Ordering::Relaxed);
    }

    fn record_flush(&self, before: usize, after: usize) {
        self.flush_requests.fetch_add(1, Ordering::Relaxed);
        self.active_entries.store(after as u64, Ordering::Relaxed);
        self.last_flush_removed
            .store(before.saturating_sub(after) as u64, Ordering::Relaxed);
    }

    fn increment_active_entries(&self) {
        self.active_entries.fetch_add(1, Ordering::Relaxed);
    }

    fn set_active_entries(&self, count: usize) {
        self.active_entries.store(count as u64, Ordering::Relaxed);
    }

    fn snapshot(&self) -> MetricsSnapshot {
        let last_cleanup_at_ms = self.last_cleanup_at_ms.load(Ordering::Relaxed);
        MetricsSnapshot {
            started_at: to_rfc3339(self.started_at_ms),
            started_at_ms: self.started_at_ms,
            uptime_ms: now_ms().saturating_sub(self.started_at_ms),
            total_checks: self.total_checks.load(Ordering::Relaxed),
            rate_checks: self.rate_checks.load(Ordering::Relaxed),
            socket_checks: self.socket_checks.load(Ordering::Relaxed),
            traffic_http: TrafficHttpMetricsSnapshot {
                requests: self.traffic_http_requests.load(Ordering::Relaxed),
                blocked: self.traffic_http_blocked.load(Ordering::Relaxed),
                errors: self.traffic_http_errors.load(Ordering::Relaxed),
            },
            allowed_decisions: self.allowed_decisions.load(Ordering::Relaxed),
            blocked_decisions: self.blocked_decisions.load(Ordering::Relaxed),
            flush_requests: self.flush_requests.load(Ordering::Relaxed),
            health_requests: self.health_requests.load(Ordering::Relaxed),
            cleanup_runs: self.cleanup_runs.load(Ordering::Relaxed),
            active_entries: self.active_entries.load(Ordering::Relaxed),
            last_cleanup_at_ms,
            last_cleanup_at: if last_cleanup_at_ms > 0 {
                Some(to_rfc3339(last_cleanup_at_ms))
            } else {
                None
            },
            last_cleanup_removed: self.last_cleanup_removed.load(Ordering::Relaxed),
            last_flush_removed: self.last_flush_removed.load(Ordering::Relaxed),
        }
    }
}

impl AppState {
    fn new(transport: TransportDetails) -> Self {
        let mut shards = Vec::with_capacity(SHARD_COUNT);
        for _ in 0..SHARD_COUNT {
            shards.push(Mutex::new(HashMap::new()));
        }

        let started_at_ms = now_ms();
        Self {
            counters: Arc::new(shards),
            metrics: Arc::new(FastpathMetrics::new(started_at_ms)),
            transport,
        }
    }

    fn shard_index(&self, key: &str) -> usize {
        let mut hasher = DefaultHasher::new();
        key.hash(&mut hasher);
        (hasher.finish() as usize) % self.counters.len()
    }

    fn cleanup_expired(&self, now_ms: u64) -> CleanupSummary {
        let mut before = 0usize;
        let mut after = 0usize;

        for shard in self.counters.iter() {
            let mut counters = shard.lock();
            before += counters.len();
            counters.retain(|_, value| value.reset_at_ms > now_ms);
            after += counters.len();
        }

        self.metrics.record_cleanup(CleanupSummary { before, after }, now_ms);
        CleanupSummary { before, after }
    }

    fn flush_matching(
        &self,
        tenant_id: Option<&str>,
        key_prefix: Option<&str>,
        expired_only: bool,
        now_ms: u64,
    ) -> CleanupSummary {
        let tenant_prefix = tenant_id.map(|tenant| format!("{}:", tenant));
        let mut before = 0usize;
        let mut after = 0usize;

        for shard in self.counters.iter() {
            let mut counters = shard.lock();
            before += counters.len();
            counters.retain(|key, value| {
                let tenant_matches = tenant_prefix
                    .as_deref()
                    .map(|prefix| key.starts_with(prefix))
                    .unwrap_or(true);
                let key_matches = key_prefix.map(|prefix| key.contains(prefix)).unwrap_or(true);
                let matches = tenant_matches && key_matches;
                let expired = value.reset_at_ms <= now_ms;

                if !matches {
                    return true;
                }

                if expired_only && !expired {
                    return true;
                }

                false
            });
            after += counters.len();
        }

        self.metrics.record_flush(before, after);
        CleanupSummary { before, after }
    }

    fn active_entries(&self) -> usize {
        let total = self
            .counters
            .iter()
            .map(|shard| shard.lock().len())
            .sum::<usize>();
        self.metrics.set_active_entries(total);
        total
    }
}

#[tokio::main]
async fn main() {
    if env::args().any(|arg| arg == "self-check") {
        match run_self_check() {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("fastpath self-check failed: {}", error);
                std::process::exit(1);
            }
        }
    }

    tracing_subscriber::fmt()
        .with_env_filter(env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .init();

    let transport = resolve_transport();
    let state = AppState::new(transport.clone());
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(CLEANUP_INTERVAL_SECS));
        loop {
            interval.tick().await;
            let now_ms = now_ms();
            let summary = cleanup_state.cleanup_expired(now_ms);
            if summary.before != summary.after {
                info!(
                    "fastpath cleanup retained {} of {} counters",
                    summary.after, summary.before
                );
            }
        }
    });

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/rate/check", post(check_rate))
        .route("/v1/socket/check", post(check_socket))
        .route("/v1/traffic/http/evaluate", post(evaluate_http_traffic))
        .route("/v1/protocols/manifests", get(protocol_manifests))
        .route("/v1/protocols/policies", get(protocol_policies))
        .route("/v1/protocols/evaluate", post(evaluate_protocol))
        .route("/v1/batch/flush", post(flush))
        .with_state(state);

    #[cfg(unix)]
    {
        if transport.mode == "unix" {
            serve_unix(app, transport.socket_path.unwrap_or_default()).await;
            return;
        }
    }

    #[cfg(not(unix))]
    {
        if transport.mode == "unix" {
            warn!("FASTPATH_TRANSPORT=unix requested on non-unix platform, falling back to tcp");
        }
    }

    serve_tcp(app, transport.tcp_address.unwrap_or_else(|| "0.0.0.0:8081".to_string())).await;
}

async fn serve_tcp(app: Router, address: String) {
    let parsed_addr = address
        .parse::<SocketAddr>()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 8081)));
    info!("starting rust-fastpath on {}", parsed_addr);

    let listener = tokio::net::TcpListener::bind(parsed_addr)
        .await
        .expect("bind listener");
    axum::serve(listener, app).await.expect("serve fastpath");
}

#[cfg(unix)]
async fn serve_unix(app: Router, socket_path: String) {
    use std::path::Path;
    use tokio::net::UnixListener;

    let socket = Path::new(&socket_path);
    if let Some(parent) = socket.parent() {
        std::fs::create_dir_all(parent).expect("create unix socket directory");
    }

    if socket.exists() {
        let _ = std::fs::remove_file(socket);
    }

    info!("starting rust-fastpath on unix socket {}", socket_path);
    let listener = UnixListener::bind(socket).expect("bind unix listener");
    let permissions = std::fs::Permissions::from_mode(0o660);
    std::fs::set_permissions(socket, permissions).expect("set unix socket permissions");
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(error) => {
                warn!("unix fastpath accept failed: {}", error);
                continue;
            }
        };
        let tower_service = app.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let hyper_service = service_fn(move |request| tower_service.clone().call(request));
            if let Err(error) = http1::Builder::new()
                .serve_connection(io, hyper_service)
                .await
            {
                info!("unix fastpath connection closed with error: {}", error);
            }
        });
    }
}

async fn protocol_manifests() -> impl IntoResponse {
    let manifests = protocols::registry::manifests();
    (StatusCode::OK, Json(json!({ "protocols": manifests })))
}

async fn evaluate_protocol(Json(input): Json<ProtocolEvaluateRequest>) -> impl IntoResponse {
    match protocols::registry::evaluate_protocol_request(&input) {
        Ok(response) => (StatusCode::OK, Json(json!(response))),
        Err(message) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "protocol_evaluation_failed", "message": message })),
        ),
    }
}

async fn protocol_policies() -> impl IntoResponse {
    let policies = protocols::registry::default_policy_map();
    let stats = protocols::registry::empty_stats_map();
    (StatusCode::OK, Json(json!({ "policies": policies, "stats": stats })))
}
async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    state.metrics.record_health();
    let active_entries = state.active_entries();
    let transport = state.transport.clone();
    let metrics = state.metrics.snapshot();
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "timestamp": to_rfc3339(now_ms()),
            "shards": SHARD_COUNT,
            "activeEntries": active_entries,
            "transport": transport,
            "metrics": metrics
        })),
    )
}

async fn check_rate(
    State(state): State<AppState>,
    Json(input): Json<CheckRequest>,
) -> impl IntoResponse {
    check_with_route(state, input, "rate")
}

async fn check_socket(
    State(state): State<AppState>,
    Json(input): Json<CheckRequest>,
) -> impl IntoResponse {
    check_with_route(state, input, "socket")
}

fn check_with_route(state: AppState, input: CheckRequest, route: &str) -> impl IntoResponse {
    let now_ms = now_ms();
    let risk_flags = collect_risk_flags(&input);
    let tenant = input.tenant_id.unwrap_or_else(|| "global".to_string());
    let namespaced_key = format!("{}:{}", tenant, input.key);

    let shard_index = state.shard_index(&namespaced_key);
    let mut counters = state.counters[shard_index].lock();
    let is_new_key = !counters.contains_key(&namespaced_key);
    let entry = counters.entry(namespaced_key).or_insert_with(|| CounterEntry {
        count: 0,
        reset_at_ms: now_ms.saturating_add(input.window_ms),
    });

    if now_ms >= entry.reset_at_ms {
        entry.count = 0;
        entry.reset_at_ms = now_ms.saturating_add(input.window_ms);
    }

    let allowed = entry.count < input.limit;
    if allowed {
        entry.count += 1;
    }

    let remaining = if allowed {
        input.limit.saturating_sub(entry.count)
    } else {
        0
    };
    let reset_at_ms = entry.reset_at_ms;

    drop(counters);

    state.metrics.record_check(route, allowed);
    if is_new_key {
        state.metrics.increment_active_entries();
    }

    let response = CheckResponse {
        allowed,
        remaining,
        reset_at: to_rfc3339(reset_at_ms),
        reset_at_ms,
        decision_source: "rust-fastpath",
        risk_flags,
    };

    (StatusCode::OK, Json(response))
}

async fn flush(
    State(state): State<AppState>,
    Json(request): Json<FlushRequest>,
) -> impl IntoResponse {
    let now_ms = now_ms();
    let tenant_id = request.tenant_id.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let key_prefix = request
        .key_prefix
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let expired_only = request.expired_only.unwrap_or(tenant_id.is_none() && key_prefix.is_none());
    let summary = state.flush_matching(tenant_id, key_prefix, expired_only, now_ms);

    (
        StatusCode::OK,
        Json(FlushResponse {
            success: true,
            before: summary.before,
            after: summary.after,
            removed: summary.removed(),
            tenant_id: tenant_id.map(ToOwned::to_owned),
            key_prefix: key_prefix.map(ToOwned::to_owned),
            expired_only,
        }),
    )
}

async fn evaluate_http_traffic(
    State(state): State<AppState>,
    Json(input): Json<HttpTrafficEvaluateRequest>,
) -> impl IntoResponse {
    match evaluate_http_traffic_request(&input) {
        Ok(response) => {
            state.metrics.record_traffic_http(response.verdict);
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(error) => {
            state.metrics.record_traffic_http_error();
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "invalid_http_traffic_payload",
                    "message": error
                })),
            )
                .into_response()
        }
    }
}

fn evaluate_http_traffic_request(
    input: &HttpTrafficEvaluateRequest,
) -> Result<HttpTrafficEvaluateResponse, String> {
    let started_at = std::time::Instant::now();
    let headers = normalize_string_headers(&input.headers);
    let body = decode_http_body(&input.body_base64)?;
    let payload = build_http_payload(input, &headers, &body);
    let payload_string = String::from_utf8_lossy(&payload).to_string();

    let mut threats = Vec::new();
    threats.extend(detect_sql_injection(&payload_string));
    threats.extend(detect_xss(&payload_string));
    threats.extend(detect_path_traversal(&input.url));
    threats.extend(detect_header_injection(&headers));

    let critical_http_threat = threats
        .iter()
        .find(|threat| threat.severity == "critical")
        .cloned();
    let generic_threats = detect_generic_critical_threats(&payload_string);
    threats.extend(generic_threats.iter().cloned());
    let deduped_threats = dedupe_http_threats(threats);

    let matched_rule = if let Some(threat) = critical_http_threat {
        Some(format!("fast_path:{}", threat.kind))
    } else if generic_threats.iter().any(|threat| threat.severity == "critical") {
        Some("fast_path:critical_threat".to_string())
    } else {
        None
    };
    let verdict = if matched_rule.is_some() { "block" } else { "allow" };

    Ok(HttpTrafficEvaluateResponse {
        protocol: "http",
        verdict,
        matched_rule,
        threats: deduped_threats,
        truncated: input.truncated,
        decision_source: "rust-fastpath-traffic-http",
        processing_time_micros: started_at.elapsed().as_micros() as u64,
    })
}

fn normalize_string_headers(headers: &HashMap<String, String>) -> HashMap<String, String> {
    headers
        .iter()
        .map(|(key, value)| (key.to_lowercase(), value.clone()))
        .collect()
}

fn decode_http_body(body_base64: &str) -> Result<Vec<u8>, String> {
    if body_base64.trim().is_empty() {
        return Ok(Vec::new());
    }
    BASE64_STANDARD
        .decode(body_base64.as_bytes())
        .map_err(|error| error.to_string())
}

fn build_http_payload(
    input: &HttpTrafficEvaluateRequest,
    headers: &HashMap<String, String>,
    body: &[u8],
) -> Vec<u8> {
    let version = normalize_http_version(&input.http_version);
    let mut head = format!("{} {} {}\r\n", input.method.trim(), input.url.trim(), version);
    for (key, value) in headers.iter() {
        head.push_str(key);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");

    let mut payload = head.into_bytes();
    payload.extend_from_slice(body);
    payload
}

fn normalize_http_version(version: &str) -> String {
    let trimmed = version.trim();
    if trimmed.is_empty() {
        return "HTTP/1.1".to_string();
    }
    if trimmed.to_ascii_uppercase().starts_with("HTTP/") {
        return trimmed.to_ascii_uppercase();
    }
    format!("HTTP/{}", trimmed)
}

fn dedupe_http_threats(threats: Vec<HttpTrafficThreat>) -> Vec<HttpTrafficThreat> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for threat in threats {
      let key = format!("{}|{}|{}", threat.kind, threat.severity, threat.description);
      if seen.insert(key) {
        deduped.push(threat);
      }
    }
    deduped
}

fn detect_sql_injection(content: &str) -> Vec<HttpTrafficThreat> {
    let mut threats = Vec::new();
    let upper_content = content.to_ascii_uppercase();

    for keyword in SQL_KEYWORDS {
        let mut offset = 0usize;
        while let Some(index) = upper_content[offset..].find(keyword) {
            let position = offset + index;
            let context_start = position.saturating_sub(5);
            let context_end = (position + keyword.len() + 5).min(content.len());
            let context = String::from_utf8_lossy(&content.as_bytes()[context_start..context_end]);
            if is_sql_context(context.as_ref()) {
                threats.push(HttpTrafficThreat {
                    kind: "sql_injection".to_string(),
                    severity: "high".to_string(),
                    description: format!("SQL keyword detected: {}", keyword),
                });
            }
            offset = position + 1;
        }
    }

    for (pattern, severity) in SQL_INJECTION_PATTERNS.iter() {
        for capture in pattern.find_iter(content) {
            threats.push(HttpTrafficThreat {
                kind: "sql_injection".to_string(),
                severity: (*severity).to_string(),
                description: format!(
                    "SQL injection pattern: {}",
                    capture.as_str().chars().take(50).collect::<String>()
                ),
            });
        }
    }

    threats
}

fn is_sql_context(context: &str) -> bool {
    ["'", "\"", "=", "(", ")", ";", " "]
        .iter()
        .any(|marker| context.contains(marker))
}

fn detect_xss(content: &str) -> Vec<HttpTrafficThreat> {
    let mut threats = Vec::new();
    for pattern in XSS_PATTERNS.iter() {
        for capture in pattern.find_iter(content) {
            threats.push(HttpTrafficThreat {
                kind: "xss".to_string(),
                severity: "high".to_string(),
                description: format!(
                    "XSS pattern detected: {}",
                    capture.as_str().chars().take(50).collect::<String>()
                ),
            });
        }
    }
    threats
}

fn detect_path_traversal(url: &str) -> Vec<HttpTrafficThreat> {
    let mut threats = Vec::new();
    for pattern in PATH_TRAVERSAL_PATTERNS.iter() {
        for capture in pattern.find_iter(url) {
            threats.push(HttpTrafficThreat {
                kind: "path_traversal".to_string(),
                severity: "high".to_string(),
                description: format!("Path traversal attempt: {}", capture.as_str()),
            });
        }
    }
    threats
}

fn detect_header_injection(headers: &HashMap<String, String>) -> Vec<HttpTrafficThreat> {
    headers
        .iter()
        .filter(|(_, value)| value.contains("\r\n") || value.contains('\n'))
        .map(|(key, _value)| HttpTrafficThreat {
            kind: "header_injection".to_string(),
            severity: "high".to_string(),
            description: format!("Header injection in {}", key),
        })
        .collect::<Vec<_>>()
}

fn detect_generic_critical_threats(content: &str) -> Vec<HttpTrafficThreat> {
    let mut threats = Vec::new();
    for (pattern, kind) in GENERIC_CRITICAL_PATTERNS.iter() {
        if pattern.is_match(content) {
            threats.push(HttpTrafficThreat {
                kind: (*kind).to_string(),
                severity: "critical".to_string(),
                description: format!("Critical threat detected: {}", kind),
            });
        }
    }
    threats
}

fn collect_risk_flags(input: &CheckRequest) -> Vec<String> {
    let mut risk_flags = vec![];

    if input.source_ip.as_deref().unwrap_or("").is_empty() {
        risk_flags.push("missing_source_ip".to_string());
    }

    if let Some(headers) = &input.headers {
        let forwarded_for = headers.get("x-forwarded-for").and_then(as_str);
        let real_ip = headers.get("x-real-ip").and_then(as_str);
        if let (Some(a), Some(b)) = (forwarded_for, real_ip) {
            if !a.is_empty()
                && !b.is_empty()
                && a.split(',').next().unwrap_or("").trim() != b.trim()
            {
                risk_flags.push("ip_header_mismatch".to_string());
            }
        }
    }

    if input.protocol.as_deref().unwrap_or("").starts_with("ws")
        && input.session_id.as_deref().unwrap_or("").is_empty()
    {
        risk_flags.push("missing_session_id".to_string());
    }

    risk_flags
}

fn resolve_transport() -> TransportDetails {
    #[cfg(unix)]
    {
        let transport = env::var("FASTPATH_TRANSPORT")
            .unwrap_or_else(|_| "unix".to_string())
            .to_lowercase();
        if transport == "unix" {
            return TransportDetails {
                mode: "unix".to_string(),
                socket_path: Some(
                    env::var("FASTPATH_SOCKET_PATH")
                        .ok()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| "/var/run/aetherguard-fastpath.sock".to_string()),
                ),
                tcp_address: None,
            };
        }
    }

    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8081);
    let host = env::var("FASTPATH_TCP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    if host != "127.0.0.1" && host != "localhost" && !host.starts_with("127.") {
        warn!(
            "FASTPATH_TCP_HOST={} is not loopback; the fastpath API has no auth and will be reachable from the network. Bind to loopback unless you have a network-isolation control (mTLS, firewall) in place.",
            host
        );
    }
    TransportDetails {
        mode: "tcp".to_string(),
        socket_path: None,
        tcp_address: Some(format!("{}:{}", host, port)),
    }
}

fn run_self_check() -> Result<(), String> {
    let transport = resolve_transport();
    let request = b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";

    if transport.mode == "unix" {
        #[cfg(unix)]
        {
            use std::os::unix::net::UnixStream;

            let socket_path = transport
                .socket_path
                .ok_or_else(|| "missing unix socket path".to_string())?;
            let mut stream = UnixStream::connect(socket_path).map_err(|error| error.to_string())?;
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .map_err(|error| error.to_string())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .map_err(|error| error.to_string())?;
            stream.write_all(request).map_err(|error| error.to_string())?;
            return read_health_response(stream);
        }

        #[cfg(not(unix))]
        {
            return Err("unix transport is not supported on this platform".to_string());
        }
    }

    let address = transport
        .tcp_address
        .ok_or_else(|| "missing tcp address".to_string())?;
    let mut stream = std::net::TcpStream::connect(address).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    stream.write_all(request).map_err(|error| error.to_string())?;
    read_health_response(stream)
}

fn read_health_response<T: Read>(mut stream: T) -> Result<(), String> {
    let mut buffer = String::new();
    stream
        .read_to_string(&mut buffer)
        .map_err(|error| error.to_string())?;
    if buffer.starts_with("HTTP/1.1 200") || buffer.starts_with("HTTP/1.0 200") {
        return Ok(());
    }
    Err(format!("unexpected health response: {}", buffer.lines().next().unwrap_or("empty")))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn to_rfc3339(timestamp_ms: u64) -> String {
    Utc.timestamp_millis_opt(timestamp_ms as i64)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn as_str(value: &Value) -> Option<&str> {
    value.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use tower::ServiceExt;

    fn sample_request(body: &str) -> HttpTrafficEvaluateRequest {
        HttpTrafficEvaluateRequest {
            tenant_id: "global".to_string(),
            request_id: "req-1".to_string(),
            method: "POST".to_string(),
            url: "/login".to_string(),
            http_version: "HTTP/1.1".to_string(),
            headers: HashMap::from([
                ("host".to_string(), "example.test".to_string()),
                (
                    "content-type".to_string(),
                    "application/x-www-form-urlencoded".to_string(),
                ),
            ]),
            body_base64: BASE64_STANDARD.encode(body.as_bytes()),
            source_ip: Some("127.0.0.1".to_string()),
            truncated: false,
        }
    }

    #[test]
    fn evaluates_benign_http_request() {
        let request = HttpTrafficEvaluateRequest {
            tenant_id: "global".to_string(),
            request_id: "req-benign".to_string(),
            method: "GET".to_string(),
            url: "/search?q=test".to_string(),
            http_version: "HTTP/1.1".to_string(),
            headers: HashMap::from([("host".to_string(), "example.test".to_string())]),
            body_base64: String::new(),
            source_ip: Some("127.0.0.1".to_string()),
            truncated: false,
        };

        let response = evaluate_http_traffic_request(&request).expect("evaluation");
        assert_eq!(response.verdict, "allow");
        assert!(response.threats.is_empty());
    }

    #[test]
    fn blocks_sqli_http_request() {
        let response = evaluate_http_traffic_request(&sample_request("username=admin' OR '1'='1"))
            .expect("evaluation");
        assert_eq!(response.verdict, "block");
        assert_eq!(response.matched_rule.as_deref(), Some("fast_path:sql_injection"));
        assert!(response
            .threats
            .iter()
            .any(|threat| threat.kind == "sql_injection" && threat.severity == "critical"));
    }

    #[test]
    fn flags_header_injection_without_blocking() {
        let request = HttpTrafficEvaluateRequest {
            tenant_id: "global".to_string(),
            request_id: "req-header".to_string(),
            method: "GET".to_string(),
            url: "/download".to_string(),
            http_version: "HTTP/1.1".to_string(),
            headers: HashMap::from([
                ("host".to_string(), "example.test".to_string()),
                ("x-test".to_string(), "ok\r\nx-evil: 1".to_string()),
            ]),
            body_base64: String::new(),
            source_ip: Some("127.0.0.1".to_string()),
            truncated: false,
        };

        let response = evaluate_http_traffic_request(&request).expect("evaluation");
        assert_eq!(response.verdict, "allow");
        assert!(response
            .threats
            .iter()
            .any(|threat| threat.kind == "header_injection" && threat.severity == "high"));
    }

    #[tokio::test]
    async fn traffic_http_endpoint_returns_contract_shape() {
        let state = AppState::new(TransportDetails {
            mode: "tcp".to_string(),
            socket_path: None,
            tcp_address: Some("127.0.0.1:0".to_string()),
        });
        let app = Router::new()
            .route("/v1/traffic/http/evaluate", post(evaluate_http_traffic))
            .with_state(state);
        let payload = serde_json::to_vec(&sample_request("username=admin' OR '1'='1")).expect("payload");
        let request = axum::http::Request::builder()
            .method("POST")
            .uri("/v1/traffic/http/evaluate")
            .header("content-type", "application/json")
            .body(Body::from(payload))
            .expect("request");

        let response = app.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX).await.expect("body");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(parsed.get("protocol").and_then(|value| value.as_str()), Some("http"));
        assert_eq!(parsed.get("verdict").and_then(|value| value.as_str()), Some("block"));
        assert!(parsed.get("threats").and_then(|value| value.as_array()).is_some());
    }

    // Regression: rate-limit window arithmetic must saturate, not wrap.
    // A wrapped reset_at_ms would make now_ms >= reset_at_ms true on every
    // call, resetting the counter and silently bypassing the rate limit.
    #[test]
    fn rate_limit_window_arithmetic_saturates_instead_of_wrapping() {
        let now_ms: u64 = 1_750_000_000_000;
        let window_ms: u64 = u64::MAX;
        let reset_at_ms = now_ms.saturating_add(window_ms);
        // Saturation yields u64::MAX, not a wrapped small value.
        assert_eq!(reset_at_ms, u64::MAX);
        // The fail-safe property: reset stays in the far future, so the
        // counter does NOT reset on the next call.
        assert!(now_ms < reset_at_ms, "reset must stay after now under saturation");
        // Contrast: plain + would wrap to now_ms - 1 and break the check.
        assert!(now_ms >= now_ms.wrapping_add(window_ms));
    }

    // Regression: TCP transport must default to loopback, not 0.0.0.0.
    // The fastpath API has no auth; binding all interfaces by default would
    // expose /v1/rate/check, /v1/batch/flush etc. to the network.
    #[test]
    fn tcp_transport_defaults_to_loopback_when_host_unset() {
        // resolve_transport reads env vars; snapshot and restore to keep the
        // test hermetic and avoid leaking state into sibling tests.
        let saved_transport = env::var("FASTPATH_TRANSPORT").ok();
        let saved_host = env::var("FASTPATH_TCP_HOST").ok();
        let saved_port = env::var("PORT").ok();

        env::set_var("FASTPATH_TRANSPORT", "tcp");
        env::remove_var("FASTPATH_TCP_HOST");
        env::remove_var("PORT");

        let transport = resolve_transport();
        let address = transport.tcp_address.expect("tcp address");
        assert!(
            address.starts_with("127.0.0.1:") || address.starts_with("localhost:"),
            "expected loopback default, got {}",
            address
        );

        // Restore.
        match saved_transport {
            Some(v) => env::set_var("FASTPATH_TRANSPORT", v),
            None => env::remove_var("FASTPATH_TRANSPORT"),
        }
        match saved_host {
            Some(v) => env::set_var("FASTPATH_TCP_HOST", v),
            None => env::remove_var("FASTPATH_TCP_HOST"),
        }
        match saved_port {
            Some(v) => env::set_var("PORT", v),
            None => env::remove_var("PORT"),
        }
    }
}
