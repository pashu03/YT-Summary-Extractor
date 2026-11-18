'use client';

import { ChevronDown, Download, FileDown, FileText, Loader2, Subtitles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, requestPdf, type PdfOptions } from '@/lib/api';
import { downloadFile, safeFilename, toSrt, toSummaryText, toTranscriptText, toVtt } from '@/lib/exporters';
import type { TranscriptResult } from '@/types/api';

export type DownloadFormat =
  | 'transcript-txt'
  | 'transcript-pdf'
  | 'srt'
  | 'vtt'
  | 'summary-txt'
  | 'summary-pdf'
  | 'report-pdf';

interface DownloadMenuProps {
  result: TranscriptResult;
  /** Which groups of formats to offer. */
  scope: 'all' | 'transcript' | 'summary';
  /** Whether TXT and PDF transcripts include timestamps. */
  timestamps?: boolean;
  label?: string;
  variant?: 'default' | 'outline';
}

const PDF_PARTS: Record<string, { include: Omit<PdfOptions, 'timestamps'>; suffix: string }> = {
  'transcript-pdf': { include: { summary: false, transcript: true }, suffix: 'transcript' },
  'summary-pdf': { include: { summary: true, transcript: false }, suffix: 'summary' },
  'report-pdf': { include: { summary: true, transcript: true }, suffix: 'summary and transcript' },
};

export function DownloadMenu({ result, scope, timestamps = true, label = 'Download', variant = 'outline' }: DownloadMenuProps) {
  const [busy, setBusy] = useState(false);
  const title = result.video.title;

  const save = async (format: DownloadFormat) => {
    try {
      switch (format) {
        case 'transcript-txt':
          downloadFile(safeFilename(title, 'transcript', 'txt'), toTranscriptText(result, { timestamps }));
          break;
        case 'summary-txt':
          downloadFile(safeFilename(title, 'summary', 'txt'), toSummaryText(result));
          break;
        case 'srt':
          downloadFile(safeFilename(title, 'captions', 'srt'), toSrt(result.transcript.cues), 'application/x-subrip;charset=utf-8');
          break;
        case 'vtt':
          downloadFile(safeFilename(title, 'captions', 'vtt'), toVtt(result.transcript.cues), 'text/vtt;charset=utf-8');
          break;
        default: {
          // PDFs are rendered by the server; the result is sent with the request because the server stores nothing.
          const { include, suffix } = PDF_PARTS[format];
          setBusy(true);
          const pdf = await requestPdf(result, { ...include, timestamps });
          downloadFile(safeFilename(title, suffix, 'pdf'), pdf);
        }
      }
      toast.success('Download started');
    } catch (err) {
      toast.error("Couldn't create the file", {
        description: err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  const showTranscript = scope !== 'summary';
  const showSummary = scope !== 'transcript';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={variant} size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {busy ? 'Preparing PDF…' : label}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {showTranscript && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Transcript</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => save('transcript-txt')}>
              <FileText /> Plain text (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('transcript-pdf')}>
              <FileDown /> PDF document (.pdf)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('srt')}>
              <Subtitles /> SubRip subtitles (.srt)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('vtt')}>
              <Subtitles /> WebVTT subtitles (.vtt)
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {showTranscript && showSummary && <DropdownMenuSeparator />}
        {showSummary && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Summary</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => save('summary-txt')}>
              <FileText /> Plain text (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('summary-pdf')}>
              <FileDown /> PDF document (.pdf)
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {scope === 'all' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => save('report-pdf')}>
              <FileDown /> Full report: summary + transcript (.pdf)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
