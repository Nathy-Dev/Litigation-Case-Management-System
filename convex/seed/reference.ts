/**
 * HYPREP LCMS - seed data for the runtime-editable lookup tables.
 *
 * These four tables are the ones TOR section 19 lets an administrator edit at
 * runtime, so they live in the database rather than in code. Everything here is
 * production configuration, not demo fixtures: the courts, matter types and
 * document types the HYPREP Legal Unit actually works with, without which the
 * case form cannot render a single dropdown.
 *
 * `slug` is the idempotency key. The seeder upserts by slug, so it can be re-run
 * after this file grows a new court without duplicating the existing rows, and
 * an administrator's edits to `name` or `active` survive a re-seed.
 *
 * Read-only structural config - workflow templates, case templates and report
 * definitions - deliberately does NOT live here. See `convex/shared/`.
 */
import type {
  CaseTypeCategory,
  CourtTier,
  DocumentGroup,
  Role,
} from '../shared/enums';

export interface CourtSeed {
  slug: string;
  name: string;
  tier: CourtTier;
  division: string;
  state: string;
  address: string;
  active: boolean;
}

export interface CaseTypeSeed {
  slug: string;
  name: string;
  description: string;
  category: CaseTypeCategory;
  active: boolean;
}

export interface DocumentTypeSeed {
  slug: string;
  name: string;
  group: DocumentGroup;
  /** Drives the retention sweep's disposal review list (TOR section 16). */
  retentionYears: number;
  requiresConfidentiality: boolean;
  active: boolean;
}

export interface TagSeed {
  slug: string;
  label: string;
  color: string;
}

export const COURTS: CourtSeed[] = [
  {
    slug: 'crt_fhc_ph',
    name: 'Federal High Court, Port Harcourt Division',
    tier: 'Federal High Court',
    division: 'Port Harcourt',
    state: 'Rivers',
    address: 'Federal High Court Complex, Moscow Road, Port Harcourt',
    active: true,
  },
  {
    slug: 'crt_fhc_abj',
    name: 'Federal High Court, Abuja Division',
    tier: 'Federal High Court',
    division: 'Abuja',
    state: 'FCT',
    address: 'Federal High Court, Shehu Shagari Way, Central Business District, Abuja',
    active: true,
  },
  {
    slug: 'crt_nicn_ph',
    name: 'National Industrial Court of Nigeria, Port Harcourt',
    tier: 'National Industrial Court',
    division: 'Port Harcourt',
    state: 'Rivers',
    address: 'NICN Judicial Division, Aba Road, Port Harcourt',
    active: true,
  },
  {
    slug: 'crt_rshc_ph',
    name: 'Rivers State High Court, Port Harcourt Judicial Division',
    tier: 'State High Court',
    division: 'Port Harcourt',
    state: 'Rivers',
    address: 'Rivers State High Court Complex, Justice Chukwudifu Oputa Road, Port Harcourt',
    active: true,
  },
  {
    slug: 'crt_rshc_bori',
    name: 'Rivers State High Court, Bori Judicial Division',
    tier: 'State High Court',
    division: 'Bori',
    state: 'Rivers',
    address: 'High Court Complex, Bori, Khana LGA, Rivers State',
    active: true,
  },
  {
    slug: 'crt_ca_ph',
    name: 'Court of Appeal, Port Harcourt Division',
    tier: 'Court of Appeal',
    division: 'Port Harcourt',
    state: 'Rivers',
    address: 'Court of Appeal, Port Harcourt Judicial Division, Rivers State',
    active: true,
  },
  {
    slug: 'crt_ca_abj',
    name: 'Court of Appeal, Abuja Division',
    tier: 'Court of Appeal',
    division: 'Abuja',
    state: 'FCT',
    address: 'Court of Appeal Headquarters, Three Arms Zone, Abuja',
    active: true,
  },
  {
    slug: 'crt_sc',
    name: 'Supreme Court of Nigeria',
    tier: 'Supreme Court',
    division: 'Abuja',
    state: 'FCT',
    address: 'Supreme Court Complex, Three Arms Zone, Abuja',
    active: true,
  },
  {
    slug: 'crt_mag_bori',
    name: 'Chief Magistrate Court, Bori',
    tier: 'Magistrate Court',
    division: 'Bori',
    state: 'Rivers',
    address: 'Magistrate Court Premises, Bori, Rivers State',
    active: true,
  },
  {
    slug: 'crt_tat_ss',
    name: 'Tax Appeal Tribunal, South-South Zone',
    tier: 'Tribunal',
    division: 'Benin',
    state: 'Edo',
    address: 'Tax Appeal Tribunal, South-South Zonal Office, Benin City',
    active: true,
  },
  {
    slug: 'crt_arb_lca',
    name: 'Lagos Court of Arbitration (Panel)',
    tier: 'Arbitration Panel',
    division: 'Lagos',
    state: 'Lagos',
    address: 'Lagos Court of Arbitration, 1A Remi Olowude Street, Lekki, Lagos',
    active: true,
  },
  {
    slug: 'crt_cca_rs',
    name: 'Customary Court of Appeal, Rivers State',
    tier: 'Customary Court',
    division: 'Port Harcourt',
    state: 'Rivers',
    address: 'Customary Court of Appeal, Port Harcourt, Rivers State',
    active: false,
  },
];

