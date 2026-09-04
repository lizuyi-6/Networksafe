#!/usr/bin/env node
/**
 * Aether security regression R2-F002 (CWE-918)
 *
 * Attack path (two independent bypasses of the outbound URL guard's stated
 * "cloud metadata MUST be unreachable" invariant):
 *   (a) DNS-name bypass: a hostname whose A record points at 169.254.169.254
 *       passed the literal-only checkOutboundUrl (pre-fix probe: allowed=true).
 *   (b) Redirect bypass: axios followed a 302 from an allowed host into a
 *       blocked loopback/metadata target and recovered the body (pre-fix
 *       probe: followed=true, body={"secret":"IMDS-CREDENTIAL-MATERIAL"}).
 *
 * AFTER the fix:
 *   (a) assertOutboundUrlAllowedResolved resolves the hostname (resolver is
 *       injectable for this offline test) and rejects metadata addresses
 *       unconditionally.
 *   (b) the dispatcher/route set maxRedirects: 0 - the same option applied
 *       here must NOT follow the redirect.
 *
 * Exit 0 = regression passes (fixed). Exit 1 = regression FAILS (vuln back).
 */
process.env.TS_NODE_PROJECT = __dirname + '/../../tsconfig.json';
require('ts-node/register/transpile-only');

const http = require('http');
const axios = require('axios');
const {
  assertOutboundUrlAllowedResolved,
  assertOutboundUrlAllowedResolvedPinned,
  createPinnedDnsContext,
  assertOutboundUrlAllowed,
  checkOutboundUrl
} = require('../../src/security/outbound-url-guard');

