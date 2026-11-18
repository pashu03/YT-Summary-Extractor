import {
  Captions,
  ClipboardPaste,
  DatabaseZap,
  Download,
  FileText,
  Languages,
  Layers,
  ListChecks,
  Lock,
  Network,
  ScrollText,
  ShieldCheck,
  Sigma,
  Tags,
  Target,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { ListenButton } from '@/components/speech';
import { joinForSpeech } from '@/lib/speech';

interface Item {
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: Item[] = [
  { icon: ClipboardPaste, title: 'Paste a link', body: 'Standard videos, youtu.be short links and Shorts all work. No account needed.' },
  { icon: Captions, title: 'Captions are read', body: "The video's own subtitles are fetched — the creator's when available, otherwise YouTube's auto-generated ones." },
  { icon: ScrollText, title: 'Read, copy or download', body: 'Get the transcript, summary, topics and keywords in a dashboard, with exports in four formats.' },
];

const FEATURES: Item[] = [
  { icon: FileText, title: 'Timestamped transcript', body: 'Clean, readable paragraphs with a timestamp on each, plus the original captions line by line. Search inside either.' },
  { icon: ListChecks, title: 'Short and detailed summaries', body: 'A few sentences for the gist, and a section-by-section summary for the detail. Every line is quoted from the video.' },
  { icon: Layers, title: 'Sections with timestamps', body: "Long videos are divided into sections using the creator's chapters, or detected automatically where the topic changes." },
  { icon: Tags, title: 'Topics and keywords', body: 'The terms and phrases that matter most, ranked by relevance, with the distinctive vocabulary of each section.' },
  { icon: Download, title: 'TXT, PDF, SRT and VTT', body: 'Download a text file, a formatted PDF report, or subtitle files that keep the original caption timing.' },
  { icon: Languages, title: 'Any caption language', body: 'Choose from every caption track a video offers. Summaries use stopword lists for more than 50 languages.' },
];

const METHODS: Item[] = [
  { icon: Sigma, title: 'TF-IDF', body: 'Each sentence becomes a weighted vector of its terms, so rare, informative words count for more than common ones.' },
  { icon: Network, title: 'TextRank', body: 'Sentences are linked by similarity and ranked with PageRank; those most connected to the rest of the video rise to the top.' },
  { icon: Target, title: 'Maximal marginal relevance', body: 'Sentences are picked one at a time, favouring ones that add something new, so a summary never repeats itself.' },
  { icon: Layers, title: 'TextTiling', body: 'Vocabulary is compared on either side of every point in the transcript; a sharp change marks the start of a new section.' },
];

const PRIVACY: Item[] = [
  { icon: UserX, title: 'No accounts', body: 'No registration, login or history. Nothing ties a request to a person.' },
  { icon: DatabaseZap, title: 'No database', body: 'Each request is processed in memory and discarded as soon as the response is sent.' },
  { icon: ShieldCheck, title: 'No AI services', body: 'Your links and transcripts are never sent to OpenAI, Claude, Gemini or any other model provider.' },
  { icon: Lock, title: 'Respects restrictions', body: 'Private, age-restricted and members-only videos are reported as unavailable, never worked around.' },
];

/** Everything in a section as one passage, for the read-aloud button. */
const narrate = (title: string, lead: string | undefined, items: Item[]) =>
  joinForSpeech([title, lead, ...items.flatMap((item) => [item.title, item.body])]);

function SectionHeading({ eyebrow, title, lead, items }: { eyebrow: string; title: string; lead?: string; items: Item[] }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold tracking-wide text-chart-1 uppercase">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance text-primary">{title}</h2>
      {lead && <p className="mt-3 text-base text-pretty text-muted-foreground">{lead}</p>}
      <ListenButton id={`section-${eyebrow}`} label={`the ${eyebrow} section`} labelled variant="outline" className="mt-4 bg-white" text={narrate(title, lead, items)} />
    </div>
  );
}

/** Static content below the tool: how it works, features, method and privacy. */
export function LandingSections() {
  return (
    <>
      <section id="how-it-works" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="How it works" title="From link to transcript in three steps" items={STEPS} />
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="relative rounded-2xl bg-white p-6 shadow-xs ring-1 ring-border">
                <span className="absolute top-6 right-6 text-4xl leading-none font-semibold text-secondary select-none" aria-hidden>
                  {index + 1}
                </span>
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="features" className="scroll-mt-16 border-y border-border bg-muted/60 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Features"
            title="Everything you need from a video, as text"
            lead="Built for research, note-taking, content repurposing and accessibility."
            items={FEATURES}
          />
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl bg-white p-6 shadow-xs ring-1 ring-border">
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="method" className="scroll-mt-16 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Method"
            title="Summaries you can verify"
            lead="No language model writes the summary. Classic text-mining algorithms choose the sentences that best represent the video, so every line can be traced to the moment it was said."
            items={METHODS}
          />
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {METHODS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border border-border p-5">
                <Icon className="size-5 text-chart-1" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="privacy" className="scroll-mt-16 bg-primary py-16 text-primary-foreground sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold tracking-wide text-sky-300 uppercase">Privacy</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">Private by design</h2>
            <p className="mt-3 text-base text-pretty text-blue-100/90">
              The results exist only in your browser tab. Close or reload it and they are gone.
            </p>
            <ListenButton
              id="section-Privacy"
              label="the Privacy section"
              labelled
              variant="outline"
              className="mt-4 bg-white text-primary"
              text={narrate('Private by design', 'The results exist only in your browser tab. Close or reload it and they are gone', PRIVACY)}
            />
          </div>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRIVACY.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/15">
                <Icon className="size-5 text-sky-300" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-blue-100/85">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
