import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('public science help distinguishes missing quality data and preserves masking limits', () => {
  const html = read('../index.html');
  const help = html.match(/<details id="flags-help"[^]*?<\/details>/)[0];
  assert.match(help, /Preview excludes non-finite pixels and bits 1, 2, 6, 9, 15 and 19/);
  assert.match(help, /Without FLAGS, Preview displays finite pixels, but flag-based quality checks are unavailable/);
  assert.match(help, /Image and coordinate checks still apply/);
  assert.match(help, /Multi-epoch requires FLAGS and its header definitions/);
  assert.match(help, /Only SOURCE and FULLSAMPLE masks declared by each FITS header are allowed/);
  assert.match(help, /all other set bits, including unknown bits, exclude the pixel before reprojection/);
  assert.match(help, /Non-finite pixels are also excluded/);
  assert.match(help, /full coverage by valid input pixels; gaps remain hidden/);
  assert.match(help, /Retained flags can include rejected input pixels/);
  assert.match(help, /do not by themselves show whether an output pixel is valid/);
  assert.doesNotMatch(help, /not a photometry recommendation/);
  assert.match(help, /Log stretch brings out faint detail/);
  assert.match(help, /supports zero and negative brightness values/);
  assert.match(help, /Histograms use original valid pixels; Min\/Max and Stretch change only the display/);
  assert.doesNotMatch(help, /finite-only|flags_or|valid_mask|weights|log1p|1000t/);
});

test('guidance has one home for timing and moving targets, with a single analysis scope note', () => {
  const html = read('../index.html');
  assert.equal((html.match(/observation intervals vary/g) || []).length, 1);
  assert.equal((html.match(/coordinate epoch and observation date/g) || []).length, 1);
  assert.equal((html.match(/measuring variability requires additional photometric analysis/g) || []).length, 1);
  const player = html.match(/<div id="epoch-player"[^]*?<details id="epoch-brightness-controls"/)[0];
  assert.match(player, /Frames play at a steady pace; observation intervals vary/);
  const details = html.match(/<details id="epoch-advanced"[^]*?<\/details>/)[0];
  assert.match(details, /measuring variability requires additional photometric analysis/);
  assert.doesNotMatch(details, /uneven|elapsed observation time|observation intervals/);
  assert.doesNotMatch(html, /not photometry|not a photometric sequence|not a photometry recommendation|target may not be identifiable|Backend PNG|raw IMAGE|native IMAGE/);
  assert.match(html, /-90 &le; Dec &le; 90/);
});

test('footer keeps one attribution and both safe official resource links', () => {
  const footer = read('../index.html').match(/<footer>[^]*?<\/footer>/)[0];
  assert.equal((footer.match(/Data source:/g) || []).length, 1);
  assert.match(footer, /Data source: NASA \/ IPAC IRSA SPHEREx/);
  assert.match(footer, /<nav class="resource-links" aria-label="Official resources">/);
  assert.doesNotMatch(footer, /Data Sources|<strong/);
  const links = [...footer.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(([, url, label]) => [url, label]), [
    ['https://spherex.caltech.edu', 'SPHEREx Mission'],
    ['https://irsa.ipac.caltech.edu/Missions/spherex.html', 'IRSA SPHEREx Data Access'],
  ]);
});

test('page declares English and contains no Chinese UI or accessibility text', () => {
  const html = read('../index.html');
  assert.match(html, /<html lang="en">/);
  assert.doesNotMatch(html, /\p{Script=Han}/u);
  for (const term of ['NASA', 'SPHEREx', 'RA', 'Dec', 'WCS', 'Detector', 'MJy/sr', 'UTC', 'SIA', 'FITS', 'Linear', 'Asinh']) {
    assert.ok(html.includes(term), `Missing scientific term: ${term}`);
  }
});

test('dynamic UI and API error messages contain no untranslated Chinese', () => {
  for (const path of ['../app.js', '../epochs.js', '../brightness.js', '../wcs-axes.js', '../color-bar.js', '../../backend/app/main.py', '../../backend/app/service.py', '../../backend/app/wcs_axes.py']) {
    const source = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(?:\/\/|#).*$/gm, '')
      .replace(/\|\u672a\u77e5\|/g, '|');
    assert.doesNotMatch(source, /\p{Script=Han}/u, path);
  }
});
