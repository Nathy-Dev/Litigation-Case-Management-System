import type { Doc } from '../_generated/dataModel';
import { DEFAULT_SETTINGS } from '../seed/reference';

/**
 * HYPREP LCMS - the password rule, in one place.
 *
 * `settings.passwordMinLength` and `settings.passwordRequireComplexity` are
 * administrator-editable (TOR section 19), and the same rule has to be applied in
 * two places: the profile screen validates before submitting so the user gets an
 * inline message, and the server enforces it because client validation is a
 * courtesy rather than a control.
 *
 * Two copies of a regex is how those two drift - the server tightens, the form
 * still accepts, and the user gets an opaque rejection. So both import this.
 *
 * It lives under `convex/shared` because that directory is aliased to `@shared`
 * in the Vite build as well as the Convex one, and it stays free of Convex
 * imports beyond the settings type for the same reason.
 */

export interface PasswordPolicy {
  minLength: number;
  requireComplexity: boolean;
}

/** Upper case, lower case, digit, symbol. */
const COMPLEXITY = /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/;

/**
 * The policy in force, with the fallback a fresh deployment needs.
 *
 * Before the seed has run there is no settings row, and the alternative to a
 * fallback would be either accepting any password or refusing every password -
 * the first is a hole, the second bricks the bootstrap. The shipped defaults are
 * the right answer to both.
 */
export function policyFrom(settings: Doc<'settings'> | null): PasswordPolicy {
  return {
    minLength: settings?.passwordMinLength ?? DEFAULT_SETTINGS.passwordMinLength,
    requireComplexity: settings?.passwordRequireComplexity ?? DEFAULT_SETTINGS.passwordRequireComplexity,
  };
}

/** The reason the password is unacceptable, or `null` if it is fine. */
export function checkPassword(password: string, policy: PasswordPolicy): string | null {
  if (password.length < policy.minLength) {
    return `Use at least ${policy.minLength} characters.`;
  }
  if (policy.requireComplexity && !COMPLEXITY.test(password)) {
    return 'Include an upper case letter, a lower case letter, a digit and a symbol.';
  }
  return null;
}
