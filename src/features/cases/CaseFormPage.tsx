import { useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save, ShieldAlert } from 'lucide-react';
import { CASE_PRIORITIES, CASE_STATUSES } from '@/types';
import { formatNaira, toDateInputValue } from '@/lib/format';
import { useDataStore } from '@/store/dataStore';
import { useCurrentUser } from '@/store/authStore';
import { notify } from '@/store/uiStore';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterMenu } from '@/components/ui/FilterMenu';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/Input';
import { PartiesField } from './PartiesField';
import { caseFormSchema, type CaseFormInput, type CaseFormValues } from './caseFormSchema';

const BLANK: CaseFormInput = {
  title: '',
  caseReference: '',
  suitNumber: '',
  courtId: '',
  presidingJudge: '',
  caseTypeId: '',
  status: 'Draft',
  priority: 'Medium',
  filingDate: '',
  claimValue: '',
  matterOwnerId: '',
  assigneeIds: [],
  externalCounselIds: [],
  teamId: '',
  parties: [
    { name: '', role: 'Claimant', type: 'Community', email: '', phone: '', address: '', representedBy: '' },
    { name: '', role: 'Respondent', type: 'Corporate', email: '', phone: '', address: '', representedBy: '' },
  ],
  tags: [],
  confidential: false,
  restrictedToUserIds: [],
  summary: '',
  reliefSought: '',
};

