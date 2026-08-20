import type { CaseFilters } from '@/lib/selectors/cases';
import { useDataStore } from '@/store/dataStore';
import { Drawer } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Input';
import { FilterMenu } from '@/components/ui/FilterMenu';

const CLAIM_FLOORS = [
  { value: '', label: 'Any value' },
  { value: '1000000', label: 'Above ₦1m' },
  { value: '50000000', label: 'Above ₦50m' },
  { value: '250000000', label: 'Above ₦250m' },
  { value: '1000000000', label: 'Above ₦1bn' },
];

/** Everything that doesn't fit the facet row (TOR §32 advanced filtering). */
export function CaseAdvancedFilters({
  open,
  onClose,
  filters,
  onChange,
  onReset,
  resultCount,
}: {
  open: boolean;
  onClose: () => void;
  filters: CaseFilters;
  onChange: (patch: Partial<CaseFilters>) => void;
  onReset: () => void;
  resultCount: number;
}) {
  const tags = useDataStore((state) => state.tags);
  const teams = useDataStore((state) => state.teams);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Advanced filters"
      description="Combine any number of criteria. The register updates as you go."
      footer={
        <>
          <Button variant="ghost" onClick={onReset}>
            Reset all
          </Button>
          <Button variant="primary" onClick={onClose}>
            Show {resultCount} {resultCount === 1 ? 'matter' : 'matters'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Filed from">
            {(props) => (
              <Input
                type="date"
                value={filters.filedFrom ?? ''}
                onChange={(event) => onChange({ filedFrom: event.target.value || null })}
                {...props}
              />
            )}
          </Field>
          <Field label="Filed to">
            {(props) => (
              <Input
                type="date"
                value={filters.filedTo ?? ''}
                onChange={(event) => onChange({ filedTo: event.target.value || null })}
                {...props}
              />
            )}
          </Field>
        </div>

        <Field label="Claim value" hint="Filters on the sum claimed, where one is pleaded.">
          {(props) => (
            <Select
              value={filters.minClaimValue ? String(filters.minClaimValue) : ''}
              onChange={(event) =>
                onChange({ minClaimValue: event.target.value ? Number(event.target.value) : null })
              }
              {...props}
            >
              {CLAIM_FLOORS.map((floor) => (
                <option key={floor.value} value={floor.value}>
                  {floor.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Next sitting within" hint="Leave unset to include matters with no date fixed.">
          {(props) => (
            <Select
              value={filters.hearingWithinDays == null ? '' : String(filters.hearingWithinDays)}
              onChange={(event) =>
                onChange({
                  hearingWithinDays: event.target.value ? Number(event.target.value) : null,
                })
              }
              {...props}
            >
              <option value="">Any time</option>
              <option value="1">Tomorrow</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </Select>
          )}
        </Field>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-800">Tags</p>
          <FilterMenu
            label={filters.tags?.length ? `${filters.tags.length} tags` : 'Choose tags'}
            searchable
            width="w-72"
            options={tags.map((tag) => ({ value: tag.label, label: tag.label }))}
            selected={filters.tags ?? []}
            onChange={(values) => onChange({ tags: values })}
          />
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-800">Team</p>
          <FilterMenu
            label={filters.teamIds?.length ? `${filters.teamIds.length} teams` : 'Choose teams'}
            width="w-72"
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            selected={filters.teamIds ?? []}
            onChange={(teamIds) => onChange({ teamIds })}
          />
        </div>

        <div className="space-y-2 border-t border-ink-100 pt-4">
          <Checkbox
            checked={Boolean(filters.confidentialOnly)}
            onChange={(event) => onChange({ confidentialOnly: event.target.checked })}
            label="Confidential matters only"
            description="Restricted files you have been named on."
          />
          <Checkbox
            checked={Boolean(filters.includeArchived)}
            onChange={(event) => onChange({ includeArchived: event.target.checked })}
            label="Include archived matters"
            description="Archived files are hidden from the register by default."
          />
        </div>
      </div>
    </Drawer>
  );
}
