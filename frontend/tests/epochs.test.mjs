import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { axesFixture } from './axes-fixture.mjs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sid = 'a'.repeat(32);
const product = (id, day, detector = 1, obs = id) => ({ product_id: id, obs_id: obs, detector, t_min: 60000 + day, source_collections: ['spherex_dr1'], frame_status: 'not_requested' });
const candidates = [product('late', 4), product('early', 0), product('middle', 1), product('fourth', 2), product('d2', 3, 2), product('alternative', 4, 1, 'late')];
function setup({ apiError, pngError = false, failed = false, allFailed = false, mode = 'observation_browse', malformed = false, network = false, hang = false, page = false, reverseDates = false, available = candidates, wcsAxes = axesFixture(), normalization, frameNormalization, expiresAt, frameDisplay, sequenceInfo = {}, frameInfo = {} } = {}) {
  const observers = [];
  const elements = {}, calls = [], intervals = new Map(), timeouts = new Map(), urls = [], revoked = [];
  let serial = 0;
  class Element {
    constructor() { this.clientWidth = 900; this.clientHeight = 600; this.value = ''; this.children = []; this.events = {}; this.attrs = {}; this.style = {}; this.dataset = {}; this.naturalWidth = this.naturalHeight = 29; this.classList = { toggle() {}, remove() {} }; }
    focus() { environment.document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    getBoundingClientRect() { return { left:0, top:0, width:parseFloat(this.style.width)||this.clientWidth, height:parseFloat(this.style.height)||this.clientHeight }; }
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute(k, v) { this.attrs[k] = v; }
    replaceChildren(...items) { this.children = items; }
    append(...items) { this.children.push(...items); }
    toDataURL() { return "data:image/png;base64,offline-display"; }
    getContext() { return { clearRect() {}, fillRect() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: frame => { this.frame = frame; } }; }
    set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = new Element();
  Object.entries({ ra: '127.69444', dec: '-39.17760', radius: '0.6', zoom: '12', 'epoch-zoom': '12', 'epoch-speed': '1000', 'explorer-mode': 'preview' }).forEach(([id, value]) => elements[id].value = value);
  class MockURL extends URL {
    static createObjectURL() { const url = `blob:frame-${urls.length}`; urls.push(url); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const ok = data => ({ ok: true, status: 200, json: async () => data });
  const environment = {
    document: { body: { style: {} }, activeElement: null, getElementById: id => { assert.ok(elements[id], id); return elements[id]; }, createElement: () => new Element() },
    window: { ResizeObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(host) { this.host = host; } } }, URL: MockURL, URLSearchParams, AbortController, TypeError, location: { hostname: '127.0.0.1', protocol: 'http:' }, localStorage: { getItem() {}, setItem() {} },
    setTimeout: (fn, ms) => { const id = ++serial; timeouts.set(id, { fn, ms }); return id; }, clearTimeout: id => timeouts.delete(id),
    setInterval: (fn, ms) => { const id = ++serial; intervals.set(id, { fn, ms }); return id; }, clearInterval: id => intervals.delete(id),
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (network) throw new TypeError('network');
      if (hang) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { const e = Error(); e.name = 'AbortError'; reject(e); }));
      if (malformed) return { ok: true, status: 200, json: async () => { throw Error(); } };
      if (url.endsWith('/api/epochs/search')) return ok({ search_id: sid, expires_at: expiresAt, products: page && !JSON.parse(options.body).cursor ? available.slice(0, 2) : available, collections: [{ name: 'spherex_dr1', status: 'partial', truncated: true }], complete: false, pagination: { next_cursor: page && !JSON.parse(options.body).cursor ? 'cursor' : null } });
      if (apiError || pngError && options.method === 'GET') return { ok: false, status: 410, headers: { get: () => '5' }, json: async () => ({ error: { code: apiError || 'frame_not_found', message: 'test failure' } }) };
      if (options.method === 'GET') return { ok: true, blob: async () => ({}) };
      const ids = JSON.parse(options.body).product_ids;
      return ok({ search_id: sid, sequence_id: sid, mode, wcs_axes: wcsAxes, normalization: normalization ?? { policy: 'mock-policy' }, ...sequenceInfo, frames: ids.map((id, index) => ({ ...available.find(p => p.product_id === id), index, observation_utc: `2025-01-0${reverseDates ? ids.length - index : index + 1}T00:00:00Z`, time_source: 'FITS_DATE-OBS', status: allFailed || failed && index === 1 ? 'failed' : 'alignment_unqualified', alignment: { status: 'unverified' }, normalization: frameNormalization?.(index), display: frameDisplay?.(index), image_url: allFailed || failed && index === 1 ? null : `http://internal/api/epoch-frames/${sid}/${index}.png`, error: { code: 'cutout_failed', message: 'kept failure slot' }, target_wavelength_um: .86, target_bandwidth_um: .021, ...frameInfo })) });
    }
  };
  for (const file of ['brightness.js', 'wcs-axes.js', 'color-bar.js', 'epochs.js', 'app.js']) vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), environment);
  const e = elements;
  e['explorer-mode'].value = 'epochs'; e['explorer-mode'].events.change();
  const submit = () => e['search-form'].events.submit({ preventDefault() {} });
  const check = id => e['epoch-products'].children.find(row => row.dataset.productId === id)?.children[0].children[0];
  const visibleIds = () => e['epoch-products'].children.map(row => row.dataset.productId);
  const choose = id => { const c = check(id); c.checked = !c.checked; c.events.change(); };
  return { e, document: environment.document, setError: code => { apiError = code; }, failAll: () => { allFailed = true; }, resize: () => observers.forEach(o => o.fn()), calls, intervals, timeouts, urls, revoked, submit, check, visibleIds, choose, quick: count => e['select-first-' + count].events.click(), load: () => e['load-frames'].events.click() };
}
test('search uses shared coordinates and detectors array, never loads FITS automatically', async () => {
  const s = setup(); s.e.detector.value = '6'; await s.submit();
  assert.deepEqual(JSON.parse(s.calls[0].body), { ra: 127.69444, dec: -39.1776, radius_deg: .01, detectors: [6], limit: 100 });
  assert.equal(s.calls.length, 1); assert.match(s.calls[0].url, /epochs\/search$/);
  assert.match(s.e['epochs-sources'].textContent, /partial.*truncated.*Search incomplete/);
  assert.match(s.e['epoch-products'].children[0].children[1].textContent, /2023-/);
  assert.match(s.e['epoch-products'].children[0].children[4].children[0].children[1].textContent, /early.*not requested/);
  assert.equal(s.e['preview-panel'].hidden, true);
});

