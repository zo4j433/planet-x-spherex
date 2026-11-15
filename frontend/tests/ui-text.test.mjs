import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtml, elements, byId, textContent, normalizedText, claim } from './html-fixture.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

function scienceHelp(html) {
  const root = parseHtml(html), help = byId(root, 'flags-help');
  assert.equal(help.tag, 'details');
  const summary = help.children.find(node => node.tag === 'summary');
  assert.ok(summary && textContent(summary), 'Science help needs an accessible summary');
  const preview = elements(help, node => node.tag === 'p' && /\bpreview\b/.test(normalizedText(node)));
  const epochs = elements(help, node => node.tag === 'p' && /\bmulti epoch\b/.test(normalizedText(node)));
  assert.equal(preview.length, 1, 'Preview masking policy has one home');
  assert.equal(epochs.length, 1, 'Multi-epoch masking policy has one home');
  const scope = paragraphs => ({ children: paragraphs });
  const p = scope(preview), e = scope(epochs);
  // These are relationships with explicit polarity and scope. Exact scientific
  // numbers and mask names remain contracts; prose and presentation do not.
  const maskRule = normalizedText(preview[0]).split(/[.;]/).map(clause => clause.trim().match(
    /^preview (?:excludes|rejects|filters out) (?:non finite pixels and bits |pixels with bits )([\d ]+(?:and \d+)?)(?: set or (?:not finite|non finite))?$/,
  )).find(Boolean);
  assert.ok(maskRule, 'Preview must state which set bits it excludes');
  assert.deepEqual(maskRule[1].match(/\d+/g).map(Number).sort((a, b) => a - b), [1, 2, 6, 9, 15, 19], 'Preview rejected bit set');
  claim(p, /^(?:preview (?:excludes|rejects) non finite pixels\b|preview (?:excludes|rejects|filters out) pixels with bits .* set or (?:not finite|non finite)$)/, 'Preview must exclude non-finite pixels');
  claim(p, /^(?:for image files )?without (?:a )?flags(?: extension)? preview (?:displays|shows) finite pixels\b/, 'Missing FLAGS still permits finite Preview pixels');
  claim(p, /^(?:.*\bbut )?flag based quality checks (?:are |remain )?(?:unavailable|not available)$/, 'Missing FLAGS must not imply quality checks passed');
  claim(p, /^image and coordinate checks (?:still apply|remain required)$/, 'Image and coordinate checks still apply');
  claim(p, /^other bits are (?:retained|kept) as quality information$/, 'Other Preview bits are quality information');
  claim(p, /^(?:the )?orange overlay (?:marks|highlights) flagged pixels$/, 'Overlay identifies flagged pixels');
  claim(e, /^multi epoch (?:requires|needs) flags and (?:its |their )?header definitions$/, 'Multi-epoch requires FLAGS and definitions');
  claim(e, /^only (?:source and fullsample|fullsample and source) masks (?:declared|defined) by each fits header are (?:allowed|accepted)$/, 'Only header-defined SOURCE/FULLSAMPLE are allowed');
  claim(e, /^(?:all other set bits including unknown bits (?:exclude|reject) the pixel|pixels with any other bit set including unknown bits are (?:excluded|rejected)) before reprojection$/, 'Reject every other bit, including unknown bits, before reprojection');
  claim(e, /^non finite pixels are (?:also )?(?:excluded|rejected)$/, 'Multi-epoch excludes non-finite pixels');
  claim(e, /^reprojection (?:requires|needs) full coverage by valid input pixels$/, 'Reprojection requires full valid input coverage');
  claim(e, /^gaps (?:remain|stay) (?:hidden|masked)$/, 'Coverage gaps must stay hidden');
  claim(e, /^retained flags can include rejected input pixels\b/, 'Retained flags may include rejected input');
  claim(e, /^retained flags can include rejected input pixels and (?:do not|cannot) by themselves (?:show|determine) whether an output pixel is valid$/, 'Retained flags alone cannot determine output validity');
  claim(help, /^log(?: stretch)? (?:supports|handles) (?:zero and negative|negative and zero) brightness values$/, 'Log must support zero and negative brightness');
  claim(help, /^histograms? (?:use|uses|show|shows) original valid pixels$/, 'Histogram uses original valid pixels');
  claim(help, /^min max and stretch (?:change|adjust) (?:only the display|the display only)$/, 'Brightness controls affect display only');
  const about = byId(root, 'brightness-about');
  assert.equal(about.tag, 'details');
  claim(about, /^(?:adjust|change) min max and stretch to (?:explore|inspect) faint detail$/, 'Brightness controls explain their purpose');
  assert.doesNotMatch(textContent(help), /\b(?:flags_or|valid_mask|weights|log1p|1000t)\b/i);
}

