#!/usr/bin/env node
/**
 * Release guard (AUD-08-1): third-party GitHub Actions must be pinned to a
 * commit SHA, not a moving tag (`@v4`), so a compromised action repository
 * cannot inject code into CI. Every `uses:` that is not SHA-pinned must
 * appear in the explicit allowlist below together with an owner and the
 * tracked issue/effort to pin it.
 *
 * Usage: node scripts/guards/check-ci-action-pins.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');

// Actions that are still tag-pinned. Each entry needs an owner and a plan —
// this list is expected to SHRINK to zero.
const ALLOWLIST = {
    // dtolnay/rust-toolchain publishes only a moving `stable` ref; pinning
    // requires choosing a fixed toolchain release.
    'dtolnay/rust-toolchain@stable': 'rust toolchain: pick pinned toolchain commit',
    // Third-party actions without an offline-verifiable SHA — pin on next
    // network-available build machine, then remove from this allowlist.
    'docker/setup-buildx-action@v3': 'pin to SHA (verify via git ls-remote on build machine)',
    'docker/build-push-action@v5': 'pin to SHA (verify via git ls-remote on build machine)',
    'xu-cheng/latex-action@v4': 'pin to SHA (verify via git ls-remote on build machine)',
    'actions/checkout@v6': 'pin to SHA (verify via git ls-remote on build machine)',
    'actions/upload-artifact@v7': 'pin to SHA (verify via git ls-remote on build machine)',
};

function isShaPinned(ref) {
    // actions/checkout@<40-hex>
    return /@[0-9a-f]{40}$/.test(ref);
}

let unpinned = [];
for (const file of readdirSync(WORKFLOWS_DIR)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const content = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
    for (const match of content.matchAll(/^\s*(?:- )?uses:\s*(\S+)\s*$/gm)) {
        const ref = match[1].trim();
        if (ref.startsWith('docker/') || ref.includes('./')) continue; // local actions fine
        if (isShaPinned(ref)) continue;
        if (ALLOWLIST[ref]) continue;
        unpinned.push(`${file}: ${ref}`);
    }
}

if (unpinned.length > 0) {
    console.error('ci_action_pins=failed — unpinned third-party actions outside the allowlist:');
    for (const entry of unpinned) {
        console.error(`  ${entry}`);
    }
    process.exit(1);
}

const allowlisted = Object.keys(ALLOWLIST).length;
console.log(`ci_action_pins=passed (all third-party actions SHA-pinned or explicitly allowlisted: ${allowlisted} tracked)`);