/** Create or edit a matter (TOR §7–8). One form, two modes. */
export function CaseFormPage() {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const cases = useDataStore((state) => state.cases);
  const courts = useDataStore((state) => state.courts);
  const caseTypes = useDataStore((state) => state.caseTypes);
  const users = useDataStore((state) => state.users);
  const teams = useDataStore((state) => state.teams);
  const tagDefs = useDataStore((state) => state.tags);
  const createCase = useDataStore((state) => state.createCase);
  const updateCase = useDataStore((state) => state.updateCase);
  const user = useCurrentUser();

  const existing = caseId ? cases.find((item) => item.id === caseId) : undefined;
  const editing = Boolean(caseId);

  const defaults = useMemo<CaseFormInput>(() => {
    if (!existing) return { ...BLANK, matterOwnerId: user?.id ?? '' };
    return {
      title: existing.title,
      caseReference: existing.caseReference ?? '',
      suitNumber: existing.suitNumber ?? '',
      courtId: existing.courtId,
      presidingJudge: existing.presidingJudge ?? '',
      caseTypeId: existing.caseTypeId,
      status: existing.status,
      priority: existing.priority,
      filingDate: toDateInputValue(existing.filingDate),
      claimValue: existing.claimValue === null ? '' : String(existing.claimValue),
      matterOwnerId: existing.matterOwnerId,
      assigneeIds: existing.assigneeIds,
      externalCounselIds: existing.externalCounselIds,
      teamId: existing.teamId ?? '',
      parties: existing.parties.map((party) => ({
        id: party.id,
        name: party.name,
        role: party.role,
        type: party.type,
        email: party.email ?? '',
        phone: party.phone ?? '',
        address: party.address ?? '',
        representedBy: party.representedBy ?? '',
      })),
      tags: existing.tags,
      confidential: existing.confidential,
      restrictedToUserIds: existing.restrictedToUserIds,
      summary: existing.summary,
      reliefSought: existing.reliefSought,
    };
  }, [existing, user?.id]);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CaseFormInput, unknown, CaseFormValues>({
    resolver: zodResolver(caseFormSchema),
    defaultValues: defaults,
  });

  const staff = users.filter(
    (item) => item.status === 'active' && ['LEGAL_STAFF', 'CASE_OFFICER', 'ADMIN', 'SUPER_ADMIN'].includes(item.role),
  );
  const counsel = users.filter((item) => item.role === 'EXTERNAL_COUNSEL' && item.status === 'active');

  const confidential = watch('confidential');
  const claimValue = watch('claimValue');

  if (editing && !existing) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" aria-hidden />}
        title="Matter not found"
        description="It may have been archived, or it is outside your access."
        action={<Link to="/cases"><Button variant="primary">Back to the register</Button></Link>}
      />
    );
  }

  const onSubmit = (values: CaseFormValues) => {
    const actorId = user?.id ?? 'system';
    const payload = {
      title: values.title.trim(),
      caseReference: values.caseReference || null,
      suitNumber: values.suitNumber || null,
      courtId: values.courtId,
      caseTypeId: values.caseTypeId,
      status: values.status,
      priority: values.priority,
      filingDate: values.filingDate ? new Date(values.filingDate).toISOString() : null,
      claimValue: values.claimValue === '' ? null : Number(values.claimValue),
      matterOwnerId: values.matterOwnerId,
      assigneeIds: values.assigneeIds,
      externalCounselIds: values.externalCounselIds,
      teamId: values.teamId || null,
      presidingJudge: values.presidingJudge || null,
      parties: values.parties.map((party, index) => ({
        id: party.id ?? `pty_${index}_${values.title.length}`,
        name: party.name.trim(),
        role: party.role,
        type: party.type,
        email: party.email || null,
        phone: party.phone || null,
        address: party.address || null,
        representedBy: party.representedBy || null,
      })),
      tags: values.tags,
      confidential: values.confidential,
      restrictedToUserIds: values.confidential ? values.restrictedToUserIds : [],
      summary: values.summary.trim(),
      reliefSought: values.reliefSought ?? '',
    };

    if (existing) {
      updateCase(existing.id, payload, actorId);
      notify({ variant: 'success', title: 'Matter updated', description: existing.caseId });
      navigate(`/cases/${existing.id}`);
    } else {
      const created = createCase(payload, actorId);
      notify({
        variant: 'success',
        title: 'Matter opened',
        description: `${created.caseId} has been added to the register.`,
      });
      navigate(`/cases/${created.id}`);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <PageHeader
        crumbs={[
          { label: 'Cases', to: '/cases' },
          ...(existing ? [{ label: existing.caseId, to: `/cases/${existing.id}` }] : []),
          { label: existing ? 'Edit' : 'New matter' },
        ]}
        title={existing ? `Edit ${existing.caseId}` : 'Open a new matter'}
        description={
          existing
            ? 'Changes are written to the audit trail with your name and the time.'
            : 'A case ID is generated automatically once the matter is saved.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate(existing ? `/cases/${existing.id}` : '/cases')}
              icon={<ArrowLeft className="size-4" aria-hidden />}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
              icon={<Save className="size-4" aria-hidden />}
            >
              {existing ? 'Save changes' : 'Open matter'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader title="The matter" description="How the case appears throughout the register." />
            <CardBody className="space-y-4">
              <Field label="Case title" required error={errors.title?.message}>
                {(props) => (
                  <Input
                    placeholder="e.g. Bodo Community v. HYPREP — challenge to remediation contract award"
                    {...register('title')}
                    {...props}
                  />
                )}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Case type" required error={errors.caseTypeId?.message}>
                  {(props) => (
                    <Select {...register('caseTypeId')} {...props}>
                      <option value="">Select a case type…</option>
                      {caseTypes
                        .filter((type) => type.active)
                        .map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                <Field label="Internal reference" hint="Optional file reference kept by the unit.">
                  {(props) => <Input placeholder="LU/2026/031" {...register('caseReference')} {...props} />}
                </Field>
              </div>

              <Field
                label="Summary"
                required
                error={errors.summary?.message}
                hint="Two or three sentences — this appears on reports and in search results."
              >
                {(props) => <Textarea rows={4} {...register('summary')} {...props} />}
              </Field>

              <Field label="Relief sought" hint="What the claimant is asking the court to order.">
                {(props) => <Textarea rows={3} {...register('reliefSought')} {...props} />}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Court & filing" description="Registry details as filed." />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Court" required error={errors.courtId?.message}>
                  {(props) => (
                    <Select {...register('courtId')} {...props}>
                      <option value="">Select a court…</option>
                      {courts
                        .filter((court) => court.active)
                        .map((court) => (
                          <option key={court.id} value={court.id}>
                            {court.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                <Field label="Presiding judge">
                  {(props) => (
                    <Input placeholder="Hon. Justice A. B. Nwosu" {...register('presidingJudge')} {...props} />
                  )}
                </Field>
                <Field label="Suit number" error={errors.suitNumber?.message} hint="As issued by the registry.">
                  {(props) => <Input placeholder="FHC/PH/CS/119/2026" {...register('suitNumber')} {...props} />}
                </Field>
                <Field label="Filing date" error={errors.filingDate?.message}>
                  {(props) => <Input type="date" {...register('filingDate')} {...props} />}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Status" required>
                  {(props) => (
                    <Select {...register('status')} {...props}>
                      {CASE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Priority" required>
                  {(props) => (
                    <Select {...register('priority')} {...props}>
                      {CASE_PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label="Sum claimed (₦)"
                  error={errors.claimValue?.message}
                  hint={
                    claimValue
                      ? formatNaira(Number(claimValue))
                      : 'Leave blank where no sum is claimed.'
                  }
                >
                  {(props) => (
                    <Input type="number" min={0} step={1000} {...register('claimValue')} {...props} />
                  )}
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Parties" description="At least two — the schema will not accept fewer." />
            <CardBody>
              <PartiesField control={control} register={register} errors={errors} />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Conduct of the matter" />
            <CardBody className="space-y-4">
              <Field
                label="Matter owner"
                required
                // The designation is shown under the control rather than appended
                // to the name, which the select is too narrow to display in full.
                hint={staff.find((item) => item.id === watch('matterOwnerId'))?.title}
                error={errors.matterOwnerId?.message}
              >
                {(props) => (
                  <Select {...register('matterOwnerId')} {...props}>
                    <option value="">Select a lawyer…</option>
                    {staff.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.fullName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <div>
                <p className="mb-1.5 text-[12px] font-semibold text-ink-700">Supporting staff</p>
                <FilterMenu
                  label="Assign staff"
                  searchable
                  width="w-72"
                  align="left"
                  options={staff.map((item) => ({ value: item.id, label: item.fullName }))}
                  selected={watch('assigneeIds')}
                  onChange={(next) => setValue('assigneeIds', next, { shouldDirty: true })}
                />
              </div>

              <div>
                <p className="mb-1.5 text-[12px] font-semibold text-ink-700">External counsel</p>
                <FilterMenu
                  label="Brief counsel"
                  searchable
                  width="w-72"
                  align="left"
                  options={counsel.map((item) => ({
                    value: item.id,
                    label: `${item.fullName}${item.firm ? ` — ${item.firm}` : ''}`,
                  }))}
                  selected={watch('externalCounselIds')}
                  onChange={(next) => setValue('externalCounselIds', next, { shouldDirty: true })}
                />
              </div>

              <Field label="Team">
                {(props) => (
                  <Select {...register('teamId')} {...props}>
                    <option value="">No team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Classification & access" />
            <CardBody className="space-y-4">
              <div>
                <p className="mb-1.5 text-[12px] font-semibold text-ink-700">Tags</p>
                <FilterMenu
                  label="Add tags"
                  searchable
                  width="w-72"
                  align="left"
                  options={tagDefs.map((tag) => ({ value: tag.label, label: tag.label }))}
                  selected={watch('tags')}
                  onChange={(next) => setValue('tags', next, { shouldDirty: true })}
                />
              </div>

              <Checkbox
                {...register('confidential')}
                label="Confidential matter"
                description="Downloads are watermarked and every view is written to the audit trail."
              />

              {confidential && (
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold text-ink-700">Restrict access to</p>
                  <FilterMenu
                    label="Named users only"
                    searchable
                    width="w-72"
                    align="left"
                    options={[...staff, ...counsel].map((item) => ({
                      value: item.id,
                      label: item.fullName,
                    }))}
                    selected={watch('restrictedToUserIds')}
                    onChange={(next) => setValue('restrictedToUserIds', next, { shouldDirty: true })}
                  />
                  {errors.restrictedToUserIds?.message && (
                    <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger-600">
                      {errors.restrictedToUserIds.message}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    Leave empty to keep the matter visible to everyone with confidential access.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </form>
  );
}
