import betterAuthTest from '@convex-dev/better-auth/test';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { parseSetCookieHeader } from 'better-auth/cookies';
import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, components } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const appOrigin = 'https://lcms.example.test';
const email = 'mfa-verification@example.test';

beforeEach(() => {
  vi.stubEnv('SITE_URL', appOrigin);
  vi.stubEnv('CONVEX_SITE_URL', 'https://some.convex.site');
  vi.stubEnv('BETTER_AUTH_SECRET', `${crypto.randomUUID()}${crypto.randomUUID()}`);
  vi.stubEnv('BOOTSTRAP_SECRET', crypto.randomUUID());
  vi.stubEnv('SSO_OIDC_DISCOVERY_URL', undefined);
  vi.stubEnv('SSO_OIDC_ISSUER', undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function createBrowser(backend: TestConvex<typeof schema>) {
  const cookies = new Map<string, string>();

  return {
    async request(path: string, body?: Record<string, unknown>) {
      const response = await backend.fetch(`/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: appOrigin,
          'content-type': 'application/json',
          'user-agent': 'LCMS MFA regression test',
          'better-auth-cookie': [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join('; '),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const header = response.headers.get('set-better-auth-cookie') ?? response.headers.get('set-cookie');
      if (header) {
        for (const [name, cookie] of parseSetCookieHeader(header)) {
          if (!cookie.value || Number(cookie['max-age']) === 0) {
            cookies.delete(name);
          } else {
            cookies.set(name, cookie.value);
          }
        }
      }

      return response;
    },
    hasConvexCookie: () => [...cookies.keys()].some((name) => name.includes('convex_jwt')),
  };
}

async function createFixture() {
  const backend = convexTest(schema, modules);
  betterAuthTest.register(backend);
  const component = components.betterAuth;
  const password = `TestMfa#2-${crypto.randomUUID()}`;
  const { userId } = await backend.action(api.bootstrap.firstSuperAdmin, {
    secret: process.env.BOOTSTRAP_SECRET!,
    fullName: 'MFA Verification Administrator',
    email,
    password,
  });
  const user = await backend.run((ctx) => ctx.db.get(userId));
  const authUserId = user!.authUserId!;
  const browser = createBrowser(backend);
  const signIn = await browser.request('/sign-in/email', { email, password });
  expect(signIn.status).toBe(200);

  return { backend, component, password, userId, authUserId, browser };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function getFactor(fixture: Fixture) {
  return fixture.backend.query(fixture.component.adapter.findOne, {
    model: 'twoFactor',
    where: [{ field: 'userId', value: fixture.authUserId }],
    select: ['verified', 'failedVerificationCount', 'lockedUntil'],
  }) as Promise<{
    verified?: boolean;
    failedVerificationCount?: number;
    lockedUntil?: number | null;
  } | null>;
}

async function getCompliance(fixture: Fixture) {
  const response = await fixture.browser.request('/get-session');
  expect(response.status).toBe(200);
  const session = await response.json();
  expect(Boolean(session?.session?.id)).toBe(true);
  return fixture.backend.withIdentity({
    subject: fixture.authUserId,
    sessionId: session.session.id,
  }).query(api.auth.me);
}

async function provision(fixture: Fixture) {
  const response = await fixture.browser.request('/two-factor/enable', {
    password: fixture.password,
    method: 'totp',
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.method).toBe('totp');
  const uri = new URL(data.totpURI);
  expect(uri.protocol).toBe('otpauth:');
  expect(uri.hostname).toBe('totp');
  expect(uri.searchParams.get('issuer')).toBe('HYPREP LCMS');
  const secret = uri.searchParams.get('secret');
  expect(Boolean(secret)).toBe(true);
  expect(Array.isArray(data.backupCodes) && data.backupCodes.length > 0).toBe(true);
  return createOTP(base32.decode(secret!), { digits: 6, period: 30 });
}

async function enroll(fixture: Fixture) {
  const authenticator = await provision(fixture);
  const response = await fixture.browser.request('/two-factor/verify-totp', {
    code: await authenticator.totp(),
  });
  expect(response.status).toBe(200);
  return authenticator;
}

async function invalidCode(authenticator: ReturnType<typeof createOTP>) {
  let candidate = 0;
  while (await authenticator.verify(String(candidate).padStart(6, '0'))) candidate += 1;
  return String(candidate).padStart(6, '0');
}

describe('production-compatible MFA authentication', () => {
  test('requires a session and keeps public registration closed', async () => {
    const fixture = await createFixture();
    const anonymous = createBrowser(fixture.backend);
    const enrollment = await anonymous.request('/two-factor/enable', {
      password: fixture.password,
      method: 'totp',
    });
    expect(enrollment.status).toBe(401);
    expect(await getFactor(fixture)).toBeNull();

    const registration = await anonymous.request('/sign-up/email', {
      email: 'uninvited@example.test',
      name: 'Uninvited User',
      password: fixture.password,
    });
    expect(registration.status).toBeGreaterThanOrEqual(400);
  });

  test('checks the password and stores supported pending MFA fields', async () => {
    const fixture = await createFixture();
    const rejected = await fixture.browser.request('/two-factor/enable', {
      password: `Wrong#2-${crypto.randomUUID()}`,
      method: 'totp',
    });
    expect(rejected.status).toBe(400);
    expect(await getFactor(fixture)).toBeNull();

    await provision(fixture);
    const factor = await getFactor(fixture);
    expect(factor?.verified).toBe(false);
    expect(factor?.failedVerificationCount).toBe(0);
    const user = await fixture.backend.run((ctx) => ctx.db.get(fixture.userId));
    expect(user?.mfaEnabled).toBe(false);
    const compliance = await getCompliance(fixture);
    expect(compliance?.kind).toBe('active');
    expect(compliance?.kind === 'active' && compliance.mustEnrolMfa).toBe(true);
  });

  test('rejects invalid enrollment codes and enables MFA only after verification', async () => {
    const fixture = await createFixture();
    const authenticator = await provision(fixture);
    const rejected = await fixture.browser.request('/two-factor/verify-totp', {
      code: await invalidCode(authenticator),
    });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect((await getFactor(fixture))?.verified).toBe(false);
    const pending = await fixture.backend.run((ctx) => ctx.db.get(fixture.userId));
    expect(pending?.mfaEnabled).toBe(false);

    const accepted = await fixture.browser.request('/two-factor/verify-totp', {
      code: await authenticator.totp(),
    });
    expect(accepted.status).toBe(200);
    expect((await getFactor(fixture))?.verified).toBe(true);
    const enabled = await fixture.backend.run((ctx) => ctx.db.get(fixture.userId));
    expect(enabled?.mfaEnabled).toBe(true);
    const compliance = await getCompliance(fixture);
    expect(compliance?.kind === 'active' && !compliance.mustEnrolMfa).toBe(true);

    const replacement = await fixture.browser.request('/two-factor/enable', {
      password: fixture.password,
      method: 'totp',
    });
    expect(replacement.status).toBe(400);
    expect((await getFactor(fixture))?.verified).toBe(true);
  });

  test('does not mint a Convex token until the sign-in second factor succeeds', async () => {
    const fixture = await createFixture();
    const authenticator = await enroll(fixture);
    const browser = createBrowser(fixture.backend);
    const firstFactor = await browser.request('/sign-in/email', { email, password: fixture.password });
    expect(firstFactor.status).toBe(200);
    const challenge = await firstFactor.json();
    expect(challenge.twoFactorRedirect).toBe(true);
    expect(challenge.token === undefined).toBe(true);
    expect(browser.hasConvexCookie()).toBe(false);

    const pendingSession = await browser.request('/get-session');
    expect(await pendingSession.json()).toBeNull();
    const refusedToken = await browser.request('/convex/token');
    expect(refusedToken.status).toBe(401);

    const accepted = await browser.request('/two-factor/verify-totp', {
      code: await authenticator.totp(),
    });
    expect(accepted.status).toBe(200);
    const issuedToken = await browser.request('/convex/token');
    expect(issuedToken.status).toBe(200);
    const token = await issuedToken.json();
    expect(typeof token.token === 'string' && token.token.length > 0).toBe(true);
  });

  test('locks repeated MFA failures across challenges and recovers after expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixture = await createFixture();
    const authenticator = await enroll(fixture);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      vi.setSystemTime(Date.now() + 61000);
      const browser = createBrowser(fixture.backend);
      const firstFactor = await browser.request('/sign-in/email', { email, password: fixture.password });
      expect(firstFactor.status, `Password challenge ${attempt}`).toBe(200);
      const rejected = await browser.request('/two-factor/verify-totp', {
        code: await invalidCode(authenticator),
      });
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      expect(rejected.status).toBeLessThan(500);
      expect((await getFactor(fixture))?.failedVerificationCount).toBe(attempt);
    }

    const factor = await getFactor(fixture);
    expect((factor?.lockedUntil ?? 0) > Date.now()).toBe(true);
    vi.setSystemTime(Date.now() + 61000);
    const browser = createBrowser(fixture.backend);
    const firstFactor = await browser.request('/sign-in/email', { email, password: fixture.password });
    expect(firstFactor.status).toBe(200);
    const locked = await browser.request('/two-factor/verify-totp', {
      code: await authenticator.totp(),
    });
    expect(locked.status).toBe(429);
    const token = await browser.request('/convex/token');
    expect(token.status).toBe(401);

    vi.setSystemTime(factor!.lockedUntil! + 1000);
    const recovered = createBrowser(fixture.backend);
    const newChallenge = await recovered.request('/sign-in/email', { email, password: fixture.password });
    expect(newChallenge.status).toBe(200);
    const accepted = await recovered.request('/two-factor/verify-totp', {
      code: await authenticator.totp(),
    });
    expect(accepted.status).toBe(200);
    const reset = await getFactor(fixture);
    expect(reset?.failedVerificationCount).toBe(0);
    expect(reset?.lockedUntil).toBeNull();
  }, 30000);

  test('exhausts the per-challenge attempt budget without issuing a session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fixture = await createFixture();
    const authenticator = await enroll(fixture);
    const browser = createBrowser(fixture.backend);
    const challenge = await browser.request('/sign-in/email', { email, password: fixture.password });
    expect(challenge.status).toBe(200);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      vi.setSystemTime(Date.now() + 61000);
      const rejected = await browser.request('/two-factor/verify-totp', {
        code: await invalidCode(authenticator),
      });
      expect(rejected.status).toBe(401);
      expect((await getFactor(fixture))?.failedVerificationCount).toBe(attempt);
    }

    vi.setSystemTime(Date.now() + 61000);
    const exhausted = await browser.request('/two-factor/verify-totp', {
      code: await authenticator.totp(),
    });
    expect(exhausted.status).toBe(400);
    expect((await getFactor(fixture))?.failedVerificationCount).toBe(5);
    const token = await browser.request('/convex/token');
    expect(token.status).toBe(401);
  }, 30000);

  test('preserves the SSO gate on the upgraded social sign-in route', async () => {
    const fixture = await createFixture();
    const browser = createBrowser(fixture.backend);
    const response = await browser.request('/sign-in/social', {
      provider: 'oidc',
      callbackURL: appOrigin,
    });
    expect(response.status).toBe(403);
  });

  test('refuses OIDC callbacks with a missing or mismatched issuer', async () => {
    const fixture = await createFixture();
    vi.stubEnv('SSO_OIDC_ISSUER', 'https://identity.example.test');
    const browser = createBrowser(fixture.backend);
    const missing = await browser.request('/callback/oidc?code=test&state=test');
    expect(missing.status).toBe(403);
    const mismatched = await browser.request('/callback/oidc?code=test&state=test&iss=https%3A%2F%2Fwrong.example.test');
    expect(mismatched.status).toBe(403);
  });

  test('revokes the verification session on sign-out', async () => {
    const fixture = await createFixture();
    await enroll(fixture);
    const signedOut = await fixture.browser.request('/sign-out', {});
    expect(signedOut.status).toBe(200);
    const session = await fixture.browser.request('/get-session');
    expect(await session.json()).toBeNull();
    const token = await fixture.browser.request('/convex/token');
    expect(token.status).toBe(401);
  });
});
