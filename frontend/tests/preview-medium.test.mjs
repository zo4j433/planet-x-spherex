import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { axesFixture } from './axes-fixture.mjs';
import { parseHtml, elements, byId, normalizedText, claim } from './html-fixture.mjs';

function factory(name) {
  const url = new URL(name,import.meta.url);
  const source = readFileSync(url,'utf8').split('\ntest(')[0]
    .replace(/^import .*;\r?$/gm,'').replaceAll('import.meta.url',JSON.stringify(url.href));
  const context = {vm,readFileSync,assert,axesFixture,URL,URLSearchParams,AbortController,queueMicrotask};
  vm.runInNewContext(source+'\nglobalThis.factory=setup;',context);
  return context.factory;
}
const setup = factory('./app.test.mjs');
const metadata = {cutout_profile:'medium',requested_cutout_arcmin:6.5,actual_shape_yx:[63,65],
  wcs_field:{available:true,horizontal_arcmin:6.66,vertical_arcmin:6.45,
    coverage_note:'Actual returned field; full requested coverage is not guaranteed.',method:'sampled spherical path'},
  display:{available:true,shape:[2,2],values:[-5,0,5,null],valid:[true,true,true,false],flags:[0,0,0,64],
    lo:-5,hi:5,min:-5,max:5,unit:'MJy/sr',histogram:{counts:[1,1,1],edges:[-5,0,5,10]}}};
function response() { return {ok:true,status:200,json:async()=>({metadata,
  image_url:`/api/images/${'a'.repeat(32)}.png`,inverted_image_url:`/api/images/${'a'.repeat(32)}-inverse.png`})}; }

test('default Small remains legacy payload; changing field triggers exactly one fresh Preview',async()=>{
  const s = setup({response:response()});
  await s.submit();
  assert.equal(JSON.parse(s.calls[0][1].body).cutout_profile,undefined);
  s.e['cutout-profile'].value='medium';
  await s.e['cutout-profile'].events.change();
  assert.equal(s.calls.length,2);
  assert.deepEqual(JSON.parse(s.calls[1][1].body),{ra:127.69444,dec:-39.1776,radius_deg:.01,cutout_profile:'medium'});
  assert.equal(s.e.status.dataset.state,'success');
  const details = s.e['preview-cutout-details'].textContent;
  assert.match(details,/6.5 arcmin \(medium\)/);
  assert.match(details,/63 × 65/);
  assert.match(details,/6.66 × 6.45 arcmin/);
  const count = s.calls.length;
  for (const stretch of ['linear','asinh','log','sqrt']) { s.e.stretch.value=stretch; s.e.stretch.events.change(); }
  s.e.zoom.value='4'; s.e.zoom.events.input(); s.e['fit-view'].events.click();
  await s.e.white.events.click(); await s.e.black.events.click();
  assert.equal(s.calls.length,count);
  s.e['cutout-profile'].value='small'; await s.e['cutout-profile'].events.change();
  assert.equal(s.calls.length,count+1);
  assert.equal(JSON.parse(s.calls.at(-1)[1].body).cutout_profile,undefined);
});

test('first selection waits for Search; invalid profile and loading changes cannot issue requests',async()=>{
  const s=setup({response:response()});
  s.e['cutout-profile'].value='medium'; await s.e['cutout-profile'].events.change();
  assert.equal(s.calls.length,0);
  await s.submit(); assert.equal(JSON.parse(s.calls[0][1].body).cutout_profile,'medium');
  s.e['cutout-profile'].value='large'; await s.e['cutout-profile'].events.change();
  assert.equal(s.calls.length,1); assert.equal(s.e.status.dataset.state,'error');
  const loading=setup({hang:true}); loading.e['cutout-profile'].value='medium';
  const pending=loading.submit();
  assert.equal(loading.e['cutout-profile'].disabled,true);
  await loading.e['cutout-profile'].events.change(); assert.equal(loading.calls.length,1);
  [...loading.timers.values()].find(t=>t.ms===180000).fn(); await pending;
  assert.equal(loading.e['cutout-profile'].disabled,false);
});

test('Multi-epoch ignores Preview selection and stays on its original request contract',async()=>{
  const s=factory('./epochs.test.mjs')();
  s.e['cutout-profile'].value='medium'; await s.submit();
  assert.equal(JSON.parse(s.calls[0].body).cutout_profile,undefined);
  s.quick(2); await s.load();
  const count=s.calls.length;
  await s.e['cutout-profile'].events.change();
  assert.equal(s.calls.length,count);
  assert.equal(JSON.parse(s.calls.find(c=>c.url.endsWith('/api/epoch-frames')).body).cutout_profile,undefined);
});

test('only bounded angular options are offered and labels distinguish magnification',()=>{
  const root=parseHtml(readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  const select=byId(root,'cutout-profile');
  assert.equal(select.tag,'select');
  const options=elements(select,node=>node.tag==='option');
  assert.deepEqual(options.map(node=>node.attrs.value),['small','medium']);
  assert.deepEqual(options.filter(node=>'selected' in node.attrs).map(node=>node.attrs.value),['small']);
  const label=elements(root,node=>node.tag==='label' && node.attrs.for==='radius');
  assert.equal(label.length,1);
  assert.match(normalizedText(label[0]),/\b(?:radius|search area)\b.*\barcmin\b/);
  assert.equal(select.attrs['aria-describedby'],'cutout-size-note');
  const note={children:[byId(root,'cutout-size-note')]};
  claim(note,/^(?:.* )?actual (?:shape and field|field and shape) depend on fits wcs and irsa cropping$/, 'Actual cutout dimensions depend on FITS/WCS and IRSA cropping');
  claim(note,/^zoom and fit (?:change|adjust) (?:display magnification only|only display magnification)$/, 'Zoom/Fit affect display magnification only');
});
