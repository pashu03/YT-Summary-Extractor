/**
 * Run the pipeline for one video from the command line and print a readable
 * report. Handy for checking summary quality without starting the servers.
 *
 *   npx tsx scripts/try.ts <youtube-url-or-id> [language]
 */
import { toAppError } from '../src/errors.js';
import { runPipeline } from '../src/pipeline.js';

const [url, language] = process.argv.slice(2);
if (!url) {
  console.error('Usage: npx tsx scripts/try.ts <youtube-url-or-id> [language]');
  process.exit(1);
}

const clock = (seconds: number) => {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

try {
  const result = await runPipeline(
    { url, language },
    { emit: (event) => event.type === 'progress' && console.error(`  [${event.percent}%] ${event.message}`) },
  );
  const { video, captions, summary, keywords, stats, transcript } = result;

  console.log(`\n${video.title}\n${video.author} · ${clock(video.durationSeconds)} · ${captions.name}`);
  console.log(`tracks: ${captions.available.map((t) => t.id).join(' ')}`);
  console.log(`stats: ${JSON.stringify(stats)}`);

  console.log('\n== SHORT SUMMARY ==');
  for (const s of summary.short) console.log(`[${clock(s.start)}] ${s.text}`);

  console.log('\n== KEY TAKEAWAYS ==');
  for (const s of summary.takeaways) console.log(`[${clock(s.start)}] ${s.text}`);

  console.log('\n== SECTIONS ==');
  for (const section of summary.sections) {
    console.log(`\n# ${section.title}  (${clock(section.start)}–${clock(section.end)}, ${section.source}, ${Math.round(section.share * 100)}%)`);
    console.log(`  keywords: ${section.keywords.join(', ')}`);
    for (const point of section.points) console.log(`  - [${clock(point.start)}] ${point.text}`);
  }

  console.log('\n== KEYWORDS ==');
  console.log(keywords.map((k) => `${k.term} (${k.score.toFixed(2)}, ×${k.count}${k.kind === 'phrase' ? ', phrase' : ''})`).join('\n'));

  console.log('\n== FIRST PARAGRAPHS ==');
  for (const p of transcript.paragraphs.slice(0, 3)) console.log(`[${clock(p.start)}] ${p.text}\n`);
  console.log(`cues: ${transcript.cues.length}, paragraphs: ${transcript.paragraphs.length}`);
} catch (err) {
  const error = toAppError(err);
  console.error(`\n${error.code}: ${error.message}${error.detail ? `\n  detail: ${error.detail}` : ''}`);
  if (error.code === 'INTERNAL') console.error(err);
  process.exitCode = 1;
}
