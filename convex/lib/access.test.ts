import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from '../schema';
import type { Id } from '../_generated/dataModel';
import {
  canAccessCase,
  caseMemberRows,
  makeActor,
  memberCaseIds,
  visibleCases,
  type AccessActor,
  type CaseAccessFields,
} from './access';
import { oracleCanAccess, oracleVisibleCaseIds } from './accessOracle';
import { DEFAULT_PERMISSION_MATRIX } from '../shared/permissions';
import { ROLES, type Role } from '../shared/enums';

/**
 * HYPREP LCMS - the access-control corpus test.
 *
 * `visibleToUser` was the riskiest thing in the migration: the security boundary,
 * with a performance cliff, depending on derived state staying in sync, and with
 * every other read downstream of it. Nothing in the prototype tested it, and a
 * mistake in it does not throw - it just quietly shows the wrong person a
 * confidential matter.
 *
 * So this does not test a handful of hand-picked scenarios. It generates a corpus
 * of matters with membership drawn pseudo-randomly across a roster of users, and
 * for every (user, matter) pair asserts three things:
 *
 *   1. The index-driven answer equals the array-scan answer. This is what catches
 *      a bad `caseMembers` projection.
 *   2. For non-confidential matters, the new rule equals the old one exactly.
 *      This bounds the behaviour change.
 *   3. For confidential matters, the new rule only ever *withholds* what the old
 *      one allowed. This proves the gap was closed and no access was widened.
 *
 * It runs against `convex-test`'s in-memory backend, so `withIndex` is the real
 * index implementation rather than a stand-in - which matters, because the
 * property under test is precisely that the index agrees with the arrays.
 *
 * ## Why there is a second, hand-written suite below
 *
 * The corpus checks were mutation-tested by breaking `access.ts` three ways.
 * Treating `restricted` as a granting kind, and dropping stakeholders from the
 * projection, were both caught loudly. Reordering the gates so the confidential
 * flag suppressed membership was **not** - and that is structural, not an
 * oversight in the corpus size. Two of the three properties are self-referential
 * (they compute their expectation from `canAccessCase`), and the third asserts
 * only that access did not *widen*, which a too-strict rule satisfies trivially.
 *
 * So the corpus is the right tool for derived-state and equivalence bugs, and the
 * wrong tool for "is the rule itself still the rule". The invariant that closes
 * that specific hole is asserted directly over the corpus, and the named
 * scenarios at the bottom of this file pin each judgment call so a regression
 * reads as "briefed counsel can no longer open their brief" rather than "seed
 * 4242 disagrees on 3 of 1080 pairs".
 */

// ---------------------------------------------------------------------------
// Corpus generation
// ---------------------------------------------------------------------------

/**
 * Same LCG the mock generators use, for the same reason: a failing corpus must
 * be reproducible from its seed. `Math.random()` here would mean a test that
 * fails once in fifty runs and can never be made to fail again.
 */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Picks a random subset, sometimes with a duplicate.
 *
 * The duplicate is deliberate. Real membership arrays acquire them - a user
 * added twice through two different edits - and `caseMemberRows` has to collapse
 * them or the join table grows a redundant row whose absence or presence must
 * not change the answer.
 */
function subset<T>(next: () => number, pool: readonly T[], maxSize: number): T[] {
  const size = Math.floor(next() * (maxSize + 1));
  const chosen: T[] = [];
  for (let i = 0; i < size; i += 1) {
    chosen.push(pool[Math.floor(next() * pool.length)]!);
  }
  if (chosen.length > 1 && next() < 0.15) chosen.push(chosen[0]!);
  return chosen;
}

/** Roles the corpus draws from, so every permission shape is represented. */
const CORPUS_ROLES: readonly Role[] = ROLES;

const CASE_COUNT = 90;

interface CorpusUser {
  id: Id<'users'>;
  role: Role;
}

/**
 * Builds a register: users across every role, then matters whose membership,
 * confidentiality and restriction lists are drawn from the seed.
 *
 * Proportions are chosen so the interesting combinations actually occur rather
 * than being theoretically possible. Roughly a third of matters are confidential
 * and a fifth are restricted, which means a meaningful number are *both* - the
 * case where the two gates interact, and the one a hand-written test is most
 * likely to omit.
 */
