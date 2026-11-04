/**
 * HYPREP LCMS - the wording of the emails this system sends.
 *
 * Separated from both the sender and the callers because a template is the one
 * part of an email that people who are not developers will want to read and
 * argue about, and because the same message is composed from two places: an
 * administrator pressing "Send password reset" and a user asking for one
 * themselves must not receive two subtly different emails.
 *
 * **Plain text is not the fallback, it is the message.** The HTML part carries the
 * same words with a button around the link. Nigerian government mail clients
 * include ones that strip HTML entirely, and a password reset that arrives as an
 * empty box is a support call, so every template here builds the text first and
 * the markup from it.
 *
 * There is no templating language and no layout engine on purpose. Six messages
 * do not justify a dependency, and the inline styles below are what mail clients
 * actually honour - a stylesheet in a `<head>` is discarded by most of them.
 */

/**
 * The system's name, not the organisation's.
 *
 * `settings.organisationName` is editable and says "HYPREP"; this says what the
 * software is, which does not change when a unit is renamed or the system is
 * adopted elsewhere. Threading the editable name through every template would
 * make each of these functions need a database read to produce a sentence.
 */
const APP_NAME = 'Litigation Case Management System';

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

/** Everything user-supplied that reaches the HTML part goes through this first. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wraps body paragraphs and an optional action button in a shell.
 *
 * A table rather than a flex container, and widths in pixels rather than
 * percentages, because Outlook renders email through Word's layout engine and
 * ignores most of the rest. This is ugly markup that works, not a mistake.
 */
function layout(paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${escapeHtml(line)}</p>`,
    )
    .join('');

  const button =
    action === undefined
      ? ''
      : `<p style="margin:0 0 24px;"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:11px 20px;background:#0f766e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">${escapeHtml(action.label)}</a></p>` +
        // Repeated as text because a button whose href a client has stripped
        // leaves the reader with nothing to act on.
        `<p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#6b7280;">If the button does not work, copy this address into your browser:<br /><span style="color:#0f766e;word-break:break-all;">${escapeHtml(action.url)}</span></p>`;

  return [
    '<div style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:560px;max-width:100%;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;">',
    '<tr><td style="padding:28px 32px;">',
    `<p style="margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0f766e;">${escapeHtml(APP_NAME)}</p>`,
    body,
    button,
    '<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#9ca3af;">This is an automated message from the Litigation Case Management System. Please do not reply to it.</p>',
    '</td></tr></table></div>',
  ].join('');
}

/** Builds both parts from one list of paragraphs, so they cannot drift apart. */
function compose(subject: string, paragraphs: string[], action?: { label: string; url: string }): EmailBody {
  const text = [
    ...paragraphs,
    ...(action === undefined ? [] : [`${action.label}: ${action.url}`]),
    '—',
    `This is an automated message from the ${APP_NAME}. Please do not reply to it.`,
  ].join('\n\n');

  return { subject, text, html: layout(paragraphs, action) };
}

/** The first name, for a greeting - "Dear Adaeze" reads better than the full name. */
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first === undefined || first === '' ? 'colleague' : first;
}

/**
 * A password reset, whether the user asked for it or an administrator sent it.
 *
 * The expiry is stated because a link that has quietly gone stale is the single
 * most common reason a reset "does not work", and the closing line is there
 * because this email is also what a compromise looks like from the victim's
 * inbox: somebody who did not ask for it needs to be told what to do about that.
 */
export function passwordResetEmail(fullName: string, url: string, expiresInMinutes: number): EmailBody {
  return compose(
    'Reset your LCMS password',
    [
      `Dear ${firstName(fullName)},`,
      `A request was made to reset the password on your ${APP_NAME} account. Use the link below to choose a new one.`,
      `The link can be used once and expires in ${expiresInMinutes} minutes. Signing in with a new password will end your other active sessions.`,
      'If you did not request this, you can ignore this email - your password has not changed. Tell your system administrator, though, because it means somebody else entered your address.',
    ],
    { label: 'Choose a new password', url },
  );
}

/**
 * An invitation to an account an administrator has just created.
 *
 * Carries the role because the first question a new user asks is what they are
 * expected to be able to do, and naming the administrator gives them somebody to
 * query if the answer is wrong.
 */
export function invitationEmail(args: {
  fullName: string;
  roleLabel: string;
  invitedBy: string;
  url: string;
  expiresInHours: number;
}): EmailBody {
  return compose(
    `You have been given access to the ${APP_NAME}`,
    [
      `Dear ${firstName(args.fullName)},`,
      `${args.invitedBy} has created an account for you on the ${APP_NAME} as ${args.roleLabel}.`,
      `Set your password using the link below to activate the account. The link expires in ${args.expiresInHours} hours; ask ${args.invitedBy} for a new one if it does.`,
      'You may be asked to enrol an authenticator app the first time you sign in. That is expected, and the system will guide you through it.',
    ],
    { label: 'Set your password', url: args.url },
  );
}