test('all frames, failed slots and mode switches keep identical common-grid ticks', async () => {
  const s = setup({ failed: true }); await s.submit(); s.quick(3); await s.load();
  const annotations = () => JSON.stringify(s.e['epoch-axes'].children);
  const before = annotations(), fetches = s.calls.length;
  s.e['epoch-next'].events.click(); assert.equal(annotations(), before);
  assert.match(s.e['epoch-image'].children[0].textContent, /Cannot display/);
  s.e['epoch-play'].events.click(); s.intervals.values().next().value.fn(); assert.equal(annotations(), before);
  s.e['epoch-time'].value = '0'; s.e['epoch-time'].events.input(); assert.equal(annotations(), before);
  s.e['epoch-zoom'].value = '32'; s.e['epoch-zoom'].events.input(); assert.notEqual(annotations(), before);
  s.e['epoch-fit-view'].events.click(); assert.equal(annotations(), before);
  s.e['explorer-mode'].value = 'preview'; s.e['explorer-mode'].events.change();
  s.e['explorer-mode'].value = 'epochs'; s.e['explorer-mode'].events.change(); assert.equal(annotations(), before);
  assert.equal(s.calls.length, fetches);
  await s.submit(); assert.equal(s.e['epoch-axes'].children.length, 0);
});

test('a sequence without reliable WCS shows unavailable, never the search centre as ticks', async () => {
  const s = setup({ wcsAxes: null }); await s.submit(); s.quick(2); await s.load();
  assert.equal(s.e['epoch-axes'].children[0].textContent, 'WCS unavailable');
  s.e['epoch-next'].events.click();
  assert.equal(s.e['epoch-axes'].children.length, 1);
  assert.equal(s.e['epoch-axes'].children[0].textContent, 'WCS unavailable');
});

const commonNormalization = { bunit: 'MJy/sr', lo: -2, hi: 6 };
const frameMap = () => ({ lo: -2, hi: 6, denominator: 8, stretch: 'asinh', a: 10, rounding: 'nearest_even' });
const colorBody = s => s.e['epoch-colorbar'].children.find(n => n.className === 'colorbar-body');
const colorTicks = s => colorBody(s).children.filter(n => n.className === 'colorbar-tick').map(n => n.textContent);

test('comparable sequence keeps a shared Color Bar through playback, zoom and mode switches', async () => {
  const s = setup({ mode: 'comparable_visualization', normalization: commonNormalization, frameNormalization: frameMap });
  await s.submit(); s.quick(3); await s.load();
  const ticks = colorTicks(s), ramp = Array.from(colorBody(s).children[0].frame.data), fetches = s.calls.length;
  assert.match(s.e['epoch-scale-note'].textContent, /^Asinh \(10x\)$/);
  s.e['epoch-play'].events.click(); s.intervals.values().next().value.fn();
  assert.deepEqual(colorTicks(s), ticks); assert.deepEqual(Array.from(colorBody(s).children[0].frame.data), ramp);
  s.e['epoch-zoom'].value = '32'; s.e['epoch-zoom'].events.input(); assert.deepEqual(colorTicks(s), ticks);
  s.e['epoch-time'].value = '2'; s.e['epoch-time'].events.input(); assert.deepEqual(colorTicks(s), ticks);
  s.e['explorer-mode'].value = 'preview'; s.e['explorer-mode'].events.change();
  s.e['explorer-mode'].value = 'epochs'; s.e['explorer-mode'].events.change(); assert.deepEqual(colorTicks(s), ticks);
  assert.equal(s.calls.length, fetches);
  await s.submit(); assert.equal(s.e['epoch-colorbar'].children.length, 0);
});

