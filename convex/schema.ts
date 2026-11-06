import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  auditEntityValidator,
  auditMetadataValidator,
  auditOutcomeValidator,
  backupScheduleValidator,
  backupScopeValidator,
  backupStatusValidator,
  backupTypeValidator,
  caseLinkTypeValidator,
  caseMemberKindValidator,
  casePriorityValidator,
  caseStatusValidator,
  caseTypeCategoryValidator,
  courtTierValidator,
  currencyValidator,
  dateFormatValidator,
  digestFrequencyValidator,
  documentFormatValidator,
  documentGroupValidator,
  hearingOutcomeValidator,
  hearingPurposeValidator,
  notificationChannelValidator,
  notificationPriorityValidator,
  notificationTypeValidator,
  ocrStatusValidator,
  partyRoleValidator,
  partyTypeValidator,
  permissionValidator,
  roleValidator,
  savedViewEntityValidator,
  staffTitleValidator,
  taskStatusValidator,
  userStatusValidator,
} from './shared/enums';

/**
 * HYPREP LCMS - database schema.
 *
 * Conventions that hold throughout:
 *
 * - **Relations use `v.id(table)`.** A Convex id is a branded string at runtime,
 *   so the client keeps comparing `record.matterOwnerId === user.id` unchanged,
 *   while the validator rejects dangling references at the boundary for free.
 *
 * - **Timestamps are ISO 8601 strings**, not epoch numbers. ISO strings in UTC
 *   sort lexicographically in chronological order, so range queries over an
 *   index work exactly as they would over numbers, and every `date-fns` call and
 *   `localeCompare` sort already written in the UI keeps working untouched.
 *
 * - **Business identifiers stay as their own indexed fields.** `cases.caseId`
 *   (HYP/LCMS/2026/0042) is printed on court process and quoted by users; the
 *   reference tables carry a `slug` so the seed is idempotent and re-runnable.
 *
 * Better Auth owns its own tables inside its component namespace (see
 * `convex.config.ts`). The `users` table here is the *domain* record - role,
 * title, licence number - linked to the credential record by `authUserId`.
 */

// ---------------------------------------------------------------------------
// Reusable embedded shapes
// ---------------------------------------------------------------------------

/** A party to a matter. Embedded: always read with the case, bounded in count. */
const party = v.object({
  id: v.string(),
  name: v.string(),
  role: partyRoleValidator,
  type: partyTypeValidator,
  email: v.union(v.string(), v.null()),
  phone: v.union(v.string(), v.null()),
  address: v.union(v.string(), v.null()),
  representedBy: v.union(v.string(), v.null()),
});

const relatedCaseLink = v.object({
  caseId: v.id('cases'),
  linkType: caseLinkTypeValidator,
  note: v.string(),
});

/**
 * One revision of a document.
 *
 * `storageId` is the real Convex storage handle. It is nullable because a
 * document record can exist without bytes behind it - a metadata-only record
 * migrated from the legacy register, for instance - and the viewer needs to be
 * able to say so rather than serving a broken URL. `storageKey` is retained as
 * the human-readable location shown in the version history.
 */
const documentVersion = v.object({
  version: v.number(),
  uploadedById: v.id('users'),
  uploadedAt: v.string(),
  sizeBytes: v.number(),
  changeNote: v.string(),
  storageId: v.union(v.id('_storage'), v.null()),
  storageKey: v.string(),
});

const taskChecklistItem = v.object({
  id: v.string(),
  label: v.string(),
  done: v.boolean(),
});

