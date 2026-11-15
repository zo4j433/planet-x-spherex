import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { axesFixture } from './axes-fixture.mjs';
import { parseHtml, elements, textContent } from './html-fixture.mjs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const context = { window: {} };
for (const file of ['wcs-axes.js', 'color-bar.js']) vm.runInNewContext(read(file), context);
vm.runInNewContext(read('app.js').split('/* Existing preview/PNG endpoints')[0], context);
const { SpherexView: view, SpherexAxes: axes, SpherexColorBar: bar } = context.window;

for (const [width, height] of [[29,29], [320,160], [100,600], [2048,2048]]) {
  for (const [availableWidth, availableHeight] of [[280,340], [440,360], [900,600], [1400,760]]) {
    test(`Fit includes full ${width}x${height} image and annotations in ${availableWidth}x${availableHeight}`, () => {
      const plan = view.fit(width, height, availableWidth, availableHeight);
      assert.ok(plan.factor > 0 && plan.stageScale > 0 && plan.stageScale <= 1);
      const model = axes.layout(null, width, height, plan.factor), size = bar.measure(model, false);
      assert.ok(size.width * plan.stageScale <= availableWidth + 1e-7);
      assert.ok(size.height * plan.stageScale <= availableHeight + 1e-7);
      assert.ok(Math.abs(model.width / model.height - width / height) < 1e-10);
      assert.ok(Math.max(model.width, model.height) * plan.stageScale > 90, 'narrow Fit must leave meaningful space for the image');
      assert.ok(size.width >= model.margin.left + model.width);
      assert.ok(size.height >= model.margin.top + model.height);
      assert.equal(size.left, model.margin.left + model.width + 30);
    });
  }
}

test('fractional Fit and manual scales preserve true WCS edge positions and Color Bar adjacency', () => {
  const metadata = axesFixture(), original = JSON.stringify(metadata);
  for (const factor of [view.fit(29,29,280,340).factor, .4, 1, 12, 32]) {
    const model = axes.layout(metadata,29,29,factor), size = bar.measure(model, false);
    assert.equal(model.available, true);
    for (const tick of model.ra) assert.equal(tick.position, (tick.pixel + .5) * factor);
    for (const tick of model.dec) assert.equal(tick.position, (29 - .5 - tick.pixel) * factor);
    assert.ok(Math.abs(size.left - model.margin.left - model.width - 30) < 1e-9);
  }
  assert.equal(JSON.stringify(metadata), original);
});