test('browse Color Bar follows each physical range and stretch in sorted timeline order', async () => {
  const s = setup({ reverseDates: true, normalization: { bunit: 'MJy/sr' }, frameNormalization: i =>
    i === 0 ? frameMap() : { lo: 0, hi: 4, denominator: 4, stretch: 'linear', rounding: 'nearest_even' } });
  await s.submit(); s.quick(2); await s.load();
  assert.match(s.e['epoch-current'].textContent, /slot 1/);
  assert.deepEqual(colorTicks(s), ['0', '1', '2', '3', '4']);
  assert.match(s.e['epoch-scale-note'].textContent, /^Linear$/);
  const wcs = JSON.stringify(s.e['epoch-axes'].children), fetches = s.calls.length;
  s.e['epoch-next'].events.click();
  assert.deepEqual(colorTicks(s), ['-2', '0', '2', '4', '6']);
  assert.match(s.e['epoch-scale-note'].textContent, /Asinh \(10x\)/);
  assert.equal(JSON.stringify(s.e['epoch-axes'].children), wcs);
  assert.equal(s.calls.length, fetches);
});

test('failed slots, missing normalization and inconsistent common scales never show a guessed bar', async () => {
  const failed = setup({ failed: true, normalization: commonNormalization, frameNormalization: frameMap });
  await failed.submit(); failed.quick(2); await failed.load();
  assert.ok(colorBody(failed)); failed.e['epoch-next'].events.click();
  assert.equal(colorBody(failed), undefined);
  assert.equal(failed.e['epoch-colorbar'].children[1].textContent, 'Color Bar unavailable');
  const missing = setup(); await missing.submit(); missing.quick(2); await missing.load();
  assert.equal(colorBody(missing), undefined);
  const inconsistent = setup({ mode: 'comparable_visualization', normalization: commonNormalization,
    frameNormalization: i => ({ ...frameMap(), hi: i === 1 ? 5 : 6 }) });
  await inconsistent.submit(); inconsistent.quick(2); await inconsistent.load();
  assert.equal(colorBody(inconsistent), undefined);
});

