import { useMemo } from 'react';
import { History } from 'lucide-react';
import { selectCaseTimeline } from '@/lib/selectors/search';
import { useDataStore } from '@/store/dataStore';
import { Card, CardHeader } from '@/components/ui/Card';
import { ActivityFeed } from '@/features/dashboard/ActivityFeed';

/** Full chronology for one matter, newest first (TOR §37 Timeline tab). */
export function TimelineTab({ caseId }: { caseId: string }) {
  const data = useDataStore();
  const events = useMemo(() => selectCaseTimeline(data, caseId), [data, caseId]);

  return (
    <Card flush>
      <CardHeader
        title="Case history"
        description={`${events.length} recorded ${events.length === 1 ? 'event' : 'events'} — every action is attributed and timestamped.`}
        icon={<History className="size-4" aria-hidden />}
        divided
      />
      <ActivityFeed events={events} limit={events.length} showCase={false} flush={false} />
    </Card>
  );
}