test('public science help distinguishes missing quality data and preserves masking limits', () => {
  scienceHelp(read('../index.html'));
});

function guidance(html) {
  const root = parseHtml(html), player = byId(root, 'epoch-player'), details = byId(root, 'epoch-advanced');
  const timing = /^observation intervals (?:vary|are (?:uneven|irregular))$/;
  const moving = /^(?:for moving targets )?check (?:the )?coordinate epoch and observation date when identifying a source$/;
  const analysis = /^(?:measuring|quantifying) variability (?:requires|needs) additional photometric analysis$/;
  claim(player, /^frames play at a (?:steady|constant) pace$/, 'Playback pace is constant');
  claim(player, timing, 'Playback pace is distinct from observation intervals');
  claim(byId(root, 'preview-panel'), moving, 'Moving-target identification needs epoch and observation date');
  claim(details, analysis, 'Variability measurements require additional photometric analysis');
  for (const [pattern, label] of [[timing, 'timing'], [moving, 'moving target'], [analysis, 'analysis scope']]) {
    const homes = elements(root, node => node.tag === 'p' && normalizedText(node).split(/[.;]/).some(clause => pattern.test(clause.trim())));
    assert.equal(homes.length, 1, `One home for ${label} guidance`);
  }
  const dec = byId(root, 'dec');
  assert.equal(dec.tag, 'input');
  assert.equal(dec.attrs.type, 'number');
  assert.equal(dec.attrs.min, '-90');
  assert.equal(dec.attrs.max, '90');
}

test('guidance has one home for timing and moving targets, with a single analysis scope note', () => {
  guidance(read('../index.html'));
});

function controls(html) {
  const root = parseHtml(html), form = byId(root, 'search-form');
  assert.equal(form.tag, 'form');
  for (const [id, min, max] of [['ra', '0', '359.99999999999994'], ['dec', '-90', '90'], ['radius', '0.00000000000006', '5']]) {
    const input = byId(form, id);
    assert.equal(input.tag, 'input');
    assert.equal(input.attrs.type, 'number');
    assert.equal(input.attrs.min, min); assert.equal(input.attrs.max, max);
    assert.equal(input.attrs.step, 'any'); assert.ok('required' in input.attrs);
    const labels = elements(form, node => node.tag === 'label' && node.attrs.for === id);
    assert.equal(labels.length, 1); assert.ok(textContent(labels[0]));
  }
  assert.equal(byId(form, 'search').attrs.type, 'submit');
  assert.equal(byId(root, 'preview').tag, 'img');
  assert.equal(byId(root, 'quality-overlay').attrs.type, 'checkbox');
  for (const id of ['epoch-prev', 'epoch-play', 'epoch-next']) assert.equal(byId(byId(root, 'epoch-player'), id).tag, 'button');
  assert.equal(byId(root, 'epoch-time').attrs.type, 'range');
}

test('essential image, form and player DOM contracts survive copy changes', () => {
  controls(read('../index.html'));
});

test('help accepts equivalent wording, capitalization, punctuation and inline formatting', () => {
  const html = read('../index.html')
    .replace('Preview excludes pixels with bits 1, 2, 6, 9, 15 and 19 set or not finite',
      'PREVIEW rejects non-finite pixels and bits 19, 15, 9, 6, 2 and 1')
    .replace('For image files without FLAGS extension', 'Without FLAGS')
    .replace('pixels with any other bit set, including unknown bits, are excluded before reprojection',
      'all other set bits, including unknown bits, exclude the pixel before reprojection')
    .replace('requires full coverage', 'needs full coverage')
    .replace('gaps remain hidden', 'gaps stay masked')
    .replace('Only SOURCE and FULLSAMPLE', 'Only <strong>FULLSAMPLE</strong> and SOURCE')
    .replace('Log stretch supports zero and negative', 'Log handles negative and zero')
    .replace('Histograms use', 'Histograms show')
    .replace('Min/Max and Stretch change the display only', 'MIN/MAX and Stretch adjust only the display')
    .replace('Frames play at a steady pace; observation intervals vary.',
      'Frames play at a constant pace! Observation intervals are irregular.')
    .replace('measuring variability requires', 'quantifying variability needs')
    .replaceAll(', ', ',\n  ');
  scienceHelp(html); guidance(html); controls(html);
});