export default defineSchema({
  fileTickets: defineTable({
    token: v.string(),
    storageId: v.id('_storage'),
    documentId: v.optional(v.id('documents')),
    inline: v.optional(v.boolean()),
    contentType: v.optional(v.string()),
    watermarked: v.optional(v.boolean()),
    userId: v.id('users'),
    authSessionId: v.union(v.string(), v.null()),
    caseId: v.id('cases'),
    permission: permissionValidator,
    name: v.string(),
    expiresAt: v.number(),
  }).index('by_token', ['token']).index('by_expiry', ['expiresAt']),
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * Domain user record.
   *
   * Deliberately separate from Better Auth's credential store: this table holds
   * everything the *application* means by a user (role, practising licence,
   * team) while Better Auth holds everything the *session* means by one
   * (password hash, TOTP secret, active sessions). `authUserId` is the join.
   *
   * A credential record with no row here is denied sign-in rather than
   * auto-provisioned - otherwise anyone who could reach the sign-up endpoint
   * would mint themselves an account.
   */
  users: defineTable({
    authUserId: v.union(v.string(), v.null()),
    fullName: v.string(),
    email: v.string(),
    phone: v.string(),
    title: staffTitleValidator,
    role: roleValidator,
    department: v.string(),
    teamId: v.union(v.id('teams'), v.null()),
    practisingLicenceNo: v.union(v.string(), v.null()),
    firm: v.union(v.string(), v.null()),
    avatarColor: v.string(),
    initials: v.string(),
    status: userStatusValidator,
    /**
     * Whether a second factor is actually enrolled. Mirrored from Better Auth's
     * `twoFactorEnabled` by a database hook - not settable from the domain side,
     * because enrolment means possessing the authenticator.
     */
    mfaEnabled: v.boolean(),
    /**
     * Whether this individual must enrol, over and above
     * `settings.mfaRequiredForRoles`.
     *
     * Separate from `mfaEnabled` because they are different facts and the
     * prototype conflated them: Admin -> Users offers "Require MFA", which an
     * administrator can genuinely demand, while enrolment is something only the
     * user can complete. One field for both meant the toggle claimed to enrol
     * somebody else's phone.
     */
    mfaRequired: v.boolean(),
    failedLoginAttempts: v.number(),
    lastLoginAt: v.union(v.string(), v.null()),
    createdAt: v.string(),
    /** Drives the TOR password-expiry rule (`settings.passwordExpiryDays`). */
    passwordChangedAt: v.union(v.string(), v.null()),
    /** Set when a lockout threshold is crossed; cleared on admin unlock. */
    lockedAt: v.union(v.string(), v.null()),
  })
    .index('by_email', ['email'])
    .index('by_authUserId', ['authUserId'])
    .index('by_role', ['role'])
    .index('by_status', ['status'])
    .index('by_team', ['teamId']),

  teams: defineTable({
    name: v.string(),
    description: v.string(),
    leadUserId: v.union(v.id('users'), v.null()),
    memberIds: v.array(v.id('users')),
  }).index('by_name', ['name']),

  /**
   * Role -> permission grants, one document per role.
   *
   * A table rather than a constant because TOR section 19 requires the matrix to be
   * editable at runtime by an administrator. Storing it per-role means an edit
   * to one role invalidates only the queries that read that role.
   */
  permissionMatrix: defineTable({
    role: roleValidator,
    permissions: v.array(permissionValidator),
    updatedAt: v.string(),
    updatedById: v.union(v.id('users'), v.null()),
  }).index('by_role', ['role']),

  /**
   * Active sign-in sessions, surfaced in the profile and admin screens so a user
   * or administrator can see and revoke them (TOR section 37).
   *
   * Better Auth is the authority on whether a session is valid; this table is
   * the human-readable projection, carrying the device/IP/location detail that
   * is only available at the HTTP boundary.
   */
  userSessions: defineTable({
    userId: v.id('users'),
    authSessionId: v.union(v.string(), v.null()),
    device: v.string(),
    browser: v.string(),
    ipAddress: v.string(),
    location: v.string(),
    startedAt: v.string(),
    lastSeenAt: v.string(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.union(v.string(), v.null()),
  })
    .index('by_user', ['userId'])
    .index('by_authSessionId', ['authSessionId']),

  // -------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------

  /**
   * The register.
   *
   * Two groups of fields here are *derived* and maintained by the mutations that
   * change their inputs, rather than computed on read:
   *
   * 1. **Rollups** (`nextHearingAt`, `openTaskCount`, ...). The register sorts
   *    and filters on these. Convex can only sort and filter over indexed
   *    fields, and a value computed during a query cannot be indexed - so
   *    leaving them derived would make server-side sorting impossible and force
   *    the whole table to the client. `overdueTaskCount` additionally depends on
   *    the clock, so a nightly cron reconciles it (see `crons.ts`).
   *
   * 2. **`searchText`**. Users search across case number, title, suit number,
   *    summary and party names. A search index covers exactly one field, so the
   *    searchable text is concatenated into one field at write time instead of
   *    maintaining five separate indexes and merging the results.
   *
   * The membership arrays are kept here for display and form round-trip, but
   * they are *not* the access index - see `caseMembers`.
   */
  cases: defineTable({
    caseId: v.string(),
    caseReference: v.union(v.string(), v.null()),
    title: v.string(),
    suitNumber: v.union(v.string(), v.null()),
    courtId: v.id('courts'),
    caseTypeId: v.id('caseTypes'),
    status: caseStatusValidator,
    priority: casePriorityValidator,
    filingDate: v.union(v.string(), v.null()),
    claimValue: v.union(v.number(), v.null()),
    matterOwnerId: v.id('users'),
    assigneeIds: v.array(v.id('users')),
    externalCounselIds: v.array(v.id('users')),
    stakeholderIds: v.array(v.id('users')),
    teamId: v.union(v.id('teams'), v.null()),
    parties: v.array(party),
    relatedCases: v.array(relatedCaseLink),
    tags: v.array(v.string()),
    confidential: v.boolean(),
    restrictedToUserIds: v.array(v.id('users')),
    summary: v.string(),
    reliefSought: v.string(),
    presidingJudge: v.union(v.string(), v.null()),
    createdById: v.id('users'),
    createdAt: v.string(),
    updatedAt: v.string(),
    archivedAt: v.union(v.string(), v.null()),

    // Derived - maintained at write time, reconciled nightly.
    nextHearingAt: v.union(v.string(), v.null()),
    lastHearingAt: v.union(v.string(), v.null()),
    openTaskCount: v.number(),
    overdueTaskCount: v.number(),
    documentCount: v.number(),
    searchText: v.string(),
  })
    .index('by_caseId', ['caseId'])
    .index('by_status', ['status'])
    .index('by_matterOwner', ['matterOwnerId'])
    .index('by_court', ['courtId'])
    .index('by_caseType', ['caseTypeId'])
    .index('by_team', ['teamId'])
    .index('by_nextHearingAt', ['nextHearingAt'])
    .index('by_archivedAt', ['archivedAt'])
    .index('by_updatedAt', ['updatedAt'])
    .index('by_status_filingDate', ['status', 'filingDate'])
    .searchIndex('search_cases', {
      searchField: 'searchText',
      filterFields: ['status', 'courtId', 'caseTypeId', 'confidential', 'archivedAt'],
    }),

  /**
   * The access index - the single most load-bearing table in the schema.
   *
   * Row-level visibility is membership: a case officer sees a matter if they own
   * it, are assigned to it, are counsel on it, or are a named stakeholder.
   * Those are four arrays on the case document, and **Convex cannot index an
   * array for containment** - so answering "which cases can this user see?"
   * from the arrays alone means scanning the entire register on every read.
   *
   * Projecting the arrays into rows turns that scan into an index lookup on
   * `by_user`. The arrays remain the source of truth on the case document; this
   * table is a derived index, rewritten in the same transaction as any edit to
   * the membership arrays.
   */
  caseMembers: defineTable({
    caseId: v.id('cases'),
    userId: v.id('users'),
    kind: caseMemberKindValidator,
  })
    .index('by_user', ['userId'])
    .index('by_case', ['caseId'])
    .index('by_user_case', ['userId', 'caseId']),

  statusChanges: defineTable({
    caseId: v.id('cases'),
    from: v.union(caseStatusValidator, v.null()),
    to: caseStatusValidator,
    reason: v.string(),
    byUserId: v.id('users'),
    at: v.string(),
  })
    .index('by_case', ['caseId'])
    .index('by_case_at', ['caseId', 'at']),

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  documents: defineTable({
    caseId: v.id('cases'),
    name: v.string(),
    documentTypeId: v.id('documentTypes'),
    format: documentFormatValidator,
    currentVersion: v.number(),
    versions: v.array(documentVersion),
    authorId: v.id('users'),
    confidential: v.boolean(),
    tags: v.array(v.string()),
    description: v.string(),
    /** Text recovered by OCR. Backs `search_document_text`. */
    ocrText: v.union(v.string(), v.null()),
    ocrStatus: ocrStatusValidator,
    /** Number of OCR attempts, so the requeue cron can stop retrying forever. */
    ocrAttempts: v.number(),
    checkedOutById: v.union(v.id('users'), v.null()),
    checkedOutAt: v.union(v.string(), v.null()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_case', ['caseId'])
    .index('by_documentType', ['documentTypeId'])
    .index('by_ocrStatus', ['ocrStatus'])
    .index('by_author', ['authorId'])
    .searchIndex('search_documents', {
      searchField: 'name',
      filterFields: ['caseId', 'confidential'],
    })
    .searchIndex('search_document_text', {
      searchField: 'ocrText',
      filterFields: ['caseId', 'confidential'],
    }),

  // -------------------------------------------------------------------------
  // Court dates / hearings
  // -------------------------------------------------------------------------

  courtDates: defineTable({
    caseId: v.id('cases'),
    startsAt: v.string(),
    durationMinutes: v.number(),
    courtId: v.id('courts'),
    courtRoom: v.string(),
    judge: v.string(),
    purpose: hearingPurposeValidator,
    notes: v.string(),
    attendeeIds: v.array(v.id('users')),
    reminderOffsetsHours: v.array(v.number()),
    outcome: v.union(hearingOutcomeValidator, v.null()),
    outcomeNotes: v.string(),
    outcomeRecordedById: v.union(v.id('users'), v.null()),
    outcomeRecordedAt: v.union(v.string(), v.null()),
    adjournedToDateId: v.union(v.id('courtDates'), v.null()),
    createdById: v.id('users'),
    createdAt: v.string(),
  })
    .index('by_case', ['caseId'])
    .index('by_startsAt', ['startsAt'])
    .index('by_case_startsAt', ['caseId', 'startsAt'])
    .index('by_court', ['courtId']),

  /**
   * Reminder idempotency ledger (TOR section 12).
   *
   * The reminder cron runs hourly and must survive being retried. Without a
   * record of what has already gone out, a single replay re-sends every reminder
   * on the diary - which for the SMS channel means texting every lawyer twice
   * and paying for it. One row per (hearing, offset) makes the send idempotent.
   */
  sentReminders: defineTable({
    courtDateId: v.id('courtDates'),
    offsetHours: v.number(),
    sentAt: v.string(),
    channels: v.array(notificationChannelValidator),
    recipientCount: v.number(),
  })
    .index('by_courtDate_offset', ['courtDateId', 'offsetHours'])
    .index('by_courtDate', ['courtDateId']),

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  tasks: defineTable({
    caseId: v.union(v.id('cases'), v.null()),
    title: v.string(),
    description: v.string(),
    ownerId: v.id('users'),
    assignedTeamId: v.union(v.id('teams'), v.null()),
    dueDate: v.string(),
    priority: casePriorityValidator,
    status: taskStatusValidator,
    checklist: v.array(taskChecklistItem),
    attachmentDocumentIds: v.array(v.id('documents')),
    createdById: v.id('users'),
    createdAt: v.string(),
    completedAt: v.union(v.string(), v.null()),
    workflowTemplateId: v.union(v.string(), v.null()),
  })
    .index('by_case', ['caseId'])
    .index('by_owner', ['ownerId'])
    .index('by_owner_status', ['ownerId', 'status'])
    .index('by_status_dueDate', ['status', 'dueDate'])
    .index('by_dueDate', ['dueDate']),

  // -------------------------------------------------------------------------
  // Notes
  // -------------------------------------------------------------------------

  notes: defineTable({
    caseId: v.id('cases'),
    body: v.string(),
    authorId: v.id('users'),
    createdAt: v.string(),
    internalOnly: v.boolean(),
    mentions: v.array(v.id('users')),
  })
    .index('by_case', ['caseId'])
    .index('by_case_createdAt', ['caseId', 'createdAt']),

  // -------------------------------------------------------------------------
  // Notifications & audit
  // -------------------------------------------------------------------------

  notifications: defineTable({
    userId: v.id('users'),
    type: notificationTypeValidator,
    title: v.string(),
    body: v.string(),
    caseId: v.union(v.id('cases'), v.null()),
    link: v.union(v.string(), v.null()),
    channels: v.array(notificationChannelValidator),
    priority: notificationPriorityValidator,
    read: v.boolean(),
    at: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_user_read', ['userId', 'read'])
    .index('by_user_at', ['userId', 'at']),

  /**
   * Append-only audit trail (TOR section 17).
   *
   * The largest table in the system by row count, and admin-only: it is always
   * read through a paginated, indexed query and never scanned wholesale.
   *
   * `ipAddress` and `userAgent` are nullable because they are genuinely
   * unavailable inside a Convex mutation - there is no request context there.
   * Events that originate at the HTTP boundary (sign-in, REST API calls) carry
   * them; events raised by an in-app mutation do not, and record null rather
   * than a fabricated value.
   */
  auditLog: defineTable({
    at: v.string(),
    actorId: v.union(v.id('users'), v.null()),
    /** Preserved for the record even if the user is later deleted. */
    actorLabel: v.string(),
    action: v.string(),
    entity: auditEntityValidator,
    entityId: v.string(),
    entityLabel: v.string(),
    ipAddress: v.union(v.string(), v.null()),
    userAgent: v.union(v.string(), v.null()),
    outcome: auditOutcomeValidator,
    metadata: auditMetadataValidator,
  })
    .index('by_at', ['at'])
    .index('by_actor_at', ['actorId', 'at'])
    .index('by_entity_entityId', ['entity', 'entityId'])
    .index('by_outcome_at', ['outcome', 'at']),

  // -------------------------------------------------------------------------
  // Configuration (TOR section 19 - runtime-editable reference data)
  // -------------------------------------------------------------------------
  //
  // Only the four tables an administrator can actually edit live in the
  // database. Workflow templates, case templates and report definitions are
  // read-only structural config, so they stay as code constants in
  // `convex/shared/` - keeping them in a table would mean re-seeding the
  // database every time a column label changed.

  courts: defineTable({
    slug: v.string(),
    name: v.string(),
    tier: courtTierValidator,
    division: v.string(),
    state: v.string(),
    address: v.string(),
    active: v.boolean(),
  })
    .index('by_slug', ['slug'])
    .index('by_active', ['active']),

  caseTypes: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    category: caseTypeCategoryValidator,
    active: v.boolean(),
  })
    .index('by_slug', ['slug'])
    .index('by_active', ['active']),

  documentTypes: defineTable({
    slug: v.string(),
    name: v.string(),
    group: documentGroupValidator,
    retentionYears: v.number(),
    requiresConfidentiality: v.boolean(),
    active: v.boolean(),
  })
    .index('by_slug', ['slug'])
    .index('by_active', ['active']),

  /**
   * Tag vocabulary. `usageCount` is derived from the cases that carry the tag
   * label and maintained by the case mutations, so the admin screen can show it
   * without counting the register on every render.
   */
  tags: defineTable({
    slug: v.string(),
    label: v.string(),
    color: v.string(),
    usageCount: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_label', ['label']),

  /** Singleton. Read with `.first()`; there is only ever one row. */
  settings: defineTable({
    organisationName: v.string(),
    unitName: v.string(),
    dateFormat: dateFormatValidator,
    timeZone: v.string(),
    currency: currencyValidator,
    sessionTimeoutMinutes: v.number(),
    passwordExpiryDays: v.number(),
    passwordMinLength: v.number(),
    passwordRequireComplexity: v.boolean(),
    maxFailedLoginAttempts: v.number(),
    mfaRequiredForRoles: v.array(roleValidator),
    reminderOffsetsHours: v.array(v.number()),
    digestFrequency: digestFrequencyValidator,
    retentionArchiveAfterYears: v.number(),
    storageQuotaGb: v.number(),
    storageUsedGb: v.number(),
    backupSchedule: backupScheduleValidator,
    backupRetentionDays: v.number(),
    watermarkConfidentialDownloads: v.boolean(),
    ocrEnabled: v.boolean(),
    smsEnabled: v.boolean(),
    ssoEnabled: v.boolean(),
    /**
     * Retention deletion is opt-in and off by default. The sweep reports what it
     * *would* remove until an administrator explicitly enables it, so a
     * misconfigured retention window cannot silently destroy court documents.
     */
    retentionDeletionEnabled: v.boolean(),
  }),

  savedViews: defineTable({
    name: v.string(),
    ownerId: v.id('users'),
    entity: savedViewEntityValidator,
    filters: v.string(),
    shared: v.boolean(),
    createdAt: v.string(),
  })
    .index('by_owner', ['ownerId'])
    .index('by_entity', ['entity'])
    .index('by_shared', ['shared']),

  archiveTickets: defineTable({
    token: v.string(),
    backupId: v.id('backups'),
    userId: v.id('users'),
    authSessionId: v.string(),
    expiresAt: v.number(),
  }).index('by_token', ['token']),

  backups: defineTable({
    startedAt: v.string(),
    scheduledAt: v.optional(v.string()),
    completedAt: v.union(v.string(), v.null()),
    type: backupTypeValidator,
    scope: backupScopeValidator,
    sizeGb: v.number(),
    location: v.string(),
    status: backupStatusValidator,
    /** The exported archive in Convex storage, when the run produced one. */
    storageId: v.union(v.id('_storage'), v.null()),
    triggeredById: v.union(v.id('users'), v.null()),
    error: v.union(v.string(), v.null()),
  })
    .index('by_startedAt', ['startedAt'])
    .index('by_scheduledAt', ['scheduledAt'])
    .index('by_status', ['status']),

  /**
   * Monotonic counters for human-readable identifiers.
   *
   * `cases.caseId` is of the form HYP/LCMS/2026/0042, so the sequence resets per
   * year and the counter name carries the year (`case:2026`). Convex mutations
   * are serialisable, which makes read-modify-write here safe without any
   * explicit locking.
   */
  counters: defineTable({
    name: v.string(),
    value: v.number(),
  }).index('by_name', ['name']),

  // -------------------------------------------------------------------------
  // Integration surface (TOR sections 18, 33)
  // -------------------------------------------------------------------------

  /**
   * API credentials for the public REST surface.
   *
   * Only the SHA-256 of the secret is stored - a leaked database row must not be
   * usable as a credential. The `keyId` half travels in clear so a request can
   * be looked up by index before the constant-time comparison.
   */
  apiKeys: defineTable({
    keyId: v.string(),
    hashedSecret: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
    createdById: v.id('users'),
    createdAt: v.string(),
    lastUsedAt: v.union(v.string(), v.null()),
    expiresAt: v.union(v.string(), v.null()),
    revokedAt: v.union(v.string(), v.null()),
  }).index('by_keyId', ['keyId']),

  webhookEndpoints: defineTable({
    url: v.string(),
    /** Signing secret for the HMAC-SHA256 `X-LCMS-Signature` header. */
    secret: v.string(),
    description: v.string(),
    events: v.array(v.string()),
    active: v.boolean(),
    createdById: v.id('users'),
    createdAt: v.string(),
    lastDeliveryAt: v.union(v.string(), v.null()),
    failureCount: v.number(),
  })
    .index('by_active', ['active'])
    .index('by_event', ['events']),

  webhookDeliveries: defineTable({
    endpointId: v.id('webhookEndpoints'),
    event: v.string(),
    payload: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('delivered'),
      v.literal('failed'),
      v.literal('abandoned'),
    ),
    attempts: v.number(),
    nextAttemptAt: v.union(v.string(), v.null()),
    lastError: v.union(v.string(), v.null()),
    responseStatus: v.union(v.number(), v.null()),
    createdAt: v.string(),
    deliveredAt: v.union(v.string(), v.null()),
  })
    .index('by_endpoint', ['endpointId'])
    .index('by_status_nextAttemptAt', ['status', 'nextAttemptAt']),
});
