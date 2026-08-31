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

import { promises as dnsPromises } from 'dns';
import * as http from 'http';
import * as https from 'https';
import type { LookupAddressEntry } from 'axios';

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
 * N5-6: exported metadata-endpoint predicate so NON-HTTP egress paths
 * (scanner TCP/TLS probes, SMTP relays) can enforce the same AG-B02
 * invariant. Accepts a hostname or literal IP (no brackets, no scheme).
 */
export function isMetadataAddress(hostOrAddress: string): boolean {
  const value = String(hostOrAddress || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) {
    return false;
  }
  // URL-form input ("http://169.254.169.254/...") is reduced to its host.
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
    try {
      return isMetadataHost(new URL(value).hostname);
    } catch {
      return false;
    }
  }
  return isMetadataHost(value);
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

  const hostname = normalizeResolvedAddress(parsed.hostname);

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

export interface ResolvedAddress {
  address: string;
  family?: number;
}

export type OutboundDnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

/**
 * Collapse an IPv4-mapped IPv6 address (::ffff:a.b.c.d) to its dotted-quad
 * IPv4 form. Node's URL parser and dns.lookup both normalize mapped literals
 * to HEX form (`[::ffff:169.254.169.254]` -> hostname `::ffff:a9fe:a9fe`),
 * so the dotted-only strip used to let the hex variant slip past every
 * literal check below (R2-F002 follow-up: reproduced bypass, fixed here).
 * Returns null when the address is not an IPv4-mapped IPv6 literal.
 */
function mappedIpv6ToIpv4(address: string): string | null {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!m) {
    return null;
  }
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return null;
  }
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function normalizeResolvedAddress(address: string): string {
  let normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  // Collapse IPv4-mapped IPv6 (::ffff:169.254.169.254 AND its hex form
  // ::ffff:a9fe:a9fe) to its IPv4 form so the literal checks below cannot
  // be bypassed by the mapped representation.
  if (normalized.startsWith('::ffff:')) {
    normalized = mappedIpv6ToIpv4(normalized) || normalized.slice('::ffff:'.length);
  }
  return normalized;
}

/**
 * SECURITY (R2-F002): literal-only hostname checks let a DNS name whose A
 * record points at a cloud-metadata / private IP slip past the guard. Resolve
 * the hostname first and validate EVERY resolved address:
 * - metadata endpoints are rejected unconditionally (AG-B02 invariant);
 * - private/loopback addresses are rejected unless allowPrivate is set.
 * `resolver` is injectable for offline regression tests.
 */
export async function assertOutboundUrlAllowedResolved(
  url: string,
  options?: { allowPrivate?: boolean; resolver?: OutboundDnsResolver }
): Promise<void> {
  await resolveValidateOutboundHost(url, options);
}

/**
 * Validate-and-pin variant of assertOutboundUrlAllowedResolved: identical
 * checks, but returns THE SAME address list that was validated so the caller
 * can pin its request agents onto exactly these peers (createPinnedDnsContext)
 * instead of letting axios re-resolve the hostname (DNS rebinding TOCTOU).
 * Single resolution: validation and the returned list cannot diverge.
 */
export async function assertOutboundUrlAllowedResolvedPinned(
  url: string,
  options?: { allowPrivate?: boolean; resolver?: OutboundDnsResolver }
): Promise<ResolvedAddress[]> {
  return resolveValidateOutboundHost(url, options);
}

/** Validate one resolved address against the metadata/private rules. */
function assertResolvedAddressAllowed(address: string, options?: { allowPrivate?: boolean }): void {
  const normalized = normalizeResolvedAddress(address);
  if (isMetadataHost(normalized)) {
    throw new Error('backend.cloud_metadata_endpoints_are_blocked');
  }
  const isPrivate =
    normalized === 'localhost'
    || normalized === '0.0.0.0'
    || isPrivateIpv4(normalized)
    || isPrivateIpv6(normalized);
  if (isPrivate && !options?.allowPrivate) {
    throw new Error('backend.private_ip_addresses_are_not_allowed');
  }
}