export const CASE_TYPES: CaseTypeSeed[] = [
  {
    slug: 'ct_env',
    name: 'Environmental Remediation Dispute',
    description: 'Disputes arising from remediation works, site handover and clean-up standards.',
    category: 'Environmental',
    active: true,
  },
  {
    slug: 'ct_contract',
    name: 'Contract & Procurement Dispute',
    description: 'Breach of contract, procurement award challenges and recovery of advance sums.',
    category: 'Contract',
    active: true,
  },
  {
    slug: 'ct_land',
    name: 'Land, Access & Compensation',
    description: 'Compensation for crops, land access, trespass and title to remediation sites.',
    category: 'Land',
    active: true,
  },
  {
    slug: 'ct_employment',
    name: 'Employment & Labour',
    description: 'Termination, promotion arrears, pensions and trade disputes before the NICN.',
    category: 'Employment',
    active: true,
  },
  {
    slug: 'ct_jr',
    name: 'Judicial Review & Public Law',
    description: 'Certiorari, mandamus and challenges to administrative decisions.',
    category: 'Regulatory',
    active: true,
  },
  {
    slug: 'ct_frea',
    name: 'Fundamental Rights Enforcement',
    description: 'Applications under the Fundamental Rights (Enforcement Procedure) Rules 2009.',
    category: 'Civil',
    active: true,
  },
  {
    slug: 'ct_debt',
    name: 'Debt Recovery & Indemnity',
    description: 'Recovery of sums due, performance bond calls and insurance indemnity claims.',
    category: 'Civil',
    active: true,
  },
  {
    slug: 'ct_regulatory',
    name: 'Regulatory Enforcement',
    description: 'Notices, sanctions and compliance disputes with regulators and agencies.',
    category: 'Regulatory',
    active: true,
  },
  {
    slug: 'ct_criminal',
    name: 'Criminal Prosecution Support',
    description: 'Matters where HYPREP is complainant or nominal party in criminal proceedings.',
    category: 'Criminal',
    active: true,
  },
  {
    slug: 'ct_tax',
    name: 'Tax & Revenue',
    description: 'Assessments, withholding tax disputes and tribunal appeals.',
    category: 'Regulatory',
    active: true,
  },
  {
    slug: 'ct_defamation',
    name: 'Defamation & Reputation',
    description: 'Libel and slander claims affecting the Project or its officers.',
    category: 'Civil',
    active: true,
  },
];

export const DOCUMENT_TYPES: DocumentTypeSeed[] = [
  {
    slug: 'dt_writ',
    name: 'Writ of Summons',
    group: 'Court Process',
    retentionYears: 25,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_soc',
    name: 'Statement of Claim',
    group: 'Court Process',
    retentionYears: 25,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_sod',
    name: 'Statement of Defence',
    group: 'Court Process',
    retentionYears: 25,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_motion',
    name: 'Motion on Notice',
    group: 'Court Process',
    retentionYears: 15,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_affidavit',
    name: 'Affidavit',
    group: 'Court Process',
    retentionYears: 15,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_written_address',
    name: 'Written Address',
    group: 'Court Process',
    retentionYears: 15,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_hearing_notice',
    name: 'Hearing Notice',
    group: 'Court Process',
    retentionYears: 10,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_draft_process',
    name: 'Draft Court Process',
    group: 'Draft',
    retentionYears: 10,
    requiresConfidentiality: true,
    active: true,
  },
  {
    slug: 'dt_legal_opinion',
    name: 'Legal Opinion / Advice',
    group: 'Internal',
    retentionYears: 10,
    requiresConfidentiality: true,
    active: true,
  },
  {
    slug: 'dt_brief',
    name: 'Brief to External Counsel',
    group: 'Internal',
    retentionYears: 10,
    requiresConfidentiality: true,
    active: true,
  },
  {
    slug: 'dt_evidence_photo',
    name: 'Site Photograph',
    group: 'Evidence',
    retentionYears: 25,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_lab_report',
    name: 'Laboratory / Soil Report',
    group: 'Evidence',
    retentionYears: 25,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_contract_doc',
    name: 'Contract / Agreement',
    group: 'Evidence',
    retentionYears: 25,
    requiresConfidentiality: true,
    active: true,
  },
  {
    slug: 'dt_correspondence',
    name: 'Correspondence',
    group: 'Correspondence',
    retentionYears: 10,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_judgment',
    name: 'Judgment / Ruling',
    group: 'Judgment',
    retentionYears: 99,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_enrolled_order',
    name: 'Enrolled Order',
    group: 'Judgment',
    retentionYears: 99,
    requiresConfidentiality: false,
    active: true,
  },
  {
    slug: 'dt_settlement',
    name: 'Terms of Settlement',
    group: 'Judgment',
    retentionYears: 99,
    requiresConfidentiality: true,
    active: true,
  },
];

