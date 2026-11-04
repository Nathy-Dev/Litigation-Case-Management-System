/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const AUTH_SUBJECT = 'documents_upload_test_subject';

async function seedReadOnlyUser(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('users', {
      authUserId: AUTH_SUBJECT,
      fullName: 'Read Only User',
      email: 'read.only@hyprep.gov.ng',
      phone: '+2348000000000',
      title: 'Lawyer',
      role: 'READ_ONLY',
      department: 'Legal Services',
      teamId: null,
      practisingLicenceNo: null,
      firm: null,
      avatarColor: '#0f766e',
      initials: 'RO',
      status: 'active',
      mfaEnabled: true,
      mfaRequired: false,
      failedLoginAttempts: 0,
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      passwordChangedAt: null,
      lockedAt: null,
    });
  });
}

test('anonymous callers cannot generate upload URLs', async () => {
  const t = convexTest(schema, modules);

  await expect(t.mutation(api.documents.generateUploadUrl, {})).rejects.toThrow(
    /Not signed in\./,
  );
}, 30_000);

test('users without document upload permission cannot generate upload URLs', async () => {
  const t = convexTest(schema, modules);
  await seedReadOnlyUser(t);

  const asReadOnly = t.withIdentity({ subject: AUTH_SUBJECT });
  await expect(asReadOnly.mutation(api.documents.generateUploadUrl, {})).rejects.toThrow(
    /does not permit this action \(document\.upload\)/,
  );
}, 30_000);