async function seedCorpus(t: ReturnType<typeof convexTest>, seed: number) {
  const next = rng(seed);

  const { users, courtId, caseTypeId } = await t.run(async (ctx) => {
    const courtId = await ctx.db.insert('courts', {
      slug: 'test-court',
      name: 'Federal High Court, Port Harcourt',
      tier: 'Federal High Court',
      division: 'Port Harcourt',
      state: 'Rivers',
      address: '1 Aba Road, Port Harcourt',
      active: true,
    });
    const caseTypeId = await ctx.db.insert('caseTypes', {
      slug: 'test-type',
      name: 'Environmental Remediation',
      description: 'Corpus fixture.',
      category: 'Civil',
      active: true,
    });

    const users: CorpusUser[] = [];
    // Two of each role: the difference between "sees it because of their role"
    // and "sees it because it is theirs" only shows up when a role has more than
    // one holder.
    for (let i = 0; i < CORPUS_ROLES.length * 2; i += 1) {
      const role = CORPUS_ROLES[i % CORPUS_ROLES.length]!;
      const id = await ctx.db.insert('users', {
        authUserId: null,
        fullName: `Corpus User ${i}`,
        email: `corpus${i}@hyprep.gov.ng`,
        phone: '+2348000000000',
        title: 'Lawyer',
        role,
        department: 'Legal Unit',
        teamId: null,
        practisingLicenceNo: null,
        firm: null,
        avatarColor: 'brand',
        initials: 'CU',
        status: 'active',
        mfaEnabled: false,
        mfaRequired: false,
        failedLoginAttempts: 0,
        lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        passwordChangedAt: null,
        lockedAt: null,
      });
      users.push({ id, role });
    }

    return { users, courtId, caseTypeId };
  });

  const userIds = users.map((u) => u.id);

  await t.run(async (ctx) => {
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const matterOwnerId = userIds[Math.floor(next() * userIds.length)]!;
      const assigneeIds = subset(next, userIds, 3);
      const externalCounselIds = subset(next, userIds, 2);
      const stakeholderIds = subset(next, userIds, 2);
      const confidential = next() < 0.35;
      // A restricted list that happens to be empty is the common case and must
      // behave as "not restricted", not as "restricted to nobody".
      const restrictedToUserIds = next() < 0.2 ? subset(next, userIds, 3) : [];

      const caseId = await ctx.db.insert('cases', {
        caseId: `HYP/LCMS/2026/${String(i).padStart(4, '0')}`,
        caseReference: null,
        title: `Corpus Matter ${i}`,
        suitNumber: null,
        courtId,
        caseTypeId,
        status: 'Filed',
        priority: 'Medium',
        filingDate: '2026-01-01',
        claimValue: null,
        matterOwnerId,
        assigneeIds,
        externalCounselIds,
        stakeholderIds,
        teamId: null,
        parties: [],
        relatedCases: [],
        tags: [],
        confidential,
        restrictedToUserIds,
        summary: '',
        reliefSought: '',
        presidingJudge: null,
        createdById: matterOwnerId,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: null,
        nextHearingAt: null,
        lastHearingAt: null,
        openTaskCount: 0,
        overdueTaskCount: 0,
        documentCount: 0,
        searchText: `Corpus Matter ${i}`,
      });

      // Written through the production projection, so the test exercises the
      // same code a real mutation would rather than a convenient stand-in.
      const record = (await ctx.db.get(caseId))!;
      for (const row of caseMemberRows(record)) {
        await ctx.db.insert('caseMembers', { caseId, userId: row.userId, kind: row.kind });
      }
    }
  });

  return { users };
}

function actorFor(user: CorpusUser): AccessActor {
  return makeActor(user.id, DEFAULT_PERMISSION_MATRIX[user.role]);
}

// ---------------------------------------------------------------------------
// The properties
// ---------------------------------------------------------------------------

// Several seeds rather than one: a single corpus can miss a combination by
// chance, and each seed is cheap. A failure names the seed that produced it.
const SEEDS = [1, 7, 99, 4242, 20260824];