const METADATA_IP = '169.254.169.254';
let failures = 0;

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  // --- (a) DNS-name bypass ---------------------------------------------
  // Sanity: the OLD literal-only check still passes this hostname (that is
  // exactly the pre-fix hole - the name is not a literal, so no check fires).
  const literalCheck = checkOutboundUrl('http://bypass.example.com/latest/meta-data/');
  if (!literalCheck.allowed) {
    console.error('UNEXPECTED: literal check now rejects the arbitrary domain; test premise changed');
    failures += 1;
  }

  const evilResolver = async (hostname) => {
    if (hostname === 'bypass.example.com') {
      return [{ address: METADATA_IP, family: 4 }];
    }
    return [{ address: '93.184.216.34', family: 4 }];
  };

  let rejectedMetadata = false;
  try {
    await assertOutboundUrlAllowedResolved('http://bypass.example.com/latest/meta-data/', { resolver: evilResolver });
    console.error('FAIL: resolved assert ALLOWED a hostname resolving to 169.254.169.254');
    failures += 1;
  } catch (e) {
    rejectedMetadata = /metadata/.test(String(e.message));
    if (!rejectedMetadata) {
      console.error('FAIL: resolved assert rejected for the wrong reason: ' + e.message);
      failures += 1;
    }
  }
  if (rejectedMetadata) {
    console.log('PASS: DNS name -> 169.254.169.254 rejected (cloud_metadata_endpoints_are_blocked)');
  }

  // allowPrivate must NOT buy metadata reachability (AG-B02 invariant).
  try {
    await assertOutboundUrlAllowedResolved('http://bypass.example.com/x', { allowPrivate: true, resolver: evilResolver });
    console.error('FAIL: allowPrivate=true permitted a metadata address');
    failures += 1;
  } catch (e) {
    if (/metadata/.test(String(e.message))) {
      console.log('PASS: allowPrivate=true still blocks metadata addresses');
    } else {
      console.error('FAIL: unexpected rejection reason under allowPrivate: ' + e.message);
      failures += 1;
    }
  }

  // Private resolution without allowPrivate is refused; with allowPrivate passes.
  const privateResolver = async () => [{ address: '10.1.2.3', family: 4 }];
  let privateBlocked = false;
  try {
    await assertOutboundUrlAllowedResolved('http://lan-host.example.com/x', { resolver: privateResolver });
  } catch {
    privateBlocked = true;
  }
  if (!privateBlocked) {
    console.error('FAIL: hostname resolving to 10.x was allowed without allowPrivate');
    failures += 1;
  } else {
    console.log('PASS: hostname resolving to 10.1.2.3 refused without allowPrivate');
    try {
      await assertOutboundUrlAllowedResolved('http://lan-host.example.com/x', { allowPrivate: true, resolver: privateResolver });
      console.log('PASS: allowPrivate=true still permits LAN targets (Ollama deployment shape)');
    } catch (e) {
      console.error('FAIL: allowPrivate=true refused a LAN target: ' + e.message);
      failures += 1;
    }
  }

  // IPv4-mapped IPv6 normalization (dotted form returned by a resolver).
  try {
    await assertOutboundUrlAllowedResolved('http://bypass.example.com/x', {
      resolver: async () => [{ address: '::ffff:169.254.169.254', family: 6 }]
    });
    console.error('FAIL: ::ffff:-mapped metadata address was allowed');
    failures += 1;
  } catch (e) {
    if (/metadata/.test(String(e.message))) {
      console.log('PASS: ::ffff:169.254.169.254 normalized and blocked');
    } else {
      console.error('FAIL: mapped-address rejection reason wrong: ' + e.message);
      failures += 1;
    }
  }

  // R2-F002 follow-up: HEX-form mapped literals. Node's URL parser and
  // dns.lookup normalize `[::ffff:169.254.169.254]` to `::ffff:a9fe:a9fe`;
  // the dotted-only strip used to let this variant past every check while
  // axios connects it to the IPv4 metadata target.
  const hexMappedUrls = [
    'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[0:0:0:0:0:ffff:169.254.169.254]/',
    'http://[::FFFF:A9FE:A9FE]/'
  ];
  for (const url of hexMappedUrls) {
    if (checkOutboundUrl(url, { allowPrivate: true }).allowed) {
      console.error('FAIL: hex-mapped metadata literal passed the literal check: ' + url);
      failures += 1;
      continue;
    }
    try {
      await assertOutboundUrlAllowedResolvedPinned(url, { allowPrivate: true, resolver: async () => [{ address: '::ffff:a9fe:a9fe', family: 6 }] });
      console.error('FAIL: hex-mapped metadata literal passed the resolved check: ' + url);
      failures += 1;
    } catch (e) {
      if (/metadata/.test(String(e.message))) {
        console.log('PASS: hex-mapped literal blocked unconditionally: ' + url);
      } else {
        console.error('FAIL: wrong rejection reason for ' + url + ': ' + e.message);
        failures += 1;
      }
    }
  }

  // Pinned-DNS context: lookup must ignore the requested hostname entirely.
  const pinnedCtx = createPinnedDnsContext([{ address: '93.184.216.34', family: 4 }]);
  await new Promise((resolve) => {
    pinnedCtx.lookup('attacker-rebind.example.com', { all: true }, (err, addresses) => {
      const onlyPinned = !err && addresses.length === 1 && addresses[0].address === '93.184.216.34';
      if (!onlyPinned) {
        console.error('FAIL: pinned lookup returned something other than the validated peers');
        failures += 1;
      } else {
        console.log('PASS: pinned lookup ignores re-resolution, returns only validated peers');
      }
      resolve(null);
    });
  });

  // --- (b) redirect bypass ----------------------------------------------
  const target = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ secret: 'IMDS-CREDENTIAL-MATERIAL', path: req.url }));
  });
  const redirector = await listen((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/latest/meta-data/` });
    res.end();
  });

  let redirectFollowed = false;
  let finalBody = null;
  try {
    const resp = await axios.post(`http://127.0.0.1:${redirector.port}/hook`, { ping: 1 }, {
      timeout: 3000,
      maxRedirects: 0,
      validateStatus: () => true
    });
    finalBody = resp.data;
    redirectFollowed = resp.data && resp.data.secret === 'IMDS-CREDENTIAL-MATERIAL';
  } catch {
    redirectFollowed = false;
  }
  redirector.srv.close(); target.srv.close();

  if (redirectFollowed) {
    console.error('FAIL: outbound fetch options followed the 302 into the blocked target and recovered ' + JSON.stringify(finalBody));
    failures += 1;
  } else {
    console.log('PASS: maxRedirects:0 options do not follow redirects into blocked targets');
  }

  // Source-level guardrail: dispatcher + AI route must both pin maxRedirects: 0.
  const fs = require('fs');
  const path = require('path');
  const dispatcherSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'services', 'notification-dispatcher.service.ts'), 'utf8');
  const aiRouteSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'routes', 'ai-endpoints.routes.ts'), 'utf8');
  const dispatcherPinned = /maxRedirects:\s*0/.test(dispatcherSrc) && dispatcherSrc.includes('assertOutboundUrlAllowedResolvedPinned') && dispatcherSrc.includes('createPinnedDnsContext');
  const aiRoutePinned = (aiRouteSrc.match(/maxRedirects:\s*0/g) || []).length >= 2 && aiRouteSrc.includes('assertOutboundUrlAllowedResolvedPinned') && (aiRouteSrc.match(/pinned\.lookup/g) || []).length >= 2;
  if (!dispatcherPinned) {
    console.error('FAIL: notification-dispatcher.service.ts lost maxRedirects:0 or the pinned resolved assert');
    failures += 1;
  } else {
    console.log('PASS: notification-dispatcher.service.ts pins maxRedirects:0 + pinned resolved assert');
  }
  if (!aiRoutePinned) {
    console.error('FAIL: ai-endpoints.routes.ts lost maxRedirects:0 (both axios calls) or the pinned lookup wiring');
    failures += 1;
  } else {
    console.log('PASS: ai-endpoints.routes.ts pins maxRedirects:0 on both axios calls + pinned lookup');
  }

  // Legacy literal assert must keep working (twin preservation).
  try {
    assertOutboundUrlAllowed('http://127.0.0.1/x');
    console.error('FAIL: legacy literal assert stopped rejecting loopback literal');
    failures += 1;
  } catch {
    console.log('PASS: legacy literal assert still rejects loopback literal');
  }

  if (failures > 0) {
    console.error(`R2-F002 regression: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('R2-F002 regression: all checks passed');
})();
