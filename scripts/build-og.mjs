// Builds one 1200x630 Open Graph card per page by screenshotting the page
// itself, cropped to its masthead and story head. Output goes to
// public/static/og/<slug>.webp, which Vite serves at /og/<slug>.webp, and each
// page's og:image and twitter:image point at its own card.
//
//   npm run og                          # shoots https://verbatim.test
//   npm run og -- https://verbatim.fyi  # shoots production
//   npm run og -- <base> --preview <dir>  # also writes the raw PNGs there
//
// Rerun after a change to a headline, a dek, the masthead or the type. Look at
// the cards before committing them. Not part of the build: the cards are
// committed files, and Netlify never runs Playwright.
import { mkdir, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const PAGES = [
  ['home', '/'],
  ['about', '/about.html'],
  ['corpus', '/corpus/'],
  ['amendments', '/amendments/'],
  ['over-time', '/over-time/'],
  ['compas', '/compas/'],
  ['trades', '/trades/'],
  ['incidents', '/incidents/'],
  ['finance', '/finance/'],
  ['qi', '/qi/'],
  ['crashes', '/crashes/'],
  ['executive', '/executive/'],
  ['vs', '/vs/'],
];

const WIDTH = 1200;
const HEIGHT = 630;
// Lowest point the last visible line may reach, so nothing sits on the edge.
const FLOOR = HEIGHT - 32;
const MAX_BYTES = 100 * 1024;

// A card is the masthead plus the page's opening block: the homepage statement
// (.front), or a story head's kicker, headline, dek and first sidebar item
// (.story-head, inside an <article> on every other page). Everything after it
// (figures, appendix, contents list, colophon) goes, and so does the body copy
// under the dek, which 630px would cut mid-sentence.
const BLOCK = '.front, .story-head';
const CARD_CSS = `
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
  .front ~ *, .story-head ~ *, body > footer { display: none !important; }
  .story-head .prose { display: none !important; }
  .story-head aside > :not(:first-child) { display: none !important; }
  .story-head aside details { display: none !important; }
`;

const args = process.argv.slice(2);
const previewAt = args.indexOf('--preview');
const previewDir = previewAt === -1 ? null : args[previewAt + 1];
const base = (args.find((a, i) => !a.startsWith('--') && i !== previewAt + 1) ?? 'https://verbatim.test').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static', 'og');

await mkdir(outDir, { recursive: true });
if (previewDir) await mkdir(previewDir, { recursive: true });

const browser = await chromium.launch();
const problems = [];
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
  });
  for (const [slug, path] of PAGES) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: CARD_CSS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // Measure the visible content, then center it between the masthead and the
    // bottom edge. Short blocks (the homepage, About, Vs.) otherwise sit at the
    // top over an empty lower half. Only ever shifts down.
    const bottom = await page.evaluate(({ selector, height }) => {
      const block = document.querySelector(selector);
      if (!block) throw new Error(`no ${selector} on ${location.pathname}`);
      // checkVisibility, not offsetParent: the body of a closed <details> still
      // has a layout box in Chromium, so offsetParent counts it.
      const rects = [...block.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && el.checkVisibility())
        .map((el) => el.getBoundingClientRect());
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const masthead = document.querySelector('.masthead').getBoundingClientRect().bottom;
      const shift = Math.max(0, Math.round((height - bottom - (top - masthead)) / 2));
      block.style.transform = `translateY(${shift}px)`;
      return bottom + shift;
    }, { selector: BLOCK, height: HEIGHT });

    const shot = await page.screenshot({ type: 'png' });
    if (previewDir) await writeFile(join(previewDir, `${slug}.png`), shot);
    const out = join(outDir, `${slug}.webp`);
    await sharp(shot).webp({ quality: 88 }).toFile(out);

    const bytes = statSync(out).size;
    console.log(`${slug.padEnd(10)} ${path.padEnd(14)} ${(bytes / 1024).toFixed(1).padStart(5)} KB  content to y=${Math.round(bottom)}`);
    if (bottom > FLOOR) problems.push(`${slug}: content runs to y=${Math.round(bottom)}, past ${FLOOR}`);
    if (bytes > MAX_BYTES) problems.push(`${slug}: ${bytes} bytes, over ${MAX_BYTES}`);
  }
} finally {
  await browser.close();
}

if (problems.length) {
  console.error(`\n${problems.join('\n')}`);
  process.exit(1);
}
