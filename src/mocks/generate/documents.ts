import type { CaseDocument, CaseRecord, DocumentFormat, DocumentVersion } from '@/types';
import { pick } from '@/lib/utils';
import { DOCUMENT_TYPES } from '@/mocks/data/reference';
import { SITE_NAMES, addDays, chance, daysBetween, intBetween, rngFor } from './helpers';

/** Which document types plausibly exist at each point in a matter's life. */
const BY_STATUS: Record<string, string[]> = {
  Draft: ['dt_draft_process', 'dt_legal_opinion'],
  Filed: ['dt_draft_process', 'dt_writ', 'dt_soc', 'dt_hearing_notice', 'dt_correspondence'],
  Pending: [
    'dt_writ',
    'dt_soc',
    'dt_sod',
    'dt_motion',
    'dt_affidavit',
    'dt_hearing_notice',
    'dt_correspondence',
    'dt_legal_opinion',
  ],
  Adjourned: [
    'dt_writ',
    'dt_soc',
    'dt_sod',
    'dt_motion',
    'dt_affidavit',
    'dt_hearing_notice',
    'dt_correspondence',
  ],
  Heard: [
    'dt_writ',
    'dt_soc',
    'dt_sod',
    'dt_written_address',
    'dt_affidavit',
    'dt_hearing_notice',
    'dt_correspondence',
  ],
  'Judgment Delivered': [
    'dt_writ',
    'dt_soc',
    'dt_sod',
    'dt_written_address',
    'dt_judgment',
    'dt_enrolled_order',
  ],
  Concluded: ['dt_writ', 'dt_soc', 'dt_sod', 'dt_judgment', 'dt_enrolled_order', 'dt_settlement'],
  Closed: ['dt_writ', 'dt_soc', 'dt_judgment', 'dt_settlement', 'dt_correspondence'],
  Archived: ['dt_writ', 'dt_soc', 'dt_judgment', 'dt_enrolled_order'],
};

/** Extra evidence types implied by the matter's subject. */
const BY_CASE_TYPE: Record<string, string[]> = {
  ct_contract: ['dt_contract_doc', 'dt_lab_report'],
  ct_debt: ['dt_contract_doc'],
  ct_env: ['dt_lab_report', 'dt_evidence_photo'],
  ct_land: ['dt_evidence_photo'],
  ct_employment: ['dt_correspondence'],
  ct_criminal: ['dt_evidence_photo'],
  ct_jr: ['dt_contract_doc'],
  ct_tax: ['dt_correspondence'],
};

const FORMAT_BY_TYPE: Record<string, DocumentFormat> = {
  dt_draft_process: 'docx',
  dt_legal_opinion: 'docx',
  dt_brief: 'docx',
  dt_written_address: 'docx',
  dt_evidence_photo: 'jpg',
  dt_correspondence: 'pdf',
  dt_lab_report: 'pdf',
};

/** Realistic size envelopes so the storage figures add up. */
const SIZE_RANGE: Partial<Record<DocumentFormat, [number, number]>> = {
  pdf: [180_000, 4_200_000],
  docx: [46_000, 620_000],
  doc: [58_000, 410_000],
  jpg: [1_400_000, 6_800_000],
  png: [900_000, 3_100_000],
  xlsx: [28_000, 320_000],
  msg: [18_000, 240_000],
};

const VERSION_NOTES = [
  'Initial upload from the registry bundle.',
  'Incorporated the Director’s comments on paragraphs 12–18.',
  'Corrected the suit number and the parties’ description.',
  'Updated the schedule of documents and re-paginated.',
  'Final version settled by external counsel.',
  'Re-scanned pages 4–9 which were illegible in the previous version.',
  'Added the certified true copy of the exhibit.',
];

const OCR_SNIPPETS = [
  'IN THE FEDERAL HIGH COURT OF NIGERIA IN THE PORT HARCOURT JUDICIAL DIVISION HOLDEN AT PORT HARCOURT. BETWEEN: HYDROCARBON POLLUTION REMEDIATION PROJECT (HYPREP) ... CLAIMANT AND ... DEFENDANT. STATEMENT OF CLAIM.',
  'CERTIFICATE OF ANALYSIS. Sample matrix: soil. Parameter: Total Petroleum Hydrocarbons (TPH). Result: 8,412 mg/kg. Intervention value: 5,000 mg/kg. Method: EPA 8015C. Analyst signature on file.',
  'Sampling point SP-07, depth 0.3m. Visible sheen observed on standing water. Photograph taken at 11:42 hours in the presence of the community monitor and the site engineer.',
  'RE: NOTICE OF DEFAULT AND DEMAND FOR REFUND. We act for the Hydrocarbon Pollution Remediation Project and are instructed to demand the immediate refund of the mobilisation sum released to you on the captioned contract.',
];