test('dashboard retains bounded image scrolling and explicit desktop/tablet/mobile grid rules', () => {
  const html = read('index.html'), css = read('styles.css');
  for (const id of ['preview-summary','epoch-view-panel','preview-display-controls','fit-view','epoch-fit-view']) assert.ok(html.includes(`id="${id}"`));
  assert.match(css, /\.viewport\s*\{[^}]*overflow:auto/);
  assert.match(css, /\.stage-frame\s*\{[^}]*overflow: hidden/);
  assert.match(css, /\.viewer\s*\{ grid-column: 2; grid-row: 1;/);
  assert.match(css, /min-width: 681px\) and \(max-width: 1099px/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /grid-template-columns: minmax\(0,1fr\)/);
  assert.doesNotMatch(html, /id="(?:epoch-)?zoom"[^>]*value="12"/);
});

function structure() {
  const nodes = new Map(), stack = [], voidTags = new Set(['meta','link','input','img','br','hr']);
  for (const [, closing, tag, attrs] of read('index.html').matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    if (closing) {
      assert.equal(stack.pop()?.tag, tag, `Mismatched HTML closing tag: ${tag}`);
      continue;
    }
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const node = { tag, attrs, parents: stack.map(parent => parent.id).filter(Boolean) };
    if (id) { assert.equal(nodes.has(id), false, `Duplicate ID ${id}`); nodes.set(id, node); }
    if (!voidTags.has(tag)) stack.push({ tag, id });
  }
  assert.equal(stack.length, 0);
  return nodes;
}

test('playback controls and Timeline are inside the image viewer; readable metadata is collapsed', () => {
  const nodes = structure();
  for (const id of ['epoch-prev','epoch-play','epoch-next','epoch-speed','epoch-time','epoch-frame-status']) {
    assert.ok(nodes.get(id).parents.includes('epoch-player'), id);
    assert.ok(nodes.get(id).parents.includes('epoch-view-panel'), id);
    assert.ok(!nodes.get(id).parents.includes('epochs-panel'), id);
  }
  for (const [id, disclosure] of [['metadata','preview-advanced'],['technical-metadata','preview-advanced'],['epoch-slots','epoch-advanced'],['sequence-metadata','epoch-advanced'],['epoch-metadata','epoch-advanced']]) {
    assert.ok(nodes.get(id).parents.includes(disclosure), id);
    assert.doesNotMatch(nodes.get(disclosure).attrs, /\bopen\b/);
  }
  for (const id of ['observation-summary','epoch-summary']) assert.ok(!nodes.get(id).parents.some(parent => parent.endsWith('advanced')));
  assert.ok(nodes.get('histogram').parents.includes('brightness-controls'));
  assert.doesNotMatch(nodes.get('brightness-controls').attrs, /\bopen\b/);
});

test('search remains ahead of disclosures and desktop sidebar has no inner scroll limit', () => {
  const html = read('index.html'), css = read('styles.css');
  const nodes = structure();
  for (const id of ['ra','dec','radius','detector','search']) assert.ok(nodes.get(id).parents.includes('search-form'));
  assert.ok(html.indexOf('id="search"') < html.indexOf('id="brightness-controls"'));
  assert.match(css, /\.search-fields\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  for (const [, rule] of css.matchAll(/\.controls-panel\s*\{([^}]+)\}/g)) {
    assert.doesNotMatch(rule, /overflow:\s*auto|max-height:\s*(?:calc|\d)/);
  }
});

test('moving scale explanations outside Fit provides a larger image without clipping its annotations', () => {
  const width = 29, height = 29, availableWidth = 900, availableHeight = 600;
  const plan = view.fit(width,height,availableWidth,availableHeight);
  const model = axes.layout(null,width,height,plan.factor);
  const compact = bar.measure(model,false), original = bar.measure(model,true);
  assert.ok(compact.height * plan.stageScale <= availableHeight);
  assert.ok(original.height * plan.stageScale > availableHeight, 'the old note reservation would require a smaller image');
  assert.ok(compact.height >= model.margin.top + model.height + model.margin.bottom);
  assert.ok(compact.width >= compact.left + 195);
});

test('desktop height budget reserves actual viewer chrome and safely scrolls short windows', () => {
  for (const height of [1080,864,900,768]) {
    for (const chrome of [180,320,420]) {
      const available = view.viewportHeight(height,114,chrome);
      assert.ok(available >= 300);
      if (available > 300) assert.ok(114 + chrome + available <= height - 16);
    }
  }
  assert.equal(view.viewportHeight(450,114,250),300);
  assert.ok(114 + 250 + 300 > 450, 'short windows must scroll instead of hiding content');
});

test('presentation is compact English, with readable metadata and one brightness disclosure', () => {
  const html = read('index.html'), nodes = structure();
  const header = elements(parseHtml(html), node => node.tag === 'header');
  assert.equal(header.length, 1);
  for (const className of ['brand', 'badge']) {
    const items = elements(header[0], node => node.attrs.class?.split(/\s+/).includes(className));
    assert.equal(items.length, 1); assert.ok(textContent(items[0]));
  }
  assert.doesNotMatch(html, /<pre\b|id="(?:raw-metadata|epoch-raw)"/i);
  assert.ok(nodes.get('histogram').parents.includes('brightness-controls'));
  assert.ok(!nodes.get('histogram').parents.includes('brightness-about'));
  assert.ok(nodes.get('brightness-about').parents.includes('brightness-controls'));
  assert.doesNotMatch(nodes.get('brightness-about').attrs, /\bopen\b/);
});

test('readable fields retain all warnings and precision formatting never mutates data', () => {
  const original = { calibration: { status: 'unverified' }, warnings: Array.from({length:20},(_,i) => `Warning ${i}`), wavelength: .860123456789 };
  const before = JSON.stringify(original), host = { children: [], replaceChildren() { this.children=[]; }, append(...nodes) { this.children.push(...nodes); } };
  context.document = { createElement: () => ({}) };
  context.window.SpherexUI.fields(host, original);
  const text = host.children.map(n => n.textContent).join(' ');
  assert.match(text,/unverified/);
  assert.match(text,/Warning 19/);
  assert.match(text,/0\.860123/);
  assert.equal(JSON.stringify(original),before);
});

test('narrow Fit puts Color Bar below WCS without shrinking readable annotations', () => {
  for (const [width,height] of [[29,29],[320,160],[100,600]]) {
    const plan=view.fit(width,height,282,440,true);
    const model=axes.layout(axesFixture(),width,height,plan.factor),size=bar.measure(model,false,true);
    assert.equal(plan.stageScale,1);
    assert.ok(size.width<=282+1e-7);
    assert.ok(size.height<=440+1e-7);
    assert.ok(size.top>=model.margin.top+model.height+model.margin.bottom);
    assert.ok(size.left>=0 && size.left+210<=size.width);
  }
});


test('observation list exists only inside accessible bounded native dialog', () => {
  const nodes=structure(), css=read('styles.css');
  assert.equal(nodes.get('observations-modal').tag,'dialog');
  assert.match(nodes.get('observations-modal').attrs,/aria-labelledby="observations-title"/);
  for(const id of ['epoch-products','epochs-more','select-first-2','select-first-3','clear-selection','load-frames']) {
    assert.ok(nodes.get(id).parents.includes('observations-modal')); assert.ok(!nodes.get(id).parents.includes('epochs-panel'));
  }
  assert.ok(nodes.get('change-selection').parents.includes('epoch-view-panel'));
  assert.match(css,/max-height:calc\(100dvh - 16px\)/);
  assert.match(css,/\.modal-content \{ overflow:auto; min-height:0/);
});

test('dashboard removes the search card and groups selection and Fit in one horizontal action row', () => {
  const html=read('index.html'),css=read('styles.css');
  assert.doesNotMatch(html,/id="(?:epochs-panel|select-observations)"/);
  const actions = elements(parseHtml(html), node => node.attrs.class?.split(/\s+/).includes('viewer-actions'));
  assert.equal(actions.length, 1);
  assert.deepEqual(elements(actions[0], node => node.tag === 'button').map(node => node.attrs.id), ['change-selection', 'epoch-fit-view']);
  assert.match(css,/.viewer-actions {[^}]*display:flex;[^}]*gap:10px/);
  assert.match(css,/.viewer-actions button { flex:0 0 auto/);
});

test('click zoom starts below 1x at fractional Fit and tiny-image Fit stops safely at 32x', () => {
  for (const [width,height] of [[2048,2048],[1,1]]) {
    const node=()=>({style:{},events:{},value:'1',addEventListener(k,fn){this.events[k]=fn;},setAttribute(){},getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}});
    const viewport=node(), stage=node(), frame=node(), slider=node(), button=node(), output=node(), image=node();
    viewport.clientWidth=900;viewport.clientHeight=600;viewport.scrollLeft=viewport.scrollTop=0;
    const instance=view.create({viewport,stage,frame,slider,button,output,image:()=>image,redraw:()=>instance.geometry(width,height)});
    instance.geometry(width,height);const fit=Number(slider.value);
    if(width===2048)assert.ok(fit<1);else assert.equal(fit,32);
    viewport.events.click({target:image,clientX:50,clientY:50});
    assert.ok(Math.abs(Number(slider.value)-Math.min(32,fit*1.5))<1e-9);
    if(width===1)assert.equal(image.style.cursor,'default');
    button.events.click();assert.match(output.textContent,/Fit/);assert.equal(Number(slider.value),fit);
  }
});


test('optional fields omit empty values, preserve false and zero, and never invent science results', () => {
  const host = { children: [], replaceChildren() { this.children=[]; }, append(...nodes) { this.children.push(...nodes); } };
  context.document = { createElement: () => ({}) };
  const ui=context.window.SpherexUI;
  ui.fields(host, ui.details({}));
  assert.equal(host.hidden,true); assert.equal(host.children.length,0);
  ui.fields(host, { missing:null, blank:'  ', empty:[], nested:{ absent:undefined }, zero:0, flag:false });
  assert.deepEqual(host.children.map(n=>n.textContent),['zero','0','flag','false']);
  assert.equal(host.hidden,false);
  ui.fields(host,ui.details({ alignment:{status:'failed',reason:'Too few stars'}, warnings:['Different wavelengths cannot be compared directly.'], error:{code:'cutout_failed',message:'Failed slot retained'} }, {wavelength_compatible:false,calibration_compatible:true}));
  const text=host.children.map(n=>n.textContent).join(' ');
  assert.match(text,/Alignment status failed/); assert.match(text,/Wavelength compatibility Not compatible/);
  assert.match(text,/Calibration compatibility Compatible/); assert.match(text,/Too few stars/);
  assert.match(text,/Different wavelengths/); assert.match(text,/Failure reason cutout_failed: Failed slot retained/);
  ui.fields(host,ui.details({})); assert.equal(host.hidden,true);
});

test('public API settings are removed and both modal actions belong to the fixed footer', () => {
  const html=read('index.html'),css=read('styles.css');
  assert.doesNotMatch(html,/id="(?:api-url|environment)"/i);
  const footer = elements(parseHtml(html), node => node.attrs.class?.split(/\s+/).includes('modal-footer'));
  assert.equal(footer.length, 1);
  assert.deepEqual(elements(footer[0], node => node.tag === 'button').map(node => node.attrs.id), ['observations-cancel', 'load-frames']);
  assert.match(css,/\.modal-footer \.primary \{ width:auto; margin:0;/);
  assert.match(css,/\.modal-header,\.modal-footer \{[^}]*flex-shrink:0/);
});
