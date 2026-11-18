const NAV = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#method', label: 'Method' },
  { href: '#privacy', label: 'Privacy' },
];

function Logo() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary" aria-hidden>
      {/* Three lines of text with a play mark: a transcript of a video. */}
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
        <path d="M4 7h9M4 12h6M4 17h9" />
        <path d="M15.5 9.2v5.6l4.6-2.8z" fill="#7dd3fc" stroke="#7dd3fc" strokeLinejoin="round" strokeWidth="1.2" />
      </svg>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Logo />
          <span className="text-base font-semibold tracking-tight text-primary">Scriptline</span>
        </a>
        <nav aria-label="Page sections" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <span className="hidden rounded-full bg-secondary px-3 py-1 text-xs font-medium text-primary sm:inline-flex md:hidden lg:inline-flex">
          No sign-up · Nothing stored
        </span>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div>
            <p className="font-semibold text-primary">Scriptline</p>
            <p className="text-xs">YouTube Transcript &amp; Summary Extractor</p>
          </div>
        </div>
        <p className="max-w-xl text-xs leading-5 md:text-right">
          Works with publicly available captions only. Not affiliated with or endorsed by YouTube. Transcripts belong to their creators —
          respect copyright and YouTube&apos;s terms when reusing them.
        </p>
      </div>
    </footer>
  );
}
