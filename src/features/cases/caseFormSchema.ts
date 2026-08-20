import { z } from 'zod';
import { CASE_PRIORITIES, CASE_STATUSES } from '@/types';
import type { PartyRole } from '@/types';

export const PARTY_ROLES = [
  'Plaintiff',
  'Defendant',
  'Claimant',
  'Respondent',
  'Appellant',
  'Applicant',
  'Interested Party',
  'Nominal Party',
] as const satisfies readonly PartyRole[];

export const PARTY_TYPES = ['Individual', 'Corporate', 'Government', 'Community'] as const;

/** Suit numbers follow registry conventions, e.g. FHC/PH/CS/119/2026. */
const SUIT_NUMBER = /^[A-Z]{2,6}(\/[A-Z0-9.]{1,8}){1,3}\/\d{1,5}\/\d{4}$/;

export const partySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, 'Enter the party’s name.'),
  role: z.enum(PARTY_ROLES),
  type: z.enum(PARTY_TYPES),
  email: z
    .string()
    .trim()
    .email('Enter a valid e-mail address.')
    .optional()
    .or(z.literal('')),
  phone: z.string().trim().optional().or(z.literal('')),
  address: z.string().trim().optional().or(z.literal('')),
  representedBy: z.string().trim().optional().or(z.literal('')),
});

export const caseFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(8, 'Give the matter a descriptive title of at least 8 characters.')
      .max(180, 'Keep the title under 180 characters.'),
    caseReference: z.string().trim().max(40).optional().or(z.literal('')),
    suitNumber: z
      .string()
      .trim()
      .regex(SUIT_NUMBER, 'Use the registry format, e.g. FHC/PH/CS/119/2026.')
      .optional()
      .or(z.literal('')),
    courtId: z.string().min(1, 'Select the court.'),
    presidingJudge: z.string().trim().max(120).optional().or(z.literal('')),
    caseTypeId: z.string().min(1, 'Select the case type.'),
    status: z.enum(CASE_STATUSES),
    priority: z.enum(CASE_PRIORITIES),
    filingDate: z.string().optional().or(z.literal('')),
    claimValue: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || (!Number.isNaN(Number(value)) && Number(value) >= 0),
        'Enter the sum claimed as a positive amount in Naira.',
      ),
    matterOwnerId: z.string().min(1, 'Assign a matter owner.'),
    assigneeIds: z.array(z.string()),
    externalCounselIds: z.array(z.string()),
    teamId: z.string().optional().or(z.literal('')),
    parties: z.array(partySchema).min(2, 'A matter needs at least two parties.'),
    tags: z.array(z.string()),
    confidential: z.boolean(),
    restrictedToUserIds: z.array(z.string()),
    summary: z
      .string()
      .trim()
      .min(20, 'Summarise the matter in at least 20 characters — it appears on every report.'),
    reliefSought: z.string().trim().optional().or(z.literal('')),
  })
  .refine((value) => value.status === 'Draft' || Boolean(value.filingDate), {
    path: ['filingDate'],
    message: 'A filed matter needs a filing date.',
  })
  .refine((value) => value.status === 'Draft' || Boolean(value.suitNumber), {
    path: ['suitNumber'],
    message: 'A filed matter needs the suit number from the registry.',
  })
  .refine(
    (value) =>
      !value.confidential ||
      value.restrictedToUserIds.length === 0 ||
      value.restrictedToUserIds.includes(value.matterOwnerId),
    {
      path: ['restrictedToUserIds'],
      message: 'The matter owner must be on the access list.',
    },
  );

/**
 * The shape the inputs hold (all strings) and the shape validation produces.
 * react-hook-form needs both: the first for `register`, the second for submit.
 */
export type CaseFormInput = z.input<typeof caseFormSchema>;
export type CaseFormValues = z.output<typeof caseFormSchema>;
