import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

/**
 * The reference bundle: every dropdown, filter, team and settings value the UI
 * reads, in one reactive subscription.
 *
 * `bundle` is an `authedQuery`, so this returns `undefined` while it loads and
 * throws for an unauthenticated caller - meaning it is only meaningful inside
 * the authenticated tree, which is where forms and filters live.
 */
export function useReferenceData() {
  return useQuery(api.reference.bundle);
}