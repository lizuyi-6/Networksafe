/**
 * Outbound URL guard — shared SSRF defense for operator-configured egress
 * URLs (AI endpoints, notification webhooks).
 *
 * SECURITY FIX (audit 2026-08, AG-B02): these URLs are admin-configurable and
 * the backend performs server-side requests to them. Cloud instance-metadata
 * endpoints (169.254.169.254 and friends) MUST be unreachable regardless of
 * any "allow private hosts" option — a compromised-admin operator must not be
 * able to pivot into cloud credentials with a wider blast radius than the
 * control plane itself. Private/loopback targets are allowed only when the
 * caller explicitly opts in (self-hosted Ollama on the LAN is a supported
 * deployment; webhooks to internal servers require an env acknowledgment).
 */

export interface OutboundUrlCheck {
  allowed: boolean;
  reason?: string;
}

/** Hosts that resolve to cloud instance metadata — NEVER reachable. */
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
]);

/** IPv4 link-local 169.254.0.0/16 — includes every cloud metadata IP. */
function isIpv4LinkLocal(hostname: string): boolean {
  if (!isIpv4Literal(hostname)) {
    return false;
  }
  const [a, b] = ipv4Octets(hostname);
  return a === 169 && b === 254;
}

function isIpv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function ipv4Octets(hostname: string): number[] {
  return hostname.split('.').map((part) => Number(part));
}

/** RFC1918 + loopback + unspecified + link-local IPv4 literals. */
function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Literal(hostname)) {
    return false;
  }
  const [a, b] = ipv4Octets(hostname);
  if (a === 127 || a === 0 || a === 10) {
    return true;
  }
  if (isIpv4LinkLocal(hostname)) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  return false;
}

/** Loopback / link-local / ULA / metadata IPv6 literals (hostname has no brackets). */
function isPrivateIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === '::' || h === '::1') {
    return true;
  }
  if (h.startsWith('fe80:')) {
    return true; // link-local
  }
  if (h.startsWith('fc') || h.startsWith('fd')) {
    return true; // ULA (fc00::/7) — includes AWS IMDS IPv6 fd00:ec2::235
  }
  return false;
}

function isMetadataHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (METADATA_HOSTNAMES.has(h)) {
    return true;
  }
  // 169.254.169.254 / 169.254.170.2 (ECS/VFS) and any link-local literal.
  if (isIpv4LinkLocal(h)) {
    return true;
  }
  if (h.startsWith('fd00:ec2:')) {
    return true; // AWS IMDS IPv6
  }
  // Alibaba metadata service (100.100.100.200) and the Azure platform
  // wire-server (168.63.129.16) — cloud internal channels, never reachable.
  if (h === '100.100.100.200' || h === '168.63.129.16') {
    return true;
  }
  return false;
}

/**
 * Validate an operator-configured outbound URL.
 *
 * - ALWAYS blocks non-http(s) protocols and cloud-metadata endpoints
 *   (regardless of `allowPrivate`).
 * - Blocks loopback/RFC1918/ULA/link-local targets unless `allowPrivate`.
 */
export function checkOutboundUrl(url: string, options?: { allowPrivate?: boolean }): OutboundUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'backend.invalid_url_format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: 'backend.only_http_and_https_protocols_are_allowed' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Cloud metadata is never reachable — even with allowPrivate (AG-B02).
  if (isMetadataHost(hostname)) {
    return { allowed: false, reason: 'backend.cloud_metadata_endpoints_are_blocked' };
  }

  const isPrivate =
    hostname === 'localhost'
    || hostname === '0.0.0.0'
    || isPrivateIpv4(hostname)
    || isPrivateIpv6(hostname);

  if (isPrivate && !options?.allowPrivate) {
    return { allowed: false, reason: 'backend.private_ip_addresses_are_not_allowed' };
  }

  return { allowed: true };
}

/** Throwing variant for dispatch-time enforcement. */
export function assertOutboundUrlAllowed(url: string, options?: { allowPrivate?: boolean }): void {
  const check = checkOutboundUrl(url, options);
  if (!check.allowed) {
    throw new Error(check.reason || 'backend.outbound_url_blocked');
  }
}