describe.each(SEEDS)('access rule over generated corpus (seed %i)', (seed) => {
  test('the index-driven answer matches the array scan for every user', async () => {
    const t = convexTest({ schema });
    const { users } = await seedCorpus(t, seed);

    await t.run(async (ctx) => {
      for (const user of users) {
        const actor = actorFor(user);

        const viaIndex = new Set((await visibleCases(ctx, actor)).map((c) => c._id));
        const viaScan = await oracleVisibleCaseIds(ctx, actor);

        // The two disagree only on confidential matters, and only by withholding.
        // Anything else is a projection bug.
        const all = await ctx.db.query('cases').collect();
        const expected = new Set<Id<'cases'>>();
        for (const record of all) {
          if (canAccessCase(record, actor)) expected.add(record._id);
        }

        expect([...viaIndex].sort()).toEqual([...expected].sort());
        expect([...viaIndex].every((id) => viaScan.has(id))).toBe(true);
      }
    });
  });

  test('non-confidential matters resolve identically to the rule this replaces', async () => {
    const t = convexTest({ schema });
    const { users } = await seedCorpus(t, seed);

    await t.run(async (ctx) => {
      const all = await ctx.db.query('cases').collect();
      const openMatters = all.filter((record) => !record.confidential);
      // Guard against a corpus that accidentally proves nothing.
      expect(openMatters.length).toBeGreaterThan(20);

      for (const user of users) {
        const actor = actorFor(user);
        const canViewAll = actor.permissions.has('case.view.all');
        for (const record of openMatters) {
          expect(canAccessCase(record, actor)).toBe(
            oracleCanAccess(record, actor.userId, canViewAll),
          );
        }
      }
    });
  });

  test('confidential matters are only ever withheld, never newly exposed', async () => {
    const t = convexTest({ schema });
    const { users } = await seedCorpus(t, seed);

    await t.run(async (ctx) => {
      const all = await ctx.db.query('cases').collect();
      const sensitive = all.filter((record) => record.confidential);
      expect(sensitive.length).toBeGreaterThan(10);

      let actuallyWithheld = 0;
      for (const user of users) {
        const actor = actorFor(user);
        const canViewAll = actor.permissions.has('case.view.all');
        for (const record of sensitive) {
          const now = canAccessCase(record, actor);
          const before = oracleCanAccess(record, actor.userId, canViewAll);
          // Strictly narrower: allowed now implies allowed before.
          if (now) expect(before).toBe(true);
          if (before && !now) actuallyWithheld += 1;
        }
      }

      // If nothing was withheld the new gate is inert and the security fix is a
      // no-op - which would pass the implication above while proving nothing.
      expect(actuallyWithheld).toBeGreaterThan(0);
    });
  });

  test('membership rows only ever grant access the arrays already imply', async () => {
    const t = convexTest({ schema });
    const { users } = await seedCorpus(t, seed);

    await t.run(async (ctx) => {
      for (const user of users) {
        const ids = await memberCaseIds(ctx, user.id);
        for (const caseId of ids) {
          const record = (await ctx.db.get(caseId))!;
          const inArrays =
            record.matterOwnerId === user.id ||
            record.assigneeIds.includes(user.id) ||
            record.externalCounselIds.includes(user.id) ||
            record.stakeholderIds.includes(user.id);
          expect(inArrays).toBe(true);
        }
      }
    });
  });

  test('attachment to a matter always grants access, whatever the flags', async () => {
    // The invariant behind gate ordering, stated over the corpus rather than a
    // fixture. Mutation-testing this suite showed the checks above cannot catch a
    // predicate that is merely *too strict*: their expectation is computed from
    // `canAccessCase` itself, and the withholding check only asserts an
    // implication that a stricter rule still satisfies. So the decision is
    // asserted directly - if you are attached to a matter and the restricted list
    // does not exclude you, you can open it, clearance or no clearance.
    const t = convexTest({ schema });
    const { users } = await seedCorpus(t, seed);

    await t.run(async (ctx) => {
      const all = await ctx.db.query('cases').collect();
      let attachedToConfidentialWithoutClearance = 0;

      for (const user of users) {
        const actor = actorFor(user);
        for (const record of all) {
          const excluded =
            record.restrictedToUserIds.length > 0 &&
            !record.restrictedToUserIds.includes(user.id);
          if (excluded) continue;

          const attached =
            record.matterOwnerId === user.id ||
            record.assigneeIds.includes(user.id) ||
            record.externalCounselIds.includes(user.id) ||
            record.stakeholderIds.includes(user.id);
          if (!attached) continue;

          expect(canAccessCase(record, actor)).toBe(true);
          if (record.confidential && !actor.permissions.has('case.confidential.view')) {
            attachedToConfidentialWithoutClearance += 1;
          }
        }
      }

      // Without this the assertion above could hold trivially, on a corpus where
      // everyone attached to a confidential matter happens to hold clearance.
      expect(attachedToConfidentialWithoutClearance).toBeGreaterThan(0);
    });
  });

  test('every array membership is reachable through the index', async () => {
    const t = convexTest({ schema });
    const { users } = await seedCorpus(t, seed);

    await t.run(async (ctx) => {
      const all = await ctx.db.query('cases').collect();
      for (const user of users) {
        const viaIndex = await memberCaseIds(ctx, user.id);
        for (const record of all) {
          const inArrays =
            record.matterOwnerId === user.id ||
            record.assigneeIds.includes(user.id) ||
            record.externalCounselIds.includes(user.id) ||
            record.stakeholderIds.includes(user.id);
          // The direction that locks a lawyer out of their own matter.
          if (inArrays) expect(viaIndex.has(record._id)).toBe(true);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// The cases the corpus cannot be relied on to produce
// ---------------------------------------------------------------------------

/**
 * Named scenarios for the decisions that were judgment calls rather than ports.
 *
 * The corpus covers these statistically, but if one of them regressed the
 * failure would read as "seed 4242 disagrees on 3 of 1080 pairs", which says
 * nothing about which rule broke. These say it directly.
 */
describe('the decisions behind the rule', () => {
  const asCase = (over: Partial<CaseAccessFields>): CaseAccessFields => ({
    _id: 'case_1' as Id<'cases'>,
    matterOwnerId: 'usr_owner' as Id<'users'>,
    assigneeIds: [],
    externalCounselIds: [],
    stakeholderIds: [],
    restrictedToUserIds: [],
    confidential: false,
    ...over,
  });

  const someone = 'usr_other' as Id<'users'>;
  const registerWide = makeActor(someone, DEFAULT_PERMISSION_MATRIX.CASE_OFFICER);
  const cleared = makeActor(someone, DEFAULT_PERMISSION_MATRIX.LEGAL_STAFF);
  const superAdmin = makeActor(someone, DEFAULT_PERMISSION_MATRIX.SUPER_ADMIN);
  const counsel = makeActor(someone, DEFAULT_PERMISSION_MATRIX.EXTERNAL_COUNSEL);

  test('the matrix still has a role with register-wide scope but no clearance', () => {
    // The premise of the whole confidential gate. If a matrix edit ever gave
    // CASE_OFFICER `case.confidential.view`, the gate would stop separating
    // anything and these tests would silently start proving less.
    expect(registerWide.permissions.has('case.view.all')).toBe(true);
    expect(registerWide.permissions.has('case.confidential.view')).toBe(false);
    expect(cleared.permissions.has('case.confidential.view')).toBe(true);
  });

  test('a restricted matter excludes even a super admin', () => {
    const record = asCase({ restrictedToUserIds: ['usr_only' as Id<'users'>] });
    expect(canAccessCase(record, superAdmin)).toBe(false);
  });

  test('register-wide scope does not open a confidential matter', () => {
    expect(canAccessCase(asCase({ confidential: true }), registerWide)).toBe(false);
  });

  test('clearance opens a confidential matter the holder is not attached to', () => {
    expect(canAccessCase(asCase({ confidential: true }), cleared)).toBe(true);
  });

  test('briefed counsel opens a confidential matter without clearance', () => {
    // The reason membership is evaluated before the flag: an external firm is
    // briefed on sensitive matters routinely and holds neither view.all nor
    // clearance. If the flag gated membership, the brief would be unopenable.
    const record = asCase({ confidential: true, externalCounselIds: [someone] });
    expect(counsel.permissions.has('case.view.all')).toBe(false);
    expect(counsel.permissions.has('case.confidential.view')).toBe(false);
    expect(canAccessCase(record, counsel)).toBe(true);
  });

  test('a case officer assigned to a confidential matter keeps access', () => {
    const record = asCase({ confidential: true, assigneeIds: [someone] });
    expect(canAccessCase(record, registerWide)).toBe(true);
  });

  test('restriction beats membership', () => {
    // Being assigned does not survive being left off an explicit allow-list -
    // that is how a matter gets locked down mid-flight without unassigning
    // anyone, and the order of gates 1 and 2 is what implements it.
    const record = asCase({
      assigneeIds: [someone],
      restrictedToUserIds: ['usr_only' as Id<'users'>],
    });
    expect(canAccessCase(record, registerWide)).toBe(false);
  });

  test('being named on the restricted list is not itself a grant', () => {
    // The subtlest rule here. `restrictedToUserIds` narrows; it does not confer.
    // A read-only stakeholder named on the list, with no working attachment and
    // no register-wide scope, still sees nothing.
    const readOnly = makeActor(someone, DEFAULT_PERMISSION_MATRIX.READ_ONLY);
    const record = asCase({ restrictedToUserIds: [someone] });
    expect(readOnly.permissions.has('case.view.all')).toBe(false);
    expect(canAccessCase(record, readOnly)).toBe(false);
    // ...whereas the same list does let register-wide scope through.
    expect(canAccessCase(record, registerWide)).toBe(true);
  });

  test('the projection records restricted users without granting them', () => {
    const record = asCase({ restrictedToUserIds: [someone] });
    const rows = caseMemberRows(record);
    expect(rows).toEqual(
      expect.arrayContaining([{ userId: someone, kind: 'restricted' }]),
    );
    // `memberCaseIds` filters to granting kinds, so the row is inert for access.
    expect(rows.filter((r) => r.kind === 'restricted')).toHaveLength(1);
  });

  test('the projection collapses duplicates but keeps distinct kinds', () => {
    const owner = 'usr_owner' as Id<'users'>;
    const rows = caseMemberRows(
      asCase({ matterOwnerId: owner, assigneeIds: [owner, owner], stakeholderIds: [owner] }),
    );
    // One row per (user, kind): owner, assignee, stakeholder - the duplicate
    // assignee entry collapses, the three roles do not.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.kind))).toEqual(
      new Set(['owner', 'assignee', 'stakeholder']),
    );
  });
});