function documentName(typeName: string, record: CaseRecord, index: number, rng: () => number) {
  const suit = (record.suitNumber ?? record.caseId).replace(/\//g, '-');
  switch (typeName) {
    case 'Site Photograph':
      return `Site Photograph — ${pick(rng, SITE_NAMES)} SP-${String(intBetween(rng, 1, 24)).padStart(2, '0')}`;
    case 'Laboratory / Soil Report':
      return `Certificate of Analysis — ${pick(rng, SITE_NAMES)} (Batch ${intBetween(rng, 100, 899)})`;
    case 'Correspondence':
      return `Letter to ${pick(rng, ['the Defendant’s Solicitors', 'the Chief Registrar', 'external counsel', 'the Project Coordinator'])} — ${index + 1}`;
    case 'Contract / Agreement':
      return `Remediation Works Contract — ${record.caseReference ?? suit}`;
    case 'Hearing Notice':
      return `Hearing Notice — ${suit}`;
    default:
      return `${typeName} — ${suit}`;
  }
}

export function buildDocuments(now: Date, cases: CaseRecord[]): CaseDocument[] {
  const typeById = new Map(DOCUMENT_TYPES.map((type) => [type.id, type]));
  const documents: CaseDocument[] = [];

  cases.forEach((record, caseIndex) => {
    const rng = rngFor('document', caseIndex);
    const pool = [
      ...(BY_STATUS[record.status] ?? []),
      ...(BY_CASE_TYPE[record.caseTypeId] ?? []),
      ...(record.externalCounselIds.length ? ['dt_brief'] : []),
      ...(record.tags.includes('Settlement track') ? ['dt_settlement'] : []),
    ];

    // De-duplicate while keeping the natural filing order.
    const typeIds = [...new Set(pool)];
    const anchor = record.filingDate ?? record.createdAt;
    const ageDays = Math.max(1, daysBetween(anchor, now));

    typeIds.forEach((typeId, index) => {
      const type = typeById.get(typeId);
      if (!type) return;

      const format = FORMAT_BY_TYPE[typeId] ?? 'pdf';
      const [minSize, maxSize] = SIZE_RANGE[format] ?? [120_000, 900_000];
      const uploadedDay = Math.min(ageDays - 1, Math.round((ageDays / (typeIds.length + 1)) * (index + 1)));
      const firstUpload = addDays(anchor, Math.max(0, uploadedDay));

      // Drafts and pleadings iterate; judgments and photographs do not.
      const versionCount =
        type.group === 'Draft' || type.group === 'Court Process'
          ? intBetween(rng, 1, type.group === 'Draft' ? 4 : 2)
          : 1;

      const author = pick(rng, record.assigneeIds.length ? record.assigneeIds : [record.matterOwnerId]);
      const versions: DocumentVersion[] = Array.from({ length: versionCount }, (_, v) => ({
        version: v + 1,
        uploadedById: v === 0 ? author : pick(rng, [...record.assigneeIds, record.matterOwnerId]),
        uploadedAt: addDays(firstUpload, v * intBetween(rng, 2, 9)),
        sizeBytes: intBetween(rng, minSize, maxSize),
        changeNote: v === 0 ? VERSION_NOTES[0]! : pick(rng, VERSION_NOTES.slice(1)),
        storageKey: `s3://hyprep-lcms-docs/${record.id}/${typeId}/v${v + 1}`,
      }));

      const latest = versions[versions.length - 1]!;
      const ocrApplicable = format === 'jpg' || format === 'png' || type.group === 'Evidence';
      const checkedOut = type.group === 'Draft' && chance(rng, 0.35);

      documents.push({
        id: `doc_${record.id.slice(5)}_${String(index + 1).padStart(2, '0')}`,
        caseId: record.id,
        name: documentName(type.name, record, index, rng),
        documentTypeId: typeId,
        format,
        currentVersion: latest.version,
        versions,
        authorId: author,
        confidential: record.confidential || type.requiresConfidentiality,
        tags: record.tags.slice(0, 2),
        description:
          type.group === 'Evidence'
            ? 'Filed as an exhibit to the affidavit in support. Chain of custody recorded on the site log.'
            : type.group === 'Draft'
              ? 'Working draft — not yet filed. Subject to the Head of Unit’s approval.'
              : `${type.name} in respect of ${record.title}.`,
        ocrText: ocrApplicable ? pick(rng, OCR_SNIPPETS) : null,
        ocrStatus: ocrApplicable ? (chance(rng, 0.12) ? 'queued' : 'completed') : 'not_applicable',
        checkedOutById: checkedOut ? author : null,
        checkedOutAt: checkedOut ? addDays(latest.uploadedAt, 1) : null,
        createdAt: versions[0]!.uploadedAt,
        updatedAt: latest.uploadedAt,
      });
    });
  });

  return documents;
}
