import type { CaseNote, CaseRecord, CaseStatus, CaseStatusChange } from '@/types';
import { pick } from '@/lib/utils';
import { addDays, at, chance, daysBetween, intBetween, rngFor } from './helpers';

/**
 * The canonical status ladder. A matter's history is the prefix of this ladder
 * up to its current status, which keeps the timeline internally consistent.
 */
const LADDER: CaseStatus[] = [
  'Draft',
  'Filed',
  'Pending',
  'Adjourned',
  'Heard',
  'Judgment Delivered',
  'Concluded',
  'Closed',
  'Archived',
];

const REASONS: Record<CaseStatus, string> = {
  Draft: 'Matter opened on the register pending settlement of the originating process.',
  Filed: 'Originating process filed at the registry and filing fees receipted.',
  Pending: 'Service effected on all defendants; matter now pending before the court.',
  Adjourned: 'Matter adjourned in open court on the application of counsel.',
  Heard: 'Hearing concluded and final written addresses adopted.',
  'Judgment Delivered': 'Judgment delivered by the court; certified true copy applied for.',
  Concluded: 'All reliefs and consequential orders disposed of.',
  Closed: 'File closed — no further steps required and cost orders satisfied.',
  Archived: 'Archived under the retention policy for concluded matters.',
};

const NOTE_BODIES = [
  'Spoke with the registry today. The court’s record of proceedings for the last adjournment is still not typed; the Assistant Registrar has promised it by the end of the week.',
  'Defendant’s counsel indicated a willingness to explore settlement. Advised that any proposal must be reduced into writing and routed through the Head of Unit before we respond.',
  'Note for the file: the community monitor confirmed that the sampling exercise was witnessed. His written statement should be obtained while his recollection is fresh.',
  'The Director has asked to be copied on every process filed in this matter given the level of press interest. Diarised accordingly.',
  'Confirmed that the exhibits tendered at the last hearing were properly marked. Certified true copies applied for and receipt is on the file.',
  'External counsel’s fee note received. Forwarded to Finance with the Unit’s recommendation for payment on the agreed scale.',
  'Site visit undertaken with the project engineer. The access corridor in dispute is clearly outside the surveyed boundary shown on the plan attached to the contract.',
  'Cause list checked this morning — our matter is serial 14. Counsel briefed to be in court by 8:30 a.m.',
  'Instruction from the Project Coordination Office: no admission of liability is to be made pending conclusion of the internal review.',
  'The claimant’s valuation appears to double-count the economic trees already enumerated in the 2024 exercise. Flagged for our expert to address in his report.',
  'Reminder that the time to file our reply expires next week. The draft is with the matter owner for settlement.',
  'Met the community leadership at the Project office. They have agreed to hold off further protest pending the next hearing.',
];

export function buildStatusChanges(now: Date, cases: CaseRecord[]): CaseStatusChange[] {
  const changes: CaseStatusChange[] = [];

  cases.forEach((record, caseIndex) => {
    const rng = rngFor('status', caseIndex);
    const target = LADDER.indexOf(record.status);
    if (target < 0) return;

    const anchor = record.filingDate ?? record.createdAt;
    const span = Math.max(2, daysBetween(anchor, now) - 2);
    const steps = target + 1;

    for (let i = 0; i < steps; i += 1) {
      const to = LADDER[i]!;
      const from = i === 0 ? null : LADDER[i - 1]!;
      const dayOffset = i === 0 ? -3 : Math.round((span / steps) * i);

      changes.push({
        id: `sc_${record.id.slice(5)}_${i + 1}`,
        caseId: record.id,
        from,
        to,
        reason: REASONS[to],
        byUserId: i === 0 ? record.createdById : pick(rng, [record.matterOwnerId, ...record.assigneeIds]),
        at: addDays(anchor, dayOffset),
      });
    }
  });

  return changes.sort((a, b) => a.at.localeCompare(b.at));
}

export function buildNotes(now: Date, cases: CaseRecord[]): CaseNote[] {
  const notes: CaseNote[] = [];

  cases.forEach((record, caseIndex) => {
    const rng = rngFor('note', caseIndex);
    const count = record.status === 'Draft' ? 1 : intBetween(rng, 1, 4);
    const authors = record.assigneeIds.length ? record.assigneeIds : [record.matterOwnerId];

    for (let i = 0; i < count; i += 1) {
      const author = pick(rng, authors);
      const others = authors.filter((id) => id !== author);
      notes.push({
        id: `nte_${record.id.slice(5)}_${i + 1}`,
        caseId: record.id,
        body: NOTE_BODIES[(caseIndex * 3 + i) % NOTE_BODIES.length]!,
        authorId: author,
        createdAt: at(now, -intBetween(rng, 1, 120), intBetween(rng, 9, 17), pick(rng, [0, 15, 30, 45])),
        internalOnly: chance(rng, 0.4),
        mentions: others.length && chance(rng, 0.3) ? [pick(rng, others)] : [],
      });
    }
  });

  return notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