test('English epoch states, missing metadata and image descriptions preserve sequence data', async () => {
  const missing = product('missing', 0);
  delete missing.t_min;
  delete missing.source_collections;
  const s = setup({ available: [missing, product('known', 1)] });
  assert.equal(s.e.search.textContent, 'Search epochs');
  const pending = s.submit();
  assert.equal(s.e.search.textContent, 'Processing multi-epoch data…');
  assert.match(s.e['epochs-status'].textContent, /Searching epoch metadata without downloading FITS/);
  await pending;
  const row = s.e['epoch-products'].children.find(row => row.dataset.productId === 'missing');
  assert.equal(row.children[1].textContent, 'Time not available');
  assert.match(row.children[4].children[0].children[1].textContent, /^Not available/);
  assert.match(s.e['epochs-status'].textContent, /Found 2 products/);
  s.quick(2); await s.load();
  assert.match(s.e['epoch-selection'].textContent, /Selected 2 \/ 3/);
  assert.match(s.e['epoch-image'].children[0].alt, /Aligned observation/);
  assert.match(s.e['sequence-details'].textContent, /offline playback/);
  assert.match(s.e['epochs-status'].textContent, /Loaded 2 of 2 frames. Ready to explore/);
  assert.match(s.e['sequence-mode'].textContent, /Observations aligned on a common sky grid/);
  assert.equal(s.e['epoch-raw'], undefined);
  for (const id of ['epochs-status', 'epochs-sources', 'epoch-selection', 'sequence-details', 'sequence-mode', 'epoch-current']) {
    assert.doesNotMatch(s.e[id].textContent, /\p{Script=Han}/u, id);
  }
  assert.equal(s.calls.length, 4);
});
test('2–3 products: same detector, distinct exposures, alternatives and fourth hidden', async () => {
  const s = setup(); await s.submit(); s.choose('late');
  assert.equal(s.check('d2'), undefined); assert.equal(s.check('alternative'), undefined);
  assert.equal(s.e['load-frames'].disabled, true);
  s.choose('early'); assert.equal(s.e['load-frames'].disabled, false); s.choose('middle');
  assert.equal(s.check('fourth'), undefined);
  await s.load(); assert.deepEqual(JSON.parse(s.calls[1].body), { search_id: sid, product_ids: ['early', 'middle', 'late'] });
  assert.equal(s.calls.filter(c => c.method === 'GET').length, 3);
  assert.match(s.e['epoch-position'].textContent,/2025-01-01/);assert.match(s.e['epoch-current'].textContent,/unverified/);assert.ok(s.e['epoch-metadata'].children.some(n=>n.textContent==='0.021'));
});
test('play, pause, speed, slider and zoom reuse loaded PNG nodes with zero extra fetches', async () => {
  const s = setup(); await s.submit(); s.choose('late'); s.choose('early'); await s.load();
  const count = s.calls.length, nodes = [...s.urls];
  s.e['epoch-play'].events.click(); assert.equal(s.intervals.size, 1); assert.equal(s.e['epoch-play'].textContent, 'Pause');
  s.intervals.values().next().value.fn(); assert.match(s.e['epoch-current'].textContent, /slot 1/);
  s.e['epoch-speed'].value = '500'; s.e['epoch-speed'].events.change(); assert.equal(s.intervals.values().next().value.ms, 500);
  s.e['epoch-play'].events.click(); assert.equal(s.intervals.size, 0); assert.equal(s.e['epoch-play'].textContent, 'Play');
  s.e['epoch-play'].events.click(); s.e['epoch-time'].value = '0'; s.e['epoch-time'].events.input(); assert.equal(s.intervals.size, 0);
  s.e['epoch-next'].events.click(); s.e['epoch-prev'].events.click();
  s.e['epoch-zoom'].value = '20'; s.e['epoch-zoom'].events.input();
  assert.equal(s.e['epoch-image'].children[0].style.width, '580px');
  assert.equal(s.calls.length, count); assert.deepEqual(s.urls, nodes);
  assert.match(s.e['sequence-mode'].textContent, /Observations aligned on a common sky grid/);
  s.e['epoch-play'].events.click(); s.e['explorer-mode'].value = 'preview'; s.e['explorer-mode'].events.change();
  assert.equal(s.intervals.size, 0); assert.equal(s.e['preview-panel'].hidden, false);
  assert.equal(s.timeouts.size, 0);
});
test('failed slot retains index/date/reason and is visited during playback', async () => {
  const s = setup({ failed: true }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  assert.equal(s.e['epoch-slots'].children.length, 2);
  s.e['epoch-play'].events.click(); s.intervals.values().next().value.fn();
  assert.match(s.e['epoch-current'].textContent, /slot 1.*cutout_failed.*kept failure slot/);
  assert.match(s.e['epoch-image'].children[0].textContent, /Cannot display/);
  assert.equal(s.calls.length, 3);
});
test('all failed slots stay visible and playback disabled', async () => {
  const s = setup({ allFailed: true }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  assert.equal(s.e['epoch-slots'].children.length, 2); assert.equal(s.e['epoch-play'].disabled, true); assert.equal(s.calls.length, 2);
});
test('shared scale is clear without repeating the analysis scope note', async () => {
  const s = setup({ mode: 'comparable_visualization' }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  assert.match(s.e['sequence-mode'].textContent, /Observations aligned on a common sky grid/);
  assert.equal(s.e['sequence-warning'].textContent, 'Shared brightness scale.');
  assert.doesNotMatch(s.e['sequence-mode'].textContent, /comparable_visualization|photometr/);
});

test('general analysis scope stays in Details while incompatibilities and unknown warnings stay visible', async () => {
  const general = 'Visualization only; target bandpass is not full-field equivalence. No PSF/background/variance correction or light-curve inference.';
  const unusual = 'Unexpected quality condition; review this observation.';
  const s = setup({ sequenceInfo: { wavelength_compatible:false, calibration_compatible:false, warnings:[general, unusual, unusual] },
    frameInfo: { warnings:['Flagged region near target.', 'Flagged region near target.'], calibration:{warning:'Flagged region near target.'} } });
  await s.submit(); s.quick(2); await s.load();
  const main = s.e['sequence-warning'].textContent;
  assert.match(main, /Independent brightness scales; displayed intensities are not directly comparable/);
  assert.match(main, /Wavelengths are not compatible for direct comparison/);
  assert.match(main, /Calibrations are not compatible for direct comparison/);
  assert.equal(main.split(unusual).length - 1, 1);
  assert.doesNotMatch(main, /Visualization only|PSF|photometr|infer variability/);
  const details = s.e['sequence-metadata'].children.map(n => n.textContent).join(' ');
  assert.match(details, /Wavelength matching applies at the target position, not across the whole image/);
  assert.match(details, /image sharpness, background and measurement uncertainty are not corrected/);
  assert.ok(details.includes(unusual));
  assert.equal(s.e['epoch-frame-warnings'].textContent, 'Flagged region near target.');
  assert.equal(s.calls.length, 4, 'wording and deduplication add no requests');
});
test('expired search disables loading and instructs explicit fresh search', async () => {
  const s = setup({ apiError: 'search_expired' }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  assert.match(s.e['epochs-status'].textContent, /search_expired.*Search epochs again/); assert.equal(s.e['load-frames'].disabled, true); assert.equal(s.calls.length, 2);
});
test('missing cached PNG keeps slots and asks for requery without automatic retries', async () => {
  const s = setup({ pngError: true }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  assert.match(s.e['epoch-current'].textContent, /frame_not_found.*Search epochs again/); assert.equal(s.e['epoch-slots'].children.length, 2); assert.equal(s.calls.length, 4);
});
test('pagination keeps snapshot query even when form changed; fresh search revokes blob URLs', async () => {
  const s = setup({ page: true }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  s.e.ra.value = '10'; await s.e['epochs-more'].events.click();
  assert.equal(JSON.parse(s.calls.at(-1).body).ra, 127.69444); assert.equal(JSON.parse(s.calls.at(-1).body).cursor, 'cursor');
  await s.submit(); assert.equal(s.revoked.length, 2); assert.match(s.e['epoch-selection'].textContent, /Selected 0/);
});
for (const [options, pattern] of [[{ malformed: true }, /JSON/], [{ network: true }, /Check your connection/]]) {
  test(`search error ${pattern} releases controls`, async () => { const s = setup(options); await s.submit(); assert.match(s.e['epochs-status'].textContent, pattern); assert.equal(s.e.search.disabled, false); assert.equal(s.timeouts.size, 0); });
}
test('API timeout is bounded and releases controls', async () => {
  const s = setup({ hang: true }); const pending = s.submit(); s.timeouts.values().next().value.fn(); await pending;
  assert.match(s.e['epochs-status'].textContent, /timed out/); assert.equal(s.e.search.disabled, false); assert.equal(s.timeouts.size, 0);
});
test('invalid coordinates issue no requests', async () => { const s = setup(); s.e.ra.value = '360'; await s.submit(); assert.equal(s.calls.length, 0); assert.match(s.e['epochs-status'].textContent, /coordinates/); });
test('timeline sorts actual FITS UTC dates while retaining original backend slot identity', async () => {
  const s = setup({ reverseDates: true }); await s.submit(); s.choose('early'); s.choose('middle'); s.choose('late'); await s.load();
  assert.match(s.e['epoch-current'].textContent,/slot 2/);assert.match(s.e['epoch-position'].textContent,/2025-01-01/);assert.ok(s.e['epoch-metadata'].children.some(n=>n.textContent==='late'));
  s.e['epoch-next'].events.click(); assert.match(s.e['epoch-current'].textContent,/slot 1/);assert.match(s.e['epoch-position'].textContent,/2025-01-02/);assert.ok(s.e['epoch-metadata'].children.some(n=>n.textContent==='middle'));
  s.e['epoch-next'].events.click(); assert.match(s.e['epoch-current'].textContent,/slot 0/);assert.match(s.e['epoch-position'].textContent,/2025-01-03/);assert.ok(s.e['epoch-metadata'].children.some(n=>n.textContent==='early'));
  assert.equal(s.calls.length, 5);
});
test('busy error exposes Retry-After and never automatically retries', async () => {
  const s = setup({ apiError: 'busy' }); await s.submit(); s.choose('early'); s.choose('late'); await s.load();
  assert.match(s.e['epochs-status'].textContent, /busy.*Retry-After: 5/); assert.equal(s.calls.length, 2); assert.equal(s.e['load-frames'].disabled, false);
});

test('main list hides invalid candidates and keeps one representative per exposure', async () => {
  const invalid = [product('unknown-detector', -1, null), product('missing-obs', -1, 1, null), product('empty-obs', -1, 1, ''), product('whitespace-obs', -1, 1, '  '), product('unknown-obs', -1, 1, 'UNKNOWN'), product('unknown-epoch', -1, 1, 'unknown-product'), product('missing-product', -1)];
  invalid.at(-1).product_id = '';
  const s = setup({ available: [...invalid, ...candidates] }); await s.submit();
  assert.deepEqual(s.visibleIds(), ['early', 'middle', 'fourth', 'd2', 'late']);
  assert.ok(s.e['epoch-products'].children.every(row => !row.children[0].children[0].disabled));
  s.choose('late'); assert.deepEqual(s.visibleIds(), ['early', 'middle', 'fourth', 'late']);
  s.choose('early'); s.choose('middle'); assert.deepEqual(s.visibleIds(), ['early', 'middle', 'late']);
  s.choose('late'); assert.ok(s.check('fourth')); assert.equal(s.check('d2'), undefined);
  s.choose('early'); s.choose('middle'); assert.ok(s.check('d2'));
  assert.equal(s.calls.length, 1);
});

for (const count of [2, 3]) {
  test(`Select first ${count} selects only legal visible products and Load frames sends exactly those IDs`, async () => {
    const s = setup(); await s.submit(); s.quick(count);
    const expected = ['early', 'middle', 'fourth'].slice(0, count);
    assert.deepEqual(s.visibleIds().filter(id => s.check(id).checked), expected);
    assert.equal(s.check('d2'), undefined); assert.equal(s.check('alternative'), undefined);
    assert.equal(s.calls.length, 1); // Quick selection itself never loads frames.
    await s.load(); assert.deepEqual(JSON.parse(s.calls[1].body), { search_id: sid, product_ids: expected });
    const fetches = s.calls.length;
    s.e['epoch-play'].events.click(); s.intervals.values().next().value.fn();
    s.e['epoch-time'].value = '0'; s.e['epoch-time'].events.input();
    s.e['epoch-next'].events.click(); s.e['epoch-prev'].events.click();
    s.e['explorer-mode'].value = 'preview'; s.e['explorer-mode'].events.change();
    s.e['explorer-mode'].value = 'epochs'; s.e['explorer-mode'].events.change();
    assert.equal(s.calls.length, fetches);
  });
}

test('quick selection uses the visible detector and cannot mix or select too few exposures', async () => {
  const s = setup(); await s.submit(); s.choose('d2');
  assert.deepEqual(s.visibleIds(), ['d2']);
  assert.equal(s.e['select-first-2'].disabled, true); assert.equal(s.e['select-first-3'].disabled, true);
  s.quick(2); s.quick(3); assert.equal(s.check('d2').checked, true); assert.equal(s.e['load-frames'].disabled, true);
  s.choose('d2'); s.choose('late'); s.quick(3);
  assert.deepEqual(s.visibleIds(), ['early', 'middle', 'fourth']);
  s.quick(2); assert.deepEqual(s.visibleIds().filter(id => s.check(id).checked), ['early', 'middle']);
  assert.ok(s.check('late')); assert.equal(s.calls.length, 1);
});

test('quick selection is unavailable without candidates, while loading, and after search expiry', async () => {
  const empty = setup({ available: [] }); await empty.submit();
  assert.deepEqual(empty.visibleIds(), []); assert.equal(empty.e['select-first-2'].disabled, true); assert.equal(empty.e['select-first-3'].disabled, true);
  const s = setup({ apiError: 'search_expired' }); await s.submit(); s.quick(2);
  const pending = s.load();
  assert.equal(s.e['select-first-2'].disabled, true); assert.equal(s.e['select-first-3'].disabled, true);
  s.quick(3); await pending;
  assert.deepEqual(JSON.parse(s.calls[1].body).product_ids, ['early', 'middle']);
  assert.deepEqual(s.visibleIds(), []); assert.equal(s.e['select-first-2'].disabled, true); assert.equal(s.e['select-first-3'].disabled, true);
});

test('sequence Fit and Resize keep geometry aligned, manual zoom persistent, and cached playback request-free', async () => {
  const s = setup({ failed: true }); await s.submit(); s.quick(3); await s.load();
  const e = s.e, requests = s.calls.length;
  assert.equal(e['epoch-fit-view'].attrs['aria-pressed'], 'true');
  const initial = parseFloat(e['epoch-image'].style.width);
  e['epoch-viewport'].clientWidth = 320; e['epoch-viewport'].clientHeight = 400; s.resize();
  assert.ok(parseFloat(e['epoch-image'].style.width) < initial);
  assert.ok(parseFloat(e['epoch-frame'].style.width) <= 320);
  assert.ok(parseFloat(e['epoch-frame'].style.height) <= 400);
  const axes = JSON.stringify(e['epoch-axes'].children);
  e['epoch-next'].events.click(); // Failed slot still uses the common grid.
  assert.equal(JSON.stringify(e['epoch-axes'].children), axes);
  e['epoch-zoom'].value = '32'; e['epoch-zoom'].events.input();
  e['epoch-viewport'].clientWidth = 600; s.resize();
  assert.equal(e['epoch-image'].style.width, '928px');
  e['explorer-mode'].value = 'preview'; e['explorer-mode'].events.change();
  assert.equal(e['epoch-view-panel'].hidden, true);
  assert.equal(e['preview-display-controls'].hidden, false);
  e['explorer-mode'].value = 'epochs'; e['explorer-mode'].events.change();
  assert.equal(e['epoch-image'].style.width, '928px');
  assert.equal(e['preview-summary'].hidden, true);
  e['epoch-fit-view'].events.click();
  e['epoch-time'].value = '2'; e['epoch-time'].events.input();
  e['epoch-play'].events.click(); s.intervals.values().next().value.fn();
  assert.equal(s.calls.length, requests);
});

test('candidate rows disclose scientific status and failure reasons without changing selection', async () => {
  const p = { ...product('long-product-id-'.repeat(15),0), frame_status: 'failed',
    calibration_status: 'unverified', alignment: { status: 'unqualified', reason: 'Alignment caveat' },
    warnings: ['Scientific limitation'], error: { code: 'test_failure', message: 'Full failure reason' } };
  const s = setup({ available: [p, product('second',1)] }); await s.submit();
  const row = s.e['epoch-products'].children[0], disclosure = row.children[4].children[0];
  assert.equal(row.children.length, 5);
  assert.match(row.children[3].textContent, /^failed; review details$/);
  assert.doesNotMatch(row.children[3].textContent, /long-product-id|Scientific limitation/);
  assert.equal(disclosure.children[0].textContent, 'Details');
  const text = disclosure.children[2].children.map(n => n.textContent).join(' ');
  for (const value of ['unverified', 'unqualified', 'Alignment caveat', 'Scientific limitation', 'test_failure', 'Full failure reason']) assert.ok(text.includes(value), value);
  s.quick(2); await s.load();
  assert.deepEqual(JSON.parse(s.calls[1].body).product_ids, [p.product_id,'second']);
});

test('compact sequence summary follows frames, exposes failed slots, and hides with Preview without requests', async () => {
  const s = setup({ failed: true }); await s.submit(); s.quick(3); await s.load();
  const count = s.calls.length, e = s.e, labels = () => e['epoch-summary'].children.filter((_, i) => i % 2 === 0).map(n => n.textContent);
  assert.deepEqual(labels(), ['Observation UTC','Detector','Wavelength (μm)','Status']);
  assert.ok(!e['epoch-summary'].children.some(n => n.textContent === 'Valid pixel count'), 'missing per-frame counts are hidden, never guessed');
  assert.equal(e['epoch-information'].hidden, false);
  assert.match(e['sequence-warning'].textContent, /Independent brightness scales; displayed intensities are not directly comparable/);
  e['epoch-next'].events.click();
  assert.match(e['epoch-frame-status'].textContent, /Frame 2.*failed.*cutout_failed.*kept failure slot/);
  assert.match(e['epoch-summary'].children.at(-1).textContent, /Failed:.*kept failure slot/);
  assert.equal(e['epoch-slots'].children.length, 3);
  assert.ok(e['epoch-metadata'].children.some(n => String(n.textContent).includes('kept failure slot')));
  assert.equal(e['epoch-raw'], undefined);
  e['explorer-mode'].value = 'preview'; e['explorer-mode'].events.change();
  assert.equal(e['epoch-information'].hidden, true);
  e['explorer-mode'].value = 'epochs'; e['explorer-mode'].events.change();
  assert.equal(e['epoch-information'].hidden, false);
  assert.equal(s.calls.length, count);
});


test('modal auto-opens only for results; close, cancel and Escape preserve selections and restore focus/scroll', async () => {
  const s = setup(); await s.submit();
  const e = s.e, modal = e['observations-modal'];
  assert.equal(modal.open, true);
  s.quick(2); const ids = s.visibleIds();
  for (const close of [() => e['observations-close'].events.click(), () => e['observations-cancel'].events.click(), () => modal.events.cancel({ preventDefault() {} })]) {
    close(); assert.equal(modal.open, false); assert.deepEqual(s.visibleIds(), ids);
    assert.equal(s.document.body.style.overflow, undefined);
    assert.equal(s.document.activeElement, e['change-selection']);
    e['change-selection'].events.click(); assert.equal(modal.open, true);
  }
  assert.equal(s.calls.length, 1);
  assert.match(e['epoch-selection'].textContent, /Selected 2/);
  const empty = setup({ available: [] }); await empty.submit(); assert.ok(!empty.e['observations-modal'].open);
});

test('Change Selection reuses snapshot and unchanged set never reloads; cancel leaves player running', async () => {
  const s = setup(); await s.submit(); s.quick(2); await s.load();
  const e = s.e, before = s.calls.length, image = e['epoch-image'].children[0];
  assert.equal(e['change-selection'].hidden, false); assert.equal(e['observations-modal'].open, false);
  e['epoch-play'].events.click();
  e['change-selection'].events.click(); s.choose('early'); s.choose('fourth');
  e['observations-cancel'].events.click();
  assert.equal(e['epoch-image'].children[0], image); assert.equal(s.intervals.size, 1);
  e['change-selection'].events.click(); s.choose('fourth'); s.choose('early'); await s.load();
  assert.equal(s.calls.length, before); assert.equal(s.intervals.size, 1);
  e['change-selection'].events.click(); s.choose('early'); s.choose('fourth'); await s.load();
  assert.equal(s.calls.filter(c => c.url.endsWith('/epochs/search')).length, 1);
  assert.equal(s.calls.filter(c => c.url.endsWith('/epoch-frames')).length, 2);
  assert.equal(s.revoked.length, 2);
});

for (const failure of ['busy', 'search_expired', 'all-slots']) test(`replacement ${failure} retains old successful image`, async () => {
  const s = setup(); await s.submit(); s.quick(2); await s.load();
  const e = s.e, image = e['epoch-image'].children[0];
  e['change-selection'].events.click(); s.choose('early'); s.choose('fourth');
  if (failure === 'all-slots') s.failAll(); else s.setError(failure);
  await s.load();
  assert.equal(e['epoch-image'].children[0], image); assert.equal(e['epoch-player'].hidden, false);
  assert.equal(s.revoked.length, 0);
  if (failure === 'search_expired') { assert.match(e['modal-status'].textContent, /Search epochs again/); assert.equal(e['load-frames'].disabled, true); }
  if (failure === 'all-slots') assert.match(e['modal-status'].textContent, /Previous images are retained/);
});

test('known expired snapshot never reaches frame API', async () => {
  const s = setup({ expiresAt: '2000-01-01T00:00:00Z' }); await s.submit(); s.quick(2); await s.load();
  assert.equal(s.calls.length, 1); assert.match(s.e['modal-status'].textContent, /expired.*Search epochs again/);
});

const displayFixture = i => ({ available:true, shape:[1,3], unit:'MJy/sr', values:[-2,null,6+i], valid:[true,false,true], min:-2,max:6+i,lo:-2,hi:6+i, histogram:{ counts:[1,1], edges:[-2,2,6+i] } });
for (const method of ['log','sqrt']) for (const mode of ['comparable_visualization','observation_browse']) test(`${method} ${mode} preserves Histogram and range semantics with no requests`, async () => {
  const s = setup({ mode, normalization:commonNormalization, frameNormalization:frameMap,
    frameDisplay: mode === 'comparable_visualization' ? () => displayFixture(0) : displayFixture });
  await s.submit(); s.quick(2); await s.load(); const e=s.e, count=s.calls.length;
  const hist=JSON.stringify(e['epoch-histogram-x'].children);
  e['epoch-stretch'].value=method; e['epoch-minimum'].value='-4'; e['epoch-maximum'].value='10'; e['epoch-stretch'].events.change();
  assert.match(e['epoch-scale-note'].textContent,method === 'sqrt' ? /Sqrt/ : /Log/);
  assert.equal(JSON.stringify(e['epoch-histogram-x'].children),hist);
  assert.deepEqual(colorTicks(s), ['-4','-0.5','3','6.5','10']);
  e['epoch-next'].events.click();
  assert.equal(e['epoch-minimum'].value, mode === 'comparable_visualization' ? '-4' : '-2');
  assert.equal(e['epoch-maximum'].value, mode === 'comparable_visualization' ? '10' : '7');
  assert.match(e['epoch-scale-note'].textContent,method === 'sqrt' ? /Sqrt/ : /Log/);
  e['epoch-prev'].events.click(); assert.equal(e['epoch-maximum'].value,'10');
  const ticks=colorTicks(s); e['epoch-minimum'].value='10'; e['epoch-maximum'].value='10'; e['epoch-minimum'].events.change();
  assert.deepEqual(colorTicks(s),ticks); assert.match(e['epoch-brightness-status'].textContent,/maximum must exceed/);
  assert.equal(s.calls.length,count);
});


test('Clear is local and Cancel during replacement processing keeps the old player', async () => {
  const s=setup(); await s.submit(); s.quick(2); await s.load(); const e=s.e, image=e['epoch-image'].children[0];
  e['change-selection'].events.click(); e['clear-selection'].events.click();
  assert.equal(e['load-frames'].disabled,true); assert.match(e['epoch-selection'].textContent,/Selected 0/);
  s.quick(3); const before=s.calls.length, pending=s.load(); e['observations-cancel'].events.click(); await pending;
  assert.equal(e['epoch-image'].children[0],image); assert.equal(s.revoked.length,0);
  assert.equal(s.calls.length,before+1,'Cancelled manifest does not start PNG requests');
  assert.match(e['epochs-status'].textContent,/cancelled.*Previous images are retained/);
});

test('Viewer selection entry has initial guidance and transitions without exposing internal search details', async () => {
  const s=setup(),e=s.e;assert.equal(e['change-selection'].disabled,true);assert.equal(e['change-selection'].textContent,'Select Observations');assert.match(e['change-selection'].title,/Search epochs first/);
  await s.submit();assert.equal(e['change-selection'].disabled,false);assert.doesNotMatch(e['epochs-sources'].textContent,/Search snapshot|Snapshot expires|http|Search ID/);s.quick(2);await s.load();assert.equal(e['change-selection'].textContent,'Change Selection');
  assert.equal(e['epoch-metadata'].children.some(n=>/product id|wcs|search id|normalization|history/i.test(n.textContent)),false);
});
test('Multi-epoch image alone supports click zoom with synchronized controls and no new requests', async () => {
  const s=setup();await s.submit();s.quick(2);await s.load();const e=s.e,image=e['epoch-image'].children[0],v=e['epoch-viewport'],count=s.calls.length;
  v.scrollLeft=v.scrollTop=0;const fit=Number(e['epoch-zoom'].value);
  v.events.click({target:e['epoch-axes']});assert.equal(Number(e['epoch-zoom'].value),fit);
  v.events.click({target:image,clientX:200,clientY:200});assert.ok(Math.abs(Number(e['epoch-zoom'].value)-Math.min(32,fit*1.5))<1e-9);
  assert.equal(e['epoch-zoom-value'].textContent,e['epoch-zoom'].value+'×');
  e['epoch-fit-view'].events.click();assert.match(e['epoch-zoom-value'].textContent,/Fit/);assert.equal(s.calls.length,count);
});

test('sequence summary reports the supplied valid fraction as a percentage when no count is supplied', async () => {
  const s=setup({available:[{...product('first',0),valid_fraction:.875},product('second',1)]});
  await s.submit();s.quick(2);await s.load();
  const fields=s.e['epoch-summary'].children.map(n=>n.textContent);
  assert.equal(fields[6],'Valid pixels (%)');assert.equal(fields[7],'87.5');
});


test('Multi-epoch retains actual compatibility, quality, zero counts, and failed-slot reasons', async () => {
  const s=setup({ failed:true, sequenceInfo:{wavelength_compatible:false,calibration_compatible:true,warnings:['Different wavelengths cannot be compared directly.']}, frameInfo:{valid_pixels:0,alignment:{status:'failed',reason:'Insufficient reference stars'},display:{available:false,reason:'No valid samples'},wcs_axes:{available:false}} });
  await s.submit(); s.quick(3); await s.load();
  const text=s.e['epoch-metadata'].children.map(n=>n.textContent).join(' ');
  assert.match(text,/Alignment status failed/); assert.match(text,/Wavelength compatibility Not compatible/);
  assert.match(text,/Calibration compatibility Compatible/); assert.match(text,/Data quality No valid samples/);
  assert.match(text,/WCS status WCS unavailable/); assert.match(text,/Insufficient reference stars/);
  assert.match(s.e['sequence-warning'].textContent,/Different wavelengths cannot be compared directly/);
  assert.match(s.e['epoch-summary'].children.map(n=>n.textContent).join(' '),/Valid pixel count 0/);
  assert.match(s.e['epochs-sources'].textContent,/Search incomplete/);
  s.e['epoch-next'].events.click(); assert.match(s.e['epoch-frame-status'].textContent,/failed.*kept failure slot/);
});

test('Multi-epoch missing compatibility and warnings never becomes a positive result', async () => {
  const s=setup({frameInfo:{alignment:null,error:null}}); await s.submit(); s.quick(2); await s.load();
  const text=['sequence-metadata','epoch-metadata'].map(id=>s.e[id].children.map(n=>n.textContent).join(' ')).join(' ');
  assert.doesNotMatch(text,/Alignment status|compatibility|Warnings|Failure reason|Not available|Compatible|Pass|No warnings/i);
  assert.equal(s.e['sequence-metadata'].hidden,true);
  assert.match(s.e['sequence-warning'].textContent,/Independent brightness scales; displayed intensities are not directly comparable/);
});
