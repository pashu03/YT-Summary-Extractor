import { LandingSections } from '@/components/landing-sections';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { TranscriptApp } from '@/components/transcript-app';

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <TranscriptApp />
        <LandingSections />
      </main>
      <SiteFooter />
    </>
  );
}