// Mutate strings in memory only: the checked-in HTML is never rewritten.
// Each mutant retains nearby science vocabulary, so keyword-only checks fail.
const scienceMutants = [
  ['missing help DOM', 'id="flags-help"', 'id="removed-help"'],
  ['missing brightness help', 'id="brightness-about"', 'id="removed-brightness"'],
  ['wrong rejected bit', 'bits 1, 2, 6, 9, 15 and 19', 'bits 1, 2, 6, 9, 15 and 20'],
  ['non-finite accepted', 'set or not finite', 'set'],
  ['Preview rejects nothing', 'Preview excludes pixels', 'Preview includes pixels'],
  ['missing FLAGS passed', 'quality checks are unavailable', 'quality checks are available'],
  ['coordinate checks removed', 'Image and coordinate checks still apply.', ''],
  ['FLAGS optional', 'Multi-epoch requires FLAGS', 'Multi-epoch does not require FLAGS'],
  ['allow-list broadened', 'Only SOURCE and FULLSAMPLE', 'SOURCE and FULLSAMPLE'],
  ['header ignored', 'declared by each FITS header', 'declared by a fixed global table'],
  ['unknown bits retained', 'including unknown bits, are excluded', 'including unknown bits, are retained'],
  ['masking after reprojection', 'excluded before reprojection', 'excluded after reprojection'],
  ['non-finite epoch pixels retained', 'Non-finite pixels are also excluded.', 'Non-finite pixels are retained.'],
  ['partial coverage accepted', 'requires full coverage', 'requires partial coverage'],
  ['gaps visible', 'gaps remain hidden', 'gaps remain visible'],
  ['flags imply validity', 'do not by themselves show', 'by themselves show'],
  ['rejected inputs forgotten', 'can include rejected input pixels', 'cannot include rejected input pixels'],
  ['log excludes negatives', 'supports zero and negative', 'rejects zero and negative'],
  ['histogram from rendered pixels', 'Histograms use original valid pixels', 'Histograms use rendered pixels'],
  ['controls change science', 'change the display only', 'change the science values'],
  ['missing histogram explanation', 'Histograms use original valid pixels;', ''],
];
for (const [name, before, after] of scienceMutants) {
  test(`science help rejects regression: ${name}`, () => {
    const html = read('../index.html');
    assert.ok(html.includes(before), 'Mutation must actually change the fixture');
    assert.throws(() => scienceHelp(html.replace(before, after)), { name: 'AssertionError' });
  });
}

for (const [name, before, after, validate] of [
  ['missing image', 'id="preview"', 'id="removed-image"', controls],
  ['missing input', 'id="ra"', 'id="removed-ra"', controls],
  ['wrong input type', 'name="ra" type="number"', 'name="ra" type="text"', controls],
  ['missing player button', 'id="epoch-play"', 'id="removed-play"', controls],
  ['missing analysis limitation', 'Visual exploration; measuring variability requires additional photometric analysis.', 'Visual exploration.', guidance],
  ['false timing claim', 'observation intervals vary', 'observation intervals are constant', guidance],
  ['missing moving-target caveat', 'check the coordinate epoch and observation date', 'check the image', guidance],
]) {
  test(`UI contracts reject regression: ${name}`, () => {
    const html = read('../index.html');
    assert.ok(html.includes(before), 'Mutation must actually change the fixture');
    assert.throws(() => validate(html.replace(before, after)), { name: 'AssertionError' });
  });
}

test('footer keeps one attribution and both safe official resource links', () => {
  const footers = elements(parseHtml(read('../index.html')), node => node.tag === 'footer');
  assert.equal(footers.length, 1);
  const footer = footers[0];
  const attributions = elements(footer, node => node.tag === 'div' && /nasa.*ipac.*irsa.*spherex/i.test(textContent(node)));
  assert.equal(attributions.length, 1, 'One NASA/IPAC IRSA SPHEREx attribution');
  const nav = elements(footer, node => node.tag === 'nav');
  assert.equal(nav.length, 1); assert.ok(nav[0].attrs['aria-label']?.trim());
  const links = elements(nav[0], node => node.tag === 'a');
  assert.deepEqual(links.map(node => node.attrs.href).sort(), [
    'https://irsa.ipac.caltech.edu/Missions/spherex.html', 'https://spherex.caltech.edu',
  ]);
  for (const link of links) {
    assert.ok(textContent(link), 'Resource links need accessible text');
    assert.equal(link.attrs.target, '_blank');
    const rel = new Set(link.attrs.rel?.split(/\s+/));
    assert.ok(rel.has('noopener') && rel.has('noreferrer'));
  }
});

test('page declares English and contains no Chinese UI or accessibility text', () => {
  const html = read('../index.html');
  assert.equal(elements(parseHtml(html), node => node.tag === 'html')[0].attrs.lang, 'en');
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
