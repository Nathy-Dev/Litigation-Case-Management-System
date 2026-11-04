'use node';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';

/**
 * HYPREP LCMS - outbound SMS (TOR section 10's hearing reminders).
 *
 * A hearing reminder is the one message where a phone notification genuinely
 * beats email: counsel on the way to court checks the phone, not the inbox.
 * Like email, this is a thin transactional sender - one message, one honest
 * answer about whether it left - with the provider behind `SMS_PROVIDER`.
 *
 * **Termii is the default** because the register is a Nigerian federal unit and
 * Termii is the local aggregator with a simple HTTPS API. The adapter surface
 * is the same for any provider, so a second one is a new branch in `send`.
 *
 * **Gated.** `settings.smsEnabled` must be true and the provider's env vars set,
 * else the message is refused (and the reminder cron records it as not sent, so
 * the idempotency ledger still advances and nothing double-sends when the
 * feature is switched on later).
 *
 * **Never throws.** A provider outage must not turn a hearing reminder into a
 * failed mutation. Failures are returned and logged; the caller (a cron) decides
 * what to record.
 */

const SEND_TIMEOUT_MS = 15_000;

export interface SmsResult {
  delivered: boolean;
  detail: string;
}

const smsResult = v.object({ delivered: v.boolean(), detail: v.string() });

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

async function sendViaTermii(to: string, text: string): Promise<SmsResult> {
  const apiKey = process.env.TERMII_API_KEY?.trim();
  const from = process.env.TERMII_SENDER_ID?.trim() ?? 'HYPREP LCMS';
  if (!apiKey) return { delivered: false, detail: 'TERMII_API_KEY is not set.' };

  try {
    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        to: to.replace(/^\+?0/, '234'),
        from,
        sms: text,
        type: 'plain',
        channel: 'generic',
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { delivered: false, detail: `Termii refused (${response.status}). ${body}`.trim() };
    }

    const payload = (await response.json().catch(() => null)) as { message_id?: string } | null;
    return { delivered: true, detail: payload?.message_id ? `Termii id ${payload.message_id}` : 'Accepted by Termii.' };
  } catch (error) {
    return { delivered: false, detail: describeError(error) };
  }
}

/**
 * Sends one SMS by whichever provider this deployment is configured for.
 *
 * `SMS_PROVIDER` unset is a deployment with SMS switched off, not a broken one.
 * `settings.smsEnabled` is the runtime switch an administrator flips in Admin ->
 * System; this action is the sending half, reached from the reminder cron.
 */
export const send = internalAction({
  args: {
    to: v.string(),
    text: v.string(),
  },
  returns: smsResult,
  handler: async (_ctx, { to, text }): Promise<SmsResult> => {
    const provider = (process.env.SMS_PROVIDER ?? '').trim().toLowerCase();

    if (provider === '' || provider === 'none') {
      const detail = 'SMS_PROVIDER is not set, so no SMS was sent.';
      console.warn(`[sms] ${detail} Intended recipient ${to}.`);
      return { delivered: false, detail };
    }

    switch (provider) {
      case 'termii':
        return await sendViaTermii(to, text);
      default:
        return {
          delivered: false,
          detail: `SMS_PROVIDER is "${provider}"; expected "termii" or "none".`,
        };
    }
  },
});
