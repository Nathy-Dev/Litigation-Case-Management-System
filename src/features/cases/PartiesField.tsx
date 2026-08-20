import { useFieldArray, type Control, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { PARTY_ROLES, PARTY_TYPES, type CaseFormInput } from './caseFormSchema';

/**
 * Repeating party rows (TOR §7). A matter is meaningless without at least a
 * claimant and a respondent, so the schema enforces two.
 */
export function PartiesField({
  control,
  register,
  errors,
}: {
  control: Control<CaseFormInput>;
  register: UseFormRegister<CaseFormInput>;
  errors: FieldErrors<CaseFormInput>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: 'parties' });

  return (
    <div className="space-y-3">
      {typeof errors.parties?.message === 'string' && (
        <p role="alert" className="text-[12px] font-medium text-danger-600">
          {errors.parties.message}
        </p>
      )}

      {fields.map((field, index) => {
        const rowErrors = errors.parties?.[index];
        return (
          <div key={field.id} className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                <Users className="size-3.5" aria-hidden />
                Party {index + 1}
              </p>
              {fields.length > 2 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(index)}
                  aria-label={`Remove party ${index + 1}`}
                  icon={<Trash2 className="size-4" aria-hidden />}
                />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required error={rowErrors?.name?.message}>
                {(props) => (
                  <Input
                    placeholder="e.g. Bodo Community Development Association"
                    {...register(`parties.${index}.name`)}
                    {...props}
                  />
                )}
              </Field>
              <Field label="Role" required>
                {(props) => (
                  <Select {...register(`parties.${index}.role`)} {...props}>
                    {PARTY_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Party type">
                {(props) => (
                  <Select {...register(`parties.${index}.type`)} {...props}>
                    {PARTY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Represented by" hint="Counsel on record, if known.">
                {(props) => (
                  <Input
                    placeholder="e.g. Chidi & Associates"
                    {...register(`parties.${index}.representedBy`)}
                    {...props}
                  />
                )}
              </Field>
              <Field label="E-mail" error={rowErrors?.email?.message}>
                {(props) => (
                  <Input type="email" {...register(`parties.${index}.email`)} {...props} />
                )}
              </Field>
              <Field label="Phone">
                {(props) => (
                  <Input placeholder="+234 803 000 0000" {...register(`parties.${index}.phone`)} {...props} />
                )}
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Address">
                {(props) => <Input {...register(`parties.${index}.address`)} {...props} />}
              </Field>
            </div>
          </div>
        );
      })}

      <Button
        onClick={() =>
          append({
            name: '',
            role: 'Defendant',
            type: 'Corporate',
            email: '',
            phone: '',
            address: '',
            representedBy: '',
          })
        }
        icon={<Plus className="size-4" aria-hidden />}
      >
        Add party
      </Button>
    </div>
  );
}
