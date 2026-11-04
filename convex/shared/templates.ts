/**
 * HYPREP LCMS - workflow and case templates.
 *
 * Read-only structural configuration, shared verbatim by both halves of the
 * stack: the server instantiates tasks from a workflow template, the client
 * renders the picker that chooses one.
 *
 * Deliberately code, not database rows. Nothing in the application edits these -
 * changing a step means changing its wording and its offset together, which is a
 * code change - so putting them in a table would buy nothing and cost a re-seed
 * on every edit, plus the standing risk of the deployed table drifting from what
 * the source says.
 */
import type { CasePriority, Role } from './enums';

export interface WorkflowTemplateStep {
  id: string;
  title: string;
  description: string;
  /** Days after instantiation that the generated task falls due. */
  offsetDays: number;
  priority: CasePriority;
  defaultOwnerRole: Role;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowTemplateStep[];
}

export interface CaseTemplate {
  id: string;
  name: string;
  description: string;
  caseTypeId: string;
  defaultCourtId: string | null;
  defaultPriority: CasePriority;
  defaultTags: string[];
  checklist: string[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'wf_filing',
    name: 'New matter — filing pack',
    description:
      'Standard steps from instruction to filing of originating process at the registry.',
    steps: [
      {
        id: 'wf_filing_1',
        title: 'Open matter file and assign matter owner',
        description: 'Create the case record, attach instruction memo and confirm matter owner.',
        offsetDays: 1,
        priority: 'High',
        defaultOwnerRole: 'CASE_OFFICER',
      },
      {
        id: 'wf_filing_2',
        title: 'Draft originating process',
        description: 'Prepare writ / originating summons, statement of claim and list of witnesses.',
        offsetDays: 5,
        priority: 'High',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_filing_3',
        title: 'Internal review by Head, Legal Unit',
        description: 'Circulate draft for review and incorporate comments.',
        offsetDays: 8,
        priority: 'Medium',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_filing_4',
        title: 'Pay filing fees and file at registry',
        description: 'Obtain treasury approval, pay assessed fees and file process.',
        offsetDays: 12,
        priority: 'High',
        defaultOwnerRole: 'CASE_OFFICER',
      },
      {
        id: 'wf_filing_5',
        title: 'Upload filed copies and diarise first return date',
        description: 'Scan sealed copies, upload to the matter file and schedule the return date.',
        offsetDays: 14,
        priority: 'Medium',
        defaultOwnerRole: 'CASE_OFFICER',
      },
    ],
  },
  {
    id: 'wf_service',
    name: 'Service of process',
    description: 'Effecting and proving service on defendants and interested parties.',
    steps: [
      {
        id: 'wf_service_1',
        title: 'Prepare service bundle per defendant',
        description: 'Collate sealed process copies for each defendant.',
        offsetDays: 2,
        priority: 'Medium',
        defaultOwnerRole: 'CASE_OFFICER',
      },
      {
        id: 'wf_service_2',
        title: 'Instruct bailiff / process server',
        description: 'Issue instructions and confirm addresses for service.',
        offsetDays: 4,
        priority: 'High',
        defaultOwnerRole: 'CASE_OFFICER',
      },
      {
        id: 'wf_service_3',
        title: 'Obtain affidavit of service',
        description: 'Collect and file proof of service ahead of the return date.',
        offsetDays: 10,
        priority: 'High',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
    ],
  },
  {
    id: 'wf_judgment',
    name: 'Judgment enforcement',
    description: 'Steps following delivery of a favourable judgment.',
    steps: [
      {
        id: 'wf_judgment_1',
        title: 'Obtain certified true copy of judgment',
        description: 'Apply to the registry for CTC and enrolled order.',
        offsetDays: 5,
        priority: 'High',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_judgment_2',
        title: 'Serve judgment and demand compliance',
        description: 'Serve the enrolled order with a letter of demand.',
        offsetDays: 12,
        priority: 'High',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_judgment_3',
        title: 'Apply for writ of execution / garnishee',
        description: 'Where compliance is refused, commence execution proceedings.',
        offsetDays: 30,
        priority: 'Medium',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_judgment_4',
        title: 'Report recovery to Finance',
        description: 'Notify Finance & Accounts of sums recovered for treasury records.',
        offsetDays: 45,
        priority: 'Low',
        defaultOwnerRole: 'CASE_OFFICER',
      },
    ],
  },
  {
    id: 'wf_appeal',
    name: 'Appeal preparation',
    description: 'Time-critical steps for filing a notice of appeal within the statutory window.',
    steps: [
      {
        id: 'wf_appeal_1',
        title: 'Advise on merits of appeal',
        description: 'Prepare an opinion on appealable grounds and prospects.',
        offsetDays: 4,
        priority: 'Critical',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_appeal_2',
        title: 'Obtain records of proceedings',
        description: 'Apply for the certified record of proceedings from the lower court.',
        offsetDays: 10,
        priority: 'High',
        defaultOwnerRole: 'CASE_OFFICER',
      },
      {
        id: 'wf_appeal_3',
        title: 'File notice of appeal',
        description: 'File within the statutory period and serve on the respondent.',
        offsetDays: 14,
        priority: 'Critical',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
      {
        id: 'wf_appeal_4',
        title: 'Compile and transmit record of appeal',
        description: 'Compile the record and transmit to the appellate registry.',
        offsetDays: 45,
        priority: 'High',
        defaultOwnerRole: 'LEGAL_STAFF',
      },
    ],
  },
];

export const CASE_TEMPLATES: CaseTemplate[] = [
  {
    id: 'tpl_contract_breach',
    name: 'Remediation contractor — breach of contract',
    description:
      'For matters against remediation contractors for defective works or abandonment of site.',
    caseTypeId: 'ct_contract',
    defaultCourtId: 'crt_fhc_ph',
    defaultPriority: 'High',
    defaultTags: ['Ogoniland', 'Procurement'],
    checklist: [
      'Attach executed contract and all variation orders',
      'Obtain site inspection report from Project Coordination Office',
      'Confirm performance bond status with Finance',
      'Compute liquidated damages to date',
    ],
  },
  {
    id: 'tpl_community_compensation',
    name: 'Community compensation claim',
    description: 'For crop, land access and livelihood compensation claims by host communities.',
    caseTypeId: 'ct_land',
    defaultCourtId: 'crt_rshc_bori',
    defaultPriority: 'High',
    defaultTags: ['Ogoniland', 'Community relations'],
    checklist: [
      'Obtain enumeration and valuation schedule',
      'Verify claimants against community register',
      'Engage Community Liaison Office on settlement window',
      'Confirm whether matter is covered by an existing global settlement',
    ],
  },
  {
    id: 'tpl_employment',
    name: 'Employment claim (NICN)',
    description: 'For termination, promotion and entitlement claims before the Industrial Court.',
    caseTypeId: 'ct_employment',
    defaultCourtId: 'crt_nicn_ph',
    defaultPriority: 'Medium',
    defaultTags: ['HR'],
    checklist: [
      'Request personnel file from Human Resources',
      'Obtain query and disciplinary panel records',
      'Confirm applicable conditions of service edition',
      'Compute terminal benefits exposure',
    ],
  },
  {
    id: 'tpl_judicial_review',
    name: 'Procurement award challenge',
    description: 'For judicial review of procurement decisions and administrative actions.',
    caseTypeId: 'ct_jr',
    defaultCourtId: 'crt_fhc_abj',
    defaultPriority: 'Critical',
    defaultTags: ['Procurement', 'Ministerial interest'],
    checklist: [
      'Obtain full procurement file and evaluation report',
      'Confirm BPP no-objection certificate',
      'Prepare chronology of the procurement process',
      'Consider counter-affidavit timeline (statutory)',
    ],
  },
];
