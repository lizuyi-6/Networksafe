import { randomUUID } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createAuthUser, findAuthUserByEmail, type AuthUserRow } from '../modules/auth/auth-user.repository';
import { getRolePermissions, normalizeRole } from '../security/permissions';

export interface OidcUserProfile {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
}

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function boolEnv(name: string, fallback = false): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

class OidcAuthService {
  isConfigured(): boolean {
    return Boolean(
      env('OIDC_CLIENT_ID')
      && env('OIDC_CLIENT_SECRET')
      && env('OIDC_AUTHORIZATION_ENDPOINT')
      && env('OIDC_TOKEN_ENDPOINT')
      && env('OIDC_USERINFO_ENDPOINT')
      && env('OIDC_REDIRECT_URI')
    );
  }

  buildAuthorizationUrl(state: string): string {
    const url = new URL(env('OIDC_AUTHORIZATION_ENDPOINT'));
    url.searchParams.set('client_id', env('OIDC_CLIENT_ID'));
    url.searchParams.set('redirect_uri', env('OIDC_REDIRECT_URI'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', env('OIDC_SCOPES') || 'openid profile email');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<{ accessToken: string }> {
    const response = await fetch(env('OIDC_TOKEN_ENDPOINT'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env('OIDC_REDIRECT_URI'),
        client_id: env('OIDC_CLIENT_ID'),
        client_secret: env('OIDC_CLIENT_SECRET')
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`backend.oidc_token_exchange_failed_${response.status}`);
    }

    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token) {
      throw new Error('backend.oidc_access_token_missing');
    }

    return {
      accessToken: payload.access_token
    };
  }

  async fetchUserProfile(accessToken: string): Promise<OidcUserProfile> {
    const response = await fetch(env('OIDC_USERINFO_ENDPOINT'), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`backend.oidc_userinfo_failed_${response.status}`);
    }

    const payload = await response.json() as OidcUserProfile;
    if (!payload.email) {
      throw new Error('backend.oidc_email_missing');
    }
    return payload;
  }

  async resolveUser(profile: OidcUserProfile): Promise<{
    row: AuthUserRow;
    isProvisioned: boolean;
  }> {
    const existing = await findAuthUserByEmail(profile.email);
    if (existing) {
      return { row: existing, isProvisioned: false };
    }

    if (!boolEnv('OIDC_AUTO_PROVISION', false)) {
      throw new Error('backend.oidc_user_not_provisioned');
    }

    const defaultRole = normalizeRole(env('OIDC_AUTO_PROVISION_ROLE') || 'tenant_viewer');
    const tenantId = env('OIDC_DEFAULT_TENANT_ID') || randomUUID();
    const row: AuthUserRow = {
      id: uuidv4(),
      email: profile.email,
      username: profile.preferred_username || profile.name || profile.email.split('@')[0],
      password_hash: `oidc:${profile.sub}`,
      role: defaultRole,
      plan: 'starter',
      tenant_id: tenantId,
      status: 'active'
    };
    await createAuthUser(row);
    return { row, isProvisioned: true };
  }

  buildState(): string {
    return randomUUID();
  }

  buildSessionUser(row: AuthUserRow) {
    return {
      userId: row.id,
      email: row.email,
      username: row.username,
      role: normalizeRole(row.role),
      plan: row.plan || 'starter',
      tenantId: row.tenant_id || undefined,
      permissions: getRolePermissions(row.role)
    };
  }
}

export const oidcAuthService = new OidcAuthService();