export const TAGS: TagSeed[] = [
  { slug: 'tag_ogoni', label: 'Ogoniland', color: 'brand' },
  { slug: 'tag_lot4', label: 'Lot 4', color: 'info' },
  { slug: 'tag_lot7', label: 'Lot 7', color: 'info' },
  { slug: 'tag_shoreline', label: 'Shoreline', color: 'info' },
  { slug: 'tag_high_value', label: 'High value', color: 'gold' },
  { slug: 'tag_community', label: 'Community relations', color: 'brand' },
  { slug: 'tag_procurement', label: 'Procurement', color: 'ink' },
  { slug: 'tag_media', label: 'Media sensitive', color: 'danger' },
  { slug: 'tag_appeal', label: 'On appeal', color: 'gold' },
  { slug: 'tag_settlement', label: 'Settlement track', color: 'brand' },
  { slug: 'tag_ministerial', label: 'Ministerial interest', color: 'danger' },
  { slug: 'tag_hr', label: 'HR', color: 'ink' },
  { slug: 'tag_bodo', label: 'Bodo', color: 'info' },
  { slug: 'tag_kdere', label: 'K-Dere', color: 'info' },
];

// ---------------------------------------------------------------------------
// System settings singleton
// ---------------------------------------------------------------------------

/**
 * The shape mirrors the `settings` table in `schema.ts`. Seeded once into a
 * single row; thereafter every value is editable from Admin -> Settings.
 */
export interface SettingsSeed {
  organisationName: string;
  unitName: string;
  dateFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd MMM yyyy';
  timeZone: string;
  currency: 'NGN';
  sessionTimeoutMinutes: number;
  passwordExpiryDays: number;
  passwordMinLength: number;
  passwordRequireComplexity: boolean;
  maxFailedLoginAttempts: number;
  mfaRequiredForRoles: Role[];
  reminderOffsetsHours: number[];
  digestFrequency: 'daily' | 'weekly' | 'off';
  retentionArchiveAfterYears: number;
  storageQuotaGb: number;
  storageUsedGb: number;
  backupSchedule: 'hourly' | 'daily' | 'weekly';
  backupRetentionDays: number;
  watermarkConfidentialDownloads: boolean;
  ocrEnabled: boolean;
  smsEnabled: boolean;
  ssoEnabled: boolean;
  retentionDeletionEnabled: boolean;
}

export const DEFAULT_SETTINGS: SettingsSeed = {
  organisationName: 'Hydrocarbon Pollution Remediation Project (HYPREP)',
  unitName: 'Legal Unit',
  dateFormat: 'dd/MM/yyyy',
  timeZone: 'Africa/Lagos (WAT, UTC+1)',
  currency: 'NGN',
  sessionTimeoutMinutes: 30,
  passwordExpiryDays: 90,
  passwordMinLength: 12,
  passwordRequireComplexity: true,
  maxFailedLoginAttempts: 5,
  mfaRequiredForRoles: ['SUPER_ADMIN', 'ADMIN'],
  reminderOffsetsHours: [168, 72, 24],
  digestFrequency: 'daily',
  retentionArchiveAfterYears: 7,
  storageQuotaGb: 500,
  // Measured by the daily storage-usage cron as the sum of document version
  // sizes. A fresh deployment holds nothing, so it starts at zero - the
  // prototype's 168.4 was part of the fabricated register, not a setting.
  storageUsedGb: 0,
  backupSchedule: 'daily',
  backupRetentionDays: 90,
  watermarkConfidentialDownloads: true,
  ocrEnabled: true,
  smsEnabled: false,
  ssoEnabled: false,
  retentionDeletionEnabled: false,
};