const defaultOutboundResolver: OutboundDnsResolver = async (hostname) => {
  const results = await dnsPromises.lookup(hostname, { all: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

/** One resolution, full validation, return the approved peer set. */
async function resolveValidateOutboundHost(
  url: string,
  options?: { allowPrivate?: boolean; resolver?: OutboundDnsResolver }
): Promise<ResolvedAddress[]> {
  // Literal checks first (protocol, known metadata hostnames, literal IPs).
  assertOutboundUrlAllowed(url, options);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('backend.invalid_url_format');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  const lookup = options?.resolver || defaultOutboundResolver;

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new Error('backend.outbound_target_unresolvable');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('backend.outbound_target_unresolvable');
  }

  for (const { address } of addresses) {
    assertResolvedAddressAllowed(String(address), options);
  }

  return addresses;
}

/**
 * SECURITY (audit 2026-08, N5-6): bare-host variant for NON-HTTP egress
 * (SMTP relay hosts, raw TCP/TLS probes) where the target is a hostname or
 * literal IP with no URL scheme. Identical rules: metadata endpoints are
 * rejected unconditionally (AG-B02), every resolved address is validated,
 * and private/loopback requires `allowPrivate`. Returns the validated peer
 * set so the caller may pin its connection when the transport allows it.
 */
export async function assertOutboundHostAllowedResolved(
  host: string,
  options?: { allowPrivate?: boolean; resolver?: OutboundDnsResolver }
): Promise<ResolvedAddress[]> {
  const normalized = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) {
    throw new Error('backend.outbound_target_unresolvable');
  }
  // Literal fast path: nothing to resolve; the address itself is validated.
  if (isIpv4Literal(normalized) || normalized.includes(':')) {
    assertResolvedAddressAllowed(normalized, options);
    return [{ address: normalized, family: normalized.includes(':') ? 6 : 4 }];
  }
  // Known metadata hostnames are refused before any lookup.
  assertResolvedAddressAllowed(normalized, options);

  const lookup = options?.resolver || defaultOutboundResolver;
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(normalized);
  } catch {
    throw new Error('backend.outbound_target_unresolvable');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('backend.outbound_target_unresolvable');
  }
  for (const { address } of addresses) {
    assertResolvedAddressAllowed(String(address), options);
  }
  return addresses;
}

/**
 * SECURITY (R2-F002 follow-up): close the validate/connect TOCTOU window.
 * assertOutboundUrlAllowedResolved validates one DNS answer, but axios then
 * resolves the hostname AGAIN — an attacker controlling authoritative DNS
 * (low TTL) can return a clean address to the guard and a metadata/private
 * address to the connect. This agent pins the validated answer: every socket
 * the request opens uses exactly the addresses the guard approved.
 *
 * Usage: pass `lookup` + `httpAgent`/`httpsAgent` from this factory into the
 * axios call alongside maxRedirects: 0.
 */
export interface PinnedDnsContext {
  /** Validated addresses; every connection is forced onto one of these. */
  addresses: ResolvedAddress[];
  /**
   * Custom lookup for axios/http.request options — returns ONLY pinned
   * answers. SECURITY (audit 2026-08, AUD-07-4): honors the Node lookup
   * contract — with `all: true` the callback receives the full pinned
   * array; with `all: false` (the net.connect default) it receives the
   * SINGLE-address form `(err, address, family)`. Returning the array in
   * the single-address form made Node read `array.family` (undefined) and
   * `array.address` (an array), so sockets could target garbage instead of
   * the validated peers.
   */
  // The callback params are intentionally wide (`any`): this function is
  // handed BOTH to axios' declared `lookup` option (whose callback type is
  // narrower than the runtime contract) and to node's http.Agent. The
  // RUNTIME contract is node's LookupFunction: `all: true` receives the
  // pinned array, `all: false` receives the single-address form
  // (err, addressString, family) — see createPinnedDnsContext below.
  lookup: (
    hostname: string,
    options: object,
    callback: (err: NodeJS.ErrnoException | null, address: any, family?: any) => void
  ) => void;
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

export function createPinnedDnsContext(addresses: ResolvedAddress[]): PinnedDnsContext {
  const pinned: LookupAddressEntry[] = addresses.map((a) => ({
    address: a.address,
    family: (a.family === 6 ? 6 : 4) as 4 | 6
  }));
  const lookup: PinnedDnsContext['lookup'] = (_hostname: string, options: object, callback) => {
    // Ignore the requested hostname entirely: after validation, the only
    // acceptable peers are the validated ones. Re-resolution (rebinding)
    // never reaches the network stack.
    const wantsAll = Boolean((options as { all?: boolean } | undefined)?.all);
    const requestedFamilyRaw = (options as { family?: number | string } | undefined)?.family;
    const requestedFamily = requestedFamilyRaw === 6 || requestedFamilyRaw === 'IPv6' ? 6
      : requestedFamilyRaw === 4 || requestedFamilyRaw === 'IPv4' ? 4
        : undefined;
    process.nextTick(() => {
      if (wantsAll) {
        callback(null, pinned);
        return;
      }
      // Single-address contract: prefer the pinned answer matching the
      // requested family, else the first validated peer.
      const chosen = pinned.find((a) => a.family === requestedFamily) || pinned[0];
      if (!chosen) {
        callback(new Error('backend.outbound_target_unresolvable'), '');
        return;
      }
      // Single-address contract: (err, addressString, family) — node's net
      // layer treats this value as the remote address.
      callback(null, chosen.address, chosen.family);
    });
  };
  return {
    addresses: pinned,
    lookup,
    httpAgent: new http.Agent({ lookup } as http.AgentOptions),
    httpsAgent: new https.Agent({ lookup } as https.AgentOptions)
  };
}
