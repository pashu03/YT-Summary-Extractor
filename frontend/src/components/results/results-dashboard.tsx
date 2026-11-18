'use client';

import { FileText, LayoutDashboard, ListChecks, Tags } from 'lucide-react';
import { useState } from 'react';
import { DownloadMenu } from '@/components/download-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TranscriptResult } from '@/types/api';
import { OverviewTab } from './overview-tab';
import { SummaryTab } from './summary-tab';
import { TopicsTab } from './topics-tab';
import { TranscriptTab } from './transcript-tab';
import { useResultTranslation, type TranslationPart } from './translation';

export type ResultTab = 'overview' | 'transcript' | 'summary' | 'topics';

const TABS: { value: ResultTab; label: string; short: string; icon: typeof FileText }[] = [
  { value: 'overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { value: 'transcript', label: 'Full Transcript', short: 'Transcript', icon: FileText },
  { value: 'summary', label: 'Detailed Summary', short: 'Summary', icon: ListChecks },
  { value: 'topics', label: 'Key Topics & Keywords', short: 'Topics', icon: Tags },
];

/** Which translated content each tab shows, so it can be prepared when the tab is opened. */
const TAB_PARTS: Record<ResultTab, TranslationPart[]> = {
  overview: [],
  transcript: ['summary', 'paragraphs', 'cues'],
  summary: ['summary'],
  topics: [],
};

export function ResultsDashboard({ result }: { result: TranscriptResult }) {
  const [tab, setTab] = useState<ResultTab>('overview');
  const translation = useResultTranslation(result);
  // Opening a tab while a translated language is chosen prepares that tab's content.
  const open = (next: ResultTab) => {
    setTab(next);
    translation.ensure(TAB_PARTS[next]);
  };

  return (
    <Tabs value={tab} onValueChange={(value) => open(value as ResultTab)} className="gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList className="h-auto! w-full justify-start gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-xs ring-1 ring-border sm:w-auto">
          {TABS.map(({ value, label, short, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              // The hover colour must not override the active tab's white label.
              className="h-9 flex-1 rounded-lg px-2 text-sm sm:flex-none sm:px-3 data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none data-active:hover:text-primary-foreground"
            >
              {/* Four labels only fit on a phone without their icons. */}
              <Icon aria-hidden className="hidden sm:block" />
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex justify-end">
          <DownloadMenu result={result} scope="all" label="Download" variant="default" />
        </div>
      </div>

      <TabsContent value="overview">
        <OverviewTab result={result} onNavigate={open} />
      </TabsContent>
      <TabsContent value="transcript">
        <TranscriptTab result={result} translation={translation} />
      </TabsContent>
      <TabsContent value="summary">
        <SummaryTab result={result} translation={translation} />
      </TabsContent>
      <TabsContent value="topics">
        <TopicsTab result={result} />
      </TabsContent>
    </Tabs>
  );
}
