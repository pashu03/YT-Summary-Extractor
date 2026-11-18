import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SpeechProvider } from '@/components/speech';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Scriptline — YouTube Transcript & Summary Extractor',
  description:
    'Paste a YouTube link to get the full timestamped transcript, a structured summary, key topics and keywords. Download as TXT, PDF, SRT or VTT. No sign-up, nothing stored.',
  applicationName: 'Scriptline',
  keywords: ['YouTube transcript', 'video summary', 'subtitles', 'SRT', 'VTT', 'keyword extraction'],
  // Results are private to the visitor; there is nothing for referrers to learn.
  referrer: 'strict-origin-when-cross-origin',
};

export const viewport: Viewport = {
  themeColor: '#0b2a5b',
  colorScheme: 'light',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body id="top" className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={150}>
          <SpeechProvider>{children}</SpeechProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
